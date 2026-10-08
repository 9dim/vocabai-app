/**
 * App Controller & UI Coordinator.
 * Handles:
 * - PWA Service Worker registration.
 * - Reactive state subscriptions and view switching.
 * - Study session manager (card flip, dictation integration, 2-phase scoring).
 * - Word creation (single + AI batch 10).
 * - Library display and search filter.
 * - Canvas metrics updates.
 * - Backup & export actions.
 */

import { state } from './state.js';
import { getRevisionQueues } from './sm2.js';
import { evaluateOfflineDefinition } from './gemini.js';
import { SpeechHandler } from './speech.js';
import { calculateMetricsData, drawMasteryDonut, drawScoreBarChart } from './metrics.js';
import {
  generateAnkiCSV,
  generateJSONBackup,
  generateMarkdownExport,
  parseJSONBackup,
  triggerFileDownload,
  copyToClipboard
} from './export.js';

// --- Toast notification helper ---
export function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// --- Controller Class ---
class AppController {
  constructor() {
    this.currentView = 'revision-view';
    this.currentFilter = 'dueToday';
    this.currentStudyQueue = [];
    this.currentStudyIndex = 0;
    this.speechHandler = null;
    this.currentWordReviewed = false;
    this.currentOfflineEval = null;
  }

  async init() {
    this.registerServiceWorker();
    this.initNavigation();
    this.initAddTabs();
    this.initForms();
    this.initExportActions();
    this.initSpeech();

    // Subscribe to state updates
    state.subscribe((event, data) => {
      this.render();
      if (event === 'words_changed' || event === 'init') {
        this.updateStudyQueue();
        this.renderRevisionCard();
        this.renderLibrary();
        this.renderMetrics();
      }
      if (event === 'pending_reviews_changed') {
        this.updatePendingBar();
      }
    });

    try {
      await state.init();
      showToast('Welcome to Vocab AI! Ready offline.', 'success', 2500);
    } catch (err) {
      console.error('Initialization error:', err);
      showToast('Database error: ' + err.message, 'error');
    }

    this.updateStudyQueue();
    this.renderRevisionCard();
    this.renderLibrary();
    this.renderMetrics();
    this.updatePendingBar();

    // Populate API key and model fields if present
    const keyInput = document.getElementById('input-api-key');
    if (keyInput && state.metrics.apiKey) {
      keyInput.value = state.metrics.apiKey;
    }
    const modelSelect = document.getElementById('select-gemini-model');
    if (modelSelect && state.metrics.preferredModel) {
      modelSelect.value = state.metrics.preferredModel;
    }

    // Populate custom prompts textareas
    this.populatePromptFields();
  }

  registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js')
        .then(() => {
          const ind = document.getElementById('sync-indicator');
          const txt = document.getElementById('sync-status-text');
          if (ind && txt) {
            ind.classList.remove('offline');
            txt.textContent = navigator.onLine ? 'Online' : 'Offline';
          }
        })
        .catch((err) => {
          console.warn('SW registration failed:', err);
        });

      window.addEventListener('online', () => {
        const ind = document.getElementById('sync-indicator');
        const txt = document.getElementById('sync-status-text');
        if (ind && txt) {
          ind.classList.remove('offline');
          txt.textContent = 'Online';
        }
        showToast('Connected back online', 'info');
      });

