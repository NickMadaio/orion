const toMin = (t) => { const [h, m] = t.split(":").map(Number); return (h ?? 0) * 60 + (m ?? 0); };
/** The nap's guessed span (minutes today): `length` long, ending now unless a fixed plan covers that time. */
export function napWindow(blocks, now, length, earliest = 240) {
    const walls = blocks.filter((b) => b.fixed && b.kind !== "commute");
    let to = now;
    let before;
    for (;;) {
        const hit = walls.find((w) => toMin(w.start) < to && to - length < toMin(w.end) && toMin(w.start) < now);
        if (!hit)
            break;
        before = hit;
        to = toMin(hit.start);
        if (to - length < earliest)
            break;
    }
    return { from: Math.max(earliest, to - length), to, ...(before ? { before } : {}) };
}
