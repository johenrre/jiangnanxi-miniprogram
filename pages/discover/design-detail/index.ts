import {
  getDesignErrorMessage,
  hasAuthSession,
  loadCartItems,
  loadDiscoverDesignDetail,
  type DesignSection,
  type DesignWork,
} from '@/api/index'
import { prepareAppResources } from '@/services/app-resource-preloader'
import { ensureAuthenticated } from '@/services/auth-gate'
import { navigateToDiyWithSnapshot } from '@/services/diy-navigation'

type PageStatus = 'loading' | 'ready' | 'empty' | 'error'
let useDesignNavigationLocked = false

Page({
  data: {
    navTopPx: 48,
    designId: '',
    section: 'designer' as DesignSection,
    status: 'loading' as PageStatus,
    design: null as DesignWork | null,
    errorMessage: '',
    previewLoadFailed: false,
    avatarLoadFailed: false,
    trayBackgroundUrl: '/assets/bg_1.jpg',
    trayLoadFailed: false,
    cartItemCount: 0,
  },

  onLoad(options: Record<string, string | undefined>) {
    const menuButton = wx.getMenuButtonBoundingClientRect()
    const designId = String(options.id || '').trim()
    const section: DesignSection = options.section === 'customer' ? 'customer' : 'designer'
    if (!designId) {
      this.setData({ status: 'empty', designId: '', section, navTopPx: menuButton.top })
      return
    }
    this.setData({ designId, section, navTopPx: menuButton.top })
    void this.loadDetail()
  },

  onShow() {
    useDesignNavigationLocked = false
    void this.refreshCartCount()
  },

  async loadDetail(forceRefresh = false) {
    const designId = String(this.data.designId || '').trim()
    if (!designId) {
      this.setData({ status: 'empty', design: null })
      return
    }

    this.setData({
      status: 'loading',
      errorMessage: '',
      previewLoadFailed: false,
      avatarLoadFailed: false,
      trayLoadFailed: false,
    })
    try {
      const [design, appResources] = await Promise.all([
        loadDiscoverDesignDetail(
          designId,
          this.data.section,
          forceRefresh,
        ),
        prepareAppResources().catch(() => null),
      ])
      const trayBackgroundUrl = appResources?.settings.diyTrayImageUrls[0]
      this.setData({
        design,
        status: design ? 'ready' : 'empty',
        ...(trayBackgroundUrl ? { trayBackgroundUrl } : {}),
      })
    } catch (error) {
      this.setData({
        design: null,
        status: 'error',
        errorMessage: getDesignErrorMessage(error),
      })
    }
  },

  handleRetry() {
    void this.loadDetail(true)
  },

  handlePreviewError() {
    this.setData({ previewLoadFailed: true })
  },

  handleTrayError() {
    this.setData({ trayLoadFailed: true })
  },

  handleAvatarError() {
    this.setData({ avatarLoadFailed: true })
  },

  handlePhotoPreview(event: WechatMiniprogram.TouchEvent) {
    const design = this.data.design
    if (!design || design.livePhotos.length === 0) return
    const photoIndex = Number(event.currentTarget.dataset.index)
    const current = design.livePhotos[Number.isFinite(photoIndex) ? photoIndex : 0]
    wx.previewImage({ current, urls: design.livePhotos })
  },

  async refreshCartCount() {
    if (!hasAuthSession()) {
      if (this.data.cartItemCount !== 0) this.setData({ cartItemCount: 0 })
      return
    }
    try {
      const cartItems = await loadCartItems()
      this.setData({
        cartItemCount: cartItems.reduce((count, item) => count + item.quantity, 0),
      })
    } catch (error) {
      console.warn('购物车数量刷新失败', error)
    }
  },

  handleUseDesign() {
    const design = this.data.design
    if (!design || useDesignNavigationLocked) return
    if (design.pattern.length === 0) {
      wx.showToast({ title: '当前方案缺少可编辑的珠材数据', icon: 'none' })
      return
    }
    useDesignNavigationLocked = true
    navigateToDiyWithSnapshot(design.pattern, {
      fail: () => {
        useDesignNavigationLocked = false
        wx.showToast({ title: '暂时无法打开 DIY 页面', icon: 'none' })
      },
    })
  },

  async handleOpenCart() {
    if (!(await ensureAuthenticated(this, {
      content: '登录后可查看购物车并继续结算。',
    }))) return
    wx.navigateTo({ url: '/pages/cart/index' })
  },

  handleBack() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack()
      return
    }
    wx.switchTab({ url: '/pages/discover/index' })
  },

})
