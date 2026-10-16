'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const {io:clientIO}=require('socket.io-client');
const {server,io,rooms}=require('../server');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function emit(s,event,data={}){return new Promise((resolve,reject)=>s.timeout(3000).emit(event,data,(e,r)=>e?reject(e):resolve(r)));}
async function until(fn){for(let i=0;i<150;i++){if(fn())return;await pause(20);}assert.fail('state synchronization timed out');}
test('six real clients: secrets, all chat blocked, fixed discussion, sequential actions, ties, reconnect and room isolation',async t=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;const sockets=[];
 t.after(async()=>{sockets.forEach(s=>s.disconnect());for(const r of rooms.values())r.destroy();await new Promise(r=>io.close(r));});
 async function connect(){const s=clientIO(url,{autoConnect:false,forceNew:true,transports:['websocket']});s.on('state',state=>s.latest=state);sockets.push(s);await new Promise((r,j)=>{s.once('connect',r);s.once('connect_error',j);s.connect();});return s;}
 const a=await connect();const created=await emit(a,'create',{name:'방장사람'});assert.equal(created.ok,true);const code=created.session.code;const sessions=[created.session];const players=[a];
 for(let i=1;i<6;i++){const s=await connect();const joined=await emit(s,'join',{code,name:`친구사람${i}`});assert.equal(joined.ok,true);sessions.push(joined.session);players.push(s);}
 await until(()=>a.latest?.players.length===6);assert.equal((await emit(players[1],'start')).ok,false);assert.equal((await emit(a,'start')).ok,false);
 assert.equal((await emit(a,'settings',{daySeconds:30})).ok,false);assert.equal((await emit(a,'settings',{daySeconds:300})).ok,true);
 assert.equal((await emit(players[1],'settings',{nightSeconds:15})).ok,false);
 assert.equal((await emit(a,'chat',{text:'대기실 메시지'})).ok,false);
 for(const s of players.slice(1))assert.equal((await emit(s,'ready')).ok,true);
 assert.equal((await emit(a,'start')).ok,true);await until(()=>players.every(s=>s.latest.phase==='reveal'));
 assert.equal((await emit(a,'chat',{text:'역할 확인 중 메시지'})).ok,false);
 const room=rooms.get(code);for(const s of players){assert.equal(s.latest.players.some(p=>'role'in p||'token'in p),false);assert.ok(s.latest.me.role);assert.deepEqual(s.latest.me.teammates,[]);}
 const outsider=await connect();assert.equal((await emit(outsider,'join',{code,name:'늦은사람'})).ok,false);assert.equal((await emit(outsider,'create',{name:'다른방사람'})).ok,true);
 room.advance();await until(()=>players.every(s=>s.latest.nightStep==='traitor'));
 const mafia=players.find(s=>s.latest.me.role==='mafia'),traitor=players.find(s=>s.latest.me.role==='traitor'),detective=players.find(s=>s.latest.me.role==='detective'),doctor=players.find(s=>s.latest.me.role==='doctor');
 const citizens=players.filter(s=>s.latest.me.role==='citizen');
 assert.deepEqual(traitor.latest.me.teammates,[mafia.latest.me.id]);for(const s of players.filter(s=>s!==traitor))assert.deepEqual(s.latest.me.teammates,[]);
 for(const s of players)assert.equal((await emit(s,'chat',{text:'밤 비밀 또는 일반 메시지',channel:'mafia'})).ok,false);
 assert.equal((await emit(mafia,'action',{target:citizens[0].latest.me.id})).ok,false);
 assert.equal((await emit(citizens[0],'action',{target:mafia.latest.me.id,role:'detective'})).ok,false);
 room.advance();assert.equal((await emit(detective,'action',{target:mafia.latest.me.id})).ok,true);room.advance();await until(()=>a.latest.phase==='day');
 assert.equal(room.alive().length,6);assert.ok(Math.abs(room.deadline-Date.now()-300000)<200);
 assert.equal((await emit(a,'voteNow')).ok,false);assert.equal(room.phase,'day');
 assert.equal((await emit(citizens[0],'chat',{text:'낮 발언'})).ok,false);
 room.advance();await until(()=>a.latest.phase==='vote');assert.equal((await emit(a,'chat',{text:'투표 중 메시지'})).ok,false);
 assert.equal((await emit(mafia,'action',{target:citizens[0].latest.me.id})).ok,true);assert.equal((await emit(traitor,'action',{target:citizens[1].latest.me.id})).ok,true);room.advance();
 await until(()=>a.latest.voteRound===2);assert.equal(room.voteCandidates.length,2);
 assert.equal((await emit(detective,'action',{target:mafia.latest.me.id})).ok,false);
 assert.equal((await emit(detective,'action',{target:citizens[0].latest.me.id})).ok,true);room.advance();await until(()=>a.latest.nightStep==='mafia');
 const deadClient=citizens[0];assert.equal((await emit(deadClient,'chat',{text:'탈락자 메시지',channel:'ghost'})).ok,false);assert.equal((await emit(deadClient,'action',{target:mafia.latest.me.id})).ok,false);
 assert.equal((await emit(doctor,'action',{target:doctor.latest.me.id})).ok,false);
 assert.equal((await emit(mafia,'action',{target:citizens[1].latest.me.id})).ok,true);room.advance();assert.equal((await emit(doctor,'action',{target:citizens[1].latest.me.id})).ok,true);room.advance();assert.equal((await emit(detective,'action',{target:mafia.latest.me.id})).ok,true);room.advance();await until(()=>a.latest.phase==='day');assert.equal(room.players.find(p=>p.id===citizens[1].latest.me.id).alive,true);
 const traitorIndex=players.indexOf(traitor),originalId=traitor.latest.me.id;traitor.disconnect();await until(()=>room.players.find(p=>p.id===originalId).connected===false);
 const resumed=await connect();const restored=await emit(resumed,'resume',sessions[traitorIndex]);assert.equal(restored.ok,true);assert.equal(restored.state.me.id,originalId);assert.deepEqual(restored.state.me.teammates,[mafia.latest.me.id]);
 assert.equal((await emit(outsider,'resume',{code,token:'fake-token'})).ok,false);
 // End by identifying the spy, then verify post-game chat remains blocked.
 room.advance();const living=room.alive();for(const p of living)room.action(p,mafia.latest.me.id);await until(()=>resumed.latest.phase==='ended');
 assert.equal(room.winner,'citizen');assert.equal((await emit(resumed,'chat',{text:'게임 종료 후 메시지'})).ok,false);
 for(const s of [a,resumed,outsider])assert.equal(s.latest.messages.every(m=>m.channel==='system'),true);
 console.log('PASS: six clients, traitor-only identity, first-night restrictions, sequential attack/protect/investigate, revote restriction, dead actions, all-phase chat rejection, fixed five-minute discussion, reconnect and separate room.');
});
