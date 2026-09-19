import {
  PIXELS_PER_MM,
  applyRingLayout,
  buildRingTargets,
  calculatePerimeterMm,
  easeOutCubic,
  findRingInsertionIndexForBeads,
  fitRingScalesToOuterRadius,
  getEditorTrayRadius,
} from '@/pages/diy/engine/geometry'
import { BraceletRenderer } from '@/pages/diy/engine/renderer'
import type { DiyBead, RingTarget, TouchPoint } from '@/pages/diy/model/types'
import type { CanvasQueryResult, DiyPageInstance } from '@/pages/diy/page/types'
import { getWindowMetrics, normalizeAngleDelta } from '@/pages/diy/page/utils'
import { appSound } from '@/services/sound'
import { getMaterialRenderMetrics } from '@/utils/material-render-geometry'

const FIXED_STEP_MS = 1000 / 60
const RING_ANIMATION_DURATION_MS = 440
const EDITOR_RING_MAX_OUTER_RADIUS_RATIO = 0.92
const MAXIMUM_RING_ANGULAR_VELOCITY = 0.012
const MINIMUM_RING_ANGULAR_VELOCITY = 0.00004
const MINIMUM_RING_RELEASE_VELOCITY = 0.00018
const RING_ANGULAR_DRAG_PER_MS = 0.0028
const RING_MAXIMUM_COMPRESSION = 0.3
const RING_SPRING_STIFFNESS = 0.00028
const RING_SPRING_DAMPING = 0.017
const RING_MINIMUM_ELASTIC_SCALE = 0.3
const RING_MAXIMUM_ELASTIC_SCALE = 1.012
const MAXIMUM_CANVAS_PIXEL_COUNT = 800000
const MINIMUM_CANVAS_PIXEL_RATIO = 3
const MAXIMUM_CANVAS_PIXEL_RATIO = 3

export const EDITOR_BEAD_DISPLAY_SCALE = 1.2
const EDITOR_RING_RADIUS_SCALE = 1.24

function isCanvasCoveredByOverlay(page: DiyPageInstance): boolean {
  return (
    page.data.showSizeGuide
    || page.data.showGuide
    || page.data.showWristPicker
    || page.data.showSaveNameDialog
  )
}

