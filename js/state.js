/**
 * Reactive in-memory state store with IndexedDB write-through synchronization.
 */
import { db } from './db.js';
import { calculateSM2 } from './sm2.js';
import { GeminiService } from './gemini.js';

class StateStore {
  constructor() {
    this.words = [];
    this.pendingReviews = [];
    this.metrics = {
      apiKey: '',
      streak: 0,
      lastStreakDate: null,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      totalCostUSD: 0,
      reviewCount: 0,
      correctReviewCount: 0
    };
    this.gemini = new GeminiService();
    this.listeners = new Set();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(event, payload) {
    for (const listener of this.listeners) {
      try {
        listener(event, payload);
      } catch (e) {
        console.error('State listener error:', e);
      }
    }
  }

  async init() {
    await db.open();
    const storedWords = await db.getAllWords();
    const storedPending = await db.getPendingReviews();
    const storedMetrics = await db.getAllMetrics();

    this.words = storedWords || [];
    this.pendingReviews = storedPending || [];
    this.metrics = { ...this.metrics, ...storedMetrics };

    if (this.metrics.apiKey) {
      this.gemini.setApiKey(this.metrics.apiKey);
    }
    if (this.metrics.preferredModel) {
      this.gemini.setActiveModel(this.metrics.preferredModel);
    }
    if (this.metrics.customPrompts) {
      this.gemini.setCustomPrompts(this.metrics.customPrompts);
    }

    this.updateDailyStreak();
    this.notify('init', { words: this.words });
  }

  // --- Daily Streak Calculation ---

  updateDailyStreak() {
    const todayStr = new Date().toISOString().slice(0, 10);
    const lastDate = this.metrics.lastStreakDate;

    if (!lastDate) {
      // First time streak setup
      return;
    }

    const todayMs = new Date(todayStr).getTime();
    const lastMs = new Date(lastDate).getTime();
    const diffDays = Math.round((todayMs - lastMs) / (24 * 60 * 60 * 1000));

    if (diffDays > 1) {
      // Streak broken
      this.metrics.streak = 0;
      db.setMetric('streak', 0);
    }
  }

  recordDailyActivity() {
    const todayStr = new Date().toISOString().slice(0, 10);
    const lastDate = this.metrics.lastStreakDate;

    if (lastDate === todayStr) {
      // Already recorded for today
      return;
    }

    if (!lastDate) {
      this.metrics.streak = 1;
    } else {
      const todayMs = new Date(todayStr).getTime();
      const lastMs = new Date(lastDate).getTime();
      const diffDays = Math.round((todayMs - lastMs) / (24 * 60 * 60 * 1000));

      if (diffDays === 1) {
        this.metrics.streak = (this.metrics.streak || 0) + 1;
      } else {
        this.metrics.streak = 1;
      }
    }

    this.metrics.lastStreakDate = todayStr;
    db.setMetric('streak', this.metrics.streak);
    db.setMetric('lastStreakDate', todayStr);
    this.notify('metrics_updated', this.metrics);
  }

  // --- Token Tracking ---

  recordTokens(tokenStats) {
    if (!tokenStats) return;

    this.metrics.totalInputTokens = (this.metrics.totalInputTokens || 0) + (tokenStats.inputTokens || 0);
    this.metrics.totalOutputTokens = (this.metrics.totalOutputTokens || 0) + (tokenStats.outputTokens || 0);
    this.metrics.totalTokens = (this.metrics.totalTokens || 0) + (tokenStats.totalTokens || 0);
    this.metrics.totalCostUSD = (this.metrics.totalCostUSD || 0) + (tokenStats.estimatedCostUSD || 0);

    db.setMetric('totalInputTokens', this.metrics.totalInputTokens);
    db.setMetric('totalOutputTokens', this.metrics.totalOutputTokens);
    db.setMetric('totalTokens', this.metrics.totalTokens);
    db.setMetric('totalCostUSD', this.metrics.totalCostUSD);

    this.notify('tokens_updated', this.metrics);
  }

  // --- API Key & Model ---

  async setApiKey(key) {
    this.metrics.apiKey = (key || '').trim();
    this.gemini.setApiKey(this.metrics.apiKey);
    await db.setMetric('apiKey', this.metrics.apiKey);
    this.notify('settings_updated', { apiKey: this.metrics.apiKey, preferredModel: this.metrics.preferredModel });
  }

  async setPreferredModel(model) {
    this.metrics.preferredModel = (model || '').trim();
    this.gemini.setActiveModel(this.metrics.preferredModel);
    await db.setMetric('preferredModel', this.metrics.preferredModel);
    this.notify('settings_updated', { apiKey: this.metrics.apiKey, preferredModel: this.metrics.preferredModel });
  }

  async setCustomPrompts(prompts) {
    this.gemini.setCustomPrompts(prompts);
    const updated = this.gemini.getCustomPrompts();
    this.metrics.customPrompts = updated;
    await db.setMetric('customPrompts', updated);
    this.notify('prompts_updated', updated);
    return updated;
  }

  async resetCustomPrompts() {
    const defaults = this.gemini.resetCustomPrompts();
    this.metrics.customPrompts = defaults;
    await db.setMetric('customPrompts', defaults);
    this.notify('prompts_updated', defaults);
    return defaults;
  }

  // --- Word Operations ---

  async addWord(wordData) {
    const wordClean = (wordData.word || '').trim();
    if (!wordClean) throw new Error('Word cannot be empty.');

    // Check duplicate
    const existing = this.words.find(w => w.word.toLowerCase() === wordClean.toLowerCase());
    if (existing) {
      throw new Error(`Word "${wordClean}" is already in your vocabulary.`);
    }

    const newWord = {
      id: wordData.id || `w_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      word: wordClean,
      partOfSpeech: wordData.partOfSpeech || '',
      definition: wordData.definition || '',
      example: wordData.example || '',
      synonyms: Array.isArray(wordData.synonyms) ? wordData.synonyms : [],
      keywords: Array.isArray(wordData.keywords) ? wordData.keywords : [],
      createdAt: Date.now(),
      repetitions: 0,
      interval: 0,
      easeFactor: 2.5,
      consecutiveFails: 0,
      dueDate: Date.now(), // available immediately
      lastReviewed: null,
      history: []
    };

    this.words.push(newWord);
    await db.putWord(newWord);
    this.notify('words_changed', { words: this.words, added: [newWord] });
    return newWord;
  }

  async addWordsBulk(wordsArray) {
    const added = [];
    for (const w of wordsArray) {
      const wordClean = (w.word || '').trim();
      if (!wordClean) continue;
      const existing = this.words.find(item => item.word.toLowerCase() === wordClean.toLowerCase());
      if (existing) continue;

      const newWord = {
        id: w.id || `w_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        word: wordClean,
        partOfSpeech: w.partOfSpeech || '',
        definition: w.definition || '',
        example: w.example || '',
        synonyms: Array.isArray(w.synonyms) ? w.synonyms : [],
        keywords: Array.isArray(w.keywords) ? w.keywords : [],
        createdAt: Date.now(),
        repetitions: 0,
        interval: 0,
        easeFactor: 2.5,
        consecutiveFails: 0,
        dueDate: Date.now(),
        lastReviewed: null,
        history: []
      };
      this.words.push(newWord);
      added.push(newWord);
    }

    if (added.length > 0) {
      await db.putWordsBulk(added);
      this.notify('words_changed', { words: this.words, added });
    }
    return added;
  }

