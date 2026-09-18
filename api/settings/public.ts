import { requestApi, resolveMediaUrl, toText } from '@/api/client'
import {
  normalizeThemeKey,
  setActiveThemeKey,
  type ThemeKey,
} from '@/services/theme'

const LEGACY_PUBLIC_SETTINGS_CACHE_KEY = 'stone_public_settings_v17'

// 公开运营配置以服务端当前值为准，不再保留历史本地缓存。
try {
  wx.removeStorageSync(LEGACY_PUBLIC_SETTINGS_CACHE_KEY)
} catch {
  // 清理旧版本缓存失败不阻塞本次网络请求。
}

interface RawHomeSlide {
  id?: string | number
  image?: string
  imageUrl?: string
  image_url?: string
  textImage?: string
  textImageUrl?: string
  text_image?: string
  text_image_url?: string
  route?: string
  path?: string
}

interface RawHomeImageSlot {
  key?: string
  id?: string
  image?: string
  imageUrl?: string
  image_url?: string
}

type RawDiyTrayImage = RawHomeImageSlot
type RawPurchaseNoticeImage = RawHomeImageSlot

export interface PublicCheckoutOption {
  optionCode?: string
  title?: string
  subtitle?: string
  amount?: number | string
  isFree?: boolean
  enabled?: boolean | number | string
  image?: string
  freeThreshold?: number | string
}

export interface PublicCheckoutOptionGroup {
  groupCode?: string
  title?: string
  enabled?: boolean | number | string
  options?: PublicCheckoutOption[]
}

interface RawPublicSettings {
  appName?: string
  homeIdentityName?: string
  diyPageTitle?: string
  themeKey?: string
  launchBackgroundImage?: string
  bottomImage?: string
  trayLogoImage?: string
  siteTitleLogoImage?: string
  horizontalLogoImage?: string
  wristMeasurementImage?: string
  purchaseNoticeImages?: RawPurchaseNoticeImage[]
  refundReturnAddress?: string
  refundReasons?: unknown[]
  contactServiceJson?: unknown
  slides?: RawHomeSlide[]
  homeMainEntries?: RawHomeImageSlot[]
  homeShortcuts?: RawHomeImageSlot[]
  homeProcessImage?: string
  homeActivityImage?: string
  homeActivityPopupImage?: string
  activityDetailImages?: RawPurchaseNoticeImage[]
  customerServiceFloatImage?: string
  homeMusicUrl?: string
  mallHeroImage?: string
  diyTrayImages?: RawDiyTrayImage[]
  diyShowcaseEyebrow?: string
  diyShowcaseTitle?: string
  diyShowcaseDescription?: string
  checkoutItemOptionGroups?: PublicCheckoutOptionGroup[]
}

interface RawContactService {
  wechatQr?: unknown
  wechatQrUrl?: unknown
  wechatQrs?: unknown
  wechatQrUrls?: unknown
  wechatId?: unknown
}

export interface PublicHomeSlide {
  id: string
  imageUrl: string
  textImageUrl: string
  route: string
}

export interface PublicHomeImageSlot {
  key: string
  imageUrl: string
}

export interface PublicContactService {
  wechatQrUrl: string
  wechatQrUrls: string[]
  wechatId: string
}

export interface PublicSettings {
  appName: string
  homeIdentityName: string
  diyPageTitle: string
  themeKey: ThemeKey
  launchBackgroundImageUrl: string
  bottomImageUrl: string
  trayLogoImageUrl: string
  siteTitleLogoImageUrl: string
  horizontalLogoImageUrl: string
  wristMeasurementImageUrl: string
  purchaseNoticeImageUrls: string[]
  refundReturnAddress: string
  refundReasons: string[]
  contactService: PublicContactService
  slides: PublicHomeSlide[]
  homeMainEntries: PublicHomeImageSlot[]
  homeShortcuts: PublicHomeImageSlot[]
  homeProcessImageUrl: string
  homeActivityImageUrl: string
  homeActivityPopupImageUrl: string
  activityDetailImageUrls: string[]
  customerServiceFloatImageUrl: string
  homeMusicUrl: string
  mallHeroImageUrl: string
  diyTrayImageUrls: string[]
  diyShowcaseEyebrow: string
  diyShowcaseTitle: string
  diyShowcaseDescription: string
  checkoutItemOptionGroups: PublicCheckoutOptionGroup[]
}

let pendingRequest: Promise<PublicSettings> | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeSlides(source: RawHomeSlide[] | undefined): PublicHomeSlide[] {
  return (source || []).map((slide, index) => ({
    id: toText(slide.id, `slide-${index + 1}`),
    imageUrl: resolveMediaUrl(slide.imageUrl || slide.image_url || slide.image),
    textImageUrl: resolveMediaUrl(slide.textImageUrl || slide.text_image_url || slide.textImage || slide.text_image),
    route: toText(slide.route || slide.path),
  })).filter((slide) => slide.imageUrl)
}

function normalizeImageSlots(source: RawHomeImageSlot[] | undefined): PublicHomeImageSlot[] {
  return (source || []).map((slot) => ({
    key: toText(slot.key || slot.id),
    imageUrl: resolveMediaUrl(slot.imageUrl || slot.image_url || slot.image),
  })).filter((slot) => slot.key && slot.imageUrl)
}

