/**
 * Gemini API client & 2-Phase Hybrid Evaluation Engine:
 * 1. Compact JSON batch prompt definition retrieval (batch size up to 10).
 * 2. Phase 1 Instant Offline Keyword/Synonym heuristic evaluator.
 * 3. Phase 2 Batch Gemini AI answer evaluator (batch size up to 10).
 * 4. Token counter & cost estimation tracker.
 */

export const GEMINI_CONFIG = {
  // Default preferred candidate models in order of priority (Fast & lightweight Flash models first, then Pro)
  CANDIDATE_MODELS: [
    'gemini-2.5-flash',
    'gemini-1.5-flash',
    'gemini-1.5-flash-latest',
    'gemini-2.0-flash',
    'gemini-2.0-flash-exp',
    'gemini-1.5-pro',
    'gemini-pro'
  ],
  DEFAULT_MODEL: 'gemini-1.5-flash',
  API_BASE: 'https://generativelanguage.googleapis.com/v1beta',
  INPUT_COST_PER_MILLION: 0.075, // $0.075 per 1M input tokens for Flash <= 128k
  OUTPUT_COST_PER_MILLION: 0.30,  // $0.30 per 1M output tokens for Flash <= 128k
};

/**
 * Heuristic token estimator (~4 chars per token).
 */
export function estimateTokens(text = '') {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * Phase 1: Instant Offline Keyword/Synonym Evaluation Heuristic
 * Compares user's verbal or typed definition against target definition, keywords, and synonyms.
 * Returns quality score (0 to 5) and feedback string.
 */
export function evaluateOfflineDefinition(userAnswer = '', wordItem = {}) {
  const normUser = (userAnswer || '').toLowerCase().trim();
  const definition = (wordItem.definition || '').toLowerCase();
  const synonyms = (wordItem.synonyms || []).map(s => s.toLowerCase());
  const keywords = (wordItem.keywords || []).map(k => k.toLowerCase());

  if (!normUser || normUser.length < 3) {
    return {
      quality: 0,
      accuracy: 0,
      feedback: 'No definition provided or response too short.',
      matchedKeywords: []
    };
  }

  // Common stop words to exclude when extracting words
  const stopWords = new Set([
    'a', 'an', 'the', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from',
    'and', 'or', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has',
    'had', 'do', 'does', 'did', 'it', 'its', 'that', 'this', 'as', 'than', 'into',
    'which', 'who', 'whom', 'whose', 'their', 'they', 'them', 'he', 'she', 'him',
    'her', 'his', 'means', 'meaning', 'something', 'someone', 'relating', 'related',
    'state', 'act', 'process', 'quality', 'condition'
  ]);

  // Extract significant words from official definition
  const defWords = definition
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));

  // Build target key pool (explicit keywords + synonyms + significant definition words)
  const targetKeyPool = new Set([...keywords, ...synonyms, ...defWords]);
  
  if (targetKeyPool.size === 0) {
    return {
      quality: 3,
      accuracy: 60,
      feedback: 'Answer accepted (offline baseline - no detailed definition available).',
      matchedKeywords: []
    };
  }

  // Tokenize user answer
  const userTokens = normUser
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1);

  const matched = [];
  for (const token of userTokens) {
    if (stopWords.has(token)) continue;
    for (const key of targetKeyPool) {
      // Substring or exact match or simple stem check
      if (key === token || (key.length > 4 && token.startsWith(key.slice(0, 4))) || (token.length > 4 && key.startsWith(token.slice(0, 4)))) {
        if (!matched.includes(key)) matched.push(key);
      }
    }
  }

  const poolSize = Math.max(1, Math.min(targetKeyPool.size, 8)); // scale against max 8 significant terms
  const ratio = matched.length / poolSize;

  let quality = 0;
  let feedback = '';

  if (ratio >= 0.6 || matched.length >= 4) {
    quality = 5;
    feedback = `Outstanding! Core concepts covered: ${matched.slice(0, 4).join(', ')}`;
  } else if (ratio >= 0.4 || matched.length >= 3) {
    quality = 4;
    feedback = `Good recall! Mentioned: ${matched.slice(0, 3).join(', ')}`;
  } else if (ratio >= 0.25 || matched.length >= 2) {
    quality = 3;
    feedback = `Acceptable basic idea. Mentioned: ${matched.slice(0, 2).join(', ')}`;
  } else if (matched.length === 1) {
    quality = 2;
    feedback = `Partially recalled keyword '${matched[0]}', but missed key aspects.`;
  } else {
    quality = 1;
    feedback = 'Did not match key definition concepts. Review definition carefully.';
  }

  const accuracy = Math.round(Math.min(100, Math.max(0, (quality / 5) * 100)));

  return {
    quality,
    accuracy,
    feedback,
    matchedKeywords: matched
  };
}

