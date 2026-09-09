import { updateStoredAccountProfile, type AccountProfile } from '@/api/auth'
import { requestApi, resolveMediaUrl, toText, uploadFileApi } from '@/api/client'

interface RawProfile {
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

interface RawProfileUpdateResult {
  user?: RawProfile
  profile?: RawProfile
}

interface RawAvatarUploadResult {
  url?: string
  avatar?: string
  avatarUrl?: string
  path?: string
}

function normalizeProfile(source: RawProfile | null | undefined): AccountProfile {
  const profile = source || {}
  return {
    id: toText(profile.id || profile.user_id),
    nickname: toText(profile.nickname || profile.nickName || profile.username, '微信用户'),
    avatarUrl: resolveMediaUrl(profile.avatarUrl || profile.avatar),
    phone: toText(profile.phone || profile.mobile),
  }
}

export async function loadProfile(): Promise<AccountProfile> {
  const result = await requestApi<RawProfile>({ path: '/api/user/profile' })
  const profile = normalizeProfile(result)
  updateStoredAccountProfile(profile)
  return profile
}

export async function uploadProfileAvatar(filePath: string): Promise<string> {
  const result = await uploadFileApi<RawAvatarUploadResult>({
    path: '/api/upload/image',
    filePath,
    name: 'file',
    timeout: 30000,
  })
  return resolveMediaUrl(result.avatarUrl || result.avatar || result.url)
}

export async function updateProfile(input: {
  nickname: string
  avatarUrl: string
}): Promise<AccountProfile> {
  const result = await requestApi<RawProfileUpdateResult | RawProfile, {
    nickname: string
    avatar: string
    avatarUrl: string
  }>({
    path: '/api/user/update',
    method: 'POST',
    data: {
      nickname: input.nickname,
      avatar: input.avatarUrl,
      avatarUrl: input.avatarUrl,
    },
  })
  const wrapper = result as RawProfileUpdateResult
  const profile = normalizeProfile(wrapper.user || wrapper.profile || result as RawProfile)
  updateStoredAccountProfile(profile)
  return profile
}
