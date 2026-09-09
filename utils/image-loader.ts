import {
  cacheRemoteResource,
  getCachedResourcePath,
  isRemoteResourceUrl,
  removeCachedResource,
} from '@/utils/resource-cache'

export type ImageLoadStatus = 'ready' | 'error'

export interface ImageLoadResult {
  source: string
  localPath: string
  status: ImageLoadStatus
}

interface NetworkImageCacheEntry {
  status: 'loading' | 'ready'
  localPath: string
  task: Promise<ImageLoadResult>
}

interface NetworkImageLoadJob {
  source: string
  resolve: (result: ImageLoadResult) => void
}

const MAXIMUM_CONCURRENT_NETWORK_LOADS = 3
const NETWORK_RETRY_COUNT = 1
const NETWORK_RETRY_DELAY_MS = 250

const networkImageCache = new Map<string, NetworkImageCacheEntry>()
const networkImageLoadQueue: NetworkImageLoadJob[] = []
let activeNetworkLoads = 0

function createResult(
  source: string,
  status: ImageLoadStatus,
  localPath = '',
): ImageLoadResult {
  return { source, localPath, status }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}

function getImageLocalPath(source: string): Promise<string> {
  return cacheRemoteResource(source, 'image').then((localPath) => (
    new Promise((resolve, reject) => {
      try {
        wx.getImageInfo({
          src: localPath,
          success: (result) => {
            if (result.path) {
              resolve(localPath)
            } else {
              removeCachedResource(source)
              reject(new Error('Image has no local path'))
            }
          },
          fail: () => {
            removeCachedResource(source)
            reject(new Error('Image download failed'))
          },
        })
      } catch (error) {
        removeCachedResource(source)
        reject(error)
      }
    })
  ))
}

async function loadNetworkImage(source: string): Promise<ImageLoadResult> {
  for (let attempt = 0; attempt <= NETWORK_RETRY_COUNT; attempt += 1) {
    try {
      const localPath = await getImageLocalPath(source)
      return createResult(source, 'ready', localPath)
    } catch {
      if (attempt < NETWORK_RETRY_COUNT) {
        await wait(NETWORK_RETRY_DELAY_MS)
      }
    }
  }
  return createResult(source, 'error')
}

async function runNetworkImageLoad(job: NetworkImageLoadJob): Promise<void> {
  let result: ImageLoadResult
  try {
    result = await loadNetworkImage(job.source)
  } catch {
    result = createResult(job.source, 'error')
  }
  job.resolve(result)
  activeNetworkLoads = Math.max(0, activeNetworkLoads - 1)
  pumpNetworkImageLoadQueue()
}

function pumpNetworkImageLoadQueue(): void {
  while (
    activeNetworkLoads < MAXIMUM_CONCURRENT_NETWORK_LOADS
    && networkImageLoadQueue.length > 0
  ) {
    const job = networkImageLoadQueue.shift()
    if (!job) continue
    activeNetworkLoads += 1
    void runNetworkImageLoad(job)
  }
}

export function loadImage(rawSource: string): Promise<ImageLoadResult> {
  const source = rawSource.trim()
  if (!source) return Promise.resolve(createResult(source, 'error'))
  if (!isRemoteResourceUrl(source)) {
    return Promise.resolve(createResult(source, 'ready', source))
  }

  const cached = networkImageCache.get(source)
  if (cached?.status === 'ready') {
    const persistentPath = getCachedResourcePath(source)
    if (persistentPath) {
      return Promise.resolve(createResult(source, 'ready', persistentPath))
    }
    networkImageCache.delete(source)
  }
  if (cached?.status === 'loading') return cached.task

  let resolveTask: (result: ImageLoadResult) => void = () => undefined
  const task = new Promise<ImageLoadResult>((resolve) => {
    resolveTask = resolve
  })
  const entry: NetworkImageCacheEntry = {
    status: 'loading',
    localPath: '',
    task,
  }
  networkImageCache.set(source, entry)
  networkImageLoadQueue.push({
    source,
    resolve: (result) => {
      if (result.status === 'ready') {
        entry.status = 'ready'
        entry.localPath = result.localPath
      } else {
        networkImageCache.delete(source)
      }
      resolveTask(result)
    },
  })
  pumpNetworkImageLoadQueue()
  return task
}

export function preloadImages(sources: readonly string[]): Promise<ImageLoadResult[]> {
  const uniqueSources = Array.from(new Set(
    sources
      .map((source) => source.trim())
      .filter((source) => Boolean(source)),
  ))
  return Promise.all(uniqueSources.map(loadImage))
}

export function getCachedImagePath(rawSource: string): string {
  const source = rawSource.trim()
  if (!source) return ''
  if (!isRemoteResourceUrl(source)) return source
  const cached = networkImageCache.get(source)
  if (cached?.status !== 'ready') return getCachedResourcePath(source)
  const persistentPath = getCachedResourcePath(source)
  if (persistentPath) return persistentPath
  networkImageCache.delete(source)
  return ''
}
