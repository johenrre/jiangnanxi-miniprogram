import { loadDiyMaterials, type DiyMaterial } from '@/api/index'
import { BEAD_LOADING_PLACEHOLDER_PATH } from '@/pages/diy/engine/three/index'
import type { MaterialGroup } from '@/pages/diy/model/types'
import { INITIAL_MATERIAL_GROUP_LIMIT } from '@/pages/diy/page/constants'
import type { DiyPageInstance, SubcategoryTab } from '@/pages/diy/page/types'
import { formatMoney } from '@/pages/diy/page/utils'
import { appSound } from '@/services/sound'
import { resolveCanvasImageUrl } from '@/utils/material-image'

const GROUP_LIMIT_INCREMENT = 24
const FIRST_SCREEN_IMAGE_LIMIT = 10
const DEFAULT_MATERIAL_SIZE_MM = 8
const USING_MATERIALS_SUBCATEGORY_ID = '__using__'

function formatSize(value: number): string {
  return Number.isInteger(value) ? `${value}mm` : `${value.toFixed(1)}mm`
}

function formatSubcategoryLabel(category: string, subcategory: string): string {
  if (category === '水晶' && /色系$/.test(subcategory)) {
    return `${subcategory.replace(/色系$/, '')}水晶`
  }
  return subcategory
}

function buildMaterialUsageCounts(beads: Array<{ materialId: string }>): Map<string, number> {
  const counts = new Map<string, number>()
  beads.forEach((bead) => {
    const materialId = String(bead.materialId || '')
    if (materialId) counts.set(materialId, (counts.get(materialId) || 0) + 1)
  })
  return counts
}

function findDefaultSizeIndex(materials: DiyMaterial[]): number {
  return materials.reduce((closestIndex, material, index) => {
    const closestDistance = Math.abs(
      materials[closestIndex].sizeMm - DEFAULT_MATERIAL_SIZE_MM,
    )
    const currentDistance = Math.abs(material.sizeMm - DEFAULT_MATERIAL_SIZE_MM)
    return currentDistance < closestDistance ? index : closestIndex
  }, 0)
}

function buildMaterialGroups(
  materials: DiyMaterial[],
  selectedSizeByGroup: Record<string, number>,
  usageCounts: ReadonlyMap<string, number>,
): MaterialGroup[] {
  const grouped = new Map<string, DiyMaterial[]>()
  materials.forEach((material) => {
    const groupKey = material.groupId
    const groupMaterials = grouped.get(groupKey) || []
    groupMaterials.push(material)
    grouped.set(groupKey, groupMaterials)
  })

  return Array.from(grouped.entries()).map(([key, groupMaterials]) => {
    groupMaterials.sort((left, right) => left.sizeMm - right.sizeMm)
    const defaultIndex = findDefaultSizeIndex(groupMaterials)
    const selectedIndex = Math.min(
      groupMaterials.length - 1,
      Math.max(0, selectedSizeByGroup[key] ?? defaultIndex),
    )
    selectedSizeByGroup[key] = selectedIndex
    const activeMaterial = groupMaterials[selectedIndex]
    return {
      key,
      name: activeMaterial.name,
      initial: activeMaterial.name.slice(0, 1),
      activeIndex: selectedIndex,
      activeMaterial,
      materials: groupMaterials,
      sizeLabel: formatSize(activeMaterial.sizeMm),
      priceLabel: formatMoney(activeMaterial.price),
      fitText: activeMaterial.fitText,
      usedCount: usageCounts.get(activeMaterial.id) || 0,
      hasPreviousSize: selectedIndex > 0,
      hasNextSize: selectedIndex < groupMaterials.length - 1,
    }
  })
}

