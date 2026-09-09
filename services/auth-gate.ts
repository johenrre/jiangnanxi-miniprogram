import {
  hasAuthSession,
} from '@/api/index'

export interface AuthGateOptions {
  title?: string
  content?: string
}

interface PhoneLoginModalInstance {
  requestLogin(options?: AuthGateOptions): Promise<boolean>
}

interface AuthGateHost {
  selectComponent(selector: string): WechatMiniprogram.Component.TrivialInstance | null
}

let activeLoginTask: Promise<boolean> | null = null

export function showPhoneAuthorizationRequired(): void {
  wx.showModal({
    title: '未完成登录',
    content: '登录后才能使用购物车、订单和设计保存等完整服务。',
    showCancel: false,
    confirmText: '我知道了',
  })
}

async function runLogin(host: AuthGateHost, options: AuthGateOptions): Promise<boolean> {
  if (hasAuthSession()) return true
  const modal = host.selectComponent('#phone-login-modal') as unknown as PhoneLoginModalInstance | null
  if (!modal) {
    wx.showToast({ title: '登录组件加载失败，请稍后重试', icon: 'none' })
    return false
  }
  return modal.requestLogin(options)
}

export function ensureAuthenticated(
  host: AuthGateHost,
  options: AuthGateOptions = {},
): Promise<boolean> {
  if (hasAuthSession()) return Promise.resolve(true)
  if (activeLoginTask) return activeLoginTask

  const task = runLogin(host, options).finally(() => {
    if (activeLoginTask === task) activeLoginTask = null
  })
  activeLoginTask = task
  return task
}
