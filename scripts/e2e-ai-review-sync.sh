#!/usr/bin/env bash
set -euo pipefail
base_url="${E2E_BASE_URL:-http://127.0.0.1:4337}"
session="pcc-ai04-debug-$$"
trap 'playwright-cli -s="$session" close >/dev/null 2>&1 || true' EXIT
playwright-cli -s="$session" open --browser=chromium "$base_url/api/health" >/dev/null
read -r -d '' scenario <<'JS' || true
async (bootstrap) => {
  const base = new URL(bootstrap.url()).origin;
  const context = await bootstrap.context().browser().newContext();
  const page = await context.newPage();
  const calls = [];
  await context.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/capabilities')) return route.fulfill({ json: { configured: true } });
    if (path.endsWith('/provider-hub/status')) return route.fulfill({ json: {
      localPersonalConnectionsAvailable: true, capabilityPolicyVersion: 'synthetic',
      credentialAuthorityIds: { 'gemini-managed': 'synthetic', 'gemini-personal': 'synthetic', 'openai-api': 'synthetic', 'chatgpt-plan': 'synthetic' },
      preferences: { defaultConnectionId: 'openai-api', defaultTextModelId: 'gpt-6.2-sol', defaultReasoningLevel: 'default' },
      connections: [{ id: 'openai-api', state: 'connected', selectedModelId: 'gpt-6.2-sol', models: [{
        id: 'gpt-6.2-sol', availability: { state: 'supported' }, textGeneration: { state: 'supported' }, reasoning: { state: 'supported', value: ['default'] },
        operationCapabilities: { diagnostics: { state: 'supported', value: true }, sync: { state: 'supported', value: true } },
      }] }],
    } });
    if (path.endsWith('/sync/analyze')) {
      calls.push(route.request().postDataJSON());
      return route.fulfill({ json: { direction: 'model-to-manuscript', coverageNote: 'Synthetic coverage is complete.', modelProposals: [], manuscriptPatches: [{
        id: 'patch-lantern', sectionId: 'debug-scene', sectionTitle: 'Synthetic Scene', rationale: 'Aligns with confirmed model detail.',
        linkedModelChange: 'Confirmed lantern detail', originalExcerpt: 'raised the lantern', proposedExcerpt: 'lifted the silver lantern',
      }] } });
    }
    if (path.endsWith('/health')) return route.continue();
    throw new Error('Unexpected API path ' + path);
  });
  try {
    await page.goto(base + '/api/health');
    await page.evaluate(async () => {
      const { createSampleProject, setEntityAttribute } = await import('/lib/canonicalModel.ts');
      const { createUndoRedoState } = await import('/lib/historyEngine.ts');
      const { narrativeBase, prepareManuscriptChange } = await import('/lib/narrative/manuscriptModel.ts');
      const { persistProjectDurably } = await import('/lib/storageEngine.ts');
      const project = createSampleProject(1700000000000);
      project.id = 'ai04-debug-sync'; project.name = 'AI-04 Synthetic Sync Project'; project.revision = 4; project.persistedRevision = 4;
      project.snapshot.entities = [project.snapshot.entities[0]]; project.snapshot.relationships = [];
      project.snapshot = setEntityAttribute(project.snapshot, project.snapshot.entities[0].id || project.snapshot.entities[0].name, 'confirmed-age', '40', 'user-edit');
      const prepared = prepareManuscriptChange(project, createUndoRedoState(project.snapshot), narrativeBase(project), [
        { id: 'debug-scene', kind: 'scene', title: 'Synthetic Scene', text: 'At dawn Mara raised the lantern.' },
      ]);
      const saved = await persistProjectDurably(prepared.project);
      if (!saved.saved) throw new Error(saved.error);
    });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.getByRole('navigation', { name: 'Narrative workspace' }).getByRole('button', { name: 'Review', exact: true }).click();
    await page.getByRole('heading', { name: 'Review & Diagnostics' }).waitFor();
    await page.getByRole('radio', { name: /Model → Manuscript/ }).check();
    await page.getByRole('button', { name: 'Generate Scoped Manuscript Patches' }).click();
    await page.getByText('Synthetic coverage is complete.', { exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Synthetic Scene · Confirmed lantern detail' }).waitFor();
    await page.getByText('Exact match verified', { exact: true }).waitFor();
    const before = await page.evaluate(async () => {
      const db = await new Promise(resolve => { const r = indexedDB.open('proactive_co_creator_db_v2'); r.onsuccess = () => resolve(r.result); });
      try { return await new Promise(resolve => { const r = db.transaction('projects').objectStore('projects').get('ai04-debug-sync'); r.onsuccess = () => resolve(r.result); }); }
      finally { db.close(); }
    });
    const beforeCurrentVersion = before.narrative.versions.find(version => version.id === before.snapshot.manuscriptVersionId);
    const beforeCurrentSection = before.narrative.sectionVersions.find(item => beforeCurrentVersion.sectionVersionIds.includes(item.id) && item.section.id === 'debug-scene').section;
    if (beforeCurrentSection.text !== 'At dawn Mara raised the lantern.') throw new Error('Patch changed the manuscript before explicit acceptance.');
    const reviewTextBefore = await page.locator('main').filter({ has: page.getByRole('heading', { name: 'Review & Diagnostics' }) }).innerText();
    if (!reviewTextBefore.includes('Exact match verified') || !reviewTextBefore.includes('Original excerpt') || !reviewTextBefore.includes('Proposed patch')) throw new Error('Patch proposal was not reviewable before application.');
    await page.getByRole('button', { name: 'Apply Scoped Manuscript Patch' }).click();
    await page.waitForFunction(async () => {
      const db = await new Promise(resolve => { const r = indexedDB.open('proactive_co_creator_db_v2'); r.onsuccess = () => resolve(r.result); });
      try {
        const record = await new Promise(resolve => { const r = db.transaction('projects').objectStore('projects').get('ai04-debug-sync'); r.onsuccess = () => resolve(r.result); });
        const current = record?.narrative?.versions.find(version => version.id === record.snapshot.manuscriptVersionId);
        return current?.sectionVersionIds.some(id => record.narrative.sectionVersions.some(item => item.id === id && item.section.id === 'debug-scene' && item.section.text === 'At dawn Mara lifted the silver lantern.')) === true;
      } finally { db.close(); }
    }, undefined, { timeout: 8000 });
    await page.getByRole('alert').filter({ hasText: 'Project or manuscript content changed since sync ran' }).waitFor();
    const after = await page.evaluate(async () => {
      const db = await new Promise(resolve => { const r = indexedDB.open('proactive_co_creator_db_v2'); r.onsuccess = () => resolve(r.result); });
      try { return await new Promise(resolve => { const r = db.transaction('projects').objectStore('projects').get('ai04-debug-sync'); r.onsuccess = () => resolve(r.result); }); }
      finally { db.close(); }
    });
    const afterCurrentVersion = after.narrative.versions.find(version => version.id === after.snapshot.manuscriptVersionId);
    const afterCurrentSection = after.narrative.sectionVersions.find(item => afterCurrentVersion.sectionVersionIds.includes(item.id) && item.section.id === 'debug-scene').section;
    const confirmedAge = after.snapshot.entities[0].attributes.find(attribute => attribute.name === 'confirmed-age')?.confirmedValue;
    if (confirmedAge !== '40') throw new Error('Confirmed model fact changed during manuscript patch application.');
    if (calls.length !== 1 || calls[0]?.direction !== 'model-to-manuscript') throw new Error('Unexpected sync transport count: ' + JSON.stringify(calls));
    const staleGuardDisabled = await page.getByRole('button', { name: 'Apply Scoped Manuscript Patch' }).isDisabled();
    if (beforeCurrentSection.text === afterCurrentSection.text || !staleGuardDisabled) throw new Error('Explicit patch application or stale proposal guard did not complete.');
    return JSON.stringify({ result: 'AI04_SYNC_PATCH_PASS', calls: calls.map(call => call.direction), beforeText: beforeCurrentSection.text, afterText: afterCurrentSection.text, beforeRevision: before.revision, afterRevision: after.revision, confirmedAge, staleGuardDisabled });
  } finally { await context.close(); }
}
JS
playwright-cli -s="$session" run-code "$scenario"
