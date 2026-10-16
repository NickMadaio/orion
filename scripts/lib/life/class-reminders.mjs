export function classCampus(title) {
  if (/macro|ECON1115|marketing|MKTG2201/i.test(title)) return 'Devon House';
  if (/\b(?:DS|CS)\d*\b|data science|discrete|computer science/i.test(title)) return 'Portsoken';
  return null;
}
export const realClasses = blocks => blocks.filter(b => b.kind === 'class' && b.fixed && b.source !== 'orion' && !/^\s*(cancell?ed|canceled)\b/i.test(String(b.title ?? '')));
export function inClass(blocks, now) { return realClasses(blocks).some(b => b.start <= now && now < b.end); }
export function classReminders(blocks, {now, sent = []}) {
  return realClasses(blocks).filter(b => now >= b.start - 10 && now < b.start && !sent.includes(b.id))
    .map(b => ({id:b.id, text:`${b.title} starts in ${b.start-now} minutes${classCampus(b.title) ? ` at ${classCampus(b.title)}` : ''}.`}));
}
