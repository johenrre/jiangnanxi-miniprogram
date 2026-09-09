Component({
  data: {
    materialScrollTop: 0,
  },

  properties: {
    mainCategories: { type: Array, value: [] },
    currentCategory: { type: String, value: '' },
    subcategories: { type: Array, value: [] },
    currentSubcategory: { type: String, value: 'all' },
    materialGroups: { type: Array, value: [] },
    loadingMaterials: { type: Boolean, value: false },
    materialsError: { type: String, value: '' },
    hasMoreMaterials: { type: Boolean, value: false },
  },

  methods: {
    resetMaterialScroll() {
      this.setData({ materialScrollTop: 1 }, () => {
        this.setData({ materialScrollTop: 0 })
      })
    },
    handleCategoryTap(event: WechatMiniprogram.TouchEvent) {
      this.resetMaterialScroll()
      this.triggerEvent('categorychange', { id: String(event.currentTarget.dataset.id || '') })
    },
    handleSubcategoryTap(event: WechatMiniprogram.TouchEvent) {
      this.resetMaterialScroll()
      this.triggerEvent('subcategorychange', { id: String(event.currentTarget.dataset.id || '') })
    },
    handleSizeChange(event: WechatMiniprogram.TouchEvent) {
      this.triggerEvent('sizechange', {
        key: String(event.currentTarget.dataset.key || ''),
        direction: Number(event.currentTarget.dataset.direction),
      })
    },
    handleMaterialTap(event: WechatMiniprogram.TouchEvent) {
      this.triggerEvent('materialtap', { id: String(event.currentTarget.dataset.id || '') })
    },
    handleScrollLower() { this.triggerEvent('loadmore') },
    handleRetry() { this.triggerEvent('retry') },
  },
})
