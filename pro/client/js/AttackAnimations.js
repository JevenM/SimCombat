/**
 * AttackAnimations - 攻击动画效果管理器
 * 处理导弹轨迹、子弹飞线、爆炸效果等动态显示
 */
class AttackAnimations {
  constructor(map) {
    this.map = map;
    this.activeAnimations = new Map(); // id -> animation
    this.particleContainer = null;
    this.init();
  }

  init() {
    // 创建粒子容器层
    this.particleContainer = L.layerGroup().addTo(this.map);
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

    // 创建轨迹线
    const line = L.polyline([[from.lat, from.lng], [from.lat, from.lng]], {
      color: color,
      weight: width,
      opacity: 0.9,
      className: 'attack-line'
    }).addTo(this.particleContainer);

    // 创建弹头标记
    const headIcon = this.createProjectileIcon(type, color);
    const head = L.marker([from.lat, from.lng], {
      icon: headIcon,
      zIndexOffset: 1000
    }).addTo(this.particleContainer);

    // 动画开始时间
    const startTime = Date.now();
    const duration = speed;

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // 计算当前位置
      const currentLat = from.lat + (to.lat - from.lat) * progress;
      const currentLng = from.lng + (to.lng - from.lng) * progress;

      // 更新轨迹线终点
      line.setLatLngs([[from.lat, from.lng], [currentLat, currentLng]]);

      // 更新弹头位置
      head.setLatLng([currentLat, currentLng]);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        // 动画结束，显示爆炸效果
        this.createExplosion(to, { color, type });

        // 清除轨迹
        setTimeout(() => {
          this.particleContainer.removeLayer(line);
          this.particleContainer.removeLayer(head);
        }, 200);
      }
    };

    requestAnimationFrame(animate);
    return id;
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
   * 创建命中标记（未摧毁目标时显示）
   */
  createHitMarker(pos, isHit) {
    const color = isHit ? '#ff4444' : '#888888';
    const symbol = isHit ? '✓' : '✗';

    const marker = L.marker([pos.lat, pos.lng], {
      icon: L.divIcon({
        className: 'hit-marker',
        html: `<div style="
          color: ${color};
          font-size: 16px;
          font-weight: bold;
          text-shadow: 0 0 3px black;
          animation: fadeUp 1s ease-out forwards;
        ">${symbol}</div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10]
      }),
      zIndexOffset: 3000
    }).addTo(this.particleContainer);

    setTimeout(() => {
      this.particleContainer.removeLayer(marker);
    }, 1000);
  }

  /**
   * 处理战斗事件并创建相应动画
   */
  handleCombatEvent(event, entities) {
    const attacker = entities.find(e => e.id === event.attacker);
    const target = entities.find(e => e.id === event.target);

    if (!attacker || !target) return;

    // 获取位置
    const geoPos = this.map.options.crs === L.CRS.Simple ?
      { lat: attacker.y, lng: attacker.x } :
      this.map.simToGeo ? this.map.simToGeo(attacker.x, attacker.y) :
      { lat: attacker.y, lng: attacker.x };

    const targetPos = this.map.options.crs === L.CRS.Simple ?
      { lat: target.y, lng: target.x } :
      this.map.simToGeo ? this.map.simToGeo(target.x, target.y) :
      { lat: target.y, lng: target.x };

    // 计算距离
    const dist = Math.hypot(target.x - attacker.x, target.y - attacker.y);

    // 根据距离和类型选择动画
    let type = 'bullet';
    let speed = 200;
    let color = '#ff6b00';

    if (attacker.type === 'artillery' || dist > 1000) {
      type = 'artillery';
      speed = 800;
      color = '#ff4444';
    } else if (attacker.type === 'fighter' || attacker.type === 'plane') {
      type = 'missile';
      speed = 400;
      color = '#ff8800';
    } else if (attacker.type === 'tank') {
      type = 'missile';
      speed = 300;
      color = '#ffaa00';
    }

    // 创建攻击线动画
    this.createAttackLine(geoPos, targetPos, {
      type,
      speed,
      color
    });

    // 如果是未命中，显示未命中标记
    if (!event.hit) {
      // 在未命中位置附近随机偏移
      const offsetLat = (Math.random() - 0.5) * 0.0001;
      const offsetLng = (Math.random() - 0.5) * 0.0001;
      this.createHitMarker(
        { lat: targetPos.lat + offsetLat, lng: targetPos.lng + offsetLng },
        false
      );
    }
  }

  /**
   * 清除所有动画
   */
  clearAll() {
    this.particleContainer.clearLayers();
  }
}

// 添加CSS动画样式
const style = document.createElement('style');
style.textContent = `
  @keyframes explode {
    0% { transform: scale(0); opacity: 1; }
    50% { transform: scale(1.2); opacity: 0.8; }
    100% { transform: scale(1); opacity: 0; }
  }

  @keyframes fadeUp {
    0% { transform: translateY(0); opacity: 1; }
    100% { transform: translateY(-30px); opacity: 0; }
  }

  .attack-line {
    filter: drop-shadow(0 0 3px currentColor);
  }

  .explosion-core {
    pointer-events: none;
  }

  .hit-marker {
    pointer-events: none;
  }
`;
document.head.appendChild(style);
