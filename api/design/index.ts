import { normalizeDesign, normalizeDesignPage, toNumber, toText } from '@/api/design/normalizer'
import { API_BASE_URL, requestApi } from '@/api/client'
import type {
  DesignPage,
  DesignSection,
  DesignWork,
  LoadDesignsOptions,
  RawDesign,
  RawDesignPage,
} from '@/api/design/types'

export type {
  DesignMaterial,
  DesignPage,
  DesignPreviewMaterial,
  DesignSection,
  DesignWork,
  LoadDesignsOptions,
} from '@/api/design/types'

const DEFAULT_PAGE_SIZE = 18

const firstPageRequests = new Map<DesignSection, Promise<DesignPage>>()

async function requestDesignWorks(
  section: DesignSection,
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
): Promise<DesignPage> {
  const result = await requestApi<RawDesignPage | RawDesign[], {
    page: number
    pageSize: number
    category: string
    section: string
    type: string
    sort: string
  }>({
    path: '/api/square/list',
    data: {
      page,
      pageSize,
      category: 'bracelet',
      section,
      type: section,
      sort: 'latest',
    },
    requiresAuth: false,
  })
  return normalizeDesignPage(result, section, API_BASE_URL)
}

async function getFirstDesignPage(
  section: DesignSection,
  forceRefresh: boolean,
): Promise<DesignPage> {
  const currentRequest = firstPageRequests.get(section)
  if (!forceRefresh && currentRequest) return currentRequest

  const request = requestDesignWorks(section, 1, DEFAULT_PAGE_SIZE).finally(() => {
    if (firstPageRequests.get(section) === request) firstPageRequests.delete(section)
  })
  firstPageRequests.set(section, request)
  return request
}

export async function loadDesignWorks(options: LoadDesignsOptions = {}): Promise<DesignPage> {
  const section = options.section || 'designer'
  const requestedPage = Math.max(1, Math.floor(toNumber(options.page)) || 1)
  const requestedPageSize = Math.min(
    100,
    Math.max(1, Math.floor(toNumber(options.pageSize)) || DEFAULT_PAGE_SIZE),
  )
  const page = requestedPage === 1 && requestedPageSize === DEFAULT_PAGE_SIZE
    ? await getFirstDesignPage(section, options.forceRefresh === true)
    : await requestDesignWorks(section, requestedPage, requestedPageSize)
  const limit = Math.floor(toNumber(options.limit))
  return limit > 0 ? { ...page, items: page.items.slice(0, limit) } : page
}

export async function loadDesignerWorks(
  options: Omit<LoadDesignsOptions, 'section'> = {},
): Promise<DesignPage> {
  return loadDesignWorks({ ...options, section: 'designer' })
}

export async function loadDesignDetail(
  designId: string,
  options: Pick<LoadDesignsOptions, 'forceRefresh' | 'section'> = {},
): Promise<DesignWork | null> {
  const normalizedId = toText(designId)
  if (!normalizedId) return null

  const section = options.section || 'designer'
  const raw = await requestApi<RawDesign, { code: string }>({
    path: '/api/square/detail',
    data: { code: normalizedId },
    requiresAuth: false,
  })
  return normalizeDesign(raw, section, API_BASE_URL)
}

export function getDesignErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = toText(error.message)
    if (message) return message
  }
  return '设计作品加载失败，请稍后重试'
}
