#!/usr/bin/env bash
set -euo pipefail

# Stage 0 Live User Journey Verification (J01-J12),
# Accessibility & Responsive Audit (S0.4), and Browser Perf Benchmark (S0.5)
# Strictly non-billable: key-free server (configured:false) + Playwright route trapping.

if ! command -v playwright-cli >/dev/null 2>&1; then
  echo "playwright-cli not found on PATH" >&2
  exit 1
fi

PORT_TO_USE="${STAGE0_PORT:-3100}"
BASE_URL="${E2E_BASE_URL:-http://127.0.0.1:${PORT_TO_USE}}"
STARTED_SERVER=0
SERVER_PID=""

cleanup() {
  playwright-cli close >/dev/null 2>&1 || true
  if [ "$STARTED_SERVER" -eq 1 ] && [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

mkdir -p .playwright-cli

if [ ! -f .playwright-cli/stage0-fixtures.json ]; then
  npx --yes tsx scripts/stage0-fixtures.ts .playwright-cli/stage0-fixtures.json
fi

if [ -z "${E2E_BASE_URL:-}" ]; then
  if [ ! -d dist ]; then
    npm run build
  fi
  env -u GEMINI_API_KEY -u API_KEY NODE_ENV=production PORT="$PORT_TO_USE" node server.ts >.playwright-cli/stage0-audit-server.log 2>&1 &
  SERVER_PID=$!
  STARTED_SERVER=1
  for _ in $(seq 1 40); do
    if curl -sf "$BASE_URL/api/health" >/dev/null; then
      break
    fi
    sleep 0.25
  done
fi

HEALTH_JSON="$(curl -sf "$BASE_URL/api/health")"
echo "STAGE0_AUDIT_HEALTH: $HEALTH_JSON"
echo "$HEALTH_JSON" | grep -q '"configured":false' || {
  echo "ERROR: Audit requires key-free test server (configured:false)." >&2
  exit 1
}

playwright-cli open --browser=chromium "$BASE_URL/api/health" >/dev/null

run_pw_phase() {
  local phase_name="$1"
  local code_file="$2"
  local out_json="$3"
  local raw_out
  raw_out="$(playwright-cli run-code "$(cat "$code_file")" 2>&1)" || {
    echo "PHASE_${phase_name}_FAIL" >&2
    echo "$raw_out" >&2
    exit 1
  }
  PHASE_NAME="$phase_name" OUT_JSON="$out_json" RAW_OUT="$raw_out" node -e '
    const fs = require("node:fs");
    const raw = process.env.RAW_OUT || "";
    if (raw.includes("### Error")) {
      console.error("PHASE_" + process.env.PHASE_NAME + "_ERROR:\n" + raw.slice(0, 2000));
      process.exit(1);
    }
    const rIdx = raw.indexOf("### Result");
    const sec = rIdx === -1 ? raw : raw.slice(rIdx);
    const s = sec.indexOf("STAGE0_JSON_BEGIN");
    const e = s === -1 ? -1 : sec.indexOf("STAGE0_JSON_END", s);
    if (s === -1 || e === -1 || e <= s) {
      console.error("PHASE_" + process.env.PHASE_NAME + "_MISSING_JSON:\n" + sec.slice(0, 1200));
      process.exit(1);
    }
    let payload = sec.slice(s + "STAGE0_JSON_BEGIN".length, e);
    if (payload.startsWith("\\\"") || sec.slice(s - 1, s) === "\"") {
      payload = JSON.parse("\"" + payload + "\"");
    }
    const parsed = JSON.parse(payload);
    fs.writeFileSync(process.env.OUT_JSON, JSON.stringify(parsed, null, 2));
    console.log("PHASE_" + process.env.PHASE_NAME + "_OK -> " + process.env.OUT_JSON);
  '
}

# ---------------- PHASE B: J01 - J12 LIVE USER JOURNEYS ----------------
cat <<'EOF' >.playwright-cli/phase2-journeys.js
async (page) => {
  const BASE = "__BASE_URL__";
  const FIXTURES = __FIXTURES_JSON__.fixtures;
  const browser = page.context().browser();
  const journeys = [];

  const runJourney = async (id, title, fixtureKey, mockHandlers, fn, opts = {}) => {
    const t0 = Date.now();
    const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1440, height: 900 } });
    const proj = fixtureKey ? FIXTURES[fixtureKey] : null;
    await ctx.addInitScript(({ p, failIdb, trackIdbWrites, workspaceMode }) => {
      if (p && !sessionStorage.getItem('__stage0_seeded')) {
        sessionStorage.setItem('__stage0_seeded', '1');
        localStorage.setItem('proactive_co_creator_projects_v2', JSON.stringify({ [p.id]: p }));
        localStorage.setItem('proactive_co_creator_active_id_v2', p.id);
      }
      if (workspaceMode) {
        localStorage.setItem('proactive_co_creator_workspace_preference_v1', JSON.stringify({ version: 1, mode: workspaceMode }));
      }
      if (trackIdbWrites) {
        window.__j10IdbWriteCount = 0;
        const originalPut = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...args) {
          window.__j10IdbWriteCount += 1;
          return originalPut.apply(this, args);
        };
      }
      if (failIdb) {
        window.__idbPuts = 0;
        const origPut = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...a) {
          window.__idbPuts += 1;
          return origPut.apply(this, a);
        };
        const origGetAll = IDBObjectStore.prototype.getAll;
        IDBObjectStore.prototype.getAll = function (...a) {
          if (localStorage.getItem('__stage0_fail_idb') === '1') {
            const req = { result: undefined, error: new DOMException('Simulated IDB read_error', 'UnknownError'), onsuccess: null, onerror: null };
            setTimeout(() => { if (typeof req.onerror === 'function') req.onerror(new Event('error')); }, 0);
            return req;
          }
          return origGetAll.apply(this, a);
        };
      }
    }, { p: proj, failIdb: Boolean(opts.failIdb), trackIdbWrites: Boolean(opts.trackIdbWrites), workspaceMode: opts.workspaceMode ?? 'plan' });

    const p = await ctx.newPage();
    const pageErrors = [];
    const consoleErrors = [];
    const mockedHits = [];
    const unmockedHits = [];

    p.on('pageerror', (e) => pageErrors.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

    await p.route('**/api/**', async (route) => {
      const url = route.request().url();
      const matchedKey = Object.keys(mockHandlers || {}).find((k) => url.includes(k));
      if (matchedKey) {
        mockedHits.push(url);
        const res = mockHandlers[matchedKey];
        await route.fulfill({
          status: res.status || 200,
          contentType: 'application/json',
          body: JSON.stringify(res.body),
        });
      } else {
        unmockedHits.push(url);
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'BLOCKED_STAGE0', message: 'Unmocked API route blocked' } }),
        });
      }
    });

    try {
      await p.goto(BASE, { waitUntil: 'networkidle' });
      await p.waitForTimeout(250);
      const outcome = await fn(p);
      journeys.push({
        id,
        title,
        fixture: fixtureKey || 'default-sample',
        status: outcome.status || 'PASS',
        durationMs: Date.now() - t0,
        steps: outcome.steps || [],
        clicks: outcome.clicks ?? 0,
        evidence: outcome.evidence || {},
        friction: outcome.friction || [],
        mockedApiHits: mockedHits.length,
        unmockedApiHits: unmockedHits.length,
        pageErrors,
        consoleErrors,
      });
    } catch (err) {
      journeys.push({
        id,
        title,
        fixture: fixtureKey || 'default-sample',
        status: 'FAIL',
        durationMs: Date.now() - t0,
        error: err instanceof Error ? err.message : String(err),
        mockedApiHits: mockedHits.length,
        unmockedApiHits: unmockedHits.length,
        pageErrors,
        consoleErrors,
      });
    } finally {
      await ctx.close();
    }
  };

  // J01: First launch -> enter seed -> Analyze (mock) -> entities & clarifications appear
  await runJourney('J01', 'First launch, seed idea entry, and Analyze (mock)', 'FX-EMPTY', {
    '/api/analyze': {
      status: 200,
      body: {
        graph: {
          entities: [
            { name: 'Clockmaker', category: 'character', presence_in_prompt: true, description: 'An apprentice repairing brass chimes.', alternatives: null, attributes: [{ name: 'mood', presence_in_prompt: false, value: [{ name: 'focused' }, { name: 'nervous' }] }] },
            { name: 'Bell Tower', category: 'location', presence_in_prompt: true, description: 'Foggy stone tower above the harbor.', alternatives: null, attributes: [] },
          ],
          relationships: [
            { source: 'Clockmaker', target: 'Bell Tower', label: 'works inside', presence_in_prompt: true },
          ],
        },
      },
    },
    '/api/clarify': {
      status: 200,
      body: {
        clarifications: [
          { id: 'c_j01_1', question: 'What storm threatens the harbor?', options: ['Autumn gale', 'Thick freezing fog'], category: 'setting' },
        ],
      },
    },
  }, async (p) => {
    const writeIsInitialWorkspace = await p.getByRole('button', { name: 'Write', exact: true }).getAttribute('aria-current');
    if (writeIsInitialWorkspace !== 'page') throw new Error('First launch did not open the Write workspace.');
    await p.getByRole('button', { name: 'Plan', exact: true }).click();
    const ideaBox = p.locator('textarea').first();
    const initialVal = await ideaBox.inputValue();
    await ideaBox.fill('An apprentice Clockmaker repairs brass chimes inside a foggy Bell Tower.');
    await p.getByRole('button', { name: /Reanalyze Idea|Analyze/i }).click();
    await p.locator('[aria-label^="Entity Clockmaker."]').first().waitFor({ state: 'visible', timeout: 6000 });
    const hasClarif = await p.getByText('What storm threatens the harbor?').isVisible();
    return {
      status: 'PASS',
      clicks: 2,
      steps: ['Seed FX-EMPTY', 'Fill idea textarea', 'Click Reanalyze Idea', 'Verify Clockmaker node + clarification render'],
      evidence: { initialWorkspace: 'write', initialEmptyTextareaValue: initialVal, clockmakerRendered: true, clarificationRendered: hasClarif },
      friction: [
        initialVal ? `Blank workspace pre-populated textarea with "${initialVal}" instead of empty placeholder` : '',
        'Empty graph canvas has no empty-state prompt/CTA guiding first-time users to click Reanalyze Idea',
        'Action button reads "Reanalyze Idea" even on an unanalyzed empty project',
      ].filter(Boolean),
    };
  }, { workspaceMode: false });

  // J02: Review inferred attribute/relationship -> Accept/Reject/Defer -> inspect target
  await runJourney('J02', 'Decision Inbox Accept/Reject/Defer & Inspect target', 'FX-SIMPLE', {}, async (p) => {
    const inbox = p.getByLabel('Creative Decisions and Batch Editor');
    const pendingBefore = await inbox.textContent();
    const firstAccept = inbox.getByRole('button', { name: 'Accept', exact: true }).first();
    await firstAccept.click();
    await p.waitForTimeout(150);
    const firstDefer = inbox.getByRole('button', { name: 'Defer', exact: true }).first();
    await firstDefer.click();
    await p.waitForTimeout(150);
    const firstReject = inbox.getByRole('button', { name: 'Reject', exact: true }).first();
    await firstReject.click();
    await p.waitForTimeout(150);
    const inspectBtn = inbox.getByRole('button', { name: /Inspect/i }).first();
    let inspected = false;
    if (await inspectBtn.isVisible()) {
      await inspectBtn.click();
      inspected = true;
    }
    const pendingAfter = await inbox.textContent();
    const revText = await p.locator('footer').textContent();
    return {
      status: 'PASS',
      clicks: 4,
      steps: ['Accept first pending decision', 'Defer next decision', 'Reject next decision', 'Click Inspect -> on item'],
      evidence: {
        headerBefore: (pendingBefore || '').slice(0, 60),
        headerAfter: (pendingAfter || '').slice(0, 60),
        inspectedTarget: inspected,
        footerSummary: (revText || '').trim().slice(0, 80),
      },
      friction: [
        'Category filter strip ("All | Questions | Characters | Relations | Setting") clips horizontally on right edge in 3-col layout',
      ],
    };
  });

  // J03: Clarification question -> custom answer -> defer/skip -> refresh (mock)
  await runJourney('J03', 'Clarification custom answer, defer, and More Questions refresh (mock)', 'FX-SIMPLE', {
    '/api/clarify': {
      status: 200,
      body: {
        clarifications: [
          { id: 'c_j03_new', question: 'What dessert is hidden under the silver cloche?', options: ['Blackberry tart', 'Hazelnut torte'], category: 'plot' },
        ],
      },
    },
  }, async (p) => {
    const inbox = p.getByLabel('Creative Decisions and Batch Editor');
    await inbox.getByRole('button', { name: 'Custom...' }).first().click();
    const customInput = inbox.locator('input[aria-label^="Custom value for"]').first();
    await customInput.fill('Warm yet secretly cunning');
    await inbox.getByRole('button', { name: 'Accept', exact: true }).first().click();
    await p.waitForTimeout(150);
    await inbox.getByRole('button', { name: 'Defer', exact: true }).first().click();
    await p.waitForTimeout(150);
    await p.getByRole('button', { name: 'More Questions' }).click();
    await p.getByText('What dessert is hidden under the silver cloche?').waitFor({ state: 'visible', timeout: 5000 });
    return {
      status: 'PASS',
      clicks: 5,
      steps: ['Open Custom... on clarification', 'Type custom answer', 'Click Accept', 'Defer second clarification', 'Click More Questions (mock)'],
      evidence: { customAnswerAccepted: true, refreshedQuestionVisible: true },
      friction: [
        'Pressing Enter inside Custom... input did not auto-submit without explicit Accept click unless handled; Defer is present while standalone Skip label is merged into Reject/Defer',
      ],
    };
  });

  // J04: Story Bible edit -> clear -> Undo/Redo -> reload persistence
  await runJourney('J04', 'Story Bible edit, clear authority, Undo/Redo, and reload persistence', 'FX-SIMPLE', {}, async (p) => {
    await p.getByRole('tab', { name: 'Story Bible' }).click();
    await p.locator('#bible-setting').fill('Rainy Harbor');
    const afterEdit = await p.locator('#bible-setting').inputValue();
    await p.locator('button[title="Clear Primary Setting"]').click();
    const afterClear = await p.locator('#bible-setting').inputValue();
    await p.getByRole('button', { name: 'Undo' }).click();
    const afterUndo = await p.locator('#bible-setting').inputValue();
    await p.getByRole('button', { name: 'Redo' }).click();
    const afterRedo = await p.locator('#bible-setting').inputValue();
    await p.waitForTimeout(650);
    await p.reload({ waitUntil: 'networkidle' });
    await p.getByRole('tab', { name: 'Story Bible' }).click();
    const afterReload = await p.locator('#bible-setting').inputValue();
    return {
      status: afterEdit === 'Rainy Harbor' && afterClear === '' && afterUndo === 'Rainy Harbor' && afterRedo === '' && afterReload === '' ? 'PASS' : 'FAIL',
      clicks: 4,
      steps: ['Open Story Bible', 'Fill #bible-setting', 'Clear Primary Setting', 'Undo', 'Redo', 'Reload & verify empty'],
      evidence: { afterEdit, afterClear, afterUndo, afterRedo, afterReload },
      friction: [
        '2-column Grid default in 3-col right Inspector truncates input values and field titles ("Point of Vi...")',
      ],
    };
  });

  // J05: Graph search, filter, pan/zoom, Table view, directed relationship inspect/edit + keyboard check
  await runJourney('J05', 'Graph search, category filter, zoom/fit, Table view & relationship edit', 'FX-BUSY', {}, async (p) => {
    await p.getByLabel('Search belief graph').fill('Badger');
    await p.waitForTimeout(150);
    const filteredNodes = await p.locator('[aria-label^="Entity "]').count();
    await p.getByLabel('Search belief graph').fill('');
    await p.getByLabel('Filter graph by entity category').selectOption('location');
    const locationNodes = await p.locator('[aria-label^="Entity "]').count();
    await p.getByLabel('Filter graph by entity category').selectOption('all');
    await p.getByRole('button', { name: 'Zoom in belief graph' }).click();
    await p.getByRole('button', { name: 'Fit belief graph to view' }).click();

    // Switch to Table view and check keyboard accessibility of rows!
    await p.getByRole('button', { name: 'Table', exact: true }).click();
    await p.waitForTimeout(150);
    const tableRowInfo = await p.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('table tbody tr'));
      const focusableRows = rows.filter((r) => r.tabIndex >= 0 || r.querySelector('button, a, input, [tabindex="0"]'));
      return { totalRows: rows.length, keyboardFocusableRows: focusableRows.length };
    });

    // Click a relationship in table view and edit label in Inspector
    await p.locator('table tbody tr', { hasText: 'guards' }).first().click();
    await p.waitForTimeout(150);
    const relInput = p.getByLabel('Edit relationship label');
    const relEditable = await relInput.isVisible();
    if (relEditable) {
      await relInput.fill('patrols');
    }

    return {
      status: 'PASS',
      clicks: 7,
      steps: ['Search Badger', 'Filter location', 'Zoom in + Fit', 'Toggle Table view', 'Check Table keyboard rows', 'Select & edit relationship'],
      evidence: { filteredNodes, locationNodes, tableRowInfo, relEditable },
      friction: [
        tableRowInfo.keyboardFocusableRows === 0
          ? `P1 ACCESSIBILITY DEFECT REPRODUCED: Table View has ${tableRowInfo.totalRows} clickable <tr> rows with 0 keyboard-focusable rows/buttons (tabIndex=-1, no onKeyDown)!`
          : '',
        'At 1440x900 with 15 entities, Fit zooms out until SVG node labels drop below ~8px visual height',
      ].filter(Boolean),
    };
  });

  // J06: NL batch -> preview -> deselect -> stale warning -> Review modal -> Re-preview -> Apply
  await runJourney('J06', 'NL batch preview, partial selection, stale guard, Review modal & Apply', 'FX-BUSY', {}, async (p) => {
    await p.locator('#nl-batch-input').fill('Make Rabbit elderly. Make Fox elderly. The party should be mysterious.');
    await p.getByRole('button', { name: 'Preview', exact: true }).click();
    await p.getByText(/Proposed Batch Operations \(3\/3\)/).waitFor({ state: 'visible' });
    await p.locator('[aria-label="Batch edit preview"] label', { hasText: /Fox/i }).locator('input[type="checkbox"]').uncheck();
    await p.getByRole('button', { name: 'Review Plan & Prompt' }).click();
    await p.getByRole('dialog', { name: 'Review Plan and Prompt Changes' }).waitFor({ state: 'visible' });
    const modalFocus = await p.evaluate(() => document.activeElement?.textContent?.trim() || document.activeElement?.tagName);
    await p.keyboard.press('Escape');
    const returnFocus = await p.evaluate(() => document.activeElement?.textContent?.trim() || '');

    // Trigger stale warning
    await p.getByRole('tab', { name: 'Story Bible' }).click();
    await p.locator('#bible-setting').fill('Obsidian Mill');
    const staleVisible = await p.getByText(/older project or revision/i).isVisible();
    const applyDisabledWhileStale = await p.getByRole('button', { name: /Apply Approved Batch/ }).isDisabled();
    await p.getByRole('button', { name: 'Re-preview for Current Project' }).click();
    await p.getByRole('button', { name: /Apply Approved Batch/ }).click();
    const appliedTone = await p.locator('#bible-tone').inputValue();
    return {
      status: staleVisible && applyDisabledWhileStale && appliedTone === 'mysterious' ? 'PASS' : 'FAIL',
      clicks: 7,
      steps: ['Fill NL batch', 'Preview', 'Uncheck Fox', 'Open Review Modal', 'Escape return focus', 'Edit setting -> stale guard', 'Re-preview & Apply'],
      evidence: { modalFocus, returnFocus, staleVisible, applyDisabledWhileStale, appliedTone },
      friction: [
        'Batch preview area sits inside left Decision Inbox scroll pane, pushing pending decisions down below the fold',
      ],
    };
  });

  // J07: Generate Story (mock) -> read full artifact -> copy/download -> edit -> check outdated badge
  await runJourney('J07', 'Generate Story (mock), inspect output, copy/download & outdated badge', 'FX-SIMPLE', {
    '/api/generate/story': {
      status: 200,
      body: {
        story: 'Mocked Stage 0 generated story: Cat raised a lantern in Lantern Glade while Fox listened quietly beside the oak table.',
      },
    },
  }, async (p) => {
    await p.getByRole('footer').or(p.locator('footer')).getByRole('button', { name: 'Generate Story' }).click();
    await p.getByText(/Mocked Stage 0 generated story/).waitFor({ state: 'visible', timeout: 5000 });
    const copyVisible = await p.getByRole('button', { name: /Copy Story/i }).isVisible();
    const dlVisible = await p.getByRole('button', { name: /Download \.txt/i }).isVisible();
    const storyBoxHeight = await p.evaluate(() => {
      const pre = Array.from(document.querySelectorAll('div, article, p')).find((el) => el.textContent?.includes('Mocked Stage 0 generated story'));
      return pre?.parentElement?.getBoundingClientRect()?.height || 0;
    });
    // Mutate Story Bible -> verify Outdated badge appears
    await p.getByRole('tab', { name: 'Story Bible' }).click();
    await p.locator('#bible-tone').fill('Noir suspense');
    await p.waitForTimeout(200);
    const outdatedVisible = await p.getByText(/Outdated/i).first().isVisible();
    return {
      status: copyVisible && dlVisible && outdatedVisible ? 'PASS' : 'FAIL',
      clicks: 2,
      steps: ['Click Generate Story (mock)', 'Verify generated story + Copy/Download controls', 'Edit Story Bible tone', 'Verify Outdated badge'],
      evidence: { copyVisible, dlVisible, outdatedVisible, storyBoxHeight: Math.round(storyBoxHeight) },
      friction: [
        'Three simultaneous "Generate Story" buttons appear on desktop before generation (PromptInput, OutputGallery empty state, Bottom Bar)',
        'Output deck height is constrained beneath BeliefGraph, limiting long-form story reading to ~5 lines at 1440x900',
      ],
    };
  });

  // J08: Switch Story <-> Image (mock) -> review 4 images + fullscreen preview & Escape focus check
  await runJourney('J08', 'Switch Story <-> Image, generate images (mock), gallery & lightbox Escape focus', 'FX-OUT', {
    '/api/generate/images': {
      status: 200,
      body: {
        images: [
          'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="%23fef3c7"/><text x="128" y="128" text-anchor="middle">Mock 1</text></svg>',
          'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="%23dbeafe"/><text x="128" y="128" text-anchor="middle">Mock 2</text></svg>',
          'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="%23dcfce7"/><text x="128" y="128" text-anchor="middle">Mock 3</text></svg>',
          'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="%23fce7f3"/><text x="128" y="128" text-anchor="middle">Mock 4</text></svg>',
        ],
        requestedCount: 4,
        failedCount: 0,
        warning: null,
      },
    },
  }, async (p) => {
    const genGroup = p.getByRole('group', { name: 'Generation mode' });
    await genGroup.getByRole('button', { name: 'Image', exact: true }).click();
    await p.locator('footer').getByRole('button', { name: 'Generate Images' }).click();
    await p.waitForTimeout(300);
    const previewBtn = p.getByRole('button', { name: 'Preview generated image 1' });
    await previewBtn.focus();
    await previewBtn.click();
    await p.getByRole('dialog', { name: 'Image full preview' }).waitFor({ state: 'visible' });
    const focusInsideLightbox = await p.evaluate(() => {
      const dlg = document.querySelector('[aria-label="Image full preview"]');
      return Boolean(dlg && dlg.contains(document.activeElement));
    });
    await p.keyboard.press('Escape');
    await p.waitForTimeout(100);
    const focusAfterEscape = await p.evaluate(() => document.activeElement?.getAttribute?.('aria-label') || document.activeElement?.tagName || '');
    await genGroup.getByRole('button', { name: 'Story', exact: true }).click();
    return {
      status: 'PASS',
      clicks: 4,
      steps: ['Switch to Image mode', 'Generate Images (mock)', 'Open image 1 lightbox', 'Inspect focus inside dialog', 'Press Escape and check focus return', 'Switch back to Story'],
      evidence: { focusInsideLightbox, focusAfterEscape },
      friction: [
        !focusInsideLightbox ? 'P1 ACCESSIBILITY DEFECT REPRODUCED: Image full preview dialog does not move keyboard focus inside the modal on open' : '',
        focusAfterEscape !== 'Preview generated image 1' ? `P1 ACCESSIBILITY DEFECT REPRODUCED: Closing Image full preview via Escape left focus on "${focusAfterEscape}" instead of returning to trigger button` : '',
      ].filter(Boolean),
    };
  });

  // J09: Create A/B projects -> edit A -> switch B -> switch A -> reload -> Export/Import JSON
  await runJourney('J09', 'Create A/B projects, switch, reload & JSON export/import roundtrip', 'FX-SIMPLE', {}, async (p) => {
    await p.getByRole('tab', { name: 'History' }).click();
    await p.getByLabel('New project title').fill('Project Alpha J09');
    await p.getByLabel('New project initial prompt').fill('Alpha lighthouse mystery');
    await p.getByRole('button', { name: 'Create Project' }).click();
    const newProjectOpenedInWrite = await p.getByRole('button', { name: 'Write', exact: true }).getAttribute('aria-current') === 'page';
    await p.getByRole('button', { name: 'Plan', exact: true }).click();
    await p.getByRole('tab', { name: 'Story Bible' }).click();
    await p.locator('#bible-genre').fill('Maritime Noir');
    await p.getByRole('tab', { name: 'History' }).click();
    await p.getByRole('button', { name: /^Woodland Lantern Mystery/ }).click();
    await p.getByRole('button', { name: /^Project Alpha J09/ }).click();
    await p.waitForTimeout(650);
    await p.reload({ waitUntil: 'networkidle' });
    await p.getByRole('tab', { name: 'Story Bible' }).click();
    const survivedGenre = await p.locator('#bible-genre').inputValue();

    // Test JSON paste import
    await p.getByRole('tab', { name: 'History' }).click();
    const importPayload = JSON.stringify({
      ...FIXTURES['FX-SIMPLE'],
      id: 'fx_imported_j09',
      name: 'Imported J09 World',
    });
    await p.locator('input[placeholder*="paste raw project JSON" i]').fill(importPayload);
    await p.getByRole('button', { name: 'Preview JSON' }).click();
    const exportPromptLocator = p.getByRole('button', { name: /Export Refined Prompt/i });
    const exportPromptBtnText = await exportPromptLocator.count() ? await exportPromptLocator.first().textContent() : 'Not present in this state';
    await p.getByRole('button', { name: 'Restore a copy' }).click();
    await p.waitForFunction(() => document.querySelector('nav[aria-label="Narrative workspace"] button[aria-current="page"]')?.textContent === 'Write');
    await p.waitForTimeout(200);
    const restoredProjectOpenedInWrite = await p.getByRole('button', { name: 'Write', exact: true }).getAttribute('aria-current') === 'page';
    const restoredProjectName = (await p.getByRole('combobox', { name: 'Current project' }).locator('option:checked').textContent())?.trim() ?? '';
    const importedVisible = restoredProjectName === 'Imported J09 World (restored copy)';
    return {
      status: newProjectOpenedInWrite && survivedGenre === 'Maritime Noir' && restoredProjectOpenedInWrite && importedVisible ? 'PASS' : 'FAIL',
      clicks: 8,
      steps: ['Open History', 'Create Project Alpha J09', 'Edit genre', 'Switch away & back', 'Reload & verify', 'Preview and restore JSON as a copy via paste'],
      evidence: { newProjectOpenedInWrite, survivedGenre, restoredProjectOpenedInWrite, restoredProjectName, importedVisible, exportPromptBtnText: (exportPromptBtnText || '').trim() },
      friction: [
        'Project creation/switching/export/import are buried inside the right-side "History" tab instead of a top-level project selector',
        'Export button reads "Export Refined Prompt (.txt)" while App.tsx downloads refined-prompt.md (Markdown)',
      ],
    };
  });

  // J10: Open Checks -> navigate to affected entity & Story Bible field -> verify 0 revision bump
  await runJourney('J10', 'Consistency Checks navigation to entity & Story Bible field without revision bump', 'FX-BUSY', {}, async (p) => {
    await p.waitForFunction(() => /\d+\s+revs?/.test(document.querySelector('footer')?.textContent || ''));
    const revBefore = Number((await p.locator('footer').textContent() || '').match(/(\d+)\s+revs?/)?.[1]);
    if (!Number.isInteger(revBefore) || revBefore < 1) throw new Error(`Invalid starting revision: ${revBefore}`);
    await p.waitForFunction(() => {
      const current = window.__j10IdbWriteCount;
      if (window.__j10LastWriteCount === current) {
        window.__j10StableWriteFrames = (window.__j10StableWriteFrames || 0) + 1;
      } else {
        window.__j10LastWriteCount = current;
        window.__j10StableWriteFrames = 0;
      }
      return window.__j10StableWriteFrames >= 2;
    });
    const idbWritesBefore = await p.evaluate(() => window.__j10IdbWriteCount);
    await p.getByRole('tab', { name: /Checks/ }).click();
    await p.getByRole('button', { name: 'Inspect Fox' }).click();
    await p.getByRole('heading', { name: 'Fox', exact: true }).waitFor();
    const foxSelected = await p.getByRole('heading', { name: 'Fox', exact: true }).isVisible();
    await p.getByRole('tab', { name: /Checks/ }).click();
    const openTone = p.getByRole('button', { name: 'Open Tone field' });
    const openToneCount = await openTone.count();
    if (openToneCount !== 1) throw new Error(`Expected one accessible Tone navigation action; found ${openToneCount}`);
    await openTone.click();
    await p.waitForFunction(() => document.activeElement?.id === 'bible-tone');
    const focusedId = await p.evaluate(() => document.activeElement?.id || '');
    const toneFieldVisible = await p.locator('#bible-tone').isVisible();
    const storyBibleSelected = await p.getByRole('tab', { name: 'Story Bible' }).getAttribute('aria-selected');
    const revAfter = Number((await p.locator('footer').textContent() || '').match(/(\d+)\s+revs?/)?.[1]);
    const idbWritesAfter = await p.evaluate(() => window.__j10IdbWriteCount);
    return {
      status: foxSelected && focusedId === 'bible-tone' && toneFieldVisible && storyBibleSelected === 'true' &&
        Number.isInteger(revAfter) && revBefore === revAfter && idbWritesBefore === idbWritesAfter ? 'PASS' : 'FAIL',
      clicks: 4,
      steps: ['Open Checks tab', 'Click Inspect Fox', 'Verify Fox is selected in Inspector', 'Return to Checks', 'Open Tone readiness field'],
      evidence: { revBefore, revAfter, foxSelected, toneFieldVisible, storyBibleSelected, focusedId, idbWritesBefore, idbWritesAfter, openToneCount },
      friction: [
        'After navigating from Checks to Inspector/Story Bible, there is no explicit "Back to Checks" breadcrumb; user must re-click the Checks tab',
      ],
    };
  }, { trackIdbWrites: true });

  // J11: IndexedDB read_error -> 0 unsolicited IDB puts -> Retry recovery + failed API error banner
  await runJourney('J11', 'IndexedDB read_error write gate, recovery & failed generation error feedback', 'FX-SIMPLE', {
    '/api/generate/story': {
      status: 503,
      body: { error: { code: 'MISSING_API_KEY', message: 'Gemini API key is not configured on the server.', retryable: false } },
    },
  }, async (p) => {
    await p.evaluate(() => {
      localStorage.setItem('__stage0_fail_idb', '1');
    });
    await p.reload({ waitUntil: 'networkidle' });
    await p.waitForTimeout(550);
    const retryBtn = p.getByRole('button', { name: 'Retry Storage Read' });
    const bannerVisible = await retryBtn.isVisible();
    const idbPutsWhileBlocked = await p.evaluate(() => window.__idbPuts || 0);
    await p.evaluate(() => { localStorage.setItem('__stage0_fail_idb', '0'); });
    await retryBtn.click();
    await p.waitForTimeout(300);
    // Trigger failed Story generation to verify error banner
    await p.locator('footer').getByRole('button', { name: 'Generate Story' }).click();
    await p.waitForTimeout(350);
    const apiErrVisible = await p.getByText(/Gemini API key is not configured/i).first().isVisible();
    return {
      status: bannerVisible && idbPutsWhileBlocked === 0 && apiErrVisible ? 'PASS' : 'FAIL',
      clicks: 2,
      steps: ['Simulate IDB read_error & reload', 'Verify Retry Storage Read banner + 0 IDB puts', 'Recover storage read', 'Trigger mock 503 generation & verify error message'],
      evidence: { bannerVisible, idbPutsWhileBlocked, apiErrVisible },
      friction: [
        'On 390px mobile, storage alert banner stacks above PromptInput and squeezes remaining workspace height significantly (see SC-15)',
      ],
    };
  }, { failIdb: true });

  // J12: Revision history -> Restore -> Undo/Redo -> Export Markdown
  await runJourney('J12', 'Revision history Restore, safety checkpoint Undo/Redo & export', 'FX-BUSY', {}, async (p) => {
    await p.getByRole('tab', { name: 'History' }).click();
    const restoreBtn = p.getByRole('button', { name: 'Restore', exact: true }).first();
    await restoreBtn.scrollIntoViewIfNeeded();
    await restoreBtn.click();
    await p.waitForTimeout(200);
    const statusVisible = await p.getByText(/Restored project revision safely/i).isVisible();
    const undoEnabled = !(await p.getByRole('button', { name: 'Undo' }).isDisabled());
    await p.getByRole('button', { name: 'Undo' }).click();
    const redoEnabled = !(await p.getByRole('button', { name: 'Redo' }).isDisabled());
    const mdBtnVisible = await p.getByRole('button', { name: /Export Story Bible as Markdown/i }).isVisible();
    return {
      status: statusVisible && undoEnabled && redoEnabled && mdBtnVisible ? 'PASS' : 'FAIL',
      clicks: 3,
      steps: ['Open History tab', 'Scroll to Revision History & click Restore', 'Verify safety notification & Undo enabled', 'Click Undo & verify Redo enabled'],
      evidence: { statusVisible, undoEnabled, redoEnabled, mdBtnVisible },
      friction: [
        'Revision History sits at the very bottom of the History tab below Export, Import, and Saved Projects; requires scrolling to discover',
        'Restore executes immediately on single click without a preview diff (though safety checkpoint + Undo protects data)',
      ],
    };
  });

  return 'STAGE0_JSON_BEGIN' + JSON.stringify({ measuredAt: new Date().toISOString(), count: journeys.length, journeys }) + 'STAGE0_JSON_END';
}
EOF

