"use strict";

/**
 * Policy check: reads ad text and flags anything likely to break Meta's
 * Advertising Standards. Offline, read-only and deterministic: the rules live
 * in policies/rules.json and the plain-words guide in
 * policies/meta-advertising-standards.md.
 *
 *   checkText(text)                 -> report for one string (primary text)
 *   checkCreative(input)            -> report for a creative, carousel spec,
 *                                      Content Studio handoff, cached ad or draft
 *   enforcePolicy({ action, input, override, dryRun })
 *                                   -> runs the check before a create path.
 *                                      BLOCK refuses unless an override reason
 *                                      is given; the override is audited.
 *
 * A report is { status: PASS|WARN|BLOCK, findings: [...], fieldsChecked, ... }.
 * Each finding: { level, ruleId, title, field, where, phrase, explain, rewrite,
 * source, category?, language? }. The report also carries `languages`: what
 * language the copy is in, which word lists checked it, and any language the
 * check has no list for (that text gets a language-not-checked WARN, never a
 * clean PASS).
 *
 * Languages: English rules live in policies/rules.json. Spanish, Portuguese,
 * French, German, Italian, Dutch and Indonesian word lists live in
 * policies/rules-i18n.json and reuse the English rule ids. Text is NFKC
 * normalised (invisible characters removed) and word boundaries are Unicode
 * aware, so accented and non-Latin letters count as letters. Language
 * detection is a cheap stopword and script count per sentence; no model call.
 */

const fs = require("fs");
const path = require("path");
const { writeAudit } = require("./audit-log");

const ROOT = path.join(__dirname, "..");
const RULES_PATH = path.join(ROOT, "policies/rules.json");
const I18N_PATH = path.join(ROOT, "policies/rules-i18n.json");
const STANDARDS_PATH = path.join(ROOT, "policies/meta-advertising-standards.md");
const DATA_DIR = path.join(ROOT, "data");
const STALE_AFTER_DAYS = 90;
const LEVEL_ORDER = { PASS: 0, WARN: 1, BLOCK: 2 };
const EXIT_CODES = { PASS: 0, WARN: 1, BLOCK: 2 };

// Which input keys hold which kind of ad text. Anything not listed (ids,
// image hashes, targeting, budgets, internal names) is never read as copy.
const FIELD_BY_KEY = {
  message: "primaryText", primaryText: "primaryText", primary_text: "primaryText", body: "primaryText",
  caption: "primaryText", text: "primaryText", offer: "primaryText", promise: "primaryText",
  headline: "headline", title: "headline",
  description: "description", link_description: "description",
  callToAction: "callToAction", call_to_action: "callToAction", callToActionType: "callToAction", call_to_action_type: "callToAction",
  link: "link", url: "link", website_url: "link", destinationUrl: "link", destination_url: "link",
  overlayText: "overlayText", overlay: "overlayText", overlay_text: "overlayText", textOverlay: "overlayText", text_overlay: "overlayText",
};
// Keys that never hold ad copy, so the walker skips them and everything under them.
const SKIP_KEYS = new Set([
  "targeting", "insights", "checklist", "campaign", "adSet", "adset", "image", "imageHash", "image_hash", "images",
  "pageId", "page_id", "instagramUserId", "instagram_user_id", "id", "status", "effective_status", "adset_id",
  "campaign_id", "creative_id", "creativeId", "adSetId", "thumbnail_url", "image_url", "url_tags", "placements",
  "policyCheck", "policyOverride", "audience", "angle", "warnings", "uploads", "summary",
]);
// Inside these containers the key "name" is shown to people (Meta's API uses
// link_data.name and child_attachments[].name for the headline).
const NAME_IS_HEADLINE_IN = new Set(["link_data", "child_attachments", "cards", "video_data", "template_data"]);
// Asset feed specs keep copy under { text } in typed arrays.
const TEXT_ARRAY_FIELD = { bodies: "primaryText", titles: "headline", descriptions: "description" };
// Slide arrays from a Content Studio handoff: every line on a slide is overlay text.
const SLIDE_ARRAYS = new Set(["slides", "overlays"]);
const SLIDE_TEXT_KEYS = new Set(["headline", "title", "text", "b_text", "promise", "keyword", "subtitle", "body", "caption", "lines", "items", "overlayText", "overlay"]);

let cachedRules = null;
let cachedI18n = null;

// A letter, combining mark, digit or underscore in any script.
const WORD_CHAR = "[\\p{L}\\p{M}\\p{N}_]";
// Unicode-aware replacement for \b: JavaScript's \b only knows ASCII letters,
// so it treats "é" or "ı" as a boundary and breaks every accented word.
const UNICODE_BOUNDARY = `(?:(?<=${WORD_CHAR})(?!${WORD_CHAR})|(?<!${WORD_CHAR})(?=${WORD_CHAR}))`;

// Rewrites every \b outside a character class into UNICODE_BOUNDARY.
function toUnicodePattern(source) {
  let out = "";
  let inClass = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "\\") {
      const next = source[i + 1];
      if (next === "b" && !inClass) out += UNICODE_BOUNDARY;
      else out += ch + (next === undefined ? "" : next);
      i += 1;
      continue;
    }
    if (ch === "[" && !inClass) inClass = true;
    else if (ch === "]" && inClass) inClass = false;
    out += ch;
  }
  return out;
}

// Compiles a rule pattern with the u flag and Unicode word boundaries.
function compilePattern(pattern, flags) {
  return new RegExp(toUnicodePattern(pattern), `${flags}u`);
}

