/**
 * Minimap - 2D小地图/作战态势图
 */
class Minimap {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.entities = [];
    this.terrain = null;

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;
  }

  setTerrain(terrain) {
    this.terrain = terrain;
  }

  updateEntities(entities) {
    this.entities = entities;
  }

  render() {
    const { width, height } = this.canvas;
    const ctx = this.ctx;

    // 清空
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, width, height);

    if (!this.terrain) return;

    // 计算缩放和偏移
    const terrainWidth = this.terrain.width;
    const terrainHeight = this.terrain.height;
    const scale = Math.min(width / terrainWidth, height / terrainHeight) * 0.9;
    const offsetX = (width - terrainWidth * scale) / 2;
    const offsetY = (height - terrainHeight * scale) / 2;

    // 绘制地形（简化）
    this.drawTerrain(ctx, scale, offsetX, offsetY);

    // 绘制网格
    this.drawGrid(ctx, scale, offsetX, offsetY);

    // 绘制单位
    this.drawEntities(ctx, scale, offsetX, offsetY);

    // 绘制图例
    this.drawLegend(ctx);
  }

  drawTerrain(ctx, scale, offsetX, offsetY) {
    const { cols, rows } = this.terrain;
    const cellW = this.terrain.resolution * scale;
    const cellH = this.terrain.resolution * scale;

    for (let y = 0; y < rows; y += 2) {
      for (let x = 0; x < cols; x += 2) {
        const idx = y * cols + x;
        const type = this.terrain.terrainType[idx];

        // 根据地类型选择颜色
        const colors = [
          '#3d5a80',  // 平原
          '#2d6a4f',  // 森林
          '#457b9d',  // 城市
          '#6b705c',  // 山地
          '#0077b6',  // 水域
          '#d4a373',  // 沙漠
          '#606c38'   // 沼泽
        ];

        ctx.fillStyle = colors[type] || colors[0];
        ctx.fillRect(
          offsetX + x * this.terrain.resolution * scale / 2,
          offsetY + y * this.terrain.resolution * scale / 2,
          cellW,
          cellH
        );
      }
    }
  }

  drawGrid(ctx, scale, offsetX, offsetY) {
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 0.5;

    const gridSize = 1000 * scale; // 1km grid

    for (let x = offsetX; x < ctx.canvas.width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, ctx.canvas.height);
      ctx.stroke();
    }

    for (let y = offsetY; y < ctx.canvas.height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(ctx.canvas.width, y);
      ctx.stroke();
    }
  }

  drawEntities(ctx, scale, offsetX, offsetY) {
    for (const e of this.entities) {
      if (e.hp <= 0) continue;

      const x = offsetX + e.x * scale;
      const y = offsetY + e.y * scale;
      const size = e.type === 'infantry' ? 4 : 6;

      // 阵营颜色
      ctx.fillStyle = e.side === 'red' ? '#ff4444' : '#4444ff';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;

      // 绘制单位
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // 健康状态圆圈
      const hpPercent = e.hp / (e.maxHp || e.hp);
      if (hpPercent < 0.5) {
        ctx.strokeStyle = hpPercent < 0.3 ? '#ff0000' : '#ffff00';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, size + 3, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 选中标记
      if (e.selected) {
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, size + 5, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 类型标记
      ctx.fillStyle = '#fff';
      ctx.font = '8px sans-serif';
      ctx.textAlign = 'center';

      let typeIcon = '?';
      switch (e.type) {
        case 'tank': typeIcon = 'T'; break;
        case 'infantry': typeIcon = 'I'; break;
        case 'plane': typeIcon = 'P'; break;
        case 'ship': typeIcon = 'S'; break;
        case 'apc': typeIcon = 'A'; break;
      }
      ctx.fillText(typeIcon, x, y + size + 10);
    }
  }

  drawLegend(ctx) {
    const { width, height } = ctx.canvas;

    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(5, height - 60, 70, 55);

    ctx.font = '9px sans-serif';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';

    let y = height - 50;
    const items = [
      { color: '#ff4444', text: '红军' },
      { color: '#4444ff', text: '蓝军' },
      { color: '#2d6a4f', text: '森林' },
      { color: '#0077b6', text: '水域' }
    ];

    for (const item of items) {
      ctx.fillStyle = item.color;
      ctx.fillRect(10, y, 8, 8);
      ctx.fillStyle = '#fff';
      ctx.fillText(item.text, 22, y + 7);
      y += 12;
    }
  }
}
