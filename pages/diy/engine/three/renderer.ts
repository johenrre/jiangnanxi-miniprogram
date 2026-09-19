import type { DiyBead } from '@/pages/diy/model/types'
import { PIXELS_PER_MM } from '@/pages/diy/engine/geometry'
import { PhotoBeadPlane } from '@/pages/diy/engine/three/photo-bead-plane'
import { ThreeSceneRuntime } from '@/pages/diy/engine/three/scene-runtime'
import { ThreeTextureCache } from '@/pages/diy/engine/three/texture-cache'
import type { BeadDisplaySize, DiyWebglCanvas } from '@/pages/diy/engine/three/types'
import { resolveCanvasImageUrl } from '@/utils/material-image'
import { getMaterialRenderMetrics } from '@/utils/material-render-geometry'

function compareBeadDepth(
  left: DiyBead,
  right: DiyBead,
  activeBeadUid: string | null,
): number {
  const leftIsActive = left.uid === activeBeadUid
  const rightIsActive = right.uid === activeBeadUid
  if (leftIsActive !== rightIsActive) return leftIsActive ? 1 : -1
  return left.layer - right.layer || left.y - right.y
}

export class Bracelet3DRenderer {
  private readonly runtime: ThreeSceneRuntime
  private readonly textureCache: ThreeTextureCache
  private readonly planeGeometry: any
  private readonly planeByUid = new Map<string, PhotoBeadPlane>()
  private readonly sortedBeads: DiyBead[] = []
  private destroyed = false

  constructor(
    canvas: DiyWebglCanvas,
    logicalWidth: number,
    logicalHeight: number,
    pixelRatio: number,
    invalidate: () => void,
  ) {
    this.runtime = new ThreeSceneRuntime(canvas, logicalWidth, logicalHeight, pixelRatio)
    this.textureCache = new ThreeTextureCache(
      this.runtime.THREE,
      canvas,
      invalidate,
    )
    this.planeGeometry = new this.runtime.THREE.PlaneGeometry(1, 1)
  }

  resize(logicalWidth: number, logicalHeight: number, pixelRatio: number): void {
    this.runtime.resize(logicalWidth, logicalHeight, pixelRatio)
  }

  getBeadDisplaySize(bead: DiyBead, displayScale: number): BeadDisplaySize {
    const plane = this.planeByUid.get(bead.uid)
    if (plane) return plane.getDisplaySize(bead, displayScale)
    const source = resolveCanvasImageUrl(bead)
    const asset = source ? this.textureCache.get(source) : null
    const intrinsicSize = asset?.status === 'ready'
      ? { width: asset.width, height: asset.height }
      : null
    return getMaterialRenderMetrics(bead, intrinsicSize, PIXELS_PER_MM, displayScale)
  }

  preloadImages(sources: string[]): Promise<void> {
    return this.textureCache.preload(sources)
  }

  render(
    beads: DiyBead[],
    displayScale = 1,
    activeBeadUid: string | null = null,
  ): void {
    if (this.destroyed) return
    const nextUids = new Set(beads.map((bead) => bead.uid))
    this.planeByUid.forEach((plane, uid) => {
      if (nextUids.has(uid)) return
      this.runtime.scene.remove(plane.mesh)
      plane.dispose()
      this.planeByUid.delete(uid)
    })

    this.sortedBeads.length = beads.length
    for (let index = 0; index < beads.length; index += 1) {
      this.sortedBeads[index] = beads[index]
    }
    this.sortedBeads.sort((left, right) => (
      compareBeadDepth(left, right, activeBeadUid)
    ))

    for (let index = 0; index < this.sortedBeads.length; index += 1) {
      const bead = this.sortedBeads[index]
      let plane = this.planeByUid.get(bead.uid)
      if (!plane) {
        plane = new PhotoBeadPlane(
          this.runtime.THREE,
          this.planeGeometry,
          this.textureCache,
        )
        this.planeByUid.set(bead.uid, plane)
        this.runtime.scene.add(plane.mesh)
      }
      const renderOrder = bead.uid === activeBeadUid ? 1000 : 10 + index
      plane.sync(bead, displayScale, renderOrder, this.runtime)
    }
    this.runtime.render()
  }

  clear(): void {
    this.runtime.clear()
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.planeByUid.forEach((plane) => {
      this.runtime.scene.remove(plane.mesh)
      plane.dispose()
    })
    this.planeByUid.clear()
    this.planeGeometry.dispose?.()
    this.textureCache.destroy()
    this.runtime.destroy()
  }
}
