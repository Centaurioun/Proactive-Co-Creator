import {
  childElements,
  failParse,
  findDescendant,
  hasForbiddenControlCharacter,
  ParseFault,
  parseXml,
  textContent,
  type EpubFailureStatus,
  type XmlElement,
  type XmlNodeBudget,
} from './epubXmlParser.ts';

/**
 * Non-mutating EPUB traversal candidate. ZIP validation and inflation stay behind
 * BoundedArchiveReader so this module cannot touch the filesystem or network.
 */
export type EpubCompression = 'stored' | 'deflate' | 'unsupported';

export interface BoundedArchiveEntry {
  /** Normalized file member name using forward slashes; directory entries are omitted. */
  path: string;
  compressedBytes: number;
  uncompressedBytes: number;
  compression: EpubCompression;
  encrypted: boolean;
}

export interface BoundedArchiveReader {
  /** Compressed archive byte length, checked before any member is read. */
  archiveBytes: number;
  /**
   * Validated file entries in physical ZIP local-header order (not central-directory
   * order). The adapter must prove that ordering from local headers and validate
   * that the first entry is the stored, unencrypted `mimetype` with no local-header
   * extra field. The core checks list order and declared method/encryption metadata,
   * but cannot independently inspect ZIP headers or prove absence of extra fields.
   */
  entries(): readonly BoundedArchiveEntry[];
  /**
   * Reads exactly one validated member and must honor maxBytes before returning it.
   * The shared adapter must validate ZIP structure/CRC, reject unsafe names and
   * encryption as appropriate, and never write members to disk.
   */
  readEntry(path: string, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array>;
}

export interface EpubParseLimits {
  maxArchiveBytes: number;
  maxEntries: number;
  maxPathLength: number;
  maxMemberBytes: number;
  maxExpandedBytes: number;
  maxTextBytes: number;
  maxSpineItems: number;
  maxBlocks: number;
  maxXmlNodes: number;
  maxXmlDepth: number;
  maxCompressionRatio: number;
}

/** Candidate limits mirror the established import bounds; reconcile with the shared reader before integration. */
export const DEFAULT_EPUB_PARSE_LIMITS: Readonly<EpubParseLimits> = Object.freeze({
  maxArchiveBytes: 12 * 1024 * 1024,
  maxEntries: 512,
  maxPathLength: 1024,
  maxMemberBytes: 12 * 1024 * 1024,
  maxExpandedBytes: 24 * 1024 * 1024,
  maxTextBytes: 8 * 1024 * 1024,
  maxSpineItems: 512,
  maxBlocks: 100_000,
  maxXmlNodes: 100_000,
  maxXmlDepth: 128,
  maxCompressionRatio: 200,
});

export interface EpubTextAnchor {
  memberPath: string;
  chapterIndex: number;
  /** UTF-16 offsets in the extracted text for this XHTML member. */
  start: number;
  end: number;
  offsetUnit: 'utf16-extracted-text';
}

export interface EpubTextBlock {
  id: string;
  start: number;
  end: number;
  kind: 'paragraph' | 'heading';
  label?: string;
  anchor: EpubTextAnchor;
}

export interface EpubChapter {
  index: number;
  memberPath: string;
  label: string;
  start: number;
  end: number;
}

export interface EpubCoverage {
  totalSpineItems: number;
  extractedSpineItems: number;
  omittedSpineItems: number;
  unsupportedItems: string[];
  membersWithoutText: string[];
}

export type EpubParseStatus = 'complete' | 'partial' | 'unsupported' | 'no-text' | 'malformed' | 'limit-exceeded' | 'archive-read-failed' | 'cancelled';

export interface EpubParseResult {
  status: EpubParseStatus;
  reason?: string;
  text: string;
  blocks: EpubTextBlock[];
  chapters: EpubChapter[];
  coverage: EpubCoverage;
  warnings: string[];
}

const CONTAINER_NS = 'urn:oasis:names:tc:opendocument:xmlns:container';
const OPF_NS = 'http://www.idpf.org/2007/opf';
const XHTML_NS = 'http://www.w3.org/1999/xhtml';
const BLOCK_NAMES = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'pre']);
const IGNORED_NAMES = new Set(['head', 'script', 'style', 'svg', 'template', 'noscript']);
const SHARED_ENCODER = new TextEncoder();

