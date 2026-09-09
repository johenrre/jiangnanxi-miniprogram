import {
  changeCartItemQuantity,
  clearAuthSession,
  getApiErrorMessage,
  hasAuthSession,
  isApiUnauthorized,
  loadCartItems,
  persistCartSelection,
  removeCartItem,
  toggleAllCartItems,
  toggleCartItem,
  type CartItem,
} from '@/api/index'
import { buildCartWristRangeText } from '@/pages/cart/shared/item-view'
import { ensureAuthenticated } from '@/services/auth-gate'
import { setCheckoutIntent } from '@/services/checkout-intent'
import {
  calculateCartLineAmount,
  calculateCartSummary,
  formatMoneyFromCents,
  type CartSummary,
} from '@/utils/cart-calculations'

type CartPageStatus = 'login' | 'loading' | 'ready' | 'empty' | 'error'

interface CartItemView extends CartItem {
  lineTotalText: string
  wristRangeText: string
  typeLabel: string
}

function buildCartItemViews(items: CartItem[]): CartItemView[] {
  return items.map((item) => ({
    ...item,
    lineTotalText: formatMoneyFromCents(calculateCartLineAmount(item).lineTotalCents),
    wristRangeText: item.itemType === 'diy_design' ? buildCartWristRangeText(item) : '',
    typeLabel: item.itemType === 'diy_design' ? 'DIY 定制' : '商城商品',
  }))
}

function createEmptySummary(): CartSummary {
  return {
    selectedLineCount: 0,
    selectedQuantity: 0,
    goodsAmountCents: 0,
    optionAmountCents: 0,
    freightAmountCents: 0,
    payableAmountCents: 0,
  }
}

