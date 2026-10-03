/**
 * CombatSystem - 战斗裁决系统
 * 包含：直接射击、间瞄射击、导弹制导、电子战、航炮（空战）
 */
const { isAirEntity } = require('../../data/equipment/Database');
const { angleDiff } = require('./FlightModel');

class CombatSystem {
  constructor(terrain) {
    this.terrain = terrain;
    this.combatLog = [];
  }

  // 视距攻击（直接射击）
  resolveDirectFire(attacker, target, dt) {
    if (target.hp <= 0 || attacker.hp <= 0) return null;

    const dist = Math.hypot(target.x - attacker.x, target.y - attacker.y);
    if (dist > attacker.range) return null;

    // 检查视线
    const los = this.terrain.hasLineOfSight(
      attacker.x, attacker.y, target.x, target.y,
      attacker.height, target.height
    );
    if (!los) return null;

    // 攻击冷却检查
    if (attacker.fireCooldown > 0) {
      attacker.fireCooldown -= dt;
      return null;
    }

    // 视线因子
    const visFactor = this.terrain.getVisibilityFactor(attacker.x, attacker.y, target.x, target.y);

    // 射程衰减
    const rangeFactor = Math.max(0.3, 1 - (dist / attacker.range) * 0.5);

    // 命中率计算
    let hitProb = attacker.accuracy *
                  rangeFactor *
                  visFactor *
                  (1 - (target.evasion || 0));

    // 地形隐蔽
    const targetTerrain = this.terrain.getTerrainParams(target.x, target.y);
    hitProb *= (1 - targetTerrain.cover * 0.5);

    // 机动类型对命中影响
    if (isAirEntity(target)) {
      hitProb *= 0.7; // 飞行目标难命中
    }

    // 护甲减伤
    const armorPenetration = Math.random();
    const penetrated = armorPenetration > (target.armor || 0);

    // 执行攻击
    attacker.fireCooldown = 1 / (attacker.fireRate || 1);

    const hit = Math.random() < hitProb;
    let damage = 0;

    if (hit && penetrated) {
      damage = attacker.damage * (0.8 + Math.random() * 0.4);
      target.hp -= damage;
      if (target.hp < 0) target.hp = 0;
    }

    const result = {
      time: Date.now(),
      type: 'direct',
      attacker: attacker.id,
      target: target.id,
      distance: dist,
      hit,
      damage,
      penetrated,
      hitProb
    };

    this.combatLog.push(result);
    return result;
  }

  /**
   * 航炮射击解算（空战对决专用）
   * 只有当目标落入射击锥 coneDeg 且位于射程内才形成有效射击；
   * 距离、偏角与目标机动状态共同决定命中概率
   * @param {Object} attacker - 攻击机
   * @param {Object} target - 目标机
   * @param {number} damageScale - 伤害缩放（拉长格斗节奏）
   * @returns {Object|null} { distance, ataDeg, hit, damage, hitProb }
   */
  resolveCannon(attacker, target, damageScale = 1) {
    if (!attacker.airCombat || !target || target.hp <= 0 || attacker.hp <= 0) return null;

    const spec = attacker.airCombat.cannon || { range: 1000, coneDeg: 10, damage: 60, fireRate: 5, accuracy: 0.7 };
    if (attacker.fireCooldown > 0) return null;

    const dist = Math.hypot(target.x - attacker.x, target.y - attacker.y);
    if (dist > spec.range) return null;

    // 机头指向与瞄准线的夹角（ATA）
    const bearing = Math.atan2(target.y - attacker.y, target.x - attacker.x) * 180 / Math.PI;
    const ataDeg = Math.abs(angleDiff(attacker.heading, bearing));
    if (ataDeg > spec.coneDeg) return null;

    // 高度差过大也难以构成有效射击
    const altGap = Math.abs((target.z || 0) - (attacker.z || 0));
    if (altGap > 1200) return null;

    attacker.fireCooldown = 1 / (spec.fireRate || 5);

    const rangeFactor = Math.max(0.2, 1 - (dist / spec.range) * 0.55);
    const angleFactor = Math.max(0.1, 1 - (ataDeg / spec.coneDeg) * 0.7);
    const evasionFactor = 1 - (target.evasion || 0) * 0.5;
    const maneuverFactor = target.status === 'evading' ? 0.55 : 1;
    const hitProb = Math.max(0.02, Math.min(0.95,
      (spec.accuracy || 0.7) * rangeFactor * angleFactor * evasionFactor * maneuverFactor));

    const hit = Math.random() < hitProb;
    let damage = 0;

    if (hit) {
      let dmg = spec.damage * damageScale * (0.8 + Math.random() * 0.4);
      if (Math.random() < 0.12) dmg *= 1.8; // 关键部位命中
      damage = dmg;
      target.hp = Math.max(0, target.hp - damage);
      if (target.hp <= 0) target.status = 'destroyed';
    }

    this.combatLog.push({
      time: Date.now(),
      type: 'cannon',
      attacker: attacker.id,
      target: target.id,
      distance: dist,
      ataDeg,
      hit,
      damage,
      hitProb
    });

    return {
      distance: Math.round(dist),
      ataDeg: Math.round(ataDeg * 10) / 10,
      hit,
      damage,
      hitProb: Math.round(hitProb * 1000) / 1000
    };
  }

