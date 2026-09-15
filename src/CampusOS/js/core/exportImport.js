/**
 * exportImport.js — backs Settings → Data Management (Instruction 32).
 *
 * Spec requirement (Note 10): don't claim file data is backed up unless
 * it genuinely is. Blobs (library files, achievement certificates) are
 * base64-encoded and embedded directly in the export JSON, so the export
 * really is a complete backup — at the cost of a larger file. That
 * tradeoff is stated in the UI, not hidden.
 */

import { CONFIG } from './config.js?v=5';
import { exportAllStores, bulkPut } from './db.js?v=5';
import { nowISO } from './utils.js?v=5';

async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBlob(base64, mime) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime || 'application/octet-stream' });
}

const BLOB_FIELDS = {
  [CONFIG.stores.libraryFiles.name]: ['blob'],
  [CONFIG.stores.achievements.name]: ['certificateBlob'],
};

export async function exportData() {
  const dump = await exportAllStores();

  for (const [storeName, fields] of Object.entries(BLOB_FIELDS)) {
    if (!dump[storeName]) continue;
    for (const record of dump[storeName]) {
      for (const field of fields) {
        if (record[field] instanceof Blob) {
          const base64 = await blobToBase64(record[field]);
          record[field] = { __blob: true, mime: record[field].type, data: base64 };
        }
      }
    }
  }

  return {
    product: CONFIG.productName,
    schemaVersion: CONFIG.db.version,
    exportedAt: nowISO(),
    data: dump,
  };
}

/** Triggers a real file save. Desktop browsers handle the classic
 * anchor-with-download-attribute trick fine, but many mobile browsers
 * (iOS Safari in particular) don't reliably respect `download` on a
 * blob: URL — clicking it often just opens the JSON in the browser
 * instead of saving a file. Where the Web Share API with file support
 * is available (most modern mobile browsers), we use that instead: it
 * opens the native share sheet, which includes a genuine "Save to
 * Files" option. Desktop falls back to the anchor-download approach. */
export async function downloadExport(payload) {
  const filename = `campusos-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const json = JSON.stringify(payload);
  const blob = new Blob([json], { type: 'application/json' });

  if (navigator.canShare) {
    try {
      const file = new File([blob], filename, { type: 'application/json' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        return;
      }
    } catch (err) {
      if (err?.name === 'AbortError') return; // user closed the share sheet — not a failure
      // otherwise fall through to the download-link approach below
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * Validates the top-level shape and imports store-by-store. A store this
 * app doesn't recognize is skipped (forward/backward compatibility);
 * a record that fails to write doesn't stop the rest of the import.
 * Returns a summary the caller can show the user.
 */
export async function importData(payload) {
  if (!payload || typeof payload !== 'object' || !payload.data || typeof payload.data !== 'object') {
    throw new Error('This file doesn\u2019t look like a CampusOS backup.');
  }

  const knownStores = new Set(Object.values(CONFIG.stores).map((s) => s.name));
  const summary = { imported: {}, skippedStores: [], errors: [] };

  for (const [storeName, records] of Object.entries(payload.data)) {
    if (!knownStores.has(storeName)) { summary.skippedStores.push(storeName); continue; }
    if (!Array.isArray(records)) continue;

    const fields = BLOB_FIELDS[storeName] || [];
    const restored = records.map((record) => {
      const copy = { ...record };
      for (const field of fields) {
        if (copy[field] && copy[field].__blob) {
          copy[field] = base64ToBlob(copy[field].data, copy[field].mime);
        }
      }
      return copy;
    });

    try {
      await bulkPut(storeName, restored);
      summary.imported[storeName] = restored.length;
    } catch (err) {
      summary.errors.push(`${storeName}: ${err.message || 'failed to import'}`);
    }
  }

  return summary;
}
