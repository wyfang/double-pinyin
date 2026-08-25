const DICTIONARIES = [
  {
    url: "./assets/dictionaries/8105.dict.yaml",
    size: 114599,
  },
  {
    url: "./assets/dictionaries/base.dict.yaml",
    size: 16626627,
  },
];
const DICTIONARY_URLS = DICTIONARIES.map((dictionary) => dictionary.url);

const DICTIONARY_CACHE_DB = "decode-dictionary-cache";
const DICTIONARY_CACHE_STORE = "files";
const DICTIONARY_CACHE_VERSION = 1;
const LOAD_STALL_DELAY = 8000;
const LOAD_TIMEOUT = 45000;

const SPECIAL_INITIALS = {
  v: "zh",
  i: "ch",
  u: "sh",
};

const ZERO_INITIAL_EXACT = {
  aa: "a",
  ai: "ai",
  an: "an",
  ao: "ao",
  oo: "o",
  ou: "ou",
  ee: "e",
  ei: "ei",
  en: "en",
  er: "er",
};

const REGULAR_INITIALS = new Set(
  "b p m f d t n l g k h j q x r z c s y w".split(" "),
);

const wordMap = new Map();
let dictionaryStatus = "loading";
let mode = "loading";
let currentTheme = "system";
let manualTheme = false;
let loadingMessage = "";
let currentLoadingPercent = 0;
let targetLoadingPercent = 0;
let loadingProgressFrame = 0;
let lastLoadingFrameTime = 0;
let isAnimating = false;
let currentDecodedText = "";