function loadRules(rulesPath = RULES_PATH) {
  if (rulesPath === RULES_PATH && cachedRules) return cachedRules;
  const raw = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
  const compile = (rule, list) => (list || []).map((pattern) => compilePattern(pattern, rule.flags === undefined ? "gi" : `g${rule.flags}`));
  const subject = compilePattern(raw.personalSubject, "i");
  const rules = (raw.rules || []).map((rule) => ({
    ...rule,
    regexes: compile(rule, rule.type === "personal-attribute" ? rule.attributes : rule.patterns),
  }));
  const special = (raw.specialCategories || []).map((rule) => ({ ...rule, type: "special-category", regexes: compile(rule, rule.patterns) }));
  const all = [...rules, ...special];
  const loaded = { version: raw.version, checkedOn: raw.checkedOn, subject, rules, special, all, byId: new Map(all.map((rule) => [rule.id, rule])) };
  if (rulesPath === RULES_PATH) cachedRules = loaded;
  return loaded;
}

// Non-English word lists. A missing file is not fatal: every non-English
// language is then reported as not checked.
function loadI18n(i18nPath = I18N_PATH) {
  if (i18nPath === I18N_PATH && cachedI18n) return cachedI18n;
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(i18nPath, "utf8"));
  } catch {
    raw = { version: null, commonWords: [], exclusiveLetters: [], languages: { en: { name: "English", lexicon: "rules.json", stopwords: ["the", "and", "you", "your", "for", "with", "is", "to", "of"] } }, unsupported: {}, scripts: [] };
  }
  const languages = {};
  for (const [code, spec] of Object.entries(raw.languages || {})) {
    languages[code] = {
      code,
      name: spec.name,
      english: spec.lexicon === "rules.json",
      stopwords: new Set((spec.stopwords || []).map((word) => foldText(word).text.toLowerCase())),
      subjects: (spec.subject || []).map((entry) => compilePattern(entry.pattern, entry.flags === undefined ? "i" : entry.flags)),
      rules: Object.entries(spec.rules || {}).map(([ruleId, patterns]) => ({ ruleId, regexes: patterns.map((pattern) => compilePattern(pattern, "gi")) })),
    };
  }
  const unsupported = {};
  for (const [code, spec] of Object.entries(raw.unsupported || {})) {
    unsupported[code] = { code, name: spec.name, stopwords: new Set((spec.stopwords || []).map((word) => foldText(word).text.toLowerCase())) };
  }
  const exclusive = (raw.exclusiveLetters || []).map((entry) => ({ ...entry, regex: new RegExp(`[${entry.letters.replace(/\s+/g, "")}]`, "u") }));
  const scripts = (raw.scripts || []).map((entry) => ({ ...entry, regex: new RegExp(`\\p{Script=${entry.script}}`, "gu") }));
  // Short words shared by many languages: they never decide the language,
  // but a sentence that has them is not "unrecognised".
  const commonWords = new Set((raw.commonWords || []).map((word) => foldText(word).text.toLowerCase()));
  const loaded = { version: raw.version, written: raw.written, languages, unsupported, scripts, exclusive, commonWords };
  if (i18nPath === I18N_PATH) cachedI18n = loaded;
  return loaded;
}

// ---------------------------------------------------------------------------
// Normalisation and language detection
// ---------------------------------------------------------------------------

// NFKC (full-width letters, ligatures and lookalike digits become plain ones),
// no invisible characters that could split a word to dodge the check, and
// runs of spaces collapsed so no pattern can backtrack over thousands of them.
function normalizeText(text) {
  return String(text).normalize("NFKC").replace(/[\u00AD\u180E\u200B-\u200F\u2060-\u2064\uFEFF]/g, "").replace(/[^\S\n]+/g, " ").replace(/ ?\n[\s]*/g, (run) => ((run.match(/\n/g) || []).length > 1 ? "\n\n" : "\n"))
    // No real number is 40 digits long; a longer run only slows the patterns.
    .replace(/\d{40,}/g, (run) => run.slice(0, 40));
}

const FOLD_EXTRA = { "ß": "ss", "ẞ": "SS", "ø": "o", "Ø": "O", "ł": "l", "Ł": "L", "đ": "d", "Đ": "D", "æ": "ae", "Æ": "AE", "œ": "oe", "Œ": "OE", "ı": "i" };

// Removes accents so word lists match with or without them ("depresión",
// "depresion"). Keeps case. Returns the folded text plus, for each folded
// UTF-16 unit, where its character starts and ends in the input, so a match
// in the folded text can be reported in the advertiser's own spelling.
function foldText(text) {
  let folded = "";
  const starts = [];
  const ends = [];
  let index = 0;
  for (const ch of String(text)) {
    const piece = FOLD_EXTRA[ch] !== undefined ? FOLD_EXTRA[ch] : ch.normalize("NFD").replace(/\p{M}/gu, "");
    for (let k = 0; k < piece.length; k += 1) { starts.push(index); ends.push(index + ch.length); }
    folded += piece;
    index += ch.length;
  }
  return { text: folded, starts, ends };
}

// German written without umlauts ("Uebergewicht", "Gluckwunsch" as
// "Glueckwunsch"): drops the e after a, o or u so the umlaut-free lists match.
function digraphFold(folded) {
  let text = "";
  const starts = [];
  const ends = [];
  for (let i = 0; i < folded.text.length; i += 1) {
    const ch = folded.text[i];
    if ((ch === "e" || ch === "E") && i > 0 && /[aouAOU]/.test(folded.text[i - 1]) && text.length) {
      ends[ends.length - 1] = folded.ends[i];
      continue;
    }
    text += ch;
    starts.push(folded.starts[i]);
    ends.push(folded.ends[i]);
  }
  return { text, starts, ends };
}

function originalSlice(original, folded, start, end) {
  if (end <= start) return "";
  return original.slice(folded.starts[start], folded.ends[end - 1]);
}

// Sentence spans [start, end) split the same way as sentences(): after . ! ?
// (or their CJK forms) followed by space, and at line breaks.
// A sentence ends at . ! ? (or their CJK forms) followed by space, or at a
// line break. The one exception is a short line (up to three words) followed
// by a line starting in lowercase: that is a wrapped line and is joined, so
// "Are you\n\n depressed?" is one sentence but a heading and a new line are not.
const SENTENCE_SPLIT = /(?<=[.!?\u3002\uFF01\uFF1F])\s+|\n\s*(?=[^\s\p{Ll}])|(?<!(?:^|\n)[^\S\n]*\S+(?:[^\S\n]+\S+){0,2}\s*)\n\s*/gu;

