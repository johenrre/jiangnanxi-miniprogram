import type { CartItem } from '@/api/cart/types'
import type { CheckoutIntent } from '@/services/checkout-intent'

export function resolveCheckoutItems(
  intent: CheckoutIntent | null,
  storedItems: CartItem[],
): CartItem[] {
  if (!intent) return []

  if (intent.source === 'buy_now') {
    return intent.directItems.map((item) => ({ ...item, checked: true }))
  }

  if (intent.cartItemIds.length === 0) return []

  const selectedIds = new Set(intent.cartItemIds)
  return storedItems
    .filter((item) => selectedIds.has(item.id))
    .map((item) => ({ ...item, checked: true }))
}
