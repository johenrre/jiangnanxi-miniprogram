import type { DiyBead } from '@/pages/diy/model/types'

const STORAGE_KEY = 'stone_diy_settlement_preview_v1'
const MAXIMUM_AGE_MS = 2 * 60 * 60 * 1000

export interface DiySettlementPreviewSnapshot {
  beads: DiyBead[]
  createdAt: number
}

function normalizeSnapshot(value: unknown): DiySettlementPreviewSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Partial<DiySettlementPreviewSnapshot>
  if (!Array.isArray(source.beads) || source.beads.length === 0) return null
  const createdAt = Number(source.createdAt)
  if (!Number.isFinite(createdAt) || Date.now() - createdAt > MAXIMUM_AGE_MS) return null
  return {
    beads: source.beads,
    createdAt,
  }
}

export function setDiySettlementPreview(snapshot: Omit<DiySettlementPreviewSnapshot, 'createdAt'>): void {
  wx.setStorageSync(STORAGE_KEY, {
    ...snapshot,
    createdAt: Date.now(),
  } satisfies DiySettlementPreviewSnapshot)
}

export function getDiySettlementPreview(): DiySettlementPreviewSnapshot | null {
  const snapshot = normalizeSnapshot(wx.getStorageSync(STORAGE_KEY) as unknown)
  if (!snapshot) wx.removeStorageSync(STORAGE_KEY)
  return snapshot
}

export function clearDiySettlementPreview(): void {
  wx.removeStorageSync(STORAGE_KEY)
}
