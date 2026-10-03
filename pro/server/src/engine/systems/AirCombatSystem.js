/**
 * AirCombatSystem - 空战对决编排器
 * 负责把「决策 → 武器 → 飞行 → 导弹」四个环节按子步推进，
 * 并汇总战斗事件、航迹与对决态势供 Simulation 使用
 *
 * 之所以使用子步：对外 Simulation.step() 的 dt=1s，而战机速度可达 600m/s，
 * 单步位移过大会使轨迹呈折线且咬尾判定不稳定。内部按 0.1s 子步迭代，
 * 对外语义保持不变。
 */
const { isAirEntity } = require('../../data/equipment/Database');
const FlightModel = require('./FlightModel');
const MissileSystem = require('./MissileSystem');
const AirCombatAI = require('../ai/AirCombatAI');
const { MANEUVER_LABELS } = require('../ai/AirCombatAI');

class AirCombatSystem {
  constructor(terrain, combatResolver, config = {}) {
    this.terrain = terrain;
    this.combat = combatResolver; // CombatSystem（裁决解算复用）
    this.flight = new FlightModel(terrain);
    this.missiles = new MissileSystem(terrain, config.damageScale ?? 0.3);
    this.ai = new AirCombatAI(terrain);

    this.subSteps = config.subSteps || 10;          // 每仿真秒的子步数
    this.duelMaxSec = config.duelMaxSec || 300;     // 单场对决上限（秒）
    this.damageScale = config.damageScale ?? 0.3;   // 伤害缩放：让格斗能持续数十秒
    this.trailMaxPoints = config.trailMaxPoints || 150;
    this.trailMinStep = config.trailMinStep || 25;  // 采样最小间距（米）

    this.trails = new Map();  // entityId -> [[x,y,z], ...]
    this.elapsed = 0;
    this.ended = null;        // { winner, reason }
    this.style = 'balanced';
    this.policy = 'rule';     // rule | hybrid | rl
  }

  /**
   * 开启对决前的初始化
   */
  init(entities, options = {}) {
    this.reset();
    this.style = options.style || 'balanced';
    this.setPolicy(options.policy || 'rule');
    this.ai.setStyle(this.style);
    if (options.damageScale !== undefined) this.damageScale = options.damageScale;
    this.missiles.damageScale = this.damageScale;

    for (const e of entities) {
      if (!isAirEntity(e)) continue;
      this.flight.initEntity(e);
      e.duelStyle = options.stylePerSide?.[e.side] || this.style;
      e.duelPolicy = options.policyPerSide?.[e.side] || this.policy;
      e.status = 'patrolling';
      e.bfmState = 'cruise';
      e.bfmManeuver = 'patrol';
      this.trails.set(e.id, [[Math.round(e.x), Math.round(e.y), Math.round(e.z || 0)]]);
    }
  }

  reset() {
    this.missiles.clear();
    this.ai.reset();
    this.trails.clear();
    this.elapsed = 0;
    this.ended = null;
  }

  setStyle(style) {
    this.style = style || 'balanced';
    this.ai.setStyle(this.style);
    return this.style;
  }

  /**
   * 切换决策策略：rule（规则专家系统）/ hybrid（RL机动+规则兜底）/ rl（纯 RL 机动）
   */
  setPolicy(policy) {
    this.policy = policy || 'rule';
    this.ai.setPolicy(this.policy);
    return this.policy;
  }

  /**
   * 选择目标：优先最近的敌方空中单位，其次任意敌方单位
   */
  pickTarget(entity, entities) {
    let best = null;
    let bestScore = -Infinity;
    for (const other of entities) {
      if (other.hp <= 0 || other.side === entity.side) continue;
      const dist = Math.hypot(other.x - entity.x, other.y - entity.y);
      const score = (isAirEntity(other) ? 100000 : 0) - dist;
      if (score > bestScore) {
        bestScore = score;
        best = other;
      }
    }
    return best;
  }