function validLimit(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function validateLimits(limits: EpubParseLimits): void {
  if (!limits || typeof limits !== 'object') failParse('malformed', 'EPUB parser limits are missing.');
  const names: Array<keyof EpubParseLimits> = [
    'maxArchiveBytes', 'maxEntries', 'maxPathLength', 'maxMemberBytes', 'maxExpandedBytes',
    'maxTextBytes', 'maxSpineItems', 'maxBlocks', 'maxXmlNodes', 'maxXmlDepth', 'maxCompressionRatio',
  ];
  for (const name of names) {
    if (!validLimit(limits[name])) failParse('malformed', `Invalid EPUB parser limit: ${name}.`);
  }
}

function emptyCoverage(): EpubCoverage {
  return { totalSpineItems: 0, extractedSpineItems: 0, omittedSpineItems: 0, unsupportedItems: [], membersWithoutText: [] };
}

function failure(status: EpubFailureStatus, reason: string, coverage = emptyCoverage()): EpubParseResult {
  return { status, reason, text: '', blocks: [], chapters: [], coverage, warnings: [reason] };
}

function isSafeMemberName(path: string, maxPathLength = 1024): boolean {
  if (!path || path.length > maxPathLength || hasForbiddenControlCharacter(path, false)) return false;
  if (path.startsWith('/') || path.includes('\\')) return false;
  if (path.includes('%') || path.includes('?') || path.includes('#')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return false;
  return path.split('/').every(segment => segment.length > 0 && segment !== '.' && segment !== '..');
}

function hasUnsafeHrefSyntax(href: string, maxPathLength: number): boolean {
  if (!href || href.length > maxPathLength) return true;
  if (href.startsWith('/') || href.startsWith('//') || href.includes('\\')) return true;
  if (href.includes('%') || href.includes('?') || href.includes('#') || href.includes('\0')) return true;
  return /^[a-z][a-z0-9+.-]*:/i.test(href);
}

function resolveInternalHref(packagePath: string, href: string, maxPathLength: number): string | null {
  if (hasUnsafeHrefSyntax(href, maxPathLength)) return null;
  const segments = packagePath.split('/').slice(0, -1);
  for (const segment of href.split('/')) {
    if (!segment || segment.includes(':')) return null;
    if (segment === '.') continue;
    if (segment === '..') {
      if (!segments.length) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  const path = segments.join('/');
  return isSafeMemberName(path, maxPathLength) ? path : null;
}

interface ExtractedBlock {
  kind: 'paragraph' | 'heading';
  text: string;
  label?: string;
  start: number;
  end: number;
}

function extractXhtmlBlocks(body: XmlElement, maxBlocks: number): { blocks: ExtractedBlock[]; unstructuredText: boolean } {
  const blocks: ExtractedBlock[] = [];
  let unstructuredText = false;
  const visit = (element: XmlElement) => {
    if (IGNORED_NAMES.has(element.localName)) return;
    if (BLOCK_NAMES.has(element.localName)) {
      const value = textContent(element).replace(/\s+/gu, ' ').trim();
      if (value) {
        const heading = /^h[1-6]$/.test(element.localName);
        blocks.push({ kind: heading ? 'heading' : 'paragraph', text: value, ...(heading ? { label: value } : {}), start: 0, end: 0 });
        if (blocks.length > maxBlocks) failParse('limit-exceeded', 'EPUB exceeds the configured extracted-block limit.');
      }
      return;
    }
    for (const child of element.children) {
      if (child.type === 'text') {
        if (child.value.trim()) unstructuredText = true;
      } else {
        visit(child);
      }
    }
  };
  visit(body);
  if (!blocks.length) {
    const fallback = textContent(body).replace(/\s+/gu, ' ').trim();
    if (fallback) {
      blocks.push({ kind: 'paragraph', text: fallback, start: 0, end: 0 });
      if (blocks.length > maxBlocks) failParse('limit-exceeded', 'EPUB exceeds the configured extracted-block limit.');
      unstructuredText = false;
    }
  }
  let offset = 0;
  for (const block of blocks) {
    block.start = offset;
    block.end = offset + block.text.length;
    offset = block.end + 1;
  }
  return { blocks, unstructuredText };
}

async function resolveTextMember(
  reader: BoundedArchiveReader,
  entries: Map<string, BoundedArchiveEntry>,
  path: string,
  limits: EpubParseLimits,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) failParse('cancelled', 'EPUB parsing was cancelled.');
  const entry = entries.get(path);
  if (!entry) failParse('malformed', `EPUB archive is missing required member "${path}".`);
  if (entry.encrypted) failParse('unsupported', `Encrypted EPUB member "${path}" is not supported.`);
  if (entry.compression === 'unsupported') failParse('unsupported', `EPUB compression for member "${path}" is not supported.`);
  if (entry.uncompressedBytes > limits.maxMemberBytes) failParse('limit-exceeded', `EPUB member "${path}" exceeds the configured member limit.`);
  const bytes = await reader.readEntry(path, limits.maxMemberBytes, signal);
  if (signal?.aborted) failParse('cancelled', 'EPUB parsing was cancelled.');
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== entry.uncompressedBytes || bytes.byteLength > limits.maxMemberBytes) {
    failParse('malformed', `Bounded EPUB reader returned an invalid byte count for member "${path}".`);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    failParse('unsupported', `EPUB member "${path}" is not valid UTF-8 for this parser core.`);
  }
}

function validateArchiveEntry(entry: BoundedArchiveEntry, limits: EpubParseLimits): void {
  if (!isSafeMemberName(entry.path, limits.maxPathLength)) failParse('malformed', 'EPUB archive contains an invalid member name.');
  const validSizes = Number.isSafeInteger(entry.compressedBytes) && entry.compressedBytes >= 0 &&
    Number.isSafeInteger(entry.uncompressedBytes) && entry.uncompressedBytes >= 0;
  const validFlags = typeof entry.encrypted === 'boolean' && ['stored', 'deflate', 'unsupported'].includes(entry.compression);
  if (!validSizes || !validFlags) failParse('malformed', `EPUB archive metadata is invalid for member "${entry.path}".`);
  if (entry.uncompressedBytes > limits.maxMemberBytes) failParse('limit-exceeded', `EPUB member "${entry.path}" exceeds the configured member limit.`);
  const zeroCompressedWithData = entry.compressedBytes === 0 && entry.uncompressedBytes > 0;
  const storedMismatch = entry.compression === 'stored' && entry.compressedBytes !== entry.uncompressedBytes;
  if (zeroCompressedWithData || storedMismatch) failParse('malformed', `EPUB member "${entry.path}" has inconsistent size metadata.`);
  if (entry.compressedBytes > 0 && entry.uncompressedBytes / entry.compressedBytes > limits.maxCompressionRatio) {
    failParse('limit-exceeded', `EPUB member "${entry.path}" exceeds the configured compression-ratio limit.`);
  }
}

function indexArchiveEntries(reader: BoundedArchiveReader, limits: EpubParseLimits): Map<string, BoundedArchiveEntry> {
  if (!Number.isSafeInteger(reader.archiveBytes) || reader.archiveBytes < 0) failParse('malformed', 'EPUB archive reader reported an invalid archive size.');
  if (reader.archiveBytes > limits.maxArchiveBytes) failParse('limit-exceeded', 'EPUB archive exceeds the configured compressed-size limit.');
  const listed = reader.entries();
  if (!Array.isArray(listed)) failParse('malformed', 'EPUB archive reader returned invalid member metadata.');
  if (listed.length > limits.maxEntries) failParse('limit-exceeded', 'EPUB archive exceeds the configured member-count limit.');
  if (listed[0]?.path !== 'mimetype') failParse('malformed', 'EPUB mimetype must be the first physical archive member.');
  const entries = new Map<string, BoundedArchiveEntry>();
  let expandedTotal = 0;
  let compressedTotal = 0;
  for (const entry of listed) {
    validateArchiveEntry(entry, limits);
    if (entries.has(entry.path)) failParse('malformed', `EPUB archive contains a duplicate member "${entry.path}".`);
    compressedTotal += entry.compressedBytes;
    if (!Number.isSafeInteger(compressedTotal) || compressedTotal > reader.archiveBytes) {
      failParse('malformed', 'EPUB member sizes exceed the reported archive size.');
    }
    expandedTotal += entry.uncompressedBytes;
    if (!Number.isSafeInteger(expandedTotal) || expandedTotal > limits.maxExpandedBytes) {
      failParse('limit-exceeded', 'EPUB archive exceeds the configured total expanded-size limit.');
    }
    entries.set(entry.path, entry);
  }
  return entries;
}

async function readOpfPackagePath(
  reader: BoundedArchiveReader,
  entries: Map<string, BoundedArchiveEntry>,
  limits: EpubParseLimits,
  xmlNodeBudget: XmlNodeBudget,
  signal?: AbortSignal,
): Promise<string> {
  const mimetypeEntry = entries.get('mimetype');
  if (!mimetypeEntry) failParse('malformed', 'EPUB archive is missing its required mimetype member.');
  if (mimetypeEntry.encrypted || mimetypeEntry.compression !== 'stored') {
    failParse('unsupported', 'EPUB mimetype must be an unencrypted stored member.');
  }
  const mimetype = await resolveTextMember(reader, entries, 'mimetype', limits, signal);
  if (mimetype !== 'application/epub+zip') failParse('malformed', 'EPUB mimetype member has an unexpected value.');
  const containerXml = await resolveTextMember(reader, entries, 'META-INF/container.xml', limits, signal);
  const container = parseXml(containerXml, limits, xmlNodeBudget);
  if (container.localName !== 'container' || container.namespaceUri !== CONTAINER_NS) {
    failParse('unsupported', 'EPUB container namespace or root is not supported.');
  }
  const rootfiles = findDescendant(container, 'rootfiles', CONTAINER_NS);
  if (!rootfiles) failParse('malformed', 'EPUB container does not declare a rootfile list.');
  const rootfile = childElements(rootfiles, 'rootfile', CONTAINER_NS)
    .find(item => item.attributes.get('media-type') === 'application/oebps-package+xml');
  if (!rootfile) failParse('unsupported', 'EPUB container has no supported OPF package document.');
  const packagePath = rootfile.attributes.get('full-path') ?? '';
  if (!isSafeMemberName(packagePath, limits.maxPathLength)) {
    failParse('unsupported', 'EPUB rootfile path is not a supported archive-relative member name.');
  }
  return packagePath;
}

function buildManifestMap(manifest: XmlElement): Map<string, { href: string; mediaType: string }> {
  const manifestItems = new Map<string, { href: string; mediaType: string }>();
  for (const item of childElements(manifest, 'item', OPF_NS)) {
    const id = item.attributes.get('id')?.trim() ?? '';
    const href = item.attributes.get('href') ?? '';
    const mediaType = item.attributes.get('media-type') ?? '';
    if (!id || !href || !mediaType || manifestItems.has(id)) {
      failParse('malformed', 'EPUB manifest contains a missing or duplicate item field.');
    }
    manifestItems.set(id, { href, mediaType });
  }
  return manifestItems;
}

function planSpineItems(
  opf: XmlElement,
  packagePath: string,
  entries: Map<string, BoundedArchiveEntry>,
  limits: EpubParseLimits,
  coverage: EpubCoverage,
): Array<{ path: string; id: string }> {
  const manifest = childElements(opf, 'manifest', OPF_NS)[0];
  const spine = childElements(opf, 'spine', OPF_NS)[0];
  if (!manifest || !spine) failParse('malformed', 'EPUB package is missing its manifest or spine.');
  const manifestItems = buildManifestMap(manifest);
  const spineItems = childElements(spine, 'itemref', OPF_NS);
  coverage.totalSpineItems = spineItems.length;
  if (spineItems.length > limits.maxSpineItems) failParse('limit-exceeded', 'EPUB spine exceeds the configured item-count limit.', coverage);
  const planned: Array<{ path: string; id: string }> = [];
  for (const itemref of spineItems) {
    const id = itemref.attributes.get('idref')?.trim() ?? '';
    if (!id) failParse('malformed', 'EPUB spine item is missing its manifest reference.', coverage);
    if (itemref.attributes.get('linear')?.toLowerCase() === 'no') {
      coverage.omittedSpineItems += 1;
      coverage.unsupportedItems.push(`non-linear spine item: ${id}`);
      continue;
    }
    const item = manifestItems.get(id);
    if (!item) failParse('malformed', `EPUB spine references unknown manifest item "${id}".`, coverage);
    if (item.mediaType !== 'application/xhtml+xml') {
      coverage.omittedSpineItems += 1;
      coverage.unsupportedItems.push(`${id}: unsupported media type ${item.mediaType}`);
      continue;
    }
    const path = resolveInternalHref(packagePath, item.href, limits.maxPathLength);
    if (!path) {
      coverage.omittedSpineItems += 1;
      coverage.unsupportedItems.push(`${id}: unsupported non-local or encoded member reference (${item.href})`);
      continue;
    }
    if (!entries.has(path)) failParse('malformed', `EPUB spine member "${path}" is missing from the archive.`, coverage);
    planned.push({ path, id });
  }
  if (!planned.length && coverage.unsupportedItems.length) {
    failParse('unsupported', 'EPUB has no supported local XHTML spine items.', coverage);
  }
  return planned;
}

interface SpineExtractionState {
  reader: BoundedArchiveReader;
  entries: Map<string, BoundedArchiveEntry>;
  limits: EpubParseLimits;
  xmlNodeBudget: XmlNodeBudget;
  coverage: EpubCoverage;
  signal?: AbortSignal;
}

async function extractSpineChapters(
  planned: ReadonlyArray<{ path: string; id: string }>,
  ctx: SpineExtractionState,
): Promise<{ textParts: string[]; blocks: EpubTextBlock[]; chapters: EpubChapter[] }> {
  const textParts: string[] = [];
  const blocks: EpubTextBlock[] = [];
  const chapters: EpubChapter[] = [];
  let assembledTextLength = 0;
  let assembledTextBytes = 0;
  for (const plannedItem of planned) {
    const entry = ctx.entries.get(plannedItem.path)!;
    if (entry.encrypted || entry.compression === 'unsupported') {
      ctx.coverage.omittedSpineItems += 1;
      ctx.coverage.unsupportedItems.push(`${plannedItem.id}: encrypted or unsupported member encoding`);
      continue;
    }
    const rawXhtml = await resolveTextMember(ctx.reader, ctx.entries, plannedItem.path, ctx.limits, ctx.signal);
    const xhtml = parseXml(rawXhtml, ctx.limits, ctx.xmlNodeBudget);
    if (xhtml.localName !== 'html' || xhtml.namespaceUri !== XHTML_NS) {
      ctx.coverage.omittedSpineItems += 1;
      ctx.coverage.unsupportedItems.push(`${plannedItem.id}: unsupported XHTML root or namespace`);
      continue;
    }
    const body = findDescendant(xhtml, 'body', XHTML_NS);
    if (!body) failParse('malformed', `EPUB XHTML member "${plannedItem.path}" has no body element.`, ctx.coverage);
    const extracted = extractXhtmlBlocks(body, ctx.limits.maxBlocks - blocks.length);
    ctx.coverage.extractedSpineItems += 1;
    if (extracted.unstructuredText) {
      ctx.coverage.omittedSpineItems += 1;
      ctx.coverage.unsupportedItems.push(`${plannedItem.id}: unstructured body text was omitted`);
    }
    if (!extracted.blocks.length) {
      ctx.coverage.membersWithoutText.push(plannedItem.path);
      continue;
    }
    const chapterIndex = chapters.length + 1;
    const memberText = extracted.blocks.map(block => block.text).join('\n');
    const separator = textParts.length ? 2 : 0;
    const memberBytes = SHARED_ENCODER.encode(memberText).byteLength;
    if (assembledTextBytes + separator + memberBytes > ctx.limits.maxTextBytes) {
      failParse('limit-exceeded', 'EPUB extracted text exceeds the configured text limit; content was not truncated.', ctx.coverage);
    }
    const chapterStart = assembledTextLength + separator;
    const chapterEnd = chapterStart + memberText.length;
    const heading = extracted.blocks.find(block => block.kind === 'heading')?.text;
    chapters.push({ index: chapterIndex, memberPath: plannedItem.path, label: heading ?? plannedItem.path, start: chapterStart, end: chapterEnd });
    let localStart = 0;
    for (const block of extracted.blocks) {
      const localEnd = localStart + block.text.length;
      blocks.push({
        id: `source-block-${blocks.length + 1}`,
        start: chapterStart + localStart,
        end: chapterStart + localEnd,
        kind: block.kind,
        ...(block.label ? { label: block.label } : {}),
        anchor: { memberPath: plannedItem.path, chapterIndex, start: localStart, end: localEnd, offsetUnit: 'utf16-extracted-text' },
      });
      localStart = localEnd + 1;
    }
    textParts.push(memberText);
    assembledTextLength = chapterEnd;
    assembledTextBytes += separator + memberBytes;
  }
  return { textParts, blocks, chapters };
}

/** Traverse only local XHTML items referenced by the OPF spine; this function never mutates a project. */
export async function parseEpub(
  reader: BoundedArchiveReader,
  limits: EpubParseLimits = DEFAULT_EPUB_PARSE_LIMITS,
  options: { signal?: AbortSignal } = {},
): Promise<EpubParseResult> {
  const coverage = emptyCoverage();
  const warnings: string[] = [];
  const xmlNodeBudget: XmlNodeBudget = { used: 0 };
  try {
    validateLimits(limits);
    const entries = indexArchiveEntries(reader, limits);
    const packagePath = await readOpfPackagePath(reader, entries, limits, xmlNodeBudget, options.signal);
    const packageXml = await resolveTextMember(reader, entries, packagePath, limits, options.signal);
    const opf = parseXml(packageXml, limits, xmlNodeBudget);
    if (opf.localName !== 'package' || opf.namespaceUri !== OPF_NS) {
      failParse('unsupported', 'EPUB package namespace or root is not supported.');
    }
    const version = opf.attributes.get('version') ?? '';
    if (!version.startsWith('2.') && !version.startsWith('3.')) {
      failParse('unsupported', 'Only EPUB package versions 2.x and 3.x are supported by this core.');
    }
    const planned = planSpineItems(opf, packagePath, entries, limits, coverage);
    const { textParts, blocks, chapters } = await extractSpineChapters(planned, {
      reader, entries, limits, xmlNodeBudget, coverage, signal: options.signal,
    });
    const text = textParts.join('\n\n');
    if (!text.trim()) {
      if (coverage.unsupportedItems.length || coverage.omittedSpineItems) {
        failParse('unsupported', 'EPUB has no readable text from supported spine items.', coverage);
      }
      failParse('no-text', 'EPUB spine contains no readable narrative text.', coverage);
    }
    const isPartial = coverage.omittedSpineItems > 0 || coverage.membersWithoutText.length > 0;
    if (coverage.unsupportedItems.length) warnings.push('Some EPUB spine items were not extracted; see coverage.unsupportedItems.');
    if (coverage.membersWithoutText.length) warnings.push('Some supported XHTML spine members contained no readable text.');
    return { status: isPartial ? 'partial' : 'complete', text, blocks, chapters, coverage, warnings };
  } catch (error) {
    if (error instanceof ParseFault) return failure(error.status, error.message, error.coverage ?? coverage);
    if (options.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      return failure('cancelled', 'EPUB parsing was cancelled.', coverage);
    }
    const reason = error instanceof Error ? error.message : 'Unknown archive reader failure.';
    return failure('archive-read-failed', `EPUB archive read failed: ${reason}`, coverage);
  }
}
