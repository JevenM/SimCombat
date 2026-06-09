/**
 * TacticalLearner - 战术学习器
 * 基于经验回放的目标选择策略优化
 * 使用简化的Q-learning思想：
 * 1. 记录目标选择决策和结果
 * 2. 根据战果评估决策价值
 * 3. 逐步优化目标选择权重
 */

class TacticalLearner {
  constructor() {
    // 经验回放池
    this.experienceBuffer = [];
    this.maxBufferSize = 1000;

    // 目标选择策略权重（可学习的参数）
    this.policyWeights = {
      distanceWeight: 0.3,        // 距离权重
      threatWeight: 0.25,         // 威胁权重
      killPotentialWeight: 0.2,   // 击杀潜力权重
      survivabilityWeight: 0.15,  // 生存能力权重
      coordinationWeight: 0.1     // 协同权重
    };

    // 学习率
    this.learningRate = 0.01;

    // 决策历史（用于后续评估）
    this.decisionHistory = new Map(); // entityId -> decisions[]

    // 统计数据
    this.stats = {
      totalDecisions: 0,
      successfulDecisions: 0,  // 成功击杀
      totalReward: 0
    };
  }

  /**
   * 根据学习到的策略选择目标
   * @param {Object} entity - 攻击者
   * @param {Array} targets - 候选目标数组
   * @param {Object} context - 战场上下文
   * @returns {Object} 评分后的目标
   */
  selectTargetWithLearning(entity, targets, context) {
    if (!targets || targets.length === 0) return null;

    const w = this.policyWeights;
    const scoredTargets = targets.map(target => {
      let score = 0;

      // 1. 距离评分（越近越好）
      const distScore = 1 - (target.distance / entity.range);
      score += distScore * w.distanceWeight;

      // 2. 威胁评分（敌方火力/血量比）
      const threatScore = Math.min(1, (target.entity.damage || 10) /
        Math.max(1, target.entity.hp) / 10);
      score += threatScore * w.threatWeight;

      // 3. 击杀潜力（我能多快击杀它）
      const myDmg = (entity.damage || 10) * (entity.fireRate || 1) * entity.accuracy;
      const killPotential = Math.min(1, myDmg / Math.max(1, target.entity.hp));
      score += killPotential * w.killPotentialWeight;

      // 4. 生存能力（攻击后我能生存多久）
      const enemyDmg = (target.entity.damage || 10) * (target.entity.fireRate || 1);
      const timeToDie = entity.hp / Math.max(1, enemyDmg);
      const survivalScore = Math.min(1, timeToDie / 30); // 30秒为基准
      score += survivalScore * w.survivabilityWeight;

      // 5. 协同评分（友军是否也在打这个目标）
      const alliesAttacking = context.allies?.filter(a =>
        a.entity.attackTarget?.id === target.entity.id
      ).length || 0;
      const coordinationScore = Math.min(1, alliesAttacking * 0.3);
      score += coordinationScore * w.coordinationWeight;

      // 记录决策信息用于后续学习
      const decisionInfo = {
        entityId: entity.id,
        targetId: target.entity.id,
        timestamp: Date.now(),
        weights: { ...w },
        features: {
          distance: distScore,
          threat: threatScore,
          killPotential,
          survival: survivalScore,
          coordination: coordinationScore
        },
        initialScore: score
      };

      return {
        target: target.entity,
        score,
        decisionInfo
      };
    });

    // 按分数排序
    scoredTargets.sort((a, b) => b.score - a.score);

    const best = scoredTargets[0];

    // 记录决策历史
    if (!this.decisionHistory.has(entity.id)) {
      this.decisionHistory.set(entity.id, []);
    }
    this.decisionHistory.get(entity.id).push(best.decisionInfo);

    // 限制历史长度
    const history = this.decisionHistory.get(entity.id);
    if (history.length > 50) {
      history.shift();
    }

    this.stats.totalDecisions++;

    return best.target;
  }

