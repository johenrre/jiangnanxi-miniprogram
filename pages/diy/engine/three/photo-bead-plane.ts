import type { DiyBead } from '@/pages/diy/model/types'
import { PIXELS_PER_MM } from '@/pages/diy/engine/geometry'
import type { ThreeTextureCache } from '@/pages/diy/engine/three/texture-cache'
import type { BeadDisplaySize, ThreeNamespace } from '@/pages/diy/engine/three/types'
import { resolveCanvasImageUrl } from '@/utils/material-image'
import {
  getMaterialRenderMetrics,
  getStringingWidthMm,
} from '@/utils/material-render-geometry'

const TEXTURE_ALPHA_CUTOFF = 0.008

export class PhotoBeadPlane {
  readonly object: any
  readonly mesh: any
  readonly hit: any

  private readonly material: any
  private readonly hitMaterial: any
  private source = ''
  private appliedTexture: any | null = null
  private poseStrategy: 'cord_tangent' | 'screen_upright' = 'cord_tangent'
  private homeAngle = 0

  constructor(
    THREE: ThreeNamespace,
    geometry: any,
    hitGeometry: any,
    private readonly textureCache: ThreeTextureCache,
  ) {
    this.material = new THREE.MeshBasicMaterial({
      color: 0xd9cec5,
      transparent: true,
      opacity: 0.22,
      alphaTest: TEXTURE_ALPHA_CUTOFF,
      depthTest: false,
      depthWrite: true,
      side: THREE.DoubleSide,
      fog: false,
    })
    if ('toneMapped' in this.material) this.material.toneMapped = false
    this.object = new THREE.Group()
    this.mesh = new THREE.Mesh(geometry, this.material)
    this.hitMaterial = new THREE.MeshBasicMaterial({
      visible: false,
      transparent: true,
      opacity: 0,
    })
    this.hit = new THREE.Mesh(hitGeometry, this.hitMaterial)
    this.mesh.frustumCulled = false
    this.hit.frustumCulled = false
    this.object.add(this.mesh, this.hit)
  }

  getDisplaySize(bead: DiyBead, displayScale: number): BeadDisplaySize {
    const source = resolveCanvasImageUrl(bead)
    const asset = source ? this.textureCache.get(source) : null
    const intrinsicSize = asset?.status === 'ready'
      ? { width: asset.width, height: asset.height }
      : null
    return getMaterialRenderMetrics(bead, intrinsicSize, PIXELS_PER_MM, displayScale)
  }

  sync(
    bead: DiyBead,
    displayScale: number,
    renderOrder: number,
    centerX: number,
    centerY: number,
  ): BeadDisplaySize {
    const source = resolveCanvasImageUrl(bead)
    if (source !== this.source) {
      this.source = source
      this.appliedTexture = null
      this.material.map = null
      this.material.color.setHex(0xd9cec5)
      this.material.opacity = 0.22
      this.material.needsUpdate = true
    }

    const asset = source ? this.textureCache.get(source) : null
    if (asset?.status === 'ready' && asset.texture !== this.appliedTexture) {
      this.appliedTexture = asset.texture
      this.material.map = asset.texture
      this.material.color.setHex(0xffffff)
      this.material.opacity = 1
      this.material.needsUpdate = true
    }

    const size = this.getDisplaySize(bead, displayScale)
    const localOffsetX = size.width / 2 - size.anchorX
    const localOffsetY = size.height / 2 - size.anchorY
    const localX = bead.x - centerX
    const localY = centerY - bead.y
    this.poseStrategy = bead.stringingPosition === 'top'
      ? 'screen_upright'
      : 'cord_tangent'
    this.homeAngle = Math.atan2(localY, localX)
    this.object.position.set(
      localX,
      localY,
      0,
    )
    this.mesh.position.set(localOffsetX, -localOffsetY, 0)
    this.mesh.scale.set(size.width, size.height, 1)
    this.hit.position.copy?.(this.mesh.position)
    const footprintPx = getStringingWidthMm(bead) * PIXELS_PER_MM * Math.max(0.1, displayScale)
    const preferredHitRadius = Math.max(
      footprintPx * 0.72,
      Math.max(size.width, size.height) * 0.54,
    )
    const hitRadius = Math.max(10, Math.min(30, preferredHitRadius))
    this.hit.scale.set(hitRadius, hitRadius, hitRadius)
    this.mesh.renderOrder = renderOrder
    this.mesh.userData.beadUid = bead.uid
    this.hit.userData.beadUid = bead.uid
    this.hit.userData.pickRadius = hitRadius
    this.mesh.visible = true
    return size
  }

