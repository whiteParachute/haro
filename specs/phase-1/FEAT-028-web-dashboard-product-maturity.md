---
id: FEAT-028
title: Web Dashboard Product Maturity（多用户、分页与中文本地化）
status: draft
phase: phase-1
owner: whiteParachute
created: 2026-04-25
updated: 2026-04-25
related:
  - ./FEAT-015-web-dashboard-foundation.md
  - ./FEAT-016-web-dashboard-agent-interaction.md
  - ./FEAT-017-web-dashboard-system-management.md
  - ./FEAT-019-web-dashboard-channel-agent-management.md
  - ./FEAT-023-permission-token-budget-guard.md
  - ./FEAT-024-web-dashboard-knowledge-skills.md
  - ./FEAT-025-web-dashboard-runtime-monitoring.md
  - ../../docs/modules/web-dashboard.md
---

# Web Dashboard Product Maturity（多用户、分页与中文本地化）

## 1. Context / 背景

FEAT-015 到 FEAT-017 已经交付 Web Dashboard 的基础壳、Chat/Sessions、Status/Settings 和最小 API key 链路。但当前前端仍偏工程骨架：i18n 只有最小资源结构，认证模型是单一 Dashboard API key，列表页缺少成熟的服务端分页/筛选/空态/错误态，中文本地化也不完整。

KeyClaw 等成熟控制面产品的经验说明，管理后台必须优先解决“多人使用、信息量变大、中文用户可直接理解”这三个基础产品问题。否则后续 Channel、Agent、Memory、Logs、Provider 监控页面增多后，Dashboard 会迅速变成只能本机单人调试的工具，而不是 Haro 的长期控制面。

## 2. Goals / 目标

- G1: 将 Dashboard 认证从单一 API key 升级为本地多用户与角色模型。
- G2: 为 Sessions、Agents、Channels、Logs、Knowledge、Skills、Users 等列表建立统一分页/筛选/排序 contract。
- G3: 完成中文本地化基线，默认 `zh-CN`，所有用户可见文案走 i18n resource。
- G4: 为高风险操作接入 FEAT-023 的权限分级与审计基础。
- G5: 保持 Phase 1 单机部署边界，不引入企业 SSO 或外部 IdP。

## 3. Non-Goals / 不做的事

- 不实现 OAuth、SAML、LDAP、OIDC 等企业身份集成；Phase 1 只做本地用户。
- 不实现多租户隔离或跨组织 workspace；用户模型只服务单个 Haro 实例。
- 不替代 FEAT-023 的权限/预算策略引擎；Dashboard 只消费其 operation class 和审批状态。
- 不重写 Dashboard 视觉系统；本 spec 聚焦产品能力成熟度，不做大规模品牌 redesign。
- 不把所有历史 API 一次性改成 breaking contract；需要保留兼容期和迁移路径。

## 4. Requirements / 需求项

- R1: 后端必须新增本地用户 read/write model，至少包含 user id、displayName、role、status、createdAt、lastLoginAt。
- R2: 角色必须至少包含 `owner`、`admin`、`operator`、`viewer`，并定义每个角色可执行的 Dashboard 操作范围。
- R3: 首次启动必须有 owner bootstrap 路径，可由 `haro setup` 或首次 Web 访问创建第一个 owner。
- R4: 认证必须从单一 `HARO_WEB_API_KEY` 兼容迁移到 user token/session token；旧 API key 可作为 bootstrap/legacy 模式保留但不得作为长期唯一模型。
- R5: 用户管理页面必须支持用户列表、创建用户、禁用/启用用户、重置 token、查看最近登录和审计摘要。
- R6: 服务端列表 API 必须统一分页 contract：`page`、`pageSize`、`sort`、`order`、`q`、domain filters；响应包含 `items`、`pageInfo`、`total`。
- R7: 前端列表组件必须统一支持分页、筛选、排序、loading、empty、error、retry 状态。
- R8: Sessions、Logs、Knowledge、Skills 等大数据量页面不得只做前端内存分页；必须使用服务端分页。
- R9: 所有用户可见文案必须从 i18n resources 读取，默认语言为 `zh-CN`，保留 `en-US` fallback。
- R10: 页面文案必须完成中文产品化表达，避免直接暴露未解释的内部字段名、异常栈或英文占位符。
- R11: 高风险操作（删除 session、修改配置、禁用 channel、重置 token 等）必须接入角色权限检查和 audit event。
- R12: 前端路由、导航、表格列和表单 validation 必须能根据用户角色隐藏或禁用不可执行动作。