export const canvasPageMethods = {
  initializeCanvas(this: DiyPageInstance): void {
    const selectorQuery = this.createSelectorQuery()
    selectorQuery.select('#diyCanvas').fields({ node: true, size: true, rect: true })
    selectorQuery.select('#diyCanvasAnchor').boundingClientRect()
    selectorQuery.exec((results) => {
      const result = results[0] as CanvasQueryResult | undefined
      const anchorResult = results[1] as CanvasQueryResult | undefined
      const canvas = result?.node
      const width = Number(result?.width)
      const height = Number(result?.height)
      if (!canvas || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        this.setData({ canvasReady: false }, () => this.updateEntryGate())
        return
      }

      const reusableRenderer = this.canvas === canvas ? this.renderer : null
      this.cancelAnimationFrame()
      if (!reusableRenderer) this.renderer?.destroy()
      this.canvas = canvas
      this.canvasLeft = Number(result?.left) || 0
      this.canvasTop = Number(result?.top) || 0
      this.canvasWidth = width
      this.canvasHeight = height
      const anchorWidth = Number(anchorResult?.width) || Math.min(width * 0.8, 310)
      const anchorHeight = Number(anchorResult?.height) || anchorWidth
      const anchorLeft = Number(anchorResult?.left) - this.canvasLeft
      const anchorTop = Number(anchorResult?.top) - this.canvasTop
      this.editorOrigin = {
        centerX: (Number.isFinite(anchorLeft) ? anchorLeft : (width - anchorWidth) / 2)
          + anchorWidth / 2,
        centerY: (Number.isFinite(anchorTop) ? anchorTop : (height - anchorHeight) / 2)
          + anchorHeight / 2,
        radius: getEditorTrayRadius(anchorWidth, anchorHeight),
      }
      this.invalidateRingLayoutCaches()
      // Use the device's pixel ratio up to 3x for this clarity test. This
      // intentionally favors sharpness so its rendering cost can be measured.
      const devicePixelRatio = Math.max(1, getWindowMetrics().pixelRatio || 1)
      const budgetedPixelRatio = Math.sqrt(
        MAXIMUM_CANVAS_PIXEL_COUNT / Math.max(1, width * height),
      )
      const pixelRatio = Math.min(
        MAXIMUM_CANVAS_PIXEL_RATIO,
        devicePixelRatio,
        Math.max(MINIMUM_CANVAS_PIXEL_RATIO, budgetedPixelRatio),
      )
      if (reusableRenderer) {
        reusableRenderer.resize(width, height, pixelRatio)
        this.renderer = reusableRenderer
      } else {
        this.renderer = new BraceletRenderer(
          canvas,
          width,
          height,
          pixelRatio,
          () => {
            this.scheduleRender()
            this.updateEntryGate()
          },
        )
      }
      if (!this.data.loadingMaterials && !this.firstScreenMaterialImagesReady) {
        void this.preloadFirstScreenMaterialImages()
      }
      this.setData({ canvasReady: true }, () => {
        void this.tryApplyTemplateDesign()
        this.updateEntryGate()
      })

      if (this.beads.length > 0) {
        this.applyRingTargets(this.buildCurrentRingTargets(this.beads))
      }
      this.scheduleRender()
    })
  },

  disposeCanvas(this: DiyPageInstance): void {
    this.cancelAnimationFrame()
    this.renderer?.destroy()
    this.renderer = null
    this.canvas = null
    this.ringAnimation = null
    this.dragState = null
    this.resetRingMotion()
  },

  scheduleRender(this: DiyPageInstance): void {
    this.renderDirty = true
    this.requestAnimationFrame()
  },

  requestAnimationFrame(this: DiyPageInstance): void {
    if (
      !this.pageVisible
      || !this.canvas
      || this.frameRequestId !== null
      || isCanvasCoveredByOverlay(this)
    ) return
    this.frameRequestId = this.canvas.requestAnimationFrame((timestamp) => {
      this.handleAnimationFrame(Number(timestamp) || Date.now())
    })
  },

  cancelAnimationFrame(this: DiyPageInstance): void {
    if (this.canvas && this.frameRequestId !== null) {
      this.canvas.cancelAnimationFrame(this.frameRequestId)
    }
    this.frameRequestId = null
    this.lastFrameTimestamp = 0
  },

  handleAnimationFrame(this: DiyPageInstance, timestamp: number): void {
    this.frameRequestId = null
    if (!this.pageVisible || isCanvasCoveredByOverlay(this)) return

    const deltaMs = this.lastFrameTimestamp > 0
      ? Math.min(50, Math.max(0, timestamp - this.lastFrameTimestamp))
      : FIXED_STEP_MS
    this.applyPendingDragPoint()
    let animationActive = false
    if (this.ringAnimation) {
      animationActive = this.stepRingAnimation(timestamp)
    } else if (this.dragState?.mode === 'ring-bead') {
      animationActive = this.stepRingDragReflow(deltaMs)
    }
    if (
      !this.ringAnimation
      && this.dragState?.mode !== 'ring-bead'
    ) {
      animationActive = this.stepRingMotion(deltaMs) || animationActive
    }
    this.lastFrameTimestamp = timestamp

    // Animation activity controls scheduling; renderDirty controls drawing.
    if (this.renderDirty) this.renderEditor()
    if (animationActive || this.renderDirty) this.requestAnimationFrame()
    else {
      this.lastFrameTimestamp = 0
    }
  },

  renderEditor(this: DiyPageInstance): void {
    this.renderDirty = false
    if (this.data.entryMaskVisible && this.renderer) {
      this.renderer.clear()
      if (!this.firstCanvasFrameRendered) {
        this.firstCanvasFrameRendered = true
        this.updateEntryGate()
      }
      return
    }

    const displayScale = this.getEditorRingLayout().displayScale
    this.renderer?.render(
      this.beads,
      displayScale,
      this.dragState?.uid ?? null,
    )
    if (!this.firstCanvasFrameRendered && this.renderer) {
      this.firstCanvasFrameRendered = true
      this.updateEntryGate()
    }
  },

  invalidateRingLayoutCaches(this: DiyPageInstance): void {
    this.editorRingLayoutCache = null
  },

  startRingAnimation(this: DiyPageInstance, duration = RING_ANIMATION_DURATION_MS): void {
    if (this.beads.length === 0 || this.canvasWidth <= 0 || this.canvasHeight <= 0) return
    // Ring transitions own a fresh RAF so a pending frame cannot make the
    // bracelet appear to snap directly to its target.
    this.cancelAnimationFrame()
    this.resetRingMotion()
    const targets = this.buildCurrentRingTargets(this.beads)
    const items = []
    for (let index = 0; index < this.beads.length; index += 1) {
      const bead = this.beads[index]
      const target = targets[index]
      if (!target) continue
      items.push({
        bead,
        fromX: bead.x,
        fromY: bead.y,
        fromRotation: bead.rotation,
        targetX: target.x,
        targetY: target.y,
        targetRotation: target.rotation,
      })
    }
    this.ringAnimation = {
      startTime: 0,
      duration,
      items,
    }
    this.renderDirty = true
    this.requestAnimationFrame()
  },

  stepRingAnimation(this: DiyPageInstance, timestamp: number): boolean {
    const animation = this.ringAnimation
    if (!animation) return false
    if (animation.startTime === 0) animation.startTime = timestamp

    const progress = Math.min(1, (timestamp - animation.startTime) / animation.duration)
    const easedProgress = easeOutCubic(progress)
    for (let index = 0; index < animation.items.length; index += 1) {
      const item = animation.items[index]
      item.bead.x = item.fromX + (item.targetX - item.fromX) * easedProgress
      item.bead.y = item.fromY + (item.targetY - item.fromY) * easedProgress
      item.bead.rotation = item.fromRotation
        + normalizeAngleDelta(item.targetRotation - item.fromRotation) * easedProgress
    }
    this.renderDirty = true

    if (progress < 1) return true
    for (let index = 0; index < animation.items.length; index += 1) {
      const item = animation.items[index]
      item.bead.x = item.targetX
      item.bead.y = item.targetY
      item.bead.rotation = item.targetRotation
    }
    this.ringAnimation = null
    return false
  },

  stepRingDragReflow(this: DiyPageInstance, deltaMs: number): boolean {
    const dragState = this.dragState
    const targets = dragState?.reflowTargets
    if (!dragState?.uid || dragState.mode !== 'ring-bead' || !targets) return false

    const frameRatio = Math.max(0.5, deltaMs / FIXED_STEP_MS)
    const smoothing = 1 - Math.pow(0.72, frameRatio)
    let moved = false
    let stillMoving = false

    for (let index = 0; index < this.beads.length; index += 1) {
      const bead = this.beads[index]
      if (bead.uid === dragState.uid) continue
      const target = targets.get(bead.uid)
      if (!target) continue

      const offsetX = target.x - bead.x
      const offsetY = target.y - bead.y
      const rotationOffset = normalizeAngleDelta(target.rotation - bead.rotation)
      const distanceSquared = offsetX * offsetX + offsetY * offsetY
      if (distanceSquared <= 0.04 && Math.abs(rotationOffset) <= 0.002) {
        bead.x = target.x
        bead.y = target.y
        bead.rotation = target.rotation
        continue
      }

      bead.x += offsetX * smoothing
      bead.y += offsetY * smoothing
      bead.rotation += rotationOffset * smoothing
      moved = true
      stillMoving = distanceSquared > 0.16 || Math.abs(rotationOffset) > 0.004
        || stillMoving
    }

    if (moved) this.renderDirty = true
    return stillMoving
  },

  stepRingMotion(this: DiyPageInstance, deltaMs: number): boolean {
    const isDirectlyRotating = this.dragState?.mode === 'ring-rotate'
    let rotationChanged = false
    if (!isDirectlyRotating && Math.abs(this.ringAngularVelocity) > 0) {
      this.ringRotationOffset = normalizeAngleDelta(
        this.ringRotationOffset + this.ringAngularVelocity * deltaMs,
      )
      this.ringAngularVelocity *= Math.exp(-RING_ANGULAR_DRAG_PER_MS * deltaMs)
      if (Math.abs(this.ringAngularVelocity) < MINIMUM_RING_ANGULAR_VELOCITY) {
        this.ringAngularVelocity = 0
      }
      rotationChanged = true
    }

    const speedRatio = Math.min(
      1,
      Math.abs(this.ringAngularVelocity) / MAXIMUM_RING_ANGULAR_VELOCITY,
    )
    const targetScale = 1 - RING_MAXIMUM_COMPRESSION * speedRatio
    const previousScale = this.ringElasticScale
    // Integrate the elastic response in fixed-size slices. A single 40–50ms
    // Euler step after a dropped frame visibly overshoots on older iPhones.
    let remainingSpringMs = Math.min(50, Math.max(0, deltaMs))
    while (remainingSpringMs > 0) {
      const springStepMs = Math.min(FIXED_STEP_MS, remainingSpringMs)
      const springAcceleration = (
        targetScale - this.ringElasticScale
      ) * RING_SPRING_STIFFNESS - this.ringElasticVelocity * RING_SPRING_DAMPING
      this.ringElasticVelocity += springAcceleration * springStepMs
      this.ringElasticScale = Math.max(
        RING_MINIMUM_ELASTIC_SCALE,
        Math.min(
          RING_MAXIMUM_ELASTIC_SCALE,
          this.ringElasticScale + this.ringElasticVelocity * springStepMs,
        ),
      )
      remainingSpringMs -= springStepMs
    }

    const springSettled = Math.abs(targetScale - this.ringElasticScale) < 0.00015
      && Math.abs(this.ringElasticVelocity) < 0.00001
    if (springSettled) {
      this.ringElasticScale = targetScale
      this.ringElasticVelocity = 0
    }

    const scaleChanged = Math.abs(this.ringElasticScale - previousScale) > 0.00001
    if (this.ringLayoutDirty || rotationChanged || scaleChanged) {
      this.applyCurrentRingLayout(this.beads)
    }

    return (!isDirectlyRotating && this.ringAngularVelocity !== 0) || !springSettled
  },

  resetRingMotion(this: DiyPageInstance): void {
    this.ringAngularVelocity = 0
    this.ringElasticScale = 1
    this.ringElasticVelocity = 0
    this.ringLayoutDirty = false
  },

  updateRingDragReflow(this: DiyPageInstance, point: TouchPoint): void {
    const dragState = this.dragState
    if (!dragState?.uid || dragState.mode !== 'ring-bead') return
    const draggedBead = dragState.bead
    if (!draggedBead) return

    const ringLayout = this.getEditorRingLayout()
    const insertionIndex = findRingInsertionIndexForBeads(
      point.x,
      point.y,
      ringLayout.centerX,
      ringLayout.centerY,
      this.beads,
      this.ringRotationOffset,
      dragState.uid,
    )
    if (insertionIndex === dragState.insertionIndex) return

    dragState.insertionIndex = insertionIndex
    const currentIndex = this.beads.indexOf(draggedBead)
    if (currentIndex < 0) return
    this.beads.splice(currentIndex, 1)
    this.beads.splice(Math.min(insertionIndex, this.beads.length), 0, draggedBead)
    this.invalidateRingLayoutCaches()
    const reflowTargets = dragState.reflowTargets || new Map<string, RingTarget>()
    reflowTargets.clear()
    const targets = this.buildCurrentRingTargets(this.beads)
    for (let index = 0; index < targets.length; index += 1) {
      reflowTargets.set(targets[index].uid, targets[index])
    }
    dragState.reflowTargets = reflowTargets
  },

  applyRingTargets(this: DiyPageInstance, targets: RingTarget[]): void {
    const targetsMatchBeadOrder = targets.length === this.beads.length
      && targets.every((target, index) => target.uid === this.beads[index]?.uid)
    if (targetsMatchBeadOrder) {
      for (let index = 0; index < this.beads.length; index += 1) {
        const bead = this.beads[index]
        const target = targets[index]
        bead.x = target.x
        bead.y = target.y
        bead.rotation = target.rotation
      }
    } else {
      const targetByUid = new Map(targets.map((target) => [target.uid, target]))
      for (let index = 0; index < this.beads.length; index += 1) {
        const bead = this.beads[index]
        const target = targetByUid.get(bead.uid)
        if (!target) continue
        bead.x = target.x
        bead.y = target.y
        bead.rotation = target.rotation
      }
    }
    this.renderDirty = true
  },

  applyCurrentRingLayout(this: DiyPageInstance, beads: DiyBead[]): void {
    const layout = this.getEditorRingLayout()
    applyRingLayout(
      beads,
      layout.centerX,
      layout.centerY,
      this.ringRotationOffset,
      layout.radiusScale * this.ringElasticScale,
      layout.displayScale,
    )
    this.ringLayoutDirty = false
    this.renderDirty = true
  },

  getEditorRingLayout(this: DiyPageInstance) {
    if (this.editorRingLayoutCache) return this.editorRingLayoutCache
    const editorPlateOrigin = this.editorOrigin || {
      centerX: this.canvasWidth / 2,
      centerY: this.canvasHeight / 2,
      radius: getEditorTrayRadius(this.canvasWidth, this.canvasHeight),
    }
    const naturalRadius = calculatePerimeterMm(this.beads) / (Math.PI * 2) * PIXELS_PER_MM
    const fittedScales = fitRingScalesToOuterRadius(
      this.beads,
      editorPlateOrigin.radius * EDITOR_RING_MAX_OUTER_RADIUS_RATIO,
      EDITOR_RING_RADIUS_SCALE,
      EDITOR_BEAD_DISPLAY_SCALE,
    )
    this.editorRingLayoutCache = {
      centerX: editorPlateOrigin.centerX,
      centerY: editorPlateOrigin.centerY,
      radiusScale: naturalRadius > 0 ? fittedScales.radiusScale : EDITOR_RING_RADIUS_SCALE,
      displayScale: fittedScales.displayScale,
    }
    return this.editorRingLayoutCache
  },

  buildCurrentRingTargets(this: DiyPageInstance, beads: DiyBead[]): RingTarget[] {
    const layout = this.getEditorRingLayout()
    return buildRingTargets(
      beads,
      layout.centerX,
      layout.centerY,
      this.ringRotationOffset,
      layout.radiusScale * this.ringElasticScale,
      layout.displayScale,
    )
  },

  getCanvasTouchPoint(
    this: DiyPageInstance,
    event: WechatMiniprogram.TouchEvent,
    useChangedTouches = false,
  ) {
    const touches = useChangedTouches ? event.changedTouches : event.touches
    const touch = touches[0]
    if (!touch) return null
    const clientX = Number(touch.clientX)
    const clientY = Number(touch.clientY)
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null
    return {
      x: clientX - this.canvasLeft,
      y: clientY - this.canvasTop,
      timestamp: Date.now(),
    }
  },

  findBeadAtPoint(this: DiyPageInstance, point: TouchPoint): DiyBead | null {
    const displayScale = this.getEditorRingLayout().displayScale
    const orderedBeads = this.beads.slice().sort((left, right) => (
      right.layer - left.layer || right.y - left.y
    ))
    for (const bead of orderedBeads) {
      const offsetX = point.x - bead.x
      const offsetY = point.y - bead.y
      const displaySize = this.renderer?.getBeadDisplaySize(bead, displayScale)
        ?? getMaterialRenderMetrics(bead, null, PIXELS_PER_MM, displayScale)
      const cosine = Math.cos(bead.rotation)
      const sine = Math.sin(bead.rotation)
      const localX = offsetX * cosine + offsetY * sine
      const localY = -offsetX * sine + offsetY * cosine
      const left = Math.min(-18, -displaySize.anchorX - 8)
      const right = Math.max(18, displaySize.width - displaySize.anchorX + 8)
      const top = Math.min(-18, -displaySize.anchorY - 8)
      const bottom = Math.max(18, displaySize.height - displaySize.anchorY + 8)
      if (localX >= left && localX <= right && localY >= top && localY <= bottom) {
        return bead
      }
    }
    return null
  },

  isPointOutsideRemovalBoundary(this: DiyPageInstance, point: TouchPoint): boolean {
    const editorPlateOrigin = this.editorOrigin || {
      centerX: this.canvasWidth / 2,
      centerY: this.canvasHeight / 2,
      radius: getEditorTrayRadius(this.canvasWidth, this.canvasHeight),
    }
    const offsetX = point.x - editorPlateOrigin.centerX
    const offsetY = point.y - editorPlateOrigin.centerY
    const distance = Math.sqrt(offsetX * offsetX + offsetY * offsetY)
    return distance > editorPlateOrigin.radius + 20
  },

  finishTouch(this: DiyPageInstance, event: WechatMiniprogram.TouchEvent): void {
    const dragState = this.dragState
    if (!dragState) return
    const point = this.getCanvasTouchPoint(event, true) || dragState.latestPoint
    if (point !== dragState.latestPoint) {
      dragState.latestPoint = point
    }
    this.applyPendingDragPoint()
    this.dragState = null

    if (dragState.mode === 'ring-rotate') {
      if (Math.abs(this.ringAngularVelocity) < MINIMUM_RING_RELEASE_VELOCITY) {
        this.ringAngularVelocity = 0
      }
      this.scheduleRender()
      return
    }
    if (!dragState.uid) return

    if (this.isPointOutsideRemovalBoundary(point)) {
      this.removeBead(dragState.uid, dragState.snapshot)
      return
    }

    const draggedBead = dragState.bead
    if (!draggedBead) return
    const ringLayout = this.getEditorRingLayout()
    const insertionIndex = findRingInsertionIndexForBeads(
      point.x,
      point.y,
      ringLayout.centerX,
      ringLayout.centerY,
      this.beads,
      this.ringRotationOffset,
      dragState.uid,
    )
    const currentIndex = this.beads.indexOf(draggedBead)
    if (currentIndex < 0) return
    this.beads.splice(currentIndex, 1)
    this.beads.splice(Math.min(insertionIndex, this.beads.length), 0, draggedBead)
    if (insertionIndex !== dragState.originalIndex) this.pushHistory(dragState.snapshot)
    this.invalidateRingLayoutCaches()
    appSound.play('discard')
    this.startRingAnimation(420)
  },

  handleCanvasTouchStart(this: DiyPageInstance, event: WechatMiniprogram.TouchEvent): void {
    const point = this.getCanvasTouchPoint(event)
    if (!point) return
    if (this.ringAnimation) return
    const bead = this.findBeadAtPoint(point)
    const snapshot = this.createSnapshot()

    this.ringAngularVelocity = 0
    this.dragState = {
      uid: bead?.uid || null,
      bead,
      mode: bead ? 'ring-bead' : 'ring-rotate',
      latestPoint: point,
      renderedPoint: point,
      snapshot,
      originalIndex: bead ? this.beads.indexOf(bead) : -1,
      insertionIndex: bead ? this.beads.indexOf(bead) : -1,
      reflowTargets: null,
    }
    if (bead) {
      appSound.play('soft-pop')
      this.scheduleRender()
    }
  },

  applyPendingDragPoint(this: DiyPageInstance): void {
    const dragState = this.dragState
    if (!dragState) return
    const point = dragState.latestPoint
    if (dragState.renderedPoint === point) return
    const previousRenderedPoint = dragState.renderedPoint
    dragState.renderedPoint = point

    if (dragState.mode === 'ring-rotate') {
      const ringLayout = this.getEditorRingLayout()
      const angle = Math.atan2(
        point.y - ringLayout.centerY,
        point.x - ringLayout.centerX,
      )
      const previousAngle = Math.atan2(
        previousRenderedPoint.y - ringLayout.centerY,
        previousRenderedPoint.x - ringLayout.centerX,
      )
      const angleDelta = normalizeAngleDelta(angle - previousAngle)
      const elapsedMs = Math.max(
        4,
        Math.min(80, point.timestamp - previousRenderedPoint.timestamp),
      )
      const instantaneousVelocity = Math.max(
        -MAXIMUM_RING_ANGULAR_VELOCITY,
        Math.min(MAXIMUM_RING_ANGULAR_VELOCITY, angleDelta / elapsedMs),
      )
      const velocityBlend = 1 - Math.exp(-elapsedMs / 42)
      this.ringAngularVelocity += (
        instantaneousVelocity - this.ringAngularVelocity
      ) * velocityBlend
      this.ringRotationOffset = normalizeAngleDelta(this.ringRotationOffset + angleDelta)
      this.ringLayoutDirty = true
      return
    }

    if (!dragState.uid) return
    const bead = dragState.bead
    if (!bead) return
    bead.x = point.x
    bead.y = point.y
    if (dragState.mode === 'ring-bead') {
      this.updateRingDragReflow(point)
    }
    this.renderDirty = true
  },

  handleCanvasTouchMove(this: DiyPageInstance, event: WechatMiniprogram.TouchEvent): void {
    const dragState = this.dragState
    if (!dragState) return
    const point = this.getCanvasTouchPoint(event)
    if (!point) return
    dragState.latestPoint = point
    // Touch events can arrive faster than the screen refresh rate on real devices.
    // Keep only the latest point and apply it once in the shared canvas frame.
    this.requestAnimationFrame()
  },

  handleCanvasTouchEnd(this: DiyPageInstance, event: WechatMiniprogram.TouchEvent): void {
    this.finishTouch(event)
  },

  handleCanvasTouchCancel(this: DiyPageInstance, event: WechatMiniprogram.TouchEvent): void {
    this.finishTouch(event)
  },
}
