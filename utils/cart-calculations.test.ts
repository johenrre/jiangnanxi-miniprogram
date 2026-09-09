import {
  calculateCartLineAmount,
  calculateCartSummary,
  calculateCheckoutSummary,
  clampCartQuantity,
  formatMoneyFromCents,
} from '@/utils/cart-calculations'
import {
  DEFAULT_CART_SELECTED_OPTIONS,
  type CartItem,
  type CartProductOptionGroup,
} from '@/api/cart/types'

const optionGroups: CartProductOptionGroup[] = [
  {
    groupCode: 'productionMethod',
    title: '制作方式',
    options: [
      { optionCode: 'diy', title: '散珠材料包', subtitle: '', amountCents: 0 },
      { optionCode: 'assembled', title: '工坊串制', subtitle: '', amountCents: 990 },
    ],
  },
  {
    groupCode: 'packaging',
    title: '包装方式',
    options: [
      { optionCode: 'normal', title: '普通包装', subtitle: '', amountCents: 0 },
      { optionCode: 'gift', title: '礼盒包装', subtitle: '', amountCents: 1000 },
    ],
  },
  {
    groupCode: 'ropeColor',
    title: '绳线颜色',
    options: [
      { optionCode: 'transparent', title: '透明弹力线', subtitle: '', amountCents: 0 },
    ],
  },
  {
    groupCode: 'expressMethod',
    title: '配送方式',
    options: [
      { optionCode: 'yunda', title: '韵达快递', subtitle: '', amountCents: 900 },
    ],
  },
]

function createItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    id: 'CART-TEST',
    itemType: 'diy_design',
    refId: 'd_test',
    section: 'designer',
    name: '测试设计',
    subtitle: '',
    coverUrl: '',
    pattern: [],
    materialMap: {},
    beadSize: 11,
    perimeterMm: 0,
    unitPriceCents: 19990,
    quantity: 1,
    checked: true,
    available: true,
    addedAt: 1,
    ...overrides,
  }
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}：期望 ${String(expected)}，实际 ${String(actual)}`)
  }
}

function runCartCalculationTests(): void {
  const optionItem = createItem({
    quantity: 2,
  })
  const line = calculateCartLineAmount(optionItem, optionGroups)
  assertEqual(line.optionAmountCents, 0, '购物车不应计算结算选项')
  assertEqual(line.unitPayableCents, 19990, '购物车单价只包含商品基础价')
  assertEqual(line.lineTotalCents, 39980, '购物车行金额应按基础价乘以数量')

  const cartSummary = calculateCartSummary([
    optionItem,
    createItem({ id: 'UNCHECKED', checked: false, unitPriceCents: 50000 }),
  ], optionGroups)
  assertEqual(cartSummary.selectedLineCount, 1, '汇总只统计已勾选商品')
  assertEqual(cartSummary.selectedQuantity, 2, '汇总数量应累计已勾选件数')
  assertEqual(cartSummary.freightAmountCents, 0, '购物车不应提前计算配送费')
  assertEqual(cartSummary.payableAmountCents, 39980, '购物车应付只展示基础商品金额')

  const checkoutSummary = calculateCheckoutSummary(
    [optionItem],
    optionGroups,
    {
      ...DEFAULT_CART_SELECTED_OPTIONS,
      productionMethod: 'assembled',
      packaging: 'gift',
    },
  )
  assertEqual(checkoutSummary.optionAmountCents, 3980, '制作与包装应按件收取')
  assertEqual(checkoutSummary.freightAmountCents, 900, '配送费应按订单收取一次')
  assertEqual(checkoutSummary.payableAmountCents, 44860, '确认订单应计入选项与一次配送费')
  assertEqual(clampCartQuantity(0), 1, '数量下限应为 1')
  assertEqual(clampCartQuantity(120), 99, '数量上限应为 99')
  assertEqual(formatMoneyFromCents(44860), '448.60', '金额展示应保留两位小数')
}

runCartCalculationTests()
