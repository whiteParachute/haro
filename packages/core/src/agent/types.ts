/**
 * FEAT-004 R1 — minimal AgentConfig surface.
 *
 * Intentionally narrow. We do NOT carry "role / goal / backstory" or any
 * persona-shaped fields (multi-agent constraint ⑤: capability is decided by
 * tools, not by descriptive labels). New fields require a spec change, not a
 * config-driven extension.
 */
export interface AgentConfig {
  id: string;
  name: string;
  systemPrompt: string;
  tools?: readonly string[];
  defaultProvider?: string;
  defaultModel?: string;
}
