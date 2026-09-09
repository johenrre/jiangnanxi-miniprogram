import { requestApi, resolveMediaUrl, toNumber, toText, uploadFileApi } from '@/api/client'
import { API_BASE_URL } from '@/api/config'
import { normalizeDesign } from '@/api/design/normalizer'
import type { DesignPreviewMaterial, RawDesign } from '@/api/design/types'

export type OrderFilter = 'all' | 'pending' | 'paid' | 'shipped' | 'completed' | 'refund'

interface RawOrderItem {
  item_type?: string
  itemType?: string
  ref_id?: string | number
  refId?: string | number
  source_code?: string
  sourceCode?: string
  title?: string
  cover_image?: string
  coverImage?: string
  unit_price?: number | string
  unitPrice?: number | string
  quantity?: number | string
  line_total?: number | string
  lineTotal?: number | string
  design_snapshot?: RawDesign
  designSnapshot?: RawDesign
}

interface RawCheckoutOptionSnapshot {
  groupCode?: string
  group_code?: string
  groupTitle?: string
  group_title?: string
  optionCode?: string
  option_code?: string
  optionTitle?: string
  option_title?: string
  amount?: number | string
}

interface RawOrder {
  id?: number | string
  order_no?: string
  orderNo?: string
  status?: string
  total_price?: number | string
  amount?: number | string
  original_total_price?: number | string
  originalTotalPrice?: number | string
  extra_fee?: number | string
  extraFee?: number | string
  quantity?: number | string
  design_name?: string
  cover_image?: string
  preview_url?: string
  snapshot_url?: string
  items?: RawOrderItem[]
  item_count?: number | string
  itemCount?: number | string
  created_at?: string
  createdAt?: string
  pay_time?: string
  payTime?: string
  paid_time?: string
  paidTime?: string
  receive_time?: string
  receiveTime?: string
  pay_type?: string
  payType?: string
  remark?: string
  greeting_message?: string
  greetingMessage?: string
  checkout_options_snapshot?: RawCheckoutOptionSnapshot[]
  checkoutOptionsSnapshot?: RawCheckoutOptionSnapshot[]
  consignee?: string
  phone?: string
  address?: string
  express_company?: string
  expressCompany?: string
  express_code?: string
  expressCode?: string
  express_no?: string
  expressNo?: string
  ship_time?: string
  shipTime?: string
  wechat_shipping_status?: string
  wechatShippingStatus?: string
  wechat_shipping_synced_at?: string
  wechatShippingSyncedAt?: string
  trade_no?: string
  tradeNo?: string
  refund_status?: string
  refundStatus?: string
  refund_reason?: string
  refundReason?: string
  refund_type?: string
  refundType?: string
  refund_description?: string
  refundDescription?: string
  refund_contact_name?: string
  refundContactName?: string
  refund_contact_phone?: string
  refundContactPhone?: string
  refund_contact_address?: string
  refundContactAddress?: string
  refund_evidence?: unknown[]
  refundEvidence?: unknown[]
  refund_return_address?: string
  refundReturnAddress?: string
  refund_return_express_company?: string
  refundReturnExpressCompany?: string
  refund_return_express_code?: string
  refundReturnExpressCode?: string
  refund_return_express_no?: string
  refundReturnExpressNo?: string
  refund_return_shipped_at?: string
  refundReturnShippedAt?: string
  refund_admin_remark?: string
  refundAdminRemark?: string
}

interface RawOrderList {
  list?: RawOrder[]
  items?: RawOrder[]
  data?: RawOrder[]
  total?: number | string
  page?: number | string
  pageSize?: number | string
  page_size?: number | string
}

export interface OrderItem {
  id: string
  orderNo: string
  rawStatus: string
  statusLabel: string
  title: string
  amountText: string
  amountCents: number
  coverUrl: string
  pattern: string[]
  materialMap: Record<string, DesignPreviewMaterial>
  beadSize: number
  itemCount: number
  createdAtText: string
  receiverText: string
  receiverName: string
  receiverPhone: string
  addressText: string
  expressCompany: string
  expressCode: string
  expressNo: string
  shipTimeText: string
  wechatShippingStatus: string
  wechatShippingSyncedAt: string
  tradeNo: string
  hasLogistics: boolean
  refundStatus: string
  afterSaleStatusLabel: string
  refundReason: string
  refundType: string
  refundTypeLabel: string
  refundDescription: string
  refundContactText: string
  refundContactAddress: string
  refundEvidenceUrls: string[]
  refundReturnAddress: string
  refundReturnExpressCompany: string
  refundReturnExpressCode: string
  refundReturnExpressNo: string
  refundReturnShippedAt: string
  refundAdminRemark: string
  canApplyAfterSale: boolean
  canReapplyAfterSale: boolean
  isAfterSale: boolean
  canPay: boolean
  canCancel: boolean
  canSubmitReturnShipment: boolean
  canConfirmReceipt: boolean
}

