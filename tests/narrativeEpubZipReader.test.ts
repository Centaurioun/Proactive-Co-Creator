import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { strToU8, zipSync, type Zippable } from 'fflate';
import { createEpubZipReader, type EpubZipReaderOptions } from '../lib/narrative/import/epubZipReader.ts';
import { parseNarrativeSource } from '../lib/narrative/import/sourceParser.ts';

function archive(files: Zippable, level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 = 0): Uint8Array {
  return zipSync(files, { level });
}


interface FakeWorkerOptions { failFirst?: boolean; holdOutput?: boolean; noReady?: boolean; throwOnStart?: boolean; messageError?: boolean; lateAfterError?: boolean }

function fakeWorkerFactory(outputs: Uint8Array[], options: FakeWorkerOptions = {}) {
  let created = 0;
  const terminated: boolean[] = [];
  const factory: NonNullable<EpubZipReaderOptions['workerFactory']> = () => {
    const index = created++;
    const worker = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      onerror: null as ((event: ErrorEvent) => void) | null,
      onmessageerror: null as ((event: MessageEvent) => void) | null,
      terminate() { terminated[index] = true; },
      postMessage(message: { type: string; sequence?: number; final?: boolean }, _transfer?: Transferable[]) {
        if (message.type === 'start') { if (options.throwOnStart) throw new Error('synthetic postMessage failure'); return; }
        if (message.type !== 'chunk') return;
        queueMicrotask(() => {
          if (options.messageError && index === 0) { worker.onmessageerror?.({ data: null } as MessageEvent); return; }
          if (options.holdOutput) return;
          if (options.failFirst && index === 0) {
            const lateHandler = worker.onmessage;
            worker.onmessage?.({ data: { type: 'error', message: 'P5 synthetic worker initialization failure' } } as MessageEvent);
            if (options.lateAfterError) setTimeout(() => lateHandler?.({ data: { type: 'data', bytes: outputs[0].slice().buffer } } as MessageEvent), 0);
            return;
          }
          const output = outputs[Math.min(index, outputs.length - 1)];
          worker.onmessage?.({ data: { type: 'data', bytes: output.slice().buffer } } as MessageEvent);
          if (message.final) worker.onmessage?.({ data: { type: 'done', outputBytes: output.length } } as MessageEvent);
          worker.onmessage?.({ data: { type: 'ack', sequence: message.sequence } } as MessageEvent);
        });
      },
    };
    if (!options.noReady) queueMicrotask(() => worker.onmessage?.({ data: { type: 'ready' } } as MessageEvent));
    return worker as unknown as Worker;
  };
  return { factory, terminated, get created() { return created; } };
}

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

