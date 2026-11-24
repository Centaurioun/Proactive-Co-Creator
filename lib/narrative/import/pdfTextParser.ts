import * as pdfjs from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export const MAX_PDF_PAGES = 200;
export const MAX_PDF_TEXT_BYTES = 8 * 1024 * 1024;
const MAX_PDF_INPUT_BYTES = 12 * 1024 * 1024;

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface PdfPageTextBlock {
  id: string;
  start: number;
  end: number;
  kind: 'paragraph';
  label: string;
  pageNumber: number;
}

export interface PdfTextExtraction {
  text: string;
  blocks: PdfPageTextBlock[];
  warnings: string[];
}

function abortError(): Error {
  const error = new Error('PDF extraction was cancelled.');
  error.name = 'AbortError';
  return error;
}

function pdfError(error: unknown): Error {
  if (error instanceof Error && error.name === 'PasswordException') {
    return new Error('Password-protected or encrypted PDFs are unsupported. Remove protection and try again.');
  }
  if (error instanceof Error && /password|encrypted/i.test(error.message)) {
    return new Error('Password-protected or encrypted PDFs are unsupported. Remove protection and try again.');
  }
  return new Error('This PDF is malformed or uses an unsupported feature. No text was imported.');
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

export async function extractPdfText(input: Uint8Array, signal?: AbortSignal): Promise<PdfTextExtraction> {
  if (signal?.aborted) throw abortError();
  if (!input.byteLength) throw new Error('The PDF file is empty.');
  if (input.byteLength > MAX_PDF_INPUT_BYTES) throw new Error('The PDF exceeds the 12 MiB source limit.');
  const header = new TextDecoder('ascii').decode(input.subarray(0, 5));
  if (header !== '%PDF-') throw new Error('The selected .pdf file does not have a PDF signature.');

  // PDF.js may transfer its input buffer to the worker. Keep the caller's bytes intact
  // for the original-source digest and retention path.
  const workerBytes = new Uint8Array(input.byteLength);
  workerBytes.set(input);
  const loadingTask = pdfjs.getDocument({
    data: workerBytes,
    isEvalSupported: false,
    enableXfa: false,
    stopAtErrors: true,
    disableAutoFetch: true,
    disableRange: true,
    disableStream: true,
    useWorkerFetch: false,
    useSystemFonts: false,
  });
  let passwordRequired = false;
  loadingTask.onPassword = () => { passwordRequired = true; void loadingTask.destroy(); };
  const onAbort = () => { void loadingTask.destroy(); };
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();

  try {
    const document = await loadingTask.promise;
    if (!Number.isSafeInteger(document.numPages) || document.numPages < 1) throw new Error('PDF has no readable pages.');
    if (document.numPages > MAX_PDF_PAGES) throw new Error(`The PDF has more than ${MAX_PDF_PAGES} pages; split it into smaller files and retry.`);

    const blocks: PdfPageTextBlock[] = [];
    let text = '';
    let utf8Bytes = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      if (signal?.aborted) throw abortError();
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent({ includeMarkedContent: false });
      if (signal?.aborted) throw abortError();
      let pageText = '';
      for (const item of content.items) {
        if (!('str' in item) || typeof item.str !== 'string') continue;
        utf8Bytes += utf8ByteLength(item.str);
        if (item.hasEOL) utf8Bytes += 1;
        if (utf8Bytes > MAX_PDF_TEXT_BYTES) throw new Error('Extracted PDF text exceeds the 8 MiB limit.');
        pageText += item.str;
        if (item.hasEOL) pageText += '\n';
      }
      pageText = pageText.trim();
      if (!pageText) {
        page.cleanup();
        continue;
      }
      if (text) {
        text += '\n\n';
        utf8Bytes += 2;
      }
      const start = text.length;
      text += pageText;
      const end = text.length;
      if (utf8Bytes > MAX_PDF_TEXT_BYTES) throw new Error('Extracted PDF text exceeds the 8 MiB limit.');
      blocks.push({ id: `pdf-page-${pageNumber}`, start, end, kind: 'paragraph', label: `Page ${pageNumber}`, pageNumber });
      page.cleanup();
    }
    if (!text.trim()) throw new Error('No selectable text was found in this PDF. Scanned/image-only PDFs are unsupported; OCR is not performed.');
    return {
      text,
      blocks,
      warnings: [
        'PDF text order is approximate for columns, tables, unusual layouts, and ligatures. Page labels preserve the source page for each extracted text block.',
        'Scanned/image-only pages are not recognized; OCR and PDF rendering are not performed.',
      ],
    };
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortException')) throw abortError();
    if (passwordRequired) throw new Error('Password-protected or encrypted PDFs are unsupported. Remove protection and try again.', { cause: error });
    if (error instanceof Error && (error.name === 'AbortError' || /No selectable text|more than 200 pages|8 MiB limit/.test(error.message))) throw error;
    throw pdfError(error);
  } finally {
    signal?.removeEventListener('abort', onAbort);
    await loadingTask.destroy().catch(() => undefined);
  }
}
