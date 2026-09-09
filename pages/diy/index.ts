import {
  getDesignErrorMessage,
  loadDiscoverDesignWorks,
} from '@/api/index'
import {
  MINIMUM_STRING_BEADS,
  calculatePerimeterMm,
  calculateRecommendedWristRange,
  calculateTotalPrice,
  getBeadCollisionRadiusPx,
  getEditorTrayRadius,
} from '@/pages/diy/engine/geometry'
import {
  TRAY_BACKGROUND_COUNT,
  createDefaultDiyShowcasePresentation,
} from '@/pages/diy/engine/renderer'
import { EDITOR_BEAD_DISPLAY_SCALE, canvasPageMethods } from '@/pages/diy/features/canvas'
import { dialogPageMethods } from '@/pages/diy/features/dialogs'
import { entryPageMethods } from '@/pages/diy/features/entry'
import { INITIAL_GROUP_LIMIT, materialPageMethods } from '@/pages/diy/features/materials'
import { createDiyPageData } from '@/pages/diy/page/data'
import type { DiyPageCustom, DiyPageData, DiyPageInstance } from '@/pages/diy/page/types'
import { cloneBeads, formatMoney, getWindowMetrics } from '@/pages/diy/page/utils'
import {
  consumePendingDiyDesignSnapshot,
  type DiyDesignSnapshot,
} from '@/services/diy-navigation'
import { appSound } from '@/services/sound'
import { prepareAppResources } from '@/services/app-resource-preloader'
import { loadDiyWristPreference } from '@/services/diy-wrist-preference'
import { resolveCanvasImageUrl } from '@/utils/material-image'

const HISTORY_LIMIT = 20
const RANDOM_GENERATION_MINIMUM_MS = 420
const RANDOM_BEAD_LAUNCH_INTERVAL_MINIMUM_MS = 90
const RANDOM_BEAD_LAUNCH_INTERVAL_VARIANCE_MS = 50
const WRIST_FIT_WARNING_VISIBLE_MS = 2400
const SHARED_BEADS_QUERY_KEY = 'beads'
const MAXIMUM_MATERIALS_WITHOUT_WRIST = 40
const SHARE_IMAGE_WIDTH = 1000
const SHARE_IMAGE_HEIGHT = 800
const SHARE_IMAGE_FRAME_TIMEOUT_MS = 1400

