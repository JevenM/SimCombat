/**
 * SmartTacticalAI - 智能战术决策系统
 * 结合 GOAP (Goal-Oriented Action Planning) 和 Utility AI
 * 特点：
 * 1. 基于效用的目标选择
 * 2. 多层级决策（战略-战术-机动）
 * 3. 协同攻击和防御
 * 4. 地形感知的路径规划
 * 5. 强化学习优化（可选）
 */

const TacticalLearner = require('./TacticalLearner');

class SmartTacticalAI {
  constructor(terrain, movementSystem) {
    this.terrain = terrain;
    this.movementSystem = movementSystem;

    // 初始化战术学习器
    this.learner = new TacticalLearner();
    this.enableLearning = false; // 默认关闭，需要时启用

    // 战术配置参数
    this.config = {
      // 战术风格
      style: 'balanced',        // aggressive, balanced, defensive
      aggression: 0.5,          // 0-1, 激进程度
      enableFormation: true,    // 启用编队协同

      // 威胁评估权重
      threatWeights: {
        distance: 0.3,        // 距离权重
        damage: 0.25,         // 火力权重
        accuracy: 0.15,       // 精度权重
        hp: 0.15,             // 血量权重
        isAttackingMe: 0.15   // 是否在攻击我
      },
      // 攻击优先级系数
      priorityModifiers: {
        artillery: 1.5,       // 优先打击敌方火炮
        tank: 1.3,            // 坦克优先级
        airDefense: 1.4,      // 优先清除防空
        infantry: 0.9,        // 步兵优先级较低
        softTarget: 1.2       // 软目标易打击
      },
      // 战术距离阈值
      ranges: {
        optimal: 0.6,         // 最佳射程比例
        retreat: 0.2,         // 低于此血量撤退
        regroup: 300,         // 重新集结距离
        support: 200          // 支援友军距离
      }
    };

    // 编队管理
    this.formations = new Map(); // formationId -> Formation

    // 战术状态缓存
    this.tacticalMemory = new Map(); // entityId -> memory
  }

  /**
   * 设置战术风格
   */
  setTacticalStyle(style, aggression, enableFormation) {
    this.config.style = style;
    this.config.aggression = aggression;
    if (enableFormation !== undefined) {
      this.config.enableFormation = enableFormation;
    }

    // 根据风格调整战术参数
    switch (style) {
      case 'aggressive':
        this.config.ranges.retreat = 0.1;     // 更低血量才撤退
        this.config.ranges.optimal = 0.4;     // 更激进的接敌距离
        break;
      case 'defensive':
        this.config.ranges.retreat = 0.3;     // 较高血量就撤退
        this.config.ranges.optimal = 0.8;     // 更保守的射程利用
        break;
      default: // balanced
        this.config.ranges.retreat = 0.2;
        this.config.ranges.optimal = 0.6;
    }
  }

  /**
   * 为实体做出战术决策
   * @param {Object} entity - 作战单元
   * @param {Array} allEntities - 所有实体
   * @param {number} dt - 时间步长
   */
  makeDecision(entity, allEntities, dt) {
    if (entity.hp <= 0) return null;

    // 获取或初始化记忆
    const memory = this.getMemory(entity.id);

    // 1. 感知阶段 - 探测目标
    const enemies = this.detectEnemies(entity, allEntities);
    const allies = this.detectAllies(entity, allEntities);

    // 2. 编队机动（如果启用）
    if (this.config.enableFormation && entity.formationId) {
      const formation = this.formations.get(entity.formationId);
      if (formation && formation.objective) {
        // 执行编队侧翼包抄
        const maneuverResult = this.executeFormationManeuver(entity, formation, allEntities, dt);
        if (maneuverResult && maneuverResult.action !== 'arrived') {
          // 如果有攻击目标，在移动过程中同时攻击
          if (maneuverResult.action === 'flanking_ready' && formation.objective.targetId) {
            const target = allEntities.find(e => e.id === formation.objective.targetId);
            if (target && target.hp > 0) {
              const attackResult = this.executeAttack(entity, target, memory, dt);
              return { ...maneuverResult, attackResult };
            }
          }
          return maneuverResult;
        }
      }
    }

    // 3. 威胁评估 - 计算当前威胁等级
    const threatLevel = this.calculateThreatLevel(entity, enemies, allies);

    // 4. 决策选择
    const action = this.selectAction(entity, enemies, allies, threatLevel, memory);

    // 5. 执行动作
    return this.executeAction(entity, action, enemies, allies, dt);
  }

