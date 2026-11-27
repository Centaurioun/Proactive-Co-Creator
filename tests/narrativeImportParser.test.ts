import assert from 'node:assert/strict';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { MAX_SOURCE_BYTES, parseNarrativeSource, countNarrativeWords } from '../lib/narrative/import/sourceParser.ts';

function buildDuplicateEntryDocx(xml: string): Uint8Array {
  // Build a valid 2-entry ZIP and rename the second entry (same 17-byte length) to duplicate word/document.xml
  const bytes = zipSync({ 'word/document.xml': strToU8(xml), 'word/documen2.xml': strToU8(xml) });
  const target = strToU8('word/documen2.xml');
  const replacement = strToU8('word/document.xml');
  for (let i = 0; i <= bytes.length - target.length; i += 1) {
    if (target.every((b, idx) => bytes[i + idx] === b)) {
      bytes.set(replacement, i);
    }
  }
  return bytes;
}

function setZipDataDescriptorFlags(bytes: Uint8Array): Uint8Array {
  const copy = bytes.slice();
  const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
  for (let i = 0; i <= copy.length - 30; i += 1) {
    if (view.getUint32(i, true) === 0x04034b50) {
      view.setUint16(i + 6, view.getUint16(i + 6, true) | 0x0008, true);
    }
    if (i <= copy.length - 46 && view.getUint32(i, true) === 0x02014b50) {
      view.setUint16(i + 8, view.getUint16(i + 8, true) | 0x0008, true);
    }
  }
  return copy;
}

test('pasted, TXT, and Markdown sources preserve Unicode and only report real structure', async () => {
  const text = 'Başlık\r\n\r\nİpek 🦉\né';
  const pasted = await parseNarrativeSource(text);
  assert.equal(pasted.text, text);
  assert.equal(pasted.retention, 'extracted-only');
  // W3-NEW-01: 'Başlık\r\n\r\nİpek 🦉\né' has 3 non-empty lines; previously raw.slice(0, -0) silently dropped final line 'é'.
  assert.equal(pasted.blocks.length, 3);
  assert.equal(pasted.text.slice(pasted.blocks[2].start, pasted.blocks[2].end), 'é');
  const md = await parseNarrativeSource(new TextEncoder().encode('# Gerçek Başlık\n\nİçerik'), 'öykü.md');
  assert.equal(md.blocks[0].kind, 'heading');
  assert.equal(md.blocks[0].label, 'Gerçek Başlık');
  assert.equal(md.mediaType, 'text/markdown');
  assert.equal(countNarrativeWords('İki farklı sözcük 🦉'), 3);
  const utf16 = new Uint8Array([0xff, 0xfe, 0x41, 0x00]);
  const decoded = await parseNarrativeSource(utf16, 'utf16.txt');
  assert.equal(decoded.text, 'A');
});

test('file source hashes and retains original bytes only under the configured ceiling', async () => {
  const bytes = new TextEncoder().encode('Gökçe ve İpek.');
  const source = await parseNarrativeSource(bytes, 'story.txt');
  assert.equal(source.retention, 'original-and-extracted');
  assert.equal(atob(source.originalBytesBase64!).length, bytes.byteLength);
  assert.match(source.digest, /^[a-f0-9]{64}$/);
  const large = new Uint8Array(2 * 1024 * 1024 + 1);
  large.set(new TextEncoder().encode('Narrative '));
  const extractedOnly = await parseNarrativeSource(large, 'large.txt', false);
  assert.equal(extractedOnly.retention, 'extracted-only');
  assert.equal(extractedOnly.originalBytesBase64, undefined);
  assert.ok(extractedOnly.warnings.some(warning => warning.includes('Only extracted text')));
});

test('rejects empty, invalid-encoding, unsupported, and oversized sources', async () => {
  await assert.rejects(() => parseNarrativeSource('  '), /No readable/);
  await assert.rejects(() => parseNarrativeSource(new Uint8Array([0xff, 0xfe, 0x00]), 'bad.txt'), /encoding/i);
  await assert.rejects(() => parseNarrativeSource(new Uint8Array([1, 2]), 'script.pdf'), /Supported sources/);
  await assert.rejects(() => parseNarrativeSource(new Uint8Array(MAX_SOURCE_BYTES + 1), 'large.txt'), /12 MiB/);
});