function sentenceSpans(text) {
  const spans = [];
  const splitter = SENTENCE_SPLIT;
  splitter.lastIndex = 0;
  let last = 0;
  let match;
  while ((match = splitter.exec(text)) !== null) {
    spans.push([last, match.index]);
    last = match.index + match[0].length;
  }
  spans.push([last, text.length]);
  return spans
    .map(([start, end]) => {
      while (start < end && /\s/u.test(text[start])) start += 1;
      while (end > start && /\s/u.test(text[end - 1])) end -= 1;
      return [start, end];
    })
    .filter(([start, end]) => end > start);
}

// Spelling habits that tell close languages apart when common words tie.
// Each hit adds half a point, capped, on top of the common-word count.
const ORTHOGRAPHY = {
  en: /\bth|ing\b|\bwh/gu,
  es: /[ñ¿¡]|ción\b|dad\b|\bll/gu,
  pt: /[ãõ]|ção\b|ções\b|lh|nh/gu,
  fr: /[éèêëàâùûçîïôœ]|eau\b|eux\b|\b(?:[ldjsnctm]|qu)['’]/gu,
  de: /[äöüß]|sch|ung\b|keit\b|lich\b/gu,
  it: /[òì]|zione\b|gli\b|cch|zz/gu,
  nl: /ij|oe|aa|uu|ee/gu,
  id: /\bny|nya\b|kan\b|\bme(ng|m|n)|\bber/gu,
};

// Text with no clear common-word winner counts as English only when it is
// plain ASCII and 60% of its words are English common words or everyday
// English ad words. English spelling (th, -ing, -tion, ck...) only tips a
// close case, and only when a fifth of the words are real English words.
// One loanword ("online", "free") in another language is not enough.
const ENGLISH_MARKERS = /^th|ing$|ed$|^ex|tion$|ck|^wh|ly$|ight|ould|ment$|ness$|ful$|able$|ous$|ee|oo|sh$|ea|ay$|ow/;
const ENGLISH_AD_WORDS = new Set("free sale sales new today tonight now get shop save off best more learn join book start starts starting offer offers deal deals limited day days week weeks month class classes course courses workshop workshops online sign up register discover try buy order call apply download watch read meet win gift gifts summer winter spring holiday weekend friday saturday sunday monday tickets ticket price prices discount special exclusive guide tips easy fast simple daily fresh style home love family kids food coffee top local near quality handmade team premium pet pets care delivered delivery yoga bread".split(" "));
function looksEnglish(text, i18n) {
  const lower = String(text).toLowerCase();
  if (/[^\x00-\x7F‘’“”–€£]/u.test(lower.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, ""))) return false;
  const words = lower.match(/[a-z]+(?:'[a-z]+)?/g) || [];
  if (!words.length) return false;
  const english = i18n && i18n.languages.en ? i18n.languages.en.stopwords : new Set();
  const known = words.filter((word) => english.has(word) || ENGLISH_AD_WORDS.has(word)).length;
  if (known / words.length >= 0.6) return true;
  // Spelling only breaks a tie: some real English words are still needed.
  const spelled = words.filter((word) => !english.has(word) && !ENGLISH_AD_WORDS.has(word) && ENGLISH_MARKERS.test(word)).length;
  return known / words.length >= 0.2 && (known + spelled) / words.length >= 0.6;
}

const VIETNAMESE_LETTERS = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/gu;
const MIN_WORDS_TO_CALL_UNKNOWN = 7;

/**
 * Guesses the language of one sentence. Returns
 *   { supported: [codes], unsupported: [{ code, name }], unknown: bool, words }
 * Non-Latin scripts and Vietnamese are found by their letters; Latin-script
 * languages by counting common words. A tie between languages keeps all of
 * them. The result only labels the copy and finds text nobody checked: every
 * word list runs on every ad, so a wrong guess never skips a check.
 */
function detectSentence(normalized, folded, i18n) {
  const result = { supported: [], unsupported: [], unknown: false, unidentified: false, words: 0 };
  const letters = (normalized.match(/\p{L}/gu) || []).length;
  if (!letters) return result;
  const seen = new Set();
  const hasKana = /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(normalized);
  for (const entry of i18n.scripts) {
    if (entry.script === "Han" && hasKana) continue; // kanji inside Japanese text
    entry.regex.lastIndex = 0;
    const count = (normalized.match(entry.regex) || []).length;
    if (count >= 2 && count / letters >= 0.2 && !seen.has(entry.code)) {
      seen.add(entry.code);
      result.unsupported.push({ code: entry.code, name: entry.name });
    }
  }
  const latin = (normalized.match(/\p{Script=Latin}/gu) || []).length;
  if (latin / letters < 0.5) return result;
  const lower = normalized.toLowerCase();
  if ((lower.match(VIETNAMESE_LETTERS) || []).length >= 2) {
    result.unsupported.push({ code: "vi", name: "Vietnamese" });
    return result;
  }
  // Letters no supported language uses (Polish ł, Turkish ğ, Czech ř, Nordic
  // å...): one is enough to say the sentence was not checked.
  for (const entry of i18n.exclusive || []) {
    if (entry.regex.test(lower) && !result.unsupported.some((lang) => lang.code === entry.code)) result.unsupported.push({ code: entry.code, name: entry.name });
  }
  if (result.unsupported.length) return result;

  const words = (folded.toLowerCase().match(/\p{L}+/gu) || []);
  result.words = words.length;
  const shared = words.filter((word) => i18n.commonWords && i18n.commonWords.has(word)).length;
  const count = (set) => words.reduce((sum, word) => sum + (set.has(word) ? 1 : 0), 0);
  const supported = Object.entries(i18n.languages).map(([code, spec]) => {
    const hits = count(spec.stopwords);
    const pattern = ORTHOGRAPHY[code];
    const bonus = pattern && hits > 0 ? 0.5 * Math.min(3, (lower.match(pattern) || []).length) : 0;
    return { code, hits, score: hits + bonus };
  });
  const unsupported = Object.entries(i18n.unsupported).map(([code, spec]) => ({ code, hits: count(spec.stopwords) }));
  const supHits = Math.max(0, ...supported.map((entry) => entry.hits));
  const supBest = Math.max(0, ...supported.map((entry) => entry.score));
  const unsHits = Math.max(0, ...unsupported.map((entry) => entry.hits));

  if (unsHits >= 2 && unsHits >= supHits && supHits < 2) {
    result.unsupported.push(...unsupported.filter((entry) => entry.hits === unsHits).map((entry) => ({ code: entry.code, name: i18n.unsupported[entry.code].name })));
    return result;
  }
  // One word from a language with no list against at most one from a checked
  // language: no label either way, the sentence is reported as not identified.
  if (unsHits === 1 && supHits <= 1) {
    result.unidentified = true;
    return result;
  }
  // One common word of a checked language among several English ad words
  // ("Mua ngay, free ship, sale het") is code-mixed copy, not that language.
  const englishAdWords = words.filter((word) => ENGLISH_AD_WORDS.has(word)).length;
  const codeMixed = supHits === 1 && englishAdWords >= 2 && !supported.some((entry) => entry.code === "en" && entry.hits >= 1);
  if (supHits >= 1 && !codeMixed) {
    result.supported.push(...supported.filter((entry) => entry.score === supBest).map((entry) => entry.code));
    return result;
  }
  // Title Case headlines, ids and code have no common words in any language;
  // only running text is reported as unrecognised.
  const capitalised = (normalized.match(/(?<![\p{L}\p{N}])\p{Lu}/gu) || []).length;
  const codeLike = /[_`~\\/<>{}=]/u.test(normalized);
  const prose = !codeLike && capitalised / Math.max(1, words.length) < 0.6;
  if (looksEnglish(normalized, i18n)) {
    result.supported.push("en");
    return result;
  }
  result.unknown = prose && words.length >= MIN_WORDS_TO_CALL_UNKNOWN && shared === 0;
  // Shorter text (a headline) with no recognisable language is still not a
  // clean pass: it is reported as not identified.
  // Two shared Romance/Germanic short words (de, la, en...) are taken as a
  // checked language.
  if (!result.unknown && !codeLike && words.length >= 3 && shared < 2) result.unidentified = true;
  return result;
}

function humanCta(value) {
  return String(value).replace(/_/g, " ").toLowerCase();
}

function pushText(out, field, where, value) {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => pushText(out, field, `${where}[${index}]`, item));
    return;
  }
  if (typeof value === "object") {
    if (field === "callToAction" && typeof value.type === "string") pushText(out, field, `${where}.type`, value.type);
    if (field === "callToAction" && value.value && typeof value.value.link === "string") pushText(out, "link", `${where}.value.link`, value.value.link);
    if (typeof value.text === "string") pushText(out, field, `${where}.text`, value.text);
    return;
  }
  if (typeof value !== "string" && typeof value !== "number") return;
  const text = String(value).trim();
  if (!text) return;
  out.push({ field, where, text: field === "callToAction" && /^[A-Z_]+$/.test(text) ? humanCta(text) : text });
}

function walk(node, where, parentKey, out, depth = 0) {
  if (depth > 8 || node === null || node === undefined) return;
  if (Array.isArray(node)) {
    node.forEach((item, index) => {
      if (typeof item === "string") {
        if (SLIDE_ARRAYS.has(parentKey)) pushText(out, "overlayText", `${where}[${index}]`, item);
        return;
      }
      walk(item, `${where}[${index}]`, parentKey, out, depth + 1);
    });
    return;
  }
  if (typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) {
    const at = where ? `${where}.${key}` : key;
    if (SKIP_KEYS.has(key)) continue;
    if (SLIDE_ARRAYS.has(parentKey) && SLIDE_TEXT_KEYS.has(key) && typeof value !== "object") { pushText(out, "overlayText", at, value); continue; }
    if (SLIDE_ARRAYS.has(parentKey) && (key === "lines" || key === "items")) { pushText(out, "overlayText", at, value); continue; }
    if (TEXT_ARRAY_FIELD[key] && Array.isArray(value)) { pushText(out, TEXT_ARRAY_FIELD[key], at, value); continue; }
    if (key === "link_urls" && Array.isArray(value)) { value.forEach((item, index) => pushText(out, "link", `${at}[${index}]`, item && item.website_url)); continue; }
    if (key === "name") {
      if (NAME_IS_HEADLINE_IN.has(parentKey)) pushText(out, "headline", at, value);
      continue;
    }
    const field = FIELD_BY_KEY[key];
    if (field && (typeof value !== "object" || value === null || field === "callToAction" || field === "overlayText" || Array.isArray(value))) {
      pushText(out, field, at, value);
      continue;
    }
    if (value && typeof value === "object") walk(value, at, key, out, depth + 1);
  }
}

// Every piece of ad text in an input, labelled by field and where it was found.
function extractTexts(input) {
  const out = [];
  if (typeof input === "string") pushText(out, "primaryText", "text", input);
  else walk(input, "", "", out);
  const seen = new Set();
  return out.filter((item) => {
    const key = `${item.field}|${item.where}|${item.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sentences(text) {
  return String(text).split(SENTENCE_SPLIT).map((part) => part.replace(/\s+/g, " ").trim()).filter(Boolean);
}

function fieldAllowed(rule, field) {
  if (rule.skipFields && rule.skipFields.includes(field)) return false;
  if (rule.type === "link") return field === "link";
  return field !== "link";
}

function matchRule(rule, item, subject) {
  const found = [];
  if (rule.type === "coverage" || !fieldAllowed(rule, item.field)) return found;
  if (rule.type === "personal-attribute") {
    for (const sentence of sentences(item.text)) {
      if (!subject.test(sentence)) continue;
      for (const regex of rule.regexes) {
        regex.lastIndex = 0;
        if (regex.test(sentence)) { found.push(sentence); break; }
      }
    }
    return found;
  }
  for (const regex of rule.regexes) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(item.text)) !== null) {
      found.push(match[0]);
      if (match[0] === "") regex.lastIndex += 1;
    }
  }
  return found;
}

// One language's word lists against one piece of text. Matches run on the
// accent-free text and are reported in the original spelling.
function matchLanguage(language, baseRule, lists, item, folded) {
  const found = [];
  if (!fieldAllowed(baseRule, item.field)) return found;
  if (baseRule.type === "personal-attribute") {
    if (!language.subjects.length) return found;
    for (const [start, end] of sentenceSpans(folded.text)) {
      const sentence = folded.text.slice(start, end);
      if (!language.subjects.some((regex) => { regex.lastIndex = 0; return regex.test(sentence); })) continue;
      for (const regex of lists.regexes) {
        regex.lastIndex = 0;
        if (regex.test(sentence)) { found.push(originalSlice(item.text, folded, start, end)); break; }
      }
    }
    return found;
  }
  for (const regex of lists.regexes) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(folded.text)) !== null) {
      if (match[0] === "") { regex.lastIndex += 1; continue; }
      found.push(originalSlice(item.text, folded, match.index, match.index + match[0].length));
    }
  }
  return found;
}

