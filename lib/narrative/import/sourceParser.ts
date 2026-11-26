import { AsyncUnzipInflate, Unzip, UnzipPassThrough } from 'fflate';
import { createEpubZipReader } from './epubZipReader';
import type { EpubZipArchiveReader } from './epubZipReader';
import { parseEpub } from './epubParser';
import type { EpubCoverage, EpubParseStatus } from './epubParser';

export const SOURCE_PARSER_VERSION = '1';
export const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
export const MAX_SOURCE_TEXT_BYTES = 8 * 1024 * 1024;
export const MAX_DOCX_EXPANDED_BYTES = 24 * 1024 * 1024;
export const MAX_RETAINED_ORIGINAL_BYTES = 2 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 512;
const MAX_ZIP_ENTRY_BYTES = 12 * 1024 * 1024;
const MAX_SOURCE_BLOCKS = 100_000;
const UTF8_FLAG = 0x0800;

export interface SourceBlock {
  id: string;
  start: number;
  end: number;
  kind: 'paragraph' | 'heading';
  label?: string;
  pageNumber?: number;
}

export interface ParsedNarrativeSource {
  text: string;
  filename: string;
  mediaType: 'text/plain' | 'text/markdown' | 'application/pdf' | 'application/epub+zip' | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  byteLength: number;
  digest: string;
  blocks: SourceBlock[];
  warnings: string[];
  originalBytesBase64?: string;
  retention: 'original-and-extracted' | 'extracted-only';
}

export type NarrativeSourceFailureKind = Exclude<EpubParseStatus, 'complete' | 'partial'>;

/** Typed EPUB failures let the import UI distinguish unsupported, empty, malformed, and bounded failures. */
export class NarrativeSourceParseError extends Error {
  constructor(
    readonly kind: NarrativeSourceFailureKind,
    message: string,
    readonly coverage?: EpubCoverage,
  ) {
    super(message);
    this.name = 'NarrativeSourceParseError';
  }
}

function sourceAbortError(message = 'Source preview was cancelled.'): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function decodeText(bytes: Uint8Array): string {
  try {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le', { fatal: true }).decode(bytes.subarray(2));
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be', { fatal: true }).decode(bytes.subarray(2));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('The source text encoding is invalid. Save it as UTF-8 or UTF-16 and try again.');
  }
}

function decodeZipFilename(bytes: Uint8Array, flags: number): string {
  if (!(flags & UTF8_FLAG) && bytes.some(byte => byte > 0x7f)) {
    throw new Error('The DOCX uses an unsupported non-UTF-8 archive filename.');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('The DOCX archive filename encoding is invalid.');
  }
}

const VALID_XML_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x9, 0x9],
  [0xa, 0xa],
  [0xd, 0xd],
  [0x20, 0xd7ff],
  [0xe000, 0xfffd],
  [0x10000, 0x10ffff],
];

function isValidXmlCodePoint(codePoint: number): boolean {
  return VALID_XML_RANGES.some(([min, max]) => codePoint >= min && codePoint <= max);
}

function decodeNumericXmlChar(raw: string, radix: number): string {
  const codePoint = Number.parseInt(raw, radix);
  if (!Number.isInteger(codePoint) || !isValidXmlCodePoint(codePoint)) {
    throw new Error('The DOCX XML contains an invalid character reference.');
  }
  return String.fromCodePoint(codePoint);
}

