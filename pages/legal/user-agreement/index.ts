import { openPrivacyProtectionGuide } from '@/utils/legal'

interface AgreementSection {
  title: string
  paragraphs: string[]
}

type LegalCenterTab = 'agreement' | 'privacy'

const agreementSections: AgreementSection[] = [
  {
    title: '一、服务说明',
    paragraphs: [
      '本小程序为用户提供晶石手串 DIY 设计、商品浏览、订单支付、物流查询和售后服务。小程序运营主体以微信公众平台公示的信息为准。',
      '使用本服务前，请仔细阅读并理解本协议。你点击同意并继续登录，即表示你已阅读并同意本协议。',
    ],
  },
  {
    title: '二、账号与登录',
    paragraphs: [
      '部分功能需要使用微信账号和绑定手机号登录。手机号仅用于账号识别、订单通知、收货及售后联系。',
      '请妥善保管微信账号及登录状态。因用户主动泄露、转借账号等原因造成的损失，由用户依法承担相应责任。',
    ],
  },
  {
    title: '三、DIY 设计与天然材料',
    paragraphs: [
      'DIY 页面展示的尺寸、颜色、纹理和排列效果用于辅助设计。受屏幕显示、天然材料纹理、批次差异和手工制作影响，实物可能与页面效果存在合理差异。',
      '用户提交订单前应核对手围、珠材规格、排列顺序、数量、价格及收货信息。',
    ],
  },
  {
    title: '四、订单与支付',
    paragraphs: [
      '商品价格、运费、优惠和应付金额以提交订单时页面显示为准。支付由微信支付提供相关服务。',
      '支付成功后，订单将进入确认和制作流程。如遇库存、价格或系统异常，我们会通过订单信息或客服与你联系。',
    ],
  },
  {
    title: '五、配送与售后',
    paragraphs: [
      '配送时间以订单页面和物流信息为准。因不可抗力、物流高峰或收货信息错误造成的延迟，将根据实际情况协助处理。',
      '根据用户选择的手围、珠材和排列制作的商品属于定制商品，依法不适用七天无理由退货。商品存在质量问题、错发或运输破损的，用户仍可通过订单售后入口或客服提交凭证申请处理。',
    ],
  },
  {
    title: '六、使用规范与知识产权',
    paragraphs: [
      '用户不得利用本服务发布违法、侵权、欺诈或扰乱平台正常运行的内容，也不得以非正常方式攻击接口、刷单或干扰交易。',
      '小程序中的品牌标识、页面设计、文字、图片及其他内容依法受到保护。未经授权，不得擅自复制、传播或用于商业用途。',
    ],
  },
  {
    title: '七、个人信息保护',
    paragraphs: [
      '我们仅在实现登录、订单履行、配送和售后服务所必要的范围内处理个人信息。具体信息类型、用途和保存规则以《隐私保护指引》为准。',
      '你可以在小程序“我的”页面随时查看隐私保护指引，并通过公开的客服渠道提出个人信息相关请求。',
    ],
  },
  {
    title: '八、协议更新与联系我们',
    paragraphs: [
      '因服务调整或法律法规变化，本协议可能进行更新。涉及用户重要权益的变更，我们会以合理方式进行提示。',
      '如对订单、售后、本协议或个人信息处理有疑问，请通过小程序内公开的官方客服渠道联系我们。',
    ],
  },
]

Page({
  data: {
    updatedAt: '2026年8月18日',
    activeTab: 'agreement' as LegalCenterTab,
    agreementSections,
  },

  onLoad(options: { tab?: string }) {
    const activeTab: LegalCenterTab = options.tab === 'privacy' ? 'privacy' : 'agreement'
    this.setData({ activeTab })
  },

  handleTabChange(event: WechatMiniprogram.TouchEvent) {
    const activeTab = String(event.currentTarget.dataset.tab || '')
    if (activeTab !== 'agreement' && activeTab !== 'privacy') return
    this.setData({ activeTab })
  },

  handleOpenOfficialPrivacy() {
    openPrivacyProtectionGuide()
  },
})
