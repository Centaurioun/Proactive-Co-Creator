# Findings ledger

| ID | Severity | Status | Area | Evidence | Confidence / cause | Proposed next action |
|---|---:|---|---|---|---|---|
| PCC-MAC-D01 | P1 | Confirmed FAIL | AI settings preference UI | D01-02/03/04 | High: status refresh marks catalog stale; active-default selectors filter stale catalog while ChatGPT-specific preferences remain displayed | Keep saved values inspectable during stale status; add settings reopen/restart regression coverage |
| PCC-MAC-D02 | P2 | PARTIAL | Review AI availability | UI AX observation | Gemini-only gating confirmed; product policy vs bug unknown | Trace mocked capability/preflight/provider path; align availability and messaging |
| PCC-MAC-D03 | P1 candidate | PARTIAL / safety incident | Plan Reanalyze provider admission | D03-01/02; source review | Candidate desktop route bypass; socket origin/result unknown | Reject all unqualified ChatGPT operations before transport; verify with no-network harness |
| PCC-MAC-D05 | P2 candidate | PARTIAL | Writing Assistant availability | D05-01 | Gemini-specific gate observed; root contract unresolved | Replace legacy boolean with explicit operation capability or correct product restriction copy |
| PCC-MAC-NAV-01 | P2 candidate | PARTIAL | Plan/Review shortcut navigation | Continued UI observations | Clicks produced no distinct destination or returned to Plan; handlers/root cause unknown | Capture targeted state and inspect route/handler with safe synthetic fixture |

No confirmed P0 finding. No confirmed unauthorized billing. No claim that the installed bundle equals candidate source.
