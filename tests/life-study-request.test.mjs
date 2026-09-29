import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseStudyRequest } from '../scripts/lib/life/study-request.mjs';

const TODAY = '2026-09-29'; // Tuesday

test('hours and subject alias', () => {
  const result = parseStudyRequest('schedule 2 hours of study for macro', TODAY);
  assert.equal(result.minutes, 120);
  assert.equal(result.subject, 'ECON1115');
  assert.equal(result.byDate, TODAY); // Default to today if not specified
  assert.deepEqual(result.splitMinutes, [120]); // <= 120, no split
});

test('minutes form', () => {
  const result = parseStudyRequest('90 min on discrete', TODAY);
  assert.equal(result.minutes, 90);
  assert.equal(result.subject, 'CS1800');
  assert.equal(result.byDate, TODAY);
  assert.deepEqual(result.splitMinutes, [90]);
});

test('before a weekday', () => {
  const result = parseStudyRequest('schedule 2 hours of study for macro before friday', TODAY);
  // Friday is 2026-10-02 (Tue 29 -> Wed 30, Thu 1, Fri 2)
  assert.equal(result.minutes, 120);
  assert.equal(result.subject, 'ECON1115');
  assert.equal(result.byDate, '2026-10-02');
});

test('same weekday means next week', () => {
  const result = parseStudyRequest('schedule 2 hours of study for macro by tuesday', TODAY);
  // Today is Tuesday. Next Tuesday is +7 days -> 2026-10-06
  assert.equal(result.minutes, 120);
  assert.equal(result.subject, 'ECON1115');
  assert.equal(result.byDate, '2026-10-06');
});

test('defaults', () => {
  const result = parseStudyRequest('study', TODAY);
  assert.equal(result.minutes, 60); // Default minutes
  assert.equal(result.subject, null); // No subject
  assert.equal(result.byDate, TODAY); // Default date
  assert.deepEqual(result.splitMinutes, [60]);
});

test('long sessions split', () => {
  const result = parseStudyRequest('schedule 3 hours of study for macro', TODAY);
  assert.equal(result.minutes, 180);
  assert.equal(result.subject, 'ECON1115');
  // 180 > 120, split into 90s
  assert.deepEqual(result.splitMinutes, [90, 90]);
});

test('out of range is an error', () => {
  const result = parseStudyRequest('10 minutes', TODAY);
  assert.equal(result.error, 'minutes out of range');
});
