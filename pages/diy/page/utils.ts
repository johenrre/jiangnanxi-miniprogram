import type { WindowMetrics } from '@/pages/diy/page/types'

export function formatMoney(value: number): string {
  const fixed = value.toFixed(2)
  return fixed.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')
}

export function normalizeAngleDelta(angle: number): number {
  let normalized = angle
  while (normalized > Math.PI) normalized -= Math.PI * 2
  while (normalized < -Math.PI) normalized += Math.PI * 2
  return normalized
}

export function getWindowMetrics(): WindowMetrics {
  const modernWx = wx as unknown as { getWindowInfo(): WindowMetrics }
  return modernWx.getWindowInfo()
}
