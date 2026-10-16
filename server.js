'use strict';
const express=require('express');
const http=require('node:http');
const path=require('node:path');
const {randomInt}=require('node:crypto');
const {Server}=require('socket.io');
const {GameRoom}=require('./game');
const app=express();const server=http.createServer(app);
const io=new Server(server,{maxHttpBufferSize:8192,serveClient:true});
const rooms=new Map();
app.disable('x-powered-by');
app.use((req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ws: wss:; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");next();});
app.get('/health',(_req,res)=>res.json({ok:true}));
app.use(express.static(path.join(__dirname,'public')));
function broadcast(room){for(const p of room.players){if(p.socketId)io.to(p.socketId).emit('state',room.stateFor(p));}}
function code(){const a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let c;do{c=Array.from({length:6},()=>a[randomInt(a.length)]).join('');}while(rooms.has(c));return c;}
const cleanName=v=>{if(typeof v!=='string')throw Error('닉네임을 입력해 주세요.');const n=v.trim();if(n.length<2||n.length>12||/[\x00-\x1f<>]/.test(n))throw Error('닉네임은 2~12자이며 특수 꺾쇠 문자는 사용할 수 없습니다.');return n;};
io.on('connection',socket=>{
  let timestamps=[];
  const handle=(event,fn)=>socket.on(event,(data,ack)=>{
    const reply=typeof ack==='function'?ack:()=>{};
    try{
      const now=Date.now();timestamps=timestamps.filter(t=>now-t<10000);if(timestamps.length>=35)throw Error('요청이 너무 빠릅니다. 잠시 기다려 주세요.');timestamps.push(now);
      const result=fn(data&&typeof data==='object'?data:{});reply({ok:true,...result});
    }catch(e){reply({ok:false,error:e.message||'요청을 처리하지 못했습니다.'});}
  });
  function current(){const r=rooms.get(socket.data.code),p=r?.players.find(x=>x.id===socket.data.playerId&&x.socketId===socket.id);if(!r||!p)throw Error('방에 먼저 입장해 주세요.');return [r,p];}
  function host(){const [r,p]=current();if(r.hostId!==p.id)throw Error('방장만 사용할 수 있습니다.');return [r,p];}
  function attach(r,p){socket.data.code=r.code;socket.data.playerId=p.id;p.connected=true;p.socketId=socket.id;if(!r.players.some(x=>x.id===r.hostId&&x.connected&&!x.bot&&x.socketId)){r.hostId=p.id;p.ready=true;}broadcast(r);return {session:{code:r.code,token:p.token},state:r.stateFor(p)};}
  function requireNoRoom(){if(socket.data.code)throw Error('현재 방에서 먼저 나가 주세요.');}
  handle('create',d=>{requireNoRoom();const name=cleanName(d.name);if(rooms.size>=500)throw Error('서버가 혼잡합니다. 나중에 다시 시도해 주세요.');const r=new GameRoom(code(),broadcast);rooms.set(r.code,r);const p=r.add(name);return attach(r,p);});
  handle('join',d=>{requireNoRoom();const r=rooms.get(String(d.code||'').toUpperCase());if(!r)throw Error('방을 찾을 수 없습니다. 초대 코드를 확인해 주세요.');const p=r.add(cleanName(d.name));r.system(`${p.name} 님이 입장했습니다.`);return attach(r,p);});
  handle('resume',d=>{
    requireNoRoom();const r=rooms.get(String(d.code||''));const p=r?.players.find(x=>x.token===d.token&&!x.bot);if(!p)throw Error('저장된 방이 만료되었습니다. 새로 입장해 주세요.');
    if(p.socketId&&p.socketId!==socket.id){const old=io.sockets.sockets.get(p.socketId);if(old){old.emit('replaced');old.data={};old.disconnect(true);}}
    return attach(r,p);
  });
  handle('ready',()=>{const[r,p]=current();if(r.phase!=='lobby')throw Error('대기실에서만 준비할 수 있습니다.');p.ready=!p.ready;r.changed();});
  handle('settings',d=>{const[r]=host();if(r.phase!=='lobby')throw Error('게임 중에는 설정할 수 없습니다.');
    if(d.daySeconds!==undefined&&d.daySeconds!==300)throw Error('낮 토론은 300초(5분)로 고정됩니다.');
    for(const k of ['nightSeconds','voteSeconds'])if(d[k]!==undefined&&!([15,30,45,60].includes(d[k])))throw Error('지원하지 않는 시간 설정입니다.');
    for(const k of ['nightSeconds','voteSeconds'])if(d[k]!==undefined)r.settings[k]=d[k];r.settings.daySeconds=300;r.changed();});
  handle('addBot',()=>{const[r]=host();const names=['안개','루나','도일','레오','노아','이브','시온','로이','제인','테오','에덴'];const name=names.find(n=>!r.players.some(p=>p.name===`${n} BOT`));r.add(`${name||'연습'} BOT`,true);});
  handle('removeBot',d=>{const[r]=host();if(r.phase!=='lobby')throw Error('대기실에서만 봇을 삭제할 수 있습니다.');r.players=r.players.filter(p=>!(p.id===d.id&&p.bot));r.changed();});
  handle('removeOffline',d=>{const[r]=host();if(r.phase!=='lobby')throw Error('대기실에서만 정리할 수 있습니다.');r.players=r.players.filter(p=>!(p.id===d.id&&!p.connected&&!p.bot));r.changed();});
  handle('start',()=>{const[r]=host();r.start();});
  handle('action',d=>{const[r,p]=current();r.action(p,d.target);});
  handle('voteNow',()=>{current();throw Error('낮 토론은 5분이 지나야 투표로 넘어갑니다.');});
  handle('reset',()=>{const[r]=host();r.reset();});
  handle('chat',()=>{throw Error('모든 채팅이 비활성화되어 있습니다.');});
  handle('leave',()=>{const[r,p]=current();socket.data={};p.connected=false;p.socketId=null;if(r.phase==='lobby')r.players=r.players.filter(x=>x!==p);if(r.hostId===p.id)r.hostId=r.players.find(x=>x.connected&&!x.bot)?.id||null;r.changed();});
  socket.on('disconnect',()=>{
    try{const[r,p]=current();p.connected=false;p.socketId=null;
      if(r.hostId===p.id){const next=r.players.find(x=>x.connected&&!x.bot);if(next){r.hostId=next.id;next.ready=true;}}
      r.changed();
    }catch{}
  });
});
const cleanup=setInterval(()=>{for(const[c,r]of rooms){const inactive=!r.players.some(p=>!p.bot&&p.connected);if(inactive&&!r.emptySince)r.emptySince=Date.now();if(!inactive)r.emptySince=null;if(inactive&&Date.now()-r.emptySince>15*60*1000){r.destroy();rooms.delete(c);}else if(Date.now()-r.createdAt>24*60*60*1000){for(const p of r.players)if(p.socketId)io.to(p.socketId).emit('expired');r.destroy();rooms.delete(c);}}},60000);cleanup.unref();
if(require.main===module){const port=Number(process.env.PORT)||3000;server.listen(port,'0.0.0.0',()=>console.log(`MIDNIGHT Mafia ready on port ${port}`));}
module.exports={app,server,io,rooms};
