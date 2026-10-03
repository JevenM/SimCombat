/**
 * EquipmentDatabase - 装备数据库
 * 参考真实军事装备参数
 * 确保同型号装备性能一致性
 */

const EquipmentDatabase = {
  // ====== 陆基单位 ======
  infantry: {
    name: '步兵班',
    type: 'ground',
    mobility: 'foot',
    hp: 50,
    maxHp: 50,
    speed: 15, // km/h 徒步行军速度
    range: 400, // 步枪有效射程 400m
    damage: 15, // 5.56mm/7.62mm步枪
    fireRate: 2, // rounds/sec 自动步枪射速
    accuracy: 0.65, // 训练有素士兵命中率
    evasion: 0.3, // 分散机动
    armor: 0.05, // 基本无装甲，只有防弹衣
    detection: 100, // 目视搜索
    signature: 0.3, // 热信号低
    height: 1.7,
    weapons: ['rifle', 'lmg', 'grenade'],
    vision: 800, // 目视距离
    cost: 10
  },
  tank: {
    name: '99A主战坦克',
    type: 'ground',
    mobility: 'tracked',
    hp: 400, // 复合装甲+反应装甲
    maxHp: 400,
    speed: 65, // km/h 公路速度
    range: 2500, // 125mm滑膛炮有效射程 2500m
    damage: 120, // 125mm APFSDS
    fireRate: 0.2, // 3 rounds/min 装填限制
    accuracy: 0.9, // 现代火控系统
    evasion: 0.08, // 机动规避
    armor: 0.75, // 复合装甲等效
    detection: 200, // 热成像/激光测距
    signature: 0.9, // 热信号高
    height: 2.3,
    weapons: ['main_gun', 'coaxial_mg', 'cmd_mg'],
    vision: 3500, // 昼间光学/夜间热成像
    cost: 300
  },
  apc: {
    name: 'ZBL-08轮式装甲车',
    type: 'ground',
    mobility: 'wheeled',
    hp: 180,
    maxHp: 180,
    speed: 100, // km/h 公路速度
    range: 1500, // 30mm机关炮射程
    damage: 35, // 30mm AP
    fireRate: 0.5, // 200 rounds/min
    accuracy: 0.7,
    evasion: 0.15,
    armor: 0.35, // 防护小口径武器
    detection: 150,
    signature: 0.6,
    height: 2.6,
    weapons: ['autocannon', 'atgm', 'mg'],
    vision: 2000,
    cost: 120,
    transport: 10 // 可运输步兵数
  },
  artillery: {
    name: 'PLZ-05自行火炮',
    type: 'ground',
    mobility: 'tracked',
    hp: 120,
    maxHp: 120,
    speed: 55, // km/h
    range: 15000, // 155mm榴弹射程 15km
    damage: 200, // 155mm HE
    fireRate: 0.1, // 6 rounds/min (爆发)
    accuracy: 0.75, // GPS制导炮弹
    evasion: 0.02, // 几乎不能机动规避
    armor: 0.15, // 防破片
    detection: 50, // 依赖外部侦查
    signature: 0.8, // 发射特征明显
    height: 2.8,
    weapons: ['howitzer'],
    vision: 500,
    cost: 350,
    indirect: true
  },
  air_defense: {
    name: 'HQ-16防空导弹',
    type: 'ground',
    mobility: 'wheeled',
    hp: 100,
    maxHp: 100,
    speed: 80, // km/h
    range: 40000, // 40km射程
    damage: 150, // 破片杀伤
    fireRate: 0.3, // 2 rounds/min
    accuracy: 0.92, // 雷达制导
    evasion: 0.05,
    armor: 0.1,
    detection: 400, // 雷达探测距离
    signature: 0.7,
    height: 4,
    weapons: ['sam'],
    vision: 2000,
    cost: 400,
    antiAir: true
  },
  mlrs: {
    name: 'PHL-03火箭炮',
    type: 'ground',
    mobility: 'wheeled',
    hp: 100,
    maxHp: 100,
    speed: 60,
    range: 40000, // 40-70km
    damage: 120, // 单发300mm火箭弹
    fireRate: 1, // 多发齐射
    accuracy: 0.5, // 面积压制武器
    evasion: 0.02,
    armor: 0.1,
    detection: 50,
    signature: 0.9,
    height: 3.2,
    weapons: ['rocket'],
    vision: 500,
    cost: 300,
    indirect: true
  },

  // ====== 空中单位 ======
  fighter: {
    name: '歼-20战斗机',
    type: 'air',
    mobility: 'flight',
    hp: 150,
    maxHp: 150,
    speed: 2200, // km/h 超音速巡航
    range: 15000, // 机炮射程 1.5km
    damage: 80, // 30mm机炮
    fireRate: 6, // 6000 rounds/min
    accuracy: 0.85,
    evasion: 0.6, // 高机动性
    armor: 0,
    detection: 300, // 有源相控阵雷达
    signature: 0.2, // 隐身设计
    height: 5000,
    weapons: ['cannon', 'aam', 'agm'],
    vision: 3000,
    cost: 1000,
    maxAltitude: 20000,
    fuel: 3600,
    fuelConsumption: 1
  },
  fighter_heavy: {
    name: '歼-16重型战机',
    type: 'air',
    mobility: 'flight',
    hp: 190,
    maxHp: 190,
    speed: 2100, // km/h
    range: 1500, // 航炮有效射程
    damage: 90, // 30mm航炮
    fireRate: 6,
    accuracy: 0.82,
    evasion: 0.45, // 机体较大，瞬时机动略逊
    armor: 0.05,
    detection: 260,
    signature: 0.55, // 非隐身
    height: 5000,
    weapons: ['cannon', 'aam', 'agm'],
    vision: 3000,
    cost: 900,
    maxAltitude: 18000,
    fuel: 4200,
    fuelConsumption: 1
  },
  fighter_light: {
    name: '歼-10C轻型战机',
    type: 'air',
    mobility: 'flight',
    hp: 130,
    maxHp: 130,
    speed: 1900, // km/h
    range: 1500,
    damage: 75,
    fireRate: 6,
    accuracy: 0.86,
    evasion: 0.7, // 高敏捷机型
    armor: 0,
    detection: 220,
    signature: 0.45,
    height: 5000,
    weapons: ['cannon', 'aam'],
    vision: 2500,
    cost: 600,
    maxAltitude: 17000,
    fuel: 3000,
    fuelConsumption: 1
  },
  bomber: {
    name: '轰-6K轰炸机',
    type: 'air',
    mobility: 'flight',
    hp: 300,
    maxHp: 300,
    speed: 900, // km/h
    range: 2500, // 巡航导弹射程
    damage: 300, // KD-20巡航导弹
    fireRate: 0.1, // 巡航导弹发射间隔
    accuracy: 0.85, // 制导武器
    evasion: 0.15,
    armor: 0.1,
    detection: 250,
    signature: 0.8,
    height: 10000,
    weapons: ['cruise_missile', 'bomb'],
    vision: 2000,
    cost: 800,
    maxAltitude: 12000,
    fuel: 10800, // 3小时续航
    fuelConsumption: 1
  },
  helicopter: {
    name: '武直-10',
    type: 'air',
    mobility: 'flight',
    hp: 120,
    maxHp: 120,
    speed: 290, // km/h
    range: 3000, // 空地导弹射程
    damage: 60, // AKD-10空地导弹
    fireRate: 0.3, // 齐射
    accuracy: 0.82,
    evasion: 0.35,
    armor: 0.15, // 装甲座舱
    detection: 200,
    signature: 0.6,
    height: 200,
    weapons: ['atgm', 'rocket', 'gun'],
    vision: 1200,
    cost: 350,
    maxAltitude: 600,
    fuel: 2400, // 40分钟
    fuelConsumption: 1
  },
  uav: {
    name: '攻击-2无人机',
    type: 'air',
    mobility: 'flight',
    hp: 40,
    maxHp: 40,
    speed: 200, // km/h
    range: 100, // 导弹射程较近
    damage: 40, // 空地导弹
    fireRate: 0.2,
    accuracy: 0.75,
    evasion: 0.1,
    armor: 0,
    detection: 150,
    signature: 0.15, // 低信号特征
    height: 500,
    weapons: ['atgm', 'bomb'],
    vision: 2000,
    stealth: true,
    cost: 100,
    maxAltitude: 9000,
    fuel: 7200, // 20小时续航
    fuelConsumption: 0.3
  },
  awacs: {
    name: '空警-500预警机',
    type: 'air',
    mobility: 'flight',
    hp: 200,
    maxHp: 200,
    speed: 700,
    range: 0, // 无武装
    damage: 0,
    fireRate: 0,
    accuracy: 0,
    evasion: 0.2,
    armor: 0,
    detection: 800, // 远程雷达
    signature: 0.7,
    height: 9000,
    weapons: [],
    vision: 8000,
    cost: 600,
    maxAltitude: 10000,
    fuel: 28800, // 8小时
    fuelConsumption: 1
  },

  // ====== 海上单位 ======
  destroyer: {
    name: '055型驱逐舰',
    type: 'naval',
    mobility: 'naval',
    hp: 800,
    maxHp: 800,
    speed: 60, // km/h 30节
    range: 2000, // 舰炮射程 20km
    damage: 180, // 130mm舰炮 / 反舰导弹
    fireRate: 0.5,
    accuracy: 0.92,
    evasion: 0.2,
    armor: 0.4,
    detection: 500, // 相控阵雷达
    signature: 1.0,
    height: 15,
    weapons: ['naval_gun', 'sam', 'torpedo', 'asm'],
    vision: 3000,
    cost: 1500,
    sonar: 400
  },
  submarine: {
    name: '093型核潜艇',
    type: 'naval',
    mobility: 'naval',
    hp: 500,
    maxHp: 500,
    speed: 55, // km/h 水下30节
    range: 500, // 鱼雷射程
    damage: 250, // 鱼雷/巡航导弹
    fireRate: 0.2,
    accuracy: 0.9,
    evasion: 0.5, // 隐蔽性
    armor: 0.3,
    detection: 200, // 被动声纳
    signature: 0.3, // 低噪声
    height: -100,
    weapons: ['torpedo', 'cruise_missile'],
    vision: 800,
    stealth: true,
    cost: 2000,
    sonar: 500,
    maxDepth: 500
  },
  carrier: {
    name: '辽宁舰航母',
    type: 'naval',
    mobility: 'naval',
    hp: 2000,
    maxHp: 2000,
    speed: 54, // km/h 29节
    range: 100, // 近防炮
    damage: 50,
    fireRate: 10, // 730近防炮
    accuracy: 0.7,
    evasion: 0.02,
    armor: 0.5,
    detection: 600,
    signature: 1.5,
    height: 20,
    weapons: ['ciws', 'sam'],
    vision: 5000,
    cost: 5000,
    airwing: 40
  },
  landing_ship: {
    name: '071型两栖舰',
    type: 'naval',
    mobility: 'naval',
    hp: 600,
    maxHp: 600,
    speed: 40,
    range: 200,
    damage: 30,
    fireRate: 0.5,
    accuracy: 0.55,
    evasion: 0.08,
    armor: 0.25,
    detection: 250,
    signature: 0.9,
    height: 12,
    weapons: ['sam', 'cannon'],
    vision: 1000,
    cost: 1000,
    transport: 800
  },
  frigate: {
    name: '054A型护卫舰',
    type: 'naval',
    mobility: 'naval',
    hp: 500,
    maxHp: 500,
    speed: 54, // 27节
    range: 1500,
    damage: 120,
    fireRate: 0.4,
    accuracy: 0.85,
    evasion: 0.25,
    armor: 0.3,
    detection: 350,
    signature: 0.8,
    height: 10,
    weapons: ['naval_gun', 'sam', 'asw'],
    vision: 2500,
    cost: 800,
    sonar: 300
  },

  // ====== 支援单位 ======
  radar: {
    name: 'JY-27A雷达',
    type: 'ground',
    mobility: 'fixed',
    hp: 60,
    maxHp: 60,
    speed: 0,
    range: 0,
    damage: 0,
    fireRate: 0,
    accuracy: 0,
    evasion: 0,
    armor: 0,
    detection: 600, // 对空搜索
    signature: 0.85,
    height: 15,
    vision: 6000,
    cost: 200,
    radar: true
  },
  supply: {
    name: '补给车',
    type: 'ground',
    mobility: 'wheeled',
    hp: 80,
    maxHp: 80,
    speed: 70,
    range: 0,
    damage: 0,
    fireRate: 0,
    accuracy: 0,
    evasion: 0.05,
    armor: 0.1,
    detection: 100,
    signature: 0.5,
    height: 2.8,
    vision: 300,
    cost: 60,
    supply: 2000
  },
  command: {
    name: '指挥车',
    type: 'ground',
    mobility: 'wheeled',
    hp: 100,
    maxHp: 100,
    speed: 80,
    range: 0,
    damage: 0,
    fireRate: 0,
    accuracy: 0,
    evasion: 0.1,
    armor: 0.2,
    detection: 300, // 指挥通信能力
    signature: 0.6,
    height: 3.0,
    vision: 2000,
    cost: 250,
    command: true
  },
  jamming: {
    name: '电子对抗车',
    type: 'ground',
    mobility: 'wheeled',
    hp: 80,
    maxHp: 80,
    speed: 65,
    range: 0,
    damage: 0,
    fireRate: 0,
    accuracy: 0,
    evasion: 0.08,
    armor: 0.1,
    detection: 200,
    signature: 0.7,
    height: 3.5,
    vision: 1000,
    cost: 300,
    ecm: true,
    ecmRange: 1500
  }
};

