import type { AccountProfile } from '@/api/index'

export const DEFAULT_ACCOUNT_NAME = '微信用户'
export const DEFAULT_ACCOUNT_AVATAR_URL = '/assets/profile/default-avatar.svg'

const GENERIC_ACCOUNT_NAMES = new Set([
  '',
  '微信用户',
  '用户',
  '新用户',
  '未设置昵称',
])

export function getAccountDisplayName(
  profile: AccountProfile | null | undefined,
  defaultName = DEFAULT_ACCOUNT_NAME,
): string {
  const nickname = String(profile?.nickname || '').trim()
  const isGeneratedNickname = /^(?:user|wxid|wechat|wx_user)/i.test(nickname)
  return GENERIC_ACCOUNT_NAMES.has(nickname) || isGeneratedNickname
    ? String(defaultName || '').trim() || DEFAULT_ACCOUNT_NAME
    : nickname
}

export function getAccountAvatarUrl(
  profile: AccountProfile | null | undefined,
  defaultAvatarUrl = DEFAULT_ACCOUNT_AVATAR_URL,
): string {
  return String(profile?.avatarUrl || '').trim()
    || String(defaultAvatarUrl || '').trim()
    || DEFAULT_ACCOUNT_AVATAR_URL
}
