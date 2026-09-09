import type {
  CheckoutOrder,
  CheckoutPaymentResult,
  CreateCheckoutOrderInput,
} from '@/api/cart/checkout-types'
import {
  createPaymentFlowRunner,
  type PaymentFlowState,
} from '@/pages/cart/order-confirm/payment-flow'
import type { CartItem } from '@/api/cart/types'
import type { CheckoutIntent } from '@/services/checkout-intent'
import { resolveCheckoutItems } from '@/pages/cart/order-confirm/checkout-selection'

const order: CheckoutOrder = {
  id: 'ORDER-TEST',
  orderNo: 'ORDER-NO-TEST',
  payableAmountCents: 1990,
  createdAt: 1,
}

const input = {} as CreateCheckoutOrderInput

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}：期望 ${String(expected)}，实际 ${String(actual)}`)
  }
}

function createError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string }
  error.code = code
  return error
}

async function runOutcome(
  requestPayment: () => Promise<void>,
  queryPayment: () => Promise<CheckoutPaymentResult>,
  maxQueryAttempts = 3,
): Promise<{ outcome: string; states: PaymentFlowState[]; queryCount: number }> {
  const states: PaymentFlowState[] = []
  let queryCount = 0
  const runner = createPaymentFlowRunner({
    createOrder: async () => order,
    requestPayment,
    queryPayment: async () => {
      queryCount += 1
      return queryPayment()
    },
    sleep: async () => undefined,
    onStateChange: (state) => states.push(state),
    maxQueryAttempts,
    queryIntervalMs: 0,
  })
  const result = await runner.submit(input)
  return { outcome: result.outcome, states, queryCount }
}

async function runPaymentFlowTests(): Promise<void> {
  const staleCheckedItem = { id: 'stale', checked: true } as CartItem
  assertEqual(
    resolveCheckoutItems(null, [staleCheckedItem]).length,
    0,
    '没有结算意图时不应回退到购物车旧勾选项',
  )

  const selectedItem = { id: 'selected', checked: false } as CartItem
  const cartIntent: CheckoutIntent = {
    source: 'cart',
    cartItemIds: ['selected'],
    directItems: [],
  }
  const cartSelection = resolveCheckoutItems(cartIntent, [staleCheckedItem, selectedItem])
  assertEqual(cartSelection.length, 1, '购物车结算只应使用当次意图中的商品')
  assertEqual(cartSelection[0]?.checked, true, '结算商品应强制设为选中')

  const directItem = { id: 'buy-now', checked: false } as CartItem
  const buyNowIntent: CheckoutIntent = {
    source: 'buy_now',
    cartItemIds: [],
    directItems: [directItem],
  }
  const directSelection = resolveCheckoutItems(buyNowIntent, [staleCheckedItem])
  assertEqual(directSelection[0]?.id, 'buy-now', '立即购买不应被购物车旧数据覆盖')
  assertEqual(directSelection[0]?.checked, true, '立即购买商品应强制设为选中')

  const success = await runOutcome(
    async () => undefined,
    async () => ({ state: 'paid', orderNo: order.orderNo }),
  )
  assertEqual(success.outcome, 'success', '支付成功应返回 success')
  assertEqual(success.states.join(','), 'creating_order,invoking_payment,confirming_payment,success', '成功状态顺序应完整')

  const orderFailureStates: PaymentFlowState[] = []
  let paymentRequestCount = 0
  const orderFailureRunner = createPaymentFlowRunner({
    createOrder: async () => Promise.reject(createError('REQUEST_FAILED', '设计不存在')),
    requestPayment: async () => {
      paymentRequestCount += 1
    },
    queryPayment: async () => ({ state: 'pending', orderNo: order.orderNo }),
    sleep: async () => undefined,
    onStateChange: (state) => orderFailureStates.push(state),
    maxQueryAttempts: 1,
    queryIntervalMs: 0,
  })
  const orderFailure = await orderFailureRunner.submit(input)
  assertEqual(orderFailure.outcome, 'order_failed', '订单创建失败应返回独立状态')
  assertEqual(orderFailure.order, null, '订单创建失败时不应伪造待付款订单')
  assertEqual(orderFailure.message, '设计不存在', '订单创建失败应保留后端业务原因')
  assertEqual(paymentRequestCount, 0, '订单创建失败时不得拉起微信支付')
  assertEqual(
    orderFailureStates.join(','),
    'creating_order,order_failed',
    '订单创建失败不应进入支付阶段',
  )

  const cancelled = await runOutcome(
    async () => Promise.reject(createError('REQUEST_PAYMENT_CANCELLED', 'cancel')),
    async () => ({ state: 'pending', orderNo: order.orderNo }),
  )
  assertEqual(cancelled.outcome, 'cancelled', '用户取消应独立返回 cancelled')
  assertEqual(cancelled.queryCount, 1, '取消后仍应向后端复查一次支付结果')
  assertEqual(cancelled.states.join(','), 'creating_order,invoking_payment,confirming_payment,cancelled', '取消时应先复查后端状态')

  const failed = await runOutcome(
    async () => Promise.reject(createError('REQUEST_PAYMENT_FAILED', 'failed')),
    async () => ({ state: 'pending', orderNo: order.orderNo }),
  )
  assertEqual(failed.outcome, 'failed', '拉起失败应返回 failed')

  const timedOut = await runOutcome(
    async () => undefined,
    async () => ({ state: 'pending', orderNo: order.orderNo }),
    3,
  )
  assertEqual(timedOut.outcome, 'timeout', '连续待支付应返回 timeout')
  assertEqual(timedOut.queryCount, 3, '超时应执行约定次数的查询')

  let createCount = 0
  let releaseCreate: (value: CheckoutOrder) => void = () => undefined
  const createPromise = new Promise<CheckoutOrder>((resolve) => {
    releaseCreate = resolve
  })
  const duplicateRunner = createPaymentFlowRunner({
    createOrder: async () => {
      createCount += 1
      return createPromise
    },
    requestPayment: async () => undefined,
    queryPayment: async () => ({ state: 'paid', orderNo: order.orderNo }),
    sleep: async () => undefined,
    onStateChange: () => undefined,
    maxQueryAttempts: 1,
    queryIntervalMs: 0,
  })
  const firstTask = duplicateRunner.submit(input)
  const secondTask = duplicateRunner.submit(input)
  assertEqual(firstTask, secondTask, '重复点击应复用同一个进行中任务')
  assertEqual(createCount, 1, '重复点击只能创建一次订单')
  releaseCreate(order)
  await Promise.all([firstTask, secondTask])
}

void runPaymentFlowTests().then(() => {
  console.log('payment-flow: 20 assertions passed')
})
