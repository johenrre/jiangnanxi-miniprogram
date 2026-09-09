import {
  cancelCheckoutOrder,
  clearAuthSession,
  createCheckoutOrder,
  createDefaultCartSelectedOptions,
  getApiErrorMessage,
  hasAuthSession,
  isApiUnauthorized,
  loadAddresses,
  loadCartItems,
  loadCartProductOptions,
  normalizeCartSelectedOptions,
  queryCheckoutPayment,
  removeCartItems,
  requestCheckoutPayment,
  type AddressItem,
  type CartItem,
  type CartProductOptionGroup,
  type CartSelectedOptions,
  type CheckoutOrder,
} from '@/api/index'
import {
  createPaymentFlowRunner,
  type PaymentFlowRunner,
  type PaymentFlowState,
} from '@/pages/cart/order-confirm/payment-flow'
import { resolveCheckoutItems } from '@/pages/cart/order-confirm/checkout-selection'
import { ensureAuthenticated } from '@/services/auth-gate'
import {
  clearCheckoutIntent,
  getCheckoutIntent,
  type CheckoutIntent,
} from '@/services/checkout-intent'
import {
  calculateCheckoutSummary,
  clampCartQuantity,
  effectiveCartOptionAmountCents,
  formatMoneyFromCents,
  type CartSummary,
} from '@/utils/cart-calculations'

type ConfirmPageStatus = 'login' | 'loading' | 'ready' | 'empty' | 'error'

interface ConfirmCartItemView extends CartItem {
  unitPriceText: string
  lineTotalText: string
  typeLabel: string
}

interface CheckoutOptionView {
  optionCode: string
  title: string
  subtitle: string
  amountText: string
  amountCents: number
  effectiveAmountCents: number
  imageUrl: string
  priceText: string
  thresholdText: string
  freeByThreshold: boolean
  selected: boolean
}

interface CheckoutOptionGroupView {
  groupCode: keyof CartSelectedOptions
  title: string
  benefitText: string
  options: CheckoutOptionView[]
}

interface ConfirmPageRuntime {
  paymentFlowRunner: PaymentFlowRunner
  pendingCheckoutOrder: CheckoutOrder | null
  checkoutRequestId: string
  activeIntent: CheckoutIntent | null
  reloadOnNextShow: boolean
}

const pageRuntimeByInstance = new WeakMap<object, ConfirmPageRuntime>()

