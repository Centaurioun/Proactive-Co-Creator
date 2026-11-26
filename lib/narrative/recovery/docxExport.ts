import { strToU8, zipSync } from 'fflate';
import type { ManuscriptSection } from '../../../shared/narrativeTypes.ts';

function stripInvalidXmlChars(value: string): string {
  let clean = '';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < value.length ? value.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        clean += value[i] + value[i + 1];
        i += 1;
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) continue;
    const allowedControl = code === 0x09 || code === 0x0a || code === 0x0d;
    const validBmp = (code >= 0x20 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd);
    if (allowedControl || validBmp) clean += value[i];
  }
  return clean;
}

function escapeXml(value: string): string {
  return stripInvalidXmlChars(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function paragraphXml(text: string, style?: 'Title' | 'Heading1' | 'Heading2'): string {
  const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '';
  const runs = text.split('\n').map((line, idx) =>
    `${idx > 0 ? '<w:br/>' : ''}<w:t xml:space="preserve">${escapeXml(line)}</w:t>`
  ).join('');
  return `<w:p>${pPr}<w:r>${runs}</w:r></w:p>`;
}

/**
 * Generates a deterministic, filesystem-safe export filename containing
 * project slug, short project ID, content kind, revision, and UTC timestamp.
 */
export function buildDeterministicExportFilename(params: {
  projectName: string;
  projectId: string;
  kind: string;
  revision: number;
  ext: string;
  timestamp?: Date;
}): string {
  const slug = params.projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'project';
  const shortId = params.projectId.replace(/[^a-z0-9]/gi, '').slice(-8) || 'id';
  const kind = params.kind.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  const utc = (params.timestamp ?? new Date()).toISOString().replace(/[-:.]/g, '').replace('T', '-').slice(0, 15) + 'Z';
  return `${slug}-${shortId}-${kind}-r${params.revision}-${utc}.${params.ext}`;
}

/**
 * Builds a minimal, valid OOXML (.docx) package from manuscript sections using fflate.
 * Uses plain paragraphs and standard Word heading styles with full XML escaping.
 */
export function buildManuscriptDocxBytes(
  projectTitle: string,
  sections: readonly ManuscriptSection[]
): Uint8Array {
  const bodyParts: string[] = [paragraphXml(projectTitle || 'Manuscript', 'Title')];

  for (const section of sections) {
    const style = section.kind === 'chapter' ? 'Heading1' : 'Heading2';
    bodyParts.push(paragraphXml(section.title || (section.kind === 'chapter' ? 'Chapter' : 'Scene'), style));
    const blocks = section.text.split(/\n{2,}/);
    for (const block of blocks) {
      if (!block.trim()) continue;
      bodyParts.push(paragraphXml(block));
    }
  }

  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body>${bodyParts.join('')}<w:sectPr/></w:body></w:document>`;

  const contentTypesXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '</Types>';

  const rootRelsXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>';

  const docRelsXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '</Relationships>';

  const stylesXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>' +
    '</w:styles>';

  return zipSync(
    {
      '[Content_Types].xml': strToU8(contentTypesXml),
      '_rels/.rels': strToU8(rootRelsXml),
      'word/_rels/document.xml.rels': strToU8(docRelsXml),
      'word/styles.xml': strToU8(stylesXml),
      'word/document.xml': strToU8(documentXml),
    },
    { level: 6 }
  );
}

export function buildManuscriptPlainText(
  projectTitle: string,
  sections: readonly ManuscriptSection[]
): string {
  const lines: string[] = [projectTitle || 'Manuscript', '='.repeat(Math.max(10, (projectTitle || 'Manuscript').length)), ''];
  for (const section of sections) {
    lines.push(section.title || (section.kind === 'chapter' ? 'Chapter' : 'Scene'));
    lines.push('-'.repeat(Math.max(4, (section.title || 'Section').length)));
    if (section.text.trim()) lines.push(section.text.trim());
    lines.push('');
  }
  return lines.join('\n');
}
