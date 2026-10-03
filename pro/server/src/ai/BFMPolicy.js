/**
 * BFMPolicy - 空战机动（BFM）的表格型 Q-learning 策略
 *
 * 设计要点：
 * 1. 状态：把连续空战几何离散成 ~2880 个态势格
 *    （距离带 × 我机头偏离 ATA × 进入角 AA × 敌机头威胁 × 高度差 × 有无来袭导弹 × 有无中距弹）
 * 2. 动作：10 个机动原语（前置/滞后追踪、高/低悠悠、急转、桶滚、破S、防御盘旋、脱离、交汇偏置）
 *    武器发射（航炮/中距弹/干扰弹）仍交由规则裁决，避免动作空间爆炸，也让机动策略可解释
 * 3. 学习：ε-greedy 探索 + 一步 Q-learning 更新；自对弈（红蓝共用同一张 Q 表，零和对称博弈）
 * 4. 持久化：Q 表存 pro/server/data/bfm-policy.json，服务端重启后可直接用于推理
 *
 * 这是一个纯 JS 实现，不依赖 Python / TensorFlow / PyTorch。
 */
const fs = require('fs');
const path = require('path');

/** 动作空间：机动原语（名称与 AirCombatAI 的机动标签保持一致） */
const ACTIONS = [
  'lead_pursuit',
  'lag_pursuit',
  'high_yoyo',
  'low_yoyo',
  'break_turn',
  'barrel_roll_defense',
  'split_s',
  'defensive_spiral',
  'extend',
  'merge_offset'
];

const ACTION_LABELS = {
  lead_pursuit: '前置追踪',
  lag_pursuit: '滞后追踪',
  high_yoyo: '高悠悠',
  low_yoyo: '低悠悠',
  break_turn: '防御急转',
  barrel_roll_defense: '防御桶滚',
  split_s: '破S机动',
  defensive_spiral: '防御盘旋',
  extend: '加速脱离',
  merge_offset: '交汇偏置'
};

class BFMPolicy {
  constructor(options = {}) {
    this.q = new Map();                 // stateKey -> number[ACTIONS.length]
    this.alpha = 0.15;                  // 学习率
    this.gamma = 0.95;                  // 折扣因子
    this.epsilon = 0.35;                // 当前探索率
    this.epsilonMin = 0.05;
    this.epsilonDecay = 0.99;           // 每训练回合衰减
    this.explore = false;               // 推理时不探索
    this.episodes = 0;                  // 累计训练回合
    this.lastStats = null;
    this.file = options.file || path.join(__dirname, '../../data/bfm-policy.json');
    this.load();
  }

  // ==================== 状态离散化 ====================
  /**
   * 把空战态势编码为状态键
   * @param {Object} sit - AirCombatAI.computeSituation() 的输出
   * @param {boolean} hasThreat - 是否有来袭导弹（临近命中）
   * @param {boolean} hasMissile - 是否还有中距弹
   */
  encode(sit, hasThreat = false, hasMissile = false) {
    const distBand = sit.dist < 800 ? 0 : sit.dist < 2000 ? 1 : sit.dist < 4000 ? 2 : sit.dist < 7000 ? 3 : 4;
    const ataBand = sit.myATA < 15 ? 0 : sit.myATA < 40 ? 1 : sit.myATA < 90 ? 2 : 3;
    const aaBand = sit.AA < 45 ? 0 : sit.AA < 90 ? 1 : sit.AA < 135 ? 2 : 3;
    const threatBand = sit.enemyATA < 30 ? 0 : sit.enemyATA < 60 ? 1 : 2;
    const altBand = sit.altDiff < -600 ? 0 : sit.altDiff <= 600 ? 1 : 2;
    return `${distBand}${ataBand}${aaBand}${threatBand}${altBand}${hasThreat ? 1 : 0}${hasMissile ? 1 : 0}`;
  }

  /** 状态的理论规模（用于展示） */
  stateSpaceSize() {
    return 5 * 4 * 4 * 3 * 3 * 2 * 2;
  }

  // ==================== Q 值存取 ====================
  ensure(key) {
    let row = this.q.get(key);
    if (!row) {
      row = new Array(ACTIONS.length).fill(0);
      this.q.set(key, row);
    }
    return row;
  }

