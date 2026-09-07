'use strict';

// Local fixture server only. It neither connects to Yahoo nor drives a browser.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const fixture = fs.readFileSync(path.join(__dirname, '../test/fixtures/mock-10980489.tsv'), 'utf8').trim().split('\n').map((line) => {
  const [, name, position, team] = line.trim().split('\t');
  return { name, position, team };
});
for (let i = 0; i < 240; i += 1) fixture.push({ name: `Replay Player ${i + 1}`, position: ['QB', 'RB', 'WR', 'TE', 'K'][i % 5], team: 'BUF' });
const defenses = { ARI: 'Cardinals', ATL: 'Falcons', BAL: 'Ravens', BUF: 'Bills', CAR: 'Panthers', CHI: 'Bears', CIN: 'Bengals', CLE: 'Browns', DAL: 'Cowboys', DEN: 'Broncos', DET: 'Lions', GB: 'Packers', HOU: 'Texans', IND: 'Colts', JAC: 'Jaguars', KC: 'Chiefs', LV: 'Raiders', LAC: 'Chargers', LAR: 'Rams', MIA: 'Dolphins', MIN: 'Vikings', NE: 'Patriots', NO: 'Saints', NYG: 'Giants', NYJ: 'Jets', PHI: 'Eagles', PIT: 'Steelers', SF: '49ers', SEA: 'Seahawks', TB: 'Buccaneers', TEN: 'Titans', WAS: 'Commanders' };
for (const [team, name] of Object.entries(defenses)) if (!fixture.some((p) => p.position === 'DEF' && p.team === team)) fixture.push({ name, position: 'DEF', team });
const players = fixture.map((p, index) => ({ ...p, id: index + 1, expertRank: index + 1, adp: index + 2, projectedPoints: Math.max(5, ({ QB: 340, RB: 290, WR: 280, TE: 240, K: 150, DEF: 140 }[p.position]) - index * 0.7) }));
const template = fs.readFileSync(path.join(__dirname, '../test/fixtures/mock-browser-rehearsal.html'), 'utf8');
const server = http.createServer((request, response) => {
  if (request.url !== '/') { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  response.end(template.replace('/* REPLAY_PLAYERS */[]', JSON.stringify(players).replace(/</g, '\\u003c')));
});
server.listen(8792, '127.0.0.1', () => console.log('Local timed rehearsal: http://127.0.0.1:8792/ — synthetic projections, no Yahoo connection'));
