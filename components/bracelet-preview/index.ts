import type { DesignPreviewMaterial } from '@/api/index'
import { getInwardFacingRotation } from '@/utils/bracelet-orientation'
import { resolveCanvasImageUrl } from '@/utils/material-image'
import { getMaterialRenderWidthMm } from '@/utils/material-render-geometry'

interface PreviewBead {
  key: string
  imageUrl: string
  imageClass: string
  imageMode: 'aspectFit' | 'widthFix'
  wrapperStyle: string
  rotatorStyle: string
  imageStyle: string
  fallbackStyle: string
}

interface PreviewLayout {
  beads: PreviewBead[]
  physicalSize: number
  previewScale: number
}

function toFiniteNumber(value: unknown, fallback: number): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function resolveMaterial(
  materialId: string,
  materials: Record<string, DesignPreviewMaterial>,
): DesignPreviewMaterial {
  return materials[materialId]
    || materials[`dynamic_${materialId}`]
    || {
      id: materialId,
      name: '未知珠材',
      size: 11,
      imageUrl: '',
      canvasImageUrl: '',
      variants: [],
      stringingWidthMm: null,
      stringingPosition: 'center',
      stringingOffsetMm: 0,
      imageScale: 1,
      isIrregular: false,
      layer: 20,
      price: 0,
    }
}

function getStringingWidthMm(material: DesignPreviewMaterial): number {
  const explicitWidth = Number(material.stringingWidthMm)
  return Number.isFinite(explicitWidth) && explicitWidth > 0
    ? explicitWidth
    : Math.max(0, material.size)
}

function getFallbackStyle(materialId: string): string {
  const hash = materialId.split('').reduce((total, character) => (
    total + character.charCodeAt(0)
  ), 0)
  const hue = hash % 360
  return `background:radial-gradient(circle at 34% 30%,hsl(${hue} 42% 94%),hsl(${hue} 34% 68%) 58%,hsl(${hue} 28% 48%));`
}

