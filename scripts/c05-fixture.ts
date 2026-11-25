import { createHash } from 'node:crypto';
import { buildFxBusy, STAGE0_FIXED_TIMESTAMP } from './stage0-fixtures.ts';

// Emits a stable, wholly synthetic FX-BUSY record for isolated browser seeding.
// Lock the fixture clock before its deterministic ID sequence is consumed; a
// second same-process build would intentionally advance the module ID counter.
// This wrapper does not touch browser storage or production data.
const originalNow = Date.now;
Date.now = () => STAGE0_FIXED_TIMESTAMP;
let first: ReturnType<typeof buildFxBusy>;
try {
  first = buildFxBusy();
} finally {
  Date.now = originalNow;
}
const canonical = (value: unknown): string => JSON.stringify(value);
const firstJson = canonical(first);
const digest = createHash('sha256').update(firstJson).digest('hex');
process.stdout.write(`${JSON.stringify({ fixture: first, sha256: digest }, null, 2)}\n`);
