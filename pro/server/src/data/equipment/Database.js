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

// 获取装备数据
function getEquipment(type) {
  const base = EquipmentDatabase[type];
  if (!base) return null;
  return { ...base, type };
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
  helicopter: '专用武装直升机，装备空地导弹和机关炮',
  uav: '察打一体无人机，可长时间巡航并执行精确打击',
  destroyer: '万吨级驱逐舰，装备相控阵雷达和垂直发射系统',
  submarine: '攻击型核潜艇，静音性能好，续航能力强'
};

module.exports = {
  EquipmentDatabase,
  getEquipment,
  EquipmentCounters,
  getDamageModifier,
  EquipmentDescriptions
};
