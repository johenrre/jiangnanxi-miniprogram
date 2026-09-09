import type { DiyPageInstance } from '@/pages/diy/page/types'

const MINIMUM_MASK_VISIBLE_MS = 2000
const MASK_FADE_DURATION_MS = 180
const ENTRY_TIMEOUT_MS = 8000

function updateMaskText(
  page: DiyPageInstance,
  statusText: string,
  detailText: string,
  errorText = '',
): void {
  if (
    page.data.entryStatusText === statusText
    && page.data.entryStatusDetail === detailText
    && page.data.entryErrorText === errorText
  ) return
  page.setData({ entryStatusText: statusText, entryStatusDetail: detailText, entryErrorText: errorText })
}

export const entryPageMethods = {
  openEntryMask(this: DiyPageInstance): void {
    this.clearEntryTimers()
    this.entryMaskOpenedAt = 0
    this.setData({
      entryMaskVisible: true,
      entryMaskLeaving: false,
      entryStatusText: '正在准备 DIY 设计台…',
      entryStatusDetail: '正在加载盘子与材料',
      entryErrorText: '',
    })
    this.entryMaskTimeoutTimer = setTimeout(() => {
      this.entryMaskTimeoutTimer = null
      if (!this.data.entryMaskVisible || this.data.entryMaskLeaving) return
      updateMaskText(
        this,
        '首屏准备时间较长',
        '核心内容尚未完成',
        '请检查网络后重新加载',
      )
    }, ENTRY_TIMEOUT_MS)
  },

  updateEntryGate(this: DiyPageInstance): void {
    if (!this.pageVisible || !this.data.entryMaskVisible || this.data.entryMaskLeaving) return
    if (this.entryMaskOpenedAt <= 0) this.entryMaskOpenedAt = Date.now()

    if (this.data.materialsError) {
      updateMaskText(this, '材料加载失败', '核心材料未能加载', this.data.materialsError)
      return
    }
    if (!this.data.canvasReady || !this.renderer) {
      updateMaskText(this, '正在初始化画布…', '准备托盘和交互区域')
      return
    }
    if (!this.renderer.areEditorEntryImagesSettled(this.data.backgroundIndex)) {
      updateMaskText(this, '正在加载盘子背景…', '准备当前编辑场景')
      return
    }
    if (this.data.loadingMaterials) {
      updateMaskText(this, '正在同步核心素材…', '读取水晶、木珠和配饰')
      return
    }
    if (this.expectsTemplateDesign && !this.templateDesignApplied) {
      updateMaskText(this, '正在载入设计方案…', '按作品顺序排好珠材')
      void this.tryApplyTemplateDesign()
      return
    }
    if (!this.firstScreenMaterialImagesReady) {
      updateMaskText(this, '正在准备首屏素材…', '预载当前可见的材料图片')
      return
    }
    if (!this.firstCanvasFrameRendered) {
      updateMaskText(this, '正在合成首屏…', '完成托盘第一帧绘制')
      return
    }

    this.revealEntryMask()
  },

  revealEntryMask(this: DiyPageInstance): void {
    if (this.entryMaskRevealTimer !== null || this.entryMaskRemovalTimer !== null) return
    if (this.entryMaskTimeoutTimer !== null) {
      clearTimeout(this.entryMaskTimeoutTimer)
      this.entryMaskTimeoutTimer = null
    }
    const elapsedMs = Date.now() - this.entryMaskOpenedAt
    const revealDelayMs = Math.max(0, MINIMUM_MASK_VISIBLE_MS - elapsedMs)
    this.entryMaskRevealTimer = setTimeout(() => {
      this.entryMaskRevealTimer = null
      this.setData({ entryMaskLeaving: true }, () => {
        this.entryMaskRemovalTimer = setTimeout(() => {
          this.entryMaskRemovalTimer = null
          this.setData(
            { entryMaskVisible: false, entryMaskLeaving: false },
            () => {
              if (this.skipEntrySizeGuide) {
                this.scheduleRender()
                return
              }
              this.handleOpenSizeGuide()
            },
          )
        }, MASK_FADE_DURATION_MS)
      })
    }, revealDelayMs)
  },

  clearEntryTimers(this: DiyPageInstance): void {
    if (this.entryMaskRevealTimer !== null) clearTimeout(this.entryMaskRevealTimer)
    if (this.entryMaskRemovalTimer !== null) clearTimeout(this.entryMaskRemovalTimer)
    if (this.entryMaskTimeoutTimer !== null) clearTimeout(this.entryMaskTimeoutTimer)
    this.entryMaskRevealTimer = null
    this.entryMaskRemovalTimer = null
    this.entryMaskTimeoutTimer = null
  },

  handleRetryEntry(this: DiyPageInstance): void {
    this.firstScreenMaterialImagesReady = false
    this.firstCanvasFrameRendered = false
    this.openEntryMask()
    if (!this.data.canvasReady || !this.renderer) this.initializeCanvas()
    else this.scheduleRender()
    void this.loadMaterials(true)
  },
}
