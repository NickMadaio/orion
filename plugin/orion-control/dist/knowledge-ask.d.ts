/** "is it bad to eat rice after the gym or whats the deal with carbs at night": a health or food fact, not his day. */
export declare function isHealthKnowledgeAsk(message: string): boolean;
/** "whats the formula for the multiplier in econ, i forgot": a textbook question, not about him or his day. */
export declare function isKnowledgeAsk(message: string): boolean;
export declare const KNOWLEDGE_PROMPT = "Nick asked a general-knowledge question. Give the standard, textbook-correct answer in one or two short sentences (a formula written plainly, e.g. \"1 / (1 \u2212 MPC)\", with what each letter means). If the subject has more than one common version, give the one taught in an intro course and name it. No tools, nothing about his day, no follow-up offer.";
