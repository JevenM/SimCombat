/**
 * BehaviorTree - 行为树系统
 * 参考：OpenRA / Spring Engine 的AI实现
 * 核心概念：选择器(Selector)、序列(Sequence)、并行(Parallel)、装饰器(Decorator)
 */
class BehaviorTree {
  constructor(blackboard = {}) {
    this.blackboard = blackboard; // 共享数据黑板
    this.root = null;
  }

  setRoot(node) {
    this.root = node;
    return this;
  }

  tick(entity, dt) {
    if (!this.root) return NodeStatus.FAILURE;
    return this.root.tick(entity, this.blackboard, dt);
  }
}

// 节点状态
const NodeStatus = {
  SUCCESS: 'success',
  FAILURE: 'failure',
  RUNNING: 'running'
};

// 基础节点类
class BTNode {
  constructor(name) {
    this.name = name;
    this.status = NodeStatus.FAILURE;
  }

  tick(entity, blackboard, dt) {
    throw new Error('Must implement tick method');
  }

  reset() {
    this.status = NodeStatus.FAILURE;
  }
}

// 组合节点基类
class CompositeNode extends BTNode {
  constructor(name, children = []) {
    super(name);
    this.children = children;
    this.currentIndex = 0;
  }

  addChild(child) {
    this.children.push(child);
    return this;
  }

  reset() {
    super.reset();
    this.currentIndex = 0;
    this.children.forEach(c => c.reset());
  }
}

// 选择器（OR逻辑）：子节点成功则返回，全失败才失败
class Selector extends CompositeNode {
  tick(entity, blackboard, dt) {
    while (this.currentIndex < this.children.length) {
      const status = this.children[this.currentIndex].tick(entity, blackboard, dt);

      if (status === NodeStatus.SUCCESS) {
        this.currentIndex = 0;
        return NodeStatus.SUCCESS;
      } else if (status === NodeStatus.RUNNING) {
        return NodeStatus.RUNNING;
      }

      this.currentIndex++;
    }

    this.currentIndex = 0;
    return NodeStatus.FAILURE;
  }
}

// 序列（AND逻辑）：子节点顺序执行，一个失败则全失败
class Sequence extends CompositeNode {
  tick(entity, blackboard, dt) {
    while (this.currentIndex < this.children.length) {
      const status = this.children[this.currentIndex].tick(entity, blackboard, dt);

      if (status === NodeStatus.FAILURE) {
        this.currentIndex = 0;
        return NodeStatus.FAILURE;
      } else if (status === NodeStatus.RUNNING) {
        return NodeStatus.RUNNING;
      }

      this.currentIndex++;
    }

    this.currentIndex = 0;
    return NodeStatus.SUCCESS;
  }
}

// 并行节点：所有子节点同时执行
class Parallel extends CompositeNode {
  constructor(name, children = [], successPolicy = 'all') {
    super(name, children);
    this.successPolicy = successPolicy; // 'all' | 'one'
  }

  tick(entity, blackboard, dt) {
    let successCount = 0;
    let runningCount = 0;

    for (const child of this.children) {
      const status = child.tick(entity, blackboard, dt);
      if (status === NodeStatus.SUCCESS) successCount++;
      else if (status === NodeStatus.RUNNING) runningCount++;
    }

    if (this.successPolicy === 'all') {
      if (successCount === this.children.length) {
        return NodeStatus.SUCCESS;
      }
    } else {
      if (successCount > 0) return NodeStatus.SUCCESS;
    }

    return runningCount > 0 ? NodeStatus.RUNNING : NodeStatus.FAILURE;
  }
}

// 装饰器基类
class Decorator extends BTNode {
  constructor(name, child = null) {
    super(name);
    this.child = child;
  }

  setChild(child) {
    this.child = child;
    return this;
  }

  reset() {
    super.reset();
    this.child?.reset();
  }
}

// 取反装饰器
class Inverter extends Decorator {
  tick(entity, blackboard, dt) {
    if (!this.child) return NodeStatus.FAILURE;
    const status = this.child.tick(entity, blackboard, dt);
    if (status === NodeStatus.SUCCESS) return NodeStatus.FAILURE;
    if (status === NodeStatus.FAILURE) return NodeStatus.SUCCESS;
    return NodeStatus.RUNNING;
  }
}

