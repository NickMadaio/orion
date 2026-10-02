import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {classReminders,inClass,classCampus} from '../scripts/lib/life/class-reminders.mjs';
test('one reminder in ten-minute window; no reminders throughout class or afterwards',()=>{
 const blocks=[{id:'macro',title:'ECON1115 Macroeconomics',start:930,end:1020,kind:'class',fixed:true,source:'calendar'}];
 assert.equal(classReminders(blocks,{now:919}).length,0);
 assert.match(classReminders(blocks,{now:920})[0].text,/10 minutes at Devon House/);
 assert.equal(classReminders(blocks,{now:925,sent:['macro']}).length,0);
 for(let now=930;now<=1100;now++) assert.equal(classReminders(blocks,{now}).length,0);
 assert.equal(inClass(blocks,960),true);assert.equal(inClass(blocks,1020),false);
 assert.equal(classCampus('CS1800 Discrete Structures'),'Portsoken');
});
test('evaluation check-ins cannot mutate live state or emit due alerts',t=>{
 const dir=mkdtempSync(join(tmpdir(),'orion-ci-isolation-')); t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const marker=join(dir,'eval-mode'), live=join(dir,'live-checkins.json');
 writeFileSync(marker,'test');writeFileSync(live,'{"checkins":[]}');
 const run=(...args)=>spawnSync(process.execPath,['scripts/orion-checkin',...args],{encoding:'utf8',env:{...process.env,ORION_EVAL_MARKER:marker,ORION_CHECKIN_FILE:live}});
 assert.equal(run('add','0','still in the lab').status,0);
 assert.equal(readFileSync(live,'utf8'),'{"checkins":[]}');assert.ok(existsSync(join(dir,'eval-checkins.json')));
 const tick=run('tick','--json');assert.equal(tick.status,0,tick.stderr);assert.deepEqual(JSON.parse(tick.stdout),[]);
});
