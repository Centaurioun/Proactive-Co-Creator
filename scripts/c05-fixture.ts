import { createHash } from 'node:crypto';
import { buildFxBusy } from './stage0-fixtures.ts';

// Emits a stable, wholly synthetic FX-BUSY record for isolated browser seeding.
// The fixture source is the existing deterministic Stage 0 builder; this wrapper
// verifies repeatability and does not touch browser storage or production data.
const first = buildFxBusy();
const second = buildFxBusy();
const canonical = (value: unknown): string => JSON.stringify(value);
const firstJson = canonical(first);
const secondJson = canonical(second);

if (firstJson !== secondJson) {
  throw new Error('FX-BUSY fixture is not deterministic across consecutive builds');
}

const digest = createHash('sha256').update(firstJson).digest('hex');
process.stdout.write(`${JSON.stringify({ fixture: first, sha256: digest }, null, 2)}\n`);
