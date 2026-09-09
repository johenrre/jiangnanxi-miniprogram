import {
  createAfterSale,
  getApiErrorMessage,
  hasAuthSession,
  loadOrderByNo,
  loadPublicSettings,
  uploadAfterSaleEvidence,
  type OrderItem,
} from '@/api/index'

type PageStatus = 'loading' | 'ready' | 'error'
type ApplyMode = 'apply' | 'reapply'

interface EvidenceItem {
  localPath: string
  url: string
}

function chooseEvidenceImages(count: number): Promise<string[]> {
  return new Promise((resolve, reject) => {
    wx.chooseMedia({
      count,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success(result) {
        resolve(result.tempFiles.map((file) => file.tempFilePath).filter(Boolean))
      },
      fail(error) {
        reject(error)
      },
    })
  })
}

Page({
  data: {
    status: 'loading' as PageStatus,
    mode: 'apply' as ApplyMode,
    isReapply: false,
    pageTitle: '申请售后',
    submitText: '提交申请',
    orderNo: '',
    order: null as OrderItem | null,
    refundReasons: [] as string[],
    reasonIndex: -1,
    reason: '',
    description: '',
    descriptionLength: 0,
    evidenceItems: [] as EvidenceItem[],
    uploading: false,
    submitting: false,
    loaded: false,
    errorMessage: '',
  },

  onLoad(options: Record<string, string | undefined>) {
    const mode: ApplyMode = options.mode === 'reapply' ? 'reapply' : 'apply'
    this.setData({
      orderNo: String(options.orderNo || '').trim(),
      mode,
      isReapply: mode === 'reapply',
      pageTitle: mode === 'reapply' ? '重新申请售后' : '申请售后',
      submitText: mode === 'reapply' ? '重新提交' : '提交申请',
    })
  },

  onShow() {
    if (!hasAuthSession()) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      wx.navigateBack()
      return
    }
    if (!this.data.loaded) void this.loadData()
  },

  async loadData() {
    if (!this.data.orderNo) {
      this.setData({ status: 'error', errorMessage: '缺少订单信息' })
      return
    }
    this.setData({ status: 'loading', errorMessage: '' })
    try {
      const [order, settings] = await Promise.all([
        loadOrderByNo(this.data.orderNo),
        loadPublicSettings(true),
      ])
      if (this.data.isReapply ? !order.canReapplyAfterSale : !order.canApplyAfterSale) {
        throw new Error(this.data.isReapply
          ? '定制商品仅支持发货前重新申请售后'
          : '定制商品仅支持发货前申请售后')
      }
      const reasonIndex = this.data.isReapply
        ? settings.refundReasons.indexOf(order.refundReason)
        : -1
      const reason = reasonIndex >= 0 ? settings.refundReasons[reasonIndex] : ''
      const description = this.data.isReapply ? order.refundDescription : ''
      const evidenceItems = this.data.isReapply
        ? order.refundEvidenceUrls.slice(0, 3).map((url) => ({ localPath: url, url }))
        : []
      this.setData({
        order,
        refundReasons: settings.refundReasons,
        reasonIndex,
        reason,
        description,
        descriptionLength: description.length,
        evidenceItems,
        status: 'ready',
        loaded: true,
      })
    } catch (error) {
      this.setData({
        status: 'error',
        errorMessage: getApiErrorMessage(error, '售后申请信息加载失败'),
      })
    }
  },

  handleReasonChange(event: WechatMiniprogram.PickerChange) {
    const reasonIndex = Number(event.detail.value)
    this.setData({
      reasonIndex,
      reason: this.data.refundReasons[reasonIndex] || '',
    })
  },

  handleDescriptionInput(event: WechatMiniprogram.TextareaInput) {
    const description = String(event.detail.value || '').slice(0, 300)
    this.setData({ description, descriptionLength: description.length })
  },

  async handleChooseEvidence() {
    if (this.data.uploading || this.data.evidenceItems.length >= 3) return
    try {
      const localPaths = await chooseEvidenceImages(3 - this.data.evidenceItems.length)
      if (!localPaths.length) return
      this.setData({ uploading: true })
      const uploaded: EvidenceItem[] = []
      for (const localPath of localPaths) {
        const url = await uploadAfterSaleEvidence(localPath)
        if (!url) throw new Error('凭证上传失败')
        uploaded.push({ localPath, url })
      }
      this.setData({ evidenceItems: [...this.data.evidenceItems, ...uploaded].slice(0, 3) })
    } catch (error) {
      const message = getApiErrorMessage(error, '')
      if (!message.toLowerCase().includes('cancel')) {
        wx.showToast({ title: message || '凭证上传失败', icon: 'none' })
      }
    } finally {
      this.setData({ uploading: false })
    }
  },

  handlePreviewEvidence(event: WechatMiniprogram.TouchEvent) {
    const current = String(event.currentTarget.dataset.path || '')
    wx.previewImage({ current, urls: this.data.evidenceItems.map((item) => item.localPath) })
  },

  handleRemoveEvidence(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index)
    this.setData({ evidenceItems: this.data.evidenceItems.filter((_, itemIndex) => itemIndex !== index) })
  },

  async handleSubmit() {
    const { order, reason, description, evidenceItems } = this.data
    if (!order || this.data.submitting || this.data.uploading) return
    if (!reason) {
      wx.showToast({ title: '请选择退款原因', icon: 'none' })
      return
    }
    if (reason === '其他问题' && description.trim().length < 5) {
      wx.showToast({ title: '请填写至少 5 个字的申请说明', icon: 'none' })
      return
    }
    this.setData({ submitting: true })
    try {
      await createAfterSale(order, {
        action: this.data.mode,
        reason,
        description,
        images: evidenceItems.map((item) => item.url),
      })
      wx.showToast({ title: this.data.isReapply ? '已重新提交' : '申请已提交', icon: 'success' })
      setTimeout(() => {
        wx.navigateBack({
          delta: 1,
          fail() {
            wx.redirectTo({ url: `/pages/profile/after-sales/index?orderNo=${encodeURIComponent(order.orderNo)}` })
          },
        })
      }, 450)
    } catch (error) {
      wx.showToast({ title: getApiErrorMessage(error, '售后申请提交失败'), icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  handleRetry() {
    void this.loadData()
  },
})