function createCheckoutRequestId(): string {
  return `mp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
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

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, milliseconds))
  })
}

function buildConfirmItemViews(items: CartItem[]): ConfirmCartItemView[] {
  return items.map((item) => ({
    ...item,
    unitPriceText: formatMoneyFromCents(item.unitPriceCents),
    lineTotalText: formatMoneyFromCents(item.unitPriceCents * item.quantity),
    typeLabel: item.itemType === 'diy_design' ? 'DIY 定制' : '商城商品',
  }))
}

function buildOptionGroupViews(
  groups: CartProductOptionGroup[],
  selectedOptions: CartSelectedOptions,
  goodsAmountCents: number,
): CheckoutOptionGroupView[] {
  return groups.map((group) => {
    const groupThreshold = group.options
      .map((option) => Math.max(0, option.freeThresholdCents || 0))
      .filter((threshold) => threshold > 0)
      .sort((a, b) => a - b)[0] || 0
    return {
      groupCode: group.groupCode,
      title: group.title,
      benefitText: groupThreshold > 0
        ? `满 ¥${formatMoneyFromCents(groupThreshold)} 可免费`
        : '',
      options: group.options.map((option) => {
        const effectiveAmountCents = effectiveCartOptionAmountCents(option, goodsAmountCents)
        const freeThresholdCents = Math.max(0, option.freeThresholdCents || 0)
        const freeByThreshold = option.amountCents > 0
          && freeThresholdCents > 0
          && effectiveAmountCents === 0
        const thresholdText = freeThresholdCents > 0
          ? freeByThreshold
            ? `已满 ¥${formatMoneyFromCents(freeThresholdCents)}，当前免费`
            : `满 ¥${formatMoneyFromCents(freeThresholdCents)} 免费`
          : ''
        return {
          ...option,
          imageUrl: option.imageUrl || '',
          effectiveAmountCents,
          amountText: formatMoneyFromCents(effectiveAmountCents),
          priceText: effectiveAmountCents > 0
            ? `+¥${formatMoneyFromCents(effectiveAmountCents)}`
            : freeByThreshold ? '满额免费' : '免费',
          thresholdText,
          freeByThreshold,
          selected: selectedOptions[group.groupCode] === option.optionCode,
        }
      }),
    }
  })
}

function selectDeliveryAddress(addresses: AddressItem[]): AddressItem | null {
  return addresses.find((address) => address.isDefault) || addresses[0] || null
}

function isBusyPaymentState(state: PaymentFlowState): boolean {
  return ['creating_order', 'invoking_payment', 'confirming_payment'].includes(state)
}

function paymentButtonText(state: PaymentFlowState): string {
  const labels: Record<PaymentFlowState, string> = {
    idle: '立即支付',
    creating_order: '正在创建订单',
    invoking_payment: '正在拉起支付',
    confirming_payment: '正在确认结果',
    success: '支付已确认',
    cancelled: '重新支付',
    order_failed: '重新提交订单',
    failed: '重新支付',
    timeout: '重新支付',
  }
  return labels[state]
}

Page({
  data: {
    status: 'loading' as ConfirmPageStatus,
    cartItems: [] as ConfirmCartItemView[],
    optionGroups: [] as CartProductOptionGroup[],
    optionGroupViews: [] as CheckoutOptionGroupView[],
    selectedOptions: {} as CartSelectedOptions,
    hasDiyItems: false,
    address: null as AddressItem | null,
    summary: createEmptySummary(),
    goodsAmountText: '0.00',
    optionAmountText: '0.00',
    freightAmountText: '0.00',
    payableAmountText: '0.00',
    errorMessage: '',
    paymentFlowState: 'idle' as PaymentFlowState,
    paymentButtonText: paymentButtonText('idle'),
    paymentMessage: '',
    paymentOrderNo: '',
    paymentBusy: false,
    paymentCompleted: false,
    hasPendingPaymentOrder: false,
    remark: '',
    greetingMessage: '',
    requiresGreetingMessage: false,
  },

  onLoad() {
    const runtime: ConfirmPageRuntime = {
      pendingCheckoutOrder: null,
      checkoutRequestId: createCheckoutRequestId(),
      activeIntent: getCheckoutIntent(),
      reloadOnNextShow: false,
      paymentFlowRunner: createPaymentFlowRunner({
      createOrder: createCheckoutOrder,
      requestPayment: requestCheckoutPayment,
      queryPayment: queryCheckoutPayment,
      sleep,
      onStateChange: (state) => this.applyPaymentFlowState(state),
      maxQueryAttempts: 20,
      queryIntervalMs: 1500,
      }),
    }
    pageRuntimeByInstance.set(this, runtime)
    void this.loadData()
  },

  onShow() {
    const runtime = pageRuntimeByInstance.get(this)
    if (!runtime?.reloadOnNextShow) return
    runtime.reloadOnNextShow = false
    if (this.data.paymentBusy || this.data.paymentCompleted) return
    void this.loadData()
  },

  onUnload() {
    pageRuntimeByInstance.delete(this)
  },

  async loadData() {
    if (!hasAuthSession()) {
      this.setData({ status: 'login', cartItems: [], address: null, errorMessage: '' })
      return
    }

    this.setData({ status: 'loading', errorMessage: '' })
    try {
      const [storedItems, optionGroups, addresses] = await Promise.all([
        loadCartItems(),
        loadCartProductOptions(),
        loadAddresses(),
      ])
      const runtime = pageRuntimeByInstance.get(this)
      const selectedItems = resolveCheckoutItems(runtime?.activeIntent || null, storedItems)
      if (selectedItems.length === 0) {
        this.setData({ status: 'empty', cartItems: [], summary: createEmptySummary() })
        return
      }
      if (selectedItems.some((item) => !item.available)) {
        this.setData({
          status: 'error',
          cartItems: [],
          errorMessage: '待结算商品已失效，可能包含已删除珠材或已下架商品，请返回购物车移除后重试。',
        })
        return
      }

      const goodsAmountCents = selectedItems.reduce(
        (sum, item) => sum + Math.max(0, Math.round(item.unitPriceCents || 0)) * clampCartQuantity(item.quantity),
        0,
      )
      const hasCurrentSelection = Object.keys(this.data.selectedOptions).length > 0
      const selectedOptions = hasCurrentSelection
        ? normalizeCartSelectedOptions(this.data.selectedOptions, optionGroups, goodsAmountCents)
        : createDefaultCartSelectedOptions(optionGroups, goodsAmountCents)
      this.applyCheckoutState(selectedItems, optionGroups, selectedOptions, addresses)
    } catch (error) {
      if (isApiUnauthorized(error)) {
        clearAuthSession()
        this.setData({ status: 'login', cartItems: [], address: null })
        return
      }
      this.setData({
        status: 'error',
        cartItems: [],
        errorMessage: getApiErrorMessage(error, '订单确认信息加载失败，请稍后重试'),
      })
    }
  },

  applyCheckoutState(
    items: CartItem[],
    optionGroups: CartProductOptionGroup[],
    selectedOptions: CartSelectedOptions,
    addresses?: AddressItem[],
  ) {
    const hasDiyItems = items.some((item) => item.itemType === 'diy_design')
    const summary = calculateCheckoutSummary(items, optionGroups, selectedOptions)
    const patch: WechatMiniprogram.IAnyObject = {
      status: 'ready',
      cartItems: buildConfirmItemViews(items),
      optionGroups,
      optionGroupViews: buildOptionGroupViews(optionGroups, selectedOptions, summary.goodsAmountCents),
      selectedOptions,
      requiresGreetingMessage: selectedOptions.greetingCard !== 'none',
      hasDiyItems,
      summary,
      goodsAmountText: formatMoneyFromCents(summary.goodsAmountCents),
      optionAmountText: formatMoneyFromCents(summary.optionAmountCents),
      freightAmountText: formatMoneyFromCents(summary.freightAmountCents),
      payableAmountText: formatMoneyFromCents(summary.payableAmountCents),
    }
    if (addresses) patch.address = selectDeliveryAddress(addresses)
    this.setData(patch)
  },

  handleSelectOption(event: WechatMiniprogram.TouchEvent) {
    if (this.data.paymentBusy || this.data.paymentCompleted) return
    const groupCode = String(event.currentTarget.dataset.groupCode || '') as keyof CartSelectedOptions
    const optionCode = String(event.currentTarget.dataset.optionCode || '')
    if (!groupCode || !optionCode) return
    const selectedOptions = normalizeCartSelectedOptions({
      ...this.data.selectedOptions,
      [groupCode]: optionCode,
    }, this.data.optionGroups)
    if (groupCode === 'greetingCard' && optionCode === 'none') {
      this.setData({ greetingMessage: '' })
    }
    this.applyCheckoutState(this.data.cartItems, this.data.optionGroups, selectedOptions)
  },

  handleGreetingMessageInput(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ greetingMessage: String(event.detail.value || '').slice(0, 120) })
  },

  handleRemarkInput(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ remark: String(event.detail.value || '').slice(0, 200) })
  },

  applyPaymentFlowState(state: PaymentFlowState) {
    this.setData({
      paymentFlowState: state,
      paymentButtonText: paymentButtonText(state),
      paymentBusy: isBusyPaymentState(state),
    })
  },

  async handleConfirmPayment() {
    const runtime = pageRuntimeByInstance.get(this)
    const runner = runtime?.paymentFlowRunner
    if (!runner || runner.isBusy() || this.data.paymentCompleted) return
    if (!this.data.address) {
      wx.showToast({ title: '请先填写并保存收货地址', icon: 'none' })
      return
    }
    if (this.data.requiresGreetingMessage && !this.data.greetingMessage.trim()) {
      wx.showToast({ title: '请填写贺卡祝福语', icon: 'none' })
      return
    }

    this.setData({ paymentMessage: '', paymentOrderNo: '' })
    const result = await runner.submit({
      checkoutSource: runtime.activeIntent?.source || 'cart',
      address: this.data.address,
      items: this.data.cartItems,
      optionGroups: this.data.optionGroups,
      selectedOptions: this.data.selectedOptions,
      payableAmountCents: this.data.summary.payableAmountCents,
      optionAmountCents: this.data.summary.optionAmountCents,
      remark: this.data.remark.trim(),
      greetingMessage: this.data.requiresGreetingMessage ? this.data.greetingMessage.trim() : '',
      requestId: runtime.checkoutRequestId,
    }, runtime.pendingCheckoutOrder)

    runtime.pendingCheckoutOrder = result.outcome === 'success' ? null : result.order
    this.setData({
      paymentMessage: result.message,
      paymentOrderNo: result.order?.orderNo || '',
      paymentCompleted: result.outcome === 'success',
      hasPendingPaymentOrder: result.outcome !== 'success' && Boolean(result.order),
    })
    if (result.outcome !== 'success') return

    if (result.order) await this.finishPaidOrder(result.order, result.message)
  },

  async finishPaidOrder(order: CheckoutOrder, message: string) {
    const runtime = pageRuntimeByInstance.get(this)
    if (!runtime) return
    runtime.pendingCheckoutOrder = null
    this.applyPaymentFlowState('success')
    this.setData({
      paymentMessage: message,
      paymentOrderNo: order.orderNo,
      paymentCompleted: true,
      hasPendingPaymentOrder: false,
    })

    const cartItemIds = runtime.activeIntent?.source === 'cart' ? runtime.activeIntent.cartItemIds : []
    clearCheckoutIntent()
    runtime.activeIntent = null
    let cleanupFailed = false
    try {
      if (cartItemIds.length > 0) await removeCartItems(cartItemIds)
    } catch (error) {
      cleanupFailed = true
      console.warn('[order-confirm] paid order cart cleanup failed', error)
    }
    wx.showToast({
      title: cleanupFailed ? '支付成功，购物车稍后刷新' : '支付成功',
      icon: cleanupFailed ? 'none' : 'success',
    })
    wx.reLaunch({
      url: `/pages/profile/orders/index?orderNo=${encodeURIComponent(order.orderNo)}`,
    })
  },

  async handleQueryPaymentResult() {
    const runtime = pageRuntimeByInstance.get(this)
    const order = runtime?.pendingCheckoutOrder
    if (!order || this.data.paymentBusy || this.data.paymentCompleted) return
    this.applyPaymentFlowState('confirming_payment')
    try {
      const result = await queryCheckoutPayment(order.orderNo)
      if (result.state === 'paid') {
        await this.finishPaidOrder(order, '支付成功，订单状态已确认。')
        return
      }
      if (result.state === 'closed') {
        runtime.pendingCheckoutOrder = null
        this.applyPaymentFlowState('failed')
        this.setData({
          paymentMessage: '该微信支付单已关闭，请返回购物车重新结算。',
          hasPendingPaymentOrder: false,
        })
        return
      }
      this.applyPaymentFlowState('failed')
      this.setData({
        paymentMessage: '暂未查询到付款结果，可继续支付或取消订单。',
        hasPendingPaymentOrder: true,
      })
    } catch (error) {
      this.applyPaymentFlowState('failed')
      this.setData({
        paymentMessage: getApiErrorMessage(error, '支付结果暂未确认，请稍后再查'),
        hasPendingPaymentOrder: true,
      })
    }
  },

  handleCancelPendingOrder() {
    const runtime = pageRuntimeByInstance.get(this)
    const order = runtime?.pendingCheckoutOrder
    if (!order || this.data.paymentBusy || this.data.paymentCompleted) return
    wx.showModal({
      title: '取消待付款订单',
      content: '系统会先确认微信支付状态。只有确定未付款时，才会关闭支付单并取消订单。',
      confirmText: '确认取消',
      confirmColor: '#9b625b',
      success: (result) => {
        if (!result.confirm) return
        this.setData({ paymentBusy: true })
        void cancelCheckoutOrder(order.id)
          .then(() => {
            runtime.pendingCheckoutOrder = null
            runtime.checkoutRequestId = createCheckoutRequestId()
            this.applyPaymentFlowState('idle')
            this.setData({
              paymentMessage: '',
              paymentOrderNo: '',
              paymentCompleted: false,
              hasPendingPaymentOrder: false,
            })
            wx.showToast({ title: '订单已取消', icon: 'success' })
          })
          .catch((error) => {
            this.applyPaymentFlowState('failed')
            this.setData({
              paymentMessage: getApiErrorMessage(error, '订单取消失败，请先查询支付结果'),
              hasPendingPaymentOrder: true,
            })
          })
      },
    })
  },

  handleRetry() {
    void this.loadData()
  },

  handleReturnCart() {
    wx.navigateBack()
  },

  async handleGoLogin() {
    if (!(await ensureAuthenticated(this, {
      content: '登录后可读取收货信息，并继续完成订单。',
    }))) return
    await this.loadData()
  },

  handleManageAddress() {
    const runtime = pageRuntimeByInstance.get(this)
    if (runtime) runtime.reloadOnNextShow = true
    wx.navigateTo({
      url: '/pages/profile/addresses/index',
      fail: () => {
        if (runtime) runtime.reloadOnNextShow = false
      },
    })
  },
})
