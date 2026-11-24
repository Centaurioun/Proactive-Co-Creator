import { AsyncUnzipInflate, Unzip } from 'fflate';

export type EpubZipCompression = 'stored' | 'deflate' | 'unsupported';

export interface EpubZipEntry {
  path: string;
  compressedBytes: number;
  uncompressedBytes: number;
  compression: EpubZipCompression;
  encrypted: boolean;
}

export interface EpubZipArchiveReader {
  archiveBytes: number;
  entries(): readonly EpubZipEntry[];
  readEntry(path: string, maxBytes: number): Promise<Uint8Array>;
}

export interface EpubZipReaderLimits {
  maxArchiveBytes: number;
  maxEntries: number;
  maxPathLength: number;
  maxMemberBytes: number;
  maxExpandedBytes: number;
  maxCompressionRatio: number;
  maxOutputChunkBytes: number;
}

export const DEFAULT_EPUB_ZIP_READER_LIMITS: Readonly<EpubZipReaderLimits> = Object.freeze({
  maxArchiveBytes: 12 * 1024 * 1024,
  maxEntries: 512,
  maxPathLength: 1024,
  maxMemberBytes: 12 * 1024 * 1024,
  maxExpandedBytes: 24 * 1024 * 1024,
  maxCompressionRatio: 200,
  maxOutputChunkBytes: 64 * 1024,
});

export interface EpubZipReaderOptions {
  signal?: AbortSignal;
  limits?: Partial<EpubZipReaderLimits>;
}

interface CentralRecord extends EpubZipEntry {
  flags: number;
  crc32: number;
  localOffset: number;
  localName: Uint8Array;
  dataOffset: number;
  dataEnd: number;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const UTF8_FLAG = 0x0800;
const ALLOWED_FLAGS = UTF8_FLAG | 0x0006;
// fflate@0.8.3 selects its cancellable worker-backed inflate path at this cutoff.
const FFLATE_ASYNC_INFLATE_CUTOFF = 320_000;
const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_unused, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
  return value >>> 0;
});

function invalid(message: string): never { throw new Error(message); }

function assertLimits(limits: EpubZipReaderLimits): void {
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) invalid(`Invalid EPUB ZIP reader limit: ${key}.`);
  }
}

function findEocd(bytes: Uint8Array, view: DataView): number {
  const start = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= start; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD && offset + 22 + view.getUint16(offset + 20, true) === bytes.length) return offset;
  }
  return invalid('EPUB ZIP end-of-central-directory record is missing or malformed.');
}

function isSafeName(name: string, maxPathLength: number): boolean {
  if (!name || name.length > maxPathLength || /[\u0000-\u001f\u007f]/.test(name) || name.startsWith('/') || name.includes('\\')) return false;
  if (name.endsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(name)) return false;
  return name.split('/').every(segment => segment && segment !== '.' && segment !== '..' && !segment.includes(':'));
}

function decodeName(bytes: Uint8Array, flags: number): string {
  if (!(flags & UTF8_FLAG) && bytes.some(byte => byte > 0x7f)) return invalid('EPUB ZIP member uses unsupported non-UTF-8 legacy filename encoding.');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return invalid('EPUB ZIP member name is not valid UTF-8.'); }
}

function checkExtras(bytes: Uint8Array, start: number, length: number, context: string): void {
  const end = start + length;
  if (end > bytes.length) invalid(`EPUB ZIP ${context} extra field is truncated.`);
  let offset = start;
  while (offset < end) {
    if (offset + 4 > end) invalid(`EPUB ZIP ${context} extra field is malformed.`);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const id = view.getUint16(offset, true);
    const fieldLength = view.getUint16(offset + 2, true);
    offset += 4 + fieldLength;
    if (offset > end) invalid(`EPUB ZIP ${context} extra field is malformed.`);
    if (id === 0x0001) invalid('EPUB ZIP64 extra fields are unsupported.');
  }
}

