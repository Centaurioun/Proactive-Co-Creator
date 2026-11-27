# Coverage and limitations

## Covered

- Installed app identity, runtime origin and app.asar digest; source commit association remains unproven.
- Real macOS UI use on the installed application with a synthetic project.
- AI settings catalog refresh and close/reopen sequence.
- Synthetic manual editing, save indication, Preview/Edit navigation, Writing Assistant availability notice.
- Plan seed entry, route disclosure, accidental Reanalyze loading state and cancellation.
- Review page inspection and local deterministic checks.
- Candidate source inspection for preference catalog state, desktop ChatGPT admission, and safeStorage fallback.

## Not completed

- Exhaustive every-control audit; full Cycle 3 coverage is not complete.
- Exact source-to-installed packaged bundle comparison.
- Electron embedded Node and Chromium version identification.
- App quit/relaunch preference restoration and single-instance behavior.
- Fullscreen/maximize, port-conflict, menu/keyboard/accessibility qualification.
- D04 long seed and nested scroll metrics.
- Full Writing Assistant caret/selection and proposal workflows.
- Plan clarification, inbox decisions, entity editing, relationships, batch preview/adoption, mind map, timeline, output reader/refinement.
- Backup/restore, project switching/deletion/archive, imports and exports (TXT/MD/JSON/PDF/EPUB/DOCX).
- Mocked provider transport tests and operation-by-provider compatibility qualification.
- Gemini/OpenAI API setup, credentials, quota, and provider transport.
- Independent six-cycle sign-off. The audit was not complete enough to claim all six criteria passed.

## Safety / provider limitations

No real provider generation was intentionally conducted. The Reanalyze click unexpectedly began loading; a transient TLS socket was observed, but endpoint, request, upstream acceptance, and billing are unknown. This cannot be described as a confirmed provider call or as a confirmed no-charge event.

The user should not interpret this evidence branch as proof that the app is ready or that all features have been tested. It is a partial independent-review package with unresolved findings.
