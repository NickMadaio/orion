import { blocksNamed } from "./day-replan.js";
const OWNED = [
    { re: /^(?:gym|workout|work out|lift(?:ing)?)$/, minutes: 90 },
    { re: /^side[ -]?project$/, minutes: 60 },
    { re: /^study(?: block| session| time)?$/, minutes: 60 },
    { re: /^(?:nap|power nap)$/ },
];
/** The add a move becomes, or undefined when this move is not that case. */
export function ownedMoveAsAdd(intent, day) {
    const item = intent.items[0];
    if (intent.verb !== "move" || intent.all || intent.target || !item || !item.start || item.fromSaid || item.by !== undefined)
        return undefined;
    const name = item.name.toLowerCase().trim();
    const owned = OWNED.find((o) => o.re.test(name));
    if (!owned || blocksNamed(item.name, day).length > 0)
        return undefined;
    const anchor = day.plan?.anchors.find((a) => a.title.toLowerCase() === name);
    // Only a length Nick said stays on the item (it earns --length-explicit); an anchor or default length is passed beside it, so his saved minimums still apply.
    const defaultMinutes = anchor?.minutes ?? owned.minutes;
    const when = intent.day === "tomorrow" ? "tomorrow's" : "today's";
    const cap = item.name.replace(/^./, (c) => c.toUpperCase());
    return {
        intent: { ...intent, verb: "add", items: [item] },
        ...(defaultMinutes ? { defaultMinutes } : {}),
        note: `${cap} wasn't on ${when} calendar, so I added it rather than moved it.`,
    };
}