interface DiyShareContent extends WechatMiniprogram.Page.ICustomShareContent {
  promise?: Promise<WechatMiniprogram.Page.ICustomShareContent>
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

async function waitForShowcaseShareFrame(page: DiyPageInstance): Promise<void> {
  const deadline = Date.now() + SHARE_IMAGE_FRAME_TIMEOUT_MS
  while (
    page.data.showShowcase
    && !page.data.isClosingShowcase
    && (page.showcaseTransitionDirection !== 'idle' || page.ringAnimation !== null)
    && Date.now() < deadline
  ) {
    await new Promise<void>((resolve) => setTimeout(resolve, 16))
  }
  if (!page.data.showShowcase || page.data.isClosingShowcase || !page.canvas) {
    throw new Error('DIY showcase is not available')
  }
  page.renderEditor()
}

async function createShowcaseShareImage(page: DiyPageInstance): Promise<string> {
  await waitForShowcaseShareFrame(page)
  const canvas = page.canvas
  if (!canvas || canvas.width <= 0 || canvas.height <= 0) {
    throw new Error('DIY canvas is not ready')
  }

  const canvasWidth = Math.floor(page.canvasWidth)
  const canvasHeight = Math.floor(page.canvasHeight)
  if (canvasWidth <= 0 || canvasHeight <= 0) {
    throw new Error('DIY canvas layout is not ready')
  }
  const targetAspectRatio = SHARE_IMAGE_WIDTH / SHARE_IMAGE_HEIGHT
  let sourceWidth = canvasWidth
  let sourceHeight = Math.floor(sourceWidth / targetAspectRatio)
  if (sourceHeight > canvasHeight) {
    sourceHeight = canvasHeight
    sourceWidth = Math.floor(sourceHeight * targetAspectRatio)
  }

  const ringLayout = page.getRingLayout()
  const sourceX = Math.round(clamp(
    ringLayout.centerX - sourceWidth / 2,
    0,
    canvasWidth - sourceWidth,
  ))
  const sourceY = Math.round(clamp(
    ringLayout.centerY - sourceHeight / 2,
    0,
    canvasHeight - sourceHeight,
  ))
  const result = await wx.canvasToTempFilePath({
    canvas,
    x: sourceX,
    y: sourceY,
    width: sourceWidth,
    height: sourceHeight,
    destWidth: SHARE_IMAGE_WIDTH,
    destHeight: SHARE_IMAGE_HEIGHT,
    fileType: 'png',
  })
  if (!result.tempFilePath) throw new Error('DIY share image export failed')
  return result.tempFilePath
}

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
  | 'stringButtonText'
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

function getStringButtonText(
  isStrung: boolean,
  constraint: StringingConstraint,
): string {
  if (isStrung) return '解除串珠'
  if (constraint.status === 'bracelet-too-long') return '超出手围'
  if (constraint.status === 'material-limit-exceeded') return '超出数量'
  return '收拢成串'
}

function buildEditorSummaryData(
  beads: DiyPageCustom['beads'],
  isStrung: boolean,
  selectedWristCm: number | null,
): EditorSummaryData {
  const beadCount = beads.length
  const totalPrice = calculateTotalPrice(beads)
  const perimeterMm = calculatePerimeterMm(beads)
  const recommendedWristRange = calculateRecommendedWristRange(beads)
  const stringingConstraint = resolveStringingConstraint(
    beadCount,
    recommendedWristRange,
    selectedWristCm,
  )
  return {
    beadCount,
    totalPriceText: formatMoney(totalPrice),
    perimeterText: `${perimeterMm.toFixed(1)} mm`,
    wristMessage: recommendedWristRange
      ? `${recommendedWristRange.minimumCm.toFixed(1)}–${recommendedWristRange.maximumCm.toFixed(1)} cm`
      : '待生成',
    stringButtonText: getStringButtonText(isStrung, stringingConstraint),
    canUndo: beadCount > 0,
    canSave: beadCount > 0 && isStrung,
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
  trayBackgroundUrls: [],
  showcasePresentation: createDefaultDiyShowcasePresentation(),
  showcaseBrandImagePath: '',
  physics: null,
  canvasLeft: 0,
  canvasTop: 0,
  canvasWidth: 0,
  canvasHeight: 0,
  frameRequestId: null,
  lastFrameTimestamp: 0,
  frameAccumulator: 0,
  renderDirty: true,
  pageVisible: false,
  ringAnimation: null,
  editorRingLayoutCache: null,
  showcaseRingLayoutCache: null,
  ringRotationOffset: 0,
  ringAngularVelocity: 0,
  ringElasticScale: 1,
  ringElasticVelocity: 0,
  ringLayoutDirty: false,
  showcaseAnimationStartTime: 0,
  showcaseMotionAccumulator: 0,
  showcaseTransitionProgress: 1,
  showcaseTransitionStartProgress: 1,
  showcaseTransitionDirection: 'idle',
  showcasePlateOrigin: null,
  showcaseEntryPositions: null,
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
  randomGenerationSequence: 0,
  lastRandomDesignerId: '',
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
    this.trayBackgroundUrls = []
    this.showcasePresentation = createDefaultDiyShowcasePresentation()
    this.showcaseBrandImagePath = ''
    this.editorRingLayoutCache = null
    this.showcaseRingLayoutCache = null
    this.firstScreenMaterialImagesReady = false
    this.firstCanvasFrameRendered = false
    this.pendingTemplateDesign = null
    this.skipEntrySizeGuide = hasSharedDesign
    this.templateDesignSequence = 0
    this.expectsTemplateDesign = Boolean(pendingDesign)
    this.templateDesignApplying = false
    this.templateDesignApplied = false
    this.lastRandomDesignerId = ''
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
      const { settings } = await prepareAppResources()
      this.trayBackgroundUrls = settings.diyTrayImageUrls
      this.showcasePresentation = {
        appDisplayName: String(settings.appName || '').trim(),
        eyebrow: settings.diyShowcaseEyebrow,
        title: settings.diyShowcaseTitle,
        description: settings.diyShowcaseDescription,
      }
      this.showcaseBrandImagePath = settings.horizontalLogoImageUrl
      this.setData({ diyPageTitle: settings.diyPageTitle })
      const backgroundCount = this.trayBackgroundUrls.length || TRAY_BACKGROUND_COUNT
      const backgroundIndex = this.data.backgroundIndex < backgroundCount
        ? this.data.backgroundIndex
        : 0
      this.renderer?.setTrayBackgroundPaths(this.trayBackgroundUrls, backgroundIndex)
      this.renderer?.setShowcasePresentation(this.showcasePresentation)
      this.renderer?.setShowcaseBrandImagePath(this.showcaseBrandImagePath)
      if (backgroundIndex !== this.data.backgroundIndex) {
        this.setData({ backgroundIndex })
      } else {
        this.scheduleRender()
      }
    } catch {
      // 配置不可用时渲染器继续使用内置珠盘图，不阻塞 DIY 编辑。
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
    else if (this.physics?.hasActiveMotion() || this.ringAnimation) this.requestAnimationFrame()
    void this.tryApplyTemplateDesign()
    this.updateEntryGate()
  },

  onHide() {
    this.pageVisible = false
    this.randomGenerationSequence += 1
    if (this.data.randomGenerating) this.setData({ randomGenerating: false })
    if (this.audioWarmupTimer !== null) clearTimeout(this.audioWarmupTimer)
    this.audioWarmupTimer = null
    this.cancelAnimationFrame()
    this.physics?.cancelDrag()
    this.dragState = null
    this.resetRingMotion()
    if (this.data.isStrung && !this.data.showShowcase && this.beads.length > 0) {
      this.applyRingTargets(this.buildCurrentRingTargets(this.beads))
    }
  },

  onUnload() {
    this.pageVisible = false
    this.randomGenerationSequence += 1
    if (this.audioWarmupTimer !== null) clearTimeout(this.audioWarmupTimer)
    this.audioWarmupTimer = null
    this.clearEntryTimers()
    if (this.wristFitWarningTimer !== null) clearTimeout(this.wristFitWarningTimer)
    this.wristFitWarningTimer = null
    this.disposeCanvas()
  },

  onShareAppMessage(): DiyShareContent {
    const diyPageTitle = String(this.data.diyPageTitle || '').trim() || '晶石实验室'
    const materialIds = this.beads
      .map((bead) => String(bead.materialId || '').trim())
      .filter(Boolean)
      .slice(0, MAXIMUM_MATERIALS_WITHOUT_WRIST)
    const query = materialIds.length > 0
      ? `?${SHARED_BEADS_QUERY_KEY}=${encodeURIComponent(materialIds.join(','))}`
      : ''
    const shareContent: WechatMiniprogram.Page.ICustomShareContent = {
      title: `我在${diyPageTitle}完成了一条原创手串`,
      path: `/pages/diy/index${query}`,
    }
    if (!this.data.showShowcase || this.data.isClosingShowcase || !this.canvas) {
      return shareContent
    }
    return {
      ...shareContent,
      promise: createShowcaseShareImage(this)
        .then((imageUrl) => ({ ...shareContent, imageUrl }))
        .catch((error) => {
          console.error('[DIY] 分享封面生成失败', error)
          return shareContent
        }),
    }
  },

  createBead(material) {
    this.uidSequence += 1
    const editorPlateOrigin = this.showcasePlateOrigin || {
      centerX: this.canvasWidth / 2,
      centerY: this.canvasHeight / 2,
      radius: getEditorTrayRadius(this.canvasWidth, this.canvasHeight),
    }
    const radius = getBeadCollisionRadiusPx(material, EDITOR_BEAD_DISPLAY_SCALE)
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
      x: editorPlateOrigin.centerX + (Math.random() - 0.5) * 42,
      y: editorPlateOrigin.centerY + editorPlateOrigin.radius - radius - 5,
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
    this.randomGenerationSequence += 1
    this.cancelAnimationFrame()
    this.physics?.cancelDrag()
    this.ringAnimation = null
    this.dragState = null
    this.resetRingMotion()
    this.beads = []
    this.physics?.replaceBeads([])
    this.invalidateRingLayoutCaches()
    this.history = []
    this.templateDesignSequence += 1
    this.pendingTemplateDesign = design
    this.expectsTemplateDesign = true
    this.templateDesignApplied = false
    this.renderer?.clear()
    this.setData({
      backgroundIndex: 0,
      isStrung: false,
      showShowcase: false,
      isClosingShowcase: false,
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
      stringButtonText: '收拢成串',
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
      this.physics?.replaceBeads([])
      this.invalidateRingLayoutCaches()
      this.setData({
        isStrung: true,
        ...buildEditorSummaryData(this.beads, true, this.data.selectedWristCm),
      }, () => this.updateMaterialUsageCounts())
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
    if (!this.data.canvasReady || !this.physics || !this.renderer) {
      wx.showToast({ title: '画布正在准备', icon: 'none' })
      return false
    }
    if (!this.canAddMaterialWithinLimit(material)) return false

    if (recordHistory) this.pushHistory()
    const bead = this.createBead(material)
    this.beads.push(bead)
    this.invalidateRingLayoutCaches()

    if (this.data.isStrung) {
      this.startRingAnimation()
    } else {
      const editorPlateOrigin = this.showcasePlateOrigin || {
        centerX: this.canvasWidth / 2,
        centerY: this.canvasHeight / 2,
        radius: getEditorTrayRadius(this.canvasWidth, this.canvasHeight),
      }
      const targetX = editorPlateOrigin.centerX
        + (Math.random() - 0.5) * editorPlateOrigin.radius * 1.15
      const targetY = editorPlateOrigin.centerY
        + (Math.random() - 0.5) * editorPlateOrigin.radius * 1.15
      const directionX = targetX - bead.x
      const directionY = targetY - bead.y
      const directionLength = Math.max(1, Math.sqrt(directionX * directionX + directionY * directionY))
      const launchSpeed = 28 + Math.random() * 18
      this.physics.addBead({
        uid: bead.uid,
        x: bead.x,
        y: bead.y,
        radius: getBeadCollisionRadiusPx(bead, EDITOR_BEAD_DISPLAY_SCALE),
        velocityX: directionX / directionLength * launchSpeed,
        velocityY: directionY / directionLength * launchSpeed,
      })
      this.requestAnimationFrame()
    }
    this.updateEditorSummary()
    this.scheduleRender()
    return true
  },

  updateEditorSummary() {
    const summary = buildEditorSummaryData(
      this.beads,
      this.data.isStrung,
      this.data.selectedWristCm,
    )
    this.setData(summary, () => this.updateMaterialUsageCounts())
  },

  createSnapshot() {
    return { beads: cloneBeads(this.beads), isStrung: this.data.isStrung }
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
    const animateRingReflow = this.data.isStrung && snapshot.isStrung
    this.beads = cloneBeads(snapshot.beads)
    this.invalidateRingLayoutCaches()
    if (animateRingReflow) {
      this.beads.forEach((bead) => {
        const currentPosition = currentPositions.get(bead.uid)
        if (!currentPosition) return
        bead.x = currentPosition.x
        bead.y = currentPosition.y
        bead.rotation = currentPosition.rotation
      })
    }
    this.setData({ isStrung: snapshot.isStrung })
    if (snapshot.isStrung) {
      if (animateRingReflow) this.startRingAnimation()
      else this.applyRingTargets(this.buildCurrentRingTargets(this.beads))
    }
    else this.rebuildLoosePhysics()
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
    this.physics?.removeBead(uid)

    if (this.beads.length === 0 && this.data.isStrung) {
      this.setData({ isStrung: false })
      this.ringRotationOffset = 0
      this.resetRingMotion()
    } else if (this.data.isStrung) {
      this.startRingAnimation(420)
    }
    this.updateEditorSummary()
    this.scheduleRender()
  },

  handleToggleString() {
    appSound.resumeOnInteraction()
    if (this.data.randomGenerating) return
    if (this.beads.length === 0) {
      wx.showToast({ title: '请先添加珠子', icon: 'none' })
      return
    }
    if (this.data.isStrung) {
      this.pushHistory()
      this.ringAnimation = null
      this.resetRingMotion()
      this.setData({
        isStrung: false,
        ...buildEditorSummaryData(this.beads, false, this.data.selectedWristCm),
      })
      this.rebuildLoosePhysics(true)
      return
    }
    if (this.beads.length < MINIMUM_STRING_BEADS) {
      wx.showToast({ title: `至少需要 ${MINIMUM_STRING_BEADS} 颗珠子`, icon: 'none' })
      return
    }
    const recommendedWristRange = calculateRecommendedWristRange(this.beads)
    const stringingConstraint = resolveStringingConstraint(
      this.beads.length,
      recommendedWristRange,
      this.data.selectedWristCm,
    )
    if (stringingConstraint.status === 'bracelet-too-long') {
      wx.showToast({
        title: `已超过手围，当前最小 ${stringingConstraint.minimumWristCm.toFixed(1)}cm`,
        icon: 'none',
      })
    }
    if (stringingConstraint.status === 'material-limit-exceeded') {
      wx.showToast({
        title: `未设置手围时最多添加 ${stringingConstraint.maximumMaterials} 颗`,
        icon: 'none',
      })
      return
    }

    this.pushHistory()
    appSound.play('soft-pop')
    this.syncBeadsFromPhysics()
    this.physics?.cancelDrag()
    this.physics?.replaceBeads([])
    this.setData({
      isStrung: true,
      ...buildEditorSummaryData(this.beads, true, this.data.selectedWristCm),
    }, () => {
      this.startRingAnimation()
    })
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
        this.physics?.replaceBeads([])
        this.setData({ isStrung: false })
        this.updateEditorSummary()
        this.scheduleRender()
      },
    })
  },

