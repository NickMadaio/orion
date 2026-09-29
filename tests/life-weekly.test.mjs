import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { blocksForDate } from '../scripts/lib/life/weekly.mjs';

// Fixture: Monday 2026-09-28 has entries at 540–630 and 660–750; Tuesday has 810–900.
const MONDAY = '2026-09-28'; // ISO weekday 1
const TUESDAY = '2026-09-29'; // ISO weekday 2

const template = {
  from: '2026-09-28',
  until: '2026-12-11',
  skip: ['2026-11-02'],
  entries: [
    { id: 'cs2100-lecture', title: 'CS2100 Lecture', kind: 'class', weekday: 1, start: 540, end: 630 },
    { id: 'math101-tutorial', title: 'Math101 Tutorial', kind: 'class', weekday: 1, start: 660, end: 750 },
    { id: 'cs2100-lab', title: 'CS2100 Lab', kind: 'class', weekday: 2, start: 810, end: 900 },
  ],
};

describe('life-weekly', () => {
  it('monday gets monday\'s classes in order', () => {
    const blocks = blocksForDate(template, MONDAY);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].id, 'cs2100-lecture-2026-09-28');
    assert.equal(blocks[0].start, 540);
    assert.equal(blocks[1].id, 'math101-tutorial-2026-09-28');
    assert.equal(blocks[1].start, 660);
  });

  it('a later monday repeats', () => {
    // 2026-10-05 is a Monday
    const blocks = blocksForDate(template, '2026-10-05');
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].id, 'cs2100-lecture-2026-10-05');
    assert.equal(blocks[1].id, 'math101-tutorial-2026-10-05');
  });

  it('tuesday gets only tuesday', () => {
    const blocks = blocksForDate(template, TUESDAY);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].id, 'cs2100-lab-2026-09-29');
  });

  it('outside the term is empty', () => {
    // 2026-12-14 is after until: 2026-12-11
    const blocks = blocksForDate(template, '2026-12-14');
    assert.equal(blocks.length, 0);
  });

  it('a skipped date is empty', () => {
    // 2026-11-02 is in skip list
    const blocks = blocksForDate(template, '2026-11-02');
    assert.equal(blocks.length, 0);
  });

  it('ids carry the date', () => {
    const blocks = blocksForDate(template, MONDAY);
    for (const block of blocks) {
      assert.ok(block.id.endsWith('-' + MONDAY));
    }
  });

  it('a bad weekday throws', () => {
    const badTemplate = {
      ...template,
      entries: [
        { id: 'bad', title: 'Bad', kind: 'class', weekday: 8, start: 540, end: 630 },
      ],
    };
    assert.throws(() => blocksForDate(badTemplate, MONDAY), TypeError);
  });
});
