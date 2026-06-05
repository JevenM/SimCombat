const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const WebSocket = require('ws');
const Sim = require('./simEngine');

const app = express();
app.use(bodyParser.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const sim = new Sim();
let clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify({ type: 'state', state: sim.getState(), replay: sim.getReplay() }));

  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.cmd === 'start') sim.start(() => broadcastState());
      if (data.cmd === 'stop') sim.stop();
      if (data.cmd === 'step') { sim.step(); broadcastState(); }
      if (data.cmd === 'init') { sim.loadScenario(data.scenario || sim.sampleScenario()); broadcastState(); }
      if (data.cmd === 'set') { sim.setEntities(data.entities); broadcastState(); }
      if (data.cmd === 'replay') { ws.send(JSON.stringify({ type: 'replay', replay: sim.getReplay() })); }
    } catch (e) { console.error('ws msg error', e); }
  });

  ws.on('close', () => clients.delete(ws));
});

function broadcastState() {
  const payload = JSON.stringify({ type: 'state', state: sim.getState() });
  for (const c of clients) {
    if (c.readyState === WebSocket.OPEN) c.send(payload);
  }
}

app.get('/api/state', (req, res) => res.json(sim.getState()));
app.post('/api/save', (req, res) => {
  const snapshot = req.body && req.body.snapshot ? req.body.snapshot : sim.getState();
  res.json({ ok: true, snapshot });
});
app.get('/api/sample', (req, res) => res.json(sim.sampleScenario()));

// static client
app.get('/', (req, res) => res.sendFile(__dirname + '/client.html'));
app.get('/client.js', (req, res) => res.sendFile(__dirname + '/client.js'));

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log('SimCombat MVP server listening on', PORT));
