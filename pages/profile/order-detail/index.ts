import {
  getApiErrorMessage,
  hasAuthSession,
  loadOrderDetail,
  type OrderDetail,
} from '@/api/index'
import { prepareAppResources } from '@/services/app-resource-preloader'
import { ensureAuthenticated } from '@/services/auth-gate'

type OrderDetailStatus = 'login' | 'loading' | 'ready' | 'error'

Page({
  data: {
    status: 'loading' as OrderDetailStatus,
    orderId: '',
    order: null as OrderDetail | null,
    errorMessage: '',
    trayBackgroundUrl: '/assets/bg_1.jpg',
    trayLoadFailed: false,
  },

  onLoad(options: Record<string, string | undefined>) {
    this.setData({ orderId: String(options.orderId || options.id || '').trim() })
    void this.loadSharedPresentation()
  },

  onShow() {
    if (!hasAuthSession()) {
      this.setData({ status: 'login', order: null })
      return
    }
    void this.loadData()
  },

  onPullDownRefresh() {
    void this.loadData().finally(() => wx.stopPullDownRefresh())
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

  async loadData() {
    const orderId = this.data.orderId
    if (!orderId) {
      this.setData({ status: 'error', errorMessage: '订单信息不完整' })
      return
    }
    this.setData({ status: 'loading', errorMessage: '' })
    try {
      const order = await loadOrderDetail(orderId)
      if (orderId !== this.data.orderId) return
      this.setData({ order, status: 'ready' })
    } catch (error) {
      if (orderId !== this.data.orderId) return
      this.setData({
        order: null,
        status: 'error',
        errorMessage: getApiErrorMessage(error, '订单详情加载失败，请稍后重试'),
      })
    }
  },

  handleProductImageError(event: WechatMiniprogram.TouchEvent) {
    const key = String(event.currentTarget.dataset.key || '')
    const order = this.data.order
    if (!order || !key) return
    this.setData({
      'order.items': order.items.map((item) => (
        item.key === key ? { ...item, imageFailed: true } : item
      )),
    })
  },

  handleTrayError() {
    this.setData({ trayLoadFailed: true })
  },

  handleCopyOrderNo() {
    const orderNo = this.data.order?.orderNo || ''
    if (!orderNo) return
    wx.setClipboardData({
      data: orderNo,
      success() {
        wx.showToast({ title: '订单编号已复制', icon: 'success' })
      },
      fail() {
        wx.showToast({ title: '复制失败，请长按订单编号', icon: 'none' })
      },
    })
  },

  handleViewLogistics() {
    const order = this.data.order
    if (!order?.hasLogistics) return
    wx.navigateTo({
      url: `/pages/profile/order-logistics/index?orderId=${encodeURIComponent(order.id)}&orderNo=${encodeURIComponent(order.orderNo)}`,
    })
  },

  handleContactService() {
    const customerService = this.selectComponent('#orderDetailCustomerService') as {
      open?: () => void
    } | null
    customerService?.open?.()
  },

  handleRetry() {
    void this.loadData()
  },

  async handleGoLogin() {
    if (!(await ensureAuthenticated(this, {
      content: '登录后可查看当前账号的订单详情。',
    }))) return
    await this.loadData()
  },
})