function xmlText(value: string): string {
  return value
    .replace(/&#x([\da-f]+);/gi, (_match, code) => decodeNumericXmlChar(code, 16))
    .replace(/&#(\d+);/g, (_match, code) => decodeNumericXmlChar(code, 10))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function findZipEocd(bytes: Uint8Array, view: DataView): number {
  const start = Math.max(0, bytes.length - 65_557);
  for (let i = bytes.length - 22; i >= start; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) {
      return i;
    }
  }
  throw new Error('This DOCX is not a valid ZIP package.');
}

function assertZipExtraClean(view: DataView, start: number, length: number, limit: number): void {
  const end = start + length;
  if (end > limit) throw new Error('The DOCX ZIP extra field is malformed.');
  let offset = start;
  while (offset + 4 <= end) {
    const id = view.getUint16(offset, true);
    const size = view.getUint16(offset + 2, true);
    offset += 4 + size;
    if (offset > end) throw new Error('The DOCX ZIP extra field is malformed.');
    if (id === 0x0001) throw new Error('The DOCX archive uses an unsupported ZIP64 extra field.');
  }
  if (offset !== end) throw new Error('The DOCX ZIP extra field is malformed.');
}

interface DocxCentralEntry {
  nameBytes: Uint8Array;
  flags: number;
  method: number;
  compressed: number;
  expanded: number;
  diskStart: number;
  localOffset: number;
  nextOffset: number;
}

function assertLocalMatchesCentral(localHeader: DocxCentralEntry, central: DocxCentralEntry): void {
  const numericMismatch =
    localHeader.flags !== central.flags ||
    localHeader.method !== central.method ||
    localHeader.compressed !== central.compressed ||
    localHeader.expanded !== central.expanded;
  if (numericMismatch) throw new Error('The DOCX local and central ZIP headers disagree.');
  const bytesMismatch =
    localHeader.nameBytes.length !== central.nameBytes.length ||
    localHeader.nameBytes.some((b, i) => b !== central.nameBytes[i]);
  if (bytesMismatch) throw new Error('The DOCX local and central ZIP filenames disagree.');
}

function verifyDocxLocalHeader(bytes: Uint8Array, view: DataView, entry: DocxCentralEntry, centralOffset: number): void {
  const local = entry.localOffset;
  if (local + 30 > centralOffset || view.getUint32(local, true) !== 0x04034b50) {
    throw new Error('The DOCX local ZIP header is malformed.');
  }
  const nameLength = view.getUint16(local + 26, true);
  const extraLength = view.getUint16(local + 28, true);
  const dataOffset = local + 30 + nameLength + extraLength;
  if (dataOffset + entry.compressed > centralOffset) throw new Error('The DOCX local ZIP entry bounds are invalid.');
  assertZipExtraClean(view, local + 30 + nameLength, extraLength, centralOffset);
  assertLocalMatchesCentral({
    nameBytes: bytes.subarray(local + 30, local + 30 + nameLength),
    flags: view.getUint16(local + 6, true),
    method: view.getUint16(local + 8, true),
    compressed: view.getUint32(local + 18, true),
    expanded: view.getUint32(local + 22, true),
    diskStart: 0,
    localOffset: local,
    nextOffset: 0,
  }, entry);
}

function readDocxEocdHeader(bytes: Uint8Array, view: DataView) {
  const eocd = findZipEocd(bytes, view);
  const diskMismatch = view.getUint16(eocd + 4, true) !== 0 || view.getUint16(eocd + 6, true) !== 0;
  const diskEntries = view.getUint16(eocd + 8, true);
  const entryCount = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  const badDirectory = diskMismatch || diskEntries !== entryCount || entryCount > MAX_ZIP_ENTRIES || centralOffset + centralSize > eocd;
  const hasZip64Marker = entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff;
  if (badDirectory || hasZip64Marker) {
    throw new Error('The DOCX archive uses an unsupported or unsafe ZIP layout.');
  }
  return { eocd, entryCount, centralSize, centralOffset };
}

function assertDocxEntryFlagsAndSize(entry: DocxCentralEntry): void {
  if (entry.flags & 1) throw new Error('Encrypted DOCX files are not supported.');
  if (entry.flags & 0x0008) throw new Error('DOCX archives using data descriptors are not supported.');
  if (entry.diskStart !== 0) throw new Error('Multi-disk DOCX archives are not supported.');
  if (entry.method !== 0 && entry.method !== 8) throw new Error('The DOCX uses an unsupported compression method.');
  const exceedsSize = entry.expanded > MAX_ZIP_ENTRY_BYTES || entry.compressed > MAX_SOURCE_BYTES;
  const zeroCompressedWithData = entry.compressed === 0 && entry.expanded > 0;
  const ratioTooHigh = entry.compressed > 0 && entry.expanded / entry.compressed > 200;
  if (exceedsSize || zeroCompressedWithData || ratioTooHigh) {
    throw new Error('The DOCX contains an oversized or highly compressed entry.');
  }
}

function readDocxCentralRecord(bytes: Uint8Array, view: DataView, offset: number, eocd: number): DocxCentralEntry {
  if (offset + 46 > eocd || view.getUint32(offset, true) !== 0x02014b50) {
    throw new Error('The DOCX central directory is malformed.');
  }
  const nameLength = view.getUint16(offset + 28, true);
  const extraLength = view.getUint16(offset + 30, true);
  const commentLength = view.getUint16(offset + 32, true);
  const nextOffset = offset + 46 + nameLength + extraLength + commentLength;
  const entry: DocxCentralEntry = {
    nameBytes: bytes.subarray(offset + 46, offset + 46 + nameLength),
    flags: view.getUint16(offset + 8, true),
    method: view.getUint16(offset + 10, true),
    compressed: view.getUint32(offset + 20, true),
    expanded: view.getUint32(offset + 24, true),
    diskStart: view.getUint16(offset + 34, true),
    localOffset: view.getUint32(offset + 42, true),
    nextOffset,
  };
  const hasZip64Size = entry.compressed === 0xffffffff || entry.expanded === 0xffffffff || entry.localOffset === 0xffffffff;
  if (!nameLength || nextOffset > eocd || hasZip64Size) {
    throw new Error('The DOCX central directory entry is malformed.');
  }
  assertZipExtraClean(view, offset + 46 + nameLength, extraLength, eocd);
  return entry;
}

function assertSafeDocxEntryName(name: string, seenNames: Set<string>): void {
  const hasTraversal = name.startsWith('/') || name.includes('\\') || name.split('/').includes('..');
  if (hasTraversal) throw new Error('The DOCX contains an unsafe archive path.');
  if (seenNames.has(name)) throw new Error(`The DOCX contains a duplicate archive entry: ${name}.`);
  seenNames.add(name);
}

function validateDocxCentralEntry(params: {
  bytes: Uint8Array;
  view: DataView;
  offset: number;
  bounds: { eocd: number; centralOffset: number };
  seenNames: Set<string>;
}): { nextOffset: number; expanded: number; isDocument: boolean } {
  const entry = readDocxCentralRecord(params.bytes, params.view, params.offset, params.bounds.eocd);
  const name = decodeZipFilename(entry.nameBytes, entry.flags);
  assertSafeDocxEntryName(name, params.seenNames);
  assertDocxEntryFlagsAndSize(entry);
  verifyDocxLocalHeader(params.bytes, params.view, entry, params.bounds.centralOffset);
  return { nextOffset: entry.nextOffset, expanded: entry.expanded, isDocument: name === 'word/document.xml' };
}

function assertZipBounds(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const { eocd, entryCount, centralSize, centralOffset } = readDocxEocdHeader(bytes, view);
  let offset = centralOffset;
  let totalExpanded = 0;
  let documentFound = false;
  const seenNames = new Set<string>();
  for (let index = 0; index < entryCount; index += 1) {
    const entry = validateDocxCentralEntry({ bytes, view, offset, bounds: { eocd, centralOffset }, seenNames });
    totalExpanded += entry.expanded;
    if (totalExpanded > MAX_DOCX_EXPANDED_BYTES) throw new Error('The DOCX expands beyond the safe processing limit.');
    if (entry.isDocument) documentFound = true;
    offset = entry.nextOffset;
  }
  if (offset !== centralOffset + centralSize || !documentFound) {
    throw new Error('The DOCX is missing its main document or has an invalid archive directory.');
  }
}

async function extractDocxDocument(bytes: Uint8Array, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw sourceAbortError();
  assertZipBounds(bytes);
  return await new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    let found = false;
    let settled = false;
    let activeFile: { terminate: () => void } | undefined;
    const finish = (err?: Error, value?: string) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      if (err) reject(err);
      else resolve(value!);
    };
    const onAbort = () => {
      try { activeFile?.terminate(); } catch { /* ignore */ }
      finish(sourceAbortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    const unzip = new Unzip(file => {
      if (settled || file.name !== 'word/document.xml') {
        file.terminate();
        return;
      }
      found = true;
      activeFile = file;
      file.ondata = (error, chunk, final) => {
        if (settled) { file.terminate(); return; }
        if (error) { finish(new Error('The DOCX document XML could not be decompressed.')); return; }
        total += chunk.byteLength;
        if (total > MAX_SOURCE_TEXT_BYTES) {
          file.terminate();
          finish(new Error('The extracted DOCX document exceeds the safe text limit.'));
          return;
        }
        chunks.push(chunk);
        if (final) {
          const merged = new Uint8Array(total);
          let cursor = 0;
          for (const part of chunks) { merged.set(part, cursor); cursor += part.byteLength; }
          try { finish(undefined, decodeText(merged)); }
          catch (decodeError) { finish(decodeError instanceof Error ? decodeError : new Error('Invalid DOCX XML encoding.')); }
        }
      };
      file.start();
    });
    unzip.register(AsyncUnzipInflate);
    unzip.register(UnzipPassThrough);
    try { unzip.push(bytes, true); } catch { finish(new Error('The DOCX archive is malformed or unsupported.')); }
    queueMicrotask(() => { if (!settled && !found) finish(new Error('The DOCX main document could not be read.')); });
  });
}