function normalizeInput(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z' ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitCodes(value) {
  const normalized = normalizeInput(value);
  if (!normalized) {
    return [];
  }

  if (normalized.includes(" ") || normalized.includes("'")) {
    return normalized.split(/[ ']+/).filter(Boolean);
  }

  return normalized.match(/.{1,2}/g) || [];
}

function decodePair(code) {
  if (code.length !== 2) {
    return code;
  }

  if (ZERO_INITIAL_EXACT[code]) {
    return ZERO_INITIAL_EXACT[code];
  }

  if (isZeroInitialCode(code[0], code[1])) {
    return decodeZeroInitial(code[0], code[1]);
  }

  if (!REGULAR_INITIALS.has(code[0]) && !SPECIAL_INITIALS[code[0]]) {
    return code;
  }

  const initial = SPECIAL_INITIALS[code[0]] || code[0];
  const final = decodeFinal(initial, code[1]);
  return normalizePinyin(initial + final);
}

function decodeFinal(initial, key) {
  const zcsGroup = new Set(["g", "k", "h", "zh", "ch", "sh", "r", "z", "c", "s"]);
  const uiGroup = new Set(["d", "t", "g", "k", "h", "zh", "ch", "sh", "r", "z", "c", "s"]);
  const uoGroup = new Set(["d", "t", "n", "l", "g", "k", "h", "zh", "ch", "sh", "r", "z", "c", "s"]);
  const iangGroup = new Set(["j", "q", "x", "n", "l"]);

  const finals = {
    q: "iu",
    w: "ei",
    e: "e",
    r: "uan",
    t: "ve",
    y: "un",
    u: "u",
    i: "i",
    o: uoGroup.has(initial) ? "uo" : "o",
    p: "ie",
    a: "a",
    s: ["j", "q", "x"].includes(initial) ? "iong" : "ong",
    d: "ai",
    f: "en",
    g: "eng",
    h: "ang",
    j: "an",
    k: zcsGroup.has(initial) ? "uai" : "ing",
    l: iangGroup.has(initial) ? "iang" : "uang",
    z: "ou",
    x: zcsGroup.has(initial) ? "ua" : "ia",
    c: "ao",
    v: decodeVFinal(initial, uiGroup),
    b: "in",
    n: "iao",
    m: "ian",
  };

  return finals[key] || key;
}

function decodeVFinal(initial, uiGroup) {
  if (uiGroup.has(initial)) {
    return "ui";
  }

  if (["j", "q", "x", "y"].includes(initial)) {
    return "u";
  }

  if (["n", "l"].includes(initial)) {
    return "v";
  }

  return "v";
}

function isZeroInitialCode(first, second) {
  return ["a", "o", "e"].includes(first) && first !== second;
}

function decodeZeroInitial(first, second) {
  const finals = {
    a: {
      d: "ai",
      j: "an",
      h: "ang",
      c: "ao",
    },
    o: {
      z: "ou",
    },
    e: {
      w: "ei",
      f: "en",
      g: "eng",
      r: "er",
    },
  };

  return finals[first]?.[second] || first + second;
}

function normalizePinyin(pinyin) {
  return pinyin.replace(/([jqxy])v/g, "$1u");
}

function addEntry(pinyin, text, weight) {
  const normalizedPinyin = pinyin.replace(/\s+/g, " ").trim();

  if (!/^[a-z]+(?: [a-z]+)*$/.test(normalizedPinyin) || !text) {
    return;
  }

  const syllableCount = normalizedPinyin.split(" ").length;
  const score = Number.isFinite(weight) && weight > 0 ? weight : 1;
  const current = wordMap.get(normalizedPinyin);

  if (!current || score > current.rawScore) {
    wordMap.set(normalizedPinyin, {
      text,
      rawScore: score,
      syllableCount,
    });
  }
}

function parseRimeDictionary(source) {
  let count = 0;

  for (const rawLine of source.split("\n")) {
    const line = rawLine.trimEnd();

    if (!line || line.trimStart().startsWith("#") || !line.includes("\t")) {
      continue;
    }

    const [text, pinyin, rawWeight] = line.split("\t");
    const word = text.trim();
    const py = pinyin?.trim();
    const weight = Number(rawWeight?.trim());

    if (!py) {
      continue;
    }

    addEntry(py, word, weight);
    count += 1;
  }

  return count;
}

async function loadDictionaries() {
  setMode("loading");
  currentLoadingPercent = 0;
  targetLoadingPercent = 0;
  lastLoadingFrameTime = 0;
  loadingMessage = "";
  renderLoadingProgress(0, true);
  const cachedResponses = await readCachedDictionaries();

  if (cachedResponses) {
    wordMap.clear();
    cachedResponses.forEach(parseRimeDictionary);
    await finishLoadingProgress();
    setMode("input");
    return;
  }

  const progress = DICTIONARIES.map((dictionary) => ({
    loaded: 0,
    total: dictionary.size,
    done: false,
  }));
  const stalledTimer = window.setTimeout(() => {
    loadingMessage = "network is slow. still trying.";
    renderLoadingProgress(getCombinedProgress(progress));
  }, LOAD_STALL_DELAY);

  try {
    const responses = await Promise.all(
      DICTIONARIES.map((dictionary, index) =>
        loadTextWithProgress(dictionary.url, {
          estimate: dictionary.size,
          timeout: LOAD_TIMEOUT,
          onProgress: (loaded, total) => {
            progress[index] = {
              loaded,
              total: total || dictionary.size,
              done: false,
            };
            renderLoadingProgress(getCombinedProgress(progress));
          },
        }).then((text) => {
          progress[index].done = true;
          progress[index].loaded = progress[index].total;
          renderLoadingProgress(getCombinedProgress(progress));
          return text;
        }),
      ),
    );

    window.clearTimeout(stalledTimer);
    wordMap.clear();
    responses.forEach(parseRimeDictionary);
    await saveCachedDictionaries(responses);
    await finishLoadingProgress();
    setMode("input");
  } catch (error) {
    window.clearTimeout(stalledTimer);
    console.error(error);
    loadingMessage = "network problem. refresh to try again.";
    dictionaryStatus = "failed";
    renderLoadingProgress(currentLoadingPercent, true);
    setMode("failed");
  }
}

async function readCachedDictionaries() {
  try {
    const db = await openDictionaryCache();
    const records = await Promise.all(
      DICTIONARIES.map((dictionary) => getCachedDictionary(db, dictionary)),
    );

    db.close();
    return records.every(Boolean) ? records.map((record) => record.text) : null;
  } catch (error) {
    console.warn(error);
    return null;
  }
}

async function saveCachedDictionaries(responses) {
  try {
    const db = await openDictionaryCache();

    await Promise.all(
      DICTIONARIES.map((dictionary, index) =>
        putCachedDictionary(db, {
          key: getDictionaryCacheKey(dictionary),
          url: dictionary.url,
          size: dictionary.size,
          text: responses[index],
          savedAt: Date.now(),
        }),
      ),
    );

    db.close();
  } catch (error) {
    console.warn(error);
  }
}

function openDictionaryCache() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("indexedDB unavailable"));
      return;
    }

    const request = window.indexedDB.open(DICTIONARY_CACHE_DB, DICTIONARY_CACHE_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(DICTIONARY_CACHE_STORE)) {
        db.createObjectStore(DICTIONARY_CACHE_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getCachedDictionary(db, dictionary) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DICTIONARY_CACHE_STORE, "readonly");
    const store = transaction.objectStore(DICTIONARY_CACHE_STORE);
    const request = store.get(getDictionaryCacheKey(dictionary));

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

function putCachedDictionary(db, record) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DICTIONARY_CACHE_STORE, "readwrite");
    const store = transaction.objectStore(DICTIONARY_CACHE_STORE);
    const request = store.put(record);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function getDictionaryCacheKey(dictionary) {
  return `${dictionary.url}|${dictionary.size}`;
}

