/**
 * MissileSystem - 空空导弹系統
 * 职责：导弹生成、比例导引飞行、近炸/直击判定、生命周期与自毁、干扰弹脱锁
 * 导弹不进入 sim.entities，避免污染地面 AI / 统计 / 结束判定
 */
const { clamp, norm360, angleDiff } = require('./FlightModel');

class MissileSystem {
  constructor(terrain, damageScale = 1) {
    this.terrain = terrain;
    this.missiles = [];
    this.nextMissileId = 1;
    this.maxMissiles = 32;
    // 伤害缩放：与航炮一致，避免一枚导弹直接秒杀
    this.damageScale = damageScale;
  }

  /**
   * 发射导弹
   * @param {Object} shooter - 发射载机
   * @param {Object} target - 目标机
   * @returns {Object|null} 导弹对象
   */
  launch(shooter, target) {
    const ac = shooter.airCombat || {};
    const spec = ac.missile || {};
    if ((shooter.missileCount || 0) <= 0) return null;
    if (this.missiles.length >= this.maxMissiles) return null;

    shooter.missileCount -= 1;

    const missile = {
      id: `m${this.nextMissileId++}`,
      side: shooter.side,
      shooterId: shooter.id,
      shooterName: shooter.name,
      targetId: target.id,
      targetName: target.name,
      x: shooter.x,
      y: shooter.y,
      z: shooter.z || 0,
      heading: shooter.heading,
      speed: spec.speed || 1000,
      maxTurnRate: spec.maxTurnRateDeg || 45,
      damage: (spec.damage || 120) * this.damageScale,
      hitProb: spec.hitProb || 0.7,
      proxyFuze: spec.proxyFuze || 40,
      life: spec.lifeSec || 12,
      seeker: spec.seeker || 'ir',
      evaded: false
    };

    this.missiles.push(missile);
    return missile;
  }

  /**
   * 目标是否被导弹锁定（用于 UI 告警与 AI 决策）
   */
  getIncoming(entityId) {
    return this.missiles.filter(m => m.targetId === entityId);
  }

  /**
   * 推进所有导弹一个子步
   * @param {Array} entities - 所有实体（用于取目标实时位置）
   * @param {number} dt - 子步长（秒）
   * @returns {Array} 结算结果 [{ outcome, missile, target, damage, reason }]
   */
  update(entities, dt) {
    const results = [];

    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const missile = this.missiles[i];
      const target = entities.find(e => e.id === missile.targetId);

      missile.life -= dt;

      // 目标已损毁或寿命耗尽 → 自毁
      if (!target || target.hp <= 0) {
        results.push({ outcome: 'lost', missile, target, reason: 'target_down' });
        this.missiles.splice(i, 1);
        continue;
      }
      if (missile.life <= 0) {
        results.push({ outcome: 'expired', missile, target, reason: 'fuel' });
        this.missiles.splice(i, 1);
        continue;
      }
      if (this.isOutOfBounds(missile)) {
        results.push({ outcome: 'expired', missile, target, reason: 'out_of_bounds' });
        this.missiles.splice(i, 1);
        continue;
      }

      // ---- 提前拦截命中点（比例导引）+ 受限转向 ----
      const dist = Math.hypot(target.x - missile.x, target.y - missile.y);
      const closing = Math.max(60, missile.speed - (target.speedMs || 0));
      const timeToImpact = Math.min(6, dist / closing);
      const aimX = target.x + (target.vx || 0) * timeToImpact;
      const aimY = target.y + (target.vy || 0) * timeToImpact;

      const desired = Math.atan2(aimY - missile.y, aimX - missile.x) * 180 / Math.PI;
      const maxTurn = missile.maxTurnRate * dt;
      missile.heading = norm360(missile.heading + clamp(angleDiff(desired, missile.heading), -maxTurn, maxTurn));

      // 记录本子步的起点，用于线段最近点判定
      const fromX = missile.x;
      const fromY = missile.y;

      const rad = missile.heading * Math.PI / 180;
      missile.x += Math.cos(rad) * missile.speed * dt;
      missile.y += Math.sin(rad) * missile.speed * dt;
      // 高度向目标靠拢
      missile.z = missile.z + clamp((target.z || 0) - missile.z, -300 * dt, 300 * dt);

      // 干扰弹：红外/雷达导引头被骗概率
      const now = Date.now();
      if (missile.seeker !== 'command' && (target.flareActiveUntil || 0) > now) {
        const jamChance = missile.seeker === 'ir' ? 0.025 : 0.015;
        if (Math.random() < jamChance * dt * 10) {
          results.push({ outcome: 'decoyed', missile, target, reason: 'flare' });
          this.missiles.splice(i, 1);
          continue;
        }
      }

      // ---- 命中判定：线段最近点（避免高速导弹在一个子步内穿透目标） ----
      const segX = missile.x - fromX;
      const segY = missile.y - fromY;
      const segLen2 = segX * segX + segY * segY;
      let t = segLen2 > 0
        ? ((target.x - fromX) * segX + (target.y - fromY) * segY) / segLen2
        : 0;
      t = clamp(t, 0, 1);
      const closestX = fromX + segX * t;
      const closestY = fromY + segY * t;
      const minDist = Math.hypot(target.x - closestX, target.y - closestY);
      const altDiff = Math.abs((target.z || 0) - missile.z);

      if (minDist <= missile.proxyFuze && altDiff < 400) {
        results.push(this.resolveDetonation(missile, target));
        this.missiles.splice(i, 1);
      }
    }

    return results;
  }

  /**
   * 近炸/直击引爆结算：目标的机动过载会降低命中质量
   */
  resolveDetonation(missile, target) {
    // 剧烈机动切半径，导弹易被甩脱
    const evasivePenalty = target.status === 'evading' ? 0.15 : 0;
    const hit = Math.random() < Math.max(0.05, missile.hitProb - evasivePenalty);

    if (!hit) {
      return { outcome: 'miss', missile, target, damage: 0, reason: 'evaded' };
    }

    const damage = missile.damage * (0.75 + Math.random() * 0.5);
    target.hp = Math.max(0, target.hp - damage);
    if (target.hp <= 0) {
      target.status = 'destroyed';
    }

    return { outcome: 'hit', missile, target, damage, hit: true };
  }

  isOutOfBounds(missile) {
    if (!this.terrain) return false;
    const pad = 500;
    return missile.x < -pad || missile.y < -pad ||
           missile.x > this.terrain.width + pad || missile.y > this.terrain.height + pad;
  }

  /**
   * 导出给前端的精简快照
   */
  snapshot() {
    return this.missiles.map(m => ({
      id: m.id,
      side: m.side,
      shooterId: m.shooterId,
      targetId: m.targetId,
      x: Math.round(m.x),
      y: Math.round(m.y),
      z: Math.round(m.z),
      heading: Math.round(m.heading),
      life: Math.round(m.life * 10) / 10
    }));
  }

  clear() {
    this.missiles = [];
    this.nextMissileId = 1;
  }
}

module.exports = MissileSystem;
