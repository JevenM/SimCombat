/**
 * Simulation - 主仿真引擎
 * 集成所有子系统：地形、AI、战斗、感知、运动
 */
const TerrainManager = require('./TerrainManager');
const { BehaviorTree, Selector, Sequence, AttackTarget, FindNearestEnemy, Retreat, CheckHealth, MoveTo, Patrol, Condition } = require('./ai/BehaviorTree');
const { TacticalAI } = require('./ai/TacticalAI');
const CombatSystem = require('./systems/CombatSystem');
const PerceptionSystem = require('./systems/PerceptionSystem');
const MovementSystem = require('./systems/MovementSystem');
const { getEquipment, getDamageModifier } = require('../data/equipment/Database');

class Simulation {
  constructor(config = {}) {
    this.time = 0;
    this.dt = config.dt || 1;
    this.isRunning = false;
    this.intervalId = null;
    this.tickRate = config.tickRate || 1000; // ms between ticks

    // 初始化子系统
    this.terrain = new TerrainManager(10000, 10000, 50);
    this.combat = new CombatSystem(this.terrain);
    this.perception = new PerceptionSystem(this.terrain);
    this.movement = new MovementSystem(this.terrain);
    this.tacticalAI = new TacticalAI(this.terrain);

    // 实体管理
    this.entities = [];
    this.entityBehaviors = new Map(); // entityId -> BehaviorTree
    this.nextEntityId = 1;

    // 回放记录
    this.replay = [];
    this.replayEnabled = config.replayEnabled !== false;
    this.maxReplayFrames = config.maxReplayFrames || 10000;

    // 统计数据
    this.stats = {
      redCasualties: 0,
      blueCasualties: 0,
      redDamage: 0,
      blueDamage: 0,
      redUnits: 0,
      blueUnits: 0,
      startTime: null,
      endTime: null
    };

    // 初始化黑板（AI共享数据）
    this.blackboard = {
      terrain: this.terrain,
      entities: this.entities,
      time: 0,
      combatEvents: []
    };

    // 预定义AI模板
    this.aiTemplates = this.createAITemplates();
  }

  // 创建AI行为树模板
  createAITemplates() {
    return {
      // 标准战斗AI
      combat: (entity, bb) => {
        return new BehaviorTree(bb)
          .setRoot(new Selector('Root')
            .addChild(new Sequence('RetreatIfHurt')
              .addChild(new CheckHealth(0.3))
              .addChild(new Retreat())
            )
            .addChild(new Sequence('Engage')
              .addChild(new FindNearestEnemy())
              .addChild(new Selector('AttackOrApproach')
                .addChild(new AttackTarget((e, bb) => bb.target))
                .addChild(new MoveTo((e, bb) => bb.target, 50))
              )
            )
            .addChild(new Patrol((e) => e.patrolWaypoints || []))
          );
      },

      // 防御型AI
      defensive: (entity, bb) => {
        return new BehaviorTree(bb)
          .setRoot(new Selector('Root')
            .addChild(new Sequence('RetreatIfHurt')
              .addChild(new CheckHealth(0.5))
              .addChild(new Retreat())
            )
            .addChild(new Condition('HoldPosition', (e) => !e.moveTarget,
              new AttackTarget((e, bb) => bb.target)
            ))
            .addChild(new FindNearestEnemy())
            .addChild(new MoveTo((e, bb) => ({x: e.defendX || e.x, y: e.defendY || e.y}), 20))
          );
      },

      // 侦察型AI
      scout: (entity, bb) => {
        return new BehaviorTree(bb)
          .setRoot(new Selector('Root')
            .addChild(new Sequence('AvoidThreat')
              .addChild(new Condition('CheckThreats', (e, bb) => {
                const nearbyThreats = bb.entities?.filter(en =>
                  en.side !== e.side &&
                  Math.hypot(en.x - e.x, en.y - e.y) < (e.vision || 200)
                );
                return nearbyThreats?.length > 0;
              }))
              .addChild(new Retreat())
            )
            .addChild(new Patrol((e) => e.scoutWaypoints || []))
          );
      },

      // 炮兵AI
      artillery: (entity, bb) => {
        return new BehaviorTree(bb)
          .setRoot(new Selector('Root')
            .addChild(new Condition('CanIndirectFire', (e, bb) => e.indirect,
              new AttackTarget((e, bb) => bb.target)
            ))
            .addChild(new FindNearestEnemy())
          );
      }
    };
  }