export const DEFAULT_PROMPTS = {
  definitionPrompt: `You are an expert polymath, technical lexicographer, and educator.
For each word/term in this list: {{WORDS_JSON}}, provide a comprehensive, deep, and crystal-clear explanation.
Especially for technical, scientific, computational, or domain-specific terms (e.g. machine learning, mathematics, philosophy, law, medicine), explain the core mechanism: what it actually is, why it is used, and how it works in practice rather than just giving a superficial dictionary gloss.

Return a JSON array where each object strictly follows this schema:
[
  {
    "word": "string (original word/term)",
    "partOfSpeech": "string (e.g. noun, verb, adjective, technical concept)",
    "definition": "detailed, explanatory definition that unpacks the underlying mechanism, intuition, and exact meaning (2-4 rich sentences)",
    "example": "a realistic, concrete, contextual example demonstrating the concept in actual use or technical practice",
    "synonyms": ["up to 4 related terms, alternatives, or standard synonyms"],
    "keywords": ["3 to 6 essential conceptual keywords and core terminology crucial for accurate recall"]
  }
]`,

  evaluationPrompt: `You are a vocabulary tutor. Evaluate user spoken/typed definitions against target definitions.
Input array: {{REVIEWS_JSON}}.
Grade each from 0 to 5:
- 5: Perfect/comprehensive recall
- 4: Good accurate recall with minor omissions
- 3: Acceptable core meaning understood
- 2: Incomplete or ambiguous
- 1: Mostly wrong
- 0: Total blank or completely incorrect
Return a JSON array of objects with schema:
[
  {
    "id": "string matching input id",
    "quality": 0-5 integer,
    "feedback": "1 sentence constructive feedback"
  }
]`
};

/**
 * Gemini API client helper with dynamic ModelService discovery and multi-model fallback.
 */
export class GeminiService {
  constructor(apiKey = '', activeModel = '', customPrompts = null) {
    this.apiKey = apiKey;
    this.activeModel = activeModel || '';
    this.discoveredModels = [];
    this.lastDiscoveredTime = 0;
    this.customPrompts = {
      definitionPrompt: customPrompts?.definitionPrompt || DEFAULT_PROMPTS.definitionPrompt,
      evaluationPrompt: customPrompts?.evaluationPrompt || DEFAULT_PROMPTS.evaluationPrompt
    };
  }

  setApiKey(key) {
    this.apiKey = (key || '').trim();
    this.discoveredModels = [];
    this.lastDiscoveredTime = 0;
  }

  setActiveModel(modelName) {
    this.activeModel = (modelName || '').trim();
  }

  setCustomPrompts(prompts = {}) {
    this.customPrompts = {
      definitionPrompt: prompts.definitionPrompt?.trim() || DEFAULT_PROMPTS.definitionPrompt,
      evaluationPrompt: prompts.evaluationPrompt?.trim() || DEFAULT_PROMPTS.evaluationPrompt
    };
  }

  getCustomPrompts() {
    return { ...this.customPrompts };
  }

  resetCustomPrompts() {
    this.customPrompts = {
      definitionPrompt: DEFAULT_PROMPTS.definitionPrompt,
      evaluationPrompt: DEFAULT_PROMPTS.evaluationPrompt
    };
    return this.getCustomPrompts();
  }

  hasApiKey() {
    return Boolean(this.apiKey && this.apiKey.length > 10);
  }

