/**
 * AttackAnimations - 攻击动画效果管理器
 * 处理导弹轨迹、子弹飞线、爆炸效果等动态显示
 */
class AttackAnimations {
  constructor(map2d) {
    this.map2d = map2d;
    this.map = map2d.map; // 保持兼容性
    this.activeAnimations = new Map(); // id -> animation
    this.sustainedAttacks = new Map(); // attackerId -> {line, startTime}
    this.particleContainer = null;
    this.init();
  }

  init() {
    // 创建置顶 pane 用于攻击动画（确保在最上层显示）
    if (!this.map.getPane('attackAnimations')) {
      this.map.createPane('attackAnimations');
      this.map.getPane('attackAnimations').style.zIndex = 1000; // 最高层级
    }

    // 创建粒子容器层
    this.particleContainer = L.layerGroup().addTo(this.map);

    // 将容器添加到置顶 pane
    const pane = this.map.getPane('attackAnimations');
    if (pane && this.particleContainer.getPane) {
      this.particleContainer.getPane = () => pane;
    }

    console.log('[攻击动画] 初始化完成，图层层级:', 1000);
  }

  /**
   * 创建或更新持续攻击线（在攻击持续期间显示）
   * @param {Object} from - 起始位置 {lat, lng}
   * @param {Object} to - 目标位置 {lat, lng}
   * @param {string} attackerId - 攻击者ID
   * @param {string} targetId - 目标ID
   * @param {Object} options - 配置
   */
  createOrUpdateSustainedAttack(from, to, attackerId, targetId, options = {}) {
    const {
      color = '#ff6b00',
      width = 3,
      type = 'missile'
    } = options;

    const attackKey = `${attackerId}_${targetId}`;

    // 检查是否已存在该攻击线
    if (this.sustainedAttacks.has(attackKey)) {
      // 更新现有攻击线
      const existing = this.sustainedAttacks.get(attackKey);
      existing.lastUpdate = Date.now();
      return attackKey;
    }

    // 创建新的持续攻击线
    let pathPoints;
    if (type === 'artillery') {
      // 内联抛物线路径计算
      const height = 0.002;
      const segments = 30;
      pathPoints = [];
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const lat = from.lat + (to.lat - from.lat) * t;
        const lng = from.lng + (to.lng - from.lng) * t;
        const arcHeight = Math.sin(t * Math.PI) * height;
        pathPoints.push([lat + arcHeight, lng]);
      }
    } else {
      // 即使是直线也使用多点，确保可见
      pathPoints = [];
      const segments = 10;
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const lat = from.lat + (to.lat - from.lat) * t;
        const lng = from.lng + (to.lng - from.lng) * t;
        pathPoints.push([lat, lng]);
      }
    }

    // 调试：在起点和终点添加临时标记（可选，调试用）
    // 注释掉调试标记
    /*
    const startMarker = L.circleMarker([from.lat, from.lng], {
      radius: 8,
      color: color,
      fillColor: color,
      fillOpacity: 0.8,
      weight: 2
    }).addTo(this.particleContainer);

    const endMarker = L.circleMarker([to.lat, to.lng], {
      radius: 8,
      color: color,
      fillColor: 'white',
      fillOpacity: 1,
      weight: 2
    }).addTo(this.particleContainer);

    // 2秒后移除调试标记
    setTimeout(() => {
      this.particleContainer.removeLayer(startMarker);
      this.particleContainer.removeLayer(endMarker);
    }, 3000);
    */

    // 主攻击线（虚线）- 线条变细
    const mainLine = L.polyline(pathPoints, {
      color: color,
      weight: width * 1,     // 变细
      opacity: 0.9,
      dashArray: '8, 5',     // 更细腻的虚线
      dashOffset: '0',
      lineCap: 'round',
      lineJoin: 'round',
      className: 'sustained-attack-line'
    }).addTo(this.particleContainer);

    // 发光效果线 - 变细
    const glowLine = L.polyline(pathPoints, {
      color: color,
      weight: width * 2,     // 变细
      opacity: 0.3,
      dashArray: '8, 5',
      lineCap: 'round',
      lineJoin: 'round',
      className: 'sustained-attack-glow'
    }).addTo(this.particleContainer);

    // 添加箭头标记（在线段末端，不覆盖单位图标）
    const lastPoint = pathPoints[pathPoints.length - 1];
    const secondLastPoint = pathPoints[pathPoints.length - 2] || pathPoints[pathPoints.length - 1];

    // 计算线段方向角度（从倒数第二点指向终点）
    const dx = lastPoint[1] - secondLastPoint[1];
    const dy = lastPoint[0] - secondLastPoint[0];
    const angle = Math.atan2(dx, dy) * 180 / Math.PI;

    // 箭头位置：在线段末端前方偏移，避免覆盖单位图标
    const offsetDistance = 0.00015; // 约15米的偏移
    const arrowLat = lastPoint[0] - Math.cos(Math.atan2(dx, dy)) * offsetDistance;
    const arrowLng = lastPoint[1] - Math.sin(Math.atan2(dx, dy)) * offsetDistance;

    const arrowIcon = L.divIcon({
      className: 'attack-direction-arrow',
      html: `<svg width="16" height="16" viewBox="0 0 24 24" style="transform: rotate(${angle}deg); filter: drop-shadow(0 0 4px ${color});">
        <defs>
          <linearGradient id="arrowGrad${attackerId}" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" style="stop-color:#ffffff;stop-opacity:1" />
            <stop offset="100%" style="stop-color:${color};stop-opacity:1" />
          </linearGradient>
        </defs>
        <path d="M12 3 L21 21 L12 17 L3 21 Z" fill="url(#arrowGrad${attackerId})" stroke="white" stroke-width="1.5"/>
      </svg>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });

    const arrowMarker = L.marker([arrowLat, arrowLng], {
      icon: arrowIcon,
      zIndexOffset: 500
    }).addTo(this.particleContainer);

    // 小脉冲标记（在攻击中点）- 变小
    const midIndex = Math.floor(pathPoints.length / 2);
    const midPoint = pathPoints[midIndex];
    const pulsingIcon = L.divIcon({
      className: 'attack-pulse-marker',
      html: `<div class="attack-pulse" style="background: ${color};"></div>`,
      iconSize: [12, 12],  // 变小
      iconAnchor: [6, 6]
    });

    const pulseMarker = L.marker([midPoint[0], midPoint[1]], {
      icon: pulsingIcon,
      zIndexOffset: 700
    }).addTo(this.particleContainer);

    // 确保攻击线在最顶层显示
    mainLine.bringToFront();
    if (glowLine.bringToFront) glowLine.bringToFront();

    // 调试信息
    console.log(`[攻击线] 已创建: ${attackerId} -> ${targetId}`, {
      点数: pathPoints.length,
      起点: pathPoints[0],
      终点: pathPoints[pathPoints.length - 1],
      颜色: color,
      类型: type,
      原始坐标: { from, to }
    });

    // 存储攻击线信息
    const attackInfo = {
      mainLine,
      glowLine,
      pulseMarker,
      arrowMarker,
      attackerId,
      targetId,
      startTime: Date.now(),
      lastUpdate: Date.now(),
      color,
      type
    };

    this.sustainedAttacks.set(attackKey, attackInfo);
    console.log(`[攻击线] 已存储: ${attackKey}, 当前数量: ${this.sustainedAttacks.size}`);

    // 启动虚线流动动画
    this.animateSustainedAttack(attackKey);

    return attackKey;
  }

  /**
   * 更新所有持续攻击线的位置
   * @param {Array} entities - 当前所有实体
   */
  updateAttackLinePositions(entities) {
    const entityMap = new Map(entities.map(e => [e.id, e]));

    for (const [attackKey, attack] of this.sustainedAttacks) {
      const attacker = entityMap.get(attack.attackerId);
      const target = entityMap.get(attack.targetId);

      if (!attacker || !target) continue;

      // 获取当前位置
      const from = this.map2d.simToGeo(attacker.x, attacker.y);
      const to = this.map2d.simToGeo(target.x, target.y);

      // 重新计算路径点
      let pathPoints;
      if (attack.type === 'artillery') {
        const height = 0.002;
        const segments = 30;
        pathPoints = [];
        for (let i = 0; i <= segments; i++) {
          const t = i / segments;
          const lat = from.lat + (to.lat - from.lat) * t;
          const lng = from.lng + (to.lng - from.lng) * t;
          const arcHeight = Math.sin(t * Math.PI) * height;
          pathPoints.push([lat + arcHeight, lng]);
        }
      } else {
        pathPoints = [];
        const segments = 10;
        for (let i = 0; i <= segments; i++) {
          const t = i / segments;
          const lat = from.lat + (to.lat - from.lat) * t;
          const lng = from.lng + (to.lng - from.lng) * t;
          pathPoints.push([lat, lng]);
        }
      }

      // 更新线条位置
      attack.mainLine.setLatLngs(pathPoints);
      attack.glowLine.setLatLngs(pathPoints);

      // 更新箭头位置和角度
      const lastPoint = pathPoints[pathPoints.length - 1];
      const secondLastPoint = pathPoints[pathPoints.length - 2] || pathPoints[pathPoints.length - 1];
      const dx = lastPoint[1] - secondLastPoint[1];
      const dy = lastPoint[0] - secondLastPoint[0];
      const angle = Math.atan2(dx, dy) * 180 / Math.PI;

      const offsetDistance = 0.00015;
      const arrowLat = lastPoint[0] - Math.cos(Math.atan2(dx, dy)) * offsetDistance;
      const arrowLng = lastPoint[1] - Math.sin(Math.atan2(dx, dy)) * offsetDistance;

      attack.arrowMarker.setLatLng([arrowLat, arrowLng]);

      // 更新箭头旋转角度
      const arrowEl = attack.arrowMarker.getElement();
      if (arrowEl) {
        const svg = arrowEl.querySelector('svg');
        if (svg) {
          svg.style.transform = `rotate(${angle}deg)`;
        }
      }

      // 更新中点脉冲位置
      const midIndex = Math.floor(pathPoints.length / 2);
      const midPoint = pathPoints[midIndex];
      attack.pulseMarker.setLatLng([midPoint[0], midPoint[1]]);
    }
  }

  /**
   * 动画化持续攻击线（虚线流动效果）
   */
  animateSustainedAttack(attackKey) {
    const attack = this.sustainedAttacks.get(attackKey);
    if (!attack) return;

    let offset = 0;
    const animate = () => {
      if (!this.sustainedAttacks.has(attackKey)) return;

      offset -= 2;
      attack.mainLine.setStyle({ dashOffset: offset });
      attack.glowLine.setStyle({ dashOffset: offset });

      requestAnimationFrame(animate);
    };

    animate();
  }

  /**
   * 结束持续攻击显示
   */
  endSustainedAttack(attackerId, targetId) {
    const attackKey = `${attackerId}_${targetId}`;
    const attack = this.sustainedAttacks.get(attackKey);

    if (attack) {
      // 移除层
      this.particleContainer.removeLayer(attack.mainLine);
      this.particleContainer.removeLayer(attack.glowLine);
      this.particleContainer.removeLayer(attack.pulseMarker);
      if (attack.arrowMarker) this.particleContainer.removeLayer(attack.arrowMarker);

      // 从地图中删除
      this.sustainedAttacks.delete(attackKey);
      console.log(`[攻击线] 已结束: ${attackKey}, 剩余数量: ${this.sustainedAttacks.size}`);

      // 显示命中效果
      const endPoint = attack.mainLine.getLatLngs();
      const lastPoint = endPoint[endPoint.length - 1];
      const effectColor = attack.color || '#ff0000';

      const marker = L.marker([lastPoint.lat, lastPoint.lng], {
        icon: L.divIcon({
          className: 'hit-effect',
          html: `<div style="
            font-size: 20px;
            animation: hitPulse 0.5s ease-out forwards;
            filter: drop-shadow(0 0 5px ${effectColor});
          ">💥</div>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12]
        }),
        zIndexOffset: 2000
      }).addTo(this.particleContainer);

      setTimeout(() => {
        this.particleContainer.removeLayer(marker);
      }, 600);
    }
  }

  /**
   * 清理过期的持续攻击（如果没有更新超过一定时间）
   */
  cleanupStaleAttacks(maxAge = 3000) {
    const now = Date.now();
    for (const [key, attack] of this.sustainedAttacks) {
      if (now - attack.lastUpdate > maxAge) {
        this.particleContainer.removeLayer(attack.mainLine);
        this.particleContainer.removeLayer(attack.glowLine);
        this.particleContainer.removeLayer(attack.pulseMarker);
        if (attack.arrowMarker) this.particleContainer.removeLayer(attack.arrowMarker);
        this.sustainedAttacks.delete(key);
        console.log(`[攻击线] 自动清理过期: ${key}`);
      }
    }
  }

  /**
   * 清除所有持续攻击显示
   */
  clearAllSustainedAttacks() {
    for (const [key, attack] of this.sustainedAttacks) {
      this.particleContainer.removeLayer(attack.mainLine);
      this.particleContainer.removeLayer(attack.glowLine);
      this.particleContainer.removeLayer(attack.pulseMarker);
      if (attack.arrowMarker) this.particleContainer.removeLayer(attack.arrowMarker);
    }
    this.sustainedAttacks.clear();
    console.log('[攻击线] 全部清除');
  }

  /**
   * 创建抛物线轨迹点
   * @param {Object} from - 起始点 {lat, lng}
   * @param {Object} to - 终点 {lat, lng}
   * @param {number} height - 抛物线高度系数
   * @param {number} segments - 分段数
   */
  createParabolicPath(from, to, height = 0.3, segments = 20) {
    const points = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      // 线性插值
      const lat = from.lat + (to.lat - from.lat) * t;
      const lng = from.lng + (to.lng - from.lng) * t;
      // 添加抛物线高度 (sin曲线模拟)
      const arcHeight = Math.sin(t * Math.PI) * height;
      // 将高度偏移应用到纬度上
      const latWithArc = lat + arcHeight;
      points.push([latWithArc, lng]);
    }
    return points;
  }

  /**
   * 创建动态攻击线（导弹/炮弹轨迹）
   * @param {Object} from - 起始位置 {lat, lng}
   * @param {Object} to - 目标位置 {lat, lng}
   * @param {Object} options - 配置
   */
  createAttackLine(from, to, options = {}) {
    const id = 'attack_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    const {
      color = '#ff6b00',
      speed = 500, // 动画持续时间(ms)
      width = 3,
      type = 'missile' // missile, bullet, laser, artillery
    } = options;

    // 根据类型选择轨迹样式
    let useParabola = false;
    let parabolaHeight = 0;
    let trailLength = 3; // 轨迹线段数量

    switch(type) {
      case 'artillery':
        useParabola = true;
        parabolaHeight = 0.002; // 抛物线高度
        trailLength = 8;
        break;
      case 'missile':
        useParabola = true;
        parabolaHeight = 0.0005;
        trailLength = 5;
        break;
      case 'bullet':
        useParabola = false;
        trailLength = 2;
        break;
    }

    // 创建轨迹点
    const pathPoints = useParabola
      ? this.createParabolicPath(from, to, parabolaHeight, 30)
      : [[from.lat, from.lng], [to.lat, to.lng]];

    // 创建轨迹线（显示完整路径）- 增强虚线效果
    const fullPath = L.polyline(pathPoints, {
      color: color,
      weight: width * 0.8,
      opacity: 0.7,
      dashArray: '10, 6',
      dashOffset: '0',
      lineCap: 'round',
      lineJoin: 'round',
      className: 'attack-trajectory'
    }).addTo(this.particleContainer);

    // 添加发光效果的轨迹线
    const glowPath = L.polyline(pathPoints, {
      color: color,
      weight: width * 2.5,
      opacity: 0.25,
      dashArray: '12, 4',
      lineCap: 'round',
      lineJoin: 'round',
      className: 'attack-trajectory-glow'
    }).addTo(this.particleContainer);

    // 创建方向箭头标记（在轨迹终点显示）
    const arrowDecorator = L.polylineDecorator ? L.polylineDecorator(pathPoints, {
      patterns: [
        {
          offset: '100%',
          repeat: 0,
          symbol: L.Symbol.arrowHead({
            pixelSize: 15,
            polygon: false,
            pathOptions: {
              color: color,
              weight: width,
              opacity: 0.9,
              lineCap: 'round'
            }
          })
        }
      ]
    }).addTo(this.particleContainer) : null;

    // 创建箭头标记
    const arrowIcon = L.divIcon({
      className: 'attack-arrow',
      html: this.createArrowSVG(type, color, width),
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });

    const arrow = L.marker([from.lat, from.lng], {
      icon: arrowIcon,
      zIndexOffset: 1000
    }).addTo(this.particleContainer);

    // 动画开始时间
    const startTime = Date.now();
    const duration = speed;
    let currentIndex = 0;

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // 计算当前在路径上的位置
      const pathIndex = Math.floor(progress * (pathPoints.length - 1));
      const segmentProgress = (progress * (pathPoints.length - 1)) % 1;

      if (pathIndex < pathPoints.length - 1) {
        const p1 = pathPoints[pathIndex];
        const p2 = pathPoints[pathIndex + 1];

        // 在当前线段上插值
        const currentLat = p1[0] + (p2[0] - p1[0]) * segmentProgress;
        const currentLng = p1[1] + (p2[1] - p1[1]) * segmentProgress;

        // 计算角度用于旋转箭头
        const angle = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]) * 180 / Math.PI;

        arrow.setLatLng([currentLat, currentLng]);

        // 旋转箭头元素
        const arrowEl = arrow.getElement()?.querySelector('.attack-arrow-svg');
        if (arrowEl) {
          arrowEl.style.transform = `rotate(${angle + 90}deg)`;
        }
      }

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        // 动画结束，显示爆炸效果
        this.createExplosion(to, { color, type });

        // 清理
        setTimeout(() => {
          this.particleContainer.removeLayer(fullPath);
          this.particleContainer.removeLayer(glowPath);
          this.particleContainer.removeLayer(arrow);
          if (arrowDecorator) {
            this.particleContainer.removeLayer(arrowDecorator);
          }
        }, 500);
      }
    };

    requestAnimationFrame(animate);
    return id;
  }

  /**
   * 创建箭头SVG
   */
  createArrowSVG(type, color, width) {
    const arrows = {
      missile: `
        <svg class="attack-arrow-svg" width="24" height="24" viewBox="0 0 24 24" style="transition: transform 0.1s;">
          <defs>
            <linearGradient id="arrowGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" style="stop-color:#ffff00;stop-opacity:1" />
              <stop offset="100%" style="stop-color:${color};stop-opacity:1" />
            </linearGradient>
          </defs>
          <polygon points="12,2 20,20 12,16 4,20" fill="url(#arrowGradient)" stroke="${color}" stroke-width="1"/>
          <polygon points="12,4 18,18 12,15 6,18" fill="${color}"/>
        </svg>`,
      bullet: `
        <svg class="attack-arrow-svg" width="16" height="16" viewBox="0 0 16 16" style="transition: transform 0.1s;">
          <circle cx="8" cy="8" r="5" fill="${color}" stroke="#ffff00" stroke-width="1"/>
          <circle cx="8" cy="8" r="2" fill="#ffff00"/>
        </svg>`,
      laser: `
        <svg class="attack-arrow-svg" width="20" height="20" viewBox="0 0 20 20" style="transition: transform 0.1s;">
          <line x1="10" y1="0" x2="10" y2="20" stroke="${color}" stroke-width="3" stroke-linecap="round"/>
          <circle cx="10" cy="10" r="4" fill="#ffff00"/>
        </svg>`,
      artillery: `
        <svg class="attack-arrow-svg" width="20" height="20" viewBox="0 0 20 20" style="transition: transform 0.1s;">
          <circle cx="10" cy="10" r="8" fill="#ff4444" stroke="#ffff00" stroke-width="2"/>
          <circle cx="10" cy="10" r="4" fill="#ffff00"/>
        </svg>`
    };
    return arrows[type] || arrows.missile;
  }

  /**
   * 创建抛射物图标（导弹、子弹等）
   */
  createProjectileIcon(type, color) {
    const icons = {
      missile: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
        <defs>
          <radialGradient id="glow" cx="50%" cy="50%">
            <stop offset="0%" stop-color="${color}" stop-opacity="1"/>
            <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <circle cx="8" cy="8" r="6" fill="url(#glow)"/>
        <circle cx="8" cy="8" r="3" fill="${color}"/>
      </svg>`,
      bullet: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12">
        <circle cx="6" cy="6" r="4" fill="${color}"/>
      </svg>`,
      laser: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
        <circle cx="10" cy="10" r="8" fill="${color}" fill-opacity="0.5"/>
        <circle cx="10" cy="10" r="4" fill="${color}"/>
      </svg>`,
      artillery: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14">
        <circle cx="7" cy="7" r="5" fill="#ff4444"/>
        <circle cx="7" cy="7" r="3" fill="#ffff00"/>
      </svg>`
    };

    const svg = icons[type] || icons.missile;
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

    return L.icon({
      iconUrl: url,
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });
  }

  /**
   * 创建爆炸效果
   * @param {Object} pos - 位置 {lat, lng}
   * @param {Object} options - 配置
   */
  createExplosion(pos, options = {}) {
    const {
      color = '#ff6b00',
      type = 'missile',
      size = 30
    } = options;

    // 爆炸波纹
    const ripples = [];
    const rippleCount = type === 'artillery' ? 3 : 2;

    for (let i = 0; i < rippleCount; i++) {
      const ripple = L.circle([pos.lat, pos.lng], {
        radius: 10,
        color: color,
        fillColor: color,
        fillOpacity: 0.3 - i * 0.1,
        weight: 2 - i * 0.5
      }).addTo(this.particleContainer);

      ripples.push({
        circle: ripple,
        delay: i * 100,
        maxRadius: size * (1 + i * 0.5)
      });
    }

    // 爆炸核心光点
    const core = L.marker([pos.lat, pos.lng], {
      icon: L.divIcon({
        className: 'explosion-core',
        html: `<div style="
          width: ${size}px;
          height: ${size}px;
          background: radial-gradient(circle, ${color} 0%, transparent 70%);
          border-radius: 50%;
          animation: explode 0.5s ease-out forwards;
        "></div>`,
        iconSize: [size, size],
        iconAnchor: [size/2, size/2]
      }),
      zIndexOffset: 2000
    }).addTo(this.particleContainer);

    // 波纹扩散动画
    ripples.forEach(ripple => {
      setTimeout(() => {
        const startTime = Date.now();
        const duration = 600;

        const animateRipple = () => {
          const elapsed = Date.now() - startTime;
          const progress = elapsed / duration;

          if (progress >= 1) {
            this.particleContainer.removeLayer(ripple.circle);
            return;
          }

          const currentRadius = ripple.maxRadius * progress;
          const opacity = (1 - progress) * 0.5;

          ripple.circle.setRadius(currentRadius);
          ripple.circle.setStyle({
            fillOpacity: opacity,
            opacity: opacity
          });

          requestAnimationFrame(animateRipple);
        };

        animateRipple();
      }, ripple.delay);
    });

    // 清理核心
    setTimeout(() => {
      this.particleContainer.removeLayer(core);
    }, 500);
  }

  /**
   * 创建命中效果（在结束时调用）
   */
  createHitEffect(pos, isHit, color) {
    const effectColor = isHit ? (color || '#ff0000') : '#888888';
    const symbol = isHit ? '💥' : '❌';

    const marker = L.marker([pos.lat, pos.lng], {
      icon: L.divIcon({
        className: 'hit-effect',
        html: `<div style="
          font-size: 20px;
          animation: hitPulse 0.5s ease-out forwards;
          filter: drop-shadow(0 0 5px ${effectColor});
        ">${symbol}</div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      }),
      zIndexOffset: 2000
    }).addTo(this.particleContainer);

    setTimeout(() => {
      this.particleContainer.removeLayer(marker);
    }, 600);
  }

  /**
   * 创建命中标记（未摧毁目标时显示）
   */
  createHitMarker(pos, isHit, text = '') {
    const color = isHit ? '#ff4444' : '#888888';
    const symbol = isHit ? '💥' : '❌';
    const label = text || symbol;

    const marker = L.marker([pos.lat, pos.lng], {
      icon: L.divIcon({
        className: 'hit-marker',
        html: `<div style="
          color: ${color};
          font-size: 16px;
          font-weight: bold;
          text-shadow: 0 0 3px black;
          animation: fadeUp 1s ease-out forwards;
          white-space: nowrap;
        ">${label}</div>`,
        iconSize: [40, 20],
        iconAnchor: [20, 10]
      }),
      zIndexOffset: 3000
    }).addTo(this.particleContainer);

    setTimeout(() => {
      this.particleContainer.removeLayer(marker);
    }, 1000);
  }

  /**
   * 创建单位被摧毁效果（显示红叉和爆炸烟雾）
   * @param {Object} pos - 位置 {lat, lng}
   * @param {string} side - 阵营
   */
  createDestructionEffect(pos, side = 'red', effectType = 'kill') {
    // 验证位置是否有效
    if (!pos || !pos.lat || !pos.lng) {
      console.warn('[摧毁效果] 无效的位置', pos);
      return;
    }

    const color = side === 'red' ? '#ff4444' : '#4488ff';

    if (effectType === 'kill') {
      // 击杀效果 - 大型连环爆炸
      this.createExplosion(pos, {
        color: '#ff0000',
        type: 'artillery',
        size: 60
      });

      // 延迟创建次级爆炸
      setTimeout(() => {
        this.createSmallExplosion(pos);
      }, 150);

      setTimeout(() => {
        const ripple = L.circle([pos.lat, pos.lng], {
          radius: 40,
          color: '#ff6600',
          fillColor: '#ff0000',
          fillOpacity: 0.5,
          weight: 3
        }).addTo(this.particleContainer);

        let opacity = 0.5;
        const fadeOut = setInterval(() => {
          opacity -= 0.05;
          if (opacity <= 0) {
            clearInterval(fadeOut);
            this.particleContainer.removeLayer(ripple);
          } else {
            ripple.setStyle({ fillOpacity: opacity, opacity });
          }
        }, 100);
      }, 300);
    }
  }

  /**
   * 创建小型爆炸效果
   */
  createSmallExplosion(pos) {
    const ripple = L.circle([pos.lat, pos.lng], {
      radius: 20,
      color: '#ff6600',
      fillColor: '#ff6600',
      fillOpacity: 0.4,
      weight: 2
    }).addTo(this.particleContainer);

    const startTime = Date.now();
    const duration = 400;

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      if (progress >= 1) {
        this.particleContainer.removeLayer(ripple);
        return;
      }

      const currentRadius = 20 + progress * 30;
      const opacity = (1 - progress) * 0.4;

      ripple.setRadius(currentRadius);
      ripple.setStyle({
        fillOpacity: opacity,
        opacity: opacity
      });

      requestAnimationFrame(animate);
    };

    animate();
  }

  /**
   * 处理战斗事件并创建相应动画
   * 支持两种事件格式：
   * - 普通攻击: {attacker, target, attackerSide, hit, damage}
   * - 击杀事件: {killer, victim, killerSide, type: 'kill'}
   */
  handleCombatEvent(event, entities) {
    // 调试输出
    console.log('处理战斗事件:', event);
    console.log('可用实体数量:', entities?.length || 0);

    if (!entities || entities.length === 0) {
      console.warn('实体数组为空，无法显示攻击动画');
      return;
    }

    // 统一不同事件格式的字段名
    // 普通攻击: attacker/target | 击杀事件: killer/victim
    const attackerId = event.attacker || event.killer;
    const targetId = event.target || event.victim;
    const attackerSide = event.attackerSide || event.killerSide;

    if (!attackerId || !targetId) {
      console.warn('战斗事件缺少攻击者或目标ID:', event);
      return;
    }

    // 查找实体
    const attacker = entities.find(e => e.id === attackerId);
    const target = entities.find(e => e.id === targetId);

    if (!attacker || !target) {
      console.warn(`找不到实体: 攻击者=${attackerId}, 目标=${targetId}`);
      console.log('可用实体ID列表:', entities.map(e => e.id));
      return;
    }

    // 获取位置 - 实体可能有 x/y 或 X/Y 属性
    const attackerX = attacker.x !== undefined ? attacker.x : attacker.X;
    const attackerY = attacker.y !== undefined ? attacker.y : attacker.Y;
    const targetX = target.x !== undefined ? target.x : target.X;
    const targetY = target.y !== undefined ? target.y : target.Y;

    if (attackerX === undefined || attackerY === undefined) {
      console.warn('攻击者缺少位置信息:', attacker);
      return;
    }

    // 坐标转换 - 使用 map2d 的 simToGeo 方法
    const geoPos = this.map2d.simToGeo(attackerX, attackerY);
    const targetPos = this.map2d.simToGeo(targetX, targetY);

    // 计算距离
    const dist = Math.hypot(targetX - attackerX, targetY - attackerY);

    // 根据阵营选择颜色：红方红色，蓝方蓝色
    const sideColors = {
      red: '#ff4444',    // 红方 - 红色轨迹
      blue: '#4488ff'    // 蓝方 - 蓝色轨迹
    };
    const color = sideColors[attackerSide] || sideColors[attacker.side] || '#ff6b00';

    // 根据距离和类型选择动画
    let type = 'bullet';
    let speed = 200;

    // 判断攻击类型
    const equipmentType = attacker.equipmentType || attacker.type;
    if (equipmentType === 'artillery' || dist > 2000) {
      type = 'artillery';
      speed = 800;
    } else if (['fighter', 'bomber', 'helicopter'].includes(equipmentType)) {
      type = 'missile';
      speed = 400;
    } else if (equipmentType === 'tank') {
      type = 'missile';
      speed = 300;
    } else if (equipmentType === 'infantry') {
      type = 'bullet';
      speed = 150;
    }

    console.log(`创建攻击动画: ${attackerId} -> ${targetId}, 类型=${type}, 颜色=${color}, 距离=${Math.round(dist)}m`);

    // 检测是否为反击（目标在当前帧也攻击了攻击者）
    const isCounterAttack = entities.some(e => {
      // 检查目标是否在当前帧攻击了攻击者
      return e.id === targetId && e.lastAttackTarget === attackerId;
    });

    // 如果是反击，使用特殊颜色
    const attackColor = isCounterAttack ? '#ffa500' : color; // 橙色表示反击

    // 创建持续攻击线（在攻击期间保持显示）
    this.createOrUpdateSustainedAttack(geoPos, targetPos, attackerId, targetId, {
      type,
      color: attackColor,
      width: type === 'artillery' ? 4 : 3
    });

    // 如果是击杀事件，结束持续攻击显示并播放摧毁效果
    const isKill = event.type === 'kill';
    if (isKill) {
      setTimeout(() => {
        this.endSustainedAttack(attackerId, targetId);
      }, 500);
    }

    // 命中/未命中效果
    // 普通攻击有 hit 字段，击杀事件有 type='kill'
    const isHit = event.hit || isKill;

    if (isHit) {
      // 根据伤害程度选择不同效果
      const damage = event.damage || 0;
      const maxHp = target.maxHp || 100;
      const damagePercent = damage / maxHp;

      // 延迟执行效果
      setTimeout(() => {
        // 重新获取目标的当前位置（确保爆炸效果显示在正确位置）
        const currentTarget = entities.find(e => e.id === targetId);
        let explosionPos;

        if (currentTarget && currentTarget.hp > 0) {
          // 目标仍然存在，使用当前位置
          explosionPos = this.map2d.simToGeo(currentTarget.x, currentTarget.y);
        } else if (currentTarget) {
          // 目标已阵亡但仍在数组中，使用最后已知位置
          explosionPos = this.map2d.simToGeo(currentTarget.x, currentTarget.y);
        } else {
          // 目标已移除，使用攻击时的位置
          explosionPos = targetPos;
        }

        // 验证位置有效性
        if (!explosionPos || typeof explosionPos.lat !== 'number' || typeof explosionPos.lng !== 'number') {
          console.warn(`[攻击动画] 无效的爆炸位置:`, explosionPos);
          return;
        }

        if (isKill) {
          // 击杀效果 - 大爆炸
          this.createHitMarker(explosionPos, true, '💥 击杀!');
          this.createDestructionEffect(explosionPos, attackerSide, 'kill');
        } else if (isCounterAttack) {
          // 反击效果 - 特殊标记
          this.createHitMarker(explosionPos, true, `⚔️ 反击! -${Math.round(damage)}`);
          this.createExplosion(explosionPos, { color: '#ffa500', type, size: 30 });
        } else if (damagePercent > 0.3) {
          // 重度伤害 (>30%)
          this.createHitMarker(explosionPos, true, `💥 -${Math.round(damage)}`);
          this.createExplosion(explosionPos, { color, type, size: 40 });
        } else if (damagePercent > 0.1) {
          // 中度伤害 (10-30%)
          this.createHitMarker(explosionPos, true, `💢 -${Math.round(damage)}`);
          this.createExplosion(explosionPos, { color, type, size: 25 });
        } else {
          // 轻度伤害 (<10%)
          this.createHitMarker(explosionPos, true, `⚡ -${Math.round(damage)}`);
          this.createSmallExplosion(explosionPos);
        }
      }, 300);

      // 如果是击杀事件，结束攻击线
      if (isKill) {
        setTimeout(() => {
          this.endSustainedAttack(attackerId, targetId);
        }, 500);
      }
    } else {
      // 未命中 - 显示❌标记
      setTimeout(() => {
        // 未命中时，在攻击发生时的位置显示（因为未命中时目标可能已经移动）
        this.createHitMarker(targetPos, false, '❌ 未命中');
      }, 300);
    }
  }

  /**
   * 清除所有动画
   */
  clearAll() {
    this.particleContainer.clearLayers();
    this.sustainedAttacks.clear();
  }
}