// 重复装饰器
class Repeater extends Decorator {
  constructor(name, child, count = -1) {
    super(name, child);
    this.count = count; // -1 = 无限
    this.currentCount = 0;
  }

  tick(entity, blackboard, dt) {
    if (!this.child) return NodeStatus.FAILURE;
    if (this.count > 0 && this.currentCount >= this.count) {
      this.currentCount = 0;
      return NodeStatus.SUCCESS;
    }

    const status = this.child.tick(entity, blackboard, dt);
    if (status !== NodeStatus.RUNNING) {
      this.currentCount++;
    }
    return NodeStatus.RUNNING;
  }

  reset() {
    super.reset();
    this.currentCount = 0;
  }
}

// 条件装饰器
class Condition extends Decorator {
  constructor(name, conditionFn, child = null) {
    super(name, child);
    this.conditionFn = conditionFn;
  }

  tick(entity, blackboard, dt) {
    if (!this.conditionFn(entity, blackboard)) {
      return NodeStatus.FAILURE;
    }
    if (!this.child) return NodeStatus.SUCCESS;
    return this.child.tick(entity, blackboard, dt);
  }
}

// ============ 军事相关行为节点 ============

// 移动行为
class MoveTo extends BTNode {
  constructor(targetProvider, tolerance = 10) {
    super('MoveTo');
    this.targetProvider = targetProvider; // 函数，返回{x,y}或 null
    this.tolerance = tolerance;
  }

  tick(entity, blackboard, dt) {
    const target = this.targetProvider(entity, blackboard);
    if (!target) return NodeStatus.FAILURE;

    const dx = target.x - entity.x;
    const dy = target.y - entity.y;
    const dist = Math.hypot(dx, dy);

    if (dist < this.tolerance) {
      entity.vx = 0;
      entity.vy = 0;
      return NodeStatus.SUCCESS;
    }

    // 考虑地形的移动速度
    const terrainMod = blackboard.terrain?.getMovementSpeedModifier(
      entity.x, entity.y, entity.mobilityType
    ) || 1.0;
    const speed = (entity.speed || 10) * terrainMod * dt;

    entity.vx = (dx / dist) * speed / dt;
    entity.vy = (dy / dist) * speed / dt;
    entity.x += entity.vx * dt;
    entity.y += entity.vy * dt;

    return NodeStatus.RUNNING;
  }
}

// 巡逻行为
class Patrol extends BTNode {
  constructor(waypointsProvider) {
    super('Patrol');
    this.waypointsProvider = waypointsProvider;
    this.currentWaypoint = 0;
    this.reversed = false;
  }

  tick(entity, blackboard, dt) {
    const waypoints = this.waypointsProvider(entity, blackboard);
    if (!waypoints || waypoints.length < 2) return NodeStatus.FAILURE;

    const target = waypoints[this.currentWaypoint];
    const dx = target.x - entity.x;
    const dy = target.y - entity.y;
    const dist = Math.hypot(dx, dy);

    if (dist < 10) {
      // 到达航点
      if (this.reversed) {
        this.currentWaypoint--;
        if (this.currentWaypoint < 0) {
          this.currentWaypoint = 1;
          this.reversed = false;
        }
      } else {
        this.currentWaypoint++;
        if (this.currentWaypoint >= waypoints.length) {
          this.currentWaypoint = waypoints.length - 2;
          this.reversed = true;
        }
      }
    }

    const speed = (entity.speed || 10) * dt;
    entity.x += (dx / dist) * speed;
    entity.y += (dy / dist) * speed;

    return NodeStatus.RUNNING;
  }
}

// 攻击行为
class AttackTarget extends BTNode {
  constructor(targetProvider) {
    super('AttackTarget');
    this.targetProvider = targetProvider;
    this.cooldown = 0;
  }

