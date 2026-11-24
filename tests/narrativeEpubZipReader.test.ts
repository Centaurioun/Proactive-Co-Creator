import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { strToU8, zipSync, type Zippable } from 'fflate';
import { createEpubZipReader, withEpubWorkerErrorBridge } from '../lib/narrative/import/epubZipReader.ts';

function archive(files: Zippable, level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 = 0): Uint8Array {
  return zipSync(files, { level });
}

test('browser Worker initialization errors are forwarded to fflate and the listener is removed', () => {
  const listeners = new Map<string, (event: Event) => void>();
  let delivered: unknown;
  const worker = {
    onmessage: (event: MessageEvent) => { delivered = event.data; },
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => listeners.set(type, listener as (event: Event) => void),
    removeEventListener: (type: string) => { listeners.delete(type); },
  } as unknown as Worker;
  const cleanup = withEpubWorkerErrorBridge(worker);
  const preventDefault = () => { /* marks this expected worker failure as handled */ };
  listeners.get('error')?.({ message: 'P5 synthetic worker initialization failure', error: new Error('worker boot failed'), preventDefault } as unknown as Event);
  assert.equal((delivered as { $e$: unknown[] }).$e$[0], 'P5 synthetic worker initialization failure');
  assert.equal((delivered as { $e$: unknown[] }).$e$[1], 'Error');
  assert.match(String((delivered as { $e$: unknown[] }).$e$[2]), /worker boot failed/);
  cleanup();
  assert.equal(listeners.has('error'), false);
});

function centralOffset(bytes: Uint8Array, filename: string): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const name = strToU8(filename);
  for (let offset = 0; offset <= bytes.length - 46; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    const length = view.getUint16(offset + 28, true);
    if (length === name.length && name.every((value, index) => value === bytes[offset + 46 + index])) return offset;
  }
  throw new Error(`central member missing: ${filename}`);
}

function localOffset(bytes: Uint8Array, filename: string): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const name = strToU8(filename);
  for (let offset = 0; offset <= bytes.length - 30; offset += 1) {
    if (view.getUint32(offset, true) !== 0x04034b50) continue;
    const length = view.getUint16(offset + 26, true);
    if (length === name.length && name.every((value, index) => value === bytes[offset + 30 + index])) return offset;
  }
  throw new Error(`local member missing: ${filename}`);
}

function reverseCentralDirectory(bytes: Uint8Array, firstName: string, secondName: string): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const first = centralOffset(bytes, firstName);
  const second = centralOffset(bytes, secondName);
  const recordEnd = (start: number) => start + 46 + view.getUint16(start + 28, true) + view.getUint16(start + 30, true) + view.getUint16(start + 32, true);
  const centralStart = Math.min(first, second);
  const centralEnd = bytes.length - 22 - view.getUint16(bytes.length - 2, true);
  const firstRecord = bytes.slice(first, recordEnd(first));
  const secondRecord = bytes.slice(second, recordEnd(second));
  const startRecord = first < second ? firstRecord : secondRecord;
  const endRecord = first < second ? secondRecord : firstRecord;
  const result = new Uint8Array(bytes.length);
  result.set(bytes.subarray(0, centralStart));
  result.set(endRecord, centralStart);
  result.set(startRecord, centralStart + endRecord.length);
  result.set(bytes.subarray(centralEnd), centralStart + endRecord.length + startRecord.length);
  return result;
}

test('ZIP reader reports physical local-header order and reads bounded stored members', async () => {
  const bytes = archive({ mimetype: strToU8('application/epub+zip'), 'OEBPS/a.xhtml': strToU8('<p>safe</p>') });
  const reader = createEpubZipReader(bytes);
  assert.deepEqual(reader.entries().map(entry => entry.path), ['mimetype', 'OEBPS/a.xhtml']);
  assert.equal(new TextDecoder().decode(await reader.readEntry('mimetype', 100)), 'application/epub+zip');
  assert.equal(new TextDecoder().decode(await reader.readEntry('OEBPS/a.xhtml', 100)), '<p>safe</p>');
});

