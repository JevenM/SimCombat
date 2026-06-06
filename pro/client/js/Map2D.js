/**
 * Map2D - Leaflet 2D地图视图
 */
class Map2D {
  constructor(containerId) {
    this.containerId = containerId;
    this.map = null;
    this.entityLayers = new Map();
    this.rangeCircles = new Map();
    this.visionCircles = new Map();  // 视野/雷达范围
    this.radarCircles = new Map();   // 雷达探测范围
    this.attackLines = new Map();    // 攻击线动画
    this.pathLayers = new Map();     // 单位路径
    this.terrainOverlay = null;
    this.selectedId = null;

    this.icons = this.createIcons();
    this.init();
  }

  init() {
    // 创建地图 - 使用标准地理坐标系
    this.map = L.map(this.containerId, {
      center: [39.9, 116.4], // 北京附近
      zoom: 9,
      minZoom: 5,
      maxZoom: 18,
      attributionControl: true,
      zoomControl: false
    });

    // 添加底图图层组
    this.baseLayers = {};

    // 标准地图 (高德)
    this.baseLayers.standard = L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', {
      subdomains: '1234',
      attribution: '高德地图',
      maxZoom: 18
    });

    // 卫星影像 (高德)
    this.baseLayers.satellite = L.tileLayer('https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}', {
      subdomains: '1234',
      attribution: '高德地图 - 卫星',
      maxZoom: 18
    });

    // 地形图 (OpenTopoMap)
    this.baseLayers.terrain = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      attribution: 'OpenTopoMap',
      maxZoom: 17
    });

    // 默认使用标准地图
    this.baseLayer = this.baseLayers.standard;
    this.baseLayer.addTo(this.map);

    // 演习区域管理
    this.exerciseArea = null; // 当前演习区域
    this.exerciseBounds = null; // 演习区域边界
    this.coordTransform = null; // 坐标转换参数

    // 点击事件
    this.map.on('click', (e) => {
      // 停止事件传播以防止与其他图层冲突
      if (this.onMapClick) {
        this.onMapClick(e);
      }
    });

    // 添加缩放控件到右下角
    L.control.zoom({ position: 'bottomright' }).addTo(this.map);

    // 添加比例尺
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(this.map);

    // 演习区域和网格默认不显示，等待用户设置
    this.exerciseArea = null;
    this.exerciseAreaLabel = null;  // 保存标签引用
    this.exerciseBounds = null;
    this.coordTransform = null;
    this.gridLayer = null;
  }

  // 清除演习区域（用于演习模式初始状态）
  clearExerciseArea() {
    if (this.exerciseArea) {
      this.map.removeLayer(this.exerciseArea);
      this.exerciseArea = null;
    }
    if (this.exerciseAreaLabel) {
      this.map.removeLayer(this.exerciseAreaLabel);
      this.exerciseAreaLabel = null;
    }
    if (this.gridLayer) {
      this.map.removeLayer(this.gridLayer);
      this.gridLayer = null;
    }
    this.exerciseBounds = null;
    this.coordTransform = null;
  }

  // 设置演习区域
  setExerciseArea(bounds) {
    // 清除旧的演习区域
    if (this.exerciseArea) {
      this.map.removeLayer(this.exerciseArea);
    }
    if (this.exerciseAreaLabel) {
      this.map.removeLayer(this.exerciseAreaLabel);
    }
    if (this.gridLayer) {
      this.map.removeLayer(this.gridLayer);
    }

    this.exerciseBounds = bounds;

    // 绘制演习区域
    this.exerciseArea = L.rectangle(bounds, {
      color: '#e94560',
      weight: 3,
      fillColor: '#e94560',
      fillOpacity: 0.05,
      dashArray: '10, 5'
    }).addTo(this.map);

    // 添加标签（保存引用以便后续移除）
    const center = [
      (bounds[0][0] + bounds[1][0]) / 2,
      (bounds[0][1] + bounds[1][1]) / 2
    ];

    this.exerciseAreaLabel = L.marker(center, {
      icon: L.divIcon({
        className: 'exercise-area-label',
        html: '<div style="background:rgba(233,69,96,0.8);color:#fff;padding:4px 8px;border-radius:4px;font-size:12px;font-weight:bold;">演习区域</div>',
        iconSize: [80, 20]
      })
    }).addTo(this.map);

    // 计算坐标转换参数
    // 将地理坐标映射到仿真坐标 0-10000
    const latRange = bounds[1][0] - bounds[0][0];
    const lngRange = bounds[1][1] - bounds[0][1];

    this.coordTransform = {
      latMin: bounds[0][0],
      lngMin: bounds[0][1],
      latRange: latRange,
      lngRange: lngRange,
      // 仿真坐标范围
      simMin: 0,
      simMax: 10000
    };

    // 添加网格
    this.addExerciseGrid(bounds);
  }

  // 添加演习区域内的网格
  addExerciseGrid(bounds) {
    // 清除旧网格
    if (this.gridLayer) {
      this.map.removeLayer(this.gridLayer);
    }

    this.gridLayer = L.layerGroup().addTo(this.map);

    const latMin = bounds[0][0];
    const latMax = bounds[1][0];
    const lngMin = bounds[0][1];
    const lngMax = bounds[1][1];

    // 添加10x10网格
    for (let i = 1; i < 10; i++) {
      const lat = latMin + (latMax - latMin) * i / 10;
      const lng = lngMin + (lngMax - lngMin) * i / 10;

      // 水平线
      L.polyline([[lat, lngMin], [lat, lngMax]], {
        color: '#e94560',
        weight: 1,
        opacity: 0.3,
        dashArray: '5, 5'
      }).addTo(this.gridLayer);

      // 垂直线
      L.polyline([[latMin, lng], [latMax, lng]], {
        color: '#e94560',
        weight: 1,
        opacity: 0.3,
        dashArray: '5, 5'
      }).addTo(this.gridLayer);
    }
  }

  // 地理坐标 -> 仿真坐标
  geoToSim(lat, lng) {
    if (!this.coordTransform) return { x: 5000, y: 5000 };

    const x = Math.round((lng - this.coordTransform.lngMin) / this.coordTransform.lngRange * 10000);
    const y = Math.round((lat - this.coordTransform.latMin) / this.coordTransform.latRange * 10000);

    return {
      x: Math.max(0, Math.min(10000, x)),
      y: Math.max(0, Math.min(10000, y))
    };
  }

  // 仿真坐标 -> 地理坐标
  simToGeo(x, y) {
    if (!this.coordTransform) return { lat: 39.9, lng: 116.4 };

    const lng = this.coordTransform.lngMin + (x / 10000) * this.coordTransform.lngRange;
    const lat = this.coordTransform.latMin + (y / 10000) * this.coordTransform.latRange;

    return { lat, lng };
  }

  createIcons() {
    const createIcon = (type, side) => {
      const colors = {
        red: '#e74c3c',
        blue: '#3498db'
      };
      const c = colors[side] || '#666';

      // NATO军事符号 - 更专业的军事图标
      const shapes = {
        tank: `
          <svg width="32" height="32" viewBox="0 0 32 32">
            <rect x="6" y="14" width="20" height="10" rx="2" fill="${c}" stroke="white" stroke-width="2"/>
            <rect x="10" y="10" width="12" height="6" rx="1" fill="${c}" stroke="white" stroke-width="1.5"/>
            <line x1="22" y1="13" x2="28" y2="13" stroke="white" stroke-width="2"/>
            <circle cx="9" cy="19" r="2.5" fill="#333"/>
            <circle cx="23" cy="19" r="2.5" fill="#333"/>
          </svg>`,
        infantry: `
          <svg width="32" height="32" viewBox="0 0 32 32">
            <circle cx="16" cy="8" r="5" fill="${c}" stroke="white" stroke-width="2"/>
            <line x1="16" y1="13" x2="16" y2="22" stroke="${c}" stroke-width="3" stroke-linecap="round"/>
            <line x1="8" y1="16" x2="24" y2="16" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/>
            <line x1="16" y1="22" x2="10" y2="28" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/>
            <line x1="16" y1="22" x2="22" y2="28" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/>
          </svg>`,
        fighter: `
          <svg width="32" height="32" viewBox="0 0 32 32">
            <path d="M16 4 L20 14 L28 16 L20 18 L18 28 L16 24 L14 28 L12 18 L4 16 L12 14 Z" fill="${c}" stroke="white" stroke-width="1.5"/>
          </svg>`,
        bomber: `
          <svg width="32" height="32" viewBox="0 0 32 32">
            <ellipse cx="16" cy="16" rx="12" ry="6" fill="${c}" stroke="white" stroke-width="2"/>
            <rect x="12" y="8" width="8" height="6" fill="${c}" stroke="white" stroke-width="1.5"/>
          </svg>`,
        helicopter: `
          <svg width="32" height="32" viewBox="0 0 32 32">
            <ellipse cx="16" cy="20" rx="10" ry="5" fill="${c}" stroke="white" stroke-width="2"/>
            <line x1="6" y1="14" x2="26" y2="14" stroke="white" stroke-width="2"/>
            <line x1="16" y1="10" x2="16" y2="14" stroke="white" stroke-width="2"/>
            <line x1="14" y1="10" x2="18" y2="10" stroke="white" stroke-width="2"/>
          </svg>`,
        ship: `
          <svg width="32" height="32" viewBox="0 0 32 32">
            <path d="M6 20 L10 26 L22 26 L26 20 L24 16 L8 16 Z" fill="${c}" stroke="white" stroke-width="2"/>
            <rect x="12" y="10" width="8" height="8" fill="${c}" stroke="white" stroke-width="1.5"/>
            <line x1="20" y1="14" x2="24" y2="14" stroke="white" stroke-width="1.5"/>
          </svg>`,
        apc: `
          <svg width="32" height="32" viewBox="0 0 32 32">
            <rect x="6" y="14" width="20" height="9" rx="3" fill="${c}" stroke="white" stroke-width="2"/>
            <rect x="10" y="11" width="10" height="5" fill="${c}" stroke="white" stroke-width="1.5"/>
            <circle cx="9" cy="19" r="2" fill="#333"/>
            <circle cx="23" cy="19" r="2" fill="#333"/>
          </svg>`,
        artillery: `
          <svg width="32" height="32" viewBox="0 0 32 32">
            <circle cx="16" cy="20" r="8" fill="${c}" stroke="white" stroke-width="2"/>
            <line x1="16" y1="20" x2="28" y2="8" stroke="${c}" stroke-width="4" stroke-linecap="round"/>
            <circle cx="16" cy="20" r="3" fill="white"/>
          </svg>`,
        air_defense: `
          <svg width="32" height="32" viewBox="0 0 32 32">
            <circle cx="16" cy="20" r="8" fill="${c}" stroke="white" stroke-width="2"/>
            <line x1="8" y1="8" x2="16" y2="14" stroke="${c}" stroke-width="3"/>
            <line x1="24" y1="8" x2="16" y2="14" stroke="${c}" stroke-width="3"/>
            <circle cx="16" cy="20" r="2" fill="white"/>
          </svg>`,
        default: `
          <svg width="32" height="32" viewBox="0 0 32 32">
            <rect x="8" y="8" width="16" height="16" rx="3" fill="${c}" stroke="white" stroke-width="2"/>
          </svg>`
      };

      // 根据equipmentType选择形状
      const shapeMap = {
        tank: 'tank',
        infantry: 'infantry',
        apc: 'apc',
        artillery: 'artillery',
        air_defense: 'air_defense',
        fighter: 'fighter',
        bomber: 'bomber',
        helicopter: 'helicopter',
        uav: 'helicopter',
        destroyer: 'ship',
        submarine: 'ship',
        carrier: 'ship',
        landing_ship: 'ship',
        default: 'default'
      };

      return L.divIcon({
        className: 'unit-marker',
        html: shapes[shapeMap[type] || 'default'],
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      });
    };

    return { createIcon };
  }

  updateEntities(entities, showLabels = true, showRange = false) {
    const currentIds = new Set();

    for (const entity of entities) {
      currentIds.add(entity.id);
      this.updateEntity(entity, showLabels, showRange);
    }

    // 移除不存在的
    for (const id of this.entityLayers.keys()) {
      if (!currentIds.has(id)) {
        this.removeEntity(id);
      }
    }
  }

  updateEntity(entity, showLabels, showRange) {
    const id = entity.id;
    let layer = this.entityLayers.get(id);

    // 仿真坐标 -> 地理坐标
    const geoPos = this.simToGeo(entity.x, entity.y);
    const lat = geoPos.lat;
    const lng = geoPos.lng;

    const icon = this.icons.createIcon(entity.equipmentType, entity.side);

    if (!layer) {
      // 创建新标记
      layer = L.marker([lat, lng], {
        icon: icon
      });

      layer.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        // 如果处于删除模式，触发删除而不是显示详情
        if (window.app?.editorMode === 'remove') {
          window.app.removeEntityById(entity.id);
        } else {
          this.onEntityClick?.(entity);
        }
      });

      layer.addTo(this.map);
      this.entityLayers.set(id, layer);
    } else {
      // 更新位置
      layer.setLatLng([lat, lng]);
    }

    // 更新弹出内容 - 悬浮显示详细信息
    const hpPercent = (entity.hp / entity.maxHp * 100).toFixed(0);
    const statusMap = {
      'idle': '待机',
      'moving': '行军',
      'attacking': '攻击',
      'deployed': '部署',
      'retreating': '撤退',
      'patrolling': '巡逻'
    };
    const statusText = statusMap[entity.status] || entity.status || '待机';

    // 计算实际速度 (km/h) - 服务端返回的是 m/s，需要转换为 km/h
    // 1 m/s = 3.6 km/h
    const speedKmh = entity.speed ? Math.round(entity.speed * 3.6 * 10) / 10 : 0;

    // 计算射速显示 (发/分钟)
    const fireRateRpm = entity.fireRate ? Math.round(entity.fireRate * 60) : 0;

    layer.bindPopup(`
      <div style="font-size: 12px; line-height: 1.6; min-width: 200px;">
        <div style="font-weight: bold; font-size: 14px; margin-bottom: 5px; color: ${entity.side === 'red' ? '#ff6b6b' : '#4dabf7'};">
          ${entity.name || entity.id}
        </div>
        <div style="display: grid; grid-template-columns: auto auto; gap: 3px 10px;">
          <span style="color: #888;">阵营:</span><span>${entity.side === 'red' ? '红军' : '蓝军'}</span>
          <span style="color: #888;">类型:</span><span>${entity.equipmentType}</span>
          <span style="color: #888;">状态:</span><span style="color: ${entity.status === 'attacking' ? '#ff6b6b' : '#51cf66'};">${statusText}</span>
          <span style="color: #888;">速度:</span><span>${speedKmh} km/h</span>
          <span style="color: #888;">航向:</span><span>${Math.round(entity.heading || 0)}°</span>
          <span style="color: #888;">位置:</span><span>(${Math.round(entity.x)}, ${Math.round(entity.y)})</span>
          <span style="color: #888;">高度:</span><span>${Math.round(entity.z || 0)}m</span>
          <span style="color: #888;">生命:</span><span>${Math.round(entity.hp)}/${entity.maxHp} (${hpPercent}%)</span>
        </div>
        <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #444;">
          <div style="font-weight: bold; color: #f0883e; margin-bottom: 3px;">⚔️ 火力配置</div>
          <div style="display: grid; grid-template-columns: auto auto; gap: 3px 10px; font-size: 11px;">
            <span style="color: #888;">射程:</span><span>${entity.range || '-'}m</span>
            <span style="color: #888;">伤害:</span><span>${entity.damage || '-'}</span>
            <span style="color: #888;">射速:</span><span>${fireRateRpm > 0 ? fireRateRpm + ' 发/分' : '-'}</span>
            <span style="color: #888;">精度:</span><span>${entity.accuracy ? Math.round(entity.accuracy * 100) + '%' : '-'}</span>
            <span style="color: #888;">装甲:</span><span>${entity.armor ? Math.round(entity.armor * 100) + '%' : '-'}</span>
          </div>
        </div>
        <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #444;">
          <div style="font-weight: bold; color: #51cf66; margin-bottom: 3px;">👁️ 探测能力</div>
          <div style="display: grid; grid-template-columns: auto auto; gap: 3px 10px; font-size: 11px;">
            <span style="color: #888;">视野:</span><span>${entity.vision || '-'}m</span>
            <span style="color: #888;">雷达:</span><span>${entity.detection ? (entity.detection * 10) + 'm' : '-'}</span>
            <span style="color: #888;">探测目标:</span><span>${entity.detectedContacts || 0} 个</span>
          </div>
        </div>
      </div>
    `, {
      closeButton: false,
      className: 'entity-popup'
    });

    // 添加鼠标悬停显示
    layer.bindTooltip(`
      <div style="font-size: 11px;">
        <b>${entity.name || entity.id}</b> - ${statusText}
        <br/>速度: ${speedKmh} km/h | 航向: ${Math.round(entity.heading || 0)}°
        <br/>射程: ${entity.range || '-'}m | 火力: ${entity.damage || '-'}
      </div>
    `, {
      direction: 'top',
      offset: [0, -10],
      className: 'entity-tooltip'
    });

    // 射程圆圈
    this.updateRangeCircle(entity, lat, lng, showRange);

    // 视野/雷达范围圆圈
    this.updateVisionCircle(entity, lat, lng);
    this.updateRadarCircle(entity, lat, lng);
  }

  updateRangeCircle(entity, lat, lng, showRange) {
    let circle = this.rangeCircles.get(entity.id);

    if (showRange && entity.range) {
      // 在平面坐标系中，使用圆的像素半径
      // Leaflet circle需要以米为单位的半径
      // 使用circleMarker配合自定义半径

      if (!circle) {
        // 使用circle显示射程
        circle = L.circle([lat, lng], {
          radius: entity.range, // 直接使用米为单位
          color: entity.side === 'red' ? '#ff6b6b' : '#4dabf7',
          fillColor: entity.side === 'red' ? '#ff6b6b' : '#4dabf7',
          fillOpacity: 0.08,
          weight: 2,
          dashArray: '5, 5',
          className: 'range-circle'
        });
        circle.addTo(this.map);
        this.rangeCircles.set(entity.id, circle);
      } else {
        circle.setLatLng([lat, lng]);
        circle.setStyle({ opacity: 1, fillOpacity: 0.08 });
      }
    } else if (circle) {
      circle.setStyle({ opacity: 0, fillOpacity: 0 });
    }
  }

  // 视野范围 - 实心浅色圆圈
  updateVisionCircle(entity, lat, lng) {
    let circle = this.visionCircles.get(entity.id);
    const visionRange = entity.vision || 500;

    if (!circle) {
      circle = L.circle([lat, lng], {
        radius: visionRange,
        color: entity.side === 'red' ? '#ff8787' : '#74c0fc',
        fillColor: entity.side === 'red' ? '#ffa8a8' : '#a5d8ff',
        fillOpacity: 0.05,
        weight: 1,
        opacity: 0.4,
        className: 'vision-circle'
      });
      circle.addTo(this.map);
      this.visionCircles.set(entity.id, circle);
    } else {
      circle.setLatLng([lat, lng]);
    }
  }

  // 雷达探测范围 - 虚线圆圈
  updateRadarCircle(entity, lat, lng) {
    let circle = this.radarCircles.get(entity.id);
    // 使用 detection 属性计算雷达范围，如果没有则使用默认值
    const radarRange = (entity.detection || 50) * 10;

    if (!circle) {
      circle = L.circle([lat, lng], {
        radius: radarRange,
        color: entity.side === 'red' ? '#ff6b6b' : '#339af0',
        fillColor: entity.side === 'red' ? '#ff6b6b' : '#339af0',
        fillOpacity: 0,
        weight: 1.5,
        dashArray: '8, 4',
        opacity: 0.5,
        className: 'radar-circle'
      });
      circle.addTo(this.map);
      this.radarCircles.set(entity.id, circle);
    } else {
      circle.setLatLng([lat, lng]);
    }
  }

  // 创建攻击动画线
  createAttackAnimation(fromEntity, toEntity, result) {
    const fromGeo = this.simToGeo(fromEntity.x, fromEntity.y);
    const toGeo = this.simToGeo(toEntity.x, toEntity.y);

    const color = fromEntity.side === 'red' ? '#ff4444' : '#4444ff';
    const isHit = result.hit;

    // 创建虚线轨迹
    const line = L.polyline([[fromGeo.lat, fromGeo.lng], [toGeo.lat, toGeo.lng]], {
      color: color,
      weight: 3,
      opacity: 0.9,
      dashArray: '10, 5',
      className: 'attack-line'
    }).addTo(this.map);

    // 创建弹头动画标记
    const projectileIcon = L.divIcon({
      className: 'projectile',
      html: `<div style="
        width: 8px;
        height: 8px;
        background: ${color};
        border-radius: 50%;
        box-shadow: 0 0 10px ${color}, 0 0 20px ${color};
        transform: translate(-50%, -50%);
      "></div>`,
      iconSize: [8, 8],
      iconAnchor: [4, 4]
    });

    const projectile = L.marker([fromGeo.lat, fromGeo.lng], {
      icon: projectileIcon,
      zIndexOffset: 1000
    }).addTo(this.map);

    // 动画参数
    const duration = 300; // 毫秒
    const startTime = Date.now();

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      const currentLat = fromGeo.lat + (toGeo.lat - fromGeo.lat) * progress;
      const currentLng = fromGeo.lng + (toGeo.lng - fromGeo.lng) * progress;

      projectile.setLatLng([currentLat, currentLng]);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        // 动画结束，创建命中/未命中效果
        this.createHitEffect(toGeo, isHit, color);

        // 清理
        setTimeout(() => {
          this.map.removeLayer(line);
          this.map.removeLayer(projectile);
        }, 200);
      }
    };

    requestAnimationFrame(animate);
  }

  // 创建命中效果
  createHitEffect(pos, isHit, color) {
    const effectColor = isHit ? '#ff0000' : '#888888';
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
    }).addTo(this.map);

    setTimeout(() => {
      this.map.removeLayer(marker);
    }, 600);
  }

  removeEntity(id) {
    const layer = this.entityLayers.get(id);
    if (layer) {
      this.map.removeLayer(layer);
      this.entityLayers.delete(id);
    }

    const circle = this.rangeCircles.get(id);
    if (circle) {
      this.map.removeLayer(circle);
      this.rangeCircles.delete(id);
    }

    const vision = this.visionCircles.get(id);
    if (vision) {
      this.map.removeLayer(vision);
      this.visionCircles.delete(id);
    }

    const radar = this.radarCircles.get(id);
    if (radar) {
      this.map.removeLayer(radar);
      this.radarCircles.delete(id);
    }
  }

  setViewCenter(x, y, zoom = 10) {
    this.map.setView([y / 100, x / 100], zoom);
  }

  highlightEntity(id) {
    // 取消之前的高亮
    this.entityLayers.forEach((layer, lid) => {
      layer.setZIndexOffset(0);
    });

    const layer = this.entityLayers.get(id);
    if (layer) {
      layer.setZIndexOffset(1000);
      layer.openPopup();
      this.selectedId = id;
    }
  }

  clear() {
    this.entityLayers.forEach(layer => this.map.removeLayer(layer));
    this.rangeCircles.forEach(circle => this.map.removeLayer(circle));
    this.entityLayers.clear();
    this.rangeCircles.clear();
  }

  destroy() {
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  }

  // 切换底图
  switchBaseLayer(type) {
    if (this.baseLayers[type] && this.baseLayers[type] !== this.baseLayer) {
      this.map.removeLayer(this.baseLayer);
      this.baseLayer = this.baseLayers[type];
      this.baseLayer.addTo(this.map);
      this.baseLayer.setZIndex(-1); // 确保底图在最下层
    }
  }

  // ========== 路径绘制功能 ==========

  // 显示单位的路径
  showPath(entityId, pathPoints) {
    this.clearPath(entityId);

    if (!pathPoints || pathPoints.length < 2) return;

    // 将仿真坐标转为地理坐标
    const latlngs = pathPoints.map(p => {
      const geo = this.simToGeo(p.x, p.y);
      return [geo.lat, geo.lng];
    });

    // 绘制路径线 - 抛物线效果（使用曲线）
    const pathLine = L.polyline(latlngs, {
      color: '#ffd700',
      weight: 4,
      opacity: 0.8,
      dashArray: '10, 10',
      className: 'unit-path',
      smoothFactor: 1.5  // 平滑曲线
    }).addTo(this.map);

    // 添加箭头标记表示方向
    const arrows = [];
    for (let i = 0; i < latlngs.length - 1; i++) {
      const arrow = L.polylineDecorator(pathLine, {
        patterns: [
          {
            offset: `${(i + 0.5) * 100 / pathPoints.length}%`,
            repeat: 0,
            symbol: L.Symbol.arrowHead({
              pixelSize: 10,
              polygon: false,
              pathOptions: {
                color: '#ffd700',
                weight: 2,
                opacity: 0.7
              }
            })
          }
        ]
      }).addTo(this.map);
      arrows.push(arrow);
    }

    // 绘制路径点
    const markers = L.layerGroup().addTo(this.map);
    pathPoints.forEach((p, i) => {
      const geo = this.simToGeo(p.x, p.y);

      // 起点(绿色)、中间点(黄色)、终点(红色)
      let color = '#ffd700';
      let radius = 6;
      if (i === 0) {
        color = '#00ff00';
        radius = 8;
      } else if (i === pathPoints.length - 1) {
        color = '#ff0000';
        radius = 8;
      }

      const point = L.circleMarker([geo.lat, geo.lng], {
        radius: radius,
        fillColor: color,
        color: '#fff',
        weight: 2,
        fillOpacity: 0.9
      }).addTo(markers);

      // 添加序号标签
      point.bindTooltip(`${i + 1}`, {
        permanent: true,
        direction: 'center',
        className: 'path-point-label'
      });

      // 添加悬停提示
      const waypointType = i === 0 ? '起点' : i === pathPoints.length - 1 ? '终点' : `途经点 ${i}`;
      point.bindPopup(`
        <div style="font-size:12px;">
          <b>${waypointType}</b><br/>
          坐标: (${Math.round(p.x)}, ${Math.round(p.y)})
        </div>
      `);
    });

    this.pathLayers.set(entityId, { line: pathLine, markers, arrows });
  }

  // 更新路径显示（单位移动时更新进度）
  updatePathProgress(entityId, currentIndex) {
    const path = this.pathLayers.get(entityId);
    if (!path) return;

    // 可以添加视觉反馈显示单位已经行进到的路径点
    const markers = path.markers.getLayers();
    markers.forEach((marker, index) => {
      if (index < currentIndex) {
        marker.setStyle({
          fillColor: '#00ff00',
          fillOpacity: 0.4
        });
      }
    });
  }

  // 清除单位的路径显示
  clearPath(entityId) {
    const path = this.pathLayers.get(entityId);
    if (path) {
      this.map.removeLayer(path.line);
      this.map.removeLayer(path.markers);
      this.pathLayers.delete(entityId);
    }
  }

  // 清除所有路径
  clearAllPaths() {
    for (const [entityId, path] of this.pathLayers) {
      this.map.removeLayer(path.line);
      this.map.removeLayer(path.markers);
    }
    this.pathLayers.clear();
  }
}