/**
 * 空战（BFM）参数表
 * 仅在「空战对决」模式下由 FlightModel / MissileSystem / AirCombatAI 使用
 * - cannon: 航炮（射程 m、单发伤害、射速 发/s、精度、射击锥半角 度）
 * - missile: 空空导弹（挂载数、最大射程、最小发射距离、飞行速度 m/s、
 *            伤害、基础命中率、续航秒、近炸引信半径、锁定耗时、装填间隔）
 * - turnRateDegPerSec / maxG: 最大稳定转弯率与过载
 * - climbRate: 最大爬升率 m/s
 * - minSpeedMs / maxSpeedMs: 失速下限与极速上限 m/s
 * - flares: 红外干扰弹数量
 */
const AIR_COMBAT_PROFILES = {
  fighter: {
    cannon: { range: 1500, damage: 80, fireRate: 6, accuracy: 0.8, coneDeg: 10 },
    missile: { count: 4, range: 8000, launchMin: 600, speed: 1100, damage: 130,
               hitProb: 0.78, lifeSec: 14, proxyFuze: 45, lockSec: 1.5, reloadSec: 3 },
    turnRateDegPerSec: 30, maxG: 9, climbRate: 200,
    minSpeedMs: 130, maxSpeedMs: 610, flares: 16
  },
  fighter_heavy: {
    cannon: { range: 1500, damage: 90, fireRate: 6, accuracy: 0.82, coneDeg: 10 },
    missile: { count: 6, range: 9000, launchMin: 600, speed: 1150, damage: 140,
               hitProb: 0.8, lifeSec: 15, proxyFuze: 50, lockSec: 1.5, reloadSec: 3 },
    turnRateDegPerSec: 24, maxG: 8, climbRate: 180,
    minSpeedMs: 150, maxSpeedMs: 583, flares: 20
  },
  fighter_light: {
    cannon: { range: 1500, damage: 75, fireRate: 6, accuracy: 0.86, coneDeg: 9 },
    missile: { count: 2, range: 6500, launchMin: 500, speed: 1050, damage: 120,
               hitProb: 0.74, lifeSec: 12, proxyFuze: 40, lockSec: 1.2, reloadSec: 2.5 },
    turnRateDegPerSec: 36, maxG: 10, climbRate: 220,
    minSpeedMs: 110, maxSpeedMs: 528, flares: 12
  }
};

