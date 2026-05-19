# FEAT-058 post-apply 自动反馈

## 背景与目标
ROADMAP P0 第二段要求补齐 apply 后反馈。FEAT-055 已让 Haro Web approve 后自动触发 L0/L1 sidecar-local gated apply，但用户仍要主动看 Haro Web或等 supervisor 通报。本 FEAT 在 FEAT-055 auto-apply 完成后，向配置的 IM 渠道发送一次结果摘要。通知是次级动作，发送失败不得改变 apply 结果。

## 范围
覆盖：仅 FEAT-055 auto-apply 路径；结果状态包括 applied、gate blocked/failed、skipped。
不覆盖：manual apply、propose、validate、approval-request 通知；不新增 IM 框架；不改 Haro Web UI；不做 FEAT-063 重试。

## 配置
使用环境变量：
```bash
HARO_FEEDBACK_CHANNEL=feishu:oc_ebecdc3214dc68a542eedfb855d956d3
HARO_LARK_CLI_BIN=/home/heyucong.bebop/.local/bin/lark-cli # 可选
```
选择环境变量是为了最小改动，不引入配置迁移。生产启用或改值后需要重启 `haro-web.service`，因为服务进程启动时读取环境和代码。

## 通知内容
通知包含 proposal id/标题、结果状态、application id、applied event id、snapshot id、rollback id、gate code/reason、时间戳和一段短说明。不包含 policy 全量内容、token、secret。

## 幂等与失败处理
成功通知后写 `evolution/feedback-events/feedback_<application-or-derived-id>.json`。同一 application id 再次触发时跳过。
`HARO_FEEDBACK_CHANNEL` 未配置时 log warn 并跳过。`lark-cli` 失败时 log error。两种情况都不抛异常、不阻塞 apply。

## 验收
1. auto-apply 成功时发送通知，包含 applied 与关键 artifact id；
2. gate 阻断时发送通知，包含 gate code 与 reason；
3. 未配置 channel 时不发送、不阻塞 apply；
4. 发送失败时 log error，不改变 application 状态；
5. typecheck、lint、build、runner-contracts test、单元测试通过；
6. MCP `haro_run_daily_workflow` 链路不被破坏。
