'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
let createYahooLiveRoom, parseYahooObservation, readYahooDocument;
test.before(async () => ({ createYahooLiveRoom, parseYahooObservation, readYahooDocument } = await import('../scripts/yahoo-live-cua-adapter.mjs')));
const identity = { origin: 'https://football.fantasysports.yahoo.com', path: '/draftclient/f1/12345678/8',
  leagueKey: 'nfl.l.12345678', teamKey: 'nfl.l.12345678.t.8', draftSlot: 8, totalPicks: 120 };
const row = { cells: ['', 'Test Player\nRB\nDet\nBye 6', '1', '1.3', '6', '330.37'],
  yahooPlayerId: '12345', title: 'Test Player', buttons: [] };
function fixture() {
  // Yahoo inserts TH-only "Your Turn" rows in TBODY alongside ordinary players.
  const raw = { origin: identity.origin, path: identity.path, header: '00:37\nDraft Starting Soon',
    observedAt: new Date().toISOString(), autoKnown: true, autodraft: false, playersSelected: true,
    tables: [{ kind: 'players', headers: ['Queue', 'Player', 'XRank', 'ADP', 'Bye', 'Proj Pts'],
      rows: [structuredClone(row), { cells: [], title: null, buttons: [] }] }], buttons: [] };
  const actions = [];
  const room = createYahooLiveRoom({ identity, tab: { playwright: {
    evaluate: async () => structuredClone(raw), getByRole: () => { actions.push('unexpected UI action'); throw Error('No action expected'); }
  } } });
  return { raw, room, actions };
}
test('actual Yahoo turn separators do not become candidate players', async () => {
  const f = fixture();
  const result = await f.room.prepare([{ yahooPlayerId: '12345', position: 'RB', team: 'DET' }]);
  assert.equal(result.players.length, 1);
  assert.equal(result.players[0].yahooPlayerId, '12345');
  assert.deepEqual(f.actions, []);
});
test('malformed data rows and duplicate numeric identities still fail closed', async () => {
  for (const badRow of [{ cells: ['', 'Unknown\nRB\nDet'], buttons: [] }, structuredClone(row)]) {
    const f = fixture(); f.raw.tables[0].rows = [structuredClone(row), badRow];
    await assert.rejects(f.room.prepare([{ yahooPlayerId: '12345', position: 'RB' }]), { code: badRow.yahooPlayerId ? 'PLAYER_IDENTITY_MISMATCH' : 'PLAYER_IDENTITY_UNREADABLE' });
    assert.deepEqual(f.actions, []);
  }
});
test('room mismatch records the actual and expected route without authentication query strings', () => {
  assert.throws(() => parseYahooObservation({ origin: identity.origin, path: '/draftclient/f1/87654321/8', url: identity.origin + '/?auth=private' }, identity), error => {
    assert.equal(error.code, 'ROOM_MISMATCH');
    assert.deepEqual(error.details, { expected: { origin: identity.origin, path: identity.path }, observed: { origin: identity.origin, path: '/draftclient/f1/87654321/8' } });
    assert.doesNotMatch(JSON.stringify(error), /private|auth=/);
    return true;
  });
});

test('Yahoo short countdown seconds are read only next to the current turn label', () => {
  for (const seconds of [0, 3, 9]) {
    const raw = {...fixture().raw,header:`YAHOO FANTASY FOOTBALL DRAFT\nFlea Flicker - H2H\n${seconds}\nYOUR TURN • ROUND 1, PICK 8\nLast:\nPlayer`};
    assert.equal(parseYahooObservation(raw,identity).secondsLeft,seconds);
  }
  for (const header of ['3\nUnrelated number\nYOUR TURN • ROUND 1, PICK 8', '00:99\nYOUR TURN • ROUND 1, PICK 8',
    '00:30\n3\nYOUR TURN • ROUND 1, PICK 8']) assert.throws(()=>parseYahooObservation({...fixture().raw,header},identity),{code:'ROOM_CLOCK_UNREADABLE'});
});

