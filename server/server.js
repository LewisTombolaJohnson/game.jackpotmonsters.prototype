import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { customAlphabet } from 'nanoid';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;

// Lobby state in-memory (consider Redis for multi-instance)
// code -> { players: Map(ws -> {id,name,x}), started: bool, jackpot: number, ownerId?: string, currentMonster?: string, leaderboards: Map<string, Map<string, number>> }
const lobbies = new Map();
const clients = new Map(); // ws -> { id, code, name }
const nano = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);

function broadcast(code, type, payload) {
  const lobby = lobbies.get(code);
  if (!lobby) return;
  for (const [ws] of lobby.players) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type, ...payload }));
    }
  }
}

function sendTo(ws, type, payload) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type, ...payload }));
  }
}

app.get('/', (_req, res) => {
  res.json({ ok: true, message: 'Card Combat server running' });
});

app.get('/healthz', (_req, res) => res.send('ok'));

const server = app.listen(PORT, () => {
  console.log(`Server on :${PORT}`);
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  const client = { id: cryptoRandomId(), code: null, name: null };
  clients.set(ws, client);

  ws.on('message', (data) => {
    let msg = {};
    try { msg = JSON.parse(String(data)); } catch { return; }
    const { type } = msg;
    if (type === 'create') {
      const code = nano();
      ensureLobby(code);
      client.code = code;
      client.name = msg.name || `Player-${shortId(client.id)}`;
      addPlayer(ws, client);
      // Mark owner on first create
      const lobby = lobbies.get(code);
      if (lobby && !lobby.ownerId) lobby.ownerId = client.id;
      ws.send(JSON.stringify({ type: 'created', code, you: { id: client.id, name: client.name } }));
      // Send initial jackpot state to the creator
      if (lobby) sendTo(ws, 'jackpotState', { code, jackpot: lobby.jackpot });
      sendRoster(code);
    } else if (type === 'join') {
      const code = String(msg.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
      if (!code) return;
      ensureLobby(code);
      client.code = code;
      client.name = msg.name || `Player-${shortId(client.id)}`;
      addPlayer(ws, client);
      ws.send(JSON.stringify({ type: 'joined', code, you: { id: client.id, name: client.name } }));
      // Send current jackpot state to the joiner
      const lobby = lobbies.get(code);
      if (lobby) sendTo(ws, 'jackpotState', { code, jackpot: lobby.jackpot });
      sendRoster(code);
    } else if (type === 'leave') {
      removePlayer(ws);
    } else if (type === 'start') {
      const code = client.code; if (!code) return;
      const lobby = lobbies.get(code); if (!lobby) return;
      lobby.started = true;
      broadcast(code, 'started', { code });
    } else if (type === 'setMonster') {
      const code = client.code; if (!code) return;
      const lobby = lobbies.get(code); if (!lobby) return;
      const key = String(msg.key || '').slice(0, 256);
      if (!key) return;
      lobby.currentMonster = key;
      if (!lobby.leaderboards) lobby.leaderboards = new Map();
      if (!lobby.leaderboards.has(key)) lobby.leaderboards.set(key, new Map());
      // Optionally broadcast monster key
      broadcast(code, 'monsterSet', { code, key });
    } else if (type === 'damageMonster') {
      const code = client.code; if (!code) return;
      const amount = Math.max(0, Number(msg.amount) || 0);
      const suit = typeof msg.suit === 'string' ? msg.suit : undefined;
      if (amount > 0) {
        // Update leaderboard for current monster
        const lobby = lobbies.get(code);
        if (lobby && lobby.currentMonster) {
          if (!lobby.leaderboards) lobby.leaderboards = new Map();
          if (!lobby.leaderboards.has(lobby.currentMonster)) lobby.leaderboards.set(lobby.currentMonster, new Map());
          const board = lobby.leaderboards.get(lobby.currentMonster);
          const prev = Number(board.get(client.id) || 0);
          board.set(client.id, prev + amount);
        }
        broadcast(code, 'damageMonster', { code, by: client.id, amount, suit });
      }
    } else if (type === 'healPlayer') {
      const code = client.code; if (!code) return;
      const targetId = String(msg.id || client.id);
      const amount = Math.max(0, Number(msg.amount) || 0);
      if (amount > 0) broadcast(code, 'healPlayer', { code, by: client.id, id: targetId, amount });
    } else if (type === 'heartHealRequest') {
      const code = client.code; if (!code) return;
      const lobby = lobbies.get(code); if (!lobby) return;
      const amount = Math.max(0, Number(msg.amount) || 0);
      let count = Math.max(1, Number(msg.count) || 1);
      const ids = Array.from(lobby.players.values()).map(p=>p.id);
      if (ids.length === 0 || amount <= 0) return;
      if (count > ids.length) count = ids.length;
      const shuffled = ids.sort(()=>Math.random()-0.5);
      const targets = shuffled.slice(0, count);
      broadcast(code, 'heartHeal', { code, by: client.id, amount, targets });
    } else if (type === 'jackpotContribute') {
      const code = client.code; if (!code) return;
      const lobby = lobbies.get(code); if (!lobby) return;
      const amount = Math.max(0, Number(msg.amount) || 0);
      if (amount > 0) {
        lobby.jackpot = Number(((lobby.jackpot || 0) + amount).toFixed(2));
        broadcast(code, 'jackpotUpdate', { code, by: client.id, delta: amount, jackpot: lobby.jackpot });
      }
    } else if (type === 'prizeParticles') {
      const code = client.code; if (!code) return;
      broadcast(code, 'prizeParticles', { code, by: client.id });
    } else if (type === 'playerPos') {
      const code = client.code; if (!code) return;
      const lobby = lobbies.get(code); if (!lobby) return;
      const x = Number(msg.x);
      if (!Number.isFinite(x)) return;
      // Clamp normalized position 0..1
      const xn = Math.max(0, Math.min(1, x));
      // Update stored position for this player
      for (const [ws2, info] of lobby.players) {
        if (info.id === client.id) { info.x = xn; break; }
      }
      broadcast(code, 'playerPos', { code, id: client.id, x: xn });
    } else if (type === 'getStats') {
      const code = client.code; if (!code) return;
      const lobby = lobbies.get(code); if (!lobby) return;
      const key = lobby.currentMonster || 'default';
      const board = (lobby.leaderboards && lobby.leaderboards.get(key)) || new Map();
      const entries = Array.from(board.entries()).map(([id, damage])=>({ id, damage: Number(damage)||0, name: findNameById(lobby, id) }));
      entries.sort((a,b)=>b.damage - a.damage);
      const top10 = entries.slice(0,10);
      sendTo(ws, 'stats', { code, monster: key, top: top10 });
    } else if (type === 'debugSetHealth') {
      const code = client.code; if (!code) return;
      const lobby = lobbies.get(code); if (!lobby) return;
      if (lobby.ownerId && lobby.ownerId === client.id) {
        const value = Math.max(0, Number(msg.health) || 100);
        broadcast(code, 'setMonsterHealth', { code, health: value });
      }
    } else if (type === 'jokerAttackRequest') {
      const code = client.code; if (!code) return;
      const lobby = lobbies.get(code); if (!lobby) return;
      const playerIds = Array.from(lobby.players.values()).map(p => p.id);
      if (playerIds.length === 0) return;
      const damage = Math.max(1, Math.min(5, Math.floor(Math.random() * 5) + 1));
      // Choose a random non-empty subset of players
      const count = Math.max(1, Math.floor(Math.random() * playerIds.length) + 1);
      const shuffled = playerIds.sort(() => Math.random() - 0.5);
      const targets = shuffled.slice(0, count);
      broadcast(code, 'jokerAttack', { code, by: client.id, damage, targets });
    }
  });

  ws.on('close', () => {
    removePlayer(ws);
    clients.delete(ws);
  });
});

function ensureLobby(code) {
  if (!lobbies.has(code)) {
    lobbies.set(code, { players: new Map(), started: false, jackpot: 1000, leaderboards: new Map() });
  }
}
function addPlayer(ws, client) {
  const lobby = lobbies.get(client.code);
  if (!lobby) return;
  lobby.players.set(ws, { name: client.name, id: client.id, x: 0.5 });
}
function removePlayer(ws) {
  const client = clients.get(ws);
  if (!client || !client.code) return;
  const lobby = lobbies.get(client.code);
  if (lobby) {
    lobby.players.delete(ws);
    if (lobby.players.size === 0) lobbies.delete(client.code);
    else sendRoster(client.code);
  }
}
function sendRoster(code) {
  const lobby = lobbies.get(code);
  if (!lobby) return;
  // Equal spacing: assign normalized x=(i+1)/(n+1) by join order
  const infos = Array.from(lobby.players.values());
  const n = infos.length;
  for (let i = 0; i < n; i++) {
    infos[i].x = (i + 1) / (n + 1);
  }
  const players = infos.map(p => ({ id: p.id, name: p.name, x: p.x }));
  broadcast(code, 'roster', { code, players, ownerId: lobby.ownerId });
}

function findNameById(lobby, id){
  for (const [,info] of lobby.players) if (info.id === id) return info.name;
  return id;
}

function cryptoRandomId() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}
function shortId(id) { return id.slice(0, 4).toUpperCase(); }
