/**
 * PerceptionSystem - 感知/侦察系统
 * 包含：视觉、雷达、声纳、红外等多种传感器
 */
class PerceptionSystem {
  constructor(terrain) {
    this.terrain = terrain;
    this.contacts = new Map(); // entity -> detected contacts
  }

  // 更新所有单位的感知
  updatePerception(entities) {
    // 清除上帧的接触
    this.contacts.clear();

    for (const entity of entities) {
      if (entity.hp <= 0) continue;

      const detected = this.detectEntities(entity, entities);
      this.contacts.set(entity.id, detected);

      // 设置实体的感知列表
      entity.detectedContacts = detected.map(c => ({
        id: c.id,
        side: c.side,
        x: c.x,
        y: c.y,
        type: c.type,
        confidence: c.confidence,
        lastSeen: Date.now()
      }));

      entity.pendingContacts = entity.detectedContacts.filter(c => c.side !== entity.side);
    }
  }

  // 单个实体探测
  detectEntities(detector, allEntities) {
    const detected = [];

    for (const target of allEntities) {
      if (target.id === detector.id || target.hp <= 0) continue;

      const detection = this.checkDetection(detector, target);
      if (detection.detected) {
        detected.push({
          ...target,
          confidence: detection.confidence,
          detectionType: detection.type
        });
      }
    }

    return detected;
  }

  // 检测判定
  checkDetection(detector, target) {
    const dist = Math.hypot(target.x - detector.x, target.y - detector.y);

    // 1. 视觉检测
    const visual = this.checkVisualDetection(detector, target, dist);
    if (visual.detected) return visual;

    // 2. 雷达检测
    const radar = this.checkRadarDetection(detector, target, dist);
    if (radar.detected) return radar;

    // 3. 声纳检测（水下）
    const sonar = this.checkSonarDetection(detector, target, dist);
    if (sonar.detected) return sonar;

    // 4. 红外检测
    const ir = this.checkIRDetection(detector, target, dist);
    if (ir.detected) return ir;

    return { detected: false };
  }

  // 视觉检测
  checkVisualDetection(detector, target, dist) {
    const visionRange = detector.vision || 500;
    if (dist > visionRange) return { detected: false };

    // 视线检查
    const los = this.terrain.hasLineOfSight(
      detector.x, detector.y, target.x, target.y,
      detector.height, target.height
    );
    if (!los) return { detected: false };

    // 目标隐蔽性
    const targetTerrain = this.terrain.getTerrainParams(target.x, target.y);
    const concealment = (target.signature || 0.5) * targetTerrain.cover;

    // 距离衰减
    const distanceFactor = 1 - (dist / visionRange) * 0.5;

    // 昼夜影响（简化）
    const timeFactor = 1.0; // 假设白天

    // 综合检测概率
    const detectionProb = distanceFactor * timeFactor * (1 - concealment);
    const detected = Math.random() < detectionProb;

    return {
      detected,
      confidence: detectionProb,
      type: 'visual'
    };
  }

  // 雷达检测
  checkRadarDetection(detector, target, dist) {
    if (!detector.detection || target.stealth) return { detected: false };

    const radarRange = detector.detection * 10; // 雷达探测距离
    if (dist > radarRange) return { detected: false };

    // 目标RCS（雷达截面积）
    const rcs = this.getRCS(target);

    // 距离衰减
    const signalStrength = (radarRange / (dist + 1)) ** 2;

    // 地形遮挡（雷达可部分穿透）
    const terrainBlock = 1 - this.terrain.getVisibilityFactor(
      detector.x, detector.y, target.x, target.y
    );

    // 电子干扰影响
    const jammingEffect = target.jammed ? (target.jamLevel || 0) : 0;

    const detectionProb = signalStrength * rcs * (1 - terrainBlock * 0.5) * (1 - jammingEffect);
    const detected = Math.random() < detectionProb;

    return {
      detected,
      confidence: detectionProb,
      type: 'radar'
    };
  }

  // 声纳检测
  checkSonarDetection(detector, target, dist) {
    if (!detector.sonar || !target.type === 'naval') return { detected: false };

    const sonarRange = detector.sonar;
    if (dist > sonarRange) return { detected: false };

    // 深度影响
    const depthFactor = target.height < 0 ?
      (1 - Math.abs(target.height) / (target.maxDepth || 300)) : 1;

    // 被动/主动声纳
    const signalStrength = (sonarRange / (dist + 1)) ** 1.5;

    const detectionProb = signalStrength * depthFactor * (target.signature || 0.5);
    const detected = Math.random() < detectionProb;

    return {
      detected,
      confidence: detectionProb,
      type: 'sonar'
    };
  }

  // 红外检测
  checkIRDetection(detector, target, dist) {
    const irRange = (detector.vision || 500) * 0.8;
    if (dist > irRange) return { detected: false };

    // 热源特征
    let heatSignature = target.signature || 0.5;
    if (target.type === 'air') heatSignature *= 1.5;
    if (target.type === 'naval') heatSignature *= 1.2;

    // 角度因子（尾部视角更强）
    const angleFactor = 1.0;

    const detectionProb = (irRange / (dist + 1)) * heatSignature * angleFactor;
    const detected = Math.random() < Math.min(1, detectionProb);

    return {
      detected,
      confidence: detectionProb,
      type: 'ir'
    };
  }

  // 获取雷达截面积
  getRCS(entity) {
    const rcsTable = {
      fighter: 0.5,
      bomber: 1.0,
      helicopter: 0.3,
      uav: 0.1,
      tank: 0.8,
      ship: 2.0,
      submarine: 0.2 // 水面状态
    };
    return rcsTable[entity.equipmentType] || 0.5;
  }

  // 获取某单位的所有接触
  getContacts(entityId) {
    return this.contacts.get(entityId) || [];
  }

  // 检查是否被特定单位探测到
  isDetectedBy(target, detector) {
    const detectorContacts = this.contacts.get(detector.id);
    if (!detectorContacts) return false;
    return detectorContacts.some(c => c.id === target.id);
  }
}

module.exports = PerceptionSystem;