// 添加CSS动画样式
const style = document.createElement('style');
style.textContent = `
  @keyframes explode {
    0% { transform: scale(0); opacity: 1; }
    50% { transform: scale(1.5); opacity: 0.8; }
    100% { transform: scale(1); opacity: 0; }
  }

  @keyframes fadeUp {
    0% { transform: translateY(0); opacity: 1; }
    100% { transform: translateY(-30px); opacity: 0; }
  }

  @keyframes arrowPulse {
    0% { filter: drop-shadow(0 0 2px currentColor); }
    50% { filter: drop-shadow(0 0 12px currentColor); }
    100% { filter: drop-shadow(0 0 2px currentColor); }
  }

  @keyframes destructionPulse {
    0% { transform: translate(-50%, -50%) scale(0) rotate(0deg); opacity: 1; }
    30% { transform: translate(-50%, -50%) scale(1.3) rotate(10deg); opacity: 1; }
    50% { transform: translate(-50%, -50%) scale(1.1) rotate(-5deg); opacity: 1; }
    70% { transform: translate(-50%, -50%) scale(1.2) rotate(5deg); opacity: 0.8; }
    100% { transform: translate(-50%, -50%) scale(1) rotate(0deg); opacity: 0.6; }
  }

  @keyframes hitPulse {
    0% { transform: scale(0); opacity: 1; }
    50% { transform: scale(1.5); opacity: 0.8; }
    100% { transform: scale(1); opacity: 0; }
  }

  .attack-trajectory {
    filter: drop-shadow(0 0 4px currentColor);
    animation: trajectoryFlow 1s linear infinite;
  }

  .attack-trajectory-glow {
    filter: blur(2px);
  }

  @keyframes trajectoryFlow {
    0% { stroke-dashoffset: 16; }
    100% { stroke-dashoffset: 0; }
  }

  .attack-arrow {
    animation: arrowPulse 0.3s ease-in-out infinite;
  }

  /* 持续攻击线样式 - 流星效果 */
  .sustained-attack-line {
    filter: drop-shadow(0 0 10px currentColor) drop-shadow(0 0 20px currentColor);
    animation: meteorFlow 0.5s linear infinite;
    opacity: 0.7;
  }

  .sustained-attack-glow {
    filter: blur(8px);
    animation: meteorGlow 1s ease-in-out infinite;
    opacity: 0.5;
  }

  @keyframes meteorFlow {
    0% { stroke-dashoffset: 0; opacity: 0.5; }
    50% { opacity: 0.8; }
    100% { stroke-dashoffset: -26; opacity: 0.5; }
  }

  @keyframes meteorGlow {
    0%, 100% { opacity: 0.3; filter: blur(6px); }
    50% { opacity: 0.6; filter: blur(10px); }
  }

  /* 攻击脉冲标记 */
  .attack-pulse-marker {
    pointer-events: none;
    z-index: 1000 !important;
  }

  /* 攻击脉冲标记 - 流星效果 */
  .attack-pulse {
    width: 8px;        /* 变小 */
    height: 8px;       /* 变小 */
    border-radius: 50%;
    animation: meteorPulse 0.6s ease-in-out infinite;
    box-shadow: 0 0 15px currentColor, 0 0 30px currentColor;
    border: 1px solid rgba(255,255,255,0.8);
    opacity: 0.8;
  }

  /* 方向箭头 */
  .attack-direction-arrow {
    pointer-events: none;
    z-index: 1000 !important;
    filter: drop-shadow(0 0 5px currentColor);
  }

  @keyframes meteorPulse {
    0% { transform: scale(0.4); opacity: 0.4; }
    50% { transform: scale(1.2); opacity: 1; box-shadow: 0 0 20px currentColor, 0 0 40px currentColor; }
    100% { transform: scale(0.4); opacity: 0.4; }
  }

  .explosion-core {
    pointer-events: none;
  }

  .hit-marker {
    pointer-events: none;
    z-index: 3000 !important;
  }

  .destruction-marker {
    pointer-events: none;
    z-index: 4000 !important;
  }

  /* 命中效果 */
  .hit-effect {
    pointer-events: none;
    z-index: 3500 !important;
  }
`;
document.head.appendChild(style);
