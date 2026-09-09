Component({
  properties: {
    title: { type: String, value: '晶石实验室' },
    totalPriceText: { type: String, value: '0' },
    beadCount: { type: Number, value: 0 },
    wristMessage: { type: String, value: '' },
  },

  methods: {
    handleOpenGuide() {
      this.triggerEvent('openguide')
    },
  },
})
