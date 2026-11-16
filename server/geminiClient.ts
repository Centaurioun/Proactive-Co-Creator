/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { AppApiError } from './errors.ts';

let cachedKey: string | null = null;
let cachedClient: GoogleGenAI | null = null;
let envFilesChecked = false;

export interface LoadEnvOptions {
  cwd?: string;
  files?: string[];
  override?: boolean;
  targetEnv?: NodeJS.ProcessEnv;
}

/**
 * Parses and loads server-side environment variables from `.env.local` and `.env`
 * when not already injected by the host runtime (e.g. AI Studio Secrets or shell export).
 * Never exposes server secrets to client `VITE_*` variables.
 */
export function loadServerEnvFromFiles(options: LoadEnvOptions = {}): string[] {
  const cwd = options.cwd ?? process.cwd();
  const files = options.files ?? ['.env.local', '.env'];
  const override = options.override ?? false;
  const targetEnv = options.targetEnv ?? process.env;
  const loadedKeys: string[] = [];

  for (const filename of files) {
    const fullPath = path.resolve(cwd, filename);
    if (!fs.existsSync(fullPath)) continue;

    let rawContent: string;
    try {
      rawContent = fs.readFileSync(fullPath, 'utf8');
    } catch {
      continue;
    }

    const lines = rawContent.split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;

      const normalized = line.startsWith('export ') ? line.slice(7).trim() : line;
      const eqIndex = normalized.indexOf('=');
      if (eqIndex <= 0) continue;

      const key = normalized.slice(0, eqIndex).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
      if (key.startsWith('VITE_')) continue;

      let value = normalized.slice(eqIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      } else {
        const inlineCommentIdx = value.indexOf(' #');
        if (inlineCommentIdx !== -1) {
          value = value.slice(0, inlineCommentIdx).trim();
        }
      }

      const existing = targetEnv[key]?.trim();
      if (!existing || override) {
        targetEnv[key] = value;
        loadedKeys.push(key);
      }
    }
  }

  return loadedKeys;
}

function ensureServerEnvLoaded(): void {
  if (!process.env.GEMINI_API_KEY?.trim() && !envFilesChecked) {
    envFilesChecked = true;
    loadServerEnvFromFiles();
  }
}

export function resetServerEnvCacheForTesting(): void {
  envFilesChecked = false;
  cachedKey = null;
  cachedClient = null;
}

export function hasConfiguredGeminiKey(): boolean {
  ensureServerEnvLoaded();
  const key = process.env.GEMINI_API_KEY?.trim();
  return Boolean(key);
}

export function getGeminiClient(): GoogleGenAI {
  ensureServerEnvLoaded();
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new AppApiError(
      'MISSING_API_KEY',
      'Server GEMINI_API_KEY is not configured. Add it in Settings > Secrets (or .env.local for local development).',
      503,
      false
    );
  }

  if (!cachedClient || cachedKey !== apiKey) {
    cachedKey = apiKey;
    cachedClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }

  return cachedClient;
}