  /**
   * 从战斗结果中学习
   * @param {Object} result - 战斗结果
   */
  learnFromOutcome(result) {
    const { attackerId, targetId, damage, hit, kill, duration } = result;

    // 查找相关的决策记录
    const history = this.decisionHistory.get(attackerId);
    if (!history || history.length === 0) return;

    // 找到最近的相关决策
    const decision = history.findLast(d => d.targetId === targetId);
    if (!decision) return;

    // 计算奖励
    let reward = 0;
    if (kill) {
      reward = 10; // 击杀奖励
    } else if (hit) {
      reward = damage / 50; // 击中奖励，按伤害比例
    } else {
      reward = -0.5; // 未命中惩罚
    }

    // 效率加成：击杀用时越短奖励越高
    if (kill && duration) {
      const efficiencyBonus = Math.max(0, 1 - duration / 60);
      reward += efficiencyBonus * 2;
    }

    // 存储经验
    this.experienceBuffer.push({
      decision: decision,
      reward: reward,
      timestamp: Date.now()
    });

    // 限制缓冲区大小
    if (this.experienceBuffer.length > this.maxBufferSize) {
      this.experienceBuffer.shift();
    }

    this.stats.totalReward += reward;
    if (kill) {
      this.stats.successfulDecisions++;
    }

    // 定期更新策略
    if (this.experienceBuffer.length >= 50) {
      this.updatePolicy();
    }
  }

  /**
   * 从经验缓冲区更新策略权重
   */
  updatePolicy() {
    // 按奖励分组分析
    const positiveExperiences = this.experienceBuffer.filter(e => e.reward > 0);
    const negativeExperiences = this.experienceBuffer.filter(e => e.reward < 0);

    if (positiveExperiences.length < 10) return;

    // 计算高奖励决策的特征平均值
    const avgPositiveFeatures = this.calculateAverageFeatures(positiveExperiences);
    const avgNegativeFeatures = negativeExperiences.length > 10 ?
      this.calculateAverageFeatures(negativeExperiences) : null;

    // 调整权重：在高奖励决策中重要的特征应该增加权重
    const w = this.policyWeights;

    for (const [feature, value] of Object.entries(avgPositiveFeatures)) {
      const weightKey = feature + 'Weight';
      if (w[weightKey] === undefined) continue;

      let adjustment = 0;

      // 如果该特征在高奖励决策中值高，增加权重
      if (value > 0.5) {
        adjustment = this.learningRate;
      }

      // 如果该特征在低奖励决策中值也高，减少权重（可能是噪声）
      if (avgNegativeFeatures && avgNegativeFeatures[feature] > 0.5) {
        adjustment -= this.learningRate * 0.5;
      }

      // 应用调整
      w[weightKey] = Math.max(0.05, Math.min(0.5, w[weightKey] + adjustment));
    }

    // 归一化权重
    this.normalizeWeights();

    console.log('Policy updated:', JSON.stringify(w));
  }

  /**
   * 计算特征平均值
   */
  calculateAverageFeatures(experiences) {
    const sum = {
      distance: 0,
      threat: 0,
      killPotential: 0,
      survival: 0,
      coordination: 0
    };

    for (const exp of experiences) {
      for (const [key, value] of Object.entries(exp.decision.features)) {
        if (sum[key] !== undefined) {
          sum[key] += value;
        }
      }
    }

    const count = experiences.length;
    return {
      distance: sum.distance / count,
      threat: sum.threat / count,
      killPotential: sum.killPotential / count,
      survival: sum.survival / count,
      coordination: sum.coordination / count
    };
  }

  /**
   * 归一化权重（确保总和为1）
   */
  normalizeWeights() {
    const w = this.policyWeights;
    const sum = w.distanceWeight + w.threatWeight + w.killPotentialWeight +
                w.survivabilityWeight + w.coordinationWeight;

    w.distanceWeight /= sum;
    w.threatWeight /= sum;
    w.killPotentialWeight /= sum;
    w.survivabilityWeight /= sum;
    w.coordinationWeight /= sum;
  }

  /**
   * 获取学习状态报告
   */
  getLearningReport() {
    return {
      stats: { ...this.stats },
      weights: { ...this.policyWeights },
      experienceCount: this.experienceBuffer.length,
      successRate: this.stats.totalDecisions > 0 ?
        (this.stats.successfulDecisions / this.stats.totalDecisions * 100).toFixed(1) + '%' : 'N/A'
    };
  }

  /**
   * 重置学习者
   */
  reset() {
    this.experienceBuffer = [];
    this.decisionHistory.clear();
    this.stats = {
      totalDecisions: 0,
      successfulDecisions: 0,
      totalReward: 0
    };
    this.policyWeights = {
      distanceWeight: 0.3,
      threatWeight: 0.25,
      killPotentialWeight: 0.2,
      survivabilityWeight: 0.15,
      coordinationWeight: 0.1
    };
  }

  /**
   * 导出学习到的策略
   */
  exportPolicy() {
    return {
      weights: { ...this.policyWeights },
      stats: { ...this.stats },
      exportedAt: Date.now()
    };
  }

  /**
   * 导入策略
   */
  importPolicy(policy) {
    if (policy.weights) {
      this.policyWeights = { ...policy.weights };
    }
  }
}

module.exports = TacticalLearner;
