import type {
  CartItem,
  CartProductOptionGroup,
  CartSelectedOptions,
} from '@/api/cart/types'

export interface CartLineAmount {
  baseAmountCents: number
  optionAmountCents: number
  unitPayableCents: number
  lineTotalCents: number
}

export interface CartSummary {
  selectedLineCount: number
  selectedQuantity: number
  goodsAmountCents: number
  optionAmountCents: number
  freightAmountCents: number
  payableAmountCents: number
}

export function clampCartQuantity(quantity: unknown): number {
  const number = Math.floor(Number(quantity))
  if (!Number.isFinite(number)) return 1
  return Math.min(99, Math.max(1, number))
}

export function formatMoneyFromCents(amountCents: unknown): string {
  const cents = Math.max(0, Math.round(Number(amountCents) || 0))
  return (cents / 100).toFixed(2)
}

export function calculateSelectedOptionAmountCents(
  selectedOptions: CartSelectedOptions,
  optionGroups: CartProductOptionGroup[],
  goodsAmountCents = 0,
): number {
  return optionGroups.reduce((totalCents, group) => {
    if (group.groupCode === 'expressMethod') return totalCents
    if (group.groupCode === 'ropeColor' && selectedOptions.productionMethod !== 'assembled') {
      return totalCents
    }
    const selectedCode = selectedOptions[group.groupCode]
    const selectedOption = group.options.find((option) => option.optionCode === selectedCode)
    return totalCents + effectiveCartOptionAmountCents(selectedOption, goodsAmountCents)
  }, 0)
}

export function calculateShippingAmountCents(
  selectedOptions: CartSelectedOptions,
  optionGroups: CartProductOptionGroup[],
  goodsAmountCents = 0,
): number {
  const group = optionGroups.find((item) => item.groupCode === 'expressMethod')
  const selected = group?.options.find(
    (option) => option.optionCode === selectedOptions.expressMethod,
  )
  return effectiveCartOptionAmountCents(selected, goodsAmountCents)
}

export function effectiveCartOptionAmountCents(
  option: CartProductOptionGroup['options'][number] | undefined,
  goodsAmountCents: number,
): number {
  if (!option) return 0
  const threshold = Math.max(0, Math.round(option.freeThresholdCents || 0))
  if (threshold > 0 && goodsAmountCents >= threshold) return 0
  return Math.max(0, Math.round(option.amountCents || 0))
}

export function calculateCartLineAmount(
  item: CartItem,
  _optionGroups: CartProductOptionGroup[] = [],
): CartLineAmount {
  const quantity = clampCartQuantity(item.quantity)
  const baseAmountCents = Math.max(0, Math.round(item.unitPriceCents || 0))
  const optionAmountCents = 0
  const unitPayableCents = baseAmountCents + optionAmountCents
  return {
    baseAmountCents,
    optionAmountCents,
    unitPayableCents,
    lineTotalCents: unitPayableCents * quantity,
  }
}

export function calculateCartSummary(
  items: CartItem[],
  optionGroups: CartProductOptionGroup[] = [],
): CartSummary {
  const selectedItems = items.filter((item) => item.checked)
  const totals = selectedItems.reduce((summary, item) => {
    const quantity = clampCartQuantity(item.quantity)
    const line = calculateCartLineAmount(item, optionGroups)
    summary.selectedQuantity += quantity
    summary.goodsAmountCents += line.baseAmountCents * quantity
    summary.optionAmountCents += line.optionAmountCents * quantity
    return summary
  }, {
    selectedQuantity: 0,
    goodsAmountCents: 0,
    optionAmountCents: 0,
  })
  return {
    selectedLineCount: selectedItems.length,
    selectedQuantity: totals.selectedQuantity,
    goodsAmountCents: totals.goodsAmountCents,
    optionAmountCents: totals.optionAmountCents,
    freightAmountCents: 0,
    payableAmountCents: totals.goodsAmountCents,
  }
}

/**
 * 确认订单阶段计价：制作与绳线仅作用于 DIY，包装按全部商品件数，运费按订单一次。
 * 最终金额仍以后端按同一份后台配置重算的结果为准。
 */
export function calculateCheckoutSummary(
  items: CartItem[],
  optionGroups: CartProductOptionGroup[],
  selectedOptions: CartSelectedOptions,
): CartSummary {
  const selectedItems = items.filter((item) => item.checked && item.available)
  const selectedQuantity = selectedItems.reduce(
    (sum, item) => sum + clampCartQuantity(item.quantity),
    0,
  )
  const diyQuantity = selectedItems.reduce(
    (sum, item) => sum + (item.itemType === 'diy_design' ? clampCartQuantity(item.quantity) : 0),
    0,
  )
  const goodsAmountCents = selectedItems.reduce(
    (sum, item) => sum + Math.max(0, Math.round(item.unitPriceCents || 0)) * clampCartQuantity(item.quantity),
    0,
  )
  const amountOf = (groupCode: keyof CartSelectedOptions): number => {
    const group = optionGroups.find((item) => item.groupCode === groupCode)
    const selected = group?.options.find(
      (option) => option.optionCode === selectedOptions[groupCode],
    )
    return effectiveCartOptionAmountCents(selected, goodsAmountCents)
  }
  const productionAmount = amountOf('productionMethod') * diyQuantity
  const ropeAmount = selectedOptions.productionMethod === 'assembled'
    ? amountOf('ropeColor') * diyQuantity
    : 0
  const packagingAmount = amountOf('packaging') * selectedQuantity
  const greetingCardAmount = amountOf('greetingCard')
  const optionAmountCents = productionAmount + ropeAmount + packagingAmount + greetingCardAmount
  const freightAmountCents = selectedItems.length > 0
    ? calculateShippingAmountCents(selectedOptions, optionGroups, goodsAmountCents)
    : 0
  return {
    selectedLineCount: selectedItems.length,
    selectedQuantity,
    goodsAmountCents,
    optionAmountCents,
    freightAmountCents,
    payableAmountCents: goodsAmountCents + optionAmountCents + freightAmountCents,
  }
}
