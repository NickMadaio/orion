import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { canvasRead, canvasCourseSnapshot } from '../scripts/lib/connect/canvas.mjs';
import { planCourseRefresh, previewCourseRefresh, excludedCourses, plainText, COURSE_FOLDER, SCHOOL_NOTE, SOURCE_REGISTER } from '../scripts/lib/connect/course-notes.mjs';
import { loadCourseVault, applyCourseRefresh } from '../scripts/lib/connect/course-vault.mjs';

const spec = JSON.parse(readFileSync(new URL('../scripts/connectors/canvas.json', import.meta.url)));
const settings = { domain:'canvas.example.edu' }, now = '2026-10-06T15:00:00Z';
const resource = (data, endpoint) => ({status:'available',data,retrieved_at:now,source_urls:[`https://canvas.example.edu/api/v1/courses/42/${endpoint}`]});
const courseNote = name => `---\ntitle: ${name}\ntype: course\npermalink: courses/${name.toLowerCase()}\ntags: [class]\n---\n\n# ${name}\n\n## Observations\n- [weekly_timetable] Tuesday 13:30–15:00; Friday 15:30–17:00, Europe/London\n- [study] Nick wants paper practice\n\n## Relations\n- taken_by [[Nick]]\n`;
const childNote = title => `---\ntitle: ${title}\ntype: assessment\npermalink: assessments/quiz\nduration_minutes: 60\nweight_percent: 25\ndue: "2026-10-16T23:59:00"\n---\n\n# ${title}\n\nSyllabus plans 40 questions.\n\n## Relations\n- part_of [[ECON1115]]\n`;
const school = '---\ncanvas_excluded_course_ids: [7349]\n---\n';
function snapshot() {
  return {schema_version:1,course_id:'42',retrieved_at:now,course:resource({id:42,name:'ECON1115 Principles of Macroeconomics',course_code:'Principles of Macroeconomics',time_zone:'Europe/London',syllabus_body:'<p>Learn macroeconomics.</p>',apply_assignment_group_weights:true},''),assignments:resource([
    {id:1,course_id:42,name:'Quiz 1',due_at:'2026-10-16T22:59:59Z',unlock_at:'2026-10-14T23:00:00Z',lock_at:'2026-10-16T22:59:59Z',description:null,quiz_id:9,assignment_group_id:7,is_quiz_assignment:true},
    {id:2,course_id:42,name:'Quiz 1 - information and assessment brief',description:'<p>40 MCQs</p>',assignment_group_id:7}
  ],'assignments'),quizzes:resource([{id:9,assignment_id:1,time_limit:60,question_count:0,points_possible:0,allowed_attempts:1,description:''}],'quizzes'),assignment_groups:resource([{id:7,name:'Quiz 1',group_weight:25}],'assignment_groups')};
}
function notes() { return new Map([[`${COURSE_FOLDER}/ECON1115.md`,courseNote('ECON1115')],[`${COURSE_FOLDER}/ECON1115 Quiz 1.md`,childNote('ECON1115 Quiz 1')],[SOURCE_REGISTER,'---\ntitle: Source Register\n---\n\n# Source Register\n\nExisting attribution.\n']]); }
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(),'canvas-vault-')), vault=join(root,'vault'), backups=join(root,'backups');
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  for (const [relative,content] of [...notes(),[SCHOOL_NOTE,school]]) { const p=join(vault,relative);mkdirSync(join(p,'..'),{recursive:true});writeFileSync(p,content); }
  return {root,vault,backups};
}

test('complete Canvas pagination preserves null, empty, false and zero', async () => {
  let calls=0;
  const result=await canvasRead(spec,'assignments',{course_id:42},settings,async url => {
    calls++;
    return calls===1 ? {ok:true,body:[{id:1,description:null,lock_at:null,points_possible:0,published:false}],link:'<https://canvas.example.edu/api/v1/courses/42/assignments?opaque=2>; rel="next"'} : {ok:true,body:[{id:2,description:''}]};
  });
  assert.equal(calls,2);assert.equal(result.data.length,2);
  assert.deepEqual(result.data[0],{id:1,description:null,lock_at:null,points_possible:0,published:false});
  assert.equal(result.data[1].description,'');assert.equal(result.source_urls.length,2);
});

