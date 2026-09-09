import { getEditorTrayRadius } from '@/pages/diy/engine/geometry'
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

export type BraceletRenderMode = 'editor' | 'showcase'

export interface ShowcaseShareBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface ShowcasePlateOrigin {
  centerX: number
  centerY: number
  radius: number
}

export interface DiyShowcasePresentation {
  appDisplayName: string
  eyebrow: string
  title: string
  description: string
}

const DEFAULT_DIY_SHOWCASE_PRESENTATION: DiyShowcasePresentation = {
  appDisplayName: '',
  eyebrow: 'MY CRYSTAL · 今日作品',
  title: '把喜欢的光，串成日常',
  description: '一串一念，留住此刻的温柔。',
}

export function createDefaultDiyShowcasePresentation(): DiyShowcasePresentation {
  return { ...DEFAULT_DIY_SHOWCASE_PRESENTATION }
}

export function getShowcaseShareBounds(
  canvasWidth: number,
  safeAreaTop: number,
): ShowcaseShareBounds {
  return {
    x: Math.max(18, canvasWidth - 122),
    y: safeAreaTop + 91,
    width: 104,
    height: 36,
  }
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

interface TrayTemplate {
  canvas: DiyRenderCanvas
  bodySize: number
}

interface OffscreenCanvasFactory {
  createOffscreenCanvas?: (
    options?: { type: '2d'; width: number; height: number },
  ) => DiyRenderCanvas
}

interface HostCanvasFactory {
  createOffscreenCanvas?: (width: number, height: number) => DiyRenderCanvas
}

const FULL_CIRCLE = Math.PI * 2
const MAXIMUM_CONCURRENT_CANVAS_IMAGE_LOADS = 3
const TRAY_TEMPLATE_SIZE = 1024
const TRAY_TEMPLATE_INSET = 44
const MAXIMUM_TRAY_TEMPLATES = 2
const RENDER_ITEM_CACHE_SWEEP_INTERVAL = 120
const RENDER_ITEM_CACHE_ALLOWANCE = 8
export const BEAD_LOADING_PLACEHOLDER_PATH = '/assets/diy/bead-loading-heart.png'
const DEFAULT_TRAY_BACKGROUND_PATHS = [
  '/assets/bg_1.jpg',
] as const
const FALLBACK_TRAY_BACKGROUND_PATH = DEFAULT_TRAY_BACKGROUND_PATHS[0]
export const TRAY_BACKGROUND_COUNT = DEFAULT_TRAY_BACKGROUND_PATHS.length

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

function normalizeTrayBackgroundPaths(paths: readonly string[]): string[] {
  const normalized = [...new Set(paths.map((path) => String(path || '').trim()).filter(Boolean))]
  return normalized.length > 0 ? normalized : [...DEFAULT_TRAY_BACKGROUND_PATHS]
}

function normalizeShowcaseBrandImagePath(path: string): string {
  return String(path || '').trim()
}

export class BraceletRenderer {
  private readonly canvas: DiyCanvas
  private readonly context: DiyCanvasContext
  private readonly imageCache = new Map<string, CachedImage>()
  private readonly imageLoadQueue: QueuedImageLoad[] = []
  private readonly trayTemplates = new Map<string, TrayTemplate | null>()
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
  private trayBackgroundPaths: string[]
  private showcasePresentation: DiyShowcasePresentation
  private showcaseBrandImagePath: string
  private destroyed = false
  private readonly compareRenderDepth = (left: DiyBead, right: DiyBead): number => (
    compareBeadDepth(left, right, this.activeBeadUid)
  )

  constructor(
    canvas: DiyCanvas,
    logicalWidth: number,
    logicalHeight: number,
    pixelRatio: number,
    initialBackgroundIndex: number,
    trayBackgroundPaths: readonly string[],
    showcasePresentation: DiyShowcasePresentation,
    showcaseBrandImagePath: string,
    invalidate: () => void,
  ) {
    this.canvas = canvas
    this.logicalWidth = logicalWidth
    this.logicalHeight = logicalHeight
    this.invalidate = invalidate
    this.trayBackgroundPaths = normalizeTrayBackgroundPaths(trayBackgroundPaths)
    this.showcasePresentation = this.normalizeShowcasePresentation(showcasePresentation)
    this.showcaseBrandImagePath = normalizeShowcaseBrandImagePath(showcaseBrandImagePath)
    canvas.width = Math.round(logicalWidth * pixelRatio)
    canvas.height = Math.round(logicalHeight * pixelRatio)
    this.context = canvas.getContext('2d') as DiyCanvasContext
    this.context.scale(pixelRatio, pixelRatio)
    this.shadowSystem = new BeadShadowSystem(canvas)
    this.preloadImage(BEAD_LOADING_PLACEHOLDER_PATH)
    this.preloadImage(this.showcaseBrandImagePath)
    this.preloadImage(FALLBACK_TRAY_BACKGROUND_PATH)
    this.preloadImage(this.getTrayBackgroundPath(initialBackgroundIndex))
  }

  setTrayBackgroundPaths(paths: readonly string[], activeBackgroundIndex = 0): void {
    if (this.destroyed) return
    this.trayBackgroundPaths = normalizeTrayBackgroundPaths(paths)
    this.trayTemplates.clear()
    this.preloadImage(FALLBACK_TRAY_BACKGROUND_PATH)
    this.preloadImage(this.getTrayBackgroundPath(activeBackgroundIndex))
    this.invalidate()
  }

  getTrayBackgroundCount(): number {
    return this.trayBackgroundPaths.length
  }

  setShowcasePresentation(presentation: DiyShowcasePresentation): void {
    if (this.destroyed) return
    this.showcasePresentation = this.normalizeShowcasePresentation(presentation)
    this.invalidate()
  }

  setShowcaseBrandImagePath(path: string): void {
    if (this.destroyed) return
    const normalized = normalizeShowcaseBrandImagePath(path)
    if (normalized === this.showcaseBrandImagePath) return
    this.showcaseBrandImagePath = normalized
    this.preloadImage(normalized)
    this.invalidate()
  }

  resize(logicalWidth: number, logicalHeight: number, pixelRatio: number): void {
    if (this.destroyed) return
    this.logicalWidth = logicalWidth
    this.logicalHeight = logicalHeight
    this.canvas.width = Math.round(logicalWidth * pixelRatio)
    this.canvas.height = Math.round(logicalHeight * pixelRatio)
    this.context.scale(pixelRatio, pixelRatio)
  }

  isEditorBackgroundSettled(backgroundIndex: number): boolean {
    const source = this.getTrayBackgroundPath(backgroundIndex)
    const cached = this.imageCache.get(source)
    if (cached?.status === 'ready') return true
    if (cached?.status !== 'error') return false
    if (source === FALLBACK_TRAY_BACKGROUND_PATH) return true
    const fallback = this.imageCache.get(FALLBACK_TRAY_BACKGROUND_PATH)
    return fallback?.status === 'ready' || fallback?.status === 'error'
  }

  areEditorEntryImagesSettled(backgroundIndex: number): boolean {
    return this.isEditorBackgroundSettled(backgroundIndex)
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
    backgroundIndex: number,
    mode: BraceletRenderMode,
    displayScale = 1,
    safeAreaTop = 0,
    showcaseProgress = 1,
    showcasePlateOrigin: ShowcasePlateOrigin | null = null,
    showShowcaseOverlay = true,
    activeBeadUid: string | null = null,
  ): void {
    if (this.destroyed) return

    this.context.clearRect(0, 0, this.logicalWidth, this.logicalHeight)
    if (mode === 'showcase') {
      const plateProgress = showShowcaseOverlay
        ? 0.8 + showcaseProgress * 0.2
        : showcaseProgress
      this.drawShowcaseScene(
        plateProgress,
        showcasePlateOrigin,
        backgroundIndex,
      )
    } else {
      const centerX = showcasePlateOrigin?.centerX ?? this.logicalWidth / 2
      const centerY = showcasePlateOrigin?.centerY ?? this.logicalHeight / 2
      const trayRadius = showcasePlateOrigin?.radius
        ?? getEditorTrayRadius(this.logicalWidth, this.logicalHeight)
      this.drawTrayImage(centerX, centerY, trayRadius, backgroundIndex)
    }

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

    if (mode === 'showcase' && showShowcaseOverlay) this.drawShowcaseOverlay(safeAreaTop)
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
    this.trayTemplates.clear()
    this.renderItemByUid.clear()
    this.sortedBeads.length = 0
    this.activeRenderItems.length = 0
    this.shadowSystem.destroy()
  }

  private drawTrayImage(
    centerX: number,
    centerY: number,
    trayRadius: number,
    backgroundIndex: number,
  ): void {
    this.drawTrayImageSource(
      centerX,
      centerY,
      trayRadius,
      this.getTrayBackgroundPath(backgroundIndex),
    )
  }

  private drawTrayImageSource(
    centerX: number,
    centerY: number,
    trayRadius: number,
    source: string,
  ): void {
    const cached = this.getImage(source)
    if (!cached || cached.status !== 'ready') {
      if (source !== FALLBACK_TRAY_BACKGROUND_PATH) {
        this.drawTrayImageSource(
          centerX,
          centerY,
          trayRadius,
          FALLBACK_TRAY_BACKGROUND_PATH,
        )
      }
      return
    }

    const template = this.getTrayTemplate(source, cached.image)
    if (template) {
      const scale = trayRadius * 2 / template.bodySize
      const destinationSize = template.canvas.width * scale
      try {
        this.context.drawImage(
          template.canvas,
          centerX - destinationSize / 2,
          centerY - destinationSize / 2,
          destinationSize,
          destinationSize,
        )
        return
      } catch {
        this.trayTemplates.set(source, null)
      }
    }

    this.context.save()
    this.context.shadowColor = 'rgba(8,28,28,.16)'
    this.context.shadowBlur = 10
    this.context.shadowOffsetX = 0
    this.context.shadowOffsetY = 4
    this.context.beginPath()
    this.context.arc(centerX, centerY, Math.max(1, trayRadius - 1), 0, FULL_CIRCLE)
    this.context.fillStyle = 'rgba(255,255,255,.98)'
    this.context.fill()
    this.context.restore()

    this.context.save()
    this.context.beginPath()
    this.context.arc(centerX, centerY, trayRadius, 0, FULL_CIRCLE)
    this.context.clip()
    this.context.drawImage(
      cached.image,
      centerX - trayRadius,
      centerY - trayRadius,
      trayRadius * 2,
      trayRadius * 2,
    )
    this.context.restore()
  }

  private getTrayTemplate(
    source: string,
    image: WechatMiniprogram.Image,
  ): TrayTemplate | null {
    if (this.trayTemplates.has(source)) return this.trayTemplates.get(source) ?? null

    const canvas = this.createRenderCanvas(TRAY_TEMPLATE_SIZE, TRAY_TEMPLATE_SIZE)
    const context = canvas?.getContext('2d')
    if (!canvas || !context) {
      this.trayTemplates.set(source, null)
      return null
    }

    const bodySize = TRAY_TEMPLATE_SIZE - TRAY_TEMPLATE_INSET * 2
    const center = TRAY_TEMPLATE_SIZE / 2
    const bodyRadius = bodySize / 2
    try {
      context.clearRect(0, 0, TRAY_TEMPLATE_SIZE, TRAY_TEMPLATE_SIZE)
      context.save()
      context.shadowColor = 'rgba(8,28,28,.16)'
      context.shadowBlur = 22
      context.shadowOffsetX = 0
      context.shadowOffsetY = 9
      context.beginPath()
      context.arc(center, center, bodyRadius - 1, 0, FULL_CIRCLE)
      context.fillStyle = 'rgba(255,255,255,.98)'
      context.fill()
      context.restore()

      context.save()
      context.beginPath()
      context.arc(center, center, bodyRadius, 0, FULL_CIRCLE)
      context.clip()
      context.drawImage(
        image,
        TRAY_TEMPLATE_INSET,
        TRAY_TEMPLATE_INSET,
        bodySize,
        bodySize,
      )
      context.restore()
    } catch {
      this.trayTemplates.set(source, null)
      return null
    }

    const template = { canvas, bodySize }
    this.trayTemplates.set(source, template)
    if (this.trayTemplates.size > MAXIMUM_TRAY_TEMPLATES) {
      const oldestSource = this.trayTemplates.keys().next().value as string | undefined
      if (oldestSource !== undefined) this.trayTemplates.delete(oldestSource)
    }
    return template
  }

  private createRenderCanvas(width: number, height: number): DiyRenderCanvas | null {
    let canvas: DiyRenderCanvas | null = null
    const wxFactory = wx as unknown as OffscreenCanvasFactory
    try {
      canvas = wxFactory.createOffscreenCanvas?.({ type: '2d', width, height }) ?? null
    } catch {
      try {
        canvas = wxFactory.createOffscreenCanvas?.() ?? null
      } catch {
        canvas = null
      }
    }
    if (!canvas) {
      try {
        const hostFactory = this.canvas as unknown as HostCanvasFactory
        canvas = hostFactory.createOffscreenCanvas?.(width, height) ?? null
      } catch {
        canvas = null
      }
    }
    if (!canvas || typeof canvas.getContext !== 'function') return null
    canvas.width = width
    canvas.height = height
    return canvas
  }

  private drawShowcaseScene(
    progress: number,
    origin: ShowcasePlateOrigin | null,
    backgroundIndex: number,
  ): void {
    const destinationCenterX = this.logicalWidth / 2
    const destinationCenterY = this.logicalHeight * 0.81
    const destinationRadius = Math.max(this.logicalWidth * 0.72, this.logicalHeight * 0.34)
    const clampedProgress = Math.max(0, Math.min(1, progress))
    const startCenterX = origin?.centerX ?? destinationCenterX
    const startCenterY = origin?.centerY ?? destinationCenterY
    const startRadius = origin?.radius ?? destinationRadius
    const centerX = startCenterX + (destinationCenterX - startCenterX) * clampedProgress
    const plateCenterY = startCenterY + (destinationCenterY - startCenterY) * clampedProgress
    const plateRadius = startRadius + (destinationRadius - startRadius) * clampedProgress
    this.drawTrayImageSource(
      centerX,
      plateCenterY,
      plateRadius,
      this.getTrayBackgroundPath(backgroundIndex),
    )
  }

  private getTrayBackgroundPath(backgroundIndex: number): string {
    const normalizedIndex = ((backgroundIndex % this.trayBackgroundPaths.length)
      + this.trayBackgroundPaths.length) % this.trayBackgroundPaths.length
    return this.trayBackgroundPaths[normalizedIndex]
  }

  private drawShowcaseOverlay(safeAreaTop: number): void {
    const left = 16
    this.drawShowcaseBrand(left, safeAreaTop + 10)

    this.context.save()
    this.context.textAlign = 'left'
    this.context.textBaseline = 'middle'

    this.context.fillStyle = '#a77d75'
    this.context.font = '700 9px sans-serif'
    this.context.fillText(
      this.showcasePresentation.eyebrow,
      left,
      safeAreaTop + 82,
      Math.max(120, this.logicalWidth - left * 2 - 112),
    )

    this.context.fillStyle = '#43534f'
    this.context.font = '500 20px "Songti SC", "STSong", serif'
    this.context.fillText(
      this.showcasePresentation.title,
      left,
      safeAreaTop + 110,
      Math.max(120, this.logicalWidth - left * 2 - 112),
    )

    this.context.fillStyle = '#8a9490'
    this.context.font = '400 10px sans-serif'
    this.context.fillText(
      this.showcasePresentation.description,
      left,
      safeAreaTop + 139,
      Math.max(120, this.logicalWidth - left * 2),
    )
    this.context.fillStyle = '#9eb5ab'
    this.drawRoundedRectangle(left, safeAreaTop + 155, 34, 3, 1.5)

    const shareBounds = getShowcaseShareBounds(this.logicalWidth, safeAreaTop)
    this.context.shadowColor = 'rgba(73,91,84,.10)'
    this.context.shadowBlur = 10
    this.context.shadowOffsetX = 0
    this.context.shadowOffsetY = 4
    this.context.fillStyle = 'rgba(238,243,239,.94)'
    this.drawRoundedRectangle(
      shareBounds.x,
      shareBounds.y,
      shareBounds.width,
      shareBounds.height,
      shareBounds.height / 2,
    )
    this.context.shadowColor = 'rgba(0,0,0,0)'
    this.context.fillStyle = '#607d76'
    this.context.font = '700 11px sans-serif'
    this.context.textAlign = 'center'
    this.context.fillText(
      '↗  分享作品',
      shareBounds.x + shareBounds.width / 2,
      shareBounds.y + shareBounds.height / 2 + 0.5,
    )

    this.context.restore()
  }

  private drawShowcaseBrand(left: number, top: number): void {
    const cached = this.getImage(this.showcaseBrandImagePath)
    if (!cached || cached.status !== 'ready' || cached.image.width <= 0) return

    const width = Math.min(110, this.logicalWidth - left - 112)
    const height = width * cached.image.height / cached.image.width
    this.context.drawImage(cached.image, left, top, width, height)
  }

  private normalizeShowcasePresentation(
    presentation: DiyShowcasePresentation,
  ): DiyShowcasePresentation {
    return {
      appDisplayName: String(
        presentation?.appDisplayName || DEFAULT_DIY_SHOWCASE_PRESENTATION.appDisplayName,
      ).trim(),
      eyebrow: String(presentation?.eyebrow || DEFAULT_DIY_SHOWCASE_PRESENTATION.eyebrow).trim(),
      title: String(presentation?.title || DEFAULT_DIY_SHOWCASE_PRESENTATION.title).trim(),
      description: String(
        presentation?.description || DEFAULT_DIY_SHOWCASE_PRESENTATION.description,
      ).trim(),
    }
  }

  private drawRoundedRectangle(
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
  ): void {
    const safeRadius = Math.min(radius, width / 2, height / 2)
    this.context.beginPath()
    this.context.moveTo(x + safeRadius, y)
    this.context.lineTo(x + width - safeRadius, y)
    this.context.arc(x + width - safeRadius, y + safeRadius, safeRadius, -Math.PI / 2, 0)
    this.context.lineTo(x + width, y + height - safeRadius)
    this.context.arc(x + width - safeRadius, y + height - safeRadius, safeRadius, 0, Math.PI / 2)
    this.context.lineTo(x + safeRadius, y + height)
    this.context.arc(x + safeRadius, y + height - safeRadius, safeRadius, Math.PI / 2, Math.PI)
    this.context.lineTo(x, y + safeRadius)
    this.context.arc(x + safeRadius, y + safeRadius, safeRadius, Math.PI, Math.PI * 1.5)
    this.context.closePath()
    this.context.fill()
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
