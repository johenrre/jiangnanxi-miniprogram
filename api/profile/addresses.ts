import { requestApi, toText } from '@/api/client'

interface RawAddress {
  id?: number | string
  name?: string
  receiverName?: string
  userName?: string
  phone?: string
  receiverPhone?: string
  telNumber?: string
  province?: string
  provinceName?: string
  city?: string
  cityName?: string
  district?: string
  countyName?: string
  address?: string
  detail?: string
  detailInfo?: string
  is_default?: boolean | number
  isDefault?: boolean
}

interface RawAddressResult {
  address?: RawAddress
}

export interface AddressItem {
  id: string
  receiverName: string
  receiverPhone: string
  province: string
  city: string
  district: string
  detail: string
  fullAddress: string
  isDefault: boolean
}

export interface AddressInput {
  receiverName: string
  receiverPhone: string
  province: string
  city: string
  district: string
  detail: string
  isDefault: boolean
}

function normalizeAddress(source: RawAddress): AddressItem {
  const province = toText(source.province || source.provinceName)
  const city = toText(source.city || source.cityName)
  const district = toText(source.district || source.countyName)
  const detail = toText(source.detail || source.address || source.detailInfo)
  return {
    id: toText(source.id),
    receiverName: toText(source.receiverName || source.name || source.userName),
    receiverPhone: toText(source.receiverPhone || source.phone || source.telNumber),
    province,
    city,
    district,
    detail,
    fullAddress: [province, city, district, detail].filter(Boolean).join(''),
    isDefault: source.isDefault === true || source.is_default === true || source.is_default === 1,
  }
}

function toBackendAddress(input: AddressInput): {
  name: string
  phone: string
  province: string
  city: string
  district: string
  address: string
  is_default: boolean
} {
  return {
    name: input.receiverName.trim(),
    phone: input.receiverPhone.replace(/[^0-9]/g, ''),
    province: input.province.trim(),
    city: input.city.trim(),
    district: input.district.trim(),
    address: input.detail.trim(),
    is_default: input.isDefault,
  }
}

export async function loadAddresses(): Promise<AddressItem[]> {
  const result = await requestApi<RawAddress[] | { list?: RawAddress[] }>({
    path: '/api/address/list',
  })
  const list = Array.isArray(result) ? result : Array.isArray(result.list) ? result.list : []
  return list.map(normalizeAddress)
}

export async function createAddress(input: AddressInput): Promise<AddressItem> {
  const result = await requestApi<RawAddressResult | RawAddress, ReturnType<typeof toBackendAddress>>({
    path: '/api/address/add',
    method: 'POST',
    data: toBackendAddress(input),
  })
  const wrapper = result as RawAddressResult
  return normalizeAddress(wrapper.address || result as RawAddress)
}

export async function updateAddress(id: string, input: AddressInput): Promise<void> {
  await requestApi<unknown, ReturnType<typeof toBackendAddress> & { id: string }>({
    path: '/api/address/update',
    method: 'POST',
    data: { ...toBackendAddress(input), id },
  })
}

export async function deleteAddress(id: string): Promise<void> {
  await requestApi<unknown, { id: string }>({
    path: '/api/address/delete',
    method: 'POST',
    data: { id },
  })
}

export async function setDefaultAddress(address: AddressItem): Promise<void> {
  await updateAddress(address.id, {
    receiverName: address.receiverName,
    receiverPhone: address.receiverPhone,
    province: address.province,
    city: address.city,
    district: address.district,
    detail: address.detail,
    isDefault: true,
  })
}