function loadTextWithProgress(url, options) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const timer = window.setTimeout(() => {
      xhr.abort();
      reject(new Error(`timeout ${url}`));
    }, options.timeout);

    xhr.open("GET", url);
    xhr.responseType = "text";
    xhr.onprogress = (event) => {
      options.onProgress(event.loaded, event.lengthComputable ? event.total : options.estimate);
    };
    xhr.onload = () => {
      window.clearTimeout(timer);

      if (xhr.status >= 200 && xhr.status < 300) {
        options.onProgress(xhr.responseText.length, xhr.responseText.length);
        resolve(xhr.responseText);
      } else {
        reject(new Error(`${xhr.status} ${url}`));
      }
    };
    xhr.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error(`network ${url}`));
    };
    xhr.onabort = () => {
      window.clearTimeout(timer);
      reject(new Error(`aborted ${url}`));
    };
    xhr.send();
  });
}

function getCombinedProgress(progress) {
  const loaded = progress.reduce((sum, item) => sum + Math.min(item.loaded, item.total), 0);
  const total = progress.reduce((sum, item) => sum + item.total, 0);
  return total ? Math.min(99, Math.round((loaded / total) * 100)) : 0;
}

function getCurrentLoadingPercent() {
  return currentLoadingPercent;
}

function renderLoadingProgress(progress, immediate = false) {
  if (!loadingTitle || !loadingDetail) {
    return;
  }

  targetLoadingPercent = Math.max(targetLoadingPercent, Math.max(0, Math.min(100, progress)));

  if (immediate) {
    if (loadingProgressFrame) {
      window.cancelAnimationFrame(loadingProgressFrame);
      loadingProgressFrame = 0;
    }

    currentLoadingPercent = targetLoadingPercent;
    lastLoadingFrameTime = 0;
    paintLoadingProgress();
    return;
  }

  if (!loadingProgressFrame) {
    loadingProgressFrame = window.requestAnimationFrame(animateLoadingProgress);
  }
}

function animateLoadingProgress(timestamp) {
  if (!lastLoadingFrameTime) {
    lastLoadingFrameTime = timestamp;
  }

  const elapsed = Math.min(80, timestamp - lastLoadingFrameTime);
  lastLoadingFrameTime = timestamp;
  const delta = targetLoadingPercent - currentLoadingPercent;
  const isLoading = dictionaryStatus === "loading";
  const softCeiling = isLoading ? 96 : targetLoadingPercent;

  if (Math.abs(delta) < 0.08 && (!isLoading || currentLoadingPercent >= softCeiling)) {
    currentLoadingPercent = targetLoadingPercent;
    loadingProgressFrame = 0;
    lastLoadingFrameTime = 0;
    paintLoadingProgress();
    return;
  }

  if (delta > 0.08) {
    const approachRate = isLoading ? 0.055 : 0.14;
    currentLoadingPercent += Math.max(0.05, Math.abs(delta) * approachRate);
  } else if (isLoading && currentLoadingPercent < softCeiling) {
    const driftSpeed = currentLoadingPercent < 80 ? 5.5 : 1.8;
    currentLoadingPercent += (driftSpeed * elapsed) / 1000;
  }

  currentLoadingPercent = Math.min(currentLoadingPercent, softCeiling, 100);
  paintLoadingProgress();
  loadingProgressFrame = window.requestAnimationFrame(animateLoadingProgress);
}

