import { API_BASE_URL } from '@/api/config'
const AUTH_TOKEN_KEY = 'stone_auth_token'

interface ApiEnvelope<T> {
  code?: number | string
  success?: boolean
  message?: string
  data?: T
}

interface RequestOptions<TData extends WechatMiniprogram.IAnyObject> {
  path: string
  method?: 'GET' | 'POST'
  data?: TData
  timeout?: number
  requiresAuth?: boolean
}

interface UploadFileOptions {
  path: string
  filePath: string
  name?: string
  formData?: WechatMiniprogram.IAnyObject
  timeout?: number
  requiresAuth?: boolean
}

export class ApiRequestError extends Error {
  readonly statusCode: number
  readonly code: string
  readonly responseData: unknown

  constructor(message: string, statusCode = 0, code = '', responseData: unknown = null) {
    super(message)
    this.name = 'ApiRequestError'
    this.statusCode = statusCode
    this.code = code || 'REQUEST_FAILED'
    this.responseData = responseData
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readMessage(value: unknown): string {
  if (!isRecord(value)) return ''
  return String(value.message || value.msg || value.error || '').trim()
}

function readBusinessCode(value: unknown): string {
  if (!isRecord(value)) return ''
  const data = isRecord(value.data) ? value.data : null
  const errorCode = String(
    value.error_code
    || value.errorCode
    || data?.error_code
    || data?.errorCode
    || '',
  ).trim()
  if (errorCode) return errorCode
  const code = String(value.code || '').trim()
  return code && code !== '200' ? code : ''
}

function unwrapResponse<T>(value: T | ApiEnvelope<T>): T {
  if (!isRecord(value)) return value as T

  const code = Number(value.code)
  if (Object.prototype.hasOwnProperty.call(value, 'code') && code !== 200) {
    throw new ApiRequestError(
      readMessage(value) || '服务暂时不可用',
      0,
      readBusinessCode(value),
      value,
    )
  }
  if (value.success === false) {
    throw new ApiRequestError(
      readMessage(value) || '操作未成功',
      0,
      readBusinessCode(value),
      value,
    )
  }
  if (
    Object.prototype.hasOwnProperty.call(value, 'data')
    && (code === 200 || value.success === true)
  ) {
    return value.data as T
  }
  return value as T
}

function buildHeaders(requiresAuth: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  }
  if (!requiresAuth) return headers

  const token = String(wx.getStorageSync(AUTH_TOKEN_KEY) || '').trim()
  if (token) {
    headers.Authorization = `Bearer ${token}`
    headers['X-Auth-Token'] = token
  }
  return headers
}

export function requestApi<
  TResult,
  TData extends WechatMiniprogram.IAnyObject = WechatMiniprogram.IAnyObject,
>(options: RequestOptions<TData>): Promise<TResult> {
  const method = options.method || 'GET'
  const requiresAuth = options.requiresAuth !== false

  return new Promise((resolve, reject) => {
    wx.request<WechatMiniprogram.IAnyObject>({
      url: `${API_BASE_URL}${options.path}`,
      method,
      data: options.data,
      timeout: options.timeout || 12000,
      header: buildHeaders(requiresAuth),
      success(response) {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const message = readMessage(response.data)
          reject(new ApiRequestError(
            message || `请求失败（${response.statusCode}）`,
            response.statusCode,
            readBusinessCode(response.data),
            response.data,
          ))
          return
        }

        try {
          resolve(unwrapResponse(response.data as TResult | ApiEnvelope<TResult>))
        } catch (error) {
          reject(error)
        }
      },
      fail(error) {
        const detail = String(error.errMsg || '')
        reject(new ApiRequestError(
          detail.includes('timeout') ? '请求超时，请稍后重试' : '网络连接失败，请检查网络后重试',
        ))
      },
    })
  })
}

/** 使用 multipart/form-data 上传文件，复用统一鉴权与响应 envelope 处理。 */
export function uploadFileApi<TResult>(options: UploadFileOptions): Promise<TResult> {
  const requiresAuth = options.requiresAuth !== false
  const headers = buildHeaders(requiresAuth)
  delete headers['content-type']

  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${API_BASE_URL}${options.path}`,
      filePath: options.filePath,
      name: options.name || 'file',
      formData: options.formData,
      timeout: options.timeout || 30000,
      header: headers,
      success(response) {
        let responseData: unknown = response.data
        try {
          responseData = JSON.parse(response.data)
        } catch {
          // 非 JSON 响应会在下面给出明确错误。
        }

        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new ApiRequestError(
            readMessage(responseData) || `上传失败（${response.statusCode}）`,
            response.statusCode,
            readBusinessCode(responseData),
            responseData,
          ))
          return
        }

        try {
          if (typeof responseData === 'string') throw new Error('上传接口返回格式错误')
          resolve(unwrapResponse(responseData as TResult | ApiEnvelope<TResult>))
        } catch (error) {
          reject(error)
        }
      },
      fail(error) {
        const detail = String(error.errMsg || '')
        reject(new ApiRequestError(
          detail.includes('timeout') ? '图片上传超时，请稍后重试' : '图片上传失败，请检查网络后重试',
        ))
      },
    })
  })
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (isRecord(error)) {
    const message = String(error.message || error.errMsg || '').trim()
    if (message) return message
  }
  return fallback
}

export function isApiUnauthorized(error: unknown): boolean {
  if (error instanceof ApiRequestError) {
    return error.statusCode === 401 || error.code === 'AUTH_INVALID'
  }
  if (!isRecord(error)) return false
  return Number(error.statusCode) === 401
    || String(error.code || '').toUpperCase() === 'AUTH_INVALID'
}

export function resolveMediaUrl(value: unknown): string {
  const url = String(value || '').trim()
  if (!url) return ''
  if (/^https?:\/\//i.test(url)) return url
  return `${API_BASE_URL}/${url.replace(/^\/+/, '')}`
}

export { API_BASE_URL }

export function toText(value: unknown, fallback = ''): string {
  const text = String(value ?? '').trim()
  return text || fallback
}

export function toNumber(value: unknown, fallback = 0): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}