function crcUpdate(crc: number, data: Uint8Array): number {
  let value = crc;
  for (const byte of data) value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return value >>> 0;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function parseCentralDirectory(bytes: Uint8Array, limits: EpubZipReaderLimits): { records: CentralRecord[]; archiveBytes: number; expandedBytes: number; centralOffset: number } {
  if (bytes.byteLength > limits.maxArchiveBytes) invalid('EPUB archive exceeds the compressed-size limit.');
  if (bytes.byteLength < 22) invalid('EPUB ZIP archive is too short.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(bytes, view);
  const disk = view.getUint16(eocd + 4, true);
  const centralDisk = view.getUint16(eocd + 6, true);
  const diskEntries = view.getUint16(eocd + 8, true);
  const entryCount = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (disk || centralDisk || diskEntries !== entryCount || entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    invalid('Multi-disk and ZIP64 EPUB archives are unsupported.');
  }
  if (!entryCount || entryCount > limits.maxEntries) invalid('EPUB archive exceeds the entry-count limit.');
  if (centralOffset + centralSize !== eocd) invalid('EPUB central directory does not end at its EOCD record.');

  const records: CentralRecord[] = [];
  const paths = new Set<string>();
  let offset = centralOffset;
  let expandedBytes = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > eocd || view.getUint32(offset, true) !== CENTRAL) invalid('EPUB central directory record is malformed.');
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const crc32 = view.getUint32(offset + 16, true);
    const compressedBytes = view.getUint32(offset + 20, true);
    const uncompressedBytes = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const diskStart = view.getUint16(offset + 34, true);
    const localOffset = view.getUint32(offset + 42, true);
    const recordEnd = offset + 46 + nameLength + extraLength + commentLength;
    if (!nameLength || recordEnd > eocd || diskStart || localOffset === 0xffffffff || compressedBytes === 0xffffffff || uncompressedBytes === 0xffffffff) {
      invalid('EPUB central directory contains an unsupported or truncated record.');
    }
    if (flags & 1 || flags & ~ALLOWED_FLAGS || (flags & 0x0008)) invalid('Encrypted, descriptor-based, or unsupported ZIP flags are not supported.');
    if (method !== 0 && method !== 8) invalid('EPUB ZIP uses an unsupported compression method.');
    checkExtras(bytes, offset + 46 + nameLength, extraLength, 'central');
    const localName = bytes.slice(offset + 46, offset + 46 + nameLength);
    const name = decodeName(localName, flags);
    if (!isSafeName(name, limits.maxPathLength)) invalid(`EPUB ZIP contains an unsafe member path: ${name}.`);
    if (paths.has(name)) invalid(`EPUB ZIP contains a duplicate member path: ${name}.`);
    paths.add(name);
    if (uncompressedBytes > limits.maxMemberBytes) invalid(`EPUB member exceeds the per-member size limit: ${name}.`);
    if ((!compressedBytes && uncompressedBytes) || (compressedBytes && uncompressedBytes / compressedBytes > limits.maxCompressionRatio)) {
      invalid(`EPUB member exceeds the configured compression ratio: ${name}.`);
    }
    expandedBytes += uncompressedBytes;
    if (!Number.isSafeInteger(expandedBytes) || expandedBytes > limits.maxExpandedBytes) invalid('EPUB archive exceeds the total expanded-size limit.');
    records.push({
      path: name,
      flags,
      compressedBytes,
      uncompressedBytes,
      compression: method === 0 ? 'stored' : 'deflate',
      encrypted: false,
      crc32,
      localOffset,
      localName,
      dataOffset: 0,
      dataEnd: 0,
    });
    offset = recordEnd;
  }
  if (offset !== centralOffset + centralSize) invalid('EPUB central directory size does not match its records.');

  records.sort((left, right) => left.localOffset - right.localOffset);
  let expectedLocalOffset = 0;
  for (const record of records) {
    const local = record.localOffset;
    if (local !== expectedLocalOffset || local + 30 > centralOffset || view.getUint32(local, true) !== LOCAL) {
      invalid('EPUB local header ordering or offset is invalid; records must be contiguous from byte zero.');
    }
    const flags = view.getUint16(local + 6, true);
    const method = view.getUint16(local + 8, true);
    const crc32 = view.getUint32(local + 14, true);
    const compressedBytes = view.getUint32(local + 18, true);
    const uncompressedBytes = view.getUint32(local + 22, true);
    const nameLength = view.getUint16(local + 26, true);
    const extraLength = view.getUint16(local + 28, true);
    if (record.path === 'mimetype' && extraLength !== 0) invalid('EPUB mimetype local header must not contain an extra field.');
    const nameStart = local + 30;
    const extraStart = nameStart + nameLength;
    const dataOffset = extraStart + extraLength;
    const dataEnd = dataOffset + record.compressedBytes;
    if (dataOffset > centralOffset || dataEnd > centralOffset) {
      invalid(`EPUB local header metadata is malformed for ${record.path}.`);
    }
    if (flags !== record.flags || flags & 1 || flags & ~ALLOWED_FLAGS || (flags & 0x0008) || method !== (record.compression === 'stored' ? 0 : 8) ||
      crc32 !== record.crc32 || compressedBytes !== record.compressedBytes || uncompressedBytes !== record.uncompressedBytes) {
      invalid(`EPUB local and central header metadata disagree for ${record.path}.`);
    }
    const localName = bytes.subarray(nameStart, extraStart);
    if (!equalBytes(localName, record.localName)) invalid(`EPUB local and central filenames disagree for ${record.path}.`);
    checkExtras(bytes, extraStart, extraLength, 'local');
    record.dataOffset = dataOffset;
    record.dataEnd = dataEnd;
    expectedLocalOffset = dataEnd;
  }
  if (expectedLocalOffset !== centralOffset) invalid('EPUB ZIP local records overlap or leave unaccounted bytes before the central directory.');
  if (records[0]?.path !== 'mimetype' || records[0].localOffset !== 0) invalid('EPUB mimetype must be the first physical local-header member.');
  if (records[0].compression !== 'stored' || records[0].encrypted) invalid('EPUB mimetype must be stored and unencrypted.');
  return { records, archiveBytes: bytes.byteLength, expandedBytes, centralOffset };
}