  /**
   * 获取或创建战术记忆
   */
  getMemory(entityId) {
    if (!this.tacticalMemory.has(entityId)) {
      this.tacticalMemory.set(entityId, {
        lastTargetId: null,
        threatHistory: [],
        damageDealt: 0,
        damageReceived: 0,
        tacticalRole: 'fighter', // fighter, support, scout, artillery
        formationTarget: null,
        lastPosition: null,
        engagementCount: 0
      });
    }
    return this.tacticalMemory.get(entityId);
  }

  /**
   * 探测敌方目标
   */
  detectEnemies(entity, allEntities) {
    const enemies = [];
    for (const other of allEntities) {
      if (other.hp <= 0) continue;
      if (other.side === entity.side) continue;

      const dist = Math.hypot(other.x - entity.x, other.y - entity.y);

      // 探测检查（视野、雷达、地形）
      if (this.canDetect(entity, other, dist)) {
        enemies.push({
          entity: other,
          distance: dist,
          threatScore: 0 // 稍后计算
        });
      }
    }
    return enemies;
  }

  /**
   * 探测友方单位
   */
  detectAllies(entity, allEntities) {
    const allies = [];
    for (const other of allEntities) {
      if (other.hp <= 0) continue;
      if (other.side !== entity.side) continue;
      if (other.id === entity.id) continue;

      const dist = Math.hypot(other.x - entity.x, other.y - entity.y);
      allies.push({ entity: other, distance: dist });
    }
    return allies;
  }

  /**
   * 探测能力检查
   */
  canDetect(detector, target, distance) {
    // 基础视野检查
    if (distance <= (detector.vision || 500)) return true;

    // 雷达探测
    if (detector.detection && distance <= detector.detection * 10) {
      // 雷达受地形影响较小，但会被干扰
      if (!detector.jammed) return true;
    }

    // 电子对抗措施(ECM)影响精度
    if (target.jammed && Math.random() < target.jamLevel) {
      return false;
    }

    // 地形遮挡检查
    if (distance > 100) {
      const los = this.terrain.hasLineOfSight(
        detector.x, detector.y, target.x, target.y,
        detector.height || 2, target.height || 2
      );
      if (!los) return false;
    }

    // 隐身/低可探测性
    const signature = target.signature || 1;
    const detectionRange = (detector.vision || 500) * (detector.detection || 0.5) / signature;

    return distance <= detectionRange;
  }

  /**
   * 计算当前威胁等级
   */
  calculateThreatLevel(entity, enemies, allies) {
    let threatLevel = 0;

    // 计算敌方对当前单位的威胁总和
    for (const { entity: enemy, distance } of enemies) {
      // 敌人在射程内
      if (distance <= enemy.range) {
        const killTime = entity.hp / (enemy.damage * enemy.fireRate);
        const canKillMe = killTime < 30; // 30秒内能击杀我的威胁
        threatLevel += canKillMe ? 2 : 1;
      }
    }

    // 友军支援因素
    const nearbyAllies = allies.filter(a => a.distance < this.config.ranges.support).length;
    threatLevel -= nearbyAllies * 0.5;

    // 血量因素
    const hpRatio = entity.hp / entity.maxHp;
    if (hpRatio < this.config.ranges.retreat) threatLevel += 3;
    else if (hpRatio < 0.5) threatLevel += 1;

    return Math.max(0, threatLevel);
  }

