import {
  DIY_DEFAULT_HEIGHT_CM,
  DIY_DEFAULT_WEIGHT_KG,
  DIY_HEIGHT_MAX_CM,
  DIY_HEIGHT_MIN_CM,
  DIY_WEIGHT_MAX_KG,
  DIY_WEIGHT_MIN_KG,
  estimateWristCm,
  normalizeWristCm,
} from '@/services/diy-wrist-estimator'

const DEFAULT_WRIST_CM = estimateWristCm(DIY_DEFAULT_HEIGHT_CM, DIY_DEFAULT_WEIGHT_KG)
const RULER_TICK_RPX = 36
const RULER_VIEWPORT_RPX = 512

function rpxToPx(value: number): number {
  return value * wx.getSystemInfoSync().windowWidth / 750
}

const RULER_TICK_PX = rpxToPx(RULER_TICK_RPX)
const RULER_VIEWPORT_PX = rpxToPx(RULER_VIEWPORT_RPX)
const RULER_EDGE_PX = (RULER_VIEWPORT_PX - RULER_TICK_PX) / 2

function toRulerScrollLeft(value: number, minimum: number): number {
  return Math.max(0, value - minimum) * RULER_TICK_PX
}

function buildRulerItems(minimum: number, maximum: number, labelInterval: number) {
  return Array.from({ length: maximum - minimum + 1 }, (_, index) => {
    const value = minimum + index
    return {
      value,
      major: value % 5 === 0,
      label: value % labelInterval === 0 ? String(value) : '',
    }
  })
}

function getRulerTrackWidthPx(itemCount: number): number {
  return RULER_EDGE_PX * 2 + itemCount * RULER_TICK_PX
}

const COMMON_WRIST_SIZES = [
  { value: 13, label: '极细手围' },
  { value: 14, label: '偏细手围' },
  { value: 15, label: '纤细手腕' },
  { value: 16, label: '日常佩戴' },
  { value: 17, label: '手腕较粗' },
  { value: 18, label: '骨架偏大' },
  { value: 19, label: '宽松舒适' },
  { value: 20, label: '大手围' },
]

