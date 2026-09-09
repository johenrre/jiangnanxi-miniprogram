interface TabBarComponentLike {
  data?: {
    hidden?: boolean
    selected?: number
  }
  setData(data: { hidden?: boolean; selected?: number }): void
}

export interface TabBarPageHost {
  getTabBar(): TabBarComponentLike | null
}

interface ScrollDirectionState {
  lastScrollTop: number
  lastSampleAt: number
  hidden: boolean
}

const scrollStates = new WeakMap<object, ScrollDirectionState>()

// 原生滚动事件可以非常密集；只以约 14fps 采样方向，且仅在显隐状态变化时 setData。
const SAMPLE_INTERVAL_MS = 72
const DIRECTION_THRESHOLD_PX = 16
const HIDE_AFTER_SCROLL_TOP_PX = 88
const ALWAYS_SHOW_BEFORE_PX = 24

function normalizeScrollTop(scrollTop: number): number {
  return Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0
}

/**
 * 返回 true/false 表示显隐状态发生变化，null 表示无需更新视图。
 * owner 可以是 Page 或内部 scroll-view 组件实例。
 */
export function getTabBarScrollIntent(
  owner: object,
  rawScrollTop: number,
  now = Date.now(),
): boolean | null {
  const scrollTop = normalizeScrollTop(rawScrollTop)
  let state = scrollStates.get(owner)

  if (!state) {
    state = {
      lastScrollTop: scrollTop,
      lastSampleAt: now,
      hidden: false,
    }
    scrollStates.set(owner, state)
    return null
  }

  if (scrollTop <= ALWAYS_SHOW_BEFORE_PX) {
    state.lastScrollTop = scrollTop
    state.lastSampleAt = now
    if (!state.hidden) return null
    state.hidden = false
    return false
  }

  if (now - state.lastSampleAt < SAMPLE_INTERVAL_MS) return null

  const delta = scrollTop - state.lastScrollTop
  state.lastSampleAt = now

  // 小幅抖动不改变锚点，让真实的慢速滚动可以累积到阈值。
  if (Math.abs(delta) < DIRECTION_THRESHOLD_PX) return null
  state.lastScrollTop = scrollTop

  const nextHidden = delta > 0 && scrollTop > HIDE_AFTER_SCROLL_TOP_PX
    ? true
    : delta < 0
      ? false
      : state.hidden

  if (nextHidden === state.hidden) return null
  state.hidden = nextHidden
  return nextHidden
}

export function setTabBarHidden(page: TabBarPageHost, hidden: boolean): void {
  const tabBar = page.getTabBar()
  if (!tabBar || Boolean(tabBar.data?.hidden) === hidden) return
  tabBar.setData({ hidden })
}

export function handleTabBarPageScroll(
  page: TabBarPageHost,
  scrollTop: number,
): void {
  const hidden = getTabBarScrollIntent(page as object, scrollTop)
  if (hidden === null) return
  setTabBarHidden(page, hidden)
}

export function markTabBarScrollVisible(owner: object): void {
  const state = scrollStates.get(owner)
  if (state) {
    state.hidden = false
    state.lastSampleAt = Date.now()
    return
  }
  scrollStates.set(owner, {
    lastScrollTop: 0,
    lastSampleAt: Date.now(),
    hidden: false,
  })
}

export function syncTabBarOnShow(page: TabBarPageHost, selected: number): void {
  markTabBarScrollVisible(page as object)

  const tabBar = page.getTabBar()
  if (!tabBar) return
  tabBar.setData({ selected, hidden: false })
}
