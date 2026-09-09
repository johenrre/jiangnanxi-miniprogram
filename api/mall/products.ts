import { requestApi, resolveMediaUrl, toNumber, toText } from '@/api/client'

export interface MallSecondaryCategory {
  id: string
  name: string
}

export interface MallCategory {
  id: string
  name: string
  children: MallSecondaryCategory[]
}

export interface MallProduct {
  id: string
  title: string
  subtitle: string
  priceText: string
  discountPriceText: string
  soldCount: number
  primaryCategoryId: string
  primaryCategoryName: string
  secondaryCategoryId: string
  secondaryCategoryName: string
  images: string[]
  detailImages: string[]
}

interface RawCategory {
  id?: unknown
  name?: unknown
  children?: unknown
}

interface RawProduct {
  id?: unknown
  title?: unknown
  subtitle?: unknown
  original_price?: unknown
  discount_price?: unknown
  sold_count?: unknown
  primary_category_id?: unknown
  primary_category_name?: unknown
  secondary_category_id?: unknown
  secondary_category_name?: unknown
  images?: unknown
  detail_images?: unknown
}

interface ListResponse<T> {
  list?: T[]
  total?: number
}

function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function priceText(value: unknown): string {
  const price = Math.max(0, toNumber(value))
  return Number.isInteger(price) ? String(price) : price.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

function normalizeCategories(data: ListResponse<RawCategory>): MallCategory[] {
  return listOf(data.list).map((item) => {
    const category = item as RawCategory
    const children = listOf(category.children).map((child) => {
      const source = child as RawCategory
      return { id: toText(source.id), name: toText(source.name) }
    }).filter((child) => child.id && child.name)
    return {
      id: toText(category.id),
      name: toText(category.name),
      children,
    }
  }).filter((category) => category.id && category.name)
}

function normalizeProduct(source: RawProduct): MallProduct {
  return {
    id: toText(source.id),
    title: toText(source.title, '未命名商品'),
    subtitle: toText(source.subtitle),
    priceText: priceText(source.original_price),
    discountPriceText: priceText(source.discount_price),
    soldCount: Math.max(0, Math.floor(toNumber(source.sold_count))),
    primaryCategoryId: toText(source.primary_category_id),
    primaryCategoryName: toText(source.primary_category_name),
    secondaryCategoryId: toText(source.secondary_category_id),
    secondaryCategoryName: toText(source.secondary_category_name),
    images: listOf(source.images).map(resolveMediaUrl).filter(Boolean),
    detailImages: listOf(source.detail_images).map(resolveMediaUrl).filter(Boolean),
  }
}

export async function loadMallCatalog(): Promise<{
  categories: MallCategory[]
  products: MallProduct[]
}> {
  const [categoryData, productData] = await Promise.all([
    requestApi<ListResponse<RawCategory>>({
      path: '/api/mall/categories',
      method: 'GET',
      requiresAuth: false,
    }),
    requestApi<ListResponse<RawProduct>, { page: number; pageSize: number }>({
      path: '/api/mall/products',
      method: 'GET',
      data: { page: 1, pageSize: 100 },
      requiresAuth: false,
    }),
  ])
  return {
    categories: normalizeCategories(categoryData),
    products: listOf(productData.list).map((item) => normalizeProduct(item as RawProduct)),
  }
}

export async function loadMallProduct(productId: string): Promise<MallProduct> {
  const data = await requestApi<RawProduct>({
    path: `/api/mall/products/${encodeURIComponent(productId)}`,
    method: 'GET',
    requiresAuth: false,
  })
  return normalizeProduct(data)
}
