#!/usr/bin/env bash
set -euo pipefail

base_url="${E2E_BASE_URL:-http://127.0.0.1:3000}"
curl -fsS "$base_url/api/health" | grep -q '"configured":false'
session="pcc-mutations-$$"
trap 'playwright-cli -s="$session" close >/dev/null 2>&1 || true' EXIT
playwright-cli -s="$session" open --browser=chromium "$base_url/api/health" >/dev/null

read -r -d '' scenario <<'JS' || true
async (bootstrap) => {
  const base = new URL(bootstrap.url()).origin;
  const finding = {
    title: 'Synthetic continuity finding', description: 'Ada and the lantern need review.',
    category: 'continuity', severity: 'warning', certainty: 'possible', targetKind: 'section', targetId: 'test-scene',
  };
  const response = { findings: [finding], coverageNote: 'Mock analysis' };
  const proposal = {
    id: 'test-alternative', label: 'Lantern alternative', text: 'Ada raised a lamp.',
    rationale: 'Use a shorter line.', assumptions: [],
  };
  const projectId = 'narrative-mutation-fixture';
  const openMode = (page, name) => page.getByRole('navigation', { name: 'Narrative workspace' })
    .getByRole('button', { name, exact: true }).click();
  const waitForSavedContent = (page, kind) => page.evaluate(async ({ projectId, kind }) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('proactive_co_creator_db_v2');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const deadline = performance.now() + 2500;
      while (performance.now() < deadline) {
        const record = await new Promise(resolve => {
          const request = db.transaction('projects').objectStore('projects').get(projectId);
          request.onsuccess = () => resolve(request.result);
        });
        const narrative = record?.narrative;
        const matches = kind === 'preferences' ? narrative?.automationPreferences?.paused === true
          : kind === 'alternative' ? narrative?.writingAlternatives?.some(alt => alt.label === 'Lantern alternative')
          : narrative?.issues?.some(issue => kind === 'local'
            ? issue.title.includes('Excluded entity')
            : issue.title === 'Synthetic continuity finding');
        if (matches && record.revision > 5 && record.persistedRevision === record.revision) return record.revision;
        await new Promise(requestAnimationFrame);
      }
      throw new Error(kind + ' did not produce an acknowledged durable revision after the existing debounce');
    } finally {
      db.close();
    }
  }, { projectId, kind });

  const failures = [];
  for (const kind of ['preferences', 'alternative', 'local', 'semantic']) {
    const aiRequests = [];
    const context = await bootstrap.context().browser().newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(4000);
    page.setDefaultNavigationTimeout(8000);
    await context.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/capabilities')) return route.fulfill({ json: { configured: true } });
      if (path.endsWith('/provider-hub/status')) return route.fulfill({ json: {
        localPersonalConnectionsAvailable: true,
        capabilityPolicyVersion: 'ai04-synthetic-openai-v1',
        credentialAuthorityIds: { 'gemini-managed': 'synthetic', 'gemini-personal': 'synthetic', 'openai-api': 'synthetic', 'chatgpt-plan': 'synthetic' },
        preferences: { defaultConnectionId: 'openai-api', defaultTextModelId: 'gpt-6.2-sol', defaultReasoningLevel: 'default' },
        connections: [{
          id: 'openai-api', state: 'connected', selectedModelId: 'gpt-6.2-sol', models: [{
            id: 'gpt-6.2-sol', displayName: 'Synthetic OpenAI API Model',
            availability: { state: 'supported', value: true }, textGeneration: { state: 'supported', value: true },
            reasoning: { state: 'supported', value: ['default'] },
            operationCapabilities: Object.fromEntries(['analyze', 'clarify', 'polish', 'story', 'batch-edit', 'narrative-import', 'diagnostics', 'sync', 'writing', 'opportunities', 'import-enhance'].map(operation => [operation, operation === 'diagnostics' && kind === 'local' ? { state: 'unsupported' } : { state: 'supported', value: true }])),
          }],
        }],
      } });
      if (path.endsWith('/diagnostics/analyze')) { aiRequests.push(path); return route.fulfill({ json: response }); }
      if (path.endsWith('/writing/assist')) { aiRequests.push(path); return route.fulfill({ json: { proposals: [proposal] } }); }
      if (path.endsWith('/health')) return route.continue();
      throw new Error('Unexpected API path ' + path);
    });
    try {
      await page.goto(base + '/api/health');
      await page.evaluate(async id => {
        const { createSampleProject } = await import('/lib/canonicalModel.ts');
        const { createUndoRedoState } = await import('/lib/historyEngine.ts');
        const { narrativeBase, prepareManuscriptChange } = await import('/lib/narrative/manuscriptModel.ts');
        const { persistProjectDurably } = await import('/lib/storageEngine.ts');
        const baseProject = { ...createSampleProject(1700000000000), id, name: 'Narrative mutation test', revision: 4, persistedRevision: 4 };
        const name = baseProject.snapshot.entities[0].name;
        baseProject.snapshot.entities[0].excluded = true;
        const prepared = prepareManuscriptChange(baseProject, createUndoRedoState(baseProject.snapshot), narrativeBase(baseProject), [
          { id: 'test-scene', kind: 'scene', title: 'Lantern scene', text: name + ' raised a lantern.' },
        ]);
        const saved = await persistProjectDurably(prepared.project);
        if (!saved.saved) throw new Error('Fixture could not be persisted: ' + saved.error);
      }, projectId);
      await page.goto(base);
      await page.waitForTimeout(500);
      if (aiRequests.length) throw new Error('AI inference started before a direct user action: ' + JSON.stringify(aiRequests));
      if (kind === 'alternative') {
        await openMode(page, 'Write');
        await page.getByText(/AI Writing Assistant \(Selection-Aware/).click();
        await page.getByRole('button', { name: 'Continue', exact: true }).click();
        await page.getByRole('button', { name: 'Generate Continue Proposals' }).click();
        await page.getByRole('button', { name: 'Keep Alternative' }).click();
      } else {
        await openMode(page, 'Review');
        if (kind === 'preferences') {
          await page.getByRole('checkbox', { name: 'Enable bounded auto-analysis' }).check();
          await page.getByRole('button', { name: 'Pause auto-analysis' }).click();
        } else if (kind === 'local') {
          if (!await page.getByRole('button', { name: 'Analyze Consistency with AI' }).isDisabled()) {
            throw new Error('The synthetic provider should be ineligible for diagnostics in the local-check scenario.');
          }
          await page.getByRole('button', { name: 'Run Local Checks' }).click();
        } else {
          if (await page.getByRole('button', { name: 'Analyze Consistency with AI' }).isDisabled()) {
            throw new Error('Eligible OpenAI API diagnostics control remained disabled.');
          }
          await page.getByRole('button', { name: 'Analyze Consistency with AI' }).click();
          await page.getByText(/Recorded 1 semantic finding/).waitFor();
        }
      }
      const revision = await waitForSavedContent(page, kind);
      await page.reload({ waitUntil: 'networkidle' });
      await openMode(page, 'Review');
      await page.getByText(new RegExp('Revision #' + revision + ' ·')).waitFor();
      if (kind === 'local') {
        await page.getByRole('button', { name: 'Run Local Checks' }).click();
        await page.getByText(new RegExp('Revision #' + revision + ' ·')).waitFor();
      }
    } catch (error) {
      const visible = await page.getByRole('heading', { name: 'Review' }).count()
        ? await page.locator('main header').innerText().catch(() => '') : await page.locator('main').first().innerText().catch(() => '');
      const storage = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('proactive_co_creator_projects_v2') || '{}')).map(p => [p.id, p.revision]));
      const alert = await page.getByRole('alert', { name: 'Storage conflict or quota alert' }).allTextContents();
      failures.push(kind + ': ' + error.message + ' ' + visible.slice(0, 350) + JSON.stringify({ storage, alert }));
    } finally {
      await context.close();
    }
  }
  if (failures.length) throw new Error(failures.join('\n'));
  return 'NARRATIVE_MUTATIONS_PASS';
}
JS
output="$(playwright-cli -s="$session" run-code "$scenario" 2>&1)" || { echo "$output" >&2; exit 1; }
echo "$output"
[[ "$output" == *'"NARRATIVE_MUTATIONS_PASS"'* ]]
