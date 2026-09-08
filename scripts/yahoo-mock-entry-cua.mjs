'use strict';

// Entry helper for the explicitly authorized free, eight-team standard mock.
// This is deliberately not a real-league entry or unattended background job.
// Load this module and the tested controller directly into CUA; do not paste
// an older wrapper or attach screenshots to the clock-sensitive methods.
function verifyStandardMockSettings(text, run) {
  const expected = {QB:1,WR:2,RB:2,TE:1,'W/R/T':1,K:1,DEF:1,BN:6,IR:0};
  const configured = run.rules?.roster || {};
  if (run.teamCount !== 8 || run.rounds !== 15 || run.rules.receptionPoints !== .5
      || run.rules.passingTouchdown !== 4
      || Object.entries(expected).some(([p,n])=>Number(configured[p]||0)!==n)
      || Object.keys(configured).some(p=>!(p in expected))) throw Error('Entry helper requires the verified standard mock configuration');
  const roster = 'Roster Positions (15)\nQB\nWR\n2\nRB\n2\nTE\nW/R/T\nK\nDEF\nBN\n6';
  if (!text.includes(roster) || !text.includes('Draft Pick Time\n30 seconds')
      || !text.includes('Rec - Receptions\n0.5') || !text.includes('Pass TD - Passing Touchdowns\n4')) {
    throw Error('Yahoo room settings differ from the prepared standard mock; no pick submitted');
  }
  for (const [position,maximum] of Object.entries(run.rules.rosterMaximums||{})) {
    if (!new RegExp(`(?:^|[,\\n]\\s*)${position}: ${maximum}(?:,|\\n|$)`).test(text)) throw Error(`Unverified ${position} maximum`);
  }
  return true;
}

async function enterStandardMock(run, {waitMs=20000}={}) {
  const tab=run.yahoo;
  const until=Date.now()+Math.min(25000,Math.max(0,waitMs));
  let gate;
  do {
    gate=await tab.playwright.evaluate(()=>({
      text:document.body.innerText.slice(0,1800),
      countdown:document.querySelector('#waiting_room-countdown')?.innerText,
      path:location.pathname,
      live:Boolean(document.querySelector('button[title="Settings"]')),
      enter:[...document.querySelectorAll('a')].some(a=>a.innerText.trim()==='Enter Draft')
    }));
    if(gate.enter || gate.live) break;
    if(Date.now()<until)await tab.playwright.waitForTimeout(300);
  } while(Date.now()<until);
  if(!gate.enter && !gate.live)return {entryWaiting:true,countdown:gate.countdown};
  if(gate.live) {
    if(gate.path!==`/draftclient/f1/${run.roomId}/${run.draftSlot}`)throw Error('Auto-entered room or seat does not match');
  } else if(!gate.text.includes(String(run.roomId)) || !gate.text.includes(`You will draft ${run.draftSlot}th`))throw Error('Waiting room or assigned seat does not match');
  run.events.push({stage:'enter-room',at:Date.now()});
  if(!gate.live)await tab.playwright.getByRole('link',{name:'Enter Draft',exact:true}).click({timeoutMs:4000});
  await tab.playwright.locator('button[title="Settings"]').click({timeoutMs:4000});
  await tab.playwright.getByRole('button',{name:'League Settings',exact:true}).click({timeoutMs:2000});
  const settings=await tab.playwright.evaluate(()=>document.body.innerText.slice(document.body.innerText.lastIndexOf('League Settings')));
  verifyStandardMockSettings(settings,run);
  run.verifiedSettingsText=settings;
  run.events.push({stage:'room-rules-verified',at:Date.now()});
  await tab.playwright.locator('button').filter({has:tab.playwright.locator('[data-icon="close-default"]')}).click({timeoutMs:2000});
  // No tool/model handoff, media operation, or separate initial import here.
  return run.startVerified();
}
export {enterStandardMock,verifyStandardMockSettings};
