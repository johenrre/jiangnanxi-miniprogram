import { loadPublicSettings } from '@/api/index'
import {
  buildDiyShareContent,
  consumeResumedDiyDesign,
  resolveInitialDiyDesign,
} from '@/pages/diy/features/design'
import { INITIAL_MATERIAL_GROUP_LIMIT } from '@/pages/diy/page/constants'
import type { DiyPageInstance } from '@/pages/diy/page/types'
import { getWindowMetrics } from '@/pages/diy/page/utils'
import { appSound } from '@/services/sound'
import { loadDiyWristPreference } from '@/services/diy-wrist-preference'

const AUDIO_WARMUP_DELAY_MS = 800

export const lifecyclePageMethods = {
  onLoad(
    this: DiyPageInstance,
    options: Record<string, string | undefined>,
  ): void {
    const { design, hasSharedDesign } = resolveInitialDiyDesign(options)
    this.materials = []
    this.materialById = {}
    this.selectedSizeByGroup = {}
    this.allVisibleGroups = []
    this.visibleGroupLimit = INITIAL_MATERIAL_GROUP_LIMIT
    this.beads = []
    this.uidSequence = 0
    this.editorRingLayoutCache = null
    this.firstScreenMaterialImagesReady = false
    this.firstCanvasFrameRendered = false
    this.pendingTemplateDesign = null
    this.templateDesignSequence = 0
    this.expectsTemplateDesign = Boolean(design)
    this.templateDesignApplying = false
    this.templateDesignApplied = false

    const storedWrist = hasSharedDesign ? null : loadDiyWristPreference()
    this.setData({
      selectedWristCm: storedWrist
        ? storedWrist.wristCm * storedWrist.strands
        : null,
      selectedWristStrands: storedWrist?.strands || 1,
    })
    this.openEntryMask()

    const windowInfo = getWindowMetrics()
    const menuButton = wx.getMenuButtonBoundingClientRect()
    const statusBarHeight = windowInfo.statusBarHeight || 24
    const navigationHeight = Math.max(
      44,
      menuButton.bottom - statusBarHeight + Math.max(0, menuButton.top - statusBarHeight),
    )
    this.setData({ statusBarHeight, navigationHeight })
    if (design) this.acceptTemplateDesign(design)
    void this.loadMaterials()
    void this.loadDiyPresentation()
  },

  async loadDiyPresentation(this: DiyPageInstance): Promise<void> {
    try {
      const settings = await loadPublicSettings()
      this.setData({ diyPageTitle: settings.diyPageTitle })
    } catch {
      // 配置不可用时继续使用页面默认标题，不阻塞 DIY 编辑。
    }
  },

  onReady(this: DiyPageInstance): void {
    this.initializeCanvas()
  },

  onShow(this: DiyPageInstance): void {
    this.pageVisible = true
    const resumedDesign = consumeResumedDiyDesign()
    if (resumedDesign) this.acceptTemplateDesign(resumedDesign)
    if (this.audioWarmupTimer === null) {
      this.audioWarmupTimer = setTimeout(() => {
        this.audioWarmupTimer = null
        if (this.pageVisible) appSound.prepare()
      }, AUDIO_WARMUP_DELAY_MS)
    }
    if (this.renderer && !resumedDesign) this.scheduleRender()
    else if (this.ringAnimation) this.requestAnimationFrame()
    void this.tryApplyTemplateDesign()
    this.updateEntryGate()
  },

  onHide(this: DiyPageInstance): void {
    this.pageVisible = false
    if (this.audioWarmupTimer !== null) clearTimeout(this.audioWarmupTimer)
    this.audioWarmupTimer = null
    this.cancelAnimationFrame()
    this.dragState = null
    if (this.beads.length > 0) {
      this.applyRingTargets(this.buildCurrentRingTargets(this.beads))
    }
  },

  onUnload(this: DiyPageInstance): void {
    this.pageVisible = false
    if (this.audioWarmupTimer !== null) clearTimeout(this.audioWarmupTimer)
    this.audioWarmupTimer = null
    this.clearEntryTimers()
    if (this.wristFitWarningTimer !== null) clearTimeout(this.wristFitWarningTimer)
    this.wristFitWarningTimer = null
    this.disposeCanvas()
  },

  onShareAppMessage(
    this: DiyPageInstance,
  ): WechatMiniprogram.Page.ICustomShareContent {
    return buildDiyShareContent(String(this.data.diyPageTitle || ''), this.beads)
  },
}