// 未单独配置机型的空中单位使用的通用参数
const DEFAULT_AIR_COMBAT = {
  cannon: { range: 800, damage: 40, fireRate: 3, accuracy: 0.6, coneDeg: 12 },
  missile: { count: 0, range: 0, launchMin: 0, speed: 800, damage: 0,
             hitProb: 0, lifeSec: 0, proxyFuze: 0, lockSec: 0, reloadSec: 0 },
  turnRateDegPerSec: 12, maxG: 4, climbRate: 60,
  minSpeedMs: 60, maxSpeedMs: 250, flares: 0
};

// 为所有空中单位挂载空战参数
for (const [key, data] of Object.entries(EquipmentDatabase)) {
  if (data.type === 'air') {
    data.airCombat = AIR_COMBAT_PROFILES[key] || DEFAULT_AIR_COMBAT;
  }
}

// 获取装备数据
function getEquipment(type) {
  const base = EquipmentDatabase[type];
  if (!base) return null;
  // category 保留原始兵种类别（air/ground/naval），避免被装备键名覆盖后无法区分
  return { ...base, type, category: base.type };
}

/**
 * 判断实体是否属于空中单位
 * 注意：entity.type 会被装备键名（如 fighter）覆盖，必须统一使用 category 判定
 */
function isAirEntity(entity) {
  if (!entity) return false;
  return entity.category === 'air' || entity.mobilityType === 'flight';
}