## 5. Design / 设计要点

### 5.1 Local user model

建议新增 SQLite 表：

```sql
CREATE TABLE web_users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE web_user_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  label TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);
```

Phase 1 可以先采用 user token/session token，不引入密码登录；首次 owner token 由 setup 或 bootstrap 页面生成并只显示一次。

### 5.2 Pagination contract

统一请求：

```http
GET /api/v1/sessions?page=1&pageSize=25&sort=createdAt&order=desc&q=...
```

统一响应：

```typescript
interface PaginatedResponse<T> {
  items: T[];
  pageInfo: {
    page: number;
    pageSize: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
  total: number;
}
```

### 5.3 i18n baseline

资源结构建议：

```
packages/web/src/i18n/
├── locales/
│   ├── zh-CN.ts
│   └── en-US.ts
└── keys.ts
```

规则：

- 新页面不得直接写用户可见硬编码文案。
- 技术字段允许保留英文标识，但必须配中文标签或 tooltip。
- API error 应映射为本地化错误摘要，详情可折叠展示。

### 5.4 Permission and audit integration

Dashboard 操作统一转换为 operation class：

- read-only: viewer 可执行。
- local-write: operator 及以上。
- config-write / token-reset / user-disable: admin 及以上。
- owner-transfer / bootstrap-reset: owner only。

所有写操作记录 audit event：actor、target、operation、result、createdAt。

## 6. Acceptance Criteria / 验收标准

- AC1: 给定首次启动且没有用户，当访问 Dashboard 或运行 `haro setup` 时，应能创建第一个 owner，并获得一次性 token。（对应 R1、R3-R4）
- AC2: 给定 viewer 用户，当访问 Settings 或 User Management 时，应能查看允许的只读信息，但保存、禁用、删除类动作不可执行。（对应 R2、R11-R12）
- AC3: 给定 Sessions 超过 100 条，当访问 Sessions 页面时，应通过服务端分页加载，并能切换页码、pageSize、排序和搜索。（对应 R6-R8）
- AC4: 给定 Logs/Knowledge/Skills 列表，当输入筛选条件时，应调用统一分页 API，而不是一次性拉取全部数据后前端过滤。（对应 R6-R8）
- AC5: 给定默认 locale `zh-CN`，Dashboard 导航、表格、按钮、空态、错误态、表单校验应显示中文文案；切换 `en-US` 时可回退英文资源。（对应 R9-R10）
- AC6: 给定 admin 重置用户 token，当操作成功时，应写入 audit event，并能在用户详情或审计摘要中看到记录。（对应 R5、R11）
- AC7: 给定旧 `HARO_WEB_API_KEY` 环境变量仍存在，Dashboard 应提供兼容访问或迁移提示，不应让已有部署直接失效。（对应 R4）

## 7. Test Plan / 测试计划

- 后端 API 测试：users CRUD、token hash/revoke、role guard、audit event、pagination query。
- 前端测试：User Management、PaginatedTable、filter/sort/page state、role-based action disable。
- i18n 测试：新增页面没有硬编码用户可见字符串；`zh-CN` keys 覆盖主路径。
- E2E 测试：bootstrap owner、viewer 只读、admin 重置 token、Sessions 服务端分页。
- 回归测试：旧 `HARO_WEB_API_KEY` 模式、Chat/Sessions/WebSocket auth 不被破坏。

## 8. Open Questions / 待定问题

- Q1: Phase 1 是否采用“token-only 本地用户”，还是需要引入用户名密码登录？
- Q2: owner bootstrap 入口以 `haro setup` 为主，还是允许首次 Web 页面创建？
- Q3: 分页 contract 是否统一使用 page/pageSize，还是对日志类页面采用 cursor pagination？

## 9. Changelog / 变更记录

- 2026-04-25: Codex — 初稿，补齐 Dashboard 多用户、服务端分页和中文本地化产品成熟度规划。