export interface OrderPage {
  items: OrderItem[]
  total: number
  page: number
  pageSize: number
}

const STATUS_LABELS: Record<string, string> = {
  pending: '待付款',
  pending_pay: '待付款',
  unpaid: '待付款',
  paid: '待发货',
  processing: '制作中',
  pending_ship: '待发货',
  shipped: '待收货',
  completed: '已完成',
  complete: '已完成',
  cancelled: '已取消',
  canceled: '已取消',
  refund: '售后中',
  refunding: '退款中',
  refunded: '已退款',
  after_sale: '售后中',
}

export interface OrderDetailLine {
  key: string
  itemType: string
  title: string
  coverUrl: string
  unitPriceText: string
  lineTotalText: string
  quantity: number
  pattern: string[]
  materialMap: Record<string, DesignPreviewMaterial>
  beadSize: number
  isDiy: boolean
  imageFailed: boolean
}

export interface OrderCheckoutOption {
  groupCode: string
  groupTitle: string
  optionCode: string
  optionTitle: string
  amount: number
  amountText: string
}

export interface OrderDetail extends OrderItem {
  statusEyebrow: string
  statusDescription: string
  statusIconUrl: string
  statusTone: OrderStatusTone
  items: OrderDetailLine[]
  totalQuantity: number
  checkoutOptions: OrderCheckoutOption[]
  goodsAmountText: string
  optionFeeText: string
  totalAmountText: string
  createdTimeText: string
  paidTimeText: string
  receiveTimeText: string
  payTypeText: string
  remark: string
  greetingMessage: string
}

const REFUND_STATUS_LABELS: Record<string, string> = {
  pending: '待商家审核',
  approved: '待寄回商品',
  returning: '待商家收货',
  rejected: '审核未通过',
  processing: '退款处理中',
  refunding: '退款处理中',
  success: '已退款',
  refunded: '已退款',
  done: '已退款',
  closed: '退款已关闭',
  abnormal: '退款异常',
  cancelled: '已撤回',
}

type OrderStatusIcon = 'payment' | 'craft' | 'parcel' | 'delivery' | 'complete' | 'closed' | 'after-sale' | 'refunded' | 'progress'
type OrderStatusTone = 'attention' | 'active' | 'ready' | 'transit' | 'success' | 'neutral' | 'service'

interface OrderStatusPresentation {
  eyebrow: string
  description: string
  icon: OrderStatusIcon
  tone: OrderStatusTone
}

const STATUS_PRESENTATION: Record<string, OrderStatusPresentation> = {
  pending: { eyebrow: 'AWAITING PAYMENT', description: '订单已创建，完成支付后将为你安排制作。', icon: 'payment', tone: 'attention' },
  pending_pay: { eyebrow: 'AWAITING PAYMENT', description: '订单已创建，完成支付后将为你安排制作。', icon: 'payment', tone: 'attention' },
  unpaid: { eyebrow: 'AWAITING PAYMENT', description: '订单已创建，完成支付后将为你安排制作。', icon: 'payment', tone: 'attention' },
  paid: { eyebrow: 'CRAFTING QUEUE', description: '款项已确认，我们正在为你安排制作。', icon: 'craft', tone: 'active' },
  processing: { eyebrow: 'HANDCRAFTING', description: '你的手串正在制作中，请耐心等待。', icon: 'craft', tone: 'active' },
  pending_ship: { eyebrow: 'READY TO SHIP', description: '商品已完成制作，正在等待打包发出。', icon: 'parcel', tone: 'ready' },
  shipped: { eyebrow: 'ON THE WAY', description: '包裹已经出发，可在下方查看物流进度。', icon: 'delivery', tone: 'transit' },
  completed: { eyebrow: 'ORDER COMPLETE', description: '订单已经完成，愿这份晶石陪伴你的日常。', icon: 'complete', tone: 'success' },
  complete: { eyebrow: 'ORDER COMPLETE', description: '订单已经完成，愿这份晶石陪伴你的日常。', icon: 'complete', tone: 'success' },
  cancelled: { eyebrow: 'ORDER CLOSED', description: '这笔订单已经取消，无需继续处理。', icon: 'closed', tone: 'neutral' },
  canceled: { eyebrow: 'ORDER CLOSED', description: '这笔订单已经取消，无需继续处理。', icon: 'closed', tone: 'neutral' },
  refund: { eyebrow: 'AFTER-SALES', description: '售后申请正在处理中，进度更新后会及时显示。', icon: 'after-sale', tone: 'service' },
  refunding: { eyebrow: 'REFUND IN PROGRESS', description: '退款正在处理中，请留意后续到账信息。', icon: 'after-sale', tone: 'service' },
  refunded: { eyebrow: 'REFUND COMPLETE', description: '退款已经完成，请留意原支付渠道的到账信息。', icon: 'refunded', tone: 'success' },
  after_sale: { eyebrow: 'AFTER-SALES', description: '售后申请正在处理中，进度更新后会及时显示。', icon: 'after-sale', tone: 'service' },
}

