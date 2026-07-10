// ---------------------------------------------
// State
// ---------------------------------------------
let pdfFile = null;
let extractedData = {}; // { spell: [...], archetype: [...], item: [...], feat: [...], magic: [...] }
let skippedItems = []; // items filtered out for being < 80% complete
let apiKey = '';
let useOllama = false;
let ollamaModel = 'qwen3:8b';
let generatedBaselineData = {};
const OVERRIDE_STORAGE_KEY = 'aurora_xml_helper_overrides_v1';
const LEGACY_AI_EXTRACTION_ENABLED = false;
let rememberedOverrides = loadRememberedOverrides();

const TYPE_LABELS = {
  spell: 'Spells',
  archetype: 'Subclasses',
  item: 'Items / Equipment',
  feat: 'Feats',
  magic: 'Magic Items',
  race: 'Races',
  background: 'Backgrounds',
  class: 'Classes',
  other: 'Other'
};

const ELEMENT_TYPES = ['spell', 'archetype', 'item', 'feat', 'magic', 'race', 'background', 'class', 'other'];
const MANUAL_AUTHOR_TYPES = ELEMENT_TYPES;
const PDFJS_WORKER_SRC = './vendor/pdf.worker.min.mjs';

// ---------------------------------------------
// Init
// ---------------------------------------------
window.addEventListener('DOMContentLoaded', () => {
  apiKey = '';
  useOllama = false;
  setKeyStatus(true);
  updateTypeCheck();
  checkExtractReady();
  // Mark initially checked boxes
  document.querySelectorAll('.type-check input:checked').forEach(cb => {
    cb.closest('.type-check').classList.add('checked');
  });
});


// ---------------------------------------------
// Ollama provider
// ---------------------------------------------

function toggleOllama(on) {
  if (!LEGACY_AI_EXTRACTION_ENABLED) {
    useOllama = false;
    setKeyStatus(true);
    showKeyTestResult(false, legacyAiDisabledMessage());
    return;
  }
  useOllama = on;
  localStorage.setItem('use_ollama', on ? 'true' : 'false');
  document.getElementById('ollamaSection').classList.toggle('hidden', !on);
  document.getElementById('geminiSection').style.opacity = on ? '0.4' : '1';
  document.getElementById('keyStatus').textContent = on ? 'OK: Using Ollama' : (apiKey ? 'OK: API key saved' : 'API key not set');
  document.getElementById('keyStatus').className = on ? 'key-set' : (apiKey ? 'key-set' : 'key-unset');
  checkExtractReady();
}

function saveOllamaPrefs() {
  if (!LEGACY_AI_EXTRACTION_ENABLED) return;
  const model = document.getElementById('ollamaModelInput').value.trim();
  if (model) {
    ollamaModel = model;
    localStorage.setItem('ollama_model', model);
  }
}

async function testOllama() {
  if (!LEGACY_AI_EXTRACTION_ENABLED) {
    showLegacyAiDisabled('ollamaTestResult');
    return;
  }
  const btn = document.querySelector('#ollamaSection .btn-secondary');
  const resultEl = document.getElementById('ollamaTestResult');
  btn.disabled = true;
  btn.textContent = 'Testing...';
  resultEl.className = 'hidden';
  try {
    saveOllamaPrefs();
    const resp = await fetch('http://localhost:11434/api/tags');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const models = (data.models || []).map(m => m.name);
    const found = models.some(m => m.startsWith(ollamaModel.split(':')[0]));
    resultEl.className = 'alert alert-success';
    resultEl.textContent = found
      ? `Connected. Model "${ollamaModel}" found.`
      : `Connected. Note: "${ollamaModel}" not found. Available: ${models.slice(0,5).join(', ')}${models.length > 5 ? '...' : ''}`;
    resultEl.classList.remove('hidden');
  } catch(e) {
    resultEl.className = 'alert alert-error';
    resultEl.textContent = `Could not reach Ollama at localhost:11434 - ${e.message}`;
    resultEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Test Connection';
  }
}

// ---------------------------------------------
// PDF text extraction via PDF.js (for Ollama mode)
// ---------------------------------------------
const MAX_WORDS = 12000;

async function extractTextFromChunk(uint8Array) {
  try {
    // PDF.js is loaded by index.html and exposed on window for the static app.
    const pdfjsLib = window.pdfjsLib || window['pdfjs-dist/build/pdf'];
    if (!pdfjsLib) throw new Error('PDF.js not loaded');
    // Use the vendored worker module so PDF.js works without CDN access.
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;
    const loadingTask = pdfjsLib.getDocument({ data: uint8Array, disableWorker: true });
    const pdf = await loadingTask.promise;
    const pageTexts = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      pageTexts.push(content.items.map(i => i.str).join(' '));
    }
    let full = pageTexts.join('\n');
    // Truncate to MAX_WORDS
    const words = full.split(/\s+/);
    if (words.length > MAX_WORDS) full = words.slice(0, MAX_WORDS).join(' ') + '\n[...truncated]';
    return full;
  } catch(e) {
    console.warn('PDF.js extraction failed:', e.message);
    return ''; // caller will handle empty text
  }
}

// ---------------------------------------------
// Ollama raw call - mirrors geminiRaw shape
// ---------------------------------------------
async function ollamaRaw(textContent, promptText) {
  if (!LEGACY_AI_EXTRACTION_ENABLED) {
    throw new Error(legacyAiDisabledMessage());
  }
  const body = {
    model: ollamaModel,
    format: 'json',
    stream: false,
    messages: [{ role: 'user', content: textContent + '\n\n' + promptText }]
  };

  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) {
      const waitSec = [10, 20, 40][attempt - 1];
      setProgress(null, `Ollama busy - retrying in ${waitSec}s (${attempt}/3)...`);
      await new Promise(r => setTimeout(r, waitSec * 1000));
    }
    try {
      const resp = await fetch('http://localhost:11434/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (resp.ok) {
        const data = await resp.json();
        const text = data.message?.content || '';
        if (!text) throw new Error('Empty response from Ollama');
        return { text, truncated: false };
      }
      lastErr = new Error(`HTTP ${resp.status}`);
      if (resp.status < 500) break;
    } catch(e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('Ollama request failed');
}


// ---------------------------------------------
// API Key
// ---------------------------------------------
function toggleKeyVisibility() {
  const input = document.getElementById('apiKeyInput');
  const btn = document.getElementById('keyVisBtn');
  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  btn.textContent = isHidden ? 'Hide' : 'Show';
  btn.title = isHidden ? 'Hide key' : 'Show key';
}

function saveKey() {
  if (!LEGACY_AI_EXTRACTION_ENABLED) {
    apiKey = '';
    setKeyStatus(true);
    showKeyTestResult(false, legacyAiDisabledMessage());
    return;
  }
  const val = document.getElementById('apiKeyInput').value.trim();
  if (!val) { showKeyTestResult(false, 'Please enter an API key.'); return; }
  apiKey = val;
  localStorage.setItem('gemini_api_key', val);
  setKeyStatus(true);
  checkExtractReady();
  showKeyTestResult(true, 'Key saved. Use Test Key to verify it works.');
}

function setKeyStatus(ok) {
  const el = document.getElementById('keyStatus');
  el.textContent = 'Deterministic mode';
  el.className = 'key-set';
}

async function testKey() {
  if (!LEGACY_AI_EXTRACTION_ENABLED) {
    showKeyTestResult(false, legacyAiDisabledMessage());
    return;
  }
  const val = document.getElementById('apiKeyInput').value.trim();
  if (!val) { showKeyTestResult(false, 'Please enter a key first.'); return; }
  const btn = document.getElementById('testKeyBtn');
  btn.disabled = true;
  btn.textContent = 'Testing...';
  showKeyTestResult(null, '');
  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${val}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: 'Say OK' }] }], generationConfig: { maxOutputTokens: 5 } }) }
    );
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error?.message || `HTTP ${resp.status}`);
    showKeyTestResult(true, 'Key is valid and working.');
    // Auto-save if test passes
    apiKey = val;
    localStorage.setItem('gemini_api_key', val);
    setKeyStatus(true);
    checkExtractReady();
  } catch(err) {
    showKeyTestResult(false, 'Error: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Test Key';
  }
}

function showKeyTestResult(ok, msg) {
  const el = document.getElementById('keyTestResult');
  if (!msg) { el.classList.add('hidden'); return; }
  el.className = 'alert ' + (ok ? 'alert-success' : 'alert-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function legacyAiDisabledMessage() {
  return 'AI extraction is disabled. The deterministic parser reads local PDF text without API keys or model calls.';
}

function showLegacyAiDisabled(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.className = 'alert alert-info';
  el.textContent = legacyAiDisabledMessage();
  el.classList.remove('hidden');
}

// ---------------------------------------------
// File handling
// ---------------------------------------------
function handleDragOver(e) { e.preventDefault(); document.getElementById('uploadZone').classList.add('drag-over'); }
function handleDragLeave() { document.getElementById('uploadZone').classList.remove('drag-over'); }
function handleDrop(e) {
  e.preventDefault();
  handleDragLeave();
  const f = e.dataTransfer.files[0];
  if (f && f.type === 'application/pdf') setFile(f);
}
function handleFileSelect(e) { if (e.target.files[0]) setFile(e.target.files[0]); }

function setFile(f) {
  pdfFile = f;
  document.getElementById('uploadZone').classList.add('hidden');
  const info = document.getElementById('fileInfo');
  info.classList.remove('hidden');
  document.getElementById('fileName').textContent = f.name;
  const mb = f.size / 1024 / 1024;
  document.getElementById('fileSize').textContent = `(${mb.toFixed(2)} MB)`;
  const warn = document.getElementById('fileSizeWarning');
  if (mb > 30) {
    warn.textContent = mb > 80
      ? `Warning: very large file (${mb.toFixed(0)} MB) - local text parsing may take several minutes. A manual page range is recommended.`
      : `Note: large file (${mb.toFixed(0)} MB) - local text parsing will scan the full PDF unless you provide a page range.`;
    warn.className = mb > 80 ? 'alert alert-warning' : 'alert alert-info';
    warn.classList.remove('hidden');
  } else {
    warn.classList.add('hidden');
  }
  // Always pre-fill from filename; user can override afterwards
  const nameVal = f.name.replace(/\.pdf$/i, '').replace(/[_-]/g, ' ').trim();
  document.getElementById('sourceName').value = nameVal;
  const inferredYear = inferPublicationYear(nameVal);
  const yearEl = document.getElementById('sourceYear');
  if (yearEl) {
    yearEl.value = inferredYear ? String(inferredYear) : '';
    delete yearEl.dataset.rulesetEvidence;
  }
  // Reset user-edited flag so abbr auto-fills fresh for this file
  const abbrEl = document.getElementById('sourceAbbr');
  delete abbrEl.dataset.userEdited;
  autoFillAbbr(nameVal);
  // Clear author so it gets re-detected for this file
  document.getElementById('sourceAuthor').value = '';
  updateSourceRulesetDecisionDisplay();
  checkExtractReady();
}

function clearFile() {
  pdfFile = null;
  document.getElementById('pdfFile').value = '';
  document.getElementById('fileInfo').classList.add('hidden');
  document.getElementById('fileSizeWarning')?.classList.add('hidden');
  document.getElementById('uploadZone').classList.remove('hidden');
  const yearEl = document.getElementById('sourceYear');
  if (yearEl) delete yearEl.dataset.rulesetEvidence;
  updateSourceRulesetDecisionDisplay();
  checkExtractReady();
}

// ---------------------------------------------
// Type checkboxes
// ---------------------------------------------
function updateTypeCheck(cb) {
  if (cb) cb.closest('.type-check').classList.toggle('checked', cb.checked);
  checkExtractReady();
}

function getSelectedTypes() {
  return Array.from(document.querySelectorAll('.type-check input:checked')).map(c => c.value);
}

function checkExtractReady() {
  const ready = pdfFile && getSelectedTypes().length > 0;
  document.getElementById('extractBtn').disabled = !ready;
}

// ---------------------------------------------
// Prompts per element type
// ---------------------------------------------
const PROMPTS = {
  spell: `Extract ALL spells from this PDF. Return a JSON array where every element has:
name, school, level (integer 0-9), castingTime, range,
hasVerbal (bool), hasSomatic (bool), hasMaterial (bool), material (string),
duration, isConcentration (bool), isRitual (bool), isTechnomagic (bool),
classes (array of strings from: Bard, Cleric, Druid, Sorcerer, Warlock, Wizard),
description (complete full text of the spell),
higherLevels (At Higher Levels text, empty string if none).
Include every spell. Do not truncate descriptions.`,

  archetype: `Extract ALL subclasses and archetypes from this PDF. Return a JSON array where every element has:
name, class (parent class name e.g. Barbarian), supports (Aurora category - use exactly:
Primal Path, Bard College, Divine Domain, Druid Circle, Martial Archetype, Monastic Tradition,
Sacred Oath, Ranger Archetype, Roguish Archetype, Sorcerous Origin, Otherworldly Patron, Arcane Tradition),
description (flavour text only),
features (array of objects with: name, level (integer), action (e.g. Bonus Action, or empty string),
usage (e.g. 1/Short Rest, or empty string), description (COMPLETE mechanical text of the feature
including every bullet point, every condition, every number - do not summarise or truncate)).
Include every subclass and every one of its features.`,

  item: `Extract ALL equipment, weapons, armor, tools, and gear from this PDF.
Return a JSON array where every element has:
name, category (Weapons/Armor/Tools/Gear),
cost (number only e.g. "50"), currency (gp/sp/cp),
weight (number only e.g. "2"),
description (the full descriptive text for this item - include special rules, usage instructions,
and any mechanics not captured in other fields. Do NOT repeat the item name, cost, weight,
damage dice, or properties list in this field as those are stored separately),
damage (e.g. 2d6 piercing, empty if not a weapon),
damageType (empty if not a weapon),
properties (comma-separated weapon/armor properties e.g. "reload 6, two-handed, burst fire", empty if none).
Include every item listed in equipment tables and descriptions.
Keep descriptions focused - omit flavour text that simply restates the item category or reiterates stats.`,
  feat: `Extract ALL feats from this PDF.
Return a JSON array where every element has:
name (string),
prerequisite (string, empty if none),
fullText (string - the COMPLETE text of the feat exactly as it appears in the PDF,
including the opening sentence AND every bullet point. Do not omit anything.).
Include every feat.`,

  magic: `Extract ALL magic items from this PDF. Return a JSON array where every element has:
name, type (e.g. Wondrous Item, Weapon, Armor, Ring, Staff, Wand, Potion, Scroll),
rarity (Common/Uncommon/Rare/Very Rare/Legendary/Artifact),
requiresAttunement (bool),
description (complete full text including all properties, charges, and effects),
charges (integer, 0 if none),
recharge (text describing when charges reset, empty if not applicable).
Include every magic item.`,

  race: `Extract ALL races and species from this PDF.
Return a JSON array where every element has:
name (string), description (string - flavour text only),
size (string - e.g. "Medium"), speed (integer - base walking speed),
abilityScores (object - e.g. {"strength":2,"dexterity":1}, omit if none),
languages (array of strings),
traits (array of objects with: name (string), description (string - complete mechanical text)),
subraces (array of objects with: name (string), description (string)) - empty if none.
Include every race. Do not truncate trait descriptions.`,

  background: `Extract ALL backgrounds from this PDF.
Return a JSON array where every element has:
name (string), description (string - flavour text only),
skillProficiencies (array of skill name strings e.g. ["Arcana","History"]),
toolProficiencies (array of strings, empty if none),
languages (array of strings, use "Any" if player chooses),
equipment (string - starting equipment list),
features (array of objects with: name (string), description (string - complete text)).`,

  class: `Extract ALL classes from this PDF.
Return a JSON array where every element has:
name (string), description (string - flavour text only),
hitDie (integer - e.g. 8 for d8),
savingThrows (array of ability name strings e.g. ["Wisdom","Charisma"]),
armorProficiencies (array - e.g. ["Light Armor","Shields"]),
weaponProficiencies (array - e.g. ["Simple Weapons"]),
skillChoices (object with: count (integer), from (array of skill names)),
startingEquipment (string),
archetypeLevel (integer - level at which archetype is chosen, e.g. 3),
archetypeLabel (string - e.g. "Primal Path"),
archetypeSupports (string - the supports tag value for archetype selection),
features (array of objects with: name (string), level (integer), action (string), usage (string), description (string - COMPLETE mechanical text)).
Include every class and all its features. Do not truncate.`,

  other: `Extract ALL elements from this PDF that do not fit into spells, subclasses, equipment, feats, or magic items. This includes things like races, classes, backgrounds, companions, vehicles, monsters, or any other custom content.
Return a JSON array where every element has:
name (string),
type (string - the specific element type, e.g. "Race", "Class", "Background", "Monster"),
description (complete full text of the element including all traits, features, and mechanics).
Include every such element. If nothing of this kind exists in the PDF, return an empty array.`
};




// ---------------------------------------------
// PDF chunking via pdf-lib
// ---------------------------------------------
const PAGES_PER_CHUNK = 50;   // ~13K tokens/chunk, safely under 1M context limit
const INLINE_LIMIT_MB = 19;   // still used for TOC/meta calls on small files

// Split a File into an array of Uint8Array chunks, each PAGES_PER_CHUNK pages
async function splitPdfIntoChunks(file, progressCallback) {
  progressCallback('Loading PDF for chunking...', 0.02);
  const arrayBuf = await file.arrayBuffer();
  let srcDoc;
  try {
    srcDoc = await PDFLib.PDFDocument.load(arrayBuf, { ignoreEncryption: true, throwOnInvalidObject: false });
  } catch(e) {
    console.error('pdf-lib load failed:', e);
    throw new Error(`pdf-lib could not parse this PDF: ${e.message}`);
  }
  const totalPages = srcDoc.getPageCount();
  if (totalPages === 0) throw new Error('PDF reports 0 pages');
  progressCallback(`PDF has ${totalPages} pages - splitting into chunks of ${PAGES_PER_CHUNK}...`, 0.04);

  const chunks = [];
  for (let start = 0; start < totalPages; start += PAGES_PER_CHUNK) {
    const end = Math.min(start + PAGES_PER_CHUNK, totalPages);
    const indices = Array.from({ length: end - start }, (_, i) => start + i);
    const chunkDoc = await PDFLib.PDFDocument.create();
    const pages = await chunkDoc.copyPages(srcDoc, indices);
    pages.forEach(p => chunkDoc.addPage(p));
    const bytes = await chunkDoc.save();
    chunks.push({ bytes, startPage: start + 1, endPage: end, totalPages });
    progressCallback(`Chunking pages ${start + 1}-${end} of ${totalPages}...`, 0.04 + (end / totalPages) * 0.04);
  }

  progressCallback(`Split into ${chunks.length} chunk(s).`, 0.08);
  return chunks;
}

// Convert Uint8Array to base64
function uint8ToBase64(uint8) {
  let binary = '';
  const len = uint8.byteLength;
  for (let i = 0; i < len; i++) binary += String.fromCharCode(uint8[i]);
  return btoa(binary);
}



// ---------------------------------------------
// TOC-guided extraction
// ---------------------------------------------

// Holds page ranges discovered from the TOC, keyed by element type
let discoveredPageRanges = {};

const TOC_PROMPT = `Read the table of contents or index of this PDF.
Return a JSON object mapping content sections to their page ranges.
Use these exact keys where the content exists: spell, archetype, item, feat, magic, race, background, class.
For each key, provide the page range as a string like "24-38" or "45" for a single page.
If a section does not exist in this PDF, omit its key.
Example: {"spell":"45-62","archetype":"10-44","race":"65-120","class":"121-200"}
Return ONLY the JSON object. If the PDF has no table of contents, return {}.`;

async function discoverPageRanges(base64, isUri, progressCallback) {
  if (!LEGACY_AI_EXTRACTION_ENABLED) return {};
  progressCallback('Reading table of contents...', 0.05);
  try {
    let text;
    if (useOllama) {
      const extracted = await extractTextFromChunk(Uint8Array.from(atob(base64), c => c.charCodeAt(0)));
      if (!extracted) return {};
      const result = await ollamaRaw(extracted, TOC_PROMPT);
      text = result.text;
    } else {
      const body = {
        contents: [{ parts: [
          { inline_data: { mime_type: 'application/pdf', data: base64 } },
          { text: TOC_PROMPT }
        ]}],
        generationConfig: { temperature: 0.1, maxOutputTokens: 1024, response_mime_type: 'application/json' }
      };
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      );
      if (!resp.ok) { console.warn('TOC HTTP error', resp.status); return {}; }
      const data = await resp.json();
      text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    }
    const parsed = safeParseJson(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      console.log('TOC discovered:', parsed);
      return parsed;
    }
    console.warn('TOC returned unexpected shape:', parsed);
  } catch(e) {
    console.warn('TOC read failed, will use full PDF:', e.message);
  }
  return {};
}



async function detectSourceMeta(base64, isUri) {
  if (!LEGACY_AI_EXTRACTION_ENABLED) return;
  const metaPrompt = 'What is the title and author of this supplement? Reply with only this exact JSON structure and nothing else: {"title":"TITLE_HERE","author":"AUTHOR_HERE"}';
  try {
    let text;
    if (useOllama) {
      const extracted = await extractTextFromChunk(Uint8Array.from(atob(base64), c => c.charCodeAt(0)));
      if (!extracted) return;
      const result = await ollamaRaw(extracted, metaPrompt);
      text = result.text.trim();
    } else {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [
            { inline_data: { mime_type: 'application/pdf', data: base64 } },
            { text: metaPrompt }
          ]}], generationConfig: { maxOutputTokens: 300, response_mime_type: 'application/json' } }) }
      );
      if (!resp.ok) return;
      const data = await resp.json();
      text = (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    }
    const meta = safeParseJson(text);
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return;
    if (meta.title && meta.title.trim()) {
      document.getElementById('sourceName').value = meta.title.trim();
      const abbrEl = document.getElementById('sourceAbbr');
      if (!abbrEl.dataset.userEdited) autoFillAbbr(meta.title.trim());
    }
    if (meta.author && meta.author.trim() && meta.author !== 'Unknown') {
      document.getElementById('sourceAuthor').value = meta.author.trim();
    }
    console.log('Source meta detected:', meta);
  } catch(e) {
    console.warn('Source meta detection failed:', e.message);
  }
}

// ---------------------------------------------
// Deterministic PDF parsing
// ---------------------------------------------
const DETERMINISTIC_PARSERS = {
  spell: parseSpellsFromText,
  archetype: parseArchetypesFromText,
  feat: parseFeatsFromText,
  magic: parseMagicItemsFromText,
  item: parseItemsFromText,
  race: parseRacesFromText,
  background: parseBackgroundsFromText,
  class: parseClassesFromText,
};

async function deterministicExtract(file, types, progressCallback) {
  progressCallback(5, 'Reading PDF text locally...');
  const pages = await extractPdfPages(file);
  const selectedPages = selectPages(pages, document.getElementById('pageRange')?.value?.trim() || '');
  const continuationPages = selectContinuationPages(pages, selectedPages);
  const text = selectedPages.map(p => p.text).join('\n\n');
  if (!text.trim()) throw new Error('No selectable text was found in this PDF. Scanned/image-only PDFs need OCR before deterministic parsing can work.');

  detectSourceMetaFromText(selectedPages);

  const out = {};
  for (let i = 0; i < types.length; i++) {
    const type = types[i];
    const parser = DETERMINISTIC_PARSERS[type];
    progressCallback(10 + Math.round((i / Math.max(types.length, 1)) * 80), `Parsing ${TYPE_LABELS[type] || type}...`);
    out[type] = parser ? parser(text, { pages: selectedPages, continuationPages }) : [];
  }
  progressCallback(95, 'Normalizing parsed elements...');
  return out;
}

async function extractPdfPages(file) {
  const pdfjsLib = window.pdfjsLib || window['pdfjs-dist/build/pdf'];
  if (!pdfjsLib) throw new Error('PDF.js is not loaded.');
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data, disableWorker: true }).promise;
  const pages = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const layout = window.AuroraPdfTextLayout;
    if (!layout?.textItemsToLayout) throw new Error('PDF text layout support is not loaded.');
    const pageLayout = layout.textItemsToLayout(content.items);
    pages.push({ page: p, text: pageLayout.lines.join('\n'), layout: pageLayout });
  }
  return pages;
}

function selectPages(pages, rangeText) {
  if (!rangeText) return pages;
  const wanted = new Set();
  for (const part of rangeText.split(',')) {
    const m = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) continue;
    const start = parseInt(m[1], 10);
    const end = parseInt(m[2] || m[1], 10);
    for (let p = Math.min(start, end); p <= Math.max(start, end); p++) wanted.add(p);
  }
  const filtered = pages.filter(p => wanted.has(p.page));
  return filtered.length ? filtered : pages;
}

function selectContinuationPages(allPages, selectedPages) {
  const selected = new Set((selectedPages || []).map(page => page.page));
  const continuationPageNumbers = new Set();
  for (const page of selectedPages || []) {
    const nextPage = page.page + 1;
    if (!selected.has(nextPage) && allPages.some(candidate => candidate.page === nextPage)) {
      continuationPageNumbers.add(nextPage);
    }
  }
  return (allPages || []).filter(page => continuationPageNumbers.has(page.page));
}

function detectSourceMetaFromText(pages) {
  const firstLines = (pages[0]?.text || '').split('\n').map(s => normalizeTextLine(normalizeEncodingArtifacts(s))).filter(Boolean);
  const allText = pages.map(page => normalizeEncodingArtifacts(page.text || '')).join('\n');
  const title = firstLines.find(line => /^[A-Z0-9][A-Za-z0-9:'\u2019\-\s]{8,70}$/.test(line) && !/^(chapter|contents|table of contents)$/i.test(line));
  if (title && !document.getElementById('sourceName').value.trim()) {
    document.getElementById('sourceName').value = title;
    autoFillAbbr(title);
  }
  const byline = firstLines.find(line => /^by\s+/i.test(line));
  if (byline && !document.getElementById('sourceAuthor').value.trim()) {
    document.getElementById('sourceAuthor').value = byline.replace(/^by\s+/i, '').trim();
  }
  const year = inferPublicationYear(firstLines.join(' '));
  const yearEl = document.getElementById('sourceYear');
  if (year && yearEl && !yearEl.value.trim()) yearEl.value = String(year);
  const modernSignals = detectModernRulesetSignals(allText);
  if (modernSignals.length && yearEl) {
    yearEl.dataset.rulesetEvidence = modernSignals.join('|');
  }
  updateSourceRulesetDecisionDisplay();
}

function normalizeEncodingArtifacts(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\u00e2\u20ac[\u0153\u009d]/g, '"')
    .replace(/\u00e2\u20ac[\u02dc\u2122]/g, "'")
    .replace(/\u00e2\u20ac[\u201c\u201d]/g, '-')
    .replace(/\u00e2\u20ac\u00a0/g, '');
}

function normalizeTextLines(text) {
  return normalizeEncodingArtifacts(text)
    .split(/\r?\n/)
    .map(normalizeTextLine)
    .filter(Boolean);
}

function normalizeTextLine(line) {
  let value = String(line || '').trim();
  if (!value) return '';
  if (/^!\[[^\]]*\]\([^)]+\)/.test(value)) return '';
  value = value
    .replace(/^>+\s*/, '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/^[`'"]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return value;
}

