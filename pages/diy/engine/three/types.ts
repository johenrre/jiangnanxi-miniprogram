export type ThreeNamespace = Record<string, any>

export type DiyWebglCanvas = WechatMiniprogram.Canvas & {
  width: number
  height: number
  createImage(): WechatMiniprogram.Image
}

export interface EditorOrigin {
  centerX: number
  centerY: number
  radius: number
}

export interface BeadDisplaySize {
  width: number
  height: number
  anchorX: number
  anchorY: number
}

export interface TextureAsset {
  source: string
  status: 'loading' | 'ready' | 'error'
  texture: any | null
  width: number
  height: number
  ready: Promise<boolean>
}
