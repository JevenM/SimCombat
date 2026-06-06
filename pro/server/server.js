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

// 获取装备列表
app.get('/api/equipment', (req, res) => {
  const { EquipmentDatabase } = require('./src/data/equipment/Database');
  res.json(EquipmentDatabase);
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
