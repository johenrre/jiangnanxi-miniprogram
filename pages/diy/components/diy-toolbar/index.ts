Component({
  properties: {
    canUndo: { type: Boolean, value: false },
    canSave: { type: Boolean, value: false },
    savingDesign: { type: Boolean, value: false },
    searchQuery: { type: String, value: '' },
  },

  methods: {
    handleUndo() { this.triggerEvent('undo') },
    handleClear() { this.triggerEvent('clear') },
    handleSave() { this.triggerEvent('save') },
    handleAddToCart() { this.triggerEvent('addtocart') },
    handleSearchInput(event: WechatMiniprogram.Input) {
      this.triggerEvent('searchchange', { value: event.detail.value })
    },
  },
})
