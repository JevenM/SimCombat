/**
 * MovementSystem - 运动系统
 * 处理单位移动、碰撞检测、编队运动
 */
class MovementSystem {
  constructor(terrain) {
    this.terrain = terrain;
    this.formations = new Map(); // formationId -> Formation
  }

  // 更新所有单位运动
  updateMovement(entities, dt) {
    // 生成编队
    this.updateFormations(entities);

    for (const entity of entities) {
      if (entity.hp <= 0) continue;
      if (!entity.vx && !entity.vy && !entity.moveTarget) continue;

      // 编队领导移动
      if (entity.formationId && !entity.isFormationLeader) {
        this.followFormation(entity, entities, dt);
      } else {
        // 独立移动或领导移动
        this.moveEntity(entity, dt);
      }

      // 检查高度变化（空中单位）
      if (entity.type === 'air') {
        this.updateAltitude(entity, dt);
      }

      // 燃油消耗
      if (entity.fuel !== undefined) {
        entity.fuel -= (entity.fuelConsumption || 0) * dt;
        if (entity.fuel <= 0) {
          entity.fuel = 0;
          entity.vx = 0;
          entity.vy = 0;
          if (entity.type === 'air') {
            entity.hp = 0; // 坠毁
          }
        }
      }

      // 碰撞检测与回避
      this.avoidCollisions(entity, entities);
    }
  }

  moveEntity(entity, dt) {
    if (!entity.moveTarget && !entity.vx && !entity.vy) return;

    // 如果有移动目标，计算速度向量
    if (entity.moveTarget) {
      const dx = entity.moveTarget.x - entity.x;
      const dy = entity.moveTarget.y - entity.y;
      const dist = Math.hypot(dx, dy);

      if (dist < 5) {
        entity.moveTarget = null;
        entity.vx = 0;
        entity.vy = 0;
        return;
      }

      // 路径跟随（如果有预计算路径）
      if (entity.path && entity.path.length > 0) {
        const nextWaypoint = entity.path[0];
        const wpdist = Math.hypot(nextWaypoint.x - entity.x, nextWaypoint.y - entity.y);
        if (wpdist < 10) {
          entity.path.shift();
        }
      }

      // 计算最大速度 (km/h 转换为 m/s，假设 dt=1s)
      const terrainMod = this.terrain.getMovementSpeedModifier(
        entity.x, entity.y, entity.mobilityType
      );
      // 注意: entity.speed 是 km/h，需要转换为 m/s，然后乘以 dt(秒)
      const maxSpeed = ((entity.speed || 10) * 1000 / 3600) * terrainMod; // 转换为 m/s

      // 设置速度向量 (m/s)
      entity.vx = (dx / dist) * maxSpeed;
      entity.vy = (dy / dist) * maxSpeed;

      // 立即更新航向
      entity.heading = (Math.atan2(entity.vy, entity.vx) * 180 / Math.PI + 360) % 360;
    }

    // 应用速度
    const actualVx = entity.vx * dt;
    const actualVy = entity.vy * dt;

    // 更新航向（角度，0-360度）
    if (entity.vx !== 0 || entity.vy !== 0) {
      entity.heading = (Math.atan2(entity.vy, entity.vx) * 180 / Math.PI + 360) % 360;
    }

    // 检查新位置是否可通行
    const newX = entity.x + actualVx;
    const newY = entity.y + actualVy;

    const params = this.terrain.getTerrainParams(newX, newY);
    if (params.pass > 0) {
      entity.x = newX;
      entity.y = newY;
    } else {
      // 不可通行，尝试滑动
      const horizPass = this.terrain.getTerrainParams(newX, entity.y).pass;
      const vertPass = this.terrain.getTerrainParams(entity.x, newY).pass;

      if (horizPass > 0) entity.x = newX;
      if (vertPass > 0) entity.y = newY;

      // 如果都不可通行，停止
      if (horizPass <= 0 && vertPass <= 0) {
        entity.vx = 0;
        entity.vy = 0;
      }
    }

    // 边界限制
    entity.x = Math.max(0, Math.min(this.terrain.width, entity.x));
    entity.y = Math.max(0, Math.min(this.terrain.height, entity.y));

    // 同步高度
    if (entity.type !== 'air' && entity.type !== 'naval') {
      entity.z = this.terrain.getElevation(entity.x, entity.y) + (entity.height || 0);
    }
  }

