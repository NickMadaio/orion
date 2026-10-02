import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const PRICES = {
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: .1, cacheWrite: 1.25 },
  'claude-sonnet-5': { input: 3, output: 15, cacheRead: .3, cacheWrite: 3.75 },
};
export const priceSources = ['https://www.anthropic.com/claude/haiku', 'https://www.anthropic.com/research/claude-sonnet-5', 'https://platform.claude.com/docs/en/build-with-claude/prompt-caching'];
const blank = () => ({ calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, recordedCost: 0, currentRateEquivalent: 0, unpricedCloudCalls: 0, unknownRateCalls: 0 });
const positive = value => Number.isFinite(value) && value >= 0 ? value : 0;
export function currentPrice(model) {
  if (model.startsWith('ollama/')) return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const id = model.replace(/^anthropic\//, '');
  return PRICES[id] ?? (id.startsWith('claude-haiku-4-5-') ? PRICES['claude-haiku-4-5'] : null);
}
export function summarizeUsage(entries, { now = Date.now(), days = null, timezone = 'Europe/London' } = {}) {
  const totals = blank(), byModel = {}, byDay = {}, byLane = {}, seen = new Set();
  let skipped = 0, duplicates = 0, firstAt = null, lastAt = null;
  const civil = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  // Calendar days in Nick's home timezone, rather than a moving 24-hour window.
  const today = civil.format(new Date(now));
  const cutoff = days == null ? null : new Date(Date.parse(today + 'T12:00:00Z') - (days - 1) * 86400000).toISOString().slice(0, 10);
  for (const { entry, session = '' } of entries) {
    const message = entry?.message, usage = message?.usage;
    if (!usage) continue;
    const at = Date.parse(entry.timestamp);
    if (!Number.isFinite(at) || at > now) { skipped++; continue; }
    const day = civil.format(new Date(at));
    if (cutoff && day < cutoff) continue;
    const fingerprint = createHash('sha256').update(JSON.stringify(entry)).digest('hex');
    if (seen.has(fingerprint)) { duplicates++; continue; } seen.add(fingerprint);
    const model = `${message.provider ?? 'unknown'}/${message.model ?? 'unknown'}`;
    const lane = /eval|bench/i.test(session) ? 'evaluation' : /project|worker|reviewer/i.test(session) ? 'agentic' : 'conversation-and-other';
    const values = blank(); values.calls = 1;
    for (const k of ['input', 'output', 'cacheRead', 'cacheWrite']) values[k] = positive(usage[k]);
    values.totalTokens = positive(usage.totalTokens) || values.input + values.output + values.cacheRead + values.cacheWrite;
    values.recordedCost = positive(usage.cost?.total);
    const price = currentPrice(model);
    if (price) for (const k of ['input', 'output', 'cacheRead', 'cacheWrite']) values.currentRateEquivalent += values[k] * price[k] / 1e6;
    else values.unknownRateCalls = 1;
    if (!model.startsWith('ollama/') && values.recordedCost === 0) values.unpricedCloudCalls = 1;
    for (const target of [totals, byModel[model] ??= blank(), byDay[day] ??= blank(), byLane[lane] ??= blank()]) for (const k of Object.keys(values)) target[k] += values[k];
    firstAt = firstAt == null ? at : Math.min(firstAt, at); lastAt = Math.max(lastAt ?? at, at);
  }
  return { totals, byModel, byDay, byLane, firstAt, lastAt, skipped, duplicates };
}
export function readUsage(home) {
  const root = join(home, '.openclaw/agents/main'), entries = []; let unreadable = 0;
  const indexFile = join(root, 'sessions/sessions.json');
  let names = {}; try { for (const [key, value] of Object.entries(JSON.parse(readFileSync(indexFile, 'utf8')))) if (value.sessionFile) names[value.sessionFile.split('/').at(-1)] = key; } catch {}
  for (const dir of ['sessions', 'sessions-archive']) {
    const folder = join(root, dir); if (!existsSync(folder)) continue;
    for (const file of readdirSync(folder).filter(x => x.endsWith('.jsonl'))) {
      let text; try { text = readFileSync(join(folder, file), 'utf8'); } catch { unreadable++; continue; }
      for (const line of text.split('\n')) {
        if (!line.includes('"usage"')) continue;
        try { entries.push({ entry: JSON.parse(line), session: names[file] ?? file }); } catch { unreadable++; }
      }
    }
  }
  return { entries, unreadable };
}