test('product source parser reads a valid stored EPUB and rejects an incomplete EPUB', async () => {
  const bytes = archive({
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8('<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    'OEBPS/book.opf': strToU8('<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>'),
    'OEBPS/chapter.xhtml': strToU8('<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Bölüm 1</h1><p>Leyla bekledi.</p></body></html>'),
  });
  const parsed = await parseNarrativeSource(bytes, 'book.epub');
  assert.equal(parsed.mediaType, 'application/epub+zip');
  assert.equal(parsed.text, 'Bölüm 1\nLeyla bekledi.');
  assert.deepEqual(parsed.blocks.map(block => parsed.text.slice(block.start, block.end)), ['Bölüm 1', 'Leyla bekledi.']);
  assert.equal(parsed.retention, 'original-and-extracted');
  const incomplete = archive({ mimetype: strToU8('application/epub+zip'), 'OEBPS/chapter.xhtml': strToU8('<p>incomplete</p>') });
  await assert.rejects(() => parseNarrativeSource(incomplete, 'book.epub'), {
    name: 'NarrativeSourceParseError',
    kind: 'malformed',
    message: /missing required member "META-INF\/container\.xml"/i,
  });
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
  for (const unsafe of ['../ab', '/abcd', 'a\\bc', 'C:/ab', 'a/../b', 'bad\u0001name']) {
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
  const workers = fakeWorkerFactory([payload]);
  const reader = createEpubZipReader(bytes, { workerFactory: workers.factory });
  await assert.rejects(() => reader.readEntry('a', 8), /actual member|output size/i);
});

test('ZIP reader honors cancellation before a member read and during asynchronous inflate', async () => {
  const data = randomBytes(400_000);
  const bytes = archive({ mimetype: [strToU8('application/epub+zip'), { level: 0 }], 'OEBPS/large.xhtml': [data, { level: 6 }] });
  const controller = new AbortController();
  const workers = fakeWorkerFactory([data], { holdOutput: true });
  const reader = createEpubZipReader(bytes, { signal: controller.signal, workerFactory: workers.factory });
  const pending = reader.readEntry('OEBPS/large.xhtml', data.length);
  setTimeout(() => controller.abort(), 0);
  await assert.rejects(() => pending, /abort|cancel/i);
  assert.deepEqual(workers.terminated, [true]);
});

test('ZIP reader handles small DEFLATE members through the injected isolated worker', async () => {
  const payload = strToU8('Small Turkish EPUB chapter: Kıyıdaki saat beşi vurdu.');
  const bytes = archive({ mimetype: strToU8('application/epub+zip'), 'OEBPS/small.xhtml': [payload, { level: 6 }] });
  const workers = fakeWorkerFactory([payload]);
  const reader = createEpubZipReader(bytes, { workerFactory: workers.factory });
  assert.deepEqual(await reader.readEntry('OEBPS/small.xhtml', payload.length), payload);
  assert.equal(workers.created, 1);
  assert.deepEqual(workers.terminated, [true]);
});

test('worker initialization failure rejects and releases the queue for the next member read', async () => {
  const payload = strToU8('A successful queued chapter after an initialization failure.');
  const bytes = archive({ mimetype: strToU8('application/epub+zip'), 'OEBPS/first.xhtml': [payload, { level: 6 }], 'OEBPS/second.xhtml': [payload, { level: 6 }] });
  const workers = fakeWorkerFactory([payload], { failFirst: true, lateAfterError: true });
  const reader = createEpubZipReader(bytes, { workerFactory: workers.factory });
  let firstSettlements = 0;
  const first = reader.readEntry('OEBPS/first.xhtml', payload.length).then(
    value => { firstSettlements += 1; return value; },
    error => { firstSettlements += 1; throw error; },
  );
  const second = reader.readEntry('OEBPS/second.xhtml', payload.length);
  await assert.rejects(first, /initialization failure/i);
  assert.deepEqual(await second, payload);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(firstSettlements, 1);
  assert.equal(workers.created, 2);
  assert.deepEqual(workers.terminated, [true, true]);
});

test('Worker readiness timeout and messageerror terminate and release the queue', async () => {
  const payload = strToU8('bounded queued test');
  const bytes = archive({ mimetype: strToU8('application/epub+zip'), first: [payload, { level: 6 }], second: [payload, { level: 6 }] });
  const timeoutWorkers = fakeWorkerFactory([payload], { noReady: true });
  const timeoutReader = createEpubZipReader(bytes, { workerFactory: timeoutWorkers.factory, limits: { workerInitTimeoutMs: 5 } });
  await assert.rejects(() => timeoutReader.readEntry('first', payload.length), /readiness timed out/i);
  assert.deepEqual(timeoutWorkers.terminated, [true]);

  const errorWorkers = fakeWorkerFactory([payload], { messageError: true });
  const errorReader = createEpubZipReader(bytes, { workerFactory: errorWorkers.factory });
  const first = errorReader.readEntry('first', payload.length);
  const second = errorReader.readEntry('second', payload.length);
  await assert.rejects(first, /message could not be decoded/i);
  assert.deepEqual(await second, payload);
  assert.deepEqual(errorWorkers.terminated, [true, true]);
});

test('Worker postMessage failure rejects and terminates the allocated Worker', async () => {
  const payload = strToU8('bounded dispatch failure test');
  const bytes = archive({ mimetype: strToU8('application/epub+zip'), a: [payload, { level: 6 }] });
  const workers = fakeWorkerFactory([payload], { throwOnStart: true });
  const reader = createEpubZipReader(bytes, { workerFactory: workers.factory });
  await assert.rejects(() => reader.readEntry('a', payload.length), /initialization failed/i);
  assert.deepEqual(workers.terminated, [true]);
});

test('Worker constructor failure rejects and releases the next queued read', async () => {
  const payload = strToU8('bounded constructor failure test');
  const bytes = archive({ mimetype: strToU8('application/epub+zip'), first: [payload, { level: 6 }], second: [payload, { level: 6 }] });
  let attempts = 0;
  const reader = createEpubZipReader(bytes, {
    workerFactory: () => {
      attempts += 1;
      if (attempts === 1) throw new Error('synthetic Worker constructor failure');
      return fakeWorkerFactory([payload]).factory();
    },
  });
  await assert.rejects(() => reader.readEntry('first', payload.length), /could not start/i);
  assert.deepEqual(await reader.readEntry('second', payload.length), payload);
  assert.equal(attempts, 2);
});

test('ZIP reader bounds the serialized read queue', async () => {
  const payload = strToU8('bounded queue');
  const bytes = archive({ mimetype: strToU8('application/epub+zip'), a: [payload, { level: 6 }] });
  const workers = fakeWorkerFactory([payload], { noReady: true });
  const reader = createEpubZipReader(bytes, { workerFactory: workers.factory, limits: { maxQueuedReads: 1, workerInitTimeoutMs: 100 } });
  const activeAbort = new AbortController();
  const active = reader.readEntry('a', payload.length, activeAbort.signal);
  await assert.rejects(() => reader.readEntry('a', payload.length), /queue is full/i);
  activeAbort.abort();
  await assert.rejects(active, /abort|cancel/i);
  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  await assert.rejects(() => reader.readEntry('a', payload.length, alreadyAborted.signal), /abort|cancel/i);
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

test('ZIP reader queues concurrent stored reads and preserves request order', async () => {
  const bytes = archive({ mimetype: strToU8('application/epub+zip'), large: strToU8('s'.repeat(200_000)), second: strToU8('second') });
  const reader = createEpubZipReader(bytes);
  const order: string[] = [];
  const first = reader.readEntry('large', 200_000).then(value => { order.push('large'); return value; });
  const second = reader.readEntry('second', 100).then(value => { order.push('second'); return value; });
  assert.equal((await first).byteLength, 200_000);
  assert.equal(new TextDecoder().decode(await second), 'second');
  assert.deepEqual(order, ['large', 'second']);
});