export const materialPageMethods = {
  async loadMaterials(this: DiyPageInstance, forceRefresh = false): Promise<void> {
    this.firstScreenMaterialImagesReady = false
    this.setData(
      { loadingMaterials: true, materialsError: '' },
      () => this.updateEntryGate(),
    )
    try {
      const materials = await loadDiyMaterials(forceRefresh)
      this.materials = materials
      this.materialById = Object.fromEntries(materials.map((material) => [material.id, material]))
      const categoryNames = Array.from(new Set(materials.map((material) => material.category)))
      const mainCategories = categoryNames.map((category) => ({ id: category, label: category }))
      const currentCategory = categoryNames.includes(this.data.currentCategory)
        ? this.data.currentCategory
        : categoryNames[0] || ''

      this.setData({ loadingMaterials: false, mainCategories, currentCategory }, () => {
        this.rebuildMaterialView(true)
        void this.preloadFirstScreenMaterialImages()
        void this.tryApplyTemplateDesign()
        this.updateEntryGate()
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : '材料加载失败，请稍后重试'
      this.setData(
        { loadingMaterials: false, materialsError: message },
        () => this.updateEntryGate(),
      )
    }
  },

  async preloadFirstScreenMaterialImages(this: DiyPageInstance): Promise<void> {
    this.firstScreenMaterialImagesReady = false
    const firstScreenMaterials = this.allVisibleGroups
      .slice(0, FIRST_SCREEN_IMAGE_LIMIT)
      .map((group) => group.activeMaterial)
    const renderer = this.renderer
    if (!renderer) return
    const canvasImageUrls = Array.from(new Set([
      BEAD_LOADING_PLACEHOLDER_PATH,
      ...firstScreenMaterials
        .map(resolveCanvasImageUrl)
        .filter((source) => Boolean(source)),
    ]))
    await renderer.preloadImages(canvasImageUrls)
    if (renderer !== this.renderer) return
    this.firstScreenMaterialImagesReady = true
    this.updateEntryGate()
  },

  rebuildMaterialView(this: DiyPageInstance, resetSubcategory = false): void {
    const categoryMaterials = this.materials.filter((material) => (
      material.category === this.data.currentCategory
    ))
    const subcategoryNames = Array.from(new Set(
      categoryMaterials.map((material) => material.subcategory),
    ))
    const subcategories: SubcategoryTab[] = [
      { id: USING_MATERIALS_SUBCATEGORY_ID, label: '正在使用' },
      { id: 'all', label: '全部' },
      ...subcategoryNames.map((subcategory) => ({
        id: subcategory,
        label: formatSubcategoryLabel(this.data.currentCategory, subcategory),
      })),
    ]
    const currentSubcategory = resetSubcategory
      || !subcategories.some((subcategory) => subcategory.id === this.data.currentSubcategory)
      ? 'all'
      : this.data.currentSubcategory
    const query = this.data.searchQuery.trim().toLowerCase()
    const usingMaterialIds = currentSubcategory === USING_MATERIALS_SUBCATEGORY_ID
      ? new Set(this.beads.map((bead) => bead.materialId))
      : null
    const filterSource = usingMaterialIds ? this.materials : categoryMaterials
    const filteredMaterials = filterSource.filter((material) => {
      const matchesSubcategory = usingMaterialIds
        ? usingMaterialIds.has(material.id)
        : currentSubcategory === 'all' || material.subcategory === currentSubcategory
      const matchesSearch = !query
        || material.name.toLowerCase().includes(query)
        || material.materialType.toLowerCase().includes(query)
      return matchesSubcategory && matchesSearch
    })

    this.visibleGroupLimit = INITIAL_MATERIAL_GROUP_LIMIT
    this.allVisibleGroups = buildMaterialGroups(
      filteredMaterials,
      this.selectedSizeByGroup,
      buildMaterialUsageCounts(this.beads),
    )
    this.setData({ subcategories, currentSubcategory })
    this.updateVisibleMaterialGroups()
  },

  updateMaterialUsageCounts(this: DiyPageInstance): void {
    if (this.data.currentSubcategory === USING_MATERIALS_SUBCATEGORY_ID) {
      this.rebuildMaterialView(false)
      return
    }
    const usageCounts = buildMaterialUsageCounts(this.beads)
    this.allVisibleGroups = this.allVisibleGroups.map((group) => ({
      ...group,
      usedCount: usageCounts.get(group.activeMaterial.id) || 0,
    }))
    this.updateVisibleMaterialGroups()
  },

  updateVisibleMaterialGroups(this: DiyPageInstance): void {
    this.setData({
      materialGroups: this.allVisibleGroups.slice(0, this.visibleGroupLimit),
      hasMoreMaterials: this.visibleGroupLimit < this.allVisibleGroups.length,
    })
  },

  handleCategoryChange(
    this: DiyPageInstance,
    event: WechatMiniprogram.CustomEvent<{ id: string }>,
  ): void {
    const category = String(event.detail.id || '')
    if (!category || category === this.data.currentCategory) return
    this.setData({ currentCategory: category, searchQuery: '' })
    this.rebuildMaterialView(true)
  },

  handleSubcategoryChange(
    this: DiyPageInstance,
    event: WechatMiniprogram.CustomEvent<{ id: string }>,
  ): void {
    const subcategory = String(event.detail.id || '')
    if (!subcategory || subcategory === this.data.currentSubcategory) return
    this.setData({ currentSubcategory: subcategory })
    this.rebuildMaterialView(false)
  },

  handleSearchInput(
    this: DiyPageInstance,
    event: WechatMiniprogram.CustomEvent<{ value: string }>,
  ): void {
    this.setData({ searchQuery: event.detail.value })
    this.rebuildMaterialView(false)
  },

  handleMaterialSizeChange(
    this: DiyPageInstance,
    event: WechatMiniprogram.CustomEvent<{ key: string; direction: number }>,
  ): void {
    const groupKey = String(event.detail.key || '')
    const direction = Number(event.detail.direction)
    const group = this.allVisibleGroups.find((candidate) => candidate.key === groupKey)
    if (!group || !Number.isFinite(direction)) return
    const nextIndex = Math.min(
      group.materials.length - 1,
      Math.max(0, group.activeIndex + direction),
    )
    if (nextIndex === group.activeIndex) return
    this.selectedSizeByGroup[groupKey] = nextIndex
    this.allVisibleGroups = buildMaterialGroups(
      this.allVisibleGroups.flatMap((candidate) => candidate.materials),
      this.selectedSizeByGroup,
      buildMaterialUsageCounts(this.beads),
    )
    this.updateVisibleMaterialGroups()
  },

  handleMaterialTap(
    this: DiyPageInstance,
    event: WechatMiniprogram.CustomEvent<{ id: string }>,
  ): void {
    const materialId = String(event.detail.id || '')
    const material = this.materialById[materialId]
    if (!material) {
      wx.showToast({ title: '材料不存在，请刷新', icon: 'none' })
      return
    }
    if (this.addMaterialToBracelet(material)) {
      appSound.play('impact', 0.34)
    }
  },

  handleMaterialsScrollLower(this: DiyPageInstance): void {
    if (!this.data.hasMoreMaterials) return
    this.visibleGroupLimit += GROUP_LIMIT_INCREMENT
    this.updateVisibleMaterialGroups()
  },

  handleRetryMaterials(this: DiyPageInstance): void {
    void this.loadMaterials(true)
  },
}
