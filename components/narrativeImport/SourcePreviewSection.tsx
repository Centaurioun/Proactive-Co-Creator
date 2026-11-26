import {
  countNarrativeWords,
  MAX_RETAINED_ORIGINAL_BYTES,
  type ParsedNarrativeSource,
} from '../../lib/narrative/import/sourceParser';

interface SourcePreviewSectionProps {
  file: File | null;
  pastedText: string;
  retainOriginal: boolean;
  confirmExtractedOnly: boolean;
  busy: boolean;
  source: ParsedNarrativeSource | null;
  sourceError: string;
  parsedHasFileRetentionGap: boolean;
  onFileChange: (next: File | null) => void;
  onPastedTextChange: (next: string) => void;
  onRetainOriginalChange: (checked: boolean) => void;
  onConfirmExtractedOnlyChange: (checked: boolean) => void;
  onInspectSource: () => void;
}

export function SourcePreviewSection({
  file,
  pastedText,
  retainOriginal,
  confirmExtractedOnly,
  busy,
  source,
  sourceError,
  parsedHasFileRetentionGap,
  onFileChange,
  onPastedTextChange,
  onRetainOriginalChange,
  onConfirmExtractedOnlyChange,
  onInspectSource,
}: SourcePreviewSectionProps) {
  return (
    <section
      className="space-y-3 rounded-xl border border-[#dad8d2] bg-white p-4 dark:border-gray-700 dark:bg-gray-900 sm:p-5"
      aria-labelledby="import-source-title"
    >
      <h2 id="import-source-title" className="font-display text-xl font-semibold">1. Choose and inspect a story source</h2>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,1.1fr)]">
        <div className="space-y-3">
          <label className="block text-sm font-medium" htmlFor="import-file">Choose a manuscript file</label>
          <input
            id="import-file"
            type="file"
            accept=".txt,.md,.markdown,.docx,.pdf,.epub,application/pdf,application/epub+zip"
            onChange={(event) => onFileChange(event.currentTarget.files?.[0] ?? null)}
            className="block min-h-12 w-full rounded-lg border border-[#c8c3c5] bg-[#f5f2ee] p-3 text-sm file:mr-3 file:min-h-9 file:rounded-md file:border-0 file:bg-white file:px-3 file:font-semibold file:text-[#62445e] dark:border-gray-700 dark:bg-gray-800 dark:file:bg-gray-700 dark:file:text-purple-100"
          />
          <label className="block text-sm" htmlFor="import-pasted-text">Or paste narrative text</label>
          <textarea
            id="import-pasted-text"
            className="min-h-32 w-full rounded-lg border border-[#dad8d2] bg-white p-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#62445e] dark:border-gray-700 dark:bg-gray-950"
            value={pastedText}
            onChange={(event) => onPastedTextChange(event.target.value)}
            placeholder="Paste text to preview locally"
          />
          {file && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={retainOriginal}
                onChange={(event) => onRetainOriginalChange(event.target.checked)}
              />
              Keep the original file alongside extracted text in the project and backups (up to {Math.round(MAX_RETAINED_ORIGINAL_BYTES / 1024 / 1024)} MiB)
            </label>
          )}
          <button
            type="button"
            className="min-h-11 rounded-lg bg-[#62445e] px-4 py-2 text-sm font-semibold text-white hover:bg-[#50364d] disabled:cursor-not-allowed disabled:opacity-50"
            onClick={onInspectSource}
            disabled={(!file && !pastedText.trim()) || busy}
          >
            {busy ? 'Reading source…' : 'Inspect source'}
          </button>
          {sourceError && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{sourceError}</p>}
          {source && (
            <div className="space-y-2 rounded bg-gray-50 p-3 dark:bg-gray-900">
              <p className="font-medium">{source.filename} · {source.text.length.toLocaleString()} characters · {countNarrativeWords(source.text).toLocaleString()} words</p>
              <p className="break-all text-xs">Source SHA-256: {source.digest} · {source.retention === 'original-and-extracted' ? 'Original bytes retained' : 'Extracted text only'}</p>
              {source.warnings.map((warning, index) => <p key={index} className="text-sm text-amber-800 dark:text-amber-200">{warning}</p>)}
              {parsedHasFileRetentionGap && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={confirmExtractedOnly} onChange={(event) => onConfirmExtractedOnlyChange(event.target.checked)} />
                  I understand this import will not preserve the original file bytes.
                </label>
              )}
              <details>
                <summary>Extracted text preview</summary>
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words">
                  {source.text.slice(0, 12_000)}{source.text.length > 12_000 ? '\n… preview shortened; full source remains available to the import pipeline.' : ''}
                </pre>
              </details>
              {source.blocks.some((block) => block.kind === 'heading') && (
                <p className="text-sm">Detected {source.blocks.filter((block) => block.kind === 'heading').length} source heading(s). Plain text structure is not inferred.</p>
              )}
            </div>
          )}
        </div>
        <aside className="space-y-3 rounded-lg border border-[#dad8d2] bg-[#fbfaf7] p-4 text-sm dark:border-gray-700 dark:bg-gray-950" aria-label="Source inspection guidance">
          {source ? (
            <>
              <div>
                <h3 className="font-semibold">Source inspected</h3>
                <p className="mt-1 break-words text-gray-700 dark:text-gray-300">{source.filename}</p>
              </div>
              <dl className="grid grid-cols-2 gap-3 border-y border-[#dad8d2] py-3 dark:border-gray-700">
                <div><dt className="text-xs text-gray-600 dark:text-gray-400">Words</dt><dd className="font-semibold tabular-nums">{countNarrativeWords(source.text).toLocaleString()}</dd></div>
                <div><dt className="text-xs text-gray-600 dark:text-gray-400">Characters</dt><dd className="font-semibold tabular-nums">{source.text.length.toLocaleString()}</dd></div>
              </dl>
              <p className="break-all text-xs text-gray-600 dark:text-gray-400">SHA-256 · {source.digest}</p>
              <p className="text-xs text-gray-600 dark:text-gray-400">{source.retention === 'original-and-extracted' ? 'Original file and extracted text are retained separately.' : 'Only extracted text is retained for this import.'}</p>
            </>
          ) : (
            <>
              <h3 className="font-semibold">Supported sources</h3>
              <p className="text-gray-700 dark:text-gray-300">DOCX, Markdown, TXT, PDF, EPUB, or pasted text.</p>
              <p className="text-xs text-gray-600 dark:text-gray-400">PDFs need selectable text. EPUB extraction is text based and may be partial. Image-only or unsupported archive content is not reconstructed.</p>
              <p className="rounded-lg bg-[#f8efdf] px-3 py-2 text-xs font-semibold text-[#6e4c21] dark:bg-amber-950/40 dark:text-amber-200">Preview does not create a project.</p>
            </>
          )}
        </aside>
      </div>
    </section>
  );
}
