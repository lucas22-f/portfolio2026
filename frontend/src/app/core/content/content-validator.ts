export type PortfolioKind = 'profile' | 'experience' | 'education' | 'skill' | 'project';

export interface PortfolioClaim {
  claim_id: string;
  text: string;
  provenance_id: string;
}

export interface ProjectDetails {
  summary: string;
  links?: ReadonlyArray<{ label: string; url: string }>;
}

export interface PortfolioRecord {
  id: string;
  kind: PortfolioKind;
  title: string;
  claims: ReadonlyArray<PortfolioClaim>;
  tags: ReadonlyArray<string>;
  aliases: ReadonlyArray<string>;
  project?: ProjectDetails;
  provenance: ReadonlyArray<string>;
}

export interface PortfolioContent {
  schema_version: '1.0.0';
  content_version: string;
  locale: 'es';
  records: ReadonlyArray<PortfolioRecord>;
}

export interface ReviewedManifest {
  schema_version: '1.0.0';
  content_version: string;
  sources: ReadonlyArray<ReviewedSource>;
  entries: ReadonlyArray<ProvenanceLocator>;
}

interface ReviewedSource {
  source_id: string;
  file_name: string;
  source_sha256: string;
  source_text_sha256: string;
  page_count: number;
}

interface ProvenanceLocator {
  provenance_id: string;
  source_id: string;
  source_sha256: string;
  page: number;
  normalized_start: number;
  normalized_end: number;
  excerpt_sha256: string;
  reviewed_at: string;
  reviewer: string;
}

export interface SourceText {
  schema_version: '1.0.0';
  normalization: 'unicode-nfc-explicit-whitespace-utf8-offsets-v1';
  source_id: string;
  file_name: string;
  source_sha256: string;
  pages: ReadonlyArray<SourcePage>;
}

interface SourcePage {
  page: number;
  normalized_text: string;
  normalized_sha256: string;
}

export interface ValidatedContentBundle {
  contentVersion: string;
  portfolio: PortfolioContent;
  manifest: ReviewedManifest;
  sourceText: SourceText;
}

const kinds = new Set<PortfolioKind>(['profile', 'experience', 'education', 'skill', 'project']);
const identifierPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const sha256Pattern = /^[0-9a-f]{64}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const whitespacePattern = /[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/gu;

export function normalizeContentText(value: string): string {
  return value.normalize('NFC').replace(whitespacePattern, ' ').replace(/^ +| +$/gu, '');
}

async function sha256Bytes(value: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', Uint8Array.from(value).buffer);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256(value: string): Promise<string> {
  return sha256Bytes(new TextEncoder().encode(value));
}

export async function verifyProvenanceLocator(
  pageText: string,
  normalizedStart: number,
  normalizedEnd: number,
  excerptSha256: string,
): Promise<boolean> {
  const bytes = new TextEncoder().encode(normalizeContentText(pageText));
  if (normalizedStart < 0 || normalizedStart >= normalizedEnd || normalizedEnd > bytes.length) {
    return false;
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(normalizedStart, normalizedEnd));
  } catch {
    return false;
  }
  return (await sha256Bytes(bytes.slice(normalizedStart, normalizedEnd))) === excerptSha256;
}

function canonicalize(value: unknown, stripContentVersion = true): unknown {
  if (Array.isArray(value)) return value.map((child) => canonicalize(child, stripContentVersion));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !stripContentVersion || key !== 'content_version')
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, canonicalize(child, stripContentVersion)]),
    );
  }
  return value;
}

export async function computeContentVersion(portfolio: unknown, manifest: unknown): Promise<string> {
  return sha256(JSON.stringify(canonicalize({ manifest, portfolio })));
}

export async function computeSourceTextHash(sourceText: unknown): Promise<string> {
  return sha256(JSON.stringify(canonicalize(sourceText, false)));
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  label: string,
  required: ReadonlyArray<string>,
  optional: ReadonlyArray<string> = [],
): void {
  const allowed = new Set([...required, ...optional]);
  const extra = Object.keys(value).find((key) => !allowed.has(key));
  const missing = required.find((key) => !Object.hasOwn(value, key));
  if (extra !== undefined) throw new Error(`${label} has additional property: ${extra}`);
  if (missing !== undefined) throw new Error(`${label}.${missing} is required.`);
}

function stringValue(value: unknown, label: string, pattern?: RegExp): string {
  if (typeof value !== 'string' || value.length === 0 || (pattern && !pattern.test(value))) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function integerValue(value: unknown, label: string, minimum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum) throw new Error(`${label} is invalid.`);
  return value as number;
}