  orientToCamera(camera: any, THREE: ThreeNamespace): void {
    if (!camera || !this.object.parent) return
    try {
      const parentQuaternion = new THREE.Quaternion()
      this.object.parent.updateMatrixWorld(true)
      this.object.parent.getWorldQuaternion(parentQuaternion)

      const radialX = Math.cos(this.homeAngle)
      const radialY = Math.sin(this.homeAngle)
      const preferredUp = new THREE.Vector3(-radialX, -radialY, 0)
        .applyQuaternion(parentQuaternion)
      const preferredRight = new THREE.Vector3(-radialY, radialX, 0)
        .applyQuaternion(parentQuaternion)
      if (preferredUp.lengthSq() > 1e-10) preferredUp.normalize()
      else preferredUp.set(0, 1, 0)
      if (preferredRight.lengthSq() > 1e-10) preferredRight.normalize()

      const worldPosition = new THREE.Vector3()
      this.object.getWorldPosition(worldPosition)
      const forward = new THREE.Vector3(
        camera.position.x - worldPosition.x,
        camera.position.y - worldPosition.y,
        camera.position.z - worldPosition.z,
      )
      if (forward.lengthSq() < 1e-10) forward.set(0, 0, 1)
      else forward.normalize()

      let right: any
      let up: any
      if (this.poseStrategy === 'screen_upright') {
        const hangingUp = preferredUp.clone()
        const alongForward = forward.dot(hangingUp)
        hangingUp.x -= forward.x * alongForward
        hangingUp.y -= forward.y * alongForward
        hangingUp.z -= forward.z * alongForward
        if (hangingUp.lengthSq() < 1e-6) hangingUp.set(0, 1, 0)
        else hangingUp.normalize()
        right = new THREE.Vector3().crossVectors(hangingUp, forward)
        if (right.lengthSq() < 1e-6) right.set(1, 0, 0)
        else right.normalize()
        up = new THREE.Vector3().crossVectors(forward, right)
        if (up.lengthSq() < 1e-10) up.set(0, 1, 0)
        else up.normalize()
        if (up.dot(hangingUp) < 0) {
          up.negate()
          right.negate()
        }
      } else {
        right = preferredRight.clone()
        const alongForward = forward.dot(right)
        right.x -= forward.x * alongForward
        right.y -= forward.y * alongForward
        right.z -= forward.z * alongForward
        if (right.lengthSq() < 1e-6) right.set(1, 0, 0)
        else right.normalize()
        if (right.dot(preferredRight) < 0) right.negate()
        up = new THREE.Vector3().crossVectors(forward, right)
        if (up.lengthSq() < 1e-10) up.set(0, 1, 0)
        else up.normalize()
      }

      const basis = new THREE.Matrix4()
      if (typeof basis.makeBasis === 'function') {
        basis.makeBasis(right, up, forward)
      } else {
        basis.set(
          right.x, up.x, forward.x, 0,
          right.y, up.y, forward.y, 0,
          right.z, up.z, forward.z, 0,
          0, 0, 0, 1,
        )
      }
      const worldQuaternion = new THREE.Quaternion().setFromRotationMatrix(basis)
      const inverseParent = parentQuaternion.clone()
      if (typeof inverseParent.invert === 'function') inverseParent.invert()
      else if (typeof inverseParent.inverse === 'function') inverseParent.inverse()
      else inverseParent.conjugate?.()
      this.object.quaternion.copy(inverseParent).multiply(worldQuaternion)
    } catch {
      this.object.lookAt?.(camera.position.x, camera.position.y, camera.position.z)
    }
  }

  dispose(): void {
    this.material.dispose?.()
    this.hitMaterial.dispose?.()
  }
}
