import type { DiyBead, RingTarget } from '@/pages/diy/model/types'
import { getInwardFacingRotation } from '@/utils/bracelet-orientation'
import {
  getStringingWidthMm,
  type StringingGeometryInput,
} from '@/utils/material-render-geometry'

const FULL_CIRCLE = Math.PI * 2

export const MINIMUM_STRING_BEADS = 2
export const PIXELS_PER_MM = 2.836
export const EDITOR_TRAY_INSET_PX = 8

export interface FittedRingScales {
  radiusScale: number
  displayScale: number
}

export interface RecommendedWristRange {
  minimumCm: number
  maximumCm: number
}

export type StringingSizedMaterial = StringingGeometryInput

export function getEditorTrayRadius(width: number, height: number): number {
  return Math.max(0, Math.min(width, height) / 2 - EDITOR_TRAY_INSET_PX)
}

export function getBeadFootprintMm(bead: StringingSizedMaterial): number {
  return getStringingWidthMm(bead)
}

export function calculatePerimeterMm(beads: StringingSizedMaterial[]): number {
  return beads.reduce((total, bead) => total + getBeadFootprintMm(bead), 0)
}

export function calculateTotalPrice(beads: DiyBead[]): number {
  return beads.reduce((total, bead) => total + bead.price, 0)
}

export function calculateRecommendedWristRange(
  beads: StringingSizedMaterial[],
): RecommendedWristRange | null {
  if (beads.length === 0) return null

  const stringingWidthsMm = beads.map(getStringingWidthMm)
  const totalStringingWidthMm = stringingWidthsMm.reduce((total, width) => total + width, 0)
  if (totalStringingWidthMm <= 0) return null

  const averageStringingWidthMm = totalStringingWidthMm / beads.length
  const innerPerimeterMm = totalStringingWidthMm - Math.PI * averageStringingWidthMm
  const minimumWristMm = Math.max(0, innerPerimeterMm - 10)
  const maximumWristMm = Math.max(
    0,
    innerPerimeterMm - Math.PI * averageStringingWidthMm / beads.length,
  )
  if (maximumWristMm <= 0) return null

  return {
    minimumCm: Math.round(minimumWristMm) / 10,
    maximumCm: Math.round(maximumWristMm) / 10,
  }
}

export function fitRingScalesToOuterRadius(
  beads: DiyBead[],
  maximumOuterRadius: number,
  preferredRadiusScale: number,
  preferredDisplayScale: number,
  clearanceRatio = 1.02,
): FittedRingScales {
  const perimeterMm = calculatePerimeterMm(beads)
  const naturalRadius = perimeterMm > 0
    ? perimeterMm / FULL_CIRCLE * PIXELS_PER_MM
    : 0
  if (naturalRadius <= 0) {
    return {
      radiusScale: Math.max(0.1, preferredRadiusScale),
      displayScale: Math.max(0.1, preferredDisplayScale),
    }
  }

  const stringingCircles: Array<{ angle: number; radius: number }> = []
  let accumulatedAngle = 0
  beads.forEach((bead) => {
    const footprintMm = getBeadFootprintMm(bead)
    if (footprintMm <= 0) return
    const angleSpan = footprintMm / perimeterMm * FULL_CIRCLE
    stringingCircles.push({
      angle: accumulatedAngle + angleSpan / 2,
      radius: footprintMm * PIXELS_PER_MM / 2,
    })
    accumulatedAngle += angleSpan
  })

  const largestStringingRadius = stringingCircles.reduce((largest, circle) => (
    Math.max(largest, circle.radius)
  ), 0)
  let minimumRingRadius = 0
  if (stringingCircles.length > 1) {
    for (let leftIndex = 0; leftIndex < stringingCircles.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < stringingCircles.length;
        rightIndex += 1
      ) {
        const leftCircle = stringingCircles[leftIndex]
        const rightCircle = stringingCircles[rightIndex]
        const rawAngleDelta = Math.abs(rightCircle.angle - leftCircle.angle)
        const angleDelta = Math.min(rawAngleDelta, FULL_CIRCLE - rawAngleDelta)
        const halfAngle = Math.max(0.0001, angleDelta / 2)
        const requiredRadius = (leftCircle.radius + rightCircle.radius)
          * Math.max(1, clearanceRatio) / (2 * Math.sin(halfAngle))
        minimumRingRadius = Math.max(minimumRingRadius, requiredRadius)
      }
    }
  }

  const safeOuterRadius = Math.max(1, maximumOuterRadius)
  const requiredOuterRadiusAtUnitScale = minimumRingRadius + largestStringingRadius
  const maximumDisplayScale = requiredOuterRadiusAtUnitScale > 0
    ? safeOuterRadius / requiredOuterRadiusAtUnitScale
    : preferredDisplayScale
  const displayScale = Math.max(
    0.1,
    Math.min(Math.max(0.1, preferredDisplayScale), maximumDisplayScale),
  )
  const maximumRingRadius = Math.max(0, safeOuterRadius - largestStringingRadius * displayScale)
  const preferredRingRadius = naturalRadius * Math.max(0.1, preferredRadiusScale)
  const fittedRingRadius = Math.min(
    maximumRingRadius,
    Math.max(minimumRingRadius * displayScale, preferredRingRadius),
  )

  return {
    radiusScale: Math.max(0.1, fittedRingRadius / naturalRadius),
    displayScale,
  }
}

