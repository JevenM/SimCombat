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
    this.trailLayers = new Map();    // 空战航迹尾迹
    this.missileLayers = new Map();  // 空空导弹实时位置
    this.duelAircraftLayers = new Map(); // 空战双机实时标签
    this.terrainOverlay = null;
    this.selectedId = null;

    this.icons = this.createIcons();
    this.init();
  }

  init() {
    // 创建地图 - 使用标准地理坐标系
    this.map = L.map(this.containerId, {
      center: [39.9, 116.4], // 北京附近
      zoom: 11, // 默认比例尺约2km
      minZoom: 5,
      maxZoom: 18,
      attributionControl: true,
      zoomControl: false
    });

    // 添加底图图层组
    this.baseLayers = {};
    this.offlineMode = false; // 离线模式标志

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

    // 地形图 (使用Stadia Terrain替代OpenTopoMap，更稳定)
    this.baseLayers.terrain = L.tileLayer('https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}.png', {
      attribution: 'Stadia Maps | Stamen Design',
      maxZoom: 17
    });

    // 离线地图图层 (简单的纯色背景)
    const offlineLayer = L.gridLayer({
      attribution: '离线模式',
      maxZoom: 18,
      tileSize: 256
    });

    // 自定义离线瓦片渲染
    offlineLayer.createTile = function(coords, done) {
      const tile = document.createElement('canvas');
      const tileSize = this.getTileSize();
      tile.setAttribute('width', tileSize.x);
      tile.setAttribute('height', tileSize.y);
      const ctx = tile.getContext('2d');

      // 使用闭包访问 Map2D 实例
      const map2d = this._map2dRef;

      // 先绘制默认背景（避免空白）
      map2d.drawOfflineTile(ctx, tileSize, coords);

      // 尝试从缓存获取瓦片
      const url = map2d.buildTileUrl(coords);
      map2d.getCachedTile(url, coords).then(cachedUrl => {
        if (cachedUrl) {
          // 如果有缓存，加载并绘制缓存的图片
          const img = new Image();
          img.onload = () => {
            // 清除默认背景
            ctx.clearRect(0, 0, tileSize.x, tileSize.y);
            // 绘制缓存图片
            ctx.drawImage(img, 0, 0);
            URL.revokeObjectURL(cachedUrl);
            // 通知 Leaflet 瓦片已准备好
            if (done) done(null, tile);
          };
          img.onerror = () => {
            // 加载失败，保持默认背景
            console.warn(`加载缓存瓦片失败: ${coords.z}/${coords.x}/${coords.y}`);
            if (done) done(null, tile);
          };
          img.src = cachedUrl;
        } else {
          // 没有缓存,保持默认背景
          if (done) done(null, tile);
        }
      }).catch(err => {
        console.error('获取缓存瓦片失败:', err);
        if (done) done(null, tile);
      });

      return tile;
    };

    // 保存 Map2D 引用到 layer
    offlineLayer._map2dRef = this;
    this.baseLayers.offline = offlineLayer;

    // 在线瓦片连续加载失败（断网 / 证书被拦截）时自动降级为离线底图
    this._tileErrorCount = 0;
    ['standard', 'satellite', 'terrain'].forEach(key => {
      this.baseLayers[key].on('tileerror', () => {
        this._tileErrorCount++;
        if (this._tileErrorCount === 6 && !this.offlineMode) {
          console.warn('[Map2D] 在线瓦片加载失败，自动切换到离线底图');
          this.setOfflineMode(true);
          const box = document.getElementById('offlineMode');
          if (box) box.checked = true;
          const status = document.getElementById('offlineStatus');
          if (status) {
            status.textContent = '离线模式（瓦片加载失败）';
            status.style.color = '#58a6ff';
          }
        }
      });
    });

    // 初始化本地缓存
    this.initOfflineCache();

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

    // 地形数据缓存
    this.terrainData = null;
    this.terrainOverlay = null; // 地形可视化图层

    // 演习区域和网格默认不显示，等待用户设置
    this.exerciseArea = null;
    this.exerciseAreaLabel = null;  // 保存标签引用
    this.exerciseBounds = null;
    this.coordTransform = null;
    this.gridLayer = null;
  }

  // 绘制默认离线瓦片
  drawOfflineTile(ctx, tileSize, coords) {
    // 绘制背景色
    ctx.fillStyle = '#2d5016'; // 深绿色代表陆地
    ctx.fillRect(0, 0, tileSize.x, tileSize.y);

    // 绘制网格线
    ctx.strokeStyle = '#3d6b25';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, tileSize.x, tileSize.y);

    // 绘制坐标文本
    ctx.fillStyle = '#5a8a3a';
    ctx.font = '10px monospace';
    ctx.fillText(`${coords.z}/${coords.x}/${coords.y}`, 5, 15);
  }

  /**
   * 加载并显示地形数据
   * @param {Object} terrainData - 从服务器导出的地形数据
   */
  loadTerrain(terrainData) {
    this.terrainData = terrainData;
    console.log(`加载地形数据: ${terrainData.cols}x${terrainData.rows} 栅格`);
  }

  /**
   * 显示/隐藏地形覆盖层
   * @param {boolean} show - 是否显示
   */
  showTerrainOverlay(show) {
    if (show) {
      if (!this.terrainData) {
        console.warn('没有地形数据可显示');
        return;
      }
      this.createTerrainOverlay();
    } else {
      this.removeTerrainOverlay();
    }
  }

  /**
   * 创建地形可视化覆盖层 - 修复版，支持无演习区域
   * 使用Canvas绘制地形类型
   */
  createTerrainOverlay() {
    if (this.terrainOverlay) {
      this.map.removeLayer(this.terrainOverlay);
    }

    const { terrainType, cols, rows, width, height } = this.terrainData;

    if (!terrainType || !cols || !rows) {
      console.warn('地形数据不完整，无法显示地形');
      return;
    }

    // 地形类型颜色映射
    const terrainColors = {
      0: '#90EE90', // 平原 - 浅绿
      1: '#228B22', // 森林 - 深绿
      2: '#808080', // 城市 - 灰色
      3: '#8B4513', // 山地 - 棕色
      4: '#4169E1', // 水域 - 蓝色
      5: '#F4E4C1', // 沙漠 - 沙色
      6: '#556B2F'  // 沼泽 - 暗绿
    };

    // 创建Canvas图层
    this.terrainOverlay = L.gridLayer({
      opacity: 0.5,
      attribution: '地形叠加'
    });

    this.terrainOverlay.createTile = (coords) => {
      const tile = document.createElement('canvas');
      const tileSize = this.terrainOverlay.getTileSize();
      tile.setAttribute('width', tileSize.x);
      tile.setAttribute('height', tileSize.y);
      const ctx = tile.getContext('2d');

      // 计算瓦片对应的地理范围
      const tileBounds = this.getTileBounds(coords);

      // 根据是否有演习区域选择不同的绘制方式
      if (this.coordTransform) {
        // 有演习区域，使用坐标转换
        this.drawTerrainWithTransform(ctx, tileSize, coords, tileBounds, terrainType, cols, rows, width, height, terrainColors);
      } else {
        // 无演习区域，使用简化绘制（基于经纬度比例）
        this.drawTerrainSimple(ctx, tileSize, coords, tileBounds, terrainType, cols, rows, terrainColors);
      }

      return tile;
    };

    this.terrainOverlay.addTo(this.map);
  }

  /**
   * 使用坐标转换绘制地形（有演习区域时）
   */
  drawTerrainWithTransform(ctx, tileSize, coords, tileBounds, terrainType, cols, rows, width, height, terrainColors) {
    const cellWidth = width / cols;
    const cellHeight = height / rows;

    const startCol = Math.floor((tileBounds.west - this.coordTransform.lngMin) / cellWidth);
    const endCol = Math.ceil((tileBounds.east - this.coordTransform.lngMin) / cellWidth);
    const startRow = Math.floor((tileBounds.north - this.coordTransform.latMin) / cellHeight);
    const endRow = Math.ceil((tileBounds.south - this.coordTransform.latMin) / cellHeight);

    for (let row = Math.max(0, startRow); row < Math.min(rows, endRow); row++) {
      for (let col = Math.max(0, startCol); col < Math.min(cols, endCol); col++) {
        const idx = row * cols + col;
        const type = terrainType[idx];
        const color = terrainColors[type] || '#CCCCCC';

        ctx.fillStyle = color;
        ctx.fillRect(col - startCol, row - startRow, 1, 1);
      }
    }
  }

  /**
   * 简化地形绘制（无演习区域时）
   */
  drawTerrainSimple(ctx, tileSize, coords, tileBounds, terrainType, cols, rows, terrainColors) {
    // 将经纬度映射到地形网格
    const lngRange = tileBounds.east - tileBounds.west;
    const latRange = tileBounds.north - tileBounds.south;

    const pixelsPerCol = tileSize.x / (lngRange * 50); // 估算比例
    const pixelsPerRow = tileSize.y / (latRange * 50);

    // 简单填充：根据瓦片位置取对应地形颜色
    const centerCol = Math.floor(cols * ((tileBounds.west + 180) / 360)) % cols;
    const centerRow = Math.floor(rows * ((90 - tileBounds.north) / 180)) % rows;

    if (centerRow >= 0 && centerRow < rows && centerCol >= 0 && centerCol < cols) {
      const idx = centerRow * cols + centerCol;
      const type = terrainType[idx] || 0;
      const color = terrainColors[type] || '#CCCCCC';

      // 填充半透明颜色
      ctx.fillStyle = color + '80'; // 添加透明度
      ctx.fillRect(0, 0, tileSize.x, tileSize.y);

      // 绘制网格线
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 1;
      ctx.strokeRect(0, 0, tileSize.x, tileSize.y);

      // 绘制坐标文字
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '10px monospace';
      ctx.fillText(`${coords.z}/${coords.x}/${coords.y}`, 5, 15);
    }
  }

  /**
   * 获取瓦片地理边界
   */
  getTileBounds(coords) {
    const tileSize = 256;
    const zoom = coords.z;
    const n = Math.PI * Math.pow(2, zoom - coords.y - 1);
    const south = (Math.atan(Math.sinh(-n))) * 180 / Math.PI;
    const north = (Math.atan(Math.sinh(n))) * 180 / Math.PI;

    const west = coords.x / Math.pow(2, zoom) * 360 - 180;
    const east = (coords.x + 1) / Math.pow(2, zoom) * 360 - 180;

    return { west, east, north, south };
  }

  /**
   * 移除地形覆盖层
   */
  removeTerrainOverlay() {
    if (this.terrainOverlay) {
      this.map.removeLayer(this.terrainOverlay);
      this.terrainOverlay = null;
    }
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
    if (!this.coordTransform) {
      // 没有演习区域时，使用默认转换（基于地图中心）
      const center = this.map.getCenter();
      // 假设默认范围约 10km x 10km
      const latRange = 0.09;  // 约 10km
      const lngRange = 0.11;  // 约 10km at latitude 40°
      const lat = center.lat - latRange/2 + (y / 10000) * latRange;
      const lng = center.lng - lngRange/2 + (x / 10000) * lngRange;
      return { lat, lng };
    }

    const lng = this.coordTransform.lngMin + (x / 10000) * this.coordTransform.lngRange;
    const lat = this.coordTransform.latMin + (y / 10000) * this.coordTransform.latRange;

    return { lat, lng };
  }

  createIcons() {
    const createIcon = (type, side, isDestroyed = false) => {
      const colors = {
        red: '#e74c3c',
        blue: '#3498db'
      };
      const c = colors[side] || '#666';

      // 如果被击毁，使用灰度颜色和半透明
      const displayColor = isDestroyed ? '#888888' : c;
      const opacity = isDestroyed ? 0.4 : 1;

      // 红色叉号遮罩（用于被击毁状态）
      const destroyOverlay = isDestroyed ? `
        <svg width="32" height="32" viewBox="0 0 32 32" style="position:absolute;top:0;left:0;pointer-events:none;z-index:10;">
          <line x1="4" y1="4" x2="28" y2="28" stroke="#ff0000" stroke-width="3" stroke-linecap="round"/>
          <line x1="28" y1="4" x2="4" y2="28" stroke="#ff0000" stroke-width="3" stroke-linecap="round"/>
          <circle cx="16" cy="16" r="14" stroke="#ff0000" stroke-width="2" fill="none" opacity="0.5"/>
        </svg>
      ` : '';

      // NATO军事符号 - 更专业的军事图标
      const shapes = {
        tank: `
          <div style="position:relative;width:32px;height:32px;">
            <svg width="32" height="32" viewBox="0 0 32 32">
              <rect x="6" y="14" width="20" height="10" rx="2" fill="${displayColor}" stroke="white" stroke-width="2" opacity="${opacity}"/>
              <rect x="10" y="10" width="12" height="6" rx="1" fill="${displayColor}" stroke="white" stroke-width="1.5" opacity="${opacity}"/>
              <line x1="22" y1="13" x2="28" y2="13" stroke="white" stroke-width="2"/>
              <circle cx="9" cy="19" r="2.5" fill="#333"/>
              <circle cx="23" cy="19" r="2.5" fill="#333"/>
            </svg>
            ${destroyOverlay}
          </div>`,
        infantry: `
          <div style="position:relative;width:32px;height:32px;">
            <svg width="32" height="32" viewBox="0 0 32 32">
              <circle cx="16" cy="8" r="5" fill="${displayColor}" stroke="white" stroke-width="2" opacity="${opacity}"/>
              <line x1="16" y1="13" x2="16" y2="22" stroke="${displayColor}" stroke-width="3" stroke-linecap="round" opacity="${opacity}"/>
              <line x1="8" y1="16" x2="24" y2="16" stroke="${displayColor}" stroke-width="2.5" stroke-linecap="round" opacity="${opacity}"/>
              <line x1="16" y1="22" x2="10" y2="28" stroke="${displayColor}" stroke-width="2.5" stroke-linecap="round" opacity="${opacity}"/>
              <line x1="16" y1="22" x2="22" y2="28" stroke="${displayColor}" stroke-width="2.5" stroke-linecap="round" opacity="${opacity}"/>
            </svg>
            ${destroyOverlay}
          </div>`,
        fighter: `
          <div style="position:relative;width:32px;height:32px;">
            <svg width="32" height="32" viewBox="0 0 32 32">
              <path d="M16 4 L20 14 L28 16 L20 18 L18 28 L16 24 L14 28 L12 18 L4 16 L12 14 Z" fill="${displayColor}" stroke="white" stroke-width="1.5" opacity="${opacity}"/>
            </svg>
            ${destroyOverlay}
          </div>`,
        // 歼-16 重型战机：宽翼展 + 双垂尾（与轻型/隐身型明显不同）
        fighter_heavy: `
          <div style="position:relative;width:32px;height:32px;">
            <svg width="32" height="32" viewBox="0 0 32 32">
              <path d="M16 3 L25 14 L30 18 L25 21 L22 29 L16 25 L10 29 L7 21 L2 18 L7 14 Z"
                    fill="${displayColor}" stroke="white" stroke-width="1.5" opacity="${opacity}"/>
              <rect x="14.5" y="7" width="3" height="15" fill="white" opacity="0.45"/>
              <line x1="12" y1="25" x2="9" y2="30" stroke="white" stroke-width="1.5"/>
              <line x1="20" y1="25" x2="23" y2="30" stroke="white" stroke-width="1.5"/>
            </svg>
            ${destroyOverlay}
          </div>`,
        // 歼-10C 轻型战机：细长三角翼 + 鸭翼
        fighter_light: `
          <div style="position:relative;width:32px;height:32px;">
            <svg width="32" height="32" viewBox="0 0 32 32">
              <path d="M16 2 L19 13 L25 21 L19 19 L17 28 L16 24 L15 28 L13 19 L7 21 L13 13 Z"
                    fill="${displayColor}" stroke="white" stroke-width="1.5" opacity="${opacity}"/>
              <line x1="9" y1="10" x2="13" y2="13" stroke="white" stroke-width="1.2"/>
              <line x1="23" y1="10" x2="19" y2="13" stroke="white" stroke-width="1.2"/>
            </svg>
            ${destroyOverlay}
          </div>`,
        bomber: `
          <div style="position:relative;width:32px;height:32px;">
            <svg width="32" height="32" viewBox="0 0 32 32">
              <ellipse cx="16" cy="16" rx="12" ry="6" fill="${displayColor}" stroke="white" stroke-width="2" opacity="${opacity}"/>
              <rect x="12" y="8" width="8" height="6" fill="${displayColor}" stroke="white" stroke-width="1.5" opacity="${opacity}"/>
            </svg>
            ${destroyOverlay}
          </div>`,
        // 无人机：细长机体 + 长直翼
        uav: `
          <div style="position:relative;width:32px;height:32px;">
            <svg width="32" height="32" viewBox="0 0 32 32">
              <rect x="14" y="6" width="4" height="20" rx="2" fill="${displayColor}" stroke="white" stroke-width="1.5" opacity="${opacity}"/>
              <line x1="4" y1="16" x2="28" y2="16" stroke="${displayColor}" stroke-width="3" opacity="${opacity}"/>
              <line x1="4" y1="16" x2="28" y2="16" stroke="white" stroke-width="1"/>
            </svg>
            ${destroyOverlay}
          </div>`,
        // 预警机：机身 + 雷达圆盘
        awacs: `
          <div style="position:relative;width:32px;height:32px;">
            <svg width="32" height="32" viewBox="0 0 32 32">
              <path d="M16 2 L19 14 L19 28 L13 28 L13 14 Z" fill="${displayColor}" stroke="white" stroke-width="1.5" opacity="${opacity}"/>
              <ellipse cx="16" cy="15" rx="12" ry="4" fill="none" stroke="white" stroke-width="1.5" opacity="${opacity}"/>
            </svg>
            ${destroyOverlay}
          </div>`,
        helicopter: `
          <div style="position:relative;width:32px;height:32px;">
            <svg width="32" height="32" viewBox="0 0 32 32">
              <ellipse cx="16" cy="20" rx="10" ry="5" fill="${displayColor}" stroke="white" stroke-width="2" opacity="${opacity}"/>
              <line x1="6" y1="14" x2="26" y2="14" stroke="white" stroke-width="2"/>
              <line x1="16" y1="10" x2="16" y2="14" stroke="white" stroke-width="2"/>
              <line x1="14" y1="10" x2="18" y2="10" stroke="white" stroke-width="2"/>
            </svg>
            ${destroyOverlay}
          </div>`,
        ship: `
          <div style="position:relative;width:32px;height:32px;">
            <svg width="32" height="32" viewBox="0 0 32 32">
              <path d="M6 20 L10 26 L22 26 L26 20 L24 16 L8 16 Z" fill="${displayColor}" stroke="white" stroke-width="2" opacity="${opacity}"/>
              <rect x="12" y="10" width="8" height="8" fill="${displayColor}" stroke="white" stroke-width="1.5" opacity="${opacity}"/>
              <line x1="20" y1="14" x2="24" y2="14" stroke="white" stroke-width="1.5"/>
            </svg>
            ${destroyOverlay}
          </div>`,
        apc: `
          <div style="position:relative;width:32px;height:32px;">
            <svg width="32" height="32" viewBox="0 0 32 32">
              <rect x="6" y="14" width="20" height="9" rx="3" fill="${displayColor}" stroke="white" stroke-width="2" opacity="${opacity}"/>
              <rect x="10" y="11" width="10" height="5" fill="${displayColor}" stroke="white" stroke-width="1.5" opacity="${opacity}"/>
              <circle cx="9" cy="19" r="2" fill="#333"/>
              <circle cx="23" cy="19" r="2" fill="#333"/>
            </svg>
            ${destroyOverlay}
          </div>`,
        artillery: `
          <div style="position:relative;width:32px;height:32px;">
            <svg width="32" height="32" viewBox="0 0 32 32">
              <circle cx="16" cy="20" r="8" fill="${displayColor}" stroke="white" stroke-width="2" opacity="${opacity}"/>
              <line x1="16" y1="20" x2="28" y2="8" stroke="${displayColor}" stroke-width="4" stroke-linecap="round" opacity="${opacity}"/>
              <circle cx="16" cy="20" r="3" fill="white"/>
            </svg>
            ${destroyOverlay}
          </div>`,
        air_defense: `
          <div style="position:relative;width:32px;height:32px;">
            <svg width="32" height="32" viewBox="0 0 32 32">
              <circle cx="16" cy="20" r="8" fill="${displayColor}" stroke="white" stroke-width="2" opacity="${opacity}"/>
              <line x1="8" y1="8" x2="16" y2="14" stroke="${displayColor}" stroke-width="3" opacity="${opacity}"/>
              <line x1="24" y1="8" x2="16" y2="14" stroke="${displayColor}" stroke-width="3" opacity="${opacity}"/>
              <circle cx="16" cy="20" r="2" fill="white"/>
            </svg>
            ${destroyOverlay}
          </div>`,
        default: `
          <div style="position:relative;width:32px;height:32px;">
            <svg width="32" height="32" viewBox="0 0 32 32">
              <rect x="8" y="8" width="16" height="16" rx="3" fill="${displayColor}" stroke="white" stroke-width="2" opacity="${opacity}"/>
            </svg>
            ${destroyOverlay}
          </div>`
      };

      // 根据equipmentType选择形状
      const shapeMap = {
        tank: 'tank',
        infantry: 'infantry',
        apc: 'apc',
        artillery: 'artillery',
        air_defense: 'air_defense',
        fighter: 'fighter',
        fighter_heavy: 'fighter_heavy',
        fighter_light: 'fighter_light',
        bomber: 'bomber',
        helicopter: 'helicopter',
        uav: 'uav',
        awacs: 'awacs',
        destroyer: 'ship',
        submarine: 'ship',
        carrier: 'ship',
        landing_ship: 'ship',
        default: 'default'
      };

      return L.divIcon({
        className: `unit-marker ${isDestroyed ? 'destroyed' : ''}`,
        html: shapes[shapeMap[type] || 'default'],
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      });
    };

    return { createIcon };
  };

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

  // 判断是否空中单位（图标旋转、航迹等仅对空中单位生效）
  isAirType(entity) {
    if (!entity) return false;
    if (entity.category === 'air') return true;
    return ['fighter', 'fighter_heavy', 'fighter_light', 'bomber', 'helicopter', 'uav', 'awacs']
      .includes(entity.equipmentType);
  }

  updateEntity(entity, showLabels, showRange) {
    const id = entity.id;
    let layer = this.entityLayers.get(id);

    // 仿真坐标 -> 地理坐标
    const geoPos = this.simToGeo(entity.x, entity.y);
    const lat = geoPos.lat;
    const lng = geoPos.lng;

    // 检测实体是否被摧毁 (HP <= 0 或状态为 destroyed)
    const isDestroyed = entity.hp <= 0 || entity.status === 'destroyed' || entity.isDestroyed;

    const icon = this.icons.createIcon(entity.equipmentType, entity.side, isDestroyed);

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

    // 更新图标（在被击毁时可能变化）
    layer.setIcon(icon);

    // 空中单位：图标随机头指向旋转，直观体现咬尾与规避
    if (this.isAirType(entity)) {
      const el = layer.getElement();
      if (el) {
        el.style.transformOrigin = 'center center';
        el.style.transform = `rotate(${90 - (entity.heading || 0)}deg)`;
      }
    }

    // 处理标签显示
    if (showLabels) {
      // 创建或更新标签
      const labelText = entity.name || entity.id;
      layer.bindTooltip(labelText, {
        permanent: true,
        direction: 'top',
        offset: [0, -16],
        className: 'unit-label'
      });
    } else {
      // 移除标签
      if (layer.getTooltip()) {
        layer.unbindTooltip();
      }
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

    // 添加鼠标悬停显示（只在不显示永久标签时）
    if (!showLabels) {
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
    }

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

  /**
   * 清空地图上的全部动态图层：单位标记（兵力/战机/人员）、射程圈、视野圈、
   * 雷达圈、攻击线、单位路径、空战航迹/导弹/双机标签
   * （地形叠加与演习区域不属于动态元素，需单独 clearExerciseArea）
   */
  clear() {
    this.entityLayers.forEach(layer => this.map.removeLayer(layer));
    this.rangeCircles.forEach(circle => this.map.removeLayer(circle));
    this.visionCircles.forEach(circle => this.map.removeLayer(circle));
    this.radarCircles.forEach(circle => this.map.removeLayer(circle));
    this.attackLines.forEach(line => this.map.removeLayer(line));
    this.entityLayers.clear();
    this.rangeCircles.clear();
    this.visionCircles.clear();
    this.radarCircles.clear();
    this.attackLines.clear();
    this.clearAllPaths();
    this.clearDuelVisuals();
    this.selectedId = null;
  }

  /**
   * 空战对决可视化：航迹尾迹 + 飞行中的导弹
   * @param {Array} missiles - [{ id, side, x, y, z, heading }]
   * @param {Array} trails - [{ entityId, points: [[x,y,z], ...] }]
   * @param {Array} entities - 实体列表（用于取阵营颜色）
   */
  updateDuelVisuals(missiles = [], trails = [], entities = []) {
    if (!this.map) return;

    const sideById = new Map(entities.map(e => [e.id, e.side]));
    const colorOf = side => (side === 'red' ? '#ff4d4d' : '#4dabf7');

    // ---- 航迹 ----
    const activeTrailIds = new Set();
    for (const trail of trails) {
      if (!trail || !Array.isArray(trail.points) || trail.points.length < 2) continue;
      activeTrailIds.add(trail.entityId);

      const latlngs = trail.points.map(p => {
        const geo = this.simToGeo(p[0], p[1]);
        return [geo.lat, geo.lng];
      });
      const color = colorOf(sideById.get(trail.entityId) || 'red');

      let layer = this.trailLayers.get(trail.entityId);
      if (!layer) {
        layer = L.polyline(latlngs, {
          color,
          weight: 2,
          opacity: 0.75,
          dashArray: '4 6',
          interactive: false
        });
        layer.addTo(this.map);
        this.trailLayers.set(trail.entityId, layer);
      } else {
        layer.setLatLngs(latlngs);
        layer.setStyle({ color });
      }
    }
    // 移除已不存在的航迹
    for (const [id, layer] of this.trailLayers) {
      if (!activeTrailIds.has(id)) {
        this.map.removeLayer(layer);
        this.trailLayers.delete(id);
      }
    }

    // ---- 导弹 ----
    const activeMissileIds = new Set();
    for (const m of missiles) {
      if (!m || !m.id) continue;
      activeMissileIds.add(m.id);
      const geo = this.simToGeo(m.x, m.y);
      const latlng = [geo.lat, geo.lng];
      const color = colorOf(m.side);

      let layer = this.missileLayers.get(m.id);
      const icon = L.divIcon({
        className: 'duel-missile-icon',
        html: `<div style="transform: rotate(${90 - (m.heading || 0)}deg); font-size:14px; color:${color};
               text-shadow:0 0 6px #000;">🚀</div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8]
      });

      if (!layer) {
        layer = L.marker(latlng, { icon, interactive: false, zIndexOffset: 800 }).addTo(this.map);
        this.missileLayers.set(m.id, layer);
      } else {
        layer.setLatLng(latlng);
        layer.setIcon(icon);
      }
    }
    for (const [id, layer] of this.missileLayers) {
      if (!activeMissileIds.has(id)) {
        this.map.removeLayer(layer);
        this.missileLayers.delete(id);
      }
    }
  }

  /**
   * 空战双机实时标签：与「起飞点」区分，随推演实时跟随
   * 红方 ▲ / 蓝方 ◆，并标注机型、高度与速度
   * @param {Array} entities - 仿真实体（duel 模式下即双方战机）
   */
  updateDuelAircraft(entities = []) {
    if (!this.map) return;

    const activeIds = new Set();
    for (const e of entities) {
      if (!e || !e.side || !this.isAirType(e)) continue;
      activeIds.add(e.id);

      const isRed = e.side === 'red';
      const alive = (e.hp ?? 1) > 0;
      const shape = alive ? (isRed ? '▲' : '◆') : '✖';
      const kmh = Math.round((e.speed || 0) * 3.6);
      const text = alive
        ? `${shape} ${e.name || (isRed ? '红方' : '蓝方')} · ${Math.round(e.z || 0)}m · ${kmh}km/h`
        : `${shape} ${e.name || (isRed ? '红方' : '蓝方')} 已被击落`;

      const geo = this.simToGeo(e.x, e.y);
      const latlng = [geo.lat, geo.lng];
      const icon = L.divIcon({
        className: 'duel-air-tag-icon',
        html: `<div class="duel-air-tag ${isRed ? 'red' : 'blue'}${alive ? '' : ' down'}">${text}</div>`,
        iconSize: [132, 18],
        iconAnchor: [66, 30]
      });

      let layer = this.duelAircraftLayers.get(e.id);
      if (!layer) {
        layer = L.marker(latlng, { icon, interactive: false, zIndexOffset: 900 }).addTo(this.map);
        this.duelAircraftLayers.set(e.id, layer);
      } else {
        layer.setLatLng(latlng);
        layer.setIcon(icon);
      }
    }

    for (const [id, layer] of this.duelAircraftLayers) {
      if (!activeIds.has(id)) {
        this.map.removeLayer(layer);
        this.duelAircraftLayers.delete(id);
      }
    }
  }

  /**
   * 清空空战相关临时图层
   */
  clearDuelVisuals() {
    if (!this.map) return;
    this.trailLayers.forEach(layer => this.map.removeLayer(layer));
    this.trailLayers.clear();
    this.missileLayers.forEach(layer => this.map.removeLayer(layer));
    this.missileLayers.clear();
    this.duelAircraftLayers.forEach(layer => this.map.removeLayer(layer));
    this.duelAircraftLayers.clear();
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

      // 更新离线模式状态
      this.offlineMode = (type === 'offline');
    }
  }

  // ========== 离线地图缓存功能 ==========

  // 初始化离线缓存
  initOfflineCache() {
    // 检查是否支持IndexedDB
    if (!window.indexedDB) {
      console.warn('浏览器不支持IndexedDB，离线缓存功能不可用');
      return;
    }

    this.dbName = 'SimCombatMapCache';
    this.dbVersion = 1;
    this.tileStoreName = 'tiles';
    this.db = null;

    // 打开数据库
    const request = indexedDB.open(this.dbName, this.dbVersion);

    request.onerror = (event) => {
      console.error('离线缓存数据库打开失败:', event.target.error);
    };

    request.onsuccess = (event) => {
      this.db = event.target.result;
      console.log('离线缓存数据库已打开');
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      // 创建瓦片存储对象
      if (!db.objectStoreNames.contains(this.tileStoreName)) {
        const store = db.createObjectStore(this.tileStoreName, { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        console.log('创建离线缓存存储对象');
      }
    };
  }

  // 生成统一的 tile ID
  getTileId(coords, layerType = null) {
    const type = layerType || this.getBaseLayerType();
    // 离线模式下默认使用标准地图的 key
    const keyType = type === 'offline' ? 'standard' : type;
    return `${keyType}_${coords.z}_${coords.x}_${coords.y}`;
  }

  // 缓存瓦片到本地
  async cacheTile(url, blob, coords) {
    if (!this.db) return;

    const tileId = this.getTileId(coords);
    const data = {
      id: tileId,
      url: url,
      blob: blob,
      timestamp: Date.now(),
      zoom: coords.z,
      x: coords.x,
      y: coords.y
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.tileStoreName], 'readwrite');
      const store = transaction.objectStore(this.tileStoreName);
      const request = store.put(data);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // 从本地缓存获取瓦片 - 增强版：尝试多种缓存类型
  async getCachedTile(url, coords) {
    if (!this.db) return null;

    // 首先尝试当前底图类型
    const primaryTileId = this.getTileId(coords);
    let result = await this.getCachedTileById(primaryTileId);
    if (result) return result;

    // 如果在离线模式下，尝试其他缓存类型
    const currentType = this.getBaseLayerType();
    if (currentType === 'offline') {
      const typesToTry = ['standard', 'satellite', 'terrain'];
      for (const type of typesToTry) {
        if (type === primaryTileId.split('_')[0]) continue; // 跳过已尝试的类型
        const altTileId = this.getTileId(coords, type);
        result = await this.getCachedTileById(altTileId);
        if (result) {
          console.log(`使用 ${type} 类型的缓存瓦片替代`);
          return result;
        }
      }
    }

    return null;
  }

  // 根据 tileId 获取缓存
  async getCachedTileById(tileId) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.tileStoreName], 'readonly');
      const store = transaction.objectStore(this.tileStoreName);
      const request = store.get(tileId);

      request.onsuccess = () => {
        const result = request.result;
        if (result && result.blob) {
          resolve(URL.createObjectURL(result.blob));
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  // 清理过期缓存（默认保留30天）
  async clearOldCache(maxAge = 30 * 24 * 60 * 60 * 1000) {
    if (!this.db) return;

    const cutoff = Date.now() - maxAge;

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.tileStoreName], 'readwrite');
      const store = transaction.objectStore(this.tileStoreName);
      const index = store.index('timestamp');
      const range = IDBKeyRange.upperBound(cutoff);
      const request = index.openCursor(range);

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          store.delete(cursor.primaryKey);
          cursor.continue();
        } else {
          console.log('清理过期缓存完成');
          resolve();
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  // 获取缓存统计信息
  async getCacheStats() {
    if (!this.db) return null;

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.tileStoreName], 'readonly');
      const store = transaction.objectStore(this.tileStoreName);
      const countRequest = store.count();

      countRequest.onsuccess = () => {
        resolve({
          tileCount: countRequest.result,
          dbName: this.dbName
        });
      };
      countRequest.onerror = () => reject(countRequest.error);
    });
  }

  // 设置离线模式
  setOfflineMode(enabled) {
    this.offlineMode = enabled;
    if (enabled) {
      this.switchBaseLayer('offline');
      console.log('切换到离线地图模式');
    } else {
      this.switchBaseLayer('standard');
      console.log('切换到在线地图模式');
    }
    return this.offlineMode;
  }

  // 预缓存指定区域和缩放级别的地图
  async prefetchArea(bounds, minZoom, maxZoom) {
    console.log(`开始预缓存区域: ${bounds.toBBoxString()}, 级别: ${minZoom}-${maxZoom}`);

    const tiles = [];
    for (let z = minZoom; z <= maxZoom; z++) {
      const northEast = bounds.getNorthEast();
      const southWest = bounds.getSouthWest();

      // 计算瓦片坐标范围
      const minX = Math.floor((southWest.lng + 180) / 360 * Math.pow(2, z));
      const maxX = Math.floor((northEast.lng + 180) / 360 * Math.pow(2, z));
      const minY = Math.floor((1 - Math.log(Math.tan(northEast.lat * Math.PI / 180) + 1 / Math.cos(northEast.lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, z));
      const maxY = Math.floor((1 - Math.log(Math.tan(southWest.lat * Math.PI / 180) + 1 / Math.cos(southWest.lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, z));

      for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
          tiles.push({ z, x, y });
        }
      }
    }

    console.log(`需要缓存 ${tiles.length} 个瓦片`);

    // 实际下载并缓存瓦片
    let cachedCount = 0;
    let failedCount = 0;

    // 批量下载，每次5个并发
    const batchSize = 5;
    for (let i = 0; i < tiles.length; i += batchSize) {
      const batch = tiles.slice(i, i + batchSize);
      const promises = batch.map(async (tile) => {
        try {
          // 构建瓦片URL（使用当前底图）
          const url = this.buildTileUrl(tile);

          // 检查是否已缓存
          const cached = await this.getCachedTile(url, tile);
          if (cached) {
            cachedCount++;
            return;
          }

          // 下载瓦片
          const response = await fetch(url);
          if (response.ok) {
            const blob = await response.blob();
            await this.cacheTile(url, blob, tile);
            cachedCount++;
          } else {
            failedCount++;
            console.warn(`下载瓦片失败: ${url}`);
          }
        } catch (error) {
          failedCount++;
          console.warn(`缓存瓦片失败: ${tile.z}/${tile.x}/${tile.y}`, error);
        }
      });

      await Promise.all(promises);

      // 每完成一批，发送进度更新（可用于UI显示）
      if ((i + batchSize) % 20 === 0 || i + batchSize >= tiles.length) {
        const progress = Math.min(((i + batchSize) / tiles.length) * 100, 100);
        console.log(`缓存进度: ${progress.toFixed(1)}% (${cachedCount}/${tiles.length})`);
      }
    }

    console.log(`缓存完成: ${cachedCount} 成功, ${failedCount} 失败`);

    // 触发自定义事件通知UI
    window.dispatchEvent(new CustomEvent('mapCacheComplete', {
      detail: { total: tiles.length, cached: cachedCount, failed: failedCount }
    }));

    return { total: tiles.length, cached: cachedCount, failed: failedCount };
  }

  // 构建瓦片URL
  buildTileUrl(coords, layerType = null) {
    // 根据当前底图类型构建URL
    const { z, x, y } = coords;
    const type = layerType || this.getBaseLayerType();

    switch (type) {
      case 'standard':
        const stdSubdomain = ['1', '2', '3', '4'][(x + y) % 4];
        return `https://webrd0${stdSubdomain}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x=${x}&y=${y}&z=${z}`;
      case 'satellite':
        const satSubdomain = ['1', '2', '3', '4'][(x + y) % 4];
        return `https://webst0${satSubdomain}.is.autonavi.com/appmaptile?style=6&x=${x}&y=${y}&z=${z}`;
      case 'terrain':
        const terSubdomain = ['a', 'b', 'c'][(x + y) % 3];
        return `https://tiles.stadiamaps.com/tiles/stamen_terrain/${z}/${x}/${y}.png`;
      default:
        // 默认使用标准地图
        const defaultSubdomain = ['1', '2', '3', '4'][(x + y) % 4];
        return `https://webrd0${defaultSubdomain}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x=${x}&y=${y}&z=${z}`;
    }
  }

  // 获取当前底图类型
  getBaseLayerType() {
    if (this.baseLayer === this.baseLayers.standard) return 'standard';
    if (this.baseLayer === this.baseLayers.satellite) return 'satellite';
    if (this.baseLayer === this.baseLayers.terrain) return 'terrain';
    if (this.baseLayer === this.baseLayers.offline) return 'offline';
    return 'standard';
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

    // 绘制路径线
    const pathLine = L.polyline(latlngs, {
      color: '#ffd700',
      weight: 4,
      opacity: 0.8,
      dashArray: '10, 10',
      className: 'unit-path',
      smoothFactor: 1.5
    }).addTo(this.map);

    // 绘制路径点
    const markers = L.layerGroup().addTo(this.map);
    pathPoints.forEach((p, i) => {
      const geo = this.simToGeo(p.x, p.y);

      // 起点(绿色)、中间点(黄色)、终点(红色)
      let color = '#ffd700';
      let radius = 6;
      let label = `${i + 1}`;
      if (i === 0) {
        color = '#00ff00';
        radius = 8;
        label = '起';
      } else if (i === pathPoints.length - 1) {
        color = '#ff0000';
        radius = 8;
        label = '终';
      }

      const point = L.circleMarker([geo.lat, geo.lng], {
        radius: radius,
        fillColor: color,
        color: '#fff',
        weight: 2,
        fillOpacity: 0.9
      }).addTo(markers);

      // 添加序号标签
      point.bindTooltip(label, {
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

    // 添加方向箭头标记（使用简单SVG）
    const arrows = L.layerGroup().addTo(this.map);
    for (let i = 0; i < latlngs.length - 1; i++) {
      const from = latlngs[i];
      const to = latlngs[i + 1];
      const mid = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
      const angle = Math.atan2(to[0] - from[0], to[1] - from[1]) * 180 / Math.PI + 90;

      const arrowIcon = L.divIcon({
        className: 'path-arrow',
        html: `<svg width="16" height="16" viewBox="0 0 16 16" style="transform: rotate(${angle}deg);">
          <path d="M8 2 L14 14 L8 10 L2 14 Z" fill="#ffd700" stroke="#fff" stroke-width="1"/>
        </svg>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8]
      });

      L.marker(mid, { icon: arrowIcon }).addTo(arrows);
    }

    this.pathLayers.set(entityId, { line: pathLine, markers, arrows });
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
