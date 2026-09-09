import {
  clearAuthSession,
  createAddress,
  deleteAddress,
  getApiErrorMessage,
  hasAuthSession,
  isApiUnauthorized,
  loadAddresses,
  setDefaultAddress,
  updateAddress,
  type AddressInput,
  type AddressItem,
} from '@/api/index'
import { ensureAuthenticated } from '@/services/auth-gate'

type AddressPageStatus = 'login' | 'loading' | 'ready' | 'empty' | 'error'

function createEmptyForm(): AddressInput {
  return {
    receiverName: '',
    receiverPhone: '',
    province: '',
    city: '',
    district: '',
    detail: '',
    isDefault: false,
  }
}

function addressToForm(address: AddressItem): AddressInput {
  return {
    receiverName: address.receiverName,
    receiverPhone: address.receiverPhone,
    province: address.province,
    city: address.city,
    district: address.district,
    detail: address.detail,
    isDefault: address.isDefault,
  }
}

function validateAddress(form: AddressInput): string {
  if (form.receiverName.trim().length < 2 || form.receiverName.trim().length > 20) {
    return '收货人姓名需为 2 至 20 个字符'
  }
  if (!/^\d{6,20}$/.test(form.receiverPhone.replace(/[^0-9]/g, ''))) {
    return '请输入正确的联系电话'
  }
  if (!form.province || !form.city || !form.district) return '请选择完整的省市区'
  if (form.detail.trim().length < 5 || form.detail.trim().length > 200) {
    return '详细地址需为 5 至 200 个字符'
  }
  return ''
}

Page({
  data: {
    status: 'loading' as AddressPageStatus,
    addresses: [] as AddressItem[],
    errorMessage: '',
    formVisible: false,
    editingAddressId: '',
    form: createEmptyForm(),
    region: [] as string[],
    regionText: '',
    submitting: false,
  },

  onShow() {
    if (!hasAuthSession()) {
      this.setData({ status: 'login', addresses: [], formVisible: false })
      return
    }
    if (this.data.status !== 'ready') void this.loadData()
  },

  async loadData() {
    this.setData({ status: 'loading', errorMessage: '' })
    try {
      const addresses = await loadAddresses()
      this.setData({
        addresses,
        status: addresses.length > 0 ? 'ready' : 'empty',
      })
    } catch (error) {
      if (isApiUnauthorized(error)) {
        clearAuthSession()
        this.setData({ addresses: [], status: 'login', formVisible: false })
        return
      }
      this.setData({
        addresses: [],
        status: 'error',
        errorMessage: getApiErrorMessage(error, '收货地址加载失败，请稍后重试'),
      })
    }
  },

  handleAddAddress() {
    this.setData({
      formVisible: true,
      editingAddressId: '',
      form: createEmptyForm(),
      region: [],
      regionText: '',
    })
  },

  handleEditAddress(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    const address = this.data.addresses.find((item) => item.id === id)
    if (!address) return
    this.setData({
      formVisible: true,
      editingAddressId: id,
      form: addressToForm(address),
      region: [address.province, address.city, address.district],
      regionText: [address.province, address.city, address.district].filter(Boolean).join(' '),
    })
  },

  handleCloseForm() {
    if (this.data.submitting) return
    this.setData({ formVisible: false })
  },

  handleNoop() {},

  handleFieldInput(event: WechatMiniprogram.Input) {
    const field = String(event.currentTarget.dataset.field || '')
    if (!['receiverName', 'receiverPhone', 'detail'].includes(field)) return
    this.setData({ [`form.${field}`]: event.detail.value })
  },

  handleRegionChange(event: WechatMiniprogram.CustomEvent<{ value: string[] }>) {
    const region = Array.isArray(event.detail.value) ? event.detail.value : []
    this.setData({
      region,
      regionText: region.filter(Boolean).join(' '),
      'form.province': region[0] || '',
      'form.city': region[1] || '',
      'form.district': region[2] || '',
    })
  },

  handleImportWechatAddress() {
    wx.chooseAddress({
      success: (address) => {
        const region = [address.provinceName, address.cityName, address.countyName]
          .map((item) => String(item || '').trim())
          .filter(Boolean)
        this.setData({
          region,
          regionText: region.join(' '),
          'form.receiverName': String(address.userName || '').trim(),
          'form.receiverPhone': String(address.telNumber || '').trim(),
          'form.province': String(address.provinceName || '').trim(),
          'form.city': String(address.cityName || '').trim(),
          'form.district': String(address.countyName || '').trim(),
          'form.detail': String(address.detailInfo || '').trim(),
        })
        wx.showToast({ title: '微信地址已填入', icon: 'success' })
      },
      fail: (error) => {
        const message = String(error.errMsg || '')
        if (message.includes('cancel')) return
        wx.showModal({
          title: '无法读取微信地址',
          content: '请在微信中允许使用通讯地址，或继续手动填写。',
          confirmText: '打开设置',
          cancelText: '手动填写',
          success: (result) => {
            if (result.confirm) wx.openSetting()
          },
        })
      },
    })
  },

  handleDefaultChange(event: WechatMiniprogram.CustomEvent<{ value: boolean }>) {
    this.setData({ 'form.isDefault': event.detail.value === true })
  },

  async handleSaveAddress() {
    if (this.data.submitting) return
    const message = validateAddress(this.data.form)
    if (message) {
      wx.showToast({ title: message, icon: 'none' })
      return
    }

    this.setData({ submitting: true })
    try {
      if (this.data.editingAddressId) {
        await updateAddress(this.data.editingAddressId, this.data.form)
      } else {
        await createAddress(this.data.form)
      }
      this.setData({ formVisible: false })
      await this.loadData()
      wx.showToast({ title: '地址已保存', icon: 'success' })
    } catch (error) {
      wx.showToast({
        title: getApiErrorMessage(error, '地址保存失败'),
        icon: 'none',
      })
    } finally {
      this.setData({ submitting: false })
    }
  },

  handleDeleteAddress(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    if (!id) return
    wx.showModal({
      title: '删除地址',
      content: '确定删除这个收货地址吗？',
      confirmText: '删除',
      success: (result) => {
        if (!result.confirm) return
        void this.removeAddress(id)
      },
    })
  },

  async removeAddress(id: string) {
    try {
      await deleteAddress(id)
      await this.loadData()
      wx.showToast({ title: '地址已删除', icon: 'success' })
    } catch (error) {
      wx.showToast({
        title: getApiErrorMessage(error, '地址删除失败'),
        icon: 'none',
      })
    }
  },

  async handleSetDefault(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    const address = this.data.addresses.find((item) => item.id === id)
    if (!address || address.isDefault) return
    try {
      await setDefaultAddress(address)
      await this.loadData()
      wx.showToast({ title: '已设为默认地址', icon: 'success' })
    } catch (error) {
      wx.showToast({
        title: getApiErrorMessage(error, '默认地址设置失败'),
        icon: 'none',
      })
    }
  },

  handleRetry() {
    void this.loadData()
  },

  async handleGoLogin() {
    if (!(await ensureAuthenticated(this, {
      content: '登录后可管理常用收货地址。',
    }))) return
    await this.loadData()
  },
})
