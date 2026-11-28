/**
 * Unicode, Turkish-aware normalization, UTF-16 surrogate boundary helpers,
 * tokenization, and deterministic hashing for E1 Narrative Memory Index.
 */

const TURKISH_LOWER_MAP: Record<string, string> = {
  'İ': 'i',
  'I': 'ı',
  'Ğ': 'ğ',
  'Ü': 'ü',
  'Ş': 'ş',
  'Ö': 'ö',
  'Ç': 'ç',
};

const DIACRITIC_FOLD_MAP: Record<string, string> = {
  'ı': 'i',
  'ğ': 'g',
  'ü': 'u',
  'ş': 's',
  'ö': 'o',
  'ç': 'c',
  'â': 'a',
  'î': 'i',
  'û': 'u',
};

/**
 * Normalizes text to NFC and applies Turkish-aware lowercase folding
 * so dotted 'İ' -> 'i' and dotless 'I' -> 'ı' deterministically.
 */
export function normalizeUnicodeText(input: string): string {
  if (!input) return '';
  const nfc = input.normalize('NFC');
  let out = '';
  for (let i = 0; i < nfc.length; i += 1) {
    const ch = nfc[i];
    const mapped = TURKISH_LOWER_MAP[ch];
    out += mapped !== undefined ? mapped : ch.toLowerCase();
  }
  return out.normalize('NFC');
}

/**
 * Secondary diacritic-folded representation (e.g. 'ışık' -> 'isik', 'Çağrı' -> 'cagri')
 * so authors can search with or without Turkish diacritics while exact forms remain primary.
 */
export function foldDiacritics(input: string): string {
  const lowered = normalizeUnicodeText(input);
  if (!lowered) return '';
  let folded = '';
  for (let i = 0; i < lowered.length; i += 1) {
    const ch = lowered[i];
    folded += DIACRITIC_FOLD_MAP[ch] ?? ch;
  }
  return folded
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFC');
}

/**
 * Verifies that a UTF-16 code unit offset does NOT split a surrogate pair.
 */
export function isValidUtf16Boundary(text: string, offset: number): boolean {
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length) {
    return false;
  }
  if (offset === 0 || offset === text.length) {
    return true;
  }
  const prevCode = text.charCodeAt(offset - 1);
  const currCode = text.charCodeAt(offset);
  const isPrevHighSurrogate = prevCode >= 0xd800 && prevCode <= 0xdbff;
  const isCurrLowSurrogate = currCode >= 0xdc00 && currCode <= 0xdfff;
  return !(isPrevHighSurrogate && isCurrLowSurrogate);
}

/**
 * Snaps an arbitrary UTF-16 offset to the nearest safe code-point boundary.
 */
export function snapToValidUtf16Boundary(text: string, offset: number, direction: 'backward' | 'forward' = 'backward'): number {
  const clamped = Math.max(0, Math.min(text.length, Math.trunc(offset)));
  if (isValidUtf16Boundary(text, clamped)) {
    return clamped;
  }
  if (direction === 'backward') {
    return Math.max(0, clamped - 1);
  }
  return Math.min(text.length, clamped + 1);
}

/**
 * Deterministic 64-bit FNV-1a hex digest for fast synchronous chunk/snapshot fingerprinting.
 */
export function computeDeterministicDigest(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0xcbf29ce4;
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    h1 ^= code & 0xff;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= (code >> 8) ^ (code & 0xff);
    h2 = Math.imul(h2, 0x01000193);
  }
  const hex1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `${hex1}${hex2}_${input.length.toString(16)}`;
}

/**
 * Estimates token count conservatively (~3.8 characters per token for English/Turkish prose).
 */
export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return Math.max(1, Math.ceil(trimmed.length / 3.8));
}

const TOKEN_SPLIT_REGEX = /[^\p{L}\p{N}_'-]+/u;

/**
 * Extracts normalized lexical tokens from text, emitting both exact Turkish-lowered
 * tokens and folded ASCII variants (tagged or merged) for high-recall BM25 indexing.
 */
export function tokenizeForLexicalIndex(text: string): string[] {
  const normalized = normalizeUnicodeText(text);
  if (!normalized) return [];
  const rawTokens = normalized.split(TOKEN_SPLIT_REGEX);
  const result: string[] = [];
  for (const raw of rawTokens) {
    const cleaned = raw.replace(/^['-_]+|['-_]+$/g, '');
    if (cleaned.length < 2) continue;
    result.push(cleaned);
    const folded = foldDiacritics(cleaned);
    if (folded.length >= 2 && folded !== cleaned) {
      result.push(`f:${folded}`);
    }
  }
  return result;
}

/**
 * Extracts query terms for BM25 lookup, matching both exact normalized tokens
 * and diacritic-folded tokens when the query contains ASCII approximations.
 */
export function tokenizeSearchQuery(query: string): { exactTerms: string[]; foldedTerms: string[] } {
  const normalized = normalizeUnicodeText(query);
  if (!normalized) return { exactTerms: [], foldedTerms: [] };
  const rawTokens = normalized.split(TOKEN_SPLIT_REGEX);
  const exactTerms: string[] = [];
  const foldedTerms: string[] = [];
  const seenExact = new Set<string>();
  const seenFolded = new Set<string>();
  for (const raw of rawTokens) {
    const cleaned = raw.replace(/^['-_]+|['-_]+$/g, '');
    if (cleaned.length < 2) continue;
    if (!seenExact.has(cleaned)) {
      seenExact.add(cleaned);
      exactTerms.push(cleaned);
    }
    const folded = foldDiacritics(cleaned);
    if (folded.length >= 2) {
      const key = `f:${folded}`;
      if (!seenFolded.has(key)) {
        seenFolded.add(key);
        foldedTerms.push(key);
      }
    }
  }
  return { exactTerms, foldedTerms };
}