test('ZIP reader rejects mimetype that is not the first physical local header', () => {
  const bytes = archive({ 'OEBPS/a.xhtml': strToU8('x'), mimetype: strToU8('application/epub+zip') });
  assert.throws(() => createEpubZipReader(bytes), /mimetype.*first/i);
});

test('ZIP reader reports local-header order even when central-directory order differs', () => {
  const bytes = archive({ mimetype: strToU8('application/epub+zip'), a: strToU8('x') });
  const reversed = reverseCentralDirectory(bytes, 'mimetype', 'a');
  const reader = createEpubZipReader(reversed);
  assert.deepEqual(reader.entries().map(entry => entry.path), ['mimetype', 'a']);
});

test('ZIP reader requires mimetype stored with no local extra field', () => {
  const bytes = archive({ mimetype: strToU8('application/epub+zip') });
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint16(28, 1, true);
  assert.throws(() => createEpubZipReader(bytes), /mimetype.*extra field/i);
});

test('ZIP reader rejects compressed mimetype members', () => {
  const bytes = archive({ mimetype: [strToU8('application/epub+zip'), { level: 6 }] });
  assert.throws(() => createEpubZipReader(bytes), /mimetype.*stored/i);
});

test('ZIP reader rejects central/local header disagreement', () => {
  const bytes = archive({ mimetype: strToU8('application/epub+zip') });
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(14, 1, true);
  assert.throws(() => createEpubZipReader(bytes), /local.*central|central.*local/i);
});

test('ZIP reader rejects data-descriptor layouts whose local integrity metadata is deferred', () => {
  const bytes = archive({ mimetype: strToU8('application/epub+zip') });
  const central = centralOffset(bytes, 'mimetype');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint16(6, view.getUint16(6, true) | 0x0008, true);
  view.setUint16(central + 8, view.getUint16(central + 8, true) | 0x0008, true);
  assert.throws(() => createEpubZipReader(bytes), /descriptor/i);
});

test('ZIP reader rejects traversal names before exposing entries', () => {
  const bytes = archive({ mimetype: strToU8('application/epub+zip'), 'safe1': strToU8('x') });
  const local = localOffset(bytes, 'safe1');
  const central = centralOffset(bytes, 'safe1');
  strToU8('../ab').forEach((value, index) => { bytes[local + 30 + index] = value; bytes[central + 46 + index] = value; });
  assert.throws(() => createEpubZipReader(bytes), /unsafe|path|traversal/i);
});

test('ZIP reader rejects absolute, backslash, drive, and dot-segment names', () => {
  for (const unsafe of ['../ab', '/abcd', 'a\\bc', 'C:/ab', 'a/../b']) {
    assert.throws(() => createEpubZipReader(archive({ mimetype: strToU8('application/epub+zip'), [unsafe]: strToU8('x') })), /unsafe.*path/i, unsafe);
  }
});

test('ZIP reader rejects duplicate normalized member paths', () => {
  const bytes = archive({ mimetype: strToU8('application/epub+zip'), first: strToU8('one'), other: strToU8('two') });
  const firstLocal = localOffset(bytes, 'first');
  const otherLocal = localOffset(bytes, 'other');
  const firstCentral = centralOffset(bytes, 'first');
  const otherCentral = centralOffset(bytes, 'other');
  for (let index = 0; index < 5; index += 1) {
    bytes[otherLocal + 30 + index] = bytes[firstLocal + 30 + index];
    bytes[otherCentral + 46 + index] = bytes[firstCentral + 46 + index];
  }
  assert.throws(() => createEpubZipReader(bytes), /duplicate member path/i);
});

