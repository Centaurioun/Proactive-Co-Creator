import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_EPUB_PARSE_LIMITS, parseEpub, type BoundedArchiveReader, type BoundedArchiveEntry, type EpubParseLimits } from '../lib/narrative/import/epubParser.ts';

const container = `<?xml version="1.0" encoding="UTF-8"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;
const packageXml = `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">fixture</dc:identifier><dc:title>Kıyıdaki Saat</dc:title><dc:language>tr</dc:language></metadata><manifest><item id="c1" href="chapter-01.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="chapter-02.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`;
const chapterOne = `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" lang="tr"><head><title>Görünmemeli</title></head><body><h1>Chapter 1 — Sis / Fog</h1><p>Aylin stood by the quay.</p><p>“The bell rang at dawn,” she said.</p></body></html>`;
const chapterTwo = `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" lang="tr"><body><h1>Chapter 2 — Dönüş / Return</h1><p>Aylin remembered the bell after sunset.</p><p>The clock showed 19:10.</p></body></html>`;

function readerFor(files: Record<string, string>, physicalOrder = Object.keys(files)): BoundedArchiveReader & { calls: string[] } {
  const encoder = new TextEncoder();
  const content = new Map(Object.entries(files).map(([path, text]) => [path, encoder.encode(text)]));
  const calls: string[] = [];
  const entries: BoundedArchiveEntry[] = physicalOrder.map(path => {
    const bytes = content.get(path)!;
    return { path, compressedBytes: bytes.byteLength, uncompressedBytes: bytes.byteLength, compression: 'stored', encrypted: false };
  });
  return {
    archiveBytes: entries.reduce((total, entry) => total + entry.compressedBytes, 0),
    entries: () => entries,
    calls,
    async readEntry(path, maxBytes) {
      calls.push(path);
      const bytes = content.get(path);
      if (!bytes) throw new Error(`missing in-memory member: ${path}`);
      if (bytes.byteLength > maxBytes) throw new Error('reader limit exceeded');
      return bytes;
    },
  };
}

function validFiles(): Record<string, string> {
  return {
    'mimetype': 'application/epub+zip',
    'META-INF/container.xml': container,
    'OEBPS/package.opf': packageXml,
    'OEBPS/chapter-02.xhtml': chapterTwo,
    'OEBPS/chapter-01.xhtml': chapterOne,
  };
}

test('EPUB extraction follows OPF spine order and emits truthful chapter/member text anchors', async () => {
  const archive = readerFor(validFiles(), ['mimetype', 'OEBPS/chapter-02.xhtml', 'META-INF/container.xml', 'OEBPS/package.opf', 'OEBPS/chapter-01.xhtml']);
  const result = await parseEpub(archive);
  assert.equal(result.status, 'complete', JSON.stringify(result));
  assert.equal(result.text, 'Chapter 1 — Sis / Fog\nAylin stood by the quay.\n“The bell rang at dawn,” she said.\n\nChapter 2 — Dönüş / Return\nAylin remembered the bell after sunset.\nThe clock showed 19:10.');
  assert.ok(!result.text.includes('Görünmemeli'));
  assert.deepEqual(result.blocks.map(block => result.text.slice(block.start, block.end)), [
    'Chapter 1 — Sis / Fog', 'Aylin stood by the quay.', '“The bell rang at dawn,” she said.',
    'Chapter 2 — Dönüş / Return', 'Aylin remembered the bell after sunset.', 'The clock showed 19:10.',
  ]);
  assert.equal(result.chapters.length, 2);
  assert.equal(result.chapters[0].memberPath, 'OEBPS/chapter-01.xhtml');
  assert.equal(result.chapters[1].memberPath, 'OEBPS/chapter-02.xhtml');
  assert.equal(result.blocks[0].kind, 'heading');
  assert.equal(result.blocks[0].anchor.memberPath, 'OEBPS/chapter-01.xhtml');
  assert.equal(result.text.slice(result.blocks[0].start, result.blocks[0].end), result.blocks[0].label);
  assert.equal(result.coverage.extractedSpineItems, 2);
  assert.deepEqual(archive.calls.slice(-2), ['OEBPS/chapter-01.xhtml', 'OEBPS/chapter-02.xhtml']);
});

