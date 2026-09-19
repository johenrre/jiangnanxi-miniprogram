import {
  BeadShadowSystem,
  type BeadCanvasImage,
} from '@/pages/diy/engine/bead-shadow'
import type { DiyBead } from '@/pages/diy/model/types'
import { loadImage } from '@/utils/image-loader'
import { resolveCanvasImageUrl } from '@/utils/material-image'
import { getMaterialRenderMetrics } from '@/utils/material-render-geometry'
import { isRemoteResourceUrl } from '@/utils/resource-cache'

interface DiyCanvasContext {
  fillStyle: string | WechatMiniprogram.CanvasGradient
  strokeStyle: string | WechatMiniprogram.CanvasGradient
  globalAlpha: number
  lineWidth: number
  lineCap: string
  lineJoin: string
  shadowColor: string
  shadowBlur: number
  shadowOffsetX: number
  shadowOffsetY: number
  font: string
  textAlign: string
  textBaseline: string
  clearRect(x: number, y: number, width: number, height: number): void
  fillRect(x: number, y: number, width: number, height: number): void
  save(): void
  restore(): void
  scale(x: number, y: number): void
  translate(x: number, y: number): void
  rotate(angle: number): void
  beginPath(): void
  closePath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void
  fill(): void
  stroke(): void
  clip(): void
  fillText(text: string, x: number, y: number, maximumWidth?: number): void
  drawImage(
    image: BeadCanvasImage | DiyRenderCanvas,
    destinationX: number,
    destinationY: number,
    destinationWidth: number,
    destinationHeight: number,
  ): void
  createRadialGradient(
    startX: number,
    startY: number,
    startRadius: number,
    endX: number,
    endY: number,
    endRadius: number,
  ): WechatMiniprogram.CanvasGradient
}

interface DiyRenderCanvas {
  width: number
  height: number
  getContext(type: '2d'): DiyCanvasContext | null
}

export type DiyCanvas = WechatMiniprogram.Canvas & {
  width: number
  height: number
}

export interface EditorOrigin {
  centerX: number
  centerY: number
  radius: number
}

interface CachedImage {
  image: WechatMiniprogram.Image
  status: 'loading' | 'ready' | 'error'
  settled: Promise<boolean>
  resolveSettled: (ready: boolean) => void
  loadStarted: boolean
}

interface QueuedImageLoad {
  source: string
  cached: CachedImage
}

interface BeadRenderItem {
  bead: DiyBead
  renderImageUrl: string
  displayWidth: number
  displayHeight: number
  anchorX: number
  anchorY: number
  image: WechatMiniprogram.Image | null
  cachedImage: CachedImage | null
  cachedCanvasImageUrl: string
  cachedDisplayImageUrl: string
  cachedSizeMm: number
  cachedModeScale: number
  cachedStringingWidthMm: number | null
  cachedStringingPosition: 'center' | 'top'
  cachedIsIrregular: boolean
  lastUsedFrame: number
}

const MAXIMUM_CONCURRENT_CANVAS_IMAGE_LOADS = 3
const RENDER_ITEM_CACHE_SWEEP_INTERVAL = 120
const RENDER_ITEM_CACHE_ALLOWANCE = 8
export const BEAD_LOADING_PLACEHOLDER_PATH = '/assets/diy/bead-loading-heart.png'

function compareBeadDepth(
  left: DiyBead,
  right: DiyBead,
  activeBeadUid: string | null,
): number {
  const leftIsActive = left.uid === activeBeadUid
  const rightIsActive = right.uid === activeBeadUid
  if (leftIsActive !== rightIsActive) return leftIsActive ? 1 : -1
  return left.layer - right.layer || left.y - right.y
}

