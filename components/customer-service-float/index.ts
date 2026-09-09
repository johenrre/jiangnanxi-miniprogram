import { loadPublicSettings } from '@/api/index'
import { resolvePreparedResourceUrl } from '@/services/app-resource-preloader'
import { recoverRemoteResourceUrl } from '@/utils/resource-cache'

const FLOAT_SIZE_RPX = 140
const FLOAT_BOTTOM_CLEARANCE_RPX = 154
const FLOAT_TOP_GAP_PX = 12
const FLOAT_DRAG_THRESHOLD_PX = 4

interface WindowMetrics {
  windowWidth?: number
  windowHeight?: number
  safeArea?: {
    top?: number
    bottom?: number
  }
}

interface FloatDragRuntime {
  minTopPx: number
  maxTopPx: number
  startClientY: number | null
  startTopPx: number
  moved: boolean
  suppressTap: boolean
}

const floatDragRuntimeByComponent = new WeakMap<object, FloatDragRuntime>()

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function getTouchClientY(event: WechatMiniprogram.TouchEvent): number | null {
  const touch = event.touches[0] || event.changedTouches[0]
  const clientY = Number(touch?.clientY)
  return Number.isFinite(clientY) ? clientY : null
}

function chooseRandomQr(urls: string[], currentUrl = ''): string {
  if (urls.length === 0) return ''
  const candidates = urls.length > 1
    ? urls.filter((url) => url !== currentUrl)
    : urls
  return candidates[Math.floor(Math.random() * candidates.length)] || urls[0] || ''
}

Component({
  properties: {
    showFloat: {
      type: Boolean,
      value: true,
    },
    draggableY: {
      type: Boolean,
      value: true,
    },
  },

  data: {
    qrUrls: [] as string[],
    qrUrl: '',
    floatImageUrl: '',
    floatTopPx: 0,
    floatPositionReady: false,
    qrLoadFailed: false,
    showModal: false,
  },

  lifetimes: {
    attached() {
      if (this.properties.draggableY) this.initializeFloatPosition()
      void this.loadContact()
    },
    detached() {
      floatDragRuntimeByComponent.delete(this as unknown as object)
    },
  },

  methods: {
    initializeFloatPosition() {
      const modernWx = wx as unknown as {
        getWindowInfo?: () => WindowMetrics
      }
      const windowInfo = modernWx.getWindowInfo?.() || wx.getSystemInfoSync()
      const windowWidth = Math.max(1, Number(windowInfo.windowWidth) || 375)
      const windowHeight = Math.max(1, Number(windowInfo.windowHeight) || 667)
      const safeAreaTop = Math.max(0, Number(windowInfo.safeArea?.top) || 0)
      const safeAreaBottom = Math.max(0, windowHeight - (Number(windowInfo.safeArea?.bottom) || windowHeight))
      const menuButton = wx.getMenuButtonBoundingClientRect()
      const floatSizePx = windowWidth * FLOAT_SIZE_RPX / 750
      const bottomClearancePx = windowWidth * FLOAT_BOTTOM_CLEARANCE_RPX / 750 + safeAreaBottom
      const minTopPx = Math.max(safeAreaTop + 8, menuButton.bottom + FLOAT_TOP_GAP_PX)
      const maxTopPx = Math.max(minTopPx, windowHeight - floatSizePx - bottomClearancePx)
      const centeredTopPx = clamp((windowHeight - floatSizePx) / 2, minTopPx, maxTopPx)

      floatDragRuntimeByComponent.set(this as unknown as object, {
        minTopPx,
        maxTopPx,
        startClientY: null,
        startTopPx: centeredTopPx,
        moved: false,
        suppressTap: false,
      })
      this.setData({
        floatTopPx: Math.round(centeredTopPx),
        floatPositionReady: true,
      })
    },

    handleFloatTouchStart(event: WechatMiniprogram.TouchEvent) {
      if (!this.properties.draggableY) return
      let runtime = floatDragRuntimeByComponent.get(this as unknown as object)
      if (!runtime) {
        this.initializeFloatPosition()
        runtime = floatDragRuntimeByComponent.get(this as unknown as object)
      }
      const clientY = getTouchClientY(event)
      if (!runtime || clientY === null) return
      runtime.startClientY = clientY
      runtime.startTopPx = this.data.floatTopPx
      runtime.moved = false
      runtime.suppressTap = false
    },

    handleFloatTouchMove(event: WechatMiniprogram.TouchEvent) {
      if (!this.properties.draggableY) return
      const runtime = floatDragRuntimeByComponent.get(this as unknown as object)
      const clientY = getTouchClientY(event)
      if (!runtime || runtime.startClientY === null || clientY === null) return
      const deltaY = clientY - runtime.startClientY
      if (Math.abs(deltaY) >= FLOAT_DRAG_THRESHOLD_PX) runtime.moved = true
      const nextTopPx = Math.round(clamp(
        runtime.startTopPx + deltaY,
        runtime.minTopPx,
        runtime.maxTopPx,
      ))
      if (nextTopPx === this.data.floatTopPx) return
      this.setData({ floatTopPx: nextTopPx })
    },

    handleFloatTouchEnd() {
      if (!this.properties.draggableY) return
      const runtime = floatDragRuntimeByComponent.get(this as unknown as object)
      if (!runtime) return
      runtime.startClientY = null
      runtime.suppressTap = runtime.moved
      if (runtime.moved) {
        setTimeout(() => {
          const currentRuntime = floatDragRuntimeByComponent.get(this as unknown as object)
          if (currentRuntime) currentRuntime.suppressTap = false
        }, 220)
      }
    },

    handleFloatTap() {
      const runtime = floatDragRuntimeByComponent.get(this as unknown as object)
      if (runtime?.suppressTap) {
        runtime.suppressTap = false
        return
      }
      this.open()
    },

    async loadContact(forceRefresh = false) {
      try {
        const settings = await loadPublicSettings(forceRefresh)
        const qrUrls = settings.contactService.wechatQrUrls
          .map(resolvePreparedResourceUrl)
          .filter(Boolean)
        this.setData({
          qrUrls,
          qrUrl: this.data.showModal
            ? chooseRandomQr(qrUrls, this.data.qrUrl)
            : this.data.qrUrl,
          floatImageUrl: resolvePreparedResourceUrl(settings.customerServiceFloatImageUrl),
          qrLoadFailed: false,
          showModal: qrUrls.length > 0 && this.data.showModal,
        })
      } catch {
        this.setData({
          qrUrls: [],
          qrUrl: '',
          floatImageUrl: '',
          qrLoadFailed: false,
          showModal: false,
        })
      }
    },

    open() {
      if (this.data.qrUrls.length === 0) {
        void this.loadContact(true)
        return
      }
      this.setData({
        showModal: true,
        qrUrl: chooseRandomQr(this.data.qrUrls, this.data.qrUrl),
        qrLoadFailed: false,
      })
    },

    handleClose() {
      this.setData({ showModal: false })
    },

    handleQrError() {
      const remoteFallbackUrl = recoverRemoteResourceUrl(this.data.qrUrl)
      this.setData({
        qrUrl: remoteFallbackUrl || this.data.qrUrl,
        qrLoadFailed: !remoteFallbackUrl,
      })
    },

    handleFloatImageError() {
      const failedUrl = this.data.floatImageUrl
      if (!failedUrl) return
      this.setData({
        floatImageUrl: recoverRemoteResourceUrl(failedUrl),
      })
    },

    handleNoop() {
      // Stop modal taps and touch movement from reaching the page behind it.
    },
  },
})
