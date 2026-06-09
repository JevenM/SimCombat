/**
 * Simulation - 主仿真引擎
 * 集成所有子系统：地形、AI、战斗、感知、运动
 */
const TerrainManager = require('./TerrainManager');
const { BehaviorTree, Selector, Sequence, AttackTarget, FindNearestEnemy, Retreat, CheckHealth, MoveTo, Patrol, Condition } = require('./ai/BehaviorTree');
const { TacticalAI } = require('./ai/TacticalAI');
const SmartTacticalAI = require('./ai/SmartTacticalAI');
const CombatSystem = require('./systems/CombatSystem');
const PerceptionSystem = require('./systems/PerceptionSystem');
const MovementSystem = require('./systems/MovementSystem');
const { getEquipment, getDamageModifier } = require('../data/equipment/Database');

class Simulation {
  constructor(config = {}) {
    this.time = 0;
    this.stepCount = 0;  // 仿真步数计数器
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
    this.smartAI = new SmartTacticalAI(this.terrain, this.movement);
    this.useSmartAI = config.useSmartAI !== false;
    this.aiStyle = 'balanced'; // aggressive, balanced, defensive

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

  // 生成示例想定 - 小规模近距离对战
  sampleScenario() {
    return {
      name: '小规模遭遇战想定',
      terrain: {
        elevation: [],
        terrainType: []
      },
      entities: [
        // 红军（西侧）- 距离蓝军约800米
        { id: 'r1', side: 'red', equipmentType: 'tank', x: 4500, y: 5000, aiType: 'combat' },
        { id: 'r2', side: 'red', equipmentType: 'tank', x: 4600, y: 5100, aiType: 'combat' },
        { id: 'r3', side: 'red', equipmentType: 'apc', x: 4400, y: 4900, aiType: 'combat' },
        { id: 'r4', side: 'red', equipmentType: 'infantry', x: 4550, y: 4950, aiType: 'combat' },
        { id: 'r5', side: 'red', equipmentType: 'infantry', x: 4650, y: 5050, aiType: 'combat' },

        // 蓝军（东侧）- 距离红军约800米
        { id: 'b1', side: 'blue', equipmentType: 'tank', x: 5300, y: 5000, aiType: 'defensive' },
        { id: 'b2', side: 'blue', equipmentType: 'tank', x: 5400, y: 5100, aiType: 'defensive' },
        { id: 'b3', side: 'blue', equipmentType: 'apc', x: 5200, y: 4900, aiType: 'defensive' },
        { id: 'b4', side: 'blue', equipmentType: 'infantry', x: 5350, y: 4950, aiType: 'defensive' },
        { id: 'b5', side: 'blue', equipmentType: 'infantry', x: 5250, y: 5050, aiType: 'defensive' }
      ]
    };
  }

  // 单步仿真
  step() {
    this.time += this.dt;
    this.stepCount++;
    this.blackboard.time = this.time;

    // 清空上一帧的战斗事件
    this.blackboard.combatEvents = [];

    // 2. 感知更新 - 所有单位探测敌情
    this.perception.updatePerception(this.entities);

    // 3. AI行为决策 - 使用SmartTacticalAI或原有行为树
    if (this.useSmartAI) {
      const aiResults = this.smartAI.updateAll(this.entities, this.dt);
      // 将AI结果转换为战斗事件
      for (const result of aiResults) {
        if (result.action === 'fire' && result.hit) {
          const target = this.entities.find(e => e.id === result.target);
          const attacker = this.entities.find(e => e.id === result.entityId);
          if (target && attacker) {
            this.updateDamageStats(attacker.side, result.damage);
            this.blackboard.combatEvents.push({
              step: this.stepCount,
              time: this.time,
              attacker: attacker.id,
              attackerName: attacker.name,
              attackerSide: attacker.side,
              target: target.id,
              targetName: target.name,
              damage: Math.round(result.damage),
              hit: result.hit,
              distance: Math.round(result.distance)
            });

            if (target.hp <= 0) {
              this.recordKill(attacker, target);
            }
          }
        }
      }
    } else {
      // 使用原有行为树
      for (const entity of this.entities) {
        if (entity.hp <= 0) continue;
        const behavior = this.entityBehaviors.get(entity.id);
        if (behavior) {
          behavior.tick(entity, this.dt);
        }
      }
      // 原有自动交战处理
      this.processAutoEngagement();
    }

    // 4. 运动更新
    this.movement.updateMovement(this.entities, this.dt);

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

  // 自动目标识别与交战处理
  processAutoEngagement() {
    for (const entity of this.entities) {
      if (entity.hp <= 0) continue;

      // 所有存活单位自动攻击射程内的敌方目标
      const target = this.findBestTarget(entity);
      if (target) {
        const result = this.combat.resolveDirectFire(entity, target, this.dt);
        if (result) {
          this.updateDamageStats(entity.side, result.damage);
          this.blackboard.combatEvents.push({
            step: this.stepCount,
            time: this.time,
            attacker: entity.id,
            attackerName: entity.name,
            attackerSide: entity.side,
            target: target.id,
            targetName: target.name,
            damage: Math.round(result.damage),
            hit: result.hit,
            distance: Math.round(result.distance)
          });

          if (target.hp <= 0) {
            this.recordKill(entity, target);
          }
        }
      }
    }
  }

  // 寻找最佳目标 - 使用智能评分算法
  findBestTarget(entity) {
    const enemies = entity.detectedContacts || [];
    let bestTarget = null;
    let bestScore = -Infinity;

    for (const contact of enemies) {
      const target = this.entities.find(e => e.id === contact.id);
      if (!target || target.hp <= 0 || target.side === entity.side) continue;

      const dist = Math.hypot(target.x - entity.x, target.y - entity.y);

      // 超出射程
      if (dist > entity.range) continue;

      // 检查视线
      if (this.terrain && !this.terrain.hasLineOfSight(
        entity.x, entity.y, target.x, target.y,
        entity.height || 2, target.height || 2
      )) continue;

      // ====== 智能目标评分算法 ======
      // 基础分数
      let score = 0;

      // 1. 距离评分：越近越好，超过2/3射程开始衰减
      const rangeRatio = dist / entity.range;
      score += (1 - rangeRatio) * 15; // 最大15分

      // 2. 威胁度评分：高火力低血量 = 高威胁，优先消灭
      const threatLevel = (target.damage || 0) * (target.fireRate || 1) / Math.max(1, target.hp);
      score += Math.min(threatLevel * 10, 25); // 最大25分

      // 3. 易击杀评分：血量越低越优先
      const killBonus = 1 - (target.hp / Math.max(1, target.maxHp));
      score += killBonus * 20; // 最大20分

      // 4. 目标类型优先级
      const typePriority = {
        'artillery': 15,   // 火炮优先
        'air_defense': 15, // 防空优先
        'tank': 10,        // 坦克重要目标
        'apc': 5,          // 装甲车
        'infantry': 3,     // 步兵
        'fighter': 12,     // 战斗机
        'helicopter': 8    // 直升机
      };
      score += typePriority[target.type] || 0;

      // 5. 协同加成：有其他友军攻击同一目标时加分
      const alliesAttackingSame = this.entities.filter(e =>
        e.side === entity.side &&
        e.hp > 0 &&
        e.attackTarget?.id === target.id
      ).length;
      score += alliesAttackingSame * 5; // 每个友军+5分

      // 6. 角度优势：正面攻击坦克减分，侧翼攻击加分
      const targetHeading = (target.heading || 0) * Math.PI / 180;
      const relativeAngle = Math.atan2(entity.y - target.y, entity.x - target.x);
      const frontAngle = Math.abs(relativeAngle - targetHeading);
      const isFront = frontAngle < Math.PI / 4 || frontAngle > 3 * Math.PI / 4;
      if (target.type === 'tank' && !isFront) {
        score += 10; // 侧翼攻击坦克加分
      }

      // 7. 随机因素（模拟战场不确定性）
      score += Math.random() * 2;

      if (score > bestScore) {
        bestScore = score;
        bestTarget = target;
      }
    }

    return bestTarget;
  }

  // 记录击杀
  recordKill(attacker, victim) {
    if (victim.side === 'red') {
      this.stats.blueCasualties++;
    } else {
      this.stats.redCasualties++;
    }

    // 标记受害者为已摧毁状态
    victim.status = 'destroyed';
    victim.hp = 0;

    this.blackboard.combatEvents.push({
      step: this.stepCount,
      time: this.time,
      type: 'kill',
      killer: attacker.id,
      killerName: attacker.name,
      killerSide: attacker.side,
      victim: victim.id,
      victimName: victim.name,
      victimSide: victim.side
    });
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

    let winner = null;
    let reason = '';

    if (redUnits.length === 0 && blueUnits.length === 0) {
      winner = 'draw';
      reason = '双方地面部队全部损失';
    } else if (redUnits.length === 0) {
      winner = 'blue';
      reason = '红军地面部队全部被歼灭';
    } else if (blueUnits.length === 0) {
      winner = 'red';
      reason = '蓝军地面部队全部被歼灭';
    }

    if (winner) {
      this.stats.endTime = Date.now();
      this.stats.winner = winner;
      this.stats.endReason = reason;
      // 在停止前再记录一帧，确保包含获胜信息
      if (this.replayEnabled) {
        this.recordFrame();
      }
      this.stop();
    }
  }

  recordFrame() {
    const frame = {
      time: this.time,
      entities: this.entities.map(e => ({
        id: e.id,
        name: e.name,           // 保存名字
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
      combatEvents: this.blackboard.combatEvents || [],  // 保存战斗事件
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
      stepCount: this.stepCount,
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
        speed: Math.round(Math.hypot(e.vx || 0, e.vy || 0) * 10) / 10,
        hp: Math.round(e.hp),
        maxHp: e.maxHp,
        range: e.range,
        vision: e.vision,
        detection: e.detection,
        damage: e.damage,
        fireRate: e.fireRate,
        accuracy: e.accuracy,
        armor: e.armor,
        status: e.status,
        detectedContacts: e.detectedContacts?.length || 0
      })),
      stats: this.stats,
      combatEvents: this.blackboard.combatEvents || [],
      terrain: this.terrain ? {
        width: this.terrain.width,
        height: this.terrain.height,
        resolution: this.terrain.resolution,
        cols: this.terrain.cols,
        rows: this.terrain.rows,
        // 只发送地形类型数据（高程数据可以单独请求）
        terrainType: Array.from(this.terrain.terrainType)
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

  // 命令实体移动
  commandMove(entityId, targetX, targetY) {
    const entity = this.entities.find(e => e.id === entityId);
    if (!entity || entity.hp <= 0) return false;

    entity.moveTarget = { x: targetX, y: targetY };
    entity.attackTarget = null;
    entity.aiOverride = true;
    entity.status = 'moving';

    return true;
  }

  // 命令实体攻击特定目标
  commandAttack(entityId, targetId) {
    const entity = this.entities.find(e => e.id === entityId);
    const target = this.entities.find(e => e.id === targetId);

    if (!entity || !target || entity.hp <= 0 || target.hp <= 0) return false;
    if (entity.side === target.side) return false;

    entity.attackTarget = target;
    entity.moveTarget = null;
    entity.aiOverride = true;
    entity.status = 'attacking';

    return true;
  }

  // 命令实体原地部署/固守
  commandHold(entityId) {
    const entity = this.entities.find(e => e.id === entityId);
    if (!entity || entity.hp <= 0) return false;

    entity.moveTarget = null;
    entity.attackTarget = null;
    entity.holdPosition = { x: entity.x, y: entity.y };
    entity.aiOverride = true;
    entity.status = 'deployed';

    // 部署状态获得精度加成
    entity.deployed = true;

    return true;
  }

  // 设置AI战术风格
  setAITacticalStyle(style, aggression, formationEnabled) {
    this.aiStyle = style;
    if (this.smartAI) {
      this.smartAI.setTacticalStyle(style, aggression / 100, formationEnabled);
    }
  }

  // 启用/禁用强化学习
  setLearningEnabled(enabled) {
    if (this.smartAI) {
      this.smartAI.setLearningEnabled(enabled);
    }
  }

  // 获取学习状态报告
  getLearningReport() {
    if (this.smartAI) {
      return this.smartAI.getLearningReport();
    }
    return null;
  }

  // 获取实体详细信息（包含武器属性）
  getEntityDetails(entityId) {
    const entity = this.entities.find(e => e.id === entityId);
    if (!entity) return null;

    return {
      id: entity.id,
      name: entity.name,
      side: entity.side,
      type: entity.equipmentType,
      status: entity.status,

      // 位置信息
      x: Math.round(entity.x),
      y: Math.round(entity.y),
      heading: Math.round(entity.heading * 10) / 10,

      // 生命值
      hp: Math.round(entity.hp),
      maxHp: entity.maxHp,
      hpPercent: Math.round((entity.hp / entity.maxHp) * 100),

      // 移动能力
      speed: entity.speed,
      mobilityType: entity.mobilityType,

      // 武器属性
      weapons: {
        range: entity.range,
        damage: entity.damage,
        fireRate: entity.fireRate,
        accuracy: entity.accuracy
      },

      // 探测能力
      detection: {
        vision: entity.vision,
        detection: entity.detection,
        signature: entity.signature
      },

      // 防御属性
      defense: {
        armor: entity.armor,
        evasion: entity.evasion
      },

      // 状态效果
      effects: {
        deployed: entity.deployed || false,
        aiOverride: entity.aiOverride || false,
        holdPosition: entity.holdPosition || null
      },

      // 目标信息
      targets: {
        currentAttack: entity.attackTarget?.id || null,
        moveDestination: entity.moveTarget || null,
        detectedContacts: entity.detectedContacts?.map(c => ({
          id: c.id,
          type: c.equipmentType,
          distance: Math.round(Math.hypot(c.x - entity.x, c.y - entity.y)),
          bearing: Math.round(Math.atan2(c.y - entity.y, c.x - entity.x) * 180 / Math.PI)
        })) || []
      }
    };
  }
}

module.exports = Simulation;
