export type CachedResourceKind = 'image' | 'audio'

interface CachedResourceEntry {
  localPath: string
  kind: CachedResourceKind
  size: number
  lastAccessAt: number
}

interface CachedResourceManifest {
  entries: Record<string, CachedResourceEntry>
}

const CACHE_STORAGE_KEY = 'stone_global_resource_files_v1'
const CACHE_DIRECTORY = `${wx.env.USER_DATA_PATH}/resource-cache-v1`
const DOWNLOAD_TIMEOUT_MS = 8_000
const MAX_CACHE_FILE_COUNT = 160
const MAX_CACHE_BYTES = 60 * 1024 * 1024

const fileSystem = wx.getFileSystemManager()
const pendingDownloads = new Map<string, Promise<string>>()
let manifest: CachedResourceManifest | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function readManifest(): CachedResourceManifest {
  if (manifest) return manifest
  try {
    const stored = wx.getStorageSync(CACHE_STORAGE_KEY) as unknown
    if (!isRecord(stored) || !isRecord(stored.entries)) {
      manifest = { entries: {} }
      return manifest
    }
    const entries: Record<string, CachedResourceEntry> = {}
    let removedInvalidSource = false
    for (const [source, value] of Object.entries(stored.entries)) {
      if (!isRecord(value)) continue
      if (!isRemoteResourceUrl(source)) {
        removedInvalidSource = true
        continue
      }
      const localPath = String(value.localPath || '')
      const kind = value.kind === 'audio' ? 'audio' : 'image'
      if (!localPath.startsWith(`${CACHE_DIRECTORY}/`)) continue
      entries[source] = {
        localPath,
        kind,
        size: Number(value.size) || 0,
        lastAccessAt: Number(value.lastAccessAt) || 0,
      }
    }
    manifest = { entries }
    if (removedInvalidSource) {
      try {
        wx.setStorageSync(CACHE_STORAGE_KEY, manifest)
      } catch {
        // 清理旧索引失败不影响当前进程使用已经筛选过的有效条目。
      }
    }
    return manifest
  } catch {
    manifest = { entries: {} }
    return manifest
  }
}

function writeManifest(): void {
  try {
    wx.setStorageSync(CACHE_STORAGE_KEY, readManifest())
  } catch {
    // 索引写入失败不影响当前进程继续使用已经下载的文件。
  }
}

function ensureCacheDirectory(): void {
  try {
    fileSystem.mkdirSync(CACHE_DIRECTORY, true)
  } catch {
    // 已存在目录在部分基础库会抛错，后续文件访问仍可正常工作。
  }
}