function worst(levels) {
  return levels.reduce((acc, level) => (LEVEL_ORDER[level] > LEVEL_ORDER[acc] ? level : acc), "PASS");
}

// Fields whose text says something to a reader (not links or button codes).
const PROSE_FIELDS = new Set(["primaryText", "headline", "description", "overlayText"]);

function excerpt(text, max = 80) {
  const clean = String(text).replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 3)}...` : clean;
}

// Works out which languages the ad is in, sentence by sentence.
function analyseLanguages(texts, i18n) {
  const perItem = texts.map((item) => {
    const sentencesFound = [];
    if (!PROSE_FIELDS.has(item.field)) return { item, sentences: sentencesFound };
    const folded = foldText(item.text);
    const whole = detectSentence(item.text, folded.text, i18n);
    for (const [start, end] of sentenceSpans(folded.text)) {
      const detection = detectSentence(originalSlice(item.text, folded, start, end), folded.text.slice(start, end), i18n);
      // A tie inside one sentence is settled by the whole field when it can be.
      if (detection.supported.length > 1) {
        const settled = detection.supported.filter((code) => whole.supported.includes(code));
        if (settled.length) detection.supported = settled;
      }
      sentencesFound.push({ detection, text: originalSlice(item.text, folded, start, end) });
    }
    return { item, sentences: sentencesFound };
  });
  const supported = new Set();
  const unsupported = new Map();
  let unknown = false;
  for (const entry of perItem) {
    for (const sentence of entry.sentences) {
      sentence.detection.supported.forEach((code) => supported.add(code));
      sentence.detection.unsupported.forEach((lang) => unsupported.set(lang.code, lang.name));
      if (sentence.detection.unknown) unknown = true;
    }
  }
  return { perItem, supported, unsupported, unknown };
}

function checkTexts(rawTexts, { rulesPath, i18nPath } = {}) {
  const rules = loadRules(rulesPath);
  const i18n = loadI18n(i18nPath);
  const texts = rawTexts.map((item) => ({ ...item, text: normalizeText(item.text) }));
  const findings = [];
  const seen = new Set();
  const add = (rule, item, phrase, extra = {}) => {
    const key = `${rule.id}|${item.where}|${phrase.toLowerCase()}${rule.type === "coverage" ? `|${extra.language}` : ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({
      level: rule.level,
      ruleId: rule.id,
      title: extra.title || rule.title,
      field: item.field,
      where: item.where,
      phrase,
      explain: extra.explain || rule.explain,
      rewrite: rule.rewrite,
      source: rule.source,
      ...(rule.category ? { category: rule.category } : {}),
      ...(extra.language ? { language: extra.language } : {}),
    });
  };

  // English rules always run (English words turn up in every language's ads).
  for (const item of texts) {
    for (const rule of rules.all) {
      for (const phrase of matchRule(rule, item, rules.subject)) add(rule, item, phrase);
    }
  }

  // Every non-English word list runs on every ad: detection can be wrong on
  // short copy, and a wrong guess must never skip a check.
  const analysis = analyseLanguages(texts, i18n);
  const applied = Object.values(i18n.languages).filter((language) => !language.english && language.rules.length);
  for (const item of texts) {
    if (item.field === "link") continue;
    const folded = foldText(item.text);
    for (const language of applied) {
      for (const lists of language.rules) {
        const baseRule = rules.byId.get(lists.ruleId);
        if (!baseRule) continue;
        for (const phrase of matchLanguage(language, baseRule, lists, item, folded)) add(baseRule, item, phrase, { language: language.code });
        if (language.code === "de" && !findings.some((f) => f.ruleId === baseRule.id && f.where === item.where)) {
          for (const phrase of matchLanguage(language, baseRule, lists, item, digraphFold(folded))) add(baseRule, item, phrase, { language: language.code });
        }
      }
    }
  }

  // Text the check has no word list for is said out loud, never passed.
  const coverageRule = rules.byId.get("language-not-checked") || {
    id: "language-not-checked", level: "WARN", type: "coverage", title: "Not checked: no word list for this language",
    explain: "The policy check has no word list for this language.", rewrite: "Review this text by hand.", source: "https://transparency.meta.com/policies/ad-standards/",
  };
  for (const entry of analysis.perItem) {
    for (const sentence of entry.sentences) {
      for (const lang of sentence.detection.unsupported) {
        add(coverageRule, entry.item, excerpt(sentence.text), {
          title: `Not checked for ${lang.name}, review by hand`,
          explain: `This text looks like ${lang.name}. The policy check has no word list for ${lang.name}, so it was not checked. Review it by hand against Meta's Advertising Standards before the ad runs.`,
          language: lang.code,
        });
      }
      if (sentence.detection.unknown) {
        add(coverageRule, entry.item, excerpt(sentence.text), {
          title: "Not checked: language not recognised, review by hand",
          explain: "The check could not tell which language this sentence is in, so it may be a language with no word list. Review it by hand against Meta's Advertising Standards before the ad runs.",
          language: "und",
        });
      }
    }
  }

  // Sentences too short to tell their language from are checked against
  // every list, but the report says the language was not identified.
  let unidentified = false;
  for (const entry of analysis.perItem) {
    for (const sentence of entry.sentences) {
      if (!sentence.detection.unidentified) continue;
      unidentified = true;
      add(coverageRule, entry.item, excerpt(sentence.text), {
        title: "Language not identified, review by hand unless it is English, Spanish, Portuguese, French, German, Italian, Dutch or Indonesian",
        explain: "This text is too short to tell which language it is in. It was checked against every word list the agent has; if it is in any other language, it was not really checked. Review it by hand before the ad runs.",
        language: "und",
      });
    }
  }

  findings.sort((a, b) => LEVEL_ORDER[b.level] - LEVEL_ORDER[a.level]);
  const status = worst(findings.map((finding) => finding.level));
  const specialCategories = [...new Set(findings.filter((finding) => finding.category).map((finding) => finding.category))];
  const nameOf = (code) => (i18n.languages[code] ? i18n.languages[code].name : analysis.unsupported.get(code) || code);
  const detectedCodes = [...analysis.supported, ...analysis.unsupported.keys()];
  return {
    status,
    exitCode: EXIT_CODES[status],
    counts: { block: findings.filter((f) => f.level === "BLOCK").length, warn: findings.filter((f) => f.level === "WARN").length },
    findings,
    specialCategories,
    fieldsChecked: texts.map((item) => ({ field: item.field, where: item.where })),
    languages: {
      detected: detectedCodes.map((code) => ({ code, name: nameOf(code), checked: Boolean(i18n.languages[code]) })),
      checkedWith: ["en", ...applied.map((language) => language.code)],
      notChecked: [...analysis.unsupported.entries()].map(([code, name]) => ({ code, name })),
      unrecognised: analysis.unknown || unidentified,
      method: "offline word lists and a stopword/script count; no model call",
    },
    rulesVersion: rules.version,
    rulesCheckedOn: rules.checkedOn,
    i18nVersion: i18n.version,
  };
}