  tick(entity, blackboard, dt) {
    const target = this.targetProvider(entity, blackboard);
    if (!target || target.hp <= 0) return NodeStatus.FAILURE;

    const dist = Math.hypot(target.x - entity.x, target.y - entity.y);

    // 检查射程
    if (dist > (entity.range || 100)) {
      return NodeStatus.FAILURE; // 目标超出射程
    }

    // 检查视线
    if (blackboard.terrain && !blackboard.terrain.hasLineOfSight(
      entity.x, entity.y, target.x, target.y, entity.height || 2, target.height || 2
    )) {
      return NodeStatus.FAILURE; // 无视线
    }

    // 攻击冷却
    this.cooldown -= dt;
    if (this.cooldown > 0) return NodeStatus.RUNNING;

    // 执行攻击
    const hitProb = (entity.accuracy || 0.7) * (1 - (target.evasion || 0));
    if (Math.random() < hitProb) {
      const damage = (entity.damage || 10) * (0.8 + Math.random() * 0.4);
      target.hp -= damage;

      // 记录攻击事件
      blackboard.combatEvents = blackboard.combatEvents || [];
      blackboard.combatEvents.push({
        time: blackboard.time,
        attacker: entity.id,
        target: target.id,
        damage: damage,
        hit: true
      });
    }

    this.cooldown = 1 / (entity.fireRate || 1);
    return NodeStatus.RUNNING;
  }
}

// 寻找最近敌人
class FindNearestEnemy extends BTNode {
  tick(entity, blackboard, dt) {
    const enemies = blackboard.entities?.filter(e =>
      e.side !== entity.side && e.hp > 0
    );
    if (!enemies || enemies.length === 0) return NodeStatus.FAILURE;

    let nearest = null;
    let minDist = Infinity;

    for (const e of enemies) {
      const dist = Math.hypot(e.x - entity.x, e.y - entity.y);
      if (dist < minDist) {
        minDist = dist;
        nearest = e;
      }
    }

    if (nearest) {
      blackboard.target = nearest;
      return NodeStatus.SUCCESS;
    }
    return NodeStatus.FAILURE;
  }
}

// 撤退行为
class Retreat extends BTNode {
  tick(entity, blackboard, dt) {
    const enemies = blackboard.entities?.filter(e =>
      e.side !== entity.side && e.hp > 0
    );
    if (!enemies || enemies.length === 0) return NodeStatus.SUCCESS;

    // 计算敌人重心反方向
    let avgX = 0, avgY = 0;
    for (const e of enemies) {
      avgX += e.x;
      avgY += e.y;
    }
    avgX /= enemies.length;
    avgY /= enemies.length;

    const dx = entity.x - avgX;
    const dy = entity.y - avgY;
    const dist = Math.hypot(dx, dy) || 1;

    const retreatDist = (entity.retreatDistance || 200);
    const speed = (entity.speed || 10) * dt * 1.5; // 撤退加速

    entity.x += (dx / dist) * Math.min(speed, retreatDist);
    entity.y += (dy / dist) * Math.min(speed, retreatDist);

    return NodeStatus.RUNNING;
  }
}

// 等待行为
class Wait extends BTNode {
  constructor(duration) {
    super('Wait');
    this.duration = duration;
    this.elapsed = 0;
  }

  tick(entity, blackboard, dt) {
    this.elapsed += dt;
    if (this.elapsed >= this.duration) {
      this.elapsed = 0;
      return NodeStatus.SUCCESS;
    }
    return NodeStatus.RUNNING;
  }

  reset() {
    super.reset();
    this.elapsed = 0;
  }
}

// 检查血量条件
class CheckHealth extends BTNode {
  constructor(threshold = 0.3) {
    super('CheckHealth');
    this.threshold = threshold;
  }

  tick(entity, blackboard, dt) {
    const healthPercent = entity.hp / (entity.maxHp || entity.hp);
    return healthPercent <= this.threshold ? NodeStatus.SUCCESS : NodeStatus.FAILURE;
  }
}

module.exports = {
  BehaviorTree,
  NodeStatus,
  BTNode,
  CompositeNode,
  Selector,
  Sequence,
  Parallel,
  Decorator,
  Inverter,
  Repeater,
  Condition,
  MoveTo,
  Patrol,
  AttackTarget,
  FindNearestEnemy,
  Retreat,
  Wait,
  CheckHealth
};
