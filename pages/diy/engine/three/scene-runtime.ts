import { createScopedThreejs } from 'threejs-miniprogram'

import type { DiyWebglCanvas, ThreeNamespace } from '@/pages/diy/engine/three/types'

const CAMERA_DISTANCE = 100

export class ThreeSceneRuntime {
  readonly THREE: ThreeNamespace
  readonly scene: any

  private readonly camera: any
  private readonly renderer: any
  private logicalWidth = 1
  private logicalHeight = 1
  private destroyed = false

  constructor(
    canvas: DiyWebglCanvas,
    logicalWidth: number,
    logicalHeight: number,
    pixelRatio: number,
  ) {
    this.THREE = createScopedThreejs(canvas) as ThreeNamespace
    this.scene = new this.THREE.Scene()
    this.camera = new this.THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200)
    this.camera.position.set(0, 0, CAMERA_DISTANCE)
    this.camera.lookAt(0, 0, 0)

    this.renderer = new this.THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    })
    this.renderer.setClearColor(0x000000, 0)
    if (this.THREE.NoToneMapping !== undefined) {
      this.renderer.toneMapping = this.THREE.NoToneMapping
    }
    if (this.renderer.toneMappingExposure !== undefined) {
      this.renderer.toneMappingExposure = 1
    }
    if (
      this.renderer.outputEncoding !== undefined
      && this.THREE.LinearEncoding !== undefined
    ) {
      this.renderer.outputEncoding = this.THREE.LinearEncoding
    }
    this.resize(logicalWidth, logicalHeight, pixelRatio)
  }

  resize(logicalWidth: number, logicalHeight: number, pixelRatio: number): void {
    if (this.destroyed) return
    this.logicalWidth = Math.max(1, logicalWidth)
    this.logicalHeight = Math.max(1, logicalHeight)
    const safePixelRatio = Math.max(1, pixelRatio)
    if (typeof this.renderer.setPixelRatio === 'function') {
      this.renderer.setPixelRatio(safePixelRatio)
    }
    this.renderer.setSize(this.logicalWidth, this.logicalHeight, false)

    this.camera.left = -this.logicalWidth / 2
    this.camera.right = this.logicalWidth / 2
    this.camera.top = this.logicalHeight / 2
    this.camera.bottom = -this.logicalHeight / 2
    this.camera.updateProjectionMatrix()
  }

  toWorldPosition(x: number, y: number): { x: number; y: number } {
    return {
      x: x - this.logicalWidth / 2,
      y: this.logicalHeight / 2 - y,
    }
  }

  render(): void {
    if (this.destroyed) return
    this.renderer.render(this.scene, this.camera)
  }

  clear(): void {
    if (this.destroyed) return
    this.renderer.clear(true, true, true)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    if (this.renderer.renderLists?.dispose) this.renderer.renderLists.dispose()
    this.renderer.dispose()
    if (typeof this.renderer.forceContextLoss === 'function') {
      this.renderer.forceContextLoss()
    }
  }
}
