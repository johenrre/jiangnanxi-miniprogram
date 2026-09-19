import type { DiyMaterial } from '@/api/index'
import type {
  BraceletRenderer,
  DiyCanvas,
  EditorOrigin,
} from '@/pages/diy/engine/renderer'
import type {
  DiyBead,
  EditorSnapshot,
  MaterialGroup,
  RingTarget,
  TouchPoint,
} from '@/pages/diy/model/types'
import type { DiyDesignSnapshot } from '@/services/diy-navigation'
import type { DiyWristStrands } from '@/services/diy-wrist-preference'

export interface CategoryTab {
  id: string
  label: string
}

export interface SubcategoryTab {
  id: string
  label: string
}

export interface CanvasQueryResult {
  node?: DiyCanvas
  width?: number
  height?: number
  left?: number
  top?: number
}

export interface WindowMetrics {
  statusBarHeight?: number
  pixelRatio: number
}

export interface RingAnimation {
  startTime: number
  duration: number
  items: Array<{
    bead: DiyBead
    fromX: number
    fromY: number
    fromRotation: number
    targetX: number
    targetY: number
    targetRotation: number
  }>
}

export interface RingLayout {
  centerX: number
  centerY: number
  radiusScale: number
  displayScale: number
}

export interface DragState {
  uid: string | null
  bead: DiyBead | null
  mode: 'ring-bead' | 'ring-rotate'
  latestPoint: TouchPoint
  renderedPoint: TouchPoint
  snapshot: EditorSnapshot
  originalIndex: number
  insertionIndex: number
  reflowTargets: Map<string, RingTarget> | null
}

export interface DiyPageData {
  statusBarHeight: number
  navigationHeight: number
  diyPageTitle: string
  entryMaskVisible: boolean
  entryMaskLeaving: boolean
  entryStatusText: string
  entryStatusDetail: string
  entryErrorText: string
  canvasReady: boolean
  loadingMaterials: boolean
  materialsError: string
  mainCategories: CategoryTab[]
  currentCategory: string
  subcategories: SubcategoryTab[]
  currentSubcategory: string
  searchQuery: string
  materialGroups: MaterialGroup[]
  hasMoreMaterials: boolean
  beadCount: number
  totalPriceText: string
  perimeterText: string
  wristMessage: string
  wristFitWarningVisible: boolean
  wristFitWarningText: string
  canUndo: boolean
  canSave: boolean
  showSaveNameDialog: boolean
  designNameDraft: string
  savingDesign: boolean
  showSizeGuide: boolean
  showGuide: boolean
  showWristPicker: boolean
  selectedWristCm: number | null
  selectedWristStrands: DiyWristStrands
}

