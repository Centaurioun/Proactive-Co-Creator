import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { computeForceLayout, computeNodeDimensions } from '../lib/graphLayout.ts';
import { buildSyntheticGraphProject } from './stage0-fixtures.ts';
import { synthesizeRefinedPrompt } from '../lib/promptBuilder.ts';
import { evaluateProjectConsistency } from '../lib/consistencyChecker.ts';

interface LayoutBenchRow {
  entityCount: number;
  edgeCount: number;
  runs: number;
  medianMs: number;
  minMs: number;
  maxMs: number;
  meanMs: number;
  promptChars: number;
  promptSynthMs: number;
  consistencyIssues: number;
  consistencyMs: number;
  serializedBytes: number;
  positionSpread: { width: number; height: number };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function runBench(): void {
  const sizes = [10, 30, 100, 250];
  const rows: LayoutBenchRow[] = [];

  for (const size of sizes) {
    const project = buildSyntheticGraphProject(size);
    const snap = project.snapshot;
    const entities = snap.entities;
    const relationships = snap.relationships;
    const nodeDimensions = computeNodeDimensions(entities);
    const runs = size <= 30 ? 7 : size <= 100 ? 5 : 3;
    const durations: number[] = [];
    let lastPositions: Record<string, { x: number; y: number }> = {};

    for (let r = 0; r < runs; r++) {
      const t0 = performance.now();
      lastPositions = computeForceLayout({
        objectEntities: entities,
        relationships,
        nodeDimensions,
        containerWidth: 960,
        containerHeight: 600,
      });
      durations.push(Number((performance.now() - t0).toFixed(2)));
    }

    const xs = Object.values(lastPositions).map((p) => p.x);
    const ys = Object.values(lastPositions).map((p) => p.y);
    const spreadWidth = xs.length > 0 ? Math.round(Math.max(...xs) - Math.min(...xs)) : 0;
    const spreadHeight = ys.length > 0 ? Math.round(Math.max(...ys) - Math.min(...ys)) : 0;

    const pt0 = performance.now();
    const prompt = synthesizeRefinedPrompt(snap, 'story');
    const promptSynthMs = Number((performance.now() - pt0).toFixed(2));

    const ct0 = performance.now();
    const issues = evaluateProjectConsistency(snap);
    const consistencyMs = Number((performance.now() - ct0).toFixed(2));

    rows.push({
      entityCount: entities.length,
      edgeCount: relationships.length,
      runs,
      medianMs: Number(median(durations).toFixed(2)),
      minMs: Math.min(...durations),
      maxMs: Math.max(...durations),
      meanMs: Number((durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(2)),
      promptChars: prompt.length,
      promptSynthMs,
      consistencyIssues: issues.length,
      consistencyMs,
      serializedBytes: Buffer.byteLength(JSON.stringify(project), 'utf8'),
      positionSpread: { width: spreadWidth, height: spreadHeight },
    });
  }

  // Test 8,000-character compiled prompt boundary
  const longPromptProject = buildSyntheticGraphProject(30);
  longPromptProject.snapshot.storyBible.continuityRules = {
    value: 'Continuity rule detail. '.repeat(350),
    status: 'confirmed',
    provenance: 'user-edit',
    updatedAt: longPromptProject.updatedAt,
  };
  const longPromptT0 = performance.now();
  const longPrompt = synthesizeRefinedPrompt(longPromptProject.snapshot, 'story');
  const longPromptMs = Number((performance.now() - longPromptT0).toFixed(2));

  const report = {
    measuredAt: new Date().toISOString(),
    environment: {
      nodeVersion: process.version,
      platform: `${os.platform()} ${os.release()} ${os.arch()}`,
      cpus: os.cpus().length,
      cpuModel: os.cpus()[0]?.model ?? 'unknown',
      totalMemMb: Math.round(os.totalmem() / (1024 * 1024)),
    },
    graphLayoutBenchmarks: rows,
    longPromptBoundary: {
      chars: longPrompt.length,
      synthMs: longPromptMs,
    },
  };

  const outPath = path.resolve(process.cwd(), '.playwright-cli/stage0-node-perf.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

runBench();