test('DOCX extracts real heading styles and paragraphs without executing package content', async () => {
  const xml = '<?xml version="1.0"?><w:document xmlns:w="urn:w"><w:body>' +
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Chapter One</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Şule &amp; Ömer</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>🦉</w:t></w:r></w:p>' +
    '</w:body></w:document>';
  const docx = zipSync({ 'word/document.xml': strToU8(xml), 'word/_rels/document.xml.rels': strToU8('<Relationships/>') });
  const source = await parseNarrativeSource(docx, 'novel.docx');
  assert.equal(source.text, 'Chapter One\nŞule & Ömer\t🦉');
  assert.equal(source.blocks[0].kind, 'heading');
  assert.equal(source.blocks[0].label, 'Chapter One');
  assert.equal(source.blocks[1].start, 12);
  assert.ok(source.warnings.some(warning => warning.includes('external relationships')));
  await assert.rejects(() => parseNarrativeSource(new Uint8Array([0x50, 0x4b]), 'broken.docx'), /ZIP|archive/);
});

test('DOCX parser rejects unsafe archive paths before decompression', async () => {
  const xml = '<w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>Safe text</w:t></w:r></w:p></w:body></w:document>';
  const docx = zipSync({ 'word/document.xml': strToU8(xml), '../word/evil.xml': strToU8('ignored') });
  await assert.rejects(() => parseNarrativeSource(docx, 'unsafe.docx'), /unsafe archive path/i);
});

test('DOCX parser rejects ZIP data trailing after an EOCD without a matching comment length', async () => {
  const xml = '<w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>Safe text</w:t></w:r></w:p></w:body></w:document>';
  const docx = zipSync({ 'word/document.xml': strToU8(xml) });
  const withTrailingJunk = new Uint8Array(docx.length + 4);
  withTrailingJunk.set(docx);
  withTrailingJunk.set([0xde, 0xad, 0xbe, 0xef], docx.length);
  await assert.rejects(() => parseNarrativeSource(withTrailingJunk, 'trailing.docx'), /ZIP|archive|directory/i);
});

test('DOCX parser rejects declared expansion bombs and DTD/entity XML', async () => {
  const safeXml = '<w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>Safe text</w:t></w:r></w:p></w:body></w:document>';
  const docx = zipSync({ 'word/document.xml': strToU8(safeXml) });
  const view = new DataView(docx.buffer, docx.byteOffset, docx.byteLength);
  let central = -1;
  for (let offset = 0; offset <= docx.length - 46; offset += 1) {
    if (view.getUint32(offset, true) === 0x02014b50) { central = offset; break; }
  }
  assert.notEqual(central, -1);
  view.setUint32(central + 24, 12 * 1024 * 1024 + 1, true);
  await assert.rejects(() => parseNarrativeSource(docx, 'zip-bomb.docx'), /oversized|compressed|expanded/i);

  const dtdXml = '<!DOCTYPE w:document [<!ENTITY payload SYSTEM "file:///secret">]><w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>&payload;</w:t></w:r></w:p></w:body></w:document>';
  const dtdDocx = zipSync({ 'word/document.xml': strToU8(dtdXml) });
  await assert.rejects(() => parseNarrativeSource(dtdDocx, 'dtd.docx'), /DTD|entity/i);
});

test('long narrative text is preserved beyond the former 8,000 character AI guard', async () => {
  const long = 'A'.repeat(9_000) + ' — son.';
  const source = await parseNarrativeSource(long);
  assert.equal(source.text, long);
  assert.equal(source.text.length, 9_007);
});

test('source parsing bounds pathological paragraph counts and rejects non-roundtripping pasted UTF-16', async () => {
  await assert.rejects(() => parseNarrativeSource(`${'x\n'.repeat(100_001)}`, 'many-lines.txt'), /paragraph|block|structure/i);
  await assert.rejects(() => parseNarrativeSource(`Broken ${String.fromCharCode(0xd800)} source`), /unicode|encoding/i);
});

