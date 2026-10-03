/**
 * TerrainManager - 地形管理系统
 * 参考：OneSAF地形架构 + Cesium地形量化思路
 * 功能：高程管理、地形类型、通行性计算、视野分析
 */
class TerrainManager {
  constructor(width = 10000, height = 10000, resolution = 100) {
    this.width = width;      // 地图宽度（米）
    this.height = height;    // 地图高度（米）
    this.resolution = resolution; // 栅格分辨率（米）
    this.cols = Math.ceil(width / resolution);
    this.rows = Math.ceil(height / resolution);

    // 地形数据栅格
    this.elevation = new Float32Array(this.cols * this.rows);    // 高程（米）
    this.terrainType = new Uint8Array(this.cols * this.rows);    // 地形类型
    this.cover = new Float32Array(this.cols * this.rows);        // 隐蔽系数 0-1
    this.passability = new Float32Array(this.cols * this.rows);  // 通行系数 0-1

    // 地形类型定义
    this.TERRAIN_TYPES = {
      PLAIN: 0,      // 平原
      FOREST: 1,     // 森林
      URBAN: 2,      // 城市
      MOUNTAIN: 3,   // 山地
      WATER: 4,      // 水域
      DESERT: 5,     // 沙漠
      SWAMP: 6       // 沼泽
    };

    // 默认地形参数
    this.terrainParams = {
      [this.TERRAIN_TYPES.PLAIN]:    { speedMod: 1.0, cover: 0.0, pass: 1.0 },
      [this.TERRAIN_TYPES.FOREST]:   { speedMod: 0.6, cover: 0.7, pass: 0.8 },
      [this.TERRAIN_TYPES.URBAN]:    { speedMod: 0.5, cover: 0.8, pass: 0.7 },
      [this.TERRAIN_TYPES.MOUNTAIN]: { speedMod: 0.3, cover: 0.5, pass: 0.4 },
      [this.TERRAIN_TYPES.WATER]:    { speedMod: 0.0, cover: 0.0, pass: 0.0 },
      [this.TERRAIN_TYPES.DESERT]:   { speedMod: 0.9, cover: 0.1, pass: 0.9 },
      [this.TERRAIN_TYPES.SWAMP]:    { speedMod: 0.2, cover: 0.3, pass: 0.2 }
    };

    this.generateDefaultTerrain();
  }

