'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocketServer, WebSocket } = require('ws');
const { deterministicExplanation } = require('../agent-core/explainer');
const { fleetManifest, fleetStatus } = require('./status');

function appendAudit(runtime, prompt, command, outcome) {
  const record = {
    ts: new Date().toISOString(),
    instance: runtime.instanceName,
    event: 'aegis-read-command',
    command,
    promptSha256: crypto.createHash('sha256').update(prompt).digest('hex'),
    promptLen: prompt.length,
    outcome
  };
  fs.mkdirSync(path.dirname(runtime.auditFile), { recursive: true });
  fs.appendFileSync(runtime.auditFile, `${JSON.stringify(record)}\n`, { mode: 0o600 });
}

function executeReadCommand(prompt, runtime, draftServices) {
  const tokens = String(prompt || '').trim().split(/\s+/);
  const command = (tokens.shift() || '').toLowerCase();
  if (command === 'help') {
    return {
      command,
      value: {
        commands: [
          'status',
          'leagues',
          'sessions <leagueId>',
          'board <leagueId> <sessionId>',
          'recommendation <leagueId> <sessionId>',
          'help'
        ],
        policy: 'read-only; no draft, roster, waiver, or provider write commands exist'
      }
    };
  }
  if (command === 'status') return { command, value: fleetStatus(runtime, draftServices) };
  if (command === 'leagues') return { command, value: fleetManifest(runtime, draftServices).leagues };
  if (command === 'sessions') {
    const [leagueId] = tokens;
    const service = draftServices.get(leagueId);
    if (!service) throw Object.assign(new Error(`Unknown league: ${leagueId || '(missing)'}`), { code: 'LEAGUE_NOT_FOUND' });
    return { command, value: { leagueId, sessions: service.listSessions() } };
  }
  if (command === 'recommendation' || command === 'board') {
    const [leagueId, sessionId] = tokens;
    const service = draftServices.get(leagueId);
    if (!service) throw Object.assign(new Error(`Unknown league: ${leagueId || '(missing)'}`), { code: 'LEAGUE_NOT_FOUND' });
    if (!sessionId) throw Object.assign(new Error(`Usage: ${command} <leagueId> <sessionId>`), { code: 'SESSION_ID_REQUIRED' });
    const card = service.recommendation(sessionId);
    const value = {
      leagueId,
      sessionId,
      currentOverall: card.currentOverall,
      onClock: card.onClock,
      nextUserPick: card.nextUserPick,
      board: card.board,
      evidence: card.evidence,
      execution: card.execution
    };
    if (command === 'recommendation') Object.assign(value, {
      preferred: card.preferred,
      alternatives: card.alternatives,
      explanation: deterministicExplanation(card)
    });
    return {
      command,
      value
    };
  }
  throw Object.assign(new Error('Unknown command. Use: help'), { code: 'COMMAND_NOT_ALLOWED' });
}

function attachReadOnlyCommandRelay(server, { runtime, draftServices }) {
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, 'http://huddle.local');
    if (url.pathname !== '/') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
  });
  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let input;
      try { input = JSON.parse(raw); } catch { input = { prompt: String(raw) }; }
      const prompt = String(input.prompt || '').trim();
      if (!prompt) {
        ws.send(JSON.stringify({ type: 'error', text: 'Empty command.' }));
        ws.send(JSON.stringify({ type: 'done' }));
        return;
      }
      ws.send(JSON.stringify({ type: 'start', text: 'Running read-only Huddle command.' }));
      try {
        const result = executeReadCommand(prompt, runtime, draftServices);
        appendAudit(runtime, prompt, result.command, 'ok');
        ws.send(JSON.stringify({ type: 'token', text: JSON.stringify(result.value, null, 2) }));
      } catch (error) {
        appendAudit(runtime, prompt, prompt.split(/\s+/)[0].toLowerCase(), error.code || 'error');
        ws.send(JSON.stringify({ type: 'error', text: `${error.code || 'COMMAND_FAILED'}: ${error.message}` }));
      }
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'done' }));
    });
  });
  return wss;
}

module.exports = { appendAudit, attachReadOnlyCommandRelay, executeReadCommand };