// 装备克制关系（基于真实战术）
const EquipmentCounters = {
  tank: ['air_defense', 'helicopter', 'fighter', 'attack_heli', 'atgm'],
  apc: ['tank', 'artillery', 'anti_tank', 'helicopter'],
  infantry: ['artillery', 'mlrs', 'helicopter', 'aircraft'],
  helicopter: ['air_defense', 'fighter', 'apc'],
  fighter: ['air_defense', 'fighter', 'awacs'],
  bomber: ['fighter', 'air_defense', 'awacs'],
  uav: ['air_defense', 'fighter', 'jamming'],
  destroyer: ['submarine', 'bomber', 'carrier'],
  submarine: ['destroyer', 'frigate', 'helicopter'],
  carrier: ['submarine', 'bomber'],
  frigate: ['submarine', 'destroyer'],
  landing_ship: ['submarine', 'aircraft']
};

// 计算装备间伤害加成
function getDamageModifier(attackerType, targetType) {
  const counters = EquipmentCounters[attackerType] || [];
  if (counters.includes(targetType)) return 1.5;
  // 反坦克导弹对坦克效果特别好
  if (attackerType === 'helicopter' && targetType === 'tank') return 2.0;
  if (attackerType === 'fighter' && targetType === 'bomber') return 1.8;
  return 1.0;
}

