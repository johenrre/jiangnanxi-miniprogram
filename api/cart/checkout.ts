import { ApiRequestError, requestApi, toNumber, toText } from '@/api/client'
import type {
  CheckoutOrder,
  CheckoutPaymentParams,
  CheckoutPaymentResult,
  CreateCheckoutOrderInput,
} from '@/api/cart/checkout-types'

interface RawOrder {
  id?: number | string
  order_no?: string
  orderNo?: string
  total_price?: number | string
}

interface RawCreateOrderResult {
  order?: RawOrder
  order_no?: string
  orderNo?: string
}

interface RawPaymentResult {
  paymentParams?: Partial<CheckoutPaymentParams>
  wxPayParams?: Partial<CheckoutPaymentParams>
  payment_params?: Partial<CheckoutPaymentParams>
  prepayId?: string
}

interface RawPaymentQueryResult {
  status?: string
  state?: string
  order?: {
    status?: string
  }
  payment?: {
    status?: string
  }
}

interface BackendOrderPayload extends WechatMiniprogram.IAnyObject {
  checkoutSource: 'cart' | 'buy_now'
  cartItemIds?: string[]
  items?: Array<{
    itemType: 'diy_design' | 'mall_product'
    refId: string
    quantity: number
  }>
  consignee: string
  phone: string
  address: string
  remark: string
  greetingMessage: string
  paymentMethod: string
  productionMethod: string
  packagingMethod: string
  expressMethod: string
  ropeColor: string
  greetingCard: string
  points_used: number
  user_coupon_id: number
  totalPrice: number
  requestId: string
}

function requireText(value: unknown, fieldName: string): string {
  const text = toText(value)
  if (!text) throw new ApiRequestError(`支付参数缺少 ${fieldName}`, 0, 'MISSING_WECHAT_PAY_PARAMS')
  return text
}

function normalizePaymentParams(source: Partial<CheckoutPaymentParams>): CheckoutPaymentParams {
  const requestedSignType = toText(source.signType, 'RSA')
  const signType = requestedSignType === 'MD5' || requestedSignType === 'HMAC-SHA256'
    ? requestedSignType
    : 'RSA'
  return {
    timeStamp: requireText(source.timeStamp, 'timeStamp'),
    nonceStr: requireText(source.nonceStr, 'nonceStr'),
    package: requireText(source.package, 'package'),
    signType,
    paySign: requireText(source.paySign, 'paySign'),
  }
}

export function buildBackendOrderPayload(input: CreateCheckoutOrderInput): BackendOrderPayload {
  const selectedItems = input.items.filter((item) => item.checked)
  if (selectedItems.length === 0) {
    throw new ApiRequestError('没有待结算商品', 0, 'NO_CHECKED_ITEMS')
  }
  if (selectedItems.some((item) => !item.available)) {
    throw new ApiRequestError('结算商品中包含已下架商品', 0, 'CHECKOUT_ITEM_UNAVAILABLE')
  }
  const selectedOptions = input.selectedOptions
  const checkoutSelection = input.checkoutSource === 'cart'
    ? {
      cartItemIds: selectedItems.map((item) => item.id),
    }
    : {
      items: selectedItems.map((item) => ({
        itemType: item.itemType,
        refId: item.refId,
        quantity: item.quantity,
      })),
    }
  return {
    checkoutSource: input.checkoutSource,
    ...checkoutSelection,
    consignee: input.address.receiverName,
    phone: input.address.receiverPhone.replace(/[^0-9]/g, ''),
    address: input.address.fullAddress,
    remark: toText(input.remark),
    greetingMessage: toText(input.greetingMessage),
    paymentMethod: 'wechat',
    productionMethod: selectedOptions.productionMethod,
    packagingMethod: selectedOptions.packaging,
    expressMethod: selectedOptions.expressMethod,
    ropeColor: selectedOptions.ropeColor,
    greetingCard: selectedOptions.greetingCard,
    points_used: 0,
    user_coupon_id: 0,
    totalPrice: input.payableAmountCents / 100,
    requestId: input.requestId,
  }
}

