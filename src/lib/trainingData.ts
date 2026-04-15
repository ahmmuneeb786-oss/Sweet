// 1. Manual "Gold Standard" phrases. 
// These will always have high priority in your predictions.
export const ROMANTIC_GOLD_STANDARD = [
  "i love you so much",
  "you are my favorite person",
  "thinking of you always",
  "can't wait to see you",
  "you make me so happy",
  "good morning beautiful",
  "sweet dreams my love",
  "i miss you",
  "you are amazing",
  "have a wonderful day"
];

// 2. The function to fetch the "Big Brain" data from the web
export const fetchOriginalData = async () => {
  try {
    // Using a proxy to avoid the CORS errors you saw in the console earlier
    const proxyUrl = "https://corsproxy.io/?";
    const targetUrl = "https://www.gutenberg.org/cache/epub/1342/pg1342.txt";
    
    const response = await fetch(proxyUrl + encodeURIComponent(targetUrl));
    
    if (!response.ok) throw new Error("Network response was not ok");
    
    const text = await response.text();
    
    // Clean the text: lowercase, remove punctuation, split into words
    return text.toLowerCase()
      .replace(/[^\w\s]|_/g, "") 
      .split(/\s+/)
      .filter(word => word.length > 2); 
  } catch (error) {
    console.error("Failed to fetch professional web data:", error);
    return [];
  }
};