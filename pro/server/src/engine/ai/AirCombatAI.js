/**
 * AirCombatAI - 双机格斗（BFM）决策
 *
 * 态势量定义（标准近距空战几何）：
 *  LOS      : 我方到目标机的视线方位角 B
 *  ATA      : 我方机头与 LOS 的夹角，0° 表示机头正对目标（可开炮）
 *  AA       : 目标机头与 LOS 的夹角，0° 表示我方咬住目标尾后，180° 为对头
 *  enemyATA : 目标机头与其到我方 LOS 的夹角，0° 表示目标正瞄准我（威胁）
 *  closing  : 接近率，正值表示双方距离在缩小
 *
 * 决策优先级：规避来袭导弹 > 防御机动 > 进攻/占位 > 巡航
 */
const { clamp, norm360, angleDiff } = require('../systems/FlightModel');

const MANEUVER_LABELS = {
  patrol: '巡航待战',
  intercept_climb: '爬升占位',
  pursuit: '尾后追击',
  lead_pursuit: '前置追踪（抢占射击位）',
  high_yoyo: '高悠悠（防止冲过头）',
  low_yoyo: '低悠悠（加速接近）',
  lag_pursuit: '滞后追踪（保能量）',
  merge_offset: '交汇偏置（转入缠斗）',
  missile_lock: '火控雷达锁定',
  missile_launch: '发射中距弹',
  break_turn: '防御急转（破坏敌方射击位）',
  barrel_roll_defense: '防御桶滚',
  split_s: '破S机动（下降翻转）',
  defensive_spiral: '防御盘旋',
  beam_evade: '侧转脱离导弹',
  flare_evade: '释放干扰弹 + 急转',
  extend: '加速脱离（拉开距离）'
};

class AirCombatAI {
  constructor(terrain) {
    this.terrain = terrain;
    this.memories = new Map(); // entityId -> 战术记忆
    this.style = 'balanced';   // aggressive | balanced | defensive
    this.policy = 'rule';      // rule | hybrid | rl（rl/hybrid 由 Q-learning 策略选机动）
    this.rl = null;            // BFMPolicy 实例（按需加载）
  }

  reset() {
    this.memories.clear();
  }

  setStyle(style) {
    this.style = style || 'balanced';
  }

  /**
   * 切换决策策略
   * @param {'rule'|'hybrid'|'rl'} policy
   *   rule   : 纯规则专家系统（BFM 手册）
   *   hybrid : RL 选机动 + 来袭导弹时规则兜底
   *   rl     : 完全由 RL 策略选机动（含规避）
   */
  setPolicy(policy) {
    this.policy = policy || 'rule';
    if (this.policy !== 'rule' && !this.rl) {
      // 延迟 require，避免与 trainer 形成模块循环依赖
      this.rl = require('../../ai/BFMPolicy').getPolicy();
    }
    return this.policy;
  }

  getMemory(entityId) {
    if (!this.memories.has(entityId)) {
      this.memories.set(entityId, {
        state: 'cruise',
        lockTime: 0,
        flareTimer: 0,
        lastManeuver: 'patrol',
        maneuverHoldSec: 0,
        // RL 决策：动作保持时间，避免每个子步抖动切换机动
        rlHoldSec: 0,
        lastRlAction: null,
        // 每架机的转向偏好，避免两台相同 AI 完全镜像导致僵局
        turnBias: Math.random() < 0.5 ? -1 : 1,
        patrolHeading: 0
      });
    }
    return this.memories.get(entityId);
  }

  /**
   * 计算机空战态势
   */
  computeSituation(self, target) {
    const dx = target.x - self.x;
    const dy = target.y - self.y;
    const dist = Math.max(1, Math.hypot(dx, dy));
    const bearing = norm360(Math.atan2(dy, dx) * 180 / Math.PI);

    // LOS 单位向量
    const ux = dx / dist;
    const uy = dy / dist;

    const myVelX = Math.cos(self.heading * Math.PI / 180) * (self.speedMs || 200);
    const myVelY = Math.sin(self.heading * Math.PI / 180) * (self.speedMs || 200);
    const tgVelX = Math.cos(target.heading * Math.PI / 180) * (target.speedMs || 200);
    const tgVelY = Math.sin(target.heading * Math.PI / 180) * (target.speedMs || 200);

    // 接近率：双方速度在 LOS 上的投影之差
    const closing = (myVelX - tgVelX) * ux + (myVelY - tgVelY) * uy;

    const absDiff = (a, b) => Math.abs(angleDiff(a, b));

    return {
      dist,
      bearing,
      closing,
      altDiff: (target.z || 0) - (self.z || 0),
      targetAltitude: target.z || 0,
      // 我方机头偏离目标的夹角
      myATA: absDiff(self.heading, bearing),
      // 目标相对我方的进入角：0=我在其尾后，180=对头
      AA: absDiff(target.heading, bearing),
      // 目标机头对准我的程度
      enemyATA: absDiff(target.heading, bearing + 180)
    };
  }

