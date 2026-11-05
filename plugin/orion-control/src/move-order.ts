/*
 Several moves in one message ("move leetcode to 2pm and push the learning plan back an hour") are planned together before any is written
 (w20 round 3, gate #2): the first one was written into the slot the second still held, and the second then failed on the overlap.
 Pure: each move is the block's current span and the span it is going to. A move whose destination overlaps a block that has yet to move away
 waits for it; destinations that overlap each other cannot both happen, and nothing is written.
*/
export type Mover = { current: readonly [number, number]; next: readonly [number, number] };

const overlap = (a: readonly [number, number], b: readonly [number, number]): number => Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));

/** Where two destinations land on each other: the pair and the minutes they share, or undefined. */
export function collision(movers: readonly Mover[]): { a: number; b: number; minutes: number; from: number; to: number } | undefined {
  for (let a = 0; a < movers.length; a += 1) {
    for (let b = a + 1; b < movers.length; b += 1) {
      const minutes = overlap(movers[a]!.next, movers[b]!.next);
      if (minutes > 0) return { a, b, minutes, from: Math.max(movers[a]!.next[0], movers[b]!.next[0]), to: Math.min(movers[a]!.next[1], movers[b]!.next[1]) };
    }
  }
  return undefined;
}

/** The order to write them in: a move goes after the blocks that sit where it is going have gone. Said order breaks every tie. */
export function writeOrder(movers: readonly Mover[]): number[] {
  const left = movers.map((_, i) => i); const order: number[] = [];
  while (left.length) {
    const ready = left.find((i) => left.every((j) => j === i || overlap(movers[i]!.next, movers[j]!.current) === 0));
    const pick = ready ?? left[0]!;
    order.push(pick); left.splice(left.indexOf(pick), 1);
  }
  return order;
}
