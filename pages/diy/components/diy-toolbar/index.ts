Component({
  properties: {
    selectedWristCm: { type: null, value: null },
    canUndo: { type: Boolean, value: false },
    canSave: { type: Boolean, value: false },
    savingDesign: { type: Boolean, value: false },
    isStrung: { type: Boolean, value: false },
    stringDisabled: { type: Boolean, value: false },
    stringButtonText: { type: String, value: '' },
    searchQuery: { type: String, value: '' },
  },

  methods: {
    handleOpenWrist() { this.triggerEvent('openwrist') },
    handleUndo() { this.triggerEvent('undo') },
    handleRandom() { this.triggerEvent('random') },
    handleBackground() { this.triggerEvent('backgroundchange') },
    handleClear() { this.triggerEvent('clear') },
    handleSave() { this.triggerEvent('save') },
    handleToggleString() { this.triggerEvent('togglestring') },
    handleAddToCart() { this.triggerEvent('addtocart') },
    handleSearchInput(event: WechatMiniprogram.Input) {
      this.triggerEvent('searchchange', { value: event.detail.value })
    },
  },
})