test('ZIP reader rejects corrupt member CRC before returning bytes', async () => {
  const bytes = archive({ mimetype: strToU8('application/epub+zip'), 'OEBPS/a.xhtml': strToU8('narrative') });
  const local = localOffset(bytes, 'OEBPS/a.xhtml');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nameLength = view.getUint16(local + 26, true);
  const extraLength = view.getUint16(local + 28, true);
  bytes[local + 30 + nameLength + extraLength] ^= 1;
  const reader = createEpubZipReader(bytes);
  await assert.rejects(() => reader.readEntry('OEBPS/a.xhtml', 100), /CRC/i);
});

test('ZIP reader applies entry, archive, ratio, and actual output bounds', async () => {
  const plain = archive({ mimetype: strToU8('application/epub+zip'), a: strToU8('123456789') });
  assert.throws(() => createEpubZipReader(plain, { limits: { maxEntries: 1 } }), /entry.*limit/i);
  assert.throws(() => createEpubZipReader(plain, { limits: { maxArchiveBytes: 4 } }), /archive.*limit/i);
  const compressed = archive({ mimetype: [strToU8('application/epub+zip'), { level: 0 }], a: [strToU8('A'.repeat(20_000)), { level: 6 }] });
  assert.throws(() => createEpubZipReader(compressed, { limits: { maxCompressionRatio: 2 } }), /ratio/i);
  const reader = createEpubZipReader(plain);
  await assert.rejects(() => reader.readEntry('a', 4), /member.*limit/i);
  assert.throws(() => createEpubZipReader(plain, { limits: { maxExpandedBytes: 10 } }), /expanded-size limit/i);
});

test('ZIP reader enforces actual decompressed output when both headers understate size', async () => {
  const payload = randomBytes(400_000);
  const bytes = archive({ mimetype: [strToU8('application/epub+zip'), { level: 0 }], a: [payload, { level: 6 }] });
  const central = centralOffset(bytes, 'a');
  const local = localOffset(bytes, 'a');
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(central + 24, 8, true);
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(local + 22, 8, true);
  const reader = createEpubZipReader(bytes);
  await assert.rejects(() => reader.readEntry('a', 8), /actual member|output size/i);
});

test('ZIP reader honors cancellation before a member read and during asynchronous inflate', async () => {
  const data = randomBytes(400_000);
  const bytes = archive({ mimetype: [strToU8('application/epub+zip'), { level: 0 }], 'OEBPS/large.xhtml': [data, { level: 6 }] });
  const controller = new AbortController();
  const reader = createEpubZipReader(bytes, { signal: controller.signal });
  const pending = reader.readEntry('OEBPS/large.xhtml', data.length);
  setTimeout(() => controller.abort(), 0);
  await assert.rejects(() => pending, /abort|cancel/i);
});

test('ZIP reader rejects a member read when its signal is already aborted', async () => {
  const bytes = archive({ mimetype: strToU8('application/epub+zip'), a: strToU8('data') });
  const controller = new AbortController();
  controller.abort();
  const reader = createEpubZipReader(bytes, { signal: controller.signal });
  await assert.rejects(() => reader.readEntry('a', 100), /abort|cancel/i);
});

test('ZIP reader honors cancellation between bounded chunks of a stored member', async () => {
  const bytes = archive({ mimetype: strToU8('application/epub+zip'), large: strToU8('s'.repeat(300_000)) });
  const controller = new AbortController();
  const reader = createEpubZipReader(bytes, { signal: controller.signal, limits: { maxOutputChunkBytes: 1024 } });
  const pending = reader.readEntry('large', 300_000);
  setTimeout(() => controller.abort(), 0);
  await assert.rejects(() => pending, /abort|cancel/i);
});

test('ZIP reader prevents concurrent reads from multiplying bounded extraction memory', async () => {
  const bytes = archive({ mimetype: strToU8('application/epub+zip'), large: strToU8('s'.repeat(200_000)), second: strToU8('second') });
  const reader = createEpubZipReader(bytes);
  const first = reader.readEntry('large', 200_000);
  await assert.rejects(() => reader.readEntry('second', 100), /another .*member read is active/i);
  assert.equal((await first).byteLength, 200_000);
});
