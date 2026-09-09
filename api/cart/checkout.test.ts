import { buildBackendOrderPayload } from '@/api/cart/checkout'
import type { CreateCheckoutOrderInput } from '@/api/cart/checkout-types'
import {
  DEFAULT_CART_SELECTED_OPTIONS,
  type CartItem,
} from '@/api/cart/types'

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}：期望 ${String(expected)}，实际 ${String(actual)}`)
  }
}

function createItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    id: 'diy_design:d_checkout_contract',
    itemType: 'diy_design',
    refId: 'd_checkout_contract',
    section: 'customer',
    name: '结算契约测试设计',
    subtitle: '',
    coverUrl: '',
    pattern: ['1'],
    materialMap: {},
    beadSize: 8,
    perimeterMm: 160,
    unitPriceCents: 100,
    quantity: 1,
    checked: true,
    available: true,
    addedAt: 1,
    ...overrides,
  }
}

function createInput(
  items: CartItem[],
  checkoutSource: CreateCheckoutOrderInput['checkoutSource'] = 'cart',
): CreateCheckoutOrderInput {
  return {
    checkoutSource,
    address: {
      id: 'ADDRESS-TEST',
      receiverName: '测试用户',
      receiverPhone: '138 0013 8000',
      province: '广东省',
      city: '深圳市',
      district: '南山区',
      detail: '测试路 1 号',
      fullAddress: '广东省深圳市南山区测试路 1 号',
      isDefault: true,
    },
    items,
    optionGroups: [],
    selectedOptions: { ...DEFAULT_CART_SELECTED_OPTIONS },
    payableAmountCents: 100,
    optionAmountCents: 0,
    requestId: 'CHECKOUT-CONTRACT-TEST',
    remark: '',
    greetingMessage: '',
  }
}

function runCheckoutPayloadTests(): void {
  const diyPayload = buildBackendOrderPayload(createInput([createItem()]))
  assertEqual(
    diyPayload.cartItemIds?.[0],
    'diy_design:d_checkout_contract',
    '购物车 DIY 下单必须提交 cartItemId',
  )
  assertEqual(diyPayload.items, undefined, '购物车结算不得提交客户端商品引用')

  const mallPayload = buildBackendOrderPayload(createInput([createItem({
    id: 'mall_product:88',
    itemType: 'mall_product',
    refId: '88',
  })], 'buy_now'))
  assertEqual(mallPayload.items?.[0]?.refId, '88', '商城下单应继续提交 product_id')
  assertEqual(mallPayload.cartItemIds, undefined, '立即购买不得伪造购物车条目')
  assertEqual(mallPayload.phone, '13800138000', '下单手机号应保持原有清洗逻辑')
}

runCheckoutPayloadTests()
console.log('checkout-payload: 5 assertions passed')
