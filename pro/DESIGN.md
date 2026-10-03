# SimCombat Pro 军事仿真推演系统

## 系统架构

### 核心参考的开源系统
| 系统 | 特点 | 借鉴点 |
|------|------|--------|
| **JSBSim** | 飞行动力学仿真 | 物理引擎架构、装备参数化配置 |
| **OpenRA** | RTS游戏引擎 | 行为树AI、规则系统 |
| **OneSAF** | 半自动兵力仿真 | 实体-行为分离架构、想定管理系统 |
| **CesiumJS** | 3D地球可视化 | 地形渲染、坐标系统 |

## 功能模块

### 1. 3D可视化引擎 (CesiumJS)
- 球面/平面双模式地图
- 真实地形高程 (DEM支持)
- 实体3D模型（坦克、飞机、舰艇、单兵）
- 特效系统（爆炸、烟雾、轨迹）
- 多视角切换（全局/跟随/第一人称）

### 2. 地形系统
- 高程数据加载（GeoTIFF/SRTM）
- 地形影响系数
  - 移动速度修正（坡度、地形类型）
  - 隐蔽系数（森林、城市、地形起伏）
  - 视野遮蔽
  - 通行性（水域、山地阻挡）

### 3. 军事AI系统 (行为树+HTN)
- **行为树**：实时行为决策
  - 巡逻、警戒、追击
  - 攻击、规避、撤退
  - 编队协同
- **HTN规划**：战术级任务规划
  - 路径规划（A* + 地形权重）
  - 目标优先级排序
  - 协同攻击规划

### 4. 装备系统扩展
- **陆基**：单兵、坦克、装甲车、自行火炮、防空系统
- **空中**：战斗机、轰炸机、无人机、直升机
- **海上**：驱逐舰、潜艇、航母、两栖舰
- **支援**：雷达、通信车、补给车

### 5. 感知与通信系统
- 视距检测（LOS）
- 雷达探测模型
- 电子战（干扰/抗干扰）
- 通信链路与指挥层级

### 6. 数据与回放
- 推演全过程记录
- 统计指标（战损比、弹药消耗、时间线）
- 回放控制（播放/暂停/快进/慢放）
- 数据导出（JSON/CSV）

## API架构

```
client (CesiumJS 3D)
    ↕ WebSocket + HTTP
server (Node.js + Express)
    ↕
simEngine (核心仿真引擎)
    ├── TerrainManager (地形管理)
    ├── EntityManager (实体管理)
    ├── AIController (AI控制)
    ├── CombatResolver (战斗裁决)
    └── ReplayRecorder (回放记录)
```

## 目录结构

```
simcombat-pro/
├── server/
│   ├── server.js
│   ├── package.json
│   └── src/
│       ├── engine/
│       │   ├── Simulation.js
│       │   ├── TerrainManager.js
│       │   ├── EntityManager.js
│       │   ├── AI/
│       │   │   ├── BehaviorTree.js
│       │   │   ├── HTNPlanner.js
│       │   │   └── TacticalAI.js
│       │   └── systems/
│       │       ├── CombatSystem.js
│       │       ├── PerceptionSystem.js
│       │       ├── MovementSystem.js
│       │       └── CommunicationSystem.js
│       └── data/
│           ├── scenarios/
│           └── equipment/
├── client/
│   ├── index.html
│   ├── css/
│   └── js/
│       ├── main.js
│       ├── CesiumViewer.js
│       ├── EntityRenderer.js
│       └── HUD/
│           ├── Minimap.js
│           ├── StatsPanel.js
│           └── ControlPanel.js
└── assets/
    ├── models/
    └── textures/
```

#### 启动 pro版本

```shell
cd D:\Git\SimCombat\pro\server
npm install
npm start
```
