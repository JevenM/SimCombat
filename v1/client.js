const ws = new WebSocket((location.protocol==='https:'?'wss://':'ws://') + location.host);
const canvas = document.getElementById('map');
const ctx = canvas.getContext('2d');
const log = document.getElementById('log');
let state = null;
let replay = null;

ws.onopen = () => { console.log('ws open'); };
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.type === 'state') { state = m.state; render(); }
  if (m.type === 'replay') { replay = m.replay; showReplay(); }
};

function render() {
  if (!state) return;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  for (const e of state.entities) {
    ctx.beginPath();
    ctx.fillStyle = e.side === 'red' ? 'red' : 'blue';
    ctx.arc(e.x, e.y, 6, 0, Math.PI*2);
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.fillText(e.id + ' ' + Math.round(e.hp), e.x+8, e.y);
  }
  log.textContent = 't=' + state.time.toFixed(1) + '\n' + state.entities.map(e=>`${e.id} ${e.side} (${Math.round(e.x)},${Math.round(e.y)}) hp:${Math.round(e.hp)}`).join('\n');
}

document.getElementById('btnStart').onclick = () => ws.send(JSON.stringify({ cmd: 'start' }));
document.getElementById('btnStop').onclick = () => ws.send(JSON.stringify({ cmd: 'stop' }));
document.getElementById('btnStep').onclick = () => ws.send(JSON.stringify({ cmd: 'step' }));
document.getElementById('btnLoad').onclick = () => ws.send(JSON.stringify({ cmd: 'init' }));
document.getElementById('btnReplay').onclick = () => ws.send(JSON.stringify({ cmd: 'replay' }));
document.getElementById('btnSave').onclick = async () => {
  const res = await fetch('/api/state');
  const s = await res.json();
  const blob = new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'snapshot.json'; a.click();
};

function showReplay() {
  if (!replay || replay.length === 0) return;
  let i = 0;
  const iv = setInterval(() => {
    const frame = replay[i++];
    if (!frame) { clearInterval(iv); return; }
    state = { time: frame.time, entities: frame.entities };
    render();
  }, 200);
}
