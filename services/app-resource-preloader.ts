import {
  loadPublicSettings,
  type PublicSettings,
} from '@/api/settings/public'
import { loadImage } from '@/utils/image-loader'
import {
  cacheRemoteResource,
  getCachedResourcePath,
  isRemoteResourceUrl,
} from '@/utils/resource-cache'

type ResourceKind = 'image' | 'audio'

interface ResourceRequest {
  url: string
  kind: ResourceKind
}

export interface AppResourceProgress {
  completed: number
  total: number
  failed: number
  currentKind: ResourceKind
}

export interface AppResourcePreparation {
  settings: PublicSettings
  failed: number
  total: number
}

type ProgressListener = (progress: AppResourceProgress) => void

const progressListeners = new Set<ProgressListener>()
let activePreparation: Promise<AppResourcePreparation> | null = null
let preparedHomeEntry: AppResourcePreparation | null = null
let latestProgress: AppResourceProgress = {
  completed: 0,
  total: 0,
  failed: 0,
  currentKind: 'image',
}

function collectResources(settings: PublicSettings): ResourceRequest[] {
  const resources: ResourceRequest[] = [
    { url: settings.launchBackgroundImageUrl, kind: 'image' },
    ...settings.slides.slice(0, 1).flatMap((slide) => [
      { url: slide.imageUrl, kind: 'image' as const },
      { url: slide.textImageUrl, kind: 'image' as const },
    ]),
    { url: settings.siteTitleLogoImageUrl, kind: 'image' },
    { url: settings.horizontalLogoImageUrl, kind: 'image' },
    { url: settings.trayLogoImageUrl, kind: 'image' },
    ...settings.diyTrayImageUrls.slice(0, 1).map((url) => ({ url, kind: 'image' as const })),
    ...settings.homeMainEntries.map((slot) => ({ url: slot.imageUrl, kind: 'image' as const })),
    ...settings.homeShortcuts.map((slot) => ({ url: slot.imageUrl, kind: 'image' as const })),
    { url: settings.homeActivityImageUrl, kind: 'image' },
    { url: settings.homeActivityPopupImageUrl, kind: 'image' },
    { url: settings.customerServiceFloatImageUrl, kind: 'image' },
    { url: settings.bottomImageUrl, kind: 'image' },
    { url: settings.homeMusicUrl, kind: 'audio' },
  ]
  const seen = new Set<string>()
  return resources.filter((resource) => {
    if (!resource.url || !isRemoteResourceUrl(resource.url) || seen.has(resource.url)) return false
    seen.add(resource.url)
    return true
  })
}

function emitProgress(progress: AppResourceProgress): void {
  latestProgress = progress
  for (const listener of progressListeners) listener(progress)
}

function localize(url: string): string {
  return getCachedResourcePath(url) || url
}

function localizeSettings(settings: PublicSettings): PublicSettings {
  return {
    ...settings,
    launchBackgroundImageUrl: localize(settings.launchBackgroundImageUrl),
    bottomImageUrl: localize(settings.bottomImageUrl),
    trayLogoImageUrl: localize(settings.trayLogoImageUrl),
    diyTrayImageUrls: settings.diyTrayImageUrls.map(localize),
    siteTitleLogoImageUrl: localize(settings.siteTitleLogoImageUrl),
    horizontalLogoImageUrl: localize(settings.horizontalLogoImageUrl),
    slides: settings.slides.map((slide) => ({
      ...slide,
      imageUrl: localize(slide.imageUrl),
      textImageUrl: localize(slide.textImageUrl),
    })),
    homeMainEntries: settings.homeMainEntries.map((slot) => ({
      ...slot,
      imageUrl: localize(slot.imageUrl),
    })),
    homeShortcuts: settings.homeShortcuts.map((slot) => ({
      ...slot,
      imageUrl: localize(slot.imageUrl),
    })),
    homeProcessImageUrl: localize(settings.homeProcessImageUrl),
    homeActivityImageUrl: localize(settings.homeActivityImageUrl),
    homeActivityPopupImageUrl: localize(settings.homeActivityPopupImageUrl),
    activityDetailImageUrls: settings.activityDetailImageUrls.map(localize),
    customerServiceFloatImageUrl: localize(settings.customerServiceFloatImageUrl),
    mallHeroImageUrl: localize(settings.mallHeroImageUrl),
    contactService: {
      ...settings.contactService,
      wechatQrUrl: localize(settings.contactService.wechatQrUrl),
      wechatQrUrls: settings.contactService.wechatQrUrls.map(localize),
    },
    homeMusicUrl: localize(settings.homeMusicUrl),
  }
}

async function prepareSettingsResources(settings: PublicSettings): Promise<AppResourcePreparation> {
  const resources = collectResources(settings)
  let completed = 0
  let failed = 0
  emitProgress({ completed, total: resources.length, failed, currentKind: 'image' })

  await Promise.all(resources.map(async (resource) => {
    try {
      if (resource.kind === 'image') {
        const result = await loadImage(resource.url)
        if (result.status !== 'ready') failed += 1
      } else {
        await cacheRemoteResource(resource.url, 'audio')
      }
    } catch {
      failed += 1
    }
    completed += 1
    emitProgress({ completed, total: resources.length, failed, currentKind: resource.kind })
  }))

  return {
    settings: localizeSettings(settings),
    failed,
    total: resources.length,
  }
}

export function resolvePreparedResourceUrl(url: string): string {
  return localize(url)
}

/**
 * 把启动页刚完成的资源结果暂存给首页首次进入使用。
 * 只保存在当前进程内，并在首页读取后立即清除，不属于公开配置缓存。
 */
export function stagePreparedHomeEntry(preparation: AppResourcePreparation): void {
  preparedHomeEntry = preparation
}

/** 首页首次进入消费启动页结果；同一份结果只能读取一次。 */
export function consumePreparedHomeEntry(): AppResourcePreparation | null {
  const preparation = preparedHomeEntry
  preparedHomeEntry = null
  return preparation
}

export function prepareAppResources(
  forceRefresh = false,
  onProgress?: ProgressListener,
): Promise<AppResourcePreparation> {
  const shouldStartPreparation = !activePreparation || forceRefresh
  if (shouldStartPreparation) {
    latestProgress = {
      completed: 0,
      total: 0,
      failed: 0,
      currentKind: 'image',
    }
  }
  if (onProgress) {
    progressListeners.add(onProgress)
    onProgress(latestProgress)
  }
  if (shouldStartPreparation) {
    const preparation = loadPublicSettings(forceRefresh)
      .then(prepareSettingsResources)
    activePreparation = preparation
    void preparation.then(
      () => {
        if (activePreparation !== preparation) return
        activePreparation = null
      },
      () => {
        if (activePreparation !== preparation) return
        activePreparation = null
      },
    )
  }
  const preparation = activePreparation as Promise<AppResourcePreparation>
  return preparation.finally(() => {
    if (onProgress) progressListeners.delete(onProgress)
  })
}
