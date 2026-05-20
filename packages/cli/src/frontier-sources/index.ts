import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import {
  FrontierSignalSchema,
  type FrontierConfidence,
  type FrontierSignal,
  type FrontierSourceType,
  type FrontierTargetDomain,
} from '@haro/agentdock-contract';

export type FrontierSourceStatus = 'loaded' | 'skipped' | 'error';

export interface FrontierSourceSummary {
  id: string;
  type: string;
  status: FrontierSourceStatus;
  signalCount: number;
  reason?: string;
}

export interface FrontierSourceCollectionResult {
  signals: FrontierSignal[];
  sourceSummaries: FrontierSourceSummary[];
}

type SourceConfig = GithubReleasesSourceConfig | RssFeedSourceConfig | HackerNewsTopstoriesSourceConfig;

type JsonRecord = Record<string, unknown>;

interface BaseSourceConfig {
  id: string;
  type: string;
  enabled?: boolean;
  limit?: number;
  targetDomains?: FrontierTargetDomain[];
  confidence?: FrontierConfidence;
  sourceType?: FrontierSourceType;
  keywords?: string[];
  timeoutMs?: number;
}

interface GithubReleasesSourceConfig extends BaseSourceConfig {
  type: 'github-releases';
  repo: string;
  tokenEnv?: string;
}

interface RssFeedSourceConfig extends BaseSourceConfig {
  type: 'rss-feed';
  url: string;
}

interface HackerNewsTopstoriesSourceConfig extends BaseSourceConfig {
  type: 'hacker-news-topstories';
  minScore?: number;
}

interface CollectInput {
  configPath: string;
  now: () => Date;
  fetchImpl?: typeof fetch;
}

