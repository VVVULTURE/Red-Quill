// Red Quill — rule-based text humanizer.
// Runs entirely client-side. No API, no network call, no cost.
//
// The approach mirrors what actually moves AI-detector scores and reads as
// "more human" to a person: it doesn't paraphrase with a model, it applies
// targeted, weighted transforms that AI writing systematically lacks:
//   1. Swap AI-tell words/phrases for plainer alternatives
//   2. Trim throat-clearing filler ("it is important to note that...")
//   3. Inject contractions at a natural (not 100%) rate
//   4. De-emphasize em-dash overuse
//   5. Vary sentence length ("burstiness") by merging short runs and
//      splitting overlong sentences
//
// Each transform is probabilistic and seeded, so the same input produces a
// different — but still grammatical — result every run.

export type Intensity = "light" | "medium" | "heavy";

export interface HumanizeResult {
  text: string;
  edits: number;
}

// ---------------------------------------------------------------------------
// Seeded PRNG (mulberry32) — deterministic if a seed is passed, otherwise
// seeded from Date.now() so every click gives fresh variation.
// ---------------------------------------------------------------------------
function mulberry32(seed: number) {
  let s = seed | 0;
  return function rng() {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

function matchCase(source: string, replacement: string): string {
  if (!replacement) return replacement;
  const first = source.charAt(0);
  if (first === first.toUpperCase() && first !== first.toLowerCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Abbreviation protection — without this, naive "split on . ! ?" treats
// "Dr." or "U.S." as a sentence boundary and mangles the text. We swap the
// trailing period for a placeholder before splitting and restore it after.
// ---------------------------------------------------------------------------
const ABBREVIATIONS = [
  "Dr", "Mr", "Mrs", "Ms", "Prof", "Sr", "Jr", "St", "vs", "etc",
  "approx", "Inc", "Ltd", "Co", "Gen", "Rep", "Sen", "Gov",
  "U.S", "U.K", "e.g", "i.e", "Ph.D", "a.m", "p.m",
];
const ABBR_PLACEHOLDER = "\u0000";

function protectAbbreviations(text: string): string {
  let result = text;
  for (const abbr of ABBREVIATIONS) {
    const re = new RegExp(`\\b${escapeRe(abbr)}\\.`, "g");
    // abbr itself may contain periods (e.g. "U.S", "e.g") — every period
    // that's part of the abbreviation token must be protected, not just
    // the trailing one, or the splitter still breaks mid-abbreviation.
    const protectedForm = abbr.split(".").join(ABBR_PLACEHOLDER);
    result = result.replace(re, `${protectedForm}${ABBR_PLACEHOLDER}`);
  }
  return result;
}

// Decimal numbers and currency ("3.5 million", "$19.99") have the same
// problem as abbreviations — a "." that isn't a sentence boundary.
function protectDecimals(text: string): string {
  return text.replace(/(\d)\.(\d)/g, `$1${ABBR_PLACEHOLDER}$2`);
}

// Single-letter initials ("T. rex", "J. K. Rowling", "E. coli") aren't in
// any fixed abbreviation list, but a sentence essentially never ends on a
// lone capital letter. Protect "<CAP>." when followed by a lowercase word
// (clearly mid-sentence, e.g. "T. rex") or another initial (e.g. "J. K.").
// Deliberately does NOT match when followed by a capitalized word, since
// that's the normal, common shape of a real sentence boundary ("...to F.
// Grading is strict.") and we don't want to swallow that split.
function protectInitials(text: string): string {
  return text.replace(/\b([A-Z])\.(?=\s+[a-z]|\s+[A-Z]\.)/g, (_, letter) => `${letter}${ABBR_PLACEHOLDER}`);
}

function restoreAbbreviations(text: string): string {
  return text.split(ABBR_PLACEHOLDER).join(".");
}

// ---------------------------------------------------------------------------
// Dictionaries — the editable heart of the tool. Add entries here to extend
// coverage; each key can map to multiple alternatives so repeated matches
// don't all get swapped to the same word.
// ---------------------------------------------------------------------------

const PHRASE_MAP: Record<string, string[]> = {
  "it is important to note that": ["worth noting,", "one thing to flag:", ""],
  "it's important to note that": ["worth noting,", "one thing to flag:", ""],
  "it is worth noting that": ["worth noting,", ""],
  "in today's fast-paced world": ["these days", "right now", "at this point"],
  "in today's society": ["these days", "nowadays"],
  "in conclusion": ["so", "bottom line", "all in all", "to wrap up"],
  "in summary": ["so", "to sum up", "bottom line"],
  "on the other hand": ["then again", "that said"],
  "as previously mentioned": ["like I said", "as noted earlier"],
  "needless to say": ["obviously", "of course"],
  "plays a vital role in": ["matters a lot for", "is a big part of"],
  "plays a crucial role in": ["matters a lot for", "is key to"],
  "a wide range of": ["a lot of", "many kinds of", "all sorts of"],
  "a variety of": ["several", "a mix of", "different"],
  "in order to": ["to"],
  "due to the fact that": ["because"],
  "despite the fact that": ["even though", "although"],
  "with regard to": ["about", "when it comes to"],
  "in the realm of": ["in", "within"],
  "shed light on": ["explain", "clarify", "show"],
  "delve into": ["look at", "dig into", "get into"],
  "navigate the complexities of": ["deal with", "work through"],
  "stands as a testament to": ["shows", "proves"],
  "serves as a testament to": ["shows", "proves"],
  "at the end of the day": ["ultimately", "in the end"],
  "it goes without saying": ["obviously", "clearly"],
  "in light of this": ["because of this", "given that"],
  "first and foremost": ["first", "to start"],
  "furthermore": ["also", "plus", "on top of that"],
  "moreover": ["also", "plus"],
  "additionally": ["also", "plus", "on top of that"],
  "consequently": ["as a result", "so"],
  "nonetheless": ["still", "even so"],
  "nevertheless": ["still", "even so"],
};

const WORD_MAP: Record<string, string[]> = {
  utilize: ["use"],
  utilizes: ["uses"],
  utilizing: ["using"],
  facilitate: ["help", "make easier"],
  facilitates: ["helps"],
  demonstrate: ["show"],
  demonstrates: ["shows"],
  demonstrating: ["showing"],
  implement: ["set up", "put in place", "carry out"],
  implementing: ["setting up", "carrying out"],
  leverage: ["use", "make use of"],
  leveraging: ["using"],
  robust: ["solid", "strong", "reliable"],
  comprehensive: ["full", "complete", "thorough"],
  intricate: ["complex", "detailed"],
  vibrant: ["lively", "bright"],
  seamless: ["smooth"],
  seamlessly: ["smoothly"],
  crucial: ["key", "important", "critical"],
  pivotal: ["key", "central"],
  myriad: ["countless", "many"],
  plethora: ["a lot of", "plenty of"],
  boasts: ["has", "offers"],
  showcases: ["shows", "displays"],
  underscores: ["shows", "highlights"],
  fosters: ["builds", "encourages"],
  bolster: ["strengthen", "support"],
  bolsters: ["strengthens", "supports"],
  paramount: ["essential", "critical", "vital"],
  multifaceted: ["complex", "many-sided"],
  cultivate: ["build", "grow", "develop"],
  cultivating: ["building", "growing"],
  tapestry: ["mix", "blend"],
  landscape: ["space", "world", "field"],
  realm: ["field", "area", "space"],
  unlock: ["open up", "reveal"],
  unleash: ["bring out", "release"],
  empower: ["enable", "help"],
  empowers: ["enables", "helps"],
  holistic: ["complete", "well-rounded"],
  synergy: ["teamwork", "combined effect"],
  innovative: ["new", "original"],
  groundbreaking: ["new", "major"],
  revolutionize: ["transform", "change"],
  revolutionizing: ["transforming", "changing"],
};

const FILLER_PHRASES = [
  "in today's world, ",
  "it is important to note that ",
  "it's important to note that ",
  "it is worth noting that ",
  "needless to say, ",
  "as we all know, ",
  "without a doubt, ",
  "simply put, ",
];

const EXPANDED_TO_CONTRACTED: [RegExp, string][] = [
  [/\bit is\b/g, "it's"],
  [/\bIt is\b/g, "It's"],
  [/\bdo not\b/g, "don't"],
  [/\bDo not\b/g, "Don't"],
  [/\bdoes not\b/g, "doesn't"],
  [/\bDoes not\b/g, "Doesn't"],
  [/\bcannot\b/g, "can't"],
  [/\bCannot\b/g, "Can't"],
  [/\bcan not\b/g, "can't"],
  [/\bwill not\b/g, "won't"],
  [/\bWill not\b/g, "Won't"],
  [/\bthey are\b/g, "they're"],
  [/\bThey are\b/g, "They're"],
  [/\bwe are\b/g, "we're"],
  [/\bWe are\b/g, "We're"],
  [/\byou are\b/g, "you're"],
  [/\bYou are\b/g, "You're"],
  [/\bthat is\b/g, "that's"],
  [/\bThat is\b/g, "That's"],
  [/\bthere is\b/g, "there's"],
  [/\bThere is\b/g, "There's"],
  [/\bI am\b/g, "I'm"],
  [/\bwould not\b/g, "wouldn't"],
  [/\bWould not\b/g, "Wouldn't"],
  [/\bshould not\b/g, "shouldn't"],
  [/\bShould not\b/g, "Shouldn't"],
  [/\bcould not\b/g, "couldn't"],
  [/\bCould not\b/g, "Couldn't"],
];

// Merging always uses "and" — neutral conjunction, asserts no relationship
// beyond simple sequence. "but"/"so"/"while" were tried and rejected: they
// assert contrast, causation, or simultaneity respectively, which can
// quietly change the meaning of two sentences that didn't originally state
// that relationship (e.g. implying two unrelated facts are causally linked
// just because "so" reads more naturally there).
const CONJUNCTIONS = ["and"];
// Fallback mid-clause split words for long sentences with no comma+FANBOYS
// break available. Only words that reliably introduce a genuine
// independent/subordinate clause (their own subject + verb) are safe here —
// "and" / "but" / "which" are excluded from this list because, used without
// a preceding comma, they very often join two noun phrases or a short list
// ("volcanic activity and changing climates"), and splitting there produces
// a sentence fragment, not two valid sentences. (The comma-gated version of
// "and"/"but"/"so"/"yet" is handled separately below, where the comma is
// itself strong evidence the conjunction joins two independent clauses.)
const SPLIT_WORDS = ["because", "although", "so"];
const COMMA_CONJUNCTIONS = ["and", "but", "so", "yet"];

// ---------------------------------------------------------------------------
// Transform passes
// ---------------------------------------------------------------------------

function applyPhraseMap(
  text: string,
  prob: number,
  rng: () => number,
  counter: { n: number }
): string {
  let result = text;
  for (const phrase of Object.keys(PHRASE_MAP)) {
    const re = new RegExp(escapeRe(phrase), "gi");
    result = result.replace(re, (match) => {
      if (rng() > prob) return match;
      const choice = pick(PHRASE_MAP[phrase], rng);
      counter.n++;
      return choice ? matchCase(match, choice) : "";
    });
  }
  return result;
}

function applyWordMap(
  text: string,
  prob: number,
  rng: () => number,
  counter: { n: number }
): string {
  let result = text;
  for (const word of Object.keys(WORD_MAP)) {
    const re = new RegExp(`\\b${word}\\b`, "gi");
    result = result.replace(re, (match) => {
      if (rng() > prob) return match;
      const options = WORD_MAP[word];
      if (!options.length) return match;
      counter.n++;
      return matchCase(match, pick(options, rng));
    });
  }
  return result;
}

function trimFillers(
  text: string,
  prob: number,
  rng: () => number,
  counter: { n: number }
): string {
  let result = text;
  for (const filler of FILLER_PHRASES) {
    const re = new RegExp(escapeRe(filler), "gi");
    result = result.replace(re, (match) => {
      if (rng() > prob) return match;
      counter.n++;
      return "";
    });
  }
  return result;
}

function applyContractions(
  text: string,
  prob: number,
  rng: () => number,
  counter: { n: number }
): string {
  let result = text;
  for (const [re, repl] of EXPANDED_TO_CONTRACTED) {
    result = result.replace(re, (match) => {
      if (rng() > prob) return match;
      counter.n++;
      return repl;
    });
  }
  return result;
}

function reduceEmDash(
  text: string,
  prob: number,
  rng: () => number,
  counter: { n: number }
): string {
  return text.replace(/\s*—\s*/g, (match) => {
    if (rng() > prob) return match;
    counter.n++;
    return pick([", ", " - ", ". "], rng);
  });
}

function splitSentences(paragraph: string): string[] {
  const matches = paragraph.match(/[^.!?]+[.!?]+["'')\]”’]*(\s+|$)/g);
  if (!matches) return paragraph.trim() ? [paragraph.trim()] : [];
  return matches.map((s) => s.trim()).filter(Boolean);
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

// "X happened, and Y happened too." — a comma directly before a
// coordinating conjunction (and/but/so/yet) is the standard grammatical
// signal of a compound sentence joining two independent clauses, which can
// always be safely broken into two separate sentences. This is a much more
// reliable split point than a bare "and"/"but" with no comma (which usually
// just joins two phrases, not two clauses — see SPLIT_WORDS above).
//
// BUT: ", and" is *also* exactly how an Oxford-comma list ends ("diversity,
// size, and extinction"), and that must never be split — the segment after
// "and" there is a noun phrase, not a clause. The distinguishing signal: a
// real clause almost always opens with a pronoun (subject or possessive);
// a list's final item almost never does. Restricting to this whitelist
// trades some recall for the safety of never splitting a list.
const CLAUSE_STARTERS = [
  "it", "they", "this", "that", "these", "those", "he", "she", "we", "i",
  "there", "you", "their", "its", "his", "her", "our", "your",
];

function trySplitOnCommaConjunction(
  sentence: string,
  rng: () => number,
  minMargin: number
): [string, string] | null {
  const re = /,\s+(and|but|so|yet)\s+/gi;
  const matches: { index: number; conj: string; matchLen: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(sentence))) {
    matches.push({ index: m.index, conj: m[1], matchLen: m[0].length });
  }
  if (!matches.length) return null;

  const mid = sentence.length / 2;
  matches.sort((a, b) => Math.abs(a.index - mid) - Math.abs(b.index - mid));

  for (const cand of matches) {
    const before = sentence.slice(0, cand.index).trim();
    const afterRest = sentence.slice(cand.index + cand.matchLen).trim();
    if (wordCount(before) < minMargin || wordCount(afterRest) < minMargin) continue;

    const firstWord = (afterRest.match(/^[A-Za-z']+/)?.[0] || "").toLowerCase();
    if (!CLAUSE_STARTERS.includes(firstWord)) continue;

    const beforeFixed = /[.!?]$/.test(before) ? before : before + ".";
    // Sometimes keep the conjunction, capitalized, as the new sentence's
    // opener ("And it cost a lot.") — real human writing does this often;
    // AI writing almost never does, which makes it a useful tell to add.
    const keepConjunction = rng() < 0.55;
    const second = keepConjunction
      ? `${cand.conj.charAt(0).toUpperCase()}${cand.conj.slice(1)} ${afterRest}`
      : afterRest.charAt(0).toUpperCase() + afterRest.slice(1);
    return [beforeFixed, second];
  }
  return null;
}

function varyBurstiness(
  sentences: string[],
  mergeProb: number,
  splitProb: number,
  rng: () => number,
  counter: { n: number }
): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < sentences.length) {
    const current = sentences[i];
    const next = sentences[i + 1];

    // Never merge into a sentence that opens with its own transitional
    // adverb ("Furthermore,", "However,") — "X, and furthermore, Y" reads
    // redundant at best and "X, and however, Y" is borderline ungrammatical.
    const TRANSITIONAL_OPENERS =
      /^(furthermore|however|moreover|additionally|therefore|thus|consequently|meanwhile|nonetheless|nevertheless|similarly|likewise|accordingly|hence)\b/i;
    const nextHasTransitionalOpener = next ? TRANSITIONAL_OPENERS.test(next.trim()) : false;

    // MERGE — calibrated against real sentence-length distributions in
    // typical essay prose (median ~16 words/sentence). A ceiling of 10
    // words left the vast majority of sentences untouched; 17 catches most
    // "short-ish" sentences while a combined-length cap keeps the merged
    // result from becoming an unreadable run-on.
    if (
      next &&
      !nextHasTransitionalOpener &&
      wordCount(current) <= 17 &&
      wordCount(next) <= 17 &&
      wordCount(current) + wordCount(next) <= 32 &&
      /\.\s*$/.test(current) &&
      rng() < mergeProb
    ) {
      const conj = pick(CONJUNCTIONS, rng);
      const firstPart = current.replace(/\.\s*$/, "");
      const secondPart = next.charAt(0).toLowerCase() + next.slice(1);
      out.push(`${firstPart}, ${conj} ${secondPart}`.trim());
      counter.n++;
      i += 2;
      continue;
    }

    // SPLIT, primary path — comma+conjunction compound-sentence break.
    // Threshold lowered to 15 (from a now-removed 26) since this is a much
    // safer split point than the old bare-conjunction search, so it can
    // afford to fire on more sentences.
    if (wordCount(current) >= 15 && rng() < splitProb) {
      const commaSplit = trySplitOnCommaConjunction(current, rng, 5);
      if (commaSplit) {
        out.push(commaSplit[0]);
        out.push(commaSplit[1]);
        counter.n++;
        i += 1;
        continue;
      }

      // SPLIT, fallback path — mid-clause "because/although/so" for long
      // sentences that had no comma+conjunction available.
      if (wordCount(current) >= 22) {
        const re = new RegExp(`\\b(${SPLIT_WORDS.join("|")})\\b`, "gi");
        const candidates: number[] = [];
        let m: RegExpExecArray | null;
        while ((m = re.exec(current))) candidates.push(m.index);

        if (candidates.length) {
          const mid = current.length / 2;
          candidates.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));

          // Require enough words on both sides of the cut, or we risk
          // producing a fragment like "Along with volcanic activity." —
          // grammatically broken even though the source sentence was fine.
          const MIN_SIDE_WORDS = 5;
          let chosen: number | null = null;
          for (const idx of candidates) {
            const before = current.slice(0, idx).trim();
            const after = current.slice(idx).trim();
            if (
              wordCount(before) >= MIN_SIDE_WORDS &&
              wordCount(after) >= MIN_SIDE_WORDS
            ) {
              chosen = idx;
              break;
            }
          }

          if (chosen !== null) {
            const before = current.slice(0, chosen).trim();
            let after = current.slice(chosen).trim();
            after = after.replace(
              new RegExp(`^(${SPLIT_WORDS.join("|")})\\s+`, "i"),
              ""
            );
            after = after.charAt(0).toUpperCase() + after.slice(1);
            const beforeFixed = /[.!?]$/.test(before) ? before : before + ".";
            out.push(beforeFixed);
            out.push(after);
            counter.n++;
            i += 1;
            continue;
          }
        }
      }
    }

    out.push(current);
    i += 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

interface IntensitySettings {
  phraseProb: number;
  wordProb: number;
  fillerProb: number;
  contractionProb: number;
  dashProb: number;
  mergeProb: number;
  splitProb: number;
}

const INTENSITY_SETTINGS: Record<Intensity, IntensitySettings> = {
  light: {
    phraseProb: 0.45,
    wordProb: 0.35,
    fillerProb: 0.35,
    contractionProb: 0.25,
    dashProb: 0.4,
    mergeProb: 0.12,
    splitProb: 0.12,
  },
  medium: {
    phraseProb: 0.75,
    wordProb: 0.6,
    fillerProb: 0.65,
    contractionProb: 0.55,
    dashProb: 0.7,
    mergeProb: 0.4,
    splitProb: 0.4,
  },
  heavy: {
    phraseProb: 1,
    wordProb: 0.85,
    fillerProb: 0.9,
    contractionProb: 0.8,
    dashProb: 1,
    mergeProb: 0.65,
    splitProb: 0.65,
  },
};

export function humanize(
  input: string,
  intensity: Intensity,
  seed?: number
): HumanizeResult {
  const rng = mulberry32(seed ?? Math.floor(Math.random() * 2 ** 31));
  const settings = INTENSITY_SETTINGS[intensity];
  const counter = { n: 0 };

  const paragraphs = input.split(/\n{2,}/);

  const processed = paragraphs.map((para) => {
    if (!para.trim()) return para;
    let text = protectInitials(protectDecimals(protectAbbreviations(para)));

    text = applyPhraseMap(text, settings.phraseProb, rng, counter);
    text = applyWordMap(text, settings.wordProb, rng, counter);
    text = trimFillers(text, settings.fillerProb, rng, counter);
    text = applyContractions(text, settings.contractionProb, rng, counter);
    text = reduceEmDash(text, settings.dashProb, rng, counter);

    let sentences = splitSentences(text);
    sentences = varyBurstiness(
      sentences,
      settings.mergeProb,
      settings.splitProb,
      rng,
      counter
    );
    text = sentences.join(" ");

    text = text.replace(/\s{2,}/g, " ").trim();
    text = text.replace(/(^|[.!?]\s+)([a-z])/g, (_, p1, p2) => p1 + p2.toUpperCase());
    text = text.replace(/\s+([,.!?])/g, "$1");
    text = restoreAbbreviations(text);

    return text;
  });

  return { text: processed.join("\n\n"), edits: counter.n };
}