export class BraceletRenderer {
  private readonly canvas: DiyCanvas
  private readonly context: DiyCanvasContext
  private readonly imageCache = new Map<string, CachedImage>()
  private readonly imageLoadQueue: QueuedImageLoad[] = []
  private readonly renderItemByUid = new Map<string, BeadRenderItem>()
  private readonly sortedBeads: DiyBead[] = []
  private readonly activeRenderItems: BeadRenderItem[] = []
  private readonly shadowSystem: BeadShadowSystem
  private readonly invalidate: () => void
  private logicalWidth: number
  private logicalHeight: number
  private activeImageLoads = 0
  private renderFrameSequence = 0
  private activeBeadUid: string | null = null
  private destroyed = false
  private readonly compareRenderDepth = (left: DiyBead, right: DiyBead): number => (
    compareBeadDepth(left, right, this.activeBeadUid)
  )

  constructor(
    canvas: DiyCanvas,
    logicalWidth: number,
    logicalHeight: number,
    pixelRatio: number,
    invalidate: () => void,
  ) {
    this.canvas = canvas
    this.logicalWidth = logicalWidth
    this.logicalHeight = logicalHeight
    this.invalidate = invalidate
    canvas.width = Math.round(logicalWidth * pixelRatio)
    canvas.height = Math.round(logicalHeight * pixelRatio)
    this.context = canvas.getContext('2d') as DiyCanvasContext
    this.context.scale(pixelRatio, pixelRatio)
    this.shadowSystem = new BeadShadowSystem(canvas)
    this.preloadImage(BEAD_LOADING_PLACEHOLDER_PATH)
  }

  resize(logicalWidth: number, logicalHeight: number, pixelRatio: number): void {
    if (this.destroyed) return
    this.logicalWidth = logicalWidth
    this.logicalHeight = logicalHeight
    this.canvas.width = Math.round(logicalWidth * pixelRatio)
    this.canvas.height = Math.round(logicalHeight * pixelRatio)
    this.context.scale(pixelRatio, pixelRatio)
  }

  getBeadDisplaySize(
    bead: DiyBead,
    modeScale: number,
  ): { width: number; height: number; anchorX: number; anchorY: number } {
    const renderImageUrl = resolveCanvasImageUrl(bead)
    const cachedImage = renderImageUrl ? this.imageCache.get(renderImageUrl) : null
    const image = cachedImage?.status === 'ready'
      && cachedImage.image.width > 0
      && cachedImage.image.height > 0
      ? cachedImage.image
      : null
    return getMaterialRenderMetrics(bead, image, 2.836, modeScale)
  }

  async preloadImages(sources: string[]): Promise<void> {
    if (this.destroyed) return
    const uniqueSources = Array.from(new Set(sources.filter((source) => Boolean(source))))
    await Promise.all(uniqueSources.map((source) => {
      const cached = this.getImage(source)
      return cached?.settled ?? Promise.resolve(false)
    }))
  }

  render(
    beads: DiyBead[],
    displayScale = 1,
    activeBeadUid: string | null = null,
  ): void {
    if (this.destroyed) return

    this.context.clearRect(0, 0, this.logicalWidth, this.logicalHeight)

    this.renderFrameSequence += 1
    this.activeBeadUid = activeBeadUid
    this.sortedBeads.length = beads.length
    for (let index = 0; index < beads.length; index += 1) {
      this.sortedBeads[index] = beads[index]
    }
    this.sortedBeads.sort(this.compareRenderDepth)
    this.activeRenderItems.length = beads.length
    for (let index = 0; index < this.sortedBeads.length; index += 1) {
      this.activeRenderItems[index] = this.getBeadRenderItem(
        this.sortedBeads[index],
        displayScale,
      )
    }

    for (let index = 0; index < this.activeRenderItems.length; index += 1) {
      const {
        bead,
        renderImageUrl,
        image,
        displayWidth,
        displayHeight,
        anchorX,
        anchorY,
      } = this.activeRenderItems[index]
      this.shadowSystem.draw(
        this.context,
        bead,
        renderImageUrl,
        image,
        displayWidth,
        displayHeight,
        anchorX,
        anchorY,
      )
    }
    for (let index = 0; index < this.activeRenderItems.length; index += 1) {
      this.drawBead(this.activeRenderItems[index])
    }
    this.sweepRenderItemCache()

  }

