import {
  PIXELS_PER_MM,
  applyRingLayout,
  buildRingTargets,
  calculatePerimeterMm,
  easeOutCubic,
  findRingInsertionIndexForBeads,
  fitRingScalesToOuterRadius,
  getBeadCollisionRadiusPx,
  getEditorTrayRadius,
} from '@/pages/diy/engine/geometry'
import { LooseBraceletPhysics } from '@/pages/diy/engine/physics'
import { BraceletRenderer } from '@/pages/diy/engine/renderer'
import type { DiyBead, RingTarget, TouchPoint } from '@/pages/diy/model/types'
import type { CanvasQueryResult, DiyPageInstance } from '@/pages/diy/page/types'
import { getWindowMetrics, normalizeAngleDelta } from '@/pages/diy/page/utils'
import { appSound } from '@/services/sound'
import { getMaterialRenderMetrics } from '@/utils/material-render-geometry'

const FIXED_STEP_MS = 1000 / 60
const MAXIMUM_STEPS_PER_FRAME = 2
const RING_ANIMATION_DURATION_MS = 440
const SHOWCASE_TRANSITION_DURATION_MS = 760
const SHOWCASE_ROTATION_RADIANS_PER_MS = Math.PI * 2 / 18000
const SHOWCASE_IDLE_FRAME_MS = 1000 / 60
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
const LOOSE_DRAG_VELOCITY_SMOOTHING_MS = 34
const LOOSE_DRAG_MINIMUM_MOTION_SQUARED = 0.16
const LOOSE_RELEASE_VELOCITY_HOLD_MS = 48
const LOOSE_RELEASE_VELOCITY_DECAY_MS = 150
const LOOSE_RELEASE_VELOCITY_EXPIRE_MS = 260
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
      this.physics?.destroy()
      this.physics = null
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
      this.showcasePlateOrigin = {
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
          this.data.backgroundIndex,
          this.trayBackgroundUrls,
          this.showcasePresentation,
          this.showcaseBrandImagePath,
          () => {
            this.scheduleRender()
            this.updateEntryGate()
          },
        )
      }
      if (!this.data.loadingMaterials && !this.firstScreenMaterialImagesReady) {
        void this.preloadFirstScreenMaterialImages()
      }
      if (!this.data.showShowcase) {
        const editorPlateOrigin = this.showcasePlateOrigin
        this.physics = new LooseBraceletPhysics(
          editorPlateOrigin.centerX,
          editorPlateOrigin.centerY,
          editorPlateOrigin.radius,
        )
      }
      this.setData({ canvasReady: true }, () => {
        void this.tryApplyTemplateDesign()
        this.updateEntryGate()
      })

      if (this.beads.length > 0) {
        if (this.data.isStrung) {
          if (this.data.showShowcase && this.showcaseEntryPositions) {
            this.beads.forEach((bead) => {
              const entryPosition = this.showcaseEntryPositions?.get(bead.uid)
              if (!entryPosition) return
              bead.x = entryPosition.x
              bead.y = entryPosition.y
              bead.rotation = entryPosition.rotation
            })
            this.startRingAnimation(SHOWCASE_TRANSITION_DURATION_MS)
          } else if (this.data.showShowcase) {
            this.startRingAnimation(SHOWCASE_TRANSITION_DURATION_MS)
          } else {
            this.applyRingTargets(this.buildCurrentRingTargets(this.beads))
          }
        } else {
          this.rebuildLoosePhysics()
        }
      }
      this.scheduleRender()
    })
  },

  disposeCanvas(this: DiyPageInstance): void {
    this.cancelAnimationFrame()
    this.renderer?.destroy()
    this.physics?.destroy()
    this.renderer = null
    this.physics = null
    this.canvas = null
    this.ringAnimation = null
    this.dragState = null
    this.showcaseMotionAccumulator = 0
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
    this.frameAccumulator = 0
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
    } else if (!this.data.isStrung && this.physics) {
      animationActive = this.stepLoosePhysics(deltaMs)
    }
    if (
      this.data.isStrung
      && !this.data.showShowcase
      && !this.ringAnimation
      && this.dragState?.mode !== 'ring-bead'
    ) {
      animationActive = this.stepRingMotion(deltaMs) || animationActive
    }
    if (this.data.showShowcase) {
      animationActive = this.stepShowcaseAnimation(timestamp, deltaMs) || animationActive
    }
    this.lastFrameTimestamp = timestamp

    // Animation activity controls scheduling; renderDirty controls drawing.
    // Keeping them separate avoids a duplicate full-canvas draw on 120Hz
    // devices when the fixed 60Hz physics step has not advanced.
    if (this.renderDirty) this.renderEditor()
    if (animationActive || this.renderDirty) this.requestAnimationFrame()
    else {
      this.lastFrameTimestamp = 0
      this.frameAccumulator = 0
    }
  },

  stepLoosePhysics(this: DiyPageInstance, deltaMs: number): boolean {
    if (!this.physics) return false
    this.frameAccumulator = Math.min(
      this.frameAccumulator + deltaMs,
      FIXED_STEP_MS * MAXIMUM_STEPS_PER_FRAME,
    )
    let stepCount = 0
    while (this.frameAccumulator >= FIXED_STEP_MS && stepCount < MAXIMUM_STEPS_PER_FRAME) {
      this.physics.step(FIXED_STEP_MS)
      this.frameAccumulator -= FIXED_STEP_MS
      stepCount += 1
    }
    if (stepCount > 0) {
      appSound.enqueueImpacts(this.physics.drainImpacts())
      this.syncBeadsFromPhysics()
      this.renderDirty = true
    }
    return this.physics.hasActiveMotion()
  },

  stepShowcaseAnimation(this: DiyPageInstance, timestamp: number, deltaMs: number): boolean {
    if (!this.data.showShowcase) return false
    const transitionDirection = this.showcaseTransitionDirection
    if (transitionDirection !== 'idle') {
      if (this.showcaseAnimationStartTime === 0) this.showcaseAnimationStartTime = timestamp
      const transitionDistance = transitionDirection === 'opening'
        ? 1 - this.showcaseTransitionStartProgress
        : this.showcaseTransitionStartProgress
      const transitionDuration = Math.max(
        160,
        SHOWCASE_TRANSITION_DURATION_MS * transitionDistance,
      )
      const linearProgress = Math.min(
        1,
        (timestamp - this.showcaseAnimationStartTime) / transitionDuration,
      )
      const easedProgress = easeOutCubic(linearProgress)
      const nextProgress = transitionDirection === 'opening'
        ? this.showcaseTransitionStartProgress
          + (1 - this.showcaseTransitionStartProgress) * easedProgress
        : this.showcaseTransitionStartProgress * (1 - easedProgress)
      if (Math.abs(nextProgress - this.showcaseTransitionProgress) > 0.0001) {
        this.showcaseTransitionProgress = nextProgress
        this.renderDirty = true
      }

      if (linearProgress >= 1) {
        if (transitionDirection === 'closing') {
          this.completeShowcaseClose()
          return false
        }
        this.showcaseTransitionProgress = 1
        this.showcaseTransitionDirection = 'idle'
      }
    }

    if (this.showcaseTransitionDirection === 'idle' && !this.ringAnimation) {
      this.showcaseMotionAccumulator += deltaMs
      if (this.showcaseMotionAccumulator >= SHOWCASE_IDLE_FRAME_MS) {
        const elapsedMs = this.showcaseMotionAccumulator
        this.showcaseMotionAccumulator %= SHOWCASE_IDLE_FRAME_MS
        this.ringRotationOffset += SHOWCASE_ROTATION_RADIANS_PER_MS * elapsedMs
        this.applyCurrentRingLayout(this.beads)
      }
    }
    return true
  },

  syncBeadsFromPhysics(this: DiyPageInstance): void {
    if (!this.physics) return
    this.physics.syncPositions(this.beads)
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

    const editorLayout = this.data.isStrung ? this.getEditorRingLayout() : null
    const editorDisplayScale = editorLayout?.displayScale ?? EDITOR_BEAD_DISPLAY_SCALE
    let displayScale = editorDisplayScale
    if (this.data.showShowcase) {
      const showcaseLayout = this.getRingLayout()
      displayScale = editorDisplayScale
        + (showcaseLayout.displayScale - editorDisplayScale) * this.showcaseTransitionProgress
    }
    this.renderer?.render(
      this.beads,
      this.data.backgroundIndex,
      this.data.showShowcase ? 'showcase' : 'editor',
      displayScale,
      this.data.statusBarHeight,
      this.showcaseTransitionProgress,
      this.showcasePlateOrigin,
      !this.data.isClosingShowcase,
      this.dragState?.uid ?? null,
    )
    if (!this.firstCanvasFrameRendered && this.renderer) {
      this.firstCanvasFrameRendered = true
      this.updateEntryGate()
    }
  },

  invalidateRingLayoutCaches(this: DiyPageInstance): void {
    this.editorRingLayoutCache = null
    this.showcaseRingLayoutCache = null
  },

  startRingAnimation(this: DiyPageInstance, duration = RING_ANIMATION_DURATION_MS): void {
    if (this.beads.length === 0 || this.canvasWidth <= 0 || this.canvasHeight <= 0) return
    // Ring transitions must own a fresh RAF. A loose-physics frame can remain
    // pending while a restored cart design switches modes on some real devices.
    // Reusing that stale request makes the ring appear to snap to its target.
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

  startRingAnimationToPositions(
    this: DiyPageInstance,
    positions: Map<string, { x: number; y: number; rotation: number }>,
    duration: number,
  ): void {
    if (this.beads.length === 0) return
    this.cancelAnimationFrame()
    this.resetRingMotion()
    const items = []
    for (let index = 0; index < this.beads.length; index += 1) {
      const bead = this.beads[index]
      const target = positions.get(bead.uid)
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
    this.ringAnimation = { startTime: 0, duration, items }
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
    if (!this.data.isStrung || this.data.showShowcase) return false

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

    const ringLayout = this.getRingLayout()
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
    const layout = this.getRingLayout()
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
    const editorPlateOrigin = this.showcasePlateOrigin || {
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

  getRingLayout(this: DiyPageInstance) {
    if (!this.data.showShowcase) return this.getEditorRingLayout()
    if (this.showcaseRingLayoutCache) return this.showcaseRingLayoutCache

    const centerX = this.canvasWidth / 2
    const naturalRadius = calculatePerimeterMm(this.beads) / (Math.PI * 2) * PIXELS_PER_MM
    const maximumOuterRadius = Math.min(this.canvasWidth * 0.43, this.canvasHeight * 0.19)
    const minimumHeroRadius = this.canvasWidth * 0.22
    const preferredScale = naturalRadius > 0
      ? Math.max(1.18, minimumHeroRadius / naturalRadius)
      : 1
    const fittedScales = fitRingScalesToOuterRadius(
      this.beads,
      maximumOuterRadius,
      preferredScale,
      preferredScale,
    )
    this.showcaseRingLayoutCache = {
      centerX,
      centerY: this.canvasHeight * 0.55,
      radiusScale: fittedScales.radiusScale,
      displayScale: fittedScales.displayScale,
    }
    return this.showcaseRingLayoutCache
  },

  buildCurrentRingTargets(this: DiyPageInstance, beads: DiyBead[]): RingTarget[] {
    const layout = this.getRingLayout()
    return buildRingTargets(
      beads,
      layout.centerX,
      layout.centerY,
      this.ringRotationOffset,
      layout.radiusScale * this.ringElasticScale,
      layout.displayScale,
    )
  },

  rebuildLoosePhysics(this: DiyPageInstance, scatter = false): void {
    if (!this.physics) return
    this.resetRingMotion()
    this.physics.replaceBeads(this.beads.map((bead) => {
      const launchAngle = Math.random() * Math.PI * 2
      const scatterSpeed = 28 + Math.random() * 18
      return {
        uid: bead.uid,
        x: bead.x,
        y: bead.y,
        radius: getBeadCollisionRadiusPx(bead, EDITOR_BEAD_DISPLAY_SCALE),
        rotation: bead.rotation,
        velocityX: scatter
          ? Math.cos(launchAngle) * scatterSpeed
          : (Math.random() - 0.5) * 10,
        velocityY: scatter
          ? Math.sin(launchAngle) * scatterSpeed
          : (Math.random() - 0.5) * 10,
      }
    }))
    this.requestAnimationFrame()
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
    const displayScale = this.data.isStrung
      ? this.getEditorRingLayout().displayScale
      : EDITOR_BEAD_DISPLAY_SCALE
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
    const editorPlateOrigin = this.showcasePlateOrigin || {
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
      this.physics?.cancelDrag()
      this.removeBead(dragState.uid, dragState.snapshot)
      return
    }

    if (dragState.mode === 'loose-bead') {
      const releaseAgeMs = Math.max(0, point.timestamp - dragState.lastMotionTimestamp)
      const releaseDecay = releaseAgeMs <= LOOSE_RELEASE_VELOCITY_HOLD_MS
        ? 1
        : Math.exp(
          -(releaseAgeMs - LOOSE_RELEASE_VELOCITY_HOLD_MS)
          / LOOSE_RELEASE_VELOCITY_DECAY_MS,
        )
      const releaseMultiplier = releaseAgeMs >= LOOSE_RELEASE_VELOCITY_EXPIRE_MS
        ? 0
        : releaseDecay
      this.physics?.endDrag(
        dragState.uid,
        dragState.releaseVelocityX * releaseMultiplier,
        dragState.releaseVelocityY * releaseMultiplier,
      )
      this.requestAnimationFrame()
      return
    }

    const draggedBead = dragState.bead
    if (!draggedBead) return
    const ringLayout = this.getRingLayout()
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

  switchShowcaseMode(this: DiyPageInstance, showShowcase: boolean): void {
    if (showShowcase) {
      if (this.data.showShowcase) return
      this.showcaseEntryPositions = new Map(this.beads.map((bead) => [
        bead.uid,
        { x: bead.x, y: bead.y, rotation: bead.rotation },
      ]))
      this.showcaseAnimationStartTime = 0
      this.showcaseMotionAccumulator = 0
      this.showcaseTransitionProgress = 0
      this.showcaseTransitionStartProgress = 0
      this.showcaseTransitionDirection = 'opening'
      this.renderDirty = false
      this.cancelAnimationFrame()
      this.setData({
        showShowcase: true,
        isClosingShowcase: false,
        showSizeGuide: false,
        showGuide: false,
        showWristPicker: false,
      }, () => {
        this.startRingAnimation(SHOWCASE_TRANSITION_DURATION_MS)
        this.scheduleRender()
      })
      return
    }

    if (!this.data.showShowcase || this.showcaseTransitionDirection === 'closing') return
    this.showcaseAnimationStartTime = 0
    this.showcaseMotionAccumulator = 0
    this.showcaseTransitionStartProgress = this.showcaseTransitionProgress
    this.showcaseTransitionDirection = 'closing'
    const transitionDuration = Math.max(
      160,
      SHOWCASE_TRANSITION_DURATION_MS * this.showcaseTransitionStartProgress,
    )
    const editorLayout = this.getEditorRingLayout()
    const editorTargets = buildRingTargets(
      this.beads,
      editorLayout.centerX,
      editorLayout.centerY,
      this.ringRotationOffset,
      editorLayout.radiusScale,
      editorLayout.displayScale,
    )
    this.showcaseEntryPositions = new Map(editorTargets.map((target) => [
      target.uid,
      { x: target.x, y: target.y, rotation: target.rotation },
    ]))
    this.startRingAnimationToPositions(this.showcaseEntryPositions, transitionDuration)
    this.setData({ isClosingShowcase: true }, () => this.scheduleRender())
    this.requestAnimationFrame()
  },

  completeShowcaseClose(this: DiyPageInstance): void {
    this.showcaseTransitionProgress = 0
    this.showcaseTransitionStartProgress = 0
    this.showcaseTransitionDirection = 'idle'
    this.showcaseAnimationStartTime = 0
    this.showcaseMotionAccumulator = 0
    this.ringAnimation = null
    this.renderDirty = false
    this.setData({ showShowcase: false, isClosingShowcase: false }, () => {
      this.applyRingTargets(this.buildCurrentRingTargets(this.beads))
      this.showcaseEntryPositions = null
      this.showcaseTransitionProgress = 1
      this.showcaseTransitionStartProgress = 1
      this.scheduleRender()
    })
  },

  handleOpenShowcase(this: DiyPageInstance): void {
    if (!this.data.isStrung || this.beads.length === 0) return
    appSound.play('soft-pop')
    this.switchShowcaseMode(true)
  },

  handleCloseShowcase(this: DiyPageInstance): void {
    this.switchShowcaseMode(false)
  },

  handleCanvasTouchStart(this: DiyPageInstance, event: WechatMiniprogram.TouchEvent): void {
    const point = this.getCanvasTouchPoint(event)
    if (!point) return
    if (this.data.showShowcase) {
      this.handleCloseShowcase()
      return
    }
    if (this.ringAnimation) return
    const bead = this.findBeadAtPoint(point)
    const snapshot = this.createSnapshot()

    if (!this.data.isStrung) {
      if (!bead || !this.physics?.beginDrag(bead.uid)) return
      this.dragState = {
        uid: bead.uid,
        bead,
        mode: 'loose-bead',
        latestPoint: point,
        renderedPoint: point,
        releaseVelocityX: 0,
        releaseVelocityY: 0,
        lastMotionTimestamp: point.timestamp,
        snapshot,
        originalIndex: this.beads.indexOf(bead),
        insertionIndex: this.beads.indexOf(bead),
        reflowTargets: null,
      }
      appSound.play('soft-pop')
      this.scheduleRender()
      return
    }

    this.ringAngularVelocity = 0
    this.dragState = {
      uid: bead?.uid || null,
      bead,
      mode: bead ? 'ring-bead' : 'ring-rotate',
      latestPoint: point,
      renderedPoint: point,
      releaseVelocityX: 0,
      releaseVelocityY: 0,
      lastMotionTimestamp: point.timestamp,
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
      const ringLayout = this.getRingLayout()
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
    if (dragState.mode === 'loose-bead') {
      const deltaX = point.x - previousRenderedPoint.x
      const deltaY = point.y - previousRenderedPoint.y
      const distanceSquared = deltaX * deltaX + deltaY * deltaY
      if (distanceSquared >= LOOSE_DRAG_MINIMUM_MOTION_SQUARED) {
        const elapsedMs = Math.max(
          4,
          Math.min(80, point.timestamp - previousRenderedPoint.timestamp),
        )
        const elapsedFrames = elapsedMs / FIXED_STEP_MS
        const instantaneousVelocityX = deltaX / elapsedFrames
        const instantaneousVelocityY = deltaY / elapsedFrames
        const velocityBlend = 1 - Math.exp(
          -elapsedMs / LOOSE_DRAG_VELOCITY_SMOOTHING_MS,
        )
        dragState.releaseVelocityX += (
          instantaneousVelocityX - dragState.releaseVelocityX
        ) * velocityBlend
        dragState.releaseVelocityY += (
          instantaneousVelocityY - dragState.releaseVelocityY
        ) * velocityBlend
        dragState.lastMotionTimestamp = point.timestamp
      }
      this.physics?.moveDraggedBead(
        bead.uid,
        point.x,
        point.y,
        dragState.releaseVelocityX,
        dragState.releaseVelocityY,
      )
    } else if (dragState.mode === 'ring-bead') {
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
