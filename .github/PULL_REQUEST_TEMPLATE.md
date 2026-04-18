<!--
提交前自查：
1. PR 标题是否含 spec ID？ 例：[FEAT-003] Pluggable Provider Registry
2. 下方 "关联 Spec" 是否已填？
3. 所有 AC 是否已有测试覆盖？CI 是否通过？
4. 相关 docs/ 是否同步更新？

流程规范见 specs/README.md。
-->

## 关联 Spec

<!-- 必填。贴 spec 相对路径，多个则全列。 -->

- `specs/phase-0/FEAT-XXX-<slug>.md`

## Summary

<!-- 1-3 句话说明这个 PR 做了什么，不是怎么做。 -->

## 覆盖的 Requirements / Acceptance Criteria

<!-- 列出本 PR 实现或验证的编号。 -->

- Implements: `R1`, `R2`
- Verifies: `AC1`, `AC2`

## Test plan

<!-- 对应 spec Test Plan 章节的实际落地。 -->

- [ ] 单元测试：`<文件/用例名>`
- [ ] 集成测试：`<场景>`
- [ ] 手动验证：`<步骤>`

## docs 同步

<!-- 与 spec 相关的 docs/ 是否同步更新？没有变化请写 N/A。 -->

- [ ] `docs/<...>` 已同步
- [ ] N/A

## Checklist

- [ ] spec status 已改为 `in-progress`（开工时）或 `done`（合入时）
- [ ] commit message 含 `spec: <ID>#<R/AC>` 标签
- [ ] 核心模块无 `providerId === 'xxx'` / `channelId === 'xxx'` 这类硬编码特判
- [ ] 无未解决的 Open Questions
- [ ] CI 全绿
