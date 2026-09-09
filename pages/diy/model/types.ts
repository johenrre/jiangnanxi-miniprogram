import type { DiyMaterial } from '@/api/index'

export interface MaterialGroup {
  key: string
  name: string
  initial: string
  activeIndex: number
  activeMaterial: DiyMaterial
  materials: DiyMaterial[]
  sizeLabel: string
  priceLabel: string
  fitText: string
  usedCount: number
  hasPreviousSize: boolean
  hasNextSize: boolean
}

export interface DiyBead {
  uid: string
  materialId: string
  name: string
  category: string
  sizeMm: number
  stringingWidthMm: number | null
  stringingPosition: 'center' | 'top'
  stringingOffsetMm: number
  price: number
  displayImageUrl: string
  canvasImageUrl: string
  imageScale: number
  isIrregular: boolean
  layer: number
  x: number
  y: number
  rotation: number
}

export interface BeadPosition {
  uid: string
  x: number
  y: number
  rotation: number
  isSleeping: boolean
}

export interface RingTarget {
  uid: string
  x: number
  y: number
  rotation: number
  angle: number
}

export interface EditorSnapshot {
  beads: DiyBead[]
  isStrung: boolean
}

export interface TouchPoint {
  x: number
  y: number
  timestamp: number
}
