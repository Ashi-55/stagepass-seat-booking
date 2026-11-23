import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {Store} from '../dist/api/store.js';
import {localCluster} from './cluster.mjs';
import {rm} from 'node:fs/promises';
const dir='.test-pg-'+randomUUID();
let cluster,store,pool,a,b,org,event,now=1800000000;
before(async()=>{
 cluster=await localCluster(dir,Number(process.env.STAGE_TEST_PG_PORT??55439));pool=new Pool({connectionString:cluster.url});
 store=new Store(pool,()=>now);await store.init('test-password','test-admin-password');
 a=(await store.run('register',{name:'Attendee A',password:'test-password'})).session;
 b=(await store.run('register',{name:'Attendee B',password:'test-password'})).session;
 org=(await store.run('login',{name:'organizer',password:'test-password'})).session;
 event=(await store.run('state',{},org)).events[0];
});
after(async()=>{await pool?.end();await cluster?.pg.stop();await rm(dir,{recursive:true,force:true,maxRetries:4,retryDelay:200});});
const run=(op,data,who=a)=>store.run(op,data,who);
const hold=(seats,who=a)=>run('hold',{event:event.id,seats},who);
test('seed has 120 and 60 seats, 30 claims',async()=>{const s=await run('state',{});assert.deepEqual(s.events.map(e=>e.rows*e.cols),[120,60]);assert.equal(s.claims.length,30);const bookings=await pool.query("SELECT count(*)::int AS count FROM stagepass.reservations WHERE status='booked'");assert.equal(bookings.rows[0].count,30);});
test('two concurrent attendees produce one confirmed booking in each of five races',async()=>{
 for(let i=0;i<5;i++){
 const results=await Promise.allSettled([a,b].map(async who=>{const r=await hold(['A1'],who);await run('confirm',r,who);return {who,r};}));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(results.find(r=>r.status==='rejected').reason.getStatus(),409);
 const {who,r}=results.find(r=>r.status==='fulfilled').value;await run('cancel',r,who);
 }});
test('fixed clock releases at exact expiry',async()=>{await hold(['A1']);now+=299;await assert.rejects(hold(['A1'],b));now++;await run('cancel',await hold(['A1'],b),b);});
test('expired hold cannot confirm',async()=>{const r=await hold(['A1']);now+=300;await assert.rejects(run('confirm',r));});
test('partial collision rolls back entire group',async()=>{const r=await hold(['A2'],b);await assert.rejects(hold(['A1','A2']));await run('cancel',await hold(['A1']));await run('cancel',r,b);});
test('attendee cannot edit event',async()=>{await assert.rejects(run('edit',event),e=>e.getStatus()===403);});
test('organizer cannot book',async()=>{await assert.rejects(hold(['A1'],org));});
test('configured limit and duration apply immediately',async()=>{await run('edit',{...event,maximum:1,minutes:2},org);await assert.rejects(hold(['A1','A2']));const r=await hold(['A1']);assert.equal((await run('state',{})).history[0].expires,now+120);await run('cancel',r);await run('edit',event,org);});
test('invalid event dates and dimensions rejected',async()=>{for(const changes of [{date:now},{rows:0},{cols:0}])await assert.rejects(run('events',{...event,...changes},org));});
test('grid cannot remove occupied seats',async()=>{await assert.rejects(run('edit',{...event,rows:2},org));});
test('invalid seats rejected',async()=>{for(const seats of [[],['A0'],['Z9'],['A1','A1']])await assert.rejects(hold(seats));});
test('history and cancellation scoped to owner',async()=>{const r=await hold(['A1']);assert.ok(!(await run('state',{},b)).history.some(h=>h.id===r.id));await assert.rejects(run('cancel',r,b));await run('cancel',r);});
test('new event is bookable',async()=>{const e=await run('events',{...event,name:'Recital'},org);const r=await run('hold',{event:e.id,seats:['B1']});await run('confirm',r);await run('cancel',r);assert.equal((await run('state',{})).history[0].status,'cancelled');});
test('registration cannot set organizer role; logout invalidates session',async()=>{const {session}=await run('register',{name:'Jane',password:'sample-password',role:'organizer'});assert.equal((await run('state',{},session)).user.role,'attendee');await run('logout',{},session);await assert.rejects(run('state',{},session));});

test('admin provisions organizers; only organizers can change event rules',async()=>{
 const admin=(await run('login',{name:'admin',password:'test-admin-password'})).session;
 const account={name:'Box Office',password:'organizer-test-password'};
 for(const token of [a,org]){
   await assert.rejects(run('admin-accounts',{},token),e=>e.getStatus()===403);
   await assert.rejects(run('create-organizer',account,token),e=>e.getStatus()===403);
 }
 await run('create-organizer',account,admin);
 await assert.rejects(run('create-organizer',account,admin));
 const {accounts}=await run('admin-accounts',{},admin);
 assert.equal(accounts.find(u=>u.name===account.name).role,'organizer');
 const organizer=(await run('login',account)).session;
 for(const op of ['edit','events'])await assert.rejects(run(op,event,admin),e=>e.getStatus()===403);
 await run('edit',{...event,minutes:4},organizer);
 assert.equal((await run('state',{},organizer)).events.find(e=>e.id===event.id).minutes,4);
 await assert.rejects(hold(['A1'],admin));
});


test('Google subject keeps the same attendee and booking history across sign-ins',async()=>{
 const {session}=await store.googleSession('test-google-subject','admin');
 const first=await run('state',{},session);
 assert.equal(first.user.role,'attendee');
 assert.notEqual(first.user.name,'admin');
 const reservation=await hold(['A1'],session);
 const returning=await store.googleSession('test-google-subject','changed@example.test');
 const second=await run('state',{},returning.session);
 assert.equal(second.user.id,first.user.id);
 assert.equal(second.history[0].id,reservation.id);
 await assert.rejects(run('login',{name:first.user.name,password:'test-password'}));
 await run('cancel',reservation,returning.session);
});


test('signed-out visitors can read event listings only',async()=>{
 const guest=(await store.run('guest')).session;
 const s=await run('state',{},guest);
 assert.ok(s.events.length);
 assert.deepEqual(Object.keys(s.events[0]).sort(),['date','genre','id','name','venue']);
 assert.deepEqual(s.claims,[]);assert.deepEqual(s.history,[]);
 await assert.rejects(hold(['A1'],guest),e=>e.getStatus()===401);
});

test('PostgreSQL rejects a duplicate seat claim without going through the store',async()=>{
 const reservation=await hold(['A1']);
 try{
   await assert.rejects(pool.query('INSERT INTO stagepass.claims(event,seat,reservation) VALUES($1,$2,$3)',[event.id,'A1',reservation.id]),error=>error.code==='23505');
 }finally{await run('cancel',reservation);}
});
