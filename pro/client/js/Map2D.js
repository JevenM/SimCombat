/**
 * Map2D - Leaflet 2D地图视图
 */
class Map2D {
  constructor(containerId) {
    this.containerId = containerId;
    this.map = null;
    this.entityLayers = new Map();
    this.rangeCircles = new Map();
    this.terrainOverlay = null;
    this.selectedId = null;

    this.icons = this.createIcons();
    this.init();
  }

  init() {
    // 创建地图 - 使用 CRS.Simple 平面坐标系
    this.map = L.map(this.containerId, {
      crs: L.CRS.Simple,
      center: [50, 50],
      zoom: 5,
      minZoom: 2,
      maxZoom: 10,
      attributionControl: false,
      zoomControl: false,
      maxBounds: [[0, 0], [100, 100]]
    });

    // 添加离线网格背景层
    const GridLayer = L.GridLayer.extend({
      createTile: function(coords) {
        const tile = document.createElement('canvas');
        const tileSize = this.getTileSize();
        tile.setAttribute('width', tileSize.x);
        tile.setAttribute('height', tileSize.y);
        const ctx = tile.getContext('2d');

        // 背景色
        ctx.fillStyle = '#0d1117';
        ctx.fillRect(0, 0, tileSize.x, tileSize.y);

        // 网格线
        ctx.strokeStyle = '#21262d';
        ctx.lineWidth = 1;
        ctx.strokeRect(0, 0, tileSize.x, tileSize.y);

        // 坐标标签（在合适的缩放级别）
        if (coords.z >= 6) {
          ctx.fillStyle = '#6e7681';
          ctx.font = '10px sans-serif';
          ctx.fillText(`${coords.x},${coords.y}`, 5, 15);
        }

        return tile;
      }
    });

    this.map.addLayer(new GridLayer());

    // 点击事件
    this.map.on('click', (e) => {
      this.onMapClick?.(e);
    });

    // 添加缩放控件到右下角
    L.control.zoom({ position: 'bottomright' }).addTo(this.map);

    // 添加比例尺
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(this.map);
  }

  createIcons() {
    const createIcon = (type, color) => {
      const colors = {
        red: '#dc3545',
        blue: '#007bff'
      };
      const c = colors[color] || color;

      const icons = {
        infantry: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ccircle cx='12' cy='12' r='8' fill='${encodeURIComponent(c)}' stroke='white' stroke-width='2'/%3E%3Ctext x='12' y='16' text-anchor='middle' fill='white' font-size='10'%3EI%3C/text%3E%3C/svg%3E`,
        tank: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect x='4' y='6' width='16' height='12' rx='2' fill='${encodeURIComponent(c)}' stroke='white' stroke-width='2'/%3E%3Ctext x='12' y='16' text-anchor='middle' fill='white' font-size='9'%3ET%3C/text%3E%3C/svg%3E`,
        plane: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 2L20 8L12 14L4 8Z' fill='${encodeURIComponent(c)}' stroke='white' stroke-width='2'/%3E%3C/svg%3E`,
        ship: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M4 14L12 20L20 14L12 4Z' fill='${encodeURIComponent(c)}' stroke='white' stroke-width='2'/%3E%3Ctext x='12' y='14' text-anchor='middle' fill='white' font-size='8'%3ES%3C/text%3E%3C/svg%3E`,
        apc: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect x='5' y='7' width='14' height='10' rx='3' fill='${encodeURIComponent(c)}' stroke='white' stroke-width='2'/%3E%3C/svg%3E`,
        default: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ccircle cx='12' cy='12' r='6' fill='${encodeURIComponent(c)}' stroke='white' stroke-width='2'/%3E%3C/svg%3E`
      };

      return L.icon({
        iconUrl: icons[type] || icons.default,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
        popupAnchor: [0, -12]
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

    // 坐标转换：将仿真坐标映射到地图坐标
    // 假设仿真地图是 10000x10000 米
    const lat = entity.y / 100; // 转换为纬度
    const lng = entity.x / 100; // 转换为经度

    const icon = this.icons.createIcon(entity.type, entity.side);

    if (!layer) {
      // 创建新标记
      layer = L.marker([lat, lng], {
        icon: icon
      });

      layer.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        this.onEntityClick?.(entity);
      });

      layer.addTo(this.map);
      this.entityLayers.set(id, layer);
    } else {
      // 更新位置
      layer.setLatLng([lat, lng]);
    }

    // 更新弹出内容
    const hpPercent = (entity.hp / entity.maxHp * 100).toFixed(0);
    layer.bindPopup(`
      <b>${entity.name || entity.id}</b><br>
      阵营: ${entity.side === 'red' ? '红军' : '蓝军'}<br>
      类型: ${entity.type}<br>
      生命: ${Math.round(entity.hp)}/${entity.maxHp} (${hpPercent}%)<br>
      位置: (${Math.round(entity.x)}, ${Math.round(entity.y)})
    `);

    // 射程圆圈
    this.updateRangeCircle(entity, lat, lng, showRange);
  }

  updateRangeCircle(entity, lat, lng, showRange) {
    let circle = this.rangeCircles.get(entity.id);

    if (showRange && entity.range) {
      const radius = entity.range / 100; // 转换为度

      if (!circle) {
        circle = L.circle([lat, lng], {
          radius: radius * 111000, // 转回米
          color: entity.side === 'red' ? '#ff4444' : '#4444ff',
          fillColor: entity.side === 'red' ? '#ff4444' : '#4444ff',
          fillOpacity: 0.1,
          weight: 1
        });
        circle.addTo(this.map);
        this.rangeCircles.set(entity.id, circle);
      } else {
        circle.setLatLng([lat, lng]);
        circle.setStyle({ opacity: 1, fillOpacity: 0.1 });
      }
    } else if (circle) {
      circle.setStyle({ opacity: 0, fillOpacity: 0 });
    }
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
