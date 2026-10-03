/**
 * SimCombat Pro Server
 * WebSocket + HTTP API for military simulation
 */
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const cors = require('cors');
const fs = require('fs');

const Simulation = require('./src/engine/Simulation');
const {
  listEquipment,
  upsertEquipment,
  deleteEquipment,
  resetEquipment,
  resetAllEquipment
} = require('./src/data/equipment/Database');
const { getPolicy: getRLPolicy } = require('./src/ai/BFMPolicy');
const { getTrainer } = require('./src/ai/BFMTrainer');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// 中间件
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// 仿真实例
const sim = new Simulation({
  dt: 1,
  tickRate: 500, // 500ms per tick for smoother view
  replayEnabled: true,
  maxReplayFrames: 20000
});

// 回放存储（内存中，服务器重启后丢失）
const savedReplays = new Map();

// 创建 replay 目录
const REPLAY_DIR = path.join(__dirname, 'replay');
if (!fs.existsSync(REPLAY_DIR)) {
  fs.mkdirSync(REPLAY_DIR, { recursive: true });
  console.log(`创建回放目录: ${REPLAY_DIR}`);
}

// 从文件加载已保存的回放
function loadReplaysFromDisk() {
  try {
    const files = fs.readdirSync(REPLAY_DIR);
    let loadedCount = 0;
    files.forEach(file => {
      if (file.endsWith('.json')) {
        try {
          const filePath = path.join(REPLAY_DIR, file);
          const content = fs.readFileSync(filePath, 'utf8');
          const replayData = JSON.parse(content);
          if (replayData.name && replayData.replay) {
            savedReplays.set(replayData.name, replayData);
            loadedCount++;
          }
        } catch (err) {
          console.warn(`加载回放文件失败: ${file}`, err.message);
        }
      }
    });
    console.log(`从磁盘加载了 ${loadedCount} 个回放文件`);
  } catch (err) {
    console.error('读取回放目录失败:', err.message);
  }
}

// 保存回放到磁盘
function saveReplayToDisk(name, replayData) {
  try {
    const fileName = `${name.replace(/[^a-zA-Z0-9一-龥_-]/g, '_')}.json`;
    const filePath = path.join(REPLAY_DIR, fileName);
    fs.writeFileSync(filePath, JSON.stringify(replayData, null, 2));
    console.log(`回放缓存到磁盘: ${fileName}`);
    return true;
  } catch (err) {
    console.error('保存回放文件失败:', err.message);
    return false;
  }
}

// 删除磁盘上的回放文件
function deleteReplayFromDisk(name) {
  try {
    const fileName = `${name.replace(/[^a-zA-Z0-9一-龥_-]/g, '_')}.json`;
    const filePath = path.join(REPLAY_DIR, fileName);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`删除回放文件: ${fileName}`);
      return true;
    }
    return false;
  } catch (err) {
    console.error('删除回放文件失败:', err.message);
    return false;
  }
}

// 广播 RL 策略/训练状态
function broadcastRLStatus(status) {
  const payload = JSON.stringify({ type: 'rlStatus', status });
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
}

// 触发一次 RL 自对弈训练（异步执行，不阻塞请求）
async function startRLTraining(options = {}, ws = null) {
  const trainer = getTrainer();
  if (trainer.running) {
    if (ws) ws.send(JSON.stringify({ type: 'error', message: '训练正在进行中' }));
    return;
  }
  const episodes = Math.min(2000, Math.max(1, Number(options.episodes) || 100));
  console.log(`[RL] 开始自对弈训练: ${episodes} 回合`);
  broadcastRLStatus({ ...getRLPolicy().status(), training: true, episode: 0, total: episodes });
  try {
    const result = await trainer.train({
      episodes,
      reset: !!options.reset,
      onProgress: (p) => broadcastRLStatus({ ...getRLPolicy().status(), training: true, ...p })
    });
    const status = { ...getRLPolicy().status(), training: false, lastResult: result.stats };
    broadcastRLStatus(status);
    console.log(`[RL] 训练完成: ${JSON.stringify(result.stats)}`);
    if (ws) ws.send(JSON.stringify({ type: 'rlTrained', stats: result.stats }));
  } catch (err) {
    console.error('[RL] 训练失败:', err.message);
    broadcastRLStatus({ ...getRLPolicy().status(), training: false, error: err.message });
    if (ws) ws.send(JSON.stringify({ type: 'error', message: `训练失败: ${err.message}` }));
  }
}