function arrayValue(value: unknown, label: string): ReadonlyArray<unknown> {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} is invalid.`);
  return value;
}

function stringList(value: unknown, label: string, identifiers = false): ReadonlyArray<string> {
  const result = arrayValue(value, label).map((item) =>
    stringValue(item, `${label}[]`, identifiers ? identifierPattern : undefined),
  );
  if (new Set(result).size !== result.length) throw new Error(`${label} must be unique.`);
  return result;
}

function parseProject(value: unknown): ProjectDetails {
  const project = requireObject(value, 'record.project');
  exactKeys(project, 'record.project', ['summary'], ['links']);
  const result: ProjectDetails = { summary: stringValue(project['summary'], 'record.project.summary') };
  if (Object.hasOwn(project, 'links')) {
    result.links = arrayValue(project['links'], 'record.project.links').map((item) => {
      const link = requireObject(item, 'record.project.links[]');
      exactKeys(link, 'record.project.links[]', ['label', 'url']);
      return {
        label: stringValue(link['label'], 'record.project.links[].label'),
        url: stringValue(link['url'], 'record.project.links[].url', /^https:\/\//),
      };
    });
  }
  return result;
}

function parsePortfolio(value: unknown): PortfolioContent {
  const portfolio = requireObject(value, 'portfolio');
  exactKeys(portfolio, 'portfolio', ['schema_version', 'content_version', 'locale', 'records']);
  if (portfolio['schema_version'] !== '1.0.0' || portfolio['locale'] !== 'es') {
    throw new Error('Unsupported portfolio contract.');
  }
  const recordIds = new Set<string>();
  const claimIds = new Set<string>();
  const records = arrayValue(portfolio['records'], 'portfolio.records').map((item) => {
    const record = requireObject(item, 'record');
    exactKeys(record, 'record', ['id', 'kind', 'title', 'claims', 'tags', 'aliases', 'provenance'], ['project']);
    const id = stringValue(record['id'], 'record.id', identifierPattern);
    const kind = stringValue(record['kind'], 'record.kind') as PortfolioKind;
    if (recordIds.has(id) || !kinds.has(kind)) throw new Error(`Invalid portfolio record: ${id}`);
    recordIds.add(id);
    const claims = arrayValue(record['claims'], 'record.claims').map((claimInput) => {
      const claim = requireObject(claimInput, 'claim');
      exactKeys(claim, 'claim', ['claim_id', 'text', 'provenance_id']);
      const claimId = stringValue(claim['claim_id'], 'claim.claim_id', identifierPattern);
      if (claimIds.has(claimId)) throw new Error(`Duplicate claim identifier: ${claimId}`);
      claimIds.add(claimId);
      return {
        claim_id: claimId,
        text: stringValue(claim['text'], 'claim.text'),
        provenance_id: stringValue(claim['provenance_id'], 'claim.provenance_id', identifierPattern),
      };
    });
    if ((kind === 'project') !== Object.hasOwn(record, 'project')) {
      throw new Error(`Project details mismatch: ${id}`);
    }
    const parsed: PortfolioRecord = {
      id,
      kind,
      title: stringValue(record['title'], 'record.title'),
      claims,
      tags: stringList(record['tags'], 'record.tags'),
      aliases: stringList(record['aliases'], 'record.aliases'),
      provenance: stringList(record['provenance'], 'record.provenance', true),
    };
    if (kind === 'project') parsed.project = parseProject(record['project']);
    return parsed;
  });
  return {
    schema_version: '1.0.0',
    content_version: stringValue(portfolio['content_version'], 'portfolio.content_version', sha256Pattern),
    locale: 'es',
    records,
  };
}

function parseManifest(value: unknown): ReviewedManifest {
  const manifest = requireObject(value, 'manifest');
  exactKeys(manifest, 'manifest', ['schema_version', 'content_version', 'sources', 'entries']);
  if (manifest['schema_version'] !== '1.0.0') throw new Error('Unsupported manifest contract.');
  const sources = arrayValue(manifest['sources'], 'manifest.sources').map((item) => {
    const source = requireObject(item, 'source');
    exactKeys(source, 'source', ['source_id', 'file_name', 'source_sha256', 'source_text_sha256', 'page_count']);
    return {
      source_id: stringValue(source['source_id'], 'source.source_id', identifierPattern),
      file_name: stringValue(source['file_name'], 'source.file_name'),
      source_sha256: stringValue(source['source_sha256'], 'source.source_sha256', sha256Pattern),
      source_text_sha256: stringValue(source['source_text_sha256'], 'source.source_text_sha256', sha256Pattern),
      page_count: integerValue(source['page_count'], 'source.page_count', 1),
    };
  });
  if (new Set(sources.map((source) => source.source_id)).size !== sources.length) {
    throw new Error('manifest.sources identifiers must be unique.');
  }
  if (sources.length !== 1) {
    throw new Error('The bundle requires exactly one manifest source.');
  }
  const entries = arrayValue(manifest['entries'], 'manifest.entries').map((item) => {
    const entry = requireObject(item, 'entry');
    exactKeys(entry, 'entry', ['provenance_id', 'source_id', 'source_sha256', 'page', 'normalized_start', 'normalized_end', 'excerpt_sha256', 'reviewed_at', 'reviewer']);
    return {
      provenance_id: stringValue(entry['provenance_id'], 'entry.provenance_id', identifierPattern),
      source_id: stringValue(entry['source_id'], 'entry.source_id', identifierPattern),
      source_sha256: stringValue(entry['source_sha256'], 'entry.source_sha256', sha256Pattern),
      page: integerValue(entry['page'], 'entry.page', 1),
      normalized_start: integerValue(entry['normalized_start'], 'entry.normalized_start', 0),
      normalized_end: integerValue(entry['normalized_end'], 'entry.normalized_end', 1),
      excerpt_sha256: stringValue(entry['excerpt_sha256'], 'entry.excerpt_sha256', sha256Pattern),
      reviewed_at: stringValue(entry['reviewed_at'], 'entry.reviewed_at', datePattern),
      reviewer: stringValue(entry['reviewer'], 'entry.reviewer'),
    };
  });
  return {
    schema_version: '1.0.0',
    content_version: stringValue(manifest['content_version'], 'manifest.content_version', sha256Pattern),
    sources,
    entries,
  };
}

function parseSourceText(value: unknown): SourceText {
  const source = requireObject(value, 'sourceText');
  exactKeys(source, 'sourceText', ['schema_version', 'normalization', 'source_id', 'file_name', 'source_sha256', 'pages']);
  if (source['schema_version'] !== '1.0.0' || source['normalization'] !== 'unicode-nfc-explicit-whitespace-utf8-offsets-v1') {
    throw new Error('Unsupported source text contract.');
  }
  return {
    schema_version: '1.0.0',
    normalization: 'unicode-nfc-explicit-whitespace-utf8-offsets-v1',
    source_id: stringValue(source['source_id'], 'sourceText.source_id', identifierPattern),
    file_name: stringValue(source['file_name'], 'sourceText.file_name'),
    source_sha256: stringValue(source['source_sha256'], 'sourceText.source_sha256', sha256Pattern),
    pages: arrayValue(source['pages'], 'sourceText.pages').map((item) => {
      const page = requireObject(item, 'sourceText.page');
      exactKeys(page, 'sourceText.page', ['page', 'normalized_text', 'normalized_sha256']);
      return {
        page: integerValue(page['page'], 'sourceText.page.page', 1),
        normalized_text: stringValue(page['normalized_text'], 'sourceText.page.normalized_text'),
        normalized_sha256: stringValue(page['normalized_sha256'], 'sourceText.page.normalized_sha256', sha256Pattern),
      };
    }),
  };
}

export async function validateContentBundle(
  portfolioInput: unknown,
  manifestInput: unknown,
  sourceTextInput: unknown,
): Promise<ValidatedContentBundle> {
  const portfolio = parsePortfolio(portfolioInput);
  const manifest = parseManifest(manifestInput);
  const sourceText = parseSourceText(sourceTextInput);
  const sources = new Map(manifest.sources.map((source) => [source.source_id, source]));
  const source = manifest.sources[0];
  if (source.source_id !== sourceText.source_id || source.file_name !== sourceText.file_name || source.source_sha256 !== sourceText.source_sha256) {
    throw new Error('Checked-in source text does not match the manifest source.');
  }
  if (source.source_text_sha256 !== (await computeSourceTextHash(sourceText))) {
    throw new Error('Checked-in source text hash does not match the manifest.');
  }
  const pages = new Map<number, SourcePage>();
  for (const page of sourceText.pages) {
    if (pages.has(page.page) || normalizeContentText(page.normalized_text) !== page.normalized_text || (await sha256(page.normalized_text)) !== page.normalized_sha256) {
      throw new Error(`Invalid checked-in source text page: ${page.page}`);
    }
    pages.set(page.page, page);
  }
  if (source.page_count !== pages.size) throw new Error('Source page count mismatch.');

  const provenanceIds = new Set<string>();
  for (const entry of manifest.entries) {
    if (entry.source_id !== sourceText.source_id) {
      throw new Error(`Provenance source mismatch with checked source text: ${entry.provenance_id}`);
    }
    const entrySource = sources.get(entry.source_id);
    const page = pages.get(entry.page);
    if (provenanceIds.has(entry.provenance_id) || !entrySource || !page || entry.source_sha256 !== entrySource.source_sha256 || !(await verifyProvenanceLocator(page.normalized_text, entry.normalized_start, entry.normalized_end, entry.excerpt_sha256))) {
      throw new Error(`Invalid provenance locator: ${entry.provenance_id}`);
    }
    provenanceIds.add(entry.provenance_id);
  }
  for (const record of portfolio.records) {
    const claimProvenance = new Set(record.claims.map((claim) => claim.provenance_id));
    for (const provenanceId of claimProvenance) {
      if (!provenanceIds.has(provenanceId)) throw new Error(`Unknown provenance reference: ${provenanceId}`);
    }
    if (claimProvenance.size !== record.provenance.length || record.provenance.some((id) => !claimProvenance.has(id))) {
      throw new Error(`Record provenance does not match claims: ${record.id}`);
    }
  }
  if (portfolio.content_version !== manifest.content_version || portfolio.content_version !== (await computeContentVersion(portfolio, manifest))) {
    throw new Error('Content version mismatch.');
  }
  return { contentVersion: portfolio.content_version, portfolio, manifest, sourceText };
}
