import type { DiyPageInstance } from '@/pages/diy/page/types'
import { ensureAuthenticated } from '@/services/auth-gate'
import { appSound } from '@/services/sound'
import { setDiySettlementPreview } from '@/services/diy-settlement-preview'
import {
  clearDiyWristPreference,
  saveDiyWristPreference,
  type DiyWristStrands,
} from '@/services/diy-wrist-preference'
import {
  getApiErrorMessage,
  saveDiyDesign,
} from '@/api/index'

function suspendCanvasForDialog(page: DiyPageInstance): void {
  page.dragState = null
  page.cancelAnimationFrame()
}

function resumeCanvasAfterDialog(page: DiyPageInstance): void {
  page.scheduleRender()
}

export const dialogPageMethods = {
  handleOpenGuide(this: DiyPageInstance): void {
    suspendCanvasForDialog(this)
    this.setData({
      showGuide: true,
      showWristPicker: false,
      showSaveNameDialog: false,
    })
  },

  handleCloseGuide(this: DiyPageInstance): void {
    this.setData(
      { showGuide: false },
      () => resumeCanvasAfterDialog(this),
    )
  },

  handleOpenWristPicker(this: DiyPageInstance): void {
    appSound.play('soft-pop')
    suspendCanvasForDialog(this)
    this.setData({
      showGuide: false,
      showWristPicker: true,
      showSaveNameDialog: false,
    })
  },

  handleCloseWristPicker(this: DiyPageInstance): void {
    this.setData(
      { showWristPicker: false },
      () => resumeCanvasAfterDialog(this),
    )
  },

  handleConfirmWrist(
    this: DiyPageInstance,
    event: WechatMiniprogram.CustomEvent<{
      value: number
      measuredWristCm: number
      strands: DiyWristStrands
    }>,
  ): void {
    const wrist = Number(event.detail.value)
    const measuredWristCm = Number(event.detail.measuredWristCm)
    const strands: DiyWristStrands = Number(event.detail.strands) === 2 ? 2 : 1
    if (!Number.isFinite(wrist) || !Number.isFinite(measuredWristCm)) return
    saveDiyWristPreference(measuredWristCm, strands)
    this.setData(
      {
        selectedWristCm: wrist,
        selectedWristStrands: strands,
        showWristPicker: false,
      },
      () => {
        this.updateEditorSummary()
        resumeCanvasAfterDialog(this)
        this.showCurrentWristFitWarning()
      },
    )
  },

  handleClearWrist(this: DiyPageInstance): void {
    clearDiyWristPreference()
    this.setData(
      {
        selectedWristCm: null,
        selectedWristStrands: 1,
        showWristPicker: false,
        wristFitWarningVisible: false,
        wristFitWarningText: '',
      },
      () => {
        this.updateEditorSummary()
        resumeCanvasAfterDialog(this)
      },
    )
  },

  async handleSaveDesign(this: DiyPageInstance): Promise<void> {
    if (!this.data.canSave) {
      wx.showToast({
        title: '请先添加珠子',
        icon: 'none',
      })
      return
    }
    if (this.data.savingDesign) return
    appSound.play('soft-pop')
    if (!(await ensureAuthenticated(this, {
      content: '登录后可将当前作品保存到「我的设计」。',
    }))) {
      return
    }
    suspendCanvasForDialog(this)
    this.setData({
      showGuide: false,
      showWristPicker: false,
      designNameDraft: '',
      showSaveNameDialog: true,
    })
  },

  handleDesignNameInput(
    this: DiyPageInstance,
    event: WechatMiniprogram.CustomEvent<{ value: string }>,
  ): void {
    this.setData({ designNameDraft: String(event.detail.value || '').slice(0, 20) })
  },

  handleCloseSaveName(this: DiyPageInstance): void {
    if (this.data.savingDesign) return
    this.setData(
      { showSaveNameDialog: false, designNameDraft: '' },
      () => resumeCanvasAfterDialog(this),
    )
  },

  async handleConfirmSaveDesign(this: DiyPageInstance): Promise<void> {
    if (this.data.savingDesign) return
    const designName = this.data.designNameDraft.trim()
    if (!designName) {
      wx.showToast({ title: '请给设计取个名字', icon: 'none' })
      return
    }
    if (!this.data.canSave) {
      this.setData({ showSaveNameDialog: false, designNameDraft: '' })
      wx.showToast({ title: '当前手串为空，请重新添加珠子', icon: 'none' })
      resumeCanvasAfterDialog(this)
      return
    }

    this.setData({ savingDesign: true })
    try {
      await saveDiyDesign(this.beads, designName)
      this.setData(
        {
          savingDesign: false,
          showSaveNameDialog: false,
          designNameDraft: '',
        },
        () => resumeCanvasAfterDialog(this),
      )
      wx.showToast({ title: '保存成功', icon: 'success' })
    } catch (error) {
      this.setData({ savingDesign: false })
      wx.showToast({ title: getApiErrorMessage(error, '设计保存失败'), icon: 'none' })
    }
  },

  async handleAddToCart(this: DiyPageInstance): Promise<void> {
    if (this.beads.length === 0) {
      wx.showToast({ title: '请先添加珠子', icon: 'none' })
      return
    }
    appSound.play('soft-pop')
    if (!(await ensureAuthenticated(this, {
      content: '登录后可预览当前手串并继续结算。',
    }))) {
      return
    }
    setDiySettlementPreview({
      beads: this.beads,
    })
    wx.navigateTo({ url: '/pages/cart/settlement-detail/index?source=diy' })
  },
}
