import type {
  DesignMaterial,
  DesignPage,
  DesignPreviewMaterial,
  DesignSection,
  DesignWork,
  RawDesign,
  RawDesignPage,
  RawMaterial,
} from '@/api/design/types'

const DEFAULT_PAGE_SIZE = 18

export function toText(value: unknown): string {
  return String(value ?? '').trim()
}

export function toNumber(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  const normalized = toText(value).toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}

function formatMoney(value: unknown): string {
  return `¥${toNumber(value).toFixed(1)}`
}

function normalizeMediaUrl(value: unknown, mediaBaseUrl: string): string {
  const url = toText(value)
  if (!url) return ''
  if (/^https?:\/\//i.test(url)) return url
  return `${mediaBaseUrl}${url.startsWith('/') ? url : `/${url}`}`
}

function normalizePattern(value: RawDesign['pattern']): string[] {
  const normalizeItem = (item: unknown): string => {
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      const source = item as Record<string, unknown>
      return normalizeItem(
        source.mat ?? source.materialId ?? source.material_id ?? source.id ?? source.code,
      )
    }
    const raw = toText(item)
    const prefixed = /^(?:dynamic|[a-z]+)_(\d+)$/i.exec(raw)
    return prefixed?.[1] || raw
  }
  if (Array.isArray(value)) return value.map(normalizeItem).filter(Boolean)
  if (typeof value !== 'string') return []

  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.map(normalizeItem).filter(Boolean) : []
  } catch {
    return value.split(',').map(normalizeItem).filter(Boolean)
  }
}

function normalizePhotoList(value: unknown, mediaBaseUrl: string): string[] {
  let source = value
  if (typeof source === 'string') {
    const text = source
    try {
      source = JSON.parse(text) as unknown
    } catch {
      source = text.split(/[\n,]/)
    }
  }
  if (!Array.isArray(source)) return []

  return source.map((item) => {
    if (typeof item === 'string') return normalizeMediaUrl(item, mediaBaseUrl)
    if (!item || typeof item !== 'object') return ''
    const photo = item as Record<string, unknown>
    return normalizeMediaUrl(
      photo.url || photo.imageUrl || photo.image_url || photo.posterUrl || photo.poster_url,
      mediaBaseUrl,
    )
  }).filter(Boolean)
}

function collectLivePhotos(rawDesign: RawDesign, mediaBaseUrl: string): string[] {
  const photoSources = [
    rawDesign.product_photos,
    rawDesign.productPhotos,
    rawDesign.live_photos,
    rawDesign.livePhotos,
    rawDesign.live_media,
    rawDesign.liveMedia,
  ]
  return Array.from(new Set(
    photoSources.flatMap((source) => normalizePhotoList(source, mediaBaseUrl)),
  ))
}

function resolveMaterialImage(material: RawMaterial, mediaBaseUrl: string): string {
  const variants = Array.isArray(material.variants) ? material.variants : []
  return normalizeMediaUrl(
    material.listImgUrl
    || material.previewUrl
    || material.imageUrl
    || material.image
    || variants[0],
    mediaBaseUrl,
  )
}

function normalizePreviewMaterial(
  materialId: string,
  rawMaterial: RawMaterial,
  mediaBaseUrl: string,
): DesignPreviewMaterial {
  const imageUrl = resolveMaterialImage(rawMaterial, mediaBaseUrl)
  const canvasImageUrl = normalizeMediaUrl(
    rawMaterial.canvasImage
      || rawMaterial.canvas_image
      || rawMaterial.canvasImageUrl
      || rawMaterial.canvas_image_url,
    mediaBaseUrl,
  )
  const variants = Array.isArray(rawMaterial.variants)
    ? rawMaterial.variants.map((url) => normalizeMediaUrl(url, mediaBaseUrl)).filter(Boolean)
    : []
  const rawStringingWidthMm = toNumber(
    rawMaterial.stringingWidthMm ?? rawMaterial.stringing_width_mm,
  )
  const stringingPosition = toText(
    rawMaterial.stringingPosition ?? rawMaterial.stringing_position,
  ).toLowerCase() === 'top' ? 'top' : 'center'
  const isIrregular = toBoolean(rawMaterial.isIrregular ?? rawMaterial.is_irregular)
  const rawLayer = rawMaterial.layer
  const explicitLayer = Number(rawLayer)
  const layer = rawLayer !== undefined
    && rawLayer !== null
    && rawLayer !== ''
    && Number.isFinite(explicitLayer)
    ? explicitLayer
    : isIrregular ? 25 : 20

  return {
    id: materialId,
    name: toText(rawMaterial.name) || '未命名珠材',
    size: toNumber(rawMaterial.size || rawMaterial.mm) || 11,
    imageUrl,
    canvasImageUrl,
    variants: variants.length > 0 ? variants : imageUrl ? [imageUrl] : [],
    stringingWidthMm: rawStringingWidthMm > 0 ? rawStringingWidthMm : null,
    stringingPosition,
    stringingOffsetMm: toNumber(
      rawMaterial.stringingOffsetMm ?? rawMaterial.stringing_offset_mm,
    ),
    imageScale: toNumber(
      rawMaterial.imageScale ?? rawMaterial.imgScale ?? rawMaterial.listImgScale,
    ) || 1,
    isIrregular,
    layer,
    price: toNumber(rawMaterial.price),
  }
}

