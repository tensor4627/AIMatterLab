import test from 'node:test';
import assert from 'node:assert/strict';
import {createPerformanceTimeline} from '../../desktop/platform/performance.mjs';

test('performance receipts contain only observed phases and keep the first measurement',()=>{
 let tick=15.125;const timeline=createPerformanceTimeline({now:()=>tick,wall:()=>1234,output:null});
 timeline.mark('desktop-initialize');tick=50;timeline.mark('renderer-interactive');tick=90;timeline.mark('renderer-interactive');
 assert.deepEqual(timeline.snapshot().marks,[{phase:'desktop-initialize',sinceStartMs:15.125,observedAt:1234},{phase:'renderer-interactive',sinceStartMs:50,observedAt:1234}]);
 const changed=timeline.snapshot();changed.marks[0].phase='changed';assert.equal(timeline.snapshot().marks[0].phase,'desktop-initialize');
 assert.throws(()=>timeline.mark('arbitrary-path'),/Invalid performance phase/);
});
