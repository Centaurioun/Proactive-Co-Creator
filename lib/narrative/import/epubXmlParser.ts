export type EpubFailureStatus =
  | 'unsupported'
  | 'no-text'
  | 'malformed'
  | 'limit-exceeded'
  | 'archive-read-failed'
  | 'cancelled';

export interface EpubXmlLimits {
  maxXmlNodes: number;
  maxXmlDepth: number;
}

export interface EpubXmlCoverage {
  totalSpineItems: number;
  extractedSpineItems: number;
  omittedSpineItems: number;
  unsupportedItems: string[];
  membersWithoutText: string[];
}

export class ParseFault extends Error {
  status: EpubFailureStatus;
  coverage?: EpubXmlCoverage;

  constructor(status: EpubFailureStatus, message: string, coverage?: EpubXmlCoverage) {
    super(message);
    this.name = 'ParseFault';
    this.status = status;
    this.coverage = coverage;
  }
}

export interface XmlTextNode {
  type: 'text';
  value: string;
}

export interface XmlElement {
  type: 'element';
  name: string;
  localName: string;
  namespaceUri: string;
  attributes: Map<string, string>;
  namespaceBindings: Map<string, string>;
  children: XmlNode[];
}

export type XmlNode = XmlTextNode | XmlElement;
export interface XmlNodeBudget {
  used: number;
}

const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const IGNORED_NAMES = new Set(['head', 'script', 'style', 'svg', 'template', 'noscript']);
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

export function failParse(status: EpubFailureStatus, message: string, coverage?: EpubXmlCoverage): never {
  throw new ParseFault(status, message, coverage);
}

