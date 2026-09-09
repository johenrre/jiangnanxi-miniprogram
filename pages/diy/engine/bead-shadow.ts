import type { DiyBead } from '@/pages/diy/model/types'

export interface BeadShadowCanvas {
  width: number
  height: number
  getContext(type: '2d'): BeadShadowTemplateContext | null
}

export type BeadCanvasImage = WechatMiniprogram.Image | BeadShadowCanvas

export interface BeadShadowDrawingContext {
  fillStyle: string | WechatMiniprogram.CanvasGradient
  globalAlpha: number
  save(): void
  restore(): void
  scale(x: number, y: number): void
  translate(x: number, y: number): void
  rotate(angle: number): void
  beginPath(): void
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void
  fill(): void
  drawImage(
    image: BeadCanvasImage,
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

interface BeadShadowTemplateContext extends BeadShadowDrawingContext {
  globalCompositeOperation: string
  clearRect(x: number, y: number, width: number, height: number): void
  fillRect(x: number, y: number, width: number, height: number): void
}

interface ShadowTemplate {
  canvas: BeadShadowCanvas
  bodyLeft: number
  bodyTop: number
  bodyWidth: number
  bodyHeight: number
}

interface OffscreenCanvasFactory {
  createOffscreenCanvas?: (
    options?: { type: '2d'; width: number; height: number },
  ) => BeadShadowCanvas
}

interface HostCanvasFactory {
  createOffscreenCanvas?: (width: number, height: number) => BeadShadowCanvas
}

const FULL_CIRCLE = Math.PI * 2
const TEMPLATE_SIZE = 160
const TEMPLATE_CENTER = TEMPLATE_SIZE / 2
const TEMPLATE_BODY_SIZE = 72
const MAX_SHAPE_TEMPLATES = 40
const BLACK_SHADOW_DEBUG = false
const ROUND_SHADOW_OFFSET_X_RATIO = 0.08
const ROUND_SHADOW_OFFSET_Y_RATIO = 0.09
const SHAPE_SHADOW_OFFSET_X_RATIO = 0.05
const SHAPE_SHADOW_OFFSET_Y_RATIO = 0.06
const SHAPE_SAMPLE_DIRECTIONS = [
  [1, 0],
  [Math.SQRT1_2, Math.SQRT1_2],
  [0, 1],
  [-Math.SQRT1_2, Math.SQRT1_2],
  [-1, 0],
  [-Math.SQRT1_2, -Math.SQRT1_2],
  [0, -1],
  [Math.SQRT1_2, -Math.SQRT1_2],
] as const

function usesShapeShadow(bead: DiyBead): boolean {
  return bead.isIrregular
}

export class BeadShadowSystem {
  private readonly hostCanvas: object
  private readonly shapeTemplates = new Map<string, ShadowTemplate>()
  private roundTemplate: ShadowTemplate | null | undefined
  private destroyed = false

  constructor(hostCanvas: object) {
    this.hostCanvas = hostCanvas
  }

  draw(
    context: BeadShadowDrawingContext,
    bead: DiyBead,
    renderImageUrl: string,
    image: WechatMiniprogram.Image | null,
    displayWidth: number,
    displayHeight: number,
    anchorX: number,
    anchorY: number,
  ): void {
    if (this.destroyed) return

    if (!usesShapeShadow(bead)) {
      this.drawRoundShadow(context, bead.x, bead.y, displayWidth, displayHeight)
      return
    }

    if (!image || !renderImageUrl) return

    const template = this.getShapeTemplate(renderImageUrl, image)
    if (!template) return

    const offsetX = displayWidth * SHAPE_SHADOW_OFFSET_X_RATIO
    const offsetY = displayWidth * SHAPE_SHADOW_OFFSET_Y_RATIO
    context.save()
    context.translate(bead.x + offsetX, bead.y + offsetY)
    context.rotate(bead.rotation)
    this.drawTemplate(
      context,
      template,
      0,
      0,
      displayWidth,
      displayHeight,
      anchorX,
      anchorY,
    )
    context.restore()
  }

  destroy(): void {
    this.destroyed = true
    this.shapeTemplates.clear()
    this.roundTemplate = null
  }

  private drawRoundShadow(
    context: BeadShadowDrawingContext,
    centerX: number,
    centerY: number,
    displayWidth: number,
    displayHeight: number,
  ): void {
    const template = this.getRoundTemplate()
    if (template) {
      this.drawTemplate(
        context,
        template,
        centerX,
        centerY,
        displayWidth,
        displayHeight,
        displayWidth / 2,
        displayHeight / 2,
      )
      return
    }
    this.drawDirectFallback(context, centerX, centerY, displayWidth)
  }

  private drawDirectFallback(
    context: BeadShadowDrawingContext,
    centerX: number,
    centerY: number,
    displayWidth: number,
  ): void {
    context.save()
    context.translate(
      centerX + displayWidth * ROUND_SHADOW_OFFSET_X_RATIO,
      centerY + displayWidth * ROUND_SHADOW_OFFSET_Y_RATIO,
    )
    context.scale(0.62, 0.36)
    context.beginPath()
    context.arc(0, 0, displayWidth * 0.55, 0, FULL_CIRCLE)
    context.fillStyle = BLACK_SHADOW_DEBUG
      ? '#000000'
      : 'rgba(8,23,22,.50)'
    context.fill()
    context.restore()
  }

  private drawTemplate(
    context: BeadShadowDrawingContext,
    template: ShadowTemplate,
    centerX: number,
    centerY: number,
    displayWidth: number,
    displayHeight: number,
    displayAnchorX: number,
    displayAnchorY: number,
  ): void {
    const templateScaleX = displayWidth / template.bodyWidth
    const templateScaleY = displayHeight / template.bodyHeight
    context.drawImage(
      template.canvas,
      centerX - displayAnchorX - template.bodyLeft * templateScaleX,
      centerY - displayAnchorY - template.bodyTop * templateScaleY,
      template.canvas.width * templateScaleX,
      template.canvas.height * templateScaleY,
    )
  }

  private getRoundTemplate(): ShadowTemplate | null {
    if (this.roundTemplate !== undefined) return this.roundTemplate
    this.roundTemplate = this.createRoundTemplate()
    return this.roundTemplate
  }

  private getShapeTemplate(
    imageUrl: string,
    image: WechatMiniprogram.Image,
  ): ShadowTemplate | null {
    const existing = this.shapeTemplates.get(imageUrl)
    if (existing) return existing

    const created = this.createShapeTemplate(image)
    if (!created) return null

    this.shapeTemplates.set(imageUrl, created)
    if (this.shapeTemplates.size > MAX_SHAPE_TEMPLATES) {
      const oldestKey = this.shapeTemplates.keys().next().value as string | undefined
      if (oldestKey !== undefined) this.shapeTemplates.delete(oldestKey)
    }
    return created
  }

  private createRoundTemplate(): ShadowTemplate | null {
    const canvas = this.createTemplateCanvas()
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return null

    context.clearRect(0, 0, TEMPLATE_SIZE, TEMPLATE_SIZE)
    if (BLACK_SHADOW_DEBUG) {
      context.beginPath()
      context.arc(
        TEMPLATE_CENTER + TEMPLATE_BODY_SIZE * ROUND_SHADOW_OFFSET_X_RATIO,
        TEMPLATE_CENTER + TEMPLATE_BODY_SIZE * ROUND_SHADOW_OFFSET_Y_RATIO,
        TEMPLATE_BODY_SIZE * 0.46,
        0,
        FULL_CIRCLE,
      )
      context.fillStyle = '#000000'
      context.fill()
      return this.createTemplate(
        canvas,
        TEMPLATE_CENTER - TEMPLATE_BODY_SIZE / 2,
        TEMPLATE_CENTER - TEMPLATE_BODY_SIZE / 2,
        TEMPLATE_BODY_SIZE,
        TEMPLATE_BODY_SIZE,
      )
    }

    const broadShadow = context.createRadialGradient(
      TEMPLATE_CENTER + TEMPLATE_BODY_SIZE * ROUND_SHADOW_OFFSET_X_RATIO,
      TEMPLATE_CENTER + TEMPLATE_BODY_SIZE * ROUND_SHADOW_OFFSET_Y_RATIO,
      2,
      TEMPLATE_CENTER + TEMPLATE_BODY_SIZE * ROUND_SHADOW_OFFSET_X_RATIO,
      TEMPLATE_CENTER + TEMPLATE_BODY_SIZE * ROUND_SHADOW_OFFSET_Y_RATIO,
      39,
    )
    broadShadow.addColorStop(0, 'rgba(8,23,22,.62)')
    broadShadow.addColorStop(0.58, 'rgba(8,23,22,.40)')
    broadShadow.addColorStop(0.85, 'rgba(8,23,22,.22)')
    broadShadow.addColorStop(1, 'rgba(8,23,22,0)')
    context.fillStyle = broadShadow
    context.fillRect(0, 0, TEMPLATE_SIZE, TEMPLATE_SIZE)

    this.paintContactEllipse(context)
    return this.createTemplate(
      canvas,
      TEMPLATE_CENTER - TEMPLATE_BODY_SIZE / 2,
      TEMPLATE_CENTER - TEMPLATE_BODY_SIZE / 2,
      TEMPLATE_BODY_SIZE,
      TEMPLATE_BODY_SIZE,
    )
  }

  private paintContactEllipse(context: BeadShadowTemplateContext): void {
    context.save()
    context.translate(TEMPLATE_CENTER + 1, TEMPLATE_CENTER + 23)
    context.scale(1, 0.34)
    const contactShadow = context.createRadialGradient(0, 0, 1, 0, 0, 29)
    contactShadow.addColorStop(0, 'rgba(6,19,18,.38)')
    contactShadow.addColorStop(0.55, 'rgba(6,19,18,.19)')
    contactShadow.addColorStop(1, 'rgba(6,19,18,0)')
    context.beginPath()
    context.arc(0, 0, 29, 0, FULL_CIRCLE)
    context.fillStyle = contactShadow
    context.fill()
    context.restore()
  }

  private createShapeTemplate(image: WechatMiniprogram.Image): ShadowTemplate | null {
    const canvas = this.createTemplateCanvas()
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return null

    const imageAspectRatio = image.width / image.height
    const bodyWidth = imageAspectRatio >= 1
      ? TEMPLATE_BODY_SIZE
      : TEMPLATE_BODY_SIZE * imageAspectRatio
    const bodyHeight = imageAspectRatio >= 1
      ? TEMPLATE_BODY_SIZE / imageAspectRatio
      : TEMPLATE_BODY_SIZE
    const imageLeft = TEMPLATE_CENTER - bodyWidth / 2
    const imageTop = TEMPLATE_CENTER - bodyHeight / 2
    context.clearRect(0, 0, TEMPLATE_SIZE, TEMPLATE_SIZE)
    context.globalCompositeOperation = 'source-over'

    if (BLACK_SHADOW_DEBUG) {
      context.globalAlpha = 1
    } else {
      this.paintShapeSamples(
        context,
        image,
        imageLeft,
        imageTop,
        bodyWidth,
        bodyHeight,
        3,
        0.012,
      )
      this.paintShapeSamples(
        context,
        image,
        imageLeft,
        imageTop,
        bodyWidth,
        bodyHeight,
        1.5,
        0.018,
      )
      context.globalAlpha = 0.06
    }
    context.drawImage(image, imageLeft, imageTop, bodyWidth, bodyHeight)

    context.globalAlpha = 1
    context.globalCompositeOperation = 'source-in'
    context.fillStyle = BLACK_SHADOW_DEBUG ? '#000000' : '#081716'
    context.fillRect(0, 0, TEMPLATE_SIZE, TEMPLATE_SIZE)
    context.globalCompositeOperation = 'source-over'
    return this.createTemplate(canvas, imageLeft, imageTop, bodyWidth, bodyHeight)
  }

  private paintShapeSamples(
    context: BeadShadowTemplateContext,
    image: WechatMiniprogram.Image,
    imageLeft: number,
    imageTop: number,
    imageWidth: number,
    imageHeight: number,
    distance: number,
    alpha: number,
  ): void {
    context.globalAlpha = alpha
    SHAPE_SAMPLE_DIRECTIONS.forEach(([directionX, directionY]) => {
      context.drawImage(
        image,
        imageLeft + directionX * distance,
        imageTop + directionY * distance,
        imageWidth,
        imageHeight,
      )
    })
  }

  private createTemplate(
    canvas: BeadShadowCanvas,
    bodyLeft: number,
    bodyTop: number,
    bodyWidth: number,
    bodyHeight: number,
  ): ShadowTemplate {
    return {
      canvas,
      bodyLeft,
      bodyTop,
      bodyWidth,
      bodyHeight,
    }
  }

  private createTemplateCanvas(): BeadShadowCanvas | null {
    let canvas: BeadShadowCanvas | null = null
    const wxFactory = wx as unknown as OffscreenCanvasFactory

    try {
      canvas = wxFactory.createOffscreenCanvas?.({
        type: '2d',
        width: TEMPLATE_SIZE,
        height: TEMPLATE_SIZE,
      }) ?? null
    } catch {
      try {
        canvas = wxFactory.createOffscreenCanvas?.() ?? null
      } catch {
        canvas = null
      }
    }

    if (!canvas) {
      try {
        const hostFactory = this.hostCanvas as HostCanvasFactory
        canvas = hostFactory.createOffscreenCanvas?.(TEMPLATE_SIZE, TEMPLATE_SIZE) ?? null
      } catch {
        canvas = null
      }
    }

    if (!canvas || typeof canvas.getContext !== 'function') return null
    canvas.width = TEMPLATE_SIZE
    canvas.height = TEMPLATE_SIZE
    return canvas
  }
}
