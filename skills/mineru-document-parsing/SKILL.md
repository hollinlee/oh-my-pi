---
name: mineru-document-parsing
description: 使用 MinerU cloud 解析用户明确指定的本地 PDF、图片、Word、PowerPoint 或 Excel 文档，并对解析结果做有界检索。仅在用户要求读取、提取、总结、核对或分析已点名的受支持文档文件时使用；普通代码、纯文本写作、未指定文件、URL、HTML、目录或批量请求不使用。
---

# MinerU 文档解析

## 触发边界

仅处理用户在当前请求中明确指定的单个本地文件：

- PDF：`.pdf`
- 图片：`.png`、`.jpg`、`.jpeg`、`.webp`、`.bmp`、`.tif`、`.tiff`
- Word：`.doc`、`.docx`
- PowerPoint：`.ppt`、`.pptx`
- Excel：`.xls`、`.xlsx`

持久 cloud upload 授权只表示可以上传，不授权扫描目录、猜测文件或上传未点名文件。文件会上传到 `mineru.net`，服务端可能保留最多 30 天。

以下情况不要加载或调用 `mineru_parse`：普通 coding 请求、对话中已有的文本、纯文本写作、未指定文件、URL、HTML、stdin、目录或 batch。不要改用其他 parser、CLI、HTTP API、flash API 或 token。

## 参数 routing

始终尊重用户显式指定的 `model`、OCR 和 language。否则按下表选择：

| 用户意图 / 文件 | `model` | `ocr` | `language` |
|---|---|---:|---|
| 一般解析、总结、表格或版面理解 | `vlm` | 按文件默认值 | `ch` |
| “逐字”“原样提取”“不要推断” | `pipeline` | 按文件默认值 | `ch` |
| 图片 | 上述规则 | `true` | `ch` |
| PDF 或 Office | 上述规则 | `false` | `ch` |
| 扫描件、扫描 PDF，或用户要求 OCR | 上述规则 | `true` | `ch` |
| 用户明确不要 OCR | 上述规则 | `false` | `ch` |
| 明确英文文档或要求英文识别 | 上述规则 | 按文件规则 | `en` |

其他明确语言使用 MinerU 对应 language code。不要做本地语言自动检测。信息不足时保留默认 `ch`。

## 执行

1. 确认请求只引用一个受支持的本地文件；不要自行枚举目录。
2. 首次解析调用 `mineru_parse`，传入 `path` 和 routing 后的参数。
3. 若已有 `jobId`，尤其是本地 timeout/cancel 后，使用 `mineru_parse(job_id=...)` 恢复。不要重新上传同一任务。
4. `remoteMayContinue: true` 表示本地停止不等于远端取消。不要声称远端已停止。
5. 失败时报告结构化 category、code、trace ID 和 suggested action。不要自动 fallback、换 token、换 model、改 OCR/language 或再次提交。

如果解析内容缺失，只建议用户确认是否创建一个新的 OCR 或 language job；未获得明确同意不得重提。

## 大结果的 context 策略

Tool 返回的 preview 只用于初步定位。完整 Markdown 位于 `resultPath`：

1. 先用 `rg -n -- <keyword> <resultPath>` 搜索关键词或标题。
2. 再用 `read` 的 `offset` / `limit` 读取命中附近的有界窗口。
3. 多个命中分段读取；逐步缩小范围。
4. 不使用 `cat`、不一次读取完整大型 Markdown、不把完整结果注入 context。

回答中区分 preview、检索到的原文和推断。关键金额、日期、名称、条款或结论应回到 `resultPath` 的相关窗口核验。

## 质量边界

- `vlm` 可能重建、归纳或误读内容，不是逐字权威来源。关键事实必须用解析原文窗口核验；需要逐字结果时新建 `pipeline` job 前先征得用户同意。
- Excel 仅覆盖可见解析内容，不等于 workbook 原生语义分析。不要声称已检查公式、宏、隐藏 sheet、named ranges、数据验证或外部链接。
- Legacy Office 解析质量可能波动。明确说明缺失或布局不确定性，不自行切换 parser。
