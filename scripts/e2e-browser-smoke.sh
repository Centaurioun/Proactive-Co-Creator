#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${E2E_BASE_URL:-http://127.0.0.1:3000}"
SESSION_NAME="pcc-smoke-$$"

if ! command -v playwright-cli >/dev/null 2>&1; then
  echo "playwright-cli not found on PATH" >&2
  exit 1
fi

trap 'playwright-cli -s="$SESSION_NAME" close >/dev/null 2>&1 || true' EXIT
mkdir -p .playwright-cli

# Preflight server health before launching Chromium
if ! HEALTH_PAYLOAD="$(curl -sf "$BASE_URL/api/health")"; then
  echo "E2E_PREFLIGHT_FAIL: Server health check failed at $BASE_URL/api/health" >&2
  exit 1
fi
echo "E2E_PREFLIGHT_OK: $HEALTH_PAYLOAD"

# Startup browser launch smoke check against /api/health with actionable diagnostic
if ! playwright-cli -s="$SESSION_NAME" open --browser=chromium "$BASE_URL/api/health"; then
  echo "E2E_BROWSER_LAUNCH_FAIL: Could not launch Chromium via playwright-cli." >&2
  echo "Ensure full Chromium (chrome-for-testing) is installed, not --only-shell:" >&2
  echo "  playwright-cli install-browser chromium --with-deps" >&2
  exit 1
fi

