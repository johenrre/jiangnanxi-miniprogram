const LEGAL_CENTER_ROUTE = '/pages/legal/user-agreement/index'

interface PrivacyContractOptions {
  success?: () => void
  fail?: (error: { errMsg?: string }) => void
}

type OpenPrivacyContract = (options: PrivacyContractOptions) => void

export type LegalCenterTab = 'agreement' | 'privacy'

export function openLegalCenter(tab: LegalCenterTab = 'agreement') {
  wx.navigateTo({ url: `${LEGAL_CENTER_ROUTE}?tab=${tab}` })
}

export function openPrivacyProtectionGuide() {
  const privacyApi = (wx as unknown as {
    openPrivacyContract?: OpenPrivacyContract
  }).openPrivacyContract

  if (!privacyApi) {
    wx.showToast({ title: '当前微信版本暂不支持查看', icon: 'none' })
    return
  }

  privacyApi.call(wx, {
    fail: () => {
      wx.showToast({ title: '隐私保护指引暂时无法打开', icon: 'none' })
    },
  })
}