// 广播装备库（任一客户端修改机型参数后，让所有连接同步刷新下拉与表单）
function broadcastEquipment() {
  const payload = JSON.stringify({ type: 'equipment', ...listEquipment() });
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
}

// 启动时加载已有回放
loadReplaysFromDisk();

// 客户端集合
const clients = new Set();

// WebSocket连接处理
wss.on('connection', (ws) => {
  clients.add(ws);
  console.log('Client connected. Total:', clients.size);

  // 发送初始状态
  ws.send(JSON.stringify({
    type: 'state',
    state: sim.getState(),
    terrain: sim.terrain ? sim.terrain.exportTerrain() : null
  }));

  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);
      handleCommand(ws, data);
    } catch (e) {
      console.error('WS message error:', e);
      ws.send(JSON.stringify({ type: 'error', message: e.message }));
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log('Client disconnected. Total:', clients.size);
  });
});

// 命令处理
function handleCommand(ws, data) {
  switch (data.cmd) {
    case 'start':
      if (!sim.isRunning) {
        sim.start(() => broadcastState());
      }
      break;

    case 'stop':
      sim.stop();
      broadcastState();
      break;

    case 'step':
      sim.step();
      broadcastState();
      break;

    case 'init':
      const scenario = data.scenario || sim.sampleScenario();
      sim.loadScenario(scenario);
      sim.stop();
      broadcastState();
      break;

    case 'loadScenario':
      if (data.scenario) {
        sim.loadScenario(data.scenario);
        sim.stop();
        broadcastState();
      }
      break;

    // ====== 空战对决 ======
    case 'startDuel':
      try {
        const state = sim.startDuel(data.config || {});
        console.log('空战对决已开始:', JSON.stringify(data.config || {}).slice(0, 200));
        broadcastState();
        // 自动开始推演
        if (!sim.isRunning) sim.start(() => broadcastState());
      } catch (err) {
        console.error('Start duel error:', err);
        ws.send(JSON.stringify({ type: 'error', message: err.message }));
      }
      break;

    case 'stopDuel':
      sim.stop();
      sim.resetDuel();
      sim.blackboard.combatEvents = [];
      broadcastState();
      console.log('空战对决已结束/重置');
      break;

    case 'setDuelStyle':
      if (data.style) {
        sim.airCombat.setStyle(data.style);
        sim.aiStyle = data.style;
        broadcastState();
        console.log('空战AI风格:', data.style);
      }
      break;

    case 'setDuelPolicy':
      if (data.policy) {
        sim.setDuelPolicy(data.policy);
        broadcastState();
        console.log('空战决策策略:', data.policy);
      }
      ws.send(JSON.stringify({ type: 'rlStatus', status: getRLPolicy().status() }));
      break;

    case 'rlStatus':
      ws.send(JSON.stringify({ type: 'rlStatus', status: getRLPolicy().status() }));
      break;

    case 'rlTrain':
      startRLTraining({ episodes: data.episodes || 100 }, ws);
      break;

    case 'createEntity':
      if (data.config) {
        try {
          const entity = sim.createEntity(data.config);
          console.log(`Created entity: ${entity.id} (${entity.side} ${entity.equipmentType})`);
          broadcastState();
        } catch (err) {
          console.error('Create entity error:', err);
          ws.send(JSON.stringify({ type: 'error', message: err.message }));
        }
      }
      break;

    case 'removeEntity':
      if (data.entityId) {
        const removed = sim.removeEntity(data.entityId);
        if (removed) {
          console.log(`Removed entity: ${data.entityId}`);
          // 清空战斗事件，避免在移除实体时产生击杀特效
          sim.blackboard.combatEvents = [];
          broadcastState();
        }
      }
      break;

    case 'moveEntity':
      if (data.entityId && data.x !== undefined && data.y !== undefined) {
        const entity = sim.entities.find(e => e.id === data.entityId);
        if (entity) {
          entity.x = data.x;
          entity.y = data.y;
          // 重新同步高度
          if (entity.type !== 'air' && entity.type !== 'naval') {
            entity.z = sim.terrain.getElevation(entity.x, entity.y);
          }
          console.log(`Moved entity: ${data.entityId} to (${data.x}, ${data.y})`);
          broadcastState();
        }
      }
      break;

    case 'commandMove':
      console.log('Received commandMove:', data.entityId, data.targetX, data.targetY);
      if (data.entityId && data.targetX !== undefined && data.targetY !== undefined) {
        const success = sim.commandMove(data.entityId, data.targetX, data.targetY);
        ws.send(JSON.stringify({
          type: 'commandResult',
          cmd: 'move',
          success,
          entityId: data.entityId
        }));
        broadcastState();
      }
      break;

    case 'commandAttack':
      console.log('Received commandAttack:', data.entityId, data.targetId);
      if (data.entityId && data.targetId) {
        const success = sim.commandAttack(data.entityId, data.targetId);
        ws.send(JSON.stringify({
          type: 'commandResult',
          cmd: 'attack',
          success,
          entityId: data.entityId,
          targetId: data.targetId
        }));
        broadcastState();
      }
      break;

    case 'commandHold':
      console.log('Received commandHold:', data.entityId);
      if (data.entityId) {
        const success = sim.commandHold(data.entityId);
        ws.send(JSON.stringify({
          type: 'commandResult',
          cmd: 'hold',
          success,
          entityId: data.entityId
        }));
        broadcastState();
      }
      break;

    case 'setSmartAI':
      if (data.enabled !== undefined) {
        sim.useSmartAI = data.enabled;
        console.log(`SmartAI ${data.enabled ? 'enabled' : 'disabled'}`);
        ws.send(JSON.stringify({
          type: 'configResult',
          config: 'smartAI',
          enabled: data.enabled
        }));
      }
      break;

    case 'setAITacticalStyle':
      if (data.style) {
        sim.setAITacticalStyle(data.style, data.aggression, data.formationEnabled);
        console.log(`AI tactical style set to: ${data.style}, aggression: ${data.aggression}%`);
        ws.send(JSON.stringify({
          type: 'configResult',
          config: 'tacticalStyle',
          style: data.style,
          aggression: data.aggression
        }));
      }
      break;

    case 'setAIAggression':
      if (data.aggression !== undefined && sim.smartAI) {
        sim.smartAI.config.aggression = data.aggression / 100;
        console.log(`AI aggression set to: ${data.aggression}%`);
        ws.send(JSON.stringify({
          type: 'configResult',
          config: 'aggression',
          value: data.aggression
        }));
      }
      break;

    case 'setAIFormation':
      if (data.enabled !== undefined && sim.smartAI) {
        sim.smartAI.config.enableFormation = data.enabled;
        console.log(`AI formation ${data.enabled ? 'enabled' : 'disabled'}`);
        ws.send(JSON.stringify({
          type: 'configResult',
          config: 'formation',
          enabled: data.enabled
        }));
      }
      break;

    case 'setLearningEnabled':
      if (data.enabled !== undefined) {
        sim.setLearningEnabled(data.enabled);
        ws.send(JSON.stringify({
          type: 'configResult',
          config: 'learning',
          enabled: data.enabled
        }));
      }
      break;

    case 'getLearningReport':
      const report = sim.getLearningReport();
      ws.send(JSON.stringify({
        type: 'learningReport',
        report
      }));
      break;

    case 'getEntityDetails':
      console.log('Received getEntityDetails:', data.entityId);
      if (data.entityId) {
        const details = sim.getEntityDetails(data.entityId);
        ws.send(JSON.stringify({
          type: 'entityDetails',
          details
        }));
      }
      break;

    case 'setEntityPath':
      if (data.entityId && data.path) {
        const ent = sim.entities.find(e => e.id === data.entityId);
        if (ent) {
          // 设置单位路径 - 使用 MovementSystem 的统一接口
          sim.movement.setPath(ent, data.path);
          // 同时设置状态为移动
          ent.status = 'moving';
          ent.pathIndex = 0;
          console.log(`Set path for ${data.entityId}: ${data.path.length} waypoints`);
          broadcastState();
        }
      }
      break;

    case 'setEntityAI':
      const e = sim.entities.find(en => en.id === data.entityId);
      if (e && data.aiType) {
        e.aiType = data.aiType;
        const aiTemplate = sim.aiTemplates[data.aiType];
        if (aiTemplate) {
          sim.entityBehaviors.set(e.id, aiTemplate(e, sim.blackboard));
        }
      }
      break;

    case 'saveReplay':
      if (data.name && sim.replay && sim.replay.length > 0) {
        // 获取第一帧作为初始场景
        const firstFrame = sim.replay[0];
        const lastFrame = sim.replay[sim.replay.length - 1];

        const replayData = {
          name: data.name,
          savedAt: new Date().toISOString(),
          initialScene: {
            time: firstFrame.time,
            entities: firstFrame.entities,
            stats: firstFrame.stats
          },
          finalResult: {
            time: lastFrame.time,
            stats: lastFrame.stats,
            winner: lastFrame.stats?.winner,
            endReason: lastFrame.stats?.endReason
          },
          replay: [...sim.replay],
          stats: { ...sim.stats },
          entities: sim.entities.map(e => ({
            id: e.id,
            name: e.name,
            side: e.side,
            equipmentType: e.equipmentType
          }))
        };
        savedReplays.set(data.name, replayData);

        // 同时保存到磁盘
        const savedToDisk = saveReplayToDisk(data.name, replayData);

        console.log(`Replay saved: ${data.name} (${replayData.replay.length} frames)`);
        ws.send(JSON.stringify({
          type: 'replaySaved',
          name: data.name,
          frameCount: replayData.replay.length,
          savedToDisk
        }));
      } else {
        ws.send(JSON.stringify({
          type: 'error',
          message: '无法保存回放：名称无效或没有回放数据'
        }));
      }
      break;

    case 'listReplays':
      const replays = Array.from(savedReplays.entries()).map(([name, data]) => ({
        name,
        savedAt: data.savedAt,
        frameCount: data.replay.length,
        entityCount: data.entities.length,
        winner: data.stats.winner
      }));
      ws.send(JSON.stringify({
        type: 'replayList',
        replays
      }));
      break;

    case 'loadReplay':
      if (data.name && savedReplays.has(data.name)) {
        const replayData = savedReplays.get(data.name);
        ws.send(JSON.stringify({
          type: 'replay',
          replay: replayData.replay,
          name: replayData.name,
          savedAt: replayData.savedAt,
          initialScene: replayData.initialScene || null,
          finalResult: replayData.finalResult || null
        }));
        console.log(`Replay loaded: ${data.name}`);
      } else {
        ws.send(JSON.stringify({
          type: 'error',
          message: '回放不存在: ' + data.name
        }));
      }
      break;

    case 'deleteReplay':
      if (data.name && savedReplays.has(data.name)) {
        savedReplays.delete(data.name);

        // 同时删除磁盘文件
        const deletedFromDisk = deleteReplayFromDisk(data.name);

        console.log(`Replay deleted: ${data.name}`);
        ws.send(JSON.stringify({
          type: 'replayDeleted',
          name: data.name,
          deletedFromDisk
        }));
      } else {
        ws.send(JSON.stringify({
          type: 'error',
          message: '回放不存在: ' + data.name
        }));
      }
      break;

    case 'replay':
      ws.send(JSON.stringify({
        type: 'replay',
        replay: sim.getReplay()
      }));
      break;

    case 'getTerrain':
      ws.send(JSON.stringify({
        type: 'terrain',
        terrain: sim.terrain.exportTerrain()
      }));
      break;

    case 'reset':
      sim.stop();
      // 清空战斗事件，避免在重置时产生击杀特效
      sim.blackboard.combatEvents = [];
      sim.loadScenario(sim.sampleScenario());
      broadcastState();
      break;

    case 'clearAllEntities':
      // 清空所有实体（演习模式初始化用）
      sim.stop();
      sim.entities = [];
      sim.entityBehaviors.clear();
      sim.time = 0;
      sim.stepCount = 0;
      sim.resetDuel();
      // 清空战斗事件，避免在清除时产生击杀特效
      sim.blackboard.combatEvents = [];
      sim.stats = {
        redCasualties: 0,
        blueCasualties: 0,
        redDamage: 0,
        blueDamage: 0,
        redUnits: 0,
        blueUnits: 0,
        startTime: null,
        endTime: null
      };
      sim.replay = [];
      broadcastState();
      break;

    default:
      console.log('Unknown command received:', data.cmd, 'Full data:', JSON.stringify(data).slice(0, 200));
      ws.send(JSON.stringify({ type: 'error', message: 'Unknown command: ' + data.cmd }));
  }
}

