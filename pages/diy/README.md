# DIY 页面目录

```text
diy/
├─ index.*       页面注册、生命周期和各模块组装
├─ components/   WXML 组件及其样式
├─ engine/       手串几何与分层 WebGL 渲染内核
├─ features/     材料、画布、弹窗、进入页等交互模块
├─ model/        DIY 领域数据结构
├─ page/         页面 Data、实例类型和页面级工具
└─ services/     音频等跨页面生命周期能力
```

约束：

- `engine/three` 隔离 Three.js、小程序 WebGL、相机/射线、手串视角、线圈、写真平面和纹理缓存。
- `engine` 不依赖页面实例，只处理绘制与几何。
- `features` 负责组合页面状态、引擎和服务。
- `index.ts` 只保留生命周期、模块组装及少量跨模块业务。
- 可复用到其他页面的能力放在项目根目录 `utils` 或独立服务中。

当前编辑模型：珠子加入后直接进入手串圆环；`canvas_image` 透明渲染图由 WebGL 平面绘制。`stringing_position=center` 的珠材沿线圈切向摆放，`stringing_position=top` 的配饰以图片顶部中央连接在线圈并保持主体向外；`stringing_width_mm` 决定环上占位，`stringing_offset_mm` 负责径向微调，`size` 与 `image_scale` 决定视觉尺寸。空白处拖动只旋转手串 Group，同层写真平面按实时相机深度决定遮挡；拖珠通过独立命中壳拾取，并投影回旋转后的手串局部平面完成换位和拖出删除。
当前只使用项目已有的穿线与图片字段，不引入额外摆放预设、图片挂点、孔轴、模型件或无孔附着件。
当前阶段不包含碰撞、惯性、双指缩放、选中态和插入标记。
结算预览仍由 `pages/cart/settlement-detail` 承担，不属于 DIY 画布展示态。
