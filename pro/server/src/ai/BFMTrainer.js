/**
 * BFMTrainer - 空战机动策略的自对弈训练器
 *
 * 每回合：
 *   1. 新建一份独立的 Simulation（不录音、不影响线上推演）
 *   2. startDuel({ policy: 'rl' })，双方都由 Q-learning 策略驱动
 *   3. 每个仿真步采样 (s, a, r, s')，对红蓝双方各做一次 Q 更新
 *
 * 奖励（我方视角）：
 *   造成的伤害 +0.6×damage │ 承受的伤害 −0.8×damage │ 角度优势 shaping ×0.25
 *   每步 −0.15（抑制消极拖延）│ 出界 −0.5 │ 击落 +100 / 被击落 −80 / 平局 −25
 *
 * 自对弈双方共用一张 Q 表（零和对称博弈），初始条件随机化以提升泛化能力。
 */
const Simulation = require('../engine/Simulation');
const { getPolicy, ACTIONS } = require('./BFMPolicy');

const DUEL_TYPES = ['fighter', 'fighter_heavy', 'fighter_light'];

class BFMTrainer {
  constructor() {
    this.running = false;
    this.cancelRequested = false;
  }

  /**
   * @param {Object} options - { episodes, reset, onProgress }
   */
  async train(options = {}) {
    if (this.running) return { started: false, message: '训练正在进行中' };

    const episodes = Math.min(2000, Math.max(1, Number(options.episodes) || 100));
    const policy = getPolicy();
    if (options.reset) policy.reset();

    this.running = true;
    this.cancelRequested = false;
    policy.setExplore(true);

    const startedAt = Date.now();
    let rewardSum = 0;
    let stepSum = 0;
    const winners = { red: 0, blue: 0, draw: 0 };
    // 复用同一个仿真实例（地形只生成一次），每回合靠 startDuel() 重置
    const sim = new Simulation({ dt: 1, tickRate: 1000, replayEnabled: false });

    try {
      // Q 表为空时先用规则专家做一次「行为克隆」热启动，避免从零随机探索
      if (policy.q.size === 0) {
        const samples = this.warmStart(sim, policy, 40);
        console.log(`[RL] 专家示范热启动：${samples} 条样本，${policy.q.size} 个状态`);
      }

      for (let ep = 1; ep <= episodes && !this.cancelRequested; ep++) {
        // 一半自对弈、一半挑战规则 AI，既保证泛化又针对当前专家系统优化
        const mode = Math.random() < 0.5 ? 'self' : 'vsRule';
        const result = this.runEpisode(sim, policy, { mode });
        rewardSum += result.reward;
        stepSum += result.steps;
        winners[result.winner] = (winners[result.winner] || 0) + 1;
        policy.episodes = (policy.episodes || 0) + 1;
        policy.decayEpsilon();

        if (options.onProgress && (ep % 5 === 0 || ep === episodes)) {
          options.onProgress({
            running: true,
            episode: ep,
            total: episodes,
            epsilon: Number(policy.epsilon.toFixed(3)),
            avgReward: Number((rewardSum / ep).toFixed(2)),
            avgSteps: Math.round(stepSum / ep),
            winners: { ...winners }
          });
        }
        // 让出事件循环，避免长时间阻塞 WebSocket / HTTP
        await new Promise(r => setImmediate(r));
      }
    } finally {
      this.running = false;
      policy.setExplore(false);
      policy.save();
    }

    const stats = {
      episodes,
      avgReward: Number((rewardSum / Math.max(1, episodes)).toFixed(2)),
      avgSteps: Math.round(stepSum / Math.max(1, episodes)),
      winners,
      states: policy.q.size,
      epsilon: Number(policy.epsilon.toFixed(3)),
      durationSec: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
      cancelled: this.cancelRequested
    };
    policy.lastStats = stats;
    return { started: true, stats };
  }

  cancel() {
    if (this.running) this.cancelRequested = true;
  }

  /**
   * 专家示范热启动（表格版行为克隆）
   * 跑若干场「规则 AI vs 规则 AI」，把专家实际选用的机动写入 Q 表作为初始偏好，
   * 让 RL 站在一个已经会打的起点上继续自我改进，而不是从随机策略起步。
   */
  warmStart(sim, policy, episodes = 40) {
    const jitter = (amp) => (Math.random() - 0.5) * 2 * amp;
    let samples = 0;

    for (let ep = 0; ep < episodes; ep++) {
      const redType = DUEL_TYPES[Math.floor(Math.random() * DUEL_TYPES.length)];
      const blueType = DUEL_TYPES[Math.floor(Math.random() * DUEL_TYPES.length)];
      sim.startDuel({
        quiet: true,
        red: { type: redType, x: 3000 + jitter(800), y: 5000 + jitter(800), z: 5000 + jitter(800) },
        blue: { type: blueType, x: 7000 + jitter(800), y: 5000 + jitter(800), z: 5000 + jitter(800) },
        style: 'balanced',
        policy: 'rule'
      });
      sim.airCombat.duelMaxSec = 150;

      let steps = 0;
      while (!sim.duelResult && steps < 220) {
        sim.stepAirDuel();
        steps++;
        for (const self of sim.entities) {
          const foe = sim.entities.find(e => e !== self);
          if (!foe || self.hp <= 0) continue;
          const maneuver = self.bfmManeuver;
          if (!ACTIONS.includes(maneuver)) continue;   // 专家机动不在 RL 动作空间时跳过
          const key = policy.encode(
            sim.airCombat.ai.computeSituation(self, foe),
            this.hasIncoming(sim, self),
            (self.missileCount || 0) > 0
          );
          const row = policy.ensure(key);
          const idx = policy.actionIndex(maneuver);
          row[idx] = Math.max(row[idx], 1);            // 示范动作给一个正向初值
          samples++;
        }
      }
    }
    return samples;
  }