test('Results navigation uses observed tab roles and waits for the selected table without repeating input', async () => {
  for (const role of ['tab','button']) {
    const raw=fixture().raw, actions=[];
    raw.buttons=[{text:'Players',name:'Players',role},{text:'Results',name:'Results',role}];
    let pending=null, reads=0, subtabDelay=0;
    const room=createYahooLiveRoom({identity,tab:{playwright:{
      evaluate:async()=>{
        if(subtabDelay && --subtabDelay===0) raw.buttons.push({text:'Round by Round',name:'Round by Round',role});
        if(pending&&++reads>=2){
          if(pending==='Results') {raw.resultsSelected=true;raw.playersSelected=false;subtabDelay=2;raw.tables=[{kind:'other',headers:['Slot','Player','Bye','Pick'],rows:[]}];}
          else {raw.roundsSelected=true;raw.tables=[{kind:'results',headers:['Pick','Player','Team'],rows:[]}];}
          pending=null;
        }
        return structuredClone(raw);
      },
      waitForTimeout:async()=>{},
      getByRole:(observed,options)=>({press:async key=>{assert.equal(observed,role);assert.equal(key,'Enter');actions.push(options.name);pending=options.name;reads=0;}})
    }}});
    const result=await room.results();assert.deepEqual(result.picks,[]);
    assert.deepEqual(actions,['Results','Round by Round']);assert.equal(raw.roundsSelected,true);
  }
});

test('DOM reader separates column headings and direct data cells from turn dividers and nested tables', () => {
  const vm = require('node:vm');
  const visible = { getClientRects: () => [{}] };
  const cell = (innerText, tagName = 'TD') => ({ ...visible, innerText, tagName });
  const headings = ['Queue', 'Player', 'XRank', 'ADP', 'Bye', 'Proj Pts'].map(text => cell(text, 'TH'));
  const dividerCell = cell('YOUR TURN - 8TH PICK', 'TH');
  const cells = row.cells.map(text => cell(text));
  const nestedCell = cell('Nested detail, not an extra player column');
  const player = { ...visible, cells,
    querySelector: selector => selector === '.ys-player[data-id]' ? { getAttribute: () => '12345' } : { getAttribute: () => 'Test Player' },
    querySelectorAll: selector => selector === 'td' ? [...cells, nestedCell] : [] };
  const divider = { ...visible, cells: [dividerCell], querySelector: () => null, querySelectorAll: () => [] };
  const nestedRow = { ...visible, cells: [nestedCell], querySelector: () => null, querySelectorAll: () => [nestedCell] };
  // HTMLTableSection.rows and HTMLTableRow.cells are direct collections; broad
  // descendant queries also contain the nested detail row and its cell.
  const table = { ...visible, tHead: { rows: [{ cells: headings }] }, tBodies: [{ rows: [player, divider] }],
    querySelectorAll: selector => selector === 'th' ? [...headings, dividerCell] : [player, divider, nestedRow] };
  const document = { body: { innerText: 'Draft Starting Soon' }, querySelectorAll: selector => selector === 'table' ? [table] : [] };
  const actual = vm.runInNewContext('(' + readYahooDocument.toString() + ')()', {
    document, location: { origin: identity.origin, pathname: identity.path }, getComputedStyle: () => ({ visibility: 'visible' })
  });
  assert.deepEqual(Array.from(actual.tables[0].headers), headings.map(c => c.innerText));
  assert.equal(actual.tables[0].rows.length, 1);
  assert.deepEqual(Array.from(actual.tables[0].rows[0].cells), row.cells);
});

test('turn observations avoid player-table and unrelated button layout reads while retaining manual-mode evidence', () => {
  const vm=require('node:vm');
  const auto={textContent:'Autodraft',getClientRects:()=>[{}],querySelector:()=>null};
  const unrelated={textContent:'Draft',getClientRects:()=>{throw Error('Do not lay out player controls to read the clock');}};
  const document={body:{innerText:'00:30\nYOUR TURN • ROUND 1, PICK 8\nYou have been put into autopick mode due to inactivity.'},
    querySelectorAll:selector=>{assert.equal(selector,'button');return [unrelated,auto];}};
  const raw=vm.runInNewContext('('+readYahooDocument.toString()+')({turnOnly:true})',{document,location:{origin:identity.origin,pathname:identity.path},getComputedStyle:()=>({visibility:'visible'})});
  assert.equal(raw.autoKnown,true);assert.equal(raw.inactivityNotice,true);assert.equal(raw.tables,undefined);
  const observed=parseYahooObservation(raw,identity);assert.equal(observed.overallPick,8);assert.equal(observed.secondsLeft,30);assert.equal(observed.manualModeKnown,false);
});