// 装备描述信息
const EquipmentDescriptions = {
  tank: '现代主战坦克，装备125mm滑膛炮，具备强大火力和防护能力',
  apc: '8x8轮式装甲车，装备30mm机关炮，可运输步兵分队',
  infantry: '标准步兵班，装备自动步枪、轻机枪和反坦克武器',
  artillery: '155mm自行榴弹炮，射程15km，可精确打击',
  air_defense: '中程防空导弹系统，射程40km，可拦截各类空中目标',
  mlrs: '300mm多管火箭炮，射程40-70km，用于面积压制',
  fighter: '第五代隐身战斗机，具备超音速巡航和先进航电系统',
  fighter_heavy: '双发重型战斗机，载弹量大、航程远，适合中距拦截',
  fighter_light: '单发高敏捷战斗机，瞬时盘旋能力强，适合近距缠斗',
  helicopter: '专用武装直升机，装备空地导弹和机关炮',
  uav: '察打一体无人机，可长时间巡航并执行精确打击',
  destroyer: '万吨级驱逐舰，装备相控阵雷达和垂直发射系统',
  submarine: '攻击型核潜艇，静音性能好，续航能力强'
};

// ==================== 装备库运行时编辑 ====================
// 支持用户调整现有机型参数、新增自定义机型，并持久化到本地文件（重启后保留）
const fs = require('fs');
const path = require('path');

// 内置库的原始快照（用于「恢复默认」）
const BUILTIN_DB_SNAPSHOT = JSON.parse(JSON.stringify(EquipmentDatabase));
const OVERRIDE_FILE = path.join(__dirname, '../../../data/equipment-overrides.json');

const customTypes = new Set();    // 用户新建的机型
const modifiedTypes = new Set();  // 被改过的内置机型

/** 为机型补齐派生字段（生命上限、空战参数） */
function ensureDerivedFields(key, data) {
  if (data.maxHp === undefined) data.maxHp = data.hp;
  if (data.type === 'air') {
    data.airCombat = data.airCombat
      || AIR_COMBAT_PROFILES[key]
      || JSON.parse(JSON.stringify(DEFAULT_AIR_COMBAT));
  }
  return data;
}

