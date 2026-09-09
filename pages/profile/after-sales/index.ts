import {
  getApiErrorMessage,
  hasAuthSession,
  loadOrders,
  submitReturnShipment,
  type OrderItem,
} from '@/api/index'
import { ensureAuthenticated } from '@/services/auth-gate'

type AfterSaleStatus = 'login' | 'loading' | 'ready' | 'empty' | 'error'
type AfterSaleSection = 'records' | 'eligible'

const returnExpressOptions = [
  { code: 'SF', name: '顺丰速运' },
  { code: 'YD', name: '韵达快递' },
  { code: 'ZTO', name: '中通快递' },
  { code: 'YTO', name: '圆通速递' },
  { code: 'STO', name: '申通快递' },
  { code: 'JD', name: '京东物流' },
  { code: 'EMS', name: '邮政 EMS' },
  { code: 'JTSD', name: '极兔速递' },
]

Page({
  data: {
    status: 'loading' as AfterSaleStatus,
    section: 'records' as AfterSaleSection,
    records: [] as OrderItem[],
    eligibleOrders: [] as OrderItem[],
    requestedOrderNo: '',
    expandedOrderId: '',
    errorMessage: '',
    returnExpressNames: returnExpressOptions.map((item) => item.name),
    editingReturnOrderId: '',
    returnExpressIndex: 0,
    returnExpressNo: '',
    submittingReturnShipment: false,
  },

  onLoad(options: Record<string, string | undefined>) {
    this.setData({ requestedOrderNo: String(options.orderNo || '') })
  },

  onShow() {
    if (!hasAuthSession()) {
      this.setData({ status: 'login', records: [], eligibleOrders: [] })
      return
    }
    void this.loadData()
  },

  async loadData() {
    this.setData({ status: 'loading', errorMessage: '' })
    try {
      const result = await loadOrders('all')
      const records = result.items.filter((item) => item.isAfterSale)
      const eligibleOrders = result.items.filter((item) => item.canApplyAfterSale)
      const requestedOrderNo = this.data.requestedOrderNo
      const requestedEligible = requestedOrderNo
        ? eligibleOrders.some((item) => item.orderNo === requestedOrderNo)
        : false
      const requestedRecord = requestedOrderNo
        ? records.find((item) => item.orderNo === requestedOrderNo)
        : undefined
      const section: AfterSaleSection = requestedRecord
        ? 'records'
        : requestedEligible ? 'eligible' : this.data.section
      this.setData({
        records,
        eligibleOrders,
        section,
        expandedOrderId: requestedRecord?.id || this.data.expandedOrderId,
        status: records.length > 0 || eligibleOrders.length > 0 ? 'ready' : 'empty',
      })
    } catch (error) {
      this.setData({
        records: [],
        eligibleOrders: [],
        status: 'error',
        errorMessage: getApiErrorMessage(error, '售后信息加载失败，请稍后重试'),
      })
    }
  },

  handleSectionChange(event: WechatMiniprogram.TouchEvent) {
    const section = String(event.currentTarget.dataset.section || '') as AfterSaleSection
    if (section !== 'records' && section !== 'eligible') return
    this.setData({ section })
  },

  handleRecordToggle(event: WechatMiniprogram.TouchEvent) {
    const orderId = String(event.currentTarget.dataset.id || '')
    if (!orderId) return
    this.setData({
      expandedOrderId: this.data.expandedOrderId === orderId ? '' : orderId,
    })
  },

  handleCopyAddress(event: WechatMiniprogram.TouchEvent) {
    const address = String(event.currentTarget.dataset.address || '').trim()
    if (!address) return
    wx.setClipboardData({
      data: address,
      fail() {
        wx.showToast({ title: '复制失败，请长按地址复制', icon: 'none' })
      },
    })
  },

  handleCopyReturnTracking(event: WechatMiniprogram.TouchEvent) {
    const trackingNo = String(event.currentTarget.dataset.trackingNo || '').trim()
    if (!trackingNo) return
    wx.setClipboardData({
      data: trackingNo,
      success() {
        wx.showToast({ title: '退货单号已复制', icon: 'success' })
      },
      fail() {
        wx.showToast({ title: '复制失败，请长按单号复制', icon: 'none' })
      },
    })
  },

  handleStartReturnShipment(event: WechatMiniprogram.TouchEvent) {
    const orderId = String(event.currentTarget.dataset.id || '').trim()
    const order = this.data.records.find((item) => item.id === orderId)
    if (!order || !order.canSubmitReturnShipment) return
    const existingIndex = returnExpressOptions.findIndex((item) => (
      item.code === order.refundReturnExpressCode
      || item.name === order.refundReturnExpressCompany
    ))
    this.setData({
      editingReturnOrderId: orderId,
      returnExpressIndex: existingIndex >= 0 ? existingIndex : 0,
      returnExpressNo: order.refundReturnExpressNo,
    })
  },

  handleReturnExpressChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ returnExpressIndex: Number(event.detail.value) || 0 })
  },

  handleReturnExpressNoInput(event: WechatMiniprogram.Input) {
    this.setData({ returnExpressNo: String(event.detail.value || '') })
  },

  handleCancelReturnShipment() {
    if (this.data.submittingReturnShipment) return
    this.setData({ editingReturnOrderId: '', returnExpressNo: '' })
  },

  handleSubmitReturnShipment() {
    const order = this.data.records.find((item) => item.id === this.data.editingReturnOrderId)
    const expressNo = this.data.returnExpressNo.trim()
    const company = returnExpressOptions[this.data.returnExpressIndex]
    if (!order || !company || this.data.submittingReturnShipment) return
    if (!expressNo) {
      wx.showToast({ title: '请填写寄回快递单号', icon: 'none' })
      return
    }
    const submit = () => {
      this.setData({ submittingReturnShipment: true })
      void submitReturnShipment(order.id, {
        expressCompany: company.name,
        expressCode: company.code,
        expressNo,
      })
        .then(() => {
          wx.showToast({ title: order.refundReturnExpressNo ? '退货物流已更新' : '退货物流已提交', icon: 'success' })
          this.setData({ editingReturnOrderId: '', returnExpressNo: '' })
          void this.loadData()
        })
        .catch((error) => {
          wx.showToast({ title: getApiErrorMessage(error, '退货物流提交失败'), icon: 'none' })
        })
        .finally(() => {
          this.setData({ submittingReturnShipment: false })
        })
    }
    if (order.refundReturnExpressNo) {
      wx.showModal({
        title: '更新退货物流？',
        content: '请确认新的快递公司和单号填写正确，商家将按此信息核对退货。',
        confirmText: '确认更新',
        confirmColor: '#607d76',
        success: (result) => {
          if (result.confirm) submit()
        },
      })
      return
    }
    submit()
  },

  handleApply(event: WechatMiniprogram.TouchEvent) {
    const orderId = String(event.currentTarget.dataset.id || '')
    const order = this.data.eligibleOrders.find((item) => item.id === orderId)
    if (!order) return
    wx.navigateTo({
      url: `/pages/profile/after-sale-apply/index?orderNo=${encodeURIComponent(order.orderNo)}`,
    })
  },

  handleReapply(event: WechatMiniprogram.TouchEvent) {
    const orderNo = String(event.currentTarget.dataset.orderNo || '').trim()
    if (!orderNo) return
    wx.navigateTo({
      url: `/pages/profile/after-sale-apply/index?orderNo=${encodeURIComponent(orderNo)}&mode=reapply`,
    })
  },

  handleRetry() {
    void this.loadData()
  },

  async handleGoLogin() {
    if (!(await ensureAuthenticated(this, {
      content: '登录后可查看和提交售后申请。',
    }))) return
    await this.loadData()
  },
})
