import {
  getApiErrorMessage,
  loadPublicSettings,
} from '@/api/index'

type UsageGuideTabKey = 'tutorial' | 'purchase' | 'wrist' | 'bead-size'
type PurchaseNoticeStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error'
type WristMeasurementStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error'
type WristReferenceGender = 'female' | 'male'

interface UsageGuideTab {
  key: UsageGuideTabKey
  label: string
}

interface TutorialItem {
  title: string
  description: string
}

interface WristSizeReference {
  size: string
  label: string
}

const FEMALE_WRIST_SIZES: WristSizeReference[] = [
  { size: '14cm', label: '纤小手围' },
  { size: '15cm', label: '标准手围' },
  { size: '16cm', label: '偏大手围' },
  { size: '17cm', label: '大手围 / 喜宽松' },
  { size: '18cm', label: '大手围 / 喜松垂' },
  { size: '19cm', label: '超大手围' },
]

const MALE_WRIST_SIZES: WristSizeReference[] = [
  { size: '16cm', label: '偏小手围' },
  { size: '17cm', label: '标准手围' },
  { size: '18cm', label: '偏大手围' },
  { size: '19cm', label: '大手围 / 喜宽松' },
  { size: '20cm', label: '大手围 / 喜松垂' },
  { size: '21cm', label: '超大手围' },
]

const GUIDE_TABS: UsageGuideTab[] = [
  { key: 'tutorial', label: '使用教程' },
  { key: 'purchase', label: '购买须知' },
  { key: 'wrist', label: '手围测量' },
  { key: 'bead-size', label: '珠子大小' },
]

const TUTORIAL_STEPS: TutorialItem[] = [
  {
    title: '挑选素材，开始搭配',
    description: '从下方分类选择珠子与配饰，轻点加入托盘，再拖动调整位置和顺序。',
  },
  {
    title: '设置净手围',
    description: '选择净手围与佩戴圈数，系统会给出串长和松紧建议。',
  },
  {
    title: '切换珠子尺寸',
    description: '同款材质可用下方 − / + 切换毫米尺寸，快速比较体量与视觉比例。',
  },
  {
    title: '收拢成串',
    description: '点击“收拢成串”，把托盘中的散珠快速排成完整手串结构。',
  },
  {
    title: '保存或加入购物车',
    description: '满意后可先保存到“我的设计”，也可以直接加入购物车继续结算。',
  },
  {
    title: '拍照分享',
    description: '进入拍照模式生成展示图，可保存到相册或分享给朋友。',
  },
]

const TUTORIAL_SHORTCUTS: TutorialItem[] = [
  {
    title: '盲盒方案',
    description: '没有搭配思路时，随机载入设计师作品或精选客订方案，再按喜好微调。',
  },
  {
    title: '高效创作',
    description: '主石、配饰、尺寸和手围可在同一工坊内快速推演，适合连续尝试多套方案。',
  },
]

const MATERIAL_NOTES: TutorialItem[] = [
  {
    title: '真实拍摄',
    description: '珠子库优先使用实拍图，颜色、纹理和透光感更接近实物。',
  },
  {
    title: '实物光效',
    description: '屏幕仅作搭配参考，天然光下的通透、折射与光影层次通常更丰富。',
  },
  {
    title: '实拍确认',
    description: '成品发货前可按流程查看实拍确认，减少色差与预期偏差。',
  },
  {
    title: '源头筛选',
    description: '按品类、尺寸与质感整理素材，帮助你更快找到主石和配饰。',
  },
]

