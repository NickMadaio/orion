// The orion-mouse subcommands as functions: each returns { ok, say, ...} (or { ok, asking, ask, say } when a piece is missing).
import { actionLabel, appNameOf, buttonLabel, parseAction, parseButton, resolveApp } from "./names.mjs";
import { changeBindings, readBindings, readDevices, requestSetupPopup } from "./store.mjs";

const ASK = {
  button: "Which button, the front or the back side button?",
  action: "What should it do? For example Stage Manager, Mission Control, the left desktop, or a screenshot.",
};
const ask = (what, extra = {}) => ({ ok: true, asking: true, ask: what, say: ASK[what], ...extra });
const fail = (error) => ({ ok: false, error, say: `${error[0].toUpperCase()}${error.slice(1)}${/[.!?]$/.test(error) ? "" : "."}` });
const where = (app) => (app ? ` in ${app.name}` : "");
const offNote = (b) => (b.enabled ? "" : " Mouse remapping is switched off in settings, so it won't act until it's on.");

function resolveTarget(buttonText, devices) {
  const b = parseButton(buttonText);
  if (b.ask) return { ask: "button" };
  if (b.error) return { error: b.error };
  const known = devices.flatMap((d) => d.extraButtons ?? []);
  if (known.length && !known.includes(b.n)) {
    return { error: `this mouse doesn't report a ${buttonLabel(b.n)}; its extra buttons are ${known.map(buttonLabel).join(", ")}` };
  }
  return { n: b.n };
}

function resolveAppOpt(appText, opts) {
  if (appText === undefined) return {};
  const app = resolveApp(appText, opts);
  return app.error ? { error: app.error } : { app };
}

/** `set <button> <action> [--app X]`. */
export function setBinding({ button, action, app: appText }, { env = process.env, lookup } = {}) {
  const opts = lookup ? { lookup } : {};
  const target = resolveTarget(button, readDevices(env));
  if (target.error) return fail(target.error);
  const act = parseAction(action);
  if (act.error) return fail(act.error);
  if (target.ask || act.ask) {
    return ask(target.ask ?? "action", { ...(target.n !== undefined ? { button: target.n } : {}), ...(act.action ? { action: act.action } : {}) });
  }
  let action2 = act.action, label = act.label;
  if (act.app) {
    const opened = resolveApp(act.app, opts);
    if (opened.error) return fail(opened.error);
    action2 = { kind: "openApp", bundleId: opened.bundleId };
    label = `open ${opened.name}`;
  }
  const scope = resolveAppOpt(appText, opts);
  if (scope.error) return fail(scope.error);
  const key = String(target.n);
  const { after } = changeBindings((b) => scope.app
    ? { ...b, apps: { ...b.apps, [scope.app.bundleId]: { ...(b.apps[scope.app.bundleId] ?? {}), [key]: action2 } } }
    : { ...b, default: { ...b.default, [key]: action2 } }, env);
  return { ok: true, button: target.n, action: action2, ...(scope.app ? { app: scope.app.bundleId } : {}),
    say: `Done: the ${buttonLabel(target.n)} now ${label.startsWith("open ") ? `opens ${label.slice(5)}` : `does ${label}`}${where(scope.app)}.${offNote(after)}` };
}

/** `clear <button> [--app X]`: back to its normal behavior. */
export function clearBinding({ button, app: appText }, { env = process.env, lookup } = {}) {
  const target = resolveTarget(button, readDevices(env));
  if (target.error) return fail(target.error);
  if (target.ask) return ask("button");
  const scope = resolveAppOpt(appText, lookup ? { lookup } : {});
  if (scope.error) return fail(scope.error);
  const key = String(target.n);
  const { before } = changeBindings((b) => {
    if (!scope.app) { const { [key]: _gone, ...rest } = b.default; return { ...b, default: rest }; }
    const { [key]: _gone, ...rest } = b.apps[scope.app.bundleId] ?? {};
    const { [scope.app.bundleId]: _app, ...others } = b.apps;
    return { ...b, apps: Object.keys(rest).length ? { ...others, [scope.app.bundleId]: rest } : others };
  }, env);
  const had = scope.app ? before.apps[scope.app.bundleId]?.[key] : before.default[key];
  return { ok: true, button: target.n, cleared: !!had, say: had
    ? `Okay, the ${buttonLabel(target.n)} is back to normal${where(scope.app)}.`
    : `The ${buttonLabel(target.n)} wasn't set to anything${where(scope.app)}, so nothing changed.` };
}

/** `passthrough add|remove <app>`: the app where the buttons are left alone. */
export function passthrough({ op, app: appText }, { env = process.env, lookup } = {}) {
  if (op !== "add" && op !== "remove") return fail("passthrough takes add or remove");
  const app = resolveApp(appText, lookup ? { lookup } : {});
  if (app.error) return fail(app.error);
  const { before } = changeBindings((b) => ({ ...b, passthroughApps: op === "add"
    ? [...new Set([...b.passthroughApps, app.bundleId])] : b.passthroughApps.filter((id) => id !== app.bundleId) }), env);
  const was = before.passthroughApps.includes(app.bundleId);
  if (op === "add") return { ok: true, app: app.bundleId, say: was ? `The mouse buttons were already left alone in ${app.name}.` : `Done: the mouse buttons won't do anything in ${app.name}.` };
  return { ok: true, app: app.bundleId, say: was ? `Done: the mouse buttons work in ${app.name} again.` : `${app.name} wasn't on the leave-alone list, so nothing changed.` };
}

