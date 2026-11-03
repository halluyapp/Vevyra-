import { initializeApp, getApps } from 'firebase/app';
import {
  getFirestore,
  doc,
  setDoc,
  deleteDoc,
  collection,
  onSnapshot,
  getDocFromServer,
} from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

export const db = firebaseConfig.firestoreDatabaseId
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);

export const auth = getAuth(app);

// Connection test per Firebase skill
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

export function handleFirestoreError(context) {
  const msg = context.error?.message || String(context.error);
  console.warn(`[Firestore Error - ${context.operation} at ${context.path}]:`, msg);
}

// Ensure anonymous or persistent user
let currentUserId = null;
const authListeners = new Set();

onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUserId = user.uid;
    authListeners.forEach((cb) => cb(user.uid));
  } else {
    signInAnonymously(auth).catch((err) => {
      console.warn('Anonymous auth note:', err.message);
    });
  }
});

export function onUserReady(cb) {
  if (currentUserId) {
    cb(currentUserId);
  }
  authListeners.add(cb);
  return () => authListeners.delete(cb);
}

// Watchlist sync
export async function syncWatchlistAdd(userId, item) {
  if (!userId || !item) return;
  const itemId = String(item.subjectId || item.id || item.detailPath).slice(0, 60);
  const ref = doc(db, 'users', userId, 'watchlist', itemId);
  try {
    await setDoc(ref, {
      userId,
      subjectId: String(item.subjectId || item.id || ''),
      detailPath: String(item.detailPath || item.slug || ''),
      title: String(item.title || item.name || '').slice(0, 250),
      poster: String(item.poster || item.poster_url || '').slice(0, 1000),
      type: item.type || 'movie',
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    handleFirestoreError({ operation: 'syncWatchlistAdd', path: ref.path, error });
  }
}

export async function syncWatchlistRemove(userId, itemId) {
  if (!userId || !itemId) return;
  const cleanId = String(itemId).slice(0, 60);
  const ref = doc(db, 'users', userId, 'watchlist', cleanId);
  try {
    await deleteDoc(ref);
  } catch (error) {
    handleFirestoreError({ operation: 'syncWatchlistRemove', path: ref.path, error });
  }
}

export function subscribeUserWatchlist(userId, onData) {
  if (!userId) return () => {};
  const colRef = collection(db, 'users', userId, 'watchlist');
  return onSnapshot(
    colRef,
    (snapshot) => {
      const items = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));
      onData(items);
    },
    (error) => {
      handleFirestoreError({ operation: 'subscribeWatchlist', path: colRef.path, error });
    }
  );
}

// History sync
export async function syncHistoryUpdate(userId, record) {
  if (!userId || !record) return;
  const historyId = String(record.subjectId || record.id || record.detailPath).slice(0, 60);
  const ref = doc(db, 'users', userId, 'history', historyId);
  try {
    await setDoc(
      ref,
      {
        userId,
        subjectId: String(record.subjectId || record.id || ''),
        detailPath: String(record.detailPath || record.slug || ''),
        title: String(record.title || record.name || '').slice(0, 250),
        poster: String(record.poster || record.poster_url || '').slice(0, 1000),
        type: record.type || 'movie',
        season: Number(record.season) || 0,
        episode: Number(record.episode) || 0,
        progressSeconds: Math.floor(Number(record.progressSeconds) || 0),
        durationSeconds: Math.floor(Number(record.durationSeconds) || 0),
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
  } catch (error) {
    handleFirestoreError({ operation: 'syncHistoryUpdate', path: ref.path, error });
  }
}

export async function syncHistoryDelete(userId, historyId) {
  if (!userId || !historyId) return;
  const cleanId = String(historyId).slice(0, 60);
  const ref = doc(db, 'users', userId, 'history', cleanId);
  try {
    await deleteDoc(ref);
  } catch (error) {
    handleFirestoreError({ operation: 'syncHistoryDelete', path: ref.path, error });
  }
}

export function subscribeUserHistory(userId, onData) {
  if (!userId) return () => {};
  const colRef = collection(db, 'users', userId, 'history');
  return onSnapshot(
    colRef,
    (snapshot) => {
      const records = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));
      // Sort newest updated first
      records.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      onData(records);
    },
    (error) => {
      handleFirestoreError({ operation: 'subscribeHistory', path: colRef.path, error });
    }
  );
}

// Download sync
export async function syncDownloadRecord(userId, task) {
  if (!userId || !task) return;
  const downloadId = String(task.id || task.subjectId).slice(0, 60);
  const ref = doc(db, 'users', userId, 'downloads', downloadId);
  try {
    await setDoc(
      ref,
      {
        userId,
        subjectId: String(task.subjectId || task.id || ''),
        detailPath: String(task.detailPath || ''),
        title: String(task.title || '').slice(0, 250),
        poster: String(task.poster || '').slice(0, 1000),
        season: Number(task.season) || 0,
        episode: Number(task.episode) || 0,
        resolution: String(task.resolution || '480p'),
        status: task.status || 'downloading',
        downloadedBytes: Number(task.downloadedBytes) || 0,
        totalBytes: Number(task.totalBytes) || 0,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
  } catch (error) {
    handleFirestoreError({ operation: 'syncDownloadRecord', path: ref.path, error });
  }
}

export async function syncDownloadDelete(userId, downloadId) {
  if (!userId || !downloadId) return;
  const cleanId = String(downloadId).slice(0, 60);
  const ref = doc(db, 'users', userId, 'downloads', cleanId);
  try {
    await deleteDoc(ref);
  } catch (error) {
    handleFirestoreError({ operation: 'syncDownloadDelete', path: ref.path, error });
  }
}
