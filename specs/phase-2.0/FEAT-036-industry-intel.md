---
id: FEAT-036
title: Industry Intel（业界趋势订阅 + 自动 eat）
status: draft
phase: phase-2.0
owner: whiteParachute
created: 2026-05-01
updated: 2026-05-01
related:
  - ../phase-0/FEAT-011-manual-eat-shit.md
  - ../phase-1/FEAT-021-memory-fabric-v1.md
  - ../phase-1/FEAT-022-evolution-asset-registry.md
  - ../phase-2.0/FEAT-040-self-monitor.md
  - ../phase-2.0/FEAT-041-auto-eat-shit-trigger.md
  - ../phase-2.5/FEAT-037-evolution-proposal.md
  - ../evolution-engine-protocol.md
  - ../evolution-metabolism.md
  - ../../docs/architecture/overview.md
  - ../../docs/planning/redesign-2026-05-01.md
---

# Industry Intel（业界趋势订阅 + 自动 eat）

## 1. Context / 背景

Haro 的进化层有四个驱动源（[overview § 四个进化驱动源](../../docs/architecture/overview.md#四个进化驱动源)）：使用记忆 / 业界趋势 / 用户决策 / Agent 自判断。Phase 2.0 之前，Haro 完全不接外部世界——agent 不知道 Anthropic 又出了什么新能力、Codex SDK 的 changelog 是否影响当前实现、agent 领域是否出现了更好的设计模式。这意味着进化层只能"内省"，会越来越和外部世界脱节。

happyclaw / 其他 Agent workbench 都没有这种外部信号订阅机制。这是 Haro 的差异化之一：通过受控订阅 + 自动 eat 流程，让平台**周期性"看一眼世界"**，把外部进展当成 evolution proposal 的输入。

本 spec 定义订阅源、抓取频率、噪音过滤、与 eat 流程的对接，以及与 Phase 2.5 Evolution Proposal 的接口。

## 2. Goals / 目标

- G1: 新增 `IndustryIntelService`，周期性从配置的源拉取最新条目（changelog / release / 文章）。
- G2: 抓取的条目走 FEAT-011 eat 流程：质量门槛 → 四问验证 → proposal bundle 写入 Memory Fabric（`industry-intel` scope）。
- G3: 噪音过滤：去重（基于 URL + content hash）、相关性打分（启发式 + 关键词）、人为 deny-list。
- G4: 订阅源由 YAML 声明：`~/.haro/intel-sources.yaml`，格式参考 RSS / Atom / GitHub Releases / 自定义 webhook。
- G5: 与 FEAT-040 Self-Monitor 接合：Industry Intel 也是被监测的子系统（抓取频率、失败率、入库条数）。
- G6: 与 FEAT-037 Evolution Proposal 接合：Pattern Miner 可消费 industry-intel scope 记忆，作为提案"证据链"的外部来源。

## 3. Non-Goals / 不做的事

- 不做完整的 web crawler；只支持结构化源（RSS / Atom / GitHub Releases / OpenAPI ChangeLog）+ 用户白名单 URL 列表。
- 不做 NLP 主题建模；相关性过滤限于关键词匹配 + 简单启发式（标题正则、作者白名单、tag 过滤）。
- 不做实时推送；订阅是 pull 模型，最高频率每 30 分钟一次。
- 不允许 Industry Intel 自动触发代码改动；它只产出 Memory Fabric 条目，下一步动作由 Phase 2.5 Evolution Proposal 走人审。
- 不调用付费 API；订阅源仅限免费公开 endpoint。
- 不做跨实例去重；自用单机即可。

## 4. Requirements / 需求项

- R1: 新建 `packages/core/src/industry-intel/`，包含 `service.ts` / `sources/<type>.ts` / `filter.ts` / `eat-bridge.ts`。
- R2: 订阅源类型至少支持：`rss` / `atom` / `github-release`（仓库 release feed）/ `github-tag`（按 tag 抓 commit）/ `webhook-mirror`（接收来自 GitHub Action 转发的 release JSON）。
- R3: `intel-sources.yaml` schema 至少含 `id` / `kind` / `url` / `pollIntervalSec` / `relevance.keywords` / `relevance.denyList` / `enabled`。
- R4: 默认 pollIntervalSec ≥ 1800（30 分钟）；CI 阶段拒绝 < 600。
- R5: 抓取必须带 `If-Modified-Since` / `ETag`，避免重复全量下载；HTTP 429 / 5xx 走指数退避。
- R6: 去重表 `industry_intel_seen`：`source_id` + `content_hash` + `first_seen_at`；同 hash 不再二次入 eat。
- R7: 相关性过滤：标题或正文命中 `keywords` 任一为 pass；`denyList` 命中即过滤；fail 但 score > 0.5 写 `pending-review`，让 owner 在 Dashboard 决定是否 eat。
- R8: 自动 eat 必须复用 FEAT-011 eat 实现：质量门槛、proposal bundle、scope `industry-intel`、`sourceRef` 标记 url + 抓取时间。
- R9: 进入 Memory Fabric 的条目必须带 `verification: pending-external` 维度，避免被当成已验证事实使用。
- R10: 抓取失败 / 去重命中 / 通过 / 写入 等关键事件必须写 `industry_intel_log`，FEAT-040 Self-Monitor 可读。
- R11: CLI 命令族：`haro intel list-sources` / `intel add-source` / `intel remove-source` / `intel run --once` / `intel status` / `intel preview --source <id>`（dry-run 抓取，不写入）。
- R12: Dashboard 新增 `/intel` 页：源列表 / 最近抓取 / pending-review 队列 / 入库统计（详细 UI 段属于 follow-up，本 spec 只声明路由 + read model 契约）。

## 5. Design / 设计要点

### 5.1 默认源建议（出厂配置，可禁用）

```yaml
sources:
  - id: anthropic-changelog
    kind: rss
    url: https://www.anthropic.com/changelog/rss
    pollIntervalSec: 3600
    relevance:
      keywords: [Claude, Sonnet, Opus, Haiku, MCP, prompt caching, batch]

  - id: openai-changelog
    kind: rss
    url: https://platform.openai.com/docs/changelog/rss.xml
    pollIntervalSec: 3600
    relevance:
      keywords: [Codex, gpt, function calling, MCP, batch, fine-tune]

  - id: claude-code-releases
    kind: github-release
    url: https://github.com/anthropics/claude-code
    pollIntervalSec: 7200

  - id: openai-codex-releases
    kind: github-release
    url: https://github.com/openai/codex
    pollIntervalSec: 7200

  - id: agent-trending-md
    kind: rss
    url: https://github.com/trending/typescript.atom
    pollIntervalSec: 86400
    relevance:
      keywords: [agent, MCP, runtime, evolution, RAG]
```

### 5.2 数据流

```
intel.poll(source)
  ├─ HTTP fetch (with ETag)
  ├─ parse → entries[]
  ├─ for each entry:
  │     ├─ dedup check (content_hash)
  │     ├─ relevance.evaluate
  │     │     ├─ pass        → eat-bridge
  │     │     ├─ pending     → write pending_review
  │     │     └─ fail        → drop, log
  │     └─ continue
  └─ update industry_intel_log
```

### 5.3 eat-bridge 接合

```ts
async function eatEntry(entry: IntelEntry) {
  await runEat({
    source: entry.url,
    title: entry.title,
    body: entry.body,
    scope: 'industry-intel',
    verification: 'pending-external',
    sourceRef: { kind: 'intel', sourceId: entry.sourceId, fetchedAt: entry.fetchedAt },
  });
}
```

走标准 eat 实现，FEAT-011 / FEAT-022 已有的质量门槛、proposal bundle、asset registry 都被复用。

### 5.4 与 FEAT-040 Self-Monitor 的接合

`industry_intel_log` 表结构：

```sql
CREATE TABLE industry_intel_log (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  event TEXT NOT NULL,           -- fetched / parsed / dedup / passed / pending / failed / written
  payload TEXT,                  -- 选择性保留摘要，不存全文
  occurred_at INTEGER NOT NULL
);
```

Self-Monitor 把抓取频率、失败率、pending 队列长度作为常态指标。

### 5.5 与 FEAT-037 Evolution Proposal 的接合

Pattern Miner（FEAT-042）查询 Memory Fabric 时可指定 `scope: industry-intel` 拉取最近窗口的外部条目，作为提案"证据链"的外部来源。Industry Intel 自身不直接产出 proposal，避免越权。

## 6. Acceptance Criteria / 验收标准

- AC1: 配置 `anthropic-changelog` 源，运行 `haro intel run --once` 抓取至少 1 条记录并入 Memory Fabric `industry-intel` scope（对应 R1、R8、R9）。
- AC2: 同一条目 hash 第二次抓取不会重复 eat（dedup 表命中）（对应 R6）。
- AC3: 配置 `denyList: [security, breach]`，匹配条目被过滤、不入 Memory Fabric（对应 R7）。
- AC4: pollIntervalSec 设为 60 时 CI 拒绝该源（对应 R4）。
- AC5: 远端返回 304 Not Modified 时不重新解析（对应 R5）。
- AC6: `haro intel preview --source anthropic-changelog` 输出最新 N 条且不写入（对应 R11）。
- AC7: `industry_intel_log` 完整记录一次抓取的 5 类事件（对应 R10）。
- AC8: Dashboard `/intel` 路由能 list 当前源、最近抓取与 pending-review 队列（read model 契约，对应 R12）。

## 7. Test Plan / 测试计划

- 单元测试：每种源类型的 parser；dedup hash 函数；relevance 决策。
- 集成测试：模拟 HTTP server 返回 RSS / Atom / GitHub Release JSON；端到端跑一次抓取 + eat。
- 安全测试：恶意 RSS（超大、深嵌套、外链伪 redirect）；payload 大小限制（默认 1MB / 条）；URL 必须 HTTPS。
- 性能：5 个源 × 30 条 / 次抓取，整体耗时 < 30s；占用 RSS < 200MB。
- 回归：FEAT-011 eat / FEAT-021 Memory Fabric / FEAT-022 Asset Registry。

## 8. Open Questions / 待定问题

- Q1: 用户隐私：抓取历史是否保留全文？倾向只保留 url + 摘要 + hash，全文延迟到用户在 Dashboard 显式查看时再 fetch。
- Q2: 是否需要订阅源签名校验（GPG / sigstore）？倾向 Phase 2.0 不做，依靠 HTTPS + 域白名单。
- Q3: webhook-mirror 类型如何鉴权？倾向 HMAC + 共享密钥，密钥存 secretRef。
- Q4: 网络断联后是否累积抓取？倾向不累积，最多记录"上次成功时间"，下次窗口重新尝试。
- Q5: 国内 / 自用 devbox 网络受限时如何 fallback？倾向引入 `proxy` 字段（http_proxy / https_proxy），不引入 SOCKS。

## 9. Changelog / 变更记录

- 2026-05-01: whiteParachute — 初稿（Phase 2.0 进化感知层批次 2）