  // 生成默认地形（程序化生成）
  generateDefaultTerrain() {
    // 使用 Simplex Noise 简化版生成自然地形
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const idx = y * this.cols + x;

        // 生成高程（多层噪声叠加）
        const nx = x / this.cols;
        const ny = y / this.rows;
        let elev = this.noise(nx * 3, ny * 3) * 100 +
                   this.noise(nx * 8, ny * 8) * 30 +
                   this.noise(nx * 20, ny * 20) * 5;

        // 边界降低（形成海岸效果）
        const borderDist = Math.min(
          x, y,
          this.cols - x, this.rows - y
        ) / Math.min(this.cols, this.rows) * 4;
        elev = elev * Math.min(1, borderDist);

        this.elevation[idx] = Math.max(0, elev);

        // 根据高程和噪声确定地形类型
        const forestNoise = this.noise(nx * 5 + 100, ny * 5 + 100);
        const urbanNoise = this.noise(nx * 10 + 200, ny * 10);

        if (elev < 2) {
          this.terrainType[idx] = this.TERRAIN_TYPES.WATER;
        } else if (elev > 80) {
          this.terrainType[idx] = this.TERRAIN_TYPES.MOUNTAIN;
        } else if (forestNoise > 0.3 && elev < 50) {
          this.terrainType[idx] = this.TERRAIN_TYPES.FOREST;
        } else if (urbanNoise > 0.7) {
          this.terrainType[idx] = this.TERRAIN_TYPES.URBAN;
        } else {
          this.terrainType[idx] = this.TERRAIN_TYPES.PLAIN;
        }

        // 计算隐蔽和通行系数
        this.updateCellParams(idx);
      }
    }
  }

  // 快速伪随机噪声（简化版Perlin噪声）
  noise(x, y) {
    const n = Math.floor(x) + Math.floor(y) * 57;
    const nn = (n << 13) ^ n;
    return (1.0 - ((nn * (nn * nn * 15731 + 789221) + 1376312589) & 0x7fffffff) / 1073741824.0);
  }

  // 更新单元格参数
  updateCellParams(idx) {
    const type = this.terrainType[idx];
    const elev = this.elevation[idx];
    const params = this.terrainParams[type];

    // 坡度计算（简化为与周围高程差异）
    this.cover[idx] = params.cover;
    this.passability[idx] = params.pass;

    // 高程变化影响坡度，进而影响通行
    if (type !== this.TERRAIN_TYPES.WATER) {
      const slope = this.calculateSlopeAtIndex(idx);
      if (slope > 30) {
        this.passability[idx] *= 0.5;
        this.cover[idx] = Math.min(1, this.cover[idx] + 0.2);
      }
    }
  }

  // 计算坡度（度）
  calculateSlopeAtIndex(idx) {
    const x = idx % this.cols;
    const y = Math.floor(idx / this.cols);
    if (x === 0 || x === this.cols - 1 || y === 0 || y === this.rows - 1) return 0;

    const dx = (this.elevation[y * this.cols + (x + 1)] -
                this.elevation[y * this.cols + (x - 1)]) / (2 * this.resolution);
    const dy = (this.elevation[(y + 1) * this.cols + x] -
                this.elevation[(y - 1) * this.cols + x]) / (2 * this.resolution);

    return Math.atan(Math.sqrt(dx * dx + dy * dy)) * 180 / Math.PI;
  }

  // 世界坐标转栅格索引
  worldToGrid(x, y) {
    const gx = Math.floor(x / this.resolution);
    const gy = Math.floor(y / this.resolution);
    if (gx < 0 || gx >= this.cols || gy < 0 || gy >= this.rows) return -1;
    return gy * this.cols + gx;
  }

  // 栅格索引转世界坐标（中心点）
  gridToWorld(idx) {
    const gx = idx % this.cols;
    const gy = Math.floor(idx / this.cols);
    return {
      x: (gx + 0.5) * this.resolution,
      y: (gy + 0.5) * this.resolution
    };
  }

  // 获取位置高程
  getElevation(x, y) {
    const idx = this.worldToGrid(x, y);
    return idx >= 0 ? this.elevation[idx] : 0;
  }

  // 获取地形类型
  getTerrainType(x, y) {
    const idx = this.worldToGrid(x, y);
    return idx >= 0 ? this.terrainType[idx] : this.TERRAIN_TYPES.PLAIN;
  }

  // 获取地形参数
  getTerrainParams(x, y) {
    const idx = this.worldToGrid(x, y);
    if (idx < 0) return { speedMod: 1, cover: 0, pass: 1, elevation: 0, type: 0, typeName: 'PLAIN' };

    const type = this.terrainType[idx];
    const params = this.terrainParams[type] || this.terrainParams[this.TERRAIN_TYPES.PLAIN];

    return {
      type: type,
      typeName: Object.keys(this.TERRAIN_TYPES).find(k => this.TERRAIN_TYPES[k] === type) || 'PLAIN',
      speedMod: params.speedMod,
      cover: this.cover[idx],
      pass: this.passability[idx],
      elevation: this.elevation[idx]
    };
  }

  // 计算移动速度修正
  getMovementSpeedModifier(x, y, mobilityType = 'wheeled') {
    // 空中单位不受地形通行性与地物影响（否则水域/山地 pass=0 会让战机无法移动）
    if (mobilityType === 'flight') return 1;

    const params = this.getTerrainParams(x, y);
    if (params.pass <= 0) return 0;

    // 不同机动类型对不同地形的适应性
    const mobilityMods = {
      foot: { [this.TERRAIN_TYPES.FOREST]: 0.9, [this.TERRAIN_TYPES.MOUNTAIN]: 0.6, [this.TERRAIN_TYPES.SWAMP]: 0.4 },
      wheeled: { [this.TERRAIN_TYPES.FOREST]: 0.5, [this.TERRAIN_TYPES.MOUNTAIN]: 0.2 },
      tracked: { [this.TERRAIN_TYPES.FOREST]: 0.8, [this.TERRAIN_TYPES.MOUNTAIN]: 0.5 },
      flight: {},
      naval: { [this.TERRAIN_TYPES.WATER]: 1.0 }
    };

    const typeMod = mobilityMods[mobilityType]?.[params.type] ?? params.speedMod;
    return typeMod * params.pass;
  }

  // 视线检测（LOS - Line of Sight）
  hasLineOfSight(x1, y1, x2, y2, height1 = 2, height2 = 2) {
    const dist = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.ceil(dist / this.resolution);

    const elev1 = this.getElevation(x1, y1) + height1;
    const elev2 = this.getElevation(x2, y2) + height2;

    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = x1 + (x2 - x1) * t;
      const y = y1 + (y2 - y1) * t;
      const groundElev = this.getElevation(x, y);
      const lineElev = elev1 + (elev2 - elev1) * t;

      // 如果地面高于视线，则遮挡
      if (groundElev > lineElev) {
        return false;
      }
    }
    return true;
  }

  // 视线受地形影响程度（0-1，1为完全可见）
  getVisibilityFactor(x1, y1, x2, y2) {
    const dist = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.ceil(dist / this.resolution);
    let obstruction = 0;

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x1 + (x2 - x1) * t;
      const y = y1 + (y2 - y1) * t;
      const params = this.getTerrainParams(x, y);
      obstruction = Math.max(obstruction, params.cover * (1 - t * 0.5));
    }

    return Math.max(0, 1 - obstruction);
  }

  // 从外部数据加载地形（GeoTIFF格式简化版）
  loadFromData(elevationData, terrainTypeData) {
    if (elevationData.length === this.elevation.length) {
      this.elevation.set(elevationData);
    }
    if (terrainTypeData && terrainTypeData.length === this.terrainType.length) {
      this.terrainType.set(terrainTypeData);
    }
    // 重新计算参数
    for (let i = 0; i < this.cols * this.rows; i++) {
      this.updateCellParams(i);
    }
  }

  // 导出地形数据
  exportTerrain() {
    return {
      width: this.width,
      height: this.height,
      resolution: this.resolution,
      elevation: Array.from(this.elevation),
      terrainType: Array.from(this.terrainType)
    };
  }
}

module.exports = TerrainManager;
