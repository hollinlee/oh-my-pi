# Context Discovery

## 目标

只读取足够回答问题的 repo 上下文。不要为了显得努力而全仓库漫游。

## 优先级

1. 用户直接提到的文件、命令或目录。
2. Root metadata：`README.md`、`package.json`、manifest、配置文件。
3. 与任务关键词匹配的源码。
4. `.pi/alignment/` 中已有私有 context、glossary、ADR。
5. 最近相关测试或验证命令。

## 读取策略

- 先用搜索定位，再读文件。
- 读到足够形成问题或判断时停止。
- 对不确定的事实标注“不确定”，不要编造。
- 如果发现代码和用户描述冲突，立刻指出并询问。

## 不做

- 不默认读取秘密文件，如 `.env`、auth、keychain 输出。
- 不把 `.pi/alignment` 内容复制到 tracked files。
- 不创建公开 context 文档。