function abortError(): Error { return new Error('EPUB ZIP member read was aborted.'); }

export function withEpubWorkerErrorBridge(worker: Worker): () => void {
  const onError = (event: ErrorEvent) => {
    event.preventDefault();
    const error = event.error instanceof Error ? event.error : undefined;
    worker.onmessage?.({ data: { $e$: [event.message || 'EPUB decompression worker failed.', error?.name, error?.stack] } } as MessageEvent);
  };
  worker.addEventListener('error', onError);
  return () => worker.removeEventListener('error', onError);
}

function withBrowserWorkerErrorBridge<T>(workerCleanups: Array<() => void>, operation: () => T): T {
  if (typeof window === 'undefined' || typeof globalThis.Worker !== 'function') return operation();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  const NativeWorker = globalThis.Worker;
  class ErrorForwardingWorker extends NativeWorker {
    constructor(scriptURL: string | URL, options?: WorkerOptions) {
      super(scriptURL, options);
      workerCleanups.push(withEpubWorkerErrorBridge(this));
    }
  }
  Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: ErrorForwardingWorker });
  try { return operation(); }
  finally {
    if (descriptor) Object.defineProperty(globalThis, 'Worker', descriptor);
    else Reflect.deleteProperty(globalThis, 'Worker');
  }
}

