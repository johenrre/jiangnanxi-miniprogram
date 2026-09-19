import { loadPublicSettings } from '@/api/index'
import {
  calculatePerimeterMm,
  calculateRecommendedWristRange,
  calculateTotalPrice,
  getEditorTrayRadius,
} from '@/pages/diy/engine/geometry'
import { canvasPageMethods } from '@/pages/diy/features/canvas'
import { dialogPageMethods } from '@/pages/diy/features/dialogs'
import { entryPageMethods } from '@/pages/diy/features/entry'
import { INITIAL_GROUP_LIMIT, materialPageMethods } from '@/pages/diy/features/materials'
import { createDiyPageData } from '@/pages/diy/page/data'
import type { DiyPageCustom, DiyPageData } from '@/pages/diy/page/types'
import { cloneBeads, formatMoney, getWindowMetrics } from '@/pages/diy/page/utils'
import {
  consumePendingDiyDesignSnapshot,
  type DiyDesignSnapshot,
} from '@/services/diy-navigation'
import { appSound } from '@/services/sound'
import { loadDiyWristPreference } from '@/services/diy-wrist-preference'
import { resolveCanvasImageUrl } from '@/utils/material-image'

const HISTORY_LIMIT = 20
const WRIST_FIT_WARNING_VISIBLE_MS = 2400
const SHARED_BEADS_QUERY_KEY = 'beads'
const MAXIMUM_MATERIALS_WITHOUT_WRIST = 40
function parseSharedMaterialIds(input: unknown): string[] {
  const queryValue = String(input || '').trim()
  if (!queryValue) return []
  let decoded = queryValue
  try {
    decoded = decodeURIComponent(queryValue)
  } catch {
    return []
  }
  return decoded
    .split(',')
    .map((materialId) => materialId.trim())
    .filter((materialId) => /^[A-Za-z0-9_-]+$/.test(materialId))
    .slice(0, MAXIMUM_MATERIALS_WITHOUT_WRIST)
}

function createSharedDesign(pattern: string[]): DiyDesignSnapshot {
  return { pattern }
}

type EditorSummaryData = Pick<
  DiyPageData,
  | 'beadCount'
  | 'totalPriceText'
  | 'perimeterText'
  | 'wristMessage'
  | 'canUndo'
  | 'canSave'
>

type RecommendedWristRange = ReturnType<typeof calculateRecommendedWristRange>

type StringingConstraint =
  | { status: 'ready' }
  | { status: 'material-limit-exceeded'; maximumMaterials: number }
  | { status: 'bracelet-too-long'; minimumWristCm: number }

function resolveStringingConstraint(
  materialCount: number,
  recommendedWristRange: RecommendedWristRange,
  selectedWristCm: number | null,
): StringingConstraint {
  if (selectedWristCm === null) {
    return materialCount > MAXIMUM_MATERIALS_WITHOUT_WRIST
      ? {
          status: 'material-limit-exceeded',
          maximumMaterials: MAXIMUM_MATERIALS_WITHOUT_WRIST,
        }
      : { status: 'ready' }
  }
  if (!recommendedWristRange) return { status: 'ready' }
  if (selectedWristCm < recommendedWristRange.minimumCm) {
    return {
      status: 'bracelet-too-long',
      minimumWristCm: recommendedWristRange.minimumCm,
    }
  }
  return { status: 'ready' }
}

function buildEditorSummaryData(
  beads: DiyPageCustom['beads'],
): EditorSummaryData {
  const beadCount = beads.length
  const totalPrice = calculateTotalPrice(beads)
  const perimeterMm = calculatePerimeterMm(beads)
  const recommendedWristRange = calculateRecommendedWristRange(beads)
  return {
    beadCount,
    totalPriceText: formatMoney(totalPrice),
    perimeterText: `${perimeterMm.toFixed(1)} mm`,
    wristMessage: recommendedWristRange
      ? `${recommendedWristRange.minimumCm.toFixed(1)}–${recommendedWristRange.maximumCm.toFixed(1)} cm`
      : '待生成',
    canUndo: beadCount > 0,
    canSave: beadCount > 0,
  }
}

