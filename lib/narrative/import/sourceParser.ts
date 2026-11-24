import { AsyncUnzipInflate, Unzip, UnzipPassThrough } from 'fflate';

export const SOURCE_PARSER_VERSION = '1';
export const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
export const MAX_SOURCE_TEXT_BYTES = 8 * 1024 * 1024;
export const MAX_DOCX_EXPANDED_BYTES = 24 * 1024 * 1024;
export const MAX_RETAINED_ORIGINAL_BYTES = 2 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 512;
const MAX_ZIP_ENTRY_BYTES = 12 * 1024 * 1024;
const MAX_SOURCE_BLOCKS = 100_000;

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
  mediaType: 'text/plain' | 'text/markdown' | 'application/pdf' | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  byteLength: number;
  digest: string;
  blocks: SourceBlock[];
  warnings: string[];
  originalBytesBase64?: string;
  retention: 'original-and-extracted' | 'extracted-only';
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

function xmlText(value: string): string {
  return value.replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function assertZipBounds(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = Math.max(0, bytes.length - 65_557);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= start; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('This DOCX is not a valid ZIP package.');
  const disk = view.getUint16(eocd + 4, true);
  const centralDisk = view.getUint16(eocd + 6, true);
  const diskEntries = view.getUint16(eocd + 8, true);
  const entryCount = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (disk || centralDisk || diskEntries !== entryCount || entryCount > MAX_ZIP_ENTRIES ||
    centralOffset + centralSize > eocd || entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error('The DOCX archive uses an unsupported or unsafe ZIP layout.');
  }
  let offset = centralOffset;
  let totalExpanded = 0;
  let documentFound = false;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) throw new Error('The DOCX central directory is malformed.');
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true);
    const expanded = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const diskStart = view.getUint16(offset + 34, true);
    const recordEnd = offset + 46 + nameLength + extraLength + commentLength;
    if (!nameLength || recordEnd > bytes.length) throw new Error('The DOCX central directory entry is malformed.');
    const name = decodeText(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) throw new Error('The DOCX contains an unsafe archive path.');
    if (flags & 1) throw new Error('Encrypted DOCX files are not supported.');
    if (diskStart !== 0) throw new Error('Multi-disk DOCX archives are not supported.');
    if (method !== 0 && method !== 8) throw new Error('The DOCX uses an unsupported compression method.');
    if (expanded > MAX_ZIP_ENTRY_BYTES || compressed > MAX_SOURCE_BYTES || (compressed === 0 && expanded > 0) ||
      (compressed > 0 && expanded / compressed > 200)) throw new Error('The DOCX contains an oversized or highly compressed entry.');
    totalExpanded += expanded;
    if (totalExpanded > MAX_DOCX_EXPANDED_BYTES) throw new Error('The DOCX expands beyond the safe processing limit.');
    if (name === 'word/document.xml') documentFound = true;
    offset = recordEnd;
  }
  if (offset !== centralOffset + centralSize || !documentFound) throw new Error('The DOCX is missing its main document or has an invalid archive directory.');
}

async function extractDocxDocument(bytes: Uint8Array): Promise<string> {
  assertZipBounds(bytes);
  return await new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    let found = false;
    const unzip = new Unzip(file => {
      if (file.name !== 'word/document.xml') {
        file.terminate();
        return;
      }
      found = true;
      file.ondata = (error, chunk, final) => {
        if (error) { reject(new Error('The DOCX document XML could not be decompressed.')); return; }
        total += chunk.byteLength;
        if (total > MAX_SOURCE_TEXT_BYTES) {
          file.terminate();
          reject(new Error('The extracted DOCX document exceeds the safe text limit.'));
          return;
        }
        chunks.push(chunk);
        if (final) {
          const merged = new Uint8Array(total);
          let cursor = 0;
          for (const part of chunks) { merged.set(part, cursor); cursor += part.byteLength; }
          resolve(decodeText(merged));
        }
      };
      file.start();
    });
    unzip.register(AsyncUnzipInflate);
    unzip.register(UnzipPassThrough);
    try { unzip.push(bytes, true); } catch { reject(new Error('The DOCX archive is malformed or unsupported.')); }
    queueMicrotask(() => { if (!found) reject(new Error('The DOCX main document could not be read.')); });
  });
}