Page({
  data: {
    status: 'loading' as CartPageStatus,
    cartItems: [] as CartItemView[],
    summary: createEmptySummary(),
    payableAmountText: '0.00',
    errorMessage: '',
    updatingItemId: '',
    loginPrompted: false,
  },

  onShow() {
    if (!hasAuthSession()) {
      this.setData({
        status: 'login',
        cartItems: [],
        summary: createEmptySummary(),
        payableAmountText: '0.00',
      })
      if (!this.data.loginPrompted) {
        this.setData({ loginPrompted: true })
        void this.handleLogin()
      }
      return
    }
    if (this.data.loginPrompted) this.setData({ loginPrompted: false })
    const silent = this.data.status === 'ready' || this.data.status === 'empty'
    void this.loadData(silent)
  },

  onHide() {
    if (this.data.loginPrompted) this.setData({ loginPrompted: false })
  },

  async onPullDownRefresh() {
    await this.loadData()
    wx.stopPullDownRefresh()
  },

  async loadData(silent = false) {
    if (!hasAuthSession()) {
      this.setData({
        status: 'login',
        cartItems: [],
        summary: createEmptySummary(),
        payableAmountText: '0.00',
      })
      return
    }
    if (!silent) this.setData({ status: 'loading', errorMessage: '' })
    try {
      this.applyCartState(await loadCartItems())
    } catch (error) {
      if (isApiUnauthorized(error)) {
        clearAuthSession()
        this.setData({
          status: 'login',
          cartItems: [],
          summary: createEmptySummary(),
          payableAmountText: '0.00',
          errorMessage: '',
        })
        return
      }
      if (!silent) {
        this.setData({
          status: 'error',
          cartItems: [],
          summary: createEmptySummary(),
          payableAmountText: '0.00',
          errorMessage: getApiErrorMessage(error, '购物车加载失败，请稍后重试'),
        })
      }
    }
  },

  applyCartState(cartItems: CartItem[]) {
    const summary = calculateCartSummary(cartItems)
    this.setData({
      cartItems: buildCartItemViews(cartItems),
      summary,
      payableAmountText: formatMoneyFromCents(summary.payableAmountCents),
      status: cartItems.length > 0 ? 'ready' : 'empty',
    })
  },

  applyCartSelectionState(cartItems: CartItemView[], changedIndexes: number[]) {
    const summary = calculateCartSummary(cartItems)
    const patch: WechatMiniprogram.IAnyObject = {
      summary,
      payableAmountText: formatMoneyFromCents(summary.payableAmountCents),
    }
    changedIndexes.forEach((index) => {
      patch[`cartItems[${index}].checked`] = cartItems[index]?.checked || false
    })
    this.setData(patch)
  },

  persistSelection(cartItems: CartItemView[]) {
    void persistCartSelection(cartItems).catch((error) => {
      wx.showToast({ title: getApiErrorMessage(error, '勾选状态保存失败'), icon: 'none' })
    })
  },

  handleRetry() {
    void this.loadData()
  },

  async handleLogin() {
    const loggedIn = await ensureAuthenticated(this, {
      content: '登录后可查看购物车，并继续确认商品与结算。',
    })
    if (!loggedIn) return
    this.setData({ loginPrompted: false })
    await this.loadData()
  },

  handleGoDiscover() {
    wx.switchTab({ url: '/pages/discover/index' })
  },

  handleOpenCartItem(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    const item = this.data.cartItems.find((candidate) => candidate.id === id)
    if (!item) return
    if (item.itemType === 'mall_product') {
      wx.navigateTo({ url: `/pages/mall/detail/index?id=${encodeURIComponent(item.refId)}` })
      return
    }
    wx.navigateTo({
      url: `/pages/cart/settlement-detail/index?id=${encodeURIComponent(id)}`,
    })
  },

  handleToggleItem(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    if (!id || this.data.updatingItemId) return
    const index = this.data.cartItems.findIndex((item) => item.id === id)
    if (index < 0) return
    const cartItems = toggleCartItem(id, this.data.cartItems)
    this.applyCartSelectionState(cartItems, [index])
    this.persistSelection(cartItems)
  },

  handleToggleAll() {
    if (this.data.updatingItemId || this.data.cartItems.length === 0) return
    const allChecked = this.data.cartItems.every((item) => item.checked)
    const checked = !allChecked
    const changedIndexes = this.data.cartItems.reduce<number[]>((indexes, item, index) => {
      if (item.checked !== checked) indexes.push(index)
      return indexes
    }, [])
    const cartItems = toggleAllCartItems(checked, this.data.cartItems)
    this.applyCartSelectionState(cartItems, changedIndexes)
    this.persistSelection(cartItems)
  },

  async handleChangeQuantity(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    const delta = Number(event.currentTarget.dataset.delta)
    const item = this.data.cartItems.find((candidate) => candidate.id === id)
    if (!item || !Number.isFinite(delta) || this.data.updatingItemId) return
    const quantity = Math.min(99, Math.max(1, item.quantity + delta))
    if (quantity === item.quantity) return
    this.setData({ updatingItemId: id })
    try {
      this.applyCartState(await changeCartItemQuantity(id, quantity))
    } catch (error) {
      wx.showToast({ title: getApiErrorMessage(error, '数量保存失败'), icon: 'none' })
    } finally {
      this.setData({ updatingItemId: '' })
    }
  },

  handleRemoveItem(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    if (!id || this.data.updatingItemId) return
    const item = this.data.cartItems.find((candidate) => candidate.id === id)
    wx.showModal({
      title: '删除商品',
      content: item?.name
        ? `确定从购物车删除“${item.name}”吗？`
        : '确定从购物车删除这个商品吗？',
      confirmText: '删除',
      confirmColor: '#aa7770',
      cancelText: '取消',
      success: ({ confirm }) => {
        if (confirm) void this.removeCartItemById(id)
      },
    })
  },

  async removeCartItemById(id: string) {
    if (!id || this.data.updatingItemId) return
    this.setData({ updatingItemId: id })
    try {
      this.applyCartState(await removeCartItem(id))
      wx.showToast({ title: '已删除', icon: 'none' })
    } catch (error) {
      wx.showToast({ title: getApiErrorMessage(error, '删除失败'), icon: 'none' })
    } finally {
      this.setData({ updatingItemId: '' })
    }
  },

  async handleCheckout() {
    const selectedItems = this.data.cartItems.filter((item) => item.checked)
    if (selectedItems.length === 0) {
      wx.showToast({ title: '请先选择要结算的商品', icon: 'none' })
      return
    }
    if (selectedItems.some((item) => !item.available)) {
      wx.showToast({ title: '选中的商品中包含已下架商品', icon: 'none' })
      return
    }
    if (!(await ensureAuthenticated(this, {
      content: '登录后可确认收货信息并继续结算。',
    }))) return
    setCheckoutIntent({
      source: 'cart',
      cartItemIds: selectedItems.map((item) => item.id),
      directItems: [],
    })
    wx.navigateTo({ url: '/pages/cart/order-confirm/index' })
  },
})
