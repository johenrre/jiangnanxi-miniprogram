import {
  prepareAppResources,
  stagePreparedHomeEntry,
  type AppResourceProgress,
} from '@/services/app-resource-preloader'
import {
  loadPublicSettings,
  type PublicSettings,
} from '@/api/settings/public'
import {
  isRemoteResourceUrl,
  recoverRemoteResourceUrl,
} from '@/utils/resource-cache'

const MIN_VISIBLE_MS = 620
const MAX_WAIT_MS = 15_000
const HOME_PATH = '/pages/home/index'
const MALL_PATH = '/pages/mall/index'
const MALL_DETAIL_PATH = '/pages/mall/detail/index'
const DISCOVER_PATH = '/pages/discover/index'
const DISCOVER_DETAIL_PATH = '/pages/discover/design-detail/index'
const FALLBACK_BACKGROUND_IMAGE = '/assets/launch/resource-preload-v1.jpg'
const LAUNCH_BACKGROUND_FILE_KEY = 'stone_launch_background_file_v1'

function resolveInitialBackgroundImage(): string {
  try {
    const storedPath = String(wx.getStorageSync(LAUNCH_BACKGROUND_FILE_KEY) || '').trim()
    return storedPath && !isRemoteResourceUrl(storedPath)
      ? storedPath
      : FALLBACK_BACKGROUND_IMAGE
  } catch {
    return FALLBACK_BACKGROUND_IMAGE
  }
}

function rememberPreparedLaunchBackground(settings: PublicSettings): void {
  const preparedPath = String(settings.launchBackgroundImageUrl || '').trim()
  try {
    if (preparedPath && !isRemoteResourceUrl(preparedPath)) {
      wx.setStorageSync(LAUNCH_BACKGROUND_FILE_KEY, preparedPath)
      return
    }
    if (!preparedPath) wx.removeStorageSync(LAUNCH_BACKGROUND_FILE_KEY)
  } catch {
    // 启动背景缓存失败不影响公开配置和页面进入。
  }
}

let pageAlive = false
let entryPath = HOME_PATH

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

Page({
  data: {
    progress: 8,
    statusLabel: '正在读取今日灵感',
    brandLogoUrl: '',
    appDisplayName: '水晶定制',
    // 只读取已下载的启动背景文件，不读取上一次公开配置。
    launchBackgroundImageUrl: resolveInitialBackgroundImage(),
  },

  onLoad(options: {
    entry?: string
    productId?: string
    designId?: string
    section?: string
  }) {
    pageAlive = true
    const productId = String(options.productId || '').trim()
    const designId = String(options.designId || '').trim()
    if (options.entry === 'mall-detail' && productId) {
      entryPath = `${MALL_DETAIL_PATH}?id=${encodeURIComponent(productId)}`
    } else if (options.entry === 'discover-detail' && designId) {
      const section = options.section === 'customer' ? 'customer' : 'designer'
      entryPath = `${DISCOVER_DETAIL_PATH}?id=${encodeURIComponent(designId)}&section=${section}`
    } else if (options.entry === 'mall' || options.entry === 'mall-detail') {
      entryPath = MALL_PATH
    } else if (options.entry === 'discover' || options.entry === 'discover-detail') {
      entryPath = DISCOVER_PATH
    } else {
      entryPath = HOME_PATH
    }
    void this.prepareAndEnter()
  },

  onUnload() {
    pageAlive = false
    entryPath = HOME_PATH
  },

  handleProgress(progress: AppResourceProgress) {
    if (!pageAlive) return
    const percent = progress.total > 0
      ? Math.max(8, Math.round((progress.completed / progress.total) * 100))
      : 8
    this.setData({
      progress: percent,
      statusLabel: progress.currentKind === 'audio'
        ? '正在准备背景音乐'
        : '正在准备晶石图像',
    })
  },

  applyLaunchBranding(settings: PublicSettings) {
    if (!pageAlive) return
    this.setData({
      brandLogoUrl: settings.siteTitleLogoImageUrl || settings.trayLogoImageUrl || '',
      appDisplayName: String(settings.appName || '').trim() || '水晶定制',
    })
  },

  handleLaunchBackgroundError() {
    const failedUrl = this.data.launchBackgroundImageUrl
    if (!failedUrl || failedUrl === FALLBACK_BACKGROUND_IMAGE) return
    this.setData({
      launchBackgroundImageUrl: recoverRemoteResourceUrl(failedUrl) || FALLBACK_BACKGROUND_IMAGE,
    })
  },

  handleBrandLogoError() {
    const failedUrl = this.data.brandLogoUrl
    if (!failedUrl) return
    this.setData({
      brandLogoUrl: recoverRemoteResourceUrl(failedUrl),
    })
  },

  async prepareAndEnter() {
    const startedAt = Date.now()
    const preparation = prepareAppResources(false, (progress) => this.handleProgress(progress))
    void preparation
      .then((result) => {
        rememberPreparedLaunchBackground(result.settings)
        stagePreparedHomeEntry(result)
      })
      .catch(() => undefined)
    void loadPublicSettings(false)
      .then((settings) => this.applyLaunchBranding(settings))
      .catch(() => undefined)
    const prepared = await Promise.race([
      preparation.catch(() => null),
      wait(MAX_WAIT_MS).then(() => null),
    ])
    if (prepared?.settings) {
      this.applyLaunchBranding(prepared.settings)
    }
    const elapsed = Date.now() - startedAt
    if (elapsed < MIN_VISIBLE_MS) await wait(MIN_VISIBLE_MS - elapsed)
    if (!pageAlive) return
    this.setData({ progress: 100, statusLabel: `正在进入${this.data.appDisplayName}` })
    await wait(120)
    if (!pageAlive) return
    if (
      entryPath.startsWith(MALL_DETAIL_PATH)
      || entryPath.startsWith(DISCOVER_DETAIL_PATH)
    ) {
      const fallbackPath = entryPath.startsWith(MALL_DETAIL_PATH) ? MALL_PATH : DISCOVER_PATH
      wx.reLaunch({
        url: entryPath,
        fail: () => wx.switchTab({ url: fallbackPath }),
      })
      return
    }
    wx.switchTab({
      url: entryPath,
      fail: () => wx.reLaunch({ url: HOME_PATH }),
    })
  },
})