  /**
   * 高度限制：把期望高度限制在机型巡航高度附近的合理空战层
   * 避免双方不断爬升比高度，最终飞到平流层
   */
  clampAltitude(entity, altitude) {
    const cruise = entity.height || 5000;
    const maxAlt = entity.maxAltitude || 18000;
    const low = Math.max(500, cruise - 2500);
    const high = Math.min(maxAlt, cruise + 2500);
    return clamp(altitude, low, high);
  }

  /**
   * 追击/占位时的目标高度（相对目标机偏移）
   */
  chaseAltitude(entity, target, offset = 0) {
    const targetAlt = target ? (target.z || entity.height || 5000) : (entity.height || 5000);
    return this.clampAltitude(entity, targetAlt + offset);
  }

  /**
   * 计算拦截点的最优航向（前置量修正）
   */
  interceptHeading(self, target, projectileSpeed) {
    const dist = Math.hypot(target.x - self.x, target.y - self.y);
    const time = Math.min(8, dist / Math.max(120, projectileSpeed));
    const aimX = target.x + (target.vx || 0) * time;
    const aimY = target.y + (target.vy || 0) * time;
    return norm360(Math.atan2(aimY - self.y, aimX - self.x) * 180 / Math.PI);
  }

  /**
   * 巡航巡逻（无目标时在战场上空盘旋）
   */
  patrolCommand(entity, memory, dt) {
    const w = this.terrain ? this.terrain.width : 10000;
    const h = this.terrain ? this.terrain.height : 10000;
    const margin = 1500;

    const cx = w / 2;
    const cy = h / 2;
    const towardCenter = norm360(Math.atan2(cy - entity.y, cx - entity.x) * 180 / Math.PI);
    const nearEdge = entity.x < margin || entity.y < margin || entity.x > w - margin || entity.y > h - margin;

    return {
      desiredHeading: nearEdge ? towardCenter : norm360(entity.heading + 25 * dt * memory.turnBias),
      desiredAltitude: entity.targetAltitude || entity.z || 5000,
      throttle: 1,
      evasive: false,
      fireCannon: false,
      launchMissile: false,
      flare: false,
      maneuverName: 'patrol',
      state: 'cruise'
    };
  }

