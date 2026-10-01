import { test } from 'node:test';
import { strict as assert } from 'node:assert/strict';
import { parseTodos } from '../scripts/lib/life/todo-parse.mjs';

test('nicks real message', () => {
  const result = parseTodos(
    'add fix Orion stuff, finish my resume, send internship applications and maybe study to my todo list',
    { now: { date: '2026-09-30', minute: 600 } },
  );
  assert.equal(result.tasks.length, 4);

  const [t1, t2, t3, t4] = result.tasks;
  assert.equal(t1.title, 'fix Orion stuff');
  assert.equal(t1.minutes, 60);
  assert.equal(t1.optional, false);
  assert.equal(t1.fixed, false);
  assert.equal(t1.at, null);

  assert.equal(t2.title, 'finish my resume');
  assert.equal(t2.minutes, 90);
  assert.equal(t2.fixed, false);
  assert.equal(t2.at, null);

  assert.equal(t3.title, 'send internship applications');
  assert.equal(t3.minutes, 90); // applications matched before send
  assert.equal(t3.fixed, false);
  assert.equal(t3.at, null);

  assert.equal(t4.title, 'study');
  assert.equal(t4.minutes, 60);
  assert.equal(t4.optional, true);
  assert.equal(t4.fixed, false);
  assert.equal(t4.at, null);
});

test('explicit time makes it fixed', () => {
  const result = parseTodos('call mum at 6', { now: { date: '2026-09-30', minute: 600 } });
  assert.equal(result.tasks.length, 1);
  const t = result.tasks[0];
  assert.equal(t.title, 'call mum');
  assert.equal(t.minutes, 30);
  assert.equal(t.at, 1080); // 6pm → 18*60
  assert.equal(t.fixed, true);
});

test('explicit duration wins', () => {
  const result = parseTodos(
    'gym for 45, study 2 hours',
    { now: { date: '2026-09-30', minute: 600 } },
  );
  assert.equal(result.tasks.length, 2);
  assert.equal(result.tasks[0].minutes, 45);
  assert.equal(result.tasks[1].minutes, 120);
});

test('due words', () => {
  const result = parseTodos(
    'essay by friday, laundry tomorrow',
    { now: { date: '2026-09-30', minute: 600 } },
  );
  assert.equal(result.tasks.length, 2);
  assert.equal(result.tasks[0].title, 'essay');
  assert.equal(result.tasks[0].due, '2026-10-02'); // Friday Oct 2
  assert.equal(result.tasks[1].title, 'laundry');
  assert.equal(result.tasks[1].due, '2026-10-01'); // tomorrow
});

test('bullets and newlines', () => {
  const result = parseTodos(
    '- groceries\n- reply to Sam\n• revise CS1802',
    { now: { date: '2026-09-30', minute: 600 } },
  );
  assert.equal(result.tasks.length, 3);
});

test('no invented times', () => {
  // Test 1 tasks
  const r1 = parseTodos(
    'add fix Orion stuff, finish my resume, send internship applications and maybe study to my todo list',
    { now: { date: '2026-09-30', minute: 600 } },
  );
  for (const t of r1.tasks) {
    assert.equal(t.at, null, `task "${t.title}" should have at=null`);
    assert.equal(t.fixed, false, `task "${t.title}" should not be fixed`);
  }
  // Test 5 tasks
  const r5 = parseTodos(
    '- groceries\n- reply to Sam\n• revise CS1802',
    { now: { date: '2026-09-30', minute: 600 } },
  );
  for (const t of r5.tasks) {
    assert.equal(t.at, null, `task "${t.title}" should have at=null`);
    assert.equal(t.fixed, false, `task "${t.title}" should not be fixed`);
  }
});

test('optional words', () => {
  const result = parseTodos(
    'if I have time clean room',
    { now: { date: '2026-09-30', minute: 600 } },
  );
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].optional, true);
  assert.equal(result.tasks[0].title, 'clean room');
});

test('duplicates collapse', () => {
  const result = parseTodos(
    'study, Study',
    { now: { date: '2026-09-30', minute: 600 } },
  );
  assert.equal(result.tasks.length, 1);
});

test('invalid input throws', () => {
  assert.throws(() => parseTodos(''), TypeError);
  assert.throws(() => parseTodos('x'), TypeError);
});
