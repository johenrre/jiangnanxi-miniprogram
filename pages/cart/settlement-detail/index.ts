import {
  addDiyDesignToCart,
  clearAuthSession,
  getApiErrorMessage,
  hasAuthSession,
  isApiUnauthorized,
  loadCartItems,
  loadPublicSettings,
  type CartItem,
} from '@/api/index'
import { ensureAuthenticated } from '@/services/auth-gate'
import { setCheckoutIntent } from '@/services/checkout-intent'
import {
  getDiySettlementPreview,
  type DiySettlementPreviewSnapshot,
} from '@/services/diy-settlement-preview'
import { navigateToDiyWithSnapshot } from '@/services/diy-navigation'
import {
  calculateCartLineAmount,
  formatMoneyFromCents,
} from '@/utils/cart-calculations'
import {
  buildCartMaterialBreakdown,
  buildCartWristRangeText,
  type CartMaterialBreakdownItem,
} from '@/pages/cart/shared/item-view'

type SettlementStatus = 'login' | 'loading' | 'ready' | 'missing' | 'error'

interface SettlementItemView extends CartItem {
  wristRangeText: string
  lineTotalText: string
  materialRows: CartMaterialBreakdownItem[]
}

type SettlementSourceMode = 'cart' | 'diy'

interface SettlementActionContext {
  data: {
    addedCartItemId: string
  }
  setData(data: WechatMiniprogram.IAnyObject): void
}

function buildSettlementItem(item: CartItem): SettlementItemView {
  const line = calculateCartLineAmount(item)
  return {
    ...item,
    wristRangeText: buildCartWristRangeText(item),
    lineTotalText: formatMoneyFromCents(line.lineTotalCents),
    materialRows: buildCartMaterialBreakdown(item),
  }
}

function buildDiyPreviewItem(snapshot: DiySettlementPreviewSnapshot): SettlementItemView {
  const materialMap: CartItem['materialMap'] = {}
  snapshot.beads.forEach((bead) => {
    if (materialMap[bead.materialId]) return
    materialMap[bead.materialId] = {
      id: bead.materialId,
      name: bead.name,
      size: bead.sizeMm,
      imageUrl: bead.displayImageUrl,
      canvasImageUrl: bead.canvasImageUrl,
      variants: [],
      stringingWidthMm: bead.stringingWidthMm,
      stringingPosition: bead.stringingPosition,
      stringingOffsetMm: bead.stringingOffsetMm,
      imageScale: bead.imageScale,
      isIrregular: bead.isIrregular,
      layer: bead.layer,
      price: bead.price,
    }
  })
  const perimeterMm = snapshot.beads.reduce((total, bead) => (
    total + (bead.stringingWidthMm && bead.stringingWidthMm > 0
      ? bead.stringingWidthMm
      : Math.max(0, bead.sizeMm))
  ), 0)
  const unitPriceCents = snapshot.beads.reduce(
    (total, bead) => total + Math.round(Math.max(0, bead.price) * 100),
    0,
  )
  return buildSettlementItem({
    id: 'diy_preview',
    itemType: 'diy_design',
    refId: '',
    section: 'customer',
    name: '当前 DIY 设计',
    subtitle: '',
    coverUrl: '',
    pattern: snapshot.beads.map((bead) => bead.materialId),
    materialMap,
    beadSize: snapshot.beads[0]?.sizeMm || 11,
    perimeterMm,
    unitPriceCents,
    quantity: 1,
    checked: true,
    available: true,
    addedAt: snapshot.createdAt,
  })
}

async function ensureDiyCartItem(context: SettlementActionContext): Promise<string> {
  if (context.data.addedCartItemId) return context.data.addedCartItemId
  const snapshot = getDiySettlementPreview()
  if (!snapshot) throw new Error('当前 DIY 设计预览已失效，请返回重新生成')
  const result = await addDiyDesignToCart(snapshot.beads)
  const cartItemId = `diy_design:${result.designCode}`
  context.setData({ addedCartItemId: cartItemId })
  return cartItemId
}

