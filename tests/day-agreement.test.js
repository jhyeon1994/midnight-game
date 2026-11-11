'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {GameRoom}=require('../game');
function make(t,{humans=5,bots=0}={}){
 const r=new GameRoom('AGREE');t.after(()=>r.destroy());
 for(let i=0;i<humans+bots;i++){const p=r.add(`참가자${i}`,i>=humans);p.ready=true;}
 r.start();r.players.forEach((p,i)=>p.role=['mafia','traitor','detective','doctor'][i]||'citizen');
 r.advance();r.advance();r.advance();assert.equal(r.phase,'day');return r;
}
const data=(r,agree=true)=>({agree,day:r.day,discussionId:r.discussionId});
const agree=(r,p,value=true)=>r.dayVoteAgreement(p,data(r,value));

test('four of five stay in discussion; final agreement starts exactly one vote',t=>{
 const r=make(t);const before=r.deadline,request=data(r);
 r.players.slice(0,4).forEach(p=>r.dayVoteAgreement(p,request));
 assert.equal(r.phase,'day');assert.equal(r.deadline,before);
 assert.equal(r.stateFor(r.players[0]).dayVoteAgreement.agreed,4);
 agree(r,r.players[4]);assert.equal(r.phase,'vote');assert.equal(r.voteRound,1);
 assert.equal(r.dayVoteAgreements.size,0);assert.equal(r.discussionId,null);
 assert.throws(()=>r.dayVoteAgreement(r.players[4],request),/낮 토론/);
 assert.equal(r.voteRound,1);assert.equal(r.messages.filter(m=>m.text.includes('전원이 동의하여')).length,1);
});
test('explicit agreement/cancellation is idempotent; host has no extra weight',t=>{
 const r=make(t),host=r.players[0];agree(r,host);agree(r,host);
 assert.equal(r.dayVoteAgreements.size,1);assert.equal(r.phase,'day');
 agree(r,host,false);agree(r,host,false);assert.equal(r.dayVoteAgreements.size,0);
 r.players.slice(1).forEach(p=>agree(r,p));assert.equal(r.phase,'day');
 agree(r,host);assert.equal(r.phase,'vote');
});
test('reject outsider, eliminated, bot, offline, malformed and stale requests',t=>{
 const r=make(t,{humans:5,bots:1}),p=r.players[4],good=data(r);
 assert.throws(()=>r.dayVoteAgreement({...p},good),/사람 플레이어/);
 assert.throws(()=>r.dayVoteAgreement(r.players[5],good),/사람 플레이어/);
 p.alive=false;assert.throws(()=>r.dayVoteAgreement(p,good),/사람 플레이어/);p.alive=true;
 p.connected=false;assert.throws(()=>r.dayVoteAgreement(p,good),/사람 플레이어/);p.connected=true;
 for(const invalid of [{...good,agree:'true'},{...good,agree:1}])assert.throws(()=>r.dayVoteAgreement(p,invalid),/동의 여부/);
 for(const invalid of [{...good,day:0},{...good,discussionId:'old'},{agree:true,day:r.day}])assert.throws(()=>r.dayVoteAgreement(p,invalid),/지난 토론/);
 assert.equal(r.dayVoteAgreements.size,0);
 r.advance();assert.throws(()=>r.dayVoteAgreement(p,good),/낮 토론/);
 r.actions={};r.action(r.players[0],r.players[1].id);r.advance();assert.equal(r.phase,'night');
 assert.throws(()=>r.dayVoteAgreement(p,good),/낮 토론/);
});
test('one human plus four bots: one human agreement starts voting, no bot consent',t=>{
 const r=make(t,{humans:1,bots:4});assert.equal(r.stateFor(r.players[0]).dayVoteAgreement.total,1);
 agree(r,r.players[0]);assert.equal(r.phase,'vote');assert.equal(Object.keys(r.actions).length,4);
});
test('zero humans never implicitly starts a vote',t=>{
 const r=make(t,{humans:0,bots:5});assert.equal(r.phase,'day');assert.equal(r.stateFor(r.players[0]).dayVoteAgreement.total,0);
});
test('dead humans are excluded from denominator and agreement requirement',t=>{
 const r=make(t);r.players[4].alive=false;
 assert.equal(r.stateFor(r.players[4]).dayVoteAgreement.total,4);
 r.players.slice(0,4).forEach(p=>agree(r,p));assert.equal(r.phase,'vote');
});
test('disconnect revokes consent but keeps denominator; resume needs new consent',t=>{
 const r=make(t),p=r.players[4];agree(r,p);r.disconnectPlayer(p);
 const s=r.stateFor(r.players[0]).dayVoteAgreement;assert.equal(s.total,5);assert.equal(s.offline,1);assert.equal(s.agreed,0);
 r.players.slice(0,4).forEach(x=>agree(r,x));assert.equal(r.phase,'day');
 p.connected=true;r.changed();assert.equal(r.phase,'day');assert.equal(r.dayVoteAgreements.has(p.id),false);
 agree(r,p);assert.equal(r.phase,'vote');
});
test('without consensus, actual timeout transitions at 300000ms even when offline',t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000000});
 const r=make(t);r.players.slice(0,4).forEach(p=>agree(r,p));r.disconnectPlayer(r.players[4]);
 t.mock.timers.tick(299999);assert.equal(r.phase,'day');t.mock.timers.tick(1);assert.equal(r.phase,'vote');assert.equal(r.voteRound,1);
});
test('final consent just before timeout cancels old timer; vote actions preserved',t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000000});
 const r=make(t);r.players.slice(0,4).forEach(p=>agree(r,p));t.mock.timers.tick(299999);
 agree(r,r.players[4]);r.action(r.players[0],r.players[1].id);t.mock.timers.tick(1);
 assert.equal(r.phase,'vote');assert.equal(r.voteRound,1);assert.equal(r.actions[r.players[0].id],r.players[1].id);
});
test('timer first, delayed final consent rejected without restarting vote',t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000000});
 const r=make(t),old=data(r);r.players.slice(0,4).forEach(p=>agree(r,p));t.mock.timers.tick(300000);
 assert.throws(()=>r.dayVoteAgreement(r.players[4],old),/낮 토론/);assert.equal(r.voteRound,1);
});
test('superseded timeout callback cannot advance a newly-started vote',t=>{
 const callbacks=[],original=setTimeout;
 t.mock.method(global,'setTimeout',(fn,ms)=>{callbacks.push(fn);return original(fn,ms);});
 const r=make(t),oldDayCallback=callbacks.at(-1);r.players.forEach(p=>agree(r,p));
 r.action(r.players[0],r.players[1].id);oldDayCallback();
 assert.equal(r.phase,'vote');assert.equal(r.voteRound,1);assert.equal(r.actions[r.players[0].id],r.players[1].id);
});
test('new day, end, reset and new game clear agreements and rotate discussion ID',t=>{
 const r=make(t),old=data(r);agree(r,r.players[0]);r.advance();r.action(r.players[0],r.players[1].id);r.advance();
 r.advance();r.advance();r.advance();assert.equal(r.phase,'day');assert.equal(r.day,2);
 assert.notEqual(r.discussionId,old.discussionId);assert.equal(r.dayVoteAgreements.size,0);
 assert.throws(()=>r.dayVoteAgreement(r.players[0],old),/지난 토론/);
 agree(r,r.players[0]);r.players[0].alive=false;r.victory();assert.equal(r.phase,'ended');assert.equal(r.dayVoteAgreements.size,0);
 r.reset();assert.equal(r.discussionId,null);r.players.forEach(p=>p.ready=true);r.start();
 r.players.forEach((p,i)=>p.role=['mafia','traitor','detective','doctor','citizen'][i]);r.advance();r.advance();r.advance();
 assert.equal(r.day,1);assert.notEqual(r.discussionId,old.discussionId);
 assert.throws(()=>r.dayVoteAgreement(r.players[0],old),/지난 토론/);assert.equal(r.dayVoteAgreements.size,0);
});
test('rooms keep separate consent and discussion tokens',t=>{
 const a=make(t),b=make(t);agree(a,a.players[0]);assert.equal(b.dayVoteAgreements.size,0);
 assert.notEqual(a.discussionId,b.discussionId);assert.throws(()=>b.dayVoteAgreement(b.players[0],data(a)),/지난 토론/);
 assert.equal(b.phase,'day');
});
