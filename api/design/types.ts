export type DesignSection = 'customer' | 'designer'

export interface RawMaterial {
  id?: number | string
  code?: number | string
  name?: string
  size?: number | string
  mm?: number | string
  sizeStr?: string
  price?: number | string
  listImgUrl?: string
  previewUrl?: string
  imageUrl?: string
  image?: string
  canvasImage?: string
  canvas_image?: string
  canvasImageUrl?: string
  canvas_image_url?: string
  variants?: string[]
  stringingWidthMm?: number | string
  stringing_width_mm?: number | string
  stringingPosition?: string
  stringing_position?: string
  stringingOffsetMm?: number | string
  stringing_offset_mm?: number | string
  imageScale?: number | string
  imgScale?: number | string
  listImgScale?: number | string
  isIrregular?: boolean | number | string
  is_irregular?: boolean | number | string
  layer?: number | string
}

export interface RawDesign {
  id?: number | string
  design_code?: string
  designCode?: string
  name?: string
  design_name?: string
  title?: string
  subtitle?: string
  description?: string
  desc?: string
  price?: number | string
  total_price?: number | string
  cover_image?: string
  preview_url?: string
  previewUrl?: string
  snapshot_url?: string
  snapshotUrl?: string
  image_url?: string
  image?: string
  pattern?: unknown[] | string
  material_map?: Record<string, RawMaterial>
  materialMap?: Record<string, RawMaterial>
  material_snapshot?: Record<string, RawMaterial>
  materialSnapshot?: Record<string, RawMaterial>
  product_photos?: unknown
  productPhotos?: unknown
  live_photos?: unknown
  livePhotos?: unknown
  live_media?: unknown
  liveMedia?: unknown
  nickname?: string
  username?: string
  author_name?: string
  authorName?: string
  creator_name?: string
  creatorName?: string
  avatar?: string
  author_avatar?: string
  authorAvatar?: string
  creator_avatar?: string
  creatorAvatar?: string
  created_at?: string
  createdAt?: string
  view_count?: number | string
  viewCount?: number | string
  inspiration_type?: string
  inspiration_pinned_at?: string
  category?: string
  bead_mm?: number | string
  beadMm?: number | string
}

export interface RawDesignPage {
  list?: RawDesign[]
  items?: RawDesign[]
  total?: number | string
  page?: number | string
  pageSize?: number | string
  page_size?: number | string
}

export interface RawDesignEnvelope {
  code?: number
  message?: string
  data?: RawDesignPage | RawDesign[]
}

export interface DesignPreviewMaterial {
  id: string
  name: string
  size: number
  imageUrl: string
  canvasImageUrl: string
  variants: string[]
  stringingWidthMm: number | null
  stringingPosition: 'center' | 'top'
  stringingOffsetMm: number
  imageScale: number
  isIrregular: boolean
  layer: number
  price: number
}

export interface DesignMaterial {
  id: string
  name: string
  imageUrl: string
  sizeText: string
  unitPriceText: string
  count: number
  subtotalText: string
}

export interface DesignWork {
  id: string
  backendId: number
  code: string
  section: DesignSection
  name: string
  subtitle: string
  description: string
  price: number
  priceText: string
  coverUrl: string
  pattern: string[]
  materialMap: Record<string, DesignPreviewMaterial>
  beadSize: number
  livePhotos: string[]
  authorName: string
  authorAvatar: string
  materials: DesignMaterial[]
  createdAt: string
  viewCount: number
  isPinned: boolean
  usesDesignerIdentity: boolean
}

export interface DesignPage {
  items: DesignWork[]
  total: number
  page: number
  pageSize: number
}

export interface LoadDesignsOptions {
  section?: DesignSection
  limit?: number
  forceRefresh?: boolean
}