function blockRecords(text: string, kinds: Array<{ start: number; end: number; kind: 'paragraph' | 'heading'; label?: string }> = []): SourceBlock[] {
  const candidates = kinds.length ? kinds : (() => {
    const result: Array<{ start: number; end: number; kind: 'paragraph' | 'heading' }> = [];
    const lines = /[^\n]*(?:\n|$)/g;
    for (const match of text.matchAll(lines)) {
      const raw = match[0];
      const start = match.index!;
      const contentEnd = start + raw.replace(/\r?\n$/, '').length;
      if (contentEnd > start && raw.slice(0, -(/\r?\n$/.test(raw) ? (raw.endsWith('\r\n') ? 2 : 1) : 0)).trim()) {
        if (result.length >= MAX_SOURCE_BLOCKS) throw new Error(`The source has more than ${MAX_SOURCE_BLOCKS.toLocaleString()} paragraphs or blocks; simplify the source structure and retry.`);
        const content = raw.replace(/\r?\n$/, '');
        const heading = /^(#{1,6})\s+(.+)$/.exec(content);
        result.push({ start, end: contentEnd, kind: heading ? 'heading' : 'paragraph', ...(heading ? { label: heading[2] } : {}) });
      }
    }
    return result;
  })();
  return candidates.map((block, index) => ({ id: `source-block-${index + 1}`, ...block }));
}

function extractDocxParagraphs(xml: string): { text: string; blocks: ReturnType<typeof blockRecords>; warnings: string[] } {
  if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(xml)) throw new Error('DOCX XML declarations with DTD or entities are not supported.');
  const paragraphs: string[] = [];
  const metadata: Array<{ start: number; end: number; kind: 'paragraph' | 'heading'; label?: string }> = [];
  const warnings = ['Formatting, comments, tracked changes, footnotes, and external relationships are not reproduced.'];
  let textOffset = 0;
  for (const match of xml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)) {
    if (paragraphs.length >= MAX_SOURCE_BLOCKS) throw new Error(`The DOCX has more than ${MAX_SOURCE_BLOCKS.toLocaleString()} paragraphs; simplify the source structure and retry.`);
    const inner = match[1];
    const style = /<w:pStyle\b[^>]*\bw:val="([^"]+)"/.exec(inner)?.[1];
    let paragraph = '';
    for (const token of inner.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>/g)) {
      if (token[1] !== undefined) paragraph += xmlText(token[1]);
      else if (/^<w:tab/.test(token[0])) paragraph += '\t';
      else paragraph += '\n';
    }
    const heading = Boolean(style && /^(?:Title|Subtitle|Heading[1-6])$/i.test(style));
    const start = textOffset;
    paragraphs.push(paragraph);
    if (paragraph.trim()) metadata.push({ start, end: start + paragraph.length, kind: heading ? 'heading' : 'paragraph', ...(heading ? { label: paragraph } : {}) });
    textOffset += paragraph.length + 1;
  }
  const text = paragraphs.join('\n');
  const blocks = metadata.map((block, index) => ({ id: `source-block-${index + 1}`, ...block }));
  if (/<w:tbl\b/.test(xml)) warnings.push('Tables are flattened to paragraph text; layout and cell relationships are not retained.');
  return { text, blocks, warnings };
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

export async function parseNarrativeSource(
  input: string | File | Uint8Array,
  filename = 'pasted-narrative.txt',
  retainOriginal = true,
): Promise<ParsedNarrativeSource> {
  const pasted = typeof input === 'string';
  const bytes = pasted ? new TextEncoder().encode(input) : input instanceof Uint8Array ? input : new Uint8Array(await input.arrayBuffer());
  if (pasted && new TextDecoder('utf-8', { fatal: true }).decode(bytes) !== input) {
    throw new Error('Pasted text contains an invalid Unicode surrogate; replace it with a valid character and retry.');
  }
  if (!bytes.length) throw new Error('The source is empty. Add narrative text before previewing.');
  if (bytes.byteLength > MAX_SOURCE_BYTES) throw new Error('The source exceeds the 12 MiB file limit.');
  const suffix = filename.toLowerCase().split('.').pop();
  let text: string;
  let mediaType: ParsedNarrativeSource['mediaType'];
  let blocks: SourceBlock[];
  const warnings: string[] = [];
  if (pasted || suffix === 'txt' || suffix === 'md' || suffix === 'markdown') {
    text = pasted ? input as string : decodeText(bytes);
    mediaType = suffix === 'md' || suffix === 'markdown' ? 'text/markdown' : 'text/plain';
    blocks = blockRecords(text);
  } else if (suffix === 'docx') {
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('The selected DOCX file does not have a ZIP package signature.');
    const extracted = extractDocxParagraphs(await extractDocxDocument(bytes));
    text = extracted.text;
    blocks = extracted.blocks;
    warnings.push(...extracted.warnings);
    mediaType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  } else if (suffix === 'pdf') {
    if (new TextDecoder('ascii').decode(bytes.subarray(0, 5)) !== '%PDF-') {
      throw new Error('Supported sources are pasted text, .txt, .md, .docx, and selectable-text .pdf files.');
    }
    const { extractPdfText } = await import('./pdfTextParser');
    const extracted = await extractPdfText(bytes);
    text = extracted.text;
    blocks = extracted.blocks;
    warnings.push(...extracted.warnings);
    mediaType = 'application/pdf';
  } else {
    throw new Error('Supported sources are pasted text, .txt, .md, .docx, and selectable-text .pdf files.');
  }
  const textBytes = new TextEncoder().encode(text);
  if (!text.trim()) throw new Error('No readable narrative text was found in this source.');
  if (textBytes.byteLength > MAX_SOURCE_TEXT_BYTES) throw new Error('Extracted narrative exceeds the 8 MiB text limit.');
  if (pasted) warnings.push('Pasted text is retained exactly as immutable source text; there are no original file bytes.');
  const keepBytes = !pasted && retainOriginal && bytes.byteLength <= MAX_RETAINED_ORIGINAL_BYTES;
  if (!pasted && retainOriginal && !keepBytes) warnings.push('Original bytes exceed the 2 MiB embedded-source safety limit. Choose extracted-only retention or a smaller file.');
  if (!pasted && !keepBytes) warnings.push('Only extracted text will be retained in the project and portable backup.');
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
