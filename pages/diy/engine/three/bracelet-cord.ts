import type { ThreeNamespace } from '@/pages/diy/engine/three/types'

const CORD_COLOR = 0x8f8178
const CORD_OPACITY = 0.48

export class BraceletCord {
  readonly object: any

  private readonly material: any
  private mesh: any | null = null
  private radius = -1

  constructor(private readonly THREE: ThreeNamespace) {
    this.object = new THREE.Group()
    this.material = new THREE.MeshBasicMaterial({
      color: CORD_COLOR,
      transparent: true,
      opacity: CORD_OPACITY,
      depthTest: true,
      depthWrite: true,
      fog: false,
    })
  }

  sync(radius: number, visible: boolean, maximumBeadRadius: number): void {
    const safeRadius = Math.max(0, Number(radius) || 0)
    this.object.visible = visible && safeRadius > 0
    if (!this.object.visible) return
    if (Math.abs(safeRadius - this.radius) < 0.05 && this.mesh) return

    this.disposeGeometry()
    this.radius = safeRadius
    const tubeRadius = Math.max(0.55, Math.min(1.05, maximumBeadRadius * 0.055))
    const geometry = new this.THREE.TorusGeometry(safeRadius, tubeRadius, 8, 96)
    this.mesh = new this.THREE.Mesh(geometry, this.material)
    this.mesh.renderOrder = 0
    this.mesh.frustumCulled = false
    this.object.add(this.mesh)
  }

  dispose(): void {
    this.disposeGeometry()
    this.material.dispose?.()
  }

  private disposeGeometry(): void {
    if (!this.mesh) return
    this.object.remove(this.mesh)
    this.mesh.geometry?.dispose?.()
    this.mesh = null
  }
}