test('EPUB reports unsupported remote spine references without reading or fetching them', async () => {
  const files = validFiles();
  files['OEBPS/package.opf'] = packageXml.replace(
    '<item id="c1" href="chapter-01.xhtml" media-type="application/xhtml+xml"/>',
    '<item id="remote" href="https://example.invalid/chapter.xhtml" media-type="application/xhtml+xml"/><item id="c1" href="chapter-01.xhtml" media-type="application/xhtml+xml"/>',
  ).replace('<spine><itemref idref="c1"/>', '<spine><itemref idref="remote"/><itemref idref="c1"/>');
  const archive = readerFor(files);
  const result = await parseEpub(archive);
  assert.equal(result.status, 'partial');
  assert.ok(result.coverage.unsupportedItems.some(item => item.includes('https://example.invalid/')));
  assert.ok(!archive.calls.some(path => path.includes('example.invalid')));
  assert.ok(result.text.includes('Aylin stood by the quay.'));
});


test('EPUB requires its declared mimetype member', async () => {
  const files = validFiles();
  delete files.mimetype;
  const result = await parseEpub(readerFor(files));
  assert.equal(result.status, 'malformed');
  assert.match(result.reason ?? '', /mimetype/i);
});

test('EPUB requires mimetype to be first in the reader validated physical entry order', async () => {
  const archive = readerFor(validFiles(), ['META-INF/container.xml', 'mimetype', 'OEBPS/package.opf', 'OEBPS/chapter-01.xhtml', 'OEBPS/chapter-02.xhtml']);
  const result = await parseEpub(archive);
  assert.equal(result.status, 'malformed');
  assert.match(result.reason ?? '', /mimetype.*first/i);
  assert.deepEqual(archive.calls, []);
});

test('EPUB parser propagates cancellation through the injected bounded reader and stops before later members', async () => {
  const archive = readerFor(validFiles());
  const originalRead = archive.readEntry.bind(archive);
  const controller = new AbortController();
  archive.readEntry = async (path, maxBytes, signal) => {
    assert.equal(signal, controller.signal);
    const bytes = await originalRead(path, maxBytes, signal);
    if (path === 'META-INF/container.xml') controller.abort();
    return bytes;
  };
  const result = await parseEpub(archive, undefined, { signal: controller.signal });
  assert.equal(result.status, 'cancelled');
  assert.deepEqual(archive.calls, ['mimetype', 'META-INF/container.xml']);
});

test('EPUB applies one aggregate XML node budget across many individually small spine documents', async () => {
  const files: Record<string, string> = {
    'mimetype': 'application/epub+zip',
    'META-INF/container.xml': container,
  };
  const items: string[] = [];
  const refs: string[] = [];
  for (let index = 0; index < 8; index += 1) {
    const name = `chapter-${index}.xhtml`;
    items.push(`<item id="c${index}" href="${name}" media-type="application/xhtml+xml"/>`);
    refs.push(`<itemref idref="c${index}"/>`);
    files[`OEBPS/${name}`] = `<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Chapter ${index}</p></body></html>`;
  }
  files['OEBPS/package.opf'] = `<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><manifest>${items.join('')}</manifest><spine>${refs.join('')}</spine></package>`;
  const result = await parseEpub(readerFor(files), { ...DEFAULT_EPUB_PARSE_LIMITS, maxXmlNodes: 32 });
  assert.equal(result.status, 'limit-exceeded');
  assert.match(result.reason ?? '', /aggregate XML node limit/i);
  assert.equal(result.text, '');
  assert.deepEqual(result.blocks, []);
});

