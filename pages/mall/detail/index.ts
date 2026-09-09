import {
  addMallProductToCart,
  createMallCartItem,
  getApiErrorMessage,
  loadMallProduct,
  type MallProduct,
} from '@/api/index'
import { ensureAuthenticated } from '@/services/auth-gate'
import { setCheckoutIntent } from '@/services/checkout-intent'

type MallDetailStatus = 'loading' | 'ready' | 'empty' | 'error'

Page({
  data: {
    status: 'loading' as MallDetailStatus,
    productId: '',
    product: null as MallProduct | null,
    emptyTitle: '没有找到这件商品',
    emptyDescription: '商品可能已经调整或下架。',
    currentGalleryIndex: 0,
    galleryCounterText: '',
    actionBusy: false,
  },

  onLoad(options: Record<string, string | undefined>) {
    const productId = String(options.id || '').trim()
    this.setData({ productId })
    if (!productId) {
      this.setData({ status: 'empty' })
      return
    }
    void this.loadProduct()
  },

  async loadProduct() {
    this.setData({ status: 'loading' })
    try {
      const product = await loadMallProduct(this.data.productId)
      this.setData({
        product,
        status: 'ready',
        currentGalleryIndex: 0,
        galleryCounterText: product.images.length ? `1 / ${product.images.length}` : '',
      })
    } catch (error) {
      const message = getApiErrorMessage(error, '商品加载失败，请稍后重试')
      const notFound = message.includes('不存在') || message.includes('下架')
      this.setData({
        product: null,
        status: notFound ? 'empty' : 'error',
        emptyTitle: notFound ? '没有找到这件商品' : '商品暂时没有加载出来',
        emptyDescription: notFound ? '商品可能已经调整或下架。' : message,
      })
    }
  },

  handleGalleryChange(event: WechatMiniprogram.SwiperChange) {
    const currentGalleryIndex = Number(event.detail.current || 0)
    const galleryCount = this.data.product?.images.length || 0
    this.setData({
      currentGalleryIndex,
      galleryCounterText: galleryCount
        ? `${currentGalleryIndex + 1} / ${galleryCount}`
        : '',
    })
  },

  handleDetailImageTap(event: WechatMiniprogram.TouchEvent) {
    const product = this.data.product
    if (!product || product.detailImages.length === 0) return
    const index = Number(event.currentTarget.dataset.index || 0)
    const current = product.detailImages[index] || product.detailImages[0]
    wx.previewImage({ current, urls: product.detailImages })
  },

  async handleAddToCart() {
    const product = this.data.product
    if (!product || this.data.actionBusy) return
    if (!(await ensureAuthenticated(this, { content: '登录后可将商品加入购物车。' }))) return
    this.setData({ actionBusy: true })
    try {
      await addMallProductToCart(product.id)
      wx.showToast({ title: '已加入购物车', icon: 'success' })
    } catch (error) {
      wx.showToast({ title: getApiErrorMessage(error, '加入购物车失败'), icon: 'none' })
    } finally {
      this.setData({ actionBusy: false })
    }
  },

  async handleBuyNow() {
    const product = this.data.product
    if (!product || this.data.actionBusy) return
    if (!(await ensureAuthenticated(this, { content: '登录后可确认收货信息并继续结算。' }))) return
    setCheckoutIntent({
      source: 'buy_now',
      cartItemIds: [],
      directItems: [createMallCartItem(product)],
    })
    wx.navigateTo({ url: '/pages/cart/order-confirm/index' })
  },

  async handleOpenCart() {
    if (!(await ensureAuthenticated(this, {
      content: '登录后可查看购物车并继续结算。',
    }))) return
    wx.navigateTo({ url: '/pages/cart/index' })
  },

  handleReturnMall() {
    wx.switchTab({ url: '/pages/mall/index' })
  },

  handleRetry() {
    void this.loadProduct()
  },

})