function buildBlockRecord(content: string, start: number, index: number): SourceBlock {
  const heading = /^(#{1,6})\s+(.+)$/.exec(content);
  return {
    id: `source-block-${index + 1}`,
    start,
    end: start + content.length,
    kind: heading ? 'heading' : 'paragraph',
    ...(heading ? { label: heading[2] } : {}),
  };
}

function blockRecords(text: string): SourceBlock[] {
  const blocks: SourceBlock[] = [];
  for (const match of text.matchAll(/[^\n]*(?:\n|$)/g)) {
    const raw = match[0];
    if (!raw) continue;
    const content = raw.replace(/\r?\n$/, '');
    if (!content.trim()) continue;
    if (blocks.length >= MAX_SOURCE_BLOCKS) {
      throw new Error(`The source has more than ${MAX_SOURCE_BLOCKS.toLocaleString()} paragraphs or blocks; simplify the source structure and retry.`);
    }
    blocks.push(buildBlockRecord(content, match.index!, blocks.length));
  }
  return blocks;
}

function extractTopLevelWordParagraphs(xml: string): string[] {
  const inners: string[] = [];
  let depth = 0;
  let outerStart = 0;
  for (const match of xml.matchAll(/<\/?w:p(?:\s[^>]*)?\/?>/g)) {
    const tag = match[0];
    if (tag.startsWith('</')) {
      if (depth === 0) continue;
      depth -= 1;
      if (depth === 0) inners.push(xml.slice(outerStart, match.index!));
      continue;
    }
    const selfClosing = tag.endsWith('/>');
    if (depth === 0 && selfClosing) {
      inners.push('');
    } else if (depth === 0) {
      depth = 1;
      outerStart = match.index! + tag.length;
    } else if (!selfClosing) {
      depth += 1;
    }
  }
  return inners;
}

function extractWordParagraphContent(inner: string): { paragraph: string; isHeading: boolean } {
  const outerPrefix = inner.split(/<w:p(?:\s|>|\/)/, 1)[0];
  const style = /<w:pStyle\b[^>]*\bw:val="([^"]+)"/.exec(outerPrefix)?.[1];
  let paragraph = '';
  for (const token of inner.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>/g)) {
    if (token[1] !== undefined) paragraph += xmlText(token[1]);
    else paragraph += /^<w:tab/.test(token[0]) ? '\t' : '\n';
  }
  const isHeading = Boolean(style && /^(?:Title|Subtitle|Heading[1-6])$/i.test(style));
  return { paragraph, isHeading };
}

