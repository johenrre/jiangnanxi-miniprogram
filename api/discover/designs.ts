import {
  loadDesignDetail,
  loadDesignWorks,
  type DesignPage,
  type DesignSection,
  type DesignWork,
} from '@/api/design/index'

export function loadDiscoverDesignWorks(
  section: DesignSection,
  forceRefresh = false,
  page = 1,
  pageSize?: number,
): Promise<DesignPage> {
  return loadDesignWorks({ section, forceRefresh, page, pageSize })
}

export function loadDiscoverDesignDetail(
  designId: string,
  section: DesignSection,
  forceRefresh = false,
): Promise<DesignWork | null> {
  return loadDesignDetail(designId, { section, forceRefresh })
}
