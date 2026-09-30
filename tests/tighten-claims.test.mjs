import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { classifyClaim } from '../scripts/lib/remote/claims.mjs';

describe('classifyClaim', () => {
  it('data absence is not an inability', () => {
    const r1 = classifyClaim("Confirmed: there's no location on that calendar event");
    assert.equal(r1.kind, 'none');
    assert.equal(r1.needsCheck, false);

    const r2 = classifyClaim("Not enough data yet—you haven't logged bedtimes.");
    assert.equal(r2.kind, 'none');
    assert.equal(r2.needsCheck, false);

    const r3 = classifyClaim("Day's wide open — nothing on the calendar.");
    assert.equal(r3.kind, 'none');
    assert.equal(r3.needsCheck, false);
  });

  it('a missing tool claim is cant', () => {
    const r = classifyClaim("I don't have a direct weather tool available right now.", { toolsRun: 0 });
    assert.equal(r.kind, 'cant');
    assert.equal(r.needsCheck, true);
  });

  it('phone-only excuse is cant', () => {
    const r = classifyClaim("Can't list them through the phone, but the desktop view is there.");
    assert.equal(r.kind, 'cant');
  });

  it('purchases refusal is cant but looked', () => {
    const r = classifyClaim("I don't have the ability to make purchases.", { toolsRun: 2 });
    assert.equal(r.kind, 'cant');
    assert.equal(r.needsCheck, false);
  });

  it('completion claims are done', () => {
    const r1 = classifyClaim("Booked two one-hour macro study sessions: Wednesday at 12:40 PM");
    assert.equal(r1.kind, 'done');

    const r2 = classifyClaim("Done. Reminder set for 10 AM tomorrow");
    assert.equal(r2.kind, 'done');

    const r3 = classifyClaim("Reverted. The macro study sessions are off the calendar.");
    assert.equal(r3.kind, 'done');
  });

  it('done with no tools needs a check', () => {
    const r0 = classifyClaim("Alarm set for 8:15 AM tomorrow.", { toolsRun: 0 });
    assert.equal(r0.kind, 'done');
    assert.equal(r0.needsCheck, true);

    const r1 = classifyClaim("Alarm set for 8:15 AM tomorrow.", { toolsRun: 1 });
    assert.equal(r1.kind, 'done');
    assert.equal(r1.needsCheck, false);
  });

  it('offers are not claims', () => {
    const r = classifyClaim("Want me to add it to your to-do list?");
    assert.equal(r.kind, 'none');
  });

  it('plain answers are none', () => {
    const r = classifyClaim("Macro Quiz 1 is Friday, October 16.");
    assert.equal(r.kind, 'none');
  });

  it('invalid input throws', () => {
    assert.throws(() => classifyClaim(null), TypeError);
    assert.throws(() => classifyClaim("x", { toolsRun: -1 }), TypeError);
  });
});

it("edit claims are done (2026-09-30)", () => {
  assert.equal(classifyClaim("Done. Combined them into \"magnesium, zinc & calcium\" and \"vitamin D3 & K2\".", { toolsRun: 1 }).kind, "done");
  assert.equal(classifyClaim("Combined them into two items.", { toolsRun: 0 }).needsCheck, true);
  assert.equal(classifyClaim("Renamed it to Ashwagandha.").kind, "done");
});