const REFUND_STATUS_PRESENTATION: Record<string, OrderStatusPresentation> = {
  pending: { eyebrow: 'REVIEW PENDING', description: '售后申请已提交，正在等待商家审核。', icon: 'after-sale', tone: 'service' },
  approved: { eyebrow: 'RETURN APPROVED', description: '售后申请已通过，请按页面提示寄回商品。', icon: 'parcel', tone: 'service' },
  returning: { eyebrow: 'RETURN IN TRANSIT', description: '退回包裹正在运输中，请留意售后进度。', icon: 'delivery', tone: 'service' },
  processing: { eyebrow: 'REFUND IN PROGRESS', description: '商品已进入退款处理流程，请耐心等待。', icon: 'after-sale', tone: 'service' },
  refunding: { eyebrow: 'REFUND IN PROGRESS', description: '退款正在处理中，请留意后续到账信息。', icon: 'after-sale', tone: 'service' },
  success: { eyebrow: 'REFUND COMPLETE', description: '退款已经完成，请留意原支付渠道的到账信息。', icon: 'refunded', tone: 'success' },
  refunded: { eyebrow: 'REFUND COMPLETE', description: '退款已经完成，请留意原支付渠道的到账信息。', icon: 'refunded', tone: 'success' },
  done: { eyebrow: 'REFUND COMPLETE', description: '退款已经完成，请留意原支付渠道的到账信息。', icon: 'refunded', tone: 'success' },
  rejected: { eyebrow: 'REQUEST DECLINED', description: '本次售后申请未通过，可查看原因或联系客服。', icon: 'closed', tone: 'neutral' },
  closed: { eyebrow: 'REQUEST CLOSED', description: '本次售后流程已经关闭。', icon: 'closed', tone: 'neutral' },
  cancelled: { eyebrow: 'REQUEST WITHDRAWN', description: '本次售后申请已经撤回。', icon: 'closed', tone: 'neutral' },
  abnormal: { eyebrow: 'SERVICE REQUIRED', description: '退款状态出现异常，请及时联系客服处理。', icon: 'after-sale', tone: 'attention' },
}

function formatDateTime(value: unknown): string {
  const text = toText(value)
  return text ? text.replace('T', ' ').replace(/\+\d{2}:?\d{2}$/, '').slice(0, 19) : ''
}

function formatMoney(value: unknown): string {
  return `¥ ${Math.max(0, toNumber(value)).toFixed(2)}`
}

function normalizePayType(value: unknown): string {
  const type = toText(value).toLowerCase()
  if (!type) return ''
  if (type === 'wechat' || type === 'wxpay') return '微信支付'
  return toText(value)
}

