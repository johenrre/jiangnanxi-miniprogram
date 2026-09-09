const DIY_PAGE_ROUTE = 'pages/diy/index'

export interface DiyDesignSnapshot {
  pattern: string[]
}

let pendingDiyDesignSnapshot: DiyDesignSnapshot | null = null

interface NavigateToDiyOptions {
  fail?: () => void
  complete?: () => void
}

function findExistingDiyPageIndex(): number {
  const pages = getCurrentPages()
  for (let index = pages.length - 1; index >= 0; index -= 1) {
    if (pages[index]?.route === DIY_PAGE_ROUTE) return index
  }
  return -1
}

function returnToExistingDiy(
  snapshot: DiyDesignSnapshot | null,
  options: NavigateToDiyOptions,
): boolean {
  const pages = getCurrentPages()
  const diyPageIndex = findExistingDiyPageIndex()
  if (diyPageIndex < 0) return false
  if (diyPageIndex === pages.length - 1) {
    if (snapshot) {
      const currentDiyPage = pages[diyPageIndex] as unknown as {
        acceptTemplateDesign?: (design: DiyDesignSnapshot) => void
      }
      if (typeof currentDiyPage.acceptTemplateDesign !== 'function') return false
      currentDiyPage.acceptTemplateDesign(snapshot)
    }
    options.complete?.()
    return true
  }

  pendingDiyDesignSnapshot = snapshot
  wx.navigateBack({
    delta: pages.length - 1 - diyPageIndex,
    fail: () => {
      if (pendingDiyDesignSnapshot === snapshot) pendingDiyDesignSnapshot = null
      options.fail?.()
    },
    complete: options.complete,
  })
  return true
}

export function consumePendingDiyDesignSnapshot(): DiyDesignSnapshot | null {
  const snapshot = pendingDiyDesignSnapshot
  pendingDiyDesignSnapshot = null
  return snapshot
}

export function navigateToDiy(options: NavigateToDiyOptions = {}): void {
  if (returnToExistingDiy(null, options)) return
  wx.navigateTo({
    url: '/pages/diy/index',
    fail: options.fail,
    complete: options.complete,
  })
}

export function navigateToDiyWithSnapshot(
  pattern: string[],
  options: NavigateToDiyOptions = {},
): void {
  const snapshot = { pattern: [...pattern] }

  if (returnToExistingDiy(snapshot, options)) return
  pendingDiyDesignSnapshot = snapshot

  wx.navigateTo({
    url: '/pages/diy/index',
    fail: () => {
      if (pendingDiyDesignSnapshot === snapshot) pendingDiyDesignSnapshot = null
      options.fail?.()
    },
    complete: options.complete,
  })
}