export async function collectFrontierSignalsFromConfig(input: CollectInput): Promise<FrontierSourceCollectionResult> {
  const raw = readConfigFile(input.configPath);
  if (!raw) {
    return {
      signals: [],
      sourceSummaries: [{ id: 'frontier-sources', type: 'config', status: 'skipped', signalCount: 0, reason: 'config-not-found' }],
    };
  }

  const staticSignals = parseStaticSignals(raw, input.configPath);
  const sources = parseSourceConfigs(raw, input.configPath);
  const signals = [...staticSignals];
  const sourceSummaries: FrontierSourceSummary[] = [];
  if (staticSignals.length > 0) {
    sourceSummaries.push({ id: 'curated-signals', type: 'static', status: 'loaded', signalCount: staticSignals.length });
  }

  for (const source of sources) {
    if (source.enabled === false) {
      sourceSummaries.push({ id: source.id, type: source.type, status: 'skipped', signalCount: 0, reason: 'disabled' });
      continue;
    }
    try {
      const collected = await collectFromSource(source, input);
      signals.push(...collected);
      sourceSummaries.push({ id: source.id, type: source.type, status: 'loaded', signalCount: collected.length });
    } catch (error) {
      sourceSummaries.push({
        id: source.id,
        type: source.type,
        status: 'error',
        signalCount: 0,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { signals, sourceSummaries };
}

function readConfigFile(path: string): unknown | undefined {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function parseStaticSignals(raw: unknown, path: string): FrontierSignal[] {
  const items = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw.signals)
      ? raw.signals
      : [];
  return items.map((item, index) => parseSignal(item, `${path}#signals[${index}]`));
}

function parseSourceConfigs(raw: unknown, path: string): SourceConfig[] {
  if (Array.isArray(raw)) return [];
  if (!isRecord(raw)) {
    throw new Error(`Invalid frontier source config at ${path}; expected FrontierSignal[] or { signals?: [], sources?: [] }.`);
  }
  const sources = raw.sources;
  if (sources === undefined) return [];
  if (!Array.isArray(sources)) {
    throw new Error(`Invalid frontier source config at ${path}; sources must be an array.`);
  }
  return sources.map((source, index) => parseSourceConfig(source, `${path}#sources[${index}]`));
}

function parseSourceConfig(value: unknown, label: string): SourceConfig {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.type !== 'string') {
    throw new Error(`Invalid frontier source config at ${label}; each source needs id and type.`);
  }
  const base = {
    id: value.id,
    type: value.type,
    ...(typeof value.enabled === 'boolean' ? { enabled: value.enabled } : {}),
    ...(typeof value.limit === 'number' ? { limit: value.limit } : {}),
    ...(Array.isArray(value.targetDomains) ? { targetDomains: value.targetDomains as FrontierTargetDomain[] } : {}),
    ...(typeof value.confidence === 'string' ? { confidence: value.confidence as FrontierConfidence } : {}),
    ...(typeof value.sourceType === 'string' ? { sourceType: value.sourceType as FrontierSourceType } : {}),
    ...(Array.isArray(value.keywords) ? { keywords: value.keywords.filter((item): item is string => typeof item === 'string') } : {}),
    ...(typeof value.timeoutMs === 'number' ? { timeoutMs: value.timeoutMs } : {}),
  };
  if (value.type === 'github-releases') {
    if (typeof value.repo !== 'string') throw new Error(`Invalid github-releases source at ${label}; repo is required.`);
    return { ...base, type: 'github-releases', repo: value.repo, ...(typeof value.tokenEnv === 'string' ? { tokenEnv: value.tokenEnv } : {}) };
  }
  if (value.type === 'rss-feed') {
    if (typeof value.url !== 'string') throw new Error(`Invalid rss-feed source at ${label}; url is required.`);
    return { ...base, type: 'rss-feed', url: value.url };
  }
  if (value.type === 'hacker-news-topstories') {
    return { ...base, type: 'hacker-news-topstories', ...(typeof value.minScore === 'number' ? { minScore: value.minScore } : {}) };
  }
  throw new Error(`Unsupported frontier source type '${value.type}' at ${label}.`);
}

async function collectFromSource(source: SourceConfig, input: CollectInput): Promise<FrontierSignal[]> {
  if (source.type === 'github-releases') return collectGithubReleases(source, input);
  if (source.type === 'rss-feed') return collectRssFeed(source, input);
  return collectHackerNewsTopstories(source, input);
}

async function collectGithubReleases(source: GithubReleasesSourceConfig, input: CollectInput): Promise<FrontierSignal[]> {
  const perPage = boundedLimit(source.limit, 5, 20);
  const headers: Record<string, string> = { accept: 'application/vnd.github+json' };
  if (source.tokenEnv && process.env[source.tokenEnv]) headers.authorization = `Bearer ${process.env[source.tokenEnv]}`;
  const repoPath = source.repo.split('/').map((part) => encodeURIComponent(part)).join('/');
  const releases = await fetchJson<unknown[]>(
    `https://api.github.com/repos/${repoPath}/releases?per_page=${perPage}`,
    source,
    input,
    headers,
  );
  return releases
    .filter(isRecord)
    .map((release) => {
      const uri = stringValue(release.html_url) ?? `https://github.com/${source.repo}/releases`;
      const publishedAt = isoDateTime(stringValue(release.published_at) ?? stringValue(release.created_at));
      return makeSignal(source, input, {
        uri,
        publishedAt,
        title: stringValue(release.name) ?? stringValue(release.tag_name) ?? `${source.repo} release`,
        summary: textSummary(stringValue(release.body), `GitHub release ${stringValue(release.tag_name) ?? uri}`),
        claims: [`${source.repo} 发布了 ${stringValue(release.tag_name) ?? '新版本'}。`],
        sourceType: 'repo-release',
        refKind: 'repo-release',
      });
    })
    .filter(matchesKeywords(source));
}

async function collectRssFeed(source: RssFeedSourceConfig, input: CollectInput): Promise<FrontierSignal[]> {
  const xml = await fetchText(source.url, source, input);
  const entries = parseFeedEntries(xml).slice(0, boundedLimit(source.limit, 10, 30));
  return entries
    .map((entry) => makeSignal(source, input, {
      uri: entry.link || source.url,
      publishedAt: isoDateTime(entry.publishedAt),
      title: entry.title || source.id,
      summary: textSummary(entry.summary, entry.title || source.url),
      claims: [entry.title || `Source ${source.id} published a new entry.`],
      sourceType: source.sourceType ?? 'official-doc',
      refKind: source.sourceType ?? 'official-doc',
    }))
    .filter(matchesKeywords(source));
}

async function collectHackerNewsTopstories(source: HackerNewsTopstoriesSourceConfig, input: CollectInput): Promise<FrontierSignal[]> {
  const topIds = await fetchJson<unknown[]>('https://hacker-news.firebaseio.com/v0/topstories.json', source, input);
  const ids = topIds.filter((id): id is number => typeof id === 'number').slice(0, boundedLimit(source.limit, 30, 60));
  const minScore = source.minScore ?? 100;
  const signals: FrontierSignal[] = [];
  for (const id of ids) {
    const item = await fetchJson<unknown>(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, source, input);
    if (!isRecord(item) || item.type !== 'story') continue;
    const score = typeof item.score === 'number' ? item.score : 0;
    if (score < minScore) continue;
    const title = stringValue(item.title) ?? `Hacker News story ${id}`;
    const uri = stringValue(item.url) ?? `https://news.ycombinator.com/item?id=${id}`;
    const publishedAt = typeof item.time === 'number' ? new Date(item.time * 1000).toISOString() : input.now().toISOString();
    const signal = makeSignal(source, input, {
      uri,
      publishedAt,
      title,
      summary: `Hacker News 高分讨论：${title}`,
      claims: [`Hacker News score=${score}，可作为外部线索，仍需追到一手来源后再提升置信度。`],
      sourceType: source.sourceType ?? 'blog-post',
      refKind: 'hacker-news-story',
      rawUri: `https://news.ycombinator.com/item?id=${id}`,
    });
    signals.push(signal);
  }
  return signals.filter(matchesKeywords(source));
}

async function fetchJson<T>(url: string, source: BaseSourceConfig, input: CollectInput, headers?: Record<string, string>): Promise<T> {
  const response = await fetchWithTimeout(url, source, input, headers);
  return await response.json() as T;
}

async function fetchText(url: string, source: BaseSourceConfig, input: CollectInput): Promise<string> {
  const response = await fetchWithTimeout(url, source, input);
  return await response.text();
}

async function fetchWithTimeout(
  url: string,
  source: BaseSourceConfig,
  input: CollectInput,
  headers?: Record<string, string>,
): Promise<Response> {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) throw new Error('global fetch is not available');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), source.timeoutMs ?? 8000);
  try {
    const response = await fetchImpl(url, { headers, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

function makeSignal(
  source: BaseSourceConfig,
  input: CollectInput,
  data: {
    uri: string;
    publishedAt: string;
    title: string;
    summary: string;
    claims: string[];
    sourceType: FrontierSourceType;
    refKind: string;
    rawUri?: string;
  },
): FrontierSignal {
  const id = `frontier_${hash(`${source.id}:${data.uri}:${data.publishedAt}`).slice(0, 24)}`;
  return parseSignal({
    id,
    sourceType: data.sourceType,
    sourceRef: { id: `${source.id}:${hash(data.uri).slice(0, 12)}`, kind: data.refKind, uri: data.uri },
    title: data.title,
    publishedAt: data.publishedAt,
    collectedAt: input.now().toISOString(),
    summary: data.summary,
    claims: data.claims,
    targetDomains: source.targetDomains ?? ['haro-sidecar'],
    confidence: source.confidence ?? (data.sourceType === 'repo-release' || data.sourceType === 'official-doc' ? 'high' : 'medium'),
    rawRef: { id: `${source.id}:raw`, kind: source.type, uri: data.rawUri ?? data.uri },
    status: 'active',
  }, source.id);
}

function parseSignal(value: unknown, label: string): FrontierSignal {
  const parsed = FrontierSignalSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const details = parsed.error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '(root)'}: ${issue.message}`)
    .join('; ');
  throw new Error(`Invalid FrontierSignal at ${label}: ${details}`);
}

function matchesKeywords(source: BaseSourceConfig): (signal: FrontierSignal) => boolean {
  const keywords = source.keywords?.map((keyword) => keyword.toLowerCase()).filter(Boolean) ?? [];
  if (keywords.length === 0) return () => true;
  return (signal) => {
    const haystack = `${signal.title}\n${signal.summary}\n${signal.claims.join('\n')}`.toLowerCase();
    return keywords.some((keyword) => haystack.includes(keyword));
  };
}

function parseFeedEntries(xml: string): Array<{ title: string; link: string; publishedAt: string; summary: string }> {
  const rssItems = matchBlocks(xml, 'item').map((block) => ({
    title: stripXml(readTag(block, 'title')),
    link: stripXml(readTag(block, 'link')),
    publishedAt: readTag(block, 'pubDate') || readTag(block, 'updated') || readTag(block, 'published'),
    summary: stripXml(readTag(block, 'description') || readTag(block, 'summary') || readTag(block, 'content')),
  }));
  if (rssItems.length > 0) return rssItems;
  return matchBlocks(xml, 'entry').map((block) => ({
    title: stripXml(readTag(block, 'title')),
    link: readAtomLink(block),
    publishedAt: readTag(block, 'published') || readTag(block, 'updated'),
    summary: stripXml(readTag(block, 'summary') || readTag(block, 'content')),
  }));
}

function matchBlocks(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi'))].map((match) => match[1] ?? '');
}

function readTag(xml: string, tag: string): string {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(xml);
  return decodeXml(match?.[1]?.trim() ?? '');
}

function readAtomLink(xml: string): string {
  const href = /<link\b[^>]*href=["']([^"']+)["'][^>]*>/i.exec(xml)?.[1];
  return decodeXml(href ?? '');
}

function stripXml(value: string): string {
  return decodeXml(value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function textSummary(value: string | undefined, fallback: string): string {
  const text = stripXml(value ?? '').slice(0, 500).trim();
  return text || fallback;
}

function isoDateTime(value: string | undefined): string {
  if (!value) return new Date(0).toISOString();
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? new Date(0).toISOString() : new Date(timestamp).toISOString();
}

function boundedLimit(value: number | undefined, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return fallback;
  return Math.min(value, max);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
