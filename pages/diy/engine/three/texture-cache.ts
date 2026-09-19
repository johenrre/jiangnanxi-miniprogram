import type {
  DiyWebglCanvas,
  TextureAsset,
  ThreeNamespace,
} from '@/pages/diy/engine/three/types'

interface MutableTextureAsset extends TextureAsset {
  resolveReady(ready: boolean): void
}

export class ThreeTextureCache {
  private readonly assets = new Map<string, MutableTextureAsset>()
  private destroyed = false

  constructor(
    private readonly THREE: ThreeNamespace,
    private readonly canvas: DiyWebglCanvas,
    private readonly invalidate: () => void,
  ) {}

  get(source: string): TextureAsset | null {
    const normalizedSource = String(source || '').trim()
    if (!normalizedSource || this.destroyed) return null
    const existing = this.assets.get(normalizedSource)
    if (existing) return existing

    let resolveReady: (ready: boolean) => void = () => undefined
    const ready = new Promise<boolean>((resolve) => {
      resolveReady = resolve
    })
    const asset: MutableTextureAsset = {
      source: normalizedSource,
      status: 'loading',
      texture: null,
      width: 0,
      height: 0,
      ready,
      resolveReady,
    }
    this.assets.set(normalizedSource, asset)
    this.loadWithCanvasImage(asset, normalizedSource, true)
    return asset
  }

  async preload(sources: string[]): Promise<void> {
    const uniqueSources = Array.from(new Set(
      sources.map((source) => String(source || '').trim()).filter(Boolean),
    ))
    await Promise.all(uniqueSources.map((source) => (
      this.get(source)?.ready ?? Promise.resolve(false)
    )))
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.assets.forEach((asset) => {
      asset.texture?.dispose?.()
      if (asset.status === 'loading') asset.resolveReady(false)
    })
    this.assets.clear()
  }

  private loadWithCanvasImage(
    asset: MutableTextureAsset,
    source: string,
    allowLocalPathFallback: boolean,
  ): void {
    if (this.destroyed || asset.status !== 'loading') return
    let image: WechatMiniprogram.Image
    try {
      image = this.canvas.createImage()
    } catch {
      this.fail(asset)
      return
    }

    image.onload = () => {
      if (this.destroyed || asset.status !== 'loading') return
      try {
        const texture = new this.THREE.Texture(image)
        texture.generateMipmaps = false
        if (this.THREE.LinearFilter !== undefined) {
          texture.minFilter = this.THREE.LinearFilter
          texture.magFilter = this.THREE.LinearFilter
        }
        if (
          texture.encoding !== undefined
          && this.THREE.LinearEncoding !== undefined
        ) {
          texture.encoding = this.THREE.LinearEncoding
        }
        texture.needsUpdate = true
        asset.texture = texture
        asset.width = Math.max(1, Number(image.width) || 1)
        asset.height = Math.max(1, Number(image.height) || 1)
        asset.status = 'ready'
        asset.resolveReady(true)
        this.invalidate()
      } catch {
        this.fail(asset)
      }
    }
    image.onerror = () => {
      if (!allowLocalPathFallback || !/^https?:\/\//i.test(source)) {
        this.fail(asset)
        return
      }
      wx.getImageInfo({
        src: source,
        success: (result) => {
          const localPath = String(result.path || '').trim()
          if (!localPath) {
            this.fail(asset)
            return
          }
          this.loadWithCanvasImage(asset, localPath, false)
        },
        fail: () => this.fail(asset),
      })
    }
    try {
      image.src = source
    } catch {
      this.fail(asset)
    }
  }

  private fail(asset: MutableTextureAsset): void {
    if (asset.status !== 'loading') return
    asset.status = 'error'
    asset.resolveReady(false)
    if (!this.destroyed) this.invalidate()
  }
}
