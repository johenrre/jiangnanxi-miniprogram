const HOME_PAGE_PATH = 'pages/home/index'
const LAUNCH_PAGE_PATH = 'pages/launch/index'
const NON_HOME_LAUNCH_ENTRIES = new Set([
  'mall',
  'mall-detail',
  'discover',
  'discover-detail',
])

let pendingHomeEntry = false

function normalizePath(path: unknown): string {
  return String(path || '').trim().replace(/^\/+/, '')
}

/**
 * 只在小程序进程首次启动时记录入口；后续 onShow 和页面切换不会重新放行。
 */
export function initializeHomeActivityPopupSession(
  options: Pick<WechatMiniprogram.App.LaunchShowOption, 'path' | 'query'>,
): void {
  const path = normalizePath(options.path)
  const entry = String(options.query?.entry || '').trim()
  pendingHomeEntry = path === HOME_PAGE_PATH
    || (path === LAUNCH_PAGE_PATH && !NON_HOME_LAUNCH_ENTRIES.has(entry))
}

/** 首页 onLoad 仅消费一次，避免返回首页或前后台切换时再次弹出。 */
export function consumeHomeActivityPopupEntry(): boolean {
  const pending = pendingHomeEntry
  pendingHomeEntry = false
  return pending
}