export interface DiyPageCustom {
  materials: DiyMaterial[]
  materialById: Record<string, DiyMaterial>
  selectedSizeByGroup: Record<string, number>
  allVisibleGroups: MaterialGroup[]
  visibleGroupLimit: number
  beads: DiyBead[]
  history: EditorSnapshot[]
  uidSequence: number
  canvas: DiyCanvas | null
  renderer: BraceletRenderer | null
  canvasLeft: number
  canvasTop: number
  canvasWidth: number
  canvasHeight: number
  frameRequestId: number | null
  lastFrameTimestamp: number
  renderDirty: boolean
  pageVisible: boolean
  ringAnimation: RingAnimation | null
  editorRingLayoutCache: RingLayout | null
  ringRotationOffset: number
  ringAngularVelocity: number
  ringElasticScale: number
  ringElasticVelocity: number
  ringLayoutDirty: boolean
  editorOrigin: EditorOrigin | null
  dragState: DragState | null
  firstScreenMaterialImagesReady: boolean
  firstCanvasFrameRendered: boolean
  entryMaskOpenedAt: number
  entryMaskRevealTimer: number | null
  entryMaskRemovalTimer: number | null
  entryMaskTimeoutTimer: number | null
  wristFitWarningTimer: number | null
  audioWarmupTimer: number | null
  skipEntrySizeGuide: boolean
  templateDesignSequence: number
  pendingTemplateDesign: DiyDesignSnapshot | null
  expectsTemplateDesign: boolean
  templateDesignApplying: boolean
  templateDesignApplied: boolean
  acceptTemplateDesign(design: DiyDesignSnapshot): void
  loadMaterials(forceRefresh?: boolean): Promise<void>
  loadDiyPresentation(): Promise<void>
  preloadFirstScreenMaterialImages(): Promise<void>
  openEntryMask(): void
  updateEntryGate(): void
  revealEntryMask(): void
  clearEntryTimers(): void
  handleRetryEntry(): void
  initializeCanvas(): void
  disposeCanvas(): void
  rebuildMaterialView(resetSubcategory?: boolean): void
  updateVisibleMaterialGroups(): void
  updateMaterialUsageCounts(): void
  createBead(material: DiyMaterial): DiyBead
  canAddMaterialWithinLimit(material: DiyMaterial): boolean
  getWristFitExceededMinimum(): number | null
  showWristFitWarning(message?: string): void
  showCurrentWristFitWarning(): boolean
  tryApplyTemplateDesign(): Promise<void>
  addMaterialToBracelet(material: DiyMaterial, recordHistory?: boolean): boolean
  updateEditorSummary(): void
  scheduleRender(): void
  requestAnimationFrame(): void
  cancelAnimationFrame(): void
  handleAnimationFrame(timestamp: number): void
  renderEditor(): void
  invalidateRingLayoutCaches(): void
  startRingAnimation(duration?: number): void
  stepRingAnimation(timestamp: number): boolean
  stepRingDragReflow(deltaMs: number): boolean
  stepRingMotion(deltaMs: number): boolean
  resetRingMotion(): void
  updateRingDragReflow(point: TouchPoint): void
  applyRingTargets(targets: RingTarget[]): void
  applyCurrentRingLayout(beads: DiyBead[]): void
  getEditorRingLayout(): RingLayout
  buildCurrentRingTargets(beads: DiyBead[]): RingTarget[]
  createSnapshot(): EditorSnapshot
  pushHistory(snapshot?: EditorSnapshot): void
  restoreSnapshot(snapshot: EditorSnapshot): void
  removeBead(uid: string, historySnapshot?: EditorSnapshot, recordHistory?: boolean): void
  getCanvasTouchPoint(event: WechatMiniprogram.TouchEvent, useChangedTouches?: boolean): TouchPoint | null
  findBeadAtPoint(point: TouchPoint): DiyBead | null
  isPointOutsideRemovalBoundary(point: TouchPoint): boolean
  finishTouch(event: WechatMiniprogram.TouchEvent): void
  handleCategoryChange(event: WechatMiniprogram.CustomEvent<{ id: string }>): void
  handleSubcategoryChange(event: WechatMiniprogram.CustomEvent<{ id: string }>): void
  handleSearchInput(event: WechatMiniprogram.CustomEvent<{ value: string }>): void
  handleMaterialSizeChange(event: WechatMiniprogram.CustomEvent<{ key: string; direction: number }>): void
  handleMaterialTap(event: WechatMiniprogram.CustomEvent<{ id: string }>): void
  handleMaterialsScrollLower(): void
  handleRetryMaterials(): void
  handleUndo(): void
  handleClear(): void
  handleCanvasTouchStart(event: WechatMiniprogram.TouchEvent): void
  applyPendingDragPoint(): void
  handleCanvasTouchMove(event: WechatMiniprogram.TouchEvent): void
  handleCanvasTouchEnd(event: WechatMiniprogram.TouchEvent): void
  handleCanvasTouchCancel(event: WechatMiniprogram.TouchEvent): void
  handleOpenSizeGuide(): void
  handleCloseSizeGuide(): void
  handleOpenGuide(): void
  handleCloseGuide(): void
  handleOpenWristPicker(): void
  handleCloseWristPicker(): void
  handleConfirmWrist(event: WechatMiniprogram.CustomEvent<{
    value: number
    measuredWristCm: number
    strands: DiyWristStrands
  }>): void
  handleClearWrist(): void
  handleSaveDesign(): Promise<void>
  handleDesignNameInput(event: WechatMiniprogram.CustomEvent<{ value: string }>): void
  handleCloseSaveName(): void
  handleConfirmSaveDesign(): Promise<void>
  handleAddToCart(): Promise<void>
}

export type DiyPageInstance = WechatMiniprogram.Page.Instance<DiyPageData, DiyPageCustom>