  async deleteWord(id) {
    this.words = this.words.filter(w => w.id !== id);
    await db.deleteWord(id);
    this.notify('words_changed', { words: this.words, deletedId: id });
  }

  async updateWord(id, updates) {
    const idx = this.words.findIndex(w => w.id === id);
    if (idx === -1) return null;

    this.words[idx] = { ...this.words[idx], ...updates };
    await db.putWord(this.words[idx]);
    this.notify('words_changed', { words: this.words, updated: this.words[idx] });
    return this.words[idx];
  }

  // --- Review Submission & SM-2 Update ---

  async applyReviewGrade(wordId, quality, evaluationMeta = {}) {
    const word = this.words.find(w => w.id === wordId);
    if (!word) throw new Error('Word not found.');

    const sm2Result = calculateSM2(word, quality);
    const updated = {
      ...word,
      ...sm2Result,
      lastEvaluation: {
        timestamp: Date.now(),
        quality,
        source: evaluationMeta.source || 'offline',
        feedback: evaluationMeta.feedback || '',
        userAnswer: evaluationMeta.userAnswer || ''
      }
    };

    // Update in-memory and DB
    const idx = this.words.findIndex(w => w.id === wordId);
    this.words[idx] = updated;
    await db.putWord(updated);

    // Update metrics
    this.metrics.reviewCount = (this.metrics.reviewCount || 0) + 1;
    if (quality >= 3) {
      this.metrics.correctReviewCount = (this.metrics.correctReviewCount || 0) + 1;
    }
    await db.setMetric('reviewCount', this.metrics.reviewCount);
    await db.setMetric('correctReviewCount', this.metrics.correctReviewCount);

    this.recordDailyActivity();
    this.notify('words_changed', { words: this.words, updated });
    return updated;
  }

  // --- Queue Pending Review for AI Batching ---

  async queuePendingReview(reviewItem) {
    this.pendingReviews.push(reviewItem);
    await db.putPendingReview(reviewItem);
    this.notify('pending_reviews_changed', this.pendingReviews);
  }

  async removePendingReviews(ids) {
    this.pendingReviews = this.pendingReviews.filter(r => !ids.includes(r.id));
    await db.removePendingReviews(ids);
    this.notify('pending_reviews_changed', this.pendingReviews);
  }

  // --- Batch Gemini Definitions Flow ---

