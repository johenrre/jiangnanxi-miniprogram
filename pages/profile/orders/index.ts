import {
  cancelCheckoutOrder,
  confirmOrderReceipt,
  getApiErrorMessage,
  hasAuthSession,
  loadOrderByNo,
  loadOrders,
  queryCheckoutPayment,
  requestCheckoutPayment,
  type CheckoutOrder,
  type OrderFilter,
  type OrderItem,
} from '@/api/index'
import {
  consumeWechatReceiptResult,
  openWechatReceiptConfirmation,
  type WechatReceiptResult,
} from '@/services/wechat-order-receipt'
import { prepareAppResources } from '@/services/app-resource-preloader'
import { ensureAuthenticated } from '@/services/auth-gate'

type OrderListStatus = 'login' | 'loading' | 'ready' | 'empty' | 'error'

interface FilterItem {
  id: OrderFilter
  label: string
}

const filters: FilterItem[] = [
  { id: 'all', label: '全部' },
  { id: 'pending', label: '待付款' },
  { id: 'paid', label: '待发货' },
  { id: 'shipped', label: '待收货' },
  { id: 'completed', label: '已完成' },
]
const ORDER_PAGE_SIZE = 20

Page({
  data: {
    status: 'loading' as OrderListStatus,
    activeFilter: 'all' as OrderFilter,
    filters,
    orders: [] as OrderItem[],
    total: 0,
    page: 1,
    loadedOrderCount: 0,
    hasMore: false,
    loadingMore: false,
    errorMessage: '',
    failedImages: {} as Record<string, boolean>,
    trayBackgroundUrl: '/assets/bg_1.jpg',
    trayLoadFailed: false,
    busyOrderId: '',
    targetOrderNo: '',
  },

  onLoad(options: Record<string, string | undefined>) {
    void this.loadSharedPresentation()
    const requested = String(options.filter || '') as OrderFilter
    const targetOrderNo = String(options.orderNo || options.order_no || '').trim()
    if (targetOrderNo) {
      this.setData({ activeFilter: 'all', targetOrderNo })
      return
    }
    if (filters.some((item) => item.id === requested)) {
      this.setData({ activeFilter: requested })
    }
  },

  async loadSharedPresentation() {
    try {
      const { settings } = await prepareAppResources()
      this.setData({
        trayBackgroundUrl: settings.diyTrayImageUrls[0] || '/assets/bg_1.jpg',
        trayLoadFailed: false,
      })
    } catch {
      this.setData({ trayBackgroundUrl: '/assets/bg_1.jpg', trayLoadFailed: false })
    }
  },

  onShow() {
    if (!hasAuthSession()) {
      this.setData({ status: 'login', orders: [], total: 0 })
      return
    }
    const receiptResult = consumeWechatReceiptResult()
    if (receiptResult) {
      void this.handleReceiptComponentReturn(receiptResult)
      return
    }
    const silent = this.data.status === 'ready' || this.data.status === 'empty'
    void this.loadData(silent)
  },

  async handleReceiptComponentReturn(result: WechatReceiptResult) {
    if (result.status === 'cancel') {
      wx.showToast({ title: '已取消确认收货', icon: 'none' })
      await this.loadData()
      return
    }
    if (result.status === 'fail') {
      wx.showToast({ title: result.errorMessage || '确认收货未完成', icon: 'none' })
      await this.loadData()
      return
    }

    this.setData({ busyOrderId: result.orderId })
    try {
      const synced = await confirmOrderReceipt(result.orderId)
      wx.showToast({
        title: synced.confirmed ? '确认收货成功' : '微信结果同步中，请稍后刷新',
        icon: synced.confirmed ? 'success' : 'none',
      })
    } catch (error) {
      wx.showToast({
        title: getApiErrorMessage(error, '确认结果同步失败，请稍后刷新'),
        icon: 'none',
      })
    } finally {
      this.setData({ busyOrderId: '' })
      await this.loadData()
    }
  },

  async loadData(silent = false) {
    const filter = this.data.activeFilter
    const targetOrderNo = this.data.targetOrderNo
    if (!silent) {
      this.setData({
        status: 'loading',
        errorMessage: '',
        page: 1,
        loadedOrderCount: 0,
        hasMore: false,
        loadingMore: false,
      })
    }
    try {
      const [result, targetOrder] = await Promise.all([
        loadOrders(filter, 1, ORDER_PAGE_SIZE),
        targetOrderNo ? loadOrderByNo(targetOrderNo) : Promise.resolve(null),
      ])
      if (filter !== this.data.activeFilter || targetOrderNo !== this.data.targetOrderNo) return
      const orders = targetOrder
        ? [targetOrder, ...result.items.filter((item) => item.orderNo !== targetOrder.orderNo)]
        : result.items
      this.setData({
        orders,
        total: result.total,
        page: result.page,
        loadedOrderCount: result.items.length,
        hasMore: result.items.length < result.total,
        status: orders.length > 0 ? 'ready' : 'empty',
        failedImages: {},
      })
    } catch (error) {
      if (filter !== this.data.activeFilter || targetOrderNo !== this.data.targetOrderNo) return
      if (!silent) {
        this.setData({
          orders: [],
          total: 0,
          status: 'error',
          errorMessage: getApiErrorMessage(
            error,
            targetOrderNo ? '指定订单加载失败，请确认登录账号' : '订单加载失败，请稍后重试',
          ),
        })
      }
    }
  },

  onReachBottom() {
    void this.loadMore()
  },

  async loadMore() {
    if (
      this.data.status !== 'ready'
      || this.data.loadingMore
      || !this.data.hasMore
    ) return

    const filter = this.data.activeFilter
    const nextPage = this.data.page + 1
    this.setData({ loadingMore: true })
    try {
      const result = await loadOrders(filter, nextPage, ORDER_PAGE_SIZE)
      if (filter !== this.data.activeFilter || nextPage !== this.data.page + 1) return
      const existingIds = new Set(this.data.orders.map((item) => item.id))
      const appendedOrders = result.items.filter((item) => !existingIds.has(item.id))
      const loadedOrderCount = this.data.loadedOrderCount + result.items.length
      this.setData({
        orders: [...this.data.orders, ...appendedOrders],
        page: result.page,
        loadedOrderCount,
        hasMore: loadedOrderCount < result.total,
      })
    } catch (error) {
      wx.showToast({
        title: getApiErrorMessage(error, '更多订单加载失败'),
        icon: 'none',
      })
    } finally {
      if (filter === this.data.activeFilter) this.setData({ loadingMore: false })
    }
  },

  handleFilterChange(event: WechatMiniprogram.TouchEvent) {
    const filter = String(event.currentTarget.dataset.filter || '') as OrderFilter
    if (!filters.some((item) => item.id === filter)) return
    if (filter === this.data.activeFilter && !this.data.targetOrderNo) return
    this.setData({ activeFilter: filter, targetOrderNo: '' })
    void this.loadData()
  },

  handleImageError(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    if (!id) return
    this.setData({ [`failedImages.${id}`]: true })
  },

  handleTrayError() {
    this.setData({ trayLoadFailed: true })
  },

  handleOpenDetail(event: WechatMiniprogram.TouchEvent) {
    const orderId = String(event.currentTarget.dataset.id || '').trim()
    if (!orderId) return
    wx.navigateTo({
      url: `/pages/profile/order-detail/index?orderId=${encodeURIComponent(orderId)}`,
    })
  },

  handleContactService() {
    const customerService = this.selectComponent('#ordersCustomerService') as {
      open?: () => void
    } | null
    customerService?.open?.()
  },

  handleAfterSale(event: WechatMiniprogram.TouchEvent) {
    const orderNo = String(event.currentTarget.dataset.orderNo || '')
    const query = orderNo ? `?orderNo=${encodeURIComponent(orderNo)}` : ''
    wx.navigateTo({ url: `/pages/profile/after-sales/index${query}` })
  },

  handleLogistics(event: WechatMiniprogram.TouchEvent) {
    const orderId = String(event.currentTarget.dataset.id || '').trim()
    const orderNo = String(event.currentTarget.dataset.orderNo || '').trim()
    if (!orderId) return
    wx.navigateTo({
      url: `/pages/profile/order-logistics/index?orderId=${encodeURIComponent(orderId)}&orderNo=${encodeURIComponent(orderNo)}`,
    })
  },

  async handleConfirmReceipt(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    const order = this.data.orders.find((item) => item.id === id)
    if (!order || !order.canConfirmReceipt || this.data.busyOrderId) return

    this.setData({ busyOrderId: order.id })
    try {
      await openWechatReceiptConfirmation({
        orderId: order.id,
        orderNo: order.orderNo,
        transactionId: order.tradeNo,
      })
    } catch (error) {
      wx.showToast({
        title: getApiErrorMessage(error, '微信确认收货组件打开失败'),
        icon: 'none',
      })
    } finally {
      this.setData({ busyOrderId: '' })
    }
  },

  async handleContinuePayment(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    const order = this.data.orders.find((item) => item.id === id)
    if (!order || !order.canPay || this.data.busyOrderId) return
    const checkoutOrder: CheckoutOrder = {
      id: order.id,
      orderNo: order.orderNo,
      payableAmountCents: order.amountCents,
      createdAt: Date.now(),
    }
    this.setData({ busyOrderId: order.id })
    let invocationError: unknown = null
    try {
      try {
        await requestCheckoutPayment(checkoutOrder)
      } catch (error) {
        invocationError = error
      }

      const result = await queryCheckoutPayment(order.orderNo)
      if (result.state === 'paid') {
        wx.showToast({ title: '支付状态已确认', icon: 'success' })
      } else if (result.state === 'closed') {
        wx.showToast({ title: '支付单已关闭，请重新结算', icon: 'none' })
      } else if (invocationError) {
        const message = getApiErrorMessage(invocationError, '')
        wx.showToast({
          title: message.toLowerCase().includes('cancel')
            ? '已取消支付，订单仍待付款'
            : (message || '支付未完成，请稍后重试'),
          icon: 'none',
        })
      } else {
        wx.showToast({ title: '支付结果确认中，请稍后刷新', icon: 'none' })
      }
    } catch (error) {
      wx.showToast({
        title: getApiErrorMessage(error, '支付结果暂未确认，请稍后刷新'),
        icon: 'none',
      })
    } finally {
      this.setData({ busyOrderId: '' })
      await this.loadData()
    }
  },

  handleCancelOrder(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    const order = this.data.orders.find((item) => item.id === id)
    if (!order || !order.canCancel || this.data.busyOrderId) return
    wx.showModal({
      title: '取消待付款订单',
      content: '系统会先确认微信支付状态。只有确定未付款时，才会关闭支付单并取消订单。',
      confirmText: '确认取消',
      confirmColor: '#9b625b',
      success: (result) => {
        if (!result.confirm) return
        this.setData({ busyOrderId: order.id })
        void cancelCheckoutOrder(order.id)
          .then(() => {
            wx.showToast({ title: '订单已取消', icon: 'success' })
          })
          .catch((error) => {
            wx.showToast({
              title: getApiErrorMessage(error, '订单取消失败，请刷新后重试'),
              icon: 'none',
            })
          })
          .finally(() => {
            this.setData({ busyOrderId: '' })
            void this.loadData()
          })
      },
    })
  },

  handleRetry() {
    void this.loadData()
  },

  async handleGoLogin() {
    if (!(await ensureAuthenticated(this, {
      content: '登录后可查看付款、制作和收货进度。',
    }))) return
    await this.loadData()
  },
})