  async handleRandomDesign() {
    appSound.resumeOnInteraction()
    if (this.data.randomGenerating) return
    if (
      !this.data.canvasReady
      || !this.renderer
      || !this.physics
    ) {
      wx.showToast({ title: 'DIY 画布正在准备', icon: 'none' })
      return
    }

    const renderer = this.renderer
    const physics = this.physics
    const generationSequence = ++this.randomGenerationSequence
    const startedAt = Date.now()
    let generationCompleted = false
    this.setData({ randomGenerating: true })

    try {
      const designPage = await loadDiscoverDesignWorks('designer')
      const availableDesigns = designPage.items.filter((design) => (
        design.pattern.length > 0
        && design.pattern.every((materialId) => Boolean(this.materialById[materialId]))
      ))
      if (availableDesigns.length === 0) {
        throw new Error('暂时没有可用的设计师方案')
      }
      const alternativeDesigns = availableDesigns.length > 1
        ? availableDesigns.filter((design) => design.id !== this.lastRandomDesignerId)
        : availableDesigns
      const candidates = alternativeDesigns.length > 0 ? alternativeDesigns : availableDesigns
      const selectedDesign = candidates[Math.floor(Math.random() * candidates.length)]
      const selectedMaterials = selectedDesign.pattern.map(
        (materialId) => this.materialById[materialId]!,
      )
      if (selectedMaterials.length === 0) {
        throw new Error('当前设计师方案缺少可用珠材')
      }

      await renderer.preloadImages(selectedMaterials.map(resolveCanvasImageUrl))
      const remainingDelay = RANDOM_GENERATION_MINIMUM_MS - (Date.now() - startedAt)
      if (remainingDelay > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, remainingDelay))
      }
      if (
        generationSequence !== this.randomGenerationSequence
        || !this.pageVisible
        || renderer !== this.renderer
        || physics !== this.physics
      ) return

