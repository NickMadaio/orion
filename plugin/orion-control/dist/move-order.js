const overlap = (a, b) => Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));
/** Where two destinations land on each other: the pair and the minutes they share, or undefined. */
export function collision(movers) {
    for (let a = 0; a < movers.length; a += 1) {
        for (let b = a + 1; b < movers.length; b += 1) {
            const minutes = overlap(movers[a].next, movers[b].next);
            if (minutes > 0)
                return { a, b, minutes, from: Math.max(movers[a].next[0], movers[b].next[0]), to: Math.min(movers[a].next[1], movers[b].next[1]) };
        }
    }
    return undefined;
}
/** The order to write them in: a move goes after the blocks that sit where it is going have gone. Said order breaks every tie. */
export function writeOrder(movers) {
    const left = movers.map((_, i) => i);
    const order = [];
    while (left.length) {
        const ready = left.find((i) => left.every((j) => j === i || overlap(movers[i].next, movers[j].current) === 0));
        const pick = ready ?? left[0];
        order.push(pick);
        left.splice(left.indexOf(pick), 1);
    }
    return order;
}
