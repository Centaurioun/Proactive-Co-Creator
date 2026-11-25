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
  for (const kind of ['switch', 'edit', 'pause', 'supersede', 'batch']) {
    const context = await bootstrap.context().browser().newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    const calls = [];
    const open = (name) => page.getByRole('navigation', { name: 'Narrative workspace' })
      .getByRole('button', { name, exact: true }).click();
    const start = () => page.getByRole('button', { name: 'Analyze Consistency with AI' }).click();
    await context.addInitScript(() => {
      const fetchReal = window.fetch.bind(window);
      window.completedMockCalls = [];
      window.fetch = async (url, options) => {
        if (!String(url).match(/\/(diagnostics\/analyze|batch-edit)$/)) return fetchReal(url, options);
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
      if (!path.match(/\/(diagnostics\/analyze|batch-edit)$/)) throw new Error('Unexpected API route ' + path);
      const id = calls.length + 1;
      await new Promise(resolve => calls.push({ finish: resolve }));
      const title = id === 1 ? 'Stale mock finding' : 'Current mock finding';
      const json = kind === 'batch'
        ? { mockCall: id, instruction: route.request().postDataJSON().instruction, operations: [],
            ambiguities: [{ clarifyingQuestion: title, candidates: [] }], warnings: [], coverageComplete: true }
        : { mockCall: id, coverageNote: 'Mock diagnostics', findings: [{
            title, description: 'Synthetic continuity issue', category: 'continuity', severity: 'warning',
            certainty: 'possible', targetKind: 'story_bible', storyField: 'genre',
          }] };
      await route.fulfill({ json });
    });
    const begin = async (action, path) => {
      const requested = page.waitForRequest('**/api/' + path, { timeout: 6500 });
      await action();
      await requested;
    };
    const finish = async (id) => {
      calls[id - 1].finish();
      await page.waitForFunction(id => window.completedMockCalls.includes(id), id);
    };
    try {
      await page.goto(base, { waitUntil: 'networkidle' });
      if (kind === 'batch') {
        await page.locator('#nl-batch-input').fill('The party should be mysterious.');
        await page.getByRole('button', { name: 'Preview', exact: true }).click();
        await page.getByRole('tab', { name: 'Story Bible' }).click();
        await page.locator('#bible-genre').fill('Mystery');
        const again = () => page.getByRole('button', { name: 'Re-preview for Current Project' }).click();
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
        await page.getByRole('tab', { name: 'History' }).click();
        await page.getByLabel('New project title').fill('Other project');
        await page.getByLabel('New project initial prompt').fill('An independent test project.');
        await page.getByRole('button', { name: 'Create Project' }).click();
        await page.getByRole('button', { name: /^Cat.s Woodland Dinner Party/ }).click();
      }
      await open('Review');
      if (kind === 'pause') {
        await begin(() => page.getByRole('checkbox', { name: 'Enable bounded auto-analysis' }).check(), 'narrative/diagnostics/analyze');
        await page.getByRole('button', { name: 'Pause auto-analysis' }).click();
      } else {
        await begin(start, 'narrative/diagnostics/analyze');
        if (kind === 'edit' || kind === 'switch') {
          await open('Plan');
          await page.getByRole('tab', { name: kind === 'edit' ? 'Story Bible' : 'History' }).click();
          if (kind === 'edit') await page.locator('#bible-genre').fill('A newer edit');
          else await page.getByRole('button', { name: /^Other project/ }).click();
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
      failures.push(kind + ': ' + error.message);
    } finally {
      calls.forEach(call => call.finish());
      await context.close();
    }
  }
  if (failures.length) throw new Error(failures.join('\n'));
  return 'AI_OWNERSHIP_PASS';
}
JS
output="$(playwright-cli -s="$session" run-code "$scenario" 2>&1)" || { echo "$output" >&2; exit 1; }
echo "$output"
[[ "$output" == *'"AI_OWNERSHIP_PASS"'* ]]