test('EPUB distinguishes no readable narrative text from a malformed XML document', async () => {
  const noText = readerFor({
    ...validFiles(),
    'OEBPS/chapter-01.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><body><img src="cover.png" alt=""/></body></html>',
    'OEBPS/chapter-02.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><body></body></html>',
  });
  assert.equal((await parseEpub(noText)).status, 'no-text');

  const malformed = readerFor({ ...validFiles(), 'OEBPS/chapter-01.xhtml': '<html><body><p>Missing close</body></html>' });
  const result = await parseEpub(malformed);
  assert.equal(result.status, 'malformed');
  assert.match(result.reason ?? '', /XML|well-formed/i);
});

test('EPUB rejects declared size limits before reading members and never truncates', async () => {
  const archive = readerFor(validFiles());
  const limits = { ...DEFAULT_EPUB_PARSE_LIMITS, maxArchiveBytes: 8 };
  const result = await parseEpub(archive, limits);
  assert.equal(result.status, 'limit-exceeded');
  assert.match(result.reason ?? '', /archive.*limit|limit.*archive/i);
  assert.deepEqual(archive.calls, []);
});


test('EPUB decodes standard XML entities in narrative text', async () => {
  const files = validFiles();
  files['OEBPS/chapter-01.xhtml'] = chapterOne.replace('Aylin stood by the quay.', 'Aylin &amp; Ekin stood by the quay.');
  const result = await parseEpub(readerFor(files));
  assert.equal(result.status, 'complete');
  assert.ok(result.text.includes('Aylin & Ekin stood by the quay.'));
});

test('EPUB marks unsupported spine media and keeps supported XHTML with partial coverage', async () => {
  const files = validFiles();
  files['OEBPS/package.opf'] = packageXml.replace('href="chapter-02.xhtml" media-type="application/xhtml+xml"', 'href="chapter-02.xhtml" media-type="application/pdf"');
  const result = await parseEpub(readerFor(files));
  assert.equal(result.status, 'partial');
  assert.equal(result.coverage.totalSpineItems, 2);
  assert.equal(result.coverage.extractedSpineItems, 1);
  assert.ok(result.coverage.unsupportedItems.some(item => item.includes('application/pdf')));
  assert.ok(result.text.includes('Chapter 1 — Sis / Fog'));
  assert.ok(!result.text.includes('Chapter 2 — Dönüş / Return'));
});

test('EPUB enforces extracted-text bounds without returning truncated content', async () => {
  const result = await parseEpub(readerFor(validFiles()), { ...DEFAULT_EPUB_PARSE_LIMITS, maxTextBytes: 40 });
  assert.equal(result.status, 'limit-exceeded');
  assert.match(result.reason ?? '', /text limit/i);
  assert.equal(result.text, '');
  assert.deepEqual(result.blocks, []);
});


test('EPUB rejects invalid runtime limit configuration instead of parsing unbounded', async () => {
  const result = await parseEpub(readerFor(validFiles()), {} as unknown as EpubParseLimits);
  assert.equal(result.status, 'malformed');
  assert.match(result.reason ?? '', /limit/i);
});

test('EPUB rejects entries exceeding the configured compression ratio', async () => {
  const archive = readerFor(validFiles());
  const baseEntries = archive.entries();
  archive.entries = () => baseEntries.map(entry => entry.path === 'OEBPS/chapter-02.xhtml'
    ? { ...entry, compressedBytes: 1, compression: 'deflate' }
    : entry);
  const result = await parseEpub(archive);
  assert.equal(result.status, 'limit-exceeded');
  assert.match(result.reason ?? '', /compression-ratio/i);
  assert.deepEqual(archive.calls, []);
});

test('EPUB reports an injected archive read failure with a typed result', async () => {
  const archive = readerFor(validFiles());
  archive.readEntry = async () => { throw new Error('synthetic read failure'); };
  const result = await parseEpub(archive);
  assert.equal(result.status, 'archive-read-failed');
  assert.match(result.reason ?? '', /read|archive/i);
});