  /**
   * 推进一个仿真步（内部展开 subSteps 个子步）
   * @param {Array} entities - 全部实体
   * @param {number} dt - 仿真步时长（秒）
   * @returns {Object} { events, missiles, trails, elapsed, ended }
   */
  update(entities, dt) {
    const events = [];
    const subDt = dt / this.subSteps;

    // 每个仿真步重置「航炮未命中」上报标记
    for (const e of entities) {
      if (isAirEntity(e)) e.__cannonMissEmitted = false;
    }

    for (let s = 0; s < this.subSteps && !this.ended; s++) {
      const airEntities = entities.filter(e => e.hp > 0 && isAirEntity(e));

      // ---- 1. 决策 + 武器 ----
      const commands = new Map();
      for (const entity of airEntities) {
        const target = this.pickTarget(entity, entities);
        const incoming = this.missiles.getIncoming(entity.id);
        const cmd = this.ai.decide(entity, target, incoming, subDt);
        commands.set(entity.id, cmd);
        entity.__targetId = target?.id || null;
        entity.bfmState = cmd.state;
        entity.bfmManeuver = cmd.maneuverName;
        entity.status = this.statusFromState(cmd);

        this.updateTimers(entity, subDt);
        this.handleWeapons(entity, target, cmd, subDt, events);
      }

      // ---- 2. 飞行积分 ----
      for (const entity of airEntities) {
        const cmd = commands.get(entity.id);
        if (!cmd || entity.hp <= 0) continue;
        this.flight.update(entity, cmd, subDt);
        this.recordTrail(entity);
      }

      // ---- 3. 导弹推进与结算 ----
      const results = this.missiles.update(entities, subDt);
      for (const r of results) {
        this.convertMissileResult(r, events);
      }

      this.elapsed += subDt;

      // ---- 4. 结束判定 ----
      const survivors = airEntities.filter(e => e.hp > 0);
      const sidesAlive = new Set(survivors.map(e => e.side));
      if (survivors.length <= 1 && sidesAlive.size <= 1 && airEntities.length > 0) {
        this.ended = {
          winner: survivors[0]?.side || 'draw',
          reason: survivors[0]
            ? `${survivors[0].side === 'red' ? '红' : '蓝'}方战机击落对手，获得制空权`
            : '双方战机同归于尽'
        };
        break;
      }
      if (this.elapsed >= this.duelMaxSec) {
        this.ended = this.judgeByHealth(entities);
        break;
      }
    }

    return {
      events,
      missiles: this.missiles.snapshot(),
      trails: this.trailSnapshot(),
      elapsed: this.elapsed,
      ended: this.ended
    };
  }

  updateTimers(entity, dt) {
    entity.fireCooldown = Math.max(0, (entity.fireCooldown || 0) - dt);
    entity.missileReload = Math.max(0, (entity.missileReload || 0) - dt);
    entity.flareCooldown = Math.max(0, (entity.flareCooldown || 0) - dt);
  }

  statusFromState(cmd) {
    if (cmd.state === 'evade_missile') return 'evading';
    if (cmd.state === 'defensive') return 'evading';
    if (cmd.fireCannon || cmd.launchMissile) return 'attacking';
    if (cmd.state === 'offensive') return 'pursuing';
    return 'patrolling';
  }

  /**
   * 处理航炮 / 导弹 / 干扰弹
   */
  handleWeapons(entity, target, cmd, dt, events) {
    // 干扰弹
    if (cmd.flare && (entity.flareCount || 0) > 0 && (entity.flareCooldown || 0) <= 0) {
      entity.flareCount -= 1;
      entity.flareActiveUntil = Date.now() + 1800;
      entity.flareCooldown = 1.5; // 避免一次性把干扰弹全部打光
      events.push({
        kind: 'flare',
        entityId: entity.id,
        entityName: entity.name,
        side: entity.side,
        remaining: entity.flareCount
      });
    }

    if (!target || target.hp <= 0) return;

    // 航炮（射速很高，未命中事件每仿真步最多上报一次，避免日志/动画刷屏）
    if (cmd.fireCannon && (entity.fireCooldown || 0) <= 0) {
      const result = this.combat.resolveCannon(entity, target, this.damageScale);
      if (result && (result.hit || !entity.__cannonMissEmitted)) {
        if (!result.hit) entity.__cannonMissEmitted = true;
        events.push({
          kind: 'cannon',
          attacker: entity,
          target,
          distance: result.distance,
          ataDeg: result.ataDeg,
          hit: result.hit,
          damage: result.damage
        });
      }
    }

    // 空空导弹
    if (cmd.launchMissile && (entity.missileCount || 0) > 0 && (entity.missileReload || 0) <= 0) {
      const missile = this.missiles.launch(entity, target);
      if (missile) {
        entity.missileReload = entity.airCombat?.missile?.reloadSec || 3;
        events.push({
          kind: 'missile_launch',
          attacker: entity,
          target,
          missile,
          distance: Math.round(Math.hypot(target.x - entity.x, target.y - entity.y))
        });
      }
    }
  }

