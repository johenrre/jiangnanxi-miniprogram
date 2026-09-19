import type { DiyBead } from '@/pages/diy/model/types'
import { MAXIMUM_MATERIALS_WITHOUT_WRIST } from '@/pages/diy/page/constants'
import type { DiyPageInstance } from '@/pages/diy/page/types'
import {
  consumePendingDiyDesignSnapshot,
  type DiyDesignSnapshot,
} from '@/services/diy-navigation'
import { resolveCanvasImageUrl } from '@/utils/material-image'

const SHARED_BEADS_QUERY_KEY = 'beads'

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

export function resolveInitialDiyDesign(
  options: Record<string, string | undefined>,
): { design: DiyDesignSnapshot | null; hasSharedDesign: boolean } {
  const sharedPattern = parseSharedMaterialIds(options[SHARED_BEADS_QUERY_KEY])
  const hasSharedDesign = sharedPattern.length > 0
  const navigationDesign = consumePendingDiyDesignSnapshot()
  return {
    design: hasSharedDesign ? { pattern: sharedPattern } : navigationDesign,
    hasSharedDesign,
  }
}

export function consumeResumedDiyDesign(): DiyDesignSnapshot | null {
  return consumePendingDiyDesignSnapshot()
}

export function buildDiyShareContent(
  pageTitle: string,
  beads: DiyBead[],
): WechatMiniprogram.Page.ICustomShareContent {
  const title = pageTitle.trim() || '晶石实验室'
  const materialIds = beads
    .map((bead) => String(bead.materialId || '').trim())
    .filter(Boolean)
    .slice(0, MAXIMUM_MATERIALS_WITHOUT_WRIST)
  const query = materialIds.length > 0
    ? `?${SHARED_BEADS_QUERY_KEY}=${encodeURIComponent(materialIds.join(','))}`
    : ''
  return {
    title: `我在${title}完成了一条原创手串`,
    path: `/pages/diy/index${query}`,
  }
}

export const designPageMethods = {
  acceptTemplateDesign(this: DiyPageInstance, design: DiyDesignSnapshot): void {
    this.cancelAnimationFrame()
    this.ringAnimation = null
    this.dragState = null
    this.beads = []
    this.invalidateRingLayoutCaches()
    this.templateDesignSequence += 1
    this.pendingTemplateDesign = design
    this.expectsTemplateDesign = true
    this.templateDesignApplied = false
    this.renderer?.clear()
    this.setData({
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

  async tryApplyTemplateDesign(this: DiyPageInstance): Promise<void> {
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

      this.ringAnimation = null
      this.dragState = null
      this.beads = templateMaterials.map((material) => this.createBead(material))
      this.invalidateRingLayoutCaches()
      this.updateEditorSummary()
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
}