      this.pushHistory()
      this.ringAnimation = null
      this.ringRotationOffset = 0
      this.resetRingMotion()
      this.beads = []
      this.invalidateRingLayoutCaches()
      physics.replaceBeads([])
      this.setData({ isStrung: false })
      this.updateEditorSummary()
      this.scheduleRender()
      const editorPlateOrigin = this.showcasePlateOrigin || {
        centerX: this.canvasWidth / 2,
        centerY: this.canvasHeight / 2,
        radius: getEditorTrayRadius(this.canvasWidth, this.canvasHeight),
      }
      for (let index = 0; index < selectedMaterials.length; index += 1) {
        if (
          generationSequence !== this.randomGenerationSequence
          || !this.pageVisible
          || renderer !== this.renderer
          || physics !== this.physics
        ) return

        const material = selectedMaterials[index]
        if (!material) continue
        const bead = this.createBead(material)
        this.beads.push(bead)
        const targetX = editorPlateOrigin.centerX
          + (Math.random() - 0.5) * editorPlateOrigin.radius * 1.15
        const targetY = editorPlateOrigin.centerY
          + (Math.random() - 0.5) * editorPlateOrigin.radius * 1.15
        const directionX = targetX - bead.x
        const directionY = targetY - bead.y
        const directionLength = Math.max(1, Math.sqrt(directionX * directionX + directionY * directionY))
        const launchSpeed = 28 + Math.random() * 18
        physics.addBead({
          uid: bead.uid,
          x: bead.x,
          y: bead.y,
          radius: getBeadCollisionRadiusPx(bead, EDITOR_BEAD_DISPLAY_SCALE),
          rotation: bead.rotation,
          velocityX: directionX / directionLength * launchSpeed,
          velocityY: directionY / directionLength * launchSpeed,
        })
        this.updateEditorSummary()
        this.scheduleRender()

        if (index < selectedMaterials.length - 1) {
          const launchInterval = RANDOM_BEAD_LAUNCH_INTERVAL_MINIMUM_MS
            + Math.random() * RANDOM_BEAD_LAUNCH_INTERVAL_VARIANCE_MS
          await new Promise<void>((resolve) => setTimeout(resolve, launchInterval))
        }
      }
      this.showCurrentWristFitWarning()
      this.lastRandomDesignerId = selectedDesign.id
      generationCompleted = true
    } catch (error) {
      if (generationSequence === this.randomGenerationSequence) {
        wx.showToast({ title: getDesignErrorMessage(error), icon: 'none' })
      }
    } finally {
      if (generationSequence === this.randomGenerationSequence) {
        this.setData({ randomGenerating: false }, () => {
          if (generationCompleted && this.pageVisible) appSound.play('soft-pop')
        })
      }
    }
  },

  handleToggleBackground() {
    appSound.play('soft-pop')
    const backgroundCount = this.renderer?.getTrayBackgroundCount()
      || this.trayBackgroundUrls.length
      || TRAY_BACKGROUND_COUNT
    this.setData({
      backgroundIndex: (this.data.backgroundIndex + 1) % backgroundCount,
    })
    this.scheduleRender()
  },
})