function checkText(text, options) {
  return checkTexts(extractTexts(String(text)), options);
}

function checkCreative(input, options) {
  return checkTexts(extractTexts(input), options);
}

// ---------------------------------------------------------------------------
// Local cache lookups (never the network)
// ---------------------------------------------------------------------------

function readCacheRows(name, dataDir = DATA_DIR) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dataDir, `${name}.json`), "utf8"));
    return Array.isArray(parsed) ? parsed : Array.isArray(parsed?.data) ? parsed.data : [];
  } catch {
    return [];
  }
}

// Finds an ad or creative by id in data/ads.json or data/creatives.json.
// Returns { kind, ad, creative } or null.
function findCached(id, dataDir = DATA_DIR) {
  const wanted = String(id);
  for (const ad of readCacheRows("ads", dataDir)) {
    if (String(ad.id) === wanted) return { kind: "ad", ad, creative: ad.creative || null };
    if (ad.creative && String(ad.creative.id) === wanted) return { kind: "creative", ad, creative: ad.creative };
  }
  for (const creative of readCacheRows("creatives", dataDir)) {
    if (String(creative.id) === wanted) return { kind: "creative", ad: null, creative };
  }
  return null;
}

const CREATIVE_FIELDS = "id,name,title,body,object_story_spec,asset_feed_spec,call_to_action_type,link_url";
const AD_FIELDS = "id,name,effective_status,ad_review_feedback,creative{id,title,body,object_story_spec,asset_feed_spec,call_to_action_type,link_url}";