function extractDocxParagraphs(xml: string): { text: string; blocks: SourceBlock[]; warnings: string[] } {
  if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(xml)) throw new Error('DOCX XML declarations with DTD or entities are not supported.');
  const paragraphs: string[] = [];
  const blocks: SourceBlock[] = [];
  const warnings = ['Formatting, comments, tracked changes, footnotes, and external relationships are not reproduced.'];
  let textOffset = 0;
  for (const inner of extractTopLevelWordParagraphs(xml)) {
    if (paragraphs.length >= MAX_SOURCE_BLOCKS) throw new Error(`The DOCX has more than ${MAX_SOURCE_BLOCKS.toLocaleString()} paragraphs; simplify the source structure and retry.`);
    const { paragraph, isHeading } = extractWordParagraphContent(inner);
    paragraphs.push(paragraph);
    if (paragraph.trim()) {
      blocks.push({
        id: `source-block-${blocks.length + 1}`,
        start: textOffset,
        end: textOffset + paragraph.length,
        kind: isHeading ? 'heading' : 'paragraph',
        ...(isHeading ? { label: paragraph } : {}),
      });
    }
    textOffset += paragraph.length + 1;
  }
  if (/<w:tbl\b/.test(xml)) warnings.push('Tables are flattened to paragraph text; layout and cell relationships are not retained.');
  return { text: paragraphs.join('\n'), blocks, warnings };
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  return btoa(binary);
}

