import rawDictionary from './assets/dictionary.json';

// 2. This variable holds the data for the whole file
let dictionary: Record<string, string[]> = {};

// 3. Initialize the dictionary
export const initializeDictionary = async () => {
  try {
    // We use the imported file directly
    dictionary = rawDictionary as Record<string, string[]>;
    console.log("Native-Ready Dictionary Loaded from Assets!");
  } catch (error) {
    console.error("Error initializing dictionary:", error);
  }
};

// Helper function to calculate how "far apart" two words are
const getEditDistance = (a: string, b: string): number => {
  const matrix = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // deletion
        matrix[i][j - 1] + 1,      // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }
  return matrix[a.length][b.length];
};

export const getSuggestions = (fullText: string): string[] => {
  if (!fullText) return ["", "", ""];

  const isEndingWithSpace = fullText.endsWith(' ');
  const words = fullText.trim().toLowerCase().split(/\s+/);
  const lastWord = words[words.length - 1];

  if (isEndingWithSpace) {
    const nextWords = dictionary[lastWord] || [];
    return [nextWords[1] || "", nextWords[0] || "", nextWords[2] || ""];
  }

  // 1. Try Prefix Matching First (e.g., "peo" -> "people")
  let matches = Object.keys(dictionary).filter(k => k.startsWith(lastWord));

  // 2. If no direct prefix, or if the user is making a typo, find the CLOSEST word
  if (lastWord.length > 2) {
    const allWords = Object.keys(dictionary).filter(k => k.length >= lastWord.length - 1);
    
    // Sort words by their similarity to what the user typed
    const fuzzyMatches = allWords
      .map(word => ({ word, distance: getEditDistance(lastWord, word) }))
      .filter(item => item.distance <= 2) // Only allow 1 or 2 mistakes
      .sort((a, b) => a.distance - b.distance)
      .map(item => item.word);

    // Combine prefix matches and fuzzy matches, removing duplicates
    matches = Array.from(new Set([...matches, ...fuzzyMatches]));
  }

  const results = matches.slice(0, 3);
  // We want the most likely word in the MIDDLE (index 1)
  return [results[1] || "", results[0] || "", results[2] || ""];
};

export const learnFromMessage = (message: string) => {
  const words = message.toLowerCase().split(/\s+/);
  
  words.forEach(word => {
    if (word.length < 3) return; // Don't learn tiny words like "is" or "at"

    // Add to prefixes
    for (let i = 1; i < word.length; i++) {
      const prefix = word.substring(0, i);
      if (!dictionary[prefix]) dictionary[prefix] = [];
      
      // If the word is new, put it at the very front of suggestions
      if (!dictionary[prefix].includes(word)) {
        dictionary[prefix].unshift(word); 
        if (dictionary[prefix].length > 5) dictionary[prefix].pop();
      }
    }
  });
};