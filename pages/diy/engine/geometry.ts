import type { DiyBead, RingTarget } from '@/pages/diy/model/types'
import { getInwardFacingRotation } from '@/utils/bracelet-orientation'
import {
  getStringingWidthMm,
  type StringingGeometryInput,
} from '@/utils/material-render-geometry'

const FULL_CIRCLE = Math.PI * 2
const MINIMUM_RING_RADIUS_MM = 11.875

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

function solveRingRadiusMm(distances: number[]): number {
  if (distances.length === 0) return MINIMUM_RING_RADIUS_MM
  const maximumDistance = Math.max(...distances)
  const perimeter = distances.reduce((total, distance) => total + distance, 0)
  let lower = Math.max(maximumDistance / 2 + 0.0001, perimeter / FULL_CIRCLE * 0.85)
  let upper = Math.max(lower * 1.2, perimeter / FULL_CIRCLE * 1.35, maximumDistance)
  const sumAngles = (radius: number) => distances.reduce((total, distance) => (
    total + 2 * Math.asin(Math.min(0.999999, distance / (2 * radius)))
  ), 0)
  for (let guard = 0; guard < 40 && sumAngles(upper) > FULL_CIRCLE; guard += 1) {
    upper *= 1.15
  }
  for (let iteration = 0; iteration < 48; iteration += 1) {
    const middle = (lower + upper) / 2
    if (sumAngles(middle) > FULL_CIRCLE) lower = middle
    else upper = middle
  }
  return Math.max(MINIMUM_RING_RADIUS_MM, (lower + upper) / 2)
}

function buildRingGeometry(beads: DiyBead[]): { radiusMm: number; angles: number[] } {
  if (beads.length === 0) return { radiusMm: MINIMUM_RING_RADIUS_MM, angles: [] }
  if (beads.length === 1) return { radiusMm: MINIMUM_RING_RADIUS_MM, angles: [-Math.PI / 2] }

  const footprints = beads.map(getBeadFootprintMm)
  const distances = beads.map((_bead, index) => {
    const nextIndex = (index + 1) % beads.length
    return Math.max(
      0.5,
      footprints[index] / 2 + footprints[nextIndex] / 2,
    )
  })
  const radiusMm = solveRingRadiusMm(distances)
  const spans = distances.map((distance) => (
    2 * Math.asin(Math.min(0.999999, distance / (2 * radiusMm)))
  ))
  const spanScale = FULL_CIRCLE / Math.max(0.0001, spans.reduce((sum, span) => sum + span, 0))
  const angles = [-Math.PI / 2]
  for (let index = 1; index < beads.length; index += 1) {
    angles.push(angles[index - 1] + spans[index - 1] * spanScale)
  }
  return { radiusMm, angles }
}

export function calculateRingRadiusMm(beads: DiyBead[]): number {
  return buildRingGeometry(beads).radiusMm
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
    ? calculateRingRadiusMm(beads) * PIXELS_PER_MM
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

  const ring = buildRingGeometry(beads)
  const radius = ring.radiusMm * PIXELS_PER_MM * Math.max(0.1, radiusScale)

  return beads.map((bead, index) => {
    const angle = ring.angles[index] + rotationOffset
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
  const targets = buildRingTargets(
    beads,
    centerX,
    centerY,
    rotationOffset,
    radiusScale,
    displayScale,
  )
  for (let index = 0; index < targets.length; index += 1) {
    beads[index].x = targets[index].x
    beads[index].y = targets[index].y
    beads[index].rotation = targets[index].rotation
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
  const candidates = beads.filter((bead) => bead.uid !== excludedUid)
  if (candidates.length === 0) return 0

  const pointAngle = Math.atan2(pointY - centerY, pointX - centerX)
  const ring = buildRingGeometry(candidates)
  let nearestIndex = 0
  let nearestDistance = Number.POSITIVE_INFINITY
  for (let index = 0; index < candidates.length; index += 1) {
    const angle = ring.angles[index] + rotationOffset
    let angularDelta = pointAngle - angle
    while (angularDelta > Math.PI) angularDelta -= FULL_CIRCLE
    while (angularDelta < -Math.PI) angularDelta += FULL_CIRCLE
    const wrappedDistance = Math.abs(angularDelta)
    if (wrappedDistance < nearestDistance) {
      nearestDistance = wrappedDistance
      nearestIndex = index
    }
  }

  return nearestIndex
}
