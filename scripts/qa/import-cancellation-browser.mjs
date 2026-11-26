import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
for (const key of Object.keys(process.env)) {
  if (/^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)$/.test(key)) delete process.env[key];
}
const sessionResult = spawnSync('agent-browser', [
  'session', 'id', '--scope', 'worktree', '--prefix', 'pcc-import-cancel',
], { cwd: repoRoot, encoding: 'utf8' });
assert.equal(sessionResult.status, 0, sessionResult.stderr);
const session = sessionResult.stdout.trim();
assert.match(session, /^pcc-import-cancel-[a-z0-9]+$/);

const port = Number(process.env.PCC_QA_PORT || 4337);
const baseUrl = `http://127.0.0.1:${port}`;
const evidenceDir = path.resolve(
  repoRoot,
  process.env.PCC_QA_EVIDENCE_DIR || '.playwright-cli/q06-import-cancellation',
);
mkdirSync(evidenceDir, { recursive: true });

const logDir = path.join(repoRoot, '.playwright-cli');
mkdirSync(logDir, { recursive: true });
const serverLogPath = path.join(logDir, `pcc-import-cancel-${process.pid}.log`);
const serverLog = createWriteStream(serverLogPath);
const serverEnv = { ...process.env, PORT: String(port) };
delete serverEnv.GEMINI_API_KEY;
delete serverEnv.API_KEY;
delete serverEnv.OPENAI_API_KEY;
const server = spawn('npm', ['run', 'dev'], {
  cwd: repoRoot,
  env: serverEnv,
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.pipe(serverLog);
server.stderr.pipe(serverLog);

let browserStarted = false;
const command = (args, input) => {
  const result = spawnSync('agent-browser', ['--session', session, ...args], {
    cwd: repoRoot,
    input,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`agent-browser ${args[0]} failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
};

const waitUntil = async (predicate, label, timeoutMs = 20_000) => {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      if (predicate()) return;
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`);
};

const evalPage = (script) => JSON.parse(command(['eval', '--stdin'], script));
const snapshot = () => command(['snapshot', '-i']);
const refFor = (tree, needle) => {
  const line = tree.split('\n').find((entry) => entry.includes(needle));
  assert.ok(line, `Could not find accessible element containing: ${needle}\n${tree}`);
  const match = line.match(/\[ref=(e\d+)\]/);
  assert.ok(match, `Element has no agent-browser reference: ${line}`);
  return `@${match[1]}`;
};
const fill = (tree, needle, value) => command(['fill', refFor(tree, needle), '--', value]);
const click = (tree, needle) => command(['click', refFor(tree, needle)]);
const screenshot = (name) => command(['screenshot', path.join(evidenceDir, name)]);
const waitPage = (js) => command(['wait', '--fn', js, '--timeout', '20000']);

const runResult = {
  status: 'RUNNING',
  candidateHead: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim(),
  browserSession: session,
  origin: baseUrl,
  providerConfigured: false,
  fixture: {
    manuscript: 'PCC cancellation fixture — Türkçe — manuscript stays intact.',
    stagedSource: 'Staged cancellation manuscript source — this passage must remain uncommitted.',
    inFlightSource: 'Delayed extraction source — Ω must remain uncommitted after cancellation.',
  },
  checks: [],
};

try {
  await waitUntil(() => {
    try {
      const response = spawnSync('curl', ['-fsS', `${baseUrl}/api/health`], { encoding: 'utf8' });
      return response.status === 0;
    } catch {
      return false;
    }
  }, 'local application server');

  const initScript = path.join(repoRoot, 'scripts/qa/import-cancellation-init.js');
  command(['--init-script', initScript, 'open', baseUrl]);
  browserStarted = true;

  let tree = snapshot();
  assert.match(tree, /Cat’s Woodland Dinner Party/);
  fill(tree, 'textbox "Start writing here…"', runResult.fixture.manuscript);
  waitPage("document.body.innerText.includes('Saved · r2')", 'durable synthetic manuscript save');

  const baseline = evalPage(`window.__pccImportQa.captureBaseline()`);
  assert.equal(baseline.projectBaseline.projectCount, 1);
  assert.equal(baseline.projectBaseline.projects[0].revision, baseline.projectBaseline.projects[0].persistedRevision);
  assert.equal(baseline.projectBaseline.projects[0].manuscriptText, runResult.fixture.manuscript);
  assert.match(JSON.stringify(baseline.workspacePreferenceBaseline), /write/);
  runResult.baseline = baseline;

  // Cancel a valid, staged source before analysis or explicit commit.
  tree = snapshot();
  click(tree, 'button "Import"');
  tree = snapshot();
  fill(tree, 'textbox "Or paste narrative text"', runResult.fixture.stagedSource);
  click(snapshot(), 'button "Inspect source"');
  waitPage("Array.from(document.querySelectorAll('button')).some((button) => button.textContent.trim() === 'Analyze source' && !button.disabled)", 'staged source to finish inspection');
  tree = snapshot();
  assert.match(tree, /Extracted text preview/);
  assert.match(tree, /Continue with source only/);
  screenshot('q06-staged-source-before-cancel.png');
  runResult.checks.push(evalPage("window.__pccImportQa.assertUnchanged('staged-source-before-exit')"));
  click(tree, 'button "Exit import"');
  waitPage("document.querySelector('h1')?.textContent?.trim() === 'Working Manuscript'", 'return to Write after staged-source cancellation');
  runResult.checks.push(evalPage("window.__pccImportQa.assertUnchanged('staged-source-after-exit')"));
  runResult.checks.push({
    name: 'staged-source-cancellation',
    returnedToWrite: evalPage("document.querySelector('h1')?.textContent?.trim() === 'Working Manuscript'"),
  });

  // Start one extraction against a deliberately unresolved mock request, abort it in-app,
  // then resolve it late to exercise the existing signal and cancellation guards.
  tree = snapshot();
  click(tree, 'button "Import"');
  tree = snapshot();
  fill(tree, 'textbox "Or paste narrative text"', runResult.fixture.inFlightSource);
  click(snapshot(), 'button "Inspect source"');
  waitPage("Array.from(document.querySelectorAll('button')).some((button) => button.textContent.trim() === 'Analyze source' && !button.disabled)", 'in-flight source to finish inspection');
  tree = snapshot();
  const analyzeLine = tree.split('\n').find((line) => line.includes('button "Analyze source"'));
  assert.ok(analyzeLine, `Analyze source control missing:\n${tree}`);
  assert.ok(!analyzeLine.includes('[disabled]'), `Analyze source should be enabled by the isolated mock:\n${analyzeLine}`);
  click(tree, 'button "Analyze source"');
  waitPage('window.__pccImportQa.extractionStarted === true', 'mocked extraction request to become pending');
  let pending = evalPage(`({
    request: window.__pccImportQa.extractionRequest,
    apiCalls: window.__pccImportQa.apiCalls,
    pending: typeof window.__pccImportQa.releaseLateResponse === 'function',
  })`);
  assert.ok(pending.pending);
  assert.equal(pending.request.text, runResult.fixture.inFlightSource);
  assert.equal(pending.apiCalls.filter((call) => call.path === '/api/narrative/import/extract').length, 1);
  assert.ok(pending.apiCalls.every((call) => call.mocked && !call.unexpected));
  tree = snapshot();
  assert.match(tree, /Cancel analysis/);
  screenshot('q06-extraction-in-flight.png');

  click(tree, 'button "Cancel analysis"');
  waitPage('window.__pccImportQa.extractionAborted === true', 'AbortSignal delivery to mocked extraction');
  evalPage("(window.__pccImportQa.releaseLateResponse(), true)");
  waitPage("!Array.from(document.querySelectorAll('button')).some((button) => button.textContent.trim() === 'Cancel analysis')", 'late mock response processing to settle');
  tree = snapshot();
  assert.equal(evalPage("document.body.innerText.includes('Analysis was cancelled.')"), true);
  assert.ok(!tree.includes('Review extracted candidates'), 'Cancelled late response must not populate Review candidates.');
  assert.equal(evalPage("document.querySelector('#import-review-title') !== null"), false);
  screenshot('q06-late-response-rejected.png');

  runResult.checks.push(evalPage("window.__pccImportQa.assertUnchanged('late-response-rejected')"));
  runResult.checks.push({
    name: 'late-response-rejected',
    abortSignalObserved: evalPage('window.__pccImportQa.extractionAborted'),
    reviewCandidatesVisible: evalPage("document.querySelector('#import-review-title') !== null"),
    requestText: pending.request.text,
  });

  click(tree, 'button "Exit import"');
  waitPage("document.querySelector('h1')?.textContent?.trim() === 'Working Manuscript'", 'return to Write after in-flight cancellation');
  const restored = evalPage("window.__pccImportQa.assertUnchanged('after-in-flight-import-exit')");
  assert.equal(restored.sameDigest, true);
  assert.equal(restored.samePreference, true);
  runResult.finalState = restored;
  runResult.apiCalls = evalPage('window.__pccImportQa.apiCalls');
  assert.ok(runResult.apiCalls.some((call) => call.path === '/api/ai/capabilities'));
  assert.equal(runResult.apiCalls.filter((call) => call.path === '/api/narrative/import/extract').length, 1);
  assert.ok(runResult.apiCalls.every((call) => call.mocked && !call.unexpected));
  assert.match(JSON.stringify(restored.state.projects), /PCC cancellation fixture — Türkçe — manuscript stays intact\./);
  runResult.status = 'PASS';
} catch (error) {
  runResult.status = 'FAIL';
  runResult.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  const outputPath = path.join(evidenceDir, 'q06-import-cancellation-2026-11-25.json');
  writeFileSync(outputPath, `${JSON.stringify(runResult, null, 2)}\n`);
  if (browserStarted) {
    const closeResult = spawnSync('agent-browser', ['--session', session, 'close'], { cwd: repoRoot, encoding: 'utf8' });
    if (closeResult.status !== 0) serverLog.write(closeResult.stderr || closeResult.stdout);
  }
  if (server.pid && server.exitCode === null && server.signalCode === null) {
    const killGroup = (sig) => {
      try {
        process.kill(-server.pid, sig);
      } catch {
        try { server.kill(sig); } catch { /* already exited */ }
      }
    };
    killGroup('SIGTERM');
    await Promise.race([
      new Promise((resolve) => server.once('exit', resolve)),
      sleep(1500),
    ]);
    if (server.exitCode === null && server.signalCode === null) {
      killGroup('SIGKILL');
    }
  }
  serverLog.end();
  process.stdout.write(`${JSON.stringify({ ...runResult, evidenceJson: outputPath, serverLog: serverLogPath }, null, 2)}\n`);
}
