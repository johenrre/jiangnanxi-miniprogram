import {
  getDesignErrorMessage,
  getApiErrorMessage,
  getStoredAccountProfile,
  hasAuthSession,
  loadDiscoverDesignWorks,
  loadPersonalDesigns,
  type DesignWork,
  type PublicHomeSlide,
  type PublicSettings,
} from '@/api/index'
import {
  handleTabBarPageScroll,
  syncTabBarOnShow,
} from '@/utils/tab-bar-visibility'
import { ensureAuthenticated } from '@/services/auth-gate'
import { homeBackgroundMusic } from '@/services/home-background-music'
import { navigateToDiy } from '@/services/diy-navigation'
import {
  consumePreparedHomeEntry,
  prepareAppResources,
} from '@/services/app-resource-preloader'
import { recoverRemoteResourceUrl } from '@/utils/resource-cache'
import {
  DEFAULT_ACCOUNT_AVATAR_URL,
  DEFAULT_ACCOUNT_NAME,
  getAccountAvatarUrl,
  getAccountDisplayName,
} from '@/utils/account-display'

type PageStatus = 'loading' | 'ready' | 'empty' | 'error'

interface SwiperChangeDetail {
  current: number
}

interface DesignSelectEventDetail {
  designId: string
}

interface HomeHeroSlideView {
  id: string
  imageUrl: string
  textImageUrl: string
  route: string
}

type HomeAssetField =
  | 'mainHandcraftImageUrl'
  | 'mainFinishedStyleImageUrl'
  | 'shortcutInspirationImageUrl'
  | 'shortcutCartImageUrl'
  | 'shortcutOrdersImageUrl'
  | 'shortcutDesignsImageUrl'

const EMPTY_HOME_ASSETS: Record<HomeAssetField, string> = {
  mainHandcraftImageUrl: '',
  mainFinishedStyleImageUrl: '',
  shortcutInspirationImageUrl: '',
  shortcutCartImageUrl: '',
  shortcutOrdersImageUrl: '',
  shortcutDesignsImageUrl: '',
}
const TAB_PAGE_PATHS = new Set([
  '/pages/home/index',
  '/pages/discover/index',
  '/pages/mall/index',
  '/pages/profile/index',
])
let homeIdentityCountLoading = false
let shouldAutoPlayHomeMusic = false

function mergeHeroSlides(slides: PublicHomeSlide[]): HomeHeroSlideView[] {
  return slides.slice(0, 5).map((slide) => ({
    id: slide.id,
    imageUrl: slide.imageUrl,
    textImageUrl: slide.textImageUrl,
    route: slide.route,
  }))
}

