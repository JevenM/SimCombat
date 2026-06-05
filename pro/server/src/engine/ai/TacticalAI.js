/**
 * HTNPlanner - 分层任务网络规划器
 * 参考：游戏AI Pro中的HTN实现
 * 用于战术级决策：路径规划、目标分配、协同攻击
 */
class HTNPlanner {
  constructor() {
    this.methods = new Map(); // 任务 -> 方法列表
    this.primitiveTasks = new Map(); // 原语任务
  }

  // 注册方法（分解复杂任务的方法）
  registerMethod(taskName, method) {
    if (!this.methods.has(taskName)) {
      this.methods.set(taskName, []);
    }
    this.methods.get(taskName).push(method);
  }

  // 注册原语任务（可直接执行）
  registerPrimitive(taskName, executor) {
    this.primitiveTasks.set(taskName, executor);
  }

  // 规划：给定世界状态和目标，返回任务序列
  plan(worldState, goalTask, maxDepth = 10) {
    const plan = [];
    const taskStack = [goalTask];
    const visited = new Set();
    let depth = 0;

    while (taskStack.length > 0 && depth < maxDepth) {
      const currentTask = taskStack.pop();
      const taskKey = JSON.stringify(currentTask);

      if (visited.has(taskKey)) continue;
      visited.add(taskKey);

      // 如果是原语任务，加入计划
      if (this.primitiveTasks.has(currentTask.name)) {
        plan.push(currentTask);
        continue;
      }

      // 尝试分解复杂任务
      const methods = this.methods.get(currentTask.name);
      if (!methods || methods.length === 0) {
        return null; // 无法分解
      }

      // 尝试每个方法，选择第一个可行的
      let decomposed = false;
      for (const method of methods) {
        const precondition = method.precondition || (() => true);
        if (precondition(worldState, currentTask.params)) {
          const subtasks = method.decompose(worldState, currentTask.params);
          if (subtasks) {
            // 将子任务加入栈（倒序，使得第一个子任务先处理）
            for (let i = subtasks.length - 1; i >= 0; i--) {
              taskStack.push(subtasks[i]);
            }
            decomposed = true;
            break;
          }
        }
      }

      if (!decomposed) {
        return null; // 无法分解此任务
      }
      depth++;
    }

    return plan;
  }

  // 执行计划
  executePlan(plan, entity, blackboard) {
    if (!plan || plan.length === 0) return false;

    for (const task of plan) {
      const executor = this.primitiveTasks.get(task.name);
      if (executor) {
        const result = executor(entity, task.params, blackboard);
        if (result === false) return false;
      }
    }
    return true;
  }
}

/**
 * TacticalAI - 战术级AI控制器
 * 集成行为树（实时反应）和HTN（规划）
 */
class TacticalAI {
  constructor(terrain) {
    this.terrain = terrain;
    this.planner = new HTNPlanner();
    this.setupTacticalMethods();
  }

  setupTacticalMethods() {
    // ====== HTN方法定义 ======

    // 攻击目标方法1：直接攻击
    this.planner.registerMethod('Attack', {
      name: 'DirectAttack',
      precondition: (ws, params) => {
        const dist = Math.hypot(params.target.x - params.x, params.target.y - params.y);
        return dist <= (params.range || 100);
      },
      decompose: (ws, params) => [
        { name: 'Aim', params },
        { name: 'Fire', params }
      ]
    });

    // 攻击目标方法2：接近后攻击
    this.planner.registerMethod('Attack', {
      name: 'ApproachAndAttack',
      precondition: () => true,
      decompose: (ws, params) => [
        { name: 'MoveToPosition', params: { x: params.target.x, y: params.target.y, range: params.range * 0.8 } },
        { name: 'Attack', params }
      ]
    });

    // 夺取目标方法
    this.planner.registerMethod('CaptureObjective', {
      name: 'StandardCapture',
      precondition: () => true,
      decompose: (ws, params) => [
        { name: 'MoveToPosition', params: { x: params.objective.x, y: params.objective.y, range: 20 } },
        { name: 'SecureArea', params }
      ]
    });

    // 协同攻击
    this.planner.registerMethod('CoordinatedAttack', {
      name: 'TeamAttack',
      precondition: (ws, params) => params.teammates && params.teammates.length > 0,
      decompose: (ws, params) => {
        const tasks = [];
        // 分配包围位置
        const positions = this.calculateEncirclement(params);
        for (let i = 0; i < params.teammates.length; i++) {
          tasks.push({
            name: 'MoveToPosition',
            params: { unit: params.teammates[i], pos: positions[i] }
          });
        }
        tasks.push({ name: 'SynchronizedFire', params });
        return tasks;
      }
    });

    // ====== 原语任务 ======

    this.planner.registerPrimitive('MoveToPosition', (entity, params, bb) => {
      const target = params.unit || entity;
      const dest = params.pos || params;

      const dx = dest.x - target.x;
      const dy = dest.y - target.y;
      const dist = Math.hypot(dx, dy);

      if (dist < (params.range || 10)) return true;

      const terrainMod = this.terrain?.getMovementSpeedModifier(target.x, target.y, target.mobilityType) || 1;
      const speed = (target.speed || 10) * terrainMod * 0.1;

      target.x += (dx / dist) * speed;
      target.y += (dy / dist) * speed;

      return 'running'; // 还需继续执行
    });

    this.planner.registerPrimitive('Aim', (entity, params) => {
      entity.aimingAt = params.target.id;
      return true;
    });

    this.planner.registerPrimitive('Fire', (entity, params, bb) => {
      const target = params.target;
      if (!target || target.hp <= 0) return false;

      const dist = Math.hypot(target.x - entity.x, target.y - entity.y);
      if (dist > entity.range) return false;

      const hitProb = (entity.accuracy || 0.7) * (1 - (target.evasion || 0));
      if (Math.random() < hitProb) {
        target.hp -= (entity.damage || 10) * (0.8 + Math.random() * 0.4);
      }

      return true;
    });

    this.planner.registerPrimitive('SecureArea', (entity, params, bb) => {
      entity.status = 'securing';
      // 检查区域内敌人
      const enemiesInRange = bb.entities?.filter(e =>
        e.side !== entity.side &&
        e.hp > 0 &&
        Math.hypot(e.x - entity.x, e.y - entity.y) < 50
      );
      return !enemiesInRange || enemiesInRange.length === 0;
    });
  }

