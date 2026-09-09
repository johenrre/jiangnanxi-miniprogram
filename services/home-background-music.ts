const HOME_MUSIC_VOLUME = 0.22

type MusicStateListener = (isPlaying: boolean) => void

interface WxInnerAudioApi {
  createInnerAudioContext(
    options?: { useWebAudioImplement?: boolean },
  ): WechatMiniprogram.InnerAudioContext
}

class HomeBackgroundMusic {
  private audio: WechatMiniprogram.InnerAudioContext | null = null
  private listener: MusicStateListener | null = null
  private playing = false
  private playRequested = false
  private source = ''

  setSource(source: string): void {
    const nextSource = String(source || '').trim()
    if (nextSource === this.source) return
    this.source = nextSource
    if (!this.audio) return
    if (this.playing || this.playRequested) this.pause()
    if (nextSource) this.audio.src = nextSource
  }

  attach(listener: MusicStateListener): void {
    this.listener = listener
    listener(this.playing)
  }

  detach(): void {
    this.listener = null
  }

  play(): void {
    if (!this.source || this.playing || this.playRequested) return
    const audio = this.ensureAudio()
    if (!audio) return
    try {
      this.playRequested = true
      audio.play()
    } catch {
      this.playRequested = false
      this.updatePlaying(false)
    }
  }

  toggle(): void {
    if (!this.source) {
      wx.showToast({ title: '背景音乐暂未配置', icon: 'none' })
      return
    }
    const audio = this.ensureAudio()
    if (!audio) return
    try {
      if (this.playing || this.playRequested) {
        this.playRequested = false
        audio.pause()
      } else {
        this.playRequested = true
        audio.play()
      }
    } catch {
      this.playRequested = false
      this.updatePlaying(false)
      wx.showToast({ title: '音乐暂时无法播放', icon: 'none' })
    }
  }

  pause(): void {
    if (!this.audio || (!this.playing && !this.playRequested)) return
    try {
      this.playRequested = false
      this.audio.pause()
    } catch {
      this.updatePlaying(false)
    }
  }

  private ensureAudio(): WechatMiniprogram.InnerAudioContext | null {
    if (!this.source) return null
    if (this.audio) return this.audio
    try {
      this.audio = (wx as unknown as WxInnerAudioApi).createInnerAudioContext({
        useWebAudioImplement: true,
      })
    } catch {
      try {
        this.audio = wx.createInnerAudioContext()
      } catch {
        return null
      }
    }

    const audio = this.audio
    audio.autoplay = false
    audio.loop = true
    audio.obeyMuteSwitch = false
    audio.volume = HOME_MUSIC_VOLUME
    audio.src = this.source
    audio.onPlay(() => {
      this.playRequested = false
      this.updatePlaying(true)
    })
    audio.onPause(() => {
      this.playRequested = false
      this.updatePlaying(false)
    })
    audio.onStop(() => {
      this.playRequested = false
      this.updatePlaying(false)
    })
    audio.onEnded(() => {
      this.playRequested = false
      this.updatePlaying(false)
    })
    audio.onError(() => {
      this.playRequested = false
      this.updatePlaying(false)
      wx.showToast({ title: '音乐暂时无法播放', icon: 'none' })
    })
    return audio
  }

  private updatePlaying(playing: boolean): void {
    if (this.playing === playing) return
    this.playing = playing
    this.listener?.(playing)
  }
}

export const homeBackgroundMusic = new HomeBackgroundMusic()
