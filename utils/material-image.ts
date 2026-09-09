export interface CanvasImageSource {
  imageUrl?: string | null
  displayImageUrl?: string | null
  canvasImageUrl?: string | null
}

export function resolveCanvasImageUrl(source: CanvasImageSource): string {
  const canvasImageUrl = String(source.canvasImageUrl || '').trim()
  if (canvasImageUrl) return canvasImageUrl
  return String(source.displayImageUrl || source.imageUrl || '').trim()
}