  /**
   * 选择最佳动作
   */
  selectAction(entity, enemies, allies, threatLevel, memory) {
    const hpRatio = entity.hp / entity.maxHp;

    // 根据激进程度调整撤退阈值
    // aggression: 0-1, 越激进越晚撤退
    const retreatThreshold = this.config.ranges.retreat *
      (1.5 - this.config.aggression); // 0.5->1.4倍阈值

    // 如果威胁极高，考虑撤退（激进AI更少撤退）
    const retreatThresholdThreat = 3 + this.config.aggression * 2; // 3-5
    if (threatLevel > retreatThresholdThreat && hpRatio < retreatThreshold) {
      return { type: 'retreat', priority: 10 };
    }

    // 激进模式：即使血量低，如果有击杀机会也不撤退
    if (this.config.aggression > 0.7 && hpRatio < 0.3) {
      const attackableEnemies = enemies.filter(e => e.distance <= entity.range);
      const lowHpEnemies = attackableEnemies.filter(e =>
        e.entity.hp < entity.damage * 2
      );
      if (lowHpEnemies.length > 0) {
        // 有机会击杀，不撤退
      }
    }

    // 如果有可攻击目标
    const attackableEnemies = enemies.filter(e => e.distance <= entity.range);
    if (attackableEnemies.length > 0) {
      // 选择最佳攻击目标
      const bestTarget = this.selectBestTarget(entity, attackableEnemies, memory);
      return {
        type: 'attack',
        target: bestTarget,
        priority: 8
      };
    }

    // 如果敌人超出射程但视野内，接近到最佳射程
    // 激进模式更愿意主动接近
    const visibleEnemies = enemies.filter(e => e.distance <= entity.vision);
    if (visibleEnemies.length > 0) {
      // 选择最近的目标接近
      const nearest = visibleEnemies.sort((a, b) => a.distance - b.distance)[0];

      // 激进模式：更激进的接敌距离
      const optimalRange = this.config.ranges.optimal;
      const adjustedRange = optimalRange * (1 - this.config.aggression * 0.3);

      return {
        type: 'approach',
        target: nearest.entity,
        desiredRange: entity.range * adjustedRange,
        priority: 6
      };
    }

    // 是否有友军交战中需要支援
    const supportingAllies = allies.filter(a => {
      const allyMemory = this.getMemory(a.entity.id);
      return allyMemory.lastTargetId && a.distance < this.config.ranges.regroup;
    });
    if (supportingAllies.length > 0) {
      // 前往支援
      const allyToSupport = supportingAllies[0];
      return {
        type: 'support',
        target: allyToSupport.entity,
        priority: 5
      };
    }

    // 战术重组/巡逻
    return {
      type: 'regroup',
      priority: 3
    };
  }

  /**
   * 使用 Utility AI 选择最佳攻击目标
   * 如果启用了学习，会使用学习器优化选择
   */
  selectBestTarget(entity, enemies, memory, allies) {
    // 如果启用学习，使用学习器选择目标
    if (this.enableLearning && this.learner) {
      const learnedTarget = this.learner.selectTargetWithLearning(entity, enemies, {
        allies: allies?.map(a => ({ entity: a.entity })) || []
      });
      if (learnedTarget) return learnedTarget;
    }

    const scoredEnemies = enemies.map(({ entity: enemy, distance }) => {
      let score = 0;
      const w = this.config.threatWeights;

      // 距离分数（越近越好）
      const distRatio = Math.max(0, 1 - distance / entity.range);
      score += distRatio * w.distance * 100;

      // 火力威胁分数（敌方伤害越高，越优先消灭）
      const enemyThreat = (enemy.damage || 10) * (enemy.fireRate || 1);
      score += Math.min(100, enemyThreat) * w.damage;

      // 精度惩罚（难打的目标分数降低）
      const hitProb = this.calculateHitProbability(entity, enemy, distance);
      score += hitProb * w.accuracy * 100;

      // 血量分数（优先打残血敌人）
      const hpRatio = 1 - (enemy.hp / enemy.maxHp);
      score += hpRatio * w.hp * 100;

      // 单位类型优先级
      const typeModifier = this.config.priorityModifiers[enemy.equipmentType] || 1.0;
      score *= typeModifier;

      // 集火加成 - 如果友军正在攻击这个目标
      const focusFireBonus = this.getFocusFireBonus(entity, enemy);
      score *= (1 + focusFireBonus);

      // 仇恨值 - 如果敌人在攻击我
      if (memory.lastTargetId === enemy.id) {
        score += 10; // 持续攻击同一目标的倾向
      }

      return { enemy, score };
    });

    // 按分数排序，返回最高分的敌人
    scoredEnemies.sort((a, b) => b.score - a.score);
    return scoredEnemies[0]?.enemy;
  }

  /**
   * 计算集火加成
   */
  getFocusFireBonus(entity, target) {
    // 检查是否有友军正在攻击这个目标
    // 简化实现：返回一个基于友军距离的加成值
    return 0;
  }

  /**
   * 计算命中概率（用于目标评估）
   */
  calculateHitProbability(attacker, target, distance) {
    let prob = attacker.accuracy || 0.7;

    // 射程衰减
    const rangeRatio = distance / attacker.range;
    prob *= Math.max(0.3, 1 - rangeRatio * 0.5);

    // 目标机动惩罚
    if (target.mobility === 'flight') prob *= 0.7;

    // 地形隐蔽
    const terrain = this.terrain.getTerrainParams(target.x, target.y);
    prob *= (1 - (terrain.cover || 0) * 0.3);

    return prob;
  }

