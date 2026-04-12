export const fetchOriginalData = async () => {
  try {
    // We add a CORS proxy prefix to bypass the browser block
    const proxyUrl = "https://corsproxy.io/?";
    const targetUrl = "https://www.gutenberg.org/cache/epub/1342/pg1342.txt";
    
    const response = await fetch(proxyUrl + encodeURIComponent(targetUrl));
    
    if (!response.ok) throw new Error("Network response was not ok");
    
    const text = await response.text();
    
    // Clean and split the text into words
    return text.toLowerCase()
      .replace(/[^\w\s]/g, "") 
      .split(/\s+/)
      .filter(word => word.length > 2); 
  } catch (error) {
    console.error("Failed to fetch professional web data:", error);
    return [];
  }
};

export const ROMANTIC_GOLD_STANDARD = [
  "I love you so much",
  "You are my everything",
  "Can't wait to see you",
  "You look beautiful today",
  "I am thinking about you",
  "Good morning sunshine",
  "Sweet dreams my love",
  "You make me so happy",
  "I miss your smile",
  "Forever and always",
  "You are the best thing that ever happened to me"
];

export const COMMON_TYPOS: Record<string, string> = {
  // Common Slang/Shortcuts
  "u": "you",
  "r": "are",
  "n": "and",
  "y": "why",
  "k": "okay",
  "omw": "on my way",
  
  // Common Romantic Typos
  "lov": "love",
  "lvoe": "love",
  "beautifull": "beautiful",
  "tomm": "tomorrow",
  "tmr": "tomorrow",
  "mornin": "morning",
  "nigh": "night",
  "realy": "really",
  "hapy": "happy",
  "missu": "miss you",
  "ily": "i love you"
};