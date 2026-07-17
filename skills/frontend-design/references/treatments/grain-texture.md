# Grain Texture Treatment

## 适用条件

用于给摄影、印刷、档案、自然材料或低饱和数字 surface 增加轻微触感，降低过度光滑的屏幕感。

## 不适用条件

高密度数据界面、小字号信息区、严格品牌纯色 surface 或纹理与主题没有材料关系时避免使用。

## 兼容方向

适合 `editorial`、`organic`、`cinematic-luxury`，也可为 `swiss-minimal` 增加极轻纸面感。

## 表达原则

- Grain 应来自主题材料：纸、胶片、织物、石材或传感噪声。
- 使用低 opacity、固定 overlay 或小型可重复 asset。
- 不要让纹理跟随每个组件边界重复。
- 保持正文和控件区域清晰。

## Fallback 与 accessibility

在 forced-colors、打印和低性能模式下可移除纹理。纹理不能成为区分状态或可交互区域的唯一方式。

## Hard limits

- 通常只使用一个全局 grain system。
- 正文背景上的纹理必须极轻。
- 不同时叠加多种噪声、纸纹和 scratches。
- 不用高分辨率动态噪声制造无意义 GPU 开销。
