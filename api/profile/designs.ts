import { API_BASE_URL, requestApi, toNumber } from '@/api/client'
import { normalizeDesign } from '@/api/design/normalizer'
import type {
  DesignPreviewMaterial,
  DesignWork,
  RawDesign,
} from '@/api/design/types'

interface RawDesignList {
  list?: RawDesign[]
  items?: RawDesign[]
  total?: number | string
}

export interface PersonalDesign {
  id: string
  code: string
  name: string
  coverUrl: string
  priceText: string
  createdAtText: string
  beadCount: number
  pattern: string[]
  materialMap: Record<string, DesignPreviewMaterial>
  beadSize: number
}

export interface PersonalDesignPage {
  items: PersonalDesign[]
  total: number
}

function normalizePersonalDesign(source: RawDesign): PersonalDesign | null {
  const design = normalizeDesignWork(source)
  if (!design) return null
  return {
    id: design.id,
    code: design.code,
    name: design.name,
    coverUrl: design.coverUrl,
    priceText: design.priceText,
    createdAtText: design.createdAt
      ? design.createdAt.replace('T', ' ').slice(0, 16)
      : '保存时间未知',
    beadCount: design.pattern.length,
    pattern: design.pattern,
    materialMap: design.materialMap,
    beadSize: design.beadSize,
  }
}

function normalizeDesignWork(source: RawDesign): DesignWork | null {
  return normalizeDesign(source, 'customer', API_BASE_URL)
}

export async function loadPersonalDesigns(): Promise<PersonalDesignPage> {
  const result = await requestApi<
    RawDesignList | RawDesign[],
    { page: number; pageSize: number; mode: string }
  >({
    path: '/api/design/list',
    data: { page: 1, pageSize: 100, mode: 'bracelet' },
  })
  const source = Array.isArray(result) ? { list: result } : result
  const rawItems = Array.isArray(source.list)
    ? source.list
    : Array.isArray(source.items) ? source.items : []
  const items = rawItems
    .map(normalizePersonalDesign)
    .filter((item): item is PersonalDesign => item !== null)
  return {
    items,
    total: toNumber(source.total, items.length),
  }
}

export async function loadPersonalDesignDetail(designCode: string): Promise<DesignWork | null> {
  const code = String(designCode || '').trim()
  if (!code) return null
  const result = await requestApi<RawDesign, { code: string }>({
    path: '/api/design/detail',
    data: { code },
  })
  return normalizeDesignWork(result)
}

export async function deletePersonalDesign(designCode: string): Promise<void> {
  const code = String(designCode || '').trim()
  if (!code) throw new Error('设计编号无效')
  await requestApi<unknown, { design_code: string }>({
    path: '/api/design/delete',
    method: 'POST',
    data: { design_code: code },
  })
}