read -r -d '' PLAYWRIGHT_FN <<'EOF' || true
async (page) => {
  const BASE = "__BASE_URL__";
  const artifactDiagnostic = "__ARTIFACT_DIAGNOSTIC__" === '1';
  const browser = page.context().browser();
  const assert = (cond, msg) => { if (!cond) throw new Error('ASSERT FAILED: ' + msg); };
  const results = [];
  const structured = {
    baseUrl: BASE,
    startedAt: new Date().toISOString(),
    passed: false,
    scenarios: [],
  };

  const setupApiTrap = async (targetPage) => {
    const pageErrors = [];
    const consoleErrors = [];
    const apiHits = [];
    const paidApiHits = [];
    targetPage.on('pageerror', (e) => pageErrors.push(e.message));
    targetPage.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    await targetPage.route('**/api/**', async (route) => {
      apiHits.push(route.request().url());
      if (
        route.request().url().endsWith('/api/ai/capabilities') ||
        route.request().url().endsWith('/api/ai/provider-hub/status')
      ) return route.continue();
      paidApiHits.push(route.request().url());
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'BLOCKED_TEST', message: 'No paid Gemini calls in E2E' } }),
      });
    });
    return { pageErrors, consoleErrors, apiHits, paidApiHits };
  };

  const createProjectFromHub = async (p, name, idea) => {
    await p.getByRole('banner').getByRole('button', { name: 'Projects', exact: true }).click();
    await p.getByRole('textbox', { name: 'Project title' }).fill(name);
    await p.getByRole('textbox', { name: 'Starting idea' }).fill(idea);
    await p.getByRole('button', { name: 'Create project', exact: true }).click();
    // Creation now waits for the durable save before it selects the new project.
    // Do not start another project action while that transaction is still pending.
    await p.waitForFunction((expectedName) => {
      const select = document.querySelector('select[aria-label="Current project"]');
      return select?.selectedOptions[0]?.textContent?.trim() === expectedName;
    }, name);
  };

  const runScenario = async (id, fn, initScript = null) => {
    const t0 = Date.now();
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    // These legacy journeys were authored against the former Plan-first shell.
    // Stage0 separately verifies the product's correct first-run Write fallback.
    await ctx.addInitScript(() => {
      localStorage.setItem('proactive_co_creator_workspace_preference_v1', JSON.stringify({ version: 1, mode: 'plan' }));
    });
    if (initScript) await ctx.addInitScript(initScript);
    await ctx.tracing.start({ screenshots: true, snapshots: true });
    const p = await ctx.newPage();
    const traps = await setupApiTrap(p);
    let passed = false;
    try {
      await fn(p, traps);
      passed = true;
      structured.scenarios.push({
        id,
        status: 'PASS',
        durationMs: Date.now() - t0,
        apiHits: traps.apiHits.length,
        pageErrors: traps.pageErrors,
        consoleErrors: traps.consoleErrors,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const safeId = id.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      try {
        await p.screenshot({ path: `.playwright-cli/fail-${safeId}.png`, fullPage: true });
      } catch { /* ignore screenshot error on crashed page */ }
      try {
        await ctx.tracing.stop({ path: `.playwright-cli/trace-fail-${safeId}.zip` });
      } catch { /* ignore trace stop error */ }
      structured.scenarios.push({
        id,
        status: 'FAIL',
        durationMs: Date.now() - t0,
        error: errorMessage,
        apiHits: traps.apiHits.length,
        pageErrors: traps.pageErrors,
        consoleErrors: traps.consoleErrors,
      });
      throw err;
    } finally {
      if (passed) {
        try {
          if (id === 'E2E-E') await ctx.tracing.stop({ path: '.playwright-cli/trace-e2e-e.zip' });
          else await ctx.tracing.stop();
        } catch { /* ignore */ }
      }
      await ctx.close();
    }
  };

  if (artifactDiagnostic) {
    try {
      await runScenario('CONTROLLED-ARTIFACT-FAILURE', async (p) => {
        await p.goto(BASE, { waitUntil: 'networkidle' });
        throw new Error('CONTROLLED_ARTIFACT_DIAGNOSTIC');
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      assert(message.includes('CONTROLLED_ARTIFACT_DIAGNOSTIC'), 'Unexpected diagnostic failure: ' + message);
    }
    const captured = structured.scenarios.find((scenario) => scenario.id === 'CONTROLLED-ARTIFACT-FAILURE');
    assert(captured?.status === 'FAIL', 'Controlled diagnostic did not exercise the failure capture path');
    structured.controlledFailure = captured;
    structured.artifactDiagnostic = true;
    structured.scenarios = [{ id: 'CONTROLLED-ARTIFACT-VERIFICATION', status: 'PASS' }];
    structured.finishedAt = new Date().toISOString();
    structured.passed = true;
    structured.summary = ['CONTROLLED-ARTIFACT-FAILURE: captured'];
    return 'E2E_JSON_BEGIN' + JSON.stringify(structured) + 'E2E_JSON_END';
  }

  try {

  // E2E-A: Rapid A -> edit -> B (<250ms) -> edit -> A -> fresh browser reload
  await runScenario('E2E-A', async (p, traps) => {
    await p.goto(BASE, { waitUntil: 'networkidle' });
    await createProjectFromHub(p, 'Alpha Rapid', 'Alpha seed idea');
    await createProjectFromHub(p, 'Beta Rapid', 'Beta seed idea');

    await p.getByLabel('Current project').selectOption({ label: 'Alpha Rapid' });
    await p.getByRole('navigation', { name: 'Narrative workspace' }).getByRole('button', { name: 'Plan', exact: true }).click();
    await p.getByRole('tab', { name: 'Story Bible' }).click();
    await p.locator('#bible-genre').fill('Clockwork Noir');
    await p.getByRole('tab', { name: 'History' }).click();
    await p.getByLabel('Current project').selectOption({ label: 'Beta Rapid' });
    await p.getByRole('tab', { name: 'Story Bible' }).click();
    await p.locator('#bible-genre').fill('Lunar Pastoral');
    await p.getByRole('tab', { name: 'History' }).click();
    await p.getByLabel('Current project').selectOption({ label: 'Alpha Rapid' });

    await p.getByRole('tab', { name: 'Story Bible' }).click();
    assert((await p.locator('#bible-genre').inputValue()) === 'Clockwork Noir', 'E2E-A immediate Alpha genre lost');

    await p.waitForTimeout(700);
    await p.reload({ waitUntil: 'networkidle' });

    await p.getByRole('tab', { name: 'Story Bible' }).click();
    assert((await p.locator('#bible-genre').inputValue()) === 'Clockwork Noir', 'E2E-A reload Alpha genre lost');
    const undoTitle = await p.getByRole('button', { name: 'Undo' }).getAttribute('title');
    assert(undoTitle && undoTitle.includes('genre'), 'E2E-A Undo label missing after reload: ' + undoTitle);

    await p.getByRole('tab', { name: 'History' }).click();
    await p.getByLabel('Current project').selectOption({ label: 'Beta Rapid' });
    await p.getByRole('tab', { name: 'Story Bible' }).click();
    assert((await p.locator('#bible-genre').inputValue()) === 'Lunar Pastoral', 'E2E-A reload Beta genre lost');
    assert(traps.pageErrors.length === 0, 'E2E-A pageErrors: ' + traps.pageErrors.join('; '));
    assert(traps.paidApiHits.length === 0, 'E2E-A paid API hits: ' + traps.paidApiHits.join(', '));
    results.push('E2E-A: PASS');
  });

  // E2E-B: Save ACK race regression check during A/r2 -> A/r3 -> switch B -> A -> reload
  await runScenario('E2E-B', async (p, traps) => {
    await p.goto(BASE, { waitUntil: 'networkidle' });
    await createProjectFromHub(p, 'Race Omega', 'Race idea');

    await p.getByRole('navigation', { name: 'Narrative workspace' }).getByRole('button', { name: 'Plan', exact: true }).click();
    await p.getByRole('tab', { name: 'Story Bible' }).click();
    await p.locator('#bible-genre').fill('Rev2 Genre');
    await p.waitForTimeout(180);
    await p.locator('#bible-setting').fill('Rev3 Spire');
    await p.getByRole('tab', { name: 'History' }).click();
    await p.getByLabel('Current project').selectOption({ label: 'Cat’s Woodland Dinner Party' });
    await p.waitForTimeout(700);
    await p.getByLabel('Current project').selectOption({ label: 'Race Omega' });
    await p.getByRole('tab', { name: 'Story Bible' }).click();
    assert((await p.locator('#bible-setting').inputValue()) === 'Rev3 Spire', 'E2E-B regressed A/r3 in memory');

    await p.reload({ waitUntil: 'networkidle' });
    await p.getByRole('tab', { name: 'Story Bible' }).click();
    assert((await p.locator('#bible-setting').inputValue()) === 'Rev3 Spire', 'E2E-B lost A/r3 on reload');
    assert(traps.pageErrors.length === 0, 'E2E-B pageErrors');
    assert(traps.paidApiHits.length === 0, 'E2E-B paid API hits');
    results.push('E2E-B: PASS');
  });

  // E2E-C: Story Bible clear authority, inline control-char error & reload persistence
  await runScenario('E2E-C', async (p, traps) => {
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

    const promptText = await p.evaluate(() => {
      const projects = JSON.parse(localStorage.getItem('proactive_co_creator_projects_v2') || '{}');
      const activeId = localStorage.getItem('proactive_co_creator_active_id_v2');
      return projects[activeId]?.snapshot?.refinedPrompt ?? '';
    });
    assert(!promptText.includes('Candlelit Atrium') && !promptText.includes('Eerie Baroque'), 'E2E-C cleared fields leaked into refined prompt');
    assert(traps.pageErrors.length === 0, 'E2E-C pageErrors');
    assert(traps.paidApiHits.length === 0, 'E2E-C paid API hits');
    results.push('E2E-C: PASS');
  });

  // E2E-D: Consistency issue navigation -> inspector & Story Bible focus (filter reset + 0 revision bump)
  await runScenario('E2E-D', async (p, traps) => {
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

    // Set narrow filter on Story Bible, then navigate via Checks -> Edit Explicit Exclusions -> verify target focus
    await p.getByRole('tab', { name: 'Story Bible' }).click();
    await p.getByRole('button', { name: 'Visual', exact: true }).click();
    await p.getByRole('tab', { name: /Checks/ }).click();
    await p.getByRole('button', { name: 'Edit Explicit Exclusions' }).click();
    await p.waitForTimeout(120);
    assert((await p.evaluate(() => document.activeElement?.id)) === 'bible-explicitExclusions', 'E2E-D explicit exclusions field not focused');
    await p.screenshot({ path: '.playwright-cli/e2e-d-bible-focus.png' });
    assert(traps.pageErrors.length === 0, 'E2E-D pageErrors');
    results.push('E2E-D: PASS');
  });

  // E2E-E: NL batch deselect -> Review Modal Before/After -> stale apply blocked -> re-preview -> apply -> Undo -> reload
  await runScenario('E2E-E', async (p, traps) => {
    await p.goto(BASE, { waitUntil: 'networkidle' });
    await p.getByRole('button', { name: /Inbox/ }).click();
    await p.locator('#nl-batch-input').fill('Make Rabbit elderly. Make Fox elderly. The party should be mysterious.');
    await p.getByRole('button', { name: 'Preview', exact: true }).click();
    await p.getByText('Proposed Batch Operations (3/3)').waitFor({ state: 'visible' });

    // Deselect the Fox op explicitly
    await p.locator('[aria-label="Batch edit preview"] label', { hasText: /Fox/i }).locator('input[type="checkbox"]').uncheck();
    await p.getByText('Proposed Batch Operations (2/3)').waitFor({ state: 'visible' });

    // Repeatedly verify modal entry, both focus-trap boundaries, close paths and canonical-state integrity.
    const reviewButton = p.getByRole('button', { name: 'Review Plan & Prompt' });
    const footerBeforeModal = await p.locator('footer').textContent();
    const revisionBeforeModal = footerBeforeModal.match(/(\d+)\s+revs?/)?.[1];
    assert(revisionBeforeModal !== undefined, 'E2E-E could not read canonical project revision before modal cycles');
    for (let cycle = 0; cycle < 5; cycle += 1) {
      await reviewButton.click();
      await p.waitForFunction(
        () => Boolean(document.querySelector('[role="dialog"]')) && document.activeElement?.textContent?.trim() === 'Close',
        null,
        { timeout: 1000 }
      );
      const modalButtons = p.locator('[role="dialog"] button:not([disabled])');
      const firstButtonText = (await modalButtons.first().textContent())?.trim();
      const lastButtonText = (await modalButtons.last().textContent())?.trim();
      assert(firstButtonText === 'Close', `E2E-E cycle ${cycle + 1} modal first focusable is ${firstButtonText}`);
      await p.keyboard.press('Shift+Tab');
      await p.waitForFunction((expected) => document.activeElement?.textContent?.trim() === expected, lastButtonText, { timeout: 1000 });
      await p.keyboard.press('Tab');
      await p.waitForFunction((expected) => document.activeElement?.textContent?.trim() === expected, firstButtonText, { timeout: 1000 });
      if (cycle === 1) await p.getByRole('button', { name: 'Close', exact: true }).click();
      else await p.keyboard.press('Escape');
      await p.waitForFunction(
        () => !document.querySelector('[role="dialog"]') && document.activeElement?.textContent?.trim() === 'Review Plan & Prompt',
        null,
        { timeout: 1000 }
      );
      assert(await reviewButton.count() === 1, `E2E-E cycle ${cycle + 1} opener was detached`);
      assert(await reviewButton.isEnabled(), `E2E-E cycle ${cycle + 1} opener was not focusable`);
      assert(
        (await p.evaluate(() => document.activeElement?.textContent?.trim())) === 'Review Plan & Prompt',
        `E2E-E cycle ${cycle + 1} focus did not return to the opener`
      );
      const footerAfterCycle = await p.locator('footer').textContent();
      assert(
        (footerAfterCycle.match(/(\d+)\s+revs?/)?.[1] ?? null) === (revisionBeforeModal ?? null),
        `E2E-E cycle ${cycle + 1} changed canonical revision`
      );
    }

    // Check the same entry and Escape restoration behavior at a phone-sized viewport.
    await p.setViewportSize({ width: 390, height: 844 });
    await reviewButton.click();
    await p.waitForFunction(
      () => Boolean(document.querySelector('[role="dialog"]')) && document.activeElement?.textContent?.trim() === 'Close',
      null,
      { timeout: 1000 }
    );
    await p.keyboard.press('Escape');
    await p.waitForFunction(
      () => !document.querySelector('[role="dialog"]') && document.activeElement?.textContent?.trim() === 'Review Plan & Prompt',
      null,
      { timeout: 1000 }
    );
    await p.screenshot({ path: '.playwright-cli/e2e-e-mobile-modal.png' });
    await p.setViewportSize({ width: 1440, height: 900 });

    // Reopen for impact assertions and a representative success trace.
    await reviewButton.click();
    await p.waitForFunction(
      () => Boolean(document.querySelector('[role="dialog"]')) && document.activeElement?.textContent?.trim() === 'Close',
      null,
      { timeout: 1000 }
    );
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
    await p.waitForFunction(
      () =>
        !document.querySelector('[role="dialog"]') &&
        document.activeElement?.textContent?.trim() === 'Review Plan & Prompt',
      null,
      { timeout: 1000 }
    );
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
    assert(traps.paidApiHits.length === 0, 'E2E-E paid API hits');
    results.push('E2E-E: PASS');
  });

  // E2E-F: IndexedDB read_error on mount -> 0 unsolicited IDB puts -> offline edit kept -> retry recovers IDB data
  await runScenario(
    'E2E-F',
    async (p, traps) => {
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
    },
    () => {
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
    }
  );

  // E2E-G: Quota + mismatched artifact content during project deletion preserves local artifact & backup
  await runScenario(
    'E2E-G',
    async (p, traps) => {
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

      await p.getByRole('navigation', { name: 'Narrative workspace' }).getByRole('button', { name: 'Plan', exact: true }).click();
      await p.getByRole('tab', { name: 'History' }).click();
      let deletionConfirmation = '';
      p.once('dialog', async (dialog) => {
        deletionConfirmation = dialog.message();
        await dialog.accept();
      });
      await p.getByRole('button', { name: 'Delete project Doomed Project' }).click();
      assert(deletionConfirmation.includes('Doomed Project'), 'E2E-G project deletion did not request confirmation');
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
    },
    () => {
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
    }
  );

  // E2E-H & E2E-I: Story <-> Image mode switching, zero paid Gemini calls, keyboard Tab/Escape, mobile 390x844
  await runScenario('E2E-H+I', async (p, traps) => {
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
    assert(traps.paidApiHits.length === 0, 'E2E-H unexpected paid Gemini API calls');

    // Mobile 390x844 responsiveness + mobile tab switch + dark mode + zero horizontal overflow
    await p.setViewportSize({ width: 390, height: 844 });
    await p.waitForTimeout(100);
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert(!overflow, 'E2E-I horizontal overflow at 390x844');
    await p.getByRole('button', { name: 'Inspector' }).click();
    await p.getByRole('tab', { name: /Checks/ }).click();
    await p.getByRole('button', { name: 'Open Tone field' }).click();
    await p.waitForTimeout(100);
    assert((await p.evaluate(() => document.activeElement?.id.startsWith('bible-'))) === true, 'E2E-I mobile readiness field focus failed');
    await p.getByRole('button', { name: 'Switch to dark mode' }).click();
    await p.waitForTimeout(250);
    const headerBg = await p.evaluate(() => getComputedStyle(document.querySelector('header')).backgroundColor);
    assert(headerBg !== 'rgb(255, 255, 255)', 'E2E-I dark header background did not transition: ' + headerBg);
    await p.screenshot({ path: '.playwright-cli/e2e-i-mobile-dark.png' });

    assert(traps.pageErrors.length === 0, 'E2E-H/I pageErrors: ' + traps.pageErrors.join('; '));
    assert(traps.consoleErrors.length === 0, 'E2E-H/I consoleErrors: ' + traps.consoleErrors.join('; '));
    results.push('E2E-H: PASS', 'E2E-I: PASS');
  });

  // E2E-J: long in-limit multiline seed remains editable and scrollable.
  await runScenario('E2E-J', async (p, traps) => {
    await p.goto(BASE, { waitUntil: 'networkidle' });
    await p.getByRole('navigation', { name: 'Narrative workspace' })
      .getByRole('button', { name: 'Plan', exact: true }).click();
    const prompt = p.locator('#prompt-textarea:visible');
    const initial = Array.from({ length: 135 }, (_, index) =>
      `Synthetic line ${String(index + 1).padStart(3, '0')}: ${'x'.repeat(34)}`
    ).join('\n');
    await prompt.fill(initial);
    const beforeEdit = await prompt.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      return {
        value: element.value,
        scrollTop: element.scrollTop,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
      };
    });
    assert(beforeEdit.value === initial, 'E2E-J multiline seed content changed during entry');
    assert(beforeEdit.scrollHeight > beforeEdit.clientHeight && beforeEdit.scrollTop > 0,
      'E2E-J long multiline seed did not expose an internal scroll area');
    await prompt.press('End');
    await prompt.pressSequentially('\nFinal line edited after scrolling.');
    const afterEdit = await prompt.inputValue();
    assert(afterEdit === `${initial}\nFinal line edited after scrolling.`,
      'E2E-J could not edit the final prompt lines after scrolling');
    assert(afterEdit.length < 8000, 'E2E-J fixture exceeded the compiled prompt limit');
    const counter = p.getByText(/compiled chars/).first();
    const counterText = await counter.innerText();
    const counterColor = await counter.evaluate((element) => getComputedStyle(element).color);
    assert(counterText.includes('/8,000 compiled chars') && counterColor !== 'rgb(220, 38, 38)',
      'E2E-J in-limit prompt counter is missing or indicates an over-limit state: ' + counterText + ' / ' + counterColor);
    assert(traps.pageErrors.length === 0, 'E2E-J pageErrors: ' + traps.pageErrors.join('; '));
    assert(traps.paidApiHits.length === 0, 'E2E-J unexpected AI/API requests: ' + traps.paidApiHits.join(', '));
    results.push('E2E-J: PASS');
  });

  // E2E-K: visible synthetic Story failure and user-owned recovery retry.
  await runScenario('E2E-K', async (p, traps) => {
    const storyCalls = [];
    const apiEvidence = { requests: [], responses: [] };
    p.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/api/')) apiEvidence.requests.push({ method: request.method(), path: url.pathname });
    });
    p.on('response', (response) => {
      const url = new URL(response.url());
      if (url.pathname.startsWith('/api/')) apiEvidence.responses.push({ status: response.status(), path: url.pathname });
    });
    await p.route('**/api/ai/provider-hub/status', (route) => route.fulfill({ json: {
      capabilityPolicyVersion: 'qa-synthetic-policy-v1',
      credentialAuthorityIds: { 'gemini-managed': 'qa-synthetic-authority' },
      preferences: { defaultConnectionId: 'gemini-managed', defaultTextModelId: 'qa-synthetic-model', defaultReasoningLevel: 'default' },
      connections: [{ id: 'gemini-managed', family: 'gemini', billing: 'host-managed-gemini', state: 'available', selectedModelId: 'qa-synthetic-model', models: [{
        id: 'qa-synthetic-model', displayName: 'Synthetic managed model',
        availability: { state: 'supported', value: true, evidence: [] },
        textGeneration: { state: 'supported', value: true, evidence: [] },
        structuredOutput: { state: 'supported', value: true, evidence: [] },
        reasoning: { state: 'supported', value: ['default'], evidence: [] },
        operationCapabilities: { story: { state: 'supported', value: true, evidence: [] } },
        capabilityPolicyVersion: 'qa-synthetic-policy-v1',
      }] }],
      usage: { observedByConnection: {}, quota: { state: 'unknown' } },
    } }));
    await p.route('**/api/generate/story', async (route) => {
      storyCalls.push(route.request().postDataJSON());
      if (storyCalls.length === 1) return route.fulfill({ status: 503, json: {
        error: { code: 'UPSTREAM_ERROR', message: 'Synthetic upstream unavailable.', retryable: true },
      } });
      return route.fulfill({ json: { story: 'Synthetic recovery story.' } });
    });
    await p.goto(BASE, { waitUntil: 'networkidle' });
    await p.getByRole('navigation', { name: 'Narrative workspace' })
      .getByRole('button', { name: 'Plan', exact: true }).click();
    const generate = () => p.locator('footer').getByRole('button', { name: 'Generate Story', exact: true });
    await generate().click();
    const failure = p.getByRole('alert').filter({ hasText: /Generation Failed/i }).last();
    await failure.waitFor({ state: 'visible' });
    assert((await failure.innerText()).includes('Synthetic upstream unavailable.'),
      'E2E-K synthetic provider error was not visible to the user');
    await p.waitForTimeout(500);
    assert(storyCalls.length === 1, 'E2E-K silently retried or fell back after the synthetic failure');
    await generate().click();
    await p.getByText('Synthetic recovery story.', { exact: true }).waitFor({ state: 'visible' });
    assert(storyCalls.length === 2, 'E2E-K explicit retry did not make exactly one second request');
    assert(apiEvidence.requests.filter((request) => request.path === '/api/generate/story').length === 2,
      'E2E-K browser request count did not match the two user actions: ' + JSON.stringify(apiEvidence));
    assert(apiEvidence.responses.some((response) => response.path === '/api/generate/story' && response.status === 503) &&
      apiEvidence.responses.some((response) => response.path === '/api/generate/story' && response.status === 200),
      'E2E-K expected 503 then 200 responses: ' + JSON.stringify(apiEvidence));
    assert(traps.pageErrors.length === 0, 'E2E-K pageErrors: ' + traps.pageErrors.join('; '));
    assert(traps.paidApiHits.length === 0, 'E2E-K unexpected real AI/API requests: ' + traps.paidApiHits.join(', '));
    results.push('E2E-K: PASS');
  });

  assert(results.length === 11, 'Expected 11 E2E results, got ' + results.length + ': ' + results.join(', '));
  structured.finishedAt = new Date().toISOString();
  structured.passed = true;
  structured.summary = results;
  } catch (err) {
    structured.finishedAt = new Date().toISOString();
    structured.passed = false;
    structured.summary = results;
    structured.fatalError = err instanceof Error ? err.message : String(err);
  }
  return 'E2E_JSON_BEGIN' + JSON.stringify(structured) + 'E2E_JSON_END';
}
EOF