  /**
   * 执行选择的动作
   */
  executeAction(entity, action, enemies, allies, dt) {
    const memory = this.getMemory(entity.id);

    switch (action.type) {
      case 'attack':
        return this.executeAttack(entity, action.target, memory, dt);

      case 'approach':
        return this.executeApproach(entity, action.target, action.desiredRange, dt);

      case 'retreat':
        return this.executeRetreat(entity, enemies, dt);

      case 'support':
        return this.executeSupport(entity, action.target, dt);

      case 'regroup':
        return this.executeRegroup(entity, allies, dt);

      default:
        return null;
    }
  }

  /**
   * 执行攻击
   */
  executeAttack(entity, target, memory, dt) {
    if (!target || target.hp <= 0) return null;

    entity.status = 'attacking';
    memory.lastTargetId = target.id;
    memory.engagementCount++;

    // 记录攻击开始时间（用于学习）
    const attackStart = memory.engagementStart || Date.now();
    if (!memory.engagementStart || memory.lastTargetId !== target.id) {
      memory.engagementStart = Date.now();
    }

    // 计算距离和命中
    const dist = Math.hypot(target.x - entity.x, target.y - entity.y);

    // 超出射程，需要接近
    if (dist > entity.range) {
      return this.moveToPosition(entity, target.x, target.y, entity.range * 0.8, dt);
    }

    // 检查射界和冷却
    if (entity.fireCooldown > 0) {
      entity.fireCooldown -= dt;
      return { action: 'waiting', target: target.id };
    }

    // 计算命中
    const hitProb = this.calculateHitProbability(entity, target, dist);
    const hit = Math.random() < hitProb;

    let damage = 0;
    let kill = false;

    if (hit) {
      damage = entity.damage * (0.8 + Math.random() * 0.4);
      target.hp -= damage;
      memory.damageDealt += damage;

      // 检查是否击杀
      if (target.hp <= 0) {
        kill = true;
        memory.engagementStart = null;
      }
    }

    // 设置冷却
    entity.fireCooldown = 1 / (entity.fireRate || 1);

    // 学习反馈
    if (this.enableLearning && this.learner) {
      this.learner.learnFromOutcome({
        attackerId: entity.id,
        targetId: target.id,
        damage: damage,
        hit: hit,
        kill: kill,
        duration: (Date.now() - attackStart) / 1000
      });
    }

    return {
      action: 'fire',
      target: target.id,
      hit: hit,
      damage: damage,
      distance: dist,
      kill: kill
    };
  }

  /**
   * 执行接近动作
   */
  executeApproach(entity, target, desiredRange, dt) {
    if (!target || target.hp <= 0) return null;

    entity.status = 'moving';

    const dist = Math.hypot(target.x - entity.x, target.y - entity.y);

    // 已经到达期望距离范围内
    if (dist <= desiredRange * 1.1 && dist >= desiredRange * 0.5) {
      entity.vx = 0;
      entity.vy = 0;
      return { action: 'hold_position' };
    }

    // 使用地形感知路径规划
    const targetPos = this.calculateOptimalPosition(entity, target, desiredRange);
    return this.moveToPosition(entity, targetPos.x, targetPos.y, 10, dt);
  }

  /**
   * 计算最佳攻击位置（考虑地形、掩体）
   */
  calculateOptimalPosition(entity, target, desiredRange) {
    // 从目标到当前单位的方向
    const dx = entity.x - target.x;
    const dy = entity.y - target.y;
    const dist = Math.hypot(dx, dy);

    // 期望位置：在目标desireRange距离处
    const dirX = dist > 0 ? dx / dist : 1;
    const dirY = dist > 0 ? dy / dist : 0;

    let bestPos = {
      x: target.x + dirX * desiredRange,
      y: target.y + dirY * desiredRange
    };

    // 考虑地形优势：寻找有掩体的位置
    const searchRadius = 100;
    let bestScore = -Infinity;

    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const testX = target.x + Math.cos(angle) * desiredRange;
      const testY = target.y + Math.sin(angle) * desiredRange;

      // 检查位置有效性
      if (testX < 0 || testX > this.terrain.width ||
          testY < 0 || testY > this.terrain.height) continue;

      // 评分
      let score = 0;

      // 地形掩护
      const terrain = this.terrain.getTerrainParams(testX, testY);
      score += (terrain.cover || 0) * 50;

      // 通行性
      if (terrain.pass <= 0) continue; // 不可通行
      score += terrain.pass * 30;

      // 是否有对目标的视线
      const hasLOS = this.terrain.hasLineOfSight(
        testX, testY, target.x, target.y,
        entity.height || 2, target.height || 2
      );
      if (hasLOS) score += 100;

      // 距离期望位置的接近程度
      const distToDesired = Math.hypot(testX - bestPos.x, testY - bestPos.y);
      score -= distToDesired * 0.1;

      if (score > bestScore) {
        bestScore = score;
        bestPos = { x: testX, y: testY };
      }
    }

