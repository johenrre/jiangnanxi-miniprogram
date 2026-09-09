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

  async loadDesigns(section: DesignSection, forceRefresh = false) {
    this.setData({ status: 'loading', errorMessage: '', designWorks: [] })
    try {
      const designPage = await loadDiscoverDesignWorks(section, forceRefresh)
      if (section !== this.data.section) return
      this.setData({
        designWorks: designPage.items,
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

  handleDesignSelect(event: WechatMiniprogram.CustomEvent<DesignSelectEventDetail>) {
    const designId = String(event.detail.designId || '').trim()
    const section = event.detail.section === 'customer' ? 'customer' : 'designer'
    if (!designId) return
    wx.navigateTo({
      url: `/pages/discover/design-detail/index?id=${encodeURIComponent(designId)}&section=${section}`,
    })
  },

})