  // 间瞄攻击（火炮、导弹）
  resolveIndirectFire(attacker, targetPos, dt) {
    if (attacker.hp <= 0 || !attacker.indirect) return null;

    const dist = Math.hypot(targetPos.x - attacker.x, targetPos.y - attacker.y);
    if (dist > attacker.range) return null;

    if (attacker.fireCooldown > 0) {
      attacker.fireCooldown -= dt;
      return null;
    }

    attacker.fireCooldown = 1 / (attacker.fireRate || 0.1);

    // 计算落点散布（CEP）
    const cep = dist * 0.05; // 5% 射程误差
    const hitX = targetPos.x + (Math.random() - 0.5) * cep * 2;
    const hitY = targetPos.y + (Math.random() - 0.5) * cep * 2;

    // 查找落点附近所有单位
    const affectedRadius = 30; // 杀伤半径

    const result = {
      time: Date.now(),
      type: 'indirect',
      attacker: attacker.id,
      targetPos,
      hitPos: { x: hitX, y: hitY },
      hits: []
    };

    return result;
  }

  // 空空/空地导弹攻击
  resolveMissileAttack(missile, target, dt) {
    if (!missile.isMissile) return null;

    const dist = Math.hypot(target.x - missile.x, target.y - missile.y);

    // 导弹制导
    if (dist < 10) {
      // 命中
      const hitProb = missile.guidanceAccuracy || 0.9;
      const hit = Math.random() < hitProb;

      if (hit) {
        target.hp -= missile.damage;
        if (target.hp < 0) target.hp = 0;
        missile.hp = 0; // 导弹消耗
      }

      return { hit, damage: hit ? missile.damage : 0 };
    }

    // 继续追踪
    const speed = missile.speed * dt;
    const dx = target.x - missile.x;
    const dy = target.y - missile.y;
    const dir = Math.atan2(dy, dx);

    missile.x += Math.cos(dir) * speed;
    missile.y += Math.sin(dir) * speed;

    return { tracking: true };
  }

  // 电子攻击（干扰）
  resolveECM(attacker, target, dt) {
    if (!attacker.ecm || target.hp <= 0) return null;

    const dist = Math.hypot(target.x - attacker.x, target.y - attacker.y);
    if (dist > (attacker.ecmRange || 300)) return null;

    // 应用干扰效果
    target.jammed = true;
    target.jamLevel = (attacker.ecmPower || 0.5);
    target.detection *= (1 - target.jamLevel);
    target.accuracy *= (1 - target.jamLevel * 0.5);

    return { jammed: true, level: target.jamLevel };
  }

  // 清除过期的干扰效果
  updateECM(entities, dt) {
    for (const e of entities) {
      if (e.jammed) {
        e.jamDuration = (e.jamDuration || 0) - dt;
        if (e.jamDuration <= 0) {
          e.jammed = false;
          e.jamLevel = 0;
          // 恢复原始属性
          if (e._originalAccuracy) {
            e.accuracy = e._originalAccuracy;
            e.detection = e._originalDetection;
          }
        }
      }
    }
  }

  getCombatLog(limit = 1000) {
    return this.combatLog.slice(-limit);
  }

  clearCombatLog() {
    this.combatLog = [];
  }
}

module.exports = CombatSystem;
