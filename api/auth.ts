import {
  ApiRequestError,
  getApiErrorMessage,
  requestApi,
  resolveMediaUrl,
  toText,
} from '@/api/client'

const AUTH_TOKEN_KEY = 'stone_auth_token'
const AUTH_SESSION_KEY = 'stone_auth_session_v1'

interface RawAuthUser {
  id?: number | string
  user_id?: number | string
  nickname?: string
  nickName?: string
  username?: string
  avatar?: string
  avatarUrl?: string
  phone?: string
  mobile?: string
}

interface RawAuthSession {
  token?: string
  accessToken?: string
  expiresIn?: number
  expires_in?: number
  refreshToken?: string
  refresh_token?: string
  user?: RawAuthUser
}

interface StoredSession {
  issuedAt: number
  expiresAt: number
  refreshToken: string
  user: AccountProfile | null
}

export interface AccountProfile {
  id: string
  nickname: string
  avatarUrl: string
  phone: string
}

function normalizeAccountProfile(source: RawAuthUser | null | undefined): AccountProfile | null {
  if (!source) return null
  return {
    id: toText(source.id || source.user_id),
    nickname: toText(source.nickname || source.nickName || source.username, '微信用户'),
    avatarUrl: resolveMediaUrl(source.avatarUrl || source.avatar),
    phone: toText(source.phone || source.mobile),
  }
}

function persistSession(session: RawAuthSession): AccountProfile | null {
  const token = toText(session.token || session.accessToken)
  if (!token) throw new Error('登录结果缺少有效令牌')

  const issuedAt = Date.now()
  const expiresIn = Number(session.expiresIn || session.expires_in || 604800)
  const user = normalizeAccountProfile(session.user)
  const storedSession: StoredSession = {
    issuedAt,
    expiresAt: issuedAt + Math.max(60, expiresIn) * 1000,
    refreshToken: toText(session.refreshToken || session.refresh_token),
    user,
  }
  wx.setStorageSync(AUTH_TOKEN_KEY, token)
  wx.setStorageSync(AUTH_SESSION_KEY, storedSession)
  return user
}

function getMiniProgramAppId(): string {
  const accountInfo = wx.getAccountInfoSync()
  return toText(accountInfo.miniProgram && accountInfo.miniProgram.appId)
}

function requestWechatCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.login({
      success(result) {
        const code = toText(result.code)
        if (code) {
          resolve(code)
          return
        }
        reject(new Error('微信登录凭证为空'))
      },
      fail(error) {
        reject(new Error(getApiErrorMessage(error, '无法获取微信登录凭证')))
      },
    })
  })
}

export function hasAuthSession(): boolean {
  const token = toText(wx.getStorageSync(AUTH_TOKEN_KEY))
  if (!token) return false

  const session = wx.getStorageSync(AUTH_SESSION_KEY) as StoredSession | undefined
  if (!session?.user) {
    clearAuthSession()
    return false
  }
  if (session && session.expiresAt > 0 && session.expiresAt <= Date.now()) {
    clearAuthSession()
    return false
  }
  return true
}

export function getStoredAccountProfile(): AccountProfile | null {
  const session = wx.getStorageSync(AUTH_SESSION_KEY) as StoredSession | undefined
  return session && session.user ? session.user : null
}

export function updateStoredAccountProfile(profile: AccountProfile): void {
  const current = wx.getStorageSync(AUTH_SESSION_KEY) as StoredSession | undefined
  const next: StoredSession = current && typeof current === 'object'
    ? { ...current, user: profile }
    : {
      issuedAt: Date.now(),
      expiresAt: 0,
      refreshToken: '',
      user: profile,
    }
  wx.setStorageSync(AUTH_SESSION_KEY, next)
}

export async function loginWithWechat(phoneCode: string): Promise<AccountProfile | null> {
  const normalizedPhoneCode = toText(phoneCode)
  if (!normalizedPhoneCode) throw new Error('未完成登录')

  clearAuthSession()
  const loginCode = await requestWechatCode()
  const session = await requestApi<RawAuthSession, {
    loginCode: string
    phoneCode: string
    miniProgramAppId: string
  }>({
    path: '/api/user/wx_phone_login',
    method: 'POST',
    data: {
      loginCode,
      phoneCode: normalizedPhoneCode,
      miniProgramAppId: getMiniProgramAppId(),
    },
    timeout: 30000,
    requiresAuth: false,
  })
  const user = normalizeAccountProfile(session.user)
  if (!user?.phone) {
    clearAuthSession()
    throw new Error('登录信息不完整，请重试')
  }
  return persistSession(session)
}

/**
 * 点击登录后通过 wx.login 登录微信账户。
 * 兼容旧后端：返回 false 时调用方仍可切换到保留的手机号授权流程。
 */
export async function loginExistingWechatUser(): Promise<boolean> {
  clearAuthSession()
  const loginCode = await requestWechatCode()
  try {
    const session = await requestApi<RawAuthSession, {
      loginCode: string
      miniProgramAppId: string
    }>({
      path: '/api/user/wx_login',
      method: 'POST',
      data: {
        loginCode,
        miniProgramAppId: getMiniProgramAppId(),
      },
      timeout: 30000,
      requiresAuth: false,
    })
    persistSession(session)
    return true
  } catch (error) {
    clearAuthSession()
    if (error instanceof ApiRequestError && error.code === 'PHONE_AUTH_REQUIRED') {
      return false
    }
    throw error
  }
}

export function clearAuthSession(): void {
  wx.removeStorageSync(AUTH_TOKEN_KEY)
  wx.removeStorageSync(AUTH_SESSION_KEY)
}
