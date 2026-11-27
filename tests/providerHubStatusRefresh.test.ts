import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createProviderHubStatusRefreshCoordinator,
} from '../lib/controller/useAiPlanActions.ts';
import type { ProviderHubStatus } from '../services/apiClient.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const status = (name: string) => ({ name }) as unknown as ProviderHubStatus;

test('newer successful provider status wins when responses arrive out of order', async () => {
  const refresh = createProviderHubStatusRefreshCoordinator();
  let current: ProviderHubStatus | null = null;
  const publish = (value: ProviderHubStatus) => { current = value; };
  const failClosed = () => { current = null; };
  const older = deferred<ProviderHubStatus>();
  const newer = deferred<ProviderHubStatus>();

  const olderRequest = refresh.refresh(() => older.promise, publish, failClosed);
  const newerRequest = refresh.refresh(() => newer.promise, publish, failClosed);
  newer.resolve(status('newer'));
  await newerRequest;
  older.resolve(status('older'));
  await olderRequest;

  assert.equal((current as unknown as { name: string } | null)?.name, 'newer');
});

test('older failed provider status request cannot clear a newer success', async () => {
  const refresh = createProviderHubStatusRefreshCoordinator();
  let current: ProviderHubStatus | null = null;
  const older = deferred<ProviderHubStatus>();
  const newer = deferred<ProviderHubStatus>();

  const olderRequest = refresh.refresh(() => older.promise, value => { current = value; }, () => { current = null; });
  const newerRequest = refresh.refresh(() => newer.promise, value => { current = value; }, () => { current = null; });
  newer.resolve(status('newer'));
  await newerRequest;
  older.reject(new Error('stale failure'));
  await olderRequest;

  assert.equal((current as unknown as { name: string } | null)?.name, 'newer');
});

test('older successful provider status cannot replace a newer failed status', async () => {
  const refresh = createProviderHubStatusRefreshCoordinator();
  let current: ProviderHubStatus | null = status('previous');
  const older = deferred<ProviderHubStatus>();
  const newer = deferred<ProviderHubStatus>();

  const olderRequest = refresh.refresh(() => older.promise, value => { current = value; }, () => { current = null; });
  const newerRequest = refresh.refresh(() => newer.promise, value => { current = value; }, () => { current = null; });
  newer.reject(new Error('current failure'));
  await newerRequest;
  older.resolve(status('stale'));
  await olderRequest;

  assert.equal(current, null, 'current failure must preserve fail-closed status');
});

test('invalidated pending provider status responses do not publish after cleanup', async () => {
  const refresh = createProviderHubStatusRefreshCoordinator();
  let current: ProviderHubStatus | null = null;
  const pending = deferred<ProviderHubStatus>();
  const request = refresh.refresh(() => pending.promise, value => { current = value; }, () => { current = null; });

  refresh.invalidate();
  pending.resolve(status('after-cleanup'));
  await request;

  assert.equal(current, null);
});

test('Strict Mode effect cleanup and replay lets the replayed request publish', async () => {
  const refresh = createProviderHubStatusRefreshCoordinator();
  let current: ProviderHubStatus | null = null;
  const strictModeFirstMount = deferred<ProviderHubStatus>();
  const replayedMount = deferred<ProviderHubStatus>();

  const firstRequest = refresh.refresh(() => strictModeFirstMount.promise, value => { current = value; }, () => { current = null; });
  refresh.invalidate();
  const replayedRequest = refresh.refresh(() => replayedMount.promise, value => { current = value; }, () => { current = null; });
  replayedMount.resolve(status('replayed'));
  await replayedRequest;
  strictModeFirstMount.resolve(status('stale-first-mount'));
  await firstRequest;

  assert.equal((current as unknown as { name: string } | null)?.name, 'replayed');
});
