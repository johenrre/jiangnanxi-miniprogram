/** 小程序运行环境，由微信在编译和发布时自动提供。 */
export type MiniProgramEnvVersion = 'develop' | 'trial' | 'release'

/**
 * 江南禧小程序在不同微信环境中使用的后端地址。
 *
 * - develop：开发者工具、开发版和真机调试，访问群晖上的本地开发后端。
 * - trial：体验版，访问阿里云生产后端。
 * - release：正式版，访问阿里云生产后端。
 *
 * 这里仅保存公开的接口地址，不能放微信、支付或其他服务端密钥。
 */
const API_BASE_URLS: Record<MiniProgramEnvVersion, string> = {
  develop: 'https://rocking.synology.me:4001',
  trial: 'https://rocking.synology.me:4001',
  release: 'https://rocking.synology.me:4001',
}

function normalizeEnvVersion(value: unknown): MiniProgramEnvVersion {
  return value === 'trial' || value === 'release' ? value : 'develop'
}

function getMiniProgramEnvVersion(): MiniProgramEnvVersion {
  if (typeof wx === 'undefined') return 'develop'
  try {
    const miniProgram = wx.getAccountInfoSync().miniProgram
    return normalizeEnvVersion(miniProgram.envVersion)
  } catch {
    return 'develop'
  }
}

export const MINI_PROGRAM_ENV_VERSION = getMiniProgramEnvVersion()

/** 由微信运行环境决定当前接口地址。 */
export const API_BASE_URL = API_BASE_URLS[MINI_PROGRAM_ENV_VERSION]
