import type { CartItem } from '@/api/cart/types'

const STORAGE_KEY = 'stone_checkout_intent_v1'

export interface CheckoutIntent {
  source: 'cart' | 'buy_now'
  cartItemIds: string[]
  directItems: CartItem[]
}

let memoryIntent: CheckoutIntent | null = null

function normalizeIntent(value: unknown): CheckoutIntent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Partial<CheckoutIntent>
  if (source.source !== 'cart' && source.source !== 'buy_now') return null
  return {
    source: source.source,
    cartItemIds: Array.isArray(source.cartItemIds)
      ? source.cartItemIds.map(String).filter(Boolean)
      : [],
    directItems: Array.isArray(source.directItems) ? source.directItems : [],
  }
}

export function setCheckoutIntent(intent: CheckoutIntent): void {
  memoryIntent = normalizeIntent(intent)
  if (memoryIntent) wx.setStorageSync(STORAGE_KEY, memoryIntent)
}

export function getCheckoutIntent(): CheckoutIntent | null {
  if (memoryIntent) return memoryIntent
  memoryIntent = normalizeIntent(wx.getStorageSync(STORAGE_KEY) as unknown)
  return memoryIntent
}

export function clearCheckoutIntent(): void {
  memoryIntent = null
  wx.removeStorageSync(STORAGE_KEY)
}
