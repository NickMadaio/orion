// Is this check-in about GOING to a real class? (2026-10-16 audit, finding 12.) The old rule was the regex
// /(class|lecture|seminar|lab|macro|marketing|ECON1115|MKTG2201)/ on the check-in text, which silently
// cancelled "start studying for macro" and "finish the DS lab write-up". A calendar class is self-timed;
// only a check-in that names one of today's real class events (code or full title) and is not about working
// on something is the calendar's business.
const WORKING = /\b(study|studying|revise|revising|prep|prepare|finish|write|writing|review|practi[sc]e|homework|work on|working on|read|reading|assignment|essay)\b/i;
const strip = (t) => String(t).replace(/ — .*$/, "").trim();

export function isClassAttendanceCheckin(what, classes) {
  const w = String(what).toLowerCase();
  if (WORKING.test(w)) return false;
  return classes.some((c) => {
    const title = strip(c.title);
    const code = /\b[A-Za-z]{2,4}\d{3,4}\b/.exec(title)?.[0]?.toLowerCase();
    const name = title.replace(/^[A-Za-z]{2,4}\d{3,4}\s+/, "").toLowerCase();
    return (code && w.includes(code)) || (name.length >= 8 && w.includes(name));
  });
}