export function isRemoteResourceUrl(rawSource: string): boolean {
  const source = rawSource.trim()
  if (!/^https?:\/\//i.test(source)) return false

  // 微信本地文件在模拟器中也使用 http 协议，例如 http://usr/...、http://tmp/...。
  const userDataRoot = String(wx.env.USER_DATA_PATH || '').replace(/\/+$/, '')
  if (userDataRoot && (source === userDataRoot || source.startsWith(`${userDataRoot}/`))) {
    return false
  }
  return !/^http:\/\/(?:usr|tmp|store)(?:\/|$)/i.test(source)
}

function fileExists(localPath: string): boolean {
  try {
    fileSystem.accessSync(localPath)
    return true
  } catch {
    return false
  }
}

function fileSize(localPath: string): number {
  try {
    return fileSystem.statSync(localPath).size
  } catch {
    return 0
  }
}

function safeUnlink(localPath: string): void {
  if (!localPath.startsWith(`${CACHE_DIRECTORY}/`)) return
  try {
    fileSystem.unlinkSync(localPath)
  } catch {
    // 文件不存在或暂时被占用时无需阻断业务。
  }
}

function hashSource(source: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function extensionFor(source: string, kind: CachedResourceKind): string {
  if (kind === 'audio') return 'mp3'
  const path = source.split(/[?#]/, 1)[0] || ''
  const extension = path.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase()
  return extension && ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension)
    ? extension
    : 'jpg'
}

function pruneCache(): void {
  const cache = readManifest()
  const entries = Object.entries(cache.entries)
    .filter(([source, entry]) => {
      if (fileExists(entry.localPath)) return true
      delete cache.entries[source]
      return false
    })
    .sort((left, right) => left[1].lastAccessAt - right[1].lastAccessAt)
  let totalBytes = entries.reduce((total, [, entry]) => total + entry.size, 0)
  let totalFiles = entries.length

  for (const [source, entry] of entries) {
    if (totalFiles <= MAX_CACHE_FILE_COUNT && totalBytes <= MAX_CACHE_BYTES) break
    safeUnlink(entry.localPath)
    delete cache.entries[source]
    totalFiles -= 1
    totalBytes -= entry.size
  }
}

function downloadResource(source: string, localPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url: source,
      filePath: localPath,
      timeout: DOWNLOAD_TIMEOUT_MS,
      success: (result) => {
        if (result.statusCode >= 200 && result.statusCode < 300 && fileExists(localPath)) {
          resolve(localPath)
          return
        }
        safeUnlink(localPath)
        reject(new Error(`resource download failed: ${result.statusCode}`))
      },
      fail: (error) => {
        safeUnlink(localPath)
        reject(error)
      },
    })
  })
}

export function getCachedResourcePath(rawSource: string): string {
  const source = rawSource.trim()
  if (!source || !isRemoteResourceUrl(source)) return source
  const cache = readManifest()
  const entry = cache.entries[source]
  if (!entry) return ''
  if (!fileExists(entry.localPath)) {
    delete cache.entries[source]
    writeManifest()
    return ''
  }
  entry.lastAccessAt = Date.now()
  return entry.localPath
}

export function removeCachedResource(rawSource: string): void {
  const source = rawSource.trim()
  if (!source) return
  const cache = readManifest()
  const entry = cache.entries[source]
  if (!entry) return
  safeUnlink(entry.localPath)
  delete cache.entries[source]
  writeManifest()
}

/**
 * 本地缓存文件无法被图片组件读取时，删除损坏缓存并返回原始网络地址。
 * 网络地址自身失败时返回空字符串，避免在 binderror 中无限重试。
 */
export function recoverRemoteResourceUrl(rawLocalPath: string): string {
  const localPath = rawLocalPath.trim()
  if (!localPath || isRemoteResourceUrl(localPath)) return ''

  const cache = readManifest()
  const matched = Object.entries(cache.entries)
    .find(([, entry]) => entry.localPath === localPath)
  if (!matched) return ''

  const [source, entry] = matched
  safeUnlink(entry.localPath)
  delete cache.entries[source]
  writeManifest()
  return source
}

export function cacheRemoteResource(
  rawSource: string,
  kind: CachedResourceKind,
): Promise<string> {
  const source = rawSource.trim()
  if (!source) return Promise.reject(new Error('resource source is empty'))
  if (!isRemoteResourceUrl(source)) return Promise.resolve(source)

  const cachedPath = getCachedResourcePath(source)
  if (cachedPath) return Promise.resolve(cachedPath)
  const pending = pendingDownloads.get(source)
  if (pending) return pending

  ensureCacheDirectory()
  const localPath = `${CACHE_DIRECTORY}/${hashSource(source)}.${extensionFor(source, kind)}`
  const task = (fileExists(localPath)
    ? Promise.resolve(localPath)
    : downloadResource(source, localPath))
    .then((downloadedPath) => {
      const cache = readManifest()
      cache.entries[source] = {
        localPath: downloadedPath,
        kind,
        size: fileSize(downloadedPath),
        lastAccessAt: Date.now(),
      }
      pruneCache()
      writeManifest()
      return downloadedPath
    })
    .finally(() => {
      pendingDownloads.delete(source)
    })
  pendingDownloads.set(source, task)
  return task
}