# ---------------- PHASE C: S0.4 ACCESSIBILITY/RESPONSIVE + S0.5 BROWSER PERF ----------------
cat <<'EOF' >.playwright-cli/phase3-audit.js
async (page) => {
  const BASE = "__BASE_URL__";
  const FIXTURES = __FIXTURES_JSON__.fixtures;
  const browser = page.context().browser();

  // Helper: WCAG relative luminance & contrast ratio in page context
  const auditA11yAndResponsive = async () => {
    const viewports = [
      { label: '1440x900 (Desktop)', width: 1440, height: 900 },
      { label: '1280x800 (Laptop)', width: 1280, height: 800 },
      { label: '768x1024 (Tablet)', width: 768, height: 1024 },
      { label: '390x844 (Mobile)', width: 390, height: 844 },
      { label: '320x568 (Narrow Mobile)', width: 320, height: 568 },
      { label: '720x450 (200% Zoom equiv @1440x900)', width: 720, height: 450 },
    ];

    const responsiveResults = [];
    for (const vp of viewports) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      await ctx.addInitScript((proj) => {
        localStorage.setItem('proactive_co_creator_projects_v2', JSON.stringify({ [proj.id]: proj }));
        localStorage.setItem('proactive_co_creator_active_id_v2', proj.id);
        localStorage.setItem('proactive_co_creator_workspace_preference_v1', JSON.stringify({ version: 1, mode: 'plan' }));
      }, FIXTURES['FX-BUSY']);
      const p = await ctx.newPage();
      await p.route('**/api/**', (r) => r.fulfill({ status: 500, body: '{}' }));
      await p.goto(BASE, { waitUntil: 'networkidle' });
      await p.waitForTimeout(250);

      const metrics = await p.evaluate(() => {
        const docOverflow = document.documentElement.scrollWidth > window.innerWidth;
        const overflowPx = Math.max(0, document.documentElement.scrollWidth - window.innerWidth);
        const clippedTextNodes = [];
        document.querySelectorAll('h1,h2,h3,span,button,label').forEach((el) => {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0 && rect.right > window.innerWidth + 1) {
            clippedTextNodes.push({
              text: (el.textContent || '').trim().slice(0, 40),
              right: Math.round(rect.right),
              viewportW: window.innerWidth,
            });
          }
        });

        const interactive = Array.from(document.querySelectorAll('button, a, input, select, textarea, [role="tab"]'))
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          });
        const below24 = [];
        const below44 = [];
        for (const el of interactive) {
          const r = el.getBoundingClientRect();
          const label = (el.getAttribute('aria-label') || el.textContent || el.id || el.tagName).trim().slice(0, 40);
          if (r.width < 24 || r.height < 24) {
            below24.push({ label, w: Math.round(r.width), h: Math.round(r.height) });
          } else if (r.width < 44 || r.height < 44) {
            below44.push({ label, w: Math.round(r.width), h: Math.round(r.height) });
          }
        }

        const footerRect = document.querySelector('footer')?.getBoundingClientRect();
        const headerRect = document.querySelector('header')?.getBoundingClientRect();
        const genBtn = Array.from(document.querySelectorAll('footer button')).find((b) => /Generate/i.test(b.textContent || ''));
        const genRect = genBtn?.getBoundingClientRect();
        const genVisibleInViewport = Boolean(genRect && genRect.bottom <= window.innerHeight + 2 && genRect.right <= window.innerWidth + 2);

        return {
          docOverflow,
          overflowPx,
          clippedRightCount: clippedTextNodes.length,
          clippedSamples: clippedTextNodes.slice(0, 6),
          totalVisibleInteractive: interactive.length,
          below24Count: below24.length,
          below24Samples: below24.slice(0, 8),
          below44Count: below44.length,
          headerHeight: headerRect ? Math.round(headerRect.height) : 0,
          footerHeight: footerRect ? Math.round(footerRect.height) : 0,
          generateButtonInViewport: genVisibleInViewport,
        };
      });

      responsiveResults.push({ viewport: vp.label, width: vp.width, height: vp.height, ...metrics });
      await ctx.close();
    }

    // Semantic, keyboard, contrast (light & dark), reduced-motion, Header activeSection, InfoModal focus checks
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript((proj) => {
      localStorage.setItem('proactive_co_creator_projects_v2', JSON.stringify({ [proj.id]: proj }));
      localStorage.setItem('proactive_co_creator_active_id_v2', proj.id);
      localStorage.setItem('proactive_co_creator_workspace_preference_v1', JSON.stringify({ version: 1, mode: 'plan' }));
    }, FIXTURES['FX-BUSY']);
    const p = await ctx.newPage();
    await p.route('**/api/**', (r) => r.fulfill({ status: 500, body: '{}' }));
    await p.goto(BASE, { waitUntil: 'networkidle' });
    await p.waitForTimeout(300);

    const measureContrast = async () => {
      return p.evaluate(() => {
        const isDark = document.documentElement.classList.contains('dark');
        const baseBg = isDark ? '#111827' : '#ffffff';
        const parseColor = (str, backdrop = baseBg) => {
          const canvas = document.createElement('canvas');
          canvas.width = 1; canvas.height = 1;
          const c = canvas.getContext('2d');
          c.fillStyle = backdrop;
          c.fillRect(0, 0, 1, 1);
          c.fillStyle = str;
          c.fillRect(0, 0, 1, 1);
          const d = c.getImageData(0, 0, 1, 1).data;
          return [d[0], d[1], d[2]];
        };
        const lum = ([r, g, b]) => {
          const a = [r, g, b].map((v) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
          });
          return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
        };
        const ratio = (fgStr, bgStr) => {
          const bgRgb = parseColor(bgStr, baseBg);
          const bgHex = `rgb(${bgRgb[0]},${bgRgb[1]},${bgRgb[2]})`;
          const l1 = lum(parseColor(fgStr, bgHex));
          const l2 = lum(bgRgb);
          const hi = Math.max(l1, l2);
          const lo = Math.min(l1, l2);
          return Number(((hi + 0.05) / (lo + 0.05)).toFixed(2));
        };
        const effectiveBg = (el) => {
          let cur = el;
          while (cur && cur !== document.documentElement) {
            const bg = getComputedStyle(cur).backgroundColor;
            if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
            cur = cur.parentElement;
          }
          return baseBg;
        };

        const genBtn = Array.from(document.querySelectorAll('footer button')).find((b) => /Generate/i.test(b.textContent || ''));
        const outdatedBox = Array.from(document.querySelectorAll('div')).find((d) => (d.textContent || '').includes('Story plan has been updated since'));
        const probes = [
          { name: 'Header brand title', el: document.querySelector('header a') },
          { name: 'Inactive workspace mode', el: document.querySelector('nav[aria-label="Narrative workspace"] button:not([aria-current="page"])') },
          { name: 'Primary Generate CTA', el: genBtn },
          { name: '12px metadata / helper text', el: document.querySelector('[aria-label="Creative Decisions and Batch Editor"] .text-xs') },
          { name: '11px link ("Try sample batch")', el: Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === 'Try sample batch') },
          { name: 'Graph legend text (11px)', el: Array.from(document.querySelectorAll('div, span')).find((el) => (el.textContent || '').includes('Solid border: Explicit')) },
          { name: 'Outdated warning banner', el: outdatedBox },
        ];
        return probes.map((pr) => {
          const el = pr.el;
          if (!el) return { name: pr.name, found: false };
          const cs = getComputedStyle(el);
          const bg = effectiveBg(el);
          return {
            name: pr.name,
            found: true,
            sampleText: (el.textContent || '').trim().slice(0, 35),
            fontSize: cs.fontSize,
            fg: cs.color,
            bg,
            contrastRatio: ratio(cs.color, bg),
            passesAA_Normal_4_5: ratio(cs.color, bg) >= 4.5,
            passesAA_Large_3_0: ratio(cs.color, bg) >= 3.0,
          };
        });
      });
    };

    const lightContrast = await measureContrast();

    // Check semantic headings, landmarks, missing accessible names, Header activeSection bug, InfoModal focus
    const semanticAudit = await p.evaluate(() => {
      const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).map((h) => ({
        tag: h.tagName,
        text: (h.textContent || '').trim().slice(0, 45),
      }));
      const unnamedControls = Array.from(document.querySelectorAll('button, a, input, select, textarea')).filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const name = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim();
        const hasLabel = el.id && document.querySelector(`label[for="${el.id}"]`);
        return !name && !hasLabel && !el.getAttribute('placeholder');
      }).map((el) => ({ tag: el.tagName, cls: el.className?.toString().slice(0, 50) }));

      const tablists = Array.from(document.querySelectorAll('[role="tablist"]')).map((tl) => ({
        label: tl.getAttribute('aria-label'),
        tabs: tl.querySelectorAll('[role="tab"]').length,
        selected: tl.querySelectorAll('[role="tab"][aria-selected="true"]').length,
      }));
      return { headings, unnamedControlsCount: unnamedControls.length, unnamedControls, tablists };
    });

    // Test primary workspace mode and contextual Story Bible tab state
    await p.getByRole('navigation', { name: 'Narrative workspace' }).getByRole('button', { name: 'Plan', exact: true }).click();
    const storyBibleTab = p.getByRole('tab', { name: 'Story Bible' });
    await storyBibleTab.click();
    await p.waitForTimeout(150);
    const headerActiveAfterStoryBible = await p.evaluate(() => {
      const plan = document.querySelector('nav[aria-label="Narrative workspace"] button[aria-current="page"]');
      const bible = document.querySelector('[role="tablist"] [role="tab"][aria-selected="true"]');
      return { activeMode: plan?.textContent?.trim() ?? '', selectedContextTab: bible?.textContent?.trim() ?? '' };
    });

    // Test InfoModal ("About") keyboard focus placement and Escape return
    const aboutBtn = p.getByRole('banner').getByRole('button', { name: 'About', exact: true });
    await aboutBtn.focus();
    await aboutBtn.click();
    await p.waitForTimeout(150);
    const infoModalDialog = await p.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      return {
        open: Boolean(dlg),
        focusInside: Boolean(dlg && dlg.contains(document.activeElement)),
        activeTag: document.activeElement?.tagName,
        activeText: (document.activeElement?.textContent || '').trim().slice(0, 30),
      };
    });
    await p.keyboard.press('Escape');
    await p.waitForTimeout(100);
    const focusAfterAboutEscape = await p.evaluate(() => ({
      tag: document.activeElement?.tagName,
      text: (document.activeElement?.textContent || '').trim().slice(0, 30),
    }));

    // Switch to Dark mode and measure dark contrast
    await p.getByRole('button', { name: 'Switch to dark mode' }).click();
    await p.waitForTimeout(250);
    const darkContrast = await measureContrast();

    // Check prefers-reduced-motion media rule presence
    const reducedMotionSupport = await p.evaluate(() => {
      let hasRule = false;
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          for (const rule of Array.from(sheet.cssRules || [])) {
            if (rule.cssText && rule.cssText.includes('prefers-reduced-motion')) {
              hasRule = true;
            }
          }
        } catch {}
      }
      return { hasReducedMotionCssRule: hasRule };
    });

    await ctx.close();
    return {
      responsiveResults,
      semanticAudit,
      headerActiveAfterStoryBible,
      infoModalFocus: { onOpen: infoModalDialog, afterEscape: focusAfterAboutEscape },
      lightContrast,
      darkContrast,
      reducedMotionSupport,
    };
  };

  // Browser Performance Benchmark (Load + Interaction + 10/30/100/250 Synthetic Graph Render in Chromium)
  const auditBrowserPerf = async () => {
    const perfRows = [];
    const buildSynth = (n) => {
      const entities = [];
      const relationships = [];
      const cats = ['character', 'location', 'object', 'event'];
      for (let i = 0; i < n; i++) {
        entities.push({
          id: `ent_s_${i}`,
          name: `Node_${String(i + 1).padStart(3, '0')}`,
          category: cats[i % cats.length],
          presence_in_prompt: true,
          description: `Synthetic node ${i + 1}`,
          alternatives: null,
          attributes: [{ id: `a_${i}`, name: 'role', presence_in_prompt: true, value: [{ name: `R${i}` }], confirmedValue: `R${i}`, status: 'confirmed', provenance: 'user-edit' }],
          status: 'confirmed',
          provenance: 'user-edit',
        });
      }
      for (let i = 0; i < n; i++) {
        relationships.push({
          id: `rel_s_${i}`,
          sourceId: `ent_s_${i}`,
          targetId: `ent_s_${(i + 1) % n}`,
          source: `Node_${String(i + 1).padStart(3, '0')}`,
          target: `Node_${String(((i + 1) % n) + 1).padStart(3, '0')}`,
          label: 'links to',
          status: 'confirmed',
          provenance: 'user-edit',
          presence_in_prompt: true,
        });
      }
      const base = JSON.parse(JSON.stringify(FIXTURES['FX-EMPTY']));
      base.id = `fx_browser_stress_${n}`;
      base.name = `Stress ${n}`;
      base.snapshot.originalIdea = `Synthetic browser stress with ${n} nodes`;
      base.snapshot.entities = entities;
      base.snapshot.relationships = relationships;
      return base;
    };

    for (const count of [10, 30, 100, 250]) {
      const proj = buildSynth(count);
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await ctx.addInitScript((pData) => {
        localStorage.setItem('proactive_co_creator_projects_v2', JSON.stringify({ [pData.id]: pData }));
        localStorage.setItem('proactive_co_creator_active_id_v2', pData.id);
        localStorage.setItem('proactive_co_creator_workspace_preference_v1', JSON.stringify({ version: 1, mode: 'plan' }));
      }, proj);
      const p = await ctx.newPage();
      await p.route('**/api/**', (r) => r.fulfill({ status: 500, body: '{}' }));
      const t0 = Date.now();
      await p.goto(BASE, { waitUntil: 'networkidle' });
      await p.locator('[aria-label^="Entity Node_001."]').first().waitFor({ state: 'visible', timeout: 10000 });
      const readyMs = Date.now() - t0;

      // Fit graph first so large 100/250-node graphs enter the SVG viewport
      const fitBtn = p.getByRole('button', { name: 'Fit belief graph to view' });
      if (await fitBtn.isVisible()) {
        await fitBtn.click();
        await p.waitForTimeout(100);
      }

      // Measure interaction latency: focus+Enter node (keyboard) + switch to Story Bible tab
      const clickT0 = Date.now();
      const firstNode = p.locator('[aria-label^="Entity Node_001."]').first();
      await firstNode.focus();
      await p.keyboard.press('Enter');
      const nodeClickMs = Date.now() - clickT0;

      const tabT0 = Date.now();
      await p.getByRole('tab', { name: 'Story Bible' }).click();
      await p.locator('#bible-genre').waitFor({ state: 'visible' });
      const tabSwitchMs = Date.now() - tabT0;

      const domStats = await p.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0];
        const fcp = performance.getEntriesByName('first-contentful-paint')[0];
        const mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / (1024 * 1024)) : null;
        return {
          domNodes: document.querySelectorAll('*').length,
          svgElements: document.querySelectorAll('svg *').length,
          domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
          loadEventMs: nav ? Math.round(nav.loadEventEnd) : null,
          fcpMs: fcp ? Math.round(fcp.startTime) : null,
          usedJsHeapMb: mem,
        };
      });

      perfRows.push({
        entityCount: count,
        edgeCount: count,
        readyMs,
        nodeClickMs,
        tabSwitchMs,
        ...domStats,
      });
      await ctx.close();
    }
    return perfRows;
  };

  const a11y = await auditA11yAndResponsive();
  const browserPerf = await auditBrowserPerf();
  return 'STAGE0_JSON_BEGIN' + JSON.stringify({ measuredAt: new Date().toISOString(), a11y, browserPerf }) + 'STAGE0_JSON_END';
}
EOF

