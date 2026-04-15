class KeyboardBrain {
  private trie: any = {};
  private bigrams: Record<string, Record<string, number>> = {};

  // This handles the "Current Word" completion
  insert(word: string) {
    let node = this.trie;
    for (const char of word.toLowerCase()) {
      if (!node[char]) node[char] = {};
      node = node[char];
    }
    node.isEndOfWord = true;
  }

  // This is what ChatWindow is calling on line 108
  async initialize(webWords: string[], manualPhrases: string[]) {
    // Reset brain
    this.trie = {};
    this.bigrams = {};

    // Load manual high-priority phrases
    manualPhrases.forEach(phrase => {
      phrase.split(/\s+/).forEach(word => this.insert(word));
    });

    // Load web data
    for (let i = 0; i < webWords.length - 1; i++) {
      const current = webWords[i].toLowerCase();
      const next = webWords[i + 1].toLowerCase();
      this.insert(current);
      if (!this.bigrams[current]) this.bigrams[current] = {};
      this.bigrams[current][next] = (this.bigrams[current][next] || 0) + 1;
    }
  }

  serialize() {
    return { trie: this.trie, bigrams: this.bigrams };
  }

  loadFromSerialized(data: any) {
    if (data) {
      this.trie = data.trie;
      this.bigrams = data.bigrams;
    }
  }
}

export const brain = new KeyboardBrain();