/**
 * Turns what the user typed into something to check:
 *   a JSON file path, inline JSON, a creative or ad id, or plain text.
 * Ids are looked up in the local cache first. Only an id missing from the
 * cache is read from Meta, with a read-only GET through the api client (which
 * redacts credentials). Returns { input, source, ad? }.
 */
async function resolvePolicyInput(target, { dataDir = DATA_DIR, apiClient, credentialsPresent } = {}) {
  const value = String(target || "").trim();
  if (!value) throw new Error("Usage: policy check <file.json|'<json>'|creative-id|\"ad text\">");
  if (value.startsWith("{") || value.startsWith("[")) return { input: JSON.parse(value), source: "inline JSON" };
  let isFile = false;
  try { isFile = value.length < 1024 && fs.statSync(value).isFile(); } catch { isFile = false; }
  if (isFile) {
    const raw = fs.readFileSync(value, "utf8");
    try { return { input: JSON.parse(raw), source: `file ${path.basename(value)}` }; } catch { return { input: raw, source: `text file ${path.basename(value)}` }; }
  }
  if (/^\d{5,}$/.test(value)) {
    const cached = findCached(value, dataDir);
    if (cached) return { input: cached.creative || cached.ad, source: `local cache (${cached.kind} ${value})`, ad: cached.ad };
    const hasCredentials = credentialsPresent !== undefined ? credentialsPresent : Boolean(process.env.META_ADS_ACCESS_TOKEN && process.env.META_ADS_ACCOUNT_ID);
    if (!hasCredentials) throw new Error(`${value} is not in the local cache and Meta credentials are not set. Run sync first, or paste the ad text instead.`);
    const client = apiClient || require("./api-client");
    try {
      const creative = await client.apiCall(`/${value}`, "GET", null, { fields: CREATIVE_FIELDS });
      if (creative && (creative.body || creative.title || creative.object_story_spec || creative.asset_feed_spec)) return { input: creative, source: `Meta API (creative ${value}, read only)` };
    } catch { /* not a creative id; try it as an ad */ }
    const ad = await client.apiCall(`/${value}`, "GET", null, { fields: AD_FIELDS });
    return { input: ad.creative || ad, source: `Meta API (ad ${value}, read only)`, ad };
  }
  return { input: value, source: "text" };
}

