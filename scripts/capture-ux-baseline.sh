#!/usr/bin/env bash
set -euo pipefail

# Stage 0 Reproducible Visual Capture, User Journey (J01-J12),
# Accessibility/Responsive & Browser Performance Harness
# Strictly non-billable: key-free production server + Playwright **/api/** trap.

if ! command -v playwright-cli >/dev/null 2>&1; then
  echo "playwright-cli not found on PATH" >&2
  exit 1
fi

PORT_TO_USE="${STAGE0_PORT:-3100}"
BASE_URL="${E2E_BASE_URL:-http://127.0.0.1:${PORT_TO_USE}}"
BASELINE_DIR="${UX_BASELINE_DIR:-.playwright-cli/ux-baseline}"
ASSETS_DIR="${BASELINE_DIR}/assets"
SESSION_NAME="pcc-ux-$$"
STARTED_SERVER=0
SERVER_PID=""

cleanup() {
  playwright-cli -s="$SESSION_NAME" close >/dev/null 2>&1 || true
  if [ "$STARTED_SERVER" -eq 1 ] && [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

mkdir -p .playwright-cli "$ASSETS_DIR"

# 1. Generate deterministic schema-v3 fixtures via real canonicalModel / storageEngine paths
npx --yes tsx scripts/stage0-fixtures.ts .playwright-cli/stage0-fixtures.json

# 2. Start key-free production server if E2E_BASE_URL not explicitly supplied
if [ -z "${E2E_BASE_URL:-}" ]; then
  if [ ! -d dist ]; then
    npm run build
  fi
  env -u GEMINI_API_KEY -u API_KEY NODE_ENV=production PORT="$PORT_TO_USE" node --experimental-strip-types server.ts >.playwright-cli/stage0-server.log 2>&1 &
  SERVER_PID=$!
  STARTED_SERVER=1
  for _ in $(seq 1 40); do
    if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
      echo "ERROR: Stage 0 capture server exited prematurely." >&2
      cat .playwright-cli/stage0-server.log >&2 || true
      exit 1
    fi
    if curl -sf "$BASE_URL/api/health" >/dev/null; then
      break
    fi
    sleep 0.25
  done
fi

HEALTH_JSON="$(curl -sf "$BASE_URL/api/health")"
echo "STAGE0_HEALTH: $HEALTH_JSON"
echo "$HEALTH_JSON" | grep -q '"configured":false' || {
  echo "ERROR: Stage 0 capture requires a key-free server (configured:false)." >&2
  exit 1
}

playwright-cli -s="$SESSION_NAME" open --browser=chromium "$BASE_URL/api/health" >/dev/null

# Helper to run a playwright-cli run-code file with JSON extraction
run_pw_phase() {
  local phase_name="$1"
  local code_file="$2"
  local out_json="$3"
  local raw_out
  raw_out="$(playwright-cli -s="$SESSION_NAME" run-code "$(cat "$code_file")" 2>&1)" || {
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

# Build Phase 1 (SC-01..SC-16) script with embedded fixtures
FIXTURES_JSON="$(cat .playwright-cli/stage0-fixtures.json)"

cat <<'EOF' >.playwright-cli/phase1-captures.js
async (page) => {
  const BASE = "__BASE_URL__";
  const FIXTURES = __FIXTURES_JSON__.fixtures;
  const browser = page.context().browser();
  const captures = [];

  const openSeeded = async (fixtureKey, viewport, opts = {}) => {
    const project = FIXTURES[fixtureKey];
    const ctx = await browser.newContext({
      viewport,
      deviceScaleFactor: opts.dpr || 1,
      reducedMotion: opts.reducedMotion || 'no-preference',
    });
    await ctx.addInitScript(({ proj, failIdb, darkMode }) => {
      try {
        if (proj) {
          const map = { [proj.id]: proj };
          localStorage.setItem('proactive_co_creator_projects_v2', JSON.stringify(map));
          localStorage.setItem('proactive_co_creator_active_id_v2', proj.id);
        }
        localStorage.setItem('proactive_co_creator_workspace_preference_v1', JSON.stringify({ version: 1, mode: 'plan' }));
        if (darkMode) {
          localStorage.setItem('theme', 'dark');
          document.documentElement.classList.add('dark');
        } else {
          localStorage.setItem('theme', 'light');
          document.documentElement.classList.remove('dark');
        }
      } catch {}
      if (failIdb) {
        const origGetAll = IDBObjectStore.prototype.getAll;
        IDBObjectStore.prototype.getAll = function (...args) {
          const fakeReq = {
            result: undefined,
            error: new DOMException('Simulated IDB read_error for FX-ERROR', 'UnknownError'),
            onsuccess: null,
            onerror: null,
          };
          setTimeout(() => {
            if (typeof fakeReq.onerror === 'function') fakeReq.onerror(new Event('error'));
          }, 0);
          return fakeReq;
        };
      }
    }, { proj: project, failIdb: Boolean(opts.failIdb), darkMode: Boolean(opts.darkMode) });

    const p = await ctx.newPage();
    const unmockedApiHits = [];
    const pageErrors = [];
    const consoleErrors = [];
    p.on('pageerror', (e) => pageErrors.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    await p.route('**/api/**', async (route) => {
      unmockedApiHits.push(route.request().url());
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'BLOCKED_CAPTURE', message: 'Zero paid calls in capture' } }),
      });
    });
    await p.goto(BASE, { waitUntil: 'networkidle' });
    await p.waitForTimeout(350);
    return { ctx, p, unmockedApiHits, pageErrors, consoleErrors };
  };

  const snap = async (id, fixture, viewport, stateDesc, actionSeq, setupFn, opts = {}) => {
    const { ctx, p, unmockedApiHits, pageErrors, consoleErrors } = await openSeeded(fixture, viewport, opts);
    try {
      let extra = {};
      if (setupFn) {
        extra = (await setupFn(p)) || {};
      }
      await p.waitForTimeout(200);
      const filePath = `__ASSETS_DIR__/${id}.png`;
      await p.screenshot({ path: filePath, fullPage: false });
      const activeEl = await p.evaluate(() => ({
        tag: document.activeElement?.tagName || '',
        id: document.activeElement?.id || '',
        ariaLabel: document.activeElement?.getAttribute?.('aria-label') || '',
        scrollOverflow: document.documentElement.scrollWidth > window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      captures.push({
        id,
        fixture,
        viewport: `${viewport.width}x${viewport.height}`,
        dpr: opts.dpr || 1,
        theme: opts.darkMode ? 'dark' : 'light',
        state: stateDesc,
        actions: actionSeq,
        path: filePath,
        unmockedApiHits: unmockedApiHits.length,
        pageErrors,
        consoleErrors,
        focusAndOverflow: activeEl,
        ...extra,
      });
    } finally {
      await ctx.close();
    }
  };

  // SC-01: Empty first launch
  await snap('SC-01', 'FX-EMPTY', { width: 1440, height: 900 },
    'First launch / empty workspace idea entry',
    ['seed FX-EMPTY', 'load workspace'],
    async (p) => {
      const textareaVisible = await p.locator('textarea').first().isVisible();
      return { domAnchor: `ideaTextareaVisible=${textareaVisible}` };
    }
  );

  // SC-02: Decision Inbox with pending/confirmed
  await snap('SC-02', 'FX-SIMPLE', { width: 1440, height: 900 },
    'Decision Inbox showing pending AI inferences vs confirmed items',
    ['seed FX-SIMPLE', 'click Inbox', 'inspect left Decision Inbox'],
    async (p) => {
      const inboxToggle = p.getByRole('button', { name: /Inbox/ });
      if ((await inboxToggle.getAttribute('aria-expanded')) === 'false') await inboxToggle.click();
      const inboxText = await p.getByLabel('Creative Decisions and Batch Editor').textContent();
      return { domAnchor: `pendingMentioned=${/pending/i.test(inboxText || '')}` };
    }
  );

  // SC-03: Belief Graph selected entity + Inspector
  await snap('SC-03', 'FX-SIMPLE', { width: 1440, height: 900 },
    'Belief Graph with Fox selected and Contextual Inspector visible',
    ['seed FX-SIMPLE', 'click entity Fox in graph'],
    async (p) => {
      await p.locator('[aria-label^="Entity Fox."]').first().click();
      await p.waitForTimeout(200);
      const insp = await p.getByLabel('Contextual Inspector and Story Bible').textContent();
      return { domAnchor: `inspectorShowsFox=${(insp || '').includes('Fox')}` };
    }
  );

  // SC-04: Busy graph >=10 entities + filters visible
  await snap('SC-04', 'FX-BUSY', { width: 1440, height: 900 },
    'Busy Belief Graph with 12+ entities, parallel edges, and search/category filters',
    ['seed FX-BUSY', 'click Fit belief graph to view'],
    async (p) => {
      const fitBtn = p.getByRole('button', { name: 'Fit belief graph to view' });
      if (await fitBtn.isVisible()) await fitBtn.click();
      await p.waitForTimeout(250);
      const nodeCount = await p.locator('[aria-label^="Entity "]').count();
      return { domAnchor: `renderedEntityNodes=${nodeCount}` };
    }
  );

  // SC-05: Story Bible edit + inline validation error
  await snap('SC-05', 'FX-BUSY', { width: 1440, height: 900 },
    'Story Bible structured editing with inline control-character validation alert',
    ['seed FX-BUSY', 'click Story Bible tab', 'inject control char into #bible-genre'],
    async (p) => {
      await p.getByRole('tab', { name: 'Story Bible' }).click();
      await p.locator('#bible-genre').evaluate((el) => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, 'Cozy\x00Invalid');
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await p.waitForTimeout(150);
      const errVisible = await p.locator('#bible-error-genre').isVisible();
      return { domAnchor: `inlineValidationVisible=${errVisible}` };
    }
  );

  // SC-06: Checks tab with navigate-to-target
  await snap('SC-06', 'FX-BUSY', { width: 1440, height: 900 },
    'Consistency Checks showing excluded-entity conflict and Inspect/Edit target actions',
    ['seed FX-BUSY', 'click Checks tab'],
    async (p) => {
      await p.getByRole('tab', { name: /Checks/ }).click();
      await p.waitForTimeout(150);
      const hasInspectFox = await p.getByRole('button', { name: 'Inspect Fox' }).isVisible();
      return { domAnchor: `inspectFoxVisible=${hasInspectFox}` };
    }
  );

  // SC-07: Batch preview + Review Plan & Prompt Before/After modal
  await snap('SC-07', 'FX-BUSY', { width: 1440, height: 900 },
    'Natural-language batch preview staged with Review Plan & Prompt Before/After modal open',
    ['seed FX-BUSY', 'click Inbox', 'fill #nl-batch-input', 'click Preview', 'click Review Plan & Prompt'],
    async (p) => {
      const inboxToggle = p.getByRole('button', { name: /Inbox/ });
      if ((await inboxToggle.getAttribute('aria-expanded')) === 'false') await inboxToggle.click();
      await p.locator('#nl-batch-input').fill('Make Rabbit elderly. The party should be mysterious.');
      await p.getByRole('button', { name: 'Preview', exact: true }).click();
      await p.getByText(/Proposed Batch Operations/).waitFor({ state: 'visible' });
      await p.getByRole('button', { name: 'Review Plan & Prompt' }).click();
      await p.getByRole('dialog', { name: 'Review Plan and Prompt Changes' }).waitFor({ state: 'visible' });
      const diffCount = await p.locator('[data-testid="review-diff-list"] > div').count();
      return { domAnchor: `reviewModalOpen=true,diffRows=${diffCount}` };
    }
  );

  // SC-08: Generated story + outdated artifact badge + artifact history
  await snap('SC-08', 'FX-OUT', { width: 1440, height: 900 },
    'Output gallery showing generated story, current/outdated badges, and artifact history',
    ['seed FX-OUT', 'click Read output', 'open Generated Story tab / inspect story & outdated artifact'],
    async (p) => {
      const readOutput = p.getByRole('button', { name: 'Read output' });
      if ((await readOutput.getAttribute('aria-expanded')) === 'false') await readOutput.click();
      const outTab = p.getByRole('tab', { name: /Generated Story/i });
      if (await outTab.isVisible()) await outTab.click();
      await p.waitForTimeout(150);
      const bodyText = await p.locator('body').textContent();
      return { domAnchor: `hasStory=${(bodyText || '').includes('Lantern Glade')},hasOutdated=${/outdated/i.test(bodyText || '')}` };
    }
  );

  // SC-09: Image gallery + fullscreen preview
  await snap('SC-09', 'FX-OUT', { width: 1440, height: 900 },
    'Image mode gallery with 4 placeholder outputs and fullscreen lightbox preview open',
    ['seed FX-OUT', 'click Read output', 'switch mode to Image', 'click Generated Images', 'click Preview generated image 1'],
    async (p) => {
      const readOutput = p.getByRole('button', { name: 'Read output' });
      if ((await readOutput.getAttribute('aria-expanded')) === 'false') await readOutput.click();
      await p.getByRole('group', { name: 'Generation mode' }).getByRole('button', { name: 'Image', exact: true }).click();
      await p.waitForTimeout(200);
      const imgTab = p.getByRole('tab', { name: /Generated Images/i });
      if (await imgTab.isVisible()) await imgTab.click();
      await p.waitForTimeout(150);
      const previewBtn = p.getByRole('button', { name: 'Preview generated image 1' });
      await previewBtn.waitFor({ state: 'visible' });
      await previewBtn.click();
      await p.getByRole('dialog', { name: 'Image full preview' }).waitFor({ state: 'visible' });
      return { domAnchor: 'imageLightboxOpen=true' };
    }
  );

  // SC-10: Project / History / Export & Revision Restore
  await snap('SC-10', 'FX-BUSY', { width: 1440, height: 900 },
    'History tab showing project management, JSON/MD export, and revision restore controls',
    ['seed FX-BUSY', 'click History tab'],
    async (p) => {
      await p.getByRole('tab', { name: 'History' }).click();
      await p.waitForTimeout(150);
      const restoreVisible = await p.getByRole('button', { name: /Restore/i }).first().isVisible();
      return { domAnchor: `restoreButtonVisible=${restoreVisible}` };
    }
  );

  // SC-11: Mobile 390x844 Graph/Inspector/Inbox switcher
  await snap('SC-11', 'FX-SIMPLE', { width: 390, height: 844 },
    'Mobile 390x844 workspace showing mobile panel switcher and belief graph',
    ['seed FX-SIMPLE', 'viewport 390x844'],
    async (p) => {
      const mobileNavVisible = await p.getByLabel('Mobile workspace panels').isVisible();
      return { domAnchor: `mobileNavVisible=${mobileNavVisible}` };
    }
  );

  // SC-12: Mobile 390x844 Story Output + Bottom Action Bar
  await snap('SC-12', 'FX-OUT', { width: 390, height: 844 },
    'Mobile 390x844 Story Output view with bottom generation/review bar',
    ['seed FX-OUT', 'viewport 390x844', 'click Output mobile panel button'],
    async (p) => {
      await p.getByLabel('Mobile workspace panels').getByRole('button', { name: /Output/i }).click();
      await p.waitForTimeout(200);
      const hasStory = (await p.locator('body').textContent() || '').includes('Lantern Glade');
      return { domAnchor: `mobileStoryVisible=${hasStory}` };
    }
  );

  // SC-13: Cramped laptop 1280x800 FX-BUSY
  await snap('SC-13', 'FX-BUSY', { width: 1280, height: 800 },
    'Cramped laptop 1280x800 full 3-column workspace under busy world load',
    ['seed FX-BUSY', 'viewport 1280x800'],
    async (p) => {
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      return { domAnchor: `laptopOverflow=${overflow}` };
    }
  );

  // SC-14: Tablet 768x1024 Story Bible
  await snap('SC-14', 'FX-SIMPLE', { width: 768, height: 1024 },
    'Tablet 768x1024 navigation with Story Bible active',
    ['seed FX-SIMPLE', 'viewport 768x1024', 'open Inspector -> Story Bible'],
    async (p) => {
      const mobileInsp = p.getByLabel('Mobile workspace panels').getByRole('button', { name: /Inspector/i });
      if (await mobileInsp.isVisible()) await mobileInsp.click();
      await p.getByRole('tab', { name: 'Story Bible' }).click();
      await p.waitForTimeout(150);
      const visible = await p.locator('#bible-genre').isVisible();
      return { domAnchor: `tabletStoryBibleVisible=${visible}` };
    }
  );

  // SC-15: Mobile 390x844 FX-ERROR storage read_error banner
  await snap('SC-15', 'FX-SIMPLE', { width: 390, height: 844 },
    'Mobile 390x844 IndexedDB read_error recovery banner with Retry Storage Read CTA',
    ['seed FX-SIMPLE with simulated IDB read_error', 'viewport 390x844'],
    async (p) => {
      const retryVisible = await p.getByRole('button', { name: 'Retry Storage Read' }).isVisible();
      return { domAnchor: `retryStorageReadVisible=${retryVisible}` };
    },
    { failIdb: true }
  );

  // SC-16: Desktop 1440x900 Dark theme
  await snap('SC-16', 'FX-SIMPLE', { width: 1440, height: 900 },
    'Desktop 1440x900 dark theme workspace',
    ['seed FX-SIMPLE', 'click Switch to dark mode button'],
    async (p) => {
      await p.getByRole('button', { name: 'Switch to dark mode' }).click();
      await p.waitForTimeout(300);
      const headerBg = await p.evaluate(() => getComputedStyle(document.querySelector('header')).backgroundColor);
      return { domAnchor: `darkHeaderBg=${headerBg}` };
    },
    { darkMode: true }
  );

  return 'STAGE0_JSON_BEGIN' + JSON.stringify({ capturedAt: new Date().toISOString(), count: captures.length, captures }) + 'STAGE0_JSON_END';
}
EOF

BASE_URL_ENV="$BASE_URL" ASSETS_DIR_ENV="$ASSETS_DIR" node -e '
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
  let code = fs.readFileSync(".playwright-cli/phase1-captures.js", "utf8");
  code = code
    .replace("__BASE_URL__", process.env.BASE_URL_ENV)
    .replace("__FIXTURES_JSON__", JSON.stringify(compact))
    .replaceAll("__ASSETS_DIR__", process.env.ASSETS_DIR_ENV);
  fs.writeFileSync(".playwright-cli/phase1-captures.resolved.js", code);
'

run_pw_phase "CAPTURES" ".playwright-cli/phase1-captures.resolved.js" "${ASSETS_DIR}/manifest.json"

# Verify every PNG exists, is non-empty, and record exact pixel dimensions from PNG IHDR
ASSETS_DIR_ENV="$ASSETS_DIR" node -e '
  const fs = require("node:fs");
  const manifestPath = `${process.env.ASSETS_DIR_ENV}/manifest.json`;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  for (const item of manifest.captures) {
    const buf = fs.readFileSync(item.path);
    if (buf.length < 2000 || buf.toString("ascii", 1, 4) !== "PNG") {
      throw new Error("Invalid PNG capture: " + item.path + " (" + buf.length + " bytes)");
    }
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    item.fileBytes = buf.length;
    item.imageResolution = `${width}x${height}`;
    item.sanityCheck = width > 0 && height > 0 && item.unmockedApiHits === 0 ? "PASS" : "FAIL";
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log("PNG_SANITY_OK:", manifest.captures.length, "images verified.");
'

echo "STAGE0_CAPTURE_COMPLETE"
