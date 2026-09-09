const RECEIPT_COMPONENT_APP_ID = 'wx1183b055aeec94d1'
const PENDING_STORAGE_KEY = 'wechat_order_receipt_pending'
const RESULT_STORAGE_KEY = 'wechat_order_receipt_result'
const RESULT_TTL_MS = 30 * 60 * 1000

export interface WechatReceiptRequest {
  orderId: string
  orderNo: string
  transactionId: string
}

export interface WechatReceiptResult extends WechatReceiptRequest {
  status: 'success' | 'fail' | 'cancel'
  errorMessage: string
  returnedAt: number
}

interface OpenBusinessViewOptions {
  businessType: 'weappOrderConfirm'
  extraData: {
    transaction_id: string
  }
  success?: () => void
  fail?: (result: { errMsg?: string }) => void
}

type WxWithBusinessView = typeof wx & {
  openBusinessView?: (options: OpenBusinessViewOptions) => void
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function textOf(value: unknown): string {
  return String(value ?? '').trim()
}

function readPendingRequest(): WechatReceiptRequest | null {
  const source = recordOf(wx.getStorageSync(PENDING_STORAGE_KEY))
  const orderId = textOf(source.orderId)
  const transactionId = textOf(source.transactionId)
  if (!orderId || !transactionId) return null
  return {
    orderId,
    orderNo: textOf(source.orderNo),
    transactionId,
  }
}

export function captureWechatReceiptResult(
  options: WechatMiniprogram.App.LaunchShowOption,
): void {
  const referrer = options.referrerInfo
  if (!referrer || referrer.appId !== RECEIPT_COMPONENT_APP_ID) return

  const extraData = recordOf(referrer.extraData)
  const status = textOf(extraData.status)
  if (!['success', 'fail', 'cancel'].includes(status)) return

  const pending = readPendingRequest()
  if (!pending) return
  const requestExtraData = recordOf(extraData.req_extradata)
  const returnedTransactionId = textOf(requestExtraData.transaction_id)
  if (returnedTransactionId && returnedTransactionId !== pending.transactionId) return

  const result: WechatReceiptResult = {
    ...pending,
    status: status as WechatReceiptResult['status'],
    errorMessage: textOf(extraData.errormsg),
    returnedAt: Date.now(),
  }
  wx.setStorageSync(RESULT_STORAGE_KEY, result)
  wx.removeStorageSync(PENDING_STORAGE_KEY)
}

export function consumeWechatReceiptResult(orderId = ''): WechatReceiptResult | null {
  const source = recordOf(wx.getStorageSync(RESULT_STORAGE_KEY))
  const returnedAt = Number(source.returnedAt)
  if (!Number.isFinite(returnedAt) || Date.now() - returnedAt > RESULT_TTL_MS) {
    wx.removeStorageSync(RESULT_STORAGE_KEY)
    return null
  }

  const result: WechatReceiptResult = {
    orderId: textOf(source.orderId),
    orderNo: textOf(source.orderNo),
    transactionId: textOf(source.transactionId),
    status: textOf(source.status) as WechatReceiptResult['status'],
    errorMessage: textOf(source.errorMessage),
    returnedAt,
  }
  if (!result.orderId || !result.transactionId || !['success', 'fail', 'cancel'].includes(result.status)) {
    wx.removeStorageSync(RESULT_STORAGE_KEY)
    return null
  }
  if (orderId && result.orderId !== orderId) return null
  wx.removeStorageSync(RESULT_STORAGE_KEY)
  return result
}

export function openWechatReceiptConfirmation(input: WechatReceiptRequest): Promise<void> {
  const request: WechatReceiptRequest = {
    orderId: textOf(input.orderId),
    orderNo: textOf(input.orderNo),
    transactionId: textOf(input.transactionId),
  }
  if (!request.orderId || !request.transactionId) {
    return Promise.reject(new Error('订单缺少微信支付交易号，暂时无法确认收货'))
  }

  const api = (wx as WxWithBusinessView).openBusinessView
  if (!api) {
    return Promise.reject(new Error('当前微信版本不支持确认收货，请升级微信后重试'))
  }

  wx.setStorageSync(PENDING_STORAGE_KEY, request)
  return new Promise((resolve, reject) => {
    api({
      businessType: 'weappOrderConfirm',
      extraData: { transaction_id: request.transactionId },
      success: resolve,
      fail: (result) => {
        wx.removeStorageSync(PENDING_STORAGE_KEY)
        reject(new Error(textOf(result.errMsg) || '微信确认收货组件打开失败'))
      },
    })
  })
}
