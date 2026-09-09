export type AppSoundEffect = 'impact' | 'discard' | 'soft-pop'

interface SoundImpact {
  volume: number
}

const STATIC_SOUND_SOURCES: Record<AppSoundEffect, string> = {
  impact: '/assets/audio/diy-hit.mp3',
  discard: '/assets/audio/ui-discard.mp3',
  'soft-pop': '/assets/audio/ui-soft-pop.wav',
}

const DECODED_SOUND_PACKAGE_PATHS: Partial<Record<AppSoundEffect, string>> = {
  'soft-pop': 'assets/audio/ui-soft-pop.wav',
}

const DEFAULT_SOUND_VOLUMES: Record<AppSoundEffect, number> = {
  impact: 0.42,
  discard: 0.5,
  'soft-pop': 0.44,
}

const IMPACT_COOLDOWN_MS = 90
const WEB_AUDIO_RETRY_INTERVAL_MS = 3000
const TEMPORARY_NODE_LIFETIME_MS = 140

interface AudioParamLike {
  value: number
  setValueAtTime(value: number, startTime: number): void
  exponentialRampToValueAtTime(value: number, endTime: number): void
}

interface AudioNodeLike {
  connect(destination: AudioNodeLike): unknown
  disconnect?(): void
}

interface GainNodeLike extends AudioNodeLike {
  gain: AudioParamLike
}

interface BiquadFilterNodeLike extends AudioNodeLike {
  type: string
  frequency: AudioParamLike
}

interface OscillatorNodeLike extends AudioNodeLike {
  type: string
  frequency: AudioParamLike
  start(when?: number): void
  stop(when?: number): void
}

interface AudioBufferLike {
  duration: number
}

interface BufferSourceNodeLike extends AudioNodeLike {
  buffer: AudioBufferLike | null
  start(when?: number): void
  stop?(when?: number): void
}

interface WebAudioContextLike {
  currentTime: number
  destination: AudioNodeLike
  state?: string
  createBiquadFilter(): BiquadFilterNodeLike
  createGain(): GainNodeLike
  createOscillator(): OscillatorNodeLike
  createBufferSource?(): BufferSourceNodeLike
  decodeAudioData?(
    audioData: ArrayBuffer,
    successCallback: (buffer: AudioBufferLike) => void,
    errorCallback: () => void,
  ): void
  resume?(): Promise<void> | void
}

interface WxWebAudioApi {
  createWebAudioContext?: () => WebAudioContextLike
}

interface WxInnerAudioApi {
  createInnerAudioContext(
    options?: { useWebAudioImplement?: boolean },
  ): WechatMiniprogram.InnerAudioContext
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function isContextRunning(context: WebAudioContextLike): boolean {
  return !context.state || context.state === 'running'
}

class AppSoundService {
  private context: WebAudioContextLike | null = null
  private outputFilter: BiquadFilterNodeLike | null = null
  private readonly staticAudio = new Map<
    AppSoundEffect,
    WechatMiniprogram.InnerAudioContext
  >()
  private readonly decodedBuffers = new Map<AppSoundEffect, AudioBufferLike>()
  private readonly decodedBufferLoads = new Set<AppSoundEffect>()
  private pendingImpact: SoundImpact | null = null
  private pendingTimer: number | null = null
  private resumeTask: Promise<boolean> | null = null
  private lastImpactAt = 0
  private webAudioRetryAt = 0
  private active = true
  private interrupted = false
  private interruptionListenersInstalled = false
  private innerAudioOptionsConfigured = false

  onAppShow(): void {
    this.active = true
    this.interrupted = false
    this.prepare()
  }

  onAppHide(): void {
    this.active = false
    this.pendingImpact = null
    if (this.pendingTimer !== null) clearTimeout(this.pendingTimer)
    this.pendingTimer = null
    this.staticAudio.forEach((audio) => {
      try {
        if (!audio.paused) audio.stop()
      } catch {
        // The native context may already have been suspended by WeChat.
      }
    })
  }

  prepare(): void {
    this.configureInnerAudioOptions()
    this.installInterruptionListeners()
    ;(Object.keys(STATIC_SOUND_SOURCES) as AppSoundEffect[])
      .forEach((effect) => this.ensureStaticAudio(effect))
    this.ensureWebAudioContext(false)
    this.preloadDecodedStatic('soft-pop')
  }

  resumeOnInteraction(): void {
    if (!this.active) return
    this.interrupted = false
    this.prepare()
    void this.resumeWebAudio(true)
  }

  play(effect: AppSoundEffect, volume = DEFAULT_SOUND_VOLUMES[effect]): void {
    if (!this.active || this.interrupted) return
    this.resumeOnInteraction()
    const normalizedVolume = clamp(volume, 0.04, 1)
    if (effect === 'impact') {
      this.playImpact(normalizedVolume)
      return
    }
    const context = this.ensureWebAudioContext(false)
    if (context && this.playDecodedStatic(context, effect, normalizedVolume)) return
    this.preloadDecodedStatic(effect)
    this.playStatic(effect, normalizedVolume)
  }