Page<DiyPageData, DiyPageCustom>({
  data: createDiyPageData(),

  materials: [],
  materialById: {},
  selectedSizeByGroup: {},
  allVisibleGroups: [],
  visibleGroupLimit: INITIAL_GROUP_LIMIT,
  beads: [],
  history: [],
  uidSequence: 0,
  canvas: null,
  renderer: null,
  canvasLeft: 0,
  canvasTop: 0,
  canvasWidth: 0,
  canvasHeight: 0,
  frameRequestId: null,
  lastFrameTimestamp: 0,
  renderDirty: true,
  pageVisible: false,
  ringAnimation: null,
  editorRingLayoutCache: null,
  ringRotationOffset: 0,
  ringAngularVelocity: 0,
  ringElasticScale: 1,
  ringElasticVelocity: 0,
  ringLayoutDirty: false,
  editorOrigin: null,
  dragState: null,
  firstScreenMaterialImagesReady: false,
  firstCanvasFrameRendered: false,
  entryMaskOpenedAt: 0,
  entryMaskRevealTimer: null,
  entryMaskRemovalTimer: null,
  entryMaskTimeoutTimer: null,
  wristFitWarningTimer: null,
  audioWarmupTimer: null,
  skipEntrySizeGuide: false,
  templateDesignSequence: 0,
  pendingTemplateDesign: null,
  expectsTemplateDesign: false,
  templateDesignApplying: false,
  templateDesignApplied: false,

  ...materialPageMethods,
  ...dialogPageMethods,
  ...entryPageMethods,
  ...canvasPageMethods,

  onLoad(options: Record<string, string | undefined>) {
    const sharedPattern = parseSharedMaterialIds(options[SHARED_BEADS_QUERY_KEY])
    const hasSharedDesign = sharedPattern.length > 0
    const navigationDesign = consumePendingDiyDesignSnapshot()
    const pendingDesign = hasSharedDesign
      ? createSharedDesign(sharedPattern)
      : navigationDesign
    this.materials = []
    this.materialById = {}
    this.selectedSizeByGroup = {}
    this.allVisibleGroups = []
    this.beads = []
    this.history = []
    this.editorRingLayoutCache = null
    this.firstScreenMaterialImagesReady = false
    this.firstCanvasFrameRendered = false
    this.pendingTemplateDesign = null
    this.skipEntrySizeGuide = hasSharedDesign
    this.templateDesignSequence = 0
    this.expectsTemplateDesign = Boolean(pendingDesign)
    this.templateDesignApplying = false
    this.templateDesignApplied = false
    const storedWrist = hasSharedDesign ? null : loadDiyWristPreference()
    if (storedWrist !== null) {
      this.setData({
        selectedWristCm: storedWrist.wristCm * storedWrist.strands,
        selectedWristStrands: storedWrist.strands,
      })
    } else if (hasSharedDesign) {
      this.setData({ selectedWristCm: null, selectedWristStrands: 1 })
    }
    this.openEntryMask()

    const windowInfo = getWindowMetrics()
    const menuButton = wx.getMenuButtonBoundingClientRect()
    const statusBarHeight = windowInfo.statusBarHeight || 24
    const navigationHeight = Math.max(
      44,
      menuButton.bottom - statusBarHeight + Math.max(0, menuButton.top - statusBarHeight),
    )
    this.setData({ statusBarHeight, navigationHeight })
    if (pendingDesign) this.acceptTemplateDesign(pendingDesign)
    void this.loadMaterials()
    void this.loadDiyPresentation()
  },

  async loadDiyPresentation() {
    try {
      const settings = await loadPublicSettings()
      this.setData({ diyPageTitle: settings.diyPageTitle })
    } catch {
      // 配置不可用时继续使用页面默认标题，不阻塞 DIY 编辑。
    }
  },

  onReady() {
    this.initializeCanvas()
  },

  onShow() {
    this.pageVisible = true
    const resumedSnapshot = consumePendingDiyDesignSnapshot()
    if (resumedSnapshot) this.acceptTemplateDesign(resumedSnapshot)
    if (this.audioWarmupTimer === null) {
      this.audioWarmupTimer = setTimeout(() => {
        this.audioWarmupTimer = null
        if (this.pageVisible) appSound.prepare()
      }, 800)
    }
    if (this.renderer && !resumedSnapshot) this.scheduleRender()
    else if (this.ringAnimation) this.requestAnimationFrame()
    void this.tryApplyTemplateDesign()
    this.updateEntryGate()
  },

  onHide() {
    this.pageVisible = false
    if (this.audioWarmupTimer !== null) clearTimeout(this.audioWarmupTimer)
    this.audioWarmupTimer = null
    this.cancelAnimationFrame()
    this.dragState = null
    this.resetRingMotion()
    if (this.beads.length > 0) {
      this.applyRingTargets(this.buildCurrentRingTargets(this.beads))
    }
  },

  onUnload() {
    this.pageVisible = false
    if (this.audioWarmupTimer !== null) clearTimeout(this.audioWarmupTimer)
    this.audioWarmupTimer = null
    this.clearEntryTimers()
    if (this.wristFitWarningTimer !== null) clearTimeout(this.wristFitWarningTimer)
    this.wristFitWarningTimer = null
    this.disposeCanvas()
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    const diyPageTitle = String(this.data.diyPageTitle || '').trim() || '晶石实验室'
    const materialIds = this.beads
      .map((bead) => String(bead.materialId || '').trim())
      .filter(Boolean)
      .slice(0, MAXIMUM_MATERIALS_WITHOUT_WRIST)
    const query = materialIds.length > 0
      ? `?${SHARED_BEADS_QUERY_KEY}=${encodeURIComponent(materialIds.join(','))}`
      : ''
    return {
      title: `我在${diyPageTitle}完成了一条原创手串`,
      path: `/pages/diy/index${query}`,
    }
  },

  createBead(material) {
    this.uidSequence += 1
    const editorPlateOrigin = this.editorOrigin || {
      centerX: this.canvasWidth / 2,
      centerY: this.canvasHeight / 2,
      radius: getEditorTrayRadius(this.canvasWidth, this.canvasHeight),
    }
    return {
      uid: `${material.id}_${Date.now()}_${this.uidSequence}`,
      materialId: material.id,
      name: material.name,
      category: material.category,
      sizeMm: material.sizeMm,
      stringingWidthMm: material.stringingWidthMm,
      stringingPosition: material.stringingPosition,
      stringingOffsetMm: material.stringingOffsetMm,
      price: material.price,
      displayImageUrl: material.imageUrl,
      canvasImageUrl: material.canvasImageUrl,
      imageScale: material.imageScale,
      isIrregular: material.isIrregular,
      layer: material.layer,
      x: editorPlateOrigin.centerX,
      y: editorPlateOrigin.centerY + editorPlateOrigin.radius,
      rotation: 0,
    }
  },

  canAddMaterialWithinLimit(material) {
    const candidateMaterials = [...this.beads, material]
    const constraint = resolveStringingConstraint(
      candidateMaterials.length,
      calculateRecommendedWristRange(candidateMaterials),
      this.data.selectedWristCm,
    )
    if (constraint.status === 'ready') return true
    if (constraint.status === 'material-limit-exceeded') {
      wx.showToast({
        title: `未设置手围时最多添加 ${constraint.maximumMaterials} 颗`,
        icon: 'none',
      })
      return false
    }
    this.showWristFitWarning('已达到设置手围')
    return false
  },

  getWristFitExceededMinimum() {
    const selectedWristCm = this.data.selectedWristCm
    if (selectedWristCm === null) return null
    const currentRange = calculateRecommendedWristRange(this.beads)
    const constraint = resolveStringingConstraint(
      this.beads.length,
      currentRange,
      selectedWristCm,
    )
    return constraint.status === 'bracelet-too-long'
      ? constraint.minimumWristCm
      : null
  },

  showWristFitWarning(message = '已超过设置手围') {
    if (this.wristFitWarningTimer !== null) clearTimeout(this.wristFitWarningTimer)
    this.setData({
      wristFitWarningVisible: true,
      wristFitWarningText: message,
    })
    this.wristFitWarningTimer = setTimeout(() => {
      this.wristFitWarningTimer = null
      this.setData({ wristFitWarningVisible: false, wristFitWarningText: '' })
    }, WRIST_FIT_WARNING_VISIBLE_MS)
  },

  showCurrentWristFitWarning() {
    const minimumCm = this.getWristFitExceededMinimum()
    const selectedWristCm = this.data.selectedWristCm
    if (minimumCm === null || selectedWristCm === null) return false
    this.showWristFitWarning()
    return true
  },

  acceptTemplateDesign(design) {
    this.cancelAnimationFrame()
    this.ringAnimation = null
    this.dragState = null
    this.resetRingMotion()
    this.beads = []
    this.invalidateRingLayoutCaches()
    this.history = []
    this.templateDesignSequence += 1
    this.pendingTemplateDesign = design
    this.expectsTemplateDesign = true
    this.templateDesignApplied = false
    this.renderer?.clear()
    this.setData({
      showSizeGuide: false,
      showGuide: false,
      showWristPicker: false,
      showSaveNameDialog: false,
      wristFitWarningVisible: false,
      wristFitWarningText: '',
      beadCount: 0,
      totalPriceText: '0',
      perimeterText: '0.0 mm',
      wristMessage: '待生成',
      canUndo: false,
      canSave: false,
    })
    void this.tryApplyTemplateDesign()
    this.updateEntryGate()
  },

  async tryApplyTemplateDesign() {
    if (
      !this.expectsTemplateDesign
      || this.templateDesignApplied
      || this.templateDesignApplying
      || !this.pendingTemplateDesign
      || !this.renderer
      || this.materials.length === 0
    ) return

    const design = this.pendingTemplateDesign
    const designSequence = this.templateDesignSequence
    const missingMaterialCount = new Set(
      design.pattern.filter((materialId) => !this.materialById[materialId]),
    ).size
    if (missingMaterialCount > 0) {
      this.expectsTemplateDesign = false
      this.pendingTemplateDesign = null
      wx.showToast({
        title: `${missingMaterialCount}种珠材已下架，无法重新设计`,
        icon: 'none',
      })
      this.updateEntryGate()
      return
    }
    const templateMaterials = design.pattern.map((materialId) => this.materialById[materialId]!)

    this.templateDesignApplying = true
    try {
      const renderer = this.renderer
      await renderer.preloadImages(templateMaterials.map(resolveCanvasImageUrl))
      if (
        !this.pageVisible
        || renderer !== this.renderer
        || designSequence !== this.templateDesignSequence
        || design !== this.pendingTemplateDesign
      ) return

      this.resetRingMotion()
      this.ringAnimation = null
      this.dragState = null
      this.history = []
      this.beads = templateMaterials.map((material) => this.createBead(material))
      this.invalidateRingLayoutCaches()
      this.setData(
        buildEditorSummaryData(this.beads),
        () => this.updateMaterialUsageCounts(),
      )
      this.applyCurrentRingLayout(this.beads)
      this.templateDesignApplied = true
      this.pendingTemplateDesign = null
      this.scheduleRender()
    } finally {
      this.templateDesignApplying = false
      this.updateEntryGate()
      if (
        designSequence !== this.templateDesignSequence
        && this.pendingTemplateDesign
        && !this.templateDesignApplied
      ) {
        void this.tryApplyTemplateDesign()
      }
    }
  },

  addMaterialToBracelet(material, recordHistory = true) {
    if (!this.data.canvasReady || !this.renderer) {
      wx.showToast({ title: '画布正在准备', icon: 'none' })
      return false
    }
    if (!this.canAddMaterialWithinLimit(material)) return false

    if (recordHistory) this.pushHistory()
    const bead = this.createBead(material)
    this.beads.push(bead)
    this.invalidateRingLayoutCaches()
    this.startRingAnimation()
    this.updateEditorSummary()
    this.scheduleRender()
    return true
  },

  updateEditorSummary() {
    const summary = buildEditorSummaryData(this.beads)
    this.setData(summary, () => this.updateMaterialUsageCounts())
  },

  createSnapshot() {
    return { beads: cloneBeads(this.beads) }
  },

  pushHistory(snapshot) {
    this.history.push(snapshot || this.createSnapshot())
    if (this.history.length > HISTORY_LIMIT) this.history.shift()
    this.setData({ canUndo: this.history.length > 0 })
  },

  restoreSnapshot(snapshot) {
    this.ringAnimation = null
    this.dragState = null
    const currentPositions = new Map(this.beads.map((bead) => [
      bead.uid,
      { x: bead.x, y: bead.y, rotation: bead.rotation },
    ]))
    this.beads = cloneBeads(snapshot.beads)
    this.invalidateRingLayoutCaches()
    this.beads.forEach((bead) => {
      const currentPosition = currentPositions.get(bead.uid)
      if (!currentPosition) return
      bead.x = currentPosition.x
      bead.y = currentPosition.y
      bead.rotation = currentPosition.rotation
    })
    if (this.beads.length > 0) this.startRingAnimation()
    else this.resetRingMotion()
    this.updateEditorSummary()
    this.scheduleRender()
  },

  removeBead(uid, historySnapshot, recordHistory = true) {
    const existing = this.beads.find((bead) => bead.uid === uid)
    if (!existing) return
    appSound.play('discard')
    if (recordHistory) this.pushHistory(historySnapshot)
    this.beads = this.beads.filter((bead) => bead.uid !== uid)
    this.invalidateRingLayoutCaches()

    if (this.beads.length === 0) {
      this.ringRotationOffset = 0
      this.resetRingMotion()
    } else {
      this.startRingAnimation(420)
    }
    this.updateEditorSummary()
    this.scheduleRender()
  },

  handleUndo() {
    let latestBead = this.beads[0]
    let latestSequence = -1
    this.beads.forEach((bead, index) => {
      const separatorIndex = bead.uid.lastIndexOf('_')
      const parsedSequence = Number(bead.uid.slice(separatorIndex + 1))
      const sequence = Number.isFinite(parsedSequence) ? parsedSequence : index
      if (sequence < latestSequence) return
      latestBead = bead
      latestSequence = sequence
    })
    if (latestBead) this.removeBead(latestBead.uid, undefined, false)
  },

  handleClear() {
    if (this.beads.length === 0) return
    wx.showModal({
      title: '清空当前设计？',
      content: '已添加的珠子会全部移除，此操作无法撤回。',
      confirmText: '清空',
      confirmColor: '#b94632',
      success: (result) => {
        if (!result.confirm) return
        this.pushHistory()
        this.beads = []
        this.invalidateRingLayoutCaches()
        this.ringAnimation = null
        this.ringRotationOffset = 0
        this.resetRingMotion()
        this.updateEditorSummary()
        this.scheduleRender()
      },
    })
  },

})
