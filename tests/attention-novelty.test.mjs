import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { noveltyOf } from '../scripts/lib/attention/novelty.mjs';

const now = Date.now();
const sevenDaysAgo = now - 7 * 86_400_000;
const eightDaysAgo = now - 8 * 86_400_000;

test('never surfaced is fully novel', () => {
  assert.equal(noveltyOf('key1', [], now), 1);
});

test('each repeat lowers novelty', () => {
  // 1 matching entry -> 0.6
  const history1 = [{ dedupKey: 'key1', surfacedAt: now - 1_000 }];
  assert.equal(noveltyOf('key1', history1, now), 0.6);

  // 2 matching entries -> 0.35
  const history2 = [
    { dedupKey: 'key1', surfacedAt: now - 1_000 },
    { dedupKey: 'key1', surfacedAt: now - 2_000 },
  ];
  assert.equal(noveltyOf('key1', history2, now), 0.35);

  // 3 matching entries -> 0.1
  const history3 = [
    { dedupKey: 'key1', surfacedAt: now - 1_000 },
    { dedupKey: 'key1', surfacedAt: now - 2_000 },
    { dedupKey: 'key1', surfacedAt: now - 3_000 },
  ];
  assert.equal(noveltyOf('key1', history3, now), 0.1);

  // 5 matching entries -> 0.1
  const history5 = [
    { dedupKey: 'key1', surfacedAt: now - 1_000 },
    { dedupKey: 'key1', surfacedAt: now - 2_000 },
    { dedupKey: 'key1', surfacedAt: now - 3_000 },
    { dedupKey: 'key1', surfacedAt: now - 4_000 },
    { dedupKey: 'key1', surfacedAt: now - 5_000 },
  ];
  assert.equal(noveltyOf('key1', history5, now), 0.1);
});

test('other keys and old surfacings do not count', () => {
  const history = [
    { dedupKey: 'other-key', surfacedAt: now - 1_000 }, // different key
    { dedupKey: 'key1', surfacedAt: eightDaysAgo },     // too old (8 days)
    { dedupKey: 'key1', surfacedAt: now + 1_000 },      // in the future
  ];
  
  // None of these should count for 'key1' within the last 7 days ending at 'now'
  assert.equal(noveltyOf('key1', history, now), 1);
});

test('malformed entries are skipped', () => {
  const history = [
    null,                          // not an object
    { dedupKey: 3 },              // dedupKey is not a string
    { dedupKey: 'k' },            // missing surfacedAt
    { dedupKey: 'key1', surfacedAt: now - 1_000 }, // valid entry for key1
  ];

  // Only the last entry counts. Count = 1 -> novelty 0.6
  assert.equal(noveltyOf('key1', history, now), 0.6);
});
