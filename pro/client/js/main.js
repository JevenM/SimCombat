/**
 * SimCombat Pro - 主程序
 */
class SimCombatApp {
  constructor() {
    this.ws = null;
    this.state = null;
    this.terrain = null;
    this.replay = null;
    this.selectedEntity = null;

    // 视图组件
    this.map2d = null;
    this.view3d = null;
    this.statsPanel = null;

    // 回放状态
    this.replayInterval = null;
    this.replayIndex = 0;
    this.replayPlaying = false;

    this.init();
  }

  init() {
    // 初始化视图
    this.map2d = new Map2D('map2d');
    this.view3d = new View3D('view3d');
    this.view3d.setVisible(false); // 默认隐藏3D视图
    this.statsPanel = new StatsPanel();

    // 设置实体点击回调
    this.map2d.onEntityClick = (entity) => this.onEntityClick(entity);
    this.view3d.onEntityClick = (id) => {
      const entity = this.state?.entities.find(e => e.id === id);
      if (entity) this.onEntityClick(entity);
    };

    // 绑定事件
    this.bindEvents();

    // 连接WebSocket
    this.connect();

    // 启动小地图渲染
    setInterval(() => this.minimapRender(), 100);
  }

  connect() {
    const wsUrl = `ws://${location.host}`;
    this.updateConnectionStatus('connecting');

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.updateConnectionStatus('connected');
      this.addLog('已连接到服务器', 'success');
    };

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.handleMessage(data);
    };

    this.ws.onclose = () => {
      this.updateConnectionStatus('disconnected');
      setTimeout(() => this.connect(), 3001);
    };

    this.ws.onerror = () => {
      this.updateConnectionStatus('disconnected');
    };
  }

  handleMessage(data) {
    switch (data.type) {
      case 'state':
        this.updateState(data.state);
        break;
      case 'terrain':
        this.terrain = data.terrain;
        break;
      case 'replay':
        this.replay = data.replay;
        this.startReplay();
        break;
      case 'error':
        this.addLog(`错误: ${data.message}`, 'error');
        break;
    }
  }

  updateState(state) {
    this.state = state;

    const showLabels = document.getElementById('showLabels').checked;
    const showRange = document.getElementById('showRange').checked;

    // 更新视图
    this.map2d.updateEntities(state.entities, showLabels, showRange);
    this.view3d.updateEntities(state.entities, showLabels, showRange);

    // 更新统计面板
    this.statsPanel.update(state.stats);

    // 更新UI
    document.getElementById('simTime').textContent = `${state.time}s`;
    document.getElementById('frameCount').textContent = state.entities.length;
    document.getElementById('redUnits').textContent = state.stats.redUnits;
    document.getElementById('blueUnits').textContent = state.stats.blueUnits;

    // 更新选中实体
    if (this.selectedEntity) {
      const entity = state.entities.find(e => e.id === this.selectedEntity.id);
      if (entity) this.showEntityInfo(entity);
    }

    // 更新按钮状态
    const startBtn = document.getElementById('btnStart');
    startBtn.textContent = state.isRunning ? '⏸ 暂停' : '▶ 开始推演';
    startBtn.className = state.isRunning ? 'btn btn-warning' : 'btn btn-primary';

    document.getElementById('statusText').textContent = state.isRunning ? '推演中' : '待机';
    document.getElementById('statusText').className = state.isRunning ? 'badge running' : 'badge stopped';
  }

  bindEvents() {
    // 控制按钮
    document.getElementById('btnStart').addEventListener('click', () => {
      this.send({ cmd: this.state?.isRunning ? 'stop' : 'start' });
    });

    document.getElementById('btnStop').addEventListener('click', () => {
      this.send({ cmd: 'stop' });
    });

    document.getElementById('btnStep').addEventListener('click', () => {
      this.send({ cmd: 'step' });
    });

    document.getElementById('btnReset').addEventListener('click', () => {
      this.send({ cmd: 'reset' });
      this.statsPanel.reset();
      this.addLog('推演已重置', 'info');
    });

    // 视图切换
    document.getElementById('viewMode').addEventListener('change', (e) => {
      const mode = e.target.value;
      const map2d = document.getElementById('map2d');
      const view3d = document.getElementById('view3d');

      if (mode === 'map2d') {
        map2d.style.display = 'block';
        view3d.style.display = 'none';
        this.view3d.setVisible(false);
      } else if (mode === '3d') {
        map2d.style.display = 'none';
        view3d.style.display = 'block';
        this.view3d.setVisible(true);
        this.view3d.resize();
      } else {
        map2d.style.display = 'block';
        view3d.style.display = 'block';
        map2d.style.width = '50%';
        this.view3d.setVisible(true);
      }
    });

    // 数据操作
    document.getElementById('btnLoad').addEventListener('click', () => {
      document.getElementById('fileInput').click();
    });

    document.getElementById('btnSave').addEventListener('click', () => this.saveState());
    document.getElementById('btnReplay').addEventListener('click', () => this.send({ cmd: 'replay' }));

    document.getElementById('fileInput').addEventListener('change', (e) => {
      this.handleFileUpload(e.target.files[0]);
    });

    // 设置变更
    document.getElementById('showLabels').addEventListener('change', () => {
      if (this.state) this.updateState(this.state);
    });
    document.getElementById('showRange').addEventListener('change', () => {
      if (this.state) this.updateState(this.state);
    });

    // 回放控制
    document.getElementById('replayPlay').addEventListener('click', () => {
      this.replayPlaying = !this.replayPlaying;
      document.getElementById('replayPlay').textContent = this.replayPlaying ? '⏸' : '▶';
    });

    document.getElementById('replaySlider').addEventListener('input', (e) => {
      this.replayIndex = parseInt(e.target.value);
      this.updateReplayFrame();
    });

    document.getElementById('replayClose').addEventListener('click', () => {
      this.stopReplay();
      document.getElementById('replayBar').style.display = 'none';
    });
  }

  onEntityClick(entity) {
    this.selectedEntity = entity;
    this.showEntityInfo(entity);
    this.map2d.highlightEntity(entity.id);
  }

  startReplay() {
    if (!this.replay || this.replay.length === 0) return;

    document.getElementById('replayBar').style.display = 'flex';
    document.getElementById('replaySlider').max = this.replay.length - 1;
    this.replayIndex = 0;
    this.replayPlaying = true;

    this.replayInterval = setInterval(() => {
      if (!this.replayPlaying) return;

      if (this.replayIndex < this.replay.length - 1) {
        this.replayIndex++;
        this.updateReplayFrame();
      } else {
        this.replayPlaying = false;
        document.getElementById('replayPlay').textContent = '▶';
      }
    }, 200);
  }

  stopReplay() {
    this.replayPlaying = false;
    clearInterval(this.replayInterval);
  }

  updateReplayFrame() {
    if (!this.replay) return;
    const frame = this.replay[this.replayIndex];

    document.getElementById('replaySlider').value = this.replayIndex;
    document.getElementById('replayTime').textContent =
      `T=${Math.round(frame.time)}s (${this.replayIndex}/${this.replay.length})`;

    this.map2d.updateEntities(frame.entities, true, false);
    this.view3d.updateEntities(frame.entities, true, false);
  }

  send(data) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  showEntityInfo(entity) {
    const container = document.getElementById('selectedEntity');
    const hpPercent = Math.round(entity.hp / entity.maxHp * 100);

    container.innerHTML = `
      <div class="entity-info">
        <div class="entity-header ${entity.side}">
          <span class="entity-id">${entity.id}</span>
          <span class="entity-type">${entity.type}</span>
        </div>
        <div class="info-grid">
          <span class="label">名称:</span><span class="value">${entity.name || entity.equipmentType}</span>
          <span class="label">阵营:</span><span class="value ${entity.side}">${entity.side === 'red' ? '红军' : '蓝军'}</span>
          <span class="label">位置:</span><span class="value">${Math.round(entity.x)}, ${Math.round(entity.y)}</span>
          <span class="label">生命:</span>
          <span class="value hp-bar">
            <span class="hp-fill" style="width:${hpPercent}%;background:${hpPercent > 50 ? '#28a745' : hpPercent > 25 ? '#ffc107' : '#dc3545'}"></span>
            <span class="hp-text">${Math.round(entity.hp)}/${entity.maxHp}</span>
          </span>
          <span class="label">状态:</span><span class="value">${entity.status || '正常'}</span>
        </div>
      </div>
    `;
  }

  async saveState() {
    try {
      const res = await fetch('/api/save');
      const data = await res.json();

      if (data.success) {
        const blob = new Blob([JSON.stringify(data.snapshot, null, 2)]);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `simcombat_${Date.now()}.json`;
        a.click();
        this.addLog('推演已保存', 'success');
      }
    } catch (e) {
      this.addLog('保存失败', 'error');
    }
  }

  handleFileUpload(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const scenario = JSON.parse(e.target.result);
        this.send({ cmd: 'loadScenario', scenario });
        this.addLog('想定已加载', 'success');
      } catch {
        alert('文件格式错误');
      }
    };
    reader.readAsText(file);
  }

  addLog(msg, type = 'info') {
    const panel = document.getElementById('logPanel');
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    panel.insertBefore(entry, panel.firstChild);
    while (panel.children.length > 100) panel.removeChild(panel.lastChild);
  }

  updateConnectionStatus(status) {
    const el = document.getElementById('connection');
    el.className = `connection-status ${status}`;
    el.textContent = { connected: '已连接', connecting: '连接中...', disconnected: '未连接' }[status];
  }

  minimapRender() {
    // 可在需要时实现
  }
}

// 启动
document.addEventListener('DOMContentLoaded', () => {
  window.app = new SimCombatApp();
});
