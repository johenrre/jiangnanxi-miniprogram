import {
  deletePersonalDesign,
  getApiErrorMessage,
  hasAuthSession,
  loadPersonalDesigns,
  type PersonalDesign,
} from '@/api/index'
import { navigateToDiyWithSnapshot } from '@/services/diy-navigation'
import { prepareAppResources } from '@/services/app-resource-preloader'
import { ensureAuthenticated } from '@/services/auth-gate'

type DesignListStatus = 'login' | 'loading' | 'ready' | 'empty' | 'error'
let designNavigationLocked = false

Page({
  data: {
    status: 'loading' as DesignListStatus,
    designs: [] as PersonalDesign[],
    total: 0,
    errorMessage: '',
    failedImages: {} as Record<string, boolean>,
    deletingIds: {} as Record<string, boolean>,
    trayBackgroundUrl: '/assets/bg_1.jpg',
    trayLoadFailed: false,
  },

  onLoad() {
    void this.loadSharedPresentation()
  },

  onShow() {
    designNavigationLocked = false
    if (!hasAuthSession()) {
      this.setData({ status: 'login', designs: [], total: 0 })
      return
    }
    if (this.data.status !== 'ready') void this.loadData()
  },

  async loadData() {
    this.setData({ status: 'loading', errorMessage: '' })
    try {
      const result = await loadPersonalDesigns()
      this.setData({
        designs: result.items,
        total: result.total,
        status: result.items.length > 0 ? 'ready' : 'empty',
        failedImages: {},
      })
    } catch (error) {
      this.setData({
        designs: [],
        total: 0,
        status: 'error',
        errorMessage: getApiErrorMessage(error, '我的设计加载失败，请稍后重试'),
      })
    }
  },

  async loadSharedPresentation() {
    try {
      const { settings } = await prepareAppResources()
      this.setData({
        trayBackgroundUrl: settings.diyTrayImageUrls[0] || '/assets/bg_1.jpg',
        trayLoadFailed: false,
      })
    } catch {
      this.setData({ trayBackgroundUrl: '/assets/bg_1.jpg', trayLoadFailed: false })
    }
  },

  handleImageError(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    if (!id) return
    this.setData({ [`failedImages.${id}`]: true })
  },

  handleTrayError() {
    this.setData({ trayLoadFailed: true })
  },

  handleDesignTap(event: WechatMiniprogram.TouchEvent) {
    const code = String(event.currentTarget.dataset.code || '').trim()
    if (designNavigationLocked) return
    if (!code) {
      wx.showToast({ title: '当前设计缺少有效编号', icon: 'none' })
      return
    }
    const design = this.data.designs.find((item) => item.code === code)
    if (!design || design.pattern.length === 0) {
      wx.showToast({ title: '当前设计缺少可编辑的珠材数据', icon: 'none' })
      return
    }

    designNavigationLocked = true
    navigateToDiyWithSnapshot(design.pattern, {
      fail: () => {
        designNavigationLocked = false
        wx.showToast({ title: '暂时无法打开该设计', icon: 'none' })
      },
    })
  },

  handleDeleteTap(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '').trim()
    const code = String(event.currentTarget.dataset.code || '').trim()
    const name = String(event.currentTarget.dataset.name || '这个设计').trim()
    if (!id || !code || this.data.deletingIds[id]) return

    wx.showModal({
      title: '删除这个设计？',
      content: `“${name}”删除后无法恢复。`,
      confirmText: '删除',
      confirmColor: '#a66f67',
      success: (result) => {
        if (result.confirm) void this.deleteDesign(id, code)
      },
    })
  },

  async deleteDesign(id: string, code: string) {
    this.setData({ [`deletingIds.${id}`]: true })
    try {
      await deletePersonalDesign(code)
      const designs = this.data.designs.filter((item) => item.id !== id)
      this.setData({
        designs,
        total: Math.max(0, this.data.total - 1),
        status: designs.length > 0 ? 'ready' : 'empty',
        [`deletingIds.${id}`]: false,
      })
      wx.showToast({ title: '已删除', icon: 'success' })
    } catch (error) {
      this.setData({ [`deletingIds.${id}`]: false })
      wx.showToast({
        title: getApiErrorMessage(error, '删除失败，请稍后重试'),
        icon: 'none',
      })
    }
  },

  handleRetry() {
    void this.loadData()
  },

  async handleGoLogin() {
    if (!(await ensureAuthenticated(this, {
      content: '登录后可查看并继续编辑已保存的设计。',
    }))) return
    await this.loadData()
  },
})
