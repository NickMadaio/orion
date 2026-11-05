export const BANNED_SHAPES = [
    { id: "say-it-again", test: /\b(?:can|could|would) you (?:please )?(?:say|tell|ask) (?:me )?(?:it|that|this)? ?again\b|\bsay it again\b|\btell me (?:it )?again\b|\bsay that again\b/i, why: "asks him to repeat" },
    { id: "rephrase", test: /\b(?:can|could|would) you (?:please )?(?:re-?phrase|reword|put that differently|say that differently)\b|\btell me differently\b/i, why: "asks him to rephrase" },
    { id: "bare-ellipsis", test: /^\s*(?:…|\.{3,})\s*$/, why: "a reply that is only dots" },
    { id: "empty", test: /^\s*$/, why: "no reply at all" },
    { id: "lookup-excuse", test: /\bI couldn'?t run that lookup\b/i, why: "the canned tool-failure line" },
    { id: "third-person-self", test: /\b(?:ORION (?:is|has|was|can|cannot|can'?t|will|does|did|doesn'?t|couldn'?t|won'?t|needs|refused)|ORION'?s own|ask ORION|tell ORION|(?:the|an?) ORION (?:app|assistant))\b/, why: "ORION talks about itself in the third person" },
    { id: "nothing-changed-no-reason", test: /^\s*(?:not done|nothing changed|no change)[.:]?\s*$/i, why: "a refusal with no reason" },
    { id: "raw-error", test: /\b(?:exec failed|ENOENT|exit (?:code )?[1-9]\b|not found in \/(?:Applications|System|Users))|\bTraceback\b|\bundefined\b|\[object Object\]/i, why: "raw tool or script text leaked" },
    { id: "diagnostic-leak", test: /\boutput format may have changed\b|\bstrict mode\b|\bshadow\.jsonl\b/i, why: "an internal diagnostic read out as the message" },
    { id: "fit-no-reason", test: /^(?=.{0,70}$)(?:(?!because|since|bedtime|asleep|overlap|past|already|ends?\b|conflict|clash|room|before|after).)*didn'?t fit\b(?:(?!because|since|bedtime|asleep|overlap|past|already|conflict|clash|room).)*$/i, why: "a short 'didn't fit' with no reason" },
    { id: "do-it-yourself", test: /\btry restarting the app\b|\byou'?ll need to (?:close|open|quit|start|do) .{0,40}\bmanually\b|\bfrom (?:your|the) (?:dock|Applications folder)\b|\bActivity Monitor\b|\buse (?:the )?Spotlight\b/i, why: "tells him to do it himself" },
    { id: "model-note-aloud", test: /\buser corrected\b|\bassumed standard\b/i, why: "the model's own note spoken as the answer" },
    { id: "double-period", test: /\.\.(?!\.)(?<!\.\.\.)/, why: "two full stops in a row" },
    { id: "fahrenheit-macros", test: /\bdegrees Fahrenheit\b.*\b(?:kcal|protein|calories)\b|\b(?:kcal|protein|calories)\b.*\bdegrees Fahrenheit\b/i, why: "macros spoken as a temperature" },
];
export const shapesIn = (reply, extra = []) => [
    ...BANNED_SHAPES.filter((s) => s.test.test(reply)).map((s) => s.id),
    ...extra.filter((src) => new RegExp(src, "i").test(reply)).map((src) => `banned:${src}`),
];
