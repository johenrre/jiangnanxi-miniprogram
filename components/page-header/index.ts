const TAB_PAGE_PATHS = new Set([
  '/pages/home/index',
  '/pages/discover/index',
  '/pages/mall/index',
  '/pages/profile/index',
])

Component({
  properties: {
    title: {
      type: String,
      value: '',
    },
    showBack: {
      type: Boolean,
      value: true,
    },
    theme: {
      type: String,
      value: 'light',
    },
    fallbackUrl: {
      type: String,
      value: '/pages/profile/index',
    },
    badge: {
      type: String,
      value: '',
    },
  },

  data: {
    menuTopPx: 48,
    menuHeightPx: 32,
  },

  lifetimes: {
    attached() {
      const menuButton = wx.getMenuButtonBoundingClientRect()
      this.setData({
        menuTopPx: menuButton.top,
        menuHeightPx: menuButton.height,
      })
    },
  },

  methods: {
    handleBack() {
      this.triggerEvent('back')
      if (getCurrentPages().length > 1) {
        wx.navigateBack()
        return
      }
      const fallbackUrl = String(this.properties.fallbackUrl || '').trim()
        || '/pages/profile/index'
      if (TAB_PAGE_PATHS.has(fallbackUrl)) {
        wx.switchTab({ url: fallbackUrl })
        return
      }
      wx.redirectTo({ url: fallbackUrl })
    },
  },
})
