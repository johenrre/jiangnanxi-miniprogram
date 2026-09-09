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
): Promise<DesignPage> {
  return loadDesignWorks({ section, forceRefresh })
}

export function loadDiscoverDesignDetail(
  designId: string,
  section: DesignSection,
  forceRefresh = false,
): Promise<DesignWork | null> {
  return loadDesignDetail(designId, { section, forceRefresh })
}
