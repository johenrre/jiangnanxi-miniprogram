import {
  clearAuthSession,
  getApiErrorMessage,
  hasAuthSession,
  loginWithWechat,
  loadProfile,
  updateProfile,
  uploadProfileAvatar,
  type AccountProfile,
} from '@/api/index'
import { showPhoneAuthorizationRequired } from '@/services/auth-gate'

type ProfilePageStatus = 'login' | 'loading' | 'ready' | 'error'

Page({
  data: {
    status: 'loading' as ProfilePageStatus,
    profile: null as AccountProfile | null,
    nickname: '',
    avatarUrl: '',
    avatarLoadFailed: false,
    selectedAvatarPath: '',
    errorMessage: '',
    saving: false,
    loginLoading: false,
  },

  onShow() {
    if (!hasAuthSession()) {
      this.setData({ status: 'login', profile: null })
      return
    }
    if (this.data.status !== 'ready') void this.loadData()
  },

  async loadData() {
    this.setData({ status: 'loading', errorMessage: '' })
    try {
      const profile = await loadProfile()
      this.setData({
        status: 'ready',
        profile,
        nickname: profile.nickname,
        avatarUrl: profile.avatarUrl,
        avatarLoadFailed: false,
        selectedAvatarPath: '',
      })
    } catch (error) {
      this.setData({
        status: 'error',
        errorMessage: getApiErrorMessage(error, '个人资料加载失败，请稍后重试'),
      })
    }
  },

  handleNicknameInput(event: WechatMiniprogram.Input) {
    this.setData({ nickname: event.detail.value })
  },

  handleAvatarChoose(event: WechatMiniprogram.CustomEvent<{ avatarUrl?: string }>) {
    const selectedAvatarPath = String(event.detail.avatarUrl || '').trim()
    if (!selectedAvatarPath) return
    this.setData({
      selectedAvatarPath,
      avatarUrl: selectedAvatarPath,
      avatarLoadFailed: false,
    })
  },

  handleAvatarError() {
    this.setData({ avatarLoadFailed: true })
  },

  async handleSave() {
    if (this.data.saving) return
    const nickname = String(this.data.nickname || '').trim()
    if (nickname.length < 2 || nickname.length > 24) {
      wx.showToast({ title: '昵称需为 2 至 24 个字符', icon: 'none' })
      return
    }

    this.setData({ saving: true })
    try {
      let avatarUrl = String(this.data.avatarUrl || '').trim()
      if (this.data.selectedAvatarPath) {
        avatarUrl = await uploadProfileAvatar(this.data.selectedAvatarPath)
      }
      const profile = await updateProfile({ nickname, avatarUrl })
      this.setData({
        profile,
        nickname: profile.nickname,
        avatarUrl: profile.avatarUrl,
        avatarLoadFailed: false,
        selectedAvatarPath: '',
      })
      wx.showToast({ title: '资料已保存', icon: 'success' })
    } catch (error) {
      wx.showToast({
        title: getApiErrorMessage(error, '个人资料保存失败'),
        icon: 'none',
      })
    } finally {
      this.setData({ saving: false })
    }
  },

  handlePhoneLogin(event: WechatMiniprogram.CustomEvent<{ code?: string }>) {
    const phoneCode = String(event.detail.code || '').trim()
    if (!phoneCode) {
      showPhoneAuthorizationRequired()
      return
    }
    void this.performLogin(phoneCode)
  },

  async performLogin(phoneCode: string) {
    if (this.data.loginLoading) return
    this.setData({ loginLoading: true })
    try {
      await loginWithWechat(phoneCode)
      await this.loadData()
      wx.showToast({ title: '登录成功', icon: 'success' })
    } catch (error) {
      wx.showToast({
        title: getApiErrorMessage(error, '登录失败，请稍后重试'),
        icon: 'none',
      })
    } finally {
      this.setData({ loginLoading: false })
    }
  },

  handleLogout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后，本机将不再显示账户资料与交易信息。',
      confirmText: '退出',
      success: (result) => {
        if (!result.confirm) return
        clearAuthSession()
        this.setData({
          status: 'login',
          profile: null,
          nickname: '',
          avatarUrl: '',
          avatarLoadFailed: false,
          selectedAvatarPath: '',
        })
      },
    })
  },

  handleRetry() {
    void this.loadData()
  },
})