  /**
   * 跑完一整场训练对局
   * @param {'self'|'vsRule'} options.mode - self：双方 RL 自对弈；vsRule：一方 RL 挑战规则 AI
   */
  runEpisode(sim, policy, options = {}) {
    const mode = options.mode || 'self';
    const jitter = (amp) => (Math.random() - 0.5) * 2 * amp;
    const redType = DUEL_TYPES[Math.floor(Math.random() * DUEL_TYPES.length)];
    const blueType = DUEL_TYPES[Math.floor(Math.random() * DUEL_TYPES.length)];

    sim.startDuel({
      quiet: true,
      red: { type: redType, x: 3000 + jitter(800), y: 5000 + jitter(800), z: 5000 + jitter(800) },
      blue: { type: blueType, x: 7000 + jitter(800), y: 5000 + jitter(800), z: 5000 + jitter(800) },
      style: 'balanced',
      policy: 'rl'
    });
    // 训练时缩短单场时限，加快收敛
    sim.airCombat.duelMaxSec = 150;

    // 清理上一场残留的动作记录
    for (const e of sim.entities) e.__rlAction = null;
    if (mode === 'vsRule') {
      // 一方 RL、另一方固定为规则专家系统（随机决定谁用 RL）
      const rlIsRed = Math.random() < 0.5;
      sim.entities[0].duelPolicy = rlIsRed ? 'rl' : 'rule';
      sim.entities[1].duelPolicy = rlIsRed ? 'rule' : 'rl';
    }

    let prev = this.sample(sim, policy);
    let steps = 0;
    let rewardTotal = 0;

    while (!sim.duelResult && steps < 220) {
      sim.stepAirDuel();
      steps++;

      const now = this.sample(sim, policy);
      const ended = sim.duelResult || null;

      const rRed = this.reward(policy, prev.red, now.red, ended, 'red');
      const rBlue = this.reward(policy, prev.blue, now.blue, ended, 'blue');
      // 只更新由 RL 驱动的一方（另一方是规则 AI，不产生学习样本）
      if (prev.red.isRL) policy.update(prev.red.key, prev.red.action, rRed, now.red.key, !!ended);
      if (prev.blue.isRL) policy.update(prev.blue.key, prev.blue.action, rBlue, now.blue.key, !!ended);

      rewardTotal += (rRed + rBlue) / 2;
      prev = now;
      if (ended) break;
    }

    // 未分出胜负（步数上限）也按剩余血量给一个终局信号
    if (!sim.duelResult) {
      const ended = sim.airCombat.judgeByHealth(sim.entities);
      const now = this.sample(sim, policy);
      if (prev.red.isRL) {
        policy.update(prev.red.key, prev.red.action, this.reward(policy, prev.red, now.red, ended, 'red'), now.red.key, true);
      }
      if (prev.blue.isRL) {
        policy.update(prev.blue.key, prev.blue.action, this.reward(policy, prev.blue, now.blue, ended, 'blue'), now.blue.key, true);
      }
    }

    const winner = sim.duelResult?.winner || 'draw';
    return { steps, reward: rewardTotal / Math.max(1, steps), winner };
  }

  /** 采样红蓝双方的当前状态（键、实际执行的动作、态势、血量） */
  sample(sim, policy) {
    const ai = sim.airCombat.ai;
    const red = sim.entities.find(e => e.id === 'red_air');
    const blue = sim.entities.find(e => e.id === 'blue_air');
    const mk = (self, foe) => ({
      key: policy.encode(this.situation(ai, self, foe), this.hasIncoming(sim, self), (self.missileCount || 0) > 0),
      action: self.__rlAction,
      isRL: self.duelPolicy === 'rl',
      sit: this.situation(ai, self, foe),
      hp: self.hp,
      foeHp: foe.hp,
      outOfBounds: this.outOfBounds(sim, self)
    });
    return { red: mk(red, blue), blue: mk(blue, red) };
  }

  situation(ai, self, foe) {
    if (!self || !foe) return { dist: 5000, AA: 90, myATA: 90, enemyATA: 90, altDiff: 0 };
    return ai.computeSituation(self, foe);
  }

  hasIncoming(sim, self) {
    const list = sim.airCombat.missiles.getIncoming(self.id) || [];
    return list.some(m => {
      const t = Math.hypot(m.x - self.x, m.y - self.y) / Math.max(100, m.speed);
      return t < 5;
    });
  }

  outOfBounds(sim, self) {
    const w = sim.terrain?.width || 10000;
    const h = sim.terrain?.height || 10000;
    const m = 200;
    return self.x < m || self.y < m || self.x > w - m || self.y > h - m;
  }

  /** 我方视角的单步奖励 */
  reward(policy, prev, now, ended, side) {
    const dealt = Math.max(0, prev.foeHp - now.foeHp);
    const taken = Math.max(0, prev.hp - now.hp);
    let r = 0.6 * dealt - 0.8 * taken;
    r += 0.25 * policy.advantage(now.sit);
    r -= 0.15; // 时间惩罚：抑制消极拖延
    if (now.outOfBounds) r -= 0.5;
    if (ended) {
      if (ended.winner === side) r += 100;
      else if (ended.winner === 'draw') r -= 25;
      else r -= 80;
    }
    return r;
  }
}

let trainer = null;
function getTrainer() {
  if (!trainer) trainer = new BFMTrainer();
  return trainer;
}

module.exports = { BFMTrainer, getTrainer };