/** `games on|off`: automatic leave-alone for games. */
export function games({ state }, { env = process.env } = {}) {
  if (state !== "on" && state !== "off") return fail("games takes on or off");
  changeBindings((b) => ({ ...b, autoPassthroughGames: state === "on" }), env);
  return { ok: true, autoPassthroughGames: state === "on", say: state === "on"
    ? "Done: the mouse buttons are left alone in games automatically."
    : "Done: I won't leave the mouse alone in games automatically any more; only the apps on your list." };
}

const joinList = (items) => (items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : items[0] ?? "");
const suggestMap = (map) => Object.entries(map).sort(([a], [b]) => a - b).map(([k, a]) => `the ${buttonLabel(Number(k))} on ${actionLabel(a, appNameOf)}`);
const describeMap = (map) => Object.entries(map).sort(([a], [b]) => a - b).map(([k, a]) => `${buttonLabel(Number(k))}: ${actionLabel(a, appNameOf)}`);

/** `status`: the devices and what the buttons do. */
export function status({ env = process.env } = {}) {
  const devices = readDevices(env);
  let bindings;
  try { bindings = readBindings(env); } catch (e) { return fail(String(e.message ?? e)); }
  const lines = [];
  if (!devices.length) lines.push("I haven't seen a mouse with extra buttons yet.");
  for (const d of devices) {
    const extras = (d.extraButtons ?? []).map(buttonLabel);
    lines.push(`${d.name ?? "A mouse"} (${d.transport ?? "unknown"}${d.connected ? ", connected" : ", not connected"}): ${extras.length ? `extra buttons are ${joinList(extras)}` : "no extra buttons seen yet"}.`);
  }
  const def = describeMap(bindings.default);
  lines.push(def.length ? `The buttons do this: ${def.join("; ")}.` : "No button is set to anything yet.");
  for (const [id, map] of Object.entries(bindings.apps)) lines.push(`In ${appNameOf(id)}: ${describeMap(map).join("; ")}.`);
  if (bindings.passthroughApps.length) lines.push(`Left alone in: ${joinList(bindings.passthroughApps.map(appNameOf))}.`);
  lines.push(`Games are ${bindings.autoPassthroughGames ? "left alone automatically" : "not left alone automatically"}.`);
  if (!bindings.enabled) lines.push("Mouse remapping is switched off in settings.");
  return { ok: true, devices, bindings, say: lines.join(" ") };
}

const SUGGESTED = { 3: { kind: "system", name: "missionControl" }, 4: { kind: "system", name: "stageManager" } };

export const SETUP_SAY = "Okay, let me help. Tell me what you want the buttons to do, or set them here:";

/** `setup`: opens the Mac's mouse-setup popup (one record in outreach.jsonl) and says SETUP_SAY. */
export function openSetup({ env = process.env, again = false } = {}) {
  const req = requestSetupPopup({ env });
  return { ok: true, popup: req.written, ...(req.row ? { record: req.row } : {}), say: again ? "Here it is." : SETUP_SAY };
}

/** `setup --suggest [--apply]`: list the extra buttons and suggest defaults (front side: Stage Manager, back side: Mission Control); --apply writes them. */
export function setup({ apply = false }, { env = process.env } = {}) {
  const devices = readDevices(env);
  const extras = [...new Set(devices.flatMap((d) => d.extraButtons ?? []))].sort((a, b) => a - b);
  if (!extras.length) return { ok: true, extras, say: "I haven't seen any extra buttons on a mouse yet. Press one and I'll pick it up." };
  const bindings = readBindings(env);
  const proposal = Object.fromEntries(Object.entries(SUGGESTED).filter(([k]) => extras.includes(Number(k)) && !bindings.default[k]));
  const name = devices.find((d) => d.name)?.name ?? "your mouse";
  if (apply) {
    if (!Object.keys(proposal).length) return { ok: true, applied: [], say: "Those buttons are already set, so I left them." };
    changeBindings((b) => ({ ...b, default: { ...b.default, ...proposal } }), env);
    return { ok: true, applied: Object.keys(proposal).map(Number), say: `Done: ${joinList(suggestMap(proposal))}. Tell me if you want any changed.` };
  }
  const list = `${name} has ${extras.length} extra button${extras.length > 1 ? "s" : ""}: ${joinList(extras.map(buttonLabel))}.`;
  const rest = extras.filter((n) => !SUGGESTED[n]);
  const suggest = Object.keys(proposal).length ? ` I'd put ${joinList(suggestMap(proposal))}${rest.length ? `, and leave ${joinList(rest.map(buttonLabel))} alone for now` : ""}. Want that?` : " They're already set up.";
  return { ok: true, extras, proposal, asking: !!Object.keys(proposal).length, say: `${list}${suggest}` };
}