  enqueueImpacts(impacts: readonly SoundImpact[]): void {
    if (!this.active || this.interrupted || impacts.length === 0) return

    const strongest = impacts.reduce((best, impact) => (
      impact.volume > best.volume ? impact : best
    ))
    if (!this.pendingImpact || strongest.volume > this.pendingImpact.volume) {
      this.pendingImpact = strongest
    }
    this.flushOrSchedulePendingImpact()
  }

  private flushOrSchedulePendingImpact(): void {
    if (!this.active || !this.pendingImpact) return
    const remainingMs = IMPACT_COOLDOWN_MS - (Date.now() - this.lastImpactAt)
    if (remainingMs <= 0 && this.pendingTimer === null) {
      const impact = this.pendingImpact
      this.pendingImpact = null
      this.playImpact(impact.volume)
      return
    }
    if (this.pendingTimer !== null) return
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null
      if (!this.active || !this.pendingImpact) return
      const impact = this.pendingImpact
      this.pendingImpact = null
      this.playImpact(impact.volume)
    }, Math.max(1, remainingMs))
  }

  private playImpact(volume: number): void {
    if (!this.active || this.interrupted) return
    this.lastImpactAt = Date.now()
    const context = this.ensureWebAudioContext(false)
    if (context && isContextRunning(context)) {
      try {
        if (this.playGeneratedImpact(context, volume)) return
      } catch {
        this.webAudioRetryAt = Date.now() + WEB_AUDIO_RETRY_INTERVAL_MS
      }
    } else if (context) {
      void this.resumeWebAudio(false)
    }
    this.playStatic('impact', volume)
  }

  private ensureWebAudioContext(forceRetry: boolean): WebAudioContextLike | null {
    if (forceRetry) this.webAudioRetryAt = 0
    if (this.context) return this.context
    if (Date.now() < this.webAudioRetryAt) return null

    const audioApi = wx as unknown as WxWebAudioApi
    if (typeof audioApi.createWebAudioContext !== 'function') return null
    try {
      const context = audioApi.createWebAudioContext()
      const filter = context.createBiquadFilter()
      const outputGain = context.createGain()
      filter.type = 'lowpass'
      filter.frequency.value = 4500
      outputGain.gain.value = 0.92
      filter.connect(outputGain)
      outputGain.connect(context.destination)
      this.context = context
      this.outputFilter = filter
      return context
    } catch {
      this.context = null
      this.outputFilter = null
      this.webAudioRetryAt = Date.now() + WEB_AUDIO_RETRY_INTERVAL_MS
      return null
    }
  }

  private resumeWebAudio(forceRetry: boolean): Promise<boolean> {
    const context = this.ensureWebAudioContext(forceRetry)
    if (!context) return Promise.resolve(false)
    if (isContextRunning(context)) return Promise.resolve(true)
    if (typeof context.resume !== 'function') return Promise.resolve(false)
    if (this.resumeTask) return this.resumeTask

    try {
      const resumeResult = context.resume()
      this.resumeTask = Promise.resolve(resumeResult)
        .then(() => {
          const ready = isContextRunning(context)
          this.webAudioRetryAt = ready ? 0 : Date.now() + WEB_AUDIO_RETRY_INTERVAL_MS
          return ready
        })
        .catch(() => {
          this.webAudioRetryAt = Date.now() + WEB_AUDIO_RETRY_INTERVAL_MS
          return false
        })
        .finally(() => {
          this.resumeTask = null
        })
      return this.resumeTask
    } catch {
      this.webAudioRetryAt = Date.now() + WEB_AUDIO_RETRY_INTERVAL_MS
      return Promise.resolve(false)
    }
  }

  private playGeneratedImpact(context: WebAudioContextLike, volume: number): boolean {
    const output = this.outputFilter
    if (!output) return false

    const normalizedVolume = clamp(volume, 0.08, 0.8)
    const now = context.currentTime
    const clickOscillator = context.createOscillator()
    const clickGain = context.createGain()
    const bodyOscillator = context.createOscillator()
    const bodyGain = context.createGain()

    clickOscillator.type = 'triangle'
    clickOscillator.frequency.setValueAtTime(2500 + 800 * Math.random(), now)
    clickGain.gain.setValueAtTime(0.4 * normalizedVolume, now)
    clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.02)
    clickOscillator.connect(clickGain)
    clickGain.connect(output)

    bodyOscillator.type = 'sine'
    bodyOscillator.frequency.setValueAtTime(700 + 300 * Math.random(), now)
    bodyGain.gain.setValueAtTime(0.7 * normalizedVolume, now)
    bodyGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08)
    bodyOscillator.connect(bodyGain)
    bodyGain.connect(output)

    clickOscillator.start(now)
    clickOscillator.stop(now + 0.03)
    bodyOscillator.start(now)
    bodyOscillator.stop(now + 0.1)

    setTimeout(() => {
      this.disconnectNode(clickOscillator)
      this.disconnectNode(clickGain)
      this.disconnectNode(bodyOscillator)
      this.disconnectNode(bodyGain)
    }, TEMPORARY_NODE_LIFETIME_MS)
    return true
  }

  private preloadDecodedStatic(effect: AppSoundEffect): void {
    const packagePath = DECODED_SOUND_PACKAGE_PATHS[effect]
    if (
      !packagePath
      || this.decodedBuffers.has(effect)
      || this.decodedBufferLoads.has(effect)
    ) return
    const context = this.ensureWebAudioContext(false)
    if (
      !context
      || typeof context.decodeAudioData !== 'function'
      || typeof context.createBufferSource !== 'function'
    ) return

    this.decodedBufferLoads.add(effect)
    const finishLoad = (): void => {
      this.decodedBufferLoads.delete(effect)
    }
    try {
      wx.getFileSystemManager().readFile({
        filePath: packagePath,
        success: (result) => {
          if (typeof result.data === 'string') {
            finishLoad()
            return
          }
          try {
            context.decodeAudioData?.(
              result.data,
              (buffer) => {
                finishLoad()
                if (this.context === context) this.decodedBuffers.set(effect, buffer)
              },
              finishLoad,
            )
          } catch {
            finishLoad()
          }
        },
        fail: finishLoad,
      })
    } catch {
      finishLoad()
    }
  }

  private playDecodedStatic(
    context: WebAudioContextLike,
    effect: AppSoundEffect,
    volume: number,
  ): boolean {
    const buffer = this.decodedBuffers.get(effect)
    if (!buffer || typeof context.createBufferSource !== 'function') return false

    try {
      const source = context.createBufferSource()
      const gain = context.createGain()
      const now = context.currentTime
      source.buffer = buffer
      gain.gain.setValueAtTime(clamp(volume, 0.04, 0.82), now)
      source.connect(gain)
      gain.connect(context.destination)
      source.start(now)
      setTimeout(() => {
        this.disconnectNode(source)
        this.disconnectNode(gain)
      }, Math.ceil((buffer.duration + 0.08) * 1000))
      return true
    } catch {
      return false
    }
  }

  private disconnectNode(node: AudioNodeLike): void {
    try {
      node.disconnect?.()
    } catch {
      // A stopped WebAudio node may already be disconnected by the host.
    }
  }

  private configureInnerAudioOptions(): void {
    if (this.innerAudioOptionsConfigured) return
    try {
      wx.setInnerAudioOption({
        mixWithOther: true,
        obeyMuteSwitch: false,
        success: () => { this.innerAudioOptionsConfigured = true },
        fail: () => { this.innerAudioOptionsConfigured = false },
      })
    } catch {
      this.innerAudioOptionsConfigured = false
    }
  }

  private ensureStaticAudio(
    effect: AppSoundEffect,
  ): WechatMiniprogram.InnerAudioContext | null {
    const existing = this.staticAudio.get(effect)
    if (existing) return existing
    let audio: WechatMiniprogram.InnerAudioContext
    try {
      audio = (wx as unknown as WxInnerAudioApi).createInnerAudioContext({
        useWebAudioImplement: true,
      })
    } catch {
      try {
        audio = wx.createInnerAudioContext()
      } catch {
        return null
      }
    }
    try {
      audio.autoplay = false
      audio.loop = false
      audio.obeyMuteSwitch = false
      audio.src = STATIC_SOUND_SOURCES[effect]
      this.staticAudio.set(effect, audio)
      return audio
    } catch {
      try {
        audio.destroy()
      } catch {
        // The native context may not have completed initialization.
      }
      return null
    }
  }

  private playStatic(effect: AppSoundEffect, volume: number): void {
    const audio = this.ensureStaticAudio(effect)
    if (!audio) return
    try {
      audio.stop()
      audio.startTime = 0
      audio.volume = clamp(volume, 0.04, 0.82)
      audio.play()
    } catch {
      // The next real user interaction will prepare the native context again.
    }
  }

  private installInterruptionListeners(): void {
    if (this.interruptionListenersInstalled) return
    this.interruptionListenersInstalled = true
    wx.onAudioInterruptionBegin(() => {
      this.interrupted = true
      this.pendingImpact = null
    })
    wx.onAudioInterruptionEnd(() => {
      this.interrupted = false
      if (this.active) void this.resumeWebAudio(true)
    })
  }
}

export const appSound = new AppSoundService()
