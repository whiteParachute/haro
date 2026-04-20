export type SkillSourceKind = 'preinstalled' | 'user';
export type SkillHandlerKind =
  | 'memory-remember'
  | 'memory-query'
  | 'memory-wrapup'
  | 'memory-maintain'
  | 'memory-status'
  | 'prompt';

export interface SkillManifestEntry {
  id: string;
  source: SkillSourceKind;
  originalSource: string;
  pinnedCommit: string;
  license: string;
  installedAt: string;
  isPreinstalled: boolean;
  enabled: boolean;
  path: string;
  keywords?: string[];
  handler?: SkillHandlerKind;
  resolvedFrom?: string;
  description?: string;
}

export interface InstalledSkillsManifest {
  version: 1;
  skills: Record<string, SkillManifestEntry>;
}

export interface SkillDescriptor {
  id: string;
  description: string;
  content: string;
}

export interface SkillUsageRow {
  skillId: string;
  installSource: string;
  installedAt: string;
  lastUsedAt?: string;
  useCount: number;
  isPreinstalled: boolean;
}

export interface SkillResolution {
  skillId: string;
  args: string;
  trigger: 'explicit' | 'description';
}

export interface SkillPrepareResult {
  matchedSkillId?: string;
  trigger?: 'explicit' | 'description';
  finalTask?: string;
  directOutput?: string;
}

export interface SkillCommandResult {
  output: string;
}