  // 创建实体
  createEntity(config) {
    const equipData = getEquipment(config.equipmentType);
    if (!equipData) {
      throw new Error(`Unknown equipment type: ${config.equipmentType}`);
    }

    const entity = {
      id: config.id || `e${this.nextEntityId++}`,
      name: config.name || equipData.name,
      side: config.side,
      equipmentType: config.equipmentType,
      type: equipData.type,
      mobilityType: equipData.mobility,

      // 位置
      x: config.x || 0,
      y: config.y || 0,
      z: config.z || 0,
      heading: config.heading || 0,
      vx: 0,
      vy: 0,

      // 属性
      hp: config.hp || equipData.hp,
      maxHp: equipData.maxHp,
      speed: config.speed || equipData.speed,
      range: equipData.range,
      damage: equipData.damage,
      fireRate: equipData.fireRate,
      accuracy: config.accuracy || equipData.accuracy,
      evasion: equipData.evasion,
      armor: equipData.armor,
      detection: equipData.detection,
      vision: equipData.vision,
      signature: equipData.signature,
      height: equipData.height,
      maxAltitude: equipData.maxAltitude,

      // 状态
      status: 'idle',
      detectedContacts: [],
      pendingContacts: [],
      fireCooldown: 0,

      // AI配置
      aiType: config.aiType || 'combat',
      patrolWaypoints: config.patrolWaypoints,
      defendX: config.defendX,
      defendY: config.defendY,

      // 其他
      fuel: equipData.fuel,
      fuelConsumption: equipData.fuelConsumption,
      indirect: equipData.indirect,
      cost: equipData.cost
    };

    // 同步高度
    if (entity.type !== 'air' && entity.type !== 'naval') {
      entity.z = this.terrain.getElevation(entity.x, entity.y);
    }

    // 创建行为树
    const aiTemplate = this.aiTemplates[entity.aiType];
    if (aiTemplate) {
      this.entityBehaviors.set(entity.id, aiTemplate(entity, this.blackboard));
    }

    this.entities.push(entity);
    return entity;
  }

  // 移除实体
  removeEntity(id) {
    const idx = this.entities.findIndex(e => e.id === id);
    if (idx >= 0) {
      const entity = this.entities[idx];
      this.entities.splice(idx, 1);
      this.entityBehaviors.delete(id);
      return entity;
    }
    return null;
  }

  // 加载想定
  loadScenario(scenario) {
    this.time = 0;
    this.entities = [];
    this.entityBehaviors.clear();
    this.replay = [];
    this.stats = {
      redCasualties: 0,
      blueCasualties: 0,
      redDamage: 0,
      blueDamage: 0,
      redUnits: 0,
      blueUnits: 0,
      startTime: Date.now(),
      endTime: null
    };

    if (scenario.terrain) {
      this.terrain.loadFromData(
        scenario.terrain.elevation,
        scenario.terrain.terrainType
      );
    }

    for (const entConfig of scenario.entities || []) {
      this.createEntity(entConfig);
    }

    this.updateStats();
    this.recordFrame();
  }

  // 生成示例想定
  sampleScenario() {
    return {
      name: '红蓝对抗样本想定',
      terrain: {
        elevation: [], // 使用默认地形
        terrainType: []
      },
      entities: [
        // 红军（进攻方）
        { id: 'r1', side: 'red', equipmentType: 'tank', x: 1000, y: 1000, aiType: 'combat' },
        { id: 'r2', side: 'red', equipmentType: 'tank', x: 1100, y: 1050, aiType: 'combat' },
        { id: 'r3', side: 'red', equipmentType: 'apc', x: 1050, y: 1100, aiType: 'combat' },
        { id: 'r4', side: 'red', equipmentType: 'infantry', x: 1020, y: 1080, aiType: 'combat' },
        { id: 'r5', side: 'red', equipmentType: 'infantry', x: 1080, y: 1020, aiType: 'combat' },
        { id: 'r6', side: 'red', equipmentType: 'artillery', x: 800, y: 800, aiType: 'artillery' },
        { id: 'r7', side: 'red', equipmentType: 'uav', x: 1200, y: 1200, z: 300, aiType: 'scout' },

        // 蓝军（防御方）
        { id: 'b1', side: 'blue', equipmentType: 'tank', x: 6000, y: 6000, aiType: 'defensive' },
        { id: 'b2', side: 'blue', equipmentType: 'tank', x: 6100, y: 5950, aiType: 'defensive' },
        { id: 'b3', side: 'blue', equipmentType: 'apc', x: 6050, y: 6050, aiType: 'defensive' },
        { id: 'b4', side: 'blue', equipmentType: 'infantry', x: 6020, y: 6020, aiType: 'defensive' },
        { id: 'b5', side: 'blue', equipmentType: 'infantry', x: 6080, y: 5980, aiType: 'defensive' },
        { id: 'b6', side: 'blue', equipmentType: 'air_defense', x: 6200, y: 5800, aiType: 'defensive' },
        { id: 'b7', side: 'blue', equipmentType: 'fighter', x: 5000, y: 5000, z: 5000, aiType: 'combat' }
      ]
    };
  }

