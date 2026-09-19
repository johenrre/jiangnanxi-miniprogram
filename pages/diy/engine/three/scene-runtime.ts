import { createScopedThreejs } from 'threejs-miniprogram'

import type { DiyWebglCanvas, ThreeNamespace } from '@/pages/diy/engine/three/types'

const CAMERA_FOV_DEGREES = 38

export class ThreeSceneRuntime {
  readonly THREE: ThreeNamespace
  readonly scene: any
  readonly camera: any

  private readonly renderer: any
  private readonly raycaster: any
  private readonly pointer: any
  private logicalWidth = 1
  private logicalHeight = 1
  private baseCameraDistance = 1
  private destroyed = false

  constructor(
    canvas: DiyWebglCanvas,
    logicalWidth: number,
    logicalHeight: number,
    pixelRatio: number,
  ) {
    this.THREE = createScopedThreejs(canvas) as ThreeNamespace
    this.scene = new this.THREE.Scene()
    this.camera = new this.THREE.PerspectiveCamera(CAMERA_FOV_DEGREES, 1, 0.1, 5000)
    this.raycaster = new this.THREE.Raycaster()
    this.pointer = new this.THREE.Vector2()

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

    this.camera.aspect = this.logicalWidth / this.logicalHeight
    const fovRadians = CAMERA_FOV_DEGREES * Math.PI / 180
    const cameraDistance = this.logicalHeight / (2 * Math.tan(fovRadians / 2))
    this.baseCameraDistance = cameraDistance
    this.camera.zoom = 1
    this.camera.position.set(0, 0, cameraDistance)
    this.camera.lookAt(0, 0, 0)
    this.camera.far = cameraDistance + Math.max(this.logicalWidth, this.logicalHeight) * 6
    this.camera.updateProjectionMatrix()
  }

  fitDepthExtent(contentRadius: number): void {
    if (this.destroyed) return
    const safeExtent = Math.max(1, Number(contentRadius) || 1)
    const cameraDistance = Math.min(
      this.baseCameraDistance,
      Math.max(120, safeExtent * 4),
    )
    this.camera.position.set(0, 0, cameraDistance)
    this.camera.zoom = cameraDistance / this.baseCameraDistance
    this.camera.lookAt(0, 0, 0)
    this.camera.far = cameraDistance + Math.max(this.logicalWidth, this.logicalHeight) * 6
    this.camera.updateProjectionMatrix()
  }

  toWorldPosition(x: number, y: number): { x: number; y: number } {
    return {
      x: x - this.logicalWidth / 2,
      y: this.logicalHeight / 2 - y,
    }
  }

  getTextureAnisotropy(): number {
    const maximum = Number(this.renderer.capabilities?.getMaxAnisotropy?.()) || 1
    return Math.max(1, Math.min(4, maximum))
  }

  pickObject(x: number, y: number, objects: any[]): any | null {
    if (this.destroyed || objects.length === 0) return null
    this.setPointer(x, y)
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hits = this.raycaster.intersectObjects(objects, false)
    if (hits.length <= 1) return hits[0]?.object ?? null

    const nearestDistance = hits[0].distance
    const candidates = hits.filter((hit: any) => (
      hit.distance <= nearestDistance * 1.25 + 0.08
    ))
    if (candidates.length <= 1) return hits[0].object

    const center = new this.THREE.Vector3()
    let best = candidates[0]
    let bestScore = Number.POSITIVE_INFINITY
    for (const hit of candidates) {
      const object = hit.object
      if (typeof object.getWorldPosition === 'function') object.getWorldPosition(center)
      else center.set(object.position?.x || 0, object.position?.y || 0, object.position?.z || 0)
      const distanceSquared = typeof this.raycaster.ray.distanceSqToPoint === 'function'
        ? this.raycaster.ray.distanceSqToPoint(center)
        : center.distanceToSquared(this.raycaster.ray.origin)
      const pickRadius = Number(object.userData?.pickRadius) > 0
        ? Number(object.userData.pickRadius)
        : 10
      const score = distanceSquared + pickRadius * pickRadius * 0.12
      if (score < bestScore) {
        best = hit
        bestScore = score
      }
    }
    return best.object
  }

  projectToGroupLocal(
    x: number,
    y: number,
    group: any,
  ): { x: number; y: number; z: number } | null {
    if (this.destroyed || !group) return null
    group.updateMatrixWorld(true)
    this.setPointer(x, y)
    this.raycaster.setFromCamera(this.pointer, this.camera)

    const origin = new this.THREE.Vector3()
    group.getWorldPosition(origin)
    const normal = new this.THREE.Vector3(0, 0, 1)
    normal.transformDirection(group.matrixWorld)
    const plane = new this.THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin)
    const worldHit = new this.THREE.Vector3()
    const hit = this.raycaster.ray.intersectPlane(plane, worldHit)
    if (!hit) return null
    const local = group.worldToLocal(worldHit.clone())
    return { x: local.x, y: local.y, z: local.z }
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

  private setPointer(x: number, y: number): void {
    this.pointer.x = x / this.logicalWidth * 2 - 1
    this.pointer.y = -(y / this.logicalHeight) * 2 + 1
  }
}
