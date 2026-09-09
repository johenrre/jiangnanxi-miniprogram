// 通用会话接口

/** 判断本机是否存在有效登录令牌。 */
export { hasAuthSession } from '@/api/auth'

/** 读取本机缓存的账户摘要。 */
export { getStoredAccountProfile } from '@/api/auth'

/** 完成微信身份与手机号授权，并使用后端签发的正式会话。 */
export { loginWithWechat } from '@/api/auth'

/** 点击登录后尝试恢复已经绑定手机号的微信账户。 */
export { loginExistingWechatUser } from '@/api/auth'

/** 更新本机会话内的账户摘要。 */
export { updateStoredAccountProfile } from '@/api/auth'

/** 清除本机登录会话。 */
export { clearAuthSession } from '@/api/auth'

/** 将任意请求异常转换为可直接展示的错误文案。 */
export { getApiErrorMessage } from '@/api/client'

/** 判断接口异常是否表示登录状态已失效。 */
export { isApiUnauthorized } from '@/api/client'

export type { AccountProfile } from '@/api/auth'
export type { ApiRequestError } from '@/api/client'

// 商城 Tab 接口

/** 加载商城分类与全部上架商品。 */
export { loadMallCatalog, loadMallProduct } from '@/api/mall/products'

export type {
  MallCategory,
  MallProduct,
  MallSecondaryCategory,
} from '@/api/mall/products'

// 首页 Tab 接口

/** 加载小程序最新公开运营配置（首页轮播等）。 */
export { loadPublicSettings } from '@/api/settings/public'

export type {
  PublicHomeSlide,
  PublicSettings,
} from '@/api/settings/public'

// 发现 Tab 及作品详情接口

/** 按发现页栏目加载作品列表。 */
export { loadDiscoverDesignWorks } from '@/api/discover/designs'

/** 加载从发现页进入的作品详情。 */
export { loadDiscoverDesignDetail } from '@/api/discover/designs'

/** 将作品接口异常转换为统一展示文案。 */
export { getDesignErrorMessage } from '@/api/design/index'

export type {
  DesignMaterial,
  DesignPage,
  DesignPreviewMaterial,
  DesignSection,
  DesignWork,
  LoadDesignsOptions,
} from '@/api/design/index'

// DIY 页面接口

/** 从服务端加载 DIY 可选珠子与配件材料。 */
export { loadDiyMaterials } from '@/api/diy/materials'

/** 保存 DIY 设计，或直接将当前 DIY 方案加入真实后端购物车。 */
export { addDiyDesignToCart, saveDiyDesign } from '@/api/diy/designs'

export type { DiyMaterial } from '@/api/diy/materials'
export type { AddedDiyCartItem, SavedDiyDesign } from '@/api/diy/designs'

// 我的 Tab：个人资料

/** 加载当前登录账户的个人资料。 */
export { loadProfile } from '@/api/profile/account'

/** 保存当前账户的昵称和头像地址。 */
export { updateProfile } from '@/api/profile/account'

/** 上传新头像并返回后端媒体地址。 */
export { uploadProfileAvatar } from '@/api/profile/account'

// 我的 Tab：设计、订单与售后

/** 加载当前账户保存的设计方案。 */
export {
  deletePersonalDesign,
  loadPersonalDesignDetail,
  loadPersonalDesigns,
} from '@/api/profile/designs'

/** 按状态加载当前账户的订单，或按订单号加载单笔订单。 */
export {
  confirmOrderReceipt,
  loadOrderByNo,
  loadOrderDetail,
  loadOrderLogistics,
  loadOrders,
  submitReturnShipment,
} from '@/api/profile/orders'

/** 为指定订单发起退款或售后申请。 */
export { createAfterSale, uploadAfterSaleEvidence } from '@/api/profile/orders'

export type {
  PersonalDesign,
  PersonalDesignPage,
} from '@/api/profile/designs'

export type {
  OrderFilter,
  ConfirmReceiptResult,
  OrderCheckoutOption,
  OrderDetail,
  OrderDetailLine,
  OrderItem,
  OrderPage,
  CreateAfterSaleInput,
  OrderLogistics,
  ReturnShipmentInput,
} from '@/api/profile/orders'

// 我的 Tab：收货地址

/** 加载当前账户的收货地址。 */
export { loadAddresses } from '@/api/profile/addresses'

/** 新增一条收货地址。 */
export { createAddress } from '@/api/profile/addresses'

/** 更新指定收货地址。 */
export { updateAddress } from '@/api/profile/addresses'

/** 删除指定收货地址。 */
export { deleteAddress } from '@/api/profile/addresses'

/** 将指定地址设为默认收货地址。 */
export { setDefaultAddress } from '@/api/profile/addresses'

export type {
  AddressInput,
  AddressItem,
} from '@/api/profile/addresses'

// 购物车与结算选项

/** 从后台公开配置加载制作、包装、绳线和配送规则。 */
export { loadCartProductOptions } from '@/api/cart/items'

/** 加载后端统一购物车，包含 DIY 与商城商品。 */
export { loadCartItems } from '@/api/cart/items'

/** 将已保存的设计方案加入后端购物车。 */
export { addDesignToCart } from '@/api/cart/items'

/** 将商城商品加入统一购物车。 */
export { addMallProductToCart, createMallCartItem } from '@/api/cart/items'

/** 修改购物车商品数量，数量范围固定为 1 至 99。 */
export { changeCartItemQuantity } from '@/api/cart/items'

/** 切换单个购物车商品的结算勾选状态。 */
export { toggleCartItem } from '@/api/cart/items'

/** 统一设置购物车全部商品的结算勾选状态。 */
export { toggleAllCartItems } from '@/api/cart/items'

/** 将购物车结算勾选状态按顺序异步写入本地缓存。 */
export { persistCartSelection } from '@/api/cart/items'

/** 从后端购物车删除指定商品。 */
export { removeCartItem } from '@/api/cart/items'

/** 按购物车条目标识批量删除已完成结算的商品。 */
export { removeCartItems } from '@/api/cart/items'

/** 支付确认成功后移除已结算商品。 */
export { removeCheckedCartItems } from '@/api/cart/items'

/** 确认订单页使用的默认结算选项。 */
export { DEFAULT_CART_SELECTED_OPTIONS } from '@/api/cart/types'
export { createDefaultCartSelectedOptions } from '@/api/cart/types'
export { normalizeCartSelectedOptions } from '@/api/cart/types'

export type {
  AddCartDesignInput,
  CartItem,
  CartItemType,
  CartProductOption,
  CartProductOptionGroup,
  CartSelectedOptions,
} from '@/api/cart/types'

// 购物车页面：订单提交与支付确认

/** 使用真实后端创建待支付订单。 */
export { createCheckoutOrder } from '@/api/cart/checkout'

/** 从后端获取支付参数并拉起微信支付。 */
export { requestCheckoutPayment } from '@/api/cart/checkout'

/** 查询订单支付结果，支付成功必须以后端结果为准。 */
export { queryCheckoutPayment } from '@/api/cart/checkout'

/** 安全取消待付款订单；后端会先查单并关闭微信支付单。 */
export { cancelCheckoutOrder } from '@/api/cart/checkout'

export type {
  CheckoutOrder,
  CheckoutPaymentParams,
  CheckoutPaymentResult,
  CheckoutPaymentResultState,
  CreateCheckoutOrderInput,
} from '@/api/cart/checkout-types'