export function createEpubZipReader(input: Uint8Array, options: EpubZipReaderOptions = {}): EpubZipArchiveReader {
  const limits: EpubZipReaderLimits = { ...DEFAULT_EPUB_ZIP_READER_LIMITS, ...options.limits };
  assertLimits(limits);
  if (input.byteLength > limits.maxArchiveBytes) invalid('EPUB archive exceeds the compressed-size limit.');
  const bytes = input.slice();
  const { records } = parseCentralDirectory(bytes, limits);
  const byPath = new Map(records.map(record => [record.path, record]));
  const entries: readonly EpubZipEntry[] = records.map(({ path, compressedBytes, uncompressedBytes, compression, encrypted }) => ({
    path, compressedBytes, uncompressedBytes, compression, encrypted,
  }));
  const signal = options.signal;
  let readActive = false;

  return {
    archiveBytes: bytes.byteLength,
    entries: () => entries,
    async readEntry(path, maxBytes) {
      if (readActive) throw new Error('Another EPUB ZIP member read is active; reads are serialized to preserve memory bounds.');
      readActive = true;
      try {
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error('EPUB ZIP read limit is invalid.');
      if (signal?.aborted) throw abortError();
      const record = byPath.get(path);
      if (!record) throw new Error(`EPUB ZIP member does not exist: ${path}.`);
      if (record.uncompressedBytes > maxBytes) throw new Error(`EPUB ZIP member exceeds the requested read limit: ${path}.`);
      if (record.compression === 'stored') {
        if (record.compressedBytes !== record.uncompressedBytes) throw new Error(`EPUB stored member has inconsistent sizes: ${path}.`);
        const result = new Uint8Array(record.uncompressedBytes);
        let copied = 0;
        let crc = 0xffffffff;
        while (copied < record.uncompressedBytes) {
          if (signal?.aborted) throw abortError();
          const amount = Math.min(limits.maxOutputChunkBytes, record.uncompressedBytes - copied);
          const chunk = bytes.subarray(record.dataOffset + copied, record.dataOffset + copied + amount);
          result.set(chunk, copied);
          crc = crcUpdate(crc, chunk);
          copied += amount;
          if (copied < record.uncompressedBytes) await new Promise<void>(resolve => setTimeout(resolve, 0));
        }
        if (signal?.aborted) throw abortError();
        if (((crc ^ 0xffffffff) >>> 0) !== record.crc32) throw new Error(`EPUB ZIP member CRC check failed: ${path}.`);
        return result;
      }

      if (record.compressedBytes < FFLATE_ASYNC_INFLATE_CUTOFF) {
        throw new Error(`EPUB DEFLATE member is unsupported below the cancellable-inflate size threshold: ${path}.`);
      }
      return await new Promise<Uint8Array>((resolve, reject) => {
        let settled = false;
        let found = false;
        let outputBytes = 0;
        let crc = 0xffffffff;
        const chunks: Uint8Array[] = [];
        const workerCleanups: Array<() => void> = [];
        const settle = (error?: Error, value?: Uint8Array) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener('abort', onAbort);
          for (const cleanup of workerCleanups.splice(0)) cleanup();
          if (error) activeFile?.terminate();
          if (error) reject(error);
          else resolve(value!);
        };
        let activeFile: { terminate(): void } | undefined;
        const onAbort = () => {
          activeFile?.terminate();
          settle(abortError());
        };
        const unzip = new Unzip(file => {
          if (file.name !== path) { file.terminate(); return; }
          found = true;
          activeFile = file;
          if (file.compression !== 8 || file.size !== record.compressedBytes || file.originalSize !== record.uncompressedBytes) {
            settle(new Error(`EPUB fflate member metadata disagrees with validated central directory: ${path}.`));
            return;
          }
          file.ondata = (error, chunk, final) => {
            if (settled) return;
            if (signal?.aborted) { onAbort(); return; }
            if (error) { settle(new Error(`EPUB DEFLATE failed for ${path}: ${String(error)}.`)); return; }
            if (chunk?.byteLength) {
              for (let offset = 0; offset < chunk.byteLength; offset += limits.maxOutputChunkBytes) {
                const part = chunk.subarray(offset, Math.min(chunk.byteLength, offset + limits.maxOutputChunkBytes));
                outputBytes += part.byteLength;
                if (outputBytes > maxBytes || outputBytes > record.uncompressedBytes || outputBytes > limits.maxMemberBytes ||
                  outputBytes / record.compressedBytes > limits.maxCompressionRatio) {
                  file.terminate();
                  settle(new Error(`EPUB DEFLATE output exceeds its actual member or ratio limit: ${path}.`));
                  return;
                }
                crc = crcUpdate(crc, part);
                chunks.push(part.slice());
              }
            }
            if (final) {
              if (outputBytes !== record.uncompressedBytes) { settle(new Error(`EPUB DEFLATE output size disagrees with central directory: ${path}.`)); return; }
              if (((crc ^ 0xffffffff) >>> 0) !== record.crc32) { settle(new Error(`EPUB ZIP member CRC check failed: ${path}.`)); return; }
              const result = new Uint8Array(outputBytes);
              let cursor = 0;
              for (const part of chunks) { result.set(part, cursor); cursor += part.byteLength; }
              settle(undefined, result);
            }
          };
          if (signal?.aborted) onAbort();
          else file.start();
        });
        unzip.register(AsyncUnzipInflate);
        signal?.addEventListener('abort', onAbort, { once: true });
        try {
          if (signal?.aborted) { onAbort(); return; }
          withBrowserWorkerErrorBridge(workerCleanups, () => unzip.push(bytes.subarray(record.localOffset, record.dataEnd), true));
          if (!found && !settled) settle(new Error(`fflate did not discover the requested member: ${path}.`));
        } catch (error) {
          settle(error instanceof Error ? error : new Error(String(error)));
        }
      });
      } finally {
        readActive = false;
      }
    },
  };
}