function paintLoadingProgress() {
  const roundedProgress = Math.round(currentLoadingPercent);
  loadingTitle.textContent = dictionaryStatus === "failed" ? "failed" : `loading ${roundedProgress}%`;
  loadingDetail.textContent = loadingMessage;
  loadingProgress.style.transform = `scaleX(${currentLoadingPercent / 100})`;
  loadingProgress.setAttribute("aria-valuenow", `${roundedProgress}`);
}

async function finishLoadingProgress() {
  dictionaryStatus = "ready";
  renderLoadingProgress(100);

  await new Promise((resolve) => {
    function checkProgress() {
      if (currentLoadingPercent >= 100 && !loadingProgressFrame) {
        resolve();
        return;
      }

      window.requestAnimationFrame(checkProgress);
    }

    checkProgress();
  });
  await new Promise((resolve) => window.setTimeout(resolve, 140));
}

function scoreEntry(entry) {
  const logWeight = Math.log10(entry.rawScore + 1);
  const length = entry.syllableCount;
  const weightFactor = 100 + length * 80;
  const phraseBonus = length > 1 ? length * length * 300 : 0;

  return logWeight * weightFactor + phraseBonus;
}

function convertPinyinToText(syllables) {
  if (!syllables.length) {
    return "";
  }

  const maxWordLength = 8;
  const dp = Array.from({ length: syllables.length + 1 }, () => ({
    score: -Infinity,
    text: "",
  }));

  dp[0] = { score: 0, text: "" };

  for (let i = 0; i < syllables.length; i += 1) {
    if (dp[i].score === -Infinity) {
      continue;
    }

    for (let len = 1; len <= maxWordLength && i + len <= syllables.length; len += 1) {
      const key = syllables.slice(i, i + len).join(" ");
      const entry = wordMap.get(key);

      if (!entry) {
        continue;
      }

      const score = dp[i].score + scoreEntry(entry);

      if (score > dp[i + len].score) {
        dp[i + len] = {
          score,
          text: dp[i].text + entry.text,
        };
      }
    }

    const fallbackScore = dp[i].score - 600;

    if (fallbackScore > dp[i + 1].score) {
      dp[i + 1] = {
        score: fallbackScore,
        text: dp[i].text + syllables[i],
      };
    }
  }

  return dp[syllables.length].text;
}

function convert(value) {
  const codes = splitCodes(value);
  const syllables = codes.map(decodePair);
  const text = convertPinyinToText(syllables);

  return {
    codes,
    syllables,
    text,
  };
}

function convertWithSymbols(value) {
  const parts = value.match(/[a-zA-Z' ]+|[^a-zA-Z' ]+/g) || [];

  return parts
    .map((part) => {
      if (!/[a-zA-Z]/.test(part)) {
        return part;
      }

      const leadingSpace = part.match(/^\s*/)[0];
      const trailingSpace = part.match(/\s*$/)[0];

      return leadingSpace + convert(part.trim()).text + trailingSpace;
    })
    .join("");
}

const app = document.querySelector("#app");
const loading = document.querySelector("#loading");
const loadingTitle = document.querySelector("#loadingTitle");
const loadingDetail = document.querySelector("#loadingDetail");
const loadingProgress = document.querySelector("#loadingProgress");
const stage = document.querySelector("#stage");
const textViewport = document.querySelector("#textViewport");
const textFrame = document.querySelector("#textFrame");
const sourceText = document.querySelector("#sourceText");
const decodedText = document.querySelector("#decodedText");
const decodedMeasure = document.querySelector("#decodedMeasure");
const emptyInputCaret = document.querySelector("#emptyInputCaret");
const actionButton = document.querySelector("#actionButton");
const themeToggle = document.querySelector("#themeToggle");
const themeIcon = document.querySelector("#themeIcon");
const shortcutLabel = document.querySelector("#shortcutLabel");