  /**
   * 主决策入口
   * @param {Object} entity - 己方战机
   * @param {Object} target - 目标战机（可能为 null）
   * @param {Array} incomingMissiles - 正在飞向自己的导弹
   * @param {number} dt - 子步长（秒）
   */
  decide(entity, target, incomingMissiles, dt) {
    const memory = this.getMemory(entity.id);
    const ac = entity.airCombat || {};
    const cannon = ac.cannon || { range: 1000, coneDeg: 10, damage: 60, fireRate: 5, accuracy: 0.7 };
    const missileSpec = ac.missile || { count: 0, range: 0, launchMin: 0, damage: 0, lockSec: 1.5 };
    const style = entity.duelStyle || this.style;
    const useRL = entity.duelPolicy || this.policy;
    // RL 动作保持计时
    memory.rlHoldSec = Math.max(0, (memory.rlHoldSec || 0) - dt);

    const baseHeading = entity.heading;
    const maxAlt = entity.maxAltitude || 18000;
    const cmd = {
      desiredHeading: baseHeading,
      desiredAltitude: this.chaseAltitude(entity, target, 0),
      throttle: 1,
      evasive: false,
      fireCannon: false,
      launchMissile: false,
      flare: false,
      maneuverName: 'patrol',
      state: 'cruise'
    };

    if (!target || target.hp <= 0) {
      return this.patrolCommand(entity, memory, dt);
    }

    const sit = this.computeSituation(entity, target);
    const enemyAc = target.airCombat || {};
    const enemyCannon = enemyAc.cannon || { range: 1000 };
    const enemyMissile = enemyAc.missile || { range: 0 };
    const enemyWeaponRange = Math.max(enemyCannon.range, (enemyMissile.range || 0) * 0.6);

    // ---------- 1. 来袭导弹规避（最高优先级） ----------
    const threat = this.pickMostDangerous(entity, incomingMissiles);
    if (threat && threat.timeToImpact < (style === 'aggressive' ? 3.2 : 4.5)) {
      // rl 模式下连规避机动也交给策略（hybrid 仍走规则兜底）
      if (useRL === 'rl') {
        return this.rlCommand(entity, target, sit, memory, cmd, threat);
      }
      memory.state = 'evade_missile';
      memory.lockTime = 0;

      // 侧转：把导弹放到 3/9 点位，最大化 LOS 角速度
      const missileBearing = norm360(Math.atan2(threat.missile.y - entity.y, threat.missile.x - entity.x) * 180 / Math.PI);
      const sideOptions = [90, -90].map(off => norm360(missileBearing + off));
      const desired = Math.abs(angleDiff(sideOptions[0], baseHeading)) <= Math.abs(angleDiff(sideOptions[1], baseHeading))
        ? sideOptions[0] : sideOptions[1];

      cmd.desiredHeading = desired;
      cmd.desiredAltitude = this.clampAltitude(entity, (entity.z || 5000) - 600);
      cmd.throttle = 1;
      cmd.evasive = true;
      cmd.state = 'evade_missile';

      // 近距离且干扰弹可用 → 投放
      const canFlare = (entity.flareCount || 0) > 0 &&
        threat.dist < (style === 'defensive' ? 3200 : 2400);
      if (canFlare) {
        cmd.flare = true;
        cmd.maneuverName = 'flare_evade';
      } else {
        cmd.maneuverName = 'beam_evade';
      }
      return cmd;
    }

    // ---------- 2. 防御：被咬尾且处于敌方武器包线内 ----------
    const iHaveNose = sit.myATA < 40;
    const heHasNose = sit.enemyATA < 45;
    const iHaveTail = sit.AA < 60; // 我在目标尾后
    const threatened = heHasNose && !iHaveNose && sit.dist < enemyWeaponRange;

    if (threatened) {
      if (useRL === 'rl' || useRL === 'hybrid') {
        return this.rlCommand(entity, target, sit, memory, cmd, threat);
      }
      memory.state = 'defensive';
      memory.lockTime = 0;
      return this.defensiveCommand(entity, target, sit, memory, style, maxAlt, dt, cmd);
    }

    // ---------- 3. 进攻 / 占位 ----------
    if (useRL === 'rl' || useRL === 'hybrid') {
      return this.rlCommand(entity, target, sit, memory, cmd, threat);
    }
    memory.state = iHaveTail || iHaveNose ? 'offensive' : 'neutral';
    return this.offensiveCommand(entity, target, sit, memory, cannon, missileSpec, style, maxAlt, dt, cmd);
  }

  /**
   * RL 决策入口：把态势离散成状态键 → Q 表选机动 → 翻译成飞行指令
   */
  rlCommand(entity, target, sit, memory, cmd, threat) {
    if (!this.rl) this.setPolicy(this.policy);
    const hasThreat = !!threat && threat.timeToImpact < 5;
    const hasMissile = (entity.missileCount || 0) > 0;
    const key = this.rl.encode(sit, hasThreat, hasMissile);

    // 动作保持：机动切换后维持 0.5s，避免高频抖动
    let action = null;
    if ((memory.rlHoldSec || 0) > 0 && memory.lastRlAction) {
      action = memory.lastRlAction;
    } else {
      action = this.rl.select(key, this.rl.explore);
      memory.lastRlAction = action;
      memory.rlHoldSec = 0.5;
    }
    entity.__rlAction = action;      // 训练器据此取回实际执行的动作

    return this.applyManeuver(entity, target, sit, memory, action, cmd, threat);
  }