Page({
  data: {
    status: 'loading' as SettlementStatus,
    sourceMode: 'cart' as SettlementSourceMode,
    itemId: '',
    item: null as SettlementItemView | null,
    trayBackgroundUrl: '/assets/bg_1.jpg',
    addedCartItemId: '',
    actionBusy: false,
    purchaseNoticeImageUrls: [] as string[],
    errorMessage: '',
  },

  onLoad(options: { id?: string; source?: string }) {
    const rawItemId = String(options.id || '').trim()
    let itemId = rawItemId
    try {
      itemId = decodeURIComponent(rawItemId)
    } catch {
      itemId = rawItemId
    }
    this.setData({
      itemId,
      sourceMode: options.source === 'diy' ? 'diy' : 'cart',
    })
    void this.loadData()
  },

  async loadData() {
    if (!hasAuthSession()) {
      this.setData({ status: 'login', item: null, errorMessage: '' })
      return
    }
    if (this.data.sourceMode === 'diy') {
      const snapshot = getDiySettlementPreview()
      if (!snapshot) {
        this.setData({ status: 'missing', item: null })
        return
      }
      this.setData({ status: 'loading', errorMessage: '' })
      try {
        const settings = await loadPublicSettings()
        this.setData({
          status: 'ready',
          item: buildDiyPreviewItem(snapshot),
          purchaseNoticeImageUrls: settings.purchaseNoticeImageUrls,
          trayBackgroundUrl: settings.diyTrayImageUrls[0] || '/assets/bg_1.jpg',
        })
      } catch (error) {
        this.setData({
          status: 'error',
          item: null,
          errorMessage: getApiErrorMessage(error, '结算预览加载失败，请稍后重试'),
        })
      }
      return
    }
    if (!this.data.itemId) {
      this.setData({ status: 'missing', item: null })
      return
    }

    this.setData({ status: 'loading', errorMessage: '' })
    try {
      const [items, settings] = await Promise.all([
        loadCartItems(),
        loadPublicSettings(),
      ])
      const source = items.find((item) => item.id === this.data.itemId)
      if (!source || source.itemType !== 'diy_design') {
        this.setData({ status: 'missing', item: null })
        return
      }
      this.setData({
        status: 'ready',
        item: buildSettlementItem(source),
        purchaseNoticeImageUrls: settings.purchaseNoticeImageUrls,
        trayBackgroundUrl: settings.diyTrayImageUrls[0] || '/assets/bg_1.jpg',
      })
    } catch (error) {
      if (isApiUnauthorized(error)) {
        clearAuthSession()
        this.setData({ status: 'login', item: null, errorMessage: '' })
        return
      }
      this.setData({
        status: 'error',
        item: null,
        errorMessage: getApiErrorMessage(error, '结算详情加载失败，请稍后重试'),
      })
    }
  },

  handleRetry() {
    void this.loadData()
  },

  async handleLogin() {
    if (!(await ensureAuthenticated(this, {
      content: '登录后可查看当前商品的结算详情。',
    }))) {
      return
    }
    await this.loadData()
  },

  handleMaterialImageError(event: WechatMiniprogram.CustomEvent) {
    const index = Number(event.currentTarget.dataset.index)
    if (!Number.isInteger(index) || index < 0) return
    this.setData({ [`item.materialRows[${index}].imageUrl`]: '' })
  },

  handleCoverImageError() {
    this.setData({ 'item.coverUrl': '' })
  },

  handleReturnCart() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack()
      return
    }
    wx.redirectTo({ url: '/pages/cart/index' })
  },

  handleRedesign() {
    const item = this.data.item
    if (this.data.sourceMode !== 'cart' || !item || this.data.actionBusy) return
    this.setData({ actionBusy: true })
    navigateToDiyWithSnapshot(item.pattern, {
      fail: () => wx.showToast({ title: '重新设计页面打开失败', icon: 'none' }),
      complete: () => this.setData({ actionBusy: false }),
    })
  },

  async handleAddToCart() {
    if (this.data.sourceMode === 'cart') {
      this.handleReturnCart()
      return
    }
    if (this.data.actionBusy) return
    this.setData({ actionBusy: true })
    wx.showLoading({ title: '正在加入购物车', mask: true })
    try {
      const existed = Boolean(this.data.addedCartItemId)
      await ensureDiyCartItem(this)
      wx.hideLoading()
      wx.showToast({ title: existed ? '已在购物车' : '已加入购物车', icon: 'success' })
    } catch (error) {
      wx.hideLoading()
      wx.showToast({ title: getApiErrorMessage(error, '加入购物车失败'), icon: 'none' })
    } finally {
      this.setData({ actionBusy: false })
    }
  },

  async handleCheckout() {
    const item = this.data.item
    if (!item || this.data.actionBusy) return
    this.setData({ actionBusy: true })
    if (this.data.sourceMode === 'diy') wx.showLoading({ title: '正在准备结算', mask: true })
    try {
      const cartItemId = this.data.sourceMode === 'diy'
        ? await ensureDiyCartItem(this)
        : item.id
      if (this.data.sourceMode === 'diy') wx.hideLoading()
      setCheckoutIntent({
        source: 'cart',
        cartItemIds: [cartItemId],
        directItems: [],
      })
      wx.navigateTo({ url: '/pages/cart/order-confirm/index' })
    } catch (error) {
      if (this.data.sourceMode === 'diy') wx.hideLoading()
      wx.showToast({ title: getApiErrorMessage(error, '结算准备失败'), icon: 'none' })
    } finally {
      this.setData({ actionBusy: false })
    }
  },
})
