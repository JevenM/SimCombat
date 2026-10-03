/**
 * FlightModel - 战机飞行运动模型
 * 与地面单位的「走到目标点」模型不同，战机采用受限转弯率 + 能量交换的运动学：
 * - 航向按当前速度/过载决定的最大转弯率逐步逼近，不能瞬时转向
 * - 剧烈盘旋、爬升会掉速，俯冲会加速（能量机动）
 * - 速度始终保持在失速下限与极速上限之间
 * - 靠近演习区边界时自动回转，避免飞出场景
 */
const { DEFAULT_AIR_COMBAT } = require('../../data/equipment/Database');

// ====== 通用数学工具 ======
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function norm360(angle) {
  return ((angle % 360) + 360) % 360;
}

// 计算从 current 转到 target 的最短角度差（-180 ~ 180）
function angleDiff(target, current) {
  let d = norm360(target) - norm360(current);
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

class FlightModel {
  constructor(terrain) {
    this.terrain = terrain;
    // 距离边界多远开始自动回转
    this.boundaryMargin = 600;
    // 最低飞行高度（避免钻地）
    this.groundClearance = 300;
  }

  /**
   * 初始化实体的空战相关字段
   * @param {Object} entity - 空中单位
   */
  initEntity(entity) {
    const ac = entity.airCombat || DEFAULT_AIR_COMBAT;

    entity.airCombat = ac;
    entity.category = 'air';

    // 初始速度（m/s）：默认巡航到极速的 75%
    if (entity.speedMs === undefined) {
      entity.speedMs = clamp((entity.speed || 900) * 1000 / 3600 * 0.75,
        ac.minSpeedMs || 100, ac.maxSpeedMs || 500);
    }

    // 高度
    const ground = this.terrain ? this.terrain.getElevation(entity.x, entity.y) : 0;
    if (!entity.z || entity.z <= 0) {
      entity.z = Math.max((entity.height || 5000) + ground, this.groundClearance);
    }
    entity.targetAltitude = entity.targetAltitude ?? entity.z;

    // 弹药与干扰弹
    entity.missileCount = entity.missileCount ?? ac.missile.count;
    entity.flareCount = entity.flareCount ?? ac.flares;
    entity.missileReload = 0;
    entity.flareCooldown = 0;
    entity.flareActiveUntil = 0;

    // 姿态
    entity.pitch = entity.pitch || 0;
    entity.roll = entity.roll || 0;

    // 速度向量（供现有状态输出与 UI 复用）
    const rad = (entity.heading || 0) * Math.PI / 180;
    entity.vx = Math.cos(rad) * entity.speedMs;
    entity.vy = Math.sin(rad) * entity.speedMs;
  }

  getParams(entity) {
    return entity.airCombat || DEFAULT_AIR_COMBAT;
  }

  /**
   * 当前速度下的最大可用转弯率（度/秒）
   * 同时受机体结构与过载上限约束；接近失速或极速时气动效能下降
   */
  maxTurnRateDeg(entity, speedMs) {
    const ac = this.getParams(entity);
    const g = 9.81;
    const maxG = ac.maxG || 6;
    const v = Math.max(60, speedMs || 200);

    // 协调转弯：ω = g * sqrt(n^2 - 1) / V
    const loadFactor = Math.sqrt(Math.max(0, maxG * maxG - 1));
    const rateByG = (g * loadFactor / v) * 180 / Math.PI;
    const rateBySpec = ac.turnRateDegPerSec || 15;
    let rate = Math.min(rateByG, rateBySpec);

    const minV = ac.minSpeedMs || 120;
    const maxV = ac.maxSpeedMs || 600;
    // 失速边缘：操纵面效能不足
    const stallFactor = clamp((v - minV) / Math.max(1, minV * 0.5), 0.3, 1);
    // 高速压缩：方向舵受限
    const highFactor = clamp((maxV - v) / Math.max(1, maxV * 0.35), 0.45, 1);

    return Math.max(2, rate * Math.min(stallFactor, highFactor));
  }

  /**
   * 边界回避：贴近演习区边缘时把期望航向拉回场内
   */
  applyBoundary(entity, desiredHeading) {
    if (!this.terrain) return desiredHeading;

    const margin = this.boundaryMargin;
    const w = this.terrain.width;
    const h = this.terrain.height;
    const ratios = {
      west: entity.x / margin,
      east: (w - entity.x) / margin,
      south: entity.y / margin,
      north: (h - entity.y) / margin
    };

    // 找出最先触发的方向（比值越小越靠近）
    let key = null;
    let minRatio = Infinity;
    for (const [k, r] of Object.entries(ratios)) {
      if (r < minRatio) { minRatio = r; key = k; }
    }
    if (!key || minRatio >= 1) return desiredHeading;

    // 回到场内的目标航向
    const inbound = { west: 0, east: 180, south: 90, north: 270 };
    const target = inbound[key];
    // 越靠近边界拉力越强，出场后立即全力回转
    const blend = minRatio <= 0 ? 1 : clamp(1 - minRatio, 0, 1) * 0.85;

    return norm360(desiredHeading + angleDiff(target, desiredHeading) * blend);
  }

  /**
   * 单步飞行积分
   * @param {Object} entity - 战机
   * @param {Object} cmd - 机动指令 { desiredHeading, desiredAltitude, throttle, evasive }
   * @param {number} dt - 子步长（秒）
   */
  update(entity, cmd, dt) {
    if (entity.hp <= 0) return;

    const ac = this.getParams(entity);
    const minV = ac.minSpeedMs || 120;
    const maxV = ac.maxSpeedMs || 600;

    let v = entity.speedMs ?? maxV * 0.7;

    // ---- 1. 航向：按最大转弯率逼近期望航向 ----
    const desiredHeading = this.applyBoundary(entity, cmd.desiredHeading ?? entity.heading);
    const rate = this.maxTurnRateDeg(entity, v);
    const diff = angleDiff(desiredHeading, entity.heading);
    const maxTurn = rate * dt;
    const turn = clamp(diff, -maxTurn, maxTurn);
    entity.heading = norm360(entity.heading + turn);

    // 盘旋强度（0~1），剧烈盘旋会大量掉速
    const turnLoad = Math.abs(turn) / Math.max(0.0001, maxTurn);

    // ---- 2. 高度：按爬升率逼近期望高度 ----
    const climbRate = ac.climbRate || 150;
    const desiredAlt = clamp(cmd.desiredAltitude ?? entity.targetAltitude ?? entity.z,
      Math.max(this.groundClearance, 200), entity.maxAltitude || 20000);
    const altDiff = desiredAlt - entity.z;
    const dz = clamp(altDiff, -climbRate * dt, climbRate * dt);
    entity.z = clamp(entity.z + dz, Math.max(this.groundClearance, 200), entity.maxAltitude || 20000);
    entity.targetAltitude = desiredAlt;

    // ---- 3. 速度：油门加速 - 盘旋阻力 - 爬升能量消耗 ----
    const throttle = clamp(cmd.throttle ?? 1, 0, 1);
    const baseAccel = (ac.accelMs2 || 22) * throttle;
    const turnDrag = turnLoad * (ac.turnDragMs2 || 30);
    // 爬升消耗能量、俯冲换取速度
    const climbLoad = dt > 0 ? (dz / dt) / climbRate : 0;
    const climbDrag = climbLoad * 18;

    v = clamp(v + (baseAccel - turnDrag - climbDrag) * dt, minV, maxV);
    entity.speedMs = v;

    // ---- 4. 位移 ----
    const rad = entity.heading * Math.PI / 180;
    entity.vx = Math.cos(rad) * v;
    entity.vy = Math.sin(rad) * v;
    entity.x = clamp(entity.x + entity.vx * dt, 0, this.terrain.width);
    entity.y = clamp(entity.y + entity.vy * dt, 0, this.terrain.height);

    // ---- 5. 姿态（供 3D 视图渲染俯仰/滚转） ----
    const bankScale = cmd.evasive ? 1.15 : 1;
    const targetRoll = clamp(Math.sign(diff) * turnLoad * 70 * bankScale, -80, 80);
    const targetPitch = clamp(climbLoad * 25, -35, 35);
    // 姿态平滑过渡
    entity.roll = entity.roll + (targetRoll - entity.roll) * clamp(dt * 4, 0, 1);
    entity.pitch = entity.pitch + (targetPitch - entity.pitch) * clamp(dt * 3, 0, 1);
  }
}

module.exports = FlightModel;
module.exports.clamp = clamp;
module.exports.norm360 = norm360;
module.exports.angleDiff = angleDiff;
