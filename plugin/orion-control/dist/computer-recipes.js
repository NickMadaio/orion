/**
 * Deterministic recipes for the computer loop (2026-10-30): one handler per clause kind, each
 * observe -> act -> re-read the AX tree -> verify the expected change -> one alternative -> honest failure.
 *
 * Preference order, from Nick's "the thing Sentient OS got right": an AX action on a named element
 * (press, set value, menu item) first; the keyboard shortcut or a coordinate click only as the retry.
 * A press that could send or submit is never retried (a second click could send twice).
 *
 * The model is used in exactly one place, `resolve`: when two on-screen candidates match his words equally,
 * it may name one BY NUMBER. Anything else it says is ignored.
 */
import { candidateLines, candidates, clearWinner, fingerprint, flatten, inGroup, nameOf, similarity, visibleText, } from "./computer-ax.js";
import { authorizePress, classifyLabel } from "./computer-auth.js";
import { BridgeFailure } from "./computer-bridge.js";
/** Thrown when the next action would pass the cap; carries what the current clause had done so far. */
export class StepCap extends Error {
    partial;
    constructor(partial) {
        super("step cap");
        this.partial = partial;
        this.name = "StepCap";
    }
}
const FATAL = new Set(["no_access", "denied", "locked"]);
const ref = (node) => ({ path: node.path, role: node.role, label: node.label });
const quote = (text, max = 40) => `"${text.length > max ? `${text.slice(0, max - 1)}…` : text}"`;
/** One action against the bridge, logged. A fatal failure (no grant, denylisted, locked) ends the task. */
async function act(ctx, entry, run) {
    if (ctx.state.used >= ctx.maxSteps)
        throw new StepCap();
    ctx.state.used += 1;
    const n = ctx.state.used;
    try {
        await run();
        ctx.state.log.push({ ...entry, n, ok: true, verified: false });
        return true;
    }
    catch (error) {
        if (error instanceof BridgeFailure && FATAL.has(error.kind))
            throw error;
        ctx.state.log.push({ ...entry, n, ok: false, verified: false, note: String(error.message ?? error).slice(0, 160) });
        return false;
    }
}
function markVerified(ctx, note) {
    const last = ctx.state.log[ctx.state.log.length - 1];
    if (last)
        ctx.state.log[ctx.state.log.length - 1] = { ...last, verified: true, ...(note ? { note } : {}) };
}
/** Re-reads the screen until `ok` holds (about 1.5 s by default). */
async function waitFor(ctx, ok, tries = 6, delayMs = 250) {
    for (let i = 0; i < tries; i += 1) {
        if (i > 0)
            await ctx.sleep(delayMs);
        const o = await ctx.bridge.observe().catch((e) => { if (e instanceof BridgeFailure && FATAL.has(e.kind))
            throw e; return null; });
        if (o && ok(o))
            return o;
    }
    return null;
}
export function matchesApp(o, app) {
    return app.bundleId ? o.bundleId === app.bundleId : o.appName.toLowerCase() === app.name.toLowerCase();
}
const valueAt = (o, path) => flatten(o.element).find((n) => n.path === path)?.value ?? null;
const editables = (o) => flatten(o.element).filter((n) => inGroup(n, "editable"));
/** A candidate for his words, or an Outcome when there is none or it is a toss-up. */
async function resolve(ctx, nodes, group, words, generic, describe) {
    const list = candidates(nodes, group, generic ? "" : words);
    if (list.length === 0)
        return { status: "fail", why: `couldn't find ${describe} on screen` };
    if (list.length === 1)
        return { node: list[0].node, unique: true };
    const winner = generic ? null : clearWinner(list);
    if (winner)
        return { node: winner.node, unique: false };
    if (ctx.pick && !generic) {
        const lines = candidateLines(list);
        const picked = await ctx.pick(words, lines).catch(() => null);
        if (typeof picked === "number" && Number.isInteger(picked) && picked >= 1 && picked <= lines.length)
            return { node: list[picked - 1].node, unique: false };
    }
    return { status: "ask", ask: `Which one: ${list.slice(0, 4).map((c) => quote(nameOf(c.node) || c.node.role.replace(/^AX/, ""))).join(", ")}?` };
}
const isOutcome = (value) => typeof value === "object" && value !== null && "status" in value;
export async function openApp(ctx, app) {
    ctx.progress(`opening ${app.name}`);
    for (let attempt = 0; attempt < 2; attempt += 1) {
        await act(ctx, { action: "open", target: app.name, via: "open" }, () => ctx.bridge.openApp(app));
        if (await waitFor(ctx, (o) => matchesApp(o, app), 12, 300)) {
            markVerified(ctx);
            return { status: "ok", said: `opened ${app.name}` };
        }
    }
    return { status: "fail", why: `couldn't bring ${app.name} to the front` };
}
/** The app the clause acts on: the one he named (opened if it is not in front), else whatever is in front. */
export async function frontFor(ctx) {
    const o = await ctx.bridge.observe();
    if (ctx.app && !matchesApp(o, ctx.app)) {
        const opened = await openApp(ctx, ctx.app);
        if (opened.status !== "ok")
            return opened;
        return ctx.bridge.observe();
    }
    if (!ctx.app && /^com\.nickmadaio\.orion/.test(o.bundleId))
        return { status: "ask", ask: "Which app should I do that in? My own window is the one in front right now." };
    return o;
}
export async function newDoc(ctx, clause, o0) {
    const b = o0.bundleId;
    const notes = b === "com.apple.Notes";
    const item = notes ? "New Note" : "New";
    const fp0 = fingerprint(o0);
    const changed = (o) => o.bundleId === b && fingerprint(o) !== fp0 && (o.windowTitle !== o0.windowTitle || editables(o).some((n) => !n.value));
    ctx.progress(notes ? "making a new note" : "making a new document");
    ctx.state.field = undefined;
    let done = await act(ctx, { action: "menu", target: `File > ${item}`, via: "menu" }, () => ctx.bridge.menu(b, ["File", item])) && await waitFor(ctx, changed);
    if (done)
        markVerified(ctx);
    else {
        done = await act(ctx, { action: "key", target: "cmd+n", via: "key" }, () => ctx.bridge.key(b, "cmd+n")) && await waitFor(ctx, changed);
        if (!done)
            return { status: "fail", why: `couldn't make a new ${notes ? "note" : "document"} (File > ${item} and ⌘N both did nothing)` };
        markVerified(ctx);
    }
    const what = notes ? "note" : "document";
    if (!clause.title)
        return { status: "ok", said: `made a new ${what}` };
    if (!notes)
        return { status: "ok", said: `made a new ${what} (it gets its name when it's saved, so it's still Untitled)` };
    const typed = await typeText(ctx, { kind: "type", text: clause.title }, await ctx.bridge.observe());
    return typed.status === "ok" ? { status: "ok", said: `made a new note called ${quote(clause.title)}` } : typed;
}
/** The field to type into: the one he named, the one the last step focused, or the only empty one. */
async function fieldFor(ctx, clause, nodes) {
    if (clause.into) {
        const found = await resolve(ctx, nodes, "editable", clause.into.words, clause.into.generic, clause.into.generic ? "a text box" : quote(clause.into.words));
        return isOutcome(found) ? found : found.node;
    }
    const remembered = ctx.state.field ? nodes.find((n) => n.path === ctx.state.field && inGroup(n, "editable")) : undefined;
    if (remembered)
        return remembered;
    const fields = nodes.filter((n) => inGroup(n, "editable"));
    const empty = fields.filter((n) => !n.value);
    if (fields.length === 1)
        return fields[0];
    return empty.length === 1 ? empty[0] : null;
}
export async function typeText(ctx, clause, o0) {
    const b = o0.bundleId;
    const text = clause.text;
    const field = await fieldFor(ctx, clause, flatten(o0.element));
    if (isOutcome(field))
        return field;
    ctx.progress(`typing ${quote(text, 30)}`);
    const contains = (o) => (field ? (valueAt(o, field.path) ?? "").includes(text) : false) || editables(o).some((n) => (n.value ?? "").includes(text));
    if (field) {
        ctx.state.field = field.path;
        const existing = field.value ?? "";
        const next = existing ? `${existing}${text}` : text;
        if (await act(ctx, { action: "set_value", target: nameOf(field) || field.role, value: text, via: "ax" }, () => ctx.bridge.setValue(b, ref(field), next))
            && await waitFor(ctx, contains, 4)) {
            markVerified(ctx);
            return { status: "ok", said: `typed ${quote(text)}` };
        }
    }
    if (await act(ctx, { action: "type", value: text, via: "type" }, () => ctx.bridge.type(b, text)) && await waitFor(ctx, contains, 4)) {
        markVerified(ctx);
        return { status: "ok", said: `typed ${quote(text)}` };
    }
    return { status: "fail", why: `couldn't type ${quote(text)}: the text never showed up in the field` };
}
export async function press(ctx, clause, o0, index) {
    const b = o0.bundleId;
    const nodes = flatten(o0.element);
    const { words, generic, group } = clause.target;
    const describe = generic ? (group === "editable" ? "a text box" : "a button") : quote(words);
    const found = await resolve(ctx, nodes, group, words, generic, describe);
    if (isOutcome(found))
        return found;
    const node = found.node;
    if (group === "editable") {
        // A click into a field is focus: reversible, and the next "type" goes there.
        ctx.progress("clicking into the text box");
        ctx.state.field = node.path;
        const clicked = node.center ? await act(ctx, { action: "click", target: nameOf(node) || "text box", via: "click" }, () => ctx.bridge.click(b, node.center.x, node.center.y)) : false;
        // No click landed? The next "type" still targets this field by its AX path, so say only what is true.
        return { status: "ok", said: clicked ? "clicked into the text box" : "found the text box" };
    }
    const label = nameOf(node) || node.role.replace(/^AX/, "");
    const confirmKey = `${index}:${label}`;
    const auth = authorizePress(label, ctx.words, { requested: true, generic, unique: found.unique, confirmed: ctx.confirmed.has(confirmKey) });
    if (!auth.ok)
        return { status: "ask", ask: auth.ask, confirmKey };
    ctx.progress(`pressing ${quote(label)}`);
    const before = new Set(visibleText(nodes));
    const fp0 = fingerprint(o0);
    const changed = (o) => fingerprint(o) !== fp0;
    let after = await act(ctx, { action: "press", target: label, via: "ax" }, () => ctx.bridge.press(b, ref(node))) ? await waitFor(ctx, changed, 4) : null;
    const pressed = ctx.state.log[ctx.state.log.length - 1]?.ok === true;
    if (after)
        markVerified(ctx);
    else if (classifyLabel(label) === "neutral" && node.center) {
        after = await act(ctx, { action: "click", target: label, via: "click" }, () => ctx.bridge.click(b, node.center.x, node.center.y)) ? await waitFor(ctx, changed, 4) : null;
        if (after)
            markVerified(ctx);
    }
    if (!after) {
        return pressed ? { status: "ok", said: `pressed ${quote(label)} (nothing on screen visibly changed)` } : { status: "fail", why: `couldn't press ${quote(label)}` };
    }
    const shows = visibleText(flatten(after.element)).filter((t) => !before.has(t)).slice(0, 3);
    return { status: "ok", said: `pressed ${quote(label)}${shows.length ? `, and it now shows ${shows.map((s) => quote(s, 80)).join("; ")}` : ""}` };
}
export async function menu(ctx, clause, o0, index) {
    const b = o0.bundleId;
    const [top, ...rest] = clause.path;
    let path = clause.path;
    if (rest.length === 1) {
        const items = await ctx.bridge.menuItems(b, top).catch(() => []);
        const best = items.map((t) => ({ t, s: similarity(rest[0], t) })).sort((x, y) => y.s - x.s)[0];
        if (best && best.s >= 0.5)
            path = [top, best.t];
    }
    const leaf = path[path.length - 1];
    const confirmKey = `${index}:${leaf}`;
    const auth = authorizePress(leaf, ctx.words, { requested: true, generic: false, unique: true, confirmed: ctx.confirmed.has(confirmKey) });
    if (!auth.ok)
        return { status: "ask", ask: auth.ask, confirmKey };
    ctx.progress(`choosing ${path.join(" > ")}`);
    const fp0 = fingerprint(o0);
    if (!await act(ctx, { action: "menu", target: path.join(" > "), via: "menu" }, () => ctx.bridge.menu(b, path))) {
        return { status: "fail", why: `couldn't find ${path.join(" > ")} in ${o0.appName}'s menus` };
    }
    if (await waitFor(ctx, (o) => fingerprint(o) !== fp0, 4))
        markVerified(ctx);
    return { status: "ok", said: `chose ${path.join(" > ")}` };
}
const tabsOf = (o) => flatten(o.element).filter((n) => n.parentRole === "AXTabGroup" && inGroup(n, "tab"));
async function closeOneTab(ctx, b, title) {
    const o = await ctx.bridge.observe();
    const nodes = flatten(o.element);
    const tab = tabsOf(o).find((t) => nameOf(t) === title);
    if (!tab)
        return false;
    const count = (x) => tabsOf(x).filter((t) => nameOf(t) === title).length;
    const before = count(o);
    const closeButton = nodes.find((n) => n.path.startsWith(`${tab.path}.`) && n.role === "AXButton" && /close/i.test(n.label ?? ""));
    if (closeButton && await act(ctx, { action: "press", target: `close ${title}`, via: "ax" }, () => ctx.bridge.press(b, ref(closeButton)))
        && await waitFor(ctx, (x) => count(x) < before, 4)) {
        markVerified(ctx);
        return true;
    }
    // Alternative: select the tab, then ⌘W.
    if (!await act(ctx, { action: "press", target: title, via: "ax" }, () => ctx.bridge.press(b, ref(tab))))
        return false;
    if (await act(ctx, { action: "key", target: "cmd+w", via: "key" }, () => ctx.bridge.key(b, "cmd+w")) && await waitFor(ctx, (x) => count(x) < before, 4)) {
        markVerified(ctx);
        return true;
    }
    return false;
}
export async function closeTabs(ctx, clause, o0, index) {
    const b = o0.bundleId;
    const tabs = tabsOf(o0).map(nameOf).filter(Boolean);
    if (tabs.length === 0)
        return { status: "fail", why: `couldn't see any tabs in ${o0.appName}` };
    const filter = clause.filter;
    const listing = tabs.slice(0, 12).map((t, i) => `${i + 1}. ${quote(t, 50)}`).join(", ");
    if (filter.mode === "ambiguous")
        return { status: "ask", ask: `Which ones count as ${filter.words}? Open tabs: ${listing}. Tell me which to close.` };
    if (filter.mode === "all") {
        ctx.progress(`closing all ${tabs.length} tabs`);
        if (await act(ctx, { action: "menu", target: "File > Close Window", via: "menu" }, () => ctx.bridge.menu(b, ["File", "Close Window"]))
            && await waitFor(ctx, (o) => tabsOf(o).length === 0 || o.bundleId !== b)) {
            markVerified(ctx);
            return { status: "ok", said: `closed all ${tabs.length} tabs` };
        }
        return { status: "fail", why: "couldn't close the window's tabs" };
    }
    const matches = (t) => similarity(filter.words, t) >= 0.5;
    const targets = tabs.filter((t) => (filter.mode === "keep" ? !matches(t) : matches(t)));
    if (targets.length === 0)
        return { status: "ok", said: `found no tabs to close (open: ${listing})` };
    const confirmKey = `${index}:tabs:${targets.length}`;
    if (filter.count !== undefined && filter.count !== targets.length && !ctx.confirmed.has(confirmKey)) {
        return { status: "ask", ask: `I count ${targets.length}, not ${filter.count}: ${targets.map((t) => quote(t, 40)).join(", ")}. Close those ${targets.length}?`, confirmKey };
    }
    const closed = [];
    const said = () => `closed ${closed.length} tab${closed.length === 1 ? "" : "s"}: ${closed.map((t) => quote(t, 40)).join(", ")}`;
    for (const title of targets) {
        ctx.progress(`closing ${quote(title, 30)}`);
        try {
            if (await closeOneTab(ctx, b, title))
                closed.push(title);
        }
        catch (error) {
            if (error instanceof StepCap)
                throw new StepCap(closed.length ? said() : undefined);
            throw error;
        }
    }
    if (closed.length < targets.length) {
        const missed = targets.filter((t) => !closed.includes(t));
        return { status: "fail", why: `${closed.length ? `${said()}, but ` : ""}couldn't close ${missed.map((t) => quote(t, 40)).join(", ")}` };
    }
    return { status: "ok", said: said() };
}
export async function closeWindow(ctx, clause, o0, index) {
    const b = o0.bundleId;
    const title0 = o0.windowTitle;
    const gone = (o) => o.bundleId !== b || !o.element || o.windowTitle !== title0;
    const sheetButtons = (o) => {
        const nodes = flatten(o.element);
        const sheets = nodes.filter((n) => n.role === "AXSheet" || n.role === "AXDialog" || n.subrole === "AXDialog");
        return nodes.filter((n) => n.role === "AXButton" && sheets.some((s) => n.path.startsWith(`${s.path}.`)));
    };
    const settled = (o) => gone(o) || sheetButtons(o).length > 0;
    ctx.progress(clause.discard ? "closing it without saving" : "closing the window");
    let after = await act(ctx, { action: "menu", target: "File > Close", via: "menu" }, () => ctx.bridge.menu(b, ["File", "Close"])) ? await waitFor(ctx, settled) : null;
    if (!after)
        after = await act(ctx, { action: "key", target: "cmd+w", via: "key" }, () => ctx.bridge.key(b, "cmd+w")) ? await waitFor(ctx, settled) : null;
    if (!after)
        return { status: "fail", why: "couldn't close it" };
    markVerified(ctx);
    if (gone(after))
        return { status: "ok", said: clause.discard ? "closed it without saving" : "closed it" };
    const buttons = sheetButtons(after);
    const labels = buttons.map(nameOf).filter(Boolean);
    const discard = buttons.find((n) => /don['’]?t save|delete|discard/i.test(nameOf(n)));
    if (!clause.discard || !discard) {
        return { status: "ask", ask: `It wants to know what to do with ${quote(title0 ?? "the document")} before closing: ${labels.map((l) => quote(l)).join(", ")}. Which?` };
    }
    const label = nameOf(discard);
    const confirmKey = `${index}:${label}`;
    const auth = authorizePress(label, ctx.words, { requested: true, generic: false, unique: true, confirmed: ctx.confirmed.has(confirmKey) });
    if (!auth.ok)
        return { status: "ask", ask: auth.ask, confirmKey };
    ctx.progress(`pressing ${quote(label)}`);
    if (await act(ctx, { action: "press", target: label, via: "ax" }, () => ctx.bridge.press(b, ref(discard))) && await waitFor(ctx, gone)) {
        markVerified(ctx);
        return { status: "ok", said: "closed it without saving" };
    }
    return { status: "fail", why: `couldn't press ${quote(label)} on the save sheet` };
}
export async function focusWindow(ctx, clause, o0) {
    const b = o0.bundleId;
    const items = await ctx.bridge.menuItems(b, "Window").catch(() => []);
    const best = items.map((t) => ({ t, s: similarity(clause.title, t) })).sort((x, y) => y.s - x.s)[0];
    if (!best || best.s < 0.5)
        return { status: "fail", why: `couldn't find a ${quote(clause.title)} window in ${o0.appName}` };
    ctx.progress(`switching to ${quote(best.t, 30)}`);
    if (!await act(ctx, { action: "menu", target: `Window > ${best.t}`, via: "menu" }, () => ctx.bridge.menu(b, ["Window", best.t]))) {
        return { status: "fail", why: `couldn't switch to ${quote(best.t)}` };
    }
    if (await waitFor(ctx, (o) => similarity(clause.title, o.windowTitle ?? "") >= 0.5))
        markVerified(ctx);
    return { status: "ok", said: `switched to ${quote(best.t)}` };
}
export async function scroll(ctx, clause, o0) {
    const b = o0.bundleId;
    const area = flatten(o0.element).find((n) => inGroup(n, "scrollable"));
    const fp0 = fingerprint(o0);
    ctx.progress(`scrolling ${clause.direction}`);
    const axAction = clause.direction === "down" ? "AXScrollDownByPage" : "AXScrollUpByPage";
    if (area && await act(ctx, { action: "scroll", target: area.role, via: "ax" }, () => ctx.bridge.press(b, ref(area), axAction))
        && await waitFor(ctx, (o) => fingerprint(o) !== fp0, 3)) {
        markVerified(ctx);
        return { status: "ok", said: `scrolled ${clause.direction}` };
    }
    const key = clause.direction === "down" ? "pagedown" : "pageup";
    if (await act(ctx, { action: "key", target: key, via: "key" }, () => ctx.bridge.key(b, key))) {
        if (await waitFor(ctx, (o) => fingerprint(o) !== fp0, 3))
            markVerified(ctx);
        return { status: "ok", said: `scrolled ${clause.direction}` };
    }
    return { status: "fail", why: `couldn't scroll ${clause.direction}` };
}
/** Reads back the field the last step typed into (or the first one with text). Not an action: no step is spent. */
export function readBack(ctx, o) {
    const nodes = flatten(o.element);
    const field = (ctx.state.field ? nodes.find((n) => n.path === ctx.state.field) : undefined) ?? nodes.find((n) => inGroup(n, "editable") && n.value);
    const value = field?.value ?? "";
    ctx.state.log.push({ n: ctx.state.used, action: "read_back", via: "observe", ok: true, verified: true, note: JSON.stringify(value.slice(0, 200)) });
    return value ? { status: "ok", said: `read it back (it says ${quote(value, 120)})` } : { status: "fail", why: "couldn't read anything back: the field is empty" };
}