  // 单步仿真
  step() {
    this.time += this.dt;
    this.blackboard.time = this.time;

    // 1. 感知更新
    this.perception.updatePerception(this.entities);

    // 2. AI行为决策
    for (const entity of this.entities) {
      if (entity.hp <= 0) continue;

      const behavior = this.entityBehaviors.get(entity.id);
      if (behavior) {
        behavior.tick(entity, this.dt);
      }
    }

    // 3. 运动更新
    this.movement.updateMovement(this.entities, this.dt);

    // 4. 战斗裁决
    for (const entity of this.entities) {
      if (entity.hp <= 0) continue;

      // 如果有目标且目标存活，尝试攻击
      if (this.blackboard.target && this.blackboard.target.hp > 0) {
        const result = this.combat.resolveDirectFire(entity, this.blackboard.target, this.dt);
        if (result) {
          this.updateDamageStats(entity.side, result.damage);
        }
      }

      // 检查攻击接触到的敌人
      if (entity.detectedContacts) {
        for (const contact of entity.detectedContacts) {
          const target = this.entities.find(e => e.id === contact.id);
          if (target && target.hp > 0 && target.side !== entity.side) {
            const result = this.combat.resolveDirectFire(entity, target, this.dt);
            if (result) {
              this.updateDamageStats(entity.side, result.damage);
            }
          }
        }
      }
    }

    // 5. 更新统计
    this.updateStats();

    // 6. 记录帧
    if (this.replayEnabled) {
      this.recordFrame();
    }

    // 7. 检查结束条件
    this.checkEndConditions();

    return this.getState();
  }

  updateDamageStats(side, damage) {
    if (side === 'red') {
      this.stats.redDamage += damage;
    } else {
      this.stats.blueDamage += damage;
    }
  }

  updateStats() {
    const redUnits = this.entities.filter(e => e.side === 'red' && e.hp > 0);
    const blueUnits = this.entities.filter(e => e.side === 'blue' && e.hp > 0);

    // 计算伤亡
    const redDead = this.entities.filter(e => e.side === 'red' && e.hp <= 0).length;
    const blueDead = this.entities.filter(e => e.side === 'blue' && e.hp <= 0).length;

    this.stats.redUnits = redUnits.length;
    this.stats.blueUnits = blueUnits.length;
    this.stats.redCasualties = redDead;
    this.stats.blueCasualties = blueDead;

    // 计算价值比
    const redValue = this.entities
      .filter(e => e.side === 'red' && e.hp > 0)
      .reduce((sum, e) => sum + (e.cost || 0), 0);
    const blueValue = this.entities
      .filter(e => e.side === 'blue' && e.hp > 0)
      .reduce((sum, e) => sum + (e.cost || 0), 0);
    this.stats.redValue = redValue;
    this.stats.blueValue = blueValue;
  }

  checkEndConditions() {
    const redUnits = this.entities.filter(e => e.side === 'red' && e.hp > 0 && e.type !== 'air');
    const blueUnits = this.entities.filter(e => e.side === 'blue' && e.hp > 0 && e.type !== 'air');

    if (redUnits.length === 0 || blueUnits.length === 0) {
      this.stats.endTime = Date.now();
      this.stop();
    }
  }

  recordFrame() {
    const frame = {
      time: this.time,
      entities: this.entities.map(e => ({
        id: e.id,
        side: e.side,
        type: e.equipmentType,
        x: e.x,
        y: e.y,
        z: e.z,
        heading: e.heading,
        hp: e.hp,
        maxHp: e.maxHp,
        status: e.status,
        detectedContacts: e.detectedContacts?.map(c => c.id)
      })),
      stats: { ...this.stats }
    };

    this.replay.push(frame);

    // 限制回放长度
    if (this.replay.length > this.maxReplayFrames) {
      this.replay.shift();
    }
  }

  // 启动/停止
  start(onTick) {
    if (this.isRunning) return;
    this.isRunning = true;
    this.onTick = onTick;

    this.intervalId = setInterval(() => {
      this.step();
      if (this.onTick) this.onTick();
    }, this.tickRate);
  }

  stop() {
    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  // 获取状态
  getState() {
    return {
      time: this.time,
      isRunning: this.isRunning,
      entities: this.entities.map(e => ({
        id: e.id,
        name: e.name,
        side: e.side,
        equipmentType: e.equipmentType,
        type: e.type,
        x: Math.round(e.x),
        y: Math.round(e.y),
        z: Math.round(e.z || 0),
        heading: Math.round(e.heading * 10) / 10,
        hp: Math.round(e.hp),
        maxHp: e.maxHp,
        status: e.status,
        detectedContacts: e.detectedContacts?.length || 0
      })),
      stats: this.stats,
      terrain: this.terrain ? {
        width: this.terrain.width,
        height: this.terrain.height,
        resolution: this.terrain.resolution
      } : null
    };
  }

  // 获取回放
  getReplay() {
    return this.replay;
  }

  // 导出完整状态
  exportState() {
    return {
      time: this.time,
      entities: this.entities,
      terrain: this.terrain.exportTerrain(),
      stats: this.stats,
      replay: this.replay
    };
  }

  // 从保存的状态导入
  importState(state) {
    this.time = state.time || 0;
    this.entities = state.entities || [];
    this.stats = state.stats || {};
    this.replay = state.replay || [];

    if (state.terrain) {
      this.terrain.loadFromData(state.terrain.elevation, state.terrain.terrainType);
    }

    // 重新创建行为树
    this.entityBehaviors.clear();
    for (const entity of this.entities) {
      const aiTemplate = this.aiTemplates[entity.aiType];
      if (aiTemplate) {
        this.entityBehaviors.set(entity.id, aiTemplate(entity, this.blackboard));
      }
    }
  }
}

module.exports = Simulation;
