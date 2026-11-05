const KEEP_MS = 30 * 60_000;
let last = null;
export const rememberEdit = (edit, now) => { last = { edit, at: now.getTime() }; };
export const recallEdit = (now) => (last && now.getTime() - last.at <= KEEP_MS ? last.edit : null);
export const forgetEdit = () => { last = null; };
const OVERRIDE = /\b(?:anyway|anyways|regardless|even though|even if|still (?:add|put|log)|(?:add|put|log) (?:it|that|those|them) (?:anyway|anyways|still))\b|\b(?:don'?t worry|doesn'?t matter|who cares|never mind) (?:that |if )?(?:it |that )?(?:already |has |have )?(?:passed|started|happened|over)\b|\balready passed\b/;
/** "add marketing museum anyways don't worry if it already passed": the last edit again, or just the parts he names. */
export function readOverride(message, now) {
    const m = message.toLowerCase().replace(/[’`]/g, "'");
    if (!OVERRIDE.test(m) || !/\b(?:add|put|log|do|book|schedule|keep|that|it)\b/.test(m))
        return null;
    const prev = recallEdit(now);
    if (!prev)
        return null;
    const named = prev.parts.filter((p) => "name" in p && p.name.length > 2 && m.includes(p.name.toLowerCase().split(" ")[0]));
    return { parts: named.length ? named : prev.parts };
}
