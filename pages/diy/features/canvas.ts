import {
  PIXELS_PER_MM,
  applyRingLayout,
  buildRingTargets,
  calculateRingRadiusMm,
  easeOutCubic,
  findRingInsertionIndexForBeads,
  fitRingScalesToOuterRadius,
  getEditorTrayRadius,
} from '@/pages/diy/engine/geometry'
import { Bracelet3DRenderer } from '@/pages/diy/engine/three/index'
import type { DiyBead, RingTarget, TouchPoint } from '@/pages/diy/model/types'
import type { CanvasQueryResult, DiyPageInstance } from '@/pages/diy/page/types'
import { getWindowMetrics, normalizeAngleDelta } from '@/pages/diy/page/utils'
import { appSound } from '@/services/sound'

const FIXED_STEP_MS = 1000 / 60
const GESTURE_MOVE_THRESHOLD_PX = 8
const RING_ANIMATION_DURATION_MS = 440
const EDITOR_RING_MAX_OUTER_RADIUS_RATIO = 0.92
const MAXIMUM_CANVAS_PIXEL_COUNT = 800000
const MINIMUM_CANVAS_PIXEL_RATIO = 1
const MAXIMUM_CANVAS_PIXEL_RATIO = 2

export const EDITOR_BEAD_DISPLAY_SCALE = 1.2
const EDITOR_RING_RADIUS_SCALE = 1.24

function isCanvasCoveredByOverlay(page: DiyPageInstance): boolean {
  return (
    page.data.showGuide
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
      // Bound the WebGL backing store so older devices do not pay an
      // unnecessary memory cost for a small editor surface.
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
        this.renderer = new Bracelet3DRenderer(
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
    } else if (this.dragState) {
      animationActive = this.stepRingDragReflow(deltaMs)
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

    const layout = this.getEditorRingLayout()
    const activeBeadUid = this.dragState?.mode === 'bead'
      || this.dragState?.mode === 'pending-bead'
      ? this.dragState.uid
      : null
    this.renderer?.render(
      this.beads,
      layout.displayScale,
      activeBeadUid,
      layout.centerX,
      layout.centerY,
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
    if (dragState?.mode !== 'bead' || !dragState.uid || !targets) return false

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

  updateRingDragReflow(this: DiyPageInstance, point: TouchPoint): void {
    const dragState = this.dragState
    if (dragState?.mode !== 'bead' || !dragState.uid || !dragState.bead) return
    const draggedBead = dragState.bead

    const ringLayout = this.getEditorRingLayout()
    const insertionIndex = findRingInsertionIndexForBeads(
      point.x,
      point.y,
      ringLayout.centerX,
      ringLayout.centerY,
      this.beads,
      0,
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
      0,
      layout.radiusScale,
      layout.displayScale,
    )
    this.renderDirty = true
  },

  getEditorRingLayout(this: DiyPageInstance) {
    if (this.editorRingLayoutCache) return this.editorRingLayoutCache
    const editorPlateOrigin = this.editorOrigin || {
      centerX: this.canvasWidth / 2,
      centerY: this.canvasHeight / 2,
      radius: getEditorTrayRadius(this.canvasWidth, this.canvasHeight),
    }
    const naturalRadius = this.beads.length > 0
      ? calculateRingRadiusMm(this.beads) * PIXELS_PER_MM
      : 0
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
      0,
      layout.radiusScale,
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
    const screenPoint = this.getCanvasTouchPoint(event, true) || dragState.latestPoint
    if (screenPoint !== dragState.latestPoint) {
      dragState.latestPoint = screenPoint
    }
    this.applyPendingDragPoint()
    this.dragState = null
    if (
      dragState.mode !== 'bead'
      || !dragState.uid
      || !dragState.bead
    ) {
      this.scheduleRender()
      return
    }

    const projectedPoint = this.renderer?.projectToBraceletPlane(screenPoint.x, screenPoint.y)
    const point = dragState.projectedPoint || (projectedPoint
      ? { ...projectedPoint, timestamp: screenPoint.timestamp }
      : null)
    if (!point) {
      this.startRingAnimation(240)
      return
    }

    if (this.isPointOutsideRemovalBoundary(point)) {
      this.removeBead(dragState.uid)
      return
    }

    const draggedBead = dragState.bead
    const ringLayout = this.getEditorRingLayout()
    const insertionIndex = findRingInsertionIndexForBeads(
      point.x,
      point.y,
      ringLayout.centerX,
      ringLayout.centerY,
      this.beads,
      0,
      dragState.uid,
    )
    const currentIndex = this.beads.indexOf(draggedBead)
    if (currentIndex < 0) return
    this.beads.splice(currentIndex, 1)
    this.beads.splice(Math.min(insertionIndex, this.beads.length), 0, draggedBead)
    this.invalidateRingLayoutCaches()
    appSound.play('discard')
    this.startRingAnimation(420)
  },

  handleCanvasTouchStart(this: DiyPageInstance, event: WechatMiniprogram.TouchEvent): void {
    const point = this.getCanvasTouchPoint(event)
    if (!point) return
    if (this.ringAnimation) return
    const beadUid = this.renderer?.pickBeadUid(point.x, point.y) || null
    const bead = beadUid
      ? this.beads.find((candidate) => candidate.uid === beadUid) || null
      : null
    const beadIndex = bead ? this.beads.indexOf(bead) : -1

    this.dragState = {
      mode: bead ? 'pending-bead' : 'pending-orbit',
      uid: bead?.uid || null,
      bead,
      startPoint: point,
      latestPoint: point,
      renderedPoint: point,
      projectedPoint: null,
      insertionIndex: beadIndex,
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
    const offsetFromStartX = point.x - dragState.startPoint.x
    const offsetFromStartY = point.y - dragState.startPoint.y
    if (dragState.mode === 'pending-bead' || dragState.mode === 'pending-orbit') {
      if (
        Math.sqrt(offsetFromStartX * offsetFromStartX + offsetFromStartY * offsetFromStartY)
        < GESTURE_MOVE_THRESHOLD_PX
      ) return
      dragState.mode = dragState.mode === 'pending-bead' ? 'bead' : 'orbit'
    }

    const previousPoint = dragState.renderedPoint
    dragState.renderedPoint = point
    if (dragState.mode === 'orbit') {
      if (this.renderer?.orbit(
        point.x - previousPoint.x,
        point.y - previousPoint.y,
        this.beads.length > 0,
      )) {
        this.renderDirty = true
      }
      return
    }

    const bead = dragState.bead
    if (!bead) return
    const projected = this.renderer?.projectToBraceletPlane(point.x, point.y)
    if (!projected) return
    const projectedPoint = { ...projected, timestamp: point.timestamp }
    dragState.projectedPoint = projectedPoint
    bead.x = projectedPoint.x
    bead.y = projectedPoint.y
    this.updateRingDragReflow(projectedPoint)
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
