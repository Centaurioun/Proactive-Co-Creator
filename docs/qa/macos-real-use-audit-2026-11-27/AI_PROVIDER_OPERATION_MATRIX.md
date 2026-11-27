# AI provider operation matrix — observed and source-level subset

This matrix records evidence available in this partial audit. A connected account or listed model does not prove operation eligibility. “Unknown” means not verified, not supported.

| Operation | ChatGPT plan | Gemini managed | OpenAI API | Observed UI / transport evidence |
|---|---|---|---|---|
| Story generation | UI displayed Luna / Medium but explicitly qualified only Luna / Default; no story run. Medium is outside approved scope. | Not tested | Not tested | No inference intentionally attempted |
| Plan Reanalyze Idea / entity analysis | UI click produced spinner; potential desktop admission bypass in candidate source; upstream result unknown | Not tested | Not tested | Transient external TLS socket, destination unknown |
| Review semantic consistency | UI disabled when Gemini server key absent; ChatGPT eligibility unknown | Missing server Gemini key | Not tested | No request |
| Manuscript → Model analysis | UI disabled when Gemini server key absent; ChatGPT eligibility unknown | Missing server Gemini key | Not tested | No request |
| Model → Manuscript sync | UI control present; no execution | Not tested | Not tested | Not exercised |
| Optional semantic auto-analysis | Disabled due missing server AI credentials | Missing server Gemini key | Not tested | No request |
| Writing Assistant (Continue/Rewrite/Clarity/Shorten/Expand/Dialogue/Alternatives/Custom) | Connected account did not enable it in the observed UI; operation-by-operation eligibility unknown | UI notice says server Gemini key absent | Not tested | Generate disabled; no request |
| Catalog refresh | ChatGPT plan connected; refresh returned 10 models | Not tested | Not tested | Status/catalog UI only |

## Source-level policy risk (not live qualification)

Candidate source inspection indicates `PCC_DESKTOP_MODE=1` can affect ChatGPT capability metadata in `server/providers/policy.ts`; `server/routes.ts` has a `desktopChatGptFull` branch that skips provider operation and model assertions for ChatGPT desktop requests. This appears broader than the UI's bounded “GPT-6 Luna with Default reasoning is qualified for ChatGPT Story” statement. Installed-bundle identity and the precise observed Reanalyze request were not proven, so this is a candidate source-level authorization defect, not a confirmed completed live inference.

No provider row is marked empirically supported except catalog refresh and the app's displayed connected status. All actual inference combinations remain unverified.
