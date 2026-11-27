#!/usr/bin/env bash
set -euo pipefail

base_url="${E2E_BASE_URL:-http://127.0.0.1:3000}"
curl -fsS "$base_url/api/health" | grep -q '"configured":false'
session="pcc-ai-ownership-$$"
trap 'playwright-cli -s="$session" close >/dev/null 2>&1 || true' EXIT
playwright-cli -s="$session" open --browser=chromium "$base_url/api/health" >/dev/null

read -r -d '' scenario <<'JS' || true
async (bootstrap) => {
  const base = new URL(bootstrap.url()).origin;
  const failures = [];
  const scenarioEvidence = [];
  for (const kind of ['switch', 'edit', 'pause', 'supersede', 'batch', 'fixes']) {
    const context = await bootstrap.context().browser().newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    const calls = [];
    const browserEvidence = { pageErrors: [], consoleErrors: [], failedRequests: [], apiRequests: [], apiResponses: [] };
    page.on('pageerror', error => browserEvidence.pageErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') browserEvidence.consoleErrors.push(message.text()); });
    page.on('requestfailed', request => browserEvidence.failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) browserEvidence.apiRequests.push({ method: request.method(), path: new URL(request.url()).pathname }); });
    page.on('response', response => { if (new URL(response.url()).pathname.startsWith('/api/')) browserEvidence.apiResponses.push({ status: response.status(), path: new URL(response.url()).pathname }); });
    const open = (name) => page.getByRole('navigation', { name: 'Narrative workspace' })
      .getByRole('button', { name, exact: true }).click();
    const start = async () => {
      const button = page.getByRole('button', { name: 'Analyze Consistency with AI' });
      if (!await button.isEnabled()) throw new Error('Analyze Consistency with AI is disabled despite the fixture declaring diagnostics support.');
      await button.click();
    };
    await context.addInitScript(() => {
      const fetchReal = window.fetch.bind(window);
      window.completedMockCalls = [];
      window.fetch = async (url, options) => {
        if (!String(url).match(/\/(diagnostics\/analyze|diagnostics\/suggest-fixes|batch-edit)$/)) return fetchReal(url, options);
        const response = await fetchReal(url, { ...options, signal: undefined });
        const read = response.json.bind(response);
        response.json = async () => {
          const body = await read();
          requestAnimationFrame(() => requestAnimationFrame(() => window.completedMockCalls.push(body.mockCall)));
          return body;
        };
        return response;
      };
    });
    await context.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/capabilities')) return route.fulfill({ json: { configured: true } });
      if (path === '/api/ai/provider-hub/status') return route.fulfill({ json: {
        capabilityPolicyVersion: 'qa-synthetic-policy-v1',
        credentialAuthorityIds: { 'gemini-managed': 'qa-synthetic-authority' },
        preferences: { defaultConnectionId: 'gemini-managed' },
        connections: [{ id: 'gemini-managed', family: 'gemini', billing: 'host-managed-gemini', state: 'available', selectedModelId: 'qa-synthetic-model', models: [{
          id: 'qa-synthetic-model', displayName: 'Synthetic managed model',
          availability: { state: 'supported', value: true, evidence: [] },
          textGeneration: { state: 'supported', value: true, evidence: [] },
          imageGeneration: { state: 'unsupported', evidence: [] },
          structuredOutput: { state: 'supported', value: true, evidence: [] },
          contextLimit: { state: 'supported', value: 8000, evidence: [] },
          outputLimit: { state: 'supported', value: 4096, evidence: [] },
          reasoning: { state: 'supported', value: ['default'], evidence: [] },
          operationCapabilities: {
            diagnostics: { state: 'supported', value: true, evidence: [] },
            'batch-edit': { state: 'supported', value: true, evidence: [] },
          },
          capabilityPolicyVersion: 'qa-synthetic-policy-v1',
        }] }],
        usage: { observedByConnection: {}, quota: { state: 'unknown' } },
      } });
      if (!path.match(/\/(diagnostics\/analyze|diagnostics\/suggest-fixes|batch-edit)$/)) throw new Error('Unexpected API route ' + path);
      const id = calls.length + 1;
      await new Promise(resolve => calls.push({ finish: resolve }));
      const title = id === 1 && kind !== 'fixes' ? 'Stale mock finding' : 'Current mock finding';
      const json = kind === 'batch'
        ? { mockCall: id, instruction: route.request().postDataJSON().instruction, operations: [],
            ambiguities: [{ clarifyingQuestion: title, candidates: [] }], warnings: [], coverageComplete: true }
        : path.endsWith('/diagnostics/suggest-fixes')
          ? { mockCall: id, alternatives: [{
              id: 'synthetic-genre-fix', title: 'Use the reviewed synthetic genre',
              reason: 'This synthetic suggestion is explicitly reviewed before application.',
              assumptions: ['The author intends this test fixture to update one Story Bible field.'],
              evidenceSummary: 'Synthetic browser fixture', affectedScope: 'Story Bible · genre',
              kind: 'story_bible', storyField: 'genre', beforeText: 'Mystery', afterText: 'Synthetic noir',
            }] }
        : { mockCall: id, coverageNote: 'Mock diagnostics', findings: [{
            title, description: 'Synthetic continuity issue', category: 'continuity', severity: 'warning',
            certainty: 'possible', targetKind: 'story_bible', storyField: 'genre',
          }] };
      await route.fulfill({ json });
    });
    const begin = async (action, path) => {
      let requestError;
      const requested = page.waitForRequest('**/api/' + path, { timeout: 6500 }).catch(error => { requestError = error; return null; });
      await action();
      if (!await requested) throw requestError;
    };
    const finish = async (id) => {
      calls[id - 1].finish();
      await page.waitForFunction(id => window.completedMockCalls.includes(id), id);
    };
    try {
      await page.goto(base, { waitUntil: 'networkidle' });
      if (kind === 'fixes') {
        await open('Plan');
        await page.getByRole('tab', { name: 'Story Bible' }).click();
        const genre = page.locator('#bible-genre');
        await genre.fill('Mystery');
        await page.waitForFunction(async () => {
          const id = localStorage.getItem('proactive_co_creator_active_id_v2');
          const db = await new Promise(resolve => { const request = indexedDB.open('proactive_co_creator_db_v2'); request.onsuccess = () => resolve(request.result); });
          try { const record = await new Promise(resolve => { const request = db.transaction('projects').objectStore('projects').get(id); request.onsuccess = () => resolve(request.result); }); return record?.snapshot?.storyBible?.genre?.value === 'Mystery'; }
          finally { db.close(); }
        }, undefined, { timeout: 8000 });
        await open('Review');
        await begin(start, 'narrative/diagnostics/analyze');
        await finish(1);
        await page.getByText('Current mock finding', { exact: true }).waitFor();
        await page.getByRole('button', { name: 'Suggest Fixes', exact: true }).click();
        await page.getByRole('heading', { name: 'Safe Fix Alternatives (Review Before Applying)' }).waitFor();
        const getAiFixes = page.getByRole('button', { name: 'Suggest AI Fixes', exact: true });
        if (!await getAiFixes.isEnabled()) throw new Error('AI fix request is disabled despite the fixture declaring diagnostics support.');
        await begin(() => getAiFixes.click(), 'narrative/diagnostics/suggest-fixes');
        await finish(2);
        await page.getByText('AI-generated suggestion', { exact: false }).waitFor();
        const beforeReview = await page.locator('[aria-label="Current project value"] pre').innerText();
        const suggested = await page.locator('[aria-label="Suggested change, not applied"] pre').innerText();
        if (beforeReview !== 'Mystery' || suggested !== 'Synthetic noir') {
          throw new Error('AI fix preview did not show the unchanged current value and proposed value: ' + JSON.stringify({ beforeReview, suggested }));
        }
        const beforeRecord = await page.evaluate(async () => {
          const id = localStorage.getItem('proactive_co_creator_active_id_v2');
          const db = await new Promise(resolve => { const request = indexedDB.open('proactive_co_creator_db_v2'); request.onsuccess = () => resolve(request.result); });
          try { return await new Promise(resolve => { const request = db.transaction('projects').objectStore('projects').get(id); request.onsuccess = () => resolve(request.result); }); }
          finally { db.close(); }
        });
        if (beforeRecord.snapshot.storyBible.genre.value !== 'Mystery') throw new Error('AI fix preview changed durable content before author acceptance.');
        await page.getByRole('button', { name: 'Accept this change', exact: true }).click();
        await page.waitForFunction(async () => {
          const id = localStorage.getItem('proactive_co_creator_active_id_v2');
          const db = await new Promise(resolve => { const request = indexedDB.open('proactive_co_creator_db_v2'); request.onsuccess = () => resolve(request.result); });
          try { const record = await new Promise(resolve => { const request = db.transaction('projects').objectStore('projects').get(id); request.onsuccess = () => resolve(request.result); }); return record?.snapshot?.storyBible?.genre?.value === 'Synthetic noir'; }
          finally { db.close(); }
        }, undefined, { timeout: 8000 });
        await page.getByRole('heading', { name: 'Safe Fix Alternatives (Review Before Applying)' }).waitFor({ state: 'hidden' });
        if (await page.getByRole('button', { name: 'Accept this change', exact: true }).count()) throw new Error('Accepted diagnostic fix remained actionable.');
        await open('Plan');
        await page.getByRole('tab', { name: 'Story Bible' }).click();
        if (await page.locator('#bible-genre').inputValue() !== 'Synthetic noir') throw new Error('Accepted diagnostic fix did not update the visible Story Bible value.');
        continue;
      }
      if (kind === 'batch') {
        await open('Plan');
        await page.getByRole('button', { name: /^Inbox/ }).click();
        await page.locator('#nl-batch-input').fill('The party should be mysterious.');
        await page.getByRole('button', { name: 'Preview', exact: true }).click();
        await page.getByRole('tab', { name: 'Story Bible' }).click();
        await page.locator('#bible-genre').fill('Mystery');
        const again = async () => {
          const button = page.getByRole('button', { name: 'Re-preview for Current Project' });
          if (!await button.isEnabled()) throw new Error('Re-preview for Current Project is disabled despite the fixture declaring batch-edit support.');
          await button.click();
        };
        for (const instruction of ['Transpose all emotional subtext', 'Find a novel dramatic structure']) {
          await page.locator('#nl-batch-input').fill(instruction);
          await begin(again, 'batch-edit');
        }
        await finish(2);
        await page.getByText('Current mock finding', { exact: true }).waitFor();
        await finish(1);
        if (!await page.getByText('Current mock finding', { exact: true }).isVisible()) {
          throw new Error('The stale request replaced the newest batch preview.');
        }
        continue;
      }
      if (kind === 'switch') {
        await page.getByRole('button', { name: 'Projects', exact: true }).click();
        await page.getByLabel('Project title').fill('Other project');
        await page.getByLabel('Starting idea').fill('An independent test project.');
        await page.getByRole('button', { name: 'Create project', exact: true }).click();
        await page.getByRole('combobox', { name: 'Current project' }).selectOption({ label: 'Cat’s Woodland Dinner Party' });
      }
      await open('Review');
      if (kind === 'pause') {
        await begin(() => page.getByRole('checkbox', { name: 'Enable bounded auto-analysis' }).check(), 'narrative/diagnostics/analyze');
        await page.getByRole('button', { name: 'Pause auto-analysis' }).click();
      } else {
        await begin(start, 'narrative/diagnostics/analyze');
        if (kind === 'edit' || kind === 'switch') {
          await open('Plan');
          if (kind === 'switch') {
            await page.getByRole('combobox', { name: 'Current project' }).selectOption({ label: 'Other project' });
          } else {
            await page.getByRole('tab', { name: 'Story Bible' }).click();
            await page.locator('#bible-genre').fill('A newer edit');
          }
          await open('Review');
        } else {
          await open('Plan');
          await open('Review');
          await begin(start, 'narrative/diagnostics/analyze');
          await finish(2);
          await page.getByText('Current mock finding', { exact: true }).waitFor();
        }
      }
      await finish(1);
      if (await page.getByText('Stale mock finding', { exact: true }).count()) {
        throw new Error('Stale semantic findings appeared in the current review.');
      }
    } catch (error) {
      failures.push(kind + ': ' + error.message + '\n' + JSON.stringify({
        url: page.url(), title: await page.title().catch(() => 'unavailable'),
        pageText: await page.locator('body').innerText().catch(() => 'unavailable'),
        rootState: await page.locator('#root').evaluate(root => ({ childCount: root.childElementCount, htmlLength: root.innerHTML.length, text: root.textContent?.slice(0, 1200) })).catch(() => 'unavailable'),
        expectedSyntheticOperationCapability: kind === 'batch' ? 'batch-edit' : 'diagnostics',
        browserEvidence,
      }, null, 2));
    } finally {
      scenarioEvidence.push({ kind, routeCalls: calls.length, ...browserEvidence });
      calls.forEach(call => call.finish());
      await context.close();
    }
  }
  if (failures.length) throw new Error(failures.join('\n'));
  return JSON.stringify({ status: 'AI_OWNERSHIP_PASS', scenarios: scenarioEvidence });
}
JS
output="$(playwright-cli -s="$session" run-code "$scenario" 2>&1)" || { echo "$output" >&2; exit 1; }
echo "$output"
[[ "$output" == *'AI_OWNERSHIP_PASS'* ]]