      window.addEventListener('offline', () => {
        const ind = document.getElementById('sync-indicator');
        const txt = document.getElementById('sync-status-text');
        if (ind && txt) {
          ind.classList.add('offline');
          txt.textContent = 'Offline';
        }
        showToast('Running in 100% offline mode', 'info');
      });
    }

    // Capture PWA install prompt for Android
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      window.deferredInstallPrompt = e;
      const btnInstall = document.getElementById('btn-pwa-install');
      if (btnInstall) {
        btnInstall.style.display = 'inline-flex';
        btnInstall.addEventListener('click', async () => {
          if (window.deferredInstallPrompt) {
            window.deferredInstallPrompt.prompt();
            const choice = await window.deferredInstallPrompt.userChoice;
            if (choice.outcome === 'accepted') {
              showToast('Vocab AI installed successfully!', 'success');
              btnInstall.style.display = 'none';
            }
            window.deferredInstallPrompt = null;
          }
        });
      }
    });
  }

  initNavigation() {
    // Theme toggle (Bright / Night Mode)
    const btnTheme = document.getElementById('btn-theme-toggle');
    const savedTheme = localStorage.getItem('vocab_theme') || 'dark';
    if (savedTheme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
      if (btnTheme) btnTheme.textContent = '☀️';
    } else {
      document.documentElement.removeAttribute('data-theme');
      if (btnTheme) btnTheme.textContent = '🌙';
    }

    if (btnTheme) {
      btnTheme.addEventListener('click', () => {
        const isLight = document.documentElement.getAttribute('data-theme') === 'light';
        if (isLight) {
          document.documentElement.removeAttribute('data-theme');
          localStorage.setItem('vocab_theme', 'dark');
          btnTheme.textContent = '🌙';
          showToast('Switched to Night Mode', 'info');
        } else {
          document.documentElement.setAttribute('data-theme', 'light');
          localStorage.setItem('vocab_theme', 'light');
          btnTheme.textContent = '☀️';
          showToast('Switched to Bright Day Mode', 'info');
        }
        // Re-render metrics canvas to adjust colors for current theme
        this.renderMetrics();
      });
    }

    const btnThemeDay = document.getElementById('btn-theme-day');
    if (btnThemeDay) {
      btnThemeDay.addEventListener('click', () => {
        document.documentElement.setAttribute('data-theme', 'light');
        localStorage.setItem('vocab_theme', 'light');
        if (btnTheme) btnTheme.textContent = '☀️';
        this.renderMetrics();
        showToast('Switched to Bright Day Mode', 'info');
      });
    }

    const btnThemeNight = document.getElementById('btn-theme-night');
    if (btnThemeNight) {
      btnThemeNight.addEventListener('click', () => {
        document.documentElement.removeAttribute('data-theme');
        localStorage.setItem('vocab_theme', 'dark');
        if (btnTheme) btnTheme.textContent = '🌙';
        this.renderMetrics();
        showToast('Switched to Midnight Night Mode', 'info');
      });
    }

    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetViewId = btn.getAttribute('data-view');
        this.switchView(targetViewId);
      });
    });

    // Study filter chips
    const filterChips = document.querySelectorAll('.filter-chip');
    filterChips.forEach((chip) => {
      chip.addEventListener('click', () => {
        filterChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.currentFilter = chip.getAttribute('data-filter');
        this.updateStudyQueue();
        this.renderRevisionCard();
      });
    });

    // Library search
    const searchInput = document.getElementById('search-library');
    if (searchInput) {
      searchInput.addEventListener('input', () => this.renderLibrary());
    }

    // Pending reviews AI batch evaluate button
    const btnSyncAI = document.getElementById('btn-sync-ai-eval');
    if (btnSyncAI) {
      btnSyncAI.addEventListener('click', async () => {
        try {
          btnSyncAI.disabled = true;
          btnSyncAI.textContent = 'Evaluating...';
          const res = await state.processPendingReviewsWithAI();
          showToast(`Evaluated ${res.evaluatedCount} reviews with Gemini!`, 'success');
        } catch (err) {
          showToast(err.message, 'error');
        } finally {
          btnSyncAI.disabled = false;
          btnSyncAI.textContent = 'Batch Evaluate (AI)';
          this.updatePendingBar();
        }
      });
    }
  }

  switchView(viewId) {
    this.currentView = viewId;
    document.querySelectorAll('.view-section').forEach((sec) => {
      sec.classList.toggle('active', sec.id === viewId);
    });
    document.querySelectorAll('.nav-item').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-view') === viewId);
    });

    if (viewId === 'metrics-view') {
      this.renderMetrics();
    }
  }

  initAddTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const target = btn.getAttribute('data-tab');
        document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');
        const activePanel = document.getElementById(target);
        if (activePanel) activePanel.style.display = 'block';
      });
    });
  }

  initSpeech() {
    this.speechHandler = new SpeechHandler({
      onStart: () => {
        const mic = document.getElementById('study-mic-btn');
        if (mic) mic.classList.add('listening');
      },
      onEnd: () => {
        const mic = document.getElementById('study-mic-btn');
        if (mic) mic.classList.remove('listening');
      },
      onError: (err) => {
        showToast(`Dictation: ${err}`, 'error');
        const mic = document.getElementById('study-mic-btn');
        if (mic) mic.classList.remove('listening');
      },
      onResult: ({ final, interim }) => {
        const textarea = document.getElementById('study-answer-input');
        if (textarea) {
          textarea.value = final || interim;
        }
      }
    });
  }

  initForms() {
    // Single word add form
    const formSingle = document.getElementById('form-single-word');
    if (formSingle) {
      formSingle.addEventListener('submit', async (e) => {
        e.preventDefault();
        const word = document.getElementById('input-single-word').value.trim();
        const partOfSpeech = document.getElementById('input-single-pos').value.trim();
        const definition = document.getElementById('input-single-def').value.trim();
        const example = document.getElementById('input-single-example').value.trim();
        const synonyms = document.getElementById('input-single-synonyms').value
          .split(',').map(s => s.trim()).filter(Boolean);
        const keywords = document.getElementById('input-single-keywords').value
          .split(',').map(k => k.trim()).filter(Boolean);

        try {
          await state.addWord({ word, partOfSpeech, definition, example, synonyms, keywords });
          showToast(`Added "${word}" to vocabulary!`, 'success');
          formSingle.reset();
          this.switchView('revision-view');
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    }

    // Single word AI define button
    const btnAiDefineSingle = document.getElementById('btn-ai-define-single');
    if (btnAiDefineSingle) {
      btnAiDefineSingle.addEventListener('click', async () => {
        const word = document.getElementById('input-single-word').value.trim();
        if (!word) {
          showToast('Enter a word first to fetch its definition.', 'error');
          return;
        }
        try {
          btnAiDefineSingle.disabled = true;
          btnAiDefineSingle.textContent = '✨ Fetching AI Definition...';
          const res = await state.gemini.fetchBatchDefinitions([word]);
          state.recordTokens(res.tokenStats);
          if (res.results && res.results.length > 0) {
            const defData = res.results[0];
            document.getElementById('input-single-pos').value = defData.partOfSpeech || '';
            document.getElementById('input-single-def').value = defData.definition || '';
            document.getElementById('input-single-example').value = defData.example || '';
            document.getElementById('input-single-synonyms').value = (defData.synonyms || []).join(', ');
            document.getElementById('input-single-keywords').value = (defData.keywords || []).join(', ');
            showToast('Definition retrieved from Gemini!', 'success');
          }
        } catch (err) {
          showToast(err.message, 'error');
        } finally {
          btnAiDefineSingle.disabled = false;
          btnAiDefineSingle.textContent = '✨ Fetch Definition via AI';
        }
      });
    }

    // Batch words add form
    const formBatch = document.getElementById('form-batch-words');
    if (formBatch) {
      formBatch.addEventListener('submit', async (e) => {
        e.preventDefault();
        const rawText = document.getElementById('input-batch-text').value;
        const words = rawText
          .split(/[\n,]+/)
          .map(w => w.trim())
          .filter(Boolean);

        if (words.length === 0) {
          showToast('Please enter at least one word.', 'error');
          return;
        }

        const btnSubmit = document.getElementById('btn-batch-submit');
        try {
          btnSubmit.disabled = true;
          btnSubmit.textContent = `✨ Fetching definitions for ${words.length} words...`;

          const res = await state.populateDefinitionsWithAI(words, (processed, total) => {
            btnSubmit.textContent = `✨ Processing ${processed} / ${total} words...`;
          });
          showToast(`Successfully added ${res.words.length} words with AI definitions!`, 'success');
          formBatch.reset();
          this.switchView('revision-view');
        } catch (err) {
          showToast(err.message, 'error');
        } finally {
          btnSubmit.disabled = false;
          btnSubmit.textContent = '✨ Generate & Save All Words';
        }
      });
    }

    // API key & Model settings form
    const formKey = document.getElementById('form-api-key');
    if (formKey) {
      formKey.addEventListener('submit', async (e) => {
        e.preventDefault();
        const key = document.getElementById('input-api-key').value.trim();
        const model = document.getElementById('select-gemini-model').value.trim();
        await state.setApiKey(key);
        await state.setPreferredModel(model);
        showToast('Gemini API settings saved to local IndexedDB!', 'success');
      });
    }

    // Check / Discover Models button
    const btnDiscover = document.getElementById('btn-discover-models');
    if (btnDiscover) {
      btnDiscover.addEventListener('click', async () => {
        const key = document.getElementById('input-api-key').value.trim();
        if (key) {
          await state.setApiKey(key);
        }
        if (!state.gemini.hasApiKey()) {
          showToast('Please enter an API key first.', 'warning');
          return;
        }

        const statusMsg = document.getElementById('models-status-msg');
        btnDiscover.disabled = true;
        btnDiscover.textContent = '⏳ Checking...';
        if (statusMsg) statusMsg.textContent = 'Calling ModelService.listModels API...';

        try {
          const models = await state.gemini.listAvailableModels(true);
          if (models.length === 0) {
            if (statusMsg) statusMsg.textContent = 'No generateContent models returned, using candidate fallbacks.';
            showToast('No models discovered directly; multi-model fallback enabled.', 'warning');
          } else {
            const select = document.getElementById('select-gemini-model');
            if (select) {
              const currentVal = select.value;
              select.innerHTML = '<option value="">Auto-Detect / Multi-Model Fallback</option>';
              models.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m;
                opt.textContent = m;
                if (m === currentVal) opt.selected = true;
                select.appendChild(opt);
              });
            }
            if (statusMsg) statusMsg.textContent = `Found ${models.length} supported models: ${models.slice(0, 3).join(', ')}...`;
            showToast(`Found ${models.length} available Gemini models!`, 'success');
          }
        } catch (err) {
          if (statusMsg) statusMsg.textContent = `Error: ${err.message}`;
          showToast(`Model check error: ${err.message}`, 'error');
        } finally {
          btnDiscover.disabled = false;
          btnDiscover.textContent = '🔍 Check Models';
        }
      });
    }

    // Custom Prompts & Schemas form
    const formPrompts = document.getElementById('form-custom-prompts');
    if (formPrompts) {
      formPrompts.addEventListener('submit', async (e) => {
        e.preventDefault();
        const defPrompt = document.getElementById('prompt-definition-template')?.value || '';
        const evalPrompt = document.getElementById('prompt-evaluation-template')?.value || '';

        if (!defPrompt.includes('{{WORDS_JSON}}')) {
          showToast('Warning: Definition prompt should contain {{WORDS_JSON}} placeholder.', 'warning', 4500);
        }
        if (!evalPrompt.includes('{{REVIEWS_JSON}}')) {
          showToast('Warning: Evaluation prompt should contain {{REVIEWS_JSON}} placeholder.', 'warning', 4500);
        }

        await state.setCustomPrompts({
          definitionPrompt: defPrompt,
          evaluationPrompt: evalPrompt
        });
        showToast('Custom prompts & schemas saved successfully!', 'success');
      });
    }

    // Reset Prompts button
    const btnResetPrompts = document.getElementById('btn-reset-prompts');
    if (btnResetPrompts) {
      btnResetPrompts.addEventListener('click', async () => {
        if (confirm('Reset definition and evaluation prompts to default?')) {
          await state.resetCustomPrompts();
          this.populatePromptFields();
          showToast('Prompts reset to standard defaults.', 'info');
        }
      });
    }
  }

  populatePromptFields() {
    const prompts = state.gemini.getCustomPrompts();
    const defArea = document.getElementById('prompt-definition-template');
    if (defArea) {
      defArea.value = prompts.definitionPrompt || '';
    }
    const evalArea = document.getElementById('prompt-evaluation-template');
    if (evalArea) {
      evalArea.value = prompts.evaluationPrompt || '';
    }
  }

  initExportActions() {
    // Copy Markdown
    const btnCopyMd = document.getElementById('btn-copy-markdown');
    if (btnCopyMd) {
      btnCopyMd.addEventListener('click', async () => {
        try {
          const md = generateMarkdownExport(state.words);
          await copyToClipboard(md);
          showToast('Vocabulary copied to clipboard as Markdown!', 'success');
        } catch (err) {
          showToast('Clipboard error: ' + err.message, 'error');
        }
      });
    }

    // Export Anki CSV
    const btnExportAnki = document.getElementById('btn-export-anki');
    if (btnExportAnki) {
      btnExportAnki.addEventListener('click', () => {
        try {
          const csv = generateAnkiCSV(state.words);
          triggerFileDownload(csv, 'vocabulary_anki.csv', 'text/csv');
          showToast('Anki CSV file downloaded!', 'success');
        } catch (err) {
          showToast('Export error: ' + err.message, 'error');
        }
      });
    }

    // Export JSON Backup
    const btnExportJson = document.getElementById('btn-export-json');
    if (btnExportJson) {
      btnExportJson.addEventListener('click', () => {
        try {
          const json = generateJSONBackup(state);
          triggerFileDownload(json, `vocab_backup_${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
          showToast('JSON Backup downloaded!', 'success');
        } catch (err) {
          showToast('Backup error: ' + err.message, 'error');
        }
      });
    }

    // Copy JSON
    const btnCopyJson = document.getElementById('btn-copy-json');
    if (btnCopyJson) {
      btnCopyJson.addEventListener('click', async () => {
        try {
          const json = generateJSONBackup(state);
          await copyToClipboard(json);
          showToast('JSON backup copied to clipboard!', 'success');
        } catch (err) {
          showToast('Clipboard error: ' + err.message, 'error');
        }
      });
    }

    // Restore JSON from file
    const fileRestore = document.getElementById('file-restore-json');
    if (fileRestore) {
      fileRestore.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (evt) => {
          try {
            const data = parseJSONBackup(evt.target.result);
            if (confirm(`Restore ${data.words.length} words from backup? This will restore complete vocabulary state and metrics.`)) {
              await state.restoreFromBackup(data);
              this.updateStudyQueue();
              this.renderRevisionCard();
              this.renderLibrary();
              this.renderMetrics();
              this.updatePendingBar();
              showToast(`Restored ${data.words.length} words with learning progress!`, 'success');
            }
          } catch (err) {
            showToast('Restore error: ' + err.message, 'error');
          } finally {
            fileRestore.value = '';
          }
        };
        reader.readAsText(file);
      });
    }
  }

  // --- Study Session Workflow ---

  updateStudyQueue() {
    const queues = getRevisionQueues(state.words);

    // Update filter counts
    const countDue = document.getElementById('count-dueToday');
    const countStruggling = document.getElementById('count-struggling');
    const countDormant = document.getElementById('count-dormant');
    const countAll = document.getElementById('count-all');

    if (countDue) countDue.textContent = queues.dueToday.length;
    if (countStruggling) countStruggling.textContent = queues.struggling.length;
    if (countDormant) countDormant.textContent = queues.dormant.length;
    if (countAll) countAll.textContent = queues.all.length;

    this.currentStudyQueue = queues[this.currentFilter] || [];
    if (this.currentStudyIndex >= this.currentStudyQueue.length) {
      this.currentStudyIndex = 0;
    }
    this.currentWordReviewed = false;
    this.currentOfflineEval = null;
  }

  renderRevisionCard() {
    const container = document.getElementById('study-container');
    if (!container) return;

    if (this.currentStudyQueue.length === 0) {
      container.innerHTML = `
        <div class="card" style="text-align: center; padding: 40px 20px;">
          <div style="font-size: 3rem; margin-bottom: 12px;">🎉</div>
          <h2 style="font-size: 1.3rem; margin-bottom: 8px;">No Words Due in this Queue!</h2>
          <p style="color: var(--text-secondary); margin-bottom: 16px;">
            ${this.currentFilter === 'dueToday'
              ? 'You have completed all scheduled reviews for now. Practice dormant words or add new words!'
              : 'Queue is currently clear.'}
          </p>
          <button id="btn-jump-add" class="btn btn-primary">➕ Add More Words</button>
        </div>
      `;
      const btnJump = document.getElementById('btn-jump-add');
      if (btnJump) {
        btnJump.addEventListener('click', () => this.switchView('add-view'));
      }
      return;
    }

    const word = this.currentStudyQueue[this.currentStudyIndex];
    const isLeech = (word.consecutiveFails || 0) >= 2;

    container.innerHTML = `
      <div class="flashcard">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <span style="font-size: 0.8rem; color: var(--text-secondary);">
            Word ${this.currentStudyIndex + 1} of ${this.currentStudyQueue.length}
          </span>
          ${isLeech ? '<span class="grade-badge grade-0">⚠️ Multi-Fail Penalty</span>' : ''}
        </div>

        <div class="flashcard-word">${word.word}</div>
        <div class="flashcard-pos">${word.partOfSpeech || 'word'}</div>

        <div class="flashcard-meta">
          <span>Repetitions: <strong>${word.repetitions || 0}</strong></span>
          <span>Interval: <strong>${word.interval || 0}d</strong></span>
          <span>Ease: <strong>${word.easeFactor || 2.5}</strong></span>
        </div>

        <!-- Answer / Dictation Input Area -->
        <div class="flashcard-answer-box">
          <label for="study-answer-input">Dictate or type what this word means:</label>
          <div class="dictation-wrapper">
            <textarea id="study-answer-input" placeholder="Tap the mic to dictate or write your definition..."></textarea>
            <button type="button" id="study-mic-btn" class="mic-btn" title="Speak definition">
              🎤
            </button>
          </div>
          <div style="margin-top: 10px; display: flex; gap: 8px;">
            <button id="btn-check-answer" class="btn btn-primary btn-full">Check Definition</button>
          </div>
        </div>

        <!-- Evaluation Results & Target Definition Reveal -->
        <div id="evaluation-result-area" style="display: none;"></div>

        <!-- Manual Grading Controls (SM-2 Grade 0-5) -->
        <div id="grading-controls-area" style="display: none; margin-top: 16px;">
          <div style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 8px; text-align: left;">
            Select your SuperMemo SM-2 Recall Grade:
          </div>
          <div class="grading-bar">
            <button class="btn btn-secondary btn-grade" data-grade="0">
              <span class="num">0</span>
              <span>Blackout</span>
            </button>
            <button class="btn btn-secondary btn-grade" data-grade="1">
              <span class="num">1</span>
              <span>Wrong</span>
            </button>
            <button class="btn btn-secondary btn-grade" data-grade="2">
              <span class="num">2</span>
              <span>Hard</span>
            </button>
            <button class="btn btn-secondary btn-grade" data-grade="3">
              <span class="num">3</span>
              <span>Pass</span>
            </button>
            <button class="btn btn-secondary btn-grade" data-grade="4">
              <span class="num">4</span>
              <span>Good</span>
            </button>
            <button class="btn btn-secondary btn-grade" data-grade="5">
              <span class="num">5</span>
              <span>Perfect</span>
            </button>
          </div>
        </div>
      </div>
    `;

    // Hook Mic button
    const micBtn = document.getElementById('study-mic-btn');
    if (micBtn) {
      micBtn.addEventListener('click', () => {
        if (this.speechHandler.isListening) {
          this.speechHandler.stop();
        } else {
          this.speechHandler.start();
        }
      });
    }

    // Hook Check Answer button (Runs Phase 1 Offline Check)
    const btnCheck = document.getElementById('btn-check-answer');
    if (btnCheck) {
      btnCheck.addEventListener('click', () => {
        const userAnswer = (document.getElementById('study-answer-input').value || '').trim();
        this.runPhaseOneCheck(word, userAnswer);
      });
    }

    // Hook Grade buttons
    const gradeBtns = container.querySelectorAll('.btn-grade');
    gradeBtns.forEach((btn) => {
      btn.addEventListener('click', async () => {
        const grade = parseInt(btn.getAttribute('data-grade'), 10);
        await this.handleGradeSelection(word, grade);
      });
    });
  }

  runPhaseOneCheck(word, userAnswer) {
    const evalArea = document.getElementById('evaluation-result-area');
    const gradingArea = document.getElementById('grading-controls-area');
    const btnCheck = document.getElementById('btn-check-answer');

    // Run Phase 1 instant offline check
    const evalRes = evaluateOfflineDefinition(userAnswer, word);
    this.currentOfflineEval = { ...evalRes, userAnswer };

    // Reveal Evaluation & Answer
    evalArea.style.display = 'block';
    evalArea.innerHTML = `
      <div class="evaluation-box">
        <div class="eval-header">
          <strong>Instant Offline Accuracy Check</strong>
          <span class="grade-badge grade-${evalRes.quality}">${evalRes.accuracy}% (${evalRes.quality}/5★)</span>
        </div>
        <p style="font-size: 0.9rem; margin-bottom: 8px;">${evalRes.feedback}</p>

        <div class="definition-reveal">
          <div style="font-weight: 600; font-size: 0.85rem; color: var(--accent-color); margin-bottom: 4px;">Target Meaning:</div>
          <div style="font-size: 0.95rem; margin-bottom: 6px;">${word.definition || 'No definition saved.'}</div>
          ${word.example ? `<div style="font-size: 0.85rem; color: #94a3b8; font-style: italic;">"${word.example}"</div>` : ''}
          ${word.synonyms && word.synonyms.length > 0 ? `<div style="font-size: 0.8rem; color: #cbd5e1; margin-top: 4px;"><strong>Synonyms:</strong> ${word.synonyms.join(', ')}</div>` : ''}
        </div>
      </div>
    `;

    // Highlight the suggested SM-2 grade button
    gradingArea.style.display = 'block';
    const suggestedBtn = gradingArea.querySelector(`[data-grade="${evalRes.quality}"]`);
    if (suggestedBtn) {
      suggestedBtn.classList.remove('btn-secondary');
      suggestedBtn.classList.add('btn-primary');
    }

    btnCheck.style.display = 'none';
  }

  async handleGradeSelection(word, grade) {
    try {
      const userAnswer = this.currentOfflineEval ? this.currentOfflineEval.userAnswer : '';
      const feedback = this.currentOfflineEval ? this.currentOfflineEval.feedback : '';

      // Apply grade to word immediately in SM-2
      const updatedWord = await state.applyReviewGrade(word.id, grade, {
        source: 'phase1_offline',
        feedback,
        userAnswer
      });

      // Also queue into pendingReviews so Gemini can evaluate in batch later if desired
      if (userAnswer) {
        await state.queuePendingReview({
          id: `rev_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          wordId: word.id,
          word: word.word,
          definition: word.definition,
          userAnswer,
          offlineGrade: grade,
          timestamp: Date.now()
        });
      }

      showToast(`Review saved! Next interval: ${updatedWord.interval}d`, 'success', 2000);

      // Reset card state and move to next card
      this.currentOfflineEval = null;
      this.currentStudyIndex++;
      this.updateStudyQueue();
      this.renderRevisionCard();
    } catch (err) {
      showToast('Error saving review: ' + err.message, 'error');
    }
  }

  updatePendingBar() {
    const bar = document.getElementById('pending-reviews-bar');
    const count = document.getElementById('pending-count');
    if (!bar || !count) return;

    const num = state.pendingReviews.length;
    count.textContent = num;
    bar.style.display = num > 0 ? 'block' : 'none';
  }

  // --- Library View ---

  renderLibrary() {
    const container = document.getElementById('library-list-container');
    const totalCount = document.getElementById('library-total-count');
    const searchInput = document.getElementById('search-library');
    if (!container) return;

    const query = (searchInput ? searchInput.value : '').toLowerCase().trim();
    let words = [...state.words];

    if (totalCount) totalCount.textContent = words.length;

    if (query) {
      words = words.filter(w =>
        w.word.toLowerCase().includes(query) ||
        (w.definition && w.definition.toLowerCase().includes(query)) ||
        (w.partOfSpeech && w.partOfSpeech.toLowerCase().includes(query)) ||
        (w.synonyms && w.synonyms.some(s => s.toLowerCase().includes(query)))
      );
    }

    if (words.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 24px; color: var(--text-secondary);">
          No words found.
        </div>
      `;
      return;
    }

    container.innerHTML = words.map(w => `
      <div class="word-item-card">
        <div class="word-item-info">
          <div>
            <h3>${w.word}</h3>
            ${w.partOfSpeech ? `<span class="pos">(${w.partOfSpeech})</span>` : ''}
          </div>
          <p>${w.definition || 'No definition'}</p>
          ${w.example ? `<div class="examples">"${w.example}"</div>` : ''}
          <div class="word-item-tags">
            ${(w.synonyms || []).map(s => `<span class="tag-badge">${s}</span>`).join('')}
            <span class="tag-badge" style="color: var(--accent-color)">SM-2: ${w.interval || 0}d</span>
          </div>
        </div>
        <div>
          <button class="btn btn-secondary btn-sm btn-delete-word" data-id="${w.id}" title="Delete word">
            🗑️
          </button>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.btn-delete-word').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        if (confirm('Delete this word from vocabulary?')) {
          await state.deleteWord(id);
          showToast('Word deleted', 'info');
        }
      });
    });
  }

  // --- Metrics & Charts View ---

  renderMetrics() {
    const data = calculateMetricsData(state.words, state.metrics);

    // Update streak badge in header
    const streakBadge = document.getElementById('streak-count');
    if (streakBadge) streakBadge.textContent = data.streak;

    // Summary tiles
    const elStreak = document.getElementById('metric-streak');
    const elTotal = document.getElementById('metric-total-words');
    const elRetention = document.getElementById('metric-retention');
    const elInterval = document.getElementById('metric-avg-interval');

    if (elStreak) elStreak.textContent = data.streak;
    if (elTotal) elTotal.textContent = data.totalWords;
    if (elRetention) elRetention.textContent = `${data.retentionRate}%`;
    if (elInterval) elInterval.textContent = `${data.avgInterval}d`;

    // Token stats
    const elInput = document.getElementById('token-input');
    const elOutput = document.getElementById('token-output');
    const elTotalT = document.getElementById('token-total');
    const elCost = document.getElementById('token-cost');

    if (elInput) elInput.textContent = data.tokens.input.toLocaleString();
    if (elOutput) elOutput.textContent = data.tokens.output.toLocaleString();
    if (elTotalT) elTotalT.textContent = data.tokens.total.toLocaleString();
    if (elCost) elCost.textContent = `$${data.tokens.costUSD}`;

    // Draw canvas charts
    const donutCanvas = document.getElementById('chart-mastery');
    if (donutCanvas) {
      drawMasteryDonut(donutCanvas, data.mastery);
    }

    const barCanvas = document.getElementById('chart-scores');
    if (barCanvas) {
      drawScoreBarChart(barCanvas, data.scoreCounts);
    }
  }

  render() {
    // General reactive updates
    const streakBadge = document.getElementById('streak-count');
    if (streakBadge) streakBadge.textContent = state.metrics.streak || 0;
  }
}

// Bootstrap app on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  const app = new AppController();
  app.init();
});
