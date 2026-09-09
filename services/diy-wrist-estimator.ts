export const DIY_HEIGHT_MIN_CM = 120
export const DIY_HEIGHT_MAX_CM = 220
export const DIY_WEIGHT_MIN_KG = 25
export const DIY_WEIGHT_MAX_KG = 150
export const DIY_WRIST_MIN_CM = 13
export const DIY_WRIST_MAX_CM = 21
export const DIY_DEFAULT_HEIGHT_CM = 166
export const DIY_DEFAULT_WEIGHT_KG = 45

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

interface CalibrationPoint {
  input: number
  output: number
}

const WEIGHT_WRIST_POINTS: readonly CalibrationPoint[] = [
  { input: 31, output: 14.4 },
  { input: 40, output: 14.8 },
  { input: 45, output: 14.8 },
  { input: 50, output: 15.4 },
  { input: 60, output: 15.9 },
  { input: 70, output: 16.4 },
  { input: 80, output: 17 },
  { input: 90, output: 17.5 },
  { input: 100, output: 18 },
  { input: 110, output: 18.6 },
  { input: 120, output: 19.1 },
  { input: 130, output: 19.6 },
  { input: 140, output: 20.2 },
] as const

const HEIGHT_CORRECTION_CURVES = [
  { height: 140, points: [{ input: 45, output: -1.1 }] },
  {
    height: 150,
    points: [
      { input: 45, output: -0.5 },
      { input: 60, output: -0.8 },
      { input: 80, output: -0.9 },
      { input: 100, output: -0.8 },
    ],
  },
  {
    height: 160,
    points: [
      { input: 45, output: 0 },
      { input: 60, output: -0.3 },
      { input: 80, output: -0.3 },
      { input: 100, output: -0.3 },
    ],
  },
  { height: 166, points: [{ input: 45, output: 0 }] },
  {
    height: 175,
    points: [
      { input: 60, output: 0.5 },
      { input: 80, output: 0.4 },
      { input: 100, output: 0.5 },
    ],
  },
  {
    height: 185,
    points: [
      { input: 60, output: 1 },
      { input: 80, output: 1 },
      { input: 100, output: 1 },
    ],
  },
] as const

function interpolatePoints(
  points: readonly CalibrationPoint[],
  input: number,
  belowSlope = 0,
  aboveSlope = 0,
): number {
  const firstPoint = points[0]
  const lastPoint = points[points.length - 1]
  if (input <= firstPoint.input) {
    return firstPoint.output + (input - firstPoint.input) * belowSlope
  }
  if (input >= lastPoint.input) {
    return lastPoint.output + (input - lastPoint.input) * aboveSlope
  }

  for (let index = 1; index < points.length; index += 1) {
    const upperPoint = points[index]
    if (input > upperPoint.input) continue
    const lowerPoint = points[index - 1]
    const progress = (input - lowerPoint.input) / (upperPoint.input - lowerPoint.input)
    return lowerPoint.output + (upperPoint.output - lowerPoint.output) * progress
  }

  return lastPoint.output
}

function weightBaseWrist(weightKg: number): number {
  return interpolatePoints(WEIGHT_WRIST_POINTS, weightKg, 0.04, 0.06)
}

function heightAdjustment(heightCm: number, weightKg: number): number {
  const firstCurve = HEIGHT_CORRECTION_CURVES[0]
  const lastCurve = HEIGHT_CORRECTION_CURVES[HEIGHT_CORRECTION_CURVES.length - 1]
  if (heightCm <= firstCurve.height) {
    const correction = interpolatePoints(firstCurve.points, weightKg)
    return correction + (heightCm - firstCurve.height) * 0.06
  }
  if (heightCm >= lastCurve.height) {
    const correction = interpolatePoints(lastCurve.points, weightKg)
    return correction + (heightCm - lastCurve.height) * 0.05
  }

  for (let index = 1; index < HEIGHT_CORRECTION_CURVES.length; index += 1) {
    const upperCurve = HEIGHT_CORRECTION_CURVES[index]
    if (heightCm > upperCurve.height) continue
    const lowerCurve = HEIGHT_CORRECTION_CURVES[index - 1]
    const lowerCorrection = interpolatePoints(lowerCurve.points, weightKg)
    const upperCorrection = interpolatePoints(upperCurve.points, weightKg)
    const progress = (heightCm - lowerCurve.height) / (upperCurve.height - lowerCurve.height)
    return lowerCorrection + (upperCorrection - lowerCorrection) * progress
  }

  return 0
}

/**
 * 基于当前店铺样本的分段估算：身高 160–166cm、体重 40–45kg 为平台区间。
 * 返回净手围，保留 0.1cm；它只是选码起点，用户仍可手动覆盖。
 */
export function estimateWristCm(heightInput: unknown, weightInput: unknown): number {
  const rawHeight = Number(heightInput)
  const rawWeight = Number(weightInput)
  const heightCm = clamp(
    Number.isFinite(rawHeight) ? rawHeight : DIY_DEFAULT_HEIGHT_CM,
    DIY_HEIGHT_MIN_CM,
    DIY_HEIGHT_MAX_CM,
  )
  const weightKg = clamp(
    Number.isFinite(rawWeight) ? rawWeight : DIY_DEFAULT_WEIGHT_KG,
    DIY_WEIGHT_MIN_KG,
    DIY_WEIGHT_MAX_KG,
  )
  const estimated = weightBaseWrist(weightKg) + heightAdjustment(heightCm, weightKg)
  return Math.round(clamp(estimated, DIY_WRIST_MIN_CM, DIY_WRIST_MAX_CM) * 10) / 10
}

export function normalizeWristCm(value: unknown, fallback = 14.8): number {
  const numeric = Number(value)
  const resolved = Number.isFinite(numeric) ? numeric : fallback
  return Math.round(clamp(resolved, DIY_WRIST_MIN_CM, DIY_WRIST_MAX_CM) * 10) / 10
}
