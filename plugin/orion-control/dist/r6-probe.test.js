import { it } from "vitest";
import { rig } from "./r4-harness.js";
const chat = () => { const adds = []; return { adds, chat: { open: async () => ({ stdout: "", code: 0 }), installed: async () => true, tasks: async (a) => { adds.push(a); return { stdout: `Added "${a[1]}"`, code: 0 }; } } }; };
const day = { date: "d", now: null, blocks: [{ title: "CS1800 Discrete Structures", start: "09:00", end: "10:00", fixed: true }] };
for (const seq of [
    ["add eggs and milk to my shopping list"], ["add a quick call with bea at 7pm and put eggs on my shopping list"],
    ["add eggs to my list", "and add milk too"], ["add stamps to my list", "add a notebook too"],
    ["remind me at 3pm to ring the dentist and put sugar on my list"],
    ["just drank a big bottle of water, how many have i had"], ["is a meal prep box with chicken and rice good before a lecture"],
])
    it(seq.join(" > ").slice(0, 70), async () => {
        const c = chat();
        const out = [];
        const r = rig({ chatRun: c.chat, day, extractReminder: undefined });
        for (const m of seq)
            out.push(`${m.slice(0, 50)} => ${String(await r.turn(m)).slice(0, 200).replace(/\n/g, " ")}`);
        console.log(out.join("\n"), "\nadds:", JSON.stringify(c.adds), "flows:", JSON.stringify(r.flows));
    });
