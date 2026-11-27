# Continued installed-app UI observations (2026-11-27)

Target: `/Applications/Proactive Co-Creator.app`, project `PCC QA Synthetic 2026-11-27` (synthetic only). Observations gathered through native app accessibility state and screenshots. No Archangel manuscript content was edited.

## Plan workspace

- Plan workspace loads with synthetic seed, story/image mode toggles, Reanalyze Idea, Generate Story, entity search/type filter, graph display modes (Graph/Table/Ego Map/Family), zoom controls, output reader tabs, undo/redo, Review Plan & Prompt, output panel toggle, and generation buttons.
- Story route displayed ChatGPT plan, model `gpt-6-luna`, reasoning `medium`, plus explicit warning that only Luna with Default reasoning is qualified for ChatGPT Story. No story was generated.
- Story Bible and Opportunities controls were clicked from Plan; accessibility tree did not change. The screen remained Plan. Result: no visible panel/navigation response in this run.
- More views opens a menu with Timeline and Mind map. Clicking Timeline did not change the accessibility tree or visible screen; menu remained open. Mind map was visible in the menu but not further activated in this continuation.
- A prior click of Reanalyze Idea unexpectedly entered an analysis spinner despite appearing unavailable. Escape ended the spinner and the external TCP connection was no longer present immediately afterward; upstream receipt/billing remains unknown. No further AI action was taken.

## Review workspace

- Review & Diagnostics loads. It reported revision 5, 0 local conflicts, 1 readiness reminder, 0 tracked issues.
- Run Local Checks completed locally and reported “Local checks found no changes to tracked issues.”
- Review page exposed Plan Checks, Creative Opportunities, Revision History, Output Gallery, Analyze Consistency with AI, manuscript/model sync, optional semantic auto-analysis, and JSON/Markdown export controls.
- AI consistency analysis, manuscript change analysis, and auto-analysis were disabled because the server Gemini API key was not configured. These were not activated.
- Readiness reminder: three core Story Bible properties (Genre, Tone, Setting) await confirmation.
- Clicking Plan Checks, Creative Opportunities, Revision History, and Output Gallery each returned the UI to Plan workspace in this run; no distinct destination content became visible. This is a repeatable navigation/result concern, with screenshot/AX evidence only for the resulting UI state.
- Evidence & Audit showed revision 5, 0 sources, 0 evidence claims, 0 registered issues; three manuscript edit revisions were listed.

## Limitations

This is a continuation log, not a complete control-by-control audit. A click that produced no visible state change is recorded as such; it is not proof of backend failure. Provider-backed and potentially billable actions were not repeated. Screenshots previously captured for the key settings, writing assistant, synthetic editor, Plan preflight, and accidental analysis spinner are documented in the main evidence set. This continuation did not save additional screenshot files.
