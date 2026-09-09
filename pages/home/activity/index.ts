import { prepareAppResources } from '@/services/app-resource-preloader'
import { recoverRemoteResourceUrl } from '@/utils/resource-cache'

Page({
  data: {
    activityImageUrl: '',
    activityDetailImageUrls: [] as string[],
  },

  onLoad() {
    void this.loadActivityPresentation()
  },

  async loadActivityPresentation() {
    try {
      const { settings } = await prepareAppResources()
      const activityDetailImageUrls = settings.activityDetailImageUrls.length > 0
        ? settings.activityDetailImageUrls
        : settings.homeActivityImageUrl
          ? [settings.homeActivityImageUrl]
          : []
      this.setData({
        activityImageUrl: settings.homeActivityImageUrl,
        activityDetailImageUrls,
      })
    } catch {
      this.setData({
        activityImageUrl: '',
        activityDetailImageUrls: [],
      })
    }
  },

  handleActivityDetailImageError(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index)
    if (!Number.isInteger(index) || index < 0 || index >= this.data.activityDetailImageUrls.length) return
    const activityDetailImageUrls = [...this.data.activityDetailImageUrls]
    const remoteFallbackUrl = recoverRemoteResourceUrl(activityDetailImageUrls[index])
    if (remoteFallbackUrl) {
      activityDetailImageUrls[index] = remoteFallbackUrl
    } else {
      activityDetailImageUrls.splice(index, 1)
    }
    this.setData({ activityDetailImageUrls })
  },

  handleContactService() {
    const customerService = this.selectComponent('#activityCustomerService') as {
      open?: () => void
    } | null
    customerService?.open?.()
  },

})
