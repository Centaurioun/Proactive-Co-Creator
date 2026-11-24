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
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const BLOCK_NAMES = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'pre']);
const IGNORED_NAMES = new Set(['head', 'script', 'style', 'svg', 'template', 'noscript']);

type FailureStatus = Exclude<EpubParseStatus, 'complete' | 'partial'>;

class ParseFault extends Error {
  status: FailureStatus;
  coverage?: EpubCoverage;
  constructor(status: FailureStatus, message: string, coverage?: EpubCoverage) {
    super(message);
    this.name = 'ParseFault';
    this.status = status;
    this.coverage = coverage;
  }
}

interface XmlTextNode { type: 'text'; value: string }
interface XmlElement {
  type: 'element';
  name: string;
  localName: string;
  namespaceUri: string;
  attributes: Map<string, string>;
  namespaceBindings: Map<string, string>;
  children: XmlNode[];
}
type XmlNode = XmlTextNode | XmlElement;
interface XmlNodeBudget { used: number }

function fail(status: FailureStatus, message: string, coverage?: EpubCoverage): never {
  throw new ParseFault(status, message, coverage);
}

function validLimit(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function validateLimits(limits: EpubParseLimits): void {
  if (!limits || typeof limits !== 'object') fail('malformed', 'EPUB parser limits are missing.');
  const names: Array<keyof EpubParseLimits> = [
    'maxArchiveBytes', 'maxEntries', 'maxPathLength', 'maxMemberBytes', 'maxExpandedBytes',
    'maxTextBytes', 'maxSpineItems', 'maxBlocks', 'maxXmlNodes', 'maxXmlDepth', 'maxCompressionRatio',
  ];
  for (const name of names) {
    if (!validLimit(limits[name])) fail('malformed', `Invalid EPUB parser limit: ${name}.`);
  }
}

function emptyCoverage(): EpubCoverage {
  return { totalSpineItems: 0, extractedSpineItems: 0, omittedSpineItems: 0, unsupportedItems: [], membersWithoutText: [] };
}

function failure(status: FailureStatus, reason: string, coverage = emptyCoverage()): EpubParseResult {
  return { status, reason, text: '', blocks: [], chapters: [], coverage, warnings: [reason] };
}

function hasForbiddenControlCharacter(value: string, allowXmlWhitespace: boolean): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (allowXmlWhitespace) {
      if (code < 32 && code !== 9 && code !== 10 && code !== 13) return true;
    } else if (code < 32 || code === 127) {
      return true;
    }
  }
  return false;
}