function openEpubArchiveSafely(bytes: Uint8Array, signal?: AbortSignal): EpubZipArchiveReader {
  try {
    return createEpubZipReader(bytes, { signal });
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw sourceAbortError();
    throw new NarrativeSourceParseError('malformed', error instanceof Error ? error.message : 'The EPUB ZIP structure is malformed.');
  }
}

function formatPartialEpubWarning(coverage: EpubCoverage): string {
  const omitted = coverage.unsupportedItems.slice(0, 5).join('; ');
  const suffix = coverage.unsupportedItems.length > 5 ? '; …' : '';
  const examples = omitted ? ` Examples: ${omitted}${suffix}` : '';
  return `EPUB text is partial: ${coverage.extractedSpineItems} of ${coverage.totalSpineItems} spine items were extracted; ${coverage.omittedSpineItems} were omitted.${examples}`;
}

async function parseEpubBytes(
  bytes: Uint8Array,
  warnings: string[],
  signal?: AbortSignal,
): Promise<{ text: string; blocks: SourceBlock[] }> {
  const reader = openEpubArchiveSafely(bytes, signal);
  const extracted = await parseEpub(reader, undefined, { signal });
  if (extracted.status === 'cancelled') throw sourceAbortError(extracted.reason);
  if (extracted.status !== 'complete' && extracted.status !== 'partial') {
    throw new NarrativeSourceParseError(extracted.status, extracted.reason ?? 'EPUB content could not be read.', extracted.coverage);
  }
  warnings.push(...extracted.warnings);
  if (extracted.status === 'partial') warnings.push(formatPartialEpubWarning(extracted.coverage));
  const blocks: SourceBlock[] = extracted.blocks.map(block => ({
    id: block.id, start: block.start, end: block.end, kind: block.kind,
    ...(block.label ? { label: block.label } : {}),
  }));
  return { text: extracted.text, blocks };
}

type FormatDispatchResult = { text: string; mediaType: ParsedNarrativeSource['mediaType']; blocks: SourceBlock[] };