function setMode(nextMode, options = {}) {
  mode = nextMode;
  updateViewportHeight();
  app.dataset.state = nextMode;
  loading.hidden = nextMode !== "loading" && nextMode !== "failed";
  stage.hidden = nextMode === "loading" || nextMode === "failed";

  if (nextMode === "failed") {
    renderLoadingProgress(getCurrentLoadingPercent(), true);
  } else if (nextMode === "loading") {
    loadingTitle.textContent = "loading";
    loadingDetail.textContent = loadingMessage;
  }

  sourceText.hidden = nextMode !== "input";
  decodedText.hidden = nextMode !== "output";
  actionButton.classList.toggle("is-clear", nextMode === "output");
  shortcutLabel.textContent = nextMode === "output" ? "ESC" : "ENTER";
  textViewport.scrollTop = 0;
  syncEmptyInputState();

  requestAnimationFrame(() => {
    if (options.fit !== false) {
      fitActiveText();
      refitAfterFontLoad(getActiveTextElement());
    }
    syncActionVisibility();

    if (nextMode === "input") {
      sourceText.focus();
      placeCaretAtEnd(sourceText);
    }
  });
}

function getActiveTextElement() {
  return mode === "output" ? decodedText : sourceText;
}

function getMaximumTextSize(target) {
  const isDecoded = target === decodedText || target === decodedMeasure;
  const content = isDecoded ? target.textContent : target.value;
  const characterCount = Array.from(content.replace(/\s/g, "")).length;

  if (isDecoded && textViewport.clientWidth <= 480 && characterCount >= 10) {
    return 80;
  }

  return 128;
}

function fitActiveText() {
  updateViewportHeight();
  const target = getActiveTextElement();

  if (!target || target.hidden) {
    return;
  }

  if (target === decodedText && isAnimating && currentDecodedText) {
    fitDecodedTextForValue(currentDecodedText);
    layoutAnimatedOutput();
    return;
  }

  fitText(target);
}

function refitAfterFontLoad(target) {
  if (!target || !document.fonts?.load) {
    return;
  }

  const isDecoded = target === decodedText;
  const font = isDecoded
    ? '400 128px "Noto Serif SC"'
    : '400 128px "Share Tech Mono"';
  const sample = (isDecoded ? target.textContent : target.value) || (isDecoded ? "译" : "CODE");

  document.fonts
    .load(font, sample)
    .then(() => {
      if (target === getActiveTextElement() && !target.hidden) {
        fitActiveText();
      }
    })
    .catch(() => {});
}

function fitText(target, options = {}) {
  const minimum = 21;
  const maximum = getMaximumTextSize(target);
  let low = minimum;
  let high = maximum;
  let best = minimum;

  target.style.overflowY = "hidden";
  target.style.height = "auto";
  target.style.fontSize = `${maximum}px`;

  while (low <= high) {
    const midpoint = Math.floor((low + high) / 2);
    target.style.fontSize = `${midpoint}px`;

    if (textFits(target)) {
      best = midpoint;
      low = midpoint + 1;
    } else {
      high = midpoint - 1;
    }
  }

  target.style.fontSize = `${best}px`;
  const fits = textFits(target);
  resizeTextHeight(target);

  if (options.manageScroll === false) {
    return;
  }

  if (fits) {
    textViewport.scrollTop = 0;
  } else if (
    target === sourceText &&
    sourceText.selectionStart === sourceText.value.length &&
    sourceText.selectionEnd === sourceText.value.length
  ) {
    requestAnimationFrame(scrollTextToEnd);
  }
}

function textFits(target) {
  const margin = 2;

  return (
    target.scrollHeight <= getAvailableTextHeight() - margin &&
    target.scrollWidth <= target.clientWidth + margin
  );
}

function getAvailableTextHeight() {
  const frameStyle = window.getComputedStyle(textFrame);
  const paddingTop = Number.parseFloat(frameStyle.paddingTop) || 0;
  const paddingBottom = Number.parseFloat(frameStyle.paddingBottom) || 0;

  return Math.max(1, textViewport.clientHeight - paddingTop - paddingBottom);
}

function resizeTextHeight(target) {
  target.style.height = "0px";
  target.style.height = `${Math.ceil(target.scrollHeight)}px`;
  target.style.overflowY = "hidden";
}