function persistOverrides() {
  const modified = {};
  for (const key of modifiedTypes) modified[key] = EquipmentDatabase[key];
  const custom = {};
  for (const key of customTypes) custom[key] = EquipmentDatabase[key];
  try {
    fs.mkdirSync(path.dirname(OVERRIDE_FILE), { recursive: true });
    fs.writeFileSync(OVERRIDE_FILE, JSON.stringify({ modified, custom }, null, 2), 'utf8');
  } catch (err) {
    console.warn('[装备库] 持久化失败:', err.message);
  }
}

function loadOverrides() {
  if (!fs.existsSync(OVERRIDE_FILE)) return;
  try {
    const parsed = JSON.parse(fs.readFileSync(OVERRIDE_FILE, 'utf8'));
    for (const [key, data] of Object.entries(parsed.custom || {})) {
      EquipmentDatabase[key] = ensureDerivedFields(key, data);
      customTypes.add(key);
    }
    for (const [key, data] of Object.entries(parsed.modified || {})) {
      EquipmentDatabase[key] = ensureDerivedFields(key, data);
      modifiedTypes.add(key);
    }
    console.log(`[装备库] 已加载自定义配置：${customTypes.size} 个新机型，${modifiedTypes.size} 个已修改机型`);
  } catch (err) {
    console.warn('[装备库] 覆盖配置加载失败:', err.message);
  }
}

/**
 * 导出给前端的完整装备库
 * @returns {{database: Object, custom: string[], modified: string[]}}
 */
function listEquipment() {
  return {
    database: EquipmentDatabase,
    custom: [...customTypes],
    modified: [...modifiedTypes]
  };
}

/**
 * 新增或更新机型
 * @param {string} key - 装备键名（英文ID）
 * @param {Object} data - 装备参数
 * @returns {{created: boolean, key: string}}
 */
function upsertEquipment(key, data) {
  if (!key || !data) throw new Error('缺少机型标识或参数');
  const isNew = !EquipmentDatabase[key];
  if (isNew) {
    customTypes.add(key);
  } else if (!customTypes.has(key)) {
    modifiedTypes.add(key);
  }
  EquipmentDatabase[key] = ensureDerivedFields(key, {
    ...EquipmentDatabase[key],
    ...JSON.parse(JSON.stringify(data))
  });
  persistOverrides();
  return { created: isNew, key };
}

/** 删除机型（只允许删除用户自定义的机型） */
function deleteEquipment(key) {
  if (!customTypes.has(key)) return false;
  delete EquipmentDatabase[key];
  customTypes.delete(key);
  modifiedTypes.delete(key);
  persistOverrides();
  return true;
}

/** 恢复单个内置机型到出厂参数（自定义机型则删除） */
function resetEquipment(key) {
  if (customTypes.has(key)) return deleteEquipment(key);
  if (!BUILTIN_DB_SNAPSHOT[key]) return false;
  EquipmentDatabase[key] = JSON.parse(JSON.stringify(BUILTIN_DB_SNAPSHOT[key]));
  ensureDerivedFields(key, EquipmentDatabase[key]);
  modifiedTypes.delete(key);
  persistOverrides();
  return true;
}

/** 恢复全部：删除所有自定义机型，内置机型回到出厂参数 */
function resetAllEquipment() {
  for (const key of [...customTypes]) delete EquipmentDatabase[key];
  customTypes.clear();
  for (const [key, data] of Object.entries(BUILTIN_DB_SNAPSHOT)) {
    EquipmentDatabase[key] = JSON.parse(JSON.stringify(data));
  }
  modifiedTypes.clear();
  persistOverrides();
  return true;
}

// 模块加载时立即应用本地覆盖配置
loadOverrides();

module.exports = {
  EquipmentDatabase,
  getEquipment,
  EquipmentCounters,
  getDamageModifier,
  EquipmentDescriptions,
  AIR_COMBAT_PROFILES,
  DEFAULT_AIR_COMBAT,
  isAirEntity,
  // 装备库编辑接口
  listEquipment,
  upsertEquipment,
  deleteEquipment,
  resetEquipment,
  resetAllEquipment
};
