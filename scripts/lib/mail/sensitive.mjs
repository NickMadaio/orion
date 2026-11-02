// Mail that carries a sign-in code or a security notice (wave 14 fix, 2026-11-02). Pure.
//
// A review found "G-482913 is your Google verification code" kept whole as the alert's topic: the code went to orion-reach, the
// outreach log, the chat mirror, the lock screen, mail-alerts.jsonl and the queued item in mail-state.json. Such mail is now told
// by its sender and a label only ("Google sent a sign-in code"), and its subject and snippet are dropped before anything is kept.
//
// Sensitive: the subject or snippet reads like a security mail, or holds a code-like token of 4 to 8 characters. Course codes
// (CS2100), rooms (Room 101), times (10am), sizes (100GB) and years are not codes; a bare 4-digit number counts only beside a
// code word ("your PIN is 4821").

export const SECURITY = /\b(?:verification code|security code|one[- ]time (?:code|password|passcode)|otp|sign[- ]?in code|login code|2fa|two[- ]factor|confirm your (?:email|sign[- ]?in)|password reset|reset your password|new sign[- ]?in|suspicious (?:sign[- ]?in|activity)|unusual activity)\b/i;
const CODE_WORD = /\b(?:code|passcode|password|otp|pin)\b/i;
const NOTICE = /\b(?:password reset|reset your password|new sign[- ]?in|suspicious (?:sign[- ]?in|activity)|unusual activity)\b/i;

/** One token, judged alone. `codeWord`: the text around it names a code, so a bare 4-digit number counts. */
function tokenIsCode(token, codeWord) {
  if (token.length < 4 || token.length > 8) return false;
  if (/^\d+$/.test(token)) return token.length >= 5 || codeWord;
  if (/^[A-Z]{1,3}-\d{4,7}$/.test(token)) return true;           // G-482913
  if (token.includes("-")) return false;
  if (/^[A-Za-z]+\d+$/.test(token) || /^\d+[A-Za-z]+$/.test(token)) return false;   // CS2100, iPhone15, 100GB, 10am
  return /\d/.test(token) && /[A-Z]/.test(token) && /^[A-Z0-9]+$/.test(token);       // X7K9Q2: letters and digits interleaved
}

/** Whether the text holds a code-like token. `context`: nearby text (the subject, for a snippet) that may name the code. */
export function codeLikeToken(text, context = "") {
  const s = String(text ?? "");
  const codeWord = CODE_WORD.test(`${s} ${context}`);
  return s.split(/[^A-Za-z0-9-]+/).some((raw) => {
    const token = raw.replace(/^-+|-+$/g, "");
    return tokenIsCode(token, codeWord);
  });
}

/** Is this mail sensitive? A queued item that was already redacted keeps its `sensitive` label. */
export function isSensitive(item) {
  if (item?.sensitive) return true;
  const text = `${item?.subject ?? ""} ${item?.snippet ?? ""}`;
  return SECURITY.test(text) || codeLikeToken(item?.subject, item?.snippet) || codeLikeToken(item?.snippet, item?.subject);
}

/** The words that stand in for the subject: "a sign-in code", "a security alert", "a message with a code in it". */
export function sensitiveLabel(item) {
  if (typeof item?.sensitive === "string") return item.sensitive;
  const text = `${item?.subject ?? ""} ${item?.snippet ?? ""}`;
  if (NOTICE.test(text) && !codeLikeToken(text)) return "a security alert";
  if (SECURITY.test(text) || CODE_WORD.test(text)) return "a sign-in code";
  return "a message with a code in it";
}

/** The item with its subject and snippet gone and the label kept: the only shape sensitive mail is stored in. */
export const redactSensitive = (item) => (isSensitive(item) ? { ...item, subject: "", snippet: "", sensitive: sensitiveLabel(item) } : item);
