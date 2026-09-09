import type { DesignPreviewMaterial, DesignSection, DesignWork } from '@/api/design/types'

export interface CartSelectedOptions {
  productionMethod: string
  packaging: string
  ropeColor: string
  expressMethod: string
  greetingCard: string
}

export interface CartProductOption {
  optionCode: string
  title: string
  subtitle: string
  amountCents: number
  freeThresholdCents?: number
  imageUrl?: string
}

export interface CartProductOptionGroup {
  groupCode: keyof CartSelectedOptions
  title: string
  options: CartProductOption[]
}

export type CartItemType = 'diy_design' | 'mall_product'

export interface CartItem {
  id: string
  itemType: CartItemType
  refId: string
  section: DesignSection
  name: string
  subtitle: string
  coverUrl: string
  pattern: string[]
  materialMap: Record<string, DesignPreviewMaterial>
  beadSize: number
  perimeterMm: number
  unitPriceCents: number
  quantity: number
  checked: boolean
  available: boolean
  addedAt: number
}

export interface AddCartDesignInput {
  design: DesignWork
}

export const DEFAULT_CART_SELECTED_OPTIONS: CartSelectedOptions = {
  productionMethod: 'diy',
  packaging: 'normal',
  ropeColor: 'transparent',
  expressMethod: 'yunda',
  greetingCard: 'none',
}

export function createDefaultCartSelectedOptions(
  groups: CartProductOptionGroup[],
  goodsAmountCents = 0,
): CartSelectedOptions {
  const selected = { ...DEFAULT_CART_SELECTED_OPTIONS }
  groups.forEach((group) => {
    const optionCode = selectSmartDefaultOptionCode(group, goodsAmountCents)
    if (optionCode) selected[group.groupCode] = optionCode
  })
  return selected
}

/**
 * 智能默认项：优先选择当前免费的选项；若同时有多个免费项，选择原价最高的一项。
 * 当前没有免费项时选择价格最低的一项，同价时保持后台配置顺序。
 */
function selectSmartDefaultOptionCode(
  group: CartProductOptionGroup,
  goodsAmountCents: number,
): string {
  const goodsAmount = Math.max(0, Math.round(Number(goodsAmountCents) || 0))
  const pricedOptions = group.options.map((option, index) => {
    const amountCents = Math.max(0, Math.round(option.amountCents || 0))
    const thresholdCents = Math.max(0, Math.round(option.freeThresholdCents || 0))
    const effectiveAmountCents = thresholdCents > 0 && goodsAmount >= thresholdCents
      ? 0
      : amountCents
    return { option, index, amountCents, effectiveAmountCents }
  })
  const freeOptions = pricedOptions.filter((item) => item.effectiveAmountCents === 0)
  const candidates = freeOptions.length > 0 ? freeOptions : pricedOptions
  candidates.sort((left, right) => {
    if (freeOptions.length > 0) {
      return right.amountCents - left.amountCents || left.index - right.index
    }
    return left.effectiveAmountCents - right.effectiveAmountCents || left.index - right.index
  })
  return candidates[0]?.option.optionCode || ''
}

/** 把已停用或已删除的选项编码切换到按当前商品金额计算出的智能默认项。 */
export function normalizeCartSelectedOptions(
  selectedOptions: Partial<CartSelectedOptions>,
  groups: CartProductOptionGroup[],
  goodsAmountCents = 0,
): CartSelectedOptions {
  const selected = { ...DEFAULT_CART_SELECTED_OPTIONS, ...selectedOptions }
  groups.forEach((group) => {
    if (group.options.some((option) => option.optionCode === selected[group.groupCode])) return
    const preferred = selectSmartDefaultOptionCode(group, goodsAmountCents)
    if (preferred) selected[group.groupCode] = preferred
  })
  return selected
}
