#!/usr/bin/env node

import assert from 'node:assert/strict';
import process from 'node:process';

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing ${name} argument.`);
  return process.argv[index + 1];
}

const raw = await new Promise((resolve, reject) => {
  let value = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { value += chunk; });
  process.stdin.on('end', () => resolve(value));
  process.stdin.on('error', reject);
});

const resultStart = raw.indexOf('### Result');
assert.notEqual(resultStart, -1, 'Missing Playwright result section.');
const resultSection = raw.slice(resultStart + '### Result'.length);
const codeStart = resultSection.indexOf('### Ran Playwright code');
const encoded = (codeStart < 0 ? resultSection : resultSection.slice(0, codeStart)).trim();
assert.ok(encoded, 'Empty Playwright result payload.');

let payload = JSON.parse(encoded);
if (typeof payload === 'string') payload = JSON.parse(payload);
assert.ok(payload && typeof payload === 'object' && !Array.isArray(payload), 'Result payload must be a JSON object.');
assert.equal(payload.status, argument('--status'), 'Unexpected structured result status.');
if (process.argv.includes('--scenario')) assert.equal(payload.scenario, argument('--scenario'), 'Unexpected structured scenario identity.');

if (payload.browserEvidence) {
  for (const field of ['pageErrors', 'consoleErrors']) {
    assert.ok(Array.isArray(payload.browserEvidence[field]), `Missing top-level ${field} evidence.`);
    assert.equal(payload.browserEvidence[field].length, 0, `Browser ${field} were reported.`);
  }
}

if (process.argv.includes('--scenarios')) {
  const expected = argument('--scenarios').split(',');
  assert.ok(Array.isArray(payload.scenarios), 'Missing scenarios array.');
  const actual = payload.scenarios.map((scenario) => scenario?.kind);
  assert.deepEqual(actual, expected, 'Scenario identities or order do not match the expected set.');
  for (const scenario of payload.scenarios) {
    assert.ok(Array.isArray(scenario.pageErrors), `${scenario.kind}: missing pageErrors evidence.`);
    assert.ok(Array.isArray(scenario.consoleErrors), `${scenario.kind}: missing consoleErrors evidence.`);
    assert.equal(scenario.pageErrors.length, 0, `${scenario.kind}: browser page errors were reported.`);
    assert.equal(scenario.consoleErrors.length, 0, `${scenario.kind}: browser console errors were reported.`);
  }
}

if (process.argv.includes('--enhancement-calls')) {
  assert.equal(payload.enhancementCalls, Number(argument('--enhancement-calls')), 'Unexpected enhancement call count.');
  const calls = payload.browserEvidence?.apiRequests?.filter((request) =>
    request.method === 'POST' && request.path === '/api/narrative/import/enhance');
  assert.equal(calls?.length, Number(argument('--enhancement-calls')), 'Structured enhancement request count is incomplete.');
}

if (process.argv.includes('--route-calls')) {
  for (const spec of argument('--route-calls').split(',')) {
    const [kind, countText] = spec.split('=');
    const scenario = payload.scenarios?.find((item) => item.kind === kind);
    assert.ok(scenario, `Missing ${kind} scenario for route call assertion.`);
    assert.equal(scenario.routeCalls, Number(countText), `${kind}: unexpected route call count.`);
  }
}

if (process.argv.includes('--revision-advances')) {
  for (const kind of argument('--revision-advances').split(',')) {
    const scenario = payload.scenarios?.find((item) => item.kind === kind);
    assert.ok(scenario?.diagnosticFixRevision, `Missing ${kind} durable revision evidence.`);
    assert.ok(scenario.diagnosticFixRevision.after > scenario.diagnosticFixRevision.before, `${kind}: durable revision did not advance.`);
  }
}

if (process.argv.includes('--api-counts')) {
  for (const spec of argument('--api-counts').split(',')) {
    const match = spec.match(/^([^:]+):(.+)=(\d+)$/);
    assert.ok(match, `Malformed API count assertion: ${spec}`);
    const [, kind, path, countText] = match;
    const scenario = payload.scenarios?.find((item) => item.kind === kind);
    assert.ok(scenario, `Missing ${kind} scenario for API count assertion.`);
    const count = scenario.apiRequests?.filter((request) => request.method === 'POST' && request.path === path).length;
    assert.equal(count, Number(countText), `${kind}: unexpected POST count for ${path}.`);
  }
}

const sanitized = {
  status: payload.status,
  scenarioCount: payload.scenarios?.length,
  scenarios: payload.scenarios?.map((scenario) => ({
    kind: scenario.kind,
    routeCalls: scenario.routeCalls,
    diagnosticFixRevision: scenario.diagnosticFixRevision,
    diagnosticAnalyzeCalls: scenario.diagnosticAnalyzeCalls,
    diagnosticFixCalls: scenario.diagnosticFixCalls,
    pageErrors: scenario.pageErrors ?? [],
    consoleErrors: scenario.consoleErrors ?? [],
    apiRequests: scenario.apiRequests?.map(({ method, path }) => ({ method, path })),
    apiResponses: scenario.apiResponses?.map(({ status, path }) => ({ status, path })),
  })),
  scenario: payload.scenario,
  enhancementCalls: payload.enhancementCalls,
};
process.stdout.write(`E2E_STRUCTURED_RESULT_VERIFIED ${JSON.stringify(sanitized)}\n`);
