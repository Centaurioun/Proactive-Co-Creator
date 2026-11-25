#!/usr/bin/env bash
set -euo pipefail

base_url="${E2E_BASE_URL:-http://127.0.0.1:3000}"
curl -fsS "$base_url/api/health" | grep -q '"configured":false'
mkdir -p .playwright-cli
trap 'playwright-cli -s=pcc-narrative close >/dev/null 2>&1 || true' EXIT
playwright-cli -s=pcc-narrative open --browser=chromium "$base_url"
read -r -d '' scenario <<'JS' || true
async (page) => {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  const apiCalls = [];
  const paidApiCalls = [];
  await context.route('**/api/**', async route => {
    const url = route.request().url();
    apiCalls.push(url);
    if (!url.endsWith('/api/ai/capabilities')) paidApiCalls.push(url);
    await route.abort();
  });
  const first = await context.newPage();
  first.on('pageerror', error => errors.push(error.message));
  const base = '__BASE_URL__';
  const mode = (p, name) => p.getByRole('navigation', { name: 'Narrative workspace' }).getByRole('button', { name, exact: true });
  const editor = (p) => p.locator('textarea').first();
  const saved = async (p) => {
    await p.getByText('Saved', { exact: true }).waitFor();
    assert(await p.getByRole('button', { name: 'Save manuscript' }).isDisabled(), 'Save action still dirty');
  };
  const activeRecord = (p) => p.evaluate(() => {
    const id = localStorage.getItem('proactive_co_creator_active_id_v2');
    const map = JSON.parse(localStorage.getItem('proactive_co_creator_projects_v2') || '{}');
    return map[id] || Object.values(map)[0];
  });
  try {
    await first.goto(base, { waitUntil: 'networkidle' });
    const legacy = await activeRecord(first);
    assert(legacy.schemaVersion === 3, 'Fixture should start on schema 3');
    legacy.artifacts = [{
      id: 'mock-generated-story', projectId: legacy.id, mode: 'story', createdAt: 100,
      revisionId: legacy.revisions[0].id, promptUsed: 'Synthetic fixture', storyText: 'Özgün çıktı 🦉',
      isOutdated: false,
    }];
    await mode(first, 'Plan').click();
    await first.getByRole('tab', { name: 'History' }).click();
    await first.getByRole('textbox', { name: 'Paste project JSON' }).fill(JSON.stringify(legacy));
    await first.getByRole('button', { name: 'Preview JSON' }).click();
    await first.getByRole('button', { name: 'Restore a copy' }).click();
    await first.waitForFunction(() => document.querySelector('nav[aria-label="Narrative workspace"] button[aria-current="page"]')?.textContent === 'Write');
    await mode(first, 'Write').click();
    await editor(first).dispatchEvent('compositionstart');
    await editor(first).fill('İpek 🦉 é');
    await first.waitForTimeout(1050);
    assert(await first.getByText('Unsaved draft', { exact: true }).isVisible(), 'Composition persisted before commit');
    await editor(first).dispatchEvent('compositionend');
    await saved(first);
    await first.getByRole('textbox', { name: 'Scene title (optional)' }).fill('First scene');
    await first.getByRole('button', { name: 'Add scene', exact: true }).click();
    await editor(first).fill('Second scene');
    await first.getByRole('button', { name: 'Move up', exact: true }).click();
    await saved(first);
    await first.getByRole('button', { name: 'Adopt generated story' }).click();
    await first.getByRole('button', { name: 'Preview full story' }).click();
    await first.getByRole('button', { name: 'Apply adoption' }).click();
    await saved(first);

    const durable = await activeRecord(first);
    assert(durable.schemaVersion === 4, 'Manuscript schema was not committed');
    assert(durable.artifacts[0].storyText === legacy.artifacts[0].storyText, 'Original artifact changed');
    const sections = (project) => project.narrative.versions.find(version => version.id === project.snapshot.manuscriptVersionId)
      .sectionVersionIds.map(id => project.narrative.sectionVersions.find(record => record.id === id).section);
    assert(sections(durable).map(section => section.text).join('|') === 'Second scene|İpek 🦉 é|Özgün çıktı 🦉', 'Unexpected outline order or Unicode content');
    await first.reload({ waitUntil: 'networkidle' });
    await mode(first, 'Write').click();
    await saved(first);
    assert(await editor(first).inputValue() === 'Second scene', 'Manuscript missing after reload');
    await first.getByRole('button', { name: 'Undo', exact: true }).click();
    await saved(first);
    await first.getByRole('button', { name: 'Redo', exact: true }).click();
    await saved(first);

    for (const width of [320, 390, 768, 1280, 1440]) {
      await first.setViewportSize({ width, height: 900 });
      assert(await editor(first).isVisible(), 'Editor unavailable at ' + width);
      assert(await first.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Horizontal overflow at ' + width);
      if (width < 1024) {
        const outlineToggle = first.getByRole('button', { name: 'Show outline' });
        assert(await outlineToggle.isVisible(), 'Mobile outline toggle missing at ' + width);
        if (width === 320) await first.screenshot({ path: '.playwright-cli/phase-01-write-320.png', fullPage: false });
        assert((await editor(first).boundingBox()).y < 800, 'Outline displaced the editor at ' + width);
      }
      if (width === 390 || width === 1440) {
        await first.screenshot({ path: '.playwright-cli/phase-01-write-' + width + '.png', fullPage: false });
      }
    }

    await first.getByRole('banner').getByRole('button', { name: 'Projects', exact: true }).click();
    await first.getByRole('button', { name: 'Create Backup' }).click();
    await first.getByText('Verified project backup created.', { exact: true }).waitFor();
    await first.getByRole('listitem').filter({ hasText: 'Manual backup' }).getByRole('button', { name: 'Preview restore' }).click();
    await first.getByRole('button', { name: 'Restore project copy' }).click();
    await first.getByText(/Restored and saved project copy/).waitFor();
    await mode(first, 'Write').click();
    await saved(first);
    assert(await editor(first).inputValue() === 'Second scene', 'Restored copy lost manuscript');

    // Replace only the selected project after checkpoint readback and an explicit confirmation.
    await first.getByRole('banner').getByRole('button', { name: 'Projects', exact: true }).click();
    await first.getByRole('button', { name: 'Create Backup' }).click();
    await first.getByText('Verified project backup created.', { exact: true }).waitFor();
    await mode(first, 'Write').click();
    await editor(first).fill('Text before replacement');
    await saved(first);
    await first.getByRole('banner').getByRole('button', { name: 'Projects', exact: true }).click();
    await first.getByRole('button', { name: 'Preview restore' }).click();
    first.once('dialog', dialog => dialog.accept());
    await first.getByRole('button', { name: 'Replace current project' }).click();
    await first.getByText('Project replaced after saving a verified safety checkpoint.').waitFor();
    await first.getByText('Before replacing project from backup', { exact: false }).waitFor();
    await mode(first, 'Write').click();
    await saved(first);
    assert(await editor(first).inputValue() === 'Second scene', 'Replacement lost backup manuscript');

    // Two real IndexedDB writers in the same origin, with independently captured bases.
    const second = await context.newPage();
    second.on('pageerror', error => errors.push(error.message));
    await second.goto(base, { waitUntil: 'networkidle' });
    await mode(second, 'Write').click();
    await saved(second);
    await editor(second).dispatchEvent('compositionstart');
    await editor(second).fill('Stale draft 🦉');
    await editor(first).fill('First writer’s durable text');
    await saved(first);
    await editor(second).dispatchEvent('compositionend');
    await second.getByText('Unsaved draft', { exact: true }).waitFor();
    await second.getByRole('button', { name: 'Export draft' }).waitFor();
    await second.getByRole('alert').first().waitFor({ timeout: 5000 });
    assert(await editor(second).inputValue() === 'Stale draft 🦉', 'Conflicting draft was dropped');
    assert(await editor(first).inputValue() === 'First writer’s durable text', 'Winner changed');

    // Fault injection at the project put, after preparation and CAS read.
    await first.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      window.restoreNarrativePut = () => { IDBObjectStore.prototype.put = put; };
      IDBObjectStore.prototype.put = function (...args) {
        if (this.name === 'projects' && args[0]?.schemaVersion === 4) {
          throw new DOMException('Synthetic write quota', 'QuotaExceededError');
        }
        return put.apply(this, args);
      };
    });
    await editor(first).fill('Retryable draft');
    await first.getByText('Unsaved draft', { exact: true }).waitFor();
    await first.getByText(/Synthetic write quota|IndexedDB.*failed|manuscript could not be saved/i).first().waitFor({ timeout: 5000 });
    assert(await editor(first).inputValue() === 'Retryable draft', 'Quota failure dropped the draft');
    const after = await first.evaluate(async (id) => {
      const request = indexedDB.open('proactive_co_creator_db_v2');
      const db = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const read = db.transaction('projects').objectStore('projects').get(id);
        return await new Promise((resolve, reject) => {
          read.onsuccess = () => resolve(read.result);
          read.onerror = () => reject(read.error);
        });
      } finally {
        db.close();
      }
    }, (await activeRecord(first)).id);
    assert(sections(after)[0].text === 'First writer’s durable text', 'Quota failure changed committed text');
    await first.evaluate(() => window.restoreNarrativePut());
    await first.getByRole('button', { name: 'Save manuscript' }).click();
    await saved(first);
    assert(sections(await activeRecord(first))[0].text === 'Retryable draft', 'Retry did not commit the retained draft');

    assert(errors.length === 0, 'Unexpected browser errors: ' + errors.join(', '));
    assert(paidApiCalls.length === 0, 'Unexpected paid AI/API requests: ' + paidApiCalls.join(', '));
    return 'NARRATIVE_WORKSPACE_PASS';
  } finally {
    await context.close();
  }
}
JS
scenario="${scenario//__BASE_URL__/$base_url}"
output="$(playwright-cli -s=pcc-narrative run-code "$scenario" 2>&1)" || { echo "$output"; exit 1; }
if ! grep -Eq '^"?NARRATIVE_WORKSPACE_PASS"?[[:space:]]*$' <<< "$output"; then
  echo "$output"
  exit 1
fi
echo 'NARRATIVE_WORKSPACE_PASS'
