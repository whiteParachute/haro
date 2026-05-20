---
id: FEAT-067
title: Frontier source real integration
status: done
owner: Haro sidecar
created: 2026-05-20
updated: 2026-05-20
---

# FEAT-067 Frontier source 真接入

## 1. 背景

ROADMAP 的步骤 1 已经有 daily workflow：`observe → frontier intake → propose → validate → approval-request`。缺口是 frontier intake 只消费人工整理过的旧 signals，没有从外部一手源持续拉新信息。

本 FEAT 让 Haro sidecar 自己从配置化 source adapter 拉取一手信号。信号仍写入 `~/.haro/evolution/frontier-signals/`，不写 AgentDock 代码、不写 AgentDock memory、不写 aria-memory。

## 2. 目标

1. 支持配置化 frontier source adapters。
2. daily workflow 在 frontier intake step 读取配置并拉取新信号。
3. 每条外部记录归一化为现有 `FrontierSignal` schema。
4. HTTP 失败、超时、404 不阻断 workflow。
5. 基于 `sourceRef.uri + publishedAt` 去重，避免同一外部条目重复落盘。

## 3. 首批 source 选择

| 优先级 | adapter | sourceType | 选择理由 | 初始定位 |
| --- | --- | --- | --- | --- |
| P0 | `github-releases` | `repo-release` | GitHub Releases 是多数工程项目的一手发布源，JSON API 稳定，可无依赖解析 | MCP SDK、AgentDock/Haro 相关仓库、provider SDK |
| P0 | `rss-feed` | 默认 `official-doc` | 官方 changelog / engineering blog 常见 RSS/Atom，适合 OpenAI、Anthropic、Cloudflare、Vercel 等站点 | 官方文档、changelog、工程博客 |
| P1 | `hacker-news-topstories` | 默认 `blog-post` | Hacker News API 稳定，可作为高分工程线索，但不是最终一手证据 | 只做线索，默认中置信度，需 keywords / score 过滤 |

不接 X / Twitter / Reddit。它们需要 cookie、JS rendering 或 browser bridge，可靠性不足，后续单独 FEAT 处理。

## 4. 配置入口

默认配置文件：

```text
~/.haro/frontier-sources.json
```

也支持：

```bash
HARO_FRONTIER_SOURCE_CONFIG=/path/to/frontier-sources.json
haro intake frontier --json
```

或显式传入：

```bash
haro intake frontier --source-config /path/to/frontier-sources.json --json
```

示例：

```json
{
  "sources": [
    {
      "id": "github-mcp-ts-sdk",
      "type": "github-releases",
      "repo": "modelcontextprotocol/typescript-sdk",
      "targetDomains": ["mcp-tools", "haro-sidecar"],
      "limit": 5
    },
    {
      "id": "openai-changelog-feed",
      "type": "rss-feed",
      "url": "https://example.com/openai/changelog.xml",
      "sourceType": "official-doc",
      "targetDomains": ["mcp-tools", "haro-sidecar"],
      "limit": 10
    },
    {
      "id": "hn-agent-systems",
      "type": "hacker-news-topstories",
      "keywords": ["agent", "mcp", "tool"],
      "minScore": 100,
      "targetDomains": ["haro-sidecar", "agentdock-kernel"],
      "confidence": "medium"
    }
  ],
  "signals": []
}
```

`signals` 兼容 FEAT-048 的人工 curated signals。`sources` 是本 FEAT 新增字段。

## 5. Schema 映射

每个 adapter 必须输出现有 `FrontierSignal`：

- `id`：由 `source.id + sourceRef.uri + publishedAt` hash 生成。
- `sourceType`：由 adapter 默认值或配置覆盖。
- `sourceRef.uri`：外部一手记录 URL。
- `publishedAt`：外部记录发布时间。
- `collectedAt`：Haro 当前采集时间。
- `summary`：外部摘要或标题兜底。
- `claims`：只写从记录中直接可见的事实，不编造。
- `targetDomains`：来自配置，默认 `haro-sidecar`。
- `confidence`：官方源默认 high，HN 默认 medium，可配置覆盖。
- `status`：新信号默认 active。

## 6. 回退与失败策略

- 配置文件不存在：CLI 返回 0 条 signal，daily workflow 不阻断。
- source `enabled=false`：跳过该 source。
- HTTP 失败 / timeout / 404：记录 `sourceSummaries[].status=error`，stderr 打 warning，不阻断 intake。
- JSON/RSS 解析失败：只影响对应 source。
- 去重命中：不重写已有 signal，不更新 cursor 为重复记录制造新状态。
- 关闭某个 source：把该 source 配成 `enabled=false` 或从配置删除即可。

## 7. Daily workflow 接入

`haro_run_daily_workflow` 的 frontier intake step 现在按以下顺序找配置：

1. MCP input `frontierSourceConfigPath`
2. `HARO_FRONTIER_SOURCE_CONFIG`
3. `~/.haro/frontier-sources.json`，仅当文件存在时启用

没有配置时 daily workflow 继续运行 observe/propose/validate/approval-request。

## 8. 验收

- AC1：mock GitHub Releases API 能生成 schema-valid `repo-release` signal。
- AC2：HTTP 5xx 不阻断 intake，stderr 有 warning，signal 不写错。
- AC3：同 `sourceRef.uri + publishedAt` 的信号不重复落盘。
- AC4：mock RSS source 通过 daily workflow 写入 `frontier-signals/`。
- AC5：不创建 `$HARO_HOME/memory`，不触碰 AgentDock / aria-memory。

## 9. 验证

- `pnpm -F @haro/cli build`
- `pnpm -F @haro/cli test -- test/agentdock-sidecar-cli.test.ts`
- 全仓 `pnpm lint && pnpm build && pnpm test && pnpm smoke && git diff --check`