function normalizeOrder(source: RawOrder): OrderItem | null {
  const id = toText(source.id)
  const orderNo = toText(source.order_no || source.orderNo)
  if (!id && !orderNo) return null
  const rawStatus = toText(source.status, 'pending').toLowerCase()
  const refundStatus = toText(source.refund_status || source.refundStatus).toLowerCase()
  const isAfterSaleActive = ['refund', 'refunding', 'refunded', 'after_sale'].includes(rawStatus)
    || ['pending', 'approved', 'returning', 'processing', 'refunding'].includes(refundStatus)
  const isAfterSale = isAfterSaleActive
    || ['rejected', 'success', 'refunded', 'done', 'closed', 'abnormal'].includes(refundStatus)
  const amount = Math.max(0, toNumber(source.total_price || source.amount))
  const createdAt = toText(source.created_at || source.createdAt)
  const receiverName = toText(source.consignee)
  const receiverPhone = toText(source.phone)
  const refundType = toText(source.refund_type || source.refundType)
    || (['paid', 'processing', 'pending_ship'].includes(rawStatus) ? 'refund_only' : 'return_refund')
  const refundEvidence = Array.isArray(source.refund_evidence)
    ? source.refund_evidence
    : Array.isArray(source.refundEvidence) ? source.refundEvidence : []
  const tradeNo = toText(source.trade_no || source.tradeNo)
  const orderItems = Array.isArray(source.items) ? source.items : []
  const primaryItem = orderItems[0]
  const rawDesignSnapshot = primaryItem?.design_snapshot || primaryItem?.designSnapshot
  const designSnapshot = rawDesignSnapshot
    ? normalizeDesign(rawDesignSnapshot, 'customer', API_BASE_URL)
    : null
  const pattern = designSnapshot?.pattern || []
  const materialMap = designSnapshot?.materialMap || {}
  const beadSize = designSnapshot?.beadSize
    || materialMap[pattern[0]]?.size
    || 11
  const itemCount = Math.max(1, Math.floor(toNumber(
    source.item_count || source.itemCount,
    orderItems.length || 1,
  )))
  return {
    id: id || orderNo,
    orderNo: orderNo || id,
    rawStatus,
    statusLabel: isAfterSaleActive
      ? (REFUND_STATUS_LABELS[refundStatus] || STATUS_LABELS[rawStatus] || '售后处理中')
      : (STATUS_LABELS[rawStatus] || '处理中'),
    title: toText(primaryItem?.title || source.design_name, '定制手串'),
    amountText: `¥ ${amount.toFixed(2)}`,
    amountCents: Math.round(amount * 100),
    coverUrl: resolveMediaUrl(
      primaryItem?.cover_image
      || primaryItem?.coverImage
      || source.cover_image
      || source.preview_url
      || source.snapshot_url,
    ),
    pattern,
    materialMap,
    beadSize,
    itemCount,
    createdAtText: createdAt ? createdAt.replace('T', ' ').slice(0, 16) : '下单时间未知',
    receiverText: [receiverName, receiverPhone].filter(Boolean).join(' '),
    receiverName,
    receiverPhone,
    addressText: toText(source.address),
    expressCompany: toText(source.express_company || source.expressCompany),
    expressCode: toText(source.express_code || source.expressCode),
    expressNo: toText(source.express_no || source.expressNo),
    shipTimeText: toText(source.ship_time || source.shipTime).replace('T', ' ').slice(0, 16),
    wechatShippingStatus: toText(source.wechat_shipping_status || source.wechatShippingStatus),
    wechatShippingSyncedAt: toText(source.wechat_shipping_synced_at || source.wechatShippingSyncedAt),
    tradeNo,
    hasLogistics: Boolean(toText(source.express_no || source.expressNo)),
    refundStatus,
    afterSaleStatusLabel: REFUND_STATUS_LABELS[refundStatus] || '售后处理中',
    refundReason: toText(source.refund_reason || source.refundReason),
    refundType,
    refundTypeLabel: refundType === 'refund_only' ? '仅退款' : '退货退款',
    refundDescription: toText(source.refund_description || source.refundDescription),
    refundContactText: [
      toText(source.refund_contact_name || source.refundContactName),
      toText(source.refund_contact_phone || source.refundContactPhone),
    ].filter(Boolean).join(' '),
    refundContactAddress: toText(source.refund_contact_address || source.refundContactAddress),
    refundEvidenceUrls: refundEvidence.map((item) => resolveMediaUrl(item)).filter(Boolean),
    refundReturnAddress: toText(source.refund_return_address || source.refundReturnAddress),
    refundReturnExpressCompany: toText(source.refund_return_express_company || source.refundReturnExpressCompany),
    refundReturnExpressCode: toText(source.refund_return_express_code || source.refundReturnExpressCode),
    refundReturnExpressNo: toText(source.refund_return_express_no || source.refundReturnExpressNo),
    refundReturnShippedAt: toText(source.refund_return_shipped_at || source.refundReturnShippedAt).replace('T', ' ').slice(0, 16),
    refundAdminRemark: toText(source.refund_admin_remark || source.refundAdminRemark),
    canApplyAfterSale: ['paid', 'processing', 'pending_ship'].includes(rawStatus) && !isAfterSale,
    canReapplyAfterSale: refundStatus === 'rejected'
      && ['paid', 'processing', 'pending_ship'].includes(rawStatus),
    isAfterSale,
    canPay: ['pending', 'pending_pay', 'unpaid'].includes(rawStatus),
    canCancel: ['pending', 'pending_pay', 'unpaid'].includes(rawStatus),
    canSubmitReturnShipment: refundType === 'return_refund'
      && ['approved', 'returning'].includes(refundStatus),
    canConfirmReceipt: rawStatus === 'shipped' && Boolean(tradeNo) && !isAfterSaleActive,
  }
}