function normalizeTabKey(value: unknown): UsageGuideTabKey {
  const key = String(value || '')
  return GUIDE_TABS.some((tab) => tab.key === key)
    ? key as UsageGuideTabKey
    : 'tutorial'
}

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
      observer(this: WechatMiniprogram.Component.TrivialInstance, visible: boolean) {
        if (!visible) return
        const activeTab = normalizeTabKey(this.data.initialTab)
        this.setData({ activeTab, activeWristReference: 'female' })
        if (activeTab === 'purchase') {
          const loadPurchaseNoticeImages = this.loadPurchaseNoticeImages as (() => Promise<void>) | undefined
          void loadPurchaseNoticeImages?.call(this)
        }
        if (activeTab === 'wrist') {
          const loadWristMeasurementImage = this.loadWristMeasurementImage as (() => Promise<void>) | undefined
          void loadWristMeasurementImage?.call(this)
        }
      },
    },
    initialTab: {
      type: String,
      value: 'tutorial',
    },
  },

  data: {
    tabs: GUIDE_TABS,
    activeTab: 'tutorial' as UsageGuideTabKey,
    tutorialSteps: TUTORIAL_STEPS,
    tutorialShortcuts: TUTORIAL_SHORTCUTS,
    materialNotes: MATERIAL_NOTES,
    purchaseNoticeStatus: 'idle' as PurchaseNoticeStatus,
    purchaseNoticeImageUrls: [] as string[],
    purchaseNoticeErrorMessage: '',
    wristMeasurementStatus: 'idle' as WristMeasurementStatus,
    wristMeasurementImageUrl: '',
    wristMeasurementErrorMessage: '',
    activeWristReference: 'female' as WristReferenceGender,
    femaleWristSizes: FEMALE_WRIST_SIZES,
    maleWristSizes: MALE_WRIST_SIZES,
  },

  methods: {
    handleTabChange(event: WechatMiniprogram.TouchEvent) {
      const activeTab = normalizeTabKey(event.currentTarget.dataset.tab)
      if (activeTab === this.data.activeTab) return
      this.setData({ activeTab })
      if (activeTab === 'purchase' && this.data.purchaseNoticeStatus === 'idle') {
        void this.loadPurchaseNoticeImages()
      }
      if (activeTab === 'wrist' && this.data.wristMeasurementStatus === 'idle') {
        void this.loadWristMeasurementImage()
      }
    },

    async loadPurchaseNoticeImages(forceRefresh = false) {
      if (this.data.purchaseNoticeStatus === 'loading') return
      if (!forceRefresh && ['ready', 'empty'].includes(this.data.purchaseNoticeStatus)) return
      this.setData({
        purchaseNoticeStatus: 'loading',
        purchaseNoticeErrorMessage: '',
      })
      try {
        const settings = await loadPublicSettings(forceRefresh)
        const purchaseNoticeImageUrls = settings.purchaseNoticeImageUrls.filter(Boolean)
        this.setData({
          purchaseNoticeImageUrls,
          purchaseNoticeStatus: purchaseNoticeImageUrls.length ? 'ready' : 'empty',
        })
      } catch (error) {
        this.setData({
          purchaseNoticeImageUrls: [],
          purchaseNoticeStatus: 'error',
          purchaseNoticeErrorMessage: getApiErrorMessage(error, '购买须知加载失败'),
        })
      }
    },

    handleRetryPurchaseNotice() {
      void this.loadPurchaseNoticeImages(true)
    },

    handlePurchaseNoticeImageError(event: WechatMiniprogram.TouchEvent) {
      const failedUrl = String(event.currentTarget.dataset.url || '')
      if (!failedUrl) return
      const purchaseNoticeImageUrls = this.data.purchaseNoticeImageUrls.filter((url) => url !== failedUrl)
      this.setData({
        purchaseNoticeImageUrls,
        purchaseNoticeStatus: purchaseNoticeImageUrls.length ? 'ready' : 'empty',
      })
    },

    async loadWristMeasurementImage(forceRefresh = false) {
      if (this.data.wristMeasurementStatus === 'loading') return
      if (!forceRefresh && ['ready', 'empty'].includes(this.data.wristMeasurementStatus)) return
      this.setData({
        wristMeasurementStatus: 'loading',
        wristMeasurementErrorMessage: '',
      })
      try {
        const settings = await loadPublicSettings(forceRefresh)
        const wristMeasurementImageUrl = settings.wristMeasurementImageUrl
        this.setData({
          wristMeasurementImageUrl,
          wristMeasurementStatus: wristMeasurementImageUrl ? 'ready' : 'empty',
        })
      } catch (error) {
        this.setData({
          wristMeasurementImageUrl: '',
          wristMeasurementStatus: 'error',
          wristMeasurementErrorMessage: getApiErrorMessage(error, '测量示意图加载失败'),
        })
      }
    },

    handleRetryWristMeasurement() {
      void this.loadWristMeasurementImage(true)
    },

    handleWristMeasurementImageError() {
      this.setData({
        wristMeasurementImageUrl: '',
        wristMeasurementStatus: 'empty',
      })
    },

    handleWristReferenceChange(event: WechatMiniprogram.TouchEvent) {
      const gender = String(event.currentTarget.dataset.gender || '') as WristReferenceGender
      if (!['female', 'male'].includes(gender) || gender === this.data.activeWristReference) return
      this.setData({ activeWristReference: gender })
    },

    handleClose() {
      this.triggerEvent('close')
    },

    handleNoop() {
      // 阻止弹窗内部点击穿透到页面。
    },
  },
})
