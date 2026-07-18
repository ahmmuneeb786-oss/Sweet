import rawDictionary from './assets/dictionary.json';

// Sorted, flat word list — enables binary-search prefix lookup (O(log n))
// instead of scanning every key in the dictionary on every keystroke, which
// was the main cause of typing lag. Accepts either a plain array (the
// expected shape going forward) or the old prefix-map object shape, so
// existing dictionary.json files keep working without needing to be
// regenerated first.
let wordList: string[] = [];

// Real next-word prediction data — ONLY populated by learnFromMessage from
// actual sent messages. A static frequency word list (like
// google-10000-english) has no sequencing information at all, so it can
// power autocomplete-while-typing, but it cannot honestly power "predict
// the next word" — that needs real bigram data, which starts empty and
// grows from how you actually write.
let bigramMap: Record<string, string[]> = {};

export const initializeDictionary = async () => {
  try {
    if (Array.isArray(rawDictionary)) {
      wordList = (rawDictionary as string[]).map((w) => w.toLowerCase()).sort();
    } else {
      // Backward-compatible with the old prefix-map shape — just take the
      // union of every word ever stored as a suggestion under any prefix.
      const set = new Set<string>();
      Object.values(rawDictionary as Record<string, string[]>).forEach((words) =>
        words.forEach((w) => set.add(w.toLowerCase()))
      );
      wordList = Array.from(set).sort();
    }
    console.log(`Dictionary loaded: ${wordList.length} words`);
  } catch (error) {
    console.error("Error initializing dictionary:", error);
  }
};

// Binary search for the first index where wordList[i] >= prefix.
function lowerBound(prefix: string): number {
  let lo = 0, hi = wordList.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (wordList[mid] < prefix) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// All words starting with `prefix`, using the sorted list — only touches
// the actual matching range, not the whole dictionary.
function prefixMatches(prefix: string, limit: number): string[] {
  const start = lowerBound(prefix);
  const results: string[] = [];
  for (let i = start; i < wordList.length && results.length < limit; i++) {
    if (!wordList[i].startsWith(prefix)) break; // sorted, so matches are contiguous
    results.push(wordList[i]);
  }
  return results;
}

const getEditDistance = (a: string, b: string): number => {
  const matrix = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[a.length][b.length];
};

// Typo fallback — only runs when prefix matching alone didn't find enough
// results, and only against a bounded, nearby slice of the sorted list
// (same first letter, similar length) instead of the entire dictionary.
function fuzzyMatches(lastWord: string, limit: number): string[] {
  if (lastWord.length < 3) return [];

  const firstLetter = lastWord[0];
  const candidateStart = lowerBound(firstLetter);
  const candidates: string[] = [];
  for (let i = candidateStart; i < wordList.length; i++) {
    const w = wordList[i];
    if (w[0] !== firstLetter) break; // sorted — past this letter entirely
    if (Math.abs(w.length - lastWord.length) <= 2) candidates.push(w);
  }

  return candidates
    .map((word) => ({ word, distance: getEditDistance(lastWord, word) }))
    .filter((item) => item.distance <= 2)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .map((item) => item.word);
}

export const getSuggestions = (fullText: string): string[] => {
  if (!fullText) return ["", "", ""];

  const isEndingWithSpace = fullText.endsWith(' ');
  const words = fullText.trim().toLowerCase().split(/\s+/);
  const lastWord = words[words.length - 1];

  if (isEndingWithSpace) {
    // Real next-word prediction — only from what's actually been learned
    // from this user's own messages. Empty is an honest answer if nothing's
    // been learned yet, rather than showing unrelated autocomplete words.
    const prevWord = words[words.length - 1]; // last real word before the trailing space
    const nextWords = bigramMap[prevWord] || [];
    return [nextWords[1] || "", nextWords[0] || "", nextWords[2] || ""];
  }

  if (!lastWord) return ["", "", ""];

  let matches = prefixMatches(lastWord, 3);
  if (matches.length < 3) {
    const fuzzy = fuzzyMatches(lastWord, 3 - matches.length);
    matches = Array.from(new Set([...matches, ...fuzzy]));
  }

  return [matches[1] || "", matches[0] || "", matches[2] || ""];
};

export const learnFromMessage = (message: string) => {
  const words = message.toLowerCase().trim().split(/\s+/).filter(Boolean);

  // Real bigrams: for each consecutive pair, record "word A is often
  // followed by word B" — this is what actually powers after-space
  // prediction now, instead of reusing the autocomplete prefix index.
  for (let i = 0; i < words.length - 1; i++) {
    const current = words[i];
    const next = words[i + 1];
    if (current.length < 2 || next.length < 2) continue;

    if (!bigramMap[current]) bigramMap[current] = [];
    const existingIndex = bigramMap[current].indexOf(next);
    if (existingIndex !== -1) bigramMap[current].splice(existingIndex, 1);
    bigramMap[current].unshift(next);
    if (bigramMap[current].length > 5) bigramMap[current].pop();
  }

  // Also feed genuinely new words into the autocomplete word list, so
  // words you actually use become completable even if they weren't in the
  // static dictionary.
  words.forEach((word) => {
    if (word.length < 3) return;
    const idx = lowerBound(word);
    if (wordList[idx] !== word) {
      wordList.splice(idx, 0, word); // keep it sorted for binary search
    }
  });
};