function toBackendStatus(filter: OrderFilter): string {
  if (filter === 'pending') return 'pending'
  if (filter === 'paid') return 'paid'
  if (filter === 'shipped') return 'shipped'
  if (filter === 'completed') return 'completed'
  if (filter === 'refund') return 'refund'
  return ''
}

export async function loadOrders(
  filter: OrderFilter = 'all',
  page = 1,
  pageSize = 20,
): Promise<OrderPage> {
  const status = toBackendStatus(filter)
  const normalizedPage = Math.max(1, Math.floor(page))
  const normalizedPageSize = Math.min(100, Math.max(1, Math.floor(pageSize)))
  const data: { page: number; pageSize: number; status?: string } = {
    page: normalizedPage,
    pageSize: normalizedPageSize,
  }
  if (status) data.status = status
  const result = await requestApi<RawOrderList | RawOrder[], typeof data>({
    path: '/api/order/list',
    data,
  })
  const source = Array.isArray(result) ? { list: result } : result
  const rawItems = Array.isArray(source.list)
    ? source.list
    : Array.isArray(source.items)
      ? source.items
      : Array.isArray(source.data) ? source.data : []
  const items = rawItems
    .map(normalizeOrder)
    .filter((item): item is OrderItem => item !== null)
  return {
    items,
    total: toNumber(source.total, items.length),
    page: Math.max(1, Math.floor(toNumber(source.page, normalizedPage))),
    pageSize: Math.max(1, Math.floor(toNumber(
      source.pageSize || source.page_size,
      normalizedPageSize,
    ))),
  }
}

export async function loadOrderByNo(orderNo: string): Promise<OrderItem> {
  const result = await requestApi<RawOrder, { order_no: string }>({
    path: '/api/order/detail',
    data: { order_no: toText(orderNo) },
  })
  const order = normalizeOrder(result)
  if (!order) throw new Error('订单数据不完整')
  return order
}

