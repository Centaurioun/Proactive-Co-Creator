import { AppApiError } from '../errors.ts';

export interface SseEvent {
  type: string;
  [key: string]: unknown;
}

export interface SseReadLimits {
  maxStreamBytes: number;
  maxOutputBytes: number;
  maxEvents?: number;
}

export interface SseReadStats {
  streamBytes: number;
  eventCount: number;
}

interface SseFrameState {
  eventName: string;
  dataLines: string[];
  outputBytes: number;
  terminal: boolean;
}

const MAX_SSE_LINE_CHARS = 128 * 1024;
const utf8Encoder = new TextEncoder();

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function validateSseEvent(eventName: string, data: string): SseEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    throw new AppApiError('INVALID_RESPONSE', 'The Responses stream contained malformed SSE JSON.', 502, false);
  }
  const record = asRecord(parsed);
  if (!record || typeof record.type !== 'string') {
    throw new AppApiError('INVALID_RESPONSE', 'The Responses stream event did not contain a valid type.', 502, false);
  }
  if (eventName && eventName !== record.type) {
    throw new AppApiError('INVALID_RESPONSE', 'The Responses SSE event type did not match its JSON envelope.', 502, false);
  }
  return record as SseEvent;
}

function isTerminalEventType(type: string): boolean {
  return type === 'response.completed' || type === 'response.failed' || type === 'response.incomplete';
}

function applyFieldLine(line: string, state: SseFrameState): void {
  if (line.startsWith(':')) return;
  const colon = line.indexOf(':');
  const field = colon < 0 ? line : line.slice(0, colon);
  let fieldValue = colon < 0 ? '' : line.slice(colon + 1);
  if (fieldValue.startsWith(' ')) fieldValue = fieldValue.slice(1);
  if (field === 'event') state.eventName = fieldValue;
  else if (field === 'data') state.dataLines.push(fieldValue);
}

function recordDeltaOutputBytes(event: SseEvent, state: SseFrameState, maxOutputBytes: number): void {
  if (event.type !== 'response.output_text.delta') return;
  if (typeof event.delta !== 'string') {
    throw new AppApiError('INVALID_RESPONSE', 'The Responses stream contained a malformed text delta.', 502, false);
  }
  state.outputBytes += utf8Encoder.encode(event.delta).byteLength;
  if (state.outputBytes > maxOutputBytes) {
    throw new AppApiError('VALIDATION_ERROR', 'The Responses output exceeded the configured output byte limit.', 413, false);
  }
}

function incrementEventCount(limits: SseReadLimits, stats?: SseReadStats): void {
  if (!stats) return;
  stats.eventCount += 1;
  if (limits.maxEvents !== undefined && stats.eventCount > limits.maxEvents) {
    throw new AppApiError('VALIDATION_ERROR', 'The Responses stream exceeded the configured event-count limit.', 413, false);
  }
}

function dispatchFrame(
  state: SseFrameState,
  limits: SseReadLimits,
  stats?: SseReadStats,
): SseEvent | undefined {
  if (state.dataLines.length === 0) {
    state.eventName = '';
    return undefined;
  }
  if (state.terminal) {
    throw new AppApiError('INVALID_RESPONSE', 'The Responses stream emitted data after a terminal event.', 502, false);
  }
  incrementEventCount(limits, stats);
  const event = validateSseEvent(state.eventName, state.dataLines.join('\n'));
  state.eventName = '';
  state.dataLines = [];
  recordDeltaOutputBytes(event, state, limits.maxOutputBytes);
  if (isTerminalEventType(event.type)) state.terminal = true;
  return event;
}

function nextCompleteLine(pending: string): { line: string; rest: string } | undefined {
  const newlineIndex = pending.search(/[\r\n]/);
  if (newlineIndex < 0) return undefined;
  const char = pending[newlineIndex];
  if (char === '\r' && newlineIndex === pending.length - 1) return undefined;
  const line = pending.slice(0, newlineIndex);
  if (line.length > MAX_SSE_LINE_CHARS) {
    throw new AppApiError('INVALID_RESPONSE', 'The Responses stream contained an oversized SSE line.', 502, false);
  }
  const lineEndingLength = char === '\r' && pending[newlineIndex + 1] === '\n' ? 2 : 1;
  return { line, rest: pending.slice(newlineIndex + lineEndingLength) };
}

function drainPendingLines(
  pending: string,
  state: SseFrameState,
  limits: SseReadLimits,
  stats?: SseReadStats,
): { pending: string; events: SseEvent[] } {
  const events: SseEvent[] = [];
  let remaining = pending;
  let next = nextCompleteLine(remaining);
  while (next !== undefined) {
    remaining = next.rest;
    if (next.line === '') {
      const event = dispatchFrame(state, limits, stats);
      if (event) events.push(event);
    } else {
      applyFieldLine(next.line, state);
    }
    next = nextCompleteLine(remaining);
  }
  return { pending: remaining, events };
}

function flushTrailingData(
  pending: string,
  state: SseFrameState,
  limits: SseReadLimits,
  stats?: SseReadStats,
): SseEvent[] {
  const events: SseEvent[] = [];
  if (pending.length > 0) {
    const line = pending.replace(/\r$/, '');
    if (line === '') {
      const event = dispatchFrame(state, limits, stats);
      if (event) events.push(event);
    } else {
      applyFieldLine(line, state);
    }
  }
  const finalEvent = dispatchFrame(state, limits, stats);
  if (finalEvent) events.push(finalEvent);
  return events;
}

/**
 * Parse SSE frames strictly. Accepts standard comments/fields and multi-line data,
 * enforcing byte/event bounds and requiring valid JSON with a Responses event type.
 */
export async function* readSseEvents(
  response: Response,
  limits: SseReadLimits,
  stats?: SseReadStats,
): AsyncGenerator<SseEvent> {
  if (!response.body) {
    throw new AppApiError('INVALID_RESPONSE', 'The Responses endpoint returned no stream body.', 502, false);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let pending = '';
  let streamBytes = 0;
  const state: SseFrameState = { eventName: '', dataLines: [], outputBytes: 0, terminal: false };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      streamBytes += value.byteLength;
      if (stats) stats.streamBytes = streamBytes;
      if (streamBytes > limits.maxStreamBytes) {
        throw new AppApiError('VALIDATION_ERROR', 'The Responses stream exceeded the adapter byte limit.', 413, false);
      }
      pending += decoder.decode(value, { stream: true });
      if (pending.length > MAX_SSE_LINE_CHARS && !/[\r\n]/.test(pending)) {
        throw new AppApiError('INVALID_RESPONSE', 'The Responses stream contained an oversized SSE line.', 502, false);
      }
      const drained = drainPendingLines(pending, state, limits, stats);
      pending = drained.pending;
      for (const event of drained.events) yield event;
    }
    pending += decoder.decode();
    for (const event of flushTrailingData(pending, state, limits, stats)) yield event;
  } catch (error) {
    try { await reader.cancel(error); } catch { /* best-effort stream cleanup */ }
    if (error instanceof AppApiError) throw error;
    throw new AppApiError('INVALID_RESPONSE', 'The Responses stream could not be decoded.', 502, false);
  } finally {
    reader.releaseLock();
  }
}
