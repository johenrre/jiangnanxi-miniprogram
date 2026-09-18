export interface StringingGeometryInput {
  sizeMm: number
  stringingWidthMm: number | null
}

export interface MaterialRenderGeometryInput extends StringingGeometryInput {
  stringingPosition: 'center' | 'top'
  isIrregular: boolean
  imageScale: number
}

export interface MaterialIntrinsicSize {
  width: number
  height: number
}

export interface MaterialRenderMetrics {
  width: number
  height: number
  anchorX: number
  anchorY: number
}

function positiveNumber(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

export function getStringingWidthMm(material: StringingGeometryInput): number {
  return positiveNumber(material.stringingWidthMm) || positiveNumber(material.sizeMm)
}

export function getMaterialRenderWidthMm(material: MaterialRenderGeometryInput): number {
  const sizeMm = positiveNumber(material.sizeMm)
  const baseWidth = material.isIrregular && material.stringingPosition === 'center'
    ? getStringingWidthMm(material)
    : sizeMm || getStringingWidthMm(material)
  return baseWidth * (positiveNumber(material.imageScale) || 1)
}

export function getMaterialRenderMetrics(
  material: MaterialRenderGeometryInput,
  intrinsicSize: MaterialIntrinsicSize | null,
  pixelsPerMm = 1,
  displayScale = 1,
): MaterialRenderMetrics {
  const safePixelsPerMm = positiveNumber(pixelsPerMm) || 1
  const safeDisplayScale = positiveNumber(displayScale) || 1
  const width = getMaterialRenderWidthMm(material) * safePixelsPerMm * safeDisplayScale
  const intrinsicWidth = positiveNumber(intrinsicSize?.width)
  const intrinsicHeight = positiveNumber(intrinsicSize?.height)
  const aspectRatio = intrinsicWidth > 0 && intrinsicHeight > 0
    ? intrinsicHeight / intrinsicWidth
    : 1
  const height = width * aspectRatio
  const stringingWidth = getStringingWidthMm(material) * safePixelsPerMm * safeDisplayScale

  return {
    width,
    height,
    anchorX: width / 2,
    anchorY: material.stringingPosition === 'top'
      ? stringingWidth / 2
      : height / 2,
  }
}
