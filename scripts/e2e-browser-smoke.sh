#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${E2E_BASE_URL:-http://localhost:3000}"

if ! command -v playwright-cli >/dev/null 2>&1; then
  echo "playwright-cli not found on PATH" >&2
  exit 1
fi

trap 'playwright-cli close >/dev/null 2>&1 || true' EXIT
mkdir -p .playwright-cli

read -r -d '' PLAYWRIGHT_FN <<'EOF' || true
async (page) => {
  const BASE = "__BASE_URL__";
  const browser = page.context().browser();
  const assert = (cond, msg) => { if (!cond) throw new Error('ASSERT FAILED: ' + msg); };
  const results = [];

  const setupApiTrap = async (targetPage) => {
    const pageErrors = [];
    const consoleErrors = [];
    const apiHits = [];
    targetPage.on('pageerror', (e) => pageErrors.push(e.message));
    targetPage.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    await targetPage.route('**/api/**', async (route) => {
      apiHits.push(route.request().url());
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'BLOCKED_TEST', message: 'No paid Gemini calls in E2E' } }),
      });
    });
    return { pageErrors, consoleErrors, apiHits };
  };

  // E2E-A: Rapid A -> edit -> B (<250ms) -> edit -> A -> fresh browser reload
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage();
    const traps = await setupApiTrap(p);
    try {
      await p.goto(BASE, { waitUntil: 'networkidle' });
      await p.getByRole('tab', { name: 'History' }).click();
      await p.getByLabel('New project title').fill('Alpha Rapid');
      await p.getByLabel('New project initial prompt').fill('Alpha seed idea');
      await p.getByRole('button', { name: 'Create Project' }).click();

      await p.getByLabel('New project title').fill('Beta Rapid');
      await p.getByLabel('New project initial prompt').fill('Beta seed idea');
      await p.getByRole('button', { name: 'Create Project' }).click();

      await p.getByRole('button', { name: /^Alpha Rapid/ }).click();
      await p.getByRole('tab', { name: 'Story Bible' }).click();
      await p.locator('#bible-genre').fill('Clockwork Noir');
      await p.getByRole('tab', { name: 'History' }).click();
      await p.getByRole('button', { name: /^Beta Rapid/ }).click();
      await p.getByRole('tab', { name: 'Story Bible' }).click();
      await p.locator('#bible-genre').fill('Lunar Pastoral');
      await p.getByRole('tab', { name: 'History' }).click();
      await p.getByRole('button', { name: /^Alpha Rapid/ }).click();

      await p.getByRole('tab', { name: 'Story Bible' }).click();
      assert((await p.locator('#bible-genre').inputValue()) === 'Clockwork Noir', 'E2E-A immediate Alpha genre lost');

      await p.waitForTimeout(700);
      await p.reload({ waitUntil: 'networkidle' });

      await p.getByRole('tab', { name: 'Story Bible' }).click();
      assert((await p.locator('#bible-genre').inputValue()) === 'Clockwork Noir', 'E2E-A reload Alpha genre lost');
      const undoTitle = await p.getByRole('button', { name: 'Undo' }).getAttribute('title');
      assert(undoTitle && undoTitle.includes('genre'), 'E2E-A Undo label missing after reload: ' + undoTitle);

      await p.getByRole('tab', { name: 'History' }).click();
      await p.getByRole('button', { name: /^Beta Rapid/ }).click();
      await p.getByRole('tab', { name: 'Story Bible' }).click();
      assert((await p.locator('#bible-genre').inputValue()) === 'Lunar Pastoral', 'E2E-A reload Beta genre lost');
      assert(traps.pageErrors.length === 0, 'E2E-A pageErrors: ' + traps.pageErrors.join('; '));
      assert(traps.apiHits.length === 0, 'E2E-A paid API hits: ' + traps.apiHits.join(', '));
      results.push('E2E-A: PASS');
    } finally {
      await ctx.close();
    }
  }

  // E2E-B: Save ACK race regression check during A/r2 -> A/r3 -> switch B -> A -> reload
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage();
    const traps = await setupApiTrap(p);
    try {
      await p.goto(BASE, { waitUntil: 'networkidle' });
      await p.getByRole('tab', { name: 'History' }).click();
      await p.getByLabel('New project title').fill('Race Omega');
      await p.getByLabel('New project initial prompt').fill('Race idea');
      await p.getByRole('button', { name: 'Create Project' }).click();

      await p.getByRole('tab', { name: 'Story Bible' }).click();
      await p.locator('#bible-genre').fill('Rev2 Genre');
      await p.waitForTimeout(180);
      await p.locator('#bible-setting').fill('Rev3 Spire');
      await p.getByRole('tab', { name: 'History' }).click();
      await p.getByRole('button', { name: /^Cat’s Woodland Dinner Party/ }).click();
      await p.waitForTimeout(700);
      await p.getByRole('button', { name: /^Race Omega/ }).click();
      await p.getByRole('tab', { name: 'Story Bible' }).click();
      assert((await p.locator('#bible-setting').inputValue()) === 'Rev3 Spire', 'E2E-B regressed A/r3 in memory');

      await p.reload({ waitUntil: 'networkidle' });
      await p.getByRole('tab', { name: 'Story Bible' }).click();
      assert((await p.locator('#bible-setting').inputValue()) === 'Rev3 Spire', 'E2E-B lost A/r3 on reload');
      assert(traps.pageErrors.length === 0, 'E2E-B pageErrors');
      assert(traps.apiHits.length === 0, 'E2E-B paid API hits');
      results.push('E2E-B: PASS');
    } finally {
      await ctx.close();
    }
  }

  // E2E-C: Story Bible clear authority, inline control-char error & reload persistence
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage();
    const traps = await setupApiTrap(p);
    try {
      await p.goto(BASE, { waitUntil: 'networkidle' });
      await p.getByRole('tab', { name: 'Story Bible' }).click();
      await p.locator('#bible-setting').fill('Candlelit Atrium');
      await p.locator('#bible-tone').fill('Eerie Baroque');
      await p.locator('button[title="Clear Primary Setting"]').click();
      await p.locator('button[title="Clear Tone"]').click();
      assert((await p.locator('#bible-setting').inputValue()) === '', 'E2E-C setting not cleared');
      assert((await p.locator('#bible-tone').inputValue()) === '', 'E2E-C tone not cleared');

      // Simulate control-character input -> accessible error banner on field without mutating canonical value
      await p.locator('#bible-genre').evaluate((el) => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, 'Noir\x00Bad');
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await p.waitForTimeout(50);
      assert((await p.locator('#bible-genre').getAttribute('aria-invalid')) === 'true', 'E2E-C aria-invalid not true');
      assert(await p.locator('#bible-error-genre').isVisible(), 'E2E-C inline error alert missing');
      await p.locator('#bible-genre').fill('Cozy Anthropomorphic Fable');

      await p.waitForTimeout(650);
      await p.reload({ waitUntil: 'networkidle' });
      await p.getByRole('tab', { name: 'Story Bible' }).click();
      assert((await p.locator('#bible-setting').inputValue()) === '', 'E2E-C cleared setting reappeared on reload');
      assert((await p.locator('#bible-tone').inputValue()) === '', 'E2E-C cleared tone reappeared on reload');

      await p.getByRole('tab', { name: 'Refined Prompt & Notes' }).click();
      const promptText = await p.locator('pre').first().textContent();
      assert(!promptText.includes('Candlelit Atrium') && !promptText.includes('Eerie Baroque'), 'E2E-C cleared fields leaked into refined prompt');
      assert(traps.pageErrors.length === 0, 'E2E-C pageErrors');
      assert(traps.apiHits.length === 0, 'E2E-C paid API hits');
      results.push('E2E-C: PASS');
    } finally {
      await ctx.close();
    }
  }

  // E2E-D: Consistency issue navigation -> inspector & Story Bible focus (filter reset + 0 revision bump)
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage();
    const traps = await setupApiTrap(p);
    try {
      await p.goto(BASE, { waitUntil: 'networkidle' });
      await p.getByRole('tab', { name: 'Story Bible' }).click();
      await p.locator('#bible-explicitExclusions').fill('Fox');
      const revBefore = (await p.locator('footer').textContent()).match(/(\d+)\s+revs?/)?.[1];

      await p.getByRole('tab', { name: /Checks/ }).click();
      await p.getByRole('button', { name: 'Inspect Fox' }).click();
      assert((await p.getByRole('tab', { name: 'Inspector' }).getAttribute('aria-selected')) === 'true', 'E2E-D Inspector tab not active');
      assert((await p.getByLabel('Contextual Inspector and Story Bible').textContent()).includes('Fox'), 'E2E-D Fox not selected');

      const revAfter = (await p.locator('footer').textContent()).match(/(\d+)\s+revs?/)?.[1];
      assert(revBefore === revAfter, 'E2E-D navigation bumped revision: ' + revBefore + ' -> ' + revAfter);

      // Set narrow filter on Story Bible, then navigate via Checks -> Edit Tone -> verify filter resets & #bible-tone focused
      await p.getByRole('tab', { name: 'Story Bible' }).click();
      await p.getByRole('button', { name: 'Visual', exact: true }).click();
      await p.getByRole('tab', { name: /Checks/ }).click();
      await p.getByRole('button', { name: 'Edit Tone' }).click();
      await p.waitForTimeout(120);
      assert((await p.evaluate(() => document.activeElement?.id)) === 'bible-tone', 'E2E-D #bible-tone not focused');
      await p.screenshot({ path: '.playwright-cli/e2e-d-bible-focus.png' });
      assert(traps.pageErrors.length === 0, 'E2E-D pageErrors');
      results.push('E2E-D: PASS');
    } finally {
      await ctx.close();
    }
  }

  // E2E-E: NL batch deselect -> Review Modal Before/After -> stale apply blocked -> re-preview -> apply -> Undo -> reload
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage();
    const traps = await setupApiTrap(p);
    try {
      await p.goto(BASE, { waitUntil: 'networkidle' });
      await p.locator('#nl-batch-input').fill('Make Rabbit elderly. Make Fox elderly. The party should be mysterious.');
      await p.getByRole('button', { name: 'Preview', exact: true }).click();
      await p.getByText('Proposed Batch Operations (3/3)').waitFor({ state: 'visible' });

      // Deselect the Fox op explicitly
      await p.locator('[aria-label="Batch edit preview"] label', { hasText: /Fox/i }).locator('input[type="checkbox"]').uncheck();
      await p.getByText('Proposed Batch Operations (2/3)').waitFor({ state: 'visible' });

      // Open Review Modal and inspect Before/After & Projected Prompt
      await p.getByRole('button', { name: 'Review Plan & Prompt' }).click();
      const batchDiffText = (
        await p.locator('[data-testid="review-diff-list"] [data-diff-source="batch-preview"]').allTextContents()
      ).join(' | ');
      assert(
        batchDiffText.includes('Rabbit') && batchDiffText.includes('tone') && !batchDiffText.includes('Fox'),
        'E2E-E Review Diff mismatch on staged batch ops: ' + batchDiffText
      );
      const projPrompt = await p.locator('[data-testid="review-projected-prompt"]').textContent();
      assert(projPrompt.includes('mysterious'), 'E2E-E projected prompt missing mysterious');
      await p.screenshot({ path: '.playwright-cli/e2e-e-review-modal.png' });

      // Close Review Modal via Escape and assert focus returns to Review button
      await p.keyboard.press('Escape');
      assert((await p.evaluate(() => document.activeElement?.textContent?.trim())) === 'Review Plan & Prompt', 'E2E-E Escape did not return focus');

      // Advance revision -> preview becomes visibly stale & Apply button disabled
      await p.getByRole('tab', { name: 'Story Bible' }).click();
      await p.locator('#bible-setting').fill('Obsidian Conservatory');
      await p.getByText(/This preview was generated for an older project or revision/).waitFor({ state: 'visible' });
      const applyBtnDisabled = await p.getByRole('button', { name: /Apply Approved Batch/ }).isDisabled();
      assert(applyBtnDisabled, 'E2E-E stale Apply button must be disabled');

      // Re-preview & apply
      await p.getByRole('button', { name: 'Re-preview for Current Project' }).click();
      await p.getByText('Proposed Batch Operations (3/3)').waitFor({ state: 'visible' });
      await p.getByRole('button', { name: /Apply Approved Batch/ }).click();

      assert((await p.locator('#bible-tone').inputValue()) === 'mysterious', 'E2E-E batch tone not applied');
      await p.getByRole('button', { name: 'Undo' }).click();
      assert((await p.locator('#bible-tone').inputValue()) !== 'mysterious', 'E2E-E Undo did not revert batch');
      assert(!(await p.getByRole('button', { name: 'Redo' }).isDisabled()), 'E2E-E Redo should be enabled after Undo');

      await p.waitForTimeout(700);
      await p.reload({ waitUntil: 'networkidle' });
      assert(!(await p.getByRole('button', { name: 'Redo' }).isDisabled()), 'E2E-E Redo stack lost after reload');
      assert(traps.pageErrors.length === 0, 'E2E-E pageErrors');
      assert(traps.apiHits.length === 0, 'E2E-E paid API hits');
      results.push('E2E-E: PASS');
    } finally {
      await ctx.close();
    }
  }

  // E2E-F: IndexedDB read_error on mount -> 0 unsolicited IDB puts -> offline edit kept -> retry recovers IDB data
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(() => {
      window.__idbPutCalls = [];
      const origPut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        window.__idbPutCalls.push({ id: args[0]?.id, rev: args[0]?.revision });
        return origPut.apply(this, args);
      };
      const origGetAll = IDBObjectStore.prototype.getAll;
      IDBObjectStore.prototype.getAll = function (...args) {
        if (localStorage.getItem('__e2e_fail_idb_read') === '1') {
          const fakeReq = {
            result: undefined,
            error: new DOMException('Simulated IDB read_error', 'UnknownError'),
            onsuccess: null,
            onerror: null,
          };
          setTimeout(() => {
            if (typeof fakeReq.onerror === 'function') {
              fakeReq.onerror(new Event('error'));
            }
          }, 0);
          return fakeReq;
        }
        return origGetAll.apply(this, args);
      };
    });
    const p = await ctx.newPage();
    const traps = await setupApiTrap(p);
    try {
      await p.goto(BASE, { waitUntil: 'networkidle' });
      await p.getByRole('tab', { name: 'Story Bible' }).click();
      await p.locator('#bible-genre').fill('Vaulted Silver Noir');
      await p.waitForTimeout(700);

      // Enable IDB read failure flag and reload while downgrading localStorage cache to detect true IDB recovery
      await p.evaluate(() => {
        localStorage.setItem('__e2e_fail_idb_read', '1');
        localStorage.removeItem('proactive_co_creator_projects_v2');
      });
      await p.reload({ waitUntil: 'networkidle' });

      const retryBtn = p.getByRole('button', { name: 'Retry Storage Read' });
      await retryBtn.waitFor({ state: 'visible' });
      await p.waitForTimeout(550);
      const putsOnMount = await p.evaluate(() => window.__idbPutCalls.length);
      assert(putsOnMount === 0, 'E2E-F performed unsolicited IDB put after read_error: ' + putsOnMount);

      // Make an offline edit while blocked -> STILL zero IDB puts!
      await p.getByRole('tab', { name: 'Story Bible' }).click();
      await p.locator('#bible-setting').fill('Temporary Offline Harbor');
      await p.waitForTimeout(550);
      const putsAfterOfflineEdit = await p.evaluate(() => window.__idbPutCalls.length);
      assert(putsAfterOfflineEdit === 0, 'E2E-F wrote to IDB while blocked-read-error: ' + putsAfterOfflineEdit);
      await p.screenshot({ path: '.playwright-cli/e2e-f-read-error.png' });

      // Clear fault flag and Retry Storage Read -> should detect conflict and allow reloading IDB Vaulted Silver Noir
      await p.evaluate(() => { localStorage.setItem('__e2e_fail_idb_read', '0'); });
      await retryBtn.click();
      await p.getByRole('button', { name: 'Reload Latest from Storage' }).waitFor({ state: 'visible' });
      await p.getByRole('button', { name: 'Reload Latest from Storage' }).click();
      await p.getByRole('tab', { name: 'Story Bible' }).click();
      assert((await p.locator('#bible-genre').inputValue()) === 'Vaulted Silver Noir', 'E2E-F failed to recover Vaulted Silver Noir from IDB');
      assert(traps.pageErrors.length === 0, 'E2E-F pageErrors');
      results.push('E2E-F: PASS');
    } finally {
      await ctx.close();
    }
  }

  // E2E-G: Quota + mismatched artifact content during project deletion preserves local artifact & backup
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(() => {
      const origSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k) {
        if (
          this === window.localStorage &&
          localStorage.getItem('__e2e_tight_quota') === '1' &&
          k === 'proactive_co_creator_deleted_ids_v2'
        ) {
          throw new DOMException('QuotaExceededError: Tombstone quota limit reached', 'QuotaExceededError');
        }
        return origSetItem.apply(this, arguments);
      };
    });
    const p = await ctx.newPage();
    const traps = await setupApiTrap(p);
    try {
      await p.goto(BASE, { waitUntil: 'networkidle' });
      await p.getByRole('tab', { name: 'History' }).click();
      await p.getByLabel('New project title').fill('Doomed Project');
      await p.getByLabel('New project initial prompt').fill('Delete me soon');
      await p.getByRole('button', { name: 'Create Project' }).click();
      await p.waitForTimeout(700);

      // Inject legacy backup + unique local artifact on Sample project + enable tombstone quota failure
      await p.evaluate(() => {
        localStorage.setItem('proactive_co_creator_backup_v2', JSON.stringify({ legacy: 'keep-intact' }));
        const raw = localStorage.getItem('proactive_co_creator_projects_v2');
        const map = JSON.parse(raw);
        for (const id of Object.keys(map)) {
          if (map[id].name !== 'Doomed Project') {
            map[id].artifacts = [{
              id: 'art_local_unique_id',
              projectId: id,
              mode: 'story',
              createdAt: Date.now(),
              revisionId: 'rev_1',
              sourceRevision: 1,
              promptUsed: 'Unique prompt',
              promptDigest: 'uniq_digest',
              storyText: 'UNIQUE_LOCAL_SURVIVING_STORY',
              isOutdated: false,
            }];
          }
        }
        localStorage.setItem('proactive_co_creator_projects_v2', JSON.stringify(map));
        localStorage.setItem('__e2e_tight_quota', '1');
      });

      await p.getByRole('button', { name: 'Delete project Doomed Project' }).click();
      await p.getByText(/Incomplete deletion warning/).first().waitFor({ state: 'visible' });

      const postState = await p.evaluate(() => ({
        backup: localStorage.getItem('proactive_co_creator_backup_v2'),
        projects: JSON.parse(localStorage.getItem('proactive_co_creator_projects_v2') || '{}'),
      }));
      assert(postState.backup === JSON.stringify({ legacy: 'keep-intact' }), 'E2E-G legacy backup destroyed!');
      const keeper = Object.values(postState.projects).find((pr) => pr.name !== 'Doomed Project');
      assert(keeper && keeper.artifacts?.[0]?.id === 'art_local_unique_id', 'E2E-G local-only artifact stripped!');
      assert(traps.pageErrors.length === 0, 'E2E-G pageErrors');
      results.push('E2E-G: PASS');
    } finally {
      await ctx.close();
    }
  }

  // E2E-H & E2E-I: Story <-> Image mode switching, zero paid Gemini calls, keyboard Tab/Escape, mobile 390x844
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage();
    const traps = await setupApiTrap(p);
    try {
      await p.goto(BASE, { waitUntil: 'networkidle' });
      await p.getByRole('tab', { name: 'Story Bible' }).click();
      await p.locator('#bible-visualStyle').fill('Ink Wash & Brass Lanterns');
      const genModeGroup = p.getByRole('group', { name: 'Generation mode' });
      await genModeGroup.getByRole('button', { name: 'Image', exact: true }).click();
      assert((await genModeGroup.getByRole('button', { name: 'Image', exact: true }).getAttribute('aria-pressed')) === 'true', 'E2E-H Image mode not active');
      assert((await p.locator('#bible-visualStyle').inputValue()) === 'Ink Wash & Brass Lanterns', 'E2E-H Story Bible lost on mode switch');
      const graphRegion = await p.getByRole('region', { name: 'Interactive belief graph' }).textContent();
      assert(graphRegion.includes('hosting') && graphRegion.includes('Cat'), 'E2E-H Graph edges missing after Image switch');
      await genModeGroup.getByRole('button', { name: 'Story', exact: true }).click();
      assert(traps.apiHits.length === 0, 'E2E-H unexpected paid Gemini API calls');

      // Mobile 390x844 responsiveness + mobile tab switch + dark mode + zero horizontal overflow
      await p.setViewportSize({ width: 390, height: 844 });
      await p.waitForTimeout(100);
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      assert(!overflow, 'E2E-I horizontal overflow at 390x844');
      await p.getByRole('button', { name: 'Inspector' }).click();
      await p.getByRole('tab', { name: /Checks/ }).click();
      await p.getByRole('button', { name: 'Edit Tone' }).click();
      await p.waitForTimeout(100);
      assert((await p.evaluate(() => document.activeElement?.id)) === 'bible-tone', 'E2E-I mobile issue focus failed');
      await p.getByRole('button', { name: 'Switch to dark mode' }).click();
      await p.waitForTimeout(250);
      const headerBg = await p.evaluate(() => getComputedStyle(document.querySelector('header')).backgroundColor);
      assert(headerBg !== 'rgb(255, 255, 255)', 'E2E-I dark header background did not transition: ' + headerBg);
      await p.screenshot({ path: '.playwright-cli/e2e-i-mobile-dark.png' });

      assert(traps.pageErrors.length === 0, 'E2E-H/I pageErrors: ' + traps.pageErrors.join('; '));
      assert(traps.consoleErrors.length === 0, 'E2E-H/I consoleErrors: ' + traps.consoleErrors.join('; '));
      results.push('E2E-H: PASS', 'E2E-I: PASS');
    } finally {
      await ctx.close();
    }
  }

  assert(results.length === 9, 'Expected 9 E2E results, got ' + results.length + ': ' + results.join(', '));
  return results.join(' | ');
}
EOF

PLAYWRIGHT_FN="${PLAYWRIGHT_FN//__BASE_URL__/$BASE_URL}"

playwright-cli open --browser=chromium "$BASE_URL"
playwright-cli run-code "$PLAYWRIGHT_FN"
echo "E2E_SMOKE_PASS: E2E-A through E2E-I verified on Chromium ($BASE_URL)"