Component({
  properties: {
    showGuide: { type: Boolean, value: false },
    showWristPicker: {
      type: Boolean,
      value: false,
      observer(this: WechatMiniprogram.Component.TrivialInstance, visible: boolean) {
        if (!visible) return
        const strands = Number(this.data.selectedWristStrands) === 2 ? 2 : 1
        const selectedWristCm = this.data.selectedWristCm
        const effectiveWristCm = Number(selectedWristCm)
        const hasSelectedWrist = selectedWristCm !== null
          && selectedWristCm !== undefined
          && selectedWristCm !== ''
          && Number.isFinite(effectiveWristCm)
          && effectiveWristCm > 0
        const estimatedWristCm = estimateWristCm(DIY_DEFAULT_HEIGHT_CM, DIY_DEFAULT_WEIGHT_KG)
        const measuredWristCm = hasSelectedWrist
          ? effectiveWristCm / strands
          : estimatedWristCm
        this.setData({
          heightDraftCm: DIY_DEFAULT_HEIGHT_CM,
          weightDraftKg: DIY_DEFAULT_WEIGHT_KG,
          heightScrollLeft: toRulerScrollLeft(DIY_DEFAULT_HEIGHT_CM, DIY_HEIGHT_MIN_CM),
          weightScrollLeft: toRulerScrollLeft(DIY_DEFAULT_WEIGHT_KG, DIY_WEIGHT_MIN_KG),
          recommendedWristCm: estimatedWristCm,
          wristDraftCm: normalizeWristCm(measuredWristCm),
          wristDraftInput: normalizeWristCm(measuredWristCm).toFixed(1),
          selectedCommonWristCm: null,
          wristDraftStrands: strands,
        })
      },
    },
    showSaveNameDialog: { type: Boolean, value: false },
    designNameDraft: { type: String, value: '' },
    savingDesign: { type: Boolean, value: false },
    entryMaskVisible: { type: Boolean, value: false },
    entryMaskLeaving: { type: Boolean, value: false },
    entryStatusText: { type: String, value: 'DIY 即将就绪…' },
    entryStatusDetail: { type: String, value: '正在准备首屏内容' },
    entryErrorText: { type: String, value: '' },
    selectedWristCm: { type: null, value: null },
    selectedWristStrands: { type: Number, value: 1 },
  },

  data: (() => {
    const heightRulerItems = buildRulerItems(DIY_HEIGHT_MIN_CM, DIY_HEIGHT_MAX_CM, 5)
    const weightRulerItems = buildRulerItems(DIY_WEIGHT_MIN_KG, DIY_WEIGHT_MAX_KG, 5)
    return {
    heightDraftCm: DIY_DEFAULT_HEIGHT_CM,
    weightDraftKg: DIY_DEFAULT_WEIGHT_KG,
    heightScrollLeft: toRulerScrollLeft(DIY_DEFAULT_HEIGHT_CM, DIY_HEIGHT_MIN_CM),
    weightScrollLeft: toRulerScrollLeft(DIY_DEFAULT_WEIGHT_KG, DIY_WEIGHT_MIN_KG),
    rulerTickPx: RULER_TICK_PX,
    rulerEdgePx: RULER_EDGE_PX,
    heightRulerItems,
    weightRulerItems,
    heightRulerTrackWidthPx: getRulerTrackWidthPx(heightRulerItems.length),
    weightRulerTrackWidthPx: getRulerTrackWidthPx(weightRulerItems.length),
    recommendedWristCm: DEFAULT_WRIST_CM,
    wristDraftCm: DEFAULT_WRIST_CM,
    wristDraftInput: DEFAULT_WRIST_CM.toFixed(1),
    selectedCommonWristCm: null as number | null,
    wristDraftStrands: 1,
    commonWristSizes: COMMON_WRIST_SIZES,
    }
  })(),

  methods: {
    handleCloseGuide() { this.triggerEvent('closeguide') },
    handleCloseWrist() { this.triggerEvent('closewrist') },
    handleCloseSave() { this.triggerEvent('closesave') },
    handleConfirmSave() { this.triggerEvent('confirmsave') },
    handleSaveNameInput(event: WechatMiniprogram.Input) {
      this.triggerEvent('savenamechange', { value: event.detail.value })
    },
    handleRetryEntry() { this.triggerEvent('retryentry') },
    applyEstimatedWrist(heightCm: number, weightKg: number) {
      const recommendedWristCm = estimateWristCm(heightCm, weightKg)
      this.setData({
        heightDraftCm: heightCm,
        weightDraftKg: weightKg,
        recommendedWristCm,
        wristDraftCm: recommendedWristCm,
        wristDraftInput: recommendedWristCm.toFixed(1),
        selectedCommonWristCm: null,
      })
    },
    resolveRulerValue(type: string, scrollLeftInput: unknown): number {
      const scrollLeft = Math.max(0, Number(scrollLeftInput) || 0)
      const isHeight = type === 'height'
      const minimum = isHeight ? DIY_HEIGHT_MIN_CM : DIY_WEIGHT_MIN_KG
      const maximum = isHeight ? DIY_HEIGHT_MAX_CM : DIY_WEIGHT_MAX_KG
      return Math.min(maximum, Math.max(minimum, minimum + Math.round(scrollLeft / RULER_TICK_PX)))
    },
    handleRulerScroll(event: WechatMiniprogram.CustomEvent<{ scrollLeft: number }>) {
      const type = String(event.currentTarget.dataset.type || '')
      const value = this.resolveRulerValue(type, event.detail.scrollLeft)
      if (type === 'height') {
        if (value === this.data.heightDraftCm) return
        this.applyEstimatedWrist(value, this.data.weightDraftKg)
        return
      }
      if (value === this.data.weightDraftKg) return
      this.applyEstimatedWrist(this.data.heightDraftCm, value)
    },
    handleRulerScrollEnd(event: WechatMiniprogram.CustomEvent<{ scrollLeft: number }>) {
      const type = String(event.currentTarget.dataset.type || '')
      const currentScrollLeft = Math.max(0, Number(event.detail.scrollLeft) || 0)
      const value = this.resolveRulerValue(type, event.detail.scrollLeft)
      const targetScrollLeft = toRulerScrollLeft(
        value,
        type === 'height' ? DIY_HEIGHT_MIN_CM : DIY_WEIGHT_MIN_KG,
      )
      const nudgeScrollLeft = targetScrollLeft + (currentScrollLeft <= targetScrollLeft ? 0.01 : -0.01)
      if (type === 'height') {
        this.setData({ heightScrollLeft: nudgeScrollLeft }, () => {
          this.setData({ heightScrollLeft: targetScrollLeft })
        })
        return
      }
      this.setData({ weightScrollLeft: nudgeScrollLeft }, () => {
        this.setData({ weightScrollLeft: targetScrollLeft })
      })
    },
    handleWristInput(event: WechatMiniprogram.Input) {
      const wristDraftInput = String(event.detail.value || '').slice(0, 4)
      const numeric = Number(wristDraftInput)
      this.setData({
        wristDraftInput,
        selectedCommonWristCm: null,
        ...(Number.isFinite(numeric) && numeric > 0
          ? { wristDraftCm: normalizeWristCm(numeric, this.data.recommendedWristCm) }
          : {}),
      })
    },
    handleWristInputBlur() {
      const wristDraftCm = normalizeWristCm(this.data.wristDraftInput, this.data.recommendedWristCm)
      this.setData({ wristDraftCm, wristDraftInput: wristDraftCm.toFixed(1) })
    },
    handleUseRecommendedWrist() {
      const wristDraftCm = this.data.recommendedWristCm
      this.setData({
        wristDraftCm,
        wristDraftInput: wristDraftCm.toFixed(1),
        selectedCommonWristCm: null,
      })
    },
    handleSelectCommonWrist(event: WechatMiniprogram.TouchEvent) {
      const wristDraftCm = normalizeWristCm(event.currentTarget.dataset.value, this.data.recommendedWristCm)
      this.setData({
        wristDraftCm,
        wristDraftInput: wristDraftCm.toFixed(1),
        selectedCommonWristCm: wristDraftCm,
      })
    },
    handleSelectWristStrands(event: WechatMiniprogram.TouchEvent) {
      this.setData({ wristDraftStrands: Number(event.currentTarget.dataset.strands) === 2 ? 2 : 1 })
    },
    handleConfirmWrist() {
      const measuredWristCm = normalizeWristCm(this.data.wristDraftInput, this.data.recommendedWristCm)
      const strands = this.data.wristDraftStrands === 2 ? 2 : 1
      this.triggerEvent('confirmwrist', {
        value: measuredWristCm * strands,
        measuredWristCm,
        strands,
      })
    },
    handleClearWrist() { this.triggerEvent('clearwrist') },
  },
})
