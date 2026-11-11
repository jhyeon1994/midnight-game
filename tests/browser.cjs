'use strict';
const {chromium,expect}=require('@playwright/test');const assert=require('node:assert/strict');const fs=require('node:fs');
const {server,io,rooms}=require('../server');
(async()=>{
 fs.mkdirSync('artifacts',{recursive:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url=`http://127.0.0.1:${server.address().port}`;const browser=await chromium.launch({headless:true});const errors=[];
 try{
  async function page(width=1360,height=970){const ctx=await browser.newContext({viewport:{width,height},locale:'ko-KR'});const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});return p;}
  const host=await page();await host.goto(url);await expect(host.locator('#connection')).toContainText('서버 연결됨');await host.evaluate(()=>document.fonts.ready);
  await expect(host.locator('.role-card')).toHaveCount(5);await expect(host.locator('.role-card.traitor')).toContainText('친일파');await host.screenshot({path:'artifacts/01-home-desktop.png',fullPage:true});
  await host.getByRole('button',{name:'게임 가이드'}).click();await expect(host.locator('#rules-dialog')).toContainText('5~12명');await host.getByRole('button',{name:'좋아요, 시작할게요'}).click();
  const mobile=await page(390,844);await mobile.goto(url);await mobile.evaluate(()=>document.fonts.ready);await mobile.screenshot({path:'artifacts/02-home-mobile.png',fullPage:true});assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await host.locator('#nickname').fill('밤의여행자');await host.getByRole('button',{name:'새로운 방 만들기'}).click();await expect(host.locator('.room-heading h1')).toHaveText('한밤의 대기실');const code=await host.locator('.code-tag strong').innerText();
  const guests=[];for(const name of ['달빛탐정','라일락','모노','새벽산책','노을빛']){const p=await page(1180,900);await p.goto(`${url}/?room=${code}`);await p.locator('#nickname').fill(name);await p.getByRole('button',{name:'참여하기'}).click();await p.getByRole('button',{name:'준비 완료 ✓',exact:true}).click();guests.push(p);}
  const pages=[host,...guests];const room=rooms.get(code);
  await expect(host.locator('.players-grid .player')).toHaveCount(6);await expect(host.locator('[data-setting="daySeconds"]')).toBeDisabled();await expect(host.locator('[data-setting="daySeconds"]')).toHaveValue('300');
  for(const p of pages)await expect(p.locator('#chat-input, #chat-form')).toHaveCount(0);
  await expect(host.locator('.chat-panel')).toContainText('모든 채팅이 비활성화');await host.screenshot({path:'artifacts/03-lobby-desktop.png',fullPage:true});
  await host.setViewportSize({width:390,height:844});await host.screenshot({path:'artifacts/04-lobby-mobile.png',fullPage:true});assert.ok(await host.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await host.setViewportSize({width:1360,height:970});
  await host.getByRole('button',{name:'밤을 시작하기'}).click();await expect(host.locator('.private-role')).toBeVisible();
  // Deterministic fixture only in this test: host spy, then traitor, investigator, doctor, two citizens.
  const roleKeys=['mafia','traitor','detective','doctor','citizen','citizen'];room.players.forEach((p,i)=>p.role=roleKeys[i]);room.changed();
  await expect(guests[0].locator('.private-role strong')).toHaveText('친일파');assert.equal(await guests[0].locator('.private-description').innerText().then(t=>t.includes('확인한 밀정:')),false);
  // Exercise actual reveal timer before advancing subsequent slots manually.
  await expect(host.locator('.phase-copy h2')).toContainText('친일파 행동 시간',{timeout:12000});await expect(guests[0].locator('.private-description')).toContainText('확인한 밀정: 밤의여행자');
  await expect(host.locator('[data-target]')).toHaveCount(0);await expect(guests[1].locator('[data-target]')).toHaveCount(0);
  const oldId=await guests[0].evaluate(()=>state.me.id);await guests[0].reload();await expect(guests[0].locator('.private-description')).toContainText('확인한 밀정: 밤의여행자');assert.equal(await guests[0].evaluate(()=>state.me.id),oldId);
  await guests[0].screenshot({path:'artifacts/05-traitor-identity.png',fullPage:true});
  async function select(p,id){await p.locator(`[data-target="${id}"]`).click();await p.getByRole('button',{name:'선택 확정하기'}).click();}
  room.advance();await expect(guests[1].locator('[data-target]')).toHaveCount(5);await select(guests[1],room.players[0].id);await expect(guests[1].getByRole('button',{name:'선택 완료'})).toBeDisabled();
  room.advance();await expect(host.locator('.phase-copy h2')).toContainText('누구의 말을 믿을까요');await expect(host.locator('#countdown')).toHaveText(/0[45]:[0-5][0-9]/);await expect(host.locator('[data-do="voteNow"]')).toHaveCount(0);await expect(guests[1].locator('.notes')).toContainText('밀정입니다');
  await host.screenshot({path:'artifacts/06-day-five-minutes.png',fullPage:true});
  await expect(host.locator('[data-do="dayVoteAgreement"]')).toBeEnabled();
  await expect(host.locator('.action-panel')).toContainText('투표 시작 동의 0 / 6명');
  await host.getByRole('button',{name:'투표 시작에 동의하기',exact:true}).click();
  await expect(host.getByRole('button',{name:'동의 취소하기',exact:true})).toBeEnabled();
  await expect(guests[0].locator('.action-panel')).toContainText('투표 시작 동의 1 / 6명');
  await host.getByRole('button',{name:'동의 취소하기',exact:true}).click();
  await expect(host.locator('.action-panel')).toContainText('투표 시작 동의 0 / 6명');
  // Desktop and mobile width share the same consent control.
  await host.setViewportSize({width:390,height:844});
  await host.getByRole('button',{name:'투표 시작에 동의하기',exact:true}).click();
  await expect(host.getByRole('button',{name:'동의 취소하기',exact:true})).toBeEnabled();
  assert.ok(await host.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await host.screenshot({path:'artifacts/09-consent-mobile.png',fullPage:true});
  await host.setViewportSize({width:1360,height:970});
  const disconnected=guests[4];
  await disconnected.getByRole('button',{name:'투표 시작에 동의하기',exact:true}).click();
  await expect(host.locator('.action-panel')).toContainText('투표 시작 동의 2 / 6명');
  await disconnected.evaluate(()=>socket.disconnect());
  await expect(disconnected.locator('[data-do="dayVoteAgreement"]')).toBeDisabled();
  await expect(host.locator('.action-panel')).toContainText('투표 시작 동의 1 / 6명');
  await expect(host.locator('.action-panel')).toContainText('연결이 끊긴 참가자');
  await disconnected.evaluate(()=>socket.connect());
  await expect(disconnected.getByRole('button',{name:'투표 시작에 동의하기',exact:true})).toBeEnabled();
  for(const guest of guests.slice(0,4)){
   await guest.getByRole('button',{name:'투표 시작에 동의하기',exact:true}).click();
   await expect(guest.getByRole('button',{name:'동의 취소하기',exact:true})).toBeEnabled();
  }
  await expect(host.locator('.action-panel')).toContainText('투표 시작 동의 5 / 6명');
  assert.equal(room.phase,'day');await host.screenshot({path:'artifacts/10-consent-desktop.png',fullPage:true});
  await disconnected.getByRole('button',{name:'투표 시작에 동의하기',exact:true}).click();
  await expect(host.locator('.phase-copy h2')).toContainText('선택할 시간');await select(host,room.players[4].id);await select(guests[0],room.players[5].id);room.advance();
  await expect(host.locator('.phase-copy h2')).toContainText('재투표 1차');for(const p of pages)await expect(p.locator('[data-target]')).toHaveCount(2);await expect(host.locator('[data-do="confirmAction"]')).toBeDisabled();
  await host.screenshot({path:'artifacts/07-tied-revote.png',fullPage:true});
  await select(guests[1],room.players[4].id);room.advance();await expect(host.locator('.phase-copy h2')).toContainText('2일차 · 밀정 행동');await expect(guests[3].locator('.action-panel')).toContainText('당신은 탈락');
  await expect(guests[2].locator('[data-target]')).toHaveCount(0);await select(host,room.players[5].id);room.advance();await expect(guests[2].locator('.phase-copy h2')).toContainText('한국인 의사 행동');await select(guests[2],room.players[5].id);room.advance();await select(guests[1],room.players[0].id);room.advance();await expect(host.locator('.phase-copy h2')).toContainText('2일차 · 누구의 말을');assert.equal(room.players[5].alive,true);
  await expect(host.locator('.action-panel')).toContainText('투표 시작 동의 0 / 5명');
  await expect(guests[3].locator('[data-do="dayVoteAgreement"]')).toHaveCount(0);
  await expect(guests[3].locator('.action-panel')).toContainText('관전만 가능합니다');
  room.advance();for(const p of pages){if(await p.evaluate(()=>state.me.alive))await select(p,room.players[0].id);}
  await expect(host.locator('.result h2')).toHaveText('독립군 측 승리');for(const p of pages)await expect(p.locator('#chat-input')).toHaveCount(0);await host.screenshot({path:'artifacts/08-game-result.png',fullPage:true});
  const practice=await page(390,844);await practice.goto(url);await practice.getByRole('button',{name:'혼자 먼저 둘러보기',exact:false}).click();await expect(practice.locator('.players-grid .player')).toHaveCount(6);await expect(practice.getByRole('button',{name:'밤을 시작하기'})).toBeEnabled();
  await practice.getByRole('button',{name:'밤을 시작하기'}).click();
  const practiceCode=await practice.locator('.code-tag strong').innerText(),practiceRoom=rooms.get(practiceCode);
  practiceRoom.advance();practiceRoom.advance();practiceRoom.advance();
  await expect(practice.locator('.action-panel')).toContainText('투표 시작 동의 0 / 1명');
  await practice.getByRole('button',{name:'투표 시작에 동의하기',exact:true}).click();
  await expect(practice.locator('.phase-copy h2')).toContainText('선택할 시간');
  assert.equal(practiceRoom.phase,'vote');
  assert.deepEqual(errors,[],'Browser JavaScript/CSP errors');
  const report='PASS: Chromium desktop/mobile; six independent browser participants.\nFive role cards, guide, role assignment fixture, lobby, fixed 300-second setting, no chat UI, actual reveal timer, traitor-only identity, reload/reconnect, first-night detective investigation, five-minute countdown, unanimous early voting, consent cancellation, disconnect revocation, reconnect, eliminated observer, tie/revote candidates, wrong identification elimination, sequential second night, protection, final victory, solo-human consent with practice bots.\nSubsequent phase transitions manually advanced for test speed; full 300-second scheduling covered separately by Node mock timer test.\nNo JavaScript/CSP errors; no mobile horizontal overflow.\n';console.log(report);fs.writeFileSync('artifacts/browser-tests.txt',report);
 }finally{await browser.close();for(const r of rooms.values())r.destroy();await new Promise(r=>io.close(r));}
})().catch(e=>{console.error(e);process.exit(1)});