function spellTableKey(value) {
  return normalizeEncodingArtifacts(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function spellTableClasses(value) {
  const expression = /\b(Bard|Cleric|Druid|Paladin|Ranger|Sorcerer|Warlock|Wizard|Artificer)\b/gi;
  return uniqueTokens([...String(value || '').matchAll(expression)].map(match => titleCase(match[1])));
}

function extractSpellTableMetadata(pages) {
  const metadata = new Map();
  for (const page of pages || []) {
    const columns = page?.layout?.columns || [];
    const left = columns.find(column => column.side === 'left');
    const right = columns.find(column => column.side === 'right');
    if (!left || !right) continue;
    if (!left.rows.some(row => /^Level\s+Spell\s+School$/i.test(row.text)) || !right.rows.some(row => /Ritual\s+Class$/i.test(row.text))) continue;

    for (const row of left.rows) {
      const match = row.text.match(/^(\d+)(?:st|nd|rd|th)\s+(.+?)\s+(Abjuration|Conjuration|Divination|Enchantment|Evocation|Illusion|Necromancy|Transmutation)$/i);
      if (!match) continue;
      const companion = right.rows
        .map(candidate => ({ candidate, distance: Math.abs(candidate.y - row.y) }))
        .filter(candidate => candidate.distance < 4)
        .sort((a, b) => a.distance - b.distance)[0]?.candidate;
      const companionMatch = companion?.text.match(/^(Yes|No)\s+(Yes|No)\s+(.+)$/i);
      if (!companionMatch) continue;
      const classes = spellTableClasses(companionMatch[3]);
      if (!classes.length) continue;
      metadata.set(spellTableKey(match[2]), {
        level: Number(match[1]),
        school: titleCase(match[3]),
        isConcentration: /^yes$/i.test(companionMatch[1]),
        isRitual: /^yes$/i.test(companionMatch[2]),
        classes
      });
    }
  }
  return metadata;
}

function hasUnclosedParenthesis(value) {
  const text = String(value || '');
  return (text.match(/\(/g) || []).length > (text.match(/\)/g) || []).length;
}

function findSpellLayoutLocation(name, pages) {
  const key = spellTableKey(name);
  for (const page of pages || []) {
    for (const column of page?.layout?.columns || []) {
      if (column.rows.some(row => spellTableKey(row.text) === key)) {
        return { page: page.page, side: column.side };
      }
    }
  }
  return null;
}

function isPdfContinuationNoise(line) {
  const text = String(line || '').trim();
  return !text
    || /^\d+\s+CHAPTER\b/i.test(text)
    || /^[-–]?(?:fizban|nzban)$/i.test(text)
    || /^[A-Za-z](?:\s+[A-Za-z])+(?:\s*\.\s*[A-Za-z])?\.?$/.test(text)
    || /[<{;~]/.test(text);
}

function isPdfPageChromeLine(line) {
  const text = String(line || '').trim();
  return /^\d+\s+CHAPTER\b/i.test(text)
    || /^CHAPTER\b.*\d+$/i.test(text)
    || /^\d+\s*$/.test(text);
}

function isSpellTableMetadataNoiseLine(line) {
  const text = String(line || '').trim();
  return /^(?:Cone\.\s+)?(?:(?:Conc\.|Concentration)\s+)?Ritual\s+Class$/i.test(text)
    || /^(?:Yes|No)\s+(?:Yes|No)\s+[A-Za-z][A-Za-z/',\s-]+$/i.test(text)
    || /^and Eberron:\s*Rising from the Last War\.?$/i.test(text)
    || /^\*The artificer class appears\b/i.test(text);
}

function cleanSpellBodyLines(lines) {
  const cleaned = [];
  let skippingSidebar = false;
  for (const rawLine of lines || []) {
    const line = String(rawLine || '').trim();
    if (!line) continue;
    if (skippingSidebar) {
      if (/^[-–]?(?:fizban|nzban)$/i.test(line)) skippingSidebar = false;
      continue;
    }
    if (/[<{~]/.test(line)) {
      skippingSidebar = true;
      continue;
    }
    if (isPdfPageChromeLine(line) || isSpellTableMetadataNoiseLine(line)) continue;
    const normalized = line.replace(/^[,;:]\s+(?=[A-Z][A-Za-z' -]+\.)/, '');
    if (/^[-–]?(?:fizban|nzban)$/i.test(normalized)) continue;
    cleaned.push(normalized);
  }
  return cleaned;
}

function continuationProseStartIndex(lines, options = {}) {
  const directAddress = lines.findIndex(line => /^You\b/i.test(line));
  const namedFeature = lines.findIndex(line => /^[A-Z][A-Za-z' -]{2,}\.\s+/.test(line));
  const proseStart = lines.findIndex(line => /^(?:The|A|An|Each|When|While|For|Until|On)\b/i.test(line));
  if (!options.preferEarliestFeature) {
    if (directAddress >= 0) return directAddress;
    if (proseStart >= 0) return proseStart;
    return namedFeature;
  }
  return [directAddress, namedFeature, proseStart]
    .filter(index => index >= 0)
    .sort((a, b) => a - b)[0] ?? -1;
}

function spellNextPageText(name, pages, candidatePages, options = {}) {
  const location = findSpellLayoutLocation(name, pages);
  if (!location) return '';
  const page = (candidatePages || []).find(candidate => candidate.page === location.page + 1);
  const column = page?.layout?.columns?.find(candidate => candidate.side === 'left')
    || page?.layout?.columns?.[0];
  if (!column) return '';

  const lines = column.rows.map(row => row.text);
  const startIndex = continuationProseStartIndex(lines, options);
  if (startIndex < 0) return '';
  const boundaryIndex = lines.findIndex((line, index) => index > startIndex && (isSectionHeading(line) || isElementStart(lines, index)));
  return cleanSpellBodyLines(lines
    .slice(startIndex, boundaryIndex < 0 ? lines.length : boundaryIndex)
    .filter(line => !isPdfContinuationNoise(line)))
    .join('\n')
    .trim();
}

function spellContinuationText(name, pages, continuationPages) {
  return spellNextPageText(name, pages, continuationPages);
}

function parseSpellsFromText(text, options = {}) {
  const lines = normalizeTextLines(text);
  const tableMetadata = extractSpellTableMetadata(options.pages);
  const spells = [];
  for (let i = 0; i < lines.length - 5; i++) {
    const kind = parseSpellKind(lines[i + 1]);
    if (!kind || !looksLikeTitle(lines[i])) continue;
    const fields = {};
    let j = i + 2;
    for (; j < Math.min(lines.length, i + 14); j++) {
      const m = lines[j].match(/^(Casting Time|Range|Components|Duration):\s*(.+)$/i);
      if (m) {
        const field = m[1].toLowerCase();
        fields[field] = m[2].trim();
        if (field === 'components') {
          while (hasUnclosedParenthesis(fields.components) && j + 1 < Math.min(lines.length, i + 14)) {
            const continuation = lines[j + 1];
            if (/^(Casting Time|Range|Components|Duration):\s*/i.test(continuation)) break;
            fields.components += ` ${continuation}`;
            j++;
          }
        }
      }
      if (fields['casting time'] && fields.range && fields.components && fields.duration) break;
    }
    if (!fields['casting time'] || !fields.range || !fields.components || !fields.duration) continue;
    const descStart = j + 1;
    let descEnd = descStart;
    while (descEnd < lines.length && !isElementStart(lines, descEnd) && !isSectionHeading(lines[descEnd])) descEnd++;
    const stoppedAtPageChrome = descEnd < lines.length && isPdfPageChromeLine(lines[descEnd]);
    let bodyLines = cleanSpellBodyLines(lines.slice(descStart, descEnd));
    let body = bodyLines.join('\n');
    if (!body.trim()) body = spellContinuationText(lines[i], options.pages, options.continuationPages);
    else if (stoppedAtPageChrome) {
      const selectedPageContinuation = spellNextPageText(lines[i], options.pages, options.pages, { preferEarliestFeature: true });
      if (selectedPageContinuation) body = `${body}\n${selectedPageContinuation}`;
    }
    const higher = body.match(/(?:At Higher Levels?\.?|At Higher Levels:|Using a Higher-Level Spell Slot\.?)\s*(.+)$/is);
    const description = higher ? body.slice(0, higher.index).trim() : body.trim();
    const components = parseComponents(fields.components);
    const tableEntry = tableMetadata.get(spellTableKey(lines[i]));
    spells.push({
      name: normalizeExtractedName(lines[i]),
      school: tableEntry?.school || kind.school,
      level: tableEntry?.level ?? kind.level,
      castingTime: normalizeSpellCastingTime(fields['casting time'], lines[i + 1]),
      range: fields.range,
      hasVerbal: components.hasVerbal,
      hasSomatic: components.hasSomatic,
      hasMaterial: components.hasMaterial,
      material: components.material,
      duration: normalizeSpellDuration(fields.duration),
      isConcentration: tableEntry?.isConcentration ?? /^concentration/i.test(fields.duration),
      isRitual: tableEntry?.isRitual ?? /\britual\b/i.test(lines[i + 1]),
      isTechnomagic: false,
      classes: tableEntry?.classes?.length ? tableEntry.classes : (kind.classes?.length ? kind.classes : inferClasses(`${lines.slice(Math.max(0, i - 8), i).join(' ')}\n${body}`)),
      tableMetadata: tableEntry || null,
      description,
      higherLevels: higher ? higher[1].trim() : ''
    });
    i = Math.max(i, descEnd - 1);
  }
  return uniqueByName(spells);
}

function parseSpellKind(line) {
  const cantrip = line.match(/^([A-Za-z]+)\s+cantrip(?:\s*\((ritual)\))?$/i);
  if (cantrip && isSpellSchool(cantrip[1])) return { level: 0, school: titleCase(cantrip[1]) };
  const leveled = line.match(/^(\d+)(?:st|nd|rd|th)-level\s+([A-Za-z]+)(?:\s*\((ritual)\))?$/i);
  if (leveled && isSpellSchool(leveled[2])) return { level: parseInt(leveled[1], 10), school: titleCase(leveled[2]) };
    const ddb = line.match(/^Level\s+(\d+)\s+([A-Za-z]+)(?:\s*\(([^)]+)\))?/i);
  if (ddb && isSpellSchool(ddb[2])) {
    const paren = ddb[3] || '';
    const classes = /\britual\b/i.test(paren) ? [] : splitListValue(paren).map(titleCase);
    return {
      level: parseInt(ddb[1], 10),
      school: titleCase(ddb[2]),
      classes
    };
  }
  return null;
}

function normalizeSpellCastingTime(value, kindLine = '') {
  const text = String(value || '').trim();
  if (/\britual\b/i.test(text) || /\britual\b/i.test(kindLine)) {
    return text.replace(/\s*\(\s*ritual\s*\)\s*/i, '').trim() + ' or Ritual';
  }
  return text;
}

function normalizeSpellDuration(value) {
  const text = String(value || '').trim();
  if (/^instant(?:aneous)?$/i.test(text)) return 'Instantaneous';
  return text;
}


function isSpellSchool(value) {
  return /^(Abjuration|Conjuration|Divination|Enchantment|Evocation|Illusion|Necromancy|Transmutation)$/i.test(String(value || '').trim());
}

function parseComponents(text) {
  const material = (text.match(/M\s*\((.+)\)/i) || [])[1] || '';
  return {
    hasVerbal: /\bV\b/i.test(text),
    hasSomatic: /\bS\b/i.test(text),
    hasMaterial: /\bM\b/i.test(text),
    material
  };
}

function inferClasses(text) {
  const allowed = new Set(['Bard','Cleric','Druid','Paladin','Ranger','Sorcerer','Warlock','Wizard','Artificer']);
  const possessive = String(text || '').match(/\b(Bard|Cleric|Druid|Paladin|Ranger|Sorcerer|Warlock|Wizard|Artificer)['’]s\s+spell\s+list\b/i);
  if (possessive) return [titleCase(possessive[1])].filter(s => allowed.has(s));
  const m = text.match(/Spell Lists?\.\s*([A-Za-z,\s]+)/i);
  if (!m) return [];
  return m[1].split(',').map(s => titleCase(s.trim())).filter(s => allowed.has(s));
}

function parseFeatsFromText(text) {
  const lines = normalizeTextLines(text);
  const feats = [];
  const hasFeatSections = lines.some(isFeatSectionHeading);
  const allowLooseFeatStarts = hasFeatSections || lines.length < 80;
  let inFeatSection = allowLooseFeatStarts && !hasFeatSections;
  for (let i = 0; i < lines.length; i++) {
    if (isFeatSectionHeading(lines[i])) {
      inFeatSection = true;
      continue;
    }
    if (isSectionHeading(lines[i])) {
      inFeatSection = false;
      continue;
    }
    const start = featStartInfo(lines, i, { inFeatSection });
    if (!start) continue;
    let bodyStart = start.bodyStart;
    while (bodyStart < lines.length && isFeatMetaLine(lines[bodyStart])) bodyStart++;
    let j = bodyStart;
    while (j < lines.length && !featStartInfo(lines, j, { inFeatSection }) && !isElementStart(lines, j) && !isSectionHeading(lines[j])) j++;
    const fullText = lines.slice(bodyStart, j).filter(line => !isFeatMetaLine(line)).join('\n');
    const parsed = parseFeatFullText({ name: start.name, prerequisite: start.prerequisite, fullText });
    if (parsed.description || parsed.benefits?.length) feats.push(parsed);
    i = Math.max(i, j - 1);
  }
  return uniqueByName(feats);
}

function featStartInfo(lines, i, options = {}) {
  const line = lines[i] || '';
  const next = lines[i + 1] || '';
  if (isLeveledFeatureHeading(line)) return null;
  const prefixed = line.match(/^Feat:\s*(.+)$/i);
  if (prefixed) {
    const name = normalizeExtractedName(prefixed[1]);
    if (isRejectedFeatTitle(name)) return null;
    const lookahead = lines.slice(i + 1, i + 6).join('\n');
    if (/^(Ability Scores?|Skill Proficiencies|Tool Proficienc(?:y|ies)|Equipment):/im.test(lookahead)) return null;
    const prerequisite = /^Prerequisite:/i.test(next) ? next.replace(/^Prerequisite:\s*/i, '').trim() : '';
    return { name, prerequisite, bodyStart: i + 1 + (prerequisite ? 1 : 0) };
  }
  if (!looksLikeTitle(line) || isRejectedFeatTitle(line) || /:/.test(line)) return null;
  if (looksLikeBackgroundStatBlockAhead(lines, i)) return null;
  const featKind = next.match(/^(?:(?:General|Origin|Epic Boon|Fighting Style|Dragonmark)\s+)?Feat(?:\s*\(([^)]*)\)|\s*$)/i);
  if (featKind) {
    const prerequisite = (featKind[1]?.match(/Prerequisite:\s*(.+)$/i) || [])[1]?.trim() || '';
    return { name: normalizeExtractedName(line), prerequisite, bodyStart: i + 2 };
  }
  if (options.inFeatSection && /^Prerequisite:|^You gain|^You have|^Increase your/i.test(next)) {
    const prerequisite = /^Prerequisite:/i.test(next) ? next.replace(/^Prerequisite:\s*/i, '').trim() : '';
    return { name: normalizeExtractedName(line), prerequisite, bodyStart: i + 1 + (prerequisite ? 1 : 0) };
  }
  return null;
}

function isFeatSectionHeading(line) {
  const clean = cleanExtractedTitle(line);
  return /^(?:General|Origin|Epic Boon|Fighting Style|Dragonmark)?\s*Feats?$/i.test(clean)
    || /^(?:Epic Boon)\s+Feat$/i.test(clean);
}

function looksLikeBackgroundStatBlockAhead(lines, i) {
  const block = [];
  for (let j = i + 1; j < Math.min(lines.length, i + 16); j++) {
    if (isSectionHeading(lines[j])) break;
    block.push(lines[j]);
  }
  const lookahead = block.join('\n');
  const hasBackgroundRows = /^(Ability Scores?|Skill Proficiencies|Tool Proficienc(?:y|ies)|Equipment):/im.test(lookahead);
  const hasFeatRow = /^Feat:\s*\S/im.test(lookahead);
  return hasBackgroundRows && hasFeatRow;
}

function isRejectedFeatTitle(title) {
  const text = cleanExtractedTitle(title);
  return !text
    || /^ARTIST:/i.test(text)
    || /^Level\s+\d+\b/i.test(text)
    || /^(General|Origin|Epic Boon|Fighting Style|Dragonmark)\s+Feats?$/i.test(text)
    || /^(Favou?red|Favoneo|Recognized|Recocnizeo|Preeminent)\s+in\s+House$/i.test(text)
    || /^Training$/i.test(text)
    || /,\s*(common|uncommon|rare|very rare|legendary|artifact|varies)\b/i.test(text)
    || /\(see\b/i.test(text);
}

function isFeatMetaLine(line) {
  return /^ARTIST:/i.test(line)
    || /^'?TIS\b/i.test(line)
    || /^(?:(?:General|Origin|Epic Boon|Fighting Style|Dragonmark)\s+)?Feat\b/i.test(line);
}

function parseMagicItemsFromText(text) {
  const lines = normalizeTextLines(text);
  const items = [];
  const rarityWords = 'common|uncommon|rare|very rare|legendary|artifact|varies';
  const hasMagicItemSections = lines.some(isMagicItemSectionHeading);
  const allowLooseMagicItems = hasMagicItemSections || lines.length < 120;
  let inMagicItemSection = allowLooseMagicItems && !hasMagicItemSections;
  for (let i = 0; i < lines.length - 1; i++) {
    if (isMagicItemSectionHeading(lines[i])) {
      inMagicItemSection = true;
      continue;
    }
    if (isSectionHeading(lines[i]) && !isMagicItemSectionHeading(lines[i])) {
      inMagicItemSection = false;
      continue;
    }
    if (!inMagicItemSection) continue;
    if (!looksLikeTitle(lines[i])) continue;
    if (isProseFragmentTitle(lines[i])) continue;
    const detail = lines[i + 1].match(new RegExp(`^(.+?),\\s*(${rarityWords})(?:\\s*\\((requires attunement.*?)\\))?$`, 'i'));
    if (!detail) continue;
    if (!isMagicItemType(detail[1])) continue;
    let j = i + 2;
    while (j < lines.length && !isElementStart(lines, j) && !isSectionHeading(lines[j])) j++;
    const description = lines.slice(i + 2, j).join('\n').trim();
    items.push({
      name: lines[i],
      type: titleCase(detail[1].trim()),
      rarity: titleCase(detail[2].trim()),
      requiresAttunement: !!detail[3],
      description,
      charges: parseCharges(description),
      recharge: parseRecharge(description)
    });
    i = Math.max(i, j - 1);
  }
  return uniqueByName(items);
}

function isMagicItemSectionHeading(line) {
  const clean = cleanExtractedTitle(line);
  return /^magic items?$/i.test(clean)
    || /^magic item descriptions$/i.test(clean)
    || /^magic items? a[-–—]z$/i.test(clean);
}

function isMagicItemType(value) {
  const clean = cleanExtractedTitle(value).replace(/\s+/g, ' ');
  return /^(Armor|Potion|Ring|Rod|Scroll|Staff|Wand|Weapon(?:\s*\([^)]+\))?|W\s*ondrous Item|Wondrous Item)$/i.test(clean);
}

function isTableOfContentsLine(line) {
  return /\.{2,}\s*\d+\s*$/i.test(String(line || '').trim());
}

function isProseFragmentTitle(line) {
  const clean = cleanExtractedTitle(line);
  if (!clean) return false;
  if (isTableOfContentsLine(clean)) return true;
  if (/[,;:\-–—]$/.test(clean)) return true;
  if (/^\d+\s+\S/.test(clean)) return true;
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length > 10) return true;
  return words.length > 4 && /^(if|when|whenever|while|for|as|you|your|this|these|those)\b/i.test(clean);
}

function parseItemsFromText(text) {
  const lines = normalizeTextLines(text);
  const items = [];
  const row = /^(.+?)\s+(\d+(?:\.\d+)?)\s*(cp|sp|gp|pp)\s+(\d+(?:\.\d+)?)\s*lb\.?(?:\s+(.+))?$/i;
  for (const line of lines) {
    const m = line.match(row);
    if (!m || !looksLikeTitle(m[1])) continue;
    items.push({
      name: m[1].trim(),
      category: 'Gear',
      cost: m[2],
      currency: m[3].toLowerCase(),
      weight: m[4],
      description: m[5] || '',
      damage: '',
      damageType: '',
      properties: ''
    });
  }
  return uniqueByName(items);
}

function parseBackgroundsFromText(text) {
  const lines = normalizeTextLines(text);
  const backgrounds = [];
  for (let i = 0; i < lines.length; i++) {
    const name = backgroundStartName(lines, i);
    if (!name) continue;
    const end = findElementEnd(lines, i + 1);
    const block = lines.slice(i + 1, end);
    const parsed = parseBackgroundBlock(name, block);
    if (parsed.features.length || parsed.skillProficiencies.length || parsed.abilityScores.length || parsed.feat) backgrounds.push(parsed);
    i = Math.max(i, end - 1);
  }
  return uniqueByName(backgrounds);
}

function parseRacesFromText(text) {
  const lines = normalizeTextLines(text);
  const races = [];
  for (let i = 0; i < lines.length; i++) {
    const name = raceStartName(lines, i);
    if (!name) continue;
    const end = findElementEnd(lines, i + 1);
    const block = lines.slice(i + 1, end);
    const parsed = parseRaceBlock(name, block);
    if (parsed.traits.length || parsed.speed || parsed.size) races.push(parsed);
    i = Math.max(i, end - 1);
  }
  return uniqueByName(races);
}

function parseArchetypesFromText(text) {
  const lines = normalizeTextLines(text);
  const archetypes = [];
  let subclassSectionClass = '';
  for (let i = 0; i < lines.length; i++) {
    const sectionClass = subclassSectionHeadingClass(lines[i]);
    if (sectionClass) {
      subclassSectionClass = sectionClass;
      continue;
    }
    if (/^Chapter\s+\d+|^(Backgrounds|Species|Magic Items|Monsters|Appendix)\b/i.test(lines[i])) {
      subclassSectionClass = '';
    }
    const start = archetypeStartInfo(lines, i, subclassSectionClass);
    if (!start) continue;
    const end = findArchetypeEnd(lines, i + 1, subclassSectionClass);
    const block = lines.slice(i + 1, end);
    const parentClass = start.class || inferClassFromBlock(block);
    const features = normalizeArchetypeFeatures(start.name, parseLeveledFeatureBlocks(block, parentClass ? `${parentClass} feature` : 'feature'));
    const firstFeature = block.findIndex((line, idx) => !!featureStartInfo(block, idx, parentClass ? `${parentClass} feature` : 'feature'));
    const description = block
      .slice(0, firstFeature === -1 ? block.length : firstFeature)
      .filter(line => !isArchetypeMetaLine(line) && !isFeatureMarkerLine(line))
      .slice(0, 3)
      .join(' ');
    archetypes.push({
      name: start.name,
      class: parentClass || '',
      supports: archetypeSupport(parentClass || ''),
      description,
      features
    });
    i = Math.max(i, end - 1);
  }
  return uniqueByName(archetypes);
}

function normalizeArchetypeFeatures(archetypeName, features) {
  if (/^Armorer$/i.test(archetypeName || '')) {
    return (features || []).filter(feature => !/^(Dreadnaught|Guardian|Infiltrator)$/i.test(feature.name || ''));
  }
  return features || [];
}

function parseClassesFromText(text) {
  const lines = normalizeTextLines(text);
  const classes = [];
  for (let i = 0; i < lines.length; i++) {
    const name = classStartName(lines, i);
    if (!name) continue;
    const end = findElementEnd(lines, i + 1);
    const block = lines.slice(i + 1, end);
    const parsed = parseClassBlock(name, block);
    if (parsed.hitDie || parsed.features.length) classes.push(parsed);
    i = Math.max(i, end - 1);
  }
  return uniqueByName(classes);
}

function parseBackgroundBlock(name, block) {
  const background = {
    name: normalizeExtractedName(name),
    description: '',
    abilityScores: [],
    feat: '',
    skillProficiencies: [],
    toolProficiencies: [],
    languages: [],
    languageChoices: 0,
    equipment: '',
    features: []
  };
  let firstField = block.length;
  const metadataEnd = findNextIndex(block, 0, line => /^(?:Background\s+)?Feature:/i.test(line));
  const metadataBlock = block.slice(0, metadataEnd);
  for (let i = 0; i < metadataBlock.length; i++) {
    const line = metadataBlock[i];
    if (isAbilityScoreFieldLine(line)) {
      background.abilityScores = parseAbilitiesFromText(line);
      firstField = Math.min(firstField, i);
    } else if (isFeatFieldLine(line)) {
      background.feat = normalizeBackgroundFeatName(stripLeadingFieldLabel(line, /^(Feat|Fea?t|t)/i));
      firstField = Math.min(firstField, i);
    } else if (/^Skill\s+Pro/i.test(line)) {
      background.skillProficiencies = parseSkillsFromText(line);
      firstField = Math.min(firstField, i);
    } else if (/^Tool\s+Pro/i.test(line)) {
      background.toolProficiencies = splitListValue(stripLeadingFieldLabel(line, /^Tool\s+Pro(?:ficienc(?:y|ies)|ficiency|ficienci|fi)?/i));
      firstField = Math.min(firstField, i);
    } else if (/^Languages:/i.test(line)) {
      const languageInfo = parseLanguageInfo(afterColon(line));
      background.languages = languageInfo.languages;
      background.languageChoices = languageInfo.choices;
      firstField = Math.min(firstField, i);
    } else if (/^(Equipment|Starting Equipment):/i.test(line)) {
      background.equipment = afterColon(line);
      firstField = Math.min(firstField, i);
    }
  }
  const proseLines = block.filter(line => !isBackgroundMetaLine(line) && !isLayoutNoiseLine(line) && !/^ARTIST:/i.test(line));
  background.description = proseLines.join(' ');
  for (let i = 0; i < block.length; i++) {
    const feature = block[i].match(/^(?:Background\s+)?Feature:\s*(.+)$/i);
    if (!feature) continue;
    const next = findNextIndex(block, i + 1, line => /^(?:Background\s+)?Feature:/i.test(line));
    const name = normalizeBackgroundFeatureName(feature[1]);
    background.features.push({
      name,
      description: block.slice(i + 1, next).filter(line => !isBackgroundMetaLine(line)).join('\n').trim()
    });
    i = next - 1;
  }
  if (!background.features.length) {
    // 2024-style backgrounds often grant ability scores and feats instead of
    // named background feature blocks, so avoid inventing features from prose.
  }
  return background;
}

function normalizeBackgroundFeatureName(value) {
  let text = String(value || '').trim();
  const loudHeading = text.match(/^([A-Z][A-Z' -]{2,}?)(?:\s+(?=[a-z])|[.?!]\s+)/);
  if (loudHeading) text = loudHeading[1];
  return normalizeExtractedName(text)
    .replace(/\bCantrip\b.*$/i, '')
    .replace(/\b\d+(?:st|nd|rd|th)\b.*$/i, '')
    .trim();
}

function parseRaceBlock(name, block) {
  const race = {
    name: normalizeExtractedName(name).replace(/\s+Traits$/i, ''),
    description: '',
    size: '',
    speed: 0,
    abilityScores: {},
    languages: [],
    languageChoices: 0,
    traits: [],
    subraces: []
  };
  let firstField = block.length;
  for (let i = 0; i < block.length; i++) {
    const line = block[i];
    if (/\bSize:/i.test(line)) {
      race.size = parseSize(line);
      race.sizeOptions = parseSizeOptions(line);
      firstField = Math.min(firstField, i);
    }
    if (/\bSpeed:/i.test(line)) {
      race.speed = parseSpeed(line);
      firstField = Math.min(firstField, i);
    }
    if (/^Languages:/i.test(line)) {
      const languageInfo = parseLanguageInfo(afterColon(line));
      race.languages = languageInfo.languages;
      race.languageChoices = languageInfo.choices;
      firstField = Math.min(firstField, i);
    }
  }
  race.abilityScores = parseAbilityScoresFromText(block.join(' '));
  race.description = block
    .slice(0, firstField)
    .filter(line => !isRaceMetaLine(line) && !isGenericRaceHeading(line) && !isLayoutNoiseLine(line) && !/^ARTIST:/i.test(line))
    .join(' ');
  const traitBlocks = parseInlineTraitBlocks(block);
  if (!traitBlocks.length) {
    traitBlocks.push(...parseNamedBlocks(block, line => looksLikeTitle(line) && !isRaceMetaLine(line) && !isGenericRaceHeading(line)));
  }
  race.traits = traitBlocks
    .map(t => ({ name: t.name, description: t.lines.filter(line => !isRaceMetaLine(line)).join('\n').trim() }))
    .filter(t => t.description);
  if (!race.traits.length) {
    const fallback = block.filter(line => !isRaceMetaLine(line)).slice(firstField).join('\n').trim();
    if (fallback) race.traits.push({ name: `${name} Traits`, description: fallback });
  }
  return race;
}

function parseOptionalTableNumber(value) {
  const match = String(value || '').match(/\d+/);
  return match ? parseInt(match[0], 10) : null;
}

function parseCoreClassTraitRows(lines) {
  const traits = {};
  for (const line of lines) {
    const cells = markdownTableCells(line);
    if (cells.length < 2 || isMarkdownTableSeparator(cells)) continue;
    const label = cleanExtractedTitle(cells[0]).toLowerCase();
    if (/^(trait|details)$/.test(label)) continue;
    if (/^(primary ability|hit point die|hit dice|saving throw proficiencies|saving throws|skill proficiencies|skills|weapon proficiencies|weapons|tool proficiencies|tools|armor training|armor|starting equipment|equipment)$/.test(label)) {
      traits[label] = cells.slice(1).join(' | ').trim();
    }
  }
  return traits;
}

function classTableHeaderKey(value) {
  const clean = cleanExtractedTitle(value).toLowerCase();
  if (/^level$/.test(clean)) return 'level';
  if (/^features?$/.test(clean)) return 'features';
  if (/^plans/.test(clean)) return 'plansKnown';
  if (/^magic items?$/.test(clean)) return 'magicItems';
  if (/^cantrips?$/.test(clean)) return 'cantrips';
  if (/^prepared/.test(clean)) return 'prepared';
  if (/^1st$/.test(clean)) return 'slots1';
  if (/^2nd$/.test(clean)) return 'slots2';
  if (/^3rd$/.test(clean)) return 'slots3';
  if (/^4th$/.test(clean)) return 'slots4';
  if (/^5th$/.test(clean)) return 'slots5';
  return '';
}

function parseClassProgressionRows(lines) {
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const headerCells = markdownTableCells(lines[i]);
    const keys = headerCells.map(classTableHeaderKey);
    if (!keys.includes('level') || !keys.includes('features')) continue;
    let j = i + 1;
    if (isMarkdownTableSeparator(markdownTableCells(lines[j] || ''))) j++;
    for (; j < lines.length; j++) {
      const cells = markdownTableCells(lines[j]);
      if (cells.length < headerCells.length || isMarkdownTableSeparator(cells)) break;
      const row = {
        level: 0,
        features: [],
        plansKnown: null,
        magicItems: null,
        cantrips: null,
        prepared: null,
        slots: []
      };
      keys.forEach((key, index) => {
        const value = cells[index] || '';
        if (!key) return;
        if (key === 'level') row.level = parseOptionalTableNumber(value) || 0;
        else if (key === 'features') {
          row.features = splitListValue(value)
            .map(feature => normalizeExtractedName(feature))
            .filter(feature => feature && /[A-Za-z0-9]/.test(feature));
        } else if (/^slots/.test(key)) {
          const slotLevel = parseInt(key.replace('slots', ''), 10);
          row.slots[slotLevel] = parseOptionalTableNumber(value);
        } else {
          row[key] = parseOptionalTableNumber(value);
        }
      });
      if (row.level) rows.push(row);
    }
    i = Math.max(i, j - 1);
  }
  return rows;
}

function applyCoreClassTraits(cls, traits) {
  const hitDieText = traits['hit point die'] || traits['hit dice'];
  if (hitDieText && !cls.hitDie) cls.hitDie = parseHitDie(hitDieText);
  const saveText = traits['saving throw proficiencies'] || traits['saving throws'];
  if (saveText && !cls.savingThrows.length) cls.savingThrows = parseAbilitiesFromText(saveText);
  const skillText = traits['skill proficiencies'] || traits.skills;
  if (skillText && !cls.skillChoices.count) cls.skillChoices = parseSkillChoice(skillText);
  const weaponText = traits['weapon proficiencies'] || traits.weapons;
  if (weaponText && !cls.weaponProficiencies.length) cls.weaponProficiencies = splitListValue(weaponText);
  const toolText = traits['tool proficiencies'] || traits.tools;
  if (toolText && !cls.toolProficiencies.length) cls.toolProficiencies = splitListValue(toolText);
  const armorText = traits['armor training'] || traits.armor;
  if (armorText && !cls.armorProficiencies.length) cls.armorProficiencies = splitListValue(armorText);
  const equipmentText = traits['starting equipment'] || traits.equipment;
  if (equipmentText && !cls.startingEquipment) cls.startingEquipment = equipmentText.replace(/^Choose A or B:\s*/i, 'Choose A or B: ');
}

function parseClassBlock(name, block) {
  const cls = {
    name,
    description: '',
    hitDie: 0,
    savingThrows: [],
    armorProficiencies: [],
    weaponProficiencies: [],
    toolProficiencies: [],
    skillChoices: { count: 0, from: [] },
    startingEquipment: '',
    archetypeLevel: 0,
    archetypeLabel: archetypeSupport(name),
    archetypeSupports: archetypeSupport(name),
    spellcastingAbility: '',
    spellcastingList: '',
    spellcastingPrepare: '',
    ritualCasting: false,
    progression: [],
    features: []
  };
  applyCoreClassTraits(cls, parseCoreClassTraitRows(block));
  cls.progression = parseClassProgressionRows(block);
  let firstField = block.length;
  for (let i = 0; i < block.length; i++) {
    const line = block[i];
    if (/^Hit Dice?:/i.test(line) || /^Hit Point Die\b/i.test(line) || /^Hit Points/i.test(line)) {
      cls.hitDie = parseHitDie(line);
      firstField = Math.min(firstField, i);
    } else if (/^Saving Throw(?:s| Proficiencies)?/i.test(line)) {
      cls.savingThrows = parseAbilitiesFromText(stripLeadingFieldLabel(line, /^Saving Throw(?:s| Proficiencies)?/i));
      firstField = Math.min(firstField, i);
    } else if (/^Armor\b/i.test(line)) {
      cls.armorProficiencies = splitListValue(stripLeadingFieldLabel(line, /^Armor(?:\s+Tr\s*ing|\s+Training)?/i));
      firstField = Math.min(firstField, i);
    } else if (/^Weapon(?:s| Proficiencies)?/i.test(line)) {
      cls.weaponProficiencies = splitListValue(stripLeadingFieldLabel(line, /^Weapon(?:s| Proficiencies)?/i));
      firstField = Math.min(firstField, i);
    } else if (/^Tool(?:\s+Proficienc(?:y|ies)|s?\s*:)/i.test(line)) {
      cls.toolProficiencies = splitListValue(stripLeadingFieldLabel(line, /^Tool(?:\s+Proficienc(?:y|ies)|s?\s*:)/i));
      firstField = Math.min(firstField, i);
    } else if (/^Skill(?:s| Proficiencies)?/i.test(line)) {
      cls.skillChoices = parseSkillChoice(line);
      firstField = Math.min(firstField, i);
    } else if (/^(Equipment|Starting Equipment)\b:?/i.test(line)) {
      cls.startingEquipment = stripLeadingFieldLabel(line, /^(Equipment|Starting Equipment)/i);
      firstField = Math.min(firstField, i);
    } else if (/^Spellcasting Ability:/i.test(line)) {
      cls.spellcastingAbility = titleCase(afterColon(line));
      firstField = Math.min(firstField, i);
    }
  }
  const blockText = block.join(' ');
  const spellcasting = blockText.match(/\b(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\b\s+is your spellcasting ability\b/i);
  if (spellcasting && !cls.spellcastingAbility) cls.spellcastingAbility = titleCase(spellcasting[1]);
  const hasSpellcastingHeading = block.some(line => /^Spellcasting$/i.test(line) || /^Spellcasting Ability:/i.test(line));
  if (cls.spellcastingAbility || hasSpellcastingHeading) cls.spellcastingList = name;
  if (/\b(prepare|preparing)\b.{0,80}\bspells?\b/i.test(blockText)) cls.spellcastingPrepare = true;
  else if (/\bspells?\s+known\b|\byou know\b.{0,40}\bspells?\b/i.test(blockText)) cls.spellcastingPrepare = false;
  cls.ritualCasting = /\britual casting\b/i.test(blockText);

  const archetype = blockText.match(/(?:choose|gain|select).{0,100}?(?:subclass|archetype|path|college|domain|circle|oath|patron|tradition).{0,60}?(?:at|when you reach)\s+(\d+)(?:st|nd|rd|th)\s+level/i)
    || blockText.match(/(?:at|when you reach)\s+(\d+)(?:st|nd|rd|th)\s+level.{0,100}?(?:choose|gain|select).{0,100}?(?:subclass|archetype|path|college|domain|circle|oath|patron|tradition)/i);
  if (archetype) cls.archetypeLevel = parseInt(archetype[1], 10);
  cls.description = block.slice(0, firstField).filter(line => !isClassMetaLine(line)).join(' ');
  cls.features = parseLeveledFeatureBlocks(block, `${name} feature`);
  const archetypeFeature = cls.features.find(f => /\b(subclass|archetype|path|college|domain|circle|oath|patron|tradition)\b/i.test(f.name || ''))
    || cls.features.find(f => /\b(subclass|archetype|path|college|domain|circle|oath|patron|tradition)\b/i.test(`${f.name} ${f.description}`));
  if (archetypeFeature) cls.archetypeLevel = parseInt(archetypeFeature.level, 10) || cls.archetypeLevel;
  cls.features = cls.features.filter(feature => !isPlaceholderClassFeature(feature));
  return cls;
}

function backgroundStartName(lines, i) {
  if (isKnownFieldLine(lines[i])) return '';
  if (/^ARTIST:/i.test(lines[i]) || isVisualNoiseTitle(lines[i])) return '';
  if (isProseFragmentTitle(lines[i])) return '';
  if (/^Can\s*t?\s*rip\b|^Cantrip\b/i.test(cleanExtractedTitle(lines[i]))) return '';
  if (/^species descriptions\b/i.test(cleanExtractedTitle(lines[i])) || isGenericRaceHeading(lines[i])) return '';
  if (/^backgrounds\b/i.test(cleanExtractedTitle(lines[i]))) return '';
  const prefixed = lines[i].match(/^Background:\s*(.+)$/i);
  if (prefixed) {
    if (isTableOfContentsLine(lines[i])) return '';
    return normalizeExtractedName(prefixed[1]);
  }
  const window = lines.slice(i + 1, i + 14).join('\n');
  const hasBackgroundFields = /^Skill\s+Pro/im.test(window)
    || (/(?:^|\n)(?:Ability Scores?|Abili)\b/im.test(window) && /(?:^|\n)(?:Equipment|Choose\s*A\s+or\s+B)\b/im.test(window));
  if (looksLikeTitle(lines[i]) && hasBackgroundFields) return normalizeExtractedName(lines[i]);
  return '';
}

function raceStartName(lines, i) {
  if (isKnownFieldLine(lines[i])) return '';
  if (/^ARTIST:/i.test(lines[i]) || isVisualNoiseTitle(lines[i])) return '';
  if (/^species descriptions\b/i.test(cleanExtractedTitle(lines[i]))) return '';
  const previous = cleanExtractedTitle(lines[i - 1] || '');
  if (looksLikeTitle(previous) && !isProseFragmentTitle(previous) && !isKnownFieldLine(previous) && !isGenericRaceHeading(previous) && !/^species descriptions\b/i.test(previous)) return '';
  if (backgroundStartName(lines, i) || classStartName(lines, i)) return '';
  const prefixed = lines[i].match(/^(?:Race|Species):\s*(.+)$/i);
  if (prefixed) return normalizeExtractedName(prefixed[1]).replace(/\s+Traits$/i, '');
  if (isGenericRaceHeading(lines[i])) return '';
  const next = lines.slice(i + 1, i + 50).join('\n');
  const markers = [/\bSize:/im, /\bSpeed:/im, /^Languages:/im, /\bCreature Type:/im].filter(re => re.test(next)).length;
  if (looksLikeTitle(lines[i]) && !isGenericRaceHeading(lines[i]) && markers >= 2) return normalizeExtractedName(lines[i]).replace(/\s+Traits$/i, '');
  return '';
}

function archetypeStartInfo(lines, i, subclassSectionClass = '') {
  if (isKnownFieldLine(lines[i])) return null;
  if (isLeveledFeatureHeading(lines[i])) return null;
  if (isProseFragmentTitle(lines[i])) return null;
  if (isGenericArchetypeHeading(lines[i])) return null;
  if (backgroundStartName(lines, i) || raceStartName(lines, i) || classStartName(lines, i)) return null;
  const prefixed = lines[i].match(/^(?:Subclass|Archetype):\s*(.+)$/i);
  if (prefixed) return { name: normalizeExtractedName(prefixed[1]), class: inferClassFromBlock(lines.slice(i + 1, i + 6)) };
  const markdownSubclass = lines[i].match(/^(.+?)\s*\(\s*([A-Za-z]+)\s+Subclass\s*\)$/i);
  if (markdownSubclass && looksLikeTitle(markdownSubclass[1])) {
    return { name: normalizeExtractedName(markdownSubclass[1]), class: titleCase(markdownSubclass[2]) };
  }
  const support = lines[i].match(/^(Primal Path|Bard College|Divine Domain|Druid Circle|Martial Archetype|Monastic Tradition|Sacred Oath|Ranger Archetype|Roguish Archetype|Sorcerous Origin|Otherworldly Patron|Arcane Tradition):\s*(.+)$/i);
  if (support) return { name: normalizeExtractedName(support[2]), class: classFromArchetypeSupport(titleCase(support[1])) };
  if (subclassSectionClass && looksLikeSubclassHeading(lines, i)) {
    return { name: normalizeExtractedName(lines[i]), class: subclassSectionClass };
  }
  const next = lines[i + 1] || '';
  const cls = inferClassFromBlock([next]);
  if (looksLikeTitle(lines[i]) && cls && /\b(subclass|archetype)\b/i.test(next)) {
    return { name: normalizeExtractedName(lines[i]), class: cls };
  }
  return null;
}

function subclassSectionHeadingClass(line) {
  const clean = cleanExtractedTitle(line);
  const direct = clean.match(/\b([A-Za-z]+)\s+Subclasses\b/i);
  if (direct) return titleCase(direct[1]);
  const letters = clean.replace(/[^A-Za-z]/g, '');
  const uppercase = (letters.match(/[A-Z]/g) || []).length;
  const lowercase = (letters.match(/[a-z]/g) || []).length;
  if (uppercase <= lowercase * 2) return '';
  return '';
}

function looksLikeSubclassHeading(lines, i) {
  const raw = String(lines[i] || '').trim();
  if (/[.!?]$/.test(raw)) return false;
  const line = cleanExtractedTitle(raw);
  if (!looksLikeTitle(line) || isGenericArchetypeHeading(line)) return false;
  if (/^(artist|art|table|spell|level|features?|chapter|appendix|actions?|reactions?|traits?)\b/i.test(line)) return false;
  if (/[\d,.;:]/.test(line)) return false;
  if (line.split(/\s+/).length > 4) return false;
  if (/^(1d\d+|d\d+|Artificer Level|Spell Level|Medium|Tiny|Small|Large)\b/i.test(cleanExtractedTitle(lines[i + 1] || ''))) return false;
  const previous = cleanExtractedTitle(lines[i - 1] || '');
  if (looksLikeTitle(previous) && !isGenericArchetypeHeading(previous)) return false;
  const introWindow = lines.slice(i + 1, i + 7).join('\n');
  const featureWindow = lines.slice(i + 1, i + 24);
  if (featureWindow.some(isLeveledFeatureHeading)) return true;
  return /ARTIST:|Craft|Expert|Specialist|specialization|expert|modifies|creates|builds/i.test(introWindow)
    && (/\bSUBCLASS\b/i.test(featureWindow.join('\n')) || featureWindow.some(isLeveledFeatureHeading));
}

function isGenericArchetypeHeading(line) {
  return /\bsubclasses?\b/i.test(String(line || ''))
    || /\bspells?\b/i.test(String(line || ''))
    || /^(features?|spells?|spell list|artist|chapter|appendix|traits|table of contents)$/i.test(cleanExtractedTitle(line));
}

function classStartName(lines, i) {
  if (isKnownFieldLine(lines[i])) return '';
  const coreTraits = (lines[i] || '').match(/^Core\s+(.+?)\s+Traits$/i);
  if (coreTraits) return titleCase(coreTraits[1]);
  const prefixed = lines[i].match(/^Class:\s*(.+)$/i);
  if (prefixed) {
    const classWindow = lines.slice(i + 1, i + 4).join('\n');
    return (/^Hit Dice?:/im.test(classWindow) || /^Hit Points/im.test(classWindow)) ? prefixed[1].trim() : '';
  }
  if (/:/.test(lines[i] || '') || /^\d/.test(lines[i] || '')) return '';
  const hitWindow = lines.slice(i + 1, i + 4).join('\n');
  const saveWindow = lines.slice(i + 1, i + 10).join('\n');
  if (looksLikeTitle(lines[i]) && (/^Hit Dice?:/im.test(hitWindow) || /^Hit Points/im.test(hitWindow)) && /^Saving Throws?:/im.test(saveWindow)) return lines[i];
  return '';
}

function findElementEnd(lines, start) {
  let i = start;
  while (i < lines.length && !isElementStart(lines, i) && !isSectionHeading(lines[i])) i++;
  return i;
}

function findArchetypeEnd(lines, start, subclassSectionClass = '') {
  let i = start;
  while (i < lines.length) {
    if (isSectionHeading(lines[i])) break;
    if ((archetypeStartInfo(lines, i, subclassSectionClass) || isElementStart(lines, i)) && !/^Class:/i.test(lines[i])) break;
    i++;
  }
  return i;
}

function findNextIndex(lines, start, predicate) {
  for (let i = start; i < lines.length; i++) {
    if (predicate(lines[i], i)) return i;
  }
  return lines.length;
}

function afterColon(line) {
  return String(line || '').replace(/^[^:]+:\s*/, '').trim();
}

function stripLeadingFieldLabel(line, labelPattern) {
  return String(line || '')
    .replace(labelPattern, '')
    .replace(/^[:.\s]+/, '')
    .trim();
}

function splitListValue(text) {
  return String(text || '')
    .replace(/\s+and\s+/gi, ', ')
    .split(/[,;]|\bor\b/gi)
    .map(s => s.trim().replace(/\.$/, ''))
    .filter(Boolean);
}

function markdownTableCells(line) {
  const text = String(line || '').trim();
  if (!text.includes('|')) return [];
  return text
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(cell => cell.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function isMarkdownTableSeparator(cells) {
  return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell));
}

const SKILL_NAMES = [
  'Acrobatics','Animal Handling','Arcana','Athletics','Deception','History','Insight','Intimidation',
  'Investigation','Medicine','Nature','Perception','Performance','Persuasion','Religion','Sleight of Hand',
  'Stealth','Survival'
];

const ABILITY_NAMES = ['Strength','Dexterity','Constitution','Intelligence','Wisdom','Charisma'];

function parseSkillsFromText(text) {
  const lower = String(text || '').toLowerCase();
  return SKILL_NAMES.filter(skill => lower.includes(skill.toLowerCase()));
}

function parseAbilitiesFromText(text) {
  const lower = String(text || '').toLowerCase();
  return ABILITY_NAMES.filter(ability => lower.includes(ability.toLowerCase()));
}

function parseLanguagesFromText(text) {
  return parseLanguageInfo(text).languages;
}

const KNOWN_LANGUAGE_NAMES = [
  'Common','Dwarvish','Elvish','Giant','Gnomish','Goblin','Halfling','Orc',
  'Abyssal','Celestial','Draconic','Deep Speech','Infernal','Primordial','Sylvan','Undercommon',
  "Thieves' Cant", 'Druidic'
];

const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10
};

function parseLanguageInfo(text) {
  const src = String(text || '').trim();
  if (!src || /^none$/i.test(src)) return { languages: [], choices: 0 };
  const lower = src.toLowerCase();
  const languages = KNOWN_LANGUAGE_NAMES.filter(lang => {
    const escaped = lang.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "['\\u2019]");
    return new RegExp(`\\b${escaped}\\b`, 'i').test(src);
  });
  let choices = 0;
  if (/\b(choice|choose|your choice|any|other language)\b/i.test(src)) {
    const countMatch = lower.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b(?=.{0,40}\b(?:language|languages|of your choice|other)\b)/i);
    choices = countMatch ? parseCountWord(countMatch[1]) : 1;
  }
  if (!languages.length && !choices && !/\bchoice|choose|any\b/i.test(src)) {
    languages.push(...splitListValue(src).filter(v => !/^(and|or)$/i.test(v)));
  }
  return { languages: uniqueStrings(languages), choices };
}

function parseCountWord(value) {
  if (/^\d+$/.test(String(value))) return parseInt(value, 10);
  return NUMBER_WORDS[String(value || '').toLowerCase()] || 0;
}

function parseAbilityScoresFromText(text) {
  const scores = {};
  const abilityMap = {
    strength: 'strength',
    dexterity: 'dexterity',
    constitution: 'constitution',
    intelligence: 'intelligence',
    wisdom: 'wisdom',
    charisma: 'charisma'
  };
  const re = /\b(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\b(?: score)?\s+increases?\s+by\s+(\d+)/gi;
  let match;
  while ((match = re.exec(text)) !== null) {
    scores[abilityMap[match[1].toLowerCase()]] = parseInt(match[2], 10);
  }
  return scores;
}

function parseSize(text) {
  const m = String(text || '').match(/\b(Tiny|Small|Medium|Large|Huge|Gargantuan)\b/i);
  return m ? titleCase(m[1]) : '';
}

function parseSizeOptions(text) {
  const sizes = [];
  for (const match of String(text || '').matchAll(/\b(Tiny|Small|Medium|Large|Huge|Gargantuan)\b/gi)) {
    const size = titleCase(match[1]);
    if (!sizes.includes(size)) sizes.push(size);
  }
  return sizes;
}

function parseSpeed(text) {
  const m = String(text || '').match(/(\d+)\s*(?:feet|ft\.?)/i);
  return m ? parseInt(m[1], 10) : 0;
}

function parseHitDie(text) {
  const m = String(text || '').match(/\bd(\d+)\b|1d(\d+)/i);
  return m ? parseInt(m[1] || m[2], 10) : 0;
}

function parseSkillChoice(line) {
  const count = (line.match(/choose\s+(\d+)/i) || [])[1];
  return {
    count: count ? parseInt(count, 10) : 0,
    from: parseSkillsFromText(line)
  };
}

function parseInlineTraitBlocks(lines) {
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const start = inlineTraitStart(lines[i]);
    if (!start) continue;
    const collected = [start.description];
    let j = i + 1;
    while (j < lines.length && !inlineTraitStart(lines[j]) && !isKnownFieldLine(lines[j]) && !isElementStart(lines, j) && !isSectionHeading(lines[j])) {
      if (!isLayoutNoiseLine(lines[j])) collected.push(lines[j]);
      j++;
    }
    blocks.push({ name: normalizeExtractedName(start.name), lines: collected });
    i = j - 1;
  }
  return blocks;
}

function inlineTraitStart(line) {
  const raw = String(line || '').trim();
  const text = cleanExtractedTitle(line);
  const match = text.match(/^([A-Z][A-Za-z'’ -]{2,45})\.\s+(.+)$/)
    || (/[.!?]\s*$/.test(raw) ? text.match(/^([A-Z][A-Za-z'’ -]{2,45})$/) : null);
  if (!match) return null;
  const name = match[1].trim();
  if (/^ARTIST:/i.test(name) || isVisualNoiseTitle(name) || /^(Action|Actions|Reaction|Reactions|Trait|Traits)$/i.test(name)) return null;
  if (name.split(/\s+/).length > 4) return null;
  if (name.split(/\s+/).some(word => /^[a-z]/.test(word) && !/^(of|the|and|or|in|with|from)$/i.test(word))) return null;
  if (/^(As a|The|This|Whenever|When|While|Once|In addition|Choose|Your|You)\b/i.test(name)) return null;
  if (isRaceMetaLine(name) || isGenericRaceHeading(name)) return null;
  return { name, description: (match[2] || '').trim() };
}

function parseNamedBlocks(lines, isStart) {
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isStart(lines[i], i)) continue;
    const next = findNextIndex(lines, i + 1, (line, idx) => isStart(line, idx) || isClassMetaLine(line) || isRaceMetaLine(line) || isBackgroundMetaLine(line));
    blocks.push({ name: lines[i], lines: lines.slice(i + 1, next) });
    i = next - 1;
  }
  return blocks;
}

function parseLeveledFeatureBlocks(lines, fallbackKind) {
  const features = [];
  for (let i = 0; i < lines.length; i++) {
    const start = featureStartInfo(lines, i, fallbackKind);
    if (!start) continue;
    const next = findNextIndex(lines, start.descriptionStart, (line, idx) => !!featureStartInfo(lines, idx, fallbackKind) || isElementStart(lines, idx));
    const description = lines.slice(start.descriptionStart, next)
      .filter(line => !isClassMetaLine(line) && !isArchetypeMetaLine(line))
      .join('\n')
      .trim();
    if (start.name && description) {
      features.push({ name: start.name, level: start.level, action: inferAction(description), usage: inferUsage(description), description });
    }
    i = Math.max(i, next - 1);
  }
  return uniqueByName(features);
}

function featureStartInfo(lines, i, fallbackKind) {
  const line = lines[i] || '';
  const next = lines[i + 1] || '';
  const leveled = parseLeveledFeatureHeading(line);
  if (leveled) return { name: leveled.name, level: leveled.level, descriptionStart: i + 1 };
  if (looksLikeTitle(line)) {
    const marker = next.match(/^(\d+)(?:st|nd|rd|th)-level\b.*(?:feature|features?)\b/i);
    if (marker) return { name: normalizeExtractedName(line), level: parseInt(marker[1], 10), descriptionStart: i + 2 };
  }
  const direct = line.match(/^(\d+)(?:st|nd|rd|th)(?:-|\s+)level:?\s+(.+)$/i);
  if (direct) return { name: normalizeExtractedName(direct[2].replace(/\bfeatures?\b/i, '').trim()), level: parseInt(direct[1], 10), descriptionStart: i + 1 };
  const ddbNamed = line.match(/^(.+?)\s+\(\s*Level\s+(\d+)\s*\)$/i);
  if (ddbNamed) return { name: normalizeExtractedName(ddbNamed[1]), level: parseInt(ddbNamed[2], 10), descriptionStart: i + 1 };
  const named = line.match(/^(.+?)\s+\((\d+)(?:st|nd|rd|th)(?:-|\s+)level(?:\s+.+?)?\)$/i);
  if (named) return { name: normalizeExtractedName(named[1]), level: parseInt(named[2], 10), descriptionStart: i + 1 };
  if (looksLikeTitle(line) && /\bfeature\b/i.test(fallbackKind || '') && /^\d+(?:st|nd|rd|th)-level\b/i.test(next)) {
    const level = parseInt(next.match(/^(\d+)/)[1], 10);
    return { name: normalizeExtractedName(line), level, descriptionStart: i + 2 };
  }
  return null;
}

function isFeatureMarkerLine(line) {
  return isLeveledFeatureHeading(line)
    || /^(\d+)(?:st|nd|rd|th)-level\b.*(?:feature|features?)\b/i.test(line)
    || /^(\d+)(?:st|nd|rd|th)(?:-|\s+)level:/i.test(line);
}

function parseLeveledFeatureHeading(line) {
  const text = String(line || '').trim();
  const match = text.match(/^Leve\w*\.?\s*(\d+)\s*[:;.]\s*(.+)$/i)
    || text.match(/^Level\s*(\d+)\s*[:;.]\s*(.+)$/i);
  const ddbNamed = text.match(/^(.+?)\s+\(\s*Level\s+(\d+)\s*\)$/i);
  if (ddbNamed) {
    const name = normalizeExtractedName(ddbNamed[1]);
    if (!name || isGenericFeatureHeading(name)) return null;
    return { level: parseInt(ddbNamed[2], 10), name };
  }
  if (!match) return null;
  const name = normalizeExtractedName(match[2]);
  if (!name || isGenericFeatureHeading(name)) return null;
  return { level: parseInt(match[1], 10), name };
}

function isLeveledFeatureHeading(line) {
  return !!parseLeveledFeatureHeading(line);
}

function cleanExtractedTitle(text) {
  return normalizeEncodingArtifacts(text)
    .replace(/^['"`]+/, '')
    .replace(/\s+/g, ' ')
    .replace(/[.!?]+$/i, '')
    .trim();
}

function normalizeExtractedName(text) {
  let value = cleanExtractedTitle(text);
  const corrections = [
    [/^Bare Smit$/i, 'Battle Smith'],
    [/^CarTOoGRAPHER$/i, 'Cartographer'],
    [/^WarrorGeo$/i, 'Warforged'],
    [/^Warrorceo$/i, 'Warforged'],
    [/^Kuoravar$/i, 'Khoravar'],
    [/^Homuncutus Servant$/i, 'Homunculus Servant'],
    [/^House Acent$/i, 'House Agent'],
    [/^House Denerti Heir$/i, 'House Deneith Heir'],
    [/^House Kunoarak Heir$/i, 'House Kundarak Heir'],
    [/^House Lyranbar Heir$/i, 'House Lyrandar Heir'],
    [/^Aperrant Heir$/i, 'Aberrant Heir'],
    [/^House Vaoauis Hei$/i, 'House Vadalis Heir'],
    [/^INauisiTivE$/i, 'Inquisitive'],
    [/^ApTILLeRIsT$/i, 'Artillerist'],
    [/^Antillerist$/i, 'Artillerist'],
    [/\bGrearer\b/gi, 'Greater'],
    [/\bHosprtauity\b/gi, 'Hospitality'],
    [/\bHospitauiry\b/gi, 'Hospitality'],
    [/\bWaroing\b/gi, 'Warding'],
    [/\bSiperYs\b/gi, 'Siberys'],
    [/\bSeribing\b/gi, 'Scribing'],
    [/\bMacic\b/gi, 'Magic'],
    [/\bRepuicate\b/gi, 'Replicate'],
    [/\bARmiFiceR\b/gi, 'Artificer'],
    [/\bAsitity\b/gi, 'Ability'],
    [/\bHem\b/gi, 'Item'],
    [/\bFuas\b/gi, 'Flash'],
    [/\bApert\b/gi, 'Adept'],
    [/\bSpeut-Storine\b/gi, 'Spell-Storing'],
    [/\bAovanceo\b/gi, 'Advanced'],
    [/\bArriFice\b/gi, 'Artifice'],
    [/\bEric\b/gi, 'Epic'],
    [/\bSout\b/gi, 'Soul'],
    [/\bToots\b/gi, 'Tools'],
    [/\bReacents\b/gi, 'Reagents'],
    [/\bCuemicaL\b/gi, 'Chemical'],
    [/\bMonet\b/gi, 'Model'],
    [/\bIMproveo\b/gi, 'Improved'],
    [/\bExprirct Canon\b/gi, 'Eldritch Cannon'],
    [/\bExptosive\b/gi, 'Explosive'],
    [/\bForririen\b/gi, 'Fortified'],
    [/\bBaTtie\b/gi, 'Battle'],
    [/\bBartue\b/gi, 'Battle'],
    [/\bReapy\b/gi, 'Ready'],
    [/\bBATTue\b/gi, 'Battle'],
    [/\bEtpritch\b/gi, 'Eldritch'],
    [/\bSteet\b/gi, 'Steel'],
    [/\bDereNoeR\b/gi, 'Defender'],
    [/\bJott\b/gi, 'Jolt'],
    [/\bMappine\b/gi, 'Mapping'],
    [/\bGuioeo\b/gi, 'Guided'],
    [/\bINceNious\b/gi, 'Ingenious']
  ];
  corrections.forEach(([pattern, replacement]) => {
    value = value.replace(pattern, replacement);
  });
  return titleCase(value);
}

function isGenericFeatureHeading(text) {
  return /^(features?|spells?|spell list|table)$/i.test(String(text || '').trim());
}

function inferAction(text) {
  const m = String(text || '').match(/\b(?:as|use|take)\s+(?:a|an|your)\s+(action|bonus action|reaction)\b/i);
  return m ? titleCase(m[1]) : '';
}

function inferUsage(text) {
  if (/short or long rest/i.test(text)) return '1/Short Rest';
  if (/long rest/i.test(text)) return '1/Long Rest';
  const m = String(text || '').match(/(\d+)\s+times?(?: per| each)?\s+(short rest|long rest|day)/i);
  if (!m) return '';
  const unit = /short/i.test(m[2]) ? 'Short Rest' : /long/i.test(m[2]) ? 'Long Rest' : 'Day';
  return `${m[1]}/${unit}`;
}

function isBackgroundMetaLine(line) {
  return isAbilityScoreFieldLine(line)
    || isFeatFieldLine(line)
    || /^(Skill\s+Pro|Tool\s+Pro|Languages|Equipment|Starting Equipment)\b/i.test(String(line || '').trim())
    || /^Choose\s*A\s+or\s+B\b/i.test(String(line || '').trim());
}

function isAbilityScoreFieldLine(line) {
  return /^(Ability Scores?|Abili)\b/i.test(String(line || '').trim());
}

function isFeatFieldLine(line) {
  return /^(Feat|Fea?t|t)\s*:/i.test(String(line || '').trim());
}

function isRaceMetaLine(line) {
  return /^(Ability Score Increase|Age|Alignment|Size|Speed|Languages|Creature Type):/i.test(line);
}

function isClassMetaLine(line) {
  return /^(?:Primary Ability\b|Hit Dice?\b|Hit Point Die\b|Hit Points\b|Proficiencies\b|Armor\b|Weapons?\b|Tools?\s*:|Tool Proficienc(?:y|ies)\s*:|Saving Throw(?:s| Proficiencies)?\b|Skill(?:s| Proficiencies)?\b|Equipment\b|Starting Equipment\b|Spellcasting Ability\b)/i.test(line);
}

function isArchetypeMetaLine(line) {
  return /^(Class|Subclass|Archetype):/i.test(line) || isFeatureMarkerLine(line);
}

function isKnownFieldLine(line) {
  return isBackgroundMetaLine(line) || isRaceMetaLine(line) || isClassMetaLine(line) || /^(Feature|Background Feature):/i.test(line);
}

function isGenericRaceHeading(line) {
  return /^(Racial Traits|Species Traits|Traits)$/i.test(cleanExtractedTitle(line))
    || /\b(?:Traits|Trains)$/i.test(cleanExtractedTitle(line));
}

function isLayoutNoiseLine(line) {
  const text = String(line || '').trim();
  if (!text) return true;
  if (/^https?:\/\//i.test(text)) return true;
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4},/.test(text)) return true;
  const letters = (text.match(/[A-Za-z]/g) || []).length;
  return letters < 3 && text.length < 30;
}

function isVisualNoiseTitle(line) {
  const text = cleanExtractedTitle(line);
  if (!text) return true;
  if (/^(Vat|Fan Mq)$/i.test(text)) return true;
  const words = text.split(/\s+/);
  if (words.length === 1 && text.length <= 3 && !/^(Elf|Orc)$/i.test(text)) return true;
  return false;
}

function normalizeBackgroundFeatName(text) {
  return normalizeExtractedName(String(text || '')
    .replace(/\(.*?\)/g, '')
    .replace(/\bsee\b.*$/i, '')
    .trim());
}

function inferClassFromBlock(lines) {
  const text = lines.join(' ');
  const match = text.match(/\b(Barbarian|Bard|Cleric|Druid|Fighter|Monk|Paladin|Ranger|Rogue|Sorcerer|Warlock|Wizard|Artificer)\b/i);
  return match ? titleCase(match[1]) : '';
}

function classFromArchetypeSupport(support) {
  const map = {
    'Primal Path': 'Barbarian',
    'Bard College': 'Bard',
    'Divine Domain': 'Cleric',
    'Druid Circle': 'Druid',
    'Martial Archetype': 'Fighter',
    'Monastic Tradition': 'Monk',
    'Sacred Oath': 'Paladin',
    'Ranger Archetype': 'Ranger',
    'Roguish Archetype': 'Rogue',
    'Sorcerous Origin': 'Sorcerer',
    'Otherworldly Patron': 'Warlock',
    'Arcane Tradition': 'Wizard'
  };
  return map[support] || '';
}

function looksLikeTitle(line) {
  if (!line || line.length < 3 || line.length > 80) return false;
  if (/[.!?]$/.test(line)) return false;
  if (/^(chapter|part|appendix|table|page|\d+)$/i.test(line)) return false;
  return /^[A-Z0-9][A-Za-z0-9:'(),&\u2019\-\s]+$/.test(line);
}

function isSectionHeading(line) {
  const clean = cleanExtractedTitle(line);
  return /^chapter\b/i.test(clean)
    || /^-{3,}$/.test(clean)
    || /^(appendix|contents|table of contents|spell|spells|feats|magic items|equipment|races|species descriptions|backgrounds|classes|bastions?|bastion facilities|companions?|vehicles?|monsters?)$/i.test(clean)
    || /^(species descriptions|backgrounds)\b/i.test(clean)
    || (/^[A-Za-z\s]+subclasses\b/i.test(clean) && clean.length < 40);
}

function isElementStart(lines, i) {
  const line = lines[i] || '';
  const next = lines[i + 1] || '';
  if (isLeveledFeatureHeading(line)) return false;
  return parseSpellKind(next)
    || !!featStartInfo(lines, i)
    || (looksLikeTitle(line) && /^(.+?),\s*(common|uncommon|rare|very rare|legendary|artifact|varies)(?:\s*\(|$)/i.test(next))
    || backgroundStartName(lines, i)
    || raceStartName(lines, i)
    || archetypeStartInfo(lines, i)
    || classStartName(lines, i);
}

function uniqueByName(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = (item.name || '').trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueStrings(items) {
  const seen = new Set();
  return (items || []).filter(item => {
    const key = String(item || '').trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function titleCase(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\b[a-z]/g, c => c.toUpperCase())
    .replace(/'S\b/g, "'s")
    .replace(/\b(Of|The|And|Or|A|An|In|On|To|With|For)\b/g, (word, _match, offset) => offset === 0 ? word : word.toLowerCase());
}

function parseCharges(text) {
  const m = String(text || '').match(/\b(\d+)\s+charges?\b/i);
  return m ? parseInt(m[1], 10) : 0;
}

function parseRecharge(text) {
  const m = String(text || '').match(/regains?[^.]+(?:dawn|dusk|sunrise|sunset|daily|long rest)[^.]*\./i);
  return m ? m[0] : '';
}

// ---------------------------------------------
// Extraction
// ---------------------------------------------
function ensureExtractedDataBuckets() {
  if (!extractedData || typeof extractedData !== 'object') extractedData = {};
  ELEMENT_TYPES.forEach(type => {
    if (!Array.isArray(extractedData[type])) extractedData[type] = [];
  });
  return extractedData;
}

function cloneData(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function normalizeForCompare(value) {
  if (Array.isArray(value)) return value.map(normalizeForCompare);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value)
    .filter(key => !key.startsWith('_'))
    .sort()
    .reduce((out, key) => {
      out[key] = normalizeForCompare(value[key]);
      return out;
    }, {});
}

function sameGeneratedShape(a, b) {
  return JSON.stringify(normalizeForCompare(a)) === JSON.stringify(normalizeForCompare(b));
}

function loadRememberedOverrides() {
  try {
    return JSON.parse(localStorage.getItem(OVERRIDE_STORAGE_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function saveRememberedOverrides() {
  try {
    localStorage.setItem(OVERRIDE_STORAGE_KEY, JSON.stringify(rememberedOverrides));
  } catch (err) {
    console.warn('Could not save remembered overrides:', err.message);
  }
}

function overrideKeyForItem(type, item, meta = getSourceMeta()) {
  return [
    meta.prefix,
    idify(meta.name),
    type,
    idify(item?.name || 'UNNAMED')
  ].join('::');
}

function captureGeneratedBaseline() {
  ensureExtractedDataBuckets();
  generatedBaselineData = cloneData(extractedData) || {};
  ELEMENT_TYPES.forEach(type => {
    if (!Array.isArray(generatedBaselineData[type])) generatedBaselineData[type] = [];
  });
}

function appendGeneratedBaselineItems(type, items) {
  if (!Array.isArray(generatedBaselineData[type])) generatedBaselineData[type] = [];
  generatedBaselineData[type].push(...cloneData(items || []));
}

function overrideKeyForIndex(type, index) {
  const baseline = generatedBaselineData[type]?.[index];
  const current = extractedData[type]?.[index];
  if (!baseline && !current) return '';
  return overrideKeyForItem(type, baseline || current);
}

function applyRememberedOverrideAt(type, index) {
  const key = overrideKeyForIndex(type, index);
  const override = key ? rememberedOverrides[key] : null;
  if (!override?.item || !extractedData[type]?.[index]) return false;
  extractedData[type][index] = cloneData(override.item);
  return true;
}

function applyRememberedOverridesToExtractedData() {
  ensureExtractedDataBuckets();
  let applied = 0;
  for (const type of ELEMENT_TYPES) {
    const items = extractedData[type] || [];
    for (let i = 0; i < items.length; i++) {
      if (applyRememberedOverrideAt(type, i)) applied++;
    }
  }
  return applied;
}

function isEditedFromGenerated(type, index) {
  const baseline = generatedBaselineData[type]?.[index];
  const current = extractedData[type]?.[index];
  if (!baseline || !current) return false;
  return !sameGeneratedShape(current, baseline);
}

function hasRememberedOverride(type, index) {
  const key = overrideKeyForIndex(type, index);
  return !!(key && rememberedOverrides[key]);
}

function startManualAuthoring() {
  ensureExtractedDataBuckets();
  if (!Object.values(generatedBaselineData).some(items => Array.isArray(items) && items.length)) {
    captureGeneratedBaseline();
  }
  skippedItems = [];
  document.getElementById('stepReview').classList.remove('hidden');
  document.getElementById('extractProgress').classList.add('hidden');
  document.getElementById('extractErrors').classList.add('hidden');
  document.getElementById('reviewArea').classList.remove('hidden');
  buildReviewUI();
  setManualAuthorStatus('Manual authoring ready.', 'info');
}

async function startExtraction() {
  const types = getSelectedTypes();
  if (!types.length || !pdfFile) return;

  document.getElementById('stepReview').classList.remove('hidden');
  document.getElementById('extractProgress').classList.remove('hidden');
  document.getElementById('reviewArea').classList.add('hidden');
  document.getElementById('extractBtn').disabled = true;
  document.getElementById('extractSpinner').classList.remove('hidden');

  extractedData = {};
  discoveredPageRanges = {};
  skippedItems = [];
  const errors = [];
  document.getElementById('extractErrors').classList.add('hidden');
  document.getElementById('extractErrors').innerHTML = '';
  document.getElementById('progressBar').style.width = '0%';

  try {
    extractedData = await deterministicExtract(pdfFile, types, (pct, msg) => setProgress(pct, msg));
  } catch (err) {
    extractedData = {};
    errors.push(err.message);
    console.error('Deterministic extraction failed:', err);
  }
  ensureExtractedDataBuckets();

  skippedItems = filterIncomplete();
  captureGeneratedBaseline();
  const appliedOverrides = applyRememberedOverridesToExtractedData();

  setProgress(100, 'Parsing complete.');
  document.getElementById('extractSpinner').classList.add('hidden');
  document.getElementById('extractBtn').disabled = false;

  const deterministicBannerParts = [];
  if (errors.length) deterministicBannerParts.push(...errors.map(e => '- ' + escHtml(String(e))));
  if (skippedItems.length) {
    deterministicBannerParts.push(`- ${skippedItems.length} element(s) skipped - below 80% complete (see skipped-elements.txt in ZIP)`);
  }
  const unsupportedTypes = types.filter(t => !DETERMINISTIC_PARSERS[t]);
  if (unsupportedTypes.length) {
    deterministicBannerParts.push(`- Rule parsers are not implemented yet for: ${unsupportedTypes.map(t => TYPE_LABELS[t] || t).join(', ')}`);
  }
  if (appliedOverrides) {
    deterministicBannerParts.push(`- Applied ${appliedOverrides} remembered correction${appliedOverrides === 1 ? '' : 's'}.`);
  }
  if (deterministicBannerParts.length) {
    const errEl = document.getElementById('extractErrors');
    errEl.className = errors.length ? 'alert alert-warning' : 'alert alert-info';
    errEl.innerHTML = '<strong>Notes:</strong><br>' + deterministicBannerParts.join('<br>');
    errEl.classList.remove('hidden');
  }

  setTimeout(() => {
    document.getElementById('extractProgress').classList.add('hidden');
    buildReviewUI();
    document.getElementById('reviewArea').classList.remove('hidden');
    markChanged();
  }, 400);
  return;

  // Split large PDFs into manageable chunks using pdf-lib, inline base64 for all
  const manualRange = document.getElementById('pageRange')?.value?.trim() || '';
  const fileSizeMB = pdfFile.size / 1024 / 1024;
  let pdfChunks = null;   // array of {bytes, startPage, endPage, totalPages} or null for small files
  let smallBase64 = null; // for files that fit in one chunk

  if (fileSizeMB > INLINE_LIMIT_MB) {
    try {
      pdfChunks = await splitPdfIntoChunks(pdfFile, setProgress);
      setProgress(8, `Split into ${pdfChunks.length} chunk(s) of ${PAGES_PER_CHUNK} pages.`);
      await new Promise(r => setTimeout(r, 400));
    } catch(e) {
      // pdf-lib couldn't parse this PDF - fall back to sending it inline as one piece.
      // This may hit token limits on very large files but is better than hard-failing.
      console.warn('PDF splitting failed, falling back to single inline chunk:', e.message);
      setProgress(8, `PDF splitting unavailable (${e.message.slice(0,60)}) - sending as single file.`);
      await new Promise(r => setTimeout(r, 600));
      pdfChunks = null;
      try {
        smallBase64 = await fileToBase64(pdfFile);
      } catch(e2) {
        errors.push(`Could not read PDF: ${e2.message}`);
        setProgress(100, 'Failed to read PDF.');
        document.getElementById('extractSpinner').classList.add('hidden');
        document.getElementById('extractBtn').disabled = false;
        const errEl = document.getElementById('extractErrors');
        errEl.className = 'alert alert-error';
        errEl.innerHTML = '<strong>Error:</strong><br>' + errors.map(e => '- ' + e).join('<br>');
        errEl.classList.remove('hidden');
        return;
      }
    }
  } else {
    smallBase64 = await fileToBase64(pdfFile);
  }

  // Helper: get base64 for a specific chunk (or the whole small file)
  const getChunkBase64 = (chunkIdx) => {
    if (!pdfChunks) return smallBase64;
    return uint8ToBase64(pdfChunks[chunkIdx].bytes);
  };
  const firstChunkBase64 = getChunkBase64(0);

  // TOC pass - use first chunk (always contains cover/TOC) if no manual range and file > 5MB
  if (!manualRange && fileSizeMB > 5) {
    setProgress(9, 'Reading table of contents...');
    discoveredPageRanges = await discoverPageRanges(firstChunkBase64, false, setProgress);
    await detectSourceMeta(firstChunkBase64, false);
    const found = Object.keys(discoveredPageRanges);
    if (found.length > 0) {
      const rangeList = found.map(k => `${TYPE_LABELS[k] || k}: p.${discoveredPageRanges[k]}`).join(', ');
      setProgress(13, `TOC read - found: ${rangeList}`);
      await new Promise(r => setTimeout(r, 800));
    } else {
      setProgress(13, 'No TOC found - will search all chunks');
      await new Promise(r => setTimeout(r, 400));
    }
  }

  // For small PDFs that skipped the TOC pass: detect title + author from cover page
  if (fileSizeMB <= 5) {
    await detectSourceMeta(firstChunkBase64, false);
  }

  const typeCount = types.length;
  for (let ti = 0; ti < typeCount; ti++) {
    const type = types[ti];
    const baseProgress = 10 + (ti / typeCount) * 85;
    try {
      const result = await callModel(pdfChunks, smallBase64, type, (msg, pct) => {
        setProgress(baseProgress + pct * (85 / typeCount), msg);
      });
      extractedData[type] = type === 'feat' ? result.map(parseFeatFullText) : result;
      const failed = result.filter(r => r._error);
      if (failed.length) errors.push(`${TYPE_LABELS[type]}: ${failed.length} item(s) need review`);
    } catch (err) {
      extractedData[type] = [];
      errors.push(`${TYPE_LABELS[type]}: ${err.message}`);
      console.error(`Error extracting ${type}:`, err);
    }
    // Small pause between types to reduce rate limit risk
    if (ti < typeCount - 1) await new Promise(r => setTimeout(r, 1500));
  }

  // Filter incomplete elements and collect skipped report
  skippedItems = filterIncomplete();

  setProgress(100, 'All done!');
  document.getElementById('extractSpinner').classList.add('hidden');
  document.getElementById('extractBtn').disabled = false;

  const bannerParts = [];
  if (errors.length) bannerParts.push(...errors.map(e => '- ' + e));
  if (skippedItems.length) {
    bannerParts.push(`- ${skippedItems.length} element(s) skipped - below 80% complete (see skipped-elements.txt in ZIP)`);
  }
  if (bannerParts.length) {
    const errEl = document.getElementById('extractErrors');
    errEl.className = skippedItems.length && !errors.length ? 'alert alert-info' : 'alert alert-warning';
    errEl.innerHTML = '<strong>Notes:</strong><br>' + bannerParts.join('<br>');
    errEl.classList.remove('hidden');
  }

  setTimeout(() => {
    document.getElementById('extractProgress').classList.add('hidden');
    buildReviewUI();
    document.getElementById('reviewArea').classList.remove('hidden');
    markChanged();
  }, 800);
}


async function geminiRaw(base64, isUri, promptText) {
  if (!LEGACY_AI_EXTRACTION_ENABLED) {
    throw new Error(legacyAiDisabledMessage());
  }
  const body = {
    contents: [{ parts: [
      { inline_data: { mime_type: 'application/pdf', data: base64 } },
      { text: promptText }
    ]}],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 65536,
      response_mime_type: 'application/json'
    }
  };

  // Retry with backoff on rate limit (429) or transient server errors (500/503)
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) {
      const waitSec = [15, 30, 60][attempt - 1];
      setProgress(null, `Rate limit hit - waiting ${waitSec}s before retry ${attempt}/3...`);
      await new Promise(r => setTimeout(r, waitSec * 1000));
    }
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );
    if (resp.ok) {
      const data = await resp.json();
      if (data.promptFeedback?.blockReason) throw new Error(`Blocked: ${data.promptFeedback.blockReason}`);
      if (!data.candidates?.length) throw new Error('No candidates returned - PDF may be too large or response was filtered.');
      const candidate = data.candidates[0];
      const text = candidate?.content?.parts?.[0]?.text || '';
      if (!text) throw new Error('Empty response from Gemini.');
      const truncated = candidate.finishReason === 'MAX_TOKENS';
      return { text, truncated };
    }
    const errBody = await resp.json().catch(() => ({}));
    lastErr = new Error(errBody.error?.message || `HTTP ${resp.status}`);
    if (resp.status !== 429 && resp.status < 500) break; // don't retry client errors
  }
  throw lastErr;
}

function safeParseJson(text) {
  // JSON mode should give us clean JSON, but guard anyway
  text = text.replace(/^```(?:json)?\s*/im, '').replace(/\s*```\s*$/im, '').trim();
  try { return JSON.parse(text); } catch(e) {}
  const aS = text.indexOf('['), aE = text.lastIndexOf(']');
  if (aS !== -1 && aE > aS) { try { return JSON.parse(text.slice(aS, aE+1)); } catch(e) {} }
  const oS = text.indexOf('{'), oE = text.lastIndexOf('}');
  if (oS !== -1 && oE > oS) {
    try {
      const o = JSON.parse(text.slice(oS, oE+1));
      return Array.isArray(o) ? o : (Object.values(o).find(v => Array.isArray(v)) || o);
    } catch(e) {}
  }
  throw new Error('JSON parse failed. Response: ' + text.slice(0, 150).replace(/\n/g,' '));
}

function archetypeSupport(cls) {
  const m = { Barbarian:'Primal Path', Bard:'Bard College', Cleric:'Divine Domain', Druid:'Druid Circle',
    Fighter:'Martial Archetype', Monk:'Monastic Tradition', Paladin:'Sacred Oath', Ranger:'Ranger Archetype',
    Rogue:'Roguish Archetype', Sorcerer:'Sorcerous Origin', Warlock:'Otherworldly Patron', Wizard:'Arcane Tradition',
    Artificer:'Artificer Specialist' };
  return m[cls] || cls;
}

// Extraction with TOC-guided page ranges + automatic alphabetic-split retry on truncation
async function callModel(pdfChunks, smallBase64, type, progressCallback) {
  if (!LEGACY_AI_EXTRACTION_ENABLED) {
    throw new Error(legacyAiDisabledMessage());
  }
  const manualRange = document.getElementById('pageRange')?.value?.trim() || '';
  const tocRange = discoveredPageRanges[type] || '';
  const pageRange = manualRange || tocRange;
  const pageHint = pageRange ? `\nOnly look at pages ${pageRange} of the PDF.` : '';

  // Determine which chunks to process
  // If TOC gave us a page range and we have chunks, filter to relevant chunks only
  let chunksToProcess = pdfChunks ? pdfChunks.map((c, i) => i) : [0];
  if (pdfChunks && pageRange) {
    const [rangeStart, rangeEnd] = pageRange.split('-').map(Number);
    const end = rangeEnd || rangeStart;
    chunksToProcess = pdfChunks
      .map((c, i) => ({ i, c }))
      .filter(({ c }) => c.startPage <= end && c.endPage >= rangeStart)
      .map(({ i }) => i);
    if (chunksToProcess.length === 0) chunksToProcess = [0]; // fallback
  }

  const label = TYPE_LABELS[type] || type;
  const allResults = [];

  for (let ci = 0; ci < chunksToProcess.length; ci++) {
    const chunkIdx = chunksToProcess[ci];
    const base64 = pdfChunks ? uint8ToBase64(pdfChunks[chunkIdx].bytes) : smallBase64;
    const chunkInfo = pdfChunks
      ? ` (pages ${pdfChunks[chunkIdx].startPage}-${pdfChunks[chunkIdx].endPage} of ${pdfChunks[chunkIdx].totalPages})`
      : '';
    const pct = 0.1 + (ci / chunksToProcess.length) * 0.7;

    progressCallback(`Extracting ${label}${chunkInfo}...`, pct);

    const prompt = PROMPTS[type] + pageHint;
    let text, truncated;
    if (useOllama) {
      const chunkBytes = pdfChunks ? pdfChunks[chunkIdx].bytes : null;
      const extracted = chunkBytes
        ? await extractTextFromChunk(chunkBytes)
        : await extractTextFromChunk(Uint8Array.from(atob(base64), c => c.charCodeAt(0)));
      if (!extracted) { text = '[]'; truncated = false; }
      else { ({ text, truncated } = await ollamaRaw(extracted, prompt)); }
    } else {
      ({ text, truncated } = await geminiRaw(base64, false, prompt));
    }

    if (truncated) {
      console.warn(`Chunk ${chunkIdx} truncated for ${type} - splitting alphabetically`);
      progressCallback(`${label} chunk too large - retrying in halves...`, pct + 0.05);
      const halves = [
        prompt + '\nOnly include elements whose name starts with A through M.',
        prompt + '\nOnly include elements whose name starts with N through Z.'
      ];
      for (let hi = 0; hi < halves.length; hi++) {
        let ht;
        if (useOllama) {
          const chunkBytes = pdfChunks ? pdfChunks[chunkIdx].bytes : null;
          const extracted = chunkBytes
            ? await extractTextFromChunk(chunkBytes)
            : await extractTextFromChunk(Uint8Array.from(atob(base64), c => c.charCodeAt(0)));
          ({ text: ht } = extracted ? await ollamaRaw(extracted, halves[hi]) : { text: '[]' });
        } else {
          ({ text: ht } = await geminiRaw(base64, false, halves[hi]));
        }
        try {
          const p = safeParseJson(ht);
          const a = Array.isArray(p) ? p : (Object.values(p).find(v => Array.isArray(v)) || []);
          allResults.push(...a);
        } catch(e) { console.warn(`Half ${hi+1} parse failed:`, e.message); }
        if (hi === 0) await new Promise(r => setTimeout(r, 600));
      }
    } else {
      try {
        const parsed = safeParseJson(text);
        const arr = Array.isArray(parsed) ? parsed : (Object.values(parsed).find(v => Array.isArray(v)) || []);
        allResults.push(...arr);
      } catch(e) {
        console.warn(`Chunk ${chunkIdx} parse failed:`, e.message);
      }
    }

    // Pause between chunks to avoid rate limits
    if (ci < chunksToProcess.length - 1) await new Promise(r => setTimeout(r, 1500));
  }

  progressCallback(`Parsing ${label}...`, 0.9);
  return allResults;
}

function fileToBase64(file) {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = () => res(reader.result.split(',')[1]);
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });
}

function setProgress(pct, msg) {
  if (pct !== null) document.getElementById('progressBar').style.width = pct + '%';
  if (msg) document.getElementById('progressMsg').textContent = msg;
}

// ---------------------------------------------
// Review UI builder
// ---------------------------------------------
function buildReviewUI(preferredType = '') {
  ensureExtractedDataBuckets();
  const total = Object.values(extractedData)
    .filter(Array.isArray)
    .reduce((s, a) => s + a.length, 0);
  const summaryEl = document.getElementById('reviewSummary');
  if (total === 0) {
    summaryEl.className = 'alert alert-warning';
    summaryEl.innerHTML = '<strong>No elements were parsed.</strong> Use Manual Author to add missed sections or paste a smaller section below.';
  } else {
    const breakdown = ELEMENT_TYPES
      .map(type => [type, extractedData[type] || []])
      .filter(([,arr]) => arr.length > 0)
      .map(([type, arr]) => `${arr.length} ${TYPE_LABELS[type]}`)
      .join(', ');
    summaryEl.className = 'alert alert-success';
    summaryEl.textContent = `Current elements: ${breakdown}. Expand each entry to review and edit, then download.`;
  }

  const tabsEl = document.getElementById('reviewTabs');
  const panelsEl = document.getElementById('reviewPanels');
  tabsEl.innerHTML = '';
  panelsEl.innerHTML = '';

  const activeType = extractedData[preferredType]?.length
    ? preferredType
    : ELEMENT_TYPES.find(type => extractedData[type]?.length);
  for (const type of ELEMENT_TYPES) {
    const items = extractedData[type] || [];
    if (!items.length) continue;
    const tabId = `tab-${type}`;
    const panelId = `panel-${type}`;
    const active = type === activeType;

    const tab = document.createElement('button');
    tab.className = 'tab' + (active ? ' active' : '');
    tab.id = tabId;
    tab.innerHTML = `${TYPE_LABELS[type]} <span class="tab-badge">${items.length}</span>`;
    tab.onclick = () => switchTab(type);
    tabsEl.appendChild(tab);

    const panel = document.createElement('div');
    panel.className = 'tab-panel' + (active ? ' active' : '');
    panel.id = panelId;
    const searchBar = `<input type="text" class="panel-search" placeholder="Search ${TYPE_LABELS[type] || type}..." oninput="filterPanel('${type}', this.value)" />`;
    panel.innerHTML = searchBar + buildPanelHTML(type, items);
    panelsEl.appendChild(panel);
  }
}

function switchTab(type) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(`tab-${type}`).classList.add('active');
  document.getElementById(`panel-${type}`).classList.add('active');
}

function buildPanelHTML(type, items) {
  return items.map((item, i) => {
    const header = item.name || `Unnamed ${type} #${i+1}`;
    const badge = type === 'spell' ? `Level ${item.level} ${item.school}` :
                  type === 'archetype' ? item.class :
                  type === 'feat' ? 'Feat' :
                  type === 'magic' ? item.rarity :
                  type === 'race' ? (item.size || 'Race') :
                  type === 'background' ? 'Background' :
                  type === 'class' ? `d${item.hitDie || '?'}` :
                  item.category || 'Item';
    return `
    <div class="element-card" id="card-${type}-${i}">
      <div class="element-card-header" onclick="toggleCard('${type}',${i})">
        <h3>${escHtml(header)}</h3>
        <span class="element-type-badge">${escHtml(badge)}</span>
      </div>
      <div class="element-card-body" id="body-${type}-${i}">
        ${buildOverrideControls(type, i)}
        <div style="display:flex; justify-content:flex-end; margin-bottom:0.75rem;">
          <button class="btn btn-secondary" style="font-size:0.7rem; padding:0.3rem 0.75rem;" onclick="removeElement('${type}-${i}', event)">Remove Element</button>
        </div>
        ${buildFieldsHTML(type, item, i)}
      </div>
    </div>`;
  }).join('');
}

function overrideStatusText(type, index) {
  const edited = isEditedFromGenerated(type, index);
  const remembered = hasRememberedOverride(type, index);
  if (remembered && edited) return 'Remembered correction will apply on future parses.';
  if (remembered) return 'Remembered correction exists for this generated element.';
  if (edited) return 'Edited for this export only. Click Remember Correction to reuse it later.';
  return 'Matches generated parser output. Edits are one-off until remembered.';
}

function buildOverrideControls(type, index) {
  const id = `${type}-${index}`;
  const edited = isEditedFromGenerated(type, index);
  const remembered = hasRememberedOverride(type, index);
  return `
    <div class="override-controls" id="override-controls-${id}">
      <span class="override-status" id="override-status-${id}">${escHtml(overrideStatusText(type, index))}</span>
      <span class="override-actions">
        <button class="btn btn-secondary" id="remember-${id}" style="font-size:0.68rem; padding:0.25rem 0.65rem;" onclick="rememberOverride('${id}', event)" ${edited ? '' : 'disabled'}>Remember Correction</button>
        <button class="btn btn-secondary" id="forget-${id}" style="font-size:0.68rem; padding:0.25rem 0.65rem;" onclick="forgetOverride('${id}', event)" ${remembered ? '' : 'disabled'}>Forget</button>
        <button class="btn btn-secondary" id="revert-${id}" style="font-size:0.68rem; padding:0.25rem 0.65rem;" onclick="revertToGenerated('${id}', event)" ${edited ? '' : 'disabled'}>Revert to Generated</button>
      </span>
    </div>`;
}


function filterPanel(type, query) {
  const q = query.trim().toLowerCase();
  const panel = document.getElementById(`panel-${type}`);
  const cards = panel.querySelectorAll('.element-card');
  let visible = 0;
  cards.forEach(card => {
    const name = (card.querySelector('.element-card-header h3')?.textContent || '').toLowerCase();
    const badge = (card.querySelector('.element-type-badge')?.textContent || '').toLowerCase();
    const matches = !q || name.includes(q) || badge.includes(q);
    card.classList.toggle('card-hidden-by-search', !matches);
    if (matches) visible++;
  });
  let emptyEl = panel.querySelector('.search-empty');
  if (!emptyEl) {
    emptyEl = document.createElement('p');
    emptyEl.className = 'search-empty';
    panel.appendChild(emptyEl);
  }
  emptyEl.style.display = visible === 0 ? 'block' : 'none';
  emptyEl.textContent = visible === 0 ? `No results for "${query}"` : '';
}

function toggleCard(type, i) {
  const body = document.getElementById(`body-${type}-${i}`);
  body.classList.toggle('open');
}

// ---------------------------------------------
// Field builders per type
// ---------------------------------------------
function buildFieldsHTML(type, item, i) {
  const id = `${type}-${i}`;
  if (type === 'spell') return buildSpellFields(item, id);
  if (type === 'archetype') return buildArchetypeFields(item, id);
  if (type === 'item') return buildItemFields(item, id);
  if (type === 'feat') return buildFeatFields(item, id);
  if (type === 'magic') return buildMagicFields(item, id);
  if (type === 'race') return buildRaceFields(item, id);
  if (type === 'background') return buildBackgroundFields(item, id);
  if (type === 'class') return buildClassFields(item, id);
  if (type === 'other') return buildOtherFields(item, id);
  return '';
}

function buildSpellFields(s, id) {
  const schools = ['Abjuration','Conjuration','Divination','Enchantment','Evocation','Illusion','Necromancy','Transmutation'];
  return `
    <div class="field-row">
      <div><label>Name</label><input type="text" value="${escAttr(s.name)}" data-field="name" data-id="${id}" onchange="updateField(this)" /></div>
      <div>
        <label>School</label>
        <select data-field="school" data-id="${id}" onchange="updateField(this)">
          <option value="" ${!s.school?'selected':''}>Select school</option>
          ${schools.map(sc => `<option ${s.school===sc?'selected':''}>${sc}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="field-row-3">
      <div><label>Level (0=cantrip)</label><input type="text" value="${s.level}" data-field="level" data-id="${id}" onchange="updateField(this)" /></div>
      <div><label>Casting Time</label><input type="text" value="${escAttr(s.castingTime)}" data-field="castingTime" data-id="${id}" onchange="updateField(this)" /></div>
      <div><label>Range</label><input type="text" value="${escAttr(s.range)}" data-field="range" data-id="${id}" onchange="updateField(this)" /></div>
    </div>
    <div class="field-row">
      <div><label>Duration</label><input type="text" value="${escAttr(s.duration)}" data-field="duration" data-id="${id}" onchange="updateField(this)" /></div>
      <div><label>Material Component</label><input type="text" value="${escAttr(s.material||'')}" data-field="material" data-id="${id}" onchange="updateField(this)" /></div>
    </div>
    <div class="field-row">
      <div>
        <label>Classes (comma-separated)</label>
        <input type="text" value="${escAttr((s.classes||[]).join(', '))}" data-field="classes" data-id="${id}" onchange="updateFieldArr(this)" />
      </div>
    </div>
    <div style="display:flex; gap:1.5rem; flex-wrap:wrap; margin-bottom:1rem;">
      ${chk('hasVerbal','Verbal',s.hasVerbal,id)}
      ${chk('hasSomatic','Somatic',s.hasSomatic,id)}
      ${chk('hasMaterial','Material',s.hasMaterial,id)}
      ${chk('isConcentration','Concentration',s.isConcentration,id)}
      ${chk('isRitual','Ritual',s.isRitual,id)}
      ${chk('isTechnomagic','Technomagic',s.isTechnomagic,id)}
    </div>
    <div><label>Description</label><textarea rows="4" data-field="description" data-id="${id}" onchange="updateField(this)">${escHtml(s.description||'')}</textarea></div>
    <div><label>At Higher Levels (leave blank if none)</label><textarea rows="2" data-field="higherLevels" data-id="${id}" onchange="updateField(this)">${escHtml(s.higherLevels||'')}</textarea></div>`;
}

function buildArchetypeFields(a, id) {
  const supports = ['Primal Path','Bard College','Divine Domain','Druid Circle','Martial Archetype','Monastic Tradition','Sacred Oath','Ranger Archetype','Roguish Archetype','Sorcerous Origin','Otherworldly Patron','Arcane Tradition'];
  return `
    <div class="field-row">
      <div><label>Name</label><input type="text" value="${escAttr(a.name)}" data-field="name" data-id="${id}" onchange="updateField(this)" /></div>
      <div><label>Class</label><input type="text" value="${escAttr(a.class||'')}" data-field="class" data-id="${id}" onchange="updateField(this)" /></div>
    </div>
    <div>
      <label>Supports (Aurora archetype category)</label>
      <select data-field="supports" data-id="${id}" onchange="updateField(this)">
        <option value="" ${!a.supports?'selected':''}>Select support</option>
        ${supports.map(s => `<option ${a.supports===s?'selected':''}>${s}</option>`).join('')}
      </select>
    </div>
    <div><label>Subclass Description</label><textarea rows="3" data-field="description" data-id="${id}" onchange="updateField(this)">${escHtml(a.description||'')}</textarea></div>
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0.5rem;">
      <span class="section-label" style="margin:0; border:none; padding:0;">Features</span>
      <button class="btn btn-secondary" style="font-size:0.7rem; padding:0.3rem 0.75rem;" onclick="addFeature('${id}')">+ Add Feature</button>
    </div>
    <div id="features-${id}">${(a.features||[]).map((f,fi) => `
      <div style="border:1px solid var(--border-light); border-radius:3px; padding:0.75rem; margin-bottom:0.75rem; background:var(--parchment);">
        <div class="field-row">
          <div><label>Feature Name</label><input type="text" value="${escAttr(f.name)}" data-field="features.${fi}.name" data-id="${id}" onchange="updateNestedField(this)" /></div>
          <div><label>Level</label><input type="text" value="${f.level}" data-field="features.${fi}.level" data-id="${id}" onchange="updateNestedField(this)" /></div>
        </div>
        <div class="field-row">
          <div><label>Action (e.g. Bonus Action)</label><input type="text" value="${escAttr(f.action||'')}" data-field="features.${fi}.action" data-id="${id}" onchange="updateNestedField(this)" /></div>
          <div><label>Usage (e.g. 1/Short Rest)</label><input type="text" value="${escAttr(f.usage||'')}" data-field="features.${fi}.usage" data-id="${id}" onchange="updateNestedField(this)" /></div>
        </div>
        <div><label>Description</label><textarea rows="3" data-field="features.${fi}.description" data-id="${id}" onchange="updateNestedField(this)">${escHtml(f.description||'')}</textarea></div>
      </div>`).join('')}</div>`;
}

function buildItemFields(item, id) {
  return `
    <div class="field-row">
      <div><label>Name</label><input type="text" value="${escAttr(item.name)}" data-field="name" data-id="${id}" onchange="updateField(this)" /></div>
      <div><label>Category</label><input type="text" value="${escAttr(item.category||'')}" data-field="category" data-id="${id}" onchange="updateField(this)" /></div>
    </div>
    <div class="field-row-3">
      <div><label>Cost</label><input type="text" value="${escAttr(item.cost||'')}" data-field="cost" data-id="${id}" onchange="updateField(this)" /></div>
      <div><label>Currency</label>
        <select data-field="currency" data-id="${id}" onchange="updateField(this)">
          ${['gp','sp','cp','pp'].map(c=>`<option ${item.currency===c?'selected':''}>${c}</option>`).join('')}
        </select>
      </div>
      <div><label>Weight (lb)</label><input type="text" value="${escAttr(item.weight||'')}" data-field="weight" data-id="${id}" onchange="updateField(this)" /></div>
    </div>
    <div class="field-row">
      <div><label>Damage (if weapon)</label><input type="text" value="${escAttr(item.damage||'')}" data-field="damage" data-id="${id}" onchange="updateField(this)" /></div>
      <div><label>Properties</label><input type="text" value="${escAttr(item.properties||'')}" data-field="properties" data-id="${id}" onchange="updateField(this)" /></div>
    </div>
    <div><label>Description</label><textarea rows="3" data-field="description" data-id="${id}" onchange="updateField(this)">${escHtml(item.description||'')}</textarea></div>`;
}

function buildFeatFields(feat, id) {
  const benefits = Array.isArray(feat.benefits) ? feat.benefits : [];
  const benefitsHtml = benefits.length
    ? benefits.map((b, bi) => `
        <div style="display:flex; gap:8px; align-items:flex-start; margin-bottom:6px;">
          <span style="color:var(--gold); font-size:1.1rem; line-height:1.5; flex-shrink:0;">&bull;</span>
          <textarea rows="2" style="flex:1; margin-bottom:0;" data-field="benefits.${bi}" data-id="${id}" onchange="updateBenefit(this)">${escHtml(b)}</textarea>
        </div>`).join('')
    : '<p class="text-muted" style="font-size:0.85rem;">No benefits extracted - check the PDF and add manually if needed.</p>';
  return `
    <div class="field-row">
      <div><label>Name</label><input type="text" value="${escAttr(feat.name)}" data-field="name" data-id="${id}" onchange="updateField(this)" /></div>
      <div><label>Prerequisite (leave blank if none)</label><input type="text" value="${escAttr(feat.prerequisite||'')}" data-field="prerequisite" data-id="${id}" onchange="updateField(this)" /></div>
    </div>
    <div><label>Description (opening sentence)</label><textarea rows="2" data-field="description" data-id="${id}" onchange="updateField(this)">${escHtml(feat.description||'')}</textarea></div>
    <div style="display:flex; align-items:center; justify-content:space-between; margin-top:0.75rem; margin-bottom:0.5rem;">
      <span class="section-label" style="margin:0; border:none; padding:0;">Benefits</span>
      <button class="btn btn-secondary" style="font-size:0.7rem; padding:0.3rem 0.75rem;" onclick="addBenefit('${id}')">+ Add Benefit</button>
    </div>
    <div id="benefits-${id}">${benefitsHtml}</div>`;
}
function buildMagicFields(item, id) {
  const rarities = ['Common','Uncommon','Rare','Very Rare','Legendary','Artifact'];
  return `
    <div class="field-row">
      <div><label>Name</label><input type="text" value="${escAttr(item.name)}" data-field="name" data-id="${id}" onchange="updateField(this)" /></div>
      <div><label>Type</label><input type="text" value="${escAttr(item.type||'Wondrous Item')}" data-field="type" data-id="${id}" onchange="updateField(this)" /></div>
    </div>
    <div class="field-row">
      <div>
        <label>Rarity</label>
        <select data-field="rarity" data-id="${id}" onchange="updateField(this)">
          <option value="" ${!item.rarity?'selected':''}>Select rarity</option>
          ${rarities.map(r=>`<option ${item.rarity===r?'selected':''}>${r}</option>`).join('')}
        </select>
      </div>
      <div><label>Charges (0 if none)</label><input type="text" value="${item.charges||0}" data-field="charges" data-id="${id}" onchange="updateField(this)" /></div>
    </div>
    <div class="field-row">
      ${chk('requiresAttunement','Requires Attunement',item.requiresAttunement,id)}
    </div>
    <div><label>Recharge (e.g. "Recharges at dawn")</label><input type="text" value="${escAttr(item.recharge||'')}" data-field="recharge" data-id="${id}" onchange="updateField(this)" /></div>
    <div><label>Description</label><textarea rows="4" data-field="description" data-id="${id}" onchange="updateField(this)">${escHtml(item.description||'')}</textarea></div>`;
}

function buildRaceFields(race, id) {
  return `
    <div class="field-row">
      <div><label>Name</label><input type="text" value="${escAttr(race.name)}" data-field="name" data-id="${id}" onchange="updateField(this)" /></div>
      <div><label>Size</label><input type="text" value="${escAttr(race.size||'')}" data-field="size" data-id="${id}" onchange="updateField(this)" /></div>
    </div>
    <div class="field-row-3">
      <div><label>Speed</label><input type="text" value="${escAttr(race.speed||'')}" data-field="speed" data-id="${id}" onchange="updateField(this)" /></div>
      <div><label>Languages (comma-separated)</label><input type="text" value="${escAttr((race.languages||[]).join(', '))}" data-field="languages" data-id="${id}" onchange="updateFieldArr(this)" /></div>
      <div><label>Language Choices</label><input type="text" value="${escAttr(race.languageChoices||'')}" data-field="languageChoices" data-id="${id}" onchange="updateField(this)" /></div>
    </div>
    <div><label>Ability Scores (e.g. strength:2, dexterity:1)</label><input type="text" value="${escAttr(formatAbilityScores(race.abilityScores))}" data-id="${id}" onchange="updateAbilityScores(this)" /></div>
    <div><label>Description</label><textarea rows="3" data-field="description" data-id="${id}" onchange="updateField(this)">${escHtml(race.description||'')}</textarea></div>
    <div style="display:flex; align-items:center; justify-content:space-between; margin-top:0.75rem; margin-bottom:0.5rem;">
      <span class="section-label" style="margin:0; border:none; padding:0;">Traits</span>
      <button class="btn btn-secondary" style="font-size:0.7rem; padding:0.3rem 0.75rem;" onclick="addTrait('${id}')">+ Add Trait</button>
    </div>
    <div id="traits-${id}">${buildNestedTextBlocks(id, 'traits', race.traits || [], 'Trait Name')}</div>`;
}

function buildBackgroundFields(bg, id) {
  return `
    <div class="field-row">
      <div><label>Name</label><input type="text" value="${escAttr(bg.name)}" data-field="name" data-id="${id}" onchange="updateField(this)" /></div>
      <div><label>Skill Proficiencies</label><input type="text" value="${escAttr((bg.skillProficiencies||[]).join(', '))}" data-field="skillProficiencies" data-id="${id}" onchange="updateFieldArr(this)" /></div>
    </div>
    <div class="field-row">
      <div><label>Ability Scores</label><input type="text" value="${escAttr((bg.abilityScores||[]).join(', '))}" data-field="abilityScores" data-id="${id}" onchange="updateFieldArr(this)" /></div>
      <div><label>Feat</label><input type="text" value="${escAttr(bg.feat||'')}" data-field="feat" data-id="${id}" onchange="updateField(this)" /></div>
    </div>
    <div class="field-row-3">
      <div><label>Tool Proficiencies</label><input type="text" value="${escAttr((bg.toolProficiencies||[]).join(', '))}" data-field="toolProficiencies" data-id="${id}" onchange="updateFieldArr(this)" /></div>
      <div><label>Languages</label><input type="text" value="${escAttr((bg.languages||[]).join(', '))}" data-field="languages" data-id="${id}" onchange="updateFieldArr(this)" /></div>
      <div><label>Language Choices</label><input type="text" value="${escAttr(bg.languageChoices||'')}" data-field="languageChoices" data-id="${id}" onchange="updateField(this)" /></div>
    </div>
    <div><label>Equipment</label><textarea rows="2" data-field="equipment" data-id="${id}" onchange="updateField(this)">${escHtml(bg.equipment||'')}</textarea></div>
    <div><label>Description</label><textarea rows="3" data-field="description" data-id="${id}" onchange="updateField(this)">${escHtml(bg.description||'')}</textarea></div>
    <div style="display:flex; align-items:center; justify-content:space-between; margin-top:0.75rem; margin-bottom:0.5rem;">
      <span class="section-label" style="margin:0; border:none; padding:0;">Features</span>
      <button class="btn btn-secondary" style="font-size:0.7rem; padding:0.3rem 0.75rem;" onclick="addSimpleFeature('${id}')">+ Add Feature</button>
    </div>
    <div id="features-${id}">${buildNestedTextBlocks(id, 'features', bg.features || [], 'Feature Name')}</div>`;
}

function buildClassFields(cls, id) {
  return `
    <div class="field-row">
      <div><label>Name</label><input type="text" value="${escAttr(cls.name)}" data-field="name" data-id="${id}" onchange="updateField(this)" /></div>
      <div><label>Hit Die</label><input type="text" value="${escAttr(cls.hitDie||'')}" data-field="hitDie" data-id="${id}" onchange="updateField(this)" /></div>
    </div>
    <div class="field-row">
      <div><label>Saving Throws</label><input type="text" value="${escAttr((cls.savingThrows||[]).join(', '))}" data-field="savingThrows" data-id="${id}" onchange="updateFieldArr(this)" /></div>
      <div><label>Skill Choices</label><input type="text" value="${escAttr((cls.skillChoices?.from||[]).join(', '))}" data-field="skillChoices.from" data-id="${id}" onchange="updateNestedArrayField(this)" /></div>
    </div>
    <div class="field-row">
      <div><label>Skill Choice Count</label><input type="text" value="${escAttr(cls.skillChoices?.count||'')}" data-field="skillChoices.count" data-id="${id}" onchange="updateNestedField(this)" /></div>
      <div><label>Archetype Level</label><input type="text" value="${escAttr(cls.archetypeLevel||'')}" data-field="archetypeLevel" data-id="${id}" onchange="updateField(this)" /></div>
    </div>
    <div class="field-row">
      <div><label>Armor Proficiencies</label><input type="text" value="${escAttr((cls.armorProficiencies||[]).join(', '))}" data-field="armorProficiencies" data-id="${id}" onchange="updateFieldArr(this)" /></div>
      <div><label>Weapon Proficiencies</label><input type="text" value="${escAttr((cls.weaponProficiencies||[]).join(', '))}" data-field="weaponProficiencies" data-id="${id}" onchange="updateFieldArr(this)" /></div>
    </div>
    <div class="field-row">
      <div><label>Archetype Label</label><input type="text" value="${escAttr(cls.archetypeLabel||'')}" data-field="archetypeLabel" data-id="${id}" onchange="updateField(this)" /></div>
      <div><label>Archetype Supports</label><input type="text" value="${escAttr(cls.archetypeSupports||'')}" data-field="archetypeSupports" data-id="${id}" onchange="updateField(this)" /></div>
    </div>
    <div class="field-row">
      <div><label>Spellcasting Ability</label><input type="text" value="${escAttr(cls.spellcastingAbility||'')}" data-field="spellcastingAbility" data-id="${id}" onchange="updateField(this)" /></div>
      <div><label>Spellcasting List</label><input type="text" value="${escAttr(cls.spellcastingList||'')}" data-field="spellcastingList" data-id="${id}" onchange="updateField(this)" /></div>
    </div>
    <div><label>Starting Equipment</label><textarea rows="2" data-field="startingEquipment" data-id="${id}" onchange="updateField(this)">${escHtml(cls.startingEquipment||'')}</textarea></div>
    <div><label>Description</label><textarea rows="3" data-field="description" data-id="${id}" onchange="updateField(this)">${escHtml(cls.description||'')}</textarea></div>
    <div style="display:flex; align-items:center; justify-content:space-between; margin-top:0.75rem; margin-bottom:0.5rem;">
      <span class="section-label" style="margin:0; border:none; padding:0;">Features</span>
      <button class="btn btn-secondary" style="font-size:0.7rem; padding:0.3rem 0.75rem;" onclick="addFeature('${id}')">+ Add Feature</button>
    </div>
    <div id="features-${id}">${(cls.features||[]).map((f,fi) => buildFeatureBlock(id, f, fi)).join('')}</div>`;
}

function buildOtherFields(item, id) {
  return `
    <div class="field-row">
      <div><label>Name</label><input type="text" value="${escAttr(item.name||'')}" data-field="name" data-id="${id}" onchange="updateField(this)" /></div>
      <div><label>Aurora Type</label><input type="text" value="${escAttr(item.type||'')}" data-field="type" data-id="${id}" onchange="updateField(this)" /></div>
    </div>
    <div><label>Description</label><textarea rows="4" data-field="description" data-id="${id}" onchange="updateField(this)">${escHtml(item.description||'')}</textarea></div>
    <div style="display:flex; align-items:center; justify-content:space-between; margin-top:0.75rem; margin-bottom:0.5rem;">
      <span class="section-label" style="margin:0; border:none; padding:0;">Features</span>
      <button class="btn btn-secondary" style="font-size:0.7rem; padding:0.3rem 0.75rem;" onclick="addSimpleFeature('${id}')">+ Add Feature</button>
    </div>
    <div id="features-${id}">${buildNestedTextBlocks(id, 'features', item.features || [], 'Feature Name')}</div>`;
}

function buildNestedTextBlocks(id, field, items, label) {
  return items.map((item, i) => `
    <div style="border:1px solid var(--border-light); border-radius:3px; padding:0.75rem; margin-bottom:0.75rem; background:var(--parchment);">
      <div><label>${label}</label><input type="text" value="${escAttr(item.name||'')}" data-field="${field}.${i}.name" data-id="${id}" onchange="updateNestedField(this)" /></div>
      <div><label>Description</label><textarea rows="3" data-field="${field}.${i}.description" data-id="${id}" onchange="updateNestedField(this)">${escHtml(item.description||'')}</textarea></div>
    </div>`).join('');
}

function buildFeatureBlock(id, f, fi) {
  return `
    <div style="border:1px solid var(--border-light); border-radius:3px; padding:0.75rem; margin-bottom:0.75rem; background:var(--parchment);">
      <div class="field-row">
        <div><label>Feature Name</label><input type="text" value="${escAttr(f.name)}" data-field="features.${fi}.name" data-id="${id}" onchange="updateNestedField(this)" /></div>
        <div><label>Level</label><input type="text" value="${f.level}" data-field="features.${fi}.level" data-id="${id}" onchange="updateNestedField(this)" /></div>
      </div>
      <div class="field-row">
        <div><label>Action</label><input type="text" value="${escAttr(f.action||'')}" data-field="features.${fi}.action" data-id="${id}" onchange="updateNestedField(this)" /></div>
        <div><label>Usage</label><input type="text" value="${escAttr(f.usage||'')}" data-field="features.${fi}.usage" data-id="${id}" onchange="updateNestedField(this)" /></div>
      </div>
      <div><label>Description</label><textarea rows="3" data-field="features.${fi}.description" data-id="${id}" onchange="updateNestedField(this)">${escHtml(f.description||'')}</textarea></div>
    </div>`;
}

function chk(field, label, val, id) {
  return `<label class="checkbox-inline">
    <input type="checkbox" ${val?'checked':''} data-field="${field}" data-id="${id}" onchange="updateFieldBool(this)" /> ${label}
  </label>`;
}

// ---------------------------------------------
// Field update helpers
// ---------------------------------------------
function parseId(id) {
  const parts = id.split('-');
  return { type: parts[0], index: parseInt(parts[1]) };
}

function updateField(el) {
  const { type, index } = parseId(el.dataset.id);
  extractedData[type][index][el.dataset.field] = el.value;
  flashField(el);
}

function updateFieldBool(el) {
  const { type, index } = parseId(el.dataset.id);
  extractedData[type][index][el.dataset.field] = el.checked;
  markChanged();
  updateOverrideStatusForId(el.dataset.id);
}

function updateFieldArr(el) {
  const { type, index } = parseId(el.dataset.id);
  extractedData[type][index][el.dataset.field] = el.value.split(',').map(s => s.trim()).filter(Boolean);
  flashField(el);
}

function updateNestedArrayField(el) {
  const { type, index } = parseId(el.dataset.id);
  const parts = el.dataset.field.split('.');
  let obj = extractedData[type][index];
  for (let i = 0; i < parts.length - 1; i++) {
    if (!obj[parts[i]]) obj[parts[i]] = {};
    obj = obj[parts[i]];
  }
  obj[parts[parts.length - 1]] = el.value.split(',').map(s => s.trim()).filter(Boolean);
  flashField(el);
}

function updateAbilityScores(el) {
  const { type, index } = parseId(el.dataset.id);
  extractedData[type][index].abilityScores = parseAbilityScoreInput(el.value);
  flashField(el);
}

function formatAbilityScores(scores) {
  if (!scores || typeof scores !== 'object') return '';
  return Object.entries(scores).map(([k, v]) => `${k}:${v}`).join(', ');
}

function parseAbilityScoreInput(text) {
  const out = {};
  String(text || '').split(',').forEach(part => {
    const m = part.trim().match(/^([a-zA-Z]+)\s*[:=]\s*(-?\d+)$/);
    if (!m) return;
    const key = m[1].toLowerCase();
    if (['strength','dexterity','constitution','intelligence','wisdom','charisma'].includes(key)) out[key] = parseInt(m[2], 10);
  });
  return out;
}

function parseFeatFullText(feat) {
  let raw = feat.fullText || feat.description || '';
  if (!raw) return { ...feat, description: '', benefits: [] };

  // Backfill prerequisite if Gemini included it in fullText but not in its own field
  let prereq = feat.prerequisite || '';
  const prereqMatch = raw.match(/^prerequisite[^:]*:\s*([^\n]+)/i);
  if (prereqMatch) {
    if (!prereq) prereq = prereqMatch[1].trim();
    raw = raw.replace(/^prerequisite[^:]*:[^\n]+\n?/i, '').trim();
  }

  // Split on common bullet markers Gemini uses
  const bulletRe = /(?:^|\n)\s*(?:[\u2022\-\*]|\d+[.)])\s+/m;

  if (!bulletRe.test(raw)) {
    const lines = raw.split(/\n+/).map(s => s.trim()).filter(Boolean);
    const genericBenefits = lines.findIndex(line => /^["']?\s*You gain the following benefits\.?$/i.test(line));
    if (genericBenefits !== -1) {
      return {
        ...feat,
        prerequisite: prereq,
        description: lines.slice(0, genericBenefits).join(' '),
        benefits: groupFeatBenefitLines(lines.slice(genericBenefits + 1))
      };
    }
    const benefitStartRe = /^(?:Increase your|You gain|You have|You learn|You can|Choose|When you|Whenever you|If you|Once per|Your)\b/i;
    const firstBenefit = lines.findIndex(line => benefitStartRe.test(line));
    if (firstBenefit !== -1) {
      return {
        ...feat,
        prerequisite: prereq,
        description: lines.slice(0, firstBenefit).join(' '),
        benefits: groupFeatBenefitLines(lines.slice(firstBenefit))
      };
    }
    return { ...feat, prerequisite: prereq, description: raw.trim(), benefits: [] };
  }

  const firstBullet = raw.search(bulletRe);
  const intro = raw.slice(0, firstBullet).trim();
  const bulletSection = raw.slice(firstBullet);

  const bullets = bulletSection
    .split(/(?:^|\n)\s*(?:[\u2022\-\*]|\d+[.)])\s+/m)
    .map(s => s.trim())
    .filter(Boolean);

  return { ...feat, prerequisite: prereq, description: intro, benefits: bullets };
}

function groupFeatBenefitLines(lines) {
  const benefits = [];
  const startsBenefit = line =>
    /^[A-Z][A-Za-z' -]{2,55}\.\s+\S/.test(line)
    || /^(?:Increase your|You gain|You have|You learn|You can|Choose|When you|Whenever you|If you|Once per|Your)\b/.test(line);

  for (const rawLine of lines) {
    const line = String(rawLine || '').trim();
    if (!line || isFeatMetaLine(line) || /^https?:\/\//i.test(line) || /^\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(line)) continue;
    if (!benefits.length || startsBenefit(line)) benefits.push(line);
    else benefits[benefits.length - 1] += ` ${line}`;
  }
  return benefits;
}
function updateBenefit(el) {
  const { type, index } = parseId(el.dataset.id);
  const bi = parseInt(el.dataset.field.split('.')[1]);
  if (!Array.isArray(extractedData[type][index].benefits)) extractedData[type][index].benefits = [];
  extractedData[type][index].benefits[bi] = el.value;
  flashField(el);
}

function updateNestedField(el) {
  const { type, index } = parseId(el.dataset.id);
  const parts = el.dataset.field.split('.');
  // e.g. features.0.name
  let obj = extractedData[type][index];
  for (let i = 0; i < parts.length - 1; i++) {
    if (!obj[parts[i]]) obj[parts[i]] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    obj = obj[parts[i]];
  }
  const finalKey = parts[parts.length - 1];
  const numericKeys = new Set(['level', 'count', 'hitDie', 'speed', 'archetypeLevel', 'charges']);
  obj[finalKey] = numericKeys.has(finalKey) ? (parseInt(el.value) || 0) : el.value;
  flashField(el);
}

function updateOverrideStatusForId(id) {
  if (!id) return;
  const { type, index } = parseId(id);
  const status = document.getElementById(`override-status-${id}`);
  if (status) status.textContent = overrideStatusText(type, index);
  const edited = isEditedFromGenerated(type, index);
  const remembered = hasRememberedOverride(type, index);
  const rememberBtn = document.getElementById(`remember-${id}`);
  const forgetBtn = document.getElementById(`forget-${id}`);
  const revertBtn = document.getElementById(`revert-${id}`);
  if (rememberBtn) rememberBtn.disabled = !edited;
  if (forgetBtn) forgetBtn.disabled = !remembered;
  if (revertBtn) revertBtn.disabled = !edited;
}

function rememberOverride(id, event) {
  if (event?.stopPropagation) event.stopPropagation();
  const { type, index } = parseId(id);
  const key = overrideKeyForIndex(type, index);
  const current = extractedData[type]?.[index];
  const baseline = generatedBaselineData[type]?.[index];
  if (!key || !current || !baseline || !isEditedFromGenerated(type, index)) {
    updateOverrideStatusForId(id);
    return;
  }
  const meta = getSourceMeta();
  rememberedOverrides[key] = {
    type,
    sourceName: meta.name,
    sourceAbbr: meta.abbr,
    originalName: baseline.name || '',
    savedAt: new Date().toISOString(),
    item: cloneData(current)
  };
  saveRememberedOverrides();
  updateOverrideStatusForId(id);
  setManualAuthorStatus(`Remembered correction for ${current.name || baseline.name || TYPE_LABELS[type] || type}.`, 'success');
}

function forgetOverride(id, event) {
  if (event?.stopPropagation) event.stopPropagation();
  const { type, index } = parseId(id);
  const key = overrideKeyForIndex(type, index);
  if (key && rememberedOverrides[key]) {
    delete rememberedOverrides[key];
    saveRememberedOverrides();
  }
  updateOverrideStatusForId(id);
  setManualAuthorStatus('Forgot saved correction. Current edits remain one-off for this export.', 'info');
}

function revertToGenerated(id, event) {
  if (event?.stopPropagation) event.stopPropagation();
  const { type, index } = parseId(id);
  const baseline = generatedBaselineData[type]?.[index];
  if (!baseline || !extractedData[type]?.[index]) return;
  extractedData[type][index] = cloneData(baseline);
  buildReviewUI(type);
  openElementCard(type, index);
  markChanged();
  setManualAuthorStatus('Reverted current element to generated parser output.', 'info');
}


// ---------------------------------------------
// Change tracking
// ---------------------------------------------
let hasUnsavedChanges = false;

function markChanged() {
  hasUnsavedChanges = true;
  ['downloadBtnWrap','downloadSingleWrap','previewBtnWrap'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('has-changes');
  });
}

function clearChanged() {
  hasUnsavedChanges = false;
  ['downloadBtnWrap','downloadSingleWrap','previewBtnWrap'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('has-changes');
  });
}

function flashField(el) {
  el.classList.add('field-saved');
  setTimeout(() => el.classList.remove('field-saved'), 1200);
  markChanged();
  updateOverrideStatusForId(el.dataset.id);
}

function normalizeManualType(type) {
  return MANUAL_AUTHOR_TYPES.includes(type) ? type : 'feat';
}

function createBlankElement(type) {
  switch (normalizeManualType(type)) {
    case 'spell':
      return {
        name: '',
        school: '',
        level: '',
        castingTime: '',
        range: '',
        duration: '',
        material: '',
        hasVerbal: false,
        hasSomatic: false,
        hasMaterial: false,
        isConcentration: false,
        isRitual: false,
        isTechnomagic: false,
        classes: [],
        description: '',
        higherLevels: ''
      };
    case 'archetype':
      return { name: '', class: '', supports: '', description: '', features: [] };
    case 'item':
      return { name: '', category: 'Equipment', cost: '0', currency: 'gp', weight: '0', damage: '', properties: '', description: '' };
    case 'feat':
      return { name: '', prerequisite: '', description: '', benefits: [] };
    case 'magic':
      return { name: '', type: 'Wondrous Item', rarity: '', requiresAttunement: false, charges: 0, recharge: '', description: '' };
    case 'race':
      return { name: '', size: '', speed: '', languages: [], languageChoices: '', abilityScores: {}, description: '', traits: [] };
    case 'background':
      return {
        name: '',
        description: '',
        abilityScores: [],
        feat: '',
        skillProficiencies: [],
        toolProficiencies: [],
        languages: [],
        languageChoices: 0,
        equipment: '',
        features: []
      };
    case 'class':
      return {
        name: '',
        hitDie: '',
        savingThrows: [],
        skillChoices: { count: 0, from: [] },
        armorProficiencies: [],
        weaponProficiencies: [],
        toolProficiencies: [],
        startingEquipment: '',
        archetypeLevel: '',
        archetypeLabel: '',
        archetypeSupports: '',
        spellcastingAbility: '',
        spellcastingList: '',
        description: '',
        features: []
      };
    case 'other':
    default:
      return { name: '', type: '', description: '', features: [] };
  }
}

function createSeededManualElement(type, text) {
  const normalizedType = normalizeManualType(type);
  const item = createBlankElement(normalizedType);
  const lines = normalizeTextLines(text);
  const name = normalizeExtractedName(lines[0] || '');
  const body = lines.slice(1).join('\n');

  item.name = name;
  if ('description' in item) item.description = body || String(text || '').trim();

  if (normalizedType === 'feat') {
    const parsed = parseFeatFullText({ name, fullText: body || String(text || '').trim() });
    return { ...item, ...parsed, name: name || parsed.name || '' };
  }

  return item;
}

function parseManualTextForType(type, text) {
  const normalizedType = normalizeManualType(type);
  const trimmed = String(text || '').trim();
  if (!trimmed) return [];

  const parser = DETERMINISTIC_PARSERS[normalizedType];
  const parsed = parser ? parser(trimmed) : [];
  return parsed.length ? parsed : [createSeededManualElement(normalizedType, trimmed)];
}

function addManualElement(typeOverride = '', itemOverride = null) {
  const select = document.getElementById('manualAddType');
  const type = normalizeManualType(typeOverride || select?.value || 'feat');
  const item = itemOverride || createBlankElement(type);

  ensureExtractedDataBuckets();
  extractedData[type].push(item);
  const index = extractedData[type].length - 1;
  appendGeneratedBaselineItems(type, [item]);
  applyRememberedOverrideAt(type, index);
  buildReviewUI(type);
  openElementCard(type, index);
  setManualAuthorStatus(`Added entry #${index + 1} to ${TYPE_LABELS[type] || type}.`, 'info');
  markChanged();
}

function parseManualSection() {
  const select = document.getElementById('manualAddType');
  const textarea = document.getElementById('manualSourceText');
  const type = normalizeManualType(select?.value || 'feat');
  const parsed = parseManualTextForType(type, textarea?.value || '');

  if (!parsed.length) {
    setManualAuthorStatus('Paste text before parsing.', 'warning');
    return;
  }

  ensureExtractedDataBuckets();
  const firstIndex = extractedData[type].length;
  extractedData[type].push(...parsed);
  appendGeneratedBaselineItems(type, parsed);
  for (let i = firstIndex; i < firstIndex + parsed.length; i++) applyRememberedOverrideAt(type, i);
  buildReviewUI(type);
  openElementCard(type, firstIndex);
  setManualAuthorStatus(`Added ${parsed.length} entr${parsed.length === 1 ? 'y' : 'ies'} to ${TYPE_LABELS[type] || type}.`, 'info');
  markChanged();
}

function removeElement(id, event) {
  if (event?.stopPropagation) event.stopPropagation();
  const { type, index } = parseId(id);
  if (!extractedData[type] || !extractedData[type][index]) return;
  const item = extractedData[type][index];
  if (!confirm(`Remove ${item.name || TYPE_LABELS[type] || type}?`)) return;
  extractedData[type].splice(index, 1);
  if (Array.isArray(generatedBaselineData[type])) generatedBaselineData[type].splice(index, 1);
  buildReviewUI(type);
  setManualAuthorStatus('Element removed.', 'info');
  markChanged();
}

function openElementCard(type, index) {
  switchTab(type);
  const body = document.getElementById(`body-${type}-${index}`);
  if (body) {
    body.classList.add('open');
    body.querySelector('input, textarea, select')?.focus?.();
  }
  document.getElementById(`card-${type}-${index}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
}

function setManualAuthorStatus(message, tone = 'info') {
  const el = document.getElementById('manualAuthorStatus');
  if (!el) return;
  el.className = `alert alert-${tone} manual-status`;
  el.textContent = message;
  el.classList.remove('hidden');
}


function addBenefit(id) {
  const { type, index } = parseId(id);
  if (!Array.isArray(extractedData[type][index].benefits)) extractedData[type][index].benefits = [];
  const benefits = extractedData[type][index].benefits;
  const bi = benefits.length;
  benefits.push('');
  // Append a new textarea to the benefits div
  const container = document.getElementById(`benefits-${id}`);
  if (container) {
    const div = document.createElement('div');
    div.style.cssText = 'display:flex; gap:8px; align-items:flex-start; margin-bottom:6px;';
    div.innerHTML = `<span style="color:var(--gold); font-size:1.1rem; line-height:1.5; flex-shrink:0;">&bull;</span>
      <textarea rows="2" style="flex:1; margin-bottom:0;" data-field="benefits.${bi}" data-id="${id}" onchange="updateBenefit(this)"></textarea>`;
    container.appendChild(div);
    div.querySelector('textarea').focus();
  }
  markChanged();
  updateOverrideStatusForId(id);
}

function addFeature(id) {
  const { type, index } = parseId(id);
  if (!Array.isArray(extractedData[type][index].features)) extractedData[type][index].features = [];
  const features = extractedData[type][index].features;
  const fi = features.length;
  features.push({ name: '', level: 1, action: '', usage: '', description: '' });
  // Append a new feature block
  const container = document.getElementById(`features-${id}`);
  if (container) {
    const div = document.createElement('div');
    div.style.cssText = 'border:1px solid var(--border-light); border-radius:3px; padding:0.75rem; margin-bottom:0.75rem; background:var(--parchment);';
    div.innerHTML = `
      <div class="field-row">
        <div><label>Feature Name</label><input type="text" value="" data-field="features.${fi}.name" data-id="${id}" onchange="updateNestedField(this)" /></div>
        <div><label>Level</label><input type="text" value="1" data-field="features.${fi}.level" data-id="${id}" onchange="updateNestedField(this)" /></div>
      </div>
      <div class="field-row">
        <div><label>Action (e.g. Bonus Action)</label><input type="text" value="" data-field="features.${fi}.action" data-id="${id}" onchange="updateNestedField(this)" /></div>
        <div><label>Usage (e.g. 1/Short Rest)</label><input type="text" value="" data-field="features.${fi}.usage" data-id="${id}" onchange="updateNestedField(this)" /></div>
      </div>
      <div><label>Description</label><textarea rows="3" data-field="features.${fi}.description" data-id="${id}" onchange="updateNestedField(this)"></textarea></div>`;
    container.appendChild(div);
    div.querySelector('input').focus();
  }
  markChanged();
  updateOverrideStatusForId(id);
}

function addSimpleFeature(id) {
  const { type, index } = parseId(id);
  if (!Array.isArray(extractedData[type][index].features)) extractedData[type][index].features = [];
  const features = extractedData[type][index].features;
  const fi = features.length;
  features.push({ name: '', description: '' });
  const container = document.getElementById(`features-${id}`);
  if (container) {
    const div = document.createElement('div');
    div.style.cssText = 'border:1px solid var(--border-light); border-radius:3px; padding:0.75rem; margin-bottom:0.75rem; background:var(--parchment);';
    div.innerHTML = `
      <div><label>Feature Name</label><input type="text" value="" data-field="features.${fi}.name" data-id="${id}" onchange="updateNestedField(this)" /></div>
      <div><label>Description</label><textarea rows="3" data-field="features.${fi}.description" data-id="${id}" onchange="updateNestedField(this)"></textarea></div>`;
    container.appendChild(div);
    div.querySelector('input').focus();
  }
  markChanged();
  updateOverrideStatusForId(id);
}

function addTrait(id) {
  const { type, index } = parseId(id);
  if (!Array.isArray(extractedData[type][index].traits)) extractedData[type][index].traits = [];
  const traits = extractedData[type][index].traits;
  const ti = traits.length;
  traits.push({ name: '', description: '' });
  const container = document.getElementById(`traits-${id}`);
  if (container) {
    const div = document.createElement('div');
    div.style.cssText = 'border:1px solid var(--border-light); border-radius:3px; padding:0.75rem; margin-bottom:0.75rem; background:var(--parchment);';
    div.innerHTML = `
      <div><label>Trait Name</label><input type="text" value="" data-field="traits.${ti}.name" data-id="${id}" onchange="updateNestedField(this)" /></div>
      <div><label>Description</label><textarea rows="3" data-field="traits.${ti}.description" data-id="${id}" onchange="updateNestedField(this)"></textarea></div>`;
    container.appendChild(div);
    div.querySelector('input').focus();
  }
  markChanged();
  updateOverrideStatusForId(id);
}

// ---------------------------------------------
// XML Generation
// ---------------------------------------------



// ---------------------------------------------
// Completeness checking
// ---------------------------------------------

// Returns { keep: bool, missing: string[] } for each item
function checkCompleteness(item, type) {
  const missing = [];

  const has = (v) => v !== undefined && v !== null && String(v).trim() !== '';

  if (type === 'spell') {
    const required = [
      ['name',        'name'],
      ['level',       'level'],
      ['school',      'school'],
      ['castingTime', 'casting time'],
      ['range',       'range'],
      ['duration',    'duration'],
      ['description', 'description'],
    ];
    for (const [field, label] of required) {
      if (!has(item[field])) missing.push(label);
    }
    // level=0 is valid (cantrip) - don't flag it
    if (item.level === 0 || item.level === '0') {
      const idx = missing.indexOf('level');
      if (idx !== -1) missing.splice(idx, 1);
    }
  }

  else if (type === 'archetype') {
    if (!has(item.name))    missing.push('name');
    if (!has(item.class))   missing.push('class');
    if (!has(item.supports)) missing.push('supports');
    if (!Array.isArray(item.features) || item.features.length === 0) {
      missing.push('features');
    } else {
      const hasUsableFeature = item.features.some(f => has(f.name) && has(f.description));
      if (!hasUsableFeature) missing.push('feature descriptions');
    }
  }

  else if (type === 'item') {
    if (!has(item.name))        missing.push('name');
    if (!has(item.category))    missing.push('category');
  }

  else if (type === 'feat') {
    if (!has(item.name)) missing.push('name');
    const hasBenefits = Array.isArray(item.benefits) && item.benefits.some(b => has(b));
    if (!hasBenefits) missing.push('benefits');
  }

  else if (type === 'magic') {
    if (!has(item.name))        missing.push('name');
    if (!has(item.type))        missing.push('type');
    if (!has(item.rarity))      missing.push('rarity');
    if (!has(item.description)) missing.push('description');
  }

  else if (type === 'race') {
    if (!has(item.name))        missing.push('name');
    if (!has(item.description)) missing.push('description');
    if (!item.traits || item.traits.length === 0) missing.push('traits');
  }

  else if (type === 'background') {
    if (!has(item.name))        missing.push('name');
    if (!has(item.description)) missing.push('description');
    if (!item.skillProficiencies || item.skillProficiencies.length === 0) missing.push('skill proficiencies');
  }

  else if (type === 'class') {
    if (!has(item.name))        missing.push('name');
    if (!has(item.hitDie))      missing.push('hit die');
    if (!item.features || item.features.length === 0) missing.push('features');
    if (!item.savingThrows || item.savingThrows.length === 0) missing.push('saving throws');
  }

    else {
    // generic / other
    if (!has(item.name))        missing.push('name');
    if (!has(item.description)) missing.push('description');
  }

  const totalFields = missing.length + (type === 'spell' ? 7 : type === 'archetype' ? 4 : type === 'item' ? 3 : type === 'feat' ? 2 : type === 'magic' ? 4 : 2);
  const completeness = (totalFields - missing.length) / totalFields;
  const keep = completeness >= 0.8;

  return { keep, missing, completeness };
}

// Runs completeness check over all extracted data, mutates extractedData in place,
// returns array of skipped items for reporting
function filterIncomplete() {
  const skipped = [];

  for (const [type, items] of Object.entries(extractedData)) {
    const kept = [];
    for (const item of items) {
      if (item._error) { kept.push(item); continue; }
      const { keep, missing, completeness } = checkCompleteness(item, type);
      if (keep) {
        kept.push(item);
      } else {
        skipped.push({
          name: item.name || '(unnamed)',
          type: TYPE_LABELS[type] || type,
          missing,
          completeness: Math.round(completeness * 100),
        });
      }
    }
    extractedData[type] = kept;
  }

  return skipped;
}

function generateSkippedReport(skipped, sourceName) {
  if (!skipped.length) return null;
  const lines = [];
  lines.push(`Skipped Elements Report - ${sourceName}`);
  lines.push(`Generated: ${new Date().toLocaleString()}`);
  lines.push('-'.repeat(60));
  lines.push(`${skipped.length} element(s) were skipped due to insufficient data (below 80% complete).`);
  lines.push('');
  const byType = {};
  for (const s of skipped) {
    if (!byType[s.type]) byType[s.type] = [];
    byType[s.type].push(s);
  }
  for (const [type, items] of Object.entries(byType)) {
    lines.push(`${type} (${items.length})`);
    lines.push('-'.repeat(40));
    for (const s of items) {
      lines.push(`  - ${s.name} - ${s.completeness}% complete`);
      lines.push(`    Missing: ${s.missing.join(', ')}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}


// ---------------------------------------------
// Validation
// ---------------------------------------------
function validateAll() {
  const issues = [];
  for (const [type, items] of Object.entries(extractedData)) {
    items.forEach((item, i) => {
      if (item._error) return;
      const label = `${TYPE_LABELS[type] || type} #${i+1}`;
      const name = (item.name || '').trim();

      if (!name) issues.push({ type, i, field: 'name', msg: `${label}: name is blank` });

      if (type === 'spell') {
        const lvl = parseInt(item.level);
        if (isNaN(lvl) || lvl < 0 || lvl > 9)
          issues.push({ type, i, field: 'level', msg: `${label} (${name}): level must be 0-9` });
        if (!item.school)
          issues.push({ type, i, field: 'school', msg: `${label} (${name}): school is blank` });
        if (!item.description)
          issues.push({ type, i, field: 'description', msg: `${label} (${name}): description is blank` });
      }

      if (type === 'archetype') {
        if (!item.class)
          issues.push({ type, i, field: 'class', msg: `${label} (${name}): class is blank` });
        if (!item.features || item.features.length === 0)
          issues.push({ type, i, field: null, msg: `${label} (${name}): has no features` });
        (item.features || []).forEach((f, fi) => {
          if (!f.name) issues.push({ type, i, field: null, msg: `${label} (${name}): feature #${fi+1} has no name` });
          const fl = parseInt(f.level);
          if (isNaN(fl) || fl < 1 || fl > 20)
            issues.push({ type, i, field: null, msg: `${label} (${name}): feature "${f.name}" has invalid level` });
        });
        const fnames = (item.features||[]).map(f => f.name);
        fnames.forEach((fn, fi) => {
          if (fn && fnames.indexOf(fn) !== fi)
            issues.push({ type, i, field: null, msg: `${label} (${name}): duplicate feature name "${fn}"` });
        });
      }

      if (type === 'feat') {
        if (!item.benefits || item.benefits.length === 0)
          issues.push({ type, i, field: null, msg: `${label} (${name}): has no benefits` });
      }

      if (type === 'race') {
        if (!item.traits || item.traits.length === 0)
          issues.push({ type, i, field: null, msg: `${label} (${name}): has no racial traits` });
      }

      if (type === 'background') {
        if (!item.skillProficiencies || item.skillProficiencies.length === 0)
          issues.push({ type, i, field: null, msg: `${label} (${name}): has no skill proficiencies` });
      }

      if (type === 'class') {
        if (!item.hitDie)
          issues.push({ type, i, field: null, msg: `${label} (${name}): hit die is missing` });
        if (!item.features || item.features.length === 0)
          issues.push({ type, i, field: null, msg: `${label} (${name}): has no class features` });
      }

      if (type === 'other') {
        if (!item.type)
          issues.push({ type, i, field: 'type', msg: `${label} (${name}): Aurora type is blank` });
        if (!item.description)
          issues.push({ type, i, field: 'description', msg: `${label} (${name}): description is blank` });
      }

      // Duplicate name check within same type
      const sameType = extractedData[type];
      const firstIdx = sameType.findIndex(x => (x.name||'').trim() === name && !x._error);
      if (firstIdx !== -1 && firstIdx < i && name)
        issues.push({ type, i, field: 'name', msg: `${label}: duplicate name "${name}" will produce duplicate XML IDs` });
    });
  }
  issues.push(...validateGeneratedXmlShape());
  return issues;
}

function validateGeneratedXmlShape() {
  if (!Object.values(extractedData).some(items => Array.isArray(items) && items.length)) return [];
  const meta = getSourceMeta();
  const singleDocs = [{ fileName: `${meta.slug}.xml`, xml: generateXml() }];
  const zipDocs = buildZipXmlDocuments(meta);
  return [
    ...validateAuroraXmlDocuments(singleDocs, 'Single XML'),
    ...validateAuroraXmlDocuments(zipDocs, 'ZIP')
  ];
}

function buildZipXmlDocuments(meta) {
  const docs = [];
  const fileList = [];
  for (const [type, items] of Object.entries(extractedData)) {
    if (!items.length) continue;
    if (type === 'other') {
      const groups = {};
      for (const item of items) {
        const resolvedType = (item.type || 'other').trim();
        if (!groups[resolvedType]) groups[resolvedType] = [];
        groups[resolvedType].push(item);
      }
      for (const [resolvedType, groupItems] of Object.entries(groups)) {
        const fileName = getFileName(resolvedType, meta.abbr);
        fileList.push(fileName);
        docs.push({ fileName, xml: genTypeXml(resolvedType, groupItems, meta) });
      }
    } else {
      const fileName = getFileName(type, meta.abbr);
      fileList.push(fileName);
      docs.push({ fileName, xml: genTypeXml(type, items, meta) });
    }
  }
  docs.push({ fileName: 'source.xml', xml: genSourceXml(meta, fileList) });
  return docs;
}

function validateAuroraXmlDocuments(docs, scopeLabel) {
  const api = window.AuroraXmlShape || globalThis.AuroraXmlShape;
  if (!api?.validateAuroraXmlDocuments) {
    return [{ type: 'xml', i: 0, field: null, msg: `${scopeLabel}: ValidatorModule - Aurora XML shape validator module is not loaded.` }];
  }
  const Parser = typeof DOMParser !== 'undefined' ? DOMParser : null;
  return api.validateAuroraXmlDocuments(docs, scopeLabel, { DOMParser: Parser });
}

function showValidationResult(issues) {
  document.querySelectorAll('.validation-error').forEach(el => el.classList.remove('validation-error'));
  document.querySelectorAll('.validation-badge').forEach(el => el.remove());
  const errEl = document.getElementById('extractErrors');

  if (issues.length === 0) {
    if (errEl?.dataset.validationMessage === '1') {
      errEl.classList.add('hidden');
      errEl.innerHTML = '';
      delete errEl.dataset.validationMessage;
    }
    return true;
  }

  issues.forEach(({ type, i, field }) => {
    const header = document.querySelector(`#card-${type}-${i} .element-card-header h3`);
    if (header && !header.querySelector('.validation-badge')) {
      header.insertAdjacentHTML('beforeend', '<span class="validation-badge">!</span>');
    }
    const body = document.getElementById(`body-${type}-${i}`);
    if (body) body.classList.add('open');
    if (field) {
      const el = document.querySelector(`[data-id="${type}-${i}"][data-field="${field}"]`);
      if (el) el.classList.add('validation-error');
    }
  });

  errEl.className = 'alert alert-error';
  errEl.dataset.validationMessage = '1';
  errEl.innerHTML = `<strong>Warning: ${issues.length} issue${issues.length > 1 ? 's' : ''} found - review before downloading:</strong><br>` +
    issues.slice(0, 8).map(x => `- ${escHtml(x.msg)}`).join('<br>') +
    (issues.length > 8 ? `<br><em>...and ${issues.length - 8} more</em>` : '');
  errEl.classList.remove('hidden');
  errEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  return false;
}

// ---------------------------------------------
// Source metadata helpers
// ---------------------------------------------
function getSourceMeta() {
  const name   = document.getElementById('sourceName').value.trim() || 'Homebrew';
  const abbr   = document.getElementById('sourceAbbr').value.trim().toUpperCase()
                   || name.split(/\s+/).map(w => w[0]).join('').toUpperCase() || 'HB';
  const author = document.getElementById('sourceAuthor').value.trim() || 'Homebrew';
  const yearEl = document.getElementById('sourceYear');
  const yearRaw = yearEl?.value.trim() || '';
  const year = parsePublicationYear(yearRaw) || inferPublicationYear(name) || 0;
  const slug   = name.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g, '') || 'homebrew';
  const prefix = 'ID_' + abbr.replace(/[^A-Z0-9]/g,'_');
  const evidence = getRulesetEvidence(yearEl);
  if (year >= 2024) evidence.unshift(`Publication year ${year}`);
  const uniqueEvidence = Array.from(new Set(evidence.filter(Boolean)));
  const ruleset = (year >= 2024 || uniqueEvidence.length) ? '2024' : '2014';
  const rulesetConfidence = year >= 2024 ? 'explicit-year' : (uniqueEvidence.length ? '5.5e-signal' : 'default');
  const rulesetDecision = ruleset === '2024'
    ? `2024 ruleset (${uniqueEvidence.join('; ') || 'publication year'})`
    : '2014 ruleset (default: no 2024 publication year or 5.5e-only signal detected)';
  return { name, abbr, author, year, ruleset, rulesetConfidence, rulesetEvidence: uniqueEvidence, rulesetDecision, slug, prefix };
}

function parsePublicationYear(text) {
  const m = String(text || '').match(/\b(19\d{2}|20\d{2})\b/);
  if (!m) return 0;
  const year = parseInt(m[1], 10);
  return year >= 1974 && year <= 2100 ? year : 0;
}

function inferPublicationYear(text) {
  const years = Array.from(String(text || '').matchAll(/\b(19\d{2}|20\d{2})\b/g))
    .map(match => parseInt(match[1], 10))
    .filter(year => year >= 1974 && year <= 2100);
  if (!years.length) return 0;
  return Math.max(...years);
}

const MODERN_RULESET_SIGNALS = [
  { pattern: /\borigin feats?\b/i, label: 'Origin Feat' },
  { pattern: /\b(epic boon|boon feat)s?\b/i, label: 'Epic Boon feat' },
  { pattern: /\bweapon mastery\b/i, label: 'Weapon Mastery' },
  { pattern: /\bmastery propert(?:y|ies)\b/i, label: 'Weapon Mastery property' },
  { pattern: /\bmagic action\b/i, label: 'Magic action' },
  { pattern: /\butilize action\b/i, label: 'Utilize action' },
  { pattern: /\binfluence action\b/i, label: 'Influence action' },
  { pattern: /\bstudy action\b/i, label: 'Study action' },
  { pattern: /\bd20 tests?\b/i, label: 'D20 Test' },
  { pattern: /\bheroic inspiration\b/i, label: 'Heroic Inspiration' },
  { pattern: /\busing a higher-level spell slot\b/i, label: '2024 upcast wording' },
  { pattern: /\bself\s*\([^)]*\bemanation\b[^)]*\)/i, label: 'Emanation area' },
  { pattern: /\b\d+\s*-?\s*foot\s+emanation\b/i, label: 'Emanation area' },
  { pattern: /\bbastion (?:facilit(?:y|ies)|turn|points?|defender|order|event)s?\b/i, label: 'Bastion rules' }
];

function detectModernRulesetSignals(text) {
  const src = String(text || '');
  const hits = [];
  for (const signal of MODERN_RULESET_SIGNALS) {
    if (signal.pattern.test(src) && !hits.includes(signal.label)) hits.push(signal.label);
  }
  return hits;
}

function detectModernRulesetSignal(text) {
  return detectModernRulesetSignals(text)[0] || '';
}

function getRulesetEvidence(yearEl) {
  return String(yearEl?.dataset?.rulesetEvidence || '')
    .split('|')
    .map(part => part.trim())
    .filter(Boolean);
}

function updateSourceRulesetDecisionDisplay() {
  const el = document.getElementById('sourceRulesetDecision');
  if (!el) return;
  el.textContent = getSourceMeta().rulesetDecision;
}

function isModernRuleset(meta) {
  return meta?.ruleset === '2024';
}

function autoFillAbbr(nameVal) {
  const abbrEl = document.getElementById('sourceAbbr');
  if (abbrEl && !abbrEl.dataset.userEdited) {
    abbrEl.value = nameVal.split(/\s+/).map(w => (w.match(/[A-Za-z0-9]/) || [''])[0]).join('').toUpperCase().slice(0,6);
  }
}

// Mark abbreviation as user-edited so auto-fill stops overwriting
document.addEventListener('DOMContentLoaded', () => {
  const abbrEl = document.getElementById('sourceAbbr');
  if (abbrEl) abbrEl.addEventListener('input', () => { abbrEl.dataset.userEdited = '1'; });
});

// ---------------------------------------------
// Generic element XML generator (fallback for unknown types)
// ---------------------------------------------
function genGenericXml(item, type, source, prefix) {
  const typeName = type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
  const typeSegment = idify(type); // uppercase, underscores only
  const id = `${prefix}_${typeSegment}_${idify(item.name || 'UNNAMED')}`;
  const lines = [];
  lines.push(`\t<element name="${escAttrXml(item.name || '')}" type="${escAttrXml(typeName)}" source="${escAttrXml(source)}" id="${id}">`);
  // Add supports for types that use it as a grouping mechanism
  if (['Race','Background','Language','Feat','Class'].includes(typeName)) {
    lines.push(`\t\t<supports>${escXml(typeName)}</supports>`);
  }
  lines.push(`\t\t<description>`);
  if (item.description) lines.push(`\t\t\t<p>${escXml(item.description)}</p>`);
  lines.push(`\t\t</description>`);
  lines.push(`\t\t<sheet>`);
  lines.push(`\t\t\t<description>${escXml(item.description || '')}</description>`);
  lines.push(`\t\t</sheet>`);
  lines.push(`\t\t<rules>`);
  // Grant any sub-features (racial traits, class features, background features, etc.)
  (item.features || []).forEach(f => {
    if (f.name) {
      const fid = `${id}_${idify(f.name)}`;
      lines.push(`\t\t\t<grant type="${escAttrXml(typeName)} Feature" id="${fid}" />`);
    }
  });
  lines.push(`\t\t</rules>`);
  lines.push(`\t</element>`);
  // Generate child feature elements
  (item.features || []).forEach(f => {
    if (!f.name) return;
    const fid = `${id}_${idify(f.name)}`;
    lines.push(`\t<element name="${escAttrXml(f.name)}" type="${escAttrXml(typeName)} Feature" source="${escAttrXml(source)}" id="${fid}">`);
    lines.push(`\t\t<compendium display="false" />`);
    lines.push(`\t\t<description><p>${escXml(f.description || '')}</p></description>`);
    lines.push(`\t\t<sheet><description>${escXml(f.description || '')}</description></sheet>`);
    lines.push(`\t\t<rules></rules>`);
    lines.push(`\t</element>`);
  });
  return lines;
}

// ---------------------------------------------
// Per-type file names and generators
// ---------------------------------------------
const FILE_SLUGS = {
  spell:     'spells',
  archetype: 'archetypes',
  item:      'items',
  feat:      'feats',
  magic:     'magic-items',
  race:      'races',
  background:'backgrounds',
  class:     'classes',
};

function getFileName(type, abbr) {
  const base = FILE_SLUGS[type]
    || type.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const a = (abbr || '').toLowerCase();
  return a ? `${a}-${base}.xml` : `${base}.xml`;
}

function dispatchGen(item, type, source, prefix, meta) {
  if (item._error) return [];
  if (type === 'spell')     return genSpellXml(item, source, prefix, meta);
  if (type === 'archetype') return genArchetypeXml(item, source, prefix, meta);
  if (type === 'item')      return genItemXml(item, source, prefix);
  if (type === 'feat')      return genFeatXml(item, source, prefix, meta);
  if (type === 'magic')     return genMagicXml(item, source, prefix);
  if (type === 'race')       return genRaceXml(item, source, prefix, meta);
  if (type === 'background') return genBackgroundXml(item, source, prefix, meta);
  if (type === 'class')      return genClassXml(item, source, prefix, meta);
  // 'other' uses the element's own type field (e.g. 'Race', 'Class') for the XML type attribute
  const resolvedType = (type === 'other' && item.type) ? item.type : type;
  return genGenericXml(item, resolvedType, source, prefix);
}

// ---------------------------------------------
// Source XML generator
// ---------------------------------------------
function genSourceXml(meta, fileList) {
  const today = new Date();
  const release = `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`;
  const lines = [];
  lines.push(`<?xml version="1.0" encoding="utf-8" ?>`);
  lines.push(`<elements>`);
  lines.push(`\t<info>`);
  lines.push(`\t\t<name>${escXml(meta.name)}</name>`);
  lines.push(`\t\t<description>Elements from ${escXml(meta.name)}.</description>`);
  lines.push(`\t\t<update version="0.1.0">`);
  lines.push(`\t\t\t<file name="source.xml" url="source.xml" />`);
  fileList.forEach(f => lines.push(`\t\t\t<file name="${escAttrXml(f)}" url="${escAttrXml(f)}" />`));
  lines.push(`\t\t</update>`);
  lines.push(`\t</info>`);
  lines.push('');
  lines.push(`\t<element name="${escAttrXml(meta.name)}" type="Source" source="${escAttrXml(meta.name)}" id="${meta.prefix}_SOURCE_${idify(meta.name)}">`);
  lines.push(`\t\t<description>`);
  lines.push(`\t\t\t<p>Elements from ${escXml(meta.name)}.</p>`);
  lines.push(`\t\t</description>`);
  lines.push(`\t\t<setters>`);
  lines.push(`\t\t\t<set name="abbreviation">${escXml(meta.abbr)}</set>`);
  lines.push(`\t\t\t<set name="url"></set>`);
  lines.push(`\t\t\t<set name="author" abbreviation="${escAttrXml(meta.abbr)}" url="">${escXml(meta.author)}</set>`);
  lines.push(`\t\t\t<set name="homebrew">true</set>`);
  lines.push(`\t\t\t<set name="release">${release}</set>`);
  lines.push(`\t\t</setters>`);
  lines.push(`\t</element>`);
  lines.push('');
  lines.push(`</elements>`);
  return lines.join('\n');
}

// ---------------------------------------------
// Per-type XML file generator
// ---------------------------------------------
function genTypeXml(type, items, meta) {
  const { name: source, slug, prefix, abbr } = meta;
  const fileName = getFileName(type, abbr);
  const lines = [];
  lines.push(`<?xml version="1.0" encoding="utf-8" ?>`);
  lines.push(`<elements>`);
  lines.push(`\t<info>`);
  lines.push(`\t\t<name>${escXml(source)} - ${escXml(TYPE_LABELS[type] || type)}</name>`);
  lines.push(`\t\t<update version="0.1.0">`);
  lines.push(`\t\t\t<file name="${escAttrXml(fileName)}" url="${escAttrXml(fileName)}" />`);
  lines.push(`\t\t</update>`);
  lines.push(`\t</info>`);
  lines.push('');
  for (const item of items) {
    const elLines = dispatchGen(item, type, source, prefix, meta);
    if (elLines.length) { lines.push(...elLines); lines.push(''); }
  }
  appendSharedTypeElements(lines, type, items, source, meta);
  lines.push(`</elements>`);
  return lines.join('\n');
}

function appendSharedTypeElements(lines, type, items, source, meta) {
  if (type !== 'feat' || !(items || []).some(feat => isMarkOfFeatName(normalizeExtractedName(feat?.name || '')))) return;
  genDragonmarkSpellcastingAbilityFeatures(source, meta).forEach(elLines => {
    lines.push(...elLines);
    lines.push('');
  });
}

// ---------------------------------------------
// ZIP download
// ---------------------------------------------
async function downloadZip() {
  const meta = getSourceMeta();
  const issues = validateAll();
  if (!showValidationResult(issues)) {
    if (!confirm(`There are ${issues.length} validation issue(s). Download anyway?`)) return;
  }
  const zip = new JSZip();
  const folder = zip.folder(meta.slug);
  buildZipXmlDocuments(meta).forEach(doc => folder.file(doc.fileName, doc.xml));

  // Include skipped elements report if any were filtered
  const skippedReport = generateSkippedReport(skippedItems, meta.name);
  if (skippedReport) {
    folder.file('skipped-elements.txt', skippedReport);
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${meta.slug}.zip`;
  a.click();
  URL.revokeObjectURL(url);
  clearChanged();

  // Refresh preview if open
  const wrap = document.getElementById('xmlPreviewWrap');
  if (!wrap.classList.contains('hidden')) {
    document.getElementById('xmlPreview').textContent = generateXml();
  }
}


function generateXml() {
  // Single-file mode: all types combined in one XML
  const meta = getSourceMeta();
  const { name: source, prefix } = meta;
  const lines = [];

  lines.push(`<?xml version="1.0" encoding="utf-8" ?>`);
  lines.push(`<elements>`);
  lines.push(`\t<info>`);
  lines.push(`\t\t<name>${escXml(source)}</name>`);
  lines.push(`\t\t<description>Elements extracted from ${escXml(source)}.</description>`);
  lines.push(`\t\t<author url="">${escXml(meta.author)}</author>`);
  lines.push(`\t\t<update version="0.1.0">`);
  lines.push(`\t\t\t<file name="${escAttrXml(meta.slug)}.xml" url="${escAttrXml(meta.slug)}.xml" />`);
  lines.push(`\t\t</update>`);
  lines.push(`\t</info>`);
  lines.push('');

  for (const [type, items] of Object.entries(extractedData)) {
    if (!items.length) continue;
    const sectionLabel = type === 'other'
      ? [...new Set(items.map(i => i.type || 'Other').filter(Boolean))].join(', ').toUpperCase()
      : (TYPE_LABELS[type] || type).toUpperCase();
    lines.push(`\t<!-- ===== ${escXmlComment(sectionLabel)} ===== -->`);
    for (const item of items) {
      const elLines = dispatchGen(item, type, source, prefix, meta);
      if (elLines.length) { lines.push(...elLines); lines.push(''); }
    }
    appendSharedTypeElements(lines, type, items, source, meta);
  }

  lines.push(`</elements>`);
  return lines.join('\n');
}

function idify(name) {
  return name.toUpperCase().replace(/['’]S\b/g, 'S').replace(/[^A-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g,'');
}

function rule(xml, summary = '', sourceText = '', options = {}) {
  return { xml, summary, sourceText, allowDuplicate: !!options.allowDuplicate };
}

function escXmlComment(s) {
  const cleaned = escXml(String(s || '')).replace(/--+/g, '- -');
  return cleaned.endsWith('-') ? `${cleaned} ` : cleaned;
}

function renderRuleLines(lines, rules) {
  (rules || []).forEach(r => {
    if (!r) return;
    if (typeof r === 'string') {
      lines.push(r);
      return;
    }
    const comment = r.summary || r.sourceText || '';
    if (comment) lines.push(`\t\t\t<!-- Source rule: ${escXmlComment(comment)} -->`);
    lines.push(r.xml);
  });
}

function uniqueTokens(tokens) {
  const seen = new Set();
  return (tokens || []).map(token => String(token || '').trim()).filter(token => {
    if (!token || seen.has(token.toLowerCase())) return false;
    seen.add(token.toLowerCase());
    return true;
  });
}

function spellSearchText(spell) {
  return [
    spell.name,
    spell.description,
    spell.higherLevels,
    spell.castingTime,
    spell.range,
    spell.duration
  ].filter(Boolean).join(' ');
}

function directSpellSavingThrowAbilities(spell) {
  const primaryEffect = String(spell.description || '')
    .split(/\bgain the following benefits\b/i)[0]
    .replace(/([A-Za-z])-\s*\n\s*([A-Za-z])/g, '$1$2')
    .replace(/\s+/g, ' ');
  const abilities = [];
  const expression = /\b(?:the target|each creature|a creature)\b[^.]{0,180}?\bmust\s+(?:make|succeed on)\s+(?:a|an)\s+(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+saving throw/gi;
  for (const match of primaryEffect.matchAll(expression)) abilities.push(titleCase(match[1]));
  return uniqueTokens(abilities);
}

function inferSpellSupportTokens(spell, meta) {
  const text = spellSearchText(spell);
  const lower = text.toLowerCase();
  const supports = [...(spell.classes || [])];

  if (/\bmelee spell attack\b/i.test(text)) supports.push('Melee', 'Spell Attack');
  else if (/\branged spell attack\b/i.test(text)) supports.push('Ranged', 'Spell Attack');
  else if (/\bspell attack\b/i.test(text)) supports.push('Spell Attack');

  if (spell.tableMetadata) {
    const savingThrowAbilities = directSpellSavingThrowAbilities(spell);
    if (savingThrowAbilities.length) supports.push(...savingThrowAbilities, 'Spell Saving Throw');
  } else if (/\bsaving throw\b/i.test(text)) {
    supports.push('Spell Saving Throw');
  }

  if (isModernRuleset(meta)) {
    const hasDamage = /\bdamage\b/i.test(text) || /\b(acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder)\b/i.test(text);
    const hasHealing = /\b(regain|regains|restore|restores|increase|increases)[^.]{0,80}\b(hit points|hit point maximum)\b/i.test(lower)
      || /\bhealing\b/i.test(lower);
    if (hasDamage) supports.push('Damaging Spell');
    if (hasHealing) supports.push('Healing Spell');
  }

  return uniqueTokens(supports);
}

function inferSpellKeywords(spell, meta) {
  if (spell.keywords) return spell.keywords;

  const text = spellSearchText(spell);
  const lower = text.toLowerCase();
  const tokens = [];
  const addIf = (pattern, token) => { if (pattern.test(lower)) tokens.push(token); };

  [
    'acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic',
    'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder'
  ].forEach(type => addIf(new RegExp(`\\b${type}\\b`, 'i'), type));

  ['cone', 'cube', 'cylinder', 'line', 'sphere', 'emanation', 'square'].forEach(shape => {
    addIf(new RegExp(`\\b${shape}\\b`, 'i'), shape);
  });

  ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'].forEach(ability => {
    addIf(new RegExp(`\\b${ability}\\b`, 'i'), ability);
  });

  [
    'blinded', 'charmed', 'deafened', 'frightened', 'grappled', 'incapacitated',
    'invisible', 'paralyzed', 'poisoned', 'prone', 'restrained', 'stunned', 'unconscious'
  ].forEach(condition => addIf(new RegExp(`\\b${condition}\\b`, 'i'), condition));

  if (/\bsaving throw\b/i.test(text)) tokens.push('save');
  if (/\bdamage\b/i.test(text)) tokens.push('damage');
  if (/\badvantage\b/i.test(text)) tokens.push('advantage');
  if (/\bdisadvantage\b/i.test(text)) tokens.push('disadvantage');
  if (/\bability checks?\b/i.test(text)) tokens.push('ability checks');
  if (/\bsaving throws?\b/i.test(text)) tokens.push('saving throws', 'saves');
  if (/\bregain|regains|restore|restores|hit points?\b/i.test(lower)) tokens.push('healing');
  if (spell.higherLevels) {
    tokens.push(isModernRuleset(meta) ? 'upcasting' : 'higher levels');
    if (isModernRuleset(meta)) tokens.push('higher-level spell slot');
  }
  if (spell.isTechnomagic) tokens.push('technomagic');

  return uniqueTokens(tokens).join(', ');
}

function usesSparseLegacySpellSetters(meta) {
  const year = Number(meta?.year);
  return Number.isInteger(year) && year >= 2020 && year <= 2021;
}

function genSpellXml(s, source, prefix, meta) {
  const id = `${prefix}_SPELL_${idify(s.name)}`;
  const supports = inferSpellSupportTokens(s, meta).join(', ');
  const keywords = inferSpellKeywords(s, meta);
  const modernRules = isModernRuleset(meta);
  const sparseLegacySetters = !modernRules && usesSparseLegacySpellSetters(meta);
  const lines = [];
  lines.push(`\t<element name="${escAttrXml(s.name)}" type="Spell" source="${escAttrXml(source)}" id="${id}">`);
  lines.push(`\t\t<supports>${escXml(supports)}</supports>`);
  lines.push(`\t\t<description>`);
  lines.push(`\t\t\t<p>${escXml(s.description || '')}</p>`);
  if (s.higherLevels) {
    const upcastLabel = isModernRuleset(meta) ? 'Using a Higher-Level Spell Slot.' : 'At Higher Levels.';
    lines.push(`\t\t\t<p class="indent"><b><i>${upcastLabel}</i></b> ${escXml(s.higherLevels)}</p>`);
  }
  lines.push(`\t\t</description>`);
  lines.push(`\t\t<setters>`);
  if (modernRules) {
    if (keywords) lines.push(`\t\t\t<set name="keywords">${escXml(keywords)}</set>`);
  } else if (!sparseLegacySetters) {
    lines.push(`\t\t\t<set name="keywords">${escXml(keywords)}</set>`);
  }
  lines.push(`\t\t\t<set name="level">${s.level}</set>`);
  lines.push(`\t\t\t<set name="school">${escXml(s.school)}</set>`);
  lines.push(`\t\t\t<set name="time">${escXml(s.castingTime)}</set>`);
  if (modernRules) {
    if (s.isRitual) lines.push(`\t\t\t<set name="isRitual">true</set>`);
    lines.push(`\t\t\t<set name="range">${escXml(s.range)}</set>`);
    if (s.hasVerbal) lines.push(`\t\t\t<set name="hasVerbalComponent">true</set>`);
    if (s.hasSomatic) lines.push(`\t\t\t<set name="hasSomaticComponent">true</set>`);
    if (s.hasMaterial || s.material) lines.push(`\t\t\t<set name="hasMaterialComponent">true</set>`);
    if (s.material) lines.push(`\t\t\t<set name="materialComponent">${escXml(s.material)}</set>`);
    if (s.isConcentration) lines.push(`\t\t\t<set name="isConcentration">true</set>`);
    lines.push(`\t\t\t<set name="duration">${escXml(s.duration)}</set>`);
  } else {
    lines.push(`\t\t\t<set name="duration">${escXml(s.duration)}</set>`);
    lines.push(`\t\t\t<set name="range">${escXml(s.range)}</set>`);
    lines.push(`\t\t\t<set name="hasVerbalComponent">${!!s.hasVerbal}</set>`);
    lines.push(`\t\t\t<set name="hasSomaticComponent">${!!s.hasSomatic}</set>`);
    lines.push(`\t\t\t<set name="hasMaterialComponent">${!!(s.hasMaterial || s.material)}</set>`);
    if (s.material) lines.push(`\t\t\t<set name="materialComponent">${escXml(s.material)}</set>`);
    else if (!sparseLegacySetters) lines.push(`\t\t\t<set name="materialComponent" />`);
    if (s.isConcentration || !sparseLegacySetters) lines.push(`\t\t\t<set name="isConcentration">${!!s.isConcentration}</set>`);
    if (s.isRitual || !sparseLegacySetters) lines.push(`\t\t\t<set name="isRitual">${!!s.isRitual}</set>`);
  }
  lines.push(`\t\t</setters>`);
  lines.push(`\t</element>`);
  return lines;
}

function genArchetypeXml(a, source, prefix, meta) {
  const archSegment = idify(a.name);
  const archId = `${prefix}_ARCHETYPE_${archSegment}`;
  const lines = [];
  lines.push(`\t<element name="${escAttrXml(a.name)}" type="Archetype" source="${escAttrXml(source)}" id="${archId}">`);
  lines.push(`\t\t<supports>${escXml(a.supports||'')}</supports>`);
  lines.push(`\t\t<description>`);
  lines.push(`\t\t\t<p>${escXml(a.description||'')}</p>`);
  (a.features||[]).forEach(f => {
    const fid = `${prefix}_ARCHETYPE_FEATURE_${archSegment}_${archetypeFeatureSegment(a, f)}`;
    lines.push(`\t\t\t<div element="${fid}" />`);
  });
  lines.push(`\t\t</description>`);
  lines.push(`\t\t<sheet display="false" />`);
  lines.push(`\t\t<rules>`);
  (a.features||[]).forEach(f => {
    const fid = `${prefix}_ARCHETYPE_FEATURE_${archSegment}_${archetypeFeatureSegment(a, f)}`;
    lines.push(`\t\t\t<grant type="Archetype Feature" id="${fid}" level="${f.level}" />`);
  });
  lines.push(`\t\t</rules>`);
  lines.push(`\t</element>`);

  (a.features||[]).forEach(f => {
    const fid = `${prefix}_ARCHETYPE_FEATURE_${archSegment}_${archetypeFeatureSegment(a, f)}`;
    const featureRules = inferArchetypeFeatureRules(a, f, meta);
    lines.push(`\t<element name="${escAttrXml(archetypeFeatureDisplayName(a, f))}" type="Archetype Feature" source="${escAttrXml(source)}" id="${fid}">`);
    lines.push(`\t\t<compendium display="false" />`);
    lines.push(`\t\t<description>`);
    lines.push(`\t\t\t<p><em>${f.level}${ordinal(f.level)}-level ${escXml(a.name)} feature</em></p>`);
    lines.push(`\t\t\t<p>${escXml(f.description||'')}</p>`);
    lines.push(`\t\t</description>`);
    const sheetAttrs = [
      f.action ? `action="${escAttrXml(f.action)}"` : '',
      f.usage ? `usage="${escAttrXml(f.usage)}"` : ''
    ].filter(Boolean).join(' ');
    lines.push(`\t\t<sheet${sheetAttrs ? ' '+sheetAttrs : ''}>`);
    lines.push(`\t\t\t<description>${escXml(f.description||'')}</description>`);
    lines.push(`\t\t</sheet>`);
    lines.push(`\t\t<rules>`);
    renderRuleLines(lines, featureRules);
    lines.push(`\t\t</rules>`);
    lines.push(`\t</element>`);
  });

  return lines;
}

function archetypeFeatureSegment(archetype, feature) {
  const archetypeName = normalizeExtractedName(archetype?.name || '');
  let featureName = normalizeExtractedName(feature?.name || '');
  const prefix = `${archetypeName} `;
  if (featureName.toLowerCase().startsWith(prefix.toLowerCase())) {
    featureName = featureName.slice(prefix.length);
  }
  return idify(featureName);
}

function archetypeFeatureDisplayName(archetype, feature) {
  const name = normalizeExtractedName(feature?.name || '');
  if (/^(Tools of the Trade|Extra Attack)$/i.test(name)) return `${name} (${normalizeExtractedName(archetype?.name || '')})`;
  return name;
}

function inferArchetypeFeatureRules(archetype, feature, meta) {
  const rules = [];
  const text = String(feature?.description || '');
  const lower = text.toLowerCase();
  const featureName = normalizeExtractedName(feature?.name || '');
  const grantsProficiencies = /^(Tools of the Trade|Battle Ready)$/i.test(featureName);

  if (grantsProficiencies) {
    for (const tool of Object.keys(TOOL_PROFICIENCY_IDS)) {
      if (new RegExp(`\\b${escapeRegExp(tool).replace(/['’]/g, "['’]?")}\\b`, 'i').test(text)) {
        rules.push(rule(
          `\t\t\t<grant type="Proficiency" id="${TOOL_PROFICIENCY_IDS[tool]}" />`,
          `Gain proficiency with ${tool}.`,
          text
        ));
      }
    }

    const proficiencies = {
      'heavy armor': 'ID_PROFICIENCY_ARMOR_PROFICIENCY_HEAVY_ARMOR',
      'martial weapons': 'ID_PROFICIENCY_WEAPON_PROFICIENCY_MARTIAL_WEAPONS',
      'martial ranged weapons': 'ID_PROFICIENCY_WEAPON_PROFICIENCY_MARTIAL_RANGED_WEAPONS'
    };
    Object.entries(proficiencies).forEach(([phrase, id]) => {
      if (lower.includes(phrase)) {
        rules.push(rule(
          `\t\t\t<grant type="Proficiency" id="${id}" />`,
          `Gain proficiency with ${phrase}.`,
          text
        ));
      }
    });
  }

  [
    'acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic',
    'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder'
  ].forEach(type => {
    if (new RegExp(`\\bresistance to [^.]{0,120}\\b${type} damage\\b|\\b${type} damage resistance\\b`, 'i').test(lower)) {
      rules.push(rule(
        `\t\t\t<grant type="Condition" id="ID_INTERNAL_CONDITION_DAMAGE_RESISTANCE_${idify(type)}" />`,
        `Gain resistance to ${type} damage.`,
        text
      ));
    }
  });

  if (/^Extra Attack$/i.test(feature?.name || '') || /\battack twice, instead of once\b/i.test(text)) {
    rules.push(rule(
      `\t\t\t<stat name="extra attack:count" value="2" level="${parseInt(feature.level, 10) || 5}" bonus="extra attack" />`,
      'Increase Extra Attack count to 2.',
      text
    ));
  }

  inferArchetypeMechanicRules(archetype, feature, meta).forEach(featureRule => rules.push(featureRule));
  inferPreparedSpellRulesFromText(text, archetype?.class || '', meta).forEach(spellRule => rules.push(spellRule));

  return dedupeRules(rules);
}

function inferArchetypeMechanicRules(archetype, feature, meta) {
  const rules = [];
  const text = String(feature?.description || '');
  const featureName = normalizeExtractedName(feature?.name || '');
  const archetypeName = normalizeExtractedName(archetype?.name || '');
  const prefix = meta?.prefix || 'ID_SOURCE';

  if (/^Experimental Elixir$/i.test(featureName) && /\btwo elixirs\b/i.test(text)) {
    rules.push(rule(
      `\t\t\t<stat name="alchemist:elixirs:max" value="2" level="${parseInt(feature.level, 10) || 3}" />`,
      'Produce two elixirs at the base feature level.',
      text
    ));
    for (const level of [5, 9, 15]) {
      if (new RegExp(`\\b(?:level|levels?)\\s+${level}\\b|\\bat level ${level}\\b`, 'i').test(text)) {
        rules.push(rule(
          `\t\t\t<stat name="alchemist:elixirs:max" value="1" level="${level}" />`,
          `Increase the Long Rest elixir count at Artificer level ${level}.`,
          text
        ));
      }
    }
  }

  if (/^Eldritch Cannon$/i.test(featureName) && /^Artillerist$/i.test(archetypeName)) {
    for (let i = 0; i < 5; i++) {
      rules.push(rule(
        `\t\t\t<stat name="cannon:hp" value="level:artificer" />`,
        i === 0 ? 'Add five times Artificer level to the cannon hit point formula.' : '',
        i === 0 ? text : '',
        { allowDuplicate: true }
      ));
    }
  }

  if (/^Steel Defender$/i.test(featureName) && /^Battle Smith$/i.test(archetypeName)) {
    rules.push(rule(
      `\t\t\t<select type="Companion" name="Steel Defender" supports="${escAttrXml((meta?.abbr || 'SRC').replace(/[^A-Z0-9]/g, '_'))} Steel Defender" default="${prefix}_COMPANION_ARTIFICER_STEEL_DEFENDER" />`,
      'Select the Steel Defender companion.',
      text
    ));
  }

  if (/^Adventurer's Atlas$/i.test(featureName) && /\bmaximum number of creatures equal to 1 plus your Intelligence modifier\b/i.test(text)) {
    rules.push(rule(
      `\t\t\t<stat name="atlas:targets" value="1" />`,
      'Set the Adventurer\'s Atlas target-count base.',
      text
    ));
    rules.push(rule(
      `\t\t\t<stat name="atlas:targets" value="intelligence:modifier" />`,
      'Add Intelligence modifier to Adventurer\'s Atlas targets.',
      text
    ));
  }

  if (/^Superior Atlas$/i.test(featureName) && /\btwice your Artificer level\b/i.test(text)) {
    for (let i = 0; i < 2; i++) {
      rules.push(rule(
        `\t\t\t<stat name="atlas:safe haven:hp" value="level:artificer" />`,
        i === 0 ? 'Set Safe Haven hit points to twice Artificer level.' : '',
        i === 0 ? text : '',
        { allowDuplicate: true }
      ));
    }
  }

  return rules;
}

function inferPreparedSpellRulesFromText(text, spellcastingClass, meta) {
  const rules = [];
  const lines = String(text || '').split(/\n+/);
  let inSpellTable = false;
  lines.forEach(line => {
    if (/^\|.*\bspells?\b.*\|$/i.test(line)) {
      inSpellTable = true;
      return;
    }
    if (/^\|\s*:?-{3,}:?\s*\|/.test(line)) return;
    if (!/^\|/.test(line)) {
      inSpellTable = false;
      return;
    }
    if (!inSpellTable) return;
    const row = line.match(/^\|\s*(\d+)\s*\|\s*(.+?)\s*\|$/);
    if (!row) return;
    splitListValue(row[2]).forEach(spell => {
      const spellId = canonicalSpellId(spell, meta);
      if (!spellId) return;
      const spellcastingAttr = spellcastingClass ? ` spellcasting="${escAttrXml(spellcastingClass)}"` : '';
      rules.push(rule(
        `\t\t\t<grant type="Spell" id="${spellId}" level="${parseInt(row[1], 10)}" prepared="true"${spellcastingAttr} />`,
        `Always prepare ${spell} at ${spellcastingClass || 'the listed'} level ${row[1]}.`,
        line
      ));
    });
  });

  const prepared = String(text || '').matchAll(/\balways have\s+(?:the\s+)?([A-Z][A-Za-z'’ -]+?)\s+spell prepared\b/gi);
  for (const match of prepared) {
    const spell = normalizeExtractedName(match[1]);
    const spellId = canonicalSpellId(spell, meta);
    if (!spellId) continue;
    const spellcastingAttr = spellcastingClass ? ` spellcasting="${escAttrXml(spellcastingClass)}"` : '';
    rules.push(rule(
      `\t\t\t<grant type="Spell" id="${spellId}" prepared="true"${spellcastingAttr} />`,
      `Always prepare ${spell}.`,
      match[0]
    ));
  }
  const castWithoutSlot = String(text || '').trim().match(/^\s*You can cast\s+(?:the\s+)?([A-Z][A-Za-z'’ -]+?)\s+without expending\b/i);
  if (castWithoutSlot) {
    const match = castWithoutSlot;
    const spell = normalizeExtractedName(match[1]);
    const spellId = canonicalSpellId(spell, meta);
    if (spellId) {
      const spellcastingAttr = spellcastingClass ? ` spellcasting="${escAttrXml(spellcastingClass)}"` : '';
      rules.push(rule(
        `\t\t\t<grant type="Spell" id="${spellId}" prepared="true"${spellcastingAttr} />`,
        `Always prepare ${spell}.`,
        match[0]
      ));
    }
  }

  return rules;
}

function canonicalSpellId(name, meta) {
  const spell = normalizeExtractedName(name).replace(/\s+spell$/i, '');
  if (!spell) return '';
  const prefix = isModernRuleset(meta) ? 'ID_WOTC_PHB24_SPELL' : 'ID_PHB_SPELL';
  return `${prefix}_${idify(spell)}`;
}

function dedupeRules(rules) {
  const seen = new Set();
  let duplicateIndex = 0;
  return (rules || []).filter(r => {
    const key = r?.allowDuplicate ? `${r.xml}#${duplicateIndex++}` : (r?.xml || String(r || ''));
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function escapeRegExp(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function genItemXml(item, source, prefix) {
  const id = `${prefix}_ITEM_${idify(item.name)}`;
  const lines = [];
  lines.push(`\t<element name="${escAttrXml(item.name)}" type="Item" source="${escAttrXml(source)}" id="${id}">`);
  lines.push(`\t\t<description><p>${escXml(item.description||'')}</p></description>`);
  lines.push(`\t\t<sheet>`);
  lines.push(`\t\t\t<description>${escXml(item.description||'')}</description>`);
  lines.push(`\t\t</sheet>`);
  lines.push(`\t\t<setters>`);
  lines.push(`\t\t\t<set name="category">${escXml(item.category||'Equipment')}</set>`);
  lines.push(`\t\t\t<set name="cost" currency="${escXml(item.currency||'gp')}">${escXml(item.cost||'0')}</set>`);
  lines.push(`\t\t\t<set name="weight" lb="${escXml(item.weight||'0')}">${escXml(item.weight||'0')} lb.</set>`);
  if (item.damage) lines.push(`\t\t\t<set name="damage">${escXml(item.damage)}</set>`);
  if (item.properties) lines.push(`\t\t\t<set name="properties">${escXml(item.properties)}</set>`);
  lines.push(`\t\t</setters>`);
  lines.push(`\t</element>`);
  return lines;
}

function inferFeatRules(feat, meta) {
  const rules = [];
  const featName = normalizeExtractedName(feat?.name || '');
  const benefits = Array.isArray(feat?.benefits) ? feat.benefits : [];
  const allText = [
    feat?.description || '',
    ...benefits.map(b => typeof b === 'string' ? b : (b.text || ''))
  ].join('\n');

  const abilityMap = {
    'strength': 'strength', 'str': 'strength',
    'dexterity': 'dexterity', 'dex': 'dexterity',
    'constitution': 'constitution', 'con': 'constitution',
    'intelligence': 'intelligence', 'int': 'intelligence',
    'wisdom': 'wisdom', 'wis': 'wisdom',
    'charisma': 'charisma', 'cha': 'charisma'
  };

  const skillMap = {
    'acrobatics': 'acrobatics', 'animal handling': 'animal handling',
    'arcana': 'arcana', 'athletics': 'athletics', 'deception': 'deception',
    'history': 'history', 'insight': 'insight', 'intimidation': 'intimidation',
    'investigation': 'investigation', 'medicine': 'medicine', 'nature': 'nature',
    'perception': 'perception', 'performance': 'performance', 'persuasion': 'persuasion',
    'religion': 'religion', 'sleight of hand': 'sleight of hand',
    'stealth': 'stealth', 'survival': 'survival'
  };

  const ruleTextEntries = [feat?.description || '', ...benefits].filter(Boolean);
  ruleTextEntries.forEach(b => {
    const rawText = typeof b === 'string' ? b : b.text || '';
    const txt = rawText.toLowerCase();

    // Ability score increase: "increase your strength score by 1"
    const asiMatch = txt.match(/increase your (\w+(?:\s\w+)?) (?:score )?by (\d+)/i)
      || txt.match(/increase your (\w+(?:\s\w+)?) by (\d+)/i);
    if (asiMatch) {
      const ability = abilityMap[asiMatch[1].toLowerCase()];
      const val = parseInt(asiMatch[2]);
      if (ability && val) {
        const maxMatch = rawText.match(/\bmaximum of\s+(\d+)/i);
        const requirementAttr = maxMatch ? ` requirements="${ability}:max${parseInt(maxMatch[1], 10)}"` : '';
        rules.push(rule(
          `\t\t\t<stat name="${ability}" value="${val}"${requirementAttr} />`,
          `Increase ${ability} by ${val}.`,
          rawText
        ));
        return;
      }
    }

    const choiceAsi = txt.match(/increase (?:one ability score of your choice|the spellcasting ability score used by your dragonmark feat) by (\d+)/i);
    if (choiceAsi) {
      const supports = /^Boon of Siberys$/i.test(featName) ? 'Ability Score Increase, 30' : 'Ability Score Increase';
      rules.push(rule(
        `\t\t\t<select type="Ability Score Improvement" name="Ability Score Increase (${escAttrXml(featName)})" supports="${supports}" />`,
        `Choose an ability score increase for ${featName}.`,
        rawText
      ));
      return;
    }

    // Proficiency with a skill
    const skillProfMatch = txt.match(/gain proficiency (?:in |with )?(?:the )?(\w+(?:\s\w+)?) skill/i);
    if (skillProfMatch) {
      const skill = skillMap[skillProfMatch[1].toLowerCase()];
      if (skill) {
        const skillId = 'ID_PROFICIENCY_SKILL_' + skill.toUpperCase().replace(/\s/g, '');
        rules.push(rule(
          `\t\t\t<grant type="Proficiency" id="${skillId}" />`,
          `Gain proficiency in ${skill}.`,
          rawText
        ));
        return;
      }
    }

    // Proficiency with a tool by name (engineering kit, hacking tools, mechanic tools, etc.)
    const toolMatch = txt.match(/gain proficiency with (?:the )?(.+?)(?:\.|$)/i);
    if (toolMatch) {
      const toolName = toolMatch[1].trim().toLowerCase();
      const toolIds = {
        'mechanic tools':    'ID_MODERN_PROFICIENCY_TOOL_MECHANIC_TOOLS',
        'engineering kit':   'ID_MODERN_PROFICIENCY_TOOL_ENGINEERING_KIT',
        'hacking tools':     'ID_MODERN_PROFICIENCY_TOOL_HACKING_TOOLS',
        'disguise kit':      'ID_PROFICIENCY_TOOL_PROFICIENCY_DISGUISE_KIT',
        'vehicles (land)':   'ID_MODERN_PROFICIENCY_VEHICLES_LAND',
        'land vehicles':     'ID_MODERN_PROFICIENCY_VEHICLES_LAND',
      };
      // Check for simple weapon/armor category proficiency
      const weapCat = {
        'simple weapons': 'ID_PROFICIENCY_WEAPON_PROFICIENCY_SIMPLE_WEAPONS',
        'martial weapons': 'ID_PROFICIENCY_WEAPON_PROFICIENCY_MARTIAL_WEAPONS',
        'light armor': 'ID_PROFICIENCY_ARMOR_PROFICIENCY_LIGHT_ARMOR',
        'medium armor': 'ID_PROFICIENCY_ARMOR_PROFICIENCY_MEDIUM_ARMOR',
        'heavy armor': 'ID_PROFICIENCY_ARMOR_PROFICIENCY_HEAVY_ARMOR',
        'shields': 'ID_PROFICIENCY_ARMOR_PROFICIENCY_SHIELDS',
      };
      const tid = toolIds[toolName] || weapCat[toolName];
      if (tid) {
        rules.push(rule(
          `\t\t\t<grant type="Proficiency" id="${tid}" />`,
          `Gain proficiency with ${toolName}.`,
          rawText
        ));
        return;
      }
    }

    // Double proficiency bonus for a skill (expertise)
    const expertiseMatch = txt.match(/add twice your proficiency bonus.+?(\w+(?:\s\w+)?) (?:check|skill)/i);
    if (expertiseMatch) {
      const skill = skillMap[expertiseMatch[1].toLowerCase()];
      if (skill) {
        rules.push(rule(
          `\t\t\t<stat name="${skill}:proficiency" value="proficiency" bonus="double" />`,
          `Double proficiency bonus for ${skill}.`,
          rawText
        ));
        return;
      }
    }

    // No pattern matched - benefit is sheet-only, no rule generated
  });

  inferDragonmarkFeatRules(featName, allText, meta).forEach(featRule => rules.push(featRule));
  inferGeneralFeatRules(featName, allText, meta).forEach(featRule => rules.push(featRule));

  return dedupeRules(rules);
}

function inferDragonmarkFeatRules(featName, text, meta) {
  const rules = [];
  const src = String(text || '');
  if (!isDragonmarkFeatName(featName) && !/^Boon of Siberys$/i.test(featName)) return rules;

  if (isMarkOfFeatName(featName)) {
    rules.push(rule(
      `\t\t\t<select type="Feat Feature" name="Spellcasting Ability (${escAttrXml(featName)})" supports="${dragonmarkAbilitySupports(meta)}" />`,
      `Choose the spellcasting ability for ${featName}.`,
      src
    ));
    if (/\bSpells of the Mark\b/i.test(src)) {
      rules.push(rule(
        `\t\t\t<grant type="Feat Feature" id="${dragonmarkSpellsOfTheMarkId(featName, meta)}" />`,
        `Grant the ${featName} Spells of the Mark list extension.`,
        src
      ));
    }
  }

  if (/one cantrip of your choice from the Sorcerer spell list/i.test(src)) {
    rules.push(rule(
      `\t\t\t<select type="Spell" name="Cantrip (${escAttrXml(featName)})" supports="Sorcerer, 0" />`,
      `Choose a Sorcerer cantrip for ${featName}.`,
      src
    ));
  }
  if (/choose a level 1 spell from (?:that|the Sorcerer) spell list/i.test(src)) {
    rules.push(rule(
      `\t\t\t<select type="Spell" name="Level 1 Spell (${escAttrXml(featName)})" supports="Sorcerer, 1" />`,
      `Choose a level 1 Sorcerer spell for ${featName}.`,
      src
    ));
  }
  if (/choose a level 8 or lower spell from the Sorcerer spell list/i.test(src) && /^Boon of Siberys$/i.test(featName)) {
    rules.push(rule(
      `\t\t\t<select type="Spell" name="Siberys Spell (${escAttrXml(featName)})" supports="Sorcerer,(1||2||3||4||5||6||7||8)" />`,
      `Choose a Sorcerer spell of level 8 or lower for ${featName}.`,
      src
    ));
  }

  for (const match of src.matchAll(/(?:When you reach character level\s+(\d+),\s+(?:you\s+)?(?:also\s+)?)?(?:you\s+)?always have\s+(?:the\s+)?(.+?)\s+spells? prepared\b/gi)) {
    const level = match[1] ? parseInt(match[1], 10) : 0;
    const phrase = match[2];
    if (/\b(that|this|spells on|spell from)\b/i.test(phrase)) continue;
    splitSpellListPhrase(phrase).forEach(spell => {
      const spellId = canonicalSpellId(spell, meta);
      if (!spellId) return;
      const levelAttr = level ? ` level="${level}"` : '';
      rules.push(rule(
        `\t\t\t<grant type="Spell" id="${spellId}" prepared="true"${levelAttr} />`,
        `Always prepare ${spell}${level ? ` at character level ${level}` : ''}.`,
        match[0]
      ));
    });
  }

  for (const match of src.matchAll(/\byou know\s+(?:the\s+)?([A-Z][A-Za-z'’ -]+?)\s+cantrip\b/gi)) {
    const spell = normalizeExtractedName(match[1]);
    if (!spell || /^one$/i.test(spell)) continue;
    const spellId = canonicalSpellId(spell, meta);
    if (!spellId) continue;
    rules.push(rule(
      `\t\t\t<grant type="Spell" id="${spellId}" prepared="true" />`,
      `Know the ${spell} cantrip.`,
      match[0]
    ));
  }

  return rules;
}

function inferGeneralFeatRules(featName, text, meta) {
  const rules = [];
  const src = String(text || '');
  const lower = src.toLowerCase();
  [
    'acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic',
    'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder'
  ].forEach(type => {
    if (new RegExp(`\\bresistance to [^.]{0,120}\\b${type} damage\\b|\\b${type} damage resistance\\b`, 'i').test(lower)) {
      rules.push(rule(
        `\t\t\t<grant type="Condition" id="ID_INTERNAL_CONDITION_DAMAGE_RESISTANCE_${idify(type)}" />`,
        `Gain resistance to ${type} damage.`,
        src
      ));
    }
  });

  const speed = lower.match(/\b(?:your\s+)?speed increases by\s+(\d+)\s+feet\b/i);
  if (speed) {
    rules.push(rule(
      `\t\t\t<stat name="innate speed:misc" value="${parseInt(speed[1], 10)}" />`,
      `Increase speed by ${parseInt(speed[1], 10)} feet.`,
      speed[0]
    ));
  }

  if (/\bDC\s+8 plus your Wisdom modifier and Proficiency Bonus\b/i.test(src)) {
    rules.push(rule(`\t\t\t<stat name="subdue animal:dc" value="8" />`, 'Set Subdue Animal save DC base.', src));
    rules.push(rule(`\t\t\t<stat name="subdue animal:dc" value="wisdom:modifier" />`, 'Add Wisdom modifier to Subdue Animal save DC.', src));
    rules.push(rule(`\t\t\t<stat name="subdue animal:dc" value="proficiency" />`, 'Add proficiency to Subdue Animal save DC.', src));
  }

  if (/\bTemporary Hit Points equal to your Proficiency Bonus plus your Intelligence, Wisdom, or Charisma modifier\b/i.test(src)) {
    rules.push(rule(`\t\t\t<stat name="hospitality:temp hp" value="proficiency" />`, 'Add proficiency bonus to hospitality temporary hit points.', src));
    if (/^Greater Mark of Hospitality$/i.test(featName)) {
      rules.push(rule(
        `\t\t\t<select type="Feat Feature" name="Hospitality Ability (${escAttrXml(featName)})" supports="${hospitalityAbilitySupports(featName, meta)}" />`,
        `Choose the spellcasting ability modifier for ${featName}.`,
        src
      ));
    } else {
      rules.push(rule(`\t\t\t<stat name="hospitality:temp hp" value="charisma:modifier" bonus="ability" />`, 'Add chosen spellcasting ability modifier to hospitality temporary hit points.', src));
    }
  }

  if (/spell slot's level is half your level \(round up\)/i.test(src)) {
    rules.push(rule(
      `\t\t\t<stat name="potent dragonmark:slot level" value="level:half:up" maximum="5" />`,
      'Set Potent Dragonmark spell slot level to half character level rounded up.',
      src
    ));
  }

  return rules;
}

function isDragonmarkFeatName(name) {
  return /^Aberrant Dragonmark$/i.test(name) || /^Mark of /i.test(name);
}

function isMarkOfFeatName(name) {
  return /^Mark of /i.test(name);
}

function featSupports(feat) {
  const name = normalizeExtractedName(feat?.name || '');
  const text = `${feat?.description || ''} ${feat?.prerequisite || ''}`;
  if (isDragonmarkFeatName(name)) return 'Dragonmark';
  if (/^Boon of Siberys$/i.test(name) || /\bEpic Boon Feat\b/i.test(text)) return 'Epic Boon';
  return '';
}

function dragonmarkAbilitySupports(meta) {
  const prefix = meta?.prefix || 'ID_SOURCE';
  return ['INTELLIGENCE', 'WISDOM', 'CHARISMA']
    .map(ability => `${prefix}_FEAT_FEATURE_DRAGONMARK_${ability}`)
    .join('|');
}

function dragonmarkSpellsOfTheMarkId(featName, meta) {
  return `${meta?.prefix || 'ID_SOURCE'}_FEAT_FEATURE_${idify(featName)}_SPELLS_OF_THE_MARK`;
}

function genDragonmarkSpellcastingAbilityFeatures(source, meta) {
  return ['Intelligence', 'Wisdom', 'Charisma'].map(ability => {
    const id = `${meta?.prefix || 'ID_SOURCE'}_FEAT_FEATURE_DRAGONMARK_${idify(ability)}`;
    return [
      `\t<element name="${ability}" type="Feat Feature" source="${escAttrXml(source)}" id="${id}">`,
      `\t\t<compendium display="false" />`,
      `\t\t<description><p>Your spellcasting ability for this Dragonmark feat's spells is ${ability}.</p></description>`,
      `\t\t<sheet alt="Dragonmark"><description>Your spellcasting ability for this Dragonmark feat's spells is ${ability}.</description></sheet>`,
      `\t</element>`
    ];
  });
}

function hospitalityAbilitySupports(featName, meta) {
  const prefix = meta?.prefix || 'ID_SOURCE';
  const base = `${prefix}_FEAT_FEATURE_${idify(featName)}`;
  return ['INTELLIGENCE', 'WISDOM', 'CHARISMA']
    .map(ability => `${base}_${ability}`)
    .join('|');
}

function genHospitalityAbilityFeatures(featName, source, meta) {
  const base = `${meta?.prefix || 'ID_SOURCE'}_FEAT_FEATURE_${idify(featName)}`;
  return ['Intelligence', 'Wisdom', 'Charisma'].map(ability => {
    const stat = ability.toLowerCase();
    return [
      `\t<element name="${ability}" type="Feat Feature" source="${escAttrXml(source)}" id="${base}_${idify(ability)}">`,
      `\t\t<compendium display="false" />`,
      `\t\t<description><p>Your spellcasting ability modifier for Improved Hospitality is ${ability}.</p></description>`,
      `\t\t<sheet alt="Improved Hospitality"><description>Your spellcasting ability modifier for Improved Hospitality is ${ability}.</description></sheet>`,
      `\t\t<rules><stat name="hospitality:temp hp" value="${stat}:modifier" bonus="ability" /></rules>`,
      `\t</element>`
    ];
  });
}

function genDragonmarkSpellsOfTheMarkFeature(feat, source, meta) {
  const featName = normalizeExtractedName(feat?.name || '');
  const text = featRuleText(feat);
  if (!isMarkOfFeatName(featName) || !/\bSpells of the Mark\b/i.test(text)) return [];
  const spells = parseSpellTableSpellNames(text);
  const id = dragonmarkSpellsOfTheMarkId(featName, meta);
  const spellExtends = spells
    .map(spell => canonicalSpellId(spell, meta))
    .filter(Boolean)
    .map(spellId => `<extend>${spellId}</extend>`)
    .join('');
  const lines = [];
  lines.push(`\t<element name="Spells of the Mark" type="Feat Feature" source="${escAttrXml(source)}" id="${id}">`);
  lines.push(`\t\t<compendium display="false" />`);
  lines.push(`\t\t<description><p>If you have the Spellcasting or Pact Magic class feature, the spells on the ${escXml(featName)} Spells table are added to that feature's spell list.</p></description>`);
  lines.push(`\t\t<sheet display="false"><description>The ${escXml(featName)} spells are added to the spell list of your spellcasting class.</description></sheet>`);
  if (spellExtends) lines.push(`\t\t<spellcasting all="true" extend="true">${spellExtends}</spellcasting>`);
  lines.push(`\t</element>`);
  return lines;
}

function featRuleText(feat) {
  const benefits = Array.isArray(feat?.benefits) ? feat.benefits : [];
  return [
    feat?.description || '',
    ...benefits.map(b => typeof b === 'string' ? b : (b.text || ''))
  ].filter(Boolean).join('\n');
}

function parseSpellTableSpellNames(text) {
  const spells = [];
  for (const match of String(text || '').matchAll(/\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|/g)) {
    splitSpellListPhrase(match[2]).forEach(spell => spells.push(spell));
  }
  return uniqueStrings(spells);
}

function splitSpellListPhrase(phrase) {
  let text = normalizeExtractedName(String(phrase || '')
    .replace(/^the\s+/i, '')
    .replace(/[.;:]+$/g, '')
    .trim());
  if (!text) return [];
  const protectedNames = [
    'Detect Poison and Disease',
    'Purify Food and Drink',
    'Protection From Evil and Good',
    'Locate Animals Or Plants'
  ];
  const restored = [];
  protectedNames.forEach((name, index) => {
    const token = `__SPELL_${index}__`;
    const pattern = new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i');
    if (pattern.test(text)) {
      text = text.replace(pattern, token);
      restored[index] = name;
    }
  });
  return text
    .split(/\s*,\s*|\s+\band\b\s+/i)
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const token = part.match(/^__SPELL_(\d+)__$/);
      return token ? restored[parseInt(token[1], 10)] : part;
    })
    .map(normalizeExtractedName)
    .filter(Boolean);
}

function genFeatXml(feat, source, prefix, meta) {
  const id = `${prefix}_FEAT_${idify(feat.name)}`;
  const benefits = Array.isArray(feat.benefits) ? feat.benefits : [];
  const rules = inferFeatRules(feat, meta);
  const requirement = requirementFromPrerequisite(feat.prerequisite);
  const supports = featSupports(feat);
  const lines = [];
  lines.push(`\t<element name="${escAttrXml(feat.name)}" type="Feat" source="${escAttrXml(source)}" id="${id}">`);
  if (supports) lines.push(`\t\t<supports>${escXml(supports)}</supports>`);
  if (feat.prerequisite) {
    lines.push(`\t\t<prerequisite>${escXml(feat.prerequisite)}</prerequisite>`);
    if (requirement) lines.push(`\t\t<requirements>${escXml(requirement)}</requirements>`);
  }
  lines.push(`\t\t<description>`);
  if (feat.prerequisite) lines.push(`\t\t\t<p class="flavor"><em>Prerequisite: ${escXml(feat.prerequisite)}</em></p>`);
  lines.push(`\t\t\t<p>${escXml(feat.description||"")}</p>`);
  if (benefits.length) {
    lines.push(`\t\t\t<ul>`);
    benefits.forEach(b => {
      const txt = typeof b === "string" ? b : (b.text || "");
      lines.push(`\t\t\t\t<li>${escXml(txt)}</li>`);
    });
    lines.push(`\t\t\t</ul>`);
  }
  lines.push(`\t\t</description>`);
  const allText = [feat.description||"", ...benefits.map(b => typeof b === "string" ? b : (b.text||""))].join(" ");
  lines.push(`\t\t<sheet><description>${escXml(allText)}</description></sheet>`);
  lines.push(`\t\t<rules>`);
  renderRuleLines(lines, rules);
  lines.push(`\t\t</rules>`);
  lines.push(`\t</element>`);
  const dragonmarkFeature = genDragonmarkSpellsOfTheMarkFeature(feat, source, meta);
  if (dragonmarkFeature.length) lines.push(...dragonmarkFeature);
  if (/^Greater Mark of Hospitality$/i.test(normalizeExtractedName(feat.name))) {
    genHospitalityAbilityFeatures(feat.name, source, meta).forEach(featureLines => lines.push(...featureLines));
  }
  return lines;
}

function requirementFromPrerequisite(text) {
  const src = String(text || '');
  const abilityMap = {
    strength: 'str', str: 'str',
    dexterity: 'dex', dex: 'dex',
    constitution: 'con', con: 'con',
    intelligence: 'int', int: 'int',
    wisdom: 'wis', wis: 'wis',
    charisma: 'cha', cha: 'cha',
  };
  const parts = [];
  const re = /\b(str(?:ength)?|dex(?:terity)?|con(?:stitution)?|int(?:elligence)?|wis(?:dom)?|cha(?:risma)?)\b(?:\s+score)?\s*(?:of\s*)?(\d{1,2})/gi;
  let match;
  while ((match = re.exec(src)) !== null) {
    const stat = abilityMap[match[1].toLowerCase()];
    if (stat) parts.push(`[${stat}:${parseInt(match[2], 10)}]`);
  }
  if (!parts.length) return '';
  return parts.length === 1 ? parts[0] : `(${parts.join(',')})`;
}

function isChoiceLanguage(value) {
  return /^(any|choice|choose|one|two|three|\d+)\b/i.test(String(value || '').trim());
}

function choiceCountFromValues(values) {
  let count = 0;
  (values || []).forEach(value => {
    if (!isChoiceLanguage(value)) return;
    const m = String(value).match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i);
    count += m ? parseCountWord(m[1]) : 1;
  });
  return count;
}

function languageChoiceSelect(ownerName, count) {
  const n = parseInt(count, 10) || 0;
  if (!n) return '';
  const numberAttr = n > 1 ? ` number="${n}"` : '';
  return `\t\t\t<select type="Language" name="Language (${escAttrXml(ownerName)})"${numberAttr} supports="Standard||Exotic" />`;
}

function readableJoin(values) {
  const list = (values || []).filter(Boolean);
  if (list.length <= 1) return list[0] || '';
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`;
}

function backgroundShortToolLabel(tool) {
  const value = String(tool || '').trim();
  if (/\bchoose\b|\bchoice\b|\bone kind\b/i.test(value)) {
    if (/artisan/i.test(value)) return "one Artisan's Tool";
    if (/gaming set/i.test(value)) return 'one Gaming Set';
    if (/musical/i.test(value)) return 'one Musical Instrument';
    return 'one Tool';
  }
  return value;
}

function backgroundShort(bg) {
  const parts = [];
  if (bg.abilityScores?.length) parts.push(bg.abilityScores.join(', '));
  if (bg.feat) parts.push(`${normalizeBackgroundFeatName(bg.feat)} Feat`);
  if (bg.skillProficiencies?.length) {
    parts.push(`${readableJoin(bg.skillProficiencies)} ${bg.skillProficiencies.length === 1 ? 'Skill' : 'Skills'}`);
  }
  if (bg.toolProficiencies?.length) parts.push(readableJoin(bg.toolProficiencies.map(backgroundShortToolLabel)));
  const languageChoices = (parseInt(bg.languageChoices, 10) || 0) + choiceCountFromValues(bg.languages);
  if (languageChoices) parts.push(`${languageChoices} ${languageChoices === 1 ? 'Language' : 'Languages'}`);
  const fixedLanguages = (bg.languages || []).filter(lang => !isChoiceLanguage(lang));
  if (fixedLanguages.length) parts.push(readableJoin(fixedLanguages));
  return parts.join(', ');
}

function backgroundDetailLine(label, value) {
  if (!value) return '';
  return `\t\t\t\t<li><strong>${escXml(label)}:</strong> ${escXml(value)}</li>`;
}

function abilityStatName(ability) {
  return {
    strength: 'strength',
    dexterity: 'dexterity',
    constitution: 'constitution',
    intelligence: 'intelligence',
    wisdom: 'wisdom',
    charisma: 'charisma'
  }[String(ability || '').toLowerCase()] || '';
}

function abilityShortName(ability) {
  return {
    strength: 'STR',
    dexterity: 'DEX',
    constitution: 'CON',
    intelligence: 'INT',
    wisdom: 'WIS',
    charisma: 'CHA'
  }[String(ability || '').toLowerCase()] || '';
}

function backgroundAbilityScoreGrantId(abilityScores) {
  const parts = (abilityScores || []).map(abilityShortName).filter(Boolean);
  if (parts.length !== 3) return '';
  return `ID_INTERNAL_ABILITY_SCORE_IMPROVEMENT_COMBINATION_${parts.join('_')}`;
}

function backgroundFeatGrantId(featName, prefix) {
  const name = normalizeBackgroundFeatName(featName);
  if (!name) return '';
  const standard = {
    Alert: 'ID_WOTC_PHB24_FEAT_ALERT',
    Lucky: 'ID_WOTC_PHB24_FEAT_LUCKY',
    Skilled: 'ID_WOTC_PHB24_FEAT_SKILLED'
  };
  if (standard[name]) return standard[name];
  const localFeats = (extractedData.feat || []).map(feat => normalizeExtractedName(feat.name));
  if (localFeats.includes(name)) return `${prefix}_FEAT_${idify(name)}`;
  return '';
}

const TOOL_PROFICIENCY_IDS = {
  "alchemist's supplies": 'ID_PROFICIENCY_TOOL_PROFICIENCY_ALCHEMISTS_SUPPLIES',
  'alchemists supplies': 'ID_PROFICIENCY_TOOL_PROFICIENCY_ALCHEMISTS_SUPPLIES',
  "calligrapher's supplies": 'ID_PROFICIENCY_TOOL_PROFICIENCY_CALLIGRAPHERS_SUPPLIES',
  'calligraphers supplies': 'ID_PROFICIENCY_TOOL_PROFICIENCY_CALLIGRAPHERS_SUPPLIES',
  "cartographer's tools": 'ID_PROFICIENCY_TOOL_PROFICIENCY_CARTOGRAPHERS_TOOLS',
  'cartographers tools': 'ID_PROFICIENCY_TOOL_PROFICIENCY_CARTOGRAPHERS_TOOLS',
  "cook's utensils": 'ID_PROFICIENCY_TOOL_PROFICIENCY_COOKS_UTENSILS',
  'cooks utensils': 'ID_PROFICIENCY_TOOL_PROFICIENCY_COOKS_UTENSILS',
  'disguise kit': 'ID_PROFICIENCY_TOOL_PROFICIENCY_DISGUISE_KIT',
  'herbalism kit': 'ID_PROFICIENCY_TOOL_PROFICIENCY_HERBALISM_KIT',
  "navigator's tools": 'ID_PROFICIENCY_TOOL_PROFICIENCY_NAVIGATORS_TOOLS',
  'navigators tools': 'ID_PROFICIENCY_TOOL_PROFICIENCY_NAVIGATORS_TOOLS',
  "smith's tools": 'ID_PROFICIENCY_TOOL_PROFICIENCY_SMITHS_TOOLS',
  'smiths tools': 'ID_PROFICIENCY_TOOL_PROFICIENCY_SMITHS_TOOLS',
  "thieves' tools": 'ID_PROFICIENCY_TOOL_PROFICIENCY_THIEVES_TOOLS',
  'thieves tools': 'ID_PROFICIENCY_TOOL_PROFICIENCY_THIEVES_TOOLS',
  "tinker's tools": 'ID_PROFICIENCY_TOOL_PROFICIENCY_TINKERS_TOOLS',
  'tinkers tools': 'ID_PROFICIENCY_TOOL_PROFICIENCY_TINKERS_TOOLS',
  "woodcarver's tools": 'ID_PROFICIENCY_TOOL_PROFICIENCY_WOODCARVERS_TOOLS',
  'woodcarvers tools': 'ID_PROFICIENCY_TOOL_PROFICIENCY_WOODCARVERS_TOOLS'
};

function toolProficiencyRule(tool, ownerName) {
  const value = String(tool || '').trim();
  if (!value) return '';
  if (/\bchoose\b|\bchoice\b|\bone kind\b/i.test(value)) {
    const choice = /gaming set/i.test(value) ? { name: 'Gaming Set', supports: 'Gaming Set' }
      : /artisan/i.test(value) ? { name: "Artisan's Tool", supports: 'Artisan tools' }
      : /musical/i.test(value) ? { name: 'Musical Instrument', supports: 'Musical Instrument' }
      : { name: 'Tool', supports: 'Tool' };
    return `<select type="Proficiency" name="${escAttrXml(choice.name)} (${escAttrXml(ownerName)})" supports="${escAttrXml(choice.supports)}" />`;
  }
  const key = value.toLowerCase().replace(/[’]/g, "'");
  const id = TOOL_PROFICIENCY_IDS[key];
  return id ? `<grant type="Proficiency" id="${id}" />` : '';
}

function magicCategoryFromType(type) {
  const t = String(type || '').toLowerCase();
  if (t.includes('wondrous')) return 'Wondrous Items';
  if (t.includes('weapon')) return 'Weapons';
  if (t.includes('armor') || t.includes('shield')) return 'Armor';
  if (t.includes('potion')) return 'Potions';
  if (t.includes('ring')) return 'Rings';
  if (t.includes('rod')) return 'Rods';
  if (t.includes('scroll')) return 'Scrolls';
  if (t.includes('staff')) return 'Staffs';
  if (t.includes('wand')) return 'Wands';
  return 'Magic Items';
}

function racialTraitId(race, trait, prefix) {
  const raceSegment = idify(race.name);
  const traitSegment = idify(trait.name);
  const suffix = traitSegment.startsWith(`${raceSegment}_`) ? traitSegment : `${raceSegment}_${traitSegment}`;
  return `${prefix}_RACIAL_TRAIT_${suffix}`;
}

function racialTraitDisplayName(race, trait) {
  const name = normalizeExtractedName(trait?.name || '');
  if (/^Darkvision$/i.test(name)) return `${name} (${normalizeExtractedName(race?.name || '')})`;
  return name;
}

const KNOWN_INTERNAL_RACE_GRANTS = new Set([
  'AARAKOCRA', 'AASIMAR', 'AIR_GENASI', 'BUGBEAR', 'CENTAUR', 'CHANGELING',
  'DARK_ELF', 'DEEP_GNOME', 'DHAMPIR', 'DRAGONBORN', 'DUERGAR', 'DWARF',
  'EARTH_GENASI', 'ELADRIN', 'ELF', 'FAIRY', 'FIRBOLG', 'FIRE_GENASI',
  'GENASI', 'GITH', 'GITHYANKI', 'GITHZERAI', 'GNOME', 'GOBLIN', 'GOBLINOID',
  'GOLIATH', 'HALF_ELF', 'HALF_ORC', 'HALFLING', 'HARENGON', 'HIGH_ELF',
  'HOBGOBLIN', 'HUMAN', 'KALASHTAR', 'KENKU', 'KOBOLD', 'LIZARDFOLK',
  'MINOTAUR', 'ORC', 'OWLIN', 'SATYR', 'SEA_ELF', 'SHADAR_KAI', 'SHIFTER',
  'TABAXI', 'TIEFLING', 'TORTLE', 'TRITON', 'WARFORGED', 'WATER_GENASI',
  'WOOD_ELF', 'YUAN_TI'
]);

function raceInternalGrantId(race) {
  const name = normalizeExtractedName(race?.name || '');
  const segment = /^Khoravar$/i.test(name) ? 'HALF_ELF' : idify(name);
  return KNOWN_INTERNAL_RACE_GRANTS.has(segment) ? `ID_INTERNAL_GRANT_RACE_${segment}` : '';
}

function raceSizeRule(race) {
  const options = (race.sizeOptions && race.sizeOptions.length ? race.sizeOptions : [race.size]).filter(Boolean);
  const hasSmall = options.some(size => /^Small$/i.test(size));
  const hasMedium = options.some(size => /^Medium$/i.test(size));
  if (hasSmall && hasMedium) {
    return rule(
      `\t\t\t<select type="Racial Trait" name="Size (${escAttrXml(race.name)})" supports="ID_INTERNAL_RACIAL_TRAIT_SMALL|ID_INTERNAL_RACIAL_TRAIT_MEDIUM" />`,
      `Choose Small or Medium size for ${race.name}.`,
      `Size: ${options.join(' or ')}`
    );
  }
  const size = options[0] || race.size;
  if (!size) return null;
  return rule(
    `\t\t\t<grant type="Size" id="ID_SIZE_${idify(size)}" />`,
    `Set size to ${size}.`,
    `Size: ${size}`
  );
}

function defaultRaceLanguages(race, meta) {
  const languages = [];
  const name = normalizeExtractedName(race?.name || '');
  (race.languages || []).filter(lang => !isChoiceLanguage(lang)).forEach(lang => languages.push(lang));
  if (isModernRuleset(meta) && !languages.some(lang => /^Common$/i.test(lang))) languages.push('Common');
  if (/^Khoravar$/i.test(name) && !languages.some(lang => /^Elvish$/i.test(lang))) languages.push('Elvish');
  return uniqueStrings(languages);
}

function defaultRaceLanguageChoices(race, meta) {
  const explicit = (parseInt(race.languageChoices, 10) || 0) + choiceCountFromValues(race.languages);
  if (explicit) return explicit;
  const name = normalizeExtractedName(race?.name || '');
  if (isModernRuleset(meta) && /^(Changeling|Kalashtar)$/i.test(name)) return 1;
  return 0;
}

function racialTraitSelectName(race, trait) {
  const traitName = normalizeExtractedName(trait?.name || '');
  const raceName = normalizeExtractedName(race?.name || '');
  if (/^(Bestial Instincts)$/i.test(traitName)) return `${traitName} (${raceName})`;
  return traitName;
}

function skillChoiceRuleFromText(race, trait) {
  const text = String(trait?.description || '');
  if (!/\bgain proficiency in\b/i.test(text)) return null;
  const skills = parseSkillsFromText(text);
  if (!skills.length) return null;
  const countMatch = text.match(/\b(?:two|2|one|1)\s+of the following skills?\b/i)
    || text.match(/\b(?:one|1)\s+skill\b/i);
  const count = countMatch ? parseCountWord(countMatch[0].match(/\b(two|2|one|1)\b/i)?.[1] || 'one') : 1;
  const numberAttr = count > 1 ? ` number="${count}"` : '';
  return rule(
    `\t\t\t<select type="Proficiency" name="${escAttrXml(racialTraitSelectName(race, trait))}"${numberAttr} supports="Skill,(${escAttrXml(skills.join('||'))})" />`,
    `Choose ${count} skill proficienc${count === 1 ? 'y' : 'ies'} for ${trait.name}.`,
    text
  );
}

function inferRacialTraitRules(race, trait, meta) {
  const rules = [];
  const text = String(trait?.description || '');
  const lower = text.toLowerCase();
  const traitName = normalizeExtractedName(trait?.name || '');
  const raceName = normalizeExtractedName(race?.name || '');
  const skillChoice = skillChoiceRuleFromText(race, trait);
  if (skillChoice) rules.push(skillChoice);

  [
    'acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic',
    'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder'
  ].forEach(type => {
    if (new RegExp(`\\bresistance to [^.]{0,120}\\b${type} damage\\b|\\b${type} damage resistance\\b`, 'i').test(lower)) {
      rules.push(rule(
        `\t\t\t<grant type="Condition" id="ID_INTERNAL_CONDITION_DAMAGE_RESISTANCE_${idify(type)}" />`,
        `Gain resistance to ${type} damage.`,
        text
      ));
    }
  });

  if (/\bdarkvision\b/i.test(text)) {
    rules.push(rule(
      `\t\t\t<grant type="Vision" id="ID_VISION_DARKVISION" />`,
      'Gain Darkvision.',
      text
    ));
  }

  if (/^Fey Gift$/i.test(traitName) && /\bFriends cantrip\b/i.test(text)) {
    rules.push(rule(
      `\t\t\t<grant type="Spell" id="${canonicalSpellId('Friends', meta)}" />`,
      'Know the Friends cantrip.',
      text
    ));
    rules.push(rule(
      `\t\t\t<select type="Racial Trait" name="Spellcasting Ability (${escAttrXml(raceName)})" supports="${escAttrXml(raceName)} Spellcasting Ability" />`,
      `Choose the spellcasting ability for ${raceName}.`,
      text
    ));
  }

  if (/^Skill Versatility$/i.test(traitName) && /\bone skill or with one tool\b/i.test(text)) {
    rules.push(rule(
      `\t\t\t<select type="Proficiency" name="Skill or Tool Versatility (${escAttrXml(raceName)})" supports="Skill||Tool" />`,
      'Choose one skill or tool proficiency.',
      text
    ));
  }

  if (/^Shifting$/i.test(traitName)) {
    if (/\bTemporary Hit Points equal to 2 times your Proficiency Bonus\b/i.test(text)) {
      rules.push(rule(
        `\t\t\t<stat name="shifting:temp hp" value="proficiency:2" />`,
        'Set Shifting temporary hit points to twice proficiency bonus.',
        text
      ));
    }
    if (/\bBeasthide\b|\bLongtooth\b|\bSwiftstride\b|\bWildhunt\b/i.test(text)) {
      rules.push(rule(
        `\t\t\t<select type="Racial Trait" name="Shifting Form (${escAttrXml(raceName)})" supports="${escAttrXml((meta?.abbr || 'SRC').replace(/[^A-Z0-9]/g, '_'))} Shifter Form" />`,
        'Choose a Shifter form.',
        text
      ));
    }
  }

  if (/^Integrated Protection$/i.test(traitName) && /\+1 bonus to your Armor Class/i.test(text)) {
    rules.push(rule(
      `\t\t\t<stat name="ac:misc" value="1" />`,
      'Gain a +1 bonus to Armor Class.',
      text
    ));
  }

  if (/^Specialized Design$/i.test(traitName) && /\bone skill proficiency and one tool proficiency\b/i.test(text)) {
    rules.push(rule(
      `\t\t\t<select type="Proficiency" name="Skill Proficiency (${escAttrXml(raceName)})" supports="Skill" />`,
      'Choose one skill proficiency.',
      text
    ));
    rules.push(rule(
      `\t\t\t<select type="Proficiency" name="Tool Proficiency (${escAttrXml(raceName)})" supports="Tool" />`,
      'Choose one tool proficiency.',
      text
    ));
  }

  return dedupeRules(rules);
}

function extraRacialTraitElements(race, source, prefix, meta) {
  const lines = [];
  const raceName = normalizeExtractedName(race?.name || '');
  if (/^Khoravar$/i.test(raceName) && (race.traits || []).some(trait => /^Fey Gift$/i.test(trait.name || ''))) {
    ['Intelligence', 'Wisdom', 'Charisma'].forEach(ability => {
      const id = `${prefix}_RACIAL_TRAIT_KHORAVAR_${idify(ability)}`;
      lines.push(`\t<element name="${ability} (Khoravar)" type="Racial Trait" source="${escAttrXml(source)}" id="${id}">`);
      lines.push(`\t\t<supports>Khoravar Spellcasting Ability</supports>`);
      lines.push(`\t\t<compendium display="false" />`);
      lines.push(`\t\t<description><p>Your spellcasting ability for Khoravar spells is ${ability}.</p></description>`);
      lines.push(`\t\t<sheet display="false" />`);
      lines.push(`\t\t<rules><stat name="khoravar:spellcasting ability" value="${ability}" inline="true" /></rules>`);
      lines.push(`\t</element>`);
    });
  }
  const shifting = (race.traits || []).find(trait => /^Shifting$/i.test(trait.name || ''));
  if (/^Shifter$/i.test(raceName) && shifting) {
    for (const option of ['Beasthide', 'Longtooth', 'Swiftstride', 'Wildhunt']) {
      const match = String(shifting.description || '').match(new RegExp(`\\b${option}\\b[:.]?\\s*([^\\n]+)`, 'i'));
      if (!match) continue;
      const id = `${prefix}_RACIAL_TRAIT_SHIFTER_${idify(option)}`;
      lines.push(`\t<element name="${option}" type="Racial Trait" source="${escAttrXml(source)}" id="${id}">`);
      lines.push(`\t\t<supports>${escXml((meta?.abbr || 'SRC').replace(/[^A-Z0-9]/g, '_'))} Shifter Form</supports>`);
      lines.push(`\t\t<compendium display="false" />`);
      lines.push(`\t\t<description><p><b>${option}.</b> ${escXml(match[1].trim())}</p></description>`);
      lines.push(`\t\t<sheet display="false" />`);
      lines.push(`\t\t<rules></rules>`);
      lines.push(`\t</element>`);
    }
  }
  return lines;
}

function genRaceXml(race, source, prefix, meta) {
  const raceId = `${prefix}_RACE_${idify(race.name)}`;
  const lines = [];
  lines.push(`\t<element name="${escAttrXml(race.name)}" type="Race" source="${escAttrXml(source)}" id="${raceId}">`);
  lines.push(`\t\t<description>`);
  lines.push(`\t\t\t<p>${escXml(race.description||'')}</p>`);
  (race.traits||[]).forEach(t => {
    const tid = racialTraitId(race, t, prefix);
    lines.push(`\t\t\t<div element="${tid}" />`);
  });
  lines.push(`\t\t</description>`);
  lines.push(`\t\t<sheet display="false" />`);
  lines.push(`\t\t<rules>`);
  const raceRules = [];
  // Core racial stat bonuses
  if (race.abilityScores) {
    const abilityMap = { strength:'strength', dexterity:'dexterity', constitution:'constitution',
      intelligence:'intelligence', wisdom:'wisdom', charisma:'charisma' };
    for (const [k, v] of Object.entries(race.abilityScores)) {
      const stat = abilityMap[k.toLowerCase()];
      if (stat && v) {
        raceRules.push(rule(
          `\t\t\t<stat name="${stat}" value="${v}" requirements="!ID_INTERNAL_GRANTS_BACKGROUND_ASI" />`,
          `Increase ${stat} by ${v} unless a background provides ability scores.`,
          `Ability Score Increase: ${k} +${v}`
        ));
      }
    }
  }
  const sizeRule = raceSizeRule(race);
  if (sizeRule) raceRules.push(sizeRule);
  if (race.speed) {
    raceRules.push(rule(
      `\t\t\t<stat name="innate speed" value="${race.speed}" bonus="base" />`,
      `Set walking speed to ${race.speed}.`,
      `Speed: ${race.speed}`
    ));
  }
  const internalGrantId = raceInternalGrantId(race);
  if (internalGrantId) {
    raceRules.push(rule(
      `\t\t\t<grant type="Grants" id="${internalGrantId}" />`,
      `Apply the internal ${race.name} race grant.`,
      race.name
    ));
  }
  defaultRaceLanguages(race, meta).forEach(lang => {
    raceRules.push(rule(
      `\t\t\t<grant type="Language" id="ID_LANGUAGE_${idify(lang)}" />`,
      `Know ${lang}.`,
      `Languages: ${lang}`
    ));
  });
  const raceLanguageChoices = defaultRaceLanguageChoices(race, meta);
  const raceLanguageSelect = languageChoiceSelect(race.name, raceLanguageChoices);
  if (raceLanguageSelect) {
    raceRules.push(rule(
      raceLanguageSelect,
      `Choose ${raceLanguageChoices} language${raceLanguageChoices === 1 ? '' : 's'}.`,
      `Languages: ${(race.languages || []).join(', ')}`
    ));
  }
  (race.traits||[]).forEach(t => {
    const tid = racialTraitId(race, t, prefix);
    raceRules.push(rule(
      `\t\t\t<grant type="Racial Trait" id="${tid}" />`,
      `Grant racial trait ${t.name}.`,
      t.description || t.name
    ));
  });
  if (race.subraces && race.subraces.length > 0) {
    raceRules.push(rule(
      `\t\t\t<select type="Sub Race" name="Subrace (${escAttrXml(race.name)})" supports="${escAttrXml(race.name)}" />`,
      `Choose a ${race.name} subrace.`,
      `Subraces: ${race.subraces.map(s => s.name).filter(Boolean).join(', ')}`
    ));
  }
  renderRuleLines(lines, raceRules);
  lines.push(`\t\t</rules>`);
  lines.push(`\t</element>`);

  // Racial Trait child elements
  (race.traits||[]).forEach(t => {
    const tid = racialTraitId(race, t, prefix);
    const traitRules = inferRacialTraitRules(race, t, meta);
    lines.push(`\t<element name="${escAttrXml(racialTraitDisplayName(race, t))}" type="Racial Trait" source="${escAttrXml(source)}" id="${tid}">`);
    lines.push(`\t\t<compendium display="false" />`);
    lines.push(`\t\t<description><p>${escXml(t.description||'')}</p></description>`);
    lines.push(`\t\t<sheet><description>${escXml(t.description||'')}</description></sheet>`);
    lines.push(`\t\t<rules>`);
    renderRuleLines(lines, traitRules);
    lines.push(`\t\t</rules>`);
    lines.push(`\t</element>`);
  });
  lines.push(...extraRacialTraitElements(race, source, prefix, meta));

  return lines;
}

function backgroundFeatureId(bg, feature, prefix) {
  return `${prefix}_BACKGROUND_FEATURE_${idify(bg.name)}_${idify(feature.name)}`;
}

function backgroundFeatureDisplayName(feature) {
  const name = String(feature?.name || '').trim();
  return /^Feature:/i.test(name) ? name : `Feature: ${name}`;
}

function genBackgroundXml(bg, source, prefix, meta) {
  const bgId = `${prefix}_BACKGROUND_${idify(bg.name)}`;
  const featGrant = backgroundFeatGrantId(bg.feat, prefix);
  const modernRules = isModernRuleset(meta);
  const lines = [];
  lines.push(`\t<element name="${escAttrXml(bg.name)}" type="Background" source="${escAttrXml(source)}" id="${bgId}">`);
  lines.push(`\t\t<description>`);
  const detailLines = [
    backgroundDetailLine('Ability Scores', bg.abilityScores?.join(', ')),
    backgroundDetailLine('Feat', bg.feat),
    backgroundDetailLine('Skill Proficiencies', bg.skillProficiencies?.join(' and ')),
    backgroundDetailLine((bg.toolProficiencies || []).length === 1 ? 'Tool Proficiency' : 'Tool Proficiencies', bg.toolProficiencies?.join(' and ')),
    backgroundDetailLine('Languages', (bg.languages || []).join(', ')),
    backgroundDetailLine('Equipment', bg.equipment)
  ].filter(Boolean);
  if (detailLines.length) {
    lines.push(`\t\t\t<ul class="unstyled" style="text-indent:-1em; margin-left:1em; margin-bottom:5px">`);
    detailLines.forEach(line => lines.push(line));
    lines.push(`\t\t\t</ul>`);
  }
  if (bg.description) lines.push(`\t\t\t<p>${escXml(bg.description)}</p>`);
  if (featGrant) {
    lines.push(`\t\t\t<div class="reference">`);
    lines.push(`\t\t\t\t<div element="${featGrant}" />`);
    lines.push(`\t\t\t</div>`);
  }
  (bg.features||[]).forEach(f => {
    const fid = backgroundFeatureId(bg, f, prefix);
    lines.push(`\t\t\t<div element="${fid}" />`);
  });
  lines.push(`\t\t</description>`);
  const short = backgroundShort(bg);
  if (short) {
    lines.push(`\t\t<setters>`);
    lines.push(`\t\t\t<set name="short">${escXml(short)}</set>`);
    lines.push(`\t\t</setters>`);
  }
  lines.push(`\t\t<sheet display="false" />`);
  lines.push(`\t\t<rules>`);
  const backgroundRules = [];
  const asiGrantId = backgroundAbilityScoreGrantId(bg.abilityScores);
  if (modernRules && asiGrantId) {
    backgroundRules.push(rule(
      `\t\t\t<grant type="Ability Score Improvement" id="${asiGrantId}" />`,
      `Choose +2/+1 or +1/+1/+1 among ${bg.abilityScores.join(', ')}.`,
      `Ability Scores: ${bg.abilityScores.join(', ')}`
    ));
  } else {
    (bg.abilityScores || []).forEach(ability => {
      const stat = abilityStatName(ability);
      if (stat) {
        backgroundRules.push(rule(
          `\t\t\t<stat name="${stat}" value="1" />`,
          `Fallback ability score grant for ${ability}.`,
          `Ability Scores: ${(bg.abilityScores || []).join(', ')}`
        ));
      }
    });
  }
  if (featGrant) {
    backgroundRules.push(rule(
      `\t\t\t<grant type="Feat" id="${featGrant}" />`,
      `Grant background feat ${bg.feat}.`,
      `Feat: ${bg.feat}`
    ));
  } else if (bg.feat) {
    backgroundRules.push(`\t\t\t<!-- ${escXmlComment(`Background feat: ${bg.feat} - include the feat in this export or add its Aurora ID manually.`)} -->`);
  }
  // Skill proficiencies
  const skillIdMap = {
    'acrobatics':'ID_PROFICIENCY_SKILL_ACROBATICS','animal handling':'ID_PROFICIENCY_SKILL_ANIMALHANDLING',
    'arcana':'ID_PROFICIENCY_SKILL_ARCANA','athletics':'ID_PROFICIENCY_SKILL_ATHLETICS',
    'deception':'ID_PROFICIENCY_SKILL_DECEPTION','history':'ID_PROFICIENCY_SKILL_HISTORY',
    'insight':'ID_PROFICIENCY_SKILL_INSIGHT','intimidation':'ID_PROFICIENCY_SKILL_INTIMIDATION',
    'investigation':'ID_PROFICIENCY_SKILL_INVESTIGATION','medicine':'ID_PROFICIENCY_SKILL_MEDICINE',
    'nature':'ID_PROFICIENCY_SKILL_NATURE','perception':'ID_PROFICIENCY_SKILL_PERCEPTION',
    'performance':'ID_PROFICIENCY_SKILL_PERFORMANCE','persuasion':'ID_PROFICIENCY_SKILL_PERSUASION',
    'religion':'ID_PROFICIENCY_SKILL_RELIGION','sleight of hand':'ID_PROFICIENCY_SKILL_SLEIGHTOFHAND',
    'stealth':'ID_PROFICIENCY_SKILL_STEALTH','survival':'ID_PROFICIENCY_SKILL_SURVIVAL',
  };
  (bg.skillProficiencies||[]).forEach(skill => {
    const sid = skillIdMap[skill.toLowerCase()];
    if (sid) {
      backgroundRules.push(rule(
        `\t\t\t<grant type="Proficiency" id="${sid}" />`,
        `Gain proficiency in ${skill}.`,
        `Skill Proficiencies: ${(bg.skillProficiencies || []).join(', ')}`
      ));
    }
  });
  (bg.toolProficiencies||[]).forEach(tool => {
    const toolRule = toolProficiencyRule(tool, bg.name);
    if (toolRule) {
      backgroundRules.push(rule(
        `\t\t\t${toolRule}`,
        `Gain or choose tool proficiency: ${tool}.`,
        `Tool Proficiencies: ${(bg.toolProficiencies || []).join(', ')}`
      ));
    } else {
      backgroundRules.push(`\t\t\t<!-- ${escXmlComment(`Tool proficiency: ${tool} - add ID manually`)} -->`);
    }
  });
  if (modernRules && asiGrantId) {
    backgroundRules.push(rule(
      `\t\t\t<grant type="Grants" id="ID_INTERNAL_GRANTS_BACKGROUND_ASI" />`,
      'Mark this background as providing the character ability score improvement.',
      `Ability Scores: ${bg.abilityScores.join(', ')}`
    ));
  }
  (bg.languages||[]).filter(lang => !isChoiceLanguage(lang)).forEach(lang => {
    backgroundRules.push(rule(
      `\t\t\t<grant type="Language" id="ID_LANGUAGE_${idify(lang)}" />`,
      `Know ${lang}.`,
      `Languages: ${(bg.languages || []).join(', ')}`
    ));
  });
  const backgroundLanguageChoices = (parseInt(bg.languageChoices, 10) || 0) + choiceCountFromValues(bg.languages);
  const backgroundLanguageSelect = languageChoiceSelect(bg.name, backgroundLanguageChoices);
  if (backgroundLanguageSelect) {
    backgroundRules.push(rule(
      backgroundLanguageSelect,
      `Choose ${backgroundLanguageChoices} language${backgroundLanguageChoices === 1 ? '' : 's'}.`,
      `Languages: ${(bg.languages || []).join(', ')}`
    ));
  }
  (bg.features||[]).forEach(f => {
    const fid = backgroundFeatureId(bg, f, prefix);
    backgroundRules.push(rule(
      `\t\t\t<grant type="Background Feature" id="${fid}" requirements="!ID_INTERNAL_GRANT_OPTIONAL_BACKGROUND_FEATURE" />`,
      `Grant background feature ${f.name}.`,
      f.description || f.name
    ));
  });
  renderRuleLines(lines, backgroundRules);
  lines.push(`\t\t</rules>`);
  lines.push(`\t</element>`);

  // Background Feature child elements
  (bg.features||[]).forEach(f => {
    const fid = backgroundFeatureId(bg, f, prefix);
    lines.push(`\t<element name="${escAttrXml(backgroundFeatureDisplayName(f))}" type="Background Feature" source="${escAttrXml(source)}" id="${fid}">`);
    lines.push(`\t\t<compendium display="false" />`);
    lines.push(`\t\t<supports>Background Feature</supports>`);
    lines.push(`\t\t<description><p>${escXml(f.description||'')}</p></description>`);
    lines.push(`\t\t<sheet><description>${escXml(f.description||'')}</description></sheet>`);
    lines.push(`\t\t<rules></rules>`);
    lines.push(`\t</element>`);
  });

  return lines;
}

function hasClassSpellcasting(cls) {
  return !!(cls.spellcastingAbility || cls.spellcastingList);
}

function spellcastingPrepareAttribute(cls) {
  if (cls.spellcastingPrepare === true || cls.spellcastingPrepare === 'true') return ' prepare="true"';
  if (cls.spellcastingPrepare === false || cls.spellcastingPrepare === 'false') return ' prepare="false"';
  return '';
}

function isArchetypeSelectionFeature(feature, cls) {
  if (!feature || !cls?.archetypeLevel) return false;
  const name = String(feature.name || '').toLowerCase();
  const label = String(cls.archetypeLabel || '').toLowerCase();
  const sameLevel = parseInt(feature.level, 10) === parseInt(cls.archetypeLevel, 10);
  return sameLevel && (
    (label && name.includes(label)) ||
    /\b(archetype|subclass|path|college|domain|circle|oath|patron|tradition)\b/i.test(name)
  );
}

function isPlaceholderClassFeature(feature) {
  return /^Subclass Feature$/i.test(String(feature?.name || ''));
}

function classFeatureIdSegment(name) {
  if (/^Ability Score Improvement$/i.test(name || '')) return 'ASI';
  return idify(name || '');
}

function classFeatureId(cls, featureName, prefix) {
  const classSegment = idify(cls.name);
  const featureSegment = classFeatureIdSegment(featureName);
  const suffix = featureSegment.startsWith(`${classSegment}_`) ? featureSegment.slice(classSegment.length + 1) : featureSegment;
  return `${prefix}_CLASS_FEATURE_${classSegment}_${suffix}`;
}

function classFeatureElements(cls) {
  return (cls.features || []).filter(feature => !isPlaceholderClassFeature(feature));
}

function classProgressionFeatureGrants(cls) {
  const progression = cls.progression || [];
  if (!progression.length) {
    return classFeatureElements(cls).map(feature => ({ name: feature.name, level: feature.level || 1 }));
  }
  const grants = [];
  progression.forEach(row => {
    (row.features || []).forEach(name => {
      if (!name || isPlaceholderClassFeature({ name })) return;
      grants.push({ name, level: row.level });
    });
  });
  return grants;
}

function progressionDeltas(rows, accessor) {
  const deltas = [];
  let previous = 0;
  (rows || []).forEach(row => {
    const value = accessor(row);
    if (!Number.isFinite(value)) return;
    if (value > previous) deltas.push({ level: row.level, value: value - previous });
    previous = value;
  });
  return deltas;
}

function classSkillSupports(skills) {
  const list = (skills || []).filter(Boolean);
  return list.length ? `Skill,(${list.join('||')})` : 'Skill';
}

function normalizeArmorProficiencyName(value) {
  const clean = normalizeExtractedName(value);
  if (/^(Light|Medium|Heavy)$/i.test(clean)) return `${clean} armor`;
  if (/^Light Armor$/i.test(clean)) return 'Light armor';
  if (/^Medium Armor$/i.test(clean)) return 'Medium armor';
  if (/^Heavy Armor$/i.test(clean)) return 'Heavy armor';
  return clean;
}

function normalizeWeaponProficiencyName(value) {
  const clean = normalizeExtractedName(value);
  if (/^Simple Weapons$/i.test(clean)) return 'Simple weapons';
  if (/^Martial Weapons$/i.test(clean)) return 'Martial weapons';
  return clean;
}

function classProficienciesSummary(cls) {
  return [
    ...(cls.weaponProficiencies || []).map(normalizeWeaponProficiencyName),
    ...(cls.toolProficiencies || []).map(cleanExtractedTitle),
    ...(cls.armorProficiencies || []).map(normalizeArmorProficiencyName)
  ].filter(Boolean).join(', ');
}

function classShortDescription(cls) {
  if (/^Artificer$/i.test(cls.name || '')) return 'An inventor who harnesses magic through tools and crafted objects.';
  return String(cls.description || '').replace(/\|[^|]+\|/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function multiclassId(cls, prefix) {
  return `${prefix}_MULTICLASS_${idify(cls.name)}`;
}

function classAbilityRequirement(ability) {
  const key = abilityStatName(ability);
  const short = abilityShortName(key).toLowerCase();
  return short ? `[${short}:13]` : '';
}

function classSavingThrowProficiencyId(ability) {
  const stat = abilityStatName(ability);
  return stat ? `ID_PROFICIENCY_SAVINGTHROW_${idify(stat)}` : '';
}

function classArmorProficiencyId(value) {
  const key = normalizeArmorProficiencyName(value).toLowerCase();
  return {
    'light armor': 'ID_PROFICIENCY_ARMOR_PROFICIENCY_LIGHT_ARMOR',
    'medium armor': 'ID_PROFICIENCY_ARMOR_PROFICIENCY_MEDIUM_ARMOR',
    'heavy armor': 'ID_PROFICIENCY_ARMOR_PROFICIENCY_HEAVY_ARMOR',
    shields: 'ID_PROFICIENCY_ARMOR_PROFICIENCY_SHIELDS'
  }[key] || '';
}

function classWeaponProficiencyId(value) {
  const key = normalizeWeaponProficiencyName(value).toLowerCase();
  return {
    'simple weapons': 'ID_PROFICIENCY_WEAPON_PROFICIENCY_SIMPLE_WEAPONS',
    'martial weapons': 'ID_PROFICIENCY_WEAPON_PROFICIENCY_MARTIAL_WEAPONS'
  }[key] || '';
}

function classToolProficiencyRule(tool, cls, requirements = '') {
  const xml = toolProficiencyRule(tool, cls.name);
  if (!xml) return '';
  return requirements ? xml.replace(/\s*\/>$/, ` requirements="${escAttrXml(requirements)}" />`) : xml;
}

function multiclassProficienciesSummary(cls) {
  if (/^Artificer$/i.test(cls.name || '')) {
    return "Light armor, medium armor, shields, Tinker's Tools, one skill from the Artificer skill list";
  }
  return [
    ...(cls.armorProficiencies || []).map(normalizeArmorProficiencyName),
    ...(cls.toolProficiencies || []).filter(tool => !/\bchoice\b|\bone type\b|\bchoose\b/i.test(tool)).map(normalizeExtractedName),
    cls.skillChoices?.count ? `one skill from the ${cls.name} skill list` : ''
  ].filter(Boolean).join(', ') || '-';
}

function renderMulticlassRuleLines(lines, cls) {
  const pushGrant = id => lines.push(`\t\t\t\t<grant type="Proficiency" id="${id}" />`);
  if (/^Artificer$/i.test(cls.name || '')) {
    pushGrant('ID_PROFICIENCY_TOOL_PROFICIENCY_TINKERS_TOOLS');
    pushGrant('ID_PROFICIENCY_ARMOR_PROFICIENCY_LIGHT_ARMOR');
    pushGrant('ID_PROFICIENCY_ARMOR_PROFICIENCY_MEDIUM_ARMOR');
    pushGrant('ID_PROFICIENCY_ARMOR_PROFICIENCY_SHIELDS');
    lines.push(`\t\t\t\t<select type="Proficiency" name="Skill Proficiency (${escAttrXml(cls.name)} Multiclass)" supports="${escAttrXml(classSkillSupports(cls.skillChoices?.from || []))}" />`);
    return;
  }
  (cls.armorProficiencies || []).forEach(armor => {
    const id = classArmorProficiencyId(armor);
    if (id) pushGrant(id);
  });
  (cls.toolProficiencies || []).forEach(tool => {
    if (/\bchoice\b|\bone type\b|\bchoose\b/i.test(tool)) return;
    const xml = toolProficiencyRule(tool, cls.name);
    if (xml && /^<grant\b/i.test(xml)) lines.push(`\t\t\t\t${xml}`);
  });
  if (cls.skillChoices?.count) {
    lines.push(`\t\t\t\t<select type="Proficiency" name="Skill Proficiency (${escAttrXml(cls.name)} Multiclass)" supports="${escAttrXml(classSkillSupports(cls.skillChoices.from || []))}" />`);
  }
}

function classSpellcastingRules(cls) {
  const rows = cls.progression || [];
  const rules = [];
  const classKey = String(cls.name || '').toLowerCase();
  const spellcastingName = escAttrXml(cls.name);
  rules.push(rule(
    `\t\t\t<grant type="Grants" id="ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_HALF_UP" requirements="ID_INTERNAL_GRANT_MULTICLASS" />`,
    'Multiclass Artificer levels count as half levels rounded up for spell slots.',
    cls.name
  ));
  for (let slotLevel = 1; slotLevel <= 5; slotLevel++) {
    progressionDeltas(rows, row => row.slots?.[slotLevel]).forEach(delta => {
      rules.push(rule(
        `\t\t\t<stat name="${classKey}:spellcasting:slots:${slotLevel}" value="${delta.value}" level="${delta.level}" />`,
        `Increase level ${slotLevel} spell slots by ${delta.value} at ${cls.name} level ${delta.level}.`,
        'Artificer Features table'
      ));
    });
  }
  progressionDeltas(rows, row => row.cantrips).forEach(delta => {
    rules.push(rule(
      `\t\t\t<stat name="${classKey}:cantrips:known" value="${delta.value}" level="${delta.level}" />`,
      `Increase known cantrips by ${delta.value} at ${cls.name} level ${delta.level}.`,
      'Cantrips column'
    ));
  });
  progressionDeltas(rows, row => row.prepared).forEach(delta => {
    rules.push(rule(
      `\t\t\t<stat name="${classKey}:spellcasting:prepare" value="${delta.value}" level="${delta.level}" />`,
      `Increase prepared spells by ${delta.value} at ${cls.name} level ${delta.level}.`,
      'Prepared Spells column'
    ));
  });
  const initialCantrips = progressionDeltas(rows, row => row.cantrips);
  if (initialCantrips.length) {
    const first = initialCantrips[0];
    const numberAttr = first.value > 1 ? ` number="${first.value}"` : '';
    rules.push(rule(
      `\t\t\t<select type="Spell" name="Cantrip (${spellcastingName})" supports="$(spellcasting:list), 0"${numberAttr} spellcasting="${spellcastingName}" />`,
      `Choose ${first.value} ${cls.name} cantrips.`,
      'Cantrips column'
    ));
    initialCantrips.slice(1).forEach(delta => {
      rules.push(rule(
        `\t\t\t<select type="Spell" name="Cantrip (${spellcastingName})" supports="$(spellcasting:list), 0" level="${delta.level}" spellcasting="${spellcastingName}" />`,
        `Choose another ${cls.name} cantrip at level ${delta.level}.`,
        'Cantrips column'
      ));
    });
  }
  return rules;
}

function replicateMagicItemRules(cls) {
  const rules = [];
  progressionDeltas(cls.progression || [], row => row.plansKnown).forEach(delta => {
    rules.push(rule(
      `\t\t\t<stat name="replicate:plans:known" value="${delta.value}" level="${delta.level}" />`,
      `Increase Replicate Magic Item plans known by ${delta.value} at level ${delta.level}.`,
      'Plans Known column'
    ));
  });
  progressionDeltas(cls.progression || [], row => row.magicItems).forEach(delta => {
    rules.push(rule(
      `\t\t\t<stat name="replicate:items:max" value="${delta.value}" level="${delta.level}" />`,
      `Increase Replicate Magic Item creations by ${delta.value} at level ${delta.level}.`,
      'Magic Items column'
    ));
  });
  return rules;
}

function inferClassFeatureRules(cls, feature, meta) {
  const rules = [];
  const name = normalizeExtractedName(feature?.name || '');
  const text = String(feature?.description || '');
  if (/^Spellcasting$/i.test(name)) {
    rules.push(...classSpellcastingRules(cls));
  }
  if (/^Tinker's Magic$/i.test(name)) {
    if (/\bMending cantrip\b/i.test(text)) {
      rules.push(rule(
        `\t\t\t<grant type="Spell" id="${canonicalSpellId('Mending', meta)}" spellcasting="${escAttrXml(cls.name)}" prepared="true" />`,
        'Know the Mending cantrip.',
        text
      ));
    }
    rules.push(rule(`\t\t\t<stat name="intelligence:modifier:min1" value="1" bonus="base" />`, 'Minimum Intelligence modifier for uses is 1.', text));
    rules.push(rule(`\t\t\t<stat name="intelligence:modifier:min1" value="intelligence:modifier" bonus="base" />`, 'Use Intelligence modifier for uses.', text));
  }
  if (/^Replicate Magic Item$/i.test(name)) rules.push(...replicateMagicItemRules(cls));
  if (isArchetypeSelectionFeature(feature, cls)) {
    rules.push(rule(
      `\t\t\t<select type="Archetype" name="${escAttrXml(cls.archetypeLabel || 'Archetype')}" supports="${escAttrXml(cls.archetypeSupports || cls.name)}" level="${cls.archetypeLevel}" />`,
      `Choose a ${cls.name} subclass.`,
      text
    ));
  }
  if (/^Ability Score Improvement$/i.test(name)) {
    rules.push(rule(
      `\t\t\t<select type="Feat" name="Feat (${escAttrXml(cls.name)})" />`,
      `Choose the Ability Score Improvement feat or another feat.`,
      text
    ));
  }
  if (/^Magic Item Adept$/i.test(name)) {
    rules.push(rule(`\t\t\t<stat name="attunement:max" value="1" bonus="magic item adept" />`, 'Increase maximum attuned magic items to four.', text));
  }
  if (/^Spell-Storing Item$/i.test(name)) {
    rules.push(rule(`\t\t\t<stat name="intelligence:modifier:min1:x2" value="2" bonus="base" />`, 'Minimum stored-spell uses are twice 1.', text));
    rules.push(rule(`\t\t\t<stat name="intelligence:modifier:min1:x2" value="intelligence:modifier:x2" bonus="base" />`, 'Stored-spell uses equal twice Intelligence modifier.', text));
  }
  if (/^Advanced Artifice$/i.test(name)) {
    rules.push(rule(`\t\t\t<stat name="attunement:max" value="1" bonus="advanced artifice" />`, 'Increase maximum attuned magic items to five.', text));
  }
  if (/^Magic Item Master$/i.test(name)) {
    rules.push(rule(`\t\t\t<stat name="attunement:max" value="1" bonus="magic item master" />`, 'Increase maximum attuned magic items to six.', text));
  }
  if (/^Epic Boon$/i.test(name)) {
    rules.push(rule(
      `\t\t\t<select type="Feat" name="Epic Boon (${escAttrXml(cls.name)})" supports="Epic Boon" />`,
      'Choose an Epic Boon feat.',
      text
    ));
  }
  return dedupeRules(rules);
}

function genClassXml(cls, source, prefix, meta) {
  const classId = `${prefix}_CLASS_${idify(cls.name)}`;
  const mcId = multiclassId(cls, prefix);
  const requirementNotMulticlass = `!${mcId}`;
  const featureElements = classFeatureElements(cls);
  const lines = [];

  // Primary class element
  lines.push(`\t<element name="${escAttrXml(cls.name)}" type="Class" source="${escAttrXml(source)}" id="${classId}">`);
  lines.push(`\t\t<description>`);
  lines.push(`\t\t\t<p>${escXml(cls.description||'')}</p>`);
  featureElements.forEach(f => {
    const fid = classFeatureId(cls, f.name, prefix);
    lines.push(`\t\t\t<div element="${fid}" />`);
  });
  lines.push(`\t\t</description>`);
  lines.push(`\t\t<sheet display="false" />`);
  lines.push(`\t\t<setters>`);
  const short = classShortDescription(cls);
  if (short) lines.push(`\t\t\t<set name="short">${escXml(short)}</set>`);
  lines.push(`\t\t\t<set name="hd">d${cls.hitDie||8}</set>`);
  lines.push(`\t\t\t<set name="hp">${cls.hitDie||8}</set>`);
  const proficiencies = classProficienciesSummary(cls);
  if (proficiencies) lines.push(`\t\t\t<set name="proficiencies">${escXml(proficiencies)}</set>`);
  if (cls.startingEquipment) lines.push(`\t\t\t<set name="equipment">${escXml(cls.startingEquipment)}</set>`);
  lines.push(`\t\t</setters>`);
  lines.push(`\t\t<rules>`);
  const classRules = [];
  // Saving throw proficiencies
  (cls.savingThrows||[]).forEach(st => {
    const sid = classSavingThrowProficiencyId(st);
    if (sid) classRules.push(rule(
      `\t\t\t<grant type="Proficiency" id="${sid}" requirements="${escAttrXml(requirementNotMulticlass)}" />`,
      `Gain ${st} saving throw proficiency.`,
      `Saving Throws: ${(cls.savingThrows || []).join(', ')}`
    ));
  });
  // Armor & weapon proficiencies
  (cls.armorProficiencies||[]).forEach(a => {
    const aid = classArmorProficiencyId(a);
    if (aid) classRules.push(rule(
      `\t\t\t<grant type="Proficiency" id="${aid}" requirements="${escAttrXml(requirementNotMulticlass)}" />`,
      `Gain ${normalizeArmorProficiencyName(a)} training.`,
      `Armor: ${(cls.armorProficiencies || []).join(', ')}`
    ));
  });
  (cls.weaponProficiencies||[]).forEach(w => {
    const wid = classWeaponProficiencyId(w);
    if (wid) classRules.push(rule(
      `\t\t\t<grant type="Proficiency" id="${wid}" requirements="${escAttrXml(requirementNotMulticlass)}" />`,
      `Gain ${normalizeWeaponProficiencyName(w)} proficiency.`,
      `Weapons: ${(cls.weaponProficiencies || []).join(', ')}`
    ));
  });
  (cls.toolProficiencies||[]).forEach(tool => {
    const xml = classToolProficiencyRule(tool, cls, requirementNotMulticlass);
    if (xml) classRules.push(rule(
      `\t\t\t${xml}`,
      `Gain ${normalizeExtractedName(tool)} proficiency.`,
      `Tools: ${(cls.toolProficiencies || []).join(', ')}`
    ));
  });
  // Skill choices
  if (cls.skillChoices && cls.skillChoices.count) {
    classRules.push(rule(
      `\t\t\t<select type="Proficiency" name="Skill Proficiency (${escAttrXml(cls.name)})" number="${cls.skillChoices.count}" supports="${escAttrXml(classSkillSupports(cls.skillChoices.from))}" requirements="${escAttrXml(requirementNotMulticlass)}" />`,
      `Choose ${cls.skillChoices.count} class skill proficiencies.`,
      `Skills: ${(cls.skillChoices.from || []).join(', ')}`
    ));
  }
  // Class features granted per level
  classProgressionFeatureGrants(cls).forEach(f => {
    const fid = classFeatureId(cls, f.name, prefix);
    classRules.push(rule(
      `\t\t\t<grant type="Class Feature" id="${fid}" level="${f.level||1}" />`,
      `Grant ${f.name} at ${cls.name} level ${f.level || 1}.`,
      f.name
    ));
  });
  renderRuleLines(lines, classRules);
  lines.push(`\t\t</rules>`);
  if (cls.spellcastingAbility || cls.skillChoices?.count || cls.armorProficiencies?.length || cls.toolProficiencies?.length) {
    const prerequisite = cls.spellcastingAbility ? `${cls.spellcastingAbility} 13` : '';
    const requirements = classAbilityRequirement(cls.spellcastingAbility);
    lines.push(`\t\t<multiclass id="${mcId}">`);
    if (prerequisite) lines.push(`\t\t\t<prerequisite>${escXml(prerequisite)}</prerequisite>`);
    if (requirements) lines.push(`\t\t\t<requirements>${escXml(requirements)}</requirements>`);
    lines.push(`\t\t\t<setters>`);
    lines.push(`\t\t\t\t<set name="multiclass proficiencies">${escXml(multiclassProficienciesSummary(cls))}</set>`);
    lines.push(`\t\t\t</setters>`);
    lines.push(`\t\t\t<rules>`);
    lines.push(`\t\t\t\t<grant type="Grants" id="ID_INTERNAL_GRANT_MULTICLASS" />`);
    renderMulticlassRuleLines(lines, cls);
    lines.push(`\t\t\t</rules>`);
    lines.push(`\t\t</multiclass>`);
  }
  lines.push(`\t</element>`);

  // Class Feature child elements
  featureElements.forEach(f => {
    const fid = classFeatureId(cls, f.name, prefix);
    lines.push(`\t<element name="${escAttrXml(f.name)}" type="Class Feature" source="${escAttrXml(source)}" id="${fid}">`);
    lines.push(`\t\t<compendium display="false" />`);
    lines.push(`\t\t<description>`);
    lines.push(`\t\t\t<p><em>${f.level||1}${ordinal(f.level||1)}-level ${escXml(cls.name)} feature</em></p>`);
    lines.push(`\t\t\t<p>${escXml(f.description||'')}</p>`);
    lines.push(`\t\t</description>`);
    const sheetAttrs = [
      f.action ? `action="${escAttrXml(f.action)}"` : '',
      f.usage  ? `usage="${escAttrXml(f.usage)}"` : '',
    ].filter(Boolean).join(' ');
    lines.push(`\t\t<sheet${sheetAttrs ? ' '+sheetAttrs : ''}>`);
    lines.push(`\t\t\t<description>${escXml(f.description||'')}</description>`);
    lines.push(`\t\t</sheet>`);
    const archetypeSelect = isArchetypeSelectionFeature(f, cls);
    if (archetypeSelect) {
      lines.push(`\t\t<rules>`);
      renderRuleLines(lines, inferClassFeatureRules(cls, f, meta));
      lines.push(`\t\t</rules>`);
    } else {
      if (/^Spellcasting$/i.test(f.name || '') && hasClassSpellcasting(cls)) {
        const list = cls.spellcastingList || cls.name;
        const ability = cls.spellcastingAbility ? ` ability="${escAttrXml(cls.spellcastingAbility)}"` : '';
        const prepare = spellcastingPrepareAttribute(cls);
        lines.push(`\t\t<spellcasting name="${escAttrXml(cls.name)}"${ability}${prepare}>`);
        lines.push(`\t\t\t<list known="true">${escXml(list)}</list>`);
        lines.push(`\t\t</spellcasting>`);
      }
      const featureRules = inferClassFeatureRules(cls, f, meta);
      lines.push(`\t\t<rules>`);
      renderRuleLines(lines, featureRules);
      lines.push(`\t\t</rules>`);
    }
    lines.push(`\t</element>`);
  });

  return lines;
}

function genMagicXml(item, source, prefix) {
  const id = `${prefix}_MAGIC_ITEM_${idify(item.name)}`;
  const lines = [];
  lines.push(`\t<element name="${escAttrXml(item.name)}" type="Magic Item" source="${escAttrXml(source)}" id="${id}">`);
  lines.push(`\t\t<description><p>${escXml(item.description||'')}</p></description>`);
  lines.push(`\t\t<sheet>`);
  lines.push(`\t\t\t<description>${escXml(item.description||'')}</description>`);
  lines.push(`\t\t</sheet>`);
  lines.push(`\t\t<setters>`);
  const currency = item.currency || 'gp';
  const cost = item.cost || '0';
  const weight = item.weight || '0';
  lines.push(`\t\t\t<set name="category">${escXml(item.category || magicCategoryFromType(item.type))}</set>`);
  lines.push(`\t\t\t<set name="cost" currency="${escAttrXml(currency)}">${escXml(cost)}</set>`);
  lines.push(`\t\t\t<set name="weight" lb="${escAttrXml(weight)}">${escXml(weight)} lb.</set>`);
  lines.push(`\t\t\t<set name="type">${escXml(item.type||'Wondrous Item')}</set>`);
  lines.push(`\t\t\t<set name="rarity">${escXml(item.rarity||'Uncommon')}</set>`);
  lines.push(`\t\t\t<set name="attunement">${!!item.requiresAttunement}</set>`);
  if (item.charges > 0) lines.push(`\t\t\t<set name="charges">${item.charges}</set>`);
  if (item.recharge) lines.push(`\t\t\t<set name="recharge">${escXml(item.recharge)}</set>`);
  lines.push(`\t\t</setters>`);
  lines.push(`\t</element>`);
  return lines;
}

// ---------------------------------------------
// Download & Preview
// ---------------------------------------------
function generateAndDownload() {
  const meta = getSourceMeta();
  const issues = validateAll();
  if (!showValidationResult(issues)) {
    if (!confirm(`There are ${issues.length} validation issue(s). Download anyway?`)) return;
  }
  const xml = generateXml();
  const blob = new Blob([xml], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${meta.slug}.xml`;
  a.click();
  URL.revokeObjectURL(url);
  clearChanged();
}

function showXmlPreview() {
  const wrap = document.getElementById('xmlPreviewWrap');
  const wasHidden = wrap.classList.contains('hidden');
  wrap.classList.toggle('hidden');
  if (!wrap.classList.contains('hidden')) {
    showValidationResult(validateAll());
    // Always regenerate so preview reflects latest edits
    document.getElementById('xmlPreview').textContent = generateXml();
    clearChanged();
  }
}

function generateAndDownloadRefreshPreview() {
  // If preview is currently open, regenerate it after download
  generateAndDownload();
  const wrap = document.getElementById('xmlPreviewWrap');
  if (!wrap.classList.contains('hidden')) {
    document.getElementById('xmlPreview').textContent = generateXml();
  }
}

// ---------------------------------------------
// Utilities
// ---------------------------------------------
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escAttr(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function stripInvalidXmlChars(s) {
  return String(s || '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

function escXml(s) { return stripInvalidXmlChars(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escAttrXml(s) { return escXml(s).replace(/"/g,'&quot;'); }

function ordinal(n) {
  if (n >= 11 && n <= 13) return 'th';
  switch (n % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

function resetAll() {
  extractedData = {};
  generatedBaselineData = {};
  discoveredPageRanges = {};
  skippedItems = [];
  pdfFile = null;
  document.getElementById('pdfFile').value = '';
  document.getElementById('fileInfo').classList.add('hidden');
  document.getElementById('fileSizeWarning').classList.add('hidden');
  document.getElementById('uploadZone').classList.remove('hidden');
  document.getElementById('stepReview').classList.add('hidden');
  document.getElementById('reviewArea').classList.add('hidden');
  document.getElementById('extractProgress').classList.add('hidden');
  document.getElementById('extractErrors').classList.add('hidden');
  document.getElementById('extractErrors').innerHTML = '';
  document.getElementById('keyTestResult').classList.add('hidden');
  document.getElementById('progressBar').style.width = '0%';
  document.getElementById('xmlPreviewWrap').classList.add('hidden');
  document.getElementById('sourceName').value = '';
  document.getElementById('sourceAbbr').value = '';
  document.getElementById('sourceAuthor').value = '';
  document.getElementById('sourceYear').value = '';
  delete document.getElementById('sourceYear').dataset.rulesetEvidence;
  document.getElementById('pageRange').value = '';
  updateSourceRulesetDecisionDisplay();
  clearChanged();
  checkExtractReady();
}

window.AuroraXMLHelper = {
  parseFeatsFromText,
  parseArchetypesFromText,
  parseClassesFromText,
  parseRacesFromText,
  parseBackgroundsFromText,
  parseSpellsFromText,
  parseItemsFromText,
  parseMagicItemsFromText,
  getSourceMeta,
  detectModernRulesetSignal,
  detectModernRulesetSignals,
  captureGeneratedBaseline,
  applyRememberedOverridesToExtractedData,
  rememberOverride,
  forgetOverride,
  revertToGenerated,
  generateXml,
  buildZipXmlDocuments,
  validateAll
};

if (document.documentElement?.dataset) {
  document.documentElement.dataset.auroraAppLoaded = 'true';
}