function isSafeMemberName(path: string, maxPathLength = 1024): boolean {
  if (!path || path.length > maxPathLength || hasForbiddenControlCharacter(path, false) || path.startsWith('/') || path.includes('\\') || path.includes('%') || path.includes('?') || path.includes('#')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return false;
  const segments = path.split('/');
  return segments.every(segment => segment.length > 0 && segment !== '.' && segment !== '..');
}

function resolveInternalHref(packagePath: string, href: string, maxPathLength: number): string | null {
  if (!href || href.length > maxPathLength || href.startsWith('/') || href.startsWith('//') || href.includes('\\') || href.includes('%') || href.includes('?') || href.includes('#') || href.includes('\0')) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
  const segments = packagePath.split('/').slice(0, -1);
  for (const segment of href.split('/')) {
    if (!segment) return null;
    if (segment === '.') continue;
    if (segment === '..') {
      if (!segments.length) return null;
      segments.pop();
      continue;
    }
    if (segment.includes(':')) return null;
    segments.push(segment);
  }
  const path = segments.join('/');
  return isSafeMemberName(path, maxPathLength) ? path : null;
}

function validXmlCodePoint(codePoint: number): boolean {
  return codePoint === 0x9 || codePoint === 0xa || codePoint === 0xd ||
    (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
    (codePoint >= 0x10000 && codePoint <= 0x10ffff);
}

function decodeXmlEntities(value: string): string {
  const references = /&([^;]+);/g;
  let cursor = 0;
  let decoded = '';
  for (const match of value.matchAll(references)) {
    const start = match.index!;
    const plain = value.slice(cursor, start);
    if (plain.includes('&')) fail('malformed', 'EPUB XML contains an unterminated or unsupported entity reference.');
    decoded += plain;
    const entity = match[1];
    if (entity === 'amp') decoded += '&';
    else if (entity === 'lt') decoded += '<';
    else if (entity === 'gt') decoded += '>';
    else if (entity === 'quot') decoded += '"';
    else if (entity === 'apos') decoded += "'";
    else {
      const hex = /^#x([\da-f]+)$/i.exec(entity);
      const decimal = /^#(\d+)$/.exec(entity);
      const codePoint = hex ? Number.parseInt(hex[1], 16) : decimal ? Number(decimal[1]) : NaN;
      if (!Number.isInteger(codePoint) || !validXmlCodePoint(codePoint)) fail('malformed', 'EPUB XML contains an invalid or unsupported entity reference.');
      decoded += String.fromCodePoint(codePoint);
    }
    cursor = start + match[0].length;
  }
  const tail = value.slice(cursor);
  if (tail.includes('&')) fail('malformed', 'EPUB XML contains an unterminated or unsupported entity reference.');
  return decoded + tail;
}

function readTagEnd(xml: string, start: number): number {
  let quote = '';
  for (let index = start; index < xml.length; index += 1) {
    const char = xml[index];
    if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      return index;
    }
  }
  fail('malformed', 'EPUB XML contains an incomplete tag.');
}

function parseXml(xml: string, limits: EpubParseLimits, budget: XmlNodeBudget): XmlElement {
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) fail('unsupported', 'EPUB XML declarations with DTD or entities are not supported.');
  if (hasForbiddenControlCharacter(xml, true)) fail('malformed', 'EPUB XML contains invalid control characters.');
  let cursor = 0;
  let root: XmlElement | undefined;
  let sawXmlDeclaration = false;
  const stack: XmlElement[] = [];
  const addText = (value: string) => {
    if (!value) return;
    if (!stack.length) {
      if (value.trim()) fail('malformed', 'EPUB XML has text outside its root element.');
      return;
    }
    budget.used += 1;
    if (budget.used > limits.maxXmlNodes) fail('limit-exceeded', 'EPUB archive exceeds the aggregate XML node limit.');
    stack[stack.length - 1].children.push({ type: 'text', value });
  };

  while (cursor < xml.length) {
    if (xml[cursor] !== '<') {
      const end = xml.indexOf('<', cursor);
      const next = end < 0 ? xml.length : end;
      const raw = xml.slice(cursor, next);
      if (raw.includes(']]>')) fail('malformed', 'EPUB XML contains an invalid CDATA terminator.');
      addText(decodeXmlEntities(raw));
      cursor = next;
      continue;
    }

    if (xml.startsWith('<!--', cursor)) {
      const end = xml.indexOf('-->', cursor + 4);
      if (end < 0 || xml.slice(cursor + 4, end).includes('--')) fail('malformed', 'EPUB XML contains an invalid comment.');
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', cursor)) {
      if (!stack.length) fail('malformed', 'EPUB XML has CDATA outside its root element.');
      const end = xml.indexOf(']]>', cursor + 9);
      if (end < 0) fail('malformed', 'EPUB XML contains an incomplete CDATA section.');
      addText(xml.slice(cursor + 9, end));
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith('<!', cursor)) fail('unsupported', 'This EPUB XML declaration form is not supported.');
    if (xml.startsWith('<?', cursor)) {
      const end = xml.indexOf('?>', cursor + 2);
      if (end < 0) fail('malformed', 'EPUB XML contains an incomplete processing instruction.');
      const declaration = xml.slice(cursor + 2, end).trim();
      if (declaration.toLowerCase().startsWith('xml ')) {
        if (root || stack.length || sawXmlDeclaration) fail('malformed', 'EPUB XML declaration is misplaced or repeated.');
        sawXmlDeclaration = true;
        const encoding = /\bencoding\s*=\s*['"]([^'"]+)['"]/i.exec(declaration)?.[1];
        if (encoding && encoding.toLowerCase() !== 'utf-8') fail('unsupported', 'This EPUB core accepts UTF-8 XML only.');
      } else {
        fail('unsupported', 'EPUB XML processing instructions are not supported.');
      }
      cursor = end + 2;
      continue;
    }
    if (xml.startsWith('</', cursor)) {
      const end = xml.indexOf('>', cursor + 2);
      if (end < 0) fail('malformed', 'EPUB XML contains an incomplete closing tag.');
      const name = xml.slice(cursor + 2, end).trim();
      if (!/^[A-Za-z_][A-Za-z\d_.:-]*$/.test(name) || !stack.length || stack[stack.length - 1].name !== name) {
        fail('malformed', 'EPUB XML tags are not well-formed.');
      }
      stack.pop();
      cursor = end + 1;
      continue;
    }

    const end = readTagEnd(xml, cursor + 1);
    let content = xml.slice(cursor + 1, end).trim();
    const selfClosing = content.endsWith('/');
    if (selfClosing) content = content.slice(0, -1).trimEnd();
    const nameMatch = /^([A-Za-z_][A-Za-z\d_.:-]*)/.exec(content);
    if (!nameMatch) fail('malformed', 'EPUB XML contains an invalid element name.');
    const name = nameMatch[1];
    const attributes = new Map<string, string>();
    let position = nameMatch[0].length;
    while (position < content.length) {
      while (/\s/.test(content[position] ?? '')) position += 1;
      if (position >= content.length) break;
      const attrMatch = /^([A-Za-z_][A-Za-z\d_.:-]*)/.exec(content.slice(position));
      if (!attrMatch) fail('malformed', 'EPUB XML contains an invalid attribute name.');
      const attrName = attrMatch[1];
      if (attributes.has(attrName)) fail('malformed', 'EPUB XML contains a duplicate attribute.');
      position += attrMatch[0].length;
      while (/\s/.test(content[position] ?? '')) position += 1;
      if (content[position] !== '=') fail('malformed', 'EPUB XML attribute is missing a value.');
      position += 1;
      while (/\s/.test(content[position] ?? '')) position += 1;
      const quote = content[position];
      if (quote !== '"' && quote !== "'") fail('malformed', 'EPUB XML attribute values must be quoted.');
      position += 1;
      const valueStart = position;
      while (position < content.length && content[position] !== quote) {
        if (content[position] === '<') fail('malformed', 'EPUB XML attribute contains an unescaped less-than sign.');
        position += 1;
      }
      if (position >= content.length) fail('malformed', 'EPUB XML attribute value is incomplete.');
      attributes.set(attrName, decodeXmlEntities(content.slice(valueStart, position)));
      position += 1;
    }

    const namespaceBindings = new Map(stack.length ? stack[stack.length - 1].namespaceBindings : [['xml', XML_NS]]);
    for (const [attrName, value] of attributes) {
      if (attrName === 'xmlns') namespaceBindings.set('', value);
      else if (attrName.startsWith('xmlns:')) {
        const prefix = attrName.slice(6);
        if (!prefix || !value || (prefix === 'xml' && value !== XML_NS) || prefix === 'xmlns') fail('malformed', 'EPUB XML has an invalid namespace declaration.');
        namespaceBindings.set(prefix, value);
      }
    }
    const nameParts = name.split(':');
    if (nameParts.length > 2 || nameParts.some(part => !part)) fail('malformed', 'EPUB XML contains an invalid qualified name.');
    const prefix = nameParts.length === 2 ? nameParts[0] : '';
    const localName = nameParts[nameParts.length - 1];
    const namespaceUri = namespaceBindings.get(prefix);
    if (namespaceUri === undefined) fail('malformed', 'EPUB XML uses an undeclared namespace prefix.');
    for (const attrName of attributes.keys()) {
      if (attrName === 'xmlns' || attrName.startsWith('xmlns:')) continue;
      const attrParts = attrName.split(':');
      if (attrParts.length > 2 || attrParts.some(part => !part) || (attrParts.length === 2 && !namespaceBindings.has(attrParts[0]))) {
        fail('malformed', 'EPUB XML attribute uses an invalid or undeclared namespace prefix.');
      }
    }
    budget.used += 1;
    if (budget.used > limits.maxXmlNodes) fail('limit-exceeded', 'EPUB archive exceeds the aggregate XML node limit.');
    const element: XmlElement = { type: 'element', name, localName, namespaceUri, attributes, namespaceBindings, children: [] };
    if (stack.length) stack[stack.length - 1].children.push(element);
    else if (!root) root = element;
    else fail('malformed', 'EPUB XML contains more than one root element.');
    if (!selfClosing) {
      stack.push(element);
      if (stack.length > limits.maxXmlDepth) fail('limit-exceeded', 'EPUB XML exceeds the configured nesting-depth limit.');
    }
    cursor = end + 1;
  }
  if (stack.length || !root) fail('malformed', 'EPUB XML is incomplete or has no root element.');
  return root;
}