  convertMissileResult(result, events) {
    const { outcome, missile, target, damage } = result;
    switch (outcome) {
      case 'hit':
        events.push({
          kind: 'missile_hit',
          attacker: { id: missile.shooterId, name: missile.shooterName, side: missile.side },
          target,
          damage,
          hit: true,
          distance: Math.round(Math.hypot(target.x - missile.x, target.y - missile.y))
        });
        break;
      case 'miss':
      case 'decoyed':
        events.push({
          kind: 'missile_miss',
          attacker: { id: missile.shooterId, name: missile.shooterName, side: missile.side },
          target,
          reason: outcome === 'decoyed' ? 'flare' : 'evaded',
          hit: false,
          damage: 0,
          distance: Math.round(Math.hypot(target.x - missile.x, target.y - missile.y))
        });
        break;
      case 'expired':
        events.push({
          kind: 'missile_expired',
          attacker: { id: missile.shooterId, name: missile.shooterName, side: missile.side },
          target: null,
          reason: result.reason,
          hit: false,
          damage: 0
        });
        break;
      default:
        break;
    }
  }

  /**
   * 超时判定：按剩余血量比例裁定优势方
   */
  judgeByHealth(entities) {
    const airEntities = entities.filter(e => isAirEntity(e));
    const score = side => {
      const list = airEntities.filter(e => e.side === side);
      if (list.length === 0) return 0;
      return list.reduce((sum, e) => sum + (e.hp / (e.maxHp || 1)), 0) / list.length;
    };
    const red = score('red');
    const blue = score('blue');
    if (Math.abs(red - blue) < 0.05) {
      return { winner: 'draw', reason: '对决超时，双方均未取得决定性优势' };
    }
    const winner = red > blue ? 'red' : 'blue';
    return { winner, reason: `对决超时，按剩余血量判定${winner === 'red' ? '红' : '蓝'}方优势` };
  }

  recordTrail(entity) {
    let trail = this.trails.get(entity.id);
    if (!trail) {
      trail = [];
      this.trails.set(entity.id, trail);
    }
    const last = trail[trail.length - 1];
    if (last && Math.hypot(last[0] - entity.x, last[1] - entity.y) < this.trailMinStep) return;
    trail.push([Math.round(entity.x), Math.round(entity.y), Math.round(entity.z || 0)]);
    if (trail.length > this.trailMaxPoints) trail.shift();
  }

  trailSnapshot() {
    // 必须深拷贝点位：this.trails 里的数组会被 recordTrail() 原地 push/shift，
    // 若直接把引用交给回放帧，保存时所有帧都会变成同一份「最终航迹」
    const out = [];
    for (const [entityId, points] of this.trails) {
      out.push({ entityId, points: points.map(p => [p[0], p[1], p[2]]) });
    }
    return out;
  }

  /**
   * 输出供前端展示的对决态势
   */
  getSnapshot(entities) {
    const airEntities = entities.filter(e => isAirEntity(e));
    const parties = {};
    for (const side of ['red', 'blue']) {
      const list = airEntities.filter(e => e.side === side);
      if (list.length === 0) {
        parties[side] = null;
        continue;
      }
      const e = list[0];
      parties[side] = {
        id: e.id,
        name: e.name,
        side: e.side,
        hp: Math.round(e.hp),
        maxHp: e.maxHp,
        hpPercent: Math.round((e.hp / (e.maxHp || 1)) * 100),
        alive: e.hp > 0,
        altitude: Math.round(e.z || 0),
        speedKmh: Math.round((e.speedMs || Math.hypot(e.vx || 0, e.vy || 0)) * 3.6),
        heading: Math.round(e.heading),
        pitch: Math.round(e.pitch || 0),
        roll: Math.round(e.roll || 0),
        missiles: e.missileCount || 0,
        flares: e.flareCount || 0,
        state: e.bfmState || 'cruise',
        maneuver: e.bfmManeuver || 'patrol',
        maneuverLabel: MANEUVER_LABELS[e.bfmManeuver] || '机动中',
        status: e.status,
        targetId: e.__targetId || null,
        // 是否被来袭导弹锁定（用于前端告警）
        lockedBy: this.missiles.missiles.some(m => m.targetId === e.id),
        incomingCount: this.missiles.missiles.filter(m => m.targetId === e.id).length,
        totalUnits: list.length
      };
    }

    const [a, b] = airEntities;
    let distance = null;
    let aspect = null;
    if (a && b) {
      distance = Math.round(Math.hypot(a.x - b.x, a.y - b.y));
      const bearing = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
      const diff = Math.abs(((b.heading - bearing) % 360 + 360) % 360);
      const aa = diff > 180 ? 360 - diff : diff;
      if (aa < 45) aspect = 'red_tail_chase';
      else if (aa > 135) aspect = 'head_on';
      else aspect = 'beam';
    }

    return {
      enabled: true,
      time: Math.round(this.elapsed),
      maxTime: this.duelMaxSec,
      winner: this.ended?.winner || null,
      reason: this.ended?.reason || '',
      parties,
      distance,
      aspect,
      missileCount: this.missiles.missiles.length
    };
  }
}

module.exports = AirCombatSystem;