  // 编队跟随
  followFormation(entity, allEntities, dt) {
    const leader = allEntities.find(e => e.id === entity.formationLeader);
    if (!leader) {
      entity.formationId = null;
      return;
    }

    // 计算编队中的相对目标位置
    const offset = this.getFormationOffset(entity);

    // 考虑领导朝向的偏移
    const leaderDir = Math.atan2(leader.vy || 0.01, leader.vx || 1);
    const cos = Math.cos(leaderDir);
    const sin = Math.sin(leaderDir);

    const rotatedOffset = {
      x: offset.x * cos - offset.y * sin,
      y: offset.x * sin + offset.y * cos
    };

    entity.moveTarget = {
      x: leader.x + rotatedOffset.x,
      y: leader.y + rotatedOffset.y
    };

    this.moveEntity(entity, dt);
  }

  // 获取编队偏移（根据编型）
  getFormationOffset(entity) {
    const formation = this.formations.get(entity.formationId);
    if (!formation) return { x: 0, y: 0 };

    const index = formation.members.indexOf(entity.id);

    switch (formation.type) {
      case 'line':
        return { x: 0, y: (index - formation.members.length/2) * 30 };
      case 'column':
        return { x: -(index + 1) * 40, y: 0 };
      case 'wedge':
        const side = index % 2 === 0 ? 1 : -1;
        return { x: -(Math.floor(index/2) + 1) * 35, y: side * (Math.floor(index/2) + 1) * 20 };
      case 'circle':
        const angle = (index / formation.members.length) * Math.PI * 2;
        return { x: Math.cos(angle) * 50, y: Math.sin(angle) * 50 };
      default:
        return { x: -(index + 1) * 30, y: (index % 2 === 0 ? 1 : -1) * 30 };
    }
  }

  // 更新编队
  updateFormations(entities) {
    // 按编队ID分组
    const groups = new Map();

    for (const e of entities) {
      if (e.formationId) {
        if (!groups.has(e.formationId)) {
          groups.set(e.formationId, []);
        }
        groups.get(e.formationId).push(e);
      }
    }

    // 更新编队信息
    for (const [id, members] of groups) {
      if (members.length < 2) {
        // 解散过小编队
        for (const m of members) {
          m.formationId = null;
          m.formationLeader = null;
        }
        this.formations.delete(id);
        continue;
      }

      // 更新或创建编队
      const formation = this.formations.get(id) || {
        id,
        type: 'column',
        members: []
      };

      formation.members = members.map(m => m.id);

      // 选择领导（通常是第一个加入的或最前面的）
      const leader = members[0];
      leader.isFormationLeader = true;
      leader.formationLeader = leader.id;

      for (const m of members.slice(1)) {
        m.isFormationLeader = false;
        m.formationLeader = leader.id;
      }

      this.formations.set(id, formation);
    }
  }

  // 创建编队
  createFormation(entityIds, type = 'column') {
    const id = 'formation_' + Date.now();
    this.formations.set(id, {
      id,
      type,
      members: entityIds
    });
    return id;
  }

  // 改变编队阵型
  changeFormation(formationId, newType) {
    const formation = this.formations.get(formationId);
    if (formation) {
      formation.type = newType;
    }
  }

  // 更新高度（空中单位）
  updateAltitude(entity, dt) {
    if (entity.targetAltitude !== undefined) {
      const diff = entity.targetAltitude - entity.z;
      const climbRate = 50 * dt; // m/s

      if (Math.abs(diff) < climbRate) {
        entity.z = entity.targetAltitude;
      } else {
        entity.z += Math.sign(diff) * climbRate;
      }

      // 高度限制
      entity.z = Math.max(0, Math.min(entity.maxAltitude || 10000, entity.z));
    }
  }

  // 碰撞回避
  avoidCollisions(entity, allEntities) {
    const avoidanceRadius = 30;
    let avoidX = 0;
    let avoidY = 0;

    for (const other of allEntities) {
      if (other.id === entity.id || other.hp <= 0) continue;

      const dx = entity.x - other.x;
      const dy = entity.y - other.y;
      const dist = Math.hypot(dx, dy);

      if (dist < avoidanceRadius && dist > 0) {
        // 排斥力
        const force = (avoidanceRadius - dist) / avoidanceRadius;
        avoidX += (dx / dist) * force;
        avoidY += (dy / dist) * force;
      }
    }

    // 应用回避力
    if (avoidX !== 0 || avoidY !== 0) {
      entity.x += avoidX * 5;
      entity.y += avoidY * 5;
    }
  }

  // 设置移动目标
  setMoveTarget(entity, x, y) {
    entity.moveTarget = { x, y };
  }

  // 设置路径
  setPath(entity, path) {
    entity.path = path;
    if (path && path.length > 0) {
      entity.moveTarget = path[0];
    }
  }
}

module.exports = MovementSystem;