function buildPreviewLayout(
  pattern: unknown[],
  materials: Record<string, DesignPreviewMaterial>,
  beadSize: number,
  containerSize: number,
): PreviewLayout {
  const materialIds = pattern.map((item) => String(item || '').trim()).filter(Boolean)
  if (materialIds.length === 0) {
    return { beads: [], physicalSize: containerSize, previewScale: 1 }
  }

  const resolvedMaterials = materialIds.map((materialId) => resolveMaterial(materialId, materials))
  const baseScale = Math.max(0.4, beadSize / 11)
  const materialCount = Math.max(1, resolvedMaterials.length)
  const circumference = resolvedMaterials.reduce((total, material) => (
    total + getStringingWidthMm(material)
  ), 0)
  const firstSize = resolvedMaterials[0]?.size || beadSize
  const radius = materialCount >= 3
    ? circumference / (2 * materialCount * Math.sin(Math.PI / materialCount)) * baseScale
    : firstSize * baseScale
  const maxDiameter = resolvedMaterials.reduce((largest, material) => (
    Math.max(largest, material.size * baseScale)
  ), beadSize)
  const physicalSize = Math.max(1, (radius * 2 + maxDiameter) * 1.05)
  const previewScale = containerSize / physicalSize
  let accumulatedAngle = 0

  const beads = resolvedMaterials.map((material, index) => {
    const materialId = materialIds[index]
    const arcLength = getStringingWidthMm(material)
    const angleSpan = circumference > 0
      ? arcLength / circumference * Math.PI * 2
      : Math.PI * 2 / materialIds.length
    const angle = accumulatedAngle + angleSpan / 2 - Math.PI / 2
    accumulatedAngle += angleSpan

    const renderWidth = getMaterialRenderWidthMm({
      sizeMm: material.size,
      stringingWidthMm: material.stringingWidthMm,
      stringingPosition: material.stringingPosition,
      isIrregular: material.isIrregular,
    }) * baseScale
    const stringingRadius = radius + material.stringingOffsetMm * baseScale
    const anchorY = material.stringingPosition === 'top'
      ? getStringingWidthMm(material) * baseScale / 2
      : renderWidth / 2
    const centerX = physicalSize / 2 + Math.cos(angle) * stringingRadius
    const centerY = physicalSize / 2 + Math.sin(angle) * stringingRadius
    const left = centerX - renderWidth / 2
    const top = centerY - anchorY
    const rotation = getInwardFacingRotation(angle)
    // Center-strung irregular materials use their threading width. When it is
    // absent, getMaterialRenderWidthMm keeps the existing size fallback.
    const usesAccessoryLayout = material.isIrregular
    const usesTopAnchor = material.stringingPosition === 'top'
    const imageMode: PreviewBead['imageMode'] = usesAccessoryLayout ? 'widthFix' : 'aspectFit'
    const variants = material.variants.length > 0 ? material.variants : [material.imageUrl]
    const imageUrl = resolveCanvasImageUrl({
      imageUrl: variants[index % variants.length] || material.imageUrl,
      canvasImageUrl: material.canvasImageUrl,
    })

    return {
      key: `${materialId}_${index}`,
      imageUrl,
      imageClass: [
        'bracelet-preview__image',
        usesAccessoryLayout ? 'bracelet-preview__image--accessory' : '',
        usesAccessoryLayout && usesTopAnchor
          ? 'bracelet-preview__image--accessory-top'
          : '',
        usesAccessoryLayout && !usesTopAnchor
          ? 'bracelet-preview__image--accessory-center'
          : '',
      ].filter(Boolean).join(' '),
      imageMode,
      wrapperStyle: [
        `width:${renderWidth}px`,
        `height:${renderWidth}px`,
        `left:${left}px`,
        `top:${top}px`,
        `z-index:${Math.round(material.layer * 10000 + centerY)}`,
      ].join(';'),
      rotatorStyle: [
        `transform-origin:${renderWidth / 2}px ${anchorY}px`,
        `transform:rotate(${rotation}rad)`,
      ].join(';'),
      imageStyle: usesAccessoryLayout && !usesTopAnchor
        ? 'transform:translateY(-50%);'
        : '',
      fallbackStyle: getFallbackStyle(materialId),
    }
  })

  return { beads, physicalSize, previewScale }
}

Component({
  properties: {
    pattern: {
      type: Array,
      value: [],
    },
    materials: {
      type: Object,
      value: {},
    },
    beadSize: {
      type: Number,
      value: 11,
    },
    containerSize: {
      type: Number,
      value: 176,
    },
    preserveOnPageHide: {
      type: Boolean,
      value: false,
    },
  },

  data: {
    pageActive: true,
    beads: [] as PreviewBead[],
    physicalSize: 0,
    previewScale: 1,
  },

  pageLifetimes: {
    show() {
      if (this.data.pageActive) return
      this.setData({ pageActive: true }, () => this.rebuildPreview())
    },
    hide() {
      if (this.properties.preserveOnPageHide) return
      if (!this.data.pageActive && this.data.beads.length === 0) return
      // A cart or design list can contain hundreds of bead <image> nodes.
      // Remove them while the parent page is hidden so the DIY editor does
      // not compete with invisible preview layers for decode/GPU resources.
      this.setData({ pageActive: false, beads: [] })
    },
  },

  observers: {
    'pattern, materials, beadSize, containerSize'() {
      this.rebuildPreview()
    },
  },

  methods: {
    rebuildPreview() {
      if (!this.data.pageActive) return
      const pattern = Array.isArray(this.properties.pattern) ? this.properties.pattern : []
      const materials = this.properties.materials && typeof this.properties.materials === 'object'
        ? this.properties.materials as Record<string, DesignPreviewMaterial>
        : {}
      const beadSize = Math.max(1, toFiniteNumber(this.properties.beadSize, 11))
      const containerSize = Math.max(1, toFiniteNumber(this.properties.containerSize, 176))
      const layout = buildPreviewLayout(pattern, materials, beadSize, containerSize)
      this.setData(layout)
    },
  },
})