  /**
   * 把 RL 选出的机动原语翻译成飞行指令；武器发射仍走规则裁决
   */
  applyManeuver(entity, target, sit, memory, action, cmd, threat) {
    const cross = memory.turnBias;
    const enemyBearing = norm360(sit.bearing + 180); // 敌机相对我的方位
    const desiredLead = this.interceptHeading(entity, target, 1400);
    const myAlt = entity.z || 5000;

    let desired = desiredLead;
    let altitude = this.clampAltitude(entity, target.z || 5000);
    let evasive = false;

    switch (action) {
      case 'lag_pursuit':
        desired = norm360(sit.bearing + 22 * cross);
        altitude = this.clampAltitude(entity, myAlt + 300);
        break;
      case 'high_yoyo':
        desired = norm360(sit.bearing + 18 * cross);
        altitude = this.clampAltitude(entity, myAlt + 700);
        break;
      case 'low_yoyo':
        desired = desiredLead;
        altitude = this.clampAltitude(entity, myAlt - 500);
        break;
      case 'break_turn':
        desired = norm360(enemyBearing + 95 * cross);
        altitude = this.clampAltitude(entity, myAlt + (sit.altDiff > 0 ? 300 : -300));
        evasive = true;
        break;
      case 'barrel_roll_defense':
        desired = norm360(enemyBearing + 110 * cross);
        altitude = this.clampAltitude(entity, myAlt + 400 * cross);
        evasive = true;
        break;
      case 'split_s':
        desired = norm360(enemyBearing + 130 * cross);
        altitude = this.clampAltitude(entity, myAlt - 800);
        evasive = true;
        break;
      case 'defensive_spiral':
        desired = norm360(enemyBearing + 70 * cross);
        altitude = this.clampAltitude(entity, myAlt);
        evasive = true;
        break;
      case 'extend':
        desired = norm360(sit.bearing + 180 + 20 * cross);
        altitude = this.clampAltitude(entity, myAlt + 200);
        break;
      case 'merge_offset':
        desired = norm360(sit.bearing + 28 * cross);
        altitude = this.chaseAltitude(entity, target, 200);
        break;
      case 'lead_pursuit':
      default:
        desired = desiredLead;
        altitude = this.clampAltitude(entity, target.z || 5000);
        break;
    }

    cmd.desiredHeading = desired;
    cmd.desiredAltitude = altitude;
    cmd.throttle = 1;
    cmd.evasive = evasive;
    cmd.maneuverName = action;
    cmd.state = evasive ? 'defensive' : 'offensive';

    // ---- 武器：规则裁决（RL 只负责机动，保证行为可解释且训练空间可控） ----
    const cannon = entity.airCombat?.cannon || { range: 1000, coneDeg: 10 };
    if (sit.dist <= cannon.range && sit.myATA <= cannon.coneDeg) {
      cmd.fireCannon = true;
      cmd.desiredHeading = desiredLead; // 开火瞬间保持前置跟踪
    }
    const ms = entity.airCombat?.missile || {};
    if ((entity.missileCount || 0) > 0 && sit.myATA < 40 &&
        sit.dist > Math.max(1500, ms.launchMin || 0) && sit.dist < (ms.range || 0) * 0.85) {
      cmd.launchMissile = true;
    }
    // 干扰弹属于安全兜底，任何模式都保留
    if (threat && threat.dist < 2600 && (entity.flareCount || 0) > 0) {
      cmd.flare = true;
      if (cmd.maneuverName === 'lead_pursuit') cmd.maneuverName = 'flare_evade';
    }
    return cmd;
  }

  pickMostDangerous(entity, missiles) {
    let worst = null;
    for (const m of missiles || []) {
      const dist = Math.hypot(m.x - entity.x, m.y - entity.y);
      const timeToImpact = dist / Math.max(100, m.speed);
      if (!worst || timeToImpact < worst.timeToImpact) {
        worst = { missile: m, dist, timeToImpact };
      }
    }
    return worst;
  }

  /**
   * 防御机动：根据距离与能量选择破S、桶滚或防御盘旋
   */
  defensiveCommand(entity, target, sit, memory, style, maxAlt, dt, cmd) {
    const enemyBearing = norm360(sit.bearing + 180); // 目标相对我的方位（目标 -> 我）
    // 朝来袭方的侧后方急转，破坏其射击位置
    const cross = memory.turnBias;

    let desired;
    let altitude;
    let maneuver;

    if (sit.dist < 900) {
      // 极近距：桶滚 / 破S —— 大幅改变机头指向并保持能量
      desired = norm360(enemyBearing + 110 * cross);
      altitude = this.clampAltitude(entity, (entity.z || 5000) - 400 * (Math.random() < 0.5 ? 1 : -1));
      maneuver = Math.random() < 0.5 ? 'barrel_roll_defense' : 'split_s';
    } else if (sit.dist < 2200) {
      // 中近距：防御急转（向敌机航向垂直方向切半径）
      desired = norm360(enemyBearing + 95 * cross);
      altitude = this.clampAltitude(entity, (entity.z || 5000) + (sit.altDiff > 0 ? 300 : -300));
      maneuver = 'break_turn';
    } else {
      // 远距离威胁：防御盘旋 + 拉开或压缩距离
      desired = norm360(enemyBearing + 70 * cross);
      altitude = this.clampAltitude(entity, entity.z || 5000);
      maneuver = 'defensive_spiral';
    }

    cmd.desiredHeading = desired;
    cmd.desiredAltitude = altitude;
    cmd.throttle = 1;
    cmd.evasive = true;
    cmd.state = 'defensive';
    cmd.maneuverName = maneuver;

    // 防御中若获得瞄准窗口，仍可反击
    const cannonSpec = target.airCombat?.cannon || {};
    if (sit.myATA < 25 && sit.dist < (cannonSpec.range || 1000)) {
      cmd.fireCannon = true;
    }

    // 防御反击：机头已指向对手且处于中距时发射导弹
    const myMissile = entity.airCombat?.missile || {};
    if (sit.myATA < 30 && (entity.missileCount || 0) > 0 &&
        sit.dist > 2000 && sit.dist < (myMissile.range || 0) * 0.8) {
      cmd.launchMissile = true;
    }
    return cmd;
  }

