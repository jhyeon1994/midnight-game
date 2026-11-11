'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {io:clientIO}=require('socket.io-client');const {server,io,rooms}=require('../server');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<200;i++){if(fn())return;await pause(10);}assert.fail('state synchronization timed out');}
const emit=(s,event,data={})=>new Promise((resolve,reject)=>s.timeout(3000).emit(event,data,(err,res)=>err?reject(err):resolve(res)));
test('real sockets: consent, resume, replacement, leave, isolation, stale requests and immediate voting',async t=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`,sockets=[];
 t.after(async()=>{sockets.forEach(s=>s.disconnect());for(const r of rooms.values())r.destroy();await new Promise(r=>io.close(r));});
 async function connect(){const s=clientIO(url,{autoConnect:false,forceNew:true,transports:['websocket']});sockets.push(s);s.on('state',v=>s.latest=v);await new Promise((resolve,reject)=>{s.once('connect',resolve);s.once('connect_error',reject);s.connect();});return s;}
 const host=await connect(),created=await emit(host,'create',{name:'동의방장'}),code=created.session.code;
 const clients=[host],sessions=[created.session];
 for(let i=1;i<5;i++){const s=await connect(),res=await emit(s,'join',{code,name:`동의사람${i}`});assert.equal(res.ok,true);clients.push(s);sessions.push(res.session);assert.equal((await emit(s,'ready')).ok,true);}
 assert.equal((await emit(host,'start')).ok,true);const room=rooms.get(code);
 room.players.forEach((p,i)=>p.role=['mafia','traitor','detective','doctor','citizen'][i]);
 assert.equal((await emit(host,'dayVoteAgreement',{agree:true,day:1,discussionId:'fake'})).ok,false);
 room.advance();room.advance();room.advance();await until(()=>clients.every(s=>s.latest?.phase==='day'));
 const d=agree=>({agree,day:room.day,discussionId:room.discussionId}),original=d(true);
 assert.equal((await emit(host,'dayVoteAgreement',d('true'))).ok,false);
 assert.equal((await emit(host,'dayVoteAgreement',{...d(true),discussionId:'fake'})).ok,false);
 const outsider=await connect();await emit(outsider,'create',{name:'다른방장'});
 assert.equal((await emit(outsider,'dayVoteAgreement',d(true))).ok,false);assert.equal(room.dayVoteAgreements.size,0);
 for(let i=0;i<4;i++)assert.equal((await emit(clients[i],'dayVoteAgreement',d(true))).ok,true);
 assert.equal(room.phase,'day');await until(()=>clients[4].latest.dayVoteAgreement.agreed===4);
 assert.equal((await emit(host,'dayVoteAgreement',d(true))).ok,true);assert.equal(room.dayVoteAgreements.size,4);
 assert.equal((await emit(host,'dayVoteAgreement',d(false))).ok,true);assert.equal(room.dayVoteAgreements.size,3);
 // A disconnected participant's consent is revoked and the target total stays five.
 const oldId=clients[3].latest.me.id;clients[3].disconnect();await until(()=>!room.players.find(p=>p.id===oldId).connected);
 await until(()=>host.latest.dayVoteAgreement.offline===1);assert.equal(host.latest.dayVoteAgreement.total,5);assert.equal(room.dayVoteAgreements.size,2);
 const resumed=await connect(),res=await emit(resumed,'resume',sessions[3]);assert.equal(res.ok,true);assert.equal(res.state.me.id,oldId);
 assert.equal(res.state.dayVoteAgreement.agreedIds.includes(oldId),false);clients[3]=resumed;
 assert.equal((await emit(resumed,'dayVoteAgreement',d(true))).ok,true);
 // Replacing an active connection also revokes consent, despite old disconnect being detached.
 const replacement=await connect();assert.equal((await emit(replacement,'resume',sessions[3])).ok,true);
 await until(()=>!resumed.connected);assert.equal(room.dayVoteAgreements.has(oldId),false);clients[3]=replacement;
 assert.equal((await emit(replacement,'dayVoteAgreement',d(true))).ok,true);
 // Explicit leave during a game keeps the alive player in the denominator, without consent.
 assert.equal((await emit(replacement,'leave')).ok,true);assert.equal(room.players.length,5);assert.equal(room.dayVoteAgreements.has(oldId),false);
 assert.equal(room.stateFor(room.players[0]).dayVoteAgreement.total,5);
 assert.equal((await emit(replacement,'dayVoteAgreement',d(true))).ok,false);
 const back=await connect();assert.equal((await emit(back,'resume',sessions[3])).ok,true);clients[3]=back;
 assert.equal((await emit(back,'dayVoteAgreement',d(true))).ok,true);
 assert.equal((await emit(host,'dayVoteAgreement',d(true))).ok,true);assert.equal(room.phase,'day');
 assert.equal((await emit(clients[4],'dayVoteAgreement',d(true))).ok,true);assert.equal(room.phase,'vote');
 await until(()=>clients.every(s=>s.latest.phase==='vote'));assert.equal(room.voteRound,1);
 assert.equal((await emit(host,'dayVoteAgreement',original)).ok,false);assert.equal(room.voteRound,1);
 assert.equal(rooms.get(outsider.latest.code).phase,'lobby');
 // The resulting vote is still the ordinary target ballot, not consent.
 for(const s of clients)assert.equal((await emit(s,'action',{target:room.players[0].id})).ok,true);
 assert.equal(room.phase,'ended');assert.equal(room.winner,'citizen');assert.equal(room.dayVoteAgreements.size,0);
 assert.equal((await emit(host,'reset')).ok,true);assert.equal(room.phase,'lobby');
});