export function hasForbiddenControlCharacter(value: string, allowXmlWhitespace: boolean): boolean {
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

function validXmlCodePoint(codePoint: number): boolean {
  if (codePoint === 0x9 || codePoint === 0xa || codePoint === 0xd) return true;
  if (codePoint >= 0x20 && codePoint <= 0xd7ff) return true;
  if (codePoint >= 0xe000 && codePoint <= 0xfffd) return true;
  return codePoint >= 0x10000 && codePoint <= 0x10ffff;
}

function decodeNumericEntity(entity: string): string {
  const hex = /^#x([\da-f]+)$/i.exec(entity);
  const decimal = /^#(\d+)$/.exec(entity);
  const codePoint = hex ? Number.parseInt(hex[1], 16) : decimal ? Number(decimal[1]) : NaN;
  if (!Number.isInteger(codePoint) || !validXmlCodePoint(codePoint)) {
    failParse('malformed', 'EPUB XML contains an invalid or unsupported entity reference.');
  }
  return String.fromCodePoint(codePoint);
}

export function decodeXmlEntities(value: string): string {
  let cursor = 0;
  let decoded = '';
  for (const match of value.matchAll(/&([^;]+);/g)) {
    const start = match.index!;
    const plain = value.slice(cursor, start);
    if (plain.includes('&')) failParse('malformed', 'EPUB XML contains an unterminated or unsupported entity reference.');
    decoded += plain;
    const entity = match[1];
    decoded += NAMED_ENTITIES[entity] ?? decodeNumericEntity(entity);
    cursor = start + match[0].length;
  }
  const tail = value.slice(cursor);
  if (tail.includes('&')) failParse('malformed', 'EPUB XML contains an unterminated or unsupported entity reference.');
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
  failParse('malformed', 'EPUB XML contains an incomplete tag.');
}

function skipWhitespace(content: string, position: number): number {
  let cursor = position;
  while (cursor < content.length && /\s/.test(content[cursor])) cursor += 1;
  return cursor;
}

function readQuotedValue(content: string, start: number): { value: string; nextPosition: number } {
  const quote = content[start];
  if (quote !== '"' && quote !== "'") failParse('malformed', 'EPUB XML attribute values must be quoted.');
  let position = start + 1;
  const valueStart = position;
  while (position < content.length && content[position] !== quote) {
    if (content[position] === '<') failParse('malformed', 'EPUB XML attribute contains an unescaped less-than sign.');
    position += 1;
  }
  if (position >= content.length) failParse('malformed', 'EPUB XML attribute value is incomplete.');
  return { value: decodeXmlEntities(content.slice(valueStart, position)), nextPosition: position + 1 };
}

function parseTagAttributes(content: string, initialPosition: number): Map<string, string> {
  const attributes = new Map<string, string>();
  let position = initialPosition;
  while (position < content.length) {
    position = skipWhitespace(content, position);
    if (position >= content.length) break;
    const attrMatch = /^([A-Za-z_][A-Za-z\d_.:-]*)/.exec(content.slice(position));
    if (!attrMatch) failParse('malformed', 'EPUB XML contains an invalid attribute name.');
    const attrName = attrMatch[1];
    if (attributes.has(attrName)) failParse('malformed', 'EPUB XML contains a duplicate attribute.');
    position = skipWhitespace(content, position + attrMatch[0].length);
    if (content[position] !== '=') failParse('malformed', 'EPUB XML attribute is missing a value.');
    position = skipWhitespace(content, position + 1);
    const quoted = readQuotedValue(content, position);
    attributes.set(attrName, quoted.value);
    position = quoted.nextPosition;
  }
  return attributes;
}

function resolveElementContext(
  name: string,
  attributes: Map<string, string>,
  parentBindings: Map<string, string> | undefined,
): { localName: string; namespaceUri: string; namespaceBindings: Map<string, string> } {
  const namespaceBindings = new Map(parentBindings ?? [['xml', XML_NS]]);
  for (const [attrName, value] of attributes) {
    if (attrName === 'xmlns') {
      namespaceBindings.set('', value);
    } else if (attrName.startsWith('xmlns:')) {
      const prefix = attrName.slice(6);
      if (!prefix || !value || (prefix === 'xml' && value !== XML_NS) || prefix === 'xmlns') {
        failParse('malformed', 'EPUB XML has an invalid namespace declaration.');
      }
      namespaceBindings.set(prefix, value);
    }
  }
  const nameParts = name.split(':');
  if (nameParts.length > 2 || nameParts.some(part => !part)) failParse('malformed', 'EPUB XML contains an invalid qualified name.');
  const prefix = nameParts.length === 2 ? nameParts[0] : '';
  const localName = nameParts[nameParts.length - 1];
  const namespaceUri = namespaceBindings.get(prefix);
  if (namespaceUri === undefined) failParse('malformed', 'EPUB XML uses an undeclared namespace prefix.');
  for (const attrName of attributes.keys()) {
    if (attrName === 'xmlns' || attrName.startsWith('xmlns:')) continue;
    const attrParts = attrName.split(':');
    if (attrParts.length > 2 || attrParts.some(part => !part)) {
      failParse('malformed', 'EPUB XML attribute uses an invalid or undeclared namespace prefix.');
    }
    if (attrParts.length === 2 && !namespaceBindings.has(attrParts[0])) {
      failParse('malformed', 'EPUB XML attribute uses an invalid or undeclared namespace prefix.');
    }
  }
  return { localName, namespaceUri, namespaceBindings };
}

function consumeSpecialMarkup(
  xml: string,
  cursor: number,
  state: { stack: XmlElement[]; root?: XmlElement; sawXmlDeclaration: boolean },
  addText: (value: string) => void,
): number | null {
  if (xml.startsWith('<!--', cursor)) {
    const end = xml.indexOf('-->', cursor + 4);
    if (end < 0 || xml.slice(cursor + 4, end).includes('--')) failParse('malformed', 'EPUB XML contains an invalid comment.');
    return end + 3;
  }
  if (xml.startsWith('<![CDATA[', cursor)) {
    if (!state.stack.length) failParse('malformed', 'EPUB XML has CDATA outside its root element.');
    const end = xml.indexOf(']]>', cursor + 9);
    if (end < 0) failParse('malformed', 'EPUB XML contains an incomplete CDATA section.');
    addText(xml.slice(cursor + 9, end));
    return end + 3;
  }
  if (xml.startsWith('<!', cursor)) failParse('unsupported', 'This EPUB XML declaration form is not supported.');
  if (xml.startsWith('<?', cursor)) {
    const end = xml.indexOf('?>', cursor + 2);
    if (end < 0) failParse('malformed', 'EPUB XML contains an incomplete processing instruction.');
    const declaration = xml.slice(cursor + 2, end).trim();
    if (!declaration.toLowerCase().startsWith('xml ')) failParse('unsupported', 'EPUB XML processing instructions are not supported.');
    if (state.root || state.stack.length || state.sawXmlDeclaration) failParse('malformed', 'EPUB XML declaration is misplaced or repeated.');
    state.sawXmlDeclaration = true;
    const encoding = /\bencoding\s*=\s*['"]([^'"]+)['"]/i.exec(declaration)?.[1];
    if (encoding && encoding.toLowerCase() !== 'utf-8') failParse('unsupported', 'This EPUB core accepts UTF-8 XML only.');
    return end + 2;
  }
  return null;
}

function consumeClosingTag(xml: string, cursor: number, stack: XmlElement[]): number {
  const end = xml.indexOf('>', cursor + 2);
  if (end < 0) failParse('malformed', 'EPUB XML contains an incomplete closing tag.');
  const name = xml.slice(cursor + 2, end).trim();
  if (!/^[A-Za-z_][A-Za-z\d_.:-]*$/.test(name) || !stack.length || stack[stack.length - 1].name !== name) {
    failParse('malformed', 'EPUB XML tags are not well-formed.');
  }
  stack.pop();
  return end + 1;
}

function consumeOpenTag(
  xml: string,
  cursor: number,
  state: { stack: XmlElement[]; root?: XmlElement },
  limits: EpubXmlLimits,
  budget: XmlNodeBudget,
): number {
  const end = readTagEnd(xml, cursor + 1);
  let content = xml.slice(cursor + 1, end).trim();
  const selfClosing = content.endsWith('/');
  if (selfClosing) content = content.slice(0, -1).trimEnd();
  const nameMatch = /^([A-Za-z_][A-Za-z\d_.:-]*)/.exec(content);
  if (!nameMatch) failParse('malformed', 'EPUB XML contains an invalid element name.');
  const name = nameMatch[1];
  const attributes = parseTagAttributes(content, nameMatch[0].length);
  const parentBindings = state.stack.length ? state.stack[state.stack.length - 1].namespaceBindings : undefined;
  const ctx = resolveElementContext(name, attributes, parentBindings);
  budget.used += 1;
  if (budget.used > limits.maxXmlNodes) failParse('limit-exceeded', 'EPUB archive exceeds the aggregate XML node limit.');
  const element: XmlElement = { type: 'element', name, ...ctx, attributes, children: [] };
  if (state.stack.length) state.stack[state.stack.length - 1].children.push(element);
  else if (!state.root) state.root = element;
  else failParse('malformed', 'EPUB XML contains more than one root element.');
  if (!selfClosing) {
    state.stack.push(element);
    if (state.stack.length > limits.maxXmlDepth) failParse('limit-exceeded', 'EPUB XML exceeds the configured nesting-depth limit.');
  }
  return end + 1;
}

export function parseXml(xml: string, limits: EpubXmlLimits, budget: XmlNodeBudget): XmlElement {
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) failParse('unsupported', 'EPUB XML declarations with DTD or entities are not supported.');
  if (hasForbiddenControlCharacter(xml, true)) failParse('malformed', 'EPUB XML contains invalid control characters.');
  let cursor = 0;
  const state: { stack: XmlElement[]; root?: XmlElement; sawXmlDeclaration: boolean } = { stack: [], sawXmlDeclaration: false };
  const addText = (value: string) => {
    if (!value) return;
    if (!state.stack.length) {
      if (value.trim()) failParse('malformed', 'EPUB XML has text outside its root element.');
      return;
    }
    budget.used += 1;
    if (budget.used > limits.maxXmlNodes) failParse('limit-exceeded', 'EPUB archive exceeds the aggregate XML node limit.');
    state.stack[state.stack.length - 1].children.push({ type: 'text', value });
  };
  while (cursor < xml.length) {
    if (xml[cursor] !== '<') {
      const end = xml.indexOf('<', cursor);
      const next = end < 0 ? xml.length : end;
      const raw = xml.slice(cursor, next);
      if (raw.includes(']]>')) failParse('malformed', 'EPUB XML contains an invalid CDATA terminator.');
      addText(decodeXmlEntities(raw));
      cursor = next;
      continue;
    }
    const specialNext = consumeSpecialMarkup(xml, cursor, state, addText);
    if (specialNext !== null) {
      cursor = specialNext;
      continue;
    }
    cursor = xml.startsWith('</', cursor)
      ? consumeClosingTag(xml, cursor, state.stack)
      : consumeOpenTag(xml, cursor, state, limits, budget);
  }
  if (state.stack.length || !state.root) failParse('malformed', 'EPUB XML is incomplete or has no root element.');
  return state.root;
}

export function childElements(element: XmlElement, localName: string, namespaceUri?: string): XmlElement[] {
  return element.children.filter((child): child is XmlElement =>
    child.type === 'element' && child.localName === localName && (namespaceUri === undefined || child.namespaceUri === namespaceUri));
}

export function findDescendant(element: XmlElement, localName: string, namespaceUri: string): XmlElement | undefined {
  for (const child of element.children) {
    if (child.type !== 'element') continue;
    if (child.localName === localName && child.namespaceUri === namespaceUri) return child;
    const nested = findDescendant(child, localName, namespaceUri);
    if (nested) return nested;
  }
  return undefined;
}

export function textContent(element: XmlElement): string {
  let result = '';
  for (const child of element.children) {
    if (child.type === 'text') result += child.value;
    else if (!IGNORED_NAMES.has(child.localName)) result += textContent(child);
  }
  return result;
}
