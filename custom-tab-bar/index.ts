import { appSound } from '@/services/sound'
import { navigateToDiy } from '@/services/diy-navigation'
import {
  getActiveThemeClass,
  subscribeTheme,
} from '@/services/theme'

interface TabItem {
  pagePath: string
  text: string
  iconPath: string
  selectedIconPath: string
  isPrimary?: boolean
}

const tabItems: TabItem[] = [
  {
    pagePath: '/pages/home/index',
    text: '首页',
    iconPath: '/assets/icons/gongxiaozhu-nav/home-muted.png',
    selectedIconPath: '/assets/icons/gongxiaozhu-nav/home-active.png',
  },
  {
    pagePath: '/pages/discover/index',
    text: '灵感',
    iconPath: '/assets/icons/gongxiaozhu-nav/discover-muted.png',
    selectedIconPath: '/assets/icons/gongxiaozhu-nav/discover-active.png',
  },
  {
    pagePath: '/pages/diy/index',
    text: 'DIY',
    iconPath: '/assets/icons/gongxiaozhu-nav/diy-muted.png',
    selectedIconPath: '/assets/icons/gongxiaozhu-nav/diy-active.png',
    isPrimary: true,
  },
  {
    pagePath: '/pages/mall/index',
    text: '商城',
    iconPath: '/assets/icons/gongxiaozhu-nav/cart-muted.png',
    selectedIconPath: '/assets/icons/gongxiaozhu-nav/cart-active.png',
  },
  {
    pagePath: '/pages/profile/index',
    text: '我的',
    iconPath: '/assets/icons/gongxiaozhu-nav/profile-muted.png',
    selectedIconPath: '/assets/icons/gongxiaozhu-nav/profile-active.png',
  },
]

function getCurrentPagePath(): string {
  const pages = getCurrentPages()
  const currentPage = pages[pages.length - 1]
  return currentPage ? `/${currentPage.route}` : ''
}

function getCurrentTabIndex(): number {
  const currentPath = getCurrentPagePath()
  return tabItems.findIndex((tab) => tab.pagePath === currentPath)
}

const themeUnsubscribers = new WeakMap<object, () => void>()

Component({
  options: {
    styleIsolation: 'apply-shared',
  },

  data: {
    selected: 0,
    tabs: tabItems,
    hidden: false,
    diyOpening: false,
    themeClass: getActiveThemeClass(),
  },

  lifetimes: {
    attached() {
      const unsubscribe = subscribeTheme((themeClass) => {
        if (themeClass !== this.data.themeClass) this.setData({ themeClass })
      })
      themeUnsubscribers.set(this, unsubscribe)
    },

    detached() {
      themeUnsubscribers.get(this)?.()
      themeUnsubscribers.delete(this)
    },
  },

  pageLifetimes: {
    show() {
      const themeClass = getActiveThemeClass()
      if (themeClass !== this.data.themeClass) this.setData({ themeClass })
      if (this.data.hidden) this.setData({ hidden: false })
      this.syncSelectedTab()
    },
  },

  methods: {
    syncSelectedTab() {
      const selected = getCurrentTabIndex()
      if (selected >= 0 && selected !== this.data.selected) {
        this.setData({ selected })
      }
    },

    handleTabSelect(event: WechatMiniprogram.TouchEvent) {
      const selected = Number(event.currentTarget.dataset.index)
      const tab = tabItems[selected]
      if (!tab) return
      if (tab.isPrimary && this.data.diyOpening) return

      appSound.play('soft-pop')

      if (tab.isPrimary) {
        this.setData({ diyOpening: true })
        navigateToDiy({
          complete: () => this.setData({ diyOpening: false }),
        })
        return
      }

      if (tab.pagePath === getCurrentPagePath()) {
        if (selected !== this.data.selected) this.setData({ selected })
        return
      }

      this.setData({ selected, hidden: false })
      wx.switchTab({
        url: tab.pagePath,
        success: () => this.syncSelectedTab(),
        fail: () => this.syncSelectedTab(),
      })
    },
  },
})
