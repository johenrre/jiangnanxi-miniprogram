# DIY 页面目录

```text
diy/
├─ index.*       页面注册、生命周期和各模块组装
├─ components/   WXML 组件及其样式
├─ engine/       Canvas 绘制、几何计算和物理模拟
├─ features/     材料、画布、弹窗、进入页等交互模块
├─ model/        DIY 领域数据结构
├─ page/         页面 Data、实例类型和页面级工具
└─ services/     音频等跨页面生命周期能力
```

约束：

- `engine` 不依赖页面实例，只处理绘制、几何和物理。
- `features` 负责组合页面状态、引擎和服务。
- `index.ts` 只保留生命周期、模块组装及少量跨模块业务。
- 可复用到其他页面的能力放在项目根目录 `utils` 或独立服务中。