test('pagination rejects another host/resource, credentials, loops and partial-page failure', async () => {
  for (const url of ['https://elsewhere.example/api/v1/courses/42/assignments?page=2','https://canvas.example.edu/api/v1/courses/42/student_view_student','https://user@canvas.example.edu/api/v1/courses/42/assignments?page=2']) {
    let calls=0;
    await assert.rejects(canvasRead(spec,'assignments',{course_id:42},settings,async()=>{calls++;return {ok:true,body:[],link:`<${url}>; rel="next"`};}),/left the requested/);
    assert.equal(calls,1);
  }
  const request='https://canvas.example.edu/api/v1/courses/42/assignments?order_by=due_at&per_page=100';
  await assert.rejects(canvasRead(spec,'assignments',{course_id:42},settings,async()=>({ok:true,body:[],link:`<${request}>; rel="next"`})),/repeated page/);
  let count=0;
  const failed=await canvasRead(spec,'assignments',{course_id:42},settings,async()=>++count===1?{ok:true,body:[{id:1}],link:'<https://canvas.example.edu/api/v1/courses/42/assignments?page=2>; rel="next"'}:{ok:false,status:403});
  assert.equal(failed.status,'unavailable');assert.equal(failed.data,undefined);
});

test('snapshot only reads an active enrolled course and optional denial stays unavailable', async () => {
  const urls=[];
  const fetch=async url=>{urls.push(url);const path=new URL(url).pathname;return path==='/api/v1/courses'?{ok:true,body:[{id:42}]}:path==='/api/v1/courses/42'?{ok:true,body:{id:42,name:'ECON1115'}}:path.endsWith('/quizzes')?{ok:false,status:403}:{ok:true,body:[]};};
  const result=await canvasCourseSnapshot(spec,42,settings,fetch);
  assert.equal(result.quizzes.status,'unavailable');assert.equal(result.assignments.status,'available');assert.deepEqual(result.assignments.data,[]);
  assert.ok(urls.every(u=>!u.includes('questions')&&!u.includes('submissions')&&!u.includes('attempts')));
  await assert.rejects(canvasCourseSnapshot(spec,99,settings,fetch),/not in your active/);
  await assert.rejects(canvasCourseSnapshot(spec,'../42',settings,fetch),/positive decimal/);
});

test('refresh reuses parent/children, folds briefs, preserves preferences, and separates planned/configured facts', () => {
  const initial=notes(),plan=planCourseRefresh(snapshot(),'ECON1115',initial,school);
  assert.equal(plan.changes.length,3);assert.ok(plan.changes.every(c=>c.before!==null));
  const parent=plan.changes.find(c=>c.path.endsWith('/ECON1115.md')).after;
  assert.match(parent,/Tuesday 13:30–15:00; Friday 15:30–17:00/);assert.match(parent,/Nick wants paper practice/);assert.match(parent,/has_assessment \[\[ECON1115 Quiz 1\]\]/);
  const child=plan.changes[0].after;
  assert.match(child,/Syllabus plans 40 questions/);assert.match(child,/quiz_question_count\] 0/);assert.match(child,/zero configured questions/);assert.match(child,/quiz_allowed_attempts\] 1/);assert.match(child,/40 MCQs/);
  assert.match(child,/16 October 2026 at 23:59:59 \(Europe\/London\)/);assert.match(child,/due: "2026-10-16T22:59:59Z"/);assert.match(child,/duration_minutes: 60/);assert.match(child,/weight_percent: 25/);
  assert.match(child,/Assessment description\] Not set/);assert.match(child,/Quiz description\] Empty/);assert.match(child,/part_of \[\[ECON1115\]\]/);
  assert.match(plan.changes.at(-1).after,/Existing attribution/);
  const second=planCourseRefresh(snapshot(),'ECON1115',new Map(plan.changes.map(c=>[c.path,c.after])),school);
  for (const c of second.changes) assert.equal(c.after,c.before,'same snapshot should be byte-idempotent');
});

test('missing dates and denied quiz metadata are not interpreted as no dates or no quizzes', () => {
  const s=snapshot();delete s.assignments.data[0].due_at;s.assignments.data[0].lock_at=null;s.quizzes={status:'unavailable',http_status:403};
  const child=planCourseRefresh(s,'ECON1115',notes(),school).changes[0].after;
  assert.match(child,/due\] Unavailable: field not returned/);assert.match(child,/locks\] Not set/);assert.match(child,/classic quizzes endpoint inaccessible/);assert.match(child,/canvas_due_at_status: "unavailable"/);
  assert.ok(!/^due:/m.test(child));assert.match(child,/prior_canvas_due: "2026-10-16T23:59:00"/);
});

test('older unzoned Canvas observations become explicitly superseded history', () => {
  const ns=notes(),path=`${COURSE_FOLDER}/ECON1115 Quiz 1.md`;
  ns.set(path,ns.get(path)+'\n- [timing_limit] Canvas timezone was not shown; due is not a separately confirmed lock/closing time.\n');
  const plan=planCourseRefresh(snapshot(),'ECON1115',ns,school),child=plan.changes[0].after;
  assert.match(child,/historical_canvas_observation\] Earlier Canvas listing observation; superseded/);
  assert.ok(!/^- \[timing_limit\] Canvas timezone was not shown/m.test(child));
});

