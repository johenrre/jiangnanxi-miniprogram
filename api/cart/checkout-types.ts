import type { AddressItem } from '@/api/profile/addresses'
import type {
  CartItem,
  CartProductOptionGroup,
  CartSelectedOptions,
} from '@/api/cart/types'

export type CheckoutSource = 'cart' | 'buy_now'

export interface CheckoutPaymentParams {
  timeStamp: string
  nonceStr: string
  package: string
  signType: 'RSA' | 'MD5' | 'HMAC-SHA256'
  paySign: string
}

export interface CreateCheckoutOrderInput {
  checkoutSource: CheckoutSource
  address: AddressItem
  items: CartItem[]
  optionGroups: CartProductOptionGroup[]
  selectedOptions: CartSelectedOptions
  payableAmountCents: number
  optionAmountCents: number
  requestId: string
  remark?: string
  greetingMessage: string
}

export interface CheckoutOrder {
  id: string
  orderNo: string
  payableAmountCents: number
  createdAt: number
}

export type CheckoutPaymentResultState = 'paid' | 'pending' | 'closed'

export interface CheckoutPaymentResult {
  state: CheckoutPaymentResultState
  orderNo: string
}