test('segmentation never begins a chunk on a low surrogate and validates integer limits', async () => {
  const { segmentNarrativeSource } = await import('../lib/narrative/import/segmentation.ts');
  const text = `${'a'.repeat(98)}🦉abc`;
  const result = segmentNarrativeSource(text, [], 100, 1, 4);
  for (const chunk of result.chunks) {
    const code = chunk.text.charCodeAt(0);
    assert.equal(code >= 0xdc00 && code <= 0xdfff, false, 'chunk starts on low surrogate');
    assert.equal(text.slice(chunk.start, chunk.end), chunk.text);
  }
  assert.throws(() => segmentNarrativeSource('a'.repeat(200), [], 100, 0.5, 2), /limits/i);
  assert.throws(() => segmentNarrativeSource('a'.repeat(200), [], 100, 1, 1.5), /limits/i);
});

test('W3-NEW-01: blockRecords preserves final line when input lacks a trailing newline', async () => {
  const single = await parseNarrativeSource('Ada opens the door.');
  assert.equal(single.blocks.length, 1);
  assert.equal(single.text.slice(single.blocks[0].start, single.blocks[0].end), 'Ada opens the door.');

  const twoLines = await parseNarrativeSource('# Title\nBody');
  assert.equal(twoLines.blocks.length, 2);
  assert.equal(twoLines.blocks[0].kind, 'heading');
  assert.equal(twoLines.text.slice(twoLines.blocks[1].start, twoLines.blocks[1].end), 'Body');
});

test('W3-NEW-05: parseNarrativeSource throws AbortError on mid-read EPUB cancellation', async () => {
  const epub = zipSync({
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8('<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    'OEBPS/book.opf': strToU8('<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>'),
    'OEBPS/c1.xhtml': strToU8('<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Ada waited.</p></body></html>'),
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => parseNarrativeSource(epub, 'book.epub', true, controller.signal),
    (err: unknown) => err instanceof Error && err.name === 'AbortError',
  );
});

test('W3-NEW-06: DOCX parser rejects duplicate document entries, data-descriptor flags, bad XML codepoints, and handles nested w:p and AbortSignal', async () => {
  const safeXml = '<w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>Safe</w:t></w:r></w:p></w:body></w:document>';
  await assert.rejects(() => parseNarrativeSource(buildDuplicateEntryDocx(safeXml), 'dup.docx'), /duplicate/i);

  const descriptorDocx = setZipDataDescriptorFlags(zipSync({ 'word/document.xml': strToU8(safeXml) }));
  await assert.rejects(() => parseNarrativeSource(descriptorDocx, 'desc.docx'), /descriptor|unsupported/i);

  const badCodePointXml = '<w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>&#x110000;</w:t></w:r></w:p></w:body></w:document>';
  const badCodePointDocx = zipSync({ 'word/document.xml': strToU8(badCodePointXml) });
  await assert.rejects(
    () => parseNarrativeSource(badCodePointDocx, 'badcp.docx'),
    (err: unknown) => err instanceof Error && err.name !== 'RangeError',
  );

  const nestedXml = '<w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>Outer start </w:t></w:r><w:pict><w:txbxContent><w:p><w:r><w:t>Inner</w:t></w:r></w:p></w:txbxContent></w:pict><w:r><w:t> outer end</w:t></w:r></w:p></w:body></w:document>';
  const nestedDocx = zipSync({ 'word/document.xml': strToU8(nestedXml) });
  const parsedNested = await parseNarrativeSource(nestedDocx, 'nested.docx');
  assert.ok(parsedNested.text.includes('outer end'), 'Outer paragraph text after nested w:p must not be truncated');

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => parseNarrativeSource(zipSync({ 'word/document.xml': strToU8(safeXml) }), 'aborted.docx', true, controller.signal),
    (err: unknown) => err instanceof Error && err.name === 'AbortError',
  );
});
