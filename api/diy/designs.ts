import { requestApi, toNumber, toText } from '@/api/client'
import { markCartItemSelected } from '@/api/cart/items'
import { getStringingWidthMm } from '@/utils/material-render-geometry'

export interface DiyDesignBeadInput {
  materialId: string
  sizeMm: number
  stringingWidthMm: number | null
}

interface RawSavedDesign {
  id?: number | string
  design_code?: string
  price?: number | string
}

interface RawSaveResult {
  design?: RawSavedDesign
  design_code?: string
}

export interface SavedDiyDesign {
  id: number
  code: string
  price: number
}

export interface AddedDiyCartItem {
  designCode: string
  price: number
}

function calculatePerimeter(beads: DiyDesignBeadInput[]): number {
  return beads.reduce((sum, bead) => sum + getStringingWidthMm(bead), 0)
}

export async function saveDiyDesign(
  beads: DiyDesignBeadInput[],
  name: string,
): Promise<SavedDiyDesign> {
  if (beads.length === 0) throw new Error('请先添加珠子')
  const designName = String(name || '').trim()
  if (!designName) throw new Error('请输入设计名称')
  const result = await requestApi<RawSaveResult, WechatMiniprogram.IAnyObject>({
    path: '/api/design/save',
    method: 'POST',
    data: {
      name: designName,
      pattern: beads.map((bead) => bead.materialId),
      mode: 'bracelet',
      perimeter: calculatePerimeter(beads),
      bgIndex: 0,
      isPublic: 0,
    },
  })
  const raw = result.design || {}
  const id = Math.floor(toNumber(raw.id))
  const code = toText(result.design_code || raw.design_code)
  if (id <= 0 || !code) throw new Error('设计保存结果不完整')
  return { id, code, price: Math.max(0, toNumber(raw.price)) }
}

export async function addDiyDesignToCart(
  beads: DiyDesignBeadInput[],
): Promise<AddedDiyCartItem> {
  if (beads.length === 0) throw new Error('请先添加珠子')
  const result = await requestApi<RawSavedDesign, WechatMiniprogram.IAnyObject>({
    path: '/api/cart/add',
    method: 'POST',
    data: {
      pattern: beads.map((bead) => bead.materialId),
      perimeter: calculatePerimeter(beads),
      quantity: 1,
    },
  })
  const designCode = toText(result.design_code)
  if (!designCode) throw new Error('购物车返回结果不完整')
  await markCartItemSelected(`diy_design:${designCode}`)
  return {
    designCode,
    price: Math.max(0, toNumber(result.price)),
  }
}
