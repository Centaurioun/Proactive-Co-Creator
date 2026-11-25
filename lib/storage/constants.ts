/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CreativeProject } from '../../shared/types.ts';

export const CURRENT_SCHEMA_VERSION = 3;
export const NARRATIVE_SCHEMA_VERSION = 4;
export const LOCAL_STORAGE_PROJECTS_KEY = 'proactive_co_creator_projects_v2';
export const LOCAL_STORAGE_ACTIVE_ID_KEY = 'proactive_co_creator_active_id_v2';
export const LOCAL_STORAGE_BACKUP_V2_KEY = 'proactive_co_creator_backup_v2';
export const LOCAL_STORAGE_DELETED_IDS_KEY = 'proactive_co_creator_deleted_ids_v2';
export const IDB_NAME = 'proactive_co_creator_db_v2';
export const IDB_STORE = 'projects';

export interface DurableWriteOptions {
  expectedPersistedRevision?: number;
  expectedManuscriptVersionId?: string;
  expectedBaseSnapshotDigest?: string;
  /** Exact observed record, or null for create-if-absent. Checked inside the write transaction. */
  expectedBaseProject?: CreativeProject | null;
  intentId?: string;
  forceOverwrite?: boolean;
  allowDeleted?: boolean;
  requireExactBase?: boolean;
}

export interface StorageSaveResult {
  ok: boolean;
  saved?: boolean;
  idempotentHit?: boolean;
  conflictDetected?: boolean;
  quotaExceeded?: boolean;
  storedProject?: CreativeProject;
  persistedRevision?: number;
  authoritativeStore?: 'indexeddb' | 'localstorage';
  idbSaved?: boolean;
  localSaved?: boolean;
  cacheSynced?: boolean;
  cacheWarning?: string;
  error?: string;
}

export type IndexedDbLoadStatus = 'ok' | 'empty' | 'unavailable' | 'read_error';

export interface IndexedDbLoadResult {
  ok: boolean;
  status: IndexedDbLoadStatus;
  projects: CreativeProject[];
  corruptRecordCount: number;
  corruptRecordErrors: string[];
  error?: string;
}