PLAYWRIGHT_FN="${PLAYWRIGHT_FN//__BASE_URL__/$BASE_URL}"
PLAYWRIGHT_FN="${PLAYWRIGHT_FN//__ARTIFACT_DIAGNOSTIC__/${E2E_ARTIFACT_DIAGNOSTIC:-0}}"

RUN_OUT="$(playwright-cli -s="$SESSION_NAME" run-code "$PLAYWRIGHT_FN" 2>&1)" || {
  echo "$RUN_OUT" >&2
  exit 1
}
echo "$RUN_OUT"

E2E_RAW_OUT="$RUN_OUT" node -e '
const fs = require("node:fs");
const raw = process.env.E2E_RAW_OUT || "";
if (raw.includes("### Error")) {
  console.error("E2E_SMOKE_FAIL: playwright-cli run-code reported an uncaught error.");
  process.exit(1);
}
const resultIdx = raw.indexOf("### Result");
const resultSection = resultIdx === -1 ? raw : raw.slice(resultIdx);
const start = resultSection.indexOf("E2E_JSON_BEGIN");
const end = start === -1 ? -1 : resultSection.indexOf("E2E_JSON_END", start);
if (start === -1 || end === -1 || end <= start) {
  console.error("E2E_SMOKE_FAIL: Missing structured E2E_JSON payload in playwright-cli result section.");
  process.exit(1);
}
let payloadStr = resultSection.slice(start + "E2E_JSON_BEGIN".length, end);
if (payloadStr.startsWith("\\\"") || resultSection.slice(start - 1, start) === "\"") {
  payloadStr = JSON.parse("\"" + payloadStr + "\"");
}
const data = JSON.parse(payloadStr);
const targetPath = data.artifactDiagnostic
  ? ".playwright-cli/controlled-failure-results.json"
  : ".playwright-cli/e2e-results.json";