export async function loadOrderDetail(orderId: string): Promise<OrderDetail> {
  const result = await requestApi<RawOrder, { id: number }>({
    path: '/api/order/detail',
    data: { id: toNumber(orderId) },
  })
  const order = normalizeOrder(result)
  if (!order) throw new Error('订单数据不完整')

  const rawItems = Array.isArray(result.items) ? result.items : []
  const items = rawItems.map((item, index): OrderDetailLine => {
    const rawDesignSnapshot = item.design_snapshot || item.designSnapshot
    const designSnapshot = rawDesignSnapshot
      ? normalizeDesign(rawDesignSnapshot, 'customer', API_BASE_URL)
      : null
    const pattern = designSnapshot?.pattern || []
    const materialMap = designSnapshot?.materialMap || {}
    const beadSize = designSnapshot?.beadSize
      || materialMap[pattern[0]]?.size
      || 11
    const itemType = toText(item.item_type || item.itemType)
    const quantity = Math.max(1, Math.floor(toNumber(item.quantity, 1)))
    return {
      key: `${order.id}-${index}`,
      itemType,
      title: toText(item.title, itemType === 'mall_product' ? '商城商品' : '定制手串'),
      coverUrl: resolveMediaUrl(item.cover_image || item.coverImage),
      unitPriceText: formatMoney(item.unit_price || item.unitPrice),
      lineTotalText: formatMoney(item.line_total || item.lineTotal),
      quantity,
      pattern,
      materialMap,
      beadSize,
      isDiy: itemType === 'diy_design' || pattern.length > 0,
      imageFailed: false,
    }
  })

  const rawCheckoutOptions = Array.isArray(result.checkout_options_snapshot)
    ? result.checkout_options_snapshot
    : Array.isArray(result.checkoutOptionsSnapshot) ? result.checkoutOptionsSnapshot : []
  const checkoutOptions = rawCheckoutOptions.map((item): OrderCheckoutOption => {
    const amount = Math.max(0, toNumber(item.amount))
    return {
      groupCode: toText(item.groupCode || item.group_code),
      groupTitle: toText(item.groupTitle || item.group_title, '结算选项'),
      optionCode: toText(item.optionCode || item.option_code),
      optionTitle: toText(item.optionTitle || item.option_title, '默认'),
      amount,
      amountText: amount > 0 ? `+ ¥ ${amount.toFixed(2)}` : '免费',
    }
  })
  const optionFee = Math.max(0, toNumber(result.extra_fee || result.extraFee))
  const itemGoodsAmount = rawItems.reduce(
    (sum, item) => sum + Math.max(0, toNumber(item.line_total || item.lineTotal)),
    0,
  )
  const fallbackGoodsAmount = Math.max(
    0,
    toNumber(result.original_total_price || result.originalTotalPrice) - optionFee,
  )
  const statusPresentation = (order.isAfterSale && order.refundStatus
    ? REFUND_STATUS_PRESENTATION[order.refundStatus]
    : null)
    || STATUS_PRESENTATION[order.rawStatus]
    || { eyebrow: 'ORDER STATUS', description: '订单进度会持续更新。', icon: 'progress', tone: 'active' }

  return {
    ...order,
    statusLabel: order.isAfterSale && order.refundStatus
      ? (REFUND_STATUS_LABELS[order.refundStatus] || order.statusLabel)
      : order.statusLabel,
    statusEyebrow: statusPresentation.eyebrow,
    statusDescription: statusPresentation.description,
    statusIconUrl: `/assets/icons/order-status/${statusPresentation.icon}.svg`,
    statusTone: statusPresentation.tone,
    items,
    totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
    checkoutOptions,
    goodsAmountText: formatMoney(itemGoodsAmount || fallbackGoodsAmount),
    optionFeeText: formatMoney(optionFee),
    totalAmountText: formatMoney(result.total_price || result.amount),
    createdTimeText: formatDateTime(result.created_at || result.createdAt),
    paidTimeText: formatDateTime(result.paid_time || result.paidTime || result.pay_time || result.payTime),
    receiveTimeText: formatDateTime(result.receive_time || result.receiveTime),
    payTypeText: normalizePayType(result.pay_type || result.payType),
    remark: toText(result.remark),
    greetingMessage: toText(result.greeting_message || result.greetingMessage),
  }
}

export interface CreateAfterSaleInput {
  reason: string
  description: string
  images: string[]
  action?: 'apply' | 'reapply'
}

interface RawEvidenceUploadResult {
  url?: string
  path?: string
}

export async function uploadAfterSaleEvidence(filePath: string): Promise<string> {
  const result = await uploadFileApi<RawEvidenceUploadResult>({
    path: '/api/upload/image',
    filePath,
    name: 'file',
    timeout: 30000,
  })
  return resolveMediaUrl(result.url || result.path)
}

export async function createAfterSale(order: OrderItem, input: CreateAfterSaleInput): Promise<void> {
  await requestApi<unknown, {
    id: number
    action: 'apply' | 'reapply'
    reason: string
    description: string
    images: string[]
  }>({
    path: '/api/order/refund',
    method: 'POST',
    data: {
      id: toNumber(order.id),
      action: input.action || 'apply',
      reason: toText(input.reason),
      description: toText(input.description),
      images: input.images.map((item) => toText(item)).filter(Boolean).slice(0, 3),
    },
  })
}

export interface OrderLogistics {
  orderStatus: string
  expressCompany: string
  expressCode: string
  expressNo: string
  shipTimeText: string
  wechatShippingStatus: string
  wechatShippingSyncedAt: string
  transactionId: string
  receiveTimeText: string
  canConfirmReceipt: boolean
  trackingProvider: string
  trackingStatus: string
  trackingState: string
  trackingStateText: string
  trackingIsSigned: boolean
  trackingMessage: string
  trackingQueriedAtText: string
  trackingCached: boolean
  trackingEvents: LogisticsTrackingEvent[]
}