  /**
   * Discovers available models via ModelService.listModels API.
   * Filters models that support `generateContent`.
   */
  async listAvailableModels(forceRefresh = false) {
    if (!this.hasApiKey()) {
      throw new Error('Missing Gemini API Key. Please configure your key in Settings.');
    }

    const now = Date.now();
    // Cache discovered models for 10 minutes unless forceRefresh is set
    if (!forceRefresh && this.discoveredModels.length > 0 && (now - this.lastDiscoveredTime < 600000)) {
      return this.discoveredModels;
    }

    const url = `${GEMINI_CONFIG.API_BASE}/models?key=${this.apiKey}`;
    try {
      const response = await fetch(url);
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to list models (${response.status}): ${errText}`);
      }

      const data = await response.json();
      const rawList = data.models || [];

      // Filter models that support generateContent method
      const validModels = rawList
        .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
        .map(m => m.name.replace(/^models\//, ''));

      if (validModels.length > 0) {
        this.discoveredModels = validModels;
        this.lastDiscoveredTime = now;
        console.log('GeminiService discovered models:', this.discoveredModels);
      }
      return this.discoveredModels;
    } catch (err) {
      console.warn('Could not fetch models via listModels, falling back to candidate list:', err.message);
      return [];
    }
  }

  /**
   * Builds the priority list of models to try.
   * Checks discovered models first, user-chosen model, and candidate fallbacks.
   */
  async getCandidateModelsToTry() {
    const list = [];

    // 1. If user explicitly configured an active model, try that first
    if (this.activeModel) {
      list.push(this.activeModel);
    }

    // 2. Discover models from API if key is present and not yet fetched
    if (this.hasApiKey() && this.discoveredModels.length === 0) {
      await this.listAvailableModels();
    }

    // 3. Add discovered models prioritized by flash/pro
    if (this.discoveredModels.length > 0) {
      // Prioritize flash models first (faster & cheaper)
      const flashModels = this.discoveredModels.filter(m => m.toLowerCase().includes('flash'));
      const otherModels = this.discoveredModels.filter(m => !m.toLowerCase().includes('flash'));
      for (const m of [...flashModels, ...otherModels]) {
        if (!list.includes(m)) list.push(m);
      }
    }

    // 4. Fallback to default candidates list
    for (const m of GEMINI_CONFIG.CANDIDATE_MODELS) {
      if (!list.includes(m)) list.push(m);
    }

    return list;
  }

  /**
   * Calls Gemini with automatic multi-model fallback and ModelService check.
   */
  async callGemini(promptText) {
    if (!this.hasApiKey()) {
      throw new Error('Missing Gemini API Key. Please configure your key in Settings.');
    }

    const inputTokens = estimateTokens(promptText);
    const modelsToTry = await this.getCandidateModelsToTry();
    const errors = [];

    const payload = {
      contents: [{
        parts: [{ text: promptText }]
      }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json'
      }
    };

    for (const model of modelsToTry) {
      const url = `${GEMINI_CONFIG.API_BASE}/models/${model}:generateContent?key=${this.apiKey}`;
      console.log(`Attempting Gemini generation with model: ${model}...`);

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const errText = await response.text();
          let msg = `Model ${model} Error (${response.status})`;
          try {
            const parsed = JSON.parse(errText);
            if (parsed.error && parsed.error.message) {
              msg = `${model}: ${parsed.error.message}`;
            }
          } catch (e) {
            msg = `${model}: ${errText}`;
          }
          errors.push(msg);
          console.warn(`Gemini model ${model} failed, attempting next model...`, msg);
          continue; // Try next model in candidate list
        }

        const data = await response.json();
        const candidate = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!candidate) {
          errors.push(`${model}: Returned empty text response.`);
          continue;
        }

        // Successfully got a response! Update active model to the working one
        this.activeModel = model;
        console.log(`Gemini generation succeeded with model: ${model}`);

        const outputTokens = estimateTokens(candidate);
        const totalTokens = inputTokens + outputTokens;

        return {
          text: candidate,
          usedModel: model,
          tokenStats: {
            inputTokens,
            outputTokens,
            totalTokens,
            estimatedCostUSD: (
              (inputTokens / 1_000_000) * GEMINI_CONFIG.INPUT_COST_PER_MILLION +
              (outputTokens / 1_000_000) * GEMINI_CONFIG.OUTPUT_COST_PER_MILLION
            )
          }
        };
      } catch (networkErr) {
        errors.push(`${model}: ${networkErr.message}`);
        console.warn(`Network error with model ${model}:`, networkErr.message);
      }
    }

    // If all models failed
    throw new Error(
      `All Gemini models failed. Models tried: [${modelsToTry.slice(0, 4).join(', ')}...].\nLast errors: ${errors.slice(-2).join('; ')}`
    );
  }

  /**
   * Batch word definition lookup (supports any number of words).
   * Automatically chunks words into batches of 10 for optimal token efficiency & API limits.
   */
  async fetchBatchDefinitions(wordList = [], onProgress = null) {
    const rawWords = wordList.map(w => w.trim()).filter(Boolean);
    // Deduplicate case-insensitively while preserving order
    const words = [];
    const seen = new Set();
    for (const w of rawWords) {
      const lower = w.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        words.push(w);
      }
    }

    if (words.length === 0) return { results: [], tokenStats: null };

    const BATCH_CHUNK_SIZE = 10;
    const allResults = [];
    let cumulativeTokens = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostUSD: 0
    };

    const template = this.customPrompts?.definitionPrompt || DEFAULT_PROMPTS.definitionPrompt;

    for (let i = 0; i < words.length; i += BATCH_CHUNK_SIZE) {
      const chunk = words.slice(i, i + BATCH_CHUNK_SIZE);
      const prompt = template.includes('{{WORDS_JSON}}')
        ? template.replace('{{WORDS_JSON}}', JSON.stringify(chunk))
        : `${template}\n\nTarget words to define:\n${JSON.stringify(chunk)}`;

      const res = await this.callGemini(prompt);
      let parsed;
      try {
        parsed = JSON.parse(res.text);
        if (!Array.isArray(parsed)) {
          if (parsed.words && Array.isArray(parsed.words)) {
            parsed = parsed.words;
          } else {
            throw new Error('Response is not a JSON array');
          }
        }
      } catch (err) {
        throw new Error(`Failed to parse definitions JSON for chunk [${chunk.join(', ')}]: ${err.message}`);
      }

      allResults.push(...parsed);

      if (res.tokenStats) {
        cumulativeTokens.inputTokens += res.tokenStats.inputTokens;
        cumulativeTokens.outputTokens += res.tokenStats.outputTokens;
        cumulativeTokens.totalTokens += res.tokenStats.totalTokens;
        cumulativeTokens.estimatedCostUSD += res.tokenStats.estimatedCostUSD;
      }

      if (typeof onProgress === 'function') {
        onProgress(Math.min(i + BATCH_CHUNK_SIZE, words.length), words.length);
      }
    }

    return {
      results: allResults,
      tokenStats: cumulativeTokens
    };
  }

  /**
   * Phase 2: Batch AI Definition Evaluation (up to 10 reviews).
   * Evaluates user's spoken or written answers against standard meanings.
   */
  async evaluateBatchReviews(reviewItems = []) {
    const batch = reviewItems.slice(0, 10);
    if (batch.length === 0) return { evaluations: [], tokenStats: null };

    const simplified = batch.map(item => ({
      id: item.id,
      word: item.word,
      definition: item.definition,
      userAnswer: item.userAnswer
    }));

    const template = this.customPrompts?.evaluationPrompt || DEFAULT_PROMPTS.evaluationPrompt;
    const prompt = template.includes('{{REVIEWS_JSON}}')
      ? template.replace('{{REVIEWS_JSON}}', JSON.stringify(simplified))
      : `${template}\n\nReview items to evaluate:\n${JSON.stringify(simplified)}`;

    const res = await this.callGemini(prompt);
    let evaluations;
    try {
      evaluations = JSON.parse(res.text);
      if (!Array.isArray(evaluations)) {
        evaluations = evaluations.evaluations || [];
      }
    } catch (err) {
      throw new Error(`Failed to parse evaluation JSON: ${err.message}`);
    }

    return {
      evaluations,
      tokenStats: res.tokenStats
    };
  }
}
