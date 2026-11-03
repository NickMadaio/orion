// game-prep (w18 gamemode): when a game is running, close what the game does not need, unload ORION's idle models, record it.
// Kept: the game and its launcher/runtime (its process tree, its parents, and for Minecraft anything Java or a Minecraft launcher), the user's keep
// list (Discord, music, voice and call apps by default), ORION, Ollama and the Finder (policy.keptReason's never list), terminals and editors,
// and call/recording apps. Everything else closes through the same escalation as quit-unused, so an app showing a save prompt is left open
// and reported, never killed. Other launchers (Epic, Steam, Battle.net) close unless they are the running game's own.
import { closeApp } from "./escalate.mjs";
import { freedText, loadConfig, loadSession, updateSession } from "./gameconfig.mjs";
import { unloadIdleModels } from "./ollama.mjs";
import { keptReason, matchApps, unusedWhy } from "./policy.mjs";

const MINECRAFT = /minecraft|mojang|\bjava\b|openjdk|temurin|zulu|prism ?launcher|multimc|atlauncher|modrinth|curseforge/i;
const MINECRAFT_GAME = /minecraft|mojang|\bjava\b/i;   // a Java game is Minecraft: the classifier only calls a java process a game for a Minecraft window
const text = (a) => `${a.name} ${a.bundleId} ${a.path ?? ""}`;
const list = (xs) => (xs.length < 3 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** { gameFound, game: [apps], close: [apps], kept: [{ name, why }] }. Pure over the snapshot and the source's tree/lineage. */
export function planGamePrep(apps, { game, keep = [], src }) {
  const gameApps = game ? matchApps(game, apps) : [];
  const minecraft = MINECRAFT_GAME.test(game ?? "") || gameApps.some((a) => MINECRAFT_GAME.test(text(a)));
  if (!gameApps.length) return { gameFound: false, game: [], close: [], kept: [] };
  const family = minecraft ? apps.filter((a) => MINECRAFT.test(text(a))) : [];
  const core = [...new Map([...gameApps, ...family].map((a) => [a.pid, a])).values()];
  const protectedPids = new Set(core.map((a) => a.pid));
  for (const a of core) {
    src.tree(a).forEach((p) => protectedPids.add(p.pid));
    (src.lineage?.(a) ?? []).forEach((pid) => protectedPids.add(pid));
  }
  const plan = apps.map((a) => {
    if (protectedPids.has(a.pid)) return { app: a, kept: a.pid === gameApps[0]?.pid ? "the game itself" : "the game or its launcher and runtime" };
    // frontmost is dropped: someone tabbed out to ask for this, and the app in front is not the game
    return { app: a, kept: keptReason({ ...a, frontmost: false }, { keep, all: true }) };
  });
  return { gameFound: true, game: gameApps, close: plan.filter((p) => !p.kept).map((p) => p.app),
    kept: plan.filter((p) => p.kept).map((p) => ({ name: p.app.name, why: p.kept })) };
}

const asking = (r) => ({ name: r.name, why: r.state === "asking_to_save" ? "asking to save" : r.state === "left_alone" ? "this chat runs from it" : "wouldn't quit" });

function headlineOf({ closed, helperCount, reported, unloaded, freedBytes }) {
  const bits = [];
  const things = [...closed.map((c) => c.name).sort(), ...(helperCount ? [plural(helperCount, "helper")] : [])];
  if (things.length) bits.push(`closed ${list(things)}`);
  if (unloaded.length) bits.push(`${bits.length ? "unloaded" : "unloaded"} ${plural(unloaded.length, "idle model")}`);
  let line = bits.join(", ");
  if (freedBytes >= 5e7) line += `${line ? ", " : ""}freed ${freedText(freedBytes)}`;
  if (!line) line = "nothing needed closing";
  if (reported.length) line += `; left ${list(reported.map((r) => r.name))} open (${[...new Set(reported.map((r) => r.why))].join(", ")})`;
  return line;
}

/** Runs the prep. `ollama` is { fetch, host } or null (skip the unload). Never throws on a missing game: it says so. */
export async function gamePrep(src, { game, keep, dir, dryRun = false, ollama = {}, ...opts }) {
  const config = loadConfig(dir);
  const session = loadSession(dir);
  const target = game ?? session?.game?.key ?? session?.game?.bundleId ?? session?.game?.name;
  if (!target) return { ok: true, dryRun, closed: [], say: "No game is running right now, so there's nothing to prep. I'll do it the moment one opens." };
  const apps = src.snapshot();
  const plan = planGamePrep(apps, { game: target, keep: keep ?? config.keep, src });
  if (!plan.gameFound) return { ok: false, dryRun, closed: [], error: `${target} isn't running`, say: `I can't see ${target} running, so I haven't closed anything.` };
  const models = ollama ? await unloadIdleModels({ ...ollama, dryRun }) : { unloaded: [], freedBytes: 0 };
  const keptSay = plan.kept.length ? ` Keeping ${list(plan.kept.map((k) => k.name))}.` : "";
  if (dryRun) {
    const would = plan.close.map((a) => ({ name: a.name, why: unusedWhy(a) }));
    const modelsSay = models.unloaded.length ? ` Would unload ${list(models.unloaded.map((m) => m.name))}.` : "";
    return { ok: true, dryRun: true, game: plan.game[0].name, closed: [], would, kept: plan.kept, unloaded: models.unloaded,
      say: `${would.length ? `I would close ${list(would.map((w) => `${w.name} (${w.why})`))}.` : "I would close nothing."}${modelsSay}${keptSay}` };
  }
  const memory = new Map(plan.close.map((a) => [a.pid, src.memoryKB?.(a) ?? 0]));
  const results = await Promise.all(plan.close.map((a) => closeApp(a, src, opts)));
  const done = results.filter((r) => r.state === "closed");
  const byName = new Map(plan.close.map((a) => [a.name, a]));
  const closed = done.map((r) => { const a = byName.get(r.name); return { name: r.name, bundleId: a.bundleId, path: a.path, kind: a.kind, helpers: r.helpers }; })
    .sort((x, y) => x.name.localeCompare(y.name));
  const helperCount = done.reduce((n, r) => n + (r.helperProcs ?? r.helpers.length), 0);
  const reported = results.filter((r) => ["asking_to_save", "still_open", "left_alone"].includes(r.state)).map(asking);
  const closedBytes = done.reduce((n, r) => n + (memory.get(byName.get(r.name).pid) ?? 0) * 1024, 0);
  const freedBytes = closedBytes + models.freedBytes;
  const prep = { at: new Date().toISOString(), closed, helperCount, reported, unloaded: models.unloaded, freedBytes, kept: plan.kept };
  const headline = headlineOf(prep);
  updateSession(dir, (s) => ({ ...s, version: 1, game: s.game ?? { name: plan.game[0].name, bundleId: plan.game[0].bundleId }, prep: { ...prep, headline } }));
  return { ok: true, dryRun: false, game: plan.game[0].name, closed, helperCount, reported, unloaded: models.unloaded, freedBytes, kept: plan.kept, headline,
    say: `Game mode: ${headline}.${keptSay}` };
}
