import {
  clearAuthSession,
  getApiErrorMessage,
  loginExistingWechatUser,
  loginWithWechat,
} from '@/api/index'
import {
  showPhoneAuthorizationRequired,
  type AuthGateOptions,
} from '@/services/auth-gate'
import {
  openLegalCenter,
} from '@/utils/legal'

interface LoginRuntime {
  task: Promise<boolean>
  resolve: (value: boolean) => void
}

const runtimeByComponent = new WeakMap<object, LoginRuntime>()

Component({
  data: {
    visible: false,
    loginLoading: false,
    phoneLoginRequired: false,
    agreementAccepted: false,
    title: '登录后继续',
    content: '登录后即可使用账户相关功能。',
  },

  lifetimes: {
    detached() {
      const key = this as unknown as object
      const runtime = runtimeByComponent.get(key)
      runtime?.resolve(false)
      runtimeByComponent.delete(key)
    },
  },

  methods: {
    requestLogin(options: AuthGateOptions = {}): Promise<boolean> {
      const key = this as unknown as object
      const current = runtimeByComponent.get(key)
      if (current) return current.task

      let resolveTask: (value: boolean) => void = () => undefined
      const task = new Promise<boolean>((resolve) => {
        resolveTask = resolve
      })
      runtimeByComponent.set(key, {
        task,
        resolve: resolveTask,
      })
      this.setData({
        visible: true,
        loginLoading: false,
        phoneLoginRequired: false,
        agreementAccepted: false,
        title: options.title || '登录后继续',
        content: options.content || '登录后即可使用账户相关功能。',
      })
      return task
    },

    completeLogin(result: boolean) {
      const key = this as unknown as object
      const runtime = runtimeByComponent.get(key)
      runtimeByComponent.delete(key)
      this.setData({
        visible: false,
        loginLoading: false,
        phoneLoginRequired: false,
        agreementAccepted: false,
      })
      runtime?.resolve(result)
    },

    handleCancel() {
      if (this.data.loginLoading) return
      this.completeLogin(false)
    },

    handleAgreementChange(
      event: WechatMiniprogram.CustomEvent<{ value?: string[] }>,
    ) {
      const selected = Array.isArray(event.detail.value) ? event.detail.value : []
      this.setData({ agreementAccepted: selected.includes('accepted') })
    },

    handleAgreementRequired() {
      wx.showToast({ title: '请先阅读并同意相关协议', icon: 'none' })
    },

    handleOpenUserAgreement() {
      openLegalCenter('agreement')
    },

    handleOpenPrivacyGuide() {
      openLegalCenter('privacy')
    },

    async handleLogin() {
      if (!this.data.agreementAccepted) {
        this.handleAgreementRequired()
        return
      }
      if (this.data.loginLoading || this.data.phoneLoginRequired) return
      this.setData({ loginLoading: true })
      try {
        const loggedIn = await loginExistingWechatUser()
        if (!loggedIn) {
          this.setData({ loginLoading: false, phoneLoginRequired: true })
          return
        }
        wx.showToast({ title: '登录成功', icon: 'success' })
        this.completeLogin(true)
      } catch (error) {
        wx.showToast({
          title: getApiErrorMessage(error, '登录失败，请稍后重试'),
          icon: 'none',
        })
        this.setData({ loginLoading: false })
      }
    },

    async handlePhoneLogin(
      event: WechatMiniprogram.CustomEvent<{ code?: string; errMsg?: string }>,
    ) {
      if (!this.data.agreementAccepted) {
        this.handleAgreementRequired()
        return
      }
      if (this.data.loginLoading) return
      const phoneCode = String(event.detail.code || '').trim()
      if (!phoneCode) {
        showPhoneAuthorizationRequired()
        return
      }

      this.setData({ loginLoading: true })
      try {
        await loginWithWechat(phoneCode)
        wx.showToast({ title: '登录成功', icon: 'success' })
        this.completeLogin(true)
      } catch (error) {
        clearAuthSession()
        wx.showToast({
          title: getApiErrorMessage(error, '登录失败，请稍后重试'),
          icon: 'none',
        })
        this.setData({ loginLoading: false })
      }
    },

    handleNoop() {
      // 阻止弹窗内部点击穿透。
    },
  },
})
