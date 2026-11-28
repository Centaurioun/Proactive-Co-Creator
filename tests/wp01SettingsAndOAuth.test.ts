/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  createChatGptOAuthPollingController,
  type ChatGptOAuthState,
} from '../lib/settings/oauthPollingController.ts';
import {
  summarizeActiveProviderPill,
} from '../lib/controller/useProviderHubStatus.ts';
import type { ProviderHubStatus } from '../server/providers/contracts.ts';

function makeHubStatus(chatGptState: 'authorization-required' | 'connected'): ProviderHubStatus {
  return {
    localPersonalConnectionsAvailable: true,
    capabilityPolicyVersion: '1',
    credentialAuthorityIds: {
      'gemini-managed': 'auth-gm',
      'gemini-personal': 'auth-gp',
      'chatgpt-plan': 'auth-cgpt',
      'openai-api': 'auth-oai',
    },
    preferences: {
      defaultConnectionId: 'gemini-managed',
      defaultTextModelId: 'gemini-2.5-flash',
      defaultReasoningLevel: 'default',
      operationOverrides: {},
      preferredTextModelsByConnection: {},
      preferredReasoningLevelsByConnection: {},
    },
    usage: {
      quota: { state: 'unknown' },
      observedByConnection: {
        'gemini-managed': 2,
        'gemini-personal': 0,
        'chatgpt-plan': 0,
        'openai-api': 0,
      },
    },
    connections: [
      {
        id: 'gemini-managed',
        family: 'gemini',
        billing: 'host-managed-gemini',
        state: 'connected',
        models: [
          {
            id: 'gemini-2.5-flash',
            displayName: 'Gemini 2.5 Flash',
            availability: { state: 'supported', value: true, evidence: [] },
            textGeneration: { state: 'supported', value: true, evidence: [] },
            structuredOutput: { state: 'supported', value: true, evidence: [] },
            imageGeneration: { state: 'unsupported', evidence: [] },
            contextLimit: { state: 'unknown', reason: 'Not queried in unit fixture' },
            outputLimit: { state: 'unknown', reason: 'Not queried in unit fixture' },
            reasoning: { state: 'unknown', reason: 'Not queried in unit fixture' },
            operationCapabilities: {},
            capabilityPolicyVersion: '1',
          },
        ],
      },
      {
        id: 'chatgpt-plan',
        family: 'openai',
        billing: 'chatgpt-plan',
        state: chatGptState,
        models: [],
      },
    ],
  };
}

