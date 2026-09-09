import type {
  CheckoutOrder,
  CheckoutPaymentResult,
  CreateCheckoutOrderInput,
} from '@/api/cart/checkout-types'

export type PaymentFlowState =
  | 'idle'
  | 'creating_order'
  | 'invoking_payment'
  | 'confirming_payment'
  | 'success'
  | 'cancelled'
  | 'order_failed'
  | 'failed'
  | 'timeout'

export type PaymentFlowOutcome = 'success' | 'cancelled' | 'order_failed' | 'failed' | 'timeout'

export interface PaymentFlowResult {
  outcome: PaymentFlowOutcome
  order: CheckoutOrder | null
  errorCode: string
  message: string
}

interface PaymentFlowDependencies {
  createOrder(input: CreateCheckoutOrderInput): Promise<CheckoutOrder>
  requestPayment(order: CheckoutOrder): Promise<void>
  queryPayment(orderNo: string): Promise<CheckoutPaymentResult>
  sleep(milliseconds: number): Promise<void>
  onStateChange(state: PaymentFlowState): void
  maxQueryAttempts: number
  queryIntervalMs: number
}

export interface PaymentFlowRunner {
  isBusy(): boolean
  submit(
    input: CreateCheckoutOrderInput,
    existingOrder?: CheckoutOrder | null,
  ): Promise<PaymentFlowResult>
}

class PaymentFlowError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'PaymentFlowError'
    this.code = code
  }
}

function readErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return ''
  const source = error as { code?: unknown; message?: unknown; errMsg?: unknown }
  const explicitCode = String(source.code || '').trim()
  if (explicitCode) return explicitCode
  const message = String(source.errMsg || source.message || '').toLowerCase()
  if (message.includes('cancel')) return 'REQUEST_PAYMENT_CANCELLED'
  return ''
}

function readErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === 'object') {
    const source = error as { message?: unknown; errMsg?: unknown }
    const message = String(source.message || source.errMsg || '').trim()
    if (message) return message
  }
  return fallback
}

function mapFailure(error: unknown, order: CheckoutOrder | null): PaymentFlowResult {
  const errorCode = readErrorCode(error)
  if (!order) {
    return {
      outcome: 'order_failed',
      order: null,
      errorCode: errorCode || 'ORDER_CREATE_FAILED',
      message: readErrorMessage(error, '订单创建失败，请稍后重试。'),
    }
  }
  if (errorCode === 'REQUEST_PAYMENT_CANCELLED') {
    return {
      outcome: 'cancelled',
      order,
      errorCode,
      message: '你已取消支付，订单仍保留为待支付。',
    }
  }
  if (errorCode === 'PAYMENT_RESULT_CONFIRM_TIMEOUT') {
    return {
      outcome: 'timeout',
      order,
      errorCode,
      message: '支付结果确认超时，请稍后在订单列表核对状态。',
    }
  }
  if (errorCode === 'REQUEST_PAYMENT_FAILED') {
    return {
      outcome: 'failed',
      order,
      errorCode,
      message: '微信支付拉起失败，请稍后重试。',
    }
  }
  return {
    outcome: 'failed',
    order,
    errorCode: errorCode || 'REQUEST_PAYMENT_FAILED',
    message: readErrorMessage(error, '支付未完成，请稍后重试。'),
  }
}

async function runPaymentFlow(
  input: CreateCheckoutOrderInput,
  dependencies: PaymentFlowDependencies,
  existingOrder: CheckoutOrder | null,
): Promise<PaymentFlowResult> {
  let order: CheckoutOrder | null = existingOrder
  try {
    if (!order) {
      dependencies.onStateChange('creating_order')
      order = await dependencies.createOrder(input)
    }

    dependencies.onStateChange('invoking_payment')
    let invocationError: unknown = null
    try {
      await dependencies.requestPayment(order)
    } catch (error) {
      invocationError = error
    }

    dependencies.onStateChange('confirming_payment')
    // 即使 wx.requestPayment 返回取消或失败，也至少向后端查一次。
    // 前端回调不代表资金最终状态，支付成功只能以后端/微信查单结果为准。
    const maxAttempts = invocationError
      ? 1
      : Math.max(1, Math.floor(dependencies.maxQueryAttempts))
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const paymentResult = await dependencies.queryPayment(order.orderNo)
      if (paymentResult.state === 'paid') {
        dependencies.onStateChange('success')
        return {
          outcome: 'success',
          order,
          errorCode: '',
          message: '支付成功，订单状态已确认。',
        }
      }
      if (paymentResult.state === 'closed') {
        throw new PaymentFlowError('REQUEST_PAYMENT_FAILED', '订单支付已关闭。')
      }
      if (invocationError) throw invocationError
      if (attempt < maxAttempts - 1) {
        await dependencies.sleep(dependencies.queryIntervalMs)
      }
    }
    if (invocationError) throw invocationError
    throw new PaymentFlowError(
      'PAYMENT_RESULT_CONFIRM_TIMEOUT',
      '支付结果确认超时',
    )
  } catch (error) {
    const result = mapFailure(error, order)
    dependencies.onStateChange(result.outcome)
    return result
  }
}

export function createPaymentFlowRunner(
  dependencies: PaymentFlowDependencies,
): PaymentFlowRunner {
  let activeTask: Promise<PaymentFlowResult> | null = null
  return {
    isBusy() {
      return activeTask !== null
    },

    submit(input, existingOrder = null) {
      if (activeTask) return activeTask
      const task = runPaymentFlow(input, dependencies, existingOrder)
      activeTask = task
      void task.finally(() => {
        if (activeTask === task) activeTask = null
      })
      return task
    },
  }
}
