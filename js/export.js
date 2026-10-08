/**
 * Data Portability Engine:
 * 1. Full JSON database backup and restore.
 * 2. Anki-compatible CSV export (Word, Definition, Example, Synonyms).
 * 3. 1-tap Copy to Clipboard in Markdown or JSON format.
 */

/**
 * Escapes fields for standard CSV.
 */
function escapeCSVField(str = '') {
  if (str === null || str === undefined) return '""';
  const val = String(str).replace(/"/g, '""');
  return `"${val}"`;
}

/**
 * Exports words into Anki-compatible CSV.
 */
export function generateAnkiCSV(words = []) {
  const headers = ['Word', 'PartOfSpeech', 'Definition', 'Example', 'Synonyms', 'Keywords'];
  const rows = [headers.join(',')];

  for (const w of words) {
    const row = [
      escapeCSVField(w.word),
      escapeCSVField(w.partOfSpeech || ''),
      escapeCSVField(w.definition || ''),
      escapeCSVField(w.example || ''),
      escapeCSVField((w.synonyms || []).join('; ')),
      escapeCSVField((w.keywords || []).join('; '))
    ];
    rows.push(row.join(','));
  }

  return rows.join('\r\n');
}

/**
 * Exports complete database backup as formatted JSON.
 */
export function generateJSONBackup(stateSnapshot = {}) {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    words: stateSnapshot.words || [],
    metrics: stateSnapshot.metrics || {},
    pendingReviews: stateSnapshot.pendingReviews || []
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * Validates and parses JSON backup object.
 */
export function parseJSONBackup(jsonString) {
  try {
    const data = JSON.parse(jsonString);
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid JSON structure.');
    }
    if (!Array.isArray(data.words)) {
      throw new Error('Missing or invalid "words" list in backup.');
    }
    return data;
  } catch (err) {
    throw new Error(`Backup parse error: ${err.message}`);
  }
}

/**
 * Generates clean Markdown formatted dictionary string for clipboard.
 */
export function generateMarkdownExport(words = []) {
  if (words.length === 0) return '# Vocabulary Notebook\n\nNo words added yet.';

  const lines = ['# 📚 Vocabulary Notebook\n'];
  for (const w of words) {
    lines.push(`### ${w.word} ${w.partOfSpeech ? `*(${w.partOfSpeech})*` : ''}`);
    if (w.definition) lines.push(`- **Definition**: ${w.definition}`);
    if (w.example) lines.push(`- **Example**: *"${w.example}"*`);
    if (w.synonyms && w.synonyms.length > 0) lines.push(`- **Synonyms**: ${w.synonyms.join(', ')}`);
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Triggers browser download for a text file.
 */
export function triggerFileDownload(content, filename, mimeType = 'text/plain') {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Copies text to system clipboard with fallback.
 */
export async function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  // Fallback for older contexts
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.left = '-9999px';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  const successful = document.execCommand('copy');
  document.body.removeChild(textArea);
  if (!successful) throw new Error('Copy command failed.');
  return true;
}
