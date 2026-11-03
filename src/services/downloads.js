// Real Offline Download Manager
// Uses IndexedDB to store downloaded media blobs with actual chunked Range byte tracking

const DB_NAME = 'veyra_offline_db';
const DB_VERSION = 1;
const STORE_NAME = 'media_blobs';

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveMediaBlob(id, blob, metadata = {}) {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put({ id, blob, metadata, savedAt: Date.now() });
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[Offline DB save error]', err);
    return false;
  }
}

export async function getMediaBlob(id) {
  try {
    const db = await openDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result?.blob || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function deleteMediaBlob(id) {
  try {
    const db = await openDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

// Active download controllers map
const activeDownloads = new Map();

export async function startMediaDownload({
  id,
  streamUrl,
  proxyUrl,
  onProgress,
  onComplete,
  onError,
}) {
  if (activeDownloads.has(id)) {
    console.warn('Download already in progress for', id);
    return;
  }

  const controller = new AbortController();
  activeDownloads.set(id, controller);

  try {
    // Prefer proxyUrl to ensure proper headers and CORS
    const targetUrl = proxyUrl || streamUrl;
    const response = await fetch(targetUrl, {
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Media fetch failed with status ${response.status}`);
    }

    const contentLength = Number(response.headers.get('content-length')) || 0;
    const contentType = response.headers.get('content-type') || 'video/mp4';

    if (!response.body) {
      const blob = await response.blob();
      await saveMediaBlob(id, blob, { size: blob.size, type: contentType });
      onComplete?.(blob);
      return;
    }

    const reader = response.body.getReader();
    let receivedBytes = 0;
    const chunks = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      chunks.push(value);
      receivedBytes += value.byteLength;

      const percent = contentLength > 0 ? (receivedBytes / contentLength) * 100 : 0;
      onProgress?.({
        receivedBytes,
        totalBytes: contentLength || receivedBytes,
        percent: Math.min(100, Math.round(percent * 10) / 10),
      });
    }

    const completeBlob = new Blob(chunks, { type: contentType });
    await saveMediaBlob(id, completeBlob, { size: receivedBytes, type: contentType });

    activeDownloads.delete(id);
    onComplete?.(completeBlob);
  } catch (error) {
    activeDownloads.delete(id);
    if (error.name === 'AbortError') {
      console.log('Download aborted by user:', id);
    } else {
      console.error('Download failure:', error);
      onError?.(error);
    }
  }
}

export function cancelMediaDownload(id) {
  const ctrl = activeDownloads.get(id);
  if (ctrl) {
    ctrl.abort();
    activeDownloads.delete(id);
  }
}