  /**
   * 进攻：先占位锁定，再中距弹，最后进入航炮缠斗
   */
  offensiveCommand(entity, target, sit, memory, cannon, missileSpec, style, maxAlt, dt, cmd) {
    const hasMissile = (entity.missileCount || 0) > 0 && (missileSpec.range || 0) > 0;
    const canLock = hasMissile && sit.dist > Math.max(2000, missileSpec.launchMin || 0) &&
      sit.dist < missileSpec.range * 0.9 && sit.myATA < 60;

    // 对头交汇：加偏置转入缠斗，避免相撞与反复对冲
    const headOn = sit.AA > 135;
    if (headOn && sit.dist < 3200) {
      cmd.desiredHeading = norm360(sit.bearing + 28 * memory.turnBias);
      cmd.desiredAltitude = this.chaseAltitude(entity, target, 200);
      cmd.maneuverName = 'merge_offset';
      cmd.state = 'offensive';
      memory.lockTime = 0;
      return cmd;
    }

    // 中距锁定/发射
    if (canLock) {
      memory.lockTime += dt;
      cmd.desiredHeading = this.interceptHeading(entity, target, missileSpec.speed || 1000);
      cmd.desiredAltitude = this.chaseAltitude(entity, target, 600);
      if (memory.lockTime >= (missileSpec.lockSec || 1.5)) {
        cmd.launchMissile = true;
        cmd.maneuverName = 'missile_launch';
        memory.lockTime = 0;
      } else {
        cmd.maneuverName = 'missile_lock';
      }
      cmd.state = 'offensive';
      return cmd;
    }
    memory.lockTime = Math.max(0, memory.lockTime - dt * 0.5);

    // 远距占位：爬升到目标上方取得能量优势
    if (hasMissile && sit.dist > missileSpec.range) {
      cmd.desiredHeading = this.interceptHeading(entity, target, entity.speedMs || 300);
      cmd.desiredAltitude = this.chaseAltitude(entity, target, 900);
      cmd.maneuverName = 'intercept_climb';
      cmd.state = 'neutral';
      return cmd;
    }

    // ---------- 航炮缠斗 ----------
    const desiredLead = this.interceptHeading(entity, target, 1400); // 航炮弹丸初速
    let desired = desiredLead;
    let altitude = this.clampAltitude(entity, target.z || 5000);
    let maneuver = 'lead_pursuit';

    // 冲过头保护：距离很近且接近率高 → 高悠悠（抬机头爬升，保持滞后优势）
    if (sit.dist < 800 && sit.closing > 260) {
      desired = norm360(sit.bearing + 18 * memory.turnBias);
      altitude = this.clampAltitude(entity, (entity.z || 5000) + 700);
      maneuver = 'high_yoyo';
    } else if (sit.dist < cannon.range * 1.6 && sit.closing < 40 && sit.dist > 500) {
      // 追不上：低悠悠俯冲换速度
      altitude = this.clampAltitude(entity, (entity.z || 5000) - 500);
      maneuver = 'low_yoyo';
    } else if (sit.myATA > 70) {
      desired = desiredLead;
      altitude = this.clampAltitude(entity, (entity.z || 5000) + 300);
      maneuver = 'lag_pursuit';
    }

    cmd.desiredHeading = desired;
    cmd.desiredAltitude = altitude;
    cmd.throttle = style === 'aggressive' ? 1 : 1;
    cmd.state = 'offensive';
    cmd.maneuverName = maneuver;

    // 射击窗口判定：机炮弹道在射击锥内且距离合适
    if (sit.dist <= cannon.range && sit.myATA <= cannon.coneDeg) {
      cmd.fireCannon = true;
      cmd.desiredHeading = desiredLead; // 开火瞬间保持前置跟踪
    }
    return cmd;
  }
}

module.exports = AirCombatAI;
module.exports.MANEUVER_LABELS = MANEUVER_LABELS;