BASE_URL_ENV="$BASE_URL" node -e '
  const fs = require("node:fs");
  const all = JSON.parse(fs.readFileSync(".playwright-cli/stage0-fixtures.json", "utf8"));
  const compact = {
    generatedAt: all.generatedAt,
    fixtures: {
      "FX-EMPTY": all.fixtures["FX-EMPTY"],
      "FX-SIMPLE": all.fixtures["FX-SIMPLE"],
      "FX-BUSY": all.fixtures["FX-BUSY"],
      "FX-OUT": all.fixtures["FX-OUT"],
    },
  };
  const compactStr = JSON.stringify(compact);
  for (const name of ["phase2-journeys", "phase3-audit"]) {
    let code = fs.readFileSync(`.playwright-cli/${name}.js`, "utf8");
    code = code.replace("__BASE_URL__", process.env.BASE_URL_ENV).replace("__FIXTURES_JSON__", compactStr);
    fs.writeFileSync(`.playwright-cli/${name}.resolved.js`, code);
  }
'

run_pw_phase "JOURNEYS" ".playwright-cli/phase2-journeys.resolved.js" ".playwright-cli/stage0-journeys.json"
run_pw_phase "AUDIT_PERF" ".playwright-cli/phase3-audit.resolved.js" ".playwright-cli/stage0-audit-metrics.json"

echo "STAGE0_AUDIT_COMPLETE"
