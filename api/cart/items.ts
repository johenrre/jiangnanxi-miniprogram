import { requestApi, resolveMediaUrl, toNumber, toText } from '@/api/client'
import { API_BASE_URL } from '@/api/config'
import type {
  AddCartDesignInput,
  CartItem,
  CartItemType,
  CartProductOptionGroup,
  CartSelectedOptions,
} from '@/api/cart/types'
import { normalizeMaterialMap } from '@/api/design/normalizer'
import type { RawMaterial } from '@/api/design/types'
import type { MallProduct } from '@/api/mall/products'
import { loadPublicSettings } from '@/api/settings/public'

const CHECKED_CART_ITEM_IDS_KEY = 'stone_checked_cart_item_ids_v3'
let checkedIdsCache: Set<string> | null = null
let checkedIdsWriteQueue: Promise<void> = Promise.resolve()

interface RawCartItem {
  cart_item_id?: string
  item_type?: CartItemType
  ref_id?: string
  design_id?: string
  design_code?: string
  product_id?: number | string
  quantity?: number | string
  design_name?: string
  product_name?: string
  product_subtitle?: string
  preview_url?: string
  price?: number | string
  available?: boolean | number | string
  diy_mode?: string
  perimeter?: number | string
  added_at?: string
  pattern?: unknown[] | string
  material_map?: Record<string, RawMaterial>
}

interface RawCartList {
  items?: RawCartItem[]
}

function normalizePattern(value: RawCartItem['pattern']): string[] {
  let source: unknown = value
  if (typeof source === 'string') {
    const text = source
    try {
      source = JSON.parse(text) as unknown
    } catch {
      source = text.split(',')
    }
  }
  if (!Array.isArray(source)) return []
  return source.map((item) => {
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      const record = item as Record<string, unknown>
      item = record.mat ?? record.materialId ?? record.material_id ?? record.id
    }
    const raw = toText(item)
    return /^(?:dynamic|[a-z]+)_(\d+)$/i.exec(raw)?.[1] || raw
  }).filter(Boolean)
}

function isAvailable(value: RawCartItem['available']): boolean {
  return !(
    value === false
    || value === 0
    || value === '0'
    || String(value ?? '').toLowerCase() === 'false'
  )
}

function readCheckedIds(allIds: string[]): Set<string> {
  if (checkedIdsCache) return new Set(checkedIdsCache)
  const stored = wx.getStorageSync(CHECKED_CART_ITEM_IDS_KEY) as unknown
  const initial = Array.isArray(stored)
    ? new Set(stored.map((value) => toText(value)).filter(Boolean))
    : new Set(allIds)
  checkedIdsCache = new Set(initial)
  if (!Array.isArray(stored)) wx.setStorageSync(CHECKED_CART_ITEM_IDS_KEY, allIds)
  return initial
}

function saveCheckedIdList(ids: string[]): Promise<void> {
  checkedIdsCache = new Set(ids)
  const pendingWrite = checkedIdsWriteQueue
    .catch(() => undefined)
    .then(() => new Promise<void>((resolve, reject) => {
      wx.setStorage({
        key: CHECKED_CART_ITEM_IDS_KEY,
        data: ids,
        success: () => resolve(),
        fail: (error) => reject(error),
      })
    }))
  checkedIdsWriteQueue = pendingWrite
  return pendingWrite
}

export async function markCartItemSelected(id: string): Promise<void> {
  const next = readCheckedIds([])
  next.add(id)
  await saveCheckedIdList([...next])
}

function saveCheckedIds(items: CartItem[]): Promise<void> {
  return saveCheckedIdList(items.filter((item) => item.checked).map((item) => item.id))
}

function isOptionEnabled(value: boolean | number | string | undefined): boolean {
  return !(
    value === false
    || value === 0
    || value === '0'
    || String(value ?? '').toLowerCase() === 'false'
  )
}

export async function loadCartProductOptions(): Promise<CartProductOptionGroup[]> {
  // 结算价格以后台最新配置为准，避免公共缓存造成展示价与服务端计价不一致。
  const settings = await loadPublicSettings(true)
  const groupMap: Record<string, keyof CartSelectedOptions> = {
    productionMethod: 'productionMethod',
    packaging: 'packaging',
    ropeColor: 'ropeColor',
    shipping: 'expressMethod',
    greetingCard: 'greetingCard',
  }
  return (settings.checkoutItemOptionGroups || []).map<CartProductOptionGroup | null>((group) => {
    if (!isOptionEnabled(group.enabled)) return null
    const groupCode = groupMap[toText(group.groupCode)]
    if (!groupCode) return null
    const options = (group.options || [])
      .filter((option) => isOptionEnabled(option.enabled))
      .map((option) => ({
        optionCode: toText(option.optionCode),
        title: toText(option.title),
        subtitle: toText(option.subtitle),
        amountCents: Math.round(Math.max(0, toNumber(option.amount)) * 100),
        freeThresholdCents: Math.round(Math.max(0, toNumber(option.freeThreshold)) * 100),
        imageUrl: resolveMediaUrl(option.image),
      }))
      .filter((option) => option.optionCode)
    if (!options.length) return null
    return {
      groupCode,
      title: toText(group.title),
      options,
    }
  }).filter((group): group is CartProductOptionGroup => group !== null)
}