// 广播状态到所有客户端
function broadcastState() {
  const state = sim.getState();
  const payload = JSON.stringify({ type: 'state', state });

  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

// HTTP API

// 获取当前状态
app.get('/api/state', (req, res) => {
  res.json(sim.getState());
});

// 获取地形数据
app.get('/api/terrain', (req, res) => {
  res.json(sim.terrain.exportTerrain());
});

// 获取示例想定
app.get('/api/sample', (req, res) => {
  res.json(sim.sampleScenario());
});

// 获取装备库（含自定义/已修改标记）
app.get('/api/equipment', (req, res) => {
  res.json(listEquipment());
});

// 装备库编辑：新增/修改机型、删除自定义机型、恢复默认
app.post('/api/equipment', (req, res) => {
  const { mode, type, data } = req.body || {};
  try {
    switch (mode) {
      case 'upsert': {
        if (!type || !data) return res.status(400).json({ success: false, message: '缺少 type 或 data' });
        const result = upsertEquipment(type, data);
        console.log(`[装备库] ${result.created ? '新增机型' : '更新机型'}: ${type} (${data.name || ''})`);
        broadcastEquipment();
        return res.json({ success: true, ...result });
      }
      case 'delete': {
        if (!type) return res.status(400).json({ success: false, message: '缺少 type' });
        const ok = deleteEquipment(type);
        if (!ok) return res.status(400).json({ success: false, message: '内置机型不可删除' });
        console.log(`[装备库] 删除自定义机型: ${type}`);
        broadcastEquipment();
        return res.json({ success: true });
      }
      case 'reset': {
        if (!type) return res.status(400).json({ success: false, message: '缺少 type' });
        resetEquipment(type);
        console.log(`[装备库] 恢复默认机型: ${type}`);
        broadcastEquipment();
        return res.json({ success: true });
      }
      case 'resetAll': {
        resetAllEquipment();
        console.log('[装备库] 已恢复出厂装备库');
        broadcastEquipment();
        return res.json({ success: true });
      }
      default:
        return res.status(400).json({ success: false, message: `未知操作: ${mode}` });
    }
  } catch (err) {
    console.error('[装备库] 操作失败:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ====== 空战 RL 策略（Q-learning 机动策略） ======
app.get('/api/rl/status', (req, res) => {
  const policy = getRLPolicy();
  res.json({ ...policy.status(), training: getTrainer().running });
});

// 启动自对弈训练（异步，立即返回）
app.post('/api/rl/train', (req, res) => {
  const trainer = getTrainer();
  if (trainer.running) {
    return res.status(409).json({ success: false, message: '训练正在进行中' });
  }
  const episodes = Number(req.body?.episodes) || 100;
  res.json({ success: true, message: `已开始训练 ${episodes} 回合` });
  // 响应发出后再开始训练，避免阻塞 HTTP
  setImmediate(() => startRLTraining({ episodes, reset: !!req.body?.reset }));
});

// 清空 Q 表
app.post('/api/rl/reset', (req, res) => {
  getRLPolicy().reset();
  broadcastRLStatus({ ...getRLPolicy().status(), training: false });
  res.json({ success: true, message: 'Q 表已清空' });
});

// 保存推演状态
app.post('/api/save', (req, res) => {
  const snapshot = sim.exportState();
  res.json({ success: true, snapshot });
});

// 获取回放数据
app.get('/api/replay', (req, res) => {
  const replay = sim.getReplay();
  res.json({ replay });
});

// 加载推演状态
app.post('/api/load', (req, res) => {
  if (req.body.snapshot) {
    sim.importState(req.body.snapshot);
    broadcastState();
    res.json({ success: true });
  } else {
    res.status(400).json({ success: false, error: 'No snapshot provided' });
  }
});

// 上传地形数据
app.post('/api/terrain/upload', (req, res) => {
  if (req.body.terrain) {
    sim.terrain.loadFromData(
      req.body.terrain.elevation,
      req.body.terrain.terrainType
    );
    res.json({ success: true });
  } else {
    res.status(400).json({ success: false });
  }
});

// 静态文件服务
app.use(express.static(path.join(__dirname, '../client')));

// 默认页面
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

const PORT = process.env.PORT || 3002;

const startServer = (port) => {
  server.listen(port, () => {
    console.log('╔═══════════════════════════════════════════════════════════════╗');
    console.log('║          SimCombat Pro - 军事仿真推演系统                      ║');
    console.log('╠═══════════════════════════════════════════════════════════════╣');
    console.log('║  服务器已启动                                                  ║');
    console.log(`║  端口: ${port}                                                  ║`);
    console.log(`║  访问: http://localhost:${port}                          ║`);
    console.log('╚═══════════════════════════════════════════════════════════════╝');
  }).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`端口 ${port} 被占用，尝试端口 ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('服务器启动失败:', err);
    }
  });
};

startServer(PORT);

// 初始状态为空，等待用户配置
