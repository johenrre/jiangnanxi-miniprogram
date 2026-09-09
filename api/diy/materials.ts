import { requestApi } from '@/api/client'

export interface DiyMaterial {
  id: string
  groupId: string
  name: string
  category: string
  subcategory: string
  materialType: string
  fitText: string
  sizeMm: number
  stringingWidthMm: number | null
  stringingPosition: 'center' | 'top'
  stringingOffsetMm: number
  price: number
  imageUrl: string
  canvasImageUrl: string
  imageScale: number
  isIrregular: boolean
  layer: number
}

const LEGACY_DIY_MATERIALS_CACHE_KEY = 'stone_diy_materials_cache'

let pendingRequest: Promise<DiyMaterial[]> | null = null
let legacyCacheRemoved = false

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toText(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value.trim() || fallback
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return fallback
}

function toFiniteNumber(value: unknown, fallback: number): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function toPositiveNumber(value: unknown, fallback: number): number {
  const number = toFiniteNumber(value, fallback)
  return number > 0 ? number : fallback
}

function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  const normalized = toText(value).toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}

function removeLegacyStoredCache(): void {
  if (legacyCacheRemoved) return
  legacyCacheRemoved = true
  try {
    wx.removeStorageSync(LEGACY_DIY_MATERIALS_CACHE_KEY)
  } catch {
    // 本地存储不可用时不影响网络加载。
  }
}

function resolveLayer(source: Record<string, unknown>, isIrregular: boolean): number {
  const rawLayer = source.layer
  if (rawLayer !== undefined && rawLayer !== null && rawLayer !== '') {
    const explicitLayer = Number(rawLayer)
    if (Number.isFinite(explicitLayer)) return explicitLayer
  }
  return isIrregular ? 25 : 20
}

function normalizeMaterialGroup(source: unknown): DiyMaterial[] {
  if (!isRecord(source) || !Array.isArray(source.variants)) return []

  const groupId = toText(source.group_id ?? source.id)
  const name = toText(source.display_name ?? source.name, '未命名珠材')
  const category = toText(source.category)
  const subcategory = toText(source.subcategory)
  const rawStringingWidthMm = toFiniteNumber(
    source.stringing_width_mm
      ?? source.stringingWidthMm
      ?? source.head_size_mm
      ?? source.headSizeMm,
    0,
  )
  const isIrregular = toBoolean(source.is_irregular ?? source.isIrregular)
  if (!groupId) return []
  if (!category || !subcategory) {
    throw new Error(`珠材“${name}”缺少主分类或子分类`)
  }

  return source.variants.flatMap((variant) => {
    if (!isRecord(variant)) return []
    const id = toText(variant.id)
    const sizeMm = toPositiveNumber(variant.size, 0)
    if (!id || sizeMm <= 0) return []
    return [{
      id,
      groupId,
      name,
      category,
      subcategory,
      materialType: toText(source.type, 'bead'),
      fitText: toText(source.fit_msg ?? source.fitMsg ?? source.fit_text ?? source.fitText),
      sizeMm,
      stringingWidthMm: rawStringingWidthMm > 0 ? rawStringingWidthMm : null,
      stringingPosition: toText(
        source.stringing_position ?? source.stringingPosition,
      ).toLowerCase() === 'top' ? 'top' : 'center',
      stringingOffsetMm: toFiniteNumber(
        source.stringing_offset_mm ?? source.stringingOffsetMm,
        0,
      ),
      price: Math.max(0, toFiniteNumber(variant.price, 0)),
      imageUrl: toText(source.image ?? source.image_url ?? source.img),
      canvasImageUrl: toText(
        source.canvas_image
          ?? source.canvas_image_url
          ?? source.canvasImage
          ?? source.canvasImageUrl,
      ),
      imageScale: toPositiveNumber(source.image_scale ?? source.img_scale ?? source.imgScale, 1),
      isIrregular,
      layer: resolveLayer(source, isIrregular),
    }]
  })
}

function parseMaterials(source: unknown): DiyMaterial[] {
  if (!Array.isArray(source)) {
    throw new Error('材料数据格式不正确')
  }

  const materials = source
    .flatMap(normalizeMaterialGroup)

  if (materials.length === 0) {
    throw new Error('材料列表为空，请稍后重试')
  }

  return materials
}

async function fetchMaterials(): Promise<DiyMaterial[]> {
  const source = await requestApi<unknown[]>({
    path: '/api/bead/list',
    requiresAuth: false,
  })
  return parseMaterials(source)
}

export function loadDiyMaterials(_forceRefresh = false): Promise<DiyMaterial[]> {
  removeLegacyStoredCache()
  if (pendingRequest) return pendingRequest

  let request: Promise<DiyMaterial[]>
  request = fetchMaterials()
    .finally(() => {
      if (pendingRequest === request) pendingRequest = null
    })
  pendingRequest = request
  return request
}