export async function loadCartItems(): Promise<CartItem[]> {
  const result = await requestApi<RawCartList>({ path: '/api/cart/list' })
  const rawItems = Array.isArray(result.items) ? result.items : []
  const ids = rawItems.map((item) => toText(
    item.cart_item_id
    || `${item.item_type || 'diy_design'}:${item.ref_id || item.design_code || item.design_id || item.product_id}`,
  )).filter(Boolean)
  const checkedIds = readCheckedIds(ids)
  return rawItems.map((source) => {
    const itemType: CartItemType = source.item_type === 'mall_product'
      ? 'mall_product'
      : 'diy_design'
    const refId = toText(
      source.ref_id
      || (itemType === 'mall_product' ? source.product_id : source.design_code || source.design_id),
    )
    const id = toText(source.cart_item_id, `${itemType}:${refId}`)
    const pattern = itemType === 'diy_design' ? normalizePattern(source.pattern) : []
    const itemMaterialMap = itemType === 'diy_design'
      ? normalizeMaterialMap({ material_map: source.material_map || {} }, API_BASE_URL)
      : {}
    return {
      id,
      itemType,
      refId,
      section: 'customer' as const,
      name: toText(
        itemType === 'mall_product' ? source.product_name : source.design_name,
        itemType === 'mall_product' ? '未命名商品' : '未命名设计',
      ),
      subtitle: toText(source.product_subtitle),
      coverUrl: resolveMediaUrl(source.preview_url),
      pattern,
      materialMap: itemMaterialMap,
      beadSize: pattern.length > 0 ? itemMaterialMap[pattern[0]]?.size || 11 : 11,
      perimeterMm: itemType === 'diy_design' ? Math.max(0, toNumber(source.perimeter)) : 0,
      unitPriceCents: Math.round(Math.max(0, toNumber(source.price)) * 100),
      quantity: Math.min(99, Math.max(1, Math.floor(toNumber(source.quantity, 1)))),
      checked: checkedIds.has(id),
      available: isAvailable(source.available),
      addedAt: Date.parse(toText(source.added_at).replace(' ', 'T')) || Date.now(),
    }
  }).filter((item) => item.id && item.refId)
}

export function createMallCartItem(product: MallProduct, quantity = 1): CartItem {
  return {
    id: `mall_product:${product.id}`,
    itemType: 'mall_product',
    refId: product.id,
    section: 'customer',
    name: product.title,
    subtitle: product.subtitle,
    coverUrl: product.images[0] || '',
    pattern: [],
    materialMap: {},
    beadSize: 11,
    perimeterMm: 0,
    unitPriceCents: Math.round(Math.max(0, Number(product.discountPriceText) || 0) * 100),
    quantity: Math.min(99, Math.max(1, Math.floor(quantity))),
    checked: true,
    available: true,
    addedAt: Date.now(),
  }
}

export async function addDesignToCart(input: AddCartDesignInput): Promise<CartItem[]> {
  if (!Number.isInteger(input.design.backendId) || input.design.backendId <= 0) {
    throw new Error('设计缺少后端编号，无法加入购物车')
  }
  await requestApi<unknown, WechatMiniprogram.IAnyObject>({
    path: '/api/cart/add',
    method: 'POST',
    data: { itemType: 'diy_design', design_id: input.design.code, quantity: 1 },
  })
  const id = `diy_design:${input.design.code}`
  await markCartItemSelected(id)
  return loadCartItems()
}

export async function addMallProductToCart(productId: string): Promise<CartItem[]> {
  await requestApi<unknown, WechatMiniprogram.IAnyObject>({
    path: '/api/cart/add',
    method: 'POST',
    data: { itemType: 'mall_product', productId, quantity: 1 },
  })
  const id = `mall_product:${productId}`
  await markCartItemSelected(id)
  return loadCartItems()
}

export async function changeCartItemQuantity(id: string, quantity: number): Promise<CartItem[]> {
  await requestApi<unknown, WechatMiniprogram.IAnyObject>({
    path: '/api/cart/update',
    method: 'POST',
    data: { cartItemId: id, quantity },
  })
  return loadCartItems()
}

export function toggleCartItem<T extends CartItem>(id: string, currentItems: T[]): T[] {
  return currentItems.map((item) => (
    item.id === id ? { ...item, checked: !item.checked } : item
  ))
}

export function toggleAllCartItems<T extends CartItem>(checked: boolean, currentItems: T[]): T[] {
  return currentItems.map((item) => (
    item.checked === checked ? item : { ...item, checked }
  ))
}

export function persistCartSelection(items: CartItem[]): Promise<void> {
  return saveCheckedIds(items)
}

export async function removeCartItem(id: string): Promise<CartItem[]> {
  await requestApi<unknown, { cartItemId: string }>({
    path: '/api/cart/remove',
    method: 'POST',
    data: { cartItemId: id },
  })
  const next = readCheckedIds([])
  next.delete(id)
  await saveCheckedIdList([...next])
  return loadCartItems()
}

export async function removeCartItems(ids: string[]): Promise<CartItem[]> {
  const uniqueIds = [...new Set(ids.filter(Boolean))]
  await Promise.all(uniqueIds.map((cartItemId) => requestApi<unknown, { cartItemId: string }>({
    path: '/api/cart/remove',
    method: 'POST',
    data: { cartItemId },
  })))
  const next = readCheckedIds([])
  uniqueIds.forEach((id) => next.delete(id))
  await saveCheckedIdList([...next])
  return loadCartItems()
}

export async function removeCheckedCartItems(): Promise<CartItem[]> {
  const checked = (await loadCartItems()).filter((item) => item.checked)
  return removeCartItems(checked.map((item) => item.id))
}