  async populateDefinitionsWithAI(wordsToFetch, onProgress = null) {
    const res = await this.gemini.fetchBatchDefinitions(wordsToFetch, onProgress);
    this.recordTokens(res.tokenStats);

    const addedOrUpdated = [];
    for (const defObj of res.results) {
      const match = this.words.find(w => w.word.toLowerCase() === (defObj.word || '').toLowerCase());
      if (match) {
        const updated = await this.updateWord(match.id, {
          partOfSpeech: defObj.partOfSpeech || match.partOfSpeech,
          definition: defObj.definition || match.definition,
          example: defObj.example || match.example,
          synonyms: defObj.synonyms || match.synonyms,
          keywords: defObj.keywords || match.keywords
        });
        addedOrUpdated.push(updated);
      } else {
        // If it was a new word, add it
        const newWord = await this.addWord({
          word: defObj.word,
          partOfSpeech: defObj.partOfSpeech,
          definition: defObj.definition,
          example: defObj.example,
          synonyms: defObj.synonyms,
          keywords: defObj.keywords
        });
        addedOrUpdated.push(newWord);
      }
    }

    return { words: addedOrUpdated, tokenStats: res.tokenStats };
  }

  // --- Process Pending Reviews with AI ---

  async processPendingReviewsWithAI() {
    if (this.pendingReviews.length === 0) return { evaluatedCount: 0 };
    if (!this.gemini.hasApiKey()) {
      throw new Error('Configure Gemini API key in Settings to run AI evaluation.');
    }

    const batch = this.pendingReviews.slice(0, 10);
    const res = await this.gemini.evaluateBatchReviews(batch);
    this.recordTokens(res.tokenStats);

    const evaluatedIds = [];
    for (const evalItem of res.evaluations) {
      const pending = batch.find(b => b.id === evalItem.id);
      if (pending) {
        await this.applyReviewGrade(pending.wordId, evalItem.quality, {
          source: 'gemini_ai',
          feedback: evalItem.feedback,
          userAnswer: pending.userAnswer
        });
        evaluatedIds.push(pending.id);
      }
    }

    await this.removePendingReviews(evaluatedIds);
    return {
      evaluatedCount: evaluatedIds.length,
      tokenStats: res.tokenStats
    };
  }

  // --- Full Backup Restore ---

  async restoreFromBackup(backupData) {
    if (!backupData || typeof backupData !== 'object') {
      throw new Error('Invalid backup data format.');
    }

    const wordsToRestore = Array.isArray(backupData.words) ? backupData.words : [];

    // Clear existing DB stores
    await db.clearAllWords();
    await db.clearAllPendingReviews();
    await db.clearAllMetrics();

    // Map and restore words, preserving existing SM-2 learning state, intervals, and history
    const restoredWords = [];
    for (const w of wordsToRestore) {
      const wordClean = (w.word || '').trim();
      if (!wordClean) continue;

      const restoredWord = {
        id: w.id || `w_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        word: wordClean,
        partOfSpeech: w.partOfSpeech || '',
        definition: w.definition || '',
        example: w.example || '',
        synonyms: Array.isArray(w.synonyms) ? w.synonyms : [],
        keywords: Array.isArray(w.keywords) ? w.keywords : [],
        createdAt: w.createdAt || Date.now(),
        repetitions: typeof w.repetitions === 'number' ? w.repetitions : 0,
        interval: typeof w.interval === 'number' ? w.interval : 0,
        easeFactor: typeof w.easeFactor === 'number' ? w.easeFactor : 2.5,
        consecutiveFails: typeof w.consecutiveFails === 'number' ? w.consecutiveFails : 0,
        dueDate: typeof w.dueDate === 'number' ? w.dueDate : Date.now(),
        lastReviewed: w.lastReviewed || null,
        history: Array.isArray(w.history) ? w.history : []
      };
      restoredWords.push(restoredWord);
    }

    if (restoredWords.length > 0) {
      await db.putWordsBulk(restoredWords);
    }
    this.words = restoredWords;

    // Restore pending reviews if present
    const restoredPending = Array.isArray(backupData.pendingReviews) ? backupData.pendingReviews : [];
    for (const p of restoredPending) {
      await db.putPendingReview(p);
    }
    this.pendingReviews = restoredPending;

    // Restore metrics if present
    if (backupData.metrics && typeof backupData.metrics === 'object') {
      this.metrics = { ...this.metrics, ...backupData.metrics };
      for (const [k, v] of Object.entries(this.metrics)) {
        await db.setMetric(k, v);
      }
      if (this.metrics.apiKey) {
        this.gemini.setApiKey(this.metrics.apiKey);
      }
    }

    this.notify('words_changed', { words: this.words });
    this.notify('pending_reviews_changed', this.pendingReviews);
    this.notify('metrics_updated', this.metrics);
    return { wordsCount: this.words.length };
  }
}

export const state = new StateStore();