async function createBackendCheckoutOrder(
  input: CreateCheckoutOrderInput,
): Promise<CheckoutOrder> {
  const result = await requestApi<RawCreateOrderResult | RawOrder, BackendOrderPayload>({
    path: '/api/order/create',
    method: 'POST',
    data: buildBackendOrderPayload(input),
    timeout: 30000,
  })
  const wrapper = result as RawCreateOrderResult
  const rawOrder = wrapper.order || result as RawOrder
  const orderId = toText(rawOrder.id)
  const orderNo = toText(wrapper.order_no || wrapper.orderNo || rawOrder.order_no || rawOrder.orderNo)
  if (!orderId || !orderNo) {
    throw new ApiRequestError('创建订单结果不完整', 0, 'ORDER_NO_REQUIRED', result)
  }

  return {
    id: orderId,
    orderNo,
    payableAmountCents: Math.round(
      toNumber(rawOrder.total_price, input.payableAmountCents / 100) * 100,
    ),
    createdAt: Date.now(),
  }
}

function requestWechatPayment(paymentParams: CheckoutPaymentParams): Promise<void> {
  if (typeof wx.requestPayment !== 'function') {
    return Promise.reject(new ApiRequestError(
      '当前环境不支持微信支付',
      0,
      'REQUEST_PAYMENT_NOT_SUPPORTED',
    ))
  }
  return new Promise((resolve, reject) => {
    wx.requestPayment({
      ...paymentParams,
      success() {
        resolve()
      },
      fail(error) {
        const message = toText(error.errMsg, 'requestPayment:fail')
        const code = message.toLowerCase().includes('cancel')
          ? 'REQUEST_PAYMENT_CANCELLED'
          : 'REQUEST_PAYMENT_FAILED'
        reject(new ApiRequestError(message, 0, code, error))
      },
    })
  })
}

function normalizePaymentResult(orderNo: string, result: RawPaymentQueryResult): CheckoutPaymentResult {
  const status = toText(
    result.state || result.status || result.payment?.status || result.order?.status,
  ).toUpperCase()
  if (['PAID', 'SUCCESS', 'SUCCESS_LATE'].includes(status)) {
    return { state: 'paid', orderNo }
  }
  if (['CLOSED', 'REVOKED', 'PAYERROR', 'CLOSED_TIMEOUT', 'CLOSED_BY_USER'].includes(status)) {
    return { state: 'closed', orderNo }
  }
  return { state: 'pending', orderNo }
}

export async function createCheckoutOrder(
  input: CreateCheckoutOrderInput,
): Promise<CheckoutOrder> {
  return createBackendCheckoutOrder(input)
}

export async function requestCheckoutPayment(order: CheckoutOrder): Promise<void> {
  const payment = await requestApi<RawPaymentResult, { orderId: string }>({
    path: '/api/pay/create_wxpay',
    method: 'POST',
    data: { orderId: order.id },
    timeout: 30000,
  })
  return requestWechatPayment(normalizePaymentParams(
    payment.paymentParams || payment.wxPayParams || payment.payment_params || {},
  ))
}

export async function queryCheckoutPayment(orderNo: string): Promise<CheckoutPaymentResult> {
  const result = await requestApi<RawPaymentQueryResult, { out_trade_no: string }>({
    path: '/api/pay/query',
    data: { out_trade_no: orderNo },
    timeout: 12000,
  })
  return normalizePaymentResult(orderNo, result)
}

export async function cancelCheckoutOrder(orderId: string): Promise<void> {
  await requestApi<unknown, { order_id: string }>({
    path: '/api/order/cancel',
    method: 'POST',
    data: { order_id: orderId },
    timeout: 30000,
  })
}
