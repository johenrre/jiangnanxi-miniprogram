import type { DiyBead } from '@/pages/diy/model/types'
import { BraceletView } from '@/pages/diy/engine/three/bracelet-view'
import { PhotoBeadPlane } from '@/pages/diy/engine/three/photo-bead-plane'
import { ThreeSceneRuntime } from '@/pages/diy/engine/three/scene-runtime'
import { ThreeTextureCache } from '@/pages/diy/engine/three/texture-cache'
import type { DiyWebglCanvas } from '@/pages/diy/engine/three/types'

export class Bracelet3DRenderer {
  private readonly runtime: ThreeSceneRuntime
  private readonly textureCache: ThreeTextureCache
  private readonly braceletView: BraceletView
  private readonly planeGeometry: any
  private readonly hitGeometry: any
  private readonly planeByUid = new Map<string, PhotoBeadPlane>()
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
      this.runtime.getTextureAnisotropy(),
    )
    this.braceletView = new BraceletView(this.runtime)
    this.planeGeometry = new this.runtime.THREE.PlaneGeometry(1, 1)
    this.hitGeometry = new this.runtime.THREE.SphereGeometry(1, 12, 12)
  }

  resize(logicalWidth: number, logicalHeight: number, pixelRatio: number): void {
    this.runtime.resize(logicalWidth, logicalHeight, pixelRatio)
  }

  preloadImages(sources: string[]): Promise<void> {
    return this.textureCache.preload(sources)
  }

  orbit(deltaX: number, deltaY: number, hasBeads: boolean): boolean {
    return this.braceletView.orbit(deltaX, deltaY, hasBeads)
  }

  pickBeadUid(x: number, y: number): string | null {
    return this.braceletView.pickBeadUid(x, y, this.planeByUid.values())
  }

  projectToBraceletPlane(x: number, y: number): { x: number; y: number } | null {
    return this.braceletView.projectToLocalScreen(x, y)
  }

  resetView(): void {
    this.braceletView.reset()
  }

  render(
    beads: DiyBead[],
    displayScale = 1,
    activeBeadUid: string | null = null,
    centerX = 0,
    centerY = 0,
  ): void {
    if (this.destroyed) return
    this.braceletView.setCenter(centerX, centerY)
    if (beads.length === 0) this.braceletView.reset()
    const nextUids = new Set(beads.map((bead) => bead.uid))
    this.planeByUid.forEach((plane, uid) => {
      if (nextUids.has(uid)) return
      this.braceletView.remove(plane)
      plane.dispose()
      this.planeByUid.delete(uid)
    })

    let ringRadiusTotal = 0
    let contentRadius = 1
    let maximumBeadRadius = 1
    for (let index = 0; index < beads.length; index += 1) {
      const bead = beads[index]
      let plane = this.planeByUid.get(bead.uid)
      if (!plane) {
        plane = new PhotoBeadPlane(
          this.runtime.THREE,
          this.planeGeometry,
          this.hitGeometry,
          this.textureCache,
        )
        this.planeByUid.set(bead.uid, plane)
        this.braceletView.add(plane)
      }
      const renderOrder = bead.uid === activeBeadUid ? 1000 : 10
      const size = plane.sync(bead, displayScale, renderOrder, centerX, centerY)
      const localX = bead.x - centerX
      const localY = centerY - bead.y
      const distance = Math.sqrt(localX * localX + localY * localY)
      const visualRadius = Math.sqrt(size.width * size.width + size.height * size.height) / 2
      ringRadiusTotal += distance
      maximumBeadRadius = Math.max(maximumBeadRadius, visualRadius)
      contentRadius = Math.max(contentRadius, distance + visualRadius)
    }
    const ringRadius = beads.length >= 2 ? ringRadiusTotal / beads.length : 0
    this.braceletView.syncStage(ringRadius, contentRadius, maximumBeadRadius)
    this.braceletView.updateBillboards(this.planeByUid.values())
    this.runtime.render()
  }

  clear(): void {
    this.runtime.clear()
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.planeByUid.forEach((plane) => {
      this.braceletView.remove(plane)
      plane.dispose()
    })
    this.planeByUid.clear()
    this.planeGeometry.dispose?.()
    this.hitGeometry.dispose?.()
    this.textureCache.destroy()
    this.braceletView.destroy()
    this.runtime.destroy()
  }
}
