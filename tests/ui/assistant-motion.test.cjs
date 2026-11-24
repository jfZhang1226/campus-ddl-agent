const {test}=require('node:test'),assert=require('node:assert/strict');
const {assistantMode,assistantFrame,shouldFinishWriting,AssistantMotionPlayer}=require('../../client/entry/src/main/ets/ui/AssistantMotion.ts');
class Clock {
 time=0;next=0;jobs=new Map();max=0;
 now(){return this.time;} schedule(fn,delay){assert.ok(delay>=80);this.jobs.set(++this.next,{fn,delay});this.max=Math.max(this.max,this.jobs.size);return this.next;}
 cancel(id){this.jobs.delete(id);} step(){const [id,job]=this.jobs.entries().next().value;this.jobs.delete(id);this.time+=job.delay;job.fn();}
}
test('actual phases map saving to writing, thinking to analysis and errors to quiet idle',()=>{
 for(const phase of ['initializing','preparing','running','staging','recovering','selecting'])assert.equal(assistantMode(phase),'think');
 assert.equal(assistantMode('saving'),'write');assert.equal(assistantMode('idle'),'idle');assert.equal(assistantMode('saving','STORAGE_FAILED'),'idle');assert.equal(assistantMode('unknown'),'idle');
});
test('a notebook completion hold requires a new real receipt from a successful save',()=>{
 assert.equal(shouldFinishWriting('saving','idle','','old','new'),true);
 for(const args of [['running','idle','','old','new'],['saving','idle','STORAGE_FAILED','old','new'],['saving','idle','','old','old'],['saving','idle','','old',''],['idle','idle','','','historical']])assert.equal(shouldFinishWriting(...args),false);
});
test('all actions have four bounded cells and idle allows a visible slow blink',()=>{
 for(const mode of ['idle','wave','think','write'])for(const i of [-3,0,1,2,3,100,NaN,Infinity]){const f=assistantFrame(mode,i);assert.ok(f.cell>=0&&f.cell<4);assert.ok(f.delay>=80&&f.delay<=2800);}
 assert.equal(assistantFrame('idle',0).delay,2800);assert.equal(assistantFrame('bad',0).mode,'idle');
});
test('hidden player owns no timer; visible player has exactly one and visits all frames',()=>{
 const clock=new Clock(),frames=[],p=new AssistantMotionPlayer(f=>frames.push(f),clock);p.setMode('think');assert.equal(clock.jobs.size,0);
 p.setActive(true);for(let i=0;i<8;i++)clock.step();assert.deepEqual([...new Set(frames.map(f=>f.cell))].sort(),[0,1,2,3]);assert.equal(clock.max,1);
 p.setActive(false);assert.equal(clock.jobs.size,0);const count=frames.length;p.setMode('write');assert.equal(frames.length,count);
});
test('tap greeting ends naturally, does not interrupt real work and is cancelled on hide',()=>{
 const clock=new Clock(),frames=[],p=new AssistantMotionPlayer(f=>frames.push(f),clock);p.setActive(true);p.greet();assert.equal(frames.at(-1).mode,'wave');
 for(let i=0;i<13;i++)clock.step();assert.equal(frames.at(-1).mode,'idle');p.setMode('think');p.greet();assert.equal(frames.at(-1).mode,'think');p.setActive(false);assert.equal(clock.jobs.size,0);
});
test('disposed or stale callbacks never restart playback after hiding or leaving a page',()=>{
 const clock=new Clock(),frames=[],p=new AssistantMotionPlayer(f=>frames.push(f),clock);p.setActive(true);const stale=[...clock.jobs.values()][0].fn;
 p.setActive(false);const count=frames.length;stale();assert.equal(frames.length,count);assert.equal(clock.jobs.size,0);
 p.setActive(true);p.dispose();p.setActive(true);p.greet();stale();assert.equal(clock.jobs.size,0);
});
test('observer-triggered teardown cannot leave an extra frame callback running',()=>{
 const clock=new Clock();let player;player=new AssistantMotionPlayer(()=>player.setActive(false),clock);player.setActive(true);assert.equal(clock.jobs.size,0);
});