async function parseDocxSource(bytes: Uint8Array, warnings: string[], signal?: AbortSignal): Promise<FormatDispatchResult> {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('The selected DOCX file does not have a ZIP package signature.');
  const extracted = extractDocxParagraphs(await extractDocxDocument(bytes, signal));
  warnings.push(...extracted.warnings);
  return { text: extracted.text, blocks: extracted.blocks, mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
}

async function parsePdfSource(bytes: Uint8Array, warnings: string[], signal?: AbortSignal): Promise<FormatDispatchResult> {
  if (new TextDecoder('ascii').decode(bytes.subarray(0, 5)) !== '%PDF-') {
    throw new Error('Supported sources are pasted text, .txt, .md, .docx, and selectable-text .pdf files.');
  }
  const { extractPdfText } = await import('./pdfTextParser');
  const extracted = await extractPdfText(bytes, signal);
  warnings.push(...extracted.warnings);
  return { text: extracted.text, blocks: extracted.blocks, mediaType: 'application/pdf' };
}

async function dispatchFormatParser(params: {
  input: string | File | Uint8Array;
  bytes: Uint8Array;
  suffix: string | undefined;
  warnings: string[];
  signal?: AbortSignal;
}): Promise<FormatDispatchResult> {
  const { input, bytes, suffix, warnings, signal } = params;
  const isTextFormat = typeof input === 'string' || suffix === 'txt' || suffix === 'md' || suffix === 'markdown';
  if (isTextFormat) {
    const text = typeof input === 'string' ? input : decodeText(bytes);
    const isMarkdown = suffix === 'md' || suffix === 'markdown';
    return { text, mediaType: isMarkdown ? 'text/markdown' : 'text/plain', blocks: blockRecords(text) };
  }
  if (suffix === 'docx') return parseDocxSource(bytes, warnings, signal);
  if (suffix === 'pdf') return parsePdfSource(bytes, warnings, signal);
  if (suffix === 'epub') {
    const epub = await parseEpubBytes(bytes, warnings, signal);
    return { text: epub.text, blocks: epub.blocks, mediaType: 'application/epub+zip' };
  }
  throw new Error('Supported sources are pasted text, .txt, .md, .docx, selectable-text .pdf, and text-based .epub files.');
}

async function readInputBuffer(input: string | File | Uint8Array): Promise<Uint8Array> {
  if (typeof input === 'string') return new TextEncoder().encode(input);
  if (input instanceof Uint8Array) return input;
  return new Uint8Array(await input.arrayBuffer());
}

async function readSourceInputBytes(input: string | File | Uint8Array, signal?: AbortSignal): Promise<Uint8Array> {
  if (signal?.aborted) throw sourceAbortError();
  const bytes = await readInputBuffer(input);
  if (signal?.aborted) throw sourceAbortError();
  if (typeof input === 'string' && new TextDecoder('utf-8', { fatal: true }).decode(bytes) !== input) {
    throw new Error('Pasted text contains an invalid Unicode surrogate; replace it with a valid character and retry.');
  }
  if (!bytes.length) throw new Error('The source is empty. Add narrative text before previewing.');
  if (bytes.byteLength > MAX_SOURCE_BYTES) throw new Error('The source exceeds the 12 MiB file limit.');
  return bytes;
}

function appendRetentionWarnings(warnings: string[], pasted: boolean, retainOriginal: boolean, byteLength: number): boolean {
  if (pasted) {
    warnings.push('Pasted text is retained exactly as immutable source text; there are no original file bytes.');
    return false;
  }
  const keepBytes = retainOriginal && byteLength <= MAX_RETAINED_ORIGINAL_BYTES;
  if (retainOriginal && !keepBytes) {
    warnings.push('Original bytes exceed the 2 MiB embedded-source safety limit. Choose extracted-only retention or a smaller file.');
  }
  if (!keepBytes) warnings.push('Only extracted text will be retained in the project and portable backup.');
  return keepBytes;
}

export async function parseNarrativeSource(
  input: string | File | Uint8Array,
  filename = 'pasted-narrative.txt',
  retainOriginal = true,
  signal?: AbortSignal,
): Promise<ParsedNarrativeSource> {
  const pasted = typeof input === 'string';
  const bytes = await readSourceInputBytes(input, signal);
  const suffix = filename.toLowerCase().split('.').pop();
  const warnings: string[] = [];
  const { text, mediaType, blocks } = await dispatchFormatParser({ input, bytes, suffix, warnings, signal });
  const textBytes = new TextEncoder().encode(text);
  if (!text.trim()) throw new Error('No readable narrative text was found in this source.');
  if (textBytes.byteLength > MAX_SOURCE_TEXT_BYTES) throw new Error('Extracted narrative exceeds the 8 MiB text limit.');
  const keepBytes = appendRetentionWarnings(warnings, pasted, retainOriginal, bytes.byteLength);
  return {
    text, filename: pasted ? 'pasted-narrative.txt' : filename,
    mediaType, byteLength: bytes.byteLength, digest: await sha256(bytes), blocks, warnings,
    ...(keepBytes ? { originalBytesBase64: toBase64(bytes) } : {}),
    retention: pasted || !keepBytes ? 'extracted-only' : 'original-and-extracted',
  };
}

export function countNarrativeWords(text: string): number {
  return text.match(/[\p{L}\p{N}]+(?:[’'][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}
