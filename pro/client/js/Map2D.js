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

    // 添加底图
    this.baseLayer = L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', {
      subdomains: '1234',
      attribution: '高德地图',
      maxZoom: 18
    }).addTo(this.map);

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
    if (this.gridLayer) {
      this.map.removeLayer(this.gridLayer);
      this.gridLayer = null;
    }
    // 移除演习区域标签
    this.map.eachLayer((layer) => {
      if (layer instanceof L.Marker && layer.getElement()) {
        const html = layer.getElement().innerHTML;
        if (html && html.includes('演习区域')) {
          this.map.removeLayer(layer);
        }
      }
    });
    this.exerciseBounds = null;
    this.coordTransform = null;
  }

  // 设置演习区域
  setExerciseArea(bounds) {
    // 清除旧的演习区域
    if (this.exerciseArea) {
      this.map.removeLayer(this.exerciseArea);
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

    // 添加标签
    const center = [
      (bounds[0][0] + bounds[1][0]) / 2,
      (bounds[0][1] + bounds[1][1]) / 2
    ];

    L.marker(center, {
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
        red: '#dc3545',
        blue: '#007bff'
      };
      const c = colors[side] || '#666';

      // 使用彩色div图标替代SVG
      const shapes = {
        tank: `<div style="background:${c};width:20px;height:14px;border-radius:4px;border:2px solid white;position:relative;"><div style="position:absolute;top:-4px;left:6px;width:8px;height:6px;background:${c};border:1px solid white;border-radius:2px;"></div><div style="position:absolute;top:4px;right:-6px;width:6px;height:2px;background:white;"></div></div>`,
        infantry: `<div style="width:24px;height:24px;display:flex;flex-direction:column;align-items:center;justify-content:center;"><div style="width:8px;height:8px;background:${c};border:2px solid white;border-radius:50%;"></div><div style="width:2px;height:10px;background:${c};"></div><div style="width:16px;height:2px;background:${c};"></div></div>`,
        fighter: `<div style="width:0;height:0;border-left:10px solid transparent;border-right:10px solid transparent;border-bottom:20px solid ${c};filter:drop-shadow(0 0 2px white);"></div>`,
        bomber: `<div style="width:24px;height:10px;background:${c};border:2px solid white;border-radius:50%;"></div>`,
        helicopter: `<div style="width:24px;height:12px;background:${c};border:2px solid white;border-radius:40%;position:relative;"><div style="position:absolute;top:-4px;left:2px;width:20px;height:2px;background:white;"></div><div style="position:absolute;top:-8px;left:10px;width:2px;height:6px;background:white;"></div></div>`,
        ship: `<div style="width:0;height:0;border-left:10px solid transparent;border-right:10px solid transparent;border-top:16px solid ${c};filter:drop-shadow(0 0 1px white);"></div>`,
        apc: `<div style="width:20px;height:12px;background:${c};border:2px solid white;border-radius:6px;"></div>`,
        default: `<div style="width:16px;height:16px;background:${c};border:2px solid white;border-radius:50%;"></div>`
      };

      // 根据equipmentType选择形状
      const shapeMap = {
        tank: 'tank',
        infantry: 'infantry',
        apc: 'apc',
        artillery: 'tank',
        air_defense: 'apc',
        fighter: 'fighter',
        bomber: 'bomber',
        helicopter: 'helicopter',
        uav: 'fighter',
        destroyer: 'ship',
        submarine: 'ship',
        carrier: 'ship',
        landing_ship: 'ship',
        default: 'default'
      };

      return L.divIcon({
        className: 'unit-marker',
        html: shapes[shapeMap[type] || 'default'],
        iconSize: [28, 28],
        iconAnchor: [14, 14]
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
}
