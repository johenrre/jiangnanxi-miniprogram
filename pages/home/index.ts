import {
  getApiErrorMessage,
  getStoredAccountProfile,
  hasAuthSession,
  loadPersonalDesigns,
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
import { consumeHomeActivityPopupEntry } from '@/services/home-activity-popup-session'
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

interface HomeHeroSlideView {
  id: string
  imageUrl: string
  pendingImageUrl: string
  eyebrow: string
  title: string
  description: string
}

const DEFAULT_APP_NAME = '水晶定制'
type HomeAssetField =
  | 'mainHandcraftImageUrl'
  | 'mainFinishedStyleImageUrl'
  | 'shortcutInspirationImageUrl'
  | 'shortcutCartImageUrl'
  | 'shortcutOrdersImageUrl'
  | 'shortcutDesignsImageUrl'
  | 'activityImageUrl'
  | 'processPosterUrl'

const EMPTY_HOME_ASSETS: Record<HomeAssetField, string> = {
  mainHandcraftImageUrl: '',
  mainFinishedStyleImageUrl: '',
  shortcutInspirationImageUrl: '',
  shortcutCartImageUrl: '',
  shortcutOrdersImageUrl: '',
  shortcutDesignsImageUrl: '',
  activityImageUrl: '',
  processPosterUrl: '',
}
const LEGACY_APP_NAMES = new Set(['', '小程序', '晶石实验室'])
const EMPTY_HERO_SLIDE: HomeHeroSlideView = {
  id: '',
  imageUrl: '',
  pendingImageUrl: '',
  eyebrow: '',
  title: '',
  description: '',
}
let homeIdentityCountLoading = false
let shouldAutoPlayHomeMusic = false
let activityPopupEntryEligible = false

function mergeHeroSlides(slides: PublicHomeSlide[]): HomeHeroSlideView[] {
  return slides.slice(0, 5).map((slide, index) => ({
    id: slide.id,
    imageUrl: index === 0 ? slide.imageUrl : '',
    pendingImageUrl: slide.imageUrl,
    eyebrow: slide.eyebrow,
    title: slide.title,
    description: slide.description,
  }))
}

function getAppDisplayName(appName: string): string {
  const normalizedName = String(appName || '').trim()
  return LEGACY_APP_NAMES.has(normalizedName) ? DEFAULT_APP_NAME : normalizedName
}

function imageUrlFor(slots: Array<{ key: string; imageUrl: string }>, key: string, fallback: string): string {
  return slots.find((slot) => slot.key === key)?.imageUrl || fallback
}

Page({
  data: {
    appDisplayName: DEFAULT_APP_NAME,
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
    activeHeroSlide: EMPTY_HERO_SLIDE,
    heroAutoplayEnabled: true,
    heroSlides: [] as HomeHeroSlideView[],
    homeConfigStatus: 'loading' as PageStatus,
    homeConfigErrorMessage: '',
    activityPopupImageUrl: '',
    isHomeMusicPlaying: false,
    hasHomeMusic: false,
    ...EMPTY_HOME_ASSETS,
  },

  onLoad() {
    activityPopupEntryEligible = consumeHomeActivityPopupEntry()
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
      await this.loadHomeSettings(true)
    } finally {
      wx.stopPullDownRefresh()
    }
  },

  onPageScroll(event: { scrollTop: number }) {
    handleTabBarPageScroll(this, event.scrollTop)
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
      activityPopupEntryEligible = false
      this.setData({
        heroSlides: [],
        currentSlide: 0,
        activeHeroSlide: EMPTY_HERO_SLIDE,
        homeConfigStatus: 'error',
        homeConfigErrorMessage: getApiErrorMessage(error, '首页配置加载失败'),
      })
    }
  },

  applyHomeSettings(settings: PublicSettings) {
    const heroSlides = mergeHeroSlides(settings.slides)
    const activityPopupImageUrl = activityPopupEntryEligible
      ? settings.homeActivityPopupImageUrl
      : ''
    activityPopupEntryEligible = false
    const appDisplayName = getAppDisplayName(settings.appName)
    const brandLogoUrl = settings.siteTitleLogoImageUrl
      || settings.trayLogoImageUrl
      || ''
    homeBackgroundMusic.setSource(settings.homeMusicUrl)
    if (settings.homeMusicUrl && shouldAutoPlayHomeMusic) {
      shouldAutoPlayHomeMusic = false
      homeBackgroundMusic.play()
    }
    this.setData({
      appDisplayName,
      brandLogoUrl,
      horizontalLogoImageUrl: settings.horizontalLogoImageUrl,
      homeIdentityDefaultName: settings.homeIdentityName,
      mainHandcraftImageUrl: imageUrlFor(settings.homeMainEntries, 'handcraft', EMPTY_HOME_ASSETS.mainHandcraftImageUrl),
      mainFinishedStyleImageUrl: imageUrlFor(settings.homeMainEntries, 'finished-style', EMPTY_HOME_ASSETS.mainFinishedStyleImageUrl),
      shortcutInspirationImageUrl: imageUrlFor(settings.homeShortcuts, 'inspiration-atlas', EMPTY_HOME_ASSETS.shortcutInspirationImageUrl),
      shortcutCartImageUrl: imageUrlFor(settings.homeShortcuts, 'cart', EMPTY_HOME_ASSETS.shortcutCartImageUrl),
      shortcutOrdersImageUrl: imageUrlFor(settings.homeShortcuts, 'orders', EMPTY_HOME_ASSETS.shortcutOrdersImageUrl),
      shortcutDesignsImageUrl: imageUrlFor(settings.homeShortcuts, 'my-designs', EMPTY_HOME_ASSETS.shortcutDesignsImageUrl),
      activityImageUrl: settings.homeActivityImageUrl || EMPTY_HOME_ASSETS.activityImageUrl,
      activityPopupImageUrl,
      processPosterUrl: settings.homeProcessImageUrl || EMPTY_HOME_ASSETS.processPosterUrl,
      hasHomeMusic: Boolean(settings.homeMusicUrl),
      heroSlides,
      currentSlide: 0,
      activeHeroSlide: heroSlides[0] || EMPTY_HERO_SLIDE,
      homeConfigStatus: heroSlides.length > 0 ? 'ready' : 'empty',
    }, () => this.syncHomeIdentity())
  },

  handleSlideChange(event: WechatMiniprogram.CustomEvent<SwiperChangeDetail>) {
    const currentSlide = event.detail.current
    if (currentSlide === this.data.currentSlide) return
    const activeHeroSlide = this.data.heroSlides[currentSlide]
    if (!activeHeroSlide) return
    const updates: WechatMiniprogram.IAnyObject = { currentSlide, activeHeroSlide }
    if (!activeHeroSlide.imageUrl && activeHeroSlide.pendingImageUrl) {
      updates[`heroSlides[${currentSlide}].imageUrl`] = activeHeroSlide.pendingImageUrl
    }
    this.setData(updates)
  },

  handleHeroImageLoad(event: WechatMiniprogram.TouchEvent) {
    const loadedSlideId = String(event.currentTarget.dataset.slideId || '')
    const loadedImageUrl = String(event.currentTarget.dataset.imageUrl || '')
    if (!loadedSlideId || !loadedImageUrl) return
    const slideIndex = this.data.heroSlides.findIndex((slide) => slide.id === loadedSlideId)
    const slide = this.data.heroSlides[slideIndex]
    if (!slide || slide.imageUrl !== loadedImageUrl) return
    this.loadNextHeroImage(slideIndex)
  },

  loadNextHeroImage(loadedIndex: number) {
    const nextIndex = loadedIndex + 1
    const nextSlide = this.data.heroSlides[nextIndex]
    if (!nextSlide || nextSlide.imageUrl || !nextSlide.pendingImageUrl) return
    this.setData({
      [`heroSlides[${nextIndex}].imageUrl`]: nextSlide.pendingImageUrl,
    })
  },

  handleHeroImageError(event: WechatMiniprogram.TouchEvent) {
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
        [`heroSlides[${slideIndex}].pendingImageUrl`]: remoteFallbackUrl,
      })
      return
    }
    this.setData({
      [`heroSlides[${slideIndex}].imageUrl`]: '',
      [`heroSlides[${slideIndex}].pendingImageUrl`]: '',
    }, () => this.loadNextHeroImage(slideIndex))
  },

  handleHomeIdentityAvatarError() {
    const failedUrl = this.data.homeIdentityAvatarUrl
    if (!failedUrl) return
    this.setData({
      homeIdentityAvatarUrl: recoverRemoteResourceUrl(failedUrl),
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

  handleToggleHomeMusic() {
    homeBackgroundMusic.toggle()
  },

  handleStartDiy() {
    navigateToDiy()
  },

  handleOpenActivity() {
    wx.navigateTo({ url: '/pages/home/activity/index' })
  },

  handleCloseActivityPopup() {
    if (!this.data.activityPopupImageUrl) return
    this.setData({ activityPopupImageUrl: '' })
  },

  handleOpenActivityPopup() {
    if (!this.data.activityPopupImageUrl) return
    this.setData({ activityPopupImageUrl: '' })
    wx.switchTab({ url: '/pages/discover/index' })
  },

  handleActivityPopupImageError() {
    const failedUrl = this.data.activityPopupImageUrl
    if (!failedUrl) return
    this.setData({
      activityPopupImageUrl: recoverRemoteResourceUrl(failedUrl),
    })
  },

  handlePreviewProcessPoster() {
    const processPosterUrl = this.data.processPosterUrl
    if (!processPosterUrl) return
    wx.previewImage({
      current: processPosterUrl,
      urls: [processPosterUrl],
      fail: () => {
        wx.showToast({ title: '流程图片暂时无法打开', icon: 'none' })
      },
    })
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
