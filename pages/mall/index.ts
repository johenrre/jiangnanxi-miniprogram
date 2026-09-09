import {
  handleTabBarPageScroll,
  syncTabBarOnShow,
} from '@/utils/tab-bar-visibility'
import {
  getApiErrorMessage,
  loadMallCatalog,
  type MallCategory,
  type MallProduct,
} from '@/api/index'
import { prepareAppResources } from '@/services/app-resource-preloader'
import { recoverRemoteResourceUrl } from '@/utils/resource-cache'

interface MallProductCard extends MallProduct {
  coverLoadFailed: boolean
}

type MallPageStatus = 'loading' | 'ready' | 'empty' | 'error'

let catalogCategories: MallCategory[] = []
let catalogProducts: MallProduct[] = []

function filterProducts(primaryCategoryId: string, secondaryCategoryId: string): MallProduct[] {
  return catalogProducts.filter((product) => {
    if (primaryCategoryId !== 'all' && product.primaryCategoryId !== primaryCategoryId) return false
    if (secondaryCategoryId !== 'all' && product.secondaryCategoryId !== secondaryCategoryId) return false
    return true
  })
}

function buildProductCards(products: MallProduct[], failedCoverIds: string[]): MallProductCard[] {
  const failedSet = new Set(failedCoverIds)
  return products.map((product) => ({
    ...product,
    coverLoadFailed: !product.images[0] || failedSet.has(product.id),
  }))
}

Page({
  data: {
    status: 'loading' as MallPageStatus,
    errorMessage: '',
    heroImageUrl: '',
    heroLoadFailed: false,
    categories: [] as MallCategory[],
    secondaryCategories: [] as MallCategory['children'],
    selectedPrimaryCategoryId: '',
    selectedSecondaryCategoryId: 'all',
    visibleProducts: [] as MallProductCard[],
    failedCoverIds: [] as string[],
  },

  onLoad() {
    void this.loadMallPresentation()
    void this.loadCatalog()
  },

  async loadMallPresentation(forceRefresh = false) {
    try {
      const { settings } = await prepareAppResources(forceRefresh)
      this.setData({
        heroImageUrl: settings.mallHeroImageUrl,
        heroLoadFailed: false,
      })
    } catch {
      this.setData({ heroImageUrl: '', heroLoadFailed: false })
    }
  },

  onShow() {
    syncTabBarOnShow(this, 3)
  },

  onPageScroll(event: { scrollTop: number }) {
    handleTabBarPageScroll(this, event.scrollTop)
  },

  onPullDownRefresh() {
    void this.loadMallPresentation(true)
    void this.loadCatalog()
  },

  async loadCatalog() {
    this.setData({ status: 'loading', errorMessage: '' })
    try {
      const catalog = await loadMallCatalog()
      catalogCategories = catalog.categories
      catalogProducts = catalog.products
      const primaryCategoryId = catalogCategories[0]?.id || ''
      const visibleProducts = primaryCategoryId
        ? filterProducts(primaryCategoryId, 'all')
        : catalogProducts
      this.setData({
        status: catalogProducts.length > 0 ? 'ready' : 'empty',
        categories: catalogCategories,
        secondaryCategories: catalogCategories[0]?.children || [],
        selectedPrimaryCategoryId: primaryCategoryId,
        selectedSecondaryCategoryId: 'all',
        visibleProducts: buildProductCards(visibleProducts, []),
        failedCoverIds: [],
      })
    } catch (error) {
      this.setData({
        status: 'error',
        errorMessage: getApiErrorMessage(error, '商城加载失败，请稍后重试'),
        categories: [],
        secondaryCategories: [],
        visibleProducts: [],
      })
    } finally {
      wx.stopPullDownRefresh()
    }
  },

  handlePrimaryCategoryTap(event: WechatMiniprogram.TouchEvent) {
    const categoryId = String(event.currentTarget.dataset.id || '')
    const category = catalogCategories.find((item) => item.id === categoryId)
    if (!category || categoryId === this.data.selectedPrimaryCategoryId) return
    this.setData({
      selectedPrimaryCategoryId: categoryId,
      selectedSecondaryCategoryId: 'all',
      secondaryCategories: category.children,
      visibleProducts: buildProductCards(
        filterProducts(categoryId, 'all'),
        this.data.failedCoverIds,
      ),
    })
  },

  handleSecondaryCategoryTap(event: WechatMiniprogram.TouchEvent) {
    const categoryId = String(event.currentTarget.dataset.id || '')
    if (!categoryId || categoryId === this.data.selectedSecondaryCategoryId) return
    this.setData({
      selectedSecondaryCategoryId: categoryId,
      visibleProducts: buildProductCards(
        filterProducts(this.data.selectedPrimaryCategoryId, categoryId),
        this.data.failedCoverIds,
      ),
    })
  },

  handleProductTap(event: WechatMiniprogram.TouchEvent) {
    const productId = String(event.currentTarget.dataset.id || '')
    if (!productId) return
    wx.navigateTo({
      url: `/pages/mall/detail/index?id=${encodeURIComponent(productId)}`,
    })
  },

  handleHeroImageError() {
    const remoteFallbackUrl = recoverRemoteResourceUrl(this.data.heroImageUrl)
    this.setData({
      heroImageUrl: remoteFallbackUrl || this.data.heroImageUrl,
      heroLoadFailed: !remoteFallbackUrl,
    })
  },

  handleRetry() {
    void this.loadCatalog()
  },

  handleProductImageError(event: WechatMiniprogram.CustomEvent) {
    const productId = String(event.currentTarget.dataset.id || '')
    if (!productId || this.data.failedCoverIds.includes(productId)) return
    const failedCoverIds = [...this.data.failedCoverIds, productId]
    this.setData({
      failedCoverIds,
      visibleProducts: buildProductCards(
        filterProducts(
          this.data.selectedPrimaryCategoryId,
          this.data.selectedSecondaryCategoryId,
        ),
        failedCoverIds,
      ),
    })
  },

})
