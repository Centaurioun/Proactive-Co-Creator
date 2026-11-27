#!/usr/bin/env bash
set -euo pipefail

base_url="${E2E_BASE_URL:-http://127.0.0.1:3000}"
curl -fsS "$base_url/api/health" | grep -q '"configured":false'
session="pcc-project-lifecycle-$$"
trap 'playwright-cli -s="$session" close >/dev/null 2>&1 || true' EXIT
playwright-cli -s="$session" open --browser=chromium "$base_url/api/health" >/dev/null

read -r -d '' scenario <<'JS' || true
async (bootstrap) => {
  const base = new URL(bootstrap.url()).origin;
  const failures = [];
  for (const kind of ['delete', 'append', 'archive', 'backup-retry', 'write-recovery']) {
    const context = await bootstrap.context().browser().newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    const projectHub = () => page.getByRole('banner').getByRole('button', { name: 'Projects', exact: true }).click();
    const open = (name) => name === 'Projects' ? projectHub() : page.getByRole('navigation', { name: 'Narrative workspace' })
      .getByRole('button', { name, exact: true }).click();
    const history = async () => {
      await projectHub();
      await page.getByRole('navigation', { name: 'Project workspace sections' })
        .getByRole('button', { name: 'Revision history', exact: true }).click();
    };
    const create = async (name) => {
      await projectHub();
      const projectSection = page.getByRole('navigation', { name: 'Project workspace sections' });
      if (await projectSection.getByRole('button', { name: 'Projects', exact: true }).count()) {
        await projectSection.getByRole('button', { name: 'Projects', exact: true }).click();
      }
      await page.locator('#new-project-title').fill(name);
      await page.locator('#new-project-idea').fill('Synthetic fixture');
      await page.getByRole('button', { name: 'Create project', exact: true }).click();
      await page.getByRole('combobox', { name: 'Current project' }).selectOption({ label: name });
    };
    await context.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/health') return route.continue();
      if (path === '/api/ai/capabilities') return route.fulfill({ json: { configured: true } });
      if (path === '/api/ai/provider-hub/status') return route.fulfill({ json: {
        capabilityPolicyVersion: 'qa-synthetic-policy-v1',
        credentialAuthorityIds: { 'gemini-managed': 'qa-synthetic-authority' },
        connections: [{ id: 'gemini-managed', selectedModelId: 'qa-synthetic-model', models: [{ id: 'qa-synthetic-model', operationCapabilities: {} }] }],
      } });
      if (path === '/api/narrative/import/extract') {
        return route.fulfill({ json: { extraction: { entities: [], relationships: [], findings: [], ambiguities: [] } } });
      }
      throw new Error('Unexpected API path ' + path);
    });
    try {
      if (kind === 'backup-retry') {
        await page.goto(base + '/api/health');
        await page.evaluate(async () => {
          const { createSampleProject } = await import('/lib/canonicalModel.ts');
          const { persistProjectDurably } = await import('/lib/storageEngine.ts');
          const project = {
            ...createSampleProject(1700000000000), id: 'backup-retry-fixture', revision: 5, persistedRevision: 5,
          };
          if (!(await persistProjectDurably(project)).saved) throw new Error('Synthetic backup project could not be created.');
        });
        await context.addInitScript(() => {
          const save = Storage.prototype.setItem;
          Storage.prototype.setItem = function (key, value) {
            if (key.startsWith('pcc-narrative-backup:') && !window.failedAutoBackup) {
              window.failedAutoBackup = true;
              throw new DOMException('Synthetic auto-backup quota', 'QuotaExceededError');
            }
            return save.call(this, key, value);
          };
        });
      }
      await page.goto(base, { waitUntil: 'networkidle' });
      if (kind === 'write-recovery') {
        const editor = page.getByPlaceholder('Start writing here…');
        const saved = () => page.getByText('Saved', { exact: true }).waitFor();
        const write = async (text) => {
          await editor.fill(text);
          await page.getByRole('button', { name: 'Save manuscript', exact: true }).click();
          await saved();
        };
        await open('Write');
        await write('First verified manuscript line.');
        await page.reload({ waitUntil: 'networkidle' });
        await open('Write');
        await saved();
        if (await editor.inputValue() !== 'First verified manuscript line.') throw new Error('Schema 4 manuscript did not reload.');
        await open('Projects');
        await page.getByRole('navigation', { name: 'Project workspace sections' }).getByRole('button', { name: 'Backup & export', exact: true }).click();
        await page.getByRole('button', { name: 'Create Backup', exact: true }).click();
        await page.getByText('Verified project backup created.', { exact: true }).waitFor();
        await open('Write');
        await write('Text added after the backup.');
        await open('Projects');
        await page.getByRole('navigation', { name: 'Project workspace sections' }).getByRole('button', { name: 'Backup & export', exact: true }).click();
        await page.getByRole('listitem').filter({ hasText: 'Manual backup' }).getByRole('button', { name: 'Preview restore' }).click();
        page.once('dialog', dialog => dialog.accept());
        await page.getByRole('button', { name: 'Review replacement confirmation', exact: true }).click();
        await page.getByText('Project replaced after saving a verified safety checkpoint.', { exact: true }).waitFor();
        await open('Write');
        await saved();
        if (await editor.inputValue() !== 'First verified manuscript line.') throw new Error('Verified replacement changed the backup manuscript.');
      } else if (kind === 'backup-retry') {
        await open('Projects');
        await page.getByRole('navigation', { name: 'Project workspace sections' }).getByRole('button', { name: 'Backup & export', exact: true }).click();
        const backup = page.getByRole('checkbox', { name: /create a verified browser backup automatically/ });
        await backup.check();
        await page.waitForFunction(() => window.failedAutoBackup);
        await backup.uncheck();
        await backup.check();
        await page.waitForFunction(() => Object.keys(localStorage).some(key => key.startsWith('pcc-narrative-backup:') &&
          JSON.parse(localStorage.getItem(key)).revision === 5), null, { timeout: 2000 });
      } else if (kind === 'delete') {
        await history();
        await create('Doomed project');
        await page.getByRole('combobox', { name: 'Current project' }).selectOption({ label: 'Cat’s Woodland Dinner Party' });
        await open('Plan');
        await page.getByRole('tab', { name: 'History' }).click();
        await page.evaluate(() => {
          const deleteOriginal = IDBObjectStore.prototype.delete;
          IDBObjectStore.prototype.delete = function (...args) {
            const tx = this.transaction;
            const oncomplete = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete');
            Object.defineProperty(tx, 'oncomplete', {
              set(callback) {
                oncomplete.set.call(tx, event => {
                  window.releaseDeletion = () => callback.call(tx, event);
                });
              },
            });
            IDBObjectStore.prototype.delete = deleteOriginal;
            return deleteOriginal.apply(this, args);
          };
        });
        let deletionConfirmation = '';
        page.once('dialog', async (dialog) => {
          deletionConfirmation = dialog.message();
          await dialog.accept();
        });
        await page.getByRole('button', { name: 'Delete project Doomed project' }).click();
        if (!deletionConfirmation.includes('Doomed project')) throw new Error('Project deletion did not request confirmation.');
        await page.waitForFunction(() => Boolean(window.releaseDeletion));
        await create('Created during deletion');
        await page.waitForFunction(() => Object.values(JSON.parse(localStorage.getItem('proactive_co_creator_projects_v2') || '{}'))
          .some(project => project.name === 'Created during deletion'));
        await page.getByRole('combobox', { name: 'Current project' }).selectOption({ label: 'Created during deletion' });
        await page.evaluate(() => { window.releaseDeletion(); });
        await page.getByText(/Deleted project from localStorage and IndexedDB|Incomplete deletion warning/).first().waitFor();
        if (!(await page.getByRole('combobox', { name: 'Current project' }).locator('option').allTextContents()).includes('Created during deletion')) {
          throw new Error('Deletion completion dropped the project created while it was pending.');
        }
      } else if (kind === 'append') {
        await page.getByRole('button', { name: 'Import', exact: true }).click();
        await page.getByRole('textbox', { name: 'Or paste narrative text' }).fill('Ada walked along the river.');
        await page.getByRole('button', { name: 'Inspect source' }).click();
        await page.getByText('Source inspected', { exact: true }).waitFor();
        await page.getByRole('button', { name: 'Analyze source', exact: true }).click();
        await page.getByText(/All planned source segments were analyzed/).waitFor();
        await page.getByRole('radio', { name: 'Append to an existing project' }).check();
        const writer = await context.newPage();
        await writer.goto(base + '/api/health');
        await writer.evaluate(async () => {
          const { loadProjectsFromIndexedDb, persistProjectDurably } = await import('/lib/storageEngine.ts');
          const { recordProjectRevision } = await import('/lib/historyEngine.ts');
          const [original] = await loadProjectsFromIndexedDb();
          const changed = recordProjectRevision({ ...original, name: 'Changed append target' }, 'Other tab edit', 'Changed the title.');
          if (!(await persistProjectDurably(changed)).saved) throw new Error('Cross-tab fixture write failed.');
        });
        await writer.close();
        await page.getByRole('button', { name: 'Reload Latest from Storage' }).click();
        await page.getByText(/Changed append target/).first().waitFor({ state: 'attached' });
        const append = page.getByRole('button', { name: /Append.*Changed append target/ });
        const reviewUpdated = page.getByRole('button', { name: 'Review updated target' });
        if (!await append.isDisabled() || !await reviewUpdated.isVisible()) {
          throw new Error('Append became eligible against a changed target without renewed review.');
        }
        await reviewUpdated.click();
        await append.click();
        await page.getByText(/Appended 1 section\(s\) into "Changed append target"/).waitFor();
      } else {
        const archive = await page.evaluate(async () => {
          const { createSampleProject } = await import('/lib/canonicalModel.ts');
          const { buildAllProjectsArchiveZip } = await import('/lib/narrative/recovery/allProjectsArchive.ts');
          const projects = ['A', 'B'].map(name => ({ ...createSampleProject(1700000000000), id: 'archive-' + name, name: 'Archived ' + name }));
          const { bytes } = await buildAllProjectsArchiveZip(projects);
          return Array.from(bytes);
        });
        await open('Projects');
        await page.getByRole('navigation', { name: 'Project workspace sections' }).getByRole('button', { name: 'Backup & export', exact: true }).click();
        await page.locator('#all-projects-archive-input').setInputFiles({
          name: 'fixture.zip', mimeType: 'application/zip', buffer: Buffer.from(archive),
        });
        await page.evaluate(() => {
          const putOriginal = IDBObjectStore.prototype.put;
          IDBObjectStore.prototype.put = function (value, ...args) {
            if (this.name === 'projects' && value.id === 'archive-B') {
              IDBObjectStore.prototype.put = putOriginal;
              window.archiveFailureReady = true;
              throw new Error('Synthetic failure after the first archive write');
            }
            if (this.name === 'projects' && value.id === 'archive-A') {
              const tx = this.transaction;
              const oncomplete = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete');
              Object.defineProperty(tx, 'oncomplete', {
                set(callback) {
                  oncomplete.set.call(tx, event => {
                    window.releaseArchive = () => callback.call(tx, event);
                  });
                },
                // The completion handler may already be assigned before put.
                get() { return oncomplete.get.call(tx); },
              });
              const current = oncomplete.get.call(tx);
              if (current) tx.oncomplete = current;
            }
            return putOriginal.call(this, value, ...args);
          };
        });
        await page.getByRole('button', { name: /Confirm Verified Restore/ }).click();
        await page.waitForFunction(() => Boolean(window.releaseArchive));
        await open('Plan');
        await history();
        await create('Created during archive restore');
        await page.getByRole('combobox', { name: 'Current project' }).selectOption({ label: 'Created during archive restore' });
        await page.evaluate(() => { window.releaseArchive(); });
        await page.waitForFunction(() => window.archiveFailureReady);
        await page.getByRole('alert', { name: 'Storage conflict or quota alert' }).waitFor();
        if (!(await page.getByRole('combobox', { name: 'Current project' }).locator('option').allTextContents()).includes('Created during archive restore')) {
          throw new Error('Partial archive restore dropped the unrelated new project.');
        }
        const projectOptions = await page.getByRole('combobox', { name: 'Current project' }).locator('option').allTextContents();
        if (!projectOptions.includes('Archived A')) throw new Error('First verified archive project was not retained.');
        if (projectOptions.includes('Archived B')) throw new Error('Failed archive project appeared in the list.');
      }
    } catch (error) {
      failures.push(kind + ': ' + error.message + '\nPAGE_TEXT=' + await page.locator('body').innerText().catch(() => 'unavailable'));
    } finally {
      await context.close();
    }
  }
  if (failures.length) throw new Error(failures.join('\n'));
  return 'PROJECT_LIFECYCLE_PASS';
}
JS
output="$(playwright-cli -s="$session" run-code "$scenario" 2>&1)" || { echo "$output" >&2; exit 1; }
echo "$output"
[[ "$output" == *'"PROJECT_LIFECYCLE_PASS"'* ]]
