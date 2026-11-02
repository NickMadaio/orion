// The words the vision model gets (orion-food-estimate). Identify first, size second, then the numbers: asking for
// calories straight away gets a round guess for the whole plate; asking for grams with a stated reason gets portions
// the table can turn into numbers, and assumptions Nick can correct ("it was a small one").

export const SYSTEM = [
  "You estimate the nutrition of a meal for a calorie log. Be careful and realistic, not optimistic.",
  "Step 1: identify each distinct food or drink (the main items, plus sauces, oil, dressing, cheese or sugary drinks when they add calories).",
  "Step 2: estimate each portion in grams. For a photo, use visual cues: plate (about 26 cm), bowl, cutlery, hand, packaging, can (330 ml).",
  "For a description, use the words (small, large, a can, a slice) and typical restaurant or home portions.",
  "Step 3: for each item give kcal, protein p, carbohydrate c and fat f in grams for THAT portion, consistent with kcal ≈ 4p + 4c + 9f.",
  "Give each item a confidence: high (clearly visible or named with a size), medium, or low (guessed).",
  "List the assumptions you made in short phrases, e.g. \"guessed 1 tbsp oil\", \"assumed a regular can\".",
  "Answer with JSON only, no prose: {\"items\":[{\"name\":\"\",\"grams\":0,\"kcal\":0,\"p\":0,\"c\":0,\"f\":0,\"confidence\":\"medium\"}],\"totals\":{\"kcal\":0,\"p\":0,\"c\":0,\"f\":0},\"assumptions\":[\"\"]}",
  "Use short plain food names (\"chicken burrito\", \"coca cola\"). If you cannot see or read any food, return {\"items\":[],\"assumptions\":[\"no food found\"]}.",
].join("\n");

/** The user message: his words, the photos' count, and a correction to an earlier estimate when there is one. */
export function userPrompt({ text, imageCount = 0, correction, previous }) {
  const parts = [];
  if (imageCount) parts.push(`${imageCount === 1 ? "A photo" : `${imageCount} photos`} of the meal ${imageCount === 1 ? "is" : "are"} attached.`);
  if (text) parts.push(`What he said about it: "${text}"`);
  if (previous) parts.push(`Your earlier estimate was: ${previous}`);
  if (correction) parts.push(`He corrected it: "${correction}". Re-estimate with that correction; it overrides your earlier guesses.`);
  if (!parts.length) parts.push("Estimate the meal.");
  return parts.join("\n");
}
