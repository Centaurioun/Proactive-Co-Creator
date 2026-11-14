/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'node:crypto';

export interface StoredVideoEntry {
  buffer: Buffer;
  mimeType: string;
  createdAt: number;
}

const DEFAULT_MAX_ENTRIES = 6;
const DEFAULT_TTL_MS = 30 * 60 * 1000;

export class VideoMemoryStore {
  private readonly entries = new Map<string, StoredVideoEntry>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;

  constructor(maxEntries: number = DEFAULT_MAX_ENTRIES, ttlMs: number = DEFAULT_TTL_MS) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
  }

  put(buffer: Buffer, mimeType: string = 'video/mp4'): string {
    this.pruneExpired();

    if (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey) {
        this.entries.delete(oldestKey);
      }
    }

    const id = crypto.randomUUID();
    this.entries.set(id, {
      buffer,
      mimeType,
      createdAt: Date.now(),
    });
    return id;
  }

  get(id: string): StoredVideoEntry | null {
    this.pruneExpired();
    const entry = this.entries.get(id);
    if (!entry) return null;
    return entry;
  }

  private pruneExpired(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [id, entry] of this.entries.entries()) {
      if (entry.createdAt < cutoff) {
        this.entries.delete(id);
      }
    }
  }
}

export const videoStore = new VideoMemoryStore();
