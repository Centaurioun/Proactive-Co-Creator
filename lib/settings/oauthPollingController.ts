/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ProviderHubStatus } from '../../server/providers/contracts';

export type ChatGptOAuthPhase =
  | 'idle'
  | 'waiting-authorization'
  | 'loading-models'
  | 'ready'
  | 'catalog-unavailable'
  | 'timed-out';

export interface ChatGptOAuthState {
  phase: ChatGptOAuthPhase;
  message: string;
  error?: string;
}

export interface OAuthPollingControllerDeps {
  fetchStatus: () => Promise<ProviderHubStatus>;
  refreshChatGptCatalog: () => Promise<{ ok: boolean; modelCount?: number; error?: string }>;
  onStateChange: (state: ChatGptOAuthState) => void;
  onStatusObserved?: (status: ProviderHubStatus) => void;
  pollIntervalMs?: number;
  maxDurationMs?: number;
  now?: () => number;
  setIntervalFn?: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearIntervalFn?: (handle: ReturnType<typeof setInterval>) => void;
}

export interface OAuthPollingController {
  start: () => void;
  triggerCheck: () => Promise<void>;
  cancel: () => void;
  dispose: () => void;
  getState: () => ChatGptOAuthState;
}

export function createChatGptOAuthPollingController(
  deps: OAuthPollingControllerDeps
): OAuthPollingController {
  const pollIntervalMs = deps.pollIntervalMs ?? 2_000;
  const maxDurationMs = deps.maxDurationMs ?? 120_000;
  const now = deps.now ?? (() => Date.now());
  const setIntervalFn = deps.setIntervalFn ?? ((fn, ms) => globalThis.setInterval(fn, ms));
  const clearIntervalFn = deps.clearIntervalFn ?? ((handle) => globalThis.clearInterval(handle));

  let epoch = 0;
  let startedAt = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let checkInFlight = false;
  let disposed = false;
  let state: ChatGptOAuthState = { phase: 'idle', message: '' };

  const stopTimer = () => {
    if (timer !== null) {
      clearIntervalFn(timer);
      timer = null;
    }
  };

  const publish = (next: ChatGptOAuthState) => {
    if (disposed) return;
    state = next;
    deps.onStateChange(next);
  };

  const triggerCheck = async (): Promise<void> => {
    if (disposed || state.phase !== 'waiting-authorization' || checkInFlight) {
      return;
    }

    const activeEpoch = epoch;
    if (now() - startedAt >= maxDurationMs) {
      stopTimer();
      publish({
        phase: 'timed-out',
        message:
          'Still waiting for authorization. Finish signing in within the opened tab, then click Check status.',
      });
      return;
    }

    checkInFlight = true;
    try {
      const hubStatus = await deps.fetchStatus();
      if (disposed || activeEpoch !== epoch) return;

      deps.onStatusObserved?.(hubStatus);
      const chatGptConn = hubStatus.connections.find((c) => c.id === 'chatgpt-plan');
      if (chatGptConn?.state !== 'connected') {
        if (now() - startedAt >= maxDurationMs) {
          stopTimer();
          publish({
            phase: 'timed-out',
            message:
              'Still waiting for authorization. Finish signing in within the opened tab, then click Check status.',
          });
        }
        return;
      }

      // Server verified connected: stop polling and perform exactly ONE targeted catalog refresh.
      stopTimer();
      publish({
        phase: 'loading-models',
        message: 'ChatGPT connected. Loading your account’s available models…',
      });

      const catalogResult = await deps.refreshChatGptCatalog();
      if (disposed || activeEpoch !== epoch) return;

      if (catalogResult.ok) {
        const count = catalogResult.modelCount ?? 0;
        publish({
          phase: 'ready',
          message:
            count > 0
              ? `ChatGPT connected and ready (${count} verified model${count === 1 ? '' : 's'} loaded).`
              : 'ChatGPT connected and ready. No eligible text models were listed for this account.',
        });
      } else {
        publish({
          phase: 'catalog-unavailable',
          message:
            'ChatGPT is connected, but the model catalog could not be loaded. Use Retry Catalog below.',
          error: catalogResult.error,
        });
      }
    } catch {
      // Transient status poll error while waiting: keep bounded polling until deadline.
      if (!disposed && activeEpoch === epoch && now() - startedAt >= maxDurationMs) {
        stopTimer();
        publish({
          phase: 'timed-out',
          message:
            'Still waiting for authorization. Check the local server connection and click Check status.',
        });
      }
    } finally {
      checkInFlight = false;
    }
  };

  const start = () => {
    if (disposed) return;
    stopTimer();
    epoch += 1;
    startedAt = now();
    checkInFlight = false;
    publish({
      phase: 'waiting-authorization',
      message:
        'Waiting for authorization in the opened tab. This screen will update automatically once sign-in finishes.',
    });
    timer = setIntervalFn(() => {
      void triggerCheck();
    }, pollIntervalMs);
  };

  const cancel = () => {
    stopTimer();
    epoch += 1;
    checkInFlight = false;
    publish({ phase: 'idle', message: '' });
  };

  const dispose = () => {
    disposed = true;
    stopTimer();
    epoch += 1;
    checkInFlight = false;
  };

  return {
    start,
    triggerCheck,
    cancel,
    dispose,
    getState: () => state,
  };
}
