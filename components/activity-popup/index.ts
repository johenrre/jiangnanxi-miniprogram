Component({
  properties: {
    imageUrl: {
      type: String,
      value: '',
    },
  },

  methods: {
    handleClose() {
      this.triggerEvent('close')
    },

    handleOpen() {
      this.triggerEvent('open')
    },

    handleImageError() {
      this.triggerEvent('imageerror')
    },

    handleTouchMove() {},
  },
})
