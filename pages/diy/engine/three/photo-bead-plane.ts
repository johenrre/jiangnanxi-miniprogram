import type { DiyBead } from '@/pages/diy/model/types'
import { PIXELS_PER_MM } from '@/pages/diy/engine/geometry'
import type { ThreeSceneRuntime } from '@/pages/diy/engine/three/scene-runtime'
import type { ThreeTextureCache } from '@/pages/diy/engine/three/texture-cache'
import type { BeadDisplaySize, ThreeNamespace } from '@/pages/diy/engine/three/types'
import { resolveCanvasImageUrl } from '@/utils/material-image'
import { getMaterialRenderMetrics } from '@/utils/material-render-geometry'

const TEXTURE_ALPHA_CUTOFF = 0.008

export class PhotoBeadPlane {
  readonly mesh: any

  private readonly material: any
  private source = ''
  private appliedTexture: any | null = null

  constructor(
    THREE: ThreeNamespace,
    geometry: any,
    private readonly textureCache: ThreeTextureCache,
  ) {
    this.material = new THREE.MeshBasicMaterial({
      color: 0xd9cec5,
      transparent: true,
      opacity: 0.22,
      alphaTest: TEXTURE_ALPHA_CUTOFF,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    })
    if ('toneMapped' in this.material) this.material.toneMapped = false
    this.mesh = new THREE.Mesh(geometry, this.material)
    this.mesh.frustumCulled = false
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
    runtime: ThreeSceneRuntime,
  ): void {
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
    const cosine = Math.cos(bead.rotation)
    const sine = Math.sin(bead.rotation)
    const screenX = bead.x + localOffsetX * cosine - localOffsetY * sine
    const screenY = bead.y + localOffsetX * sine + localOffsetY * cosine
    const world = runtime.toWorldPosition(screenX, screenY)

    this.mesh.position.set(world.x, world.y, renderOrder * 0.0001)
    this.mesh.rotation.set(0, 0, -bead.rotation)
    this.mesh.scale.set(size.width, size.height, 1)
    this.mesh.renderOrder = renderOrder
    this.mesh.userData.beadUid = bead.uid
    this.mesh.visible = true
  }

  dispose(): void {
    this.material.dispose?.()
  }
}
