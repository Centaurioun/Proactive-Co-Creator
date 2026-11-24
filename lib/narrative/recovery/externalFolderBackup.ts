export interface ExternalFolderSupportStatus {
  supported: boolean;
  reason: string;
}

export interface ExternalBackupDestinationResult {
  ok: boolean;
  destination: 'external-folder';
  filename?: string;
  folderName?: string;
  sha256?: string;
  verifiedReadback: boolean;
  error?: string;
}

interface DirectoryHandleLike {
  name: string;
  queryPermission?: (desc: { mode: 'readwrite' }) => Promise<'granted' | 'denied' | 'prompt'>;
  requestPermission?: (desc: { mode: 'readwrite' }) => Promise<'granted' | 'denied' | 'prompt'>;
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<{
    createWritable: () => Promise<{ write: (data: BlobPart) => Promise<void>; close: () => Promise<void> }>;
    getFile: () => Promise<File>;
  }>;
}

export function detectExternalFolderBackupSupport(): ExternalFolderSupportStatus {
  if (typeof window === 'undefined') {
    return { supported: false, reason: 'External folder backup requires a browser environment.' };
  }
  const hasPicker = typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
  if (!hasPicker) {
    return {
      supported: false,
      reason: 'This browser does not support the File System Access API (showDirectoryPicker). Use portable archive download instead.',
    };
  }
  try {
    if (window.self !== window.top) {
      return {
        supported: false,
        reason: 'External folder picker is restricted inside embedded preview iframes. Use portable archive download or open in a top-level Chromium window.',
      };
    }
  } catch {
    return {
      supported: false,
      reason: 'External folder picker is restricted in cross-origin iframes. Use portable archive download instead.',
    };
  }
  return {
    supported: true,
    reason: 'File System Access API is available for explicit user-approved folder backups.',
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Prompts the user (must be invoked from an explicit click gesture) to choose a folder,
 * checks write permission, writes the backup bytes, and performs immediate readback SHA-256 verification.
 */
export async function writeVerifiedExternalFolderBackup(
  filename: string,
  bytes: Uint8Array
): Promise<ExternalBackupDestinationResult> {
  const support = detectExternalFolderBackupSupport();
  if (!support.supported) {
    return {
      ok: false,
      destination: 'external-folder',
      verifiedReadback: false,
      error: support.reason,
    };
  }

  try {
    const picker = (window as unknown as { showDirectoryPicker: (opts?: { mode?: 'readwrite' }) => Promise<DirectoryHandleLike> }).showDirectoryPicker;
    const dirHandle = await picker({ mode: 'readwrite' });

    if (typeof dirHandle.queryPermission === 'function') {
      let state = await dirHandle.queryPermission({ mode: 'readwrite' });
      if (state !== 'granted' && typeof dirHandle.requestPermission === 'function') {
        state = await dirHandle.requestPermission({ mode: 'readwrite' });
      }
      if (state !== 'granted') {
        return {
          ok: false,
          destination: 'external-folder',
          folderName: dirHandle.name,
          verifiedReadback: false,
          error: 'Write permission was not granted for the selected folder.',
        };
      }
    }

    const expectedHash = await sha256Hex(bytes);
    const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    const writeCopy = new Uint8Array(bytes.byteLength);
    writeCopy.set(bytes);
    await writable.write(writeCopy);
    await writable.close();

    // Immediate readback verification
    const readFile = await fileHandle.getFile();
    const readBytes = new Uint8Array(await readFile.arrayBuffer());
    const readHash = await sha256Hex(readBytes);
    if (readBytes.byteLength !== bytes.byteLength || readHash !== expectedHash) {
      return {
        ok: false,
        destination: 'external-folder',
        filename,
        folderName: dirHandle.name,
        verifiedReadback: false,
        error: 'External folder backup readback checksum did not match written bytes.',
      };
    }

    return {
      ok: true,
      destination: 'external-folder',
      filename,
      folderName: dirHandle.name,
      sha256: readHash,
      verifiedReadback: true,
    };
  } catch (err) {
    const msg =
      err instanceof Error && err.name === 'AbortError'
        ? 'Folder selection was cancelled.'
        : err instanceof Error
          ? err.message
          : 'Could not write backup to external folder.';
    return {
      ok: false,
      destination: 'external-folder',
      verifiedReadback: false,
      error: msg,
    };
  }
}