export function normalizeMaterialMap(
  rawDesign: RawDesign,
  mediaBaseUrl: string,
): Record<string, DesignPreviewMaterial> {
  const rawMaterialMap = rawDesign.material_map
    || rawDesign.materialMap
    || rawDesign.material_snapshot
    || rawDesign.materialSnapshot
    || {}

  return Object.entries(rawMaterialMap).reduce<Record<string, DesignPreviewMaterial>>(
    (materialMap, [materialId, rawMaterial]) => {
      materialMap[materialId] = normalizePreviewMaterial(materialId, rawMaterial, mediaBaseUrl)
      return materialMap
    },
    {},
  )
}

function buildMaterialList(
  pattern: string[],
  materialMap: Record<string, DesignPreviewMaterial>,
): DesignMaterial[] {
  const materialCounts = new Map<string, number>()
  pattern.forEach((materialId) => {
    materialCounts.set(materialId, (materialCounts.get(materialId) || 0) + 1)
  })

  return Array.from(materialCounts.entries()).map(([materialId, count]) => {
    const material = materialMap[materialId]
    const unitPrice = material?.price || 0
    return {
      id: materialId,
      name: material?.name || '未命名珠材',
      imageUrl: material?.imageUrl || '',
      sizeText: material?.size ? `${material.size}mm` : '--',
      unitPriceText: formatMoney(unitPrice),
      count,
      subtotalText: formatMoney(unitPrice * count),
    }
  })
}

export function normalizeDesign(
  rawDesign: RawDesign,
  requestedSection: DesignSection,
  mediaBaseUrl: string,
): DesignWork | null {
  const code = toText(rawDesign.design_code || rawDesign.designCode || rawDesign.id)
  if (!code) return null

  const rawSection = toText(rawDesign.inspiration_type || rawDesign.category).toLowerCase()
  const section: DesignSection = rawSection === 'customer' ? 'customer' : requestedSection
  const name = toText(rawDesign.name || rawDesign.design_name || rawDesign.title) || '未命名作品'
  const authorName = toText(
    rawDesign.nickname
    || rawDesign.author_name
    || rawDesign.authorName
    || rawDesign.creator_name
    || rawDesign.creatorName
    || rawDesign.username,
  ) || (section === 'designer' ? '设计师' : '匿名作者')
  const price = toNumber(rawDesign.price || rawDesign.total_price)
  const pattern = normalizePattern(rawDesign.pattern)
  const materialMap = normalizeMaterialMap(rawDesign, mediaBaseUrl)
  const subtitle = toText(rawDesign.subtitle || rawDesign.description || rawDesign.desc)
    || `由 ${authorName} 创作的手串设计方案。`

  return {
    id: code,
    backendId: toNumber(rawDesign.id),
    code,
    section,
    name,
    subtitle,
    description: subtitle,
    price,
    priceText: formatMoney(price),
    coverUrl: normalizeMediaUrl(
      rawDesign.cover_image
      || rawDesign.preview_url
      || rawDesign.previewUrl
      || rawDesign.snapshot_url
      || rawDesign.snapshotUrl
      || rawDesign.image_url
      || rawDesign.image,
      mediaBaseUrl,
    ),
    pattern,
    materialMap,
    beadSize: toNumber(rawDesign.bead_mm || rawDesign.beadMm) || 11,
    livePhotos: collectLivePhotos(rawDesign, mediaBaseUrl),
    authorName,
    authorAvatar: normalizeMediaUrl(
      rawDesign.avatar
      || rawDesign.author_avatar
      || rawDesign.authorAvatar
      || rawDesign.creator_avatar
      || rawDesign.creatorAvatar,
      mediaBaseUrl,
    ),
    materials: buildMaterialList(pattern, materialMap),
    createdAt: toText(rawDesign.created_at || rawDesign.createdAt),
    viewCount: toNumber(rawDesign.view_count || rawDesign.viewCount),
    isPinned: Boolean(toText(rawDesign.inspiration_pinned_at)),
    usesDesignerIdentity: section === 'designer',
  }
}

export function normalizeDesignPage(
  source: RawDesignPage | RawDesign[],
  section: DesignSection,
  mediaBaseUrl: string,
): DesignPage {
  const pageData = Array.isArray(source) ? { list: source } : source

  const rawItems = Array.isArray(pageData.list)
    ? pageData.list
    : Array.isArray(pageData.items) ? pageData.items : []
  const items = rawItems.map((item) => normalizeDesign(item, section, mediaBaseUrl))
    .filter((design): design is DesignWork => design !== null)

  return {
    items,
    total: toNumber(pageData.total) || items.length,
    page: toNumber(pageData.page) || 1,
    pageSize: toNumber(pageData.pageSize || pageData.page_size) || DEFAULT_PAGE_SIZE,
  }
}
