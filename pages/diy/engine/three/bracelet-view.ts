import type { PhotoBeadPlane } from '@/pages/diy/engine/three/photo-bead-plane'
import { BraceletCord } from '@/pages/diy/engine/three/bracelet-cord'
import type { ThreeSceneRuntime } from '@/pages/diy/engine/three/scene-runtime'

const HORIZONTAL_ROTATION_SPEED = 0.008
const VERTICAL_ROTATION_SPEED = 0.006
const MINIMUM_VERTICAL_ROTATION = -0.35
const MAXIMUM_VERTICAL_ROTATION = 0.55

export class BraceletView {
  readonly group: any

  private readonly cord: BraceletCord
  private rotationX = 0
  private rotationY = 0
  private centerX = 0
  private centerY = 0

  constructor(private readonly runtime: ThreeSceneRuntime) {
    this.group = new runtime.THREE.Group()
    this.cord = new BraceletCord(runtime.THREE)
    this.group.add(this.cord.object)
    runtime.scene.add(this.group)
  }

  setCenter(screenX: number, screenY: number): void {
    this.centerX = screenX
    this.centerY = screenY
    const world = this.runtime.toWorldPosition(screenX, screenY)
    this.group.position.set(world.x, world.y, 0)
  }

  add(plane: PhotoBeadPlane): void {
    this.group.add(plane.object)
  }

  remove(plane: PhotoBeadPlane): void {
    this.group.remove(plane.object)
  }

  syncStage(ringRadius: number, contentRadius: number, maximumBeadRadius: number): void {
    this.cord.sync(ringRadius, ringRadius > 0, maximumBeadRadius)
    this.runtime.fitDepthExtent(contentRadius)
  }

  orbit(deltaX: number, deltaY: number, hasBeads: boolean): boolean {
    if (!hasBeads) return false
    this.rotationY += deltaX * HORIZONTAL_ROTATION_SPEED
    this.rotationX = Math.max(
      MINIMUM_VERTICAL_ROTATION,
      Math.min(MAXIMUM_VERTICAL_ROTATION, this.rotationX + deltaY * VERTICAL_ROTATION_SPEED),
    )
    this.applyRotation()
    return true
  }

  reset(): void {
    this.rotationX = 0
    this.rotationY = 0
    this.applyRotation()
  }

  updateBillboards(planes: Iterable<PhotoBeadPlane>): void {
    this.group.updateMatrixWorld(true)
    for (const plane of planes) {
      plane.orientToCamera(this.runtime.camera, this.runtime.THREE)
    }
    this.group.updateMatrixWorld(true)
  }

  pickBeadUid(x: number, y: number, planes: Iterable<PhotoBeadPlane>): string | null {
    const planeList = Array.from(planes)
    this.updateBillboards(planeList)
    const meshes = planeList.map((plane) => plane.hit)
    const object = this.runtime.pickObject(x, y, meshes)
    const beadUid = String(object?.userData?.beadUid || '').trim()
    return beadUid || null
  }

  projectToLocalScreen(x: number, y: number): { x: number; y: number } | null {
    const local = this.runtime.projectToGroupLocal(x, y, this.group)
    if (!local) return null
    return {
      x: this.centerX + local.x,
      y: this.centerY - local.y,
    }
  }

  destroy(): void {
    this.cord.dispose()
    this.group.remove(this.cord.object)
    this.runtime.scene.remove(this.group)
  }

  private applyRotation(): void {
    this.group.rotation.x = this.rotationX
    this.group.rotation.y = this.rotationY
    this.group.updateMatrixWorld(true)
  }
}
