import {
  clearAuthSession,
  getApiErrorMessage,
  getStoredAccountProfile,
  hasAuthSession,
  isApiUnauthorized,
  loadPublicSettings,
  loadProfile,
  type AccountProfile,
} from '@/api/index'
import {
  handleTabBarPageScroll,
  syncTabBarOnShow,
} from '@/utils/tab-bar-visibility'
import {
  DEFAULT_ACCOUNT_AVATAR_URL,
  DEFAULT_ACCOUNT_NAME,
  getAccountDisplayName,
} from '@/utils/account-display'
import { resolvePreparedResourceUrl } from '@/services/app-resource-preloader'
import { ensureAuthenticated } from '@/services/auth-gate'
import {
  openLegalCenter,
} from '@/utils/legal'

type DashboardStatus = 'idle' | 'loading' | 'ready' | 'error'

interface ProfileEntry {
  id: string
  iconUrl: string
  label: string
  description: string
  url: string
}

const profileEntries: ProfileEntry[] = [
  {
    id: 'cart',
    iconUrl: '/assets/icons/profile-cart.svg',
    label: '购物车',
    description: '确认已选设计与商品规格',
    url: '/pages/cart/index',
  },
  {
    id: 'my-designs',
    iconUrl: '/assets/icons/profile-designs.svg',
    label: '我的设计',
    description: '继续编辑已保存的方案',
    url: '/pages/profile/my-designs/index',
  },
  {
    id: 'orders',
    iconUrl: '/assets/icons/profile-orders.svg',
    label: '我的订单',
    description: '付款、制作与收货进度',
    url: '/pages/profile/orders/index',
  },
  {
    id: 'addresses',
    iconUrl: '/assets/icons/profile-address.svg',
    label: '收货地址',
    description: '管理常用收件信息',
    url: '/pages/profile/addresses/index',
  },
  {
    id: 'after-sales',
    iconUrl: '/assets/icons/profile-after-sales.svg',
    label: '退款 / 售后',
    description: '查询与处理售后申请',
    url: '/pages/profile/after-sales/index',
  },
]

Page({
  data: {
    isLoggedIn: false,
    dashboardStatus: 'idle' as DashboardStatus,
    profile: null as AccountProfile | null,
    defaultAccountName: DEFAULT_ACCOUNT_NAME,
    profileDisplayName: DEFAULT_ACCOUNT_NAME,
    defaultAvatarUrl: DEFAULT_ACCOUNT_AVATAR_URL,
    avatarLoadFailed: false,
    errorMessage: '',
    profileEntries,
  },

  onShow() {
    syncTabBarOnShow(this, 4)
    this.syncAccountState()
    void this.loadBranding()
  },

  onPageScroll(event: { scrollTop: number }) {
    handleTabBarPageScroll(this, event.scrollTop)
  },

  syncAccountState() {
    const isLoggedIn = hasAuthSession()
    const storedProfile = isLoggedIn ? getStoredAccountProfile() : null
    const hasVisibleProfile = isLoggedIn && Boolean(this.data.profile || storedProfile)
    const visibleProfile = isLoggedIn ? (storedProfile || this.data.profile) : null
    this.setData({
      isLoggedIn,
      profile: visibleProfile,
      profileDisplayName: getAccountDisplayName(visibleProfile, this.data.defaultAccountName),
      avatarLoadFailed: false,
      dashboardStatus: isLoggedIn ? (hasVisibleProfile ? 'ready' : 'loading') : 'idle',
      errorMessage: '',
    })
    if (isLoggedIn) void this.loadDashboard(hasVisibleProfile)
  },

  async loadDashboard(silent = false) {
    if (!silent) this.setData({ dashboardStatus: 'loading', errorMessage: '' })
    try {
      const profile = await loadProfile()
      this.setData({
        profile,
        profileDisplayName: getAccountDisplayName(profile, this.data.defaultAccountName),
        dashboardStatus: 'ready',
        avatarLoadFailed: false,
      })
    } catch (error) {
      if (isApiUnauthorized(error)) {
        clearAuthSession()
        this.setData({
          isLoggedIn: false,
          profile: null,
          profileDisplayName: this.data.defaultAccountName,
          dashboardStatus: 'idle',
          errorMessage: '',
        })
        wx.showToast({ title: '登录已失效，请重新登录', icon: 'none' })
        return
      }
      if (!silent) {
        this.setData({
          dashboardStatus: 'error',
          errorMessage: getApiErrorMessage(error, '个人资料加载失败，请稍后重试'),
        })
      }
    }
  },

  async handleLogin() {
    if (!(await ensureAuthenticated(this, {
      content: '登录后可同步设计、订单和收货信息。',
    }))) return
    this.syncAccountState()
  },

  async handleEntryTap(event: WechatMiniprogram.TouchEvent) {
    const url = String(event.currentTarget.dataset.url || '')
    if (!url) return
    const content = String(event.currentTarget.dataset.loginCopy || '')
    if (!(await ensureAuthenticated(this, { content }))) return
    this.syncAccountState()
    wx.navigateTo({ url })
  },

  handleOpenLegalCenter() {
    openLegalCenter()
  },

  async loadBranding() {
    try {
      const settings = await loadPublicSettings()
      const defaultAccountName = settings.homeIdentityName || DEFAULT_ACCOUNT_NAME
      this.setData({
        defaultAccountName,
        profileDisplayName: getAccountDisplayName(this.data.profile, defaultAccountName),
        defaultAvatarUrl: resolvePreparedResourceUrl(
          settings.siteTitleLogoImageUrl
            || settings.trayLogoImageUrl
            || DEFAULT_ACCOUNT_AVATAR_URL,
        ),
      })
    } catch {
      this.setData({
        defaultAccountName: DEFAULT_ACCOUNT_NAME,
        profileDisplayName: getAccountDisplayName(this.data.profile),
        defaultAvatarUrl: DEFAULT_ACCOUNT_AVATAR_URL,
      })
    }
  },

  handleAvatarError() {
    this.setData({ avatarLoadFailed: true })
  },

  handleDefaultAvatarError() {
    if (this.data.defaultAvatarUrl === DEFAULT_ACCOUNT_AVATAR_URL) return
    this.setData({ defaultAvatarUrl: DEFAULT_ACCOUNT_AVATAR_URL })
  },

  handleRetry() {
    void this.loadDashboard()
  },
})
