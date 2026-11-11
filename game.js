'use strict';
const { randomUUID, randomInt } = require('node:crypto');
const ROLE_NAMES = {mafia:'밀정', traitor:'친일파', detective:'독립군', doctor:'한국인 의사', citizen:'한국인'};
const choose = a => a.length ? a[randomInt(a.length)] : null;
function leaders(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v)||0)+1);
  let max=0, winners=[];
  for (const [v,n] of counts) { if(n>max){max=n;winners=[v];} else if(n===max) winners.push(v); }
  return winners;
}
function plurality(values){const w=leaders(values);return w.length===1?w[0]:null;}
class GameRoom {
  constructor(code,onChange=()=>{}) {
    this.code=code; this.onChange=onChange; this.players=[]; this.hostId=null;
    this.dayVoteAgreements=new Set();this.discussionId=null;this.phaseVersion=0;
    this.phase='lobby'; this.day=0; this.deadline=null; this.messages=[]; this.actions={};
    this.nightStep=null;this.voteCandidates=[];this.voteRound=0;this.processingBots=false;
    this.settings={daySeconds:300,nightSeconds:30,voteSeconds:30}; this.winner=null;
    this.createdAt=Date.now(); this.updatedAt=Date.now(); this.timer=null;
  }
  changed(){this.updatedAt=Date.now();this.onChange(this);}
  add(name,bot=false){
    if(this.phase!=='lobby') throw Error('이미 시작된 게임입니다. 다음 게임에 참여해 주세요.');
    if(this.players.length>=12) throw Error('방이 가득 찼습니다.');
    if(this.players.some(p=>p.name===name)) throw Error('이미 사용 중인 닉네임입니다.');
    const p={id:randomUUID(),token:randomUUID(),name,bot,connected:true,ready:bot||!this.hostId,alive:true,role:null,notes:[],knownMafia:null};
    this.players.push(p);if(!this.hostId)this.hostId=p.id; this.changed();return p;
  }
  system(text){this.message({name:'사회자',text,channel:'system'});}
  // Player-authored messages are never stored, including legacy/faction/ghost channels.
  message(m){if(m.channel!=='system')return;this.messages.push({id:randomUUID(),time:Date.now(),...m});if(this.messages.length>250)this.messages.shift();}
  alive(){return this.players.filter(p=>p.alive);}
  setPhase(phase,seconds){
    clearTimeout(this.timer);const version=++this.phaseVersion;
    this.dayVoteAgreements.clear();this.discussionId=phase==='day'?randomUUID():null;
    this.phase=phase;this.deadline=seconds?Date.now()+seconds*1000:null;
    // Ignore a superseded phase's timeout, even if it was already queued.
    if(seconds)this.timer=setTimeout(()=>{if(this.phaseVersion===version)this.advance();},seconds*1000);
    this.changed();
  }
  start(){
    if(this.phase!=='lobby') throw Error('대기실에서만 시작할 수 있습니다.');
    if(this.players.length<5) throw Error('최소 5명이 필요합니다. 친구를 초대하거나 연습 봇을 추가해 주세요.');
    if(this.players.some(p=>!p.bot&&(!p.connected||(!p.ready&&p.id!==this.hostId)))) throw Error('모든 참가자가 접속하고 준비해야 합니다.');
    const roles=['mafia','traitor','detective','doctor',...Array(this.players.length-4).fill('citizen')];
    for(let i=roles.length-1;i>0;i--){const j=randomInt(i+1);[roles[i],roles[j]]=[roles[j],roles[i]];}
    this.players.forEach((p,i)=>{p.role=roles[i];p.alive=true;p.notes=[];p.knownMafia=null;p.ready=false;});
    this.messages=[];this.winner=null;this.day=1;this.actions={};this.nightStep=null;this.voteCandidates=[];this.voteRound=0;
    this.settings.daySeconds=300;
    this.system('게임이 시작되었습니다. 나의 역할을 조용히 확인해 주세요. 채팅은 모든 단계에서 사용할 수 없습니다.'); this.setPhase('reveal',8);
  }
  victory(){
    const alive=this.alive(), mafia=alive.some(p=>p.role==='mafia');
    const allied=alive.filter(p=>['mafia','traitor'].includes(p.role)).length;
    if(!mafia)this.winner='citizen'; else if(allied>=alive.length-allied)this.winner='mafia';
    if(this.winner){this.nightStep=null;this.actions={};this.system(`${this.winner==='mafia'?'밀정 측':'독립군 측'}이 승리했습니다. 모든 역할을 공개합니다.`);this.setPhase('ended',0);return true;}return false;
  }
  nightSequence(){return this.day===1?['traitor','detective']:['mafia','doctor','detective'];}
  beginNight(){
    this.actions={};this.voteCandidates=[];this.voteRound=0;
    this.enterNightStep(this.nightSequence()[0]);
  }
  enterNightStep(step){
    this.nightStep=step;
    if(step==='traitor'){
      const mafia=this.players.find(p=>p.role==='mafia');
      for(const p of this.alive().filter(p=>p.role==='traitor'))p.knownMafia=mafia?.id||null;
    }
    this.system(`${this.day}일차 밤 · ${ROLE_NAMES[step]} 행동 시간입니다.`);
    // Every slot lasts the full configured time, even if that role is eliminated.
    this.setPhase('night',this.settings.nightSeconds);this.botActions();
  }
  resolveNight(){
    const alive=this.alive();
    for(const p of alive.filter(p=>p.role==='detective')){
      const t=this.players.find(x=>x.id===this.actions[p.id]);
      if(t)p.notes.push({day:this.day,name:t.name,mafia:t.role==='mafia'});
    }
    if(this.day>1){
      const attacker=alive.find(p=>p.role==='mafia'),doctor=alive.find(p=>p.role==='doctor');
      const victim=alive.find(p=>p.id===this.actions[attacker?.id]);
      if(victim&&this.actions[doctor?.id]!==victim.id){victim.alive=false;this.system(`${victim.name} 님이 밤사이 탈락했습니다. 역할은 공개되지 않습니다.`);}
      else this.system('아침이 밝았습니다. 지난밤에는 아무도 탈락하지 않았습니다.');
    }else this.system('첫날 아침입니다. 첫날 밤에는 공격과 보호가 없습니다.');
    this.actions={};this.nightStep=null;
    if(!this.victory()){this.system('낮 토론은 최대 5분입니다. 생존한 사람 플레이어 전원이 동의하면 즉시 투표를 시작합니다. 연습 봇과 탈락자는 동의 대상에서 제외됩니다. 시간이 끝나도 자동으로 투표가 시작됩니다. 채팅은 사용할 수 없습니다.');this.setPhase('day',300);}
  }
  dayVoteAgreement(p,{agree,day,discussionId}={}){
    if(!this.players.includes(p)||p.bot||!p.alive||!p.connected)throw Error('접속 중인 생존한 사람 플레이어만 동의할 수 있습니다.');
    if(this.phase!=='day')throw Error('낮 토론 중에만 투표 시작에 동의할 수 있습니다.');
    if(day!==this.day||discussionId!==this.discussionId)throw Error('지난 토론의 요청입니다. 현재 화면에서 다시 시도해 주세요.');
    if(typeof agree!=='boolean')throw Error('동의 여부를 확인해 주세요.');
    if(agree)this.dayVoteAgreements.add(p.id);else this.dayVoteAgreements.delete(p.id);
    const eligible=this.alive().filter(x=>!x.bot);
    if(eligible.length&&eligible.every(x=>x.connected&&this.dayVoteAgreements.has(x.id))){
      this.system('생존한 사람 플레이어 전원이 동의하여 토론을 마칩니다. 투표를 시작합니다.');
      this.beginVote();
    }else this.changed();
  }
  disconnectPlayer(p){
    // Disconnected humans still count toward unanimity, but lose prior agreement.
    this.dayVoteAgreements.delete(p.id);p.connected=false;p.socketId=null;
  }
  beginVote(candidates=this.alive().map(p=>p.id),revote=false){
    if(revote?this.phase!=='vote':this.phase!=='day')return;
    this.actions={};this.voteCandidates=candidates;this.voteRound=revote?this.voteRound+1:1;
    this.system(revote?'동점 또는 투표 없음입니다. 지정된 후보들만 대상으로 재투표합니다.':'투표 시간입니다. 밀정으로 의심되는 한 명을 지목해 주세요. 기권은 없습니다.');
    this.setPhase('vote',this.settings.voteSeconds);this.botActions();
  }
  resolveVote(){
    const values=Object.values(this.actions).filter(id=>this.voteCandidates.includes(id));
    const tally=Object.create(null);for(const v of values)tally[v]=(tally[v]||0)+1;
    this.system(`투표 결과: ${Object.entries(tally).map(([id,n])=>`${this.players.find(p=>p.id===id)?.name} ${n}표`).join(' · ')||'투표 없음'}.`);
    const top=leaders(values);
    if(top.length!==1){this.beginVote(top.length?top:this.voteCandidates,true);return;}
    const victim=this.alive().find(p=>p.id===top[0]);
    victim.alive=false;
    this.system(`${victim.name} 님이 밀정으로 지목되어 탈락했습니다.${victim.role==='mafia'?' 밀정이 맞습니다.':' 역할은 게임 종료 시 공개됩니다.'}`);
    this.actions={};if(!this.victory()){this.day++;this.beginNight();}
  }
  advance(){
    if(this.phase==='reveal')this.beginNight();
    else if(this.phase==='night'){
      const sequence=this.nightSequence(),next=sequence[sequence.indexOf(this.nightStep)+1];
      if(next)this.enterNightStep(next);else this.resolveNight();
    }else if(this.phase==='day')this.beginVote();
    else if(this.phase==='vote')this.resolveVote();
  }
  action(p,target){
    if(!this.players.includes(p))throw Error('참가자를 확인할 수 없습니다.');
    if(!p.alive)throw Error('탈락한 플레이어는 행동할 수 없습니다.');
    if(!['night','vote'].includes(this.phase))throw Error('지금은 대상을 선택할 수 없습니다.');
    if(this.phase==='night'&&(p.role!==this.nightStep||p.role==='traitor'))throw Error('지금은 이 역할의 행동 순서가 아닙니다.');
    if(Object.hasOwn(this.actions,p.id))throw Error('이미 선택을 확정했습니다.');
    const t=this.alive().find(x=>x.id===target);if(!t)throw Error('생존한 플레이어를 선택해 주세요. 기권은 없습니다.');
    if(this.phase==='vote'){
      if(!this.voteCandidates.includes(t.id))throw Error('재투표 후보 중에서 선택해 주세요.');
    }else{
      if(p.role==='mafia'&&t.id===p.id)throw Error('자신은 공격할 수 없습니다.');
      if(p.role==='detective'&&t.id===p.id)throw Error('자신은 조사할 수 없습니다.');
    }
    this.actions[p.id]=target;
    if(this.phase==='vote'&&!this.processingBots&&this.alive().every(x=>Object.hasOwn(this.actions,x.id)))this.advance();
    else this.changed();
  }
  botActions(){
    this.processingBots=true;
    try{
      for(const p of this.alive().filter(x=>x.bot)){
        if(this.phase==='night'&&(p.role!==this.nightStep||p.role==='traitor'))continue;
        if(!['night','vote'].includes(this.phase))continue;
        const targets=this.alive().filter(x=>this.phase==='vote'?this.voteCandidates.includes(x.id):p.role==='doctor'||x.id!==p.id);
        const t=choose(targets);if(t)this.action(p,t.id);
      }
    }finally{this.processingBots=false;}
  }
  reset(){
    if(this.phase!=='ended')throw Error('게임 종료 후에만 대기실로 돌아갈 수 있습니다.');
    clearTimeout(this.timer);this.phaseVersion++;this.dayVoteAgreements.clear();this.discussionId=null;this.phase='lobby';this.deadline=null;this.actions={};this.winner=null;this.day=0;
    this.nightStep=null;this.voteCandidates=[];this.voteRound=0;
    this.players=this.players.filter(p=>p.connected||p.bot);
    this.players.forEach(p=>{p.role=null;p.alive=true;p.ready=p.bot||p.id===this.hostId;p.notes=[];p.knownMafia=null;});
    this.messages=[];this.system('새 게임을 준비합니다.');this.changed();
  }
  stateFor(me){
    const eligible=this.phase==='day'?this.alive().filter(p=>!p.bot):[];
    const agreedIds=eligible.filter(p=>p.connected&&this.dayVoteAgreements.has(p.id)).map(p=>p.id);
    return {
      dayVoteAgreement:{discussionId:this.discussionId,total:eligible.length,agreed:agreedIds.length,agreedIds,offline:eligible.filter(p=>!p.connected).length},
      code:this.code,hostId:this.hostId,phase:this.phase,day:this.day,nightStep:this.nightStep,voteCandidates:this.voteCandidates,voteRound:this.voteRound,deadline:this.deadline,serverTime:Date.now(),settings:{...this.settings,daySeconds:300},winner:this.winner,
      players:this.players.map(p=>({id:p.id,name:p.name,bot:p.bot,connected:p.connected,ready:p.ready,alive:p.alive,...(this.phase==='ended'?{role:p.role}:{})})),
      me:{id:me.id,role:me.role,alive:me.alive,notes:me.notes,chosen:this.actions[me.id]||null,teammates:me.role==='traitor'&&me.knownMafia?[me.knownMafia]:[]},
      submitted:this.phase==='vote'?Object.keys(this.actions):[],
      messages:this.messages.filter(m=>m.channel==='system')
    };
  }
  destroy(){clearTimeout(this.timer);this.phaseVersion++;this.dayVoteAgreements.clear();this.discussionId=null;}
}
module.exports={GameRoom,ROLE_NAMES,plurality};
