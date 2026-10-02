import { strict as assert } from "node:assert";

export const MAC_STEPS = ["none", "nudge", "say", "front", "quit", "lock"];

const OFF_TASK_APPS = new Set([
  "Instagram", "TikTok", "Snapchat", "Reddit", "Twitter", "X",
  "Facebook", "Netflix", "Discord", "Steam"
]);

const OFF_TASK_TITLE_RE = /\b(instagram|tiktok|reddit|netflix|twitch|x\.com|twitter|facebook)\b/i;

const NON_FOCUS_KINDS = new Set(["meal", "rest", "gym"]);
const NON_FOCUS_TITLE_RE = /\b(nap|wind down|sleep|bed|break|rest|dinner|lunch|breakfast|meal|gym)\b/i;

/**
 * @param {Array<{id: string, title: string, kind: string, start: number, end: number, fixed: boolean, source: string}>} blocks
 * @param {number} now
 * @returns {{id: string, title: string, kind: string, start: number, end: number, fixed: boolean, source: string}|null}
 */
export function focusBlock(blocks, now) {
  for (const block of blocks) {
    if (now < block.start || now >= block.end) continue;

    // Real classes are not focus blocks.
    // A real class is kind === "class" && fixed && source !== "orion".
    if (block.kind === "class" && block.fixed && block.source !== "orion") {
      continue;
    }

    // Must be study, side_project, deadline, other, or ORION class.
    const isAllowedKind = [
      "study", "side_project", "deadline", "other",
      block.kind === "class" && block.source === "orion" ? "class" : null
    ].includes(block.kind);

    if (!isAllowedKind) continue;

    // Title must not match non-focus patterns.
    if (NON_FOCUS_TITLE_RE.test(block.title)) continue;

    return block;
  }
  return null;
}

/**
 * @param {{id: string, title: string, kind: string, start: number, end: number, fixed: boolean, source: string}} block
 * @param {{app: string, title: string, idleSeconds: number}} activity
 * @param {{allow?: string[]}} opts
 * @returns {{onTask: boolean, why: string}}
 */
export function judgeActivity(block, activity, { allow = [] } = {}) {
  // Idle check first? The brief says "idleSeconds >= 300 is off task".
  // It lists checks in order: allow, off-task apps/titles, youtube, otherwise on task.
  // But idle is a separate condition. Let's look at the structure.
  // "judgeActivity: on task when ... OFF task when ... YouTube counts as ... otherwise on task. idleSeconds >= 300 is off task."
  // This implies idle overrides or is checked alongside. Usually idle means away, so off-task.
  
  if (activity.idleSeconds >= 300) {
    return { onTask: false, why: "idle for too long" };
  }

  const appLower = activity.app.toLowerCase();
  const titleLower = activity.title.toLowerCase();
  const allowLower = allow.map(a => a.toLowerCase());

  // On task if app or title contains any allow entry.
  for (const allowed of allowLower) {
    if (appLower.includes(allowed) || titleLower.includes(allowed)) {
      return { onTask: true, why: "allowed app or title" };
    }
  }

  // Off task if app is in the bad list.
  // The list is case-sensitive in the brief? "Instagram", "TikTok"...
  // Let's assume case-insensitive match for safety, or exact?
  // Brief: "app is one of Instagram, TikTok..."
  // Usually app names are specific. Let's do case-insensitive to be robust, 
  // but the set above has mixed case. Let's normalize.
  const appIsBad = OFF_TASK_APPS.has(activity.app);
  
  if (appIsBad) {
    return { onTask: false, why: `off-task app ${activity.app}` };
  }

  // Off task if title matches bad regex.
  if (OFF_TASK_TITLE_RE.test(activity.title)) {
    return { onTask: false, why: "off-task window title" };
  }

  // YouTube special case.
  if (appLower.includes("youtube") || titleLower.includes("youtube")) {
    // On task only when title shares a word of 4+ letters with block title.
    const blockWords = new Set(
      block.title.toLowerCase().split(/\W+/).filter(w => w.length >= 4)
    );
    const titleWords = activity.title.toLowerCase().split(/\W+/);
    
    let shared = false;
    for (const word of titleWords) {
      if (word.length >= 4 && blockWords.has(word)) {
        shared = true;
        break;
      }
    }

    if (shared) {
      return { onTask: true, why: "youtube video related to block" };
    } else {
      return { onTask: false, why: "youtube video not related to block" };
    }
  }

  // Otherwise on task.
  return { onTask: true, why: "on-task activity" };
}

