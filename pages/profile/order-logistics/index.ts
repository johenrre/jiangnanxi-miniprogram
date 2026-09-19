import {
  confirmOrderReceipt,
  getApiErrorMessage,
  hasAuthSession,
  loadOrderLogistics,
  type OrderLogistics,
} from '@/api/index'
import {
  consumeWechatReceiptResult,
  openWechatReceiptConfirmation,
  type WechatReceiptResult,
} from '@/services/wechat-order-receipt'
import { ensureAuthenticated } from '@/services/auth-gate'

type LogisticsStatus = 'login' | 'loading' | 'ready' | 'empty' | 'error'

Page({
  data: {
    status: 'loading' as LogisticsStatus,
    orderId: '',
    orderNo: '',
    logistics: null as OrderLogistics | null,
    isCompleted: false,
    trackingTitle: '商家已发货',
    trackingDescription: '包裹已交由快递公司，请留意配送电话。',
    confirmingReceipt: false,
    errorMessage: '',
  },

  onLoad(options: Record<string, string | undefined>) {
    this.setData({
      orderId: String(options.orderId || options.id || '').trim(),
      orderNo: String(options.orderNo || '').trim(),
    })
  },

  onShow() {
    if (!hasAuthSession()) {
      this.setData({ status: 'login', logistics: null })
      return
    }
    const receiptResult = consumeWechatReceiptResult(this.data.orderId)
    if (receiptResult) {
      void this.handleReceiptComponentReturn(receiptResult)
      return
    }
    void this.loadData()
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

    this.setData({ confirmingReceipt: true })
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
      this.setData({ confirmingReceipt: false })
      await this.loadData()
    }
  },

  async loadData() {
    if (!this.data.orderId) {
      this.setData({ status: 'error', errorMessage: '订单信息不完整' })
      return
    }
    this.setData({ status: 'loading', errorMessage: '' })
    try {
      const logistics = await loadOrderLogistics(this.data.orderId)
      const isCompleted = logistics.orderStatus === 'completed'
      const trackingTitle = logistics.trackingStateText
        || (isCompleted ? '订单已完成' : '商家已发货')
      const trackingDescription = logistics.trackingEvents[0]?.context
        || (isCompleted
          ? '感谢你的耐心等待，物流信息仍可留存查询。'
          : '包裹已交由快递公司，请留意配送电话。')
      this.setData({
        logistics,
        isCompleted,
        trackingTitle,
        trackingDescription,
        status: logistics.expressNo ? 'ready' : 'empty',
      })
    } catch (error) {
      this.setData({
        logistics: null,
        status: 'error',
        errorMessage: getApiErrorMessage(error, '物流信息加载失败，请稍后重试'),
      })
    }
  },

  handleCopyTrackingNo() {
    const trackingNo = this.data.logistics?.expressNo || ''
    if (!trackingNo) return
    wx.setClipboardData({
      data: trackingNo,
      success() {
        wx.showToast({ title: '快递单号已复制', icon: 'success' })
      },
      fail() {
        wx.showToast({ title: '复制失败，请长按单号复制', icon: 'none' })
      },
    })
  },

  async handleConfirmReceipt() {
    const logistics = this.data.logistics
    if (!logistics?.canConfirmReceipt || this.data.confirmingReceipt) return
    this.setData({ confirmingReceipt: true })
    try {
      await openWechatReceiptConfirmation({
        orderId: this.data.orderId,
        orderNo: this.data.orderNo,
        transactionId: logistics.transactionId,
      })
    } catch (error) {
      wx.showToast({
        title: getApiErrorMessage(error, '微信确认收货组件打开失败'),
        icon: 'none',
      })
    } finally {
      this.setData({ confirmingReceipt: false })
    }
  },

  handleRetry() {
    void this.loadData()
  },

  async handleGoLogin() {
    if (!(await ensureAuthenticated(this, {
      content: '登录后可查看自己的订单物流信息。',
    }))) return
    await this.loadData()
  },
})
