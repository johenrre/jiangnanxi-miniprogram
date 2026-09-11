import {
  getDesignErrorMessage,
  loadDiscoverDesignWorks,
  type DesignSection,
  type DesignWork,
} from '@/api/index'
import {
  handleTabBarPageScroll,
  syncTabBarOnShow,
} from '@/utils/tab-bar-visibility'
import { prepareAppResources } from '@/services/app-resource-preloader'

type PageStatus = 'loading' | 'ready' | 'empty' | 'error'

interface DesignSelectEventDetail {
  designId: string
  section: DesignSection
}

Page({
  data: {
    menuButtonTopPx: 48,
    section: 'designer' as DesignSection,
    status: 'loading' as PageStatus,
    designWorks: [] as DesignWork[],
    currentPage: 0,
    pageSize: 18,
    total: 0,
    hasMore: false,
    isLoadingMore: false,
    loadMoreFailed: false,
    trayBackgroundUrl: '/assets/bg_1.jpg',
    errorMessage: '',
  },

  onLoad() {
    const menuButton = wx.getMenuButtonBoundingClientRect()
    const requestedSection = wx.getStorageSync('discoverSection')
    const section: DesignSection = requestedSection === 'customer' ? 'customer' : 'designer'
    wx.removeStorageSync('discoverSection')
    this.setData({ menuButtonTopPx: menuButton.top, section })
    void this.loadSharedPresentation()
    void this.loadDesigns(section)
  },

  async loadSharedPresentation() {
    try {
      const { settings } = await prepareAppResources()
      const trayBackgroundUrl = settings.diyTrayImageUrls[0]
      if (trayBackgroundUrl) this.setData({ trayBackgroundUrl })
    } catch {
      // 公共配置失败时保留内置盘子图，作品列表仍可独立使用。
    }
  },

  onShow() {
    syncTabBarOnShow(this, 1)

    const requestedSection = wx.getStorageSync('discoverSection')
    const section: DesignSection = requestedSection === 'customer' || requestedSection === 'designer'
      ? requestedSection
      : this.data.section
    if (requestedSection === 'customer' || requestedSection === 'designer') {
      wx.removeStorageSync('discoverSection')
    }
    if (section !== this.data.section) {
      this.setData({ section })
      void this.loadDesigns(section)
    }
  },

  onPageScroll(event: { scrollTop: number }) {
    handleTabBarPageScroll(this, event.scrollTop)
  },

  onReachBottom() {
    void this.loadMoreDesigns()
  },

  async loadDesigns(section: DesignSection, forceRefresh = false) {
    this.setData({
      status: 'loading',
      errorMessage: '',
      designWorks: [],
      currentPage: 0,
      total: 0,
      hasMore: false,
      isLoadingMore: false,
      loadMoreFailed: false,
    })
    try {
      const designPage = await loadDiscoverDesignWorks(section, forceRefresh)
      if (section !== this.data.section) return
      this.setData({
        designWorks: designPage.items,
        currentPage: designPage.page,
        pageSize: designPage.pageSize,
        total: designPage.total,
        hasMore: designPage.items.length > 0 && designPage.items.length < designPage.total,
        status: designPage.items.length > 0 ? 'ready' : 'empty',
      })
    } catch (error) {
      if (section !== this.data.section) return
      this.setData({
        designWorks: [],
        status: 'error',
        errorMessage: getDesignErrorMessage(error),
      })
    }
  },

  async loadMoreDesigns() {
    if (this.data.status !== 'ready' || !this.data.hasMore || this.data.isLoadingMore) return

    const section = this.data.section
    const nextPage = this.data.currentPage + 1
    this.setData({ isLoadingMore: true, loadMoreFailed: false })

    try {
      const designPage = await loadDiscoverDesignWorks(
        section,
        false,
        nextPage,
        this.data.pageSize,
      )
      if (section !== this.data.section) return

      const knownDesignIds = new Set(this.data.designWorks.map((design) => design.id))
      const newDesigns = designPage.items.filter((design) => !knownDesignIds.has(design.id))
      const currentPage = Math.max(nextPage, designPage.page)
      this.setData({
        designWorks: [...this.data.designWorks, ...newDesigns],
        currentPage,
        pageSize: designPage.pageSize,
        total: designPage.total,
        hasMore: designPage.items.length > 0
          && currentPage * designPage.pageSize < designPage.total,
        isLoadingMore: false,
      })
    } catch {
      if (section !== this.data.section) return
      this.setData({ isLoadingMore: false, loadMoreFailed: true })
    }
  },

  handleSectionSelect(event: WechatMiniprogram.TouchEvent) {
    const section = event.currentTarget.dataset.section as DesignSection
    if (section !== 'customer' && section !== 'designer') return
    if (section === this.data.section) return
    this.setData({ section })
    void this.loadDesigns(section)
  },

  handleRetry() {
    void this.loadDesigns(this.data.section, true)
  },

  handleLoadMoreRetry() {
    void this.loadMoreDesigns()
  },

  handleDesignSelect(event: WechatMiniprogram.CustomEvent<DesignSelectEventDetail>) {
    const designId = String(event.detail.designId || '').trim()
    const section = event.detail.section === 'customer' ? 'customer' : 'designer'
    if (!designId) return
    wx.navigateTo({
      url: `/pages/discover/design-detail/index?id=${encodeURIComponent(designId)}&section=${section}`,
    })
  },

})
