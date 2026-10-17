const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = process.env.PORT || 10000;
const ROOT = path.join(__dirname, 'public');
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  const requested = pathname === '/' ? '/index.html' : pathname;
  const safePath = path.normalize(path.join(ROOT, requested));
  if (!safePath.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(safePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(safePath);
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, maxPayload: 2048 });
const players = new Map();
const COLORS = ['#ffcf5a', '#7de0ff', '#ff8ea8', '#b5a0ff', '#95e67c', '#ffad68', '#f3f3f3'];
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
function cleanName(s) { return String(s || 'Visitante').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 16) || 'Visitante'; }
function send(ws, obj) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); }
function broadcast(obj, except = null) { const data = JSON.stringify(obj); for (const ws of wss.clients) if (ws !== except && ws.readyState === WebSocket.OPEN) ws.send(data); }
function snapshot() { return [...players.values()].map(p => ({ id:p.id, name:p.name, x:p.x, y:p.y, color:p.color, dir:p.dir })); }
function system(text) { broadcast({ type:'chat', name:'CIDADE', text, system:true, time:Date.now() }); }

wss.on('connection', (ws) => {
  const id = Math.random().toString(36).slice(2, 10);
  let player = null;
  send(ws, { type:'welcome', id, players:snapshot(), online:players.size });
  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'join') {
      if (player) return;
      player = { id, name:cleanName(msg.name), x:140 + Math.random()*120, y:180 + Math.random()*120, color:COLORS[Math.floor(Math.random()*COLORS.length)], dir:0, lastChat:0 };
      players.set(id, player);
      send(ws, { type:'joined', id, players:snapshot(), online:players.size });
      broadcast({ type:'playerJoined', player:{...player}, online:players.size }, ws);
      system(`${player.name} entrou na cidade!`);
      return;
    }
    if (!player) return;
    if (msg.type === 'move') {
      const x = Number(msg.x), y = Number(msg.y), dir = Number(msg.dir);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      // Client movement is bounded; collisions are handled by the map on client.
      player.x = clamp(x, 24, 1976); player.y = clamp(y, 24, 1176); player.dir = Number.isFinite(dir) ? clamp(dir, -6.3, 6.3) : player.dir;
      broadcast({ type:'playerMoved', id, x:player.x, y:player.y, dir:player.dir }, ws);
    } else if (msg.type === 'chat') {
      const now = Date.now();
      if (now - player.lastChat < 700) return;
      player.lastChat = now;
      const text = String(msg.text || '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 180);
      if (!text) return;
      broadcast({ type:'chat', name:player.name, text, time:now });
    } else if (msg.type === 'ping') send(ws, { type:'pong', time:Date.now() });
  });
  ws.on('close', () => {
    if (player) { players.delete(id); broadcast({ type:'playerLeft', id, online:players.size }); system(`${player.name} saiu da cidade.`); }
  });
});

setInterval(() => {
  const data = JSON.stringify({ type:'online', count:players.size });
  for (const ws of wss.clients) if (ws.readyState === WebSocket.OPEN) ws.send(data);
}, 10000);

server.listen(PORT, '0.0.0.0', () => console.log(`Cidade Pequena Online rodando na porta ${PORT}`));