// Every cached ad with policy risk, for the dashboard card.
function cachedAdRisks(dataDir = DATA_DIR, ads = readCacheRows("ads", dataDir)) {
  const risky = [];
  for (const ad of ads) {
    if (!ad || !ad.creative) continue;
    const report = checkCreative(ad.creative);
    if (report.status !== "PASS") risky.push({ id: ad.id, name: ad.name || null, status: report.status, ruleIds: [...new Set(report.findings.map((f) => f.ruleId))] });
  }
  return risky;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function fieldLabel(finding) {
  const card = finding.where.match(/(?:cards|child_attachments|slides)\[(\d+)\]/);
  const names = { primaryText: "primary text", headline: "headline", description: "description", callToAction: "button", link: "link", overlayText: "image text" };
  return `${card ? `card ${Number(card[1]) + 1} ` : ""}${names[finding.field] || finding.field}`;
}

// "Language: Spanish (checked)." or "Languages: English (checked); Thai (not
// checked, review by hand)."
function describeLanguages(languages) {
  if (!languages) return "";
  const parts = languages.detected.map((lang) => `${lang.name} (${lang.checked ? "checked" : "not checked, review by hand"})`);
  if (languages.unrecognised) parts.push("a language the check could not recognise (review by hand)");
  if (!parts.length) return "";
  return `${parts.length > 1 ? "Languages" : "Language"}: ${parts.join("; ")}.`;
}

function formatReport(report, { title = "Meta policy check" } = {}) {
  const lines = [];
  const summary = report.status === "PASS"
    ? "PASS: nothing in this ad text breaks the rules the agent knows."
    : `${report.status}: ${report.counts.block} to fix before running, ${report.counts.warn} to check.`;
  lines.push(`${title}: ${summary}`);
  const languageLine = describeLanguages(report.languages);
  if (languageLine) lines.push(languageLine);
  if (!report.fieldsChecked.length) lines.push("No ad text was found to check (headline, primary text, description, button, image text or link).");
  for (const finding of report.findings) {
    lines.push("");
    lines.push(`${finding.level.padEnd(5)}  ${finding.ruleId}  (${fieldLabel(finding)})${finding.ruleId === "language-not-checked" ? `: ${finding.title}` : ""}`);
    lines.push(`       Phrase: "${finding.phrase}"`);
    lines.push(`       Why:    ${finding.explain}`);
    lines.push(`       Try:    ${finding.rewrite}`);
  }
  if (report.specialCategories.length) {
    lines.push("");
    lines.push(`Special ad category to declare: ${report.specialCategories.join(", ")}. Set it in the campaign's special_ad_categories.`);
  }
  if (report.status !== "PASS") lines.push("", "Rules: policies/rules.json. Guide: policies/meta-advertising-standards.md.");
  return lines.join("\n");
}

function listRules(options) {
  const rules = loadRules(options && options.rulesPath);
  return rules.all.map((rule) => ({ id: rule.id, level: rule.level, type: rule.type, section: rule.section, title: rule.title, ...(rule.category ? { category: rule.category } : {}) }));
}

// ---------------------------------------------------------------------------
// Create-path guard
// ---------------------------------------------------------------------------

/**
 * Runs before every path that creates ad copy. Prints the findings to stderr.
 * BLOCK throws unless `override` holds a reason; an override is written to the
 * audit log with the reason and the rule ids. WARN prints and continues. Dry
 * runs are checked the same way.
 */
function enforcePolicy({ action, input, report, override, dryRun = false, log = (line) => console.error(line) }) {
  const result = report || checkCreative(input);
  if (result.status === "PASS") {
    if (result.fieldsChecked.length) log(`Meta policy check (${action}): PASS`);
    return result;
  }
  log(formatReport(result, { title: `Meta policy check (${action})` }));
  if (result.status !== "BLOCK") return result;
  const ruleIds = [...new Set(result.findings.filter((f) => f.level === "BLOCK").map((f) => f.ruleId))];
  const reason = typeof override === "string" ? override.trim() : "";
  if (override !== undefined && override !== null && !reason) {
    throw Object.assign(new Error(`${action}: --policy-override needs a reason in quotes, for example --policy-override "Approved by Meta support on 3 Oct"`), { exitCode: 2 });
  }
  if (!reason) {
    throw Object.assign(new Error(`${action} refused: this ad text is likely to be rejected by Meta (${ruleIds.join(", ")}). Use the rewrites above, then try again. If you are sure it is fine, rerun with --policy-override "<your reason>"; the reason is saved in the audit log.`), { exitCode: 2, policyReport: result });
  }
  writeAudit(`POLICY OVERRIDE ${action}`, { action, reason, ruleIds, dryRun: Boolean(dryRun) }, { overridden: true, status: result.status, dryRun: Boolean(dryRun), findings: result.findings.map((f) => ({ level: f.level, ruleId: f.ruleId, phrase: f.phrase })) });
  log(`Policy override recorded in the audit log. Reason: ${reason}. Rules overridden: ${ruleIds.join(", ")}.`);
  return { ...result, overridden: true, overrideReason: reason };
}

// Pulls --policy-override "<reason>" out of an argv array (mutates it).
function takeOverrideArg(args) {
  const index = args.indexOf("--policy-override");
  if (index === -1) return undefined;
  const value = args[index + 1];
  const reason = value === undefined || value.startsWith("--") ? "" : value;
  args.splice(index, reason === "" && value !== "" ? 1 : 2);
  return reason;
}

// ---------------------------------------------------------------------------
// Freshness of the bundled policy guide (doctor)
// ---------------------------------------------------------------------------

function standardsFreshness({ standardsPath = STANDARDS_PATH, now = new Date() } = {}) {
  let text;
  try {
    text = fs.readFileSync(standardsPath, "utf8");
  } catch {
    return { ok: false, checkedOn: null, ageDays: null, message: "policies/meta-advertising-standards.md is missing, so the policy check has no guide to point to. Reinstall the agent." };
  }
  const match = text.match(/^checkedOn:\s*(\d{4}-\d{2}-\d{2})\s*$/m);
  if (!match) return { ok: false, checkedOn: null, ageDays: null, message: "policies/meta-advertising-standards.md has no checkedOn line, so its age is unknown. Re-check it against Meta's pages and add one." };
  const checked = new Date(`${match[1]}T00:00:00Z`);
  const ageDays = Math.floor((now.getTime() - checked.getTime()) / 86400000);
  const stale = !Number.isFinite(ageDays) || ageDays > STALE_AFTER_DAYS;
  return {
    ok: !stale,
    checkedOn: match[1],
    ageDays,
    message: stale
      ? `The Meta policy guide was last checked on ${match[1]} (${ageDays} days ago, more than ${STALE_AFTER_DAYS}). Meta changes its rules often: re-check policies/meta-advertising-standards.md and policies/rules.json against https://transparency.meta.com/policies/ad-standards/ and update the checkedOn date.`
      : `The Meta policy guide was checked on ${match[1]} (${ageDays} days ago).`,
  };
}

// ---------------------------------------------------------------------------
// Rejection reasons -> rules
// ---------------------------------------------------------------------------

// Meta's rejection wording varies; these keywords map it to our rule ids.
const REJECTION_MAP = [
  { pattern: /personal (attribute|health|characteristic)|implies? (knowledge|personal)|assert(s|ing)? or impl/i, ruleIds: ["personal-attributes-health", "personal-attributes-finances", "personal-attributes-age", "personal-attributes-religion", "personal-attributes-sexuality-gender", "personal-attributes-race-ethnicity", "personal-attributes-criminal-record"] },
  { pattern: /unrealistic|misleading claim|guarantee|exaggerat|false or misleading/i, ruleIds: ["guaranteed-results", "fast-results-claim", "unsubstantiated-claims"] },
  { pattern: /income|money[- ]making|get rich|business opportunit|multi[- ]level|mlm/i, ruleIds: ["income-claims"] },
  { pattern: /investment|financial (product|service)|returns/i, ruleIds: ["investment-returns", "prohibited-financial-products", "special-category-credit"] },
  { pattern: /deceptive|prohibited commercial practice|scam|bait/i, ruleIds: ["guaranteed-results", "income-claims", "false-urgency", "fake-ui-or-prize"] },
  { pattern: /health|wellness|body image|weight|before[- ]and[- ]after|cosmetic|self[- ]perception/i, ruleIds: ["negative-self-image", "before-after", "weight-loss-claims", "cure-claims", "restricted-supplements"] },
  { pattern: /sensational|clickbait|shocking|low[- ]quality|engagement bait|withhold/i, ruleIds: ["sensational-clickbait", "low-quality-formatting"] },
  { pattern: /profan/i, ruleIds: ["profanity"] },
  { pattern: /special ad categor|housing|employment|credit|social issue|election|politic/i, ruleIds: ["special-category-housing", "special-category-employment", "special-category-credit", "special-category-politics"] },
  { pattern: /alcohol/i, ruleIds: ["restricted-alcohol"] },
  { pattern: /dating/i, ruleIds: ["restricted-dating"] },
  { pattern: /gambl|casino|betting/i, ruleIds: ["restricted-gambling"] },
  { pattern: /crypto/i, ruleIds: ["restricted-crypto"] },
  { pattern: /drug|pharma|prescription|addiction/i, ruleIds: ["restricted-pharma"] },
  { pattern: /tobacco|vap|nicotine/i, ruleIds: ["prohibited-tobacco-vape"] },
  { pattern: /weapon|firearm|ammunition|explosive/i, ruleIds: ["prohibited-weapons"] },
  { pattern: /landing page|destination|non[- ]functional|broken link|website/i, ruleIds: ["landing-page-https", "landing-page-placeholder"] },
  { pattern: /crisis|tragedy|controversial event/i, ruleIds: ["crisis-exploitation"] },
  { pattern: /discriminat|exclu(de|sion)/i, ruleIds: ["discriminatory-practices"] },
  { pattern: /lead (form|ad)|personal information|sensitive information/i, ruleIds: ["lead-sensitive-data"] },
];

function mapRejectionReason(text) {
  const ids = [];
  for (const entry of REJECTION_MAP) if (entry.pattern.test(String(text || ""))) ids.push(...entry.ruleIds);
  const known = new Set(listRules().map((rule) => rule.id));
  return [...new Set(ids)].filter((id) => known.has(id));
}

// Pulls Meta's review feedback out of a cached ad, if the sync captured it.
function rejectionFromCachedAd(ad) {
  if (!ad) return null;
  const feedback = ad.ad_review_feedback || ad.creative?.ad_review_feedback || null;
  const parts = [];
  if (feedback && typeof feedback === "object") {
    for (const group of Object.values(feedback)) {
      if (group && typeof group === "object") for (const [key, value] of Object.entries(group)) parts.push(`${key}: ${value}`);
      else if (group) parts.push(String(group));
    }
  } else if (typeof feedback === "string") parts.push(feedback);
  return { effectiveStatus: ad.effective_status || null, feedback: parts.join(" | ") || null };
}

module.exports = {
  RULES_PATH,
  I18N_PATH,
  STANDARDS_PATH,
  STALE_AFTER_DAYS,
  EXIT_CODES,
  loadRules,
  loadI18n,
  normalizeText,
  foldText,
  detectSentence,
  extractTexts,
  checkText,
  checkCreative,
  checkTexts,
  findCached,
  resolvePolicyInput,
  cachedAdRisks,
  formatReport,
  listRules,
  enforcePolicy,
  takeOverrideArg,
  standardsFreshness,
  mapRejectionReason,
  rejectionFromCachedAd,
};