describe('WP01 M5: Seamless ChatGPT OAuth controller & provider status pill', () => {
  it('transitions Waiting -> Loading models -> Ready with exactly ONE targeted catalog refresh on server-verified connect', async () => {
    const phases: ChatGptOAuthState['phase'][] = [];
    let pollCount = 0;
    let catalogCalls = 0;
    let cleared = false;
    const fakeTimer = { id: 1 } as unknown as ReturnType<typeof setInterval>;

    const controller = createChatGptOAuthPollingController({
      fetchStatus: async () => {
        pollCount += 1;
        return makeHubStatus(pollCount >= 2 ? 'connected' : 'authorization-required');
      },
      refreshChatGptCatalog: async () => {
        catalogCalls += 1;
        return { ok: true, modelCount: 3 };
      },
      onStateChange: (next) => phases.push(next.phase),
      setIntervalFn: () => fakeTimer,
      clearIntervalFn: () => {
        cleared = true;
      },
    });

    controller.start();
    await controller.triggerCheck(); // poll 1: still not-connected
    assert.equal(controller.getState().phase, 'waiting-authorization');
    assert.equal(catalogCalls, 0);

    await controller.triggerCheck(); // poll 2: connected -> 1 catalog load -> ready
    assert.equal(controller.getState().phase, 'ready');
    assert.equal(catalogCalls, 1);
    assert.equal(cleared, true);
    assert.deepEqual(phases, ['waiting-authorization', 'loading-models', 'ready']);
  });

  it('transitions to catalog-unavailable when OAuth succeeds but catalog refresh fails (no automatic retry or new OAuth)', async () => {
    const phases: ChatGptOAuthState['phase'][] = [];
    let catalogCalls = 0;

    const controller = createChatGptOAuthPollingController({
      fetchStatus: async () => makeHubStatus('connected'),
      refreshChatGptCatalog: async () => {
        catalogCalls += 1;
        return { ok: false, error: 'Upstream catalog 503' };
      },
      onStateChange: (next) => phases.push(next.phase),
      setIntervalFn: () => ({ id: 2 } as unknown as ReturnType<typeof setInterval>),
      clearIntervalFn: () => {},
    });

    controller.start();
    await controller.triggerCheck();

    assert.equal(catalogCalls, 1);
    assert.equal(controller.getState().phase, 'catalog-unavailable');
    assert.equal(controller.getState().error, 'Upstream catalog 503');
    assert.deepEqual(phases, ['waiting-authorization', 'loading-models', 'catalog-unavailable']);
  });

  it('discards stale in-flight OAuth status and catalog responses after cancel/disconnect', async () => {
    let resolveCatalog!: (val: { ok: boolean; modelCount: number }) => void;
    const catalogPromise = new Promise<{ ok: boolean; modelCount: number }>((res) => {
      resolveCatalog = res;
    });
    const phases: ChatGptOAuthState['phase'][] = [];

    const controller = createChatGptOAuthPollingController({
      fetchStatus: async () => makeHubStatus('connected'),
      refreshChatGptCatalog: () => catalogPromise,
      onStateChange: (next) => phases.push(next.phase),
      setIntervalFn: () => ({ id: 3 } as unknown as ReturnType<typeof setInterval>),
      clearIntervalFn: () => {},
    });

    controller.start();
    const checkPromise = controller.triggerCheck();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(controller.getState().phase, 'loading-models');

    // User clicks Disconnect ChatGPT while catalog load is in flight.
    controller.cancel();
    assert.equal(controller.getState().phase, 'idle');

    // Now the stale catalog promise resolves — must NOT overwrite idle state!
    resolveCatalog({ ok: true, modelCount: 2 });
    await checkPromise;
    assert.equal(controller.getState().phase, 'idle');
    assert.deepEqual(phases, ['waiting-authorization', 'loading-models', 'idle']);
  });

  it('deduplicates concurrent focus/interval checks and stops cleanly at bounded timeout', async () => {
    let currentTime = 1_000;
    let statusCalls = 0;
    let resolveFirst!: (val: ProviderHubStatus) => void;
    let timerCleared = false;

    const controller = createChatGptOAuthPollingController({
      fetchStatus: () => {
        statusCalls += 1;
        return new Promise<ProviderHubStatus>((res) => {
          resolveFirst = res;
        });
      },
      refreshChatGptCatalog: async () => ({ ok: true, modelCount: 1 }),
      onStateChange: () => {},
      maxDurationMs: 10_000,
      now: () => currentTime,
      setIntervalFn: () => ({ id: 4 } as unknown as ReturnType<typeof setInterval>),
      clearIntervalFn: () => {
        timerCleared = true;
      },
    });

    controller.start();
    const p1 = controller.triggerCheck();
    const p2 = controller.triggerCheck(); // deduplicated while p1 is in flight
    assert.equal(statusCalls, 1);

    resolveFirst(makeHubStatus('authorization-required'));
    await Promise.all([p1, p2]);
    assert.equal(controller.getState().phase, 'waiting-authorization');

    // Advance past bounded deadline.
    currentTime += 15_000;
    await controller.triggerCheck();
    assert.equal(controller.getState().phase, 'timed-out');
    assert.equal(timerCleared, true);
  });

  it('summarizes active provider status pill truthfully across ready, needs-attention, and image-note states', () => {
    const status = makeHubStatus('connected');
    const readyPill = summarizeActiveProviderPill(status, status.preferences, false, null);
    assert.equal(readyPill.state, 'ready');
    assert.equal(readyPill.providerLabel, 'Gemini Managed');
    assert.equal(readyPill.modelLabel, 'Gemini 2.5 Flash');

    const chatGptPrefs = {
      ...status.preferences,
      defaultConnectionId: 'chatgpt-plan' as const,
      defaultTextModelId: 'gpt-5-mini',
    };
    const chatGptPill = summarizeActiveProviderPill(status, chatGptPrefs, false, null);
    assert.equal(chatGptPill.state, 'ready');
    assert.equal(chatGptPill.providerLabel, 'ChatGPT Plan');
    assert.match(chatGptPill.detail, /Image generation remains Gemini Managed only/i);

    const disconnectedStatus = makeHubStatus('authorization-required');
    const attentionPill = summarizeActiveProviderPill(disconnectedStatus, chatGptPrefs, false, null);
    assert.equal(attentionPill.state, 'needs-attention');
    assert.equal(attentionPill.modelLabel, 'Setup needed');
  });

  it('keeps 5 honest AI Settings tabs and automatic-update OAuth callback copy', () => {
    const panelSource = fs.readFileSync(
      path.join(process.cwd(), 'components/settings/AiConnectionsPanel.tsx'),
      'utf8'
    );
    assert.match(panelSource, /Overview & Connections/);
    assert.match(panelSource, /Models & Defaults/);
    assert.match(panelSource, /Operation Overrides/);
    assert.match(panelSource, /Embeddings & Search/);
    assert.match(panelSource, /Usage & Limits/);
    assert.match(panelSource, /Not yet implemented — scheduled for WP02/);

    const routesSource = fs.readFileSync(
      path.join(process.cwd(), 'server/providerHubRoutes.ts'),
      'utf8'
    );
    assert.doesNotMatch(routesSource, /and refresh connection status/i);
    assert.match(routesSource, /update automatically/i);
  });
});
