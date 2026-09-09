const DIY_WRIST_STORAGE_KEY = 'stone_diy_wrist_cm_v1'
const MINIMUM_WRIST_CM = 13
const MAXIMUM_WRIST_CM = 21

export type DiyWristStrands = 1 | 2

export interface DiyWristPreference {
  wristCm: number
  strands: DiyWristStrands
}

function normalizeStrands(value: unknown): DiyWristStrands {
  return Number(value) === 2 ? 2 : 1
}

export function loadDiyWristPreference(): DiyWristPreference | null {
  try {
    const stored = wx.getStorageSync(DIY_WRIST_STORAGE_KEY) as unknown
    const source = stored && typeof stored === 'object' && !Array.isArray(stored)
      ? stored as Partial<DiyWristPreference>
      : { wristCm: Number(stored), strands: 1 }
    const strands = normalizeStrands(source.strands)
    let wristCm = Number(source.wristCm)
    if (strands === 2 && wristCm > MAXIMUM_WRIST_CM && wristCm / 2 <= MAXIMUM_WRIST_CM) {
      wristCm /= 2
    }
    if (!Number.isFinite(wristCm) || wristCm < MINIMUM_WRIST_CM || wristCm > MAXIMUM_WRIST_CM) return null
    wristCm = Math.round(wristCm * 10) / 10
    return { wristCm, strands }
  } catch {
    return null
  }
}

export function saveDiyWristPreference(
  wristCm: number,
  strands: DiyWristStrands = 1,
): void {
  if (!Number.isFinite(wristCm)) return
  try {
    wx.setStorageSync(DIY_WRIST_STORAGE_KEY, {
      wristCm,
      strands: normalizeStrands(strands),
    } satisfies DiyWristPreference)
  } catch {
    // 本地缓存不可用时不影响本次 DIY 操作。
  }
}

export function clearDiyWristPreference(): void {
  try {
    wx.removeStorageSync(DIY_WRIST_STORAGE_KEY)
  } catch {
    // 本地缓存不可用时不影响本次 DIY 操作。
  }
}