  clear(): void {
    if (this.destroyed) return
    this.context.clearRect(0, 0, this.logicalWidth, this.logicalHeight)
  }

  destroy(): void {
    this.destroyed = true
    this.imageLoadQueue.length = 0
    this.imageCache.forEach((cached) => {
      const { image } = cached
      image.onload = () => undefined
      image.onerror = () => undefined
      if (cached.status === 'loading') {
        cached.status = 'error'
        cached.resolveSettled(false)
      }
    })
    this.activeImageLoads = 0
    this.imageCache.clear()
    this.renderItemByUid.clear()
    this.sortedBeads.length = 0
    this.activeRenderItems.length = 0
    this.shadowSystem.destroy()
  }

  private getBeadRenderItem(
    bead: DiyBead,
    modeScale: number,
  ): BeadRenderItem {
    let item = this.renderItemByUid.get(bead.uid)
    if (!item) {
      item = {
        bead,
        renderImageUrl: '',
        displayWidth: 0,
        displayHeight: 0,
        anchorX: 0,
        anchorY: 0,
        image: null,
        cachedImage: null,
        cachedCanvasImageUrl: '',
        cachedDisplayImageUrl: '',
        cachedSizeMm: Number.NaN,
        cachedModeScale: Number.NaN,
        cachedStringingWidthMm: null,
        cachedStringingPosition: bead.stringingPosition,
        cachedIsIrregular: bead.isIrregular,
        lastUsedFrame: this.renderFrameSequence,
      }
      this.renderItemByUid.set(bead.uid, item)
    }

    const sourceChanged = item.cachedCanvasImageUrl !== bead.canvasImageUrl
      || item.cachedDisplayImageUrl !== bead.displayImageUrl
    if (sourceChanged) {
      item.renderImageUrl = resolveCanvasImageUrl(bead)
      item.cachedImage = item.renderImageUrl ? this.getImage(item.renderImageUrl) : null
      item.cachedCanvasImageUrl = bead.canvasImageUrl
      item.cachedDisplayImageUrl = bead.displayImageUrl
    }
    const cachedImage = item.cachedImage
    const image = cachedImage?.status === 'ready'
      && cachedImage.image.width > 0
      && cachedImage.image.height > 0
      ? cachedImage.image
      : null
    const metricsChanged = item.image !== image
      || item.cachedSizeMm !== bead.sizeMm
      || item.cachedModeScale !== modeScale
      || item.cachedStringingWidthMm !== bead.stringingWidthMm
      || item.cachedStringingPosition !== bead.stringingPosition
      || item.cachedIsIrregular !== bead.isIrregular

    item.bead = bead
    item.image = image
    item.lastUsedFrame = this.renderFrameSequence
    if (metricsChanged) {
      const metrics = getMaterialRenderMetrics(bead, image, 2.836, modeScale)
      item.displayWidth = metrics.width
      item.displayHeight = metrics.height
      item.anchorX = metrics.anchorX
      item.anchorY = metrics.anchorY
      item.cachedSizeMm = bead.sizeMm
      item.cachedModeScale = modeScale
      item.cachedStringingWidthMm = bead.stringingWidthMm
      item.cachedStringingPosition = bead.stringingPosition
      item.cachedIsIrregular = bead.isIrregular
    }
    return item
  }

  private sweepRenderItemCache(): void {
    if (
      this.renderFrameSequence % RENDER_ITEM_CACHE_SWEEP_INTERVAL !== 0
      || this.renderItemByUid.size
        <= this.activeRenderItems.length + RENDER_ITEM_CACHE_ALLOWANCE
    ) return

    const oldestActiveFrame = this.renderFrameSequence - RENDER_ITEM_CACHE_SWEEP_INTERVAL
    this.renderItemByUid.forEach((item, uid) => {
      if (item.lastUsedFrame < oldestActiveFrame) this.renderItemByUid.delete(uid)
    })
  }

