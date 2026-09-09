import type { DesignWork } from '@/api/index'

Component({
  properties: {
    design: {
      type: Object,
      value: {},
      observer() {
        this.setData({ coverLoadFailed: false, avatarLoadFailed: false })
      },
    },
    variant: {
      type: String,
      value: 'home',
    },
    trayBackgroundUrl: {
      type: String,
      value: '/assets/bg_1.jpg',
      observer() {
        this.setData({ trayLoadFailed: false })
      },
    },
  },

  data: {
    coverLoadFailed: false,
    avatarLoadFailed: false,
    trayLoadFailed: false,
  },

  methods: {
    handleTap() {
      const design = this.data.design as DesignWork | null
      if (!design || !design.id) return
      this.triggerEvent('select', {
        designId: design.id,
        section: design.section,
      })
    },

    handleCoverError() {
      this.setData({ coverLoadFailed: true })
    },

    handleAvatarError() {
      this.setData({ avatarLoadFailed: true })
    },

    handleTrayError() {
      this.setData({ trayLoadFailed: true })
    },
  },
})
