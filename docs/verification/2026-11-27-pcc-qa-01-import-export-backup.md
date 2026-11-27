# PCC-QA-01 — Import, Export and Backup Integrity

**Result:** PASS for the verified synthetic scope. No product source change was needed.

## Scope and isolation

- Tested the requested base `11ae2af2f09f278ab74312a276cf3dc8cd944c7d` in a fresh Chromium context with isolated localStorage and IndexedDB.
- Used a local server on port 4300. `/api/health` reported `configured: false`.
- The browser made local capability and provider-status checks. It made zero narrative extraction, enhancement, generation, analysis, image, or story operation requests. No provider traffic occurred.
- Read and compared projects from IndexedDB. Import and restore created separate project IDs; the original project remained present.

## Import results

Each supported UI import was performed with “Continue with source only”; no extraction or inference was started. For each file, the source digest matched the fixture bytes, original bytes were retained, and the extracted text was stored as the imported manuscript section in the expected order.

| Format | Result | Text/order evidence |
| --- | --- | --- |
| TXT | PASS | 22 characters; two paragraphs; exact Unicode source text retained. |
| Markdown | PASS | 50 characters; four source blocks; heading and body order retained exactly. |
| DOCX | PASS | 35 extracted characters; heading style and paragraph order retained. |
| PDF | PASS | 18 selectable-text characters; page text order retained. |
| EPUB | PASS | 41 characters; four blocks; OPF spine order retained (second chapter before first). |

Small fixture SHA-256 digests: TXT `d160ca8f043c27382994fc3445169c6335c2b216aeb4fe916ae21618e71f33e1`; Markdown `a704bbe5e0dd84e242b2db961ed996629a9c8a544ddea88b6dba1c54e1961b43`; DOCX `dcbd9dfd73400cda361237426368f3af165b9c97be3484f00f6117ad82eff074`; PDF `7524068eee21246e12e8f323c2814a9c79dffd1bf15fec153aab7efe844aab0d`; EPUB `8a26121e5f56ca9e2a434fe98ea4e6f07c1f964012c6fa52b6f1e3d4931f3525`.

Malformed PDF and unsupported binary files were rejected at source preview. The full existing IndexedDB project set and content remained unchanged after both attempts (comparison normalizes only regenerated `snapshot.decisions[].createdAt` values).

## Export results

Exported through the UI and inspected the actual downloaded files:

- Markdown matched the IndexedDB project’s Markdown export string exactly; SHA-256 `a704bbe5e0dd84e242b2db961ed996629a9c8a544ddea88b6dba1c54e1961b43`.
- TXT matched the project’s plain-text export string exactly and contained the full manuscript; SHA-256 `17912236e56018d9cbf020a15e0d654fb362ffee1a65432f25af598ce5ff152e`.
- DOCX opened as a valid ZIP package. Extracted document text contained project title, section label and manuscript text in order; SHA-256 `0190b804f52b29b57d10f78f16e384380a4a55a2b94388eea930b04e190e2fc2`.

## Backup and restore

- Created and exported a browser backup labelled `PCC-QA-01 synthetic`.
- Downloaded manifest payload size was 59,566 bytes; payload SHA-256 `daac2a15aa0fe49361cb13cfc5b4967f7930bf3c05d5453af5a50a1802d7676c` matched the manifest. The retained Markdown source bytes in the backup matched the original fixture byte-for-byte and digest.
- Previewed the backup before restoring. Restore created a separate active IndexedDB project and did not replace the original.
- After reload, verified the restored project’s manuscript/source metadata, 6 entities, 5 relationships, Story Bible values, two revision-history entries and narrative source records against the original project. Snapshot content matched apart from the derived decision timestamp normalization described below.
- Tampered with the exported backup payload without updating its checksum. Preview rejected it; the existing project IDs and project content remained unchanged.

## Known scope limits

- PDF extraction reads selectable text; image-only pages are not OCR’d.
- EPUB extraction is text based and can report partial or unsupported spine content. This synthetic EPUB contained only supported XHTML chapters.
- DOCX extraction preserves paragraph text and recognized heading styles; it does not promise complete Word layout/media reconstruction. The parser rejects unsafe or unsupported ZIP layouts.
- EPUB coverage is conditional; only a complete synthetic EPUB case was exercised in the UI. Existing EPUB parser tests separately cover unsupported and partial cases.
- Schema migration rebuilds derived decision inbox entries and may regenerate a decision `createdAt` timestamp. Decision identity/status and the requested manuscript, entity, relationship, Story Bible, revision and narrative content remained intact.

## Checks

- Targeted parser, persistence, recovery, export and manuscript tests: 36 passed, 0 failed.
- Targeted EPUB, ZIP-reader, recovery and export tests: 54 passed, 0 failed.
- Browser UI import/export/backup/restore scenario: PASS; source operation endpoints called: 0.
- No source changes were made; typecheck and lint were therefore not run.