fs.writeFileSync(targetPath, JSON.stringify(data, null, 2));
const browserLogs = (data.scenarios || []).map((scenario) => ({
  scenario: scenario.id,
  pageErrors: (Array.isArray(scenario.pageErrors) ? scenario.pageErrors : []).map((message) =>
    String(message).replace(/([?&](?:key|token|api_key)=)[^&\s]+/gi, "$1[REDACTED]")
  ),
  consoleErrors: (Array.isArray(scenario.consoleErrors) ? scenario.consoleErrors : []).map((message) =>
    String(message).replace(/([?&](?:key|token|api_key)=)[^&\s]+/gi, "$1[REDACTED]")
  ),
}));
fs.writeFileSync(".playwright-cli/browser-logs.json", JSON.stringify(browserLogs, null, 2));
if (data.artifactDiagnostic) {
  const failure = data.controlledFailure;
  const fsExists = (name) => fs.existsSync(`.playwright-cli/${name}`);
  if (!data.passed || !failure || failure.status !== "FAIL" ||
      !fsExists("fail-controlled-artifact-failure.png") ||
      !fsExists("trace-fail-controlled-artifact-failure.zip")) {
    console.error("E2E_ARTIFACT_DIAGNOSTIC_FAIL: controlled failure evidence is incomplete.");
    process.exit(1);
  }
  console.log("E2E_ARTIFACT_DIAGNOSTIC_PASS: screenshot, trace, and structured failure results captured.");
} else if (!data.passed || !Array.isArray(data.summary) || data.summary.length !== 11) {
  console.error("E2E_SMOKE_FAIL:", data.fatalError || "Not all 11 E2E scenarios passed", JSON.stringify(data.scenarios));
  process.exit(1);
}
console.log("E2E_RESULTS_VERIFIED:", data.summary.join(" | "));
'

echo "E2E_SMOKE_PASS: E2E-A through E2E-K verified on Chromium ($BASE_URL)"
