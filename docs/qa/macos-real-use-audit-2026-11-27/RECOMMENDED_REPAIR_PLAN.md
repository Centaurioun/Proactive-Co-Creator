# Recommended repair plan (review only; no fixes applied)

1. **Close the ChatGPT desktop admission gap (P1 candidate).** Remove broad desktop bypass behavior. Enforce the approved operation/model/reasoning tuple at the final server admission point for every request. Add no-network tests that assert unsupported combinations never reach transport.
2. **Repair catalog freshness and default preference rendering (P1).** A `/status` refresh must not invalidate a freshly loaded catalog without reason. Preserve stored defaults visibly while catalog refresh is pending/stale; distinguish persistence from current execution eligibility. Add close/reopen and relaunch regression tests.
3. **Unify operation availability and user-facing explanations (P2).** Replace legacy Gemini-only booleans with operation-specific capabilities, or explicitly document and explain Gemini-only features if that is the intended product boundary. Review Write and Review together.
4. **Investigate Plan/Review navigation (P2 candidate).** Trace the no-op/return-to-Plan shortcuts with a synthetic project, verify route destination and focus, and add deterministic navigation tests.
5. **Run the missing functional qualification.** Complete D04 scrolling, D05 selection/adoption, app restart, project lifecycle, import/export, remaining Plan views, backup/restore, and UI lifecycle. Use synthetic fixtures and mock-only providers.
6. **Requalify the installed build.** Compare packaged bundle contents to the selected source commit and retest the repaired candidate in the installed macOS app before release claims.

No speculative feature expansion is recommended. No implementation is included in this evidence-only branch.