function normalizeSlideRoute(value: unknown): string {
  const route = String(value || '').trim()
  if (route.length > 500) return ''
  return /^\/pages\/[A-Za-z0-9_/-]+(?:\?[^#\s]*)?$/.test(route) ? route : ''
}

function imageUrlFor(slots: Array<{ key: string; imageUrl: string }>, key: string, fallback: string): string {
  return slots.find((slot) => slot.key === key)?.imageUrl || fallback
}

Page({
  data: {
    brandLogoUrl: DEFAULT_ACCOUNT_AVATAR_URL,
    horizontalLogoImageUrl: '',
    homeIdentityDefaultName: DEFAULT_ACCOUNT_NAME,
    homeIdentityName: DEFAULT_ACCOUNT_NAME,
    homeIdentityAvatarUrl: DEFAULT_ACCOUNT_AVATAR_URL,
    homeIdentityDescription: '登录后保存设计与订单',
    homeIdentityWorkCount: 0,
    menuButtonTopPx: 48,
    searchButtonRightPx: 106,
    searchButtonSizePx: 32,
    currentSlide: 0,
    heroAutoplayEnabled: true,
    heroSlides: [] as HomeHeroSlideView[],
    homeConfigStatus: 'loading' as PageStatus,
    homeConfigErrorMessage: '',
    designerStatus: 'loading' as PageStatus,
    designerWorks: [] as DesignWork[],
    designerCurrentPage: 0,
    designerPageSize: 18,
    designerTotal: 0,
    designerHasMore: false,
    isDesignerLoadingMore: false,
    designerLoadMoreFailed: false,
    designerErrorMessage: '',
    designerTrayBackgroundUrl: '/assets/bg_1.jpg',
    isHomeMusicPlaying: false,
    hasHomeMusic: false,
    ...EMPTY_HOME_ASSETS,
  },

  onLoad() {
    shouldAutoPlayHomeMusic = true
    const menuButton = wx.getMenuButtonBoundingClientRect()
    const modernWx = wx as unknown as {
      getWindowInfo?: () => { windowWidth?: number }
    }
    const windowWidth = modernWx.getWindowInfo?.().windowWidth || 375
    this.setData({
      menuButtonTopPx: menuButton.top,
      searchButtonRightPx: Math.max(92, windowWidth - menuButton.left + 12),
      searchButtonSizePx: Math.max(30, menuButton.height),
    })
    homeBackgroundMusic.attach((isHomeMusicPlaying) => {
      this.setData({ isHomeMusicPlaying })
    })
    void this.loadHomeSettings()
    void this.loadHomeDesignerWorks()
  },

  onShow() {
    syncTabBarOnShow(this, 0)
    this.syncHomeIdentity()
    if (!this.data.heroAutoplayEnabled) {
      this.setData({ heroAutoplayEnabled: true })
    }
  },

  syncHomeIdentity() {
    const isLoggedIn = hasAuthSession()
    const profile = isLoggedIn ? getStoredAccountProfile() : null
    this.setData({
      homeIdentityName: getAccountDisplayName(profile, this.data.homeIdentityDefaultName),
      homeIdentityAvatarUrl: getAccountAvatarUrl(profile, this.data.brandLogoUrl),
      homeIdentityDescription: isLoggedIn
        ? '继续你的专属晶石创作'
        : '登录后保存设计与订单',
      ...(!isLoggedIn ? { homeIdentityWorkCount: 0 } : {}),
    })
    if (isLoggedIn) void this.loadHomeIdentityWorkCount()
  },

  async loadHomeIdentityWorkCount() {
    if (homeIdentityCountLoading || !hasAuthSession()) return
    homeIdentityCountLoading = true
    try {
      const result = await loadPersonalDesigns()
      if (!hasAuthSession()) return
      this.setData({
        homeIdentityWorkCount: Math.max(0, result.total || result.items.length),
      })
    } catch {
      // 首页的辅助统计失败时保持现有值，不打断首页主要内容。
    } finally {
      homeIdentityCountLoading = false
    }
  },

  onHide() {
    if (this.data.heroAutoplayEnabled) {
      this.setData({ heroAutoplayEnabled: false })
    }
  },

  onUnload() {
    shouldAutoPlayHomeMusic = false
    homeBackgroundMusic.detach()
  },

  async onPullDownRefresh() {
    try {
      await Promise.all([
        this.loadHomeSettings(true),
        this.loadHomeDesignerWorks(true),
      ])
    } finally {
      wx.stopPullDownRefresh()
    }
  },

  onPageScroll(event: { scrollTop: number }) {
    handleTabBarPageScroll(this, event.scrollTop)
  },

  onReachBottom() {
    void this.loadMoreHomeDesignerWorks()
  },

  async loadHomeSettings(forceRefresh = false) {
    if (!forceRefresh) {
      const preparedHomeEntry = consumePreparedHomeEntry()
      if (preparedHomeEntry) {
        this.applyHomeSettings(preparedHomeEntry.settings)
        return
      }
    }
    this.setData({
      homeConfigStatus: 'loading',
      homeConfigErrorMessage: '',
    })
    try {
      const { settings } = await prepareAppResources(forceRefresh)
      if (!forceRefresh) consumePreparedHomeEntry()
      this.applyHomeSettings(settings)
    } catch (error) {
      this.setData({
        heroSlides: [],
        currentSlide: 0,
        homeConfigStatus: 'error',
        homeConfigErrorMessage: getApiErrorMessage(error, '首页配置加载失败'),
      })
    }
  },

  applyHomeSettings(settings: PublicSettings) {
    const heroSlides = mergeHeroSlides(settings.slides)
    const brandLogoUrl = settings.siteTitleLogoImageUrl
      || settings.trayLogoImageUrl
      || ''
    homeBackgroundMusic.setSource(settings.homeMusicUrl)
    if (settings.homeMusicUrl && shouldAutoPlayHomeMusic) {
      shouldAutoPlayHomeMusic = false
      homeBackgroundMusic.play()
    }
    this.setData({
      brandLogoUrl,
      horizontalLogoImageUrl: settings.horizontalLogoImageUrl,
      homeIdentityDefaultName: settings.homeIdentityName,
      mainHandcraftImageUrl: imageUrlFor(settings.homeMainEntries, 'handcraft', EMPTY_HOME_ASSETS.mainHandcraftImageUrl),
      mainFinishedStyleImageUrl: imageUrlFor(settings.homeMainEntries, 'finished-style', EMPTY_HOME_ASSETS.mainFinishedStyleImageUrl),
      shortcutInspirationImageUrl: imageUrlFor(settings.homeShortcuts, 'inspiration-atlas', EMPTY_HOME_ASSETS.shortcutInspirationImageUrl),
      shortcutCartImageUrl: imageUrlFor(settings.homeShortcuts, 'cart', EMPTY_HOME_ASSETS.shortcutCartImageUrl),
      shortcutOrdersImageUrl: imageUrlFor(settings.homeShortcuts, 'orders', EMPTY_HOME_ASSETS.shortcutOrdersImageUrl),
      shortcutDesignsImageUrl: imageUrlFor(settings.homeShortcuts, 'my-designs', EMPTY_HOME_ASSETS.shortcutDesignsImageUrl),
      designerTrayBackgroundUrl: settings.diyTrayImageUrls[0] || '/assets/bg_1.jpg',
      hasHomeMusic: Boolean(settings.homeMusicUrl),
      heroSlides,
      currentSlide: 0,
      homeConfigStatus: heroSlides.length > 0 ? 'ready' : 'empty',
    }, () => this.syncHomeIdentity())
  },

  async loadHomeDesignerWorks(forceRefresh = false) {
    this.setData({
      designerStatus: 'loading',
      designerWorks: [],
      designerCurrentPage: 0,
      designerTotal: 0,
      designerHasMore: false,
      isDesignerLoadingMore: false,
      designerLoadMoreFailed: false,
      designerErrorMessage: '',
    })
    try {
      const designPage = await loadDiscoverDesignWorks('designer', forceRefresh)
      this.setData({
        designerWorks: designPage.items,
        designerCurrentPage: designPage.page,
        designerPageSize: designPage.pageSize,
        designerTotal: designPage.total,
        designerHasMore: designPage.items.length > 0
          && designPage.page * designPage.pageSize < designPage.total,
        designerStatus: designPage.items.length > 0 ? 'ready' : 'empty',
      })
    } catch (error) {
      this.setData({
        designerWorks: [],
        designerStatus: 'error',
        designerErrorMessage: getDesignErrorMessage(error),
      })
    }
  },

  async loadMoreHomeDesignerWorks() {
    if (
      this.data.designerStatus !== 'ready'
      || !this.data.designerHasMore
      || this.data.isDesignerLoadingMore
    ) return

    const nextPage = this.data.designerCurrentPage + 1
    this.setData({
      isDesignerLoadingMore: true,
      designerLoadMoreFailed: false,
    })
    try {
      const designPage = await loadDiscoverDesignWorks(
        'designer',
        false,
        nextPage,
        this.data.designerPageSize,
      )
      const knownDesignIds = new Set(this.data.designerWorks.map((design) => design.id))
      const newDesigns = designPage.items.filter((design) => !knownDesignIds.has(design.id))
      const currentPage = Math.max(nextPage, designPage.page)
      this.setData({
        designerWorks: [...this.data.designerWorks, ...newDesigns],
        designerCurrentPage: currentPage,
        designerPageSize: designPage.pageSize,
        designerTotal: designPage.total,
        designerHasMore: designPage.items.length > 0
          && currentPage * designPage.pageSize < designPage.total,
        isDesignerLoadingMore: false,
      })
    } catch {
      this.setData({
        isDesignerLoadingMore: false,
        designerLoadMoreFailed: true,
      })
    }
  },

  handleSlideChange(event: WechatMiniprogram.CustomEvent<SwiperChangeDetail>) {
    const currentSlide = event.detail.current
    if (currentSlide === this.data.currentSlide) return
    if (!this.data.heroSlides[currentSlide]) return
    this.setData({ currentSlide })
  },

  handleHeroBackgroundError(event: WechatMiniprogram.TouchEvent) {
    const failedSlideId = String(event.currentTarget.dataset.slideId || '')
    const failedImageUrl = String(event.currentTarget.dataset.imageUrl || '')
    if (!failedSlideId || !failedImageUrl) return
    const slideIndex = this.data.heroSlides.findIndex((slide) => slide.id === failedSlideId)
    const slide = this.data.heroSlides[slideIndex]
    if (!slide || slide.imageUrl !== failedImageUrl) return
    const remoteFallbackUrl = recoverRemoteResourceUrl(failedImageUrl)
    if (remoteFallbackUrl) {
      this.setData({
        [`heroSlides[${slideIndex}].imageUrl`]: remoteFallbackUrl,
      })
      return
    }
    this.setData({
      [`heroSlides[${slideIndex}].imageUrl`]: '',
    })
  },

  handleHeroTextImageError(event: WechatMiniprogram.TouchEvent) {
    const failedSlideId = String(event.currentTarget.dataset.slideId || '')
    const failedImageUrl = String(event.currentTarget.dataset.imageUrl || '')
    if (!failedSlideId || !failedImageUrl) return
    const slideIndex = this.data.heroSlides.findIndex((slide) => slide.id === failedSlideId)
    const slide = this.data.heroSlides[slideIndex]
    if (!slide || slide.textImageUrl !== failedImageUrl) return
    this.setData({
      [`heroSlides[${slideIndex}].textImageUrl`]: recoverRemoteResourceUrl(failedImageUrl),
    })
  },

  handleHeroSlideTap(event: WechatMiniprogram.TouchEvent) {
    const url = normalizeSlideRoute(event.currentTarget.dataset.route)
    if (!url) return
    const pagePath = url.split('?')[0] || ''
    const fail = () => wx.showToast({ title: '页面暂时无法打开', icon: 'none' })
    if (TAB_PAGE_PATHS.has(pagePath)) {
      if (url.includes('?')) wx.reLaunch({ url, fail })
      else wx.switchTab({ url: pagePath, fail })
      return
    }
    wx.navigateTo({ url, fail })
  },

  handleHomeIdentityAvatarError() {
    const failedUrl = this.data.homeIdentityAvatarUrl
    if (!failedUrl) return
    this.setData({
      homeIdentityAvatarUrl: recoverRemoteResourceUrl(failedUrl) || DEFAULT_ACCOUNT_AVATAR_URL,
    })
  },

  handleBrandLogoError() {
    if (!this.data.brandLogoUrl) return
    const failedUrl = this.data.brandLogoUrl
    const remoteFallbackUrl = recoverRemoteResourceUrl(failedUrl)
    this.setData({
      brandLogoUrl: remoteFallbackUrl,
      ...(this.data.homeIdentityAvatarUrl === failedUrl
        ? { homeIdentityAvatarUrl: remoteFallbackUrl }
        : {}),
    })
  },

  handleHorizontalLogoError() {
    const failedUrl = this.data.horizontalLogoImageUrl
    if (!failedUrl) return
    this.setData({
      horizontalLogoImageUrl: recoverRemoteResourceUrl(failedUrl),
    })
  },

  handleHomeAssetError(event: WechatMiniprogram.TouchEvent) {
    const field = String(event.currentTarget.dataset.asset || '') as HomeAssetField
    if (!(field in EMPTY_HOME_ASSETS)) return
    const failedUrl = this.data[field]
    if (!failedUrl) return
    this.setData({
      [field]: recoverRemoteResourceUrl(failedUrl) || EMPTY_HOME_ASSETS[field],
    })
  },

  handleRetrySettings() {
    void this.loadHomeSettings(true)
  },

  handleRetryDesignerWorks() {
    void this.loadHomeDesignerWorks(true)
  },

  handleRetryMoreDesignerWorks() {
    void this.loadMoreHomeDesignerWorks()
  },

  handleHomeDesignerSelect(event: WechatMiniprogram.CustomEvent<DesignSelectEventDetail>) {
    const designId = String(event.detail.designId || '').trim()
    if (!designId) return
    wx.navigateTo({
      url: `/pages/discover/design-detail/index?id=${encodeURIComponent(designId)}&section=designer`,
    })
  },

  handleToggleHomeMusic() {
    homeBackgroundMusic.toggle()
  },

  handleStartDiy() {
    navigateToDiy()
  },

  handleSearch() {
    wx.switchTab({ url: '/pages/discover/index' })
  },

  handleViewAllDesigns() {
    wx.setStorageSync('discoverSection', 'designer')
    wx.switchTab({ url: '/pages/discover/index' })
  },

  handleOpenProfile() {
    wx.switchTab({ url: '/pages/profile/index' })
  },

  async handleOpenCart() {
    if (!(await ensureAuthenticated(this, {
      content: '登录后可查看购物车并继续结算。',
    }))) return
    wx.navigateTo({
      url: '/pages/cart/index',
      fail: () => wx.showToast({ title: '购物车暂时无法打开', icon: 'none' }),
    })
  },

  async handleProtectedEntry(event: WechatMiniprogram.TouchEvent) {
    const url = String(event.currentTarget.dataset.url || '')
    const content = String(event.currentTarget.dataset.loginCopy || '')
    if (!url || !(await ensureAuthenticated(this, { content }))) return
    wx.navigateTo({ url })
  },

})