function fitDecodedTextForValue(value) {
  decodedMeasure.textContent = value;
  fitText(decodedMeasure, { manageScroll: false });
  decodedText.style.fontSize = decodedMeasure.style.fontSize;
  decodedMeasure.replaceChildren();
  decodedMeasure.style.height = "0px";
}

function scrollTextToEnd() {
  textViewport.scrollTop = Math.max(0, textViewport.scrollHeight - textViewport.clientHeight);
}

function layoutAnimatedOutput() {
  resizeTextHeight(decodedText);
  scrollTextToEnd();
}

async function decodeCurrentText() {
  if (dictionaryStatus !== "ready" || isAnimating) {
    return;
  }

  const value = getSourceValue().trim();

  if (getActionableLength(value) < 2) {
    fitActiveText();
    return;
  }

  const finalText = convertWithSymbols(value);
  currentDecodedText = finalText;
  isAnimating = true;
  syncActionVisibility();

  if (document.fonts?.load) {
    try {
      await document.fonts.load('400 128px "Noto Serif SC"', finalText);
    } catch (error) {
      console.warn(error);
    }
  }

  try {
    setMode("output", { fit: false });
    fitDecodedTextForValue(finalText);
    decodedText.replaceChildren();
    resizeTextHeight(decodedText);
    await TextEffects.scrambleToText(decodedText, finalText, {
      onLayout: layoutAnimatedOutput,
    });
  } catch (error) {
    console.error(error);
    decodedText.textContent = finalText;
  } finally {
    isAnimating = false;
    resizeTextHeight(decodedText);
    syncActionVisibility();
  }
}

async function clearText() {
  if (isAnimating) {
    return;
  }

  if (mode !== "output") {
    setSourceValue("");
    decodedText.replaceChildren();
    setMode("input");
    return;
  }

  isAnimating = true;
  syncActionVisibility();

  try {
    await TextEffects.destroyText(decodedText, {
      onLayout: fitActiveText,
    });
  } catch (error) {
    console.error(error);
  } finally {
    setSourceValue("");
    decodedText.replaceChildren();
    currentDecodedText = "";
    isAnimating = false;
    setMode("input");
  }
}