test('only the clock observation requests the light reader; player preparation retains exact rows',async()=>{
  const options=[],raw=fixture().raw;
  const room=createYahooLiveRoom({identity,tab:{playwright:{evaluate:async(fn,arg)=>{options.push(arg);return structuredClone(raw);}}}});
  await room.observe();await room.prepare([{yahooPlayerId:'12345',position:'RB',team:'DET'}]);
  assert.equal(options[0]?.turnOnly,true);assert.notEqual(options[1]?.turnOnly,true);
});

test('an acknowledged tab input without a view change permits only one freshly verified idempotent retry',async()=>{
  for(const inputBehavior of ['ignore-first','ignore-all','reject','move-room']) {
    let time=0,inputs=0;const raw=fixture().raw;raw.roundsSelected=true;
    raw.buttons=[{text:'Results',name:'Results',role:'tab'}];
    const room=createYahooLiveRoom({identity,now:()=>time,tab:{playwright:{
      evaluate:async()=>{time+=10;return structuredClone(raw);},waitForTimeout:async ms=>{time+=ms;},
      getByRole:(role,options)=>({press:async()=>{assert.equal(role,'tab');assert.equal(options.name,'Results');inputs++;
        if(inputBehavior==='reject')throw Error('Input response lost');
        if(inputBehavior==='move-room')raw.path='/draftclient/f1/87654321/8';
        if(inputBehavior==='ignore-first'&&inputs===2){raw.resultsSelected=true;raw.playersSelected=false;raw.tables=[{kind:'results',headers:['Pick','Player','Team'],rows:[]}];}
      }})
    }}});
    if(inputBehavior==='ignore-first')assert.deepEqual((await room.results({timeoutMs:4000})).picks,[]);
    else await assert.rejects(room.results({timeoutMs:4000}));
    const terminal=['reject','move-room'].includes(inputBehavior);
    assert.equal(inputs,terminal?1:2);
    assert.equal(room.events().filter(e=>e.type==='navigation-retry').length,terminal?0:1);
  }
});

function queueFixture({ responseLost = false, wrongAdded = false } = {}) {
  const raw = fixture().raw, queue = [{ yahooPlayerId: '99999', text: 'Existing entry' }], paths = [];
  const locator = path => ({
    filter() { return this; }, locator: selector => locator(path + ' > ' + selector),
    getByRole: (role, options) => locator(path + ' role=' + role + ':' + (options?.name || '')),
    evaluate: async () => structuredClone(queue),
    async press(key) {
      paths.push(path); assert.equal(key, 'Enter');
      if (path.includes('role=button:Remove')) { queue.pop(); return; }
      assert.ok(path.includes('.ys-addqueue[data-id="12345"]'), 'Activate the actual unnamed star inside the exact identity container');
      assert.ok(!path.includes('role=button:Queue'), 'The observed star has no accessible Queue label');
      queue.push({ yahooPlayerId: wrongAdded ? '22222' : '12345', text: 'New entry' });
      if (responseLost) throw Error('Acknowledgment lost after queue changed');
    }
  });
  const room = createYahooLiveRoom({ identity, queueContainerSelector: '.queue-items', tab: { playwright: {
    evaluate: async () => structuredClone(raw), locator
  } } });
  return { room, queue, paths };
}
test('the exact-ID queue star is verified after an uncertain input response', async () => {
  const f = queueFixture({ responseLost: true });
  assert.equal((await f.room.enqueue({ yahooPlayerId: '12345', position: 'RB' })).verified, true);
  assert.deepEqual(f.queue.map(p => p.yahooPlayerId), ['99999', '12345']);
  assert.equal(f.paths.length, 1);
  assert.equal(f.room.events()[0].responseUncertain, true);
});
test('a wrong queue addition is removed while the pre-existing queue entry remains', async () => {
  const f = queueFixture({ wrongAdded: true });
  await assert.rejects(f.room.enqueue({ yahooPlayerId: '12345', position: 'RB' }), { code: 'QUEUE_VERIFICATION_FAILED' });
  assert.deepEqual(f.queue.map(p => p.yahooPlayerId), ['99999']);
  assert.equal(f.room.events()[0].restored, true);
});
