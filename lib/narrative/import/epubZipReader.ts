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
  readEntry(path: string, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array>;
}

export interface EpubZipReaderLimits {
  maxArchiveBytes: number;
  maxEntries: number;
  maxQueuedReads: number;
  maxPathLength: number;
  maxMemberBytes: number;
  maxExpandedBytes: number;
  maxCompressionRatio: number;
  maxOutputChunkBytes: number;
  workerInitTimeoutMs: number;
  workerReadTimeoutMs: number;
}

export const DEFAULT_EPUB_ZIP_READER_LIMITS: Readonly<EpubZipReaderLimits> = Object.freeze({
  maxArchiveBytes: 12 * 1024 * 1024,
  maxEntries: 512,
  maxQueuedReads: 16,
  maxPathLength: 1024,
  maxMemberBytes: 12 * 1024 * 1024,
  maxExpandedBytes: 24 * 1024 * 1024,
  maxCompressionRatio: 200,
  maxOutputChunkBytes: 64 * 1024,
  workerInitTimeoutMs: 5_000,
  workerReadTimeoutMs: 30_000,
});

export interface EpubInflateWorkerLike {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
}

export interface EpubZipReaderOptions {
  signal?: AbortSignal;
  limits?: Partial<EpubZipReaderLimits>;
  workerFactory?: () => EpubInflateWorkerLike;
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
// A 1 KiB compressed push bounds fflate.Inflate's largest output burst. DEFLATE
// can encode a 258-byte match with a 1-bit length symbol and 1-bit distance
// symbol (RFC 1951), or 1,032 output bytes per compressed byte. A partial
// stored block may add at most 65,535 buffered bytes. fflate grows its output
// buffer by at most 2x the next 128 KiB target; the worker checks actual output
// before transferring it to the caller.
const DEFLATE_INPUT_CHUNK_BYTES = 1024;
const MAX_DEFLATE_MATCH_OUTPUT_PER_INPUT_BYTE = 1032;
const MAX_STORED_BLOCK_BYTES = 65_535;
const MAX_DEFLATE_OUTPUT_BURST_BYTES = DEFLATE_INPUT_CHUNK_BYTES * MAX_DEFLATE_MATCH_OUTPUT_PER_INPUT_BYTE + MAX_STORED_BLOCK_BYTES;
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
  if (!name || name.length > maxPathLength || name.startsWith('/') || name.includes('\\')) return false;
  if ([...name].some(character => { const code = character.charCodeAt(0); return code <= 0x1f || code === 0x7f; })) return false;
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

function createInflateWorker(options: EpubZipReaderOptions): EpubInflateWorkerLike {
  if (options.workerFactory) return options.workerFactory();
  if (typeof Worker === 'undefined') throw new Error('EPUB DEFLATE requires a dedicated Worker.');
  return new Worker(new URL('./epubInflate.worker.ts', import.meta.url), { type: 'module' });
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
  let readQueue: Promise<void> = Promise.resolve();

  const readEntryNow = async (path: string, maxBytes: number, requestSignal?: AbortSignal): Promise<Uint8Array> => {
    const signal = requestSignal ?? options.signal;
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
    if (record.compression !== 'deflate') throw new Error(`EPUB member compression is unsupported: ${path}.`);
    if (record.compressedBytes === 0) throw new Error(`EPUB DEFLATE member has no compressed data: ${path}.`);
    const outputLimit = Math.min(maxBytes, limits.maxMemberBytes, record.uncompressedBytes);
    const result = new Uint8Array(outputLimit);
    return await new Promise<Uint8Array>((resolve, reject) => {
      let settled = false;
      let ready = false;
      let lastChunkAcknowledged = false;
      let finalSeen = false;
      let sequence = 0;
      let awaitingSequence: number | undefined;
      let inputOffset = 0;
      let outputOffset = 0;
      let crc = 0xffffffff;
      let worker: EpubInflateWorkerLike | undefined;
      const cleanup = () => {
        if (initTimer) clearTimeout(initTimer);
        if (readTimer) clearTimeout(readTimer);
        signal?.removeEventListener('abort', onAbort);
        if (worker) {
          const activeWorker = worker;
          worker.onmessage = null;
          worker.onerror = null;
          worker.onmessageerror = null;
          worker = undefined;
          try { activeWorker.terminate(); } catch { /* settlement must not depend on host cleanup */ }
        }
      };
      const settle = (error?: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error);
        else resolve(result);
      };
      const onAbort = () => settle(abortError());
      const fail = (message: string) => settle(new Error(message));
      const verifyAndSettle = () => {
        if (!finalSeen || !lastChunkAcknowledged || settled) return;
        if (outputOffset !== record.uncompressedBytes) { fail(`EPUB DEFLATE output size disagrees with central directory: ${path}.`); return; }
        if (((crc ^ 0xffffffff) >>> 0) !== record.crc32) { fail(`EPUB ZIP member CRC check failed: ${path}.`); return; }
        settle();
      };
      const sendNext = () => {
        if (!worker || !ready || awaitingSequence !== undefined || settled) return;
        if (inputOffset >= record.dataEnd - record.dataOffset) return;
        const length = Math.min(DEFLATE_INPUT_CHUNK_BYTES, record.compressedBytes - inputOffset);
        const chunk = bytes.slice(record.dataOffset + inputOffset, record.dataOffset + inputOffset + length);
        const isFinal = inputOffset + length === record.compressedBytes;
        const nextSequence = ++sequence;
        awaitingSequence = nextSequence;
        inputOffset += length;
        try { worker.postMessage({ type: 'chunk', sequence: nextSequence, bytes: chunk.buffer, final: isFinal }, [chunk.buffer]); }
        catch (error) { fail(error instanceof Error ? `EPUB DEFLATE Worker input dispatch failed: ${error.message}` : 'EPUB DEFLATE Worker input dispatch failed.'); }
      };
      const initTimer = setTimeout(() => fail('EPUB DEFLATE Worker readiness timed out.'), limits.workerInitTimeoutMs);
      const readTimer = setTimeout(() => fail('EPUB DEFLATE Worker read timed out.'), limits.workerReadTimeoutMs);
      try {
        worker = createInflateWorker(options);
      } catch (error) {
        fail(error instanceof Error ? `EPUB DEFLATE Worker could not start: ${error.message}` : 'EPUB DEFLATE Worker could not start.');
        return;
      }
      worker.onmessage = event => {
        if (settled || !event.data || typeof event.data.type !== 'string') return;
        const message = event.data as { type: string; message?: string; bytes?: ArrayBuffer; sequence?: number; outputBytes?: number };
        if (message.type === 'ready') {
          if (ready) { fail('EPUB DEFLATE Worker sent duplicate readiness.'); return; }
          ready = true;
          if (initTimer) clearTimeout(initTimer);
          try {
            worker?.postMessage({
              type: 'start', maxOutputBytes: outputLimit, compressedBytes: record.compressedBytes,
              maxCompressionRatio: limits.maxCompressionRatio, outputChunkBytes: limits.maxOutputChunkBytes,
              maxOutputBurstBytes: MAX_DEFLATE_OUTPUT_BURST_BYTES,
            });
          } catch (error) { fail(error instanceof Error ? `EPUB DEFLATE Worker initialization failed: ${error.message}` : 'EPUB DEFLATE Worker initialization failed.'); return; }
          sendNext();
          return;
        }
        if (message.type === 'error') { fail(`EPUB DEFLATE Worker failed: ${message.message ?? 'unknown worker error'}`); return; }
        if (message.type === 'data') {
          if (!ready || !(message.bytes instanceof ArrayBuffer)) { fail('EPUB DEFLATE Worker returned invalid output.'); return; }
          const chunk = new Uint8Array(message.bytes);
          if (outputOffset + chunk.byteLength > outputLimit || (outputOffset + chunk.byteLength) / record.compressedBytes > limits.maxCompressionRatio) {
            fail(`EPUB DEFLATE output exceeds its actual member or compression-ratio limit: ${path}.`); return;
          }
          result.set(chunk, outputOffset);
          crc = crcUpdate(crc, chunk);
          outputOffset += chunk.byteLength;
          return;
        }
        if (message.type === 'done') {
          if (message.outputBytes !== outputOffset || finalSeen) { fail('EPUB DEFLATE Worker returned an invalid final byte count.'); return; }
          finalSeen = true;
          verifyAndSettle();
          return;
        }
        if (message.type === 'ack') {
          if (message.sequence !== awaitingSequence || awaitingSequence === undefined) { fail('EPUB DEFLATE Worker returned an unexpected input acknowledgement.'); return; }
          awaitingSequence = undefined;
          if (inputOffset === record.compressedBytes) lastChunkAcknowledged = true;
          else sendNext();
          verifyAndSettle();
          return;
        }
        fail(`EPUB DEFLATE Worker sent an unsupported message: ${message.type}.`);
      };
      worker.onerror = event => { event.preventDefault(); fail(`EPUB DEFLATE Worker error: ${event.message || 'unknown worker error'}`); };
      worker.onmessageerror = () => fail('EPUB DEFLATE Worker message could not be decoded.');
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
  };
  let pendingReads = 0;

  return {
    archiveBytes: bytes.byteLength,
    entries: () => entries,
    readEntry(path, maxBytes, signal) {
      if (pendingReads >= limits.maxQueuedReads) return Promise.reject(new Error('EPUB ZIP reader queue is full.'));
      pendingReads += 1;
      const queued = readQueue.then(() => readEntryNow(path, maxBytes, signal), () => readEntryNow(path, maxBytes, signal));
      const tracked = queued.finally(() => { pendingReads -= 1; });
      readQueue = tracked.then(() => undefined, () => undefined);
      return tracked;
    },
  };
}