function childElements(element: XmlElement, localName: string, namespaceUri?: string): XmlElement[] {
  return element.children.filter((child): child is XmlElement => child.type === 'element' && child.localName === localName &&
    (namespaceUri === undefined || child.namespaceUri === namespaceUri));
}

function findDescendant(element: XmlElement, localName: string, namespaceUri: string): XmlElement | undefined {
  for (const child of element.children) {
    if (child.type !== 'element') continue;
    if (child.localName === localName && child.namespaceUri === namespaceUri) return child;
    const nested = findDescendant(child, localName, namespaceUri);
    if (nested) return nested;
  }
  return undefined;
}

function textContent(element: XmlElement): string {
  let result = '';
  for (const child of element.children) {
    if (child.type === 'text') result += child.value;
    else if (!IGNORED_NAMES.has(child.localName)) result += textContent(child);
  }
  return result;
}

interface ExtractedBlock { kind: 'paragraph' | 'heading'; text: string; label?: string; start: number; end: number }

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
        if (blocks.length > maxBlocks) fail('limit-exceeded', 'EPUB exceeds the configured extracted-block limit.');
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
      if (blocks.length > maxBlocks) fail('limit-exceeded', 'EPUB exceeds the configured extracted-block limit.');
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

function resolveTextMember(reader: BoundedArchiveReader, entries: Map<string, BoundedArchiveEntry>, path: string, limits: EpubParseLimits, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) return Promise.reject(new ParseFault('cancelled', 'EPUB parsing was cancelled.'));
  const entry = entries.get(path);
  if (!entry) return Promise.reject(new ParseFault('malformed', `EPUB archive is missing required member "${path}".`));
  if (entry.encrypted) return Promise.reject(new ParseFault('unsupported', `Encrypted EPUB member "${path}" is not supported.`));
  if (entry.compression === 'unsupported') return Promise.reject(new ParseFault('unsupported', `EPUB compression for member "${path}" is not supported.`));
  if (entry.uncompressedBytes > limits.maxMemberBytes) return Promise.reject(new ParseFault('limit-exceeded', `EPUB member "${path}" exceeds the configured member limit.`));
  return reader.readEntry(path, limits.maxMemberBytes, signal).then(bytes => {
    if (signal?.aborted) fail('cancelled', 'EPUB parsing was cancelled.');
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== entry.uncompressedBytes || bytes.byteLength > limits.maxMemberBytes) {
      fail('malformed', `Bounded EPUB reader returned an invalid byte count for member "${path}".`);
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      fail('unsupported', `EPUB member "${path}" is not valid UTF-8 for this parser core.`);
    }
  });
}

function countTextBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
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
    if (!Number.isSafeInteger(reader.archiveBytes) || reader.archiveBytes < 0) fail('malformed', 'EPUB archive reader reported an invalid archive size.');
    if (reader.archiveBytes > limits.maxArchiveBytes) fail('limit-exceeded', 'EPUB archive exceeds the configured compressed-size limit.');
    const listed = reader.entries();
    if (!Array.isArray(listed)) fail('malformed', 'EPUB archive reader returned invalid member metadata.');
    if (listed.length > limits.maxEntries) fail('limit-exceeded', 'EPUB archive exceeds the configured member-count limit.');
    if (listed[0]?.path !== 'mimetype') fail('malformed', 'EPUB mimetype must be the first physical archive member.');
    const entries = new Map<string, BoundedArchiveEntry>();
    let expandedTotal = 0;
    let compressedTotal = 0;
    for (const entry of listed) {
      if (!isSafeMemberName(entry.path, limits.maxPathLength)) fail('malformed', 'EPUB archive contains an invalid member name.');
      if (entries.has(entry.path)) fail('malformed', `EPUB archive contains a duplicate member "${entry.path}".`);
      if (!Number.isSafeInteger(entry.compressedBytes) || entry.compressedBytes < 0 ||
        !Number.isSafeInteger(entry.uncompressedBytes) || entry.uncompressedBytes < 0 || typeof entry.encrypted !== 'boolean' ||
        !['stored', 'deflate', 'unsupported'].includes(entry.compression)) {
        fail('malformed', `EPUB archive metadata is invalid for member "${entry.path}".`);
      }
      if (entry.uncompressedBytes > limits.maxMemberBytes) fail('limit-exceeded', `EPUB member "${entry.path}" exceeds the configured member limit.`);
      compressedTotal += entry.compressedBytes;
      if (!Number.isSafeInteger(compressedTotal) || compressedTotal > reader.archiveBytes) fail('malformed', 'EPUB member sizes exceed the reported archive size.');
      if ((entry.compressedBytes === 0 && entry.uncompressedBytes > 0) ||
        (entry.compression === 'stored' && entry.compressedBytes !== entry.uncompressedBytes)) {
        fail('malformed', `EPUB member "${entry.path}" has inconsistent size metadata.`);
      }
      if (entry.compressedBytes > 0 && entry.uncompressedBytes / entry.compressedBytes > limits.maxCompressionRatio) {
        fail('limit-exceeded', `EPUB member "${entry.path}" exceeds the configured compression-ratio limit.`);
      }
      expandedTotal += entry.uncompressedBytes;
      if (!Number.isSafeInteger(expandedTotal) || expandedTotal > limits.maxExpandedBytes) fail('limit-exceeded', 'EPUB archive exceeds the configured total expanded-size limit.');
      entries.set(entry.path, entry);
    }

    const mimetypeEntry = entries.get('mimetype');
    if (!mimetypeEntry) fail('malformed', 'EPUB archive is missing its required mimetype member.');
    if (mimetypeEntry.encrypted || mimetypeEntry.compression !== 'stored') fail('unsupported', 'EPUB mimetype must be an unencrypted stored member.');
    const mimetype = await resolveTextMember(reader, entries, 'mimetype', limits, options.signal);
    if (mimetype !== 'application/epub+zip') fail('malformed', 'EPUB mimetype member has an unexpected value.');
    const containerXml = await resolveTextMember(reader, entries, 'META-INF/container.xml', limits, options.signal);
    const container = parseXml(containerXml, limits, xmlNodeBudget);
    if (container.localName !== 'container' || container.namespaceUri !== CONTAINER_NS) fail('unsupported', 'EPUB container namespace or root is not supported.');
    const rootfiles = findDescendant(container, 'rootfiles', CONTAINER_NS);
    if (!rootfiles) fail('malformed', 'EPUB container does not declare a rootfile list.');
    const rootfile = childElements(rootfiles, 'rootfile', CONTAINER_NS).find(item => item.attributes.get('media-type') === 'application/oebps-package+xml');
    if (!rootfile) fail('unsupported', 'EPUB container has no supported OPF package document.');
    const packagePath = rootfile.attributes.get('full-path') ?? '';
    if (!isSafeMemberName(packagePath, limits.maxPathLength)) fail('unsupported', 'EPUB rootfile path is not a supported archive-relative member name.');
    const packageXml = await resolveTextMember(reader, entries, packagePath, limits, options.signal);
    const opf = parseXml(packageXml, limits, xmlNodeBudget);
    if (opf.localName !== 'package' || opf.namespaceUri !== OPF_NS) fail('unsupported', 'EPUB package namespace or root is not supported.');
    const version = opf.attributes.get('version') ?? '';
    if (!version.startsWith('2.') && !version.startsWith('3.')) fail('unsupported', 'Only EPUB package versions 2.x and 3.x are supported by this core.');
    const manifest = childElements(opf, 'manifest', OPF_NS)[0];
    const spine = childElements(opf, 'spine', OPF_NS)[0];
    if (!manifest || !spine) fail('malformed', 'EPUB package is missing its manifest or spine.');
    const manifestItems = new Map<string, { href: string; mediaType: string }>();
    for (const item of childElements(manifest, 'item', OPF_NS)) {
      const id = item.attributes.get('id')?.trim() ?? '';
      const href = item.attributes.get('href') ?? '';
      const mediaType = item.attributes.get('media-type') ?? '';
      if (!id || !href || !mediaType || manifestItems.has(id)) fail('malformed', 'EPUB manifest contains a missing or duplicate item field.');
      manifestItems.set(id, { href, mediaType });
    }
    const spineItems = childElements(spine, 'itemref', OPF_NS);
    coverage.totalSpineItems = spineItems.length;
    if (spineItems.length > limits.maxSpineItems) fail('limit-exceeded', 'EPUB spine exceeds the configured item-count limit.', coverage);
    const planned: Array<{ path: string; id: string }> = [];
    for (const itemref of spineItems) {
      const id = itemref.attributes.get('idref')?.trim() ?? '';
      if (!id) fail('malformed', 'EPUB spine item is missing its manifest reference.', coverage);
      if (itemref.attributes.get('linear')?.toLowerCase() === 'no') {
        coverage.omittedSpineItems += 1;
        coverage.unsupportedItems.push(`non-linear spine item: ${id}`);
        continue;
      }
      const item = manifestItems.get(id);
      if (!item) fail('malformed', `EPUB spine references unknown manifest item "${id}".`, coverage);
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
      if (!entries.has(path)) fail('malformed', `EPUB spine member "${path}" is missing from the archive.`, coverage);
      planned.push({ path, id });
    }
    if (!planned.length && coverage.unsupportedItems.length) fail('unsupported', 'EPUB has no supported local XHTML spine items.', coverage);

    const textParts: string[] = [];
    const blocks: EpubTextBlock[] = [];
    const chapters: EpubChapter[] = [];
    let assembledTextLength = 0;
    let assembledTextBytes = 0;
    for (const plannedItem of planned) {
      const entry = entries.get(plannedItem.path)!;
      if (entry.encrypted || entry.compression === 'unsupported') {
        coverage.omittedSpineItems += 1;
        coverage.unsupportedItems.push(`${plannedItem.id}: encrypted or unsupported member encoding`);
        continue;
      }
      const xhtml = parseXml(await resolveTextMember(reader, entries, plannedItem.path, limits, options.signal), limits, xmlNodeBudget);
      if (xhtml.localName !== 'html' || xhtml.namespaceUri !== XHTML_NS) {
        coverage.omittedSpineItems += 1;
        coverage.unsupportedItems.push(`${plannedItem.id}: unsupported XHTML root or namespace`);
        continue;
      }
      const body = findDescendant(xhtml, 'body', XHTML_NS);
      if (!body) fail('malformed', `EPUB XHTML member "${plannedItem.path}" has no body element.`, coverage);
      const extracted = extractXhtmlBlocks(body, limits.maxBlocks - blocks.length);
      coverage.extractedSpineItems += 1;
      if (extracted.unstructuredText) {
        coverage.omittedSpineItems += 1;
        coverage.unsupportedItems.push(`${plannedItem.id}: unstructured body text was omitted`);
      }
      if (!extracted.blocks.length) {
        coverage.membersWithoutText.push(plannedItem.path);
        continue;
      }
      const chapterIndex = chapters.length + 1;
      const memberText = extracted.blocks.map(block => block.text).join('\n');
      const separatorLength = textParts.length ? 2 : 0;
      const separatorBytes = textParts.length ? 2 : 0;
      const memberBytes = countTextBytes(memberText);
      if (assembledTextBytes + separatorBytes + memberBytes > limits.maxTextBytes) {
        fail('limit-exceeded', 'EPUB extracted text exceeds the configured text limit; content was not truncated.', coverage);
      }
      const chapterStart = assembledTextLength + separatorLength;
      const chapterEnd = chapterStart + memberText.length;
      const heading = extracted.blocks.find(block => block.kind === 'heading')?.text;
      chapters.push({ index: chapterIndex, memberPath: plannedItem.path, label: heading ?? plannedItem.path, start: chapterStart, end: chapterEnd });
      let localStart = 0;
      for (const block of extracted.blocks) {
        const localEnd = localStart + block.text.length;
        const globalStart = chapterStart + localStart;
        const globalEnd = chapterStart + localEnd;
        blocks.push({
          id: `source-block-${blocks.length + 1}`,
          start: globalStart,
          end: globalEnd,
          kind: block.kind,
          ...(block.label ? { label: block.label } : {}),
          anchor: { memberPath: plannedItem.path, chapterIndex, start: localStart, end: localEnd, offsetUnit: 'utf16-extracted-text' },
        });
        localStart = localEnd + 1;
      }
      textParts.push(memberText);
      assembledTextLength = chapterEnd;
      assembledTextBytes += separatorBytes + memberBytes;
    }

    const text = textParts.join('\n\n');
    if (!text.trim()) {
      if (coverage.unsupportedItems.length || coverage.omittedSpineItems) {
        fail('unsupported', 'EPUB has no readable text from supported spine items.', coverage);
      }
      fail('no-text', 'EPUB spine contains no readable narrative text.', coverage);
    }
    const isPartial = coverage.omittedSpineItems > 0 || coverage.membersWithoutText.length > 0;
    if (coverage.unsupportedItems.length) warnings.push('Some EPUB spine items were not extracted; see coverage.unsupportedItems.');
    if (coverage.membersWithoutText.length) warnings.push('Some supported XHTML spine members contained no readable text.');
    return { status: isPartial ? 'partial' : 'complete', text, blocks, chapters, coverage, warnings };
  } catch (error) {
    if (error instanceof ParseFault) return failure(error.status, error.message, error.coverage ?? coverage);
    const reason = error instanceof Error ? error.message : 'Unknown archive reader failure.';
    return failure('archive-read-failed', `EPUB archive read failed: ${reason}`, coverage);
  }
}
