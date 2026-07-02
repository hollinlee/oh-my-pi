---
name: diagnosing-bugs
description: 用于用户明确要求 debug、diagnose、排查失败、测试挂了、CI 挂了、行为异常或 root-cause 分析时。普通实现、重构、功能开发或没有失败现象的代码修改不使用；修改代码前必须展示 diagnosis summary 并等待用户确认。
---

# Diagnosing Bugs

## 目标

在失败、异常或 regression 场景中先诊断，再修复。不要看到报错就直接改代码；先复现现象、缩小范围、用证据支持 root cause，再提出最小修复方案。

适用场景包括：

- 用户明确说 debug / diagnose / 排查
- 测试挂了或 CI 挂了
- 报错、异常行为或 regression
- 用户问“为什么坏了”
- 多次修复失败，需要重新建立诊断路径

不适用场景包括：

- 普通功能实现。
- 常规重构。
- 没有失败现象的代码修改。
- 用户已经给出明确实现方案、且没有要求诊断。

## 默认流程

1. 确认 symptom：实际看到的失败、报错或异常行为是什么。
2. 尝试 reproduction：运行相关命令或整理复现步骤；如果无法复现，明确说明。
3. 明确 Expected vs Actual：期望行为和实际行为分别是什么。
4. 提出 hypotheses：列出少量最可能原因，并说明为什么。
5. 缩小范围：优先用日志、测试、最小 case、git diff 或代码阅读排除假设。
6. 判断 root cause：只有在有证据支持时才确认；否则标注 confidence，不进入修复。
7. 输出 Diagnosis Summary 和 Fix Strategy。
8. 等用户确认后，才可以修改代码。
9. 修改后用同一个复现路径或相关验证证明问题已解决。

## Diagnosis Summary

修改代码前必须展示简短的 diagnosis summary：

```txt
Symptom:
- ...

Reproduction:
- ...

Expected vs Actual:
- Expected: ...
- Actual: ...

Root Cause + Evidence:
- ...

Fix Strategy + Validation:
- ...
```

如果无法复现或 root cause 只是猜测，要直接说明，不要包装成确定结论。

## 修复边界

可以在确认前做：

- 读取相关文件。
- 运行安全的本地验证命令。
- 缩小失败范围。
- 形成 diagnosis summary。
- 提出 fix strategy。

必须用户确认后才做：

- 修改代码。
- 修改测试。
- 删除文件。
- 执行有外部副作用的命令。
- 扩大修复范围。

## Stop Points

这些 stop points 用来防止在证据不足或范围变化时继续硬改。遇到以下情况先停住，向用户说明当前判断和建议下一步：

- 无法复现，且没有足够证据支持 root cause。
- root cause 只是猜测。
- 修复会超出用户给出的 bug 范围。
- 需要修改测试，且测试是否错误还需要判断。
- 需要危险操作、外部服务调用或不可逆变更。
- 存在多个合理 fix strategy，需要用户选择。
- flaky tests 或 intermittent CI 只有单次失败，缺少稳定复现、相关日志、最小 case 或明确变更关联。

对 flaky tests 或 intermittent CI，默认不要把单次失败当 root cause。优先重复运行相关验证或寻找稳定信号；如果仍无法稳定复现，输出当前证据、可能假设和下一步建议，然后停住。

## 禁止

- 不在 root cause 不清楚时改代码。
- 不把 stack trace 或 symptom 直接当 root cause。
- 不为了让测试通过而修改测试，除非证据表明测试本身错了。
- 不顺手重构无关代码。
- 不写事故复盘式长文；输出应短、硬、可判断。
- 第一版不默认接入 `/work-issue`、`/handle-review` 或其他 GitHub workflow。

## 输出原则

用户需要看到的是可判断的诊断产出，不是 agent 的劳动过程。默认展示：

- 复现结果。
- 被保留或排除的关键假设。
- root cause 的证据。
- 最小修复策略。
- 验证方式和剩余风险。