  private drawBead(item: BeadRenderItem): void {
    const {
      bead,
      displayWidth,
      displayHeight,
      anchorX,
      anchorY,
      image,
      cachedImage,
    } = item

    this.context.save()
    this.context.translate(bead.x, bead.y)
    this.context.rotate(bead.rotation)

    let imageDrawn = false
    if (image) {
      try {
        this.context.drawImage(
          image,
          -anchorX,
          -anchorY,
          displayWidth,
          displayHeight,
        )
        imageDrawn = true
      } catch {
        if (cachedImage) cachedImage.status = 'error'
      }
    }
    if (!imageDrawn) {
      this.drawPlaceholderBead(displayWidth, displayHeight, anchorX, anchorY)
    }
    this.context.restore()
  }

  private drawPlaceholderBead(
    width: number,
    height: number,
    anchorX: number,
    anchorY: number,
  ): void {
    const cached = this.getImage(BEAD_LOADING_PLACEHOLDER_PATH)
    if (!cached || cached.status !== 'ready') return
    try {
      this.context.drawImage(cached.image, -anchorX, -anchorY, width, height)
    } catch {
      cached.status = 'error'
    }
  }

  private preloadImage(source: string): void {
    this.getImage(source)
  }

  private getImage(source: string): CachedImage | null {
    if (!source) return null
    const existing = this.imageCache.get(source)
    if (existing) return existing

    const image = this.canvas.createImage()
    let resolveSettled: (ready: boolean) => void = () => undefined
    const settled = new Promise<boolean>((resolve) => {
      resolveSettled = resolve
    })
    const cached: CachedImage = {
      image,
      status: 'loading',
      settled,
      resolveSettled,
      loadStarted: false,
    }
    this.imageCache.set(source, cached)
    this.imageLoadQueue.push({ source, cached })
    this.pumpImageLoadQueue()
    return cached
  }

  private pumpImageLoadQueue(): void {
    if (this.destroyed) return
    while (
      this.activeImageLoads < MAXIMUM_CONCURRENT_CANVAS_IMAGE_LOADS
      && this.imageLoadQueue.length > 0
    ) {
      const queued = this.imageLoadQueue.shift()
      if (!queued || queued.cached.status !== 'loading') continue
      queued.cached.loadStarted = true
      this.activeImageLoads += 1
      this.startImageLoad(queued.source, queued.cached)
    }
  }

  private startImageLoad(source: string, cached: CachedImage): void {
    // Keep the same URL as the material card so WeChat can reuse its image cache.
    if (isRemoteResourceUrl(source)) {
      this.loadCanvasImage(cached, source)
      return
    }

    void loadImage(source).then(
      (result) => {
        if (this.destroyed) return
        if (result.status !== 'ready' || !result.localPath) {
          this.markImageUnavailable(cached)
          return
        }
        this.loadCanvasImage(cached, result.localPath)
      },
      () => {
        if (this.destroyed) return
        this.markImageUnavailable(cached)
      },
    )
  }

  private loadCanvasImage(cached: CachedImage, source: string): void {
    const { image } = cached
    image.onload = () => {
      this.settleImageLoad(cached, 'ready')
    }
    image.onerror = () => {
      this.settleImageLoad(cached, 'error')
    }
    try {
      image.src = source
    } catch {
      this.markImageUnavailable(cached)
    }
  }

  private markImageUnavailable(cached: CachedImage): void {
    this.settleImageLoad(cached, 'error')
  }

  private settleImageLoad(cached: CachedImage, status: 'ready' | 'error'): void {
    if (cached.status !== 'loading') return
    cached.status = status
    cached.resolveSettled(status === 'ready')
    if (cached.loadStarted) {
      cached.loadStarted = false
      this.activeImageLoads = Math.max(0, this.activeImageLoads - 1)
    }
    if (this.destroyed) return
    this.invalidate()
    this.pumpImageLoadQueue()
  }
}
