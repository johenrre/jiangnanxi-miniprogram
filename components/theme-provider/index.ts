import {
  getActiveThemeClass,
  subscribeTheme,
} from '@/services/theme'

const unsubscribers = new WeakMap<object, () => void>()

Component({
  options: {
    styleIsolation: 'apply-shared',
  },

  data: {
    themeClass: getActiveThemeClass(),
  },

  lifetimes: {
    attached() {
      const unsubscribe = subscribeTheme((themeClass) => {
        if (themeClass !== this.data.themeClass) this.setData({ themeClass })
      })
      unsubscribers.set(this, unsubscribe)
    },

    detached() {
      unsubscribers.get(this)?.()
      unsubscribers.delete(this)
    },
  },

  pageLifetimes: {
    show() {
      const themeClass = getActiveThemeClass()
      if (themeClass !== this.data.themeClass) this.setData({ themeClass })
    },
  },
})
