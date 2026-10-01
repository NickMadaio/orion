import { strict as assert } from "node:assert";

const THIRD_PERSON_PATTERNS = [
  /\bHis\b/g,
  /\bhis\b/g,
  /\bHe\b/g,
  /\bhe\b/g,
  /\bhim\b/g,
  /\bhimself\b/g,
  /(?:^|\s)Nick's\b/g,
  /(?:^|\s)Nick\b/g,
];

const VERB_AGREEMENT = [
  { from: "he's got", to: "you've got" },
  { from: "he's", to: "you're" },
  { from: "he is", to: "you are" },
  { from: "he was", to: "you were" },
  { from: "he has", to: "you have" },
  { from: "he doesn't", to: "you don't" },
];

const THIRD_PERSON_VERBS = [
  "needs", "wants", "has", "goes", "does", "says", "gets", "sleeps",
  "wakes", "asks", "tries",
];

function splitIntoSentences(text) {
  // Split on sentence boundaries but keep the delimiters
  const parts = text.split(/(?<=[.!?])\s+/);
  return parts;
}

function isNickReference(sentence, matchText) {
  // Check if this third-person reference refers to Nick (not someone else)
  // Rule: "he/his/him/himself" and "Nick"/"Nick's" when NO other male name or
  // male noun appears earlier in the same sentence.
  
  const lowerSentence = sentence.toLowerCase();
  
  // Check for other male names or nouns that would indicate this isn't about Nick
  const otherMaleIndicators = [
    /your\s+dad/i,
    /your\s+brother/i,
    /the\s+professor/i,
    /your\s+friend/i,
    // Any capitalized name other than Nick/ORION
    /\b[A-Z][a-z]+\b/g,
  ];
  
  // Find all capitalized names in the sentence before this match
  const nameMatches = lowerSentence.match(/\b[A-Z][a-z]+\b/g) || [];
  
  for (const name of nameMatches) {
    if (name.toLowerCase() !== "nick" && name.toLowerCase() !== "orion") {
      // Found another capitalized name - this might not be about Nick
      return false;
    }
  }
  
  // Check for specific male noun phrases
  if (/your\s+dad/i.test(sentence) || 
      /your\s+brother/i.test(sentence) || 
      /the\s+professor/i.test(sentence) || 
      /your\s+friend/i.test(sentence)) {
    return false;
  }
  
  return true;
}

export function findThirdPerson(reply) {
  if (typeof reply !== "string") {
    throw new TypeError("reply must be a string");
  }
  
  const results = [];
  const sentences = splitIntoSentences(reply);
  
  for (const sentence of sentences) {
    // Check each pattern in the sentence
    for (const pattern of THIRD_PERSON_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(sentence)) !== null) {
        const phrase = match[0].trim();
        if (isNickReference(sentence, phrase)) {
          results.push({ phrase, index: match.index });
        }
      }
    }
  }
  
  return results;
}

export function toSecondPerson(reply) {
  if (typeof reply !== "string") {
    throw new TypeError("reply must be a string");
  }
  
  // Split into sentences to handle context properly
  const sentences = splitIntoSentences(reply);
  
  const processedSentences = sentences.map(sentence => {
    // First, protect quoted text
    const quoteParts = [];
    let remaining = sentence;
    
    while (remaining.includes('"')) {
      const startQuote = remaining.indexOf('"');
      const endQuote = remaining.indexOf('"', startQuote + 1);
      
      if (endQuote === -1) break; // Unmatched quote, treat as literal
      
      // Add text before quote
      if (startQuote > 0) {
        quoteParts.push({ type: "text", content: remaining.slice(0, startQuote) });
      }
      // Add the quoted part
      quoteParts.push({ type: "quote", content: remaining.slice(startQuote, endQuote + 1) });
      remaining = remaining.slice(endQuote + 1);
    }
    
    if (remaining.length > 0) {
      quoteParts.push({ type: "text", content: remaining });
    }
    
    // Process only the non-quoted parts
    const processedParts = quoteParts.map(part => {
      if (part.type === "quote") {
        return part.content;
      }
      
      let text = part.content;
      
      // Check if this sentence has third-person references to Nick
      const refs = findThirdPerson(text);
      if (refs.length === 0) {
        return text;
      }
      
      // Apply verb agreement transformations first (before pronoun changes)
      for (const rule of VERB_AGREEMENT) {
        const regex = new RegExp(`\\b${rule.from}\\b`, "gi");
        text = text.replace(regex, (match) => {
          // Preserve capitalization if the pronoun was capitalized
          if (match[0] === match[0].toUpperCase() && /[Hh]/.test(match[0])) {
            return rule.to.charAt(0).toUpperCase() + rule.to.slice(1);
          }
          return rule.to;
        });
      }
      
      // Handle third-person -s verbs after he/him
      for (const verb of THIRD_PERSON_VERBS) {
        const regex = new RegExp(`\\b(he|him)\\s+${verb}\\b`, "gi");
        text = text.replace(regex, (match) => {
          const base = `you ${verb.slice(0, -1)}`;
          // Preserve capitalization if the pronoun was capitalized
          if (/^[Hh]/.test(match) && match[0] === "H") {
            return "You" + base.slice(3);
          }
          return base;
        });
      }
      
      // Now replace the pronouns themselves
      const replacements = [
        { pattern: /\bHis\b/g, replacement: "Your" },
        { pattern: /\bhis\b/g, replacement: "your" },
        { pattern: /\bHe\b/g, replacement: "You" },
        { pattern: /\bhe\b/g, replacement: "you" },
        { pattern: /\bhim\b/g, replacement: "you" },
        { pattern: /\bhimself\b/g, replacement: "yourself" },
        { pattern: /(?:^|\s)Nick's\b/g, replacement: (match) => match.startsWith(" ") ? " your" : "your" },
        { pattern: /(?:^|\s)Nick\b/g, replacement: (match) => match.startsWith(" ") ? " you" : "you" },
      ];
      
      for (const repl of replacements) {
        text = text.replace(repl.pattern, repl.replacement);
      }
      
      return text;
    });
    
    return processedParts.join("");
  });
  
  return processedSentences.join(" ");
}