function placeCaretAtEnd(element) {
  if ("setSelectionRange" in element) {
    const length = element.value.length;
    element.setSelectionRange(length, length);
    return;
  }

  const range = document.createRange();
  const selection = window.getSelection();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function insertTextAtSelection(text) {
  if ("selectionStart" in sourceText && "selectionEnd" in sourceText) {
    const start = sourceText.selectionStart;
    const end = sourceText.selectionEnd;
    const value = getSourceValue();
    setSourceValue(value.slice(0, start) + text + value.slice(end));
    const nextPosition = start + text.length;
    sourceText.setSelectionRange(nextPosition, nextPosition);
    return;
  }

  const selection = window.getSelection();

  if (!selection || !selection.rangeCount) {
    sourceText.append(document.createTextNode(text));
    placeCaretAtEnd(sourceText);
    return;
  }

  const range = selection.getRangeAt(0);

  if (!sourceText.contains(range.commonAncestorContainer)) {
    sourceText.focus({ preventScroll: true });
    placeCaretAtEnd(sourceText);
    insertTextAtSelection(text);
    return;
  }

  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.setEndAfter(node);
  selection.removeAllRanges();
  selection.addRange(range);
}

function updateViewportHeight() {
  const viewport = window.visualViewport;
  const height = viewport ? viewport.height : window.innerHeight;
  const top = viewport ? viewport.offsetTop : 0;
  document.documentElement.style.setProperty("--app-top", `${top}px`);
  document.documentElement.style.setProperty("--app-height", `${height}px`);
}

function getActionableLength(value) {
  return Array.from(removeHanCharacters(value).replace(/\s/g, "")).length;
}

function syncActionVisibility() {
  const shouldShow =
    !isAnimating && (mode === "output" || getActionableLength(getSourceValue()) >= 2);
  actionButton.disabled = isAnimating;
  actionButton.classList.toggle("is-hidden", !shouldShow);
}

function removeHanCharacters(value) {
  return value.replace(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g, "");
}

function cleanSourceText() {
  const cleaned = removeHanCharacters(getSourceValue());

  if (cleaned !== getSourceValue()) {
    setSourceValue(cleaned);
    placeCaretAtEnd(sourceText);
  }
}

function getSourceValue() {
  return sourceText.value;
}

function setSourceValue(value) {
  sourceText.value = value;
  syncEmptyInputState();
}

function syncEmptyInputState() {
  const isEmptyInput = mode === "input" && getSourceValue().length === 0;
  sourceText.classList.toggle("is-empty", isEmptyInput);
  emptyInputCaret.hidden = !isEmptyInput;
}

function getSystemTheme() {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function setTheme(theme, options = {}) {
  manualTheme = options.manual ?? manualTheme;
  currentTheme = theme;
  const appliedTheme = theme === "system" ? getSystemTheme() : theme;
  document.documentElement.dataset.theme = appliedTheme;
  themeIcon.innerHTML =
    appliedTheme === "dark"
      ? '<path d="M12 3v2"/><path d="M12 19v2"/><path d="M4.22 4.22l1.42 1.42"/><path d="M18.36 18.36l1.42 1.42"/><path d="M3 12h2"/><path d="M19 12h2"/><path d="M4.22 19.78l1.42-1.42"/><path d="M18.36 5.64l1.42-1.42"/><circle cx="12" cy="12" r="4"/>'
      : '<path d="M21 12.79A8.5 8.5 0 1 1 11.21 3 6.5 6.5 0 0 0 21 12.79Z"/>';
}

function restoreInputFocus() {
  if (mode !== "input") {
    return;
  }

  sourceText.focus({ preventScroll: true });
  placeCaretAtEnd(sourceText);
}

textViewport.addEventListener("click", () => {
  if (mode === "input") {
    sourceText.focus();
  }
});

sourceText.addEventListener("input", () => {
  cleanSourceText();
  syncEmptyInputState();
  syncActionVisibility();
  fitActiveText();
});

sourceText.addEventListener("focus", () => {
  sourceText.classList.add("is-focused");
  requestAnimationFrame(() => {
    fitActiveText();
  });
});

sourceText.addEventListener("blur", () => {
  sourceText.classList.remove("is-focused");
  requestAnimationFrame(fitActiveText);
});

sourceText.addEventListener("paste", (event) => {
  event.preventDefault();
  const text = removeHanCharacters(event.clipboardData.getData("text/plain"));
  insertTextAtSelection(text);
  cleanSourceText();
  syncActionVisibility();
  fitActiveText();
});

sourceText.addEventListener("keydown", (event) => {
  if (event.key.length === 1 && /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(event.key)) {
    event.preventDefault();
    return;
  }

  if (event.key === "Enter" && event.shiftKey) {
    event.preventDefault();
    insertTextAtSelection("\n");
    syncActionVisibility();
    fitActiveText();
    return;
  }

  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    decodeCurrentText();
  }

  if (event.key === "Escape") {
    event.preventDefault();
    clearText();
  }
});

window.addEventListener("keydown", (event) => {
  if (mode !== "output" || event.key !== "Escape") {
    return;
  }

  event.preventDefault();
  clearText();
});

actionButton.addEventListener("click", () => {
  if (isAnimating) {
    return;
  }

  if (mode === "output") {
    clearText();
    return;
  }

  decodeCurrentText();
});

themeToggle.addEventListener("pointerdown", (event) => {
  event.preventDefault();
});

themeToggle.addEventListener("click", () => {
  const activeTheme = currentTheme === "system" ? getSystemTheme() : currentTheme;
  setTheme(activeTheme === "dark" ? "light" : "dark", { manual: true });
  requestAnimationFrame(restoreInputFocus);
});

window.addEventListener("resize", fitActiveText);

if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", fitActiveText);
  window.visualViewport.addEventListener("scroll", fitActiveText);
}

updateViewportHeight();
const colorSchemeQuery = window.matchMedia?.("(prefers-color-scheme: dark)");
colorSchemeQuery?.addEventListener("change", () => {
  if (!manualTheme) {
    setTheme("system");
  }
});

setTheme("system");
syncEmptyInputState();
syncActionVisibility();
loadDictionaries();
