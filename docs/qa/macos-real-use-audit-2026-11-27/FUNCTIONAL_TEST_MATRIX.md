# Functional test matrix (observed subset)

Statuses follow the audit prompt. Severity applies only to defects, not expected restrictions.

| ID | Area / action | Method | Result | Status | Severity | Evidence / limit |
|---|---|---|---|---|---:|---|
| ENV-01 | Launch installed app, identify runtime | Native UI + process inspection | App opened at 127.0.0.1:4319; app identity recorded | PASS | — | Provenance file; binary-to-source tie remains unverified |
| W-01 | Create synthetic project and chapter | Actual GUI | Project and synthetic section created | PASS | — | `W01-01-synthetic-manuscript.jpg` |
| W-02 | Edit synthetic manuscript and save | Actual GUI | Saved state/revision shown | PASS | — | Synthetic content only |
| W-03 | Preview then return to Edit | Actual GUI | Preview rendered text; Edit returned to editor | PASS | — | Tested earlier in this session |
| W-04 | Writing Assistant modes and availability | Actual GUI | Gemini-key unavailable notice; mode choices visible; Generate disabled; no provider call | PARTIAL | P2 candidate | `D05-01-writing-assistant.jpg`; text selection behavior not qualified |
| P-01 | Enter synthetic seed | Actual GUI | Seed accepted; 116 chars shown in compiled count | PASS | — | `P01-01-plan-seed-and-preflight.jpg` |
| P-02 | Inspect effective Story route | Actual GUI | ChatGPT plan / Luna / Medium shown; notice says only Luna / Default qualifies | PASS | — | No generation attempted |
| P-03 | Reanalyze Idea | Actual GUI | Click unexpectedly entered spinner; Escape closed it; external TLS socket transiently observed | PARTIAL | P1 candidate | `D03-01`, `D03-02`; provider completion/billing unknown; not repeated |
| P-04 | Story Bible / Opportunities shortcuts | Actual GUI | No distinct panel/content change observed on click | PARTIAL | P2 candidate | No separate screenshot saved for each action |
| P-05 | More views / Timeline | Actual GUI | Menu exposed Timeline and Mind map; Timeline click left screen/menu visibly unchanged | PARTIAL | P2 candidate | Mind map not exercised in this continuation |
| R-01 | Open Review & Diagnostics | Actual GUI | Revision 5, 0 conflicts, 1 reminder, 0 issues shown | PASS | — | AX state captured in task log |
| R-02 | Run local deterministic checks | Actual GUI | “Local checks found no changes to tracked issues” | PASS | — | Synthetic project |
| R-03 | AI semantic consistency / auto-analysis | Actual GUI | Disabled because server Gemini key absent | EXPECTED RESTRICTION / unresolved | — | Whether ChatGPT should be eligible is not settled |
| R-04 | Manuscript-to-model analysis | Actual GUI | Button disabled due missing Gemini server key | EXPECTED RESTRICTION / unresolved | — | No inference run |
| R-05 | Plan Checks, Opportunities, Revision History, Output Gallery shortcuts | Actual GUI | Clicks returned to Plan; no distinct destination content surfaced | PARTIAL | P2 candidate | Root cause not established |
| R-06 | Evidence & Audit | Actual GUI | 0 sources, 0 evidence claims, 0 registered issues; revision entries listed | PASS | — | Synthetic project |
| D-01 | Refresh catalog then close/reopen AI settings | Actual GUI | Active default model/reasoning become “Saved unavailable”; ChatGPT-specific Luna/Medium remain | FAIL | P1 | `D01-02` through `D01-04` |
| D-02 | Compare pre-reopen and post-reopen preference state | GUI + source | Refresh temporarily shows default Luna/Medium; reopen status marks catalog stale and disables defaults | FAIL | P1 | Root mechanism documented in issue report |
| LIFE-01 | Quit/relaunch installed app and verify preference restoration | Not performed | — | NOT TESTED | — | No relaunch persistence claim |
| IMP-01 | TXT/MD/JSON/PDF/EPUB import workflows | Not performed | — | NOT TESTED | — | No fixture exercise |
| EXP-01 | JSON/Markdown/DOCX export workflows | Not performed | — | NOT TESTED | — | UI export reports not exercised |
| PROJ-01 | Project switching, backup/restore, archive/delete | Not performed | — | NOT TESTED | — | Synthetic project retained pending audit cleanup |
| MAC-01 | Finder/Dock, maximize/fullscreen, port conflict, app lifecycle | Partial prior observation only | Not comprehensively covered | NOT TESTED | — | See coverage file |

This is a bounded observed subset, not exhaustive functional qualification.