    return bestPos;
  }

  /**
   * 执行撤退
   */
  executeRetreat(entity, enemies, dt) {
    entity.status = 'retreating';

    // 计算敌军重心
    let avgX = 0, avgY = 0;
    for (const { entity: enemy } of enemies) {
      avgX += enemy.x;
      avgY += enemy.y;
    }
    avgX /= enemies.length;
    avgY /= enemies.length;

    // 撤退方向：远离敌人重心的方向
    const dx = entity.x - avgX;
    const dy = entity.y - avgY;
    const dist = Math.hypot(dx, dy) || 1;

    // 寻找有掩体的撤退位置
    const retreatDistance = Math.min(300, entity.speed * 10);
    let bestRetreatX = entity.x + (dx / dist) * retreatDistance;
    let bestRetreatY = entity.y + (dy / dist) * retreatDistance;

    // 检查该位置是否有掩体
    const terrain = this.terrain.getTerrainParams(bestRetreatX, bestRetreatY);
    if (terrain.cover < 0.3) {
      // 寻找附近更好的位置
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const testX = entity.x + (dx / dist) * retreatDistance * 0.7 + Math.cos(angle) * 50;
        const testY = entity.y + (dy / dist) * retreatDistance * 0.7 + Math.sin(angle) * 50;

        const testTerrain = this.terrain.getTerrainParams(testX, testY);
        if (testTerrain.cover > 0.3 && testTerrain.pass > 0) {
          bestRetreatX = testX;
          bestRetreatY = testY;
          break;
        }
      }
    }

    return this.moveToPosition(entity, bestRetreatX, bestRetreatY, 5, dt);
  }

  /**
   * 执行支援友军
   */
  executeSupport(entity, ally, dt) {
    entity.status = 'supporting';

    // 移动到友军附近，保持距离
    const dist = Math.hypot(ally.x - entity.x, ally.y - entity.y);
    const supportRange = 150;

    if (dist > supportRange) {
      // 以友军为中心，在侧面部署
      const angle = Math.atan2(ally.y - entity.y, ally.x - entity.x) + Math.PI / 4;
      const targetX = ally.x - Math.cos(angle) * supportRange;
      const targetY = ally.y - Math.sin(angle) * supportRange;
      return this.moveToPosition(entity, targetX, targetY, 10, dt);
    }

    // 已经到达支援位置，开始警戒
    entity.status = 'deployed';
    return { action: 'supporting', ally: ally.id };
  }

  /**
   * 执行战术重组
   */
  executeRegroup(entity, allies, dt) {
    if (allies.length === 0) {
      entity.status = 'idle';
      return { action: 'idle' };
    }

    // 计算友军平均位置
    let avgX = 0, avgY = 0;
    for (const { entity: ally } of allies) {
      avgX += ally.x;
      avgY += ally.y;
    }
    avgX /= allies.length;
    avgY /= allies.length;

    const dist = Math.hypot(avgX - entity.x, avgY - entity.y);

    if (dist > this.config.ranges.regroup) {
      entity.status = 'regrouping';
      return this.moveToPosition(entity, avgX, avgY, 20, dt);
    }

    entity.status = 'idle';
    return { action: 'regrouped' };
  }

  /**
   * 移动到指定位置（带地形感知）
   */
  moveToPosition(entity, targetX, targetY, tolerance, dt) {
    const dx = targetX - entity.x;
    const dy = targetY - entity.y;
    const dist = Math.hypot(dx, dy);

    if (dist < tolerance) {
      entity.vx = 0;
      entity.vy = 0;
      return { action: 'arrived' };
    }

    // 地形速度修正
    const terrainMod = this.terrain.getMovementSpeedModifier(
      entity.x, entity.y, entity.mobilityType
    );

    // km/h 转换为 m/s
    const maxSpeed = ((entity.speed || 10) * 1000 / 3600) * terrainMod;

    entity.vx = (dx / dist) * maxSpeed;
    entity.vy = (dy / dist) * maxSpeed;
    entity.heading = Math.atan2(entity.vy, entity.vx) * 180 / Math.PI;

    return {
      action: 'moving',
      targetX, targetY,
      distance: dist,
      speed: maxSpeed
    };
  }

  /**
   * 协同攻击 - 为多单位分配攻击目标以达到最优效果
   */
  coordinateAttacks(entities, allEntities) {
    // 按阵营分组
    const bySide = new Map();
    for (const entity of entities) {
      if (entity.hp <= 0) continue;
      if (!bySide.has(entity.side)) {
        bySide.set(entity.side, []);
      }
      bySide.get(entity.side).push(entity);
    }

    // 为每个阵营分配目标
    for (const [side, sideEntities] of bySide) {
      this.assignTargetsForSide(sideEntities, allEntities);
    }
  }

  /**
   * 为一方阵营分配攻击目标
   */
  assignTargetsForSide(units, allEntities) {
    // 找出所有敌方单位
    const enemies = allEntities.filter(e =>
      e.hp > 0 && e.side !== units[0]?.side
    );

    if (enemies.length === 0) return;

    // 创建成本矩阵：[己方单位, 敌方目标]
    const costMatrix = [];
    for (const unit of units) {
      const row = [];
      for (const enemy of enemies) {
        const dist = Math.hypot(enemy.x - unit.x, enemy.y - unit.y);
        const canAttack = dist <= unit.range && this.canDetect(unit, enemy, dist);

        if (!canAttack) {
          row.push(Infinity);
          continue;
        }

        // 计算分配此目标的价值（越低越好）
        const dmgPerShot = unit.damage * unit.accuracy;
        const timeToKill = enemy.hp / Math.max(1, dmgPerShot * unit.fireRate);
        const travelTime = (dist - unit.range) / Math.max(1, unit.speed / 3.6);

        // 优先打能最快消灭的目标
        const cost = timeToKill + travelTime * 0.5;
        row.push(cost);
      }
      costMatrix.push(row);
    }

    // 简单的贪心分配（每个单位选择最佳目标）
    for (let i = 0; i < units.length; i++) {
      const unit = units[i];
      const costs = costMatrix[i];
      let bestTargetIdx = -1;
      let minCost = Infinity;

      for (let j = 0; j < enemies.length; j++) {
        if (costs[j] < minCost) {
          minCost = costs[j];
          bestTargetIdx = j;
        }
      }

      if (bestTargetIdx >= 0) {
        const memory = this.getMemory(unit.id);
        memory.assignedTarget = enemies[bestTargetIdx].id;
      }
    }
  }

  /**
   * 更新所有单位的AI
   */
  updateAll(entities, dt) {
    const results = [];

    // 启用地形感知的编队管理
    if (this.config.enableFormation) {
      this.updateFormations(entities);
    }

    // 按编队优先级排序：先执行编队领导，再执行跟随者
    const sortedEntities = [...entities].sort((a, b) => {
      const aIsLeader = a.isFormationLeader ? 1 : 0;
      const bIsLeader = b.isFormationLeader ? 1 : 0;
      return bIsLeader - aIsLeader;
    });

    // 先进行目标分配协调
    this.coordinateAttacks(sortedEntities, entities);

    // 然后每个单位执行自己的决策
    for (const entity of sortedEntities) {
      const result = this.makeDecision(entity, entities, dt);
      if (result) {
        results.push({
          entityId: entity.id,
          ...result
        });
      }
    }

    return results;
  }

  // ============ 编队战术系统 ============

  /**
   * 更新编队管理
   * 自动将附近的友军单位组织成战术编队
   */
  updateFormations(entities) {
    const bySide = new Map();

    // 按阵营分组
    for (const entity of entities) {
      if (entity.hp <= 0) continue;
      if (!bySide.has(entity.side)) {
        bySide.set(entity.side, []);
      }
      bySide.get(entity.side).push(entity);
    }

    // 为每个阵营管理编队
    for (const [side, sideEntities] of bySide) {
      this.manageFormationsForSide(sideEntities);
    }
  }

  /**
   * 管理单个阵营的编队
   */
  manageFormationsForSide(entities) {
    const formationRange = 200; // 编队凝聚距离
    const maxFormationSize = 5; // 最大编队规模

    // 清除过小的编队
    for (const [formationId, formation] of this.formations) {
      const members = formation.members.filter(id =>
        entities.some(e => e.id === id && e.hp > 0)
      );
      if (members.length < 2) {
        // 解散编队
        for (const memberId of formation.members) {
          const entity = entities.find(e => e.id === memberId);
          if (entity) {
            entity.formationId = null;
            entity.isFormationLeader = false;
            entity.formationLeader = null;
          }
        }
        this.formations.delete(formationId);
      } else {
        formation.members = members;
      }
    }

    // 为未编队的单位寻找或创建编队
    const unassigned = entities.filter(e =>
      !e.formationId && e.hp > 0 && e.type !== 'air' && e.type !== 'artillery'
    );

    for (const entity of unassigned) {
      // 寻找最近的已有编队
      let bestFormation = null;
      let minDist = Infinity;

      for (const [formationId, formation] of this.formations) {
        if (formation.side !== entity.side) continue;
        if (formation.members.length >= maxFormationSize) continue;

        // 检查编队距离
        const formationCenter = this.getFormationCenter(formation, entities);
        const dist = Math.hypot(formationCenter.x - entity.x, formationCenter.y - entity.y);

        if (dist < formationRange && dist < minDist) {
          minDist = dist;
          bestFormation = formation;
        }
      }

      if (bestFormation) {
        // 加入现有编队
        bestFormation.members.push(entity.id);
        entity.formationId = bestFormation.id;
        entity.isFormationLeader = false;
        entity.formationLeader = bestFormation.leaderId;
      } else {
        // 创建新编队
        this.createFormation(entity, entities);
      }
    }

    // 选择战术队形
    for (const [formationId, formation] of this.formations) {
      const formationEntities = entities.filter(e => e.formationId === formationId);
      if (formationEntities.length >= 2) {
        this.selectTacticalFormation(formation, formationEntities);
      }
    }
  }

  /**
   * 创建新编队
   */
  createFormation(leader, entities) {
    const formationId = `formation_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

    const formation = {
      id: formationId,
      side: leader.side,
      leaderId: leader.id,
      members: [leader.id],
      type: 'wedge', // wedge, line, column, circle
      objective: null // 编队目标
    };

    this.formations.set(formationId, formation);

    leader.formationId = formationId;
    leader.isFormationLeader = true;
    leader.formationLeader = leader.id;

    return formation;
  }

  /**
   * 根据战术情况选择队形
   */
  selectTacticalFormation(formation, entities) {
    const leader = entities.find(e => e.isFormationLeader);
    if (!leader) return;

    // 分析战术态势
    const enemies = entities.filter(e => e.side !== leader.side && e.hp > 0);
    const nearestEnemy = enemies.length > 0 ?
      enemies.reduce((nearest, e) => {
        const d = Math.hypot(e.x - leader.x, e.y - leader.y);
        return d < nearest.dist ? { e, dist: d } : nearest;
      }, { e: null, dist: Infinity }).e : null;

    const nearestDist = nearestEnemy ?
      Math.hypot(nearestEnemy.x - leader.x, nearestEnemy.y - leader.y) : Infinity;

    // 根据距离和战术风格选择队形
    if (nearestDist < leader.range * 0.5) {
      // 接敌状态 - 使用楔形或线形以最大化火力
      formation.type = 'wedge';
    } else if (nearestDist < leader.range) {
      // 警戒状态 - 使用纵队便于机动
      formation.type = 'column';
    } else {
      // 行军状态 - 根据单位数量选择
      formation.type = entities.length > 3 ? 'line' : 'wedge';
    }

    // 编队目标：进攻最近的敌人或侧翼包抄
    if (nearestEnemy) {
      formation.objective = this.calculateFlankingObjective(formation, leader, nearestEnemy, entities);
    }
  }

  /**
   * 计算侧翼包抄目标点
   */
  calculateFlankingObjective(formation, leader, target, formationEntities) {
    // 计算敌方朝向
    const enemyHeading = target.heading || 0;
    const enemyDir = enemyHeading * Math.PI / 180;

    // 侧翼角度（左右各45度）
    const flankingAngles = [Math.PI / 4, -Math.PI / 4];
    let bestAngle = flankingAngles[formation.id.charCodeAt(formation.id.length - 1) % 2];

    // 避开地形障碍
    const desiredRange = leader.range * 0.7;
    let bestX = target.x + Math.cos(enemyDir + bestAngle) * desiredRange;
    let bestY = target.y + Math.sin(enemyDir + bestAngle) * desiredRange;

    // 检查该位置是否可通行
    const terrain = this.terrain.getTerrainParams(bestX, bestY);
    if (terrain.pass <= 0) {
      // 寻找附近可通行位置
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const testX = target.x + Math.cos(angle) * desiredRange;
        const testY = target.y + Math.sin(angle) * desiredRange;
        const testTerrain = this.terrain.getTerrainParams(testX, testY);
        if (testTerrain.pass > 0) {
          bestX = testX;
          bestY = testY;
          break;
        }
      }
    }

    return { x: bestX, y: bestY, targetId: target.id };
  }

  /**
   * 获取编队中心位置
   */
  getFormationCenter(formation, entities) {
    let totalX = 0, totalY = 0, count = 0;
    for (const memberId of formation.members) {
      const entity = entities.find(e => e.id === memberId);
      if (entity && entity.hp > 0) {
        totalX += entity.x;
        totalY += entity.y;
        count++;
      }
    }
    return count > 0 ?
      { x: totalX / count, y: totalY / count } :
      { x: 0, y: 0 };
  }

  /**
   * 获取编组队形中的目标位置
   */
  getFormationOffset(entity, formation) {
    const index = formation.members.indexOf(entity.id);
    if (index < 0) return { x: 0, y: 0 };

    const spacing = 40; // 单位间距

    switch (formation.type) {
      case 'wedge':
        // 楔形：领导在前，两翼展开
        if (index === 0) return { x: 0, y: 0 };
        const side = index % 2 === 0 ? 1 : -1;
        const depth = Math.floor((index - 1) / 2) + 1;
        return {
          x: -depth * spacing,
          y: side * depth * spacing * 0.6
        };

      case 'line':
        // 线形：横向展开
        const centerOffset = (formation.members.length - 1) / 2;
        return {
          x: 0,
          y: (index - centerOffset) * spacing
        };

      case 'column':
        // 纵队：纵向排列
        return {
          x: -index * spacing * 0.8,
          y: 0
        };

      case 'circle':
        // 环形：包围保护
        const angle = (index / formation.members.length) * Math.PI * 2;
        const radius = spacing;
        return {
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius
        };

      default:
        return { x: -index * spacing, y: 0 };
    }
  }

  /**
   * 执行编队机动（侧翼包抄）
   */
  executeFormationManeuver(entity, formation, allEntities, dt) {
    if (!formation || !formation.objective) return null;

    const objective = formation.objective;

    // 如果是编队领导，带队前往目标位置
    if (entity.isFormationLeader) {
      const dist = Math.hypot(objective.x - entity.x, objective.y - entity.y);

      if (dist < 30) {
        // 到达包抄位置，开始攻击
        entity.formationTarget = { id: objective.targetId };
        return { action: 'flanking_ready', target: objective.targetId };
      }

      // 向包抄位置移动
      return this.moveToPosition(entity, objective.x, objective.y, 20, dt);
    }

    // 编队成员跟随领导
    const leader = this.getEntityById(formation.leaderId, allEntities);
    if (!leader) return null;

    const offset = this.getFormationOffset(entity, formation);
    const leaderDir = (leader.heading || 0) * Math.PI / 180;

    // 将偏移量旋转到领导的朝向
    const rotatedOffset = {
      x: offset.x * Math.cos(leaderDir) - offset.y * Math.sin(leaderDir),
      y: offset.x * Math.sin(leaderDir) + offset.y * Math.cos(leaderDir)
    };

    const targetPos = {
      x: leader.x + rotatedOffset.x,
      y: leader.y + rotatedOffset.y
    };

    return this.moveToPosition(entity, targetPos.x, targetPos.y, 10, dt);
  }

  // ============ 学习方法 ============

  /**
   * 启用/禁用强化学习
   */
  setLearningEnabled(enabled) {
    this.enableLearning = enabled;
    console.log(`Tactical learning ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * 获取学习状态报告
   */
  getLearningReport() {
    if (!this.learner) return null;
    return this.learner.getLearningReport();
  }

  /**
   * 重置学习器
   */
  resetLearning() {
    if (this.learner) {
      this.learner.reset();
    }
  }

  /**
   * 导出学习到的策略
   */
  exportLearnedPolicy() {
    if (!this.learner) return null;
    return this.learner.exportPolicy();
  }

  /**
   * 导入学习策略
   */
  importLearnedPolicy(policy) {
    if (this.learner && policy) {
      this.learner.importPolicy(policy);
    }
  }

  /**
   * 辅助方法：通过ID获取实体
   */
  getEntityById(id, entities) {
    return entities?.find(e => e.id === id) || null;
  }
}

module.exports = SmartTacticalAI;