/**
 * @param {{blockId: string|null, offSince: number|null, lastStep: string, snoozeUntil: number|null, phoneWarnedAt: number|null}} state
 * @param {{now: number, block: {id: string, title: string, kind: string, start: number, end: number, fixed: boolean, source: string}|null, activity: {app: string, title: string, idleSeconds: number}, phone: {minutesInUse: number}, allow?: string[]}} opts
 * @returns {{mac: string, phone: string, why: string, state: {blockId: string|null, offSince: number|null, lastStep: string, snoozeUntil: number|null, phoneWarnedAt: number|null}}}
 */
export function nextStep(state, { now, block, activity, phone, allow = [] }) {
  // 1. No focus block -> none.
  if (!block) {
    const newState = {
      ...state,
      offSince: null,
      lastStep: "none",
      // keep snoozeUntil? Brief says "state reset to offSince: null, lastStep: 'none' (keep snoozeUntil)".
      // But if there's no block, do we keep it? Yes.
    };
    return { mac: "none", phone: "none", why: "no focus block", state: newState };
  }

  // 2. Snooze check.
  if (state.snoozeUntil !== null && state.snoozeUntil > now) {
    const newState = {
      ...state,
      offSince: null,
      lastStep: "none",
    };
    return { mac: "none", phone: "none", why: "snoozed", state: newState };
  }

  // 3. New block id resets state.
  const isNewBlock = state.blockId !== block.id;
  let currentState = { ...state };
  
  if (isNewBlock) {
    currentState = {
      blockId: block.id,
      offSince: null,
      lastStep: "none",
      snoozeUntil: null, // cleared
      phoneWarnedAt: null,
    };
  }

  // 4. Judge activity.
  const judgment = judgeActivity(block, activity, { allow });
  
  // 5. Mac ladder.
  let macStep = "none";
  let whyMac = "";

  if (judgment.onTask) {
    // Back on task -> none and reset offSince/lastStep.
    currentState.offSince = null;
    currentState.lastStep = "none";
    macStep = "none";
    whyMac = "on task";
  } else {
    // Off task.
    if (currentState.offSince === null) {
      currentState.offSince = now;
    }

    const minutesOff = (now - currentState.offSince);
    
    // Determine target step based on time.
    let targetStepIndex = 0; // "none"
    if (minutesOff >= 20) targetStepIndex = 5; // lock
    else if (minutesOff >= 12) targetStepIndex = 4; // quit
    else if (minutesOff >= 8) targetStepIndex = 3; // front
    else if (minutesOff >= 5) targetStepIndex = 2; // say
    else if (minutesOff >= 2) targetStepIndex = 1; // nudge
    
    // Current step index.
    const currentStepIndex = MAC_STEPS.indexOf(currentState.lastStep);
    
    // Never skip upward by more than one step per call.
    let nextStepIndex = Math.min(targetStepIndex, currentStepIndex + 1);
    
    // Ensure we don't go backwards? The brief implies escalation only while off task.
    // If we were at "say" and now it's only been 3 mins (due to time jump back?), 
    // the ladder logic is based on `offSince`. If `offSince` is fixed, minutesOff grows.
    // So targetStepIndex only grows or stays same relative to offSince.
    // However, if we reset offSince, it starts at 0.
    
    macStep = MAC_STEPS[nextStepIndex];
    currentState.lastStep = macStep;
    whyMac = `off task for ${minutesOff} min`;
  }

  // 6. Phone rules. Applies whether or not Mac is on task.
  let phoneStep = "none";
  let whyPhone = "";
  
  const minsInUse = phone.minutesInUse;
  
  if (minsInUse >= 15) {
    phoneStep = "block";
    whyPhone = "phone use >= 15 min";
  } else if (minsInUse >= 10) {
    // Warn once.
    if (currentState.phoneWarnedAt === null) {
      phoneStep = "warn";
      currentState.phoneWarnedAt = now;
      whyPhone = "phone use >= 10 min, first warning";
    } else {
      phoneStep = "none";
      whyPhone = "phone use >= 10 min, already warned";
    }
  } else {
    whyPhone = "phone use < 10 min";
  }

  // Combine why.
  const why = `${whyMac}; ${whyPhone}`;

  return { mac: macStep, phone: phoneStep, why, state: currentState };
}