export interface LogisticsTrackingEvent {
  time: string
  context: string
  location: string
  status: string
  areaCode: string
  areaName: string
}

interface RawOrderLogistics {
  order_status?: string
  express_company?: string
  express_code?: string
  express_no?: string
  ship_time?: string
  wechat_shipping_status?: string
  wechat_shipping_synced_at?: string
  trade_no?: string
  receive_time?: string
  tracking_provider?: string
  tracking_status?: string
  tracking_state?: string
  tracking_state_text?: string
  tracking_is_signed?: boolean
  tracking_message?: string
  tracking_queried_at?: string
  tracking_cached?: boolean
  tracking_events?: Array<Partial<LogisticsTrackingEvent>>
}

export async function loadOrderLogistics(orderId: string): Promise<OrderLogistics> {
  const result = await requestApi<RawOrderLogistics, { id: number }>({
    path: '/api/order/logistics',
    data: { id: toNumber(orderId) },
  })
  const orderStatus = toText(result.order_status)
  const transactionId = toText(result.trade_no)
  const trackingEvents = Array.isArray(result.tracking_events)
    ? result.tracking_events.map((item) => ({
        time: toText(item.time),
        context: toText(item.context),
        location: toText(item.location),
        status: toText(item.status),
        areaCode: toText(item.areaCode),
        areaName: toText(item.areaName),
      })).filter((item) => Boolean(item.context))
    : []
  return {
    orderStatus,
    expressCompany: toText(result.express_company),
    expressCode: toText(result.express_code),
    expressNo: toText(result.express_no),
    shipTimeText: toText(result.ship_time).replace('T', ' ').slice(0, 16),
    wechatShippingStatus: toText(result.wechat_shipping_status),
    wechatShippingSyncedAt: toText(result.wechat_shipping_synced_at).replace('T', ' ').slice(0, 16),
    transactionId,
    receiveTimeText: toText(result.receive_time).replace('T', ' ').slice(0, 16),
    canConfirmReceipt: orderStatus === 'shipped' && Boolean(transactionId),
    trackingProvider: toText(result.tracking_provider),
    trackingStatus: toText(result.tracking_status),
    trackingState: toText(result.tracking_state),
    trackingStateText: toText(result.tracking_state_text),
    trackingIsSigned: Boolean(result.tracking_is_signed),
    trackingMessage: toText(result.tracking_message),
    trackingQueriedAtText: toText(result.tracking_queried_at).replace('T', ' ').slice(0, 16),
    trackingCached: Boolean(result.tracking_cached),
    trackingEvents,
  }
}

export interface ConfirmReceiptResult {
  confirmed: boolean
  orderStatus: string
  wechatOrderState: number
  wechatOrderStateLabel: string
}

interface RawConfirmReceiptResult {
  confirmed?: boolean
  order?: RawOrder
  wechat_order_state?: number | string
  wechat_order_state_label?: string
}

function waitForWechatReceiptState(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

export async function confirmOrderReceipt(orderId: string): Promise<ConfirmReceiptResult> {
  let latest: ConfirmReceiptResult = {
    confirmed: false,
    orderStatus: 'shipped',
    wechatOrderState: 0,
    wechatOrderStateLabel: '',
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await requestApi<RawConfirmReceiptResult, { id: number }>({
      path: '/api/order/confirm',
      method: 'POST',
      data: { id: toNumber(orderId) },
    })
    latest = {
      confirmed: Boolean(result.confirmed),
      orderStatus: toText(result.order?.status),
      wechatOrderState: toNumber(result.wechat_order_state),
      wechatOrderStateLabel: toText(result.wechat_order_state_label),
    }
    if (latest.confirmed || attempt === 2) return latest
    await waitForWechatReceiptState(600 * (attempt + 1))
  }
  return latest
}

export interface ReturnShipmentInput {
  expressCompany: string
  expressCode: string
  expressNo: string
}

export async function submitReturnShipment(
  orderId: string,
  input: ReturnShipmentInput,
): Promise<void> {
  await requestApi<unknown, {
    id: number
    express_company: string
    express_code: string
    express_no: string
  }>({
    path: '/api/order/refund_return_ship',
    method: 'POST',
    data: {
      id: toNumber(orderId),
      express_company: toText(input.expressCompany),
      express_code: toText(input.expressCode),
      express_no: toText(input.expressNo),
    },
  })
}
