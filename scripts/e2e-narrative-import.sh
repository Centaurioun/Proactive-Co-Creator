#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${E2E_BASE_URL:-http://127.0.0.1:3000}"
if ! command -v playwright-cli >/dev/null 2>&1; then
  echo "playwright-cli not found on PATH" >&2
  exit 1
fi
curl -fsS "$BASE_URL/api/health" | grep -q '"configured":false'
mkdir -p .playwright-cli
trap 'playwright-cli -s=pcc-import close >/dev/null 2>&1 || true' EXIT
playwright-cli -s=pcc-import open --browser=chromium "$BASE_URL/api/health" >/dev/null
read -r -d '' scenario <<'JS' || true
async (page) => {
  const browser = page.context().browser();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });
  await context.addInitScript(() => {
    if (localStorage.getItem('proactive_co_creator_active_id_v2')) return;
    const now = 1700000000000;
    const id = 'synthetic-import-seed';
    const seed = {
      schemaVersion: 3, id, name: 'Synthetic Import Seed', revision: 1, persistedRevision: 1,
      createdAt: now, updatedAt: now,
      snapshot: { originalIdea: 'Synthetic baseline', refinedPrompt: 'Synthetic baseline', freeformNotes: '', mode: 'story',
        entities: [], relationships: [], clarifications: [], decisions: [], answeredQuestions: [], skippedQuestions: [] },
      artifacts: [], revisions: [],
    };
    localStorage.setItem('proactive_co_creator_projects_v2', JSON.stringify({ [id]: seed }));
    localStorage.setItem('proactive_co_creator_active_id_v2', id);
  });
  const errors = [];
  let extractionCalls = 0;
  await context.route('**/api/narrative/import/extract', async route => {
    extractionCalls += 1;
    const request = route.request().postDataJSON();
    const quote = 'Ada is a cartographer.';
    const start = request.text.indexOf(quote);
    if (start < 0) throw new Error('Synthetic source quote was not present in the request.');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ extraction: {
      findings: [],
      entities: [{ id: 'model-id-ignored', name: 'Ada', category: 'character', description: 'Cartographer', aliases: [],
        attributes: [{ id: 'model-attribute-ignored', name: 'occupation', value: 'cartographer', kind: 'explicit', rationale: 'The source states this directly.', evidence: { start, end: start + quote.length, quote } }],
        kind: 'explicit', rationale: 'The source names Ada and her occupation.', evidence: { start, end: start + quote.length, quote } }],
      relationships: [], ambiguities: [],
    } }) });
  });
  const p = await context.newPage();
  p.on('pageerror', error => errors.push(error.message));
  try {
    await p.goto('__BASE_URL__', { waitUntil: 'networkidle' });
    const activeIdBefore = await p.evaluate(() => localStorage.getItem('proactive_co_creator_active_id_v2'));
    await p.getByRole('navigation', { name: 'Narrative workspace' }).getByRole('button', { name: 'Import Story' }).click();
    const story = 'Ada is a cartographer.\n\nShe distrusts the letter.';
    await p.getByRole('textbox', { name: 'Or paste narrative text' }).fill(story);
    await p.getByRole('button', { name: 'Preview source' }).click();
    await p.getByText(/Source SHA-256:/).waitFor();
    if (extractionCalls !== 0) throw new Error('Preview unexpectedly called extraction.');
    await p.getByRole('button', { name: 'Analyze source' }).click();
    await p.getByText(/All planned source segments were analyzed/).waitFor();
    await p.getByRole('button', { name: /Accept evidence-backed explicit findings/ }).click();
    await p.screenshot({ path: '.playwright-cli/phase-02-import-review-1280-dark.png' });
    await p.getByRole('button', { name: 'Create Project', exact: true }).click();
    await p.waitForTimeout(1500);
    const afterCreateText = await p.locator('body').innerText();
    if (!afterCreateText.includes('Imported project "Imported narrative" saved.')) throw new Error('Project creation did not report success: ' + afterCreateText.slice(-1800));
    const saved = await p.evaluate(() => {
      const activeId = localStorage.getItem('proactive_co_creator_active_id_v2');
      const projects = JSON.parse(localStorage.getItem('proactive_co_creator_projects_v2') || '{}');
      return { activeId, project: projects[activeId] };
    });
    if (!saved.project || saved.activeId === activeIdBefore) throw new Error('Import did not create a separate project.');
    if (saved.project.narrative.sources[0].text !== story) throw new Error('Imported source text was not retained exactly.');
    if (saved.project.narrative.claims.length < 2) throw new Error('Expected evidence claims were not persisted.');
    if (!saved.project.narrative.claims.every(claim => claim.approval === 'confirmed')) throw new Error('Bulk confirmation failed to approve explicit source-backed claims.');
    await p.reload({ waitUntil: 'networkidle' });
    const persistedAfterReload = await p.evaluate(async () => {
      const activeId = localStorage.getItem('proactive_co_creator_active_id_v2');
      const map = JSON.parse(localStorage.getItem('proactive_co_creator_projects_v2') || '{}');
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('proactive_co_creator_db_v2');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      const idbProjects = await new Promise((resolve, reject) => {
        const request = db.transaction('projects').objectStore('projects').getAll();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      db.close();
      const summary = project => project ? { id: project.id, revision: project.revision, schemaVersion: project.schemaVersion, sources: project.narrative?.sources?.length ?? 0, claims: project.narrative?.claims?.length ?? 0 } : null;
      return { activeId, local: summary(map[activeId]), localProjects: Object.keys(map), idbProjects: idbProjects.map(summary) };
    });
    await p.getByRole('navigation', { name: 'Narrative workspace' }).getByRole('button', { name: 'Review' }).click();
    await p.waitForTimeout(1000);
    const reviewText = await p.locator('body').innerText();
    if (!reviewText.includes('1 sources') || !reviewText.includes('2 evidence claims')) throw new Error('Imported records did not reload into Review: ' + JSON.stringify(persistedAfterReload) + '\n' + reviewText.slice(-1600));
    await p.getByText('Source: pasted-narrative.txt · extracted text only', { exact: true }).click();
    await p.getByText(/SHA-256/).waitFor();
    if (extractionCalls !== 1) throw new Error('Unexpected extraction request count: ' + extractionCalls);
    if (errors.length) throw new Error('Browser page errors: ' + errors.join('; '));
    await p.getByRole('navigation', { name: 'Narrative workspace' }).getByRole('button', { name: 'Projects' }).click();
    await p.getByRole('button', { name: 'Create Backup' }).click();
    await p.getByText('Verified project backup created.', { exact: true }).waitFor();
    await p.getByRole('listitem').filter({ hasText: 'Manual backup' }).getByRole('button', { name: 'Preview restore' }).click();
    await p.getByRole('button', { name: 'Restore project copy' }).click();
    await p.getByText(/Restored and saved project copy/).waitFor();
    const restored = await p.evaluate(() => {
      const activeId = localStorage.getItem('proactive_co_creator_active_id_v2');
      const projects = JSON.parse(localStorage.getItem('proactive_co_creator_projects_v2') || '{}');
      const project = projects[activeId];
      return { id: activeId, sources: project?.narrative?.sources?.length ?? 0, claims: project?.narrative?.claims?.length ?? 0,
        proposals: project?.narrative?.proposals?.length ?? 0, originalText: project?.narrative?.sources?.[0]?.text,
        coverage: project?.narrative?.sources?.[0]?.analysisCoverage };
    });
    if (restored.sources !== 1 || restored.claims < 2 || restored.proposals < 2 || restored.originalText !== story || restored.coverage?.instruction !== '') {
      throw new Error('Managed backup restore lost import records: ' + JSON.stringify(restored));
    }
    await p.getByRole('navigation', { name: 'Narrative workspace' }).getByRole('button', { name: 'Review' }).click();
    await p.setViewportSize({ width: 390, height: 844 });
    await p.getByText(/Imported findings and proposals/).waitFor();
    if (await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Horizontal overflow at 390px.');
    await p.screenshot({ path: '.playwright-cli/phase-02-import-review-record-390.png', fullPage: true });
    return 'IMPORT_E2E_JSON_BEGIN' + JSON.stringify({ passed: true, extractionCalls, activeProjectId: saved.activeId, restoredProjectId: restored.id, sourceCharacters: story.length, screenshots: ['.playwright-cli/phase-02-import-review-1280-dark.png', '.playwright-cli/phase-02-import-review-record-390.png'], pageErrors: errors }) + 'IMPORT_E2E_JSON_END';
  } finally { await context.close(); }
}
JS
scenario="${scenario//__BASE_URL__/$BASE_URL}"
RUN_OUT="$(playwright-cli -s=pcc-import run-code "$scenario" 2>&1)" || { echo "$RUN_OUT" >&2; exit 1; }
echo "$RUN_OUT"
IMPORT_E2E_RAW="$RUN_OUT" node -e '
const fs = require("node:fs"); const raw = process.env.IMPORT_E2E_RAW || "";
const start = raw.indexOf("IMPORT_E2E_JSON_BEGIN"); const end = raw.indexOf("IMPORT_E2E_JSON_END", start);
if (start < 0 || end < 0) { console.error("Missing structured import E2E result"); process.exit(1); }
const escaped = raw.slice(start + 21, end).replaceAll(String.fromCharCode(92) + String.fromCharCode(34), String.fromCharCode(34));
const result = JSON.parse(escaped);
fs.writeFileSync(".playwright-cli/narrative-import-e2e.json", JSON.stringify(result, null, 2));
if (!result.passed) process.exit(1);
console.log("Phase 2 import Chromium flow passed;", result.extractionCalls, "mock request(s).");
'
