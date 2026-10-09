import type { Artwork } from './types';

const DB_NAME = 'kumonosu-oekaki';
const STORE = 'artworks';

export async function saveArtwork(artwork: Artwork): Promise<void> {
  if (!('indexedDB' in window)) { localStorage.setItem('kumonosu-latest', JSON.stringify(artwork)); return; }
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { const tx = request.result.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(artwork); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); };
  });
}

export async function listArtworks(): Promise<Artwork[]> {
  if (!('indexedDB' in window)) { const value = localStorage.getItem('kumonosu-latest'); return value ? [JSON.parse(value) as Artwork] : []; }
  return new Promise((resolve) => { const request = indexedDB.open(DB_NAME, 1); request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' }); request.onsuccess = () => { const get = request.result.transaction(STORE, 'readonly').objectStore(STORE).getAll(); get.onsuccess = () => resolve(get.result as Artwork[]); get.onerror = () => resolve([]); }; request.onerror = () => resolve([]); });
}

export async function deleteArtwork(id: string): Promise<void> {
  if (!('indexedDB' in window)) { const value = localStorage.getItem('kumonosu-latest'); if (value && (JSON.parse(value) as Artwork).id === id) localStorage.removeItem('kumonosu-latest'); return; }
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { const tx = request.result.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(id); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); };
  });
}