test('preview includes the scoped source-register block without unrelated attribution', () => {
  const plan=planCourseRefresh(snapshot(),'ECON1115',notes(),school),preview=previewCourseRefresh(plan);
  assert.equal(preview.length,3);assert.ok(preview.every(p=>p.source_block.includes('Canvas')));
  assert.ok(!preview.at(-1).source_block.includes('Existing attribution'));
});

test('exclusions, ambiguous mappings, unavailable assignments and code mismatch refuse writes', () => {
  assert.ok(excludedCourses(school).has('7349'));
  const excluded=snapshot();excluded.course_id='7349';assert.throws(()=>planCourseRefresh(excluded,'ECON1115',notes(),school),/excluded by Nick/);
  const bad=snapshot();bad.assignments={status:'unavailable',http_status:403};assert.throws(()=>planCourseRefresh(bad,'ECON1115',notes(),school),/Assignments unavailable/);
  assert.throws(()=>planCourseRefresh(snapshot(),'CS1800',new Map([[`${COURSE_FOLDER}/CS1800.md`,courseNote('CS1800')]]),school),/does not match/);
  const duplicate=notes();duplicate.set(`${COURSE_FOLDER}/Online Quiz 1.md`,childNote('ECON1115 Quiz 1').replace('type: assessment','type: assessment\ncanvas_course_id: 42\ncanvas_assignment_id: 1'));
  assert.throws(()=>planCourseRefresh(snapshot(),'ECON1115',duplicate,school),/Multiple notes/);
});

test('AE1: Exam maps to existing AE1; source markup cannot create graph links', () => {
  const s=snapshot();s.course.data.name='CS2100 Program Design';s.course.data.course_code='Program Design';s.assignments.data=[{id:1,course_id:42,name:'AE1: Exam',description:'<script>bad()</script><p>[[Other]] <!-- orion:canvas:end --></p>'}];s.quizzes.data=[];
  const ns=new Map([[`${COURSE_FOLDER}/CS2100.md`,courseNote('CS2100')],[`${COURSE_FOLDER}/CS2100 AE1.md`,childNote('CS2100 AE1')],[SOURCE_REGISTER,'---\ntitle: Source Register\n---\n# Source Register\n']]);
  const plan=planCourseRefresh(s,'CS2100',ns,school);
  assert.ok(plan.changes.some(c=>c.path.endsWith('/CS2100 AE1.md')));assert.ok(plan.changes.every(c=>c.before!==null));
  assert.ok(!plan.changes[0].after.includes('[[Other]]'));assert.ok(!plan.changes[0].after.includes('bad()'));
  assert.equal(plainText('<p>A &amp; B &#x1F600;</p>'),'A & B 😀');
});

test('vault writes verify files, keep backups, and refuse a stale local edit', t => {
  const {vault,backups}=fixture(t),loaded=loadCourseVault(vault),plan=planCourseRefresh(snapshot(),'ECON1115',loaded.notes,loaded.schoolNote);
  const result=applyCourseRefresh(vault,plan,backups,loaded.schoolNote);
  assert.ok(existsSync(join(result.backup,'ECON1115.md')));
  for (const c of plan.changes) assert.equal(readFileSync(join(vault,c.path),'utf8'),c.after);
  const stale=planCourseRefresh(snapshot(),'ECON1115',loadCourseVault(vault).notes,school);
  const path=join(vault,stale.changes[0].path);writeFileSync(path,readFileSync(path,'utf8')+'\nLocal new study note.\n');
  assert.throws(()=>applyCourseRefresh(vault,stale,backups,school),/changed during retrieval/);
  assert.match(readFileSync(path,'utf8'),/Local new study note/);assert.ok(!existsSync(join(vault,COURSE_FOLDER,'.orion-canvas.lock')));
});

test('vault refuses symlinks, concurrent refresh, and changed exclusion decisions', t => {
  const {vault,backups,root}=fixture(t),loaded=loadCourseVault(vault),plan=planCourseRefresh(snapshot(),'ECON1115',loaded.notes,school);
  writeFileSync(join(vault,COURSE_FOLDER,'.orion-canvas.lock'),'busy');
  assert.throws(()=>applyCourseRefresh(vault,plan,backups,school),/already running/);
  rmSync(join(vault,COURSE_FOLDER,'.orion-canvas.lock'));
  writeFileSync(join(vault,SCHOOL_NOTE),school+'Changed');
  assert.throws(()=>applyCourseRefresh(vault,plan,backups,school),/exclusions changed/);
  const child=join(vault,COURSE_FOLDER,'ECON1115 Quiz 1.md');rmSync(child);symlinkSync(join(root,'missing-target'),child);
  assert.throws(()=>loadCourseVault(vault),/symlink/);
});