  /**
   * ε-greedy 选动作
   * @returns {string} 机动名
   */
  select(key, explore = this.explore) {
    const row = this.ensure(key);
    if (explore && Math.random() < this.epsilon) {
      return ACTIONS[Math.floor(Math.random() * ACTIONS.length)];
    }
    let best = 0;
    for (let i = 1; i < row.length; i++) {
      if (row[i] > row[best]) best = i;
    }
    return ACTIONS[best];
  }

  /** 取当前状态下的最优动作（用于展示策略） */
  bestAction(key) {
    const row = this.ensure(key);
    let best = 0;
    for (let i = 1; i < row.length; i++) {
      if (row[i] > row[best]) best = i;
    }
    return { action: ACTIONS[best], value: row[best] };
  }

  actionIndex(action) {
    const idx = ACTIONS.indexOf(action);
    return idx < 0 ? 0 : idx;
  }

  /** 一步 Q-learning 更新 */
  update(key, action, reward, nextKey, done = false) {
    if (!key || action == null) return;
    const row = this.ensure(key);
    const a = this.actionIndex(action);
    const nextRow = this.ensure(nextKey || key);
    let bestNext = -Infinity;
    for (const v of nextRow) if (v > bestNext) bestNext = v;
    const target = done ? reward : reward + this.gamma * bestNext;
    row[a] += this.alpha * (target - row[a]);
  }

  decayEpsilon() {
    this.epsilon = Math.max(this.epsilonMin, this.epsilon * this.epsilonDecay);
  }

  setExplore(on) {
    this.explore = !!on;
  }

  // ==================== 态势优势（奖励 shaping） ====================
  /**
   * 单步角度优势：正值表示我方占优（咬住对手尾后 / 对手未瞄准我）
   * @param {Object} sit
   * @param {number} cannonRange
   */
  advantage(sit, cannonRange = 1000) {
    let adv = (1 - Math.min(180, sit.AA) / 180) - (1 - Math.min(180, sit.enemyATA) / 180);
    if (sit.dist <= cannonRange && sit.myATA < 25) adv += 0.4;   // 进入射击窗口
    if (sit.dist > 6000) adv -= 0.2;                             // 脱离交战
    return adv;
  }

  // ==================== 持久化 ====================
  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const obj = {
        version: 1,
        episodes: this.episodes,
        epsilon: this.epsilon,
        alpha: this.alpha,
        gamma: this.gamma,
        q: Object.fromEntries(this.q)
      };
      fs.writeFileSync(this.file, JSON.stringify(obj), 'utf8');
      return true;
    } catch (err) {
      console.warn('[RL] Q表保存失败:', err.message);
      return false;
    }
  }

  load() {
    try {
      if (!fs.existsSync(this.file)) return;
      const obj = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.q = new Map(Object.entries(obj.q || {}));
      this.episodes = obj.episodes || 0;
      this.epsilon = obj.epsilon ?? 0.35;
      if (obj.alpha) this.alpha = obj.alpha;
      if (obj.gamma) this.gamma = obj.gamma;
      console.log(`[RL] 已加载 Q 表：${this.q.size} 个状态，${this.episodes} 回合训练经验`);
    } catch (err) {
      console.warn('[RL] Q表加载失败:', err.message);
    }
  }

  reset() {
    this.q.clear();
    this.episodes = 0;
    this.epsilon = 0.35;
    this.lastStats = null;
    try {
      if (fs.existsSync(this.file)) fs.unlinkSync(this.file);
    } catch (err) {
      console.warn('[RL] Q表文件删除失败:', err.message);
    }
  }

  /** 供前端展示的训练状态 */
  status() {
    return {
      trained: this.episodes > 0,
      episodes: this.episodes,
      states: this.q.size,
      stateSpace: this.stateSpaceSize(),
      epsilon: Number(this.epsilon.toFixed(3)),
      actions: ACTIONS.length,
      lastStats: this.lastStats
    };
  }
}

let instance = null;
function getPolicy() {
  if (!instance) instance = new BFMPolicy();
  return instance;
}

module.exports = { BFMPolicy, ACTIONS, ACTION_LABELS, getPolicy };
