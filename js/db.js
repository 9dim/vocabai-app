/**
 * IndexedDB storage engine for Vocabulary PWA.
 * Manages 'words', 'pendingReviews', and 'metrics'.
 */

const DB_NAME = 'vocab_pwa_db';
const DB_VERSION = 1;

class VocabDB {
  constructor() {
    this.db = null;
  }

  async open() {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        // Words store
        if (!db.objectStoreNames.contains('words')) {
          const wordStore = db.createObjectStore('words', { keyPath: 'id' });
          wordStore.createIndex('word', 'word', { unique: true });
          wordStore.createIndex('dueDate', 'dueDate', { unique: false });
          wordStore.createIndex('interval', 'interval', { unique: false });
          wordStore.createIndex('lastReviewed', 'lastReviewed', { unique: false });
        }

        // Pending AI evaluations store (when offline or queued)
        if (!db.objectStoreNames.contains('pendingReviews')) {
          const pendingStore = db.createObjectStore('pendingReviews', { keyPath: 'id' });
          pendingStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // Metrics & settings store (streaks, token counters, settings)
        if (!db.objectStoreNames.contains('metrics')) {
          db.createObjectStore('metrics', { keyPath: 'key' });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  async getTransaction(storeNames, mode = 'readonly') {
    const db = await this.open();
    return db.transaction(storeNames, mode);
  }

  // --- Words CRUD ---

  async getAllWords() {
    const tx = await this.getTransaction('words', 'readonly');
    const store = tx.objectStore('words');
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async getWord(id) {
    const tx = await this.getTransaction('words', 'readonly');
    const store = tx.objectStore('words');
    return new Promise((resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async putWord(wordData) {
    const tx = await this.getTransaction('words', 'readwrite');
    const store = tx.objectStore('words');
    return new Promise((resolve, reject) => {
      const request = store.put(wordData);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async putWordsBulk(wordsArray) {
    const tx = await this.getTransaction('words', 'readwrite');
    const store = tx.objectStore('words');
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
      for (const word of wordsArray) {
        store.put(word);
      }
    });
  }

  async deleteWord(id) {
    const tx = await this.getTransaction('words', 'readwrite');
    const store = tx.objectStore('words');
    return new Promise((resolve, reject) => {
      const request = store.delete(id);
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  async clearAllWords() {
    const tx = await this.getTransaction('words', 'readwrite');
    const store = tx.objectStore('words');
    return new Promise((resolve, reject) => {
      const request = store.clear();
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  // --- Pending Reviews ---

  async getPendingReviews() {
    const tx = await this.getTransaction('pendingReviews', 'readonly');
    const store = tx.objectStore('pendingReviews');
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async putPendingReview(reviewData) {
    const tx = await this.getTransaction('pendingReviews', 'readwrite');
    const store = tx.objectStore('pendingReviews');
    return new Promise((resolve, reject) => {
      const request = store.put(reviewData);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async removePendingReviews(ids) {
    const tx = await this.getTransaction('pendingReviews', 'readwrite');
    const store = tx.objectStore('pendingReviews');
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
      for (const id of ids) {
        store.delete(id);
      }
    });
  }

  async clearAllPendingReviews() {
    const tx = await this.getTransaction('pendingReviews', 'readwrite');
    const store = tx.objectStore('pendingReviews');
    return new Promise((resolve, reject) => {
      const request = store.clear();
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  // --- Metrics & Key-Value Config ---

  async getMetric(key, defaultValue = null) {
    const tx = await this.getTransaction('metrics', 'readonly');
    const store = tx.objectStore('metrics');
    return new Promise((resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => {
        if (request.result && request.result.value !== undefined) {
          resolve(request.result.value);
        } else {
          resolve(defaultValue);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  async setMetric(key, value) {
    const tx = await this.getTransaction('metrics', 'readwrite');
    const store = tx.objectStore('metrics');
    return new Promise((resolve, reject) => {
      const request = store.put({ key, value });
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  async getAllMetrics() {
    const tx = await this.getTransaction('metrics', 'readonly');
    const store = tx.objectStore('metrics');
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => {
        const result = {};
        for (const item of request.result || []) {
          result[item.key] = item.value;
        }
        resolve(result);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async clearAllMetrics() {
    const tx = await this.getTransaction('metrics', 'readwrite');
    const store = tx.objectStore('metrics');
    return new Promise((resolve, reject) => {
      const request = store.clear();
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }
}

export const db = new VocabDB();
