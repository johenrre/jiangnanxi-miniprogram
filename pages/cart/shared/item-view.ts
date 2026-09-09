import type { CartItem, DesignPreviewMaterial } from '@/api/index'
import { calculateRecommendedWristRange } from '@/pages/diy/engine/geometry'
import { resolveCanvasImageUrl } from '@/utils/material-image'

export interface CartMaterialBreakdownItem {
  id: string
  name: string
  imageUrl: string
  sizeText: string
  unitPriceText: string
  quantity: number
  subtotalText: string
}

function resolveMaterial(
  materialId: string,
  materialMap: Record<string, DesignPreviewMaterial>,
): DesignPreviewMaterial | null {
  return materialMap[materialId]
    || materialMap[`dynamic_${materialId}`]
    || null
}

function formatYuan(amount: unknown): string {
  return Math.max(0, Number(amount) || 0).toFixed(2)
}

function formatSize(sizeMm: unknown): string {
  const size = Math.max(0, Number(sizeMm) || 0)
  if (size <= 0) return '待确认'
  return `${Number.isInteger(size) ? size.toFixed(0) : size.toFixed(1)}mm`
}

export function buildCartWristRangeText(item: CartItem): string {
  const stringingMaterials = item.pattern.map((materialId) => {
    const material = resolveMaterial(materialId, item.materialMap)
    return {
      sizeMm: material?.size || item.beadSize,
      stringingWidthMm: material?.stringingWidthMm ?? null,
    }
  })
  const range = calculateRecommendedWristRange(stringingMaterials)
  return range
    ? `${range.minimumCm.toFixed(1)}–${range.maximumCm.toFixed(1)} cm`
    : '待确认'
}

export function buildCartMaterialBreakdown(item: CartItem): CartMaterialBreakdownItem[] {
  const counts = new Map<string, number>()
  item.pattern.forEach((materialId) => {
    counts.set(materialId, (counts.get(materialId) || 0) + 1)
  })

  return [...counts.entries()].map(([materialId, quantity]) => {
    const material = resolveMaterial(materialId, item.materialMap)
    const unitPrice = Math.max(0, Number(material?.price) || 0)
    return {
      id: materialId,
      name: material?.name || '未知珠材',
      imageUrl: material
        ? resolveCanvasImageUrl({
          imageUrl: material.imageUrl,
          canvasImageUrl: material.canvasImageUrl,
        })
        : '',
      sizeText: formatSize(material?.size),
      unitPriceText: formatYuan(unitPrice),
      quantity,
      subtotalText: formatYuan(unitPrice * quantity),
    }
  })
}