function normalizeDiyTrayImages(source: RawDiyTrayImage[] | undefined): string[] {
  return (source || [])
    .map((item) => resolveMediaUrl(item.imageUrl || item.image_url || item.image))
    .filter(Boolean)
    .slice(0, 5)
}

function normalizePurchaseNoticeImages(source: RawPurchaseNoticeImage[] | undefined): string[] {
  return (source || [])
    .map((item) => resolveMediaUrl(item.imageUrl || item.image_url || item.image))
    .filter(Boolean)
    .slice(0, 10)
}

function parseContactService(value: unknown): RawContactService {
  if (isRecord(value)) return value
  if (typeof value !== 'string' || !value.trim()) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function normalizeContactService(value: unknown): PublicContactService {
  const contact = parseContactService(value)
  const configuredList = Array.isArray(contact.wechatQrs)
    ? contact.wechatQrs
    : Array.isArray(contact.wechatQrUrls)
      ? contact.wechatQrUrls
      : []
  const configured = configuredList.length > 0
    ? configuredList
    : [contact.wechatQrUrl || contact.wechatQr]
  const wechatQrUrls = [...new Set(configured.map((item) => {
    if (isRecord(item)) {
      return resolveMediaUrl(item.image || item.imageUrl || item.image_url || item.url)
    }
    return resolveMediaUrl(item)
  }).filter(Boolean))].slice(0, 10)
  return {
    wechatQrUrl: wechatQrUrls[0] || '',
    wechatQrUrls,
    wechatId: toText(contact.wechatId),
  }
}

function normalizePublicSettings(source: RawPublicSettings): PublicSettings {
  const refundReasons = Array.isArray(source.refundReasons)
    ? [...new Set(source.refundReasons.map((item) => toText(item)).filter(Boolean))].slice(0, 10)
    : []
  return {
    appName: toText(source.appName, ''),
    homeIdentityName: toText(source.homeIdentityName, '微信用户'),
    diyPageTitle: toText(source.diyPageTitle, '晶石实验室'),
    themeKey: normalizeThemeKey(source.themeKey),
    launchBackgroundImageUrl: resolveMediaUrl(source.launchBackgroundImage),
    bottomImageUrl: resolveMediaUrl(source.bottomImage),
    trayLogoImageUrl: resolveMediaUrl(source.trayLogoImage),
    siteTitleLogoImageUrl: resolveMediaUrl(source.siteTitleLogoImage),
    horizontalLogoImageUrl: resolveMediaUrl(source.horizontalLogoImage),
    wristMeasurementImageUrl: resolveMediaUrl(source.wristMeasurementImage),
    purchaseNoticeImageUrls: normalizePurchaseNoticeImages(source.purchaseNoticeImages),
    refundReturnAddress: toText(source.refundReturnAddress),
    refundReasons: refundReasons.length > 0
      ? refundReasons
      : ['质量问题', '商品与描述不符', '其他问题'],
    contactService: normalizeContactService(source.contactServiceJson),
    slides: normalizeSlides(source.slides),
    homeMainEntries: normalizeImageSlots(source.homeMainEntries),
    homeShortcuts: normalizeImageSlots(source.homeShortcuts),
    homeProcessImageUrl: resolveMediaUrl(source.homeProcessImage),
    homeActivityImageUrl: resolveMediaUrl(source.homeActivityImage),
    homeActivityPopupImageUrl: resolveMediaUrl(source.homeActivityPopupImage),
    activityDetailImageUrls: normalizePurchaseNoticeImages(source.activityDetailImages),
    customerServiceFloatImageUrl: resolveMediaUrl(source.customerServiceFloatImage),
    homeMusicUrl: resolveMediaUrl(source.homeMusicUrl),
    mallHeroImageUrl: resolveMediaUrl(source.mallHeroImage),
    diyTrayImageUrls: normalizeDiyTrayImages(source.diyTrayImages),
    diyShowcaseEyebrow: toText(source.diyShowcaseEyebrow, 'MY CRYSTAL · 今日作品'),
    diyShowcaseTitle: toText(source.diyShowcaseTitle, '把喜欢的光，串成日常'),
    diyShowcaseDescription: toText(
      source.diyShowcaseDescription,
      '一串一念，留住此刻的温柔。',
    ),
    checkoutItemOptionGroups: Array.isArray(source.checkoutItemOptionGroups)
      ? source.checkoutItemOptionGroups
      : [],
  }
}

function applyPublicSettings(value: PublicSettings): PublicSettings {
  setActiveThemeKey(value.themeKey)
  return value
}

export function loadPublicSettings(_forceRefresh = false): Promise<PublicSettings> {
  // 只合并仍在进行中的同一请求；请求完成后不缓存返回值。
  if (pendingRequest) return pendingRequest

  const request = requestApi<RawPublicSettings>({
    path: '/api/settings/public',
    requiresAuth: false,
  }).then((settings) => applyPublicSettings(normalizePublicSettings(settings)))
    .finally(() => {
      if (pendingRequest === request) pendingRequest = null
    })
  pendingRequest = request
  return request
}