  calculateEncirclement(params) {
    const { target, teammates } = params;
    const positions = [];
    const radius = 150;
    const angleStep = (2 * Math.PI) / (teammates.length + 1);

    for (let i = 0; i < teammates.length; i++) {
      const angle = i * angleStep;
      positions.push({
        x: target.x + Math.cos(angle) * radius,
        y: target.y + Math.sin(angle) * radius
      });
    }
    return positions;
  }

  // 为实体生成任务计划
  generatePlan(entity, goal, worldState) {
    return this.planner.plan(worldState, goal);
  }

  // A*路径规划（考虑地形权重）
  findPath(startX, startY, endX, endY, mobilityType = 'wheeled') {
    const startIdx = this.terrain.worldToGrid(startX, startY);
    const endIdx = this.terrain.worldToGrid(endX, endY);

    if (startIdx < 0 || endIdx < 0) return null;

    const openSet = new Map();
    const closedSet = new Set();
    const cameFrom = new Map();
    const gScore = new Map();
    const fScore = new Map();

    openSet.set(startIdx, true);
    gScore.set(startIdx, 0);
    fScore.set(startIdx, this.heuristic(startIdx, endIdx));

    while (openSet.size > 0) {
      // 找到fScore最低的节点
      let current = null;
      let minF = Infinity;
      for (const [idx] of openSet) {
        const f = fScore.get(idx) || Infinity;
        if (f < minF) {
          minF = f;
          current = idx;
        }
      }

      if (current === endIdx) {
        return this.reconstructPath(cameFrom, current);
      }

      openSet.delete(current);
      closedSet.add(current);

      // 遍历邻居
      for (const neighbor of this.getNeighbors(current)) {
        if (closedSet.has(neighbor)) continue;

        const pass = this.terrain.passability[neighbor];
        if (pass <= 0) continue; // 不可通行

        const terrainCost = 1 / (pass * this.terrain.getMovementSpeedModifier(
          ...this.idxToXY(neighbor), mobilityType
        ) || 1);

        const tentativeG = (gScore.get(current) || Infinity) + terrainCost;

        if (!openSet.has(neighbor)) {
          openSet.set(neighbor, true);
        } else if (tentativeG >= (gScore.get(neighbor) || Infinity)) {
          continue;
        }

        cameFrom.set(neighbor, current);
        gScore.set(neighbor, tentativeG);
        fScore.set(neighbor, tentativeG + this.heuristic(neighbor, endIdx));
      }
    }

    return null; // 无路可走
  }

  heuristic(idx1, idx2) {
    const x1 = idx1 % this.terrain.cols;
    const y1 = Math.floor(idx1 / this.terrain.cols);
    const x2 = idx2 % this.terrain.cols;
    const y2 = Math.floor(idx2 / this.terrain.cols);
    return Math.abs(x1 - x2) + Math.abs(y1 - y2);
  }

  getNeighbors(idx) {
    const neighbors = [];
    const x = idx % this.terrain.cols;
    const y = Math.floor(idx / this.terrain.cols);

    const dirs = [[-1,0], [1,0], [0,-1], [0,1], [-1,-1], [1,-1], [-1,1], [1,1]];
    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < this.terrain.cols && ny >= 0 && ny < this.terrain.rows) {
        neighbors.push(ny * this.terrain.cols + nx);
      }
    }
    return neighbors;
  }

  idxToXY(idx) {
    const pos = this.terrain.gridToWorld(idx);
    return [pos.x, pos.y];
  }

  reconstructPath(cameFrom, current) {
    const path = [this.terrain.gridToWorld(current)];
    while (cameFrom.has(current)) {
      current = cameFrom.get(current);
      path.unshift(this.terrain.gridToWorld(current));
    }
    return path;
  }
}

module.exports = { HTNPlanner, TacticalAI };
