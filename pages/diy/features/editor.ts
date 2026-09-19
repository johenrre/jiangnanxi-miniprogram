import type { DiyMaterial } from '@/api/index'
import {
  calculatePerimeterMm,
  calculateRecommendedWristRange,
  calculateTotalPrice,
  getEditorTrayRadius,
} from '@/pages/diy/engine/geometry'
import type { DiyBead } from '@/pages/diy/model/types'
import { MAXIMUM_MATERIALS_WITHOUT_WRIST } from '@/pages/diy/page/constants'
import type { DiyPageData, DiyPageInstance } from '@/pages/diy/page/types'
import { formatMoney } from '@/pages/diy/page/utils'
import { appSound } from '@/services/sound'

const WRIST_FIT_WARNING_VISIBLE_MS = 2400

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
  if (
    recommendedWristRange
    && selectedWristCm < recommendedWristRange.minimumCm
  ) {
    return {
      status: 'bracelet-too-long',
      minimumWristCm: recommendedWristRange.minimumCm,
    }
  }
  return { status: 'ready' }
}

function buildEditorSummaryData(beads: DiyBead[]): EditorSummaryData {
  const beadCount = beads.length
  const perimeterMm = calculatePerimeterMm(beads)
  const recommendedWristRange = calculateRecommendedWristRange(beads)
  return {
    beadCount,
    totalPriceText: formatMoney(calculateTotalPrice(beads)),
    perimeterText: `${perimeterMm.toFixed(1)} mm`,
    wristMessage: recommendedWristRange
      ? `${recommendedWristRange.minimumCm.toFixed(1)}–${recommendedWristRange.maximumCm.toFixed(1)} cm`
      : '待生成',
    canUndo: beadCount > 0,
    canSave: beadCount > 0,
  }
}

export const editorPageMethods = {
  createBead(this: DiyPageInstance, material: DiyMaterial): DiyBead {
    this.uidSequence += 1
    const editorOrigin = this.editorOrigin || {
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
      x: editorOrigin.centerX,
      y: editorOrigin.centerY + editorOrigin.radius,
      rotation: 0,
    }
  },

  canAddMaterialWithinLimit(this: DiyPageInstance, material: DiyMaterial): boolean {
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

  getWristFitExceededMinimum(this: DiyPageInstance): number | null {
    const selectedWristCm = this.data.selectedWristCm
    if (selectedWristCm === null) return null
    const constraint = resolveStringingConstraint(
      this.beads.length,
      calculateRecommendedWristRange(this.beads),
      selectedWristCm,
    )
    return constraint.status === 'bracelet-too-long'
      ? constraint.minimumWristCm
      : null
  },

  showWristFitWarning(
    this: DiyPageInstance,
    message = '已超过设置手围',
  ): void {
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

  showCurrentWristFitWarning(this: DiyPageInstance): boolean {
    if (this.getWristFitExceededMinimum() === null) return false
    this.showWristFitWarning()
    return true
  },

  addMaterialToBracelet(this: DiyPageInstance, material: DiyMaterial): boolean {
    if (!this.data.canvasReady || !this.renderer) {
      wx.showToast({ title: '画布正在准备', icon: 'none' })
      return false
    }
    if (!this.canAddMaterialWithinLimit(material)) return false

    this.beads.push(this.createBead(material))
    this.invalidateRingLayoutCaches()
    this.startRingAnimation()
    this.updateEditorSummary()
    this.scheduleRender()
    return true
  },

  updateEditorSummary(this: DiyPageInstance): void {
    this.setData(
      buildEditorSummaryData(this.beads),
      () => this.updateMaterialUsageCounts(),
    )
  },

  removeBead(this: DiyPageInstance, uid: string): void {
    if (!this.beads.some((bead) => bead.uid === uid)) return
    appSound.play('discard')
    this.beads = this.beads.filter((bead) => bead.uid !== uid)
    this.invalidateRingLayoutCaches()
    if (this.beads.length > 0) this.startRingAnimation(420)
    this.updateEditorSummary()
    this.scheduleRender()
  },

  handleUndo(this: DiyPageInstance): void {
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
    if (latestBead) this.removeBead(latestBead.uid)
  },

  handleClear(this: DiyPageInstance): void {
    if (this.beads.length === 0) return
    wx.showModal({
      title: '清空当前设计？',
      content: '已添加的珠子会全部移除，此操作无法撤回。',
      confirmText: '清空',
      confirmColor: '#b94632',
      success: (result) => {
        if (!result.confirm) return
        this.beads = []
        this.invalidateRingLayoutCaches()
        this.ringAnimation = null
        this.updateEditorSummary()
        this.scheduleRender()
      },
    })
  },
}
