#!/usr/bin/env bash
set -euo pipefail

base_url="${E2E_BASE_URL:-http://127.0.0.1:3000}"
curl -fsS "$base_url/api/health" | grep -q '"configured":false'
session="pcc-stage2-$$"
trap 'playwright-cli -s="$session" close >/dev/null 2>&1 || true' EXIT
playwright-cli -s="$session" open --browser=chromium "$base_url/api/health" >/dev/null

read -r -d '' scenario <<'JS' || true
async (bootstrap) => {
  const base = new URL(bootstrap.url()).origin;
  const context = await bootstrap.context().browser().newContext();
  const quote = 'Ada is a cartographer.';
  const title = 'Tighten the opening';
  let enhancementCalls = 0;
  let releaseLate;
  const waitForLate = new Promise(resolve => { releaseLate = resolve; });
  const json = (route, body) => route.fulfill({ json: body });
  await context.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/ai/capabilities') return json(route, { configured: true });
    if (path === '/api/ai/provider-hub/status') {
      return json(route, {
        localPersonalConnectionsAvailable: false,
        capabilityPolicyVersion: 'cap-v1',
        credentialAuthorityIds: {
          'gemini-managed': 'auth-managed',
          'gemini-personal': 'auth-personal',
          'chatgpt-plan': 'auth-chatgpt',
          'openai-api': 'auth-openai',
        },
        connections: [{
          id: 'gemini-managed',
          family: 'gemini',
          billing: 'host-managed-gemini',
          state: 'available',
          selectedModelId: 'gemini-2.5-flash',
          models: [{
            id: 'gemini-2.5-flash',
            displayName: 'Gemini 2.5 Flash',
            availability: { state: 'supported', value: true, evidence: [] },
            textGeneration: { state: 'supported', value: true, evidence: [] },
            imageGeneration: { state: 'unsupported', evidence: [] },
            structuredOutput: { state: 'supported', value: true, evidence: [] },
            contextLimit: { state: 'supported', value: 8000, evidence: [] },
            outputLimit: { state: 'supported', value: 4096, evidence: [] },
            reasoning: { state: 'supported', value: ['default'], evidence: [] },
            operationCapabilities: { 'narrative-import': { state: 'supported', value: true, evidence: [] } },
            capabilityPolicyVersion: 'cap-v1',
          }],
        }],
        preferences: { defaultConnectionId: 'gemini-managed' },
        usage: { observedByConnection: {}, quota: { state: 'unknown' } },
      });
    }
    if (path === '/api/narrative/import/extract') {
      return json(route, { extraction: { entities: [], relationships: [], findings: [], ambiguities: [] } });
    }
    if (path === '/api/narrative/import/enhance') {
      const call = ++enhancementCalls;
      if (call === 2) await waitForLate;
      if (call === 2) {
        await json(route, { proposals: [{
          id: 'late', title: 'Late enhancement', category: 'pacing', rationale: 'A late mock response.',
          beforeExcerpt: quote, afterExcerpt: 'Ada mapped the coast.', assumptions: [],
        }], coverageNote: 'Synthetic source' }).catch(() => {});
        return;
      }
      return json(route, { proposals: [{
        id: 'opening', title, category: 'pacing', rationale: 'Give Ada an action.',
        beforeExcerpt: quote, afterExcerpt: 'Ada mapped the coast.', assumptions: [],
      }], coverageNote: 'Synthetic source' });
    }
    throw new Error('Unexpected API request: ' + path);
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const openImport = async (sourceText = quote) => {
    await page.getByRole('banner').getByRole('button', { name: 'Import', exact: true }).click();
    await page.getByRole('textbox', { name: 'Or paste narrative text' }).fill(sourceText);
    await page.getByRole('button', { name: 'Inspect source', exact: true }).click();
    await page.getByRole('radio', { name: /Faithful import with optional enhancements/ }).check();
    await page.getByRole('button', { name: 'Analyze source' }).click();
    await page.getByText(/All planned source segments were analyzed/).waitFor();
  };
  const generate = () => page.getByRole('button', { name: 'Generate Enhancement Proposals' });
  try {
    await page.goto(base);
    if (!await page.evaluate(() => Boolean(document.querySelector('script[src="/@vite/client"]')))) {
      throw new Error('Run against the development server to exercise StrictMode effect replay.');
    }
    await openImport();
    const firstRequest = page.waitForRequest('**/api/narrative/import/enhance', { timeout: 3000 });
    await generate().click();
    await firstRequest;
    const proposal = page.getByRole('checkbox', { name: new RegExp(title) });
    await proposal.check();
    if (!await proposal.isChecked()) throw new Error('The enhancement could not be approved.');

    const secondRequest = page.waitForRequest('**/api/narrative/import/enhance');
    await generate().click();
    await secondRequest;
    await page.getByRole('navigation', { name: 'Narrative workspace' }).getByRole('button', { name: 'Plan' }).click();
    await page.getByRole('button', { name: 'Exit import', exact: true }).waitFor({ state: 'hidden' });
    releaseLate();
    await openImport('Ada mapped the coast.');
    if (await page.getByRole('checkbox', { name: /Late enhancement/ }).count()) {
      throw new Error('An enhancement from the unmounted workflow reached the replacement workflow.');
    }
    if (enhancementCalls !== 2 || pageErrors.length) throw new Error(JSON.stringify({ enhancementCalls, pageErrors }));
    return 'STAGE2_STRICT_MODE_PASS';
  } finally {
    releaseLate();
    await context.close();
  }
}
JS
output="$(playwright-cli -s="$session" run-code "$scenario" 2>&1)" || { echo "$output" >&2; exit 1; }
echo "$output"
[[ "$output" == *STAGE2_STRICT_MODE_PASS* ]]