export function easeOutCubic(progress: number): number {
  const clampedProgress = Math.min(1, Math.max(0, progress))
  return 1 - Math.pow(1 - clampedProgress, 3)
}

export function buildRingTargets(
  beads: DiyBead[],
  centerX: number,
  centerY: number,
  rotationOffset = 0,
  radiusScale = 1,
  displayScale = 1,
): RingTarget[] {
  if (beads.length === 0) return []

  const perimeterMm = calculatePerimeterMm(beads)
  const fallbackSpan = FULL_CIRCLE / Math.max(1, beads.length)
  const radius = perimeterMm > 0
    ? perimeterMm / FULL_CIRCLE * PIXELS_PER_MM * Math.max(0.1, radiusScale)
    : 0
  let accumulatedAngle = -Math.PI / 2 + rotationOffset

  return beads.map((bead) => {
    const footprintMm = getBeadFootprintMm(bead)
    const angleSpan = perimeterMm > 0
      ? footprintMm / perimeterMm * FULL_CIRCLE
      : fallbackSpan
    const angle = accumulatedAngle + angleSpan / 2
    accumulatedAngle += angleSpan
    const stringingOffsetMm = Number(bead.stringingOffsetMm)
    const radialOffsetPx = Number.isFinite(stringingOffsetMm)
      ? stringingOffsetMm * PIXELS_PER_MM * Math.max(0.1, displayScale)
      : 0
    const beadRadius = Math.max(0, radius + radialOffsetPx)

    return {
      uid: bead.uid,
      x: centerX + Math.cos(angle) * beadRadius,
      y: centerY + Math.sin(angle) * beadRadius,
      rotation: getInwardFacingRotation(angle),
      angle,
    }
  })
}

export function applyRingLayout(
  beads: DiyBead[],
  centerX: number,
  centerY: number,
  rotationOffset = 0,
  radiusScale = 1,
  displayScale = 1,
): void {
  if (beads.length === 0) return

  const perimeterMm = calculatePerimeterMm(beads)
  const fallbackSpan = FULL_CIRCLE / Math.max(1, beads.length)
  const radius = perimeterMm > 0
    ? perimeterMm / FULL_CIRCLE * PIXELS_PER_MM * Math.max(0.1, radiusScale)
    : 0
  let accumulatedAngle = -Math.PI / 2 + rotationOffset

  for (let index = 0; index < beads.length; index += 1) {
    const bead = beads[index]
    const footprintMm = getBeadFootprintMm(bead)
    const angleSpan = perimeterMm > 0
      ? footprintMm / perimeterMm * FULL_CIRCLE
      : fallbackSpan
    const angle = accumulatedAngle + angleSpan / 2
    accumulatedAngle += angleSpan
    const stringingOffsetMm = Number(bead.stringingOffsetMm)
    const radialOffsetPx = Number.isFinite(stringingOffsetMm)
      ? stringingOffsetMm * PIXELS_PER_MM * Math.max(0.1, displayScale)
      : 0
    const beadRadius = Math.max(0, radius + radialOffsetPx)
    bead.x = centerX + Math.cos(angle) * beadRadius
    bead.y = centerY + Math.sin(angle) * beadRadius
    bead.rotation = getInwardFacingRotation(angle)
  }
}

export function findRingInsertionIndexForBeads(
  pointX: number,
  pointY: number,
  centerX: number,
  centerY: number,
  beads: DiyBead[],
  rotationOffset = 0,
  excludedUid: string | null = null,
): number {
  let candidateCount = 0
  for (let index = 0; index < beads.length; index += 1) {
    if (beads[index].uid !== excludedUid) candidateCount += 1
  }
  if (candidateCount === 0) return 0

  const pointAngle = Math.atan2(pointY - centerY, pointX - centerX)
  let perimeterMm = 0
  for (let index = 0; index < beads.length; index += 1) {
    if (beads[index].uid !== excludedUid) {
      perimeterMm += getBeadFootprintMm(beads[index])
    }
  }
  const fallbackSpan = FULL_CIRCLE / candidateCount
  let accumulatedAngle = -Math.PI / 2 + rotationOffset
  let nearestIndex = 0
  let nearestDistance = Number.POSITIVE_INFINITY
  let candidateIndex = 0

  for (let index = 0; index < beads.length; index += 1) {
    const bead = beads[index]
    if (bead.uid === excludedUid) continue
    const angleSpan = perimeterMm > 0
      ? getBeadFootprintMm(bead) / perimeterMm * FULL_CIRCLE
      : fallbackSpan
    const angle = accumulatedAngle + angleSpan / 2
    accumulatedAngle += angleSpan
    let angularDelta = pointAngle - angle
    while (angularDelta > Math.PI) angularDelta -= FULL_CIRCLE
    while (angularDelta < -Math.PI) angularDelta += FULL_CIRCLE
    const wrappedDistance = Math.abs(angularDelta)
    if (wrappedDistance < nearestDistance) {
      nearestDistance = wrappedDistance
      nearestIndex = candidateIndex
    }
    candidateIndex += 1
  }

  return nearestIndex
}
