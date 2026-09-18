import { appSound } from '@/services/sound'
import { loadPublicSettings } from '@/api/settings/public'
import { prepareAppResources } from '@/services/app-resource-preloader'
import { homeBackgroundMusic } from '@/services/home-background-music'
import { captureWechatReceiptResult } from '@/services/wechat-order-receipt'
import { initializeHomeActivityPopupSession } from '@/services/home-activity-popup-session'

const registerPage = Page
const LAUNCH_PAGE_PATH = '/pages/launch/index'
let shareAppName = ''

function createDefaultSharePath(): string {
  const pages = getCurrentPages()
  const currentPage = pages[pages.length - 1]
  const currentRoute = String(currentPage?.route || '')
  if (currentRoute === 'pages/mall/detail/index') {
    const productId = String(currentPage.options?.id || '').trim()
    return productId
      ? `${LAUNCH_PAGE_PATH}?entry=mall-detail&productId=${encodeURIComponent(productId)}`
      : `${LAUNCH_PAGE_PATH}?entry=mall`
  }
  if (currentRoute.startsWith('pages/mall/')) {
    return `${LAUNCH_PAGE_PATH}?entry=mall`
  }
  if (currentRoute === 'pages/discover/design-detail/index') {
    const designId = String(currentPage.options?.id || '').trim()
    const section = currentPage.options?.section === 'customer' ? 'customer' : 'designer'
    return designId
      ? `${LAUNCH_PAGE_PATH}?entry=discover-detail&designId=${encodeURIComponent(designId)}&section=${section}`
      : `${LAUNCH_PAGE_PATH}?entry=discover`
  }
  return currentRoute.startsWith('pages/discover/')
    ? `${LAUNCH_PAGE_PATH}?entry=discover`
    : LAUNCH_PAGE_PATH
}

function createDefaultShareMessage() {
  return {
    title: shareAppName || '江南禧',
    path: createDefaultSharePath(),
  }
}

/**
 * 微信只在 Page 上识别分享回调。页面未提供专属分享时，才使用全局分享卡片。
 */
Page = ((options: WechatMiniprogram.Page.Options<any, any>) => {
  registerPage({
    ...options,
    onShareAppMessage: options.onShareAppMessage || createDefaultShareMessage,
  })
}) as WechatMiniprogram.Page.Constructor

App({
  onLaunch(options) {
    initializeHomeActivityPopupSession(options)
    appSound.prepare()
    void loadPublicSettings()
      .then((settings) => {
        shareAppName = String(settings.appName || '').trim()
      })
      .catch(() => {
        // 配置暂不可用时不伪造小程序名称。
      })
    void prepareAppResources()
      .then(({ settings }) => {
        homeBackgroundMusic.setSource(settings.homeMusicUrl)
      })
      .catch(() => {
        // 首页会展示可重试的配置错误，应用启动不在这里重复提示。
      })
  },

  onPageNotFound() {
    wx.reLaunch({ url: LAUNCH_PAGE_PATH })
  },

  onShow(options) {
    captureWechatReceiptResult(options)
    appSound.onAppShow()
  },

  onHide() {
    appSound.onAppHide()
  },
})
