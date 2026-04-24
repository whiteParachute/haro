# W5 测试 warning 清理记录 — 2026-04-24

## MaxListenersExceededWarning

定位结果：`createLogger()` 默认启用 `pino` rolling transport；每个 transport 实例会在
`process` 上注册 `exit` listener。CLI/Vitest 测试会反复创建短生命周期 logger，超过
Node 默认 listener 阈值后出现：

```text
MaxListenersExceededWarning: Possible EventEmitter memory leak detected. 11 exit listeners added to [process]
```

修复策略：测试脚本显式设置 `HARO_LOG_ROLLING=0`，让测试使用同步文件 logger，避免短生命周期
logger 在同一测试进程内累积 pino transport `exit` listener。生产运行仍保留默认 rolling 行为，
可继续用 `HARO_LOG_ROLLING=0/1` 显式覆盖。

## DEP0040 punycode

定位结果：`pnpm why punycode` 指向 dev-only 工具链：`eslint` → `ajv@6` → `uri-js@4.4.1` →
`punycode`。该链路不是 Haro runtime 或 channel-telegram 业务代码直接引入。

修复策略：测试脚本最小化 suppress `DEP0040`，避免第三方 dev-only deprecated dependency 污染
release test 输出。未直接升级 ESLint/AJV 链路，因为这会触发 lint 配置迁移风险，超出 W5 的测试噪声
清理范围；后续可单独做依赖升级任务根治。
