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

    // 演习模式默认不显示演习区域
    this.simMode = 'exercise';
    this.exerciseAreaSet = false;
    this.map2d.clearExerciseArea();

    // 初始化攻击动画管理器
    this.attackAnimations = null; // 等待地图初始化完成后再创建

    // 设置实体点击回调
    this.map2d.onEntityClick = (entity) => this.onEntityClick(entity);
    this.view3d.onEntityClick = (id) => {
      const entity = this.state?.entities.find(e => e.id === id);
      if (entity) this.onEntityClick(entity);
    };

    // 等待地图初始化后创建动画管理器
    setTimeout(() => {
      if (this.map2d.map) {
        this.attackAnimations = new AttackAnimations(this.map2d.map);
      }
    }, 1000);

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
      case 'entityDetails':
        this.showEntityDetails(data.details);
        break;
      case 'commandResult':
        if (data.success) {
          const cmdNames = { move: '移动', attack: '攻击', hold: '部署' };
          this.addLog(`命令执行成功: ${cmdNames[data.cmd] || data.cmd}`, 'success');
        }
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
    this.statsPanel.update(state.stats, state.combatEvents || [], state.isRunning, state.time);

    // 更新UI
    document.getElementById('simTime').textContent = `${state.time}s`;
    document.getElementById('entityCount').textContent = state.entities.length;
    document.getElementById('redUnits').textContent = state.stats.redUnits;
    document.getElementById('blueUnits').textContent = state.stats.blueUnits;

    // 显示步数（在实体数量旁添加）
    const stepInfo = state.stepCount !== undefined ? ` (步#${state.stepCount})` : '';
    document.getElementById('entityCount').textContent = state.entities.length + stepInfo;

    // 更新选中实体 - 实时更新侧边栏显示
    if (this.selectedEntity) {
      const entity = state.entities.find(e => e.id === this.selectedEntity.id);
      if (entity) {
        this.selectedEntity = entity;
        // 实时更新侧边栏显示
        this.showEntityInfo(entity);
      } else {
        this.selectedEntity = null;
        document.getElementById('selectedEntity').innerHTML = '<p class="no-selection">单位已销毁</p>';
      }
    }

    // 添加战斗日志
    if (state.combatEvents && state.combatEvents.length > 0) {
      for (const event of state.combatEvents) {
        this.addCombatLog(event);
      }
    }

    // 更新按钮状态
    const startBtn = document.getElementById('btnStart');
    startBtn.textContent = state.isRunning ? '⏸ 暂停' : '▶ 开始推演';
    startBtn.className = state.isRunning ? 'btn btn-warning' : 'btn btn-primary';

    document.getElementById('statusText').textContent = state.isRunning ? '推演中' : '待机';
    document.getElementById('statusText').className = state.isRunning ? 'badge running' : 'badge stopped';
  }

  bindEvents() {
    // 控制按钮 - 添加模式检查
    document.getElementById('btnStart').addEventListener('click', () => {
      // 演习模式下检查是否已划定区域
      if (this.simMode === 'exercise' && !this.exerciseAreaSet) {
        this.addLog('⚠️ 演习模式：请先在地图上划定演习区域', 'warning');
        return;
      }
      // 演习模式下检查是否有单位
      if (this.simMode === 'exercise' && (!this.state?.entities || this.state.entities.length === 0)) {
        this.addLog('⚠️ 演习模式：请先配置想定（添加单位）', 'warning');
        return;
      }
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

    // 演习区域设置按钮
    document.getElementById('btnSetArea')?.addEventListener('click', () => {
      this.startAreaSelection();
    });

    document.getElementById('btnMoveArea')?.addEventListener('click', () => {
      this.startAreaMove();
    });

    document.getElementById('btnDeleteArea')?.addEventListener('click', () => {
      this.deleteExerciseArea();
    });

    document.getElementById('btnResetArea')?.addEventListener('click', () => {
      this.resetExerciseArea();
    });

    // 侧边栏切换按钮
    const leftToggle = document.getElementById('toggleLeftPanel');
    const rightToggle = document.getElementById('toggleRightPanel');
    const leftPanel = document.getElementById('leftPanel');
    const rightPanel = document.getElementById('rightPanel');

    if (leftToggle && leftPanel) {
      leftToggle.addEventListener('click', () => {
        leftPanel.classList.toggle('collapsed');
        leftToggle.classList.toggle('collapsed');
        leftToggle.textContent = leftPanel.classList.contains('collapsed') ? '▶' : '◀';
        // 触发地图resize
        setTimeout(() => this.map2d.map.invalidateSize(), 300);
      });
    }

    if (rightToggle && rightPanel) {
      rightToggle.addEventListener('click', () => {
        rightPanel.classList.toggle('collapsed');
        rightToggle.classList.toggle('collapsed');
        rightToggle.textContent = rightPanel.classList.contains('collapsed') ? '◀' : '▶';
        // 触发地图resize
        setTimeout(() => this.map2d.map.invalidateSize(), 300);
      });
    }

    // 视图切换
    document.getElementById('viewMode').addEventListener('change', (e) => {
      const mode = e.target.value;
      const map2d = document.getElementById('map2d');
      const view3d = document.getElementById('view3d');

      if (mode === 'map2d') {
        map2d.style.display = 'block';
        map2d.style.width = '100%';
        view3d.style.display = 'none';
        this.view3d.setVisible(false);
      } else if (mode === '3d') {
        map2d.style.display = 'none';
        view3d.style.display = 'block';
        view3d.style.width = '100%';
        this.view3d.setVisible(true);
        this.view3d.resize();
      } else if (mode === 'split') {
        map2d.style.display = 'block';
        map2d.style.width = '50%';
        view3d.style.display = 'block';
        view3d.style.width = '50%';
        this.view3d.setVisible(true);
        this.view3d.resize();
      }
    });

    // 想定编辑器事件
    this.initScenarioEditor();

    // 数据操作
    document.getElementById('btnLoad').addEventListener('click', () => {
      document.getElementById('fileInput').click();
    });

    document.getElementById('btnSave').addEventListener('click', () => this.saveState());
    document.getElementById('btnReplay').addEventListener('click', () => this.send({ cmd: 'replay' }));

    // 查看红方/蓝方位置
    document.getElementById('btnViewRed').addEventListener('click', () => this.focusOnSide('red'));
    document.getElementById('btnViewBlue').addEventListener('click', () => this.focusOnSide('blue'));

    document.getElementById('fileInput').addEventListener('change', (e) => {
      this.handleFileUpload(e.target.files[0]);
    });

    // 地图双击事件 - 结束路径绘制
    this.map2d.map.on('dblclick', () => {
      if (this.editorMode === 'setPath' && this.pathDrawing) {
        this.finishPathDrawing();
      }
    });

    // 设置变更
    document.getElementById('showLabels').addEventListener('change', () => {
      if (this.state) this.updateState(this.state);
    });
    document.getElementById('showRange').addEventListener('change', () => {
      if (this.state) this.updateState(this.state);
    });

    // 底图切换
    document.getElementById('baseMapType')?.addEventListener('change', (e) => {
      this.map2d.switchBaseLayer(e.target.value);
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
    // 点击时打开悬浮详情窗口
    const layer = this.map2d.entityLayers.get(entity.id);
    if (layer) {
      layer.openPopup();
    }
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

    // 计算速度 (km/h)
    const speedKmh = entity.speed ? Math.round(entity.speed * 3.6 * 10) / 10 : 0;

    // 获取状态文本
    const statusText = this.getStatusText(entity.status);

    // 获取探测到的目标信息
    let targetInfo = '无';
    if (entity.detectedContacts > 0) {
      targetInfo = `发现 ${entity.detectedContacts} 个目标`;
    }

    container.innerHTML = `
      <div class="entity-info" style="font-size: 12px;">
        <div class="entity-header ${entity.side}" style="display:flex; justify-content:space-between; padding:6px 10px; background:rgba(233,69,96,0.2); border-radius:4px; margin-bottom:10px; border:1px solid ${entity.side === 'red' ? '#ff6b6b' : '#4dabf7'};">
          <span style="font-weight:bold;">${entity.id}</span>
          <span style="opacity:0.8;">${entity.equipmentType}</span>
        </div>

        <!-- 实时作战状态 -->
        <div style="margin-bottom:12px; padding:8px; background:#0d1117; border-radius:4px;">
          <div style="color:#f0883e; font-weight:bold; margin-bottom:6px;">⚔️ 当前动作</div>
          <div style="display:grid; grid-template-columns:auto 1fr; gap:4px 8px;">
            <span style="color:#888;">状态:</span>
            <span style="color:${entity.status === 'attacking' ? '#ff6b6b' : entity.status === 'moving' ? '#4dabf7' : '#51cf66'};">${statusText}</span>

            <span style="color:#888;">速度:</span>
            <span>${speedKmh} km/h</span>

            <span style="color:#888;">航向:</span>
            <span>${Math.round(entity.heading || 0)}°</span>

            <span style="color:#888;">位置:</span>
            <span>(${Math.round(entity.x)}, ${Math.round(entity.y)})</span>

            <span style="color:#888;">高度:</span>
            <span>${Math.round(entity.z || 0)}m</span>
          </div>
        </div>

        <!-- 火力与探测 -->
        <div style="margin-bottom:12px; padding:8px; background:#0d1117; border-radius:4px;">
          <div style="color:#ff6b6b; font-weight:bold; margin-bottom:6px;">🎯 火力与探测</div>
          <div style="display:grid; grid-template-columns:auto 1fr; gap:4px 8px;">
            <span style="color:#888;">射程:</span><span>${entity.range || '-'}m</span>
            <span style="color:#888;">伤害:</span><span>${entity.damage || '-'}</span>
            <span style="color:#888;">视野:</span><span>${entity.vision || '-'}m</span>
            <span style="color:#888;">探测目标:</span><span style="color:${entity.detectedContacts > 0 ? '#ff6b6b' : '#888'};">${targetInfo}</span>
          </div>
        </div>

        <!-- 生命值 -->
        <div style="padding:8px; background:#0d1117; border-radius:4px;">
          <div style="color:#51cf66; font-weight:bold; margin-bottom:6px;">❤️ 生命值</div>
          <div class="hp-bar" style="position:relative; height:18px; background:#30363d; border-radius:3px; overflow:hidden;">
            <span class="hp-fill" style="position:absolute; height:100%; width:${hpPercent}%; background:${hpPercent > 50 ? '#28a745' : hpPercent > 25 ? '#ffc107' : '#dc3545'}; transition:width 0.3s;"></span>
            <span class="hp-text" style="position:absolute; top:0; left:0; right:0; text-align:center; font-size:10px; line-height:18px; color:#fff; text-shadow:0 0 2px #000;">${Math.round(entity.hp)}/${entity.maxHp}</span>
          </div>
        </div>
      </div>
    `;
  }

  // 显示实体详细信息
  showEntityDetails(details) {
    if (!details) {
      console.warn('showEntityDetails called with null details');
      return;
    }
    const container = document.getElementById(`entityDetails_${details.id}`);
    if (!container) return;

    const weapons = details.weapons;
    const detection = details.detection;
    const defense = details.defense;
    const effects = details.effects;
    const targets = details.targets;

    // 构建探测到的目标列表
    let contactsHtml = '';
    const contactCount = targets?.detectedContacts?.length || 0;
    if (contactCount > 0) {
      contactsHtml = `
        <div class="contacts-list">
          <h5>🔍 探测到的目标 (${contactCount})</h5>
          ${targets.detectedContacts.map(c => `
            <div class="contact-item ${c?.side || 'unknown'}">
              <span>${c?.id || '未知'} (${c?.type || '未知'})</span>
              <span>距离 ${c?.distance || '-'}m</span>
              <button class="btn btn-small" onclick="window.app.commandAttack('${details.id}', '${c?.id}')">攻击</button>
            </div>
          `).join('')}
        </div>
      `;
    } else {
      contactsHtml = '<div class="no-contacts">未探测到敌方目标</div>';
    }

    container.innerHTML = `
      <div class="entity-details">
        <h5>⚔️ 武器属性</h5>
        <div class="weapon-stats">
          <div class="stat-row">
            <span class="stat-label">射程:</span>
            <span class="stat-value weapons-range">${weapons.range}m</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">伤害:</span>
            <span class="stat-value weapons-damage">${weapons.damage}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">射速:</span>
            <span class="stat-value weapons-rate">${weapons.fireRate}/s</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">精度:</span>
            <span class="stat-value weapons-accuracy">${Math.round(weapons.accuracy * 100)}%</span>
          </div>
        </div>

        <h5>🔭 探测能力</h5>
        <div class="detection-stats">
          <div class="stat-row">
            <span class="stat-label">视野:</span>
            <span class="stat-value detection-vision">${detection.vision}m</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">雷达:</span>
            <span class="stat-value detection-radar">${detection.detection * 10}m</span>
          </div>
        </div>

        <h5>🛡️ 防御属性</h5>
        <div class="defense-stats">
          <div class="stat-row">
            <span class="stat-label">护甲:</span>
            <span class="stat-value defense-armor">${Math.round(defense.armor * 100)}%</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">闪避:</span>
            <span class="stat-value defense-evasion">${Math.round(defense.evasion * 100)}%</span>
          </div>
        </div>

        ${effects.deployed ? '<div class="effect-badge deployed">✓ 已部署（精度+20%）</div>' : ''}

        ${contactsHtml}
      </div>
    `;
  }

  getStatusText(status) {
    const statusMap = {
      'idle': '待机',
      'moving': '移动中',
      'attacking': '攻击中',
      'deployed': '已部署',
      'retreating': '撤退中',
      'patrolling': '巡逻中'
    };
    return statusMap[status] || status || '待机';
  }

  // 开始移动模式（在地图上点击目的地）
  startMoveMode(entityId) {
    this.moveModeEntityId = entityId;
    this.map2d.map.getContainer().style.cursor = 'crosshair';
    this.addLog('请点击地图选择移动目的地', 'info');

    // 临时替换地图点击事件
    this.map2d._originalOnMapClick = this.map2d.onMapClick;
    this.map2d.onMapClick = (e) => {
      const simPos = this.map2d.geoToSim(e.latlng.lat, e.latlng.lng);
      this.commandMove(entityId, simPos.x, simPos.y);

      // 恢复原始点击事件
      this.map2d.onMapClick = this.map2d._originalOnMapClick;
      this.map2d.map.getContainer().style.cursor = '';
      this.moveModeEntityId = null;
    };
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

  // 保存回放
  async saveReplay() {
    try {
      const res = await fetch('/api/replay');
      const data = await res.json();

      if (data.replay && data.replay.length > 0) {
        const blob = new Blob([JSON.stringify(data.replay, null, 2)]);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `simcombat_replay_${Date.now()}.json`;
        a.click();
        this.addLog('回放已保存', 'success');
      } else {
        this.addLog('没有可保存的回放数据', 'warning');
      }
    } catch (e) {
      this.addLog('保存回放失败', 'error');
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
    const timestamp = new Date().toLocaleTimeString();
    entry.textContent = `[${timestamp}] ${msg}`;
    panel.insertBefore(entry, panel.firstChild);
    while (panel.children.length > 100) panel.removeChild(panel.lastChild);

    // 同时保存到本地存储
    this.saveLogToStorage(`[${timestamp}] [${type}] ${msg}`);
  }

  // 保存日志到本地存储
  saveLogToStorage(logEntry) {
    try {
      let logs = JSON.parse(localStorage.getItem('simcombat_logs') || '[]');
      logs.push({
        time: Date.now(),
        entry: logEntry
      });
      // 只保留最近1000条
      if (logs.length > 1000) logs = logs.slice(-1000);
      localStorage.setItem('simcombat_logs', JSON.stringify(logs));
    } catch (e) {
      console.error('Failed to save log:', e);
    }
  }

  // 导出日志到文件
  exportLogs() {
    try {
      const logs = JSON.parse(localStorage.getItem('simcombat_logs') || '[]');
      if (logs.length === 0) {
        this.addLog('没有可导出的日志', 'warning');
        return;
      }
      const content = logs.map(l => `[${new Date(l.time).toLocaleString()}] ${l.entry}`).join('\n');
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `simcombat_logs_${Date.now()}.txt`;
      a.click();
      this.addLog('日志已导出', 'success');
    } catch (e) {
      this.addLog('导出日志失败', 'error');
    }
  }

  addCombatLog(event) {
    const sideColor = event.attackerSide === 'red' ? '红' : '蓝';
    const sideClass = event.attackerSide === 'red' ? 'red' : 'blue';
    const hitStatus = event.hit ? `命中! 伤害${event.damage}` : '未命中';

    // 处理未定义的名称
    const attackerName = event.attackerName || event.attacker?.split('_')[0] || '未知单位';
    const targetName = event.targetName || event.target?.split('_')[0] || '目标';
    const attackerId = event.attacker || '?';
    const targetId = event.target || '?';
    const distance = event.distance || '?';

    const msg = `[步${event.step}] ${sideColor}方${attackerName}(${attackerId}) → ${targetName}(${targetId}), 距离${distance}m, ${hitStatus}`;
    this.addLog(msg, 'combat');
  }

  updateConnectionStatus(status) {
    const el = document.getElementById('connection');
    el.className = `connection-status ${status}`;
    el.textContent = { connected: '已连接', connecting: '连接中...', disconnected: '未连接' }[status];
  }

  // ========== 想定编辑器功能 ==========
  initScenarioEditor() {
    this.editorMode = 'view'; // view, addRed, addBlue, remove
    this.selectedUnitType = 'tank';
    this.simMode = 'exercise'; // 'exercise' 或 'combat'
    this.exerciseAreaSet = false;

    const modeSelect = document.getElementById('editorMode');
    const unitSelector = document.getElementById('unitSelector');
    const unitTypeSelect = document.getElementById('unitType');
    const hint = document.getElementById('editorHint');
    const simModeSelect = document.getElementById('simMode');
    const modeHint = document.getElementById('modeHint');

    // 推演模式切换
    if (simModeSelect) {
      simModeSelect.addEventListener('change', (e) => {
        this.simMode = e.target.value;
        if (this.simMode === 'exercise') {
          modeHint.innerHTML = '💡 演习模式：请先划定演习区域，配置兵力后再开始推演';
          modeHint.style.borderLeftColor = '#f0883e';
          // 演习模式下清空默认单位并隐藏演习区域
          this.send({ cmd: 'clearAllEntities' });
          this.exerciseAreaSet = false;
          this.map2d.clearExerciseArea();
        } else {
          modeHint.innerHTML = '💡 实战模式：可直接部署兵力，系统已加载预设对抗态势';
          modeHint.style.borderLeftColor = '#238636';
          // 实战模式下加载默认想定并显示默认演习区域
          this.send({ cmd: 'reset' });
          this.exerciseAreaSet = true;
          this.map2d.setExerciseArea([[39.4, 115.9], [40.4, 116.9]]);
        }
      });
    }

    // 模式切换
    modeSelect.addEventListener('change', (e) => {
      this.editorMode = e.target.value;
      const isAddMode = this.editorMode === 'addRed' || this.editorMode === 'addBlue';
      unitSelector.style.display = isAddMode ? 'block' : 'none';

      // 清除之前的路径绘制状态
      if (this.pathDrawing) {
        this.cancelPathDrawing();
      }

      if (this.editorMode === 'view') {
        hint.textContent = '💡 仅查看模式，可以查看和选择单位';
        this.map2d.map.getContainer().style.cursor = '';
      } else if (this.editorMode.startsWith('add')) {
        hint.textContent = '💡 点击地图放置单位';
        this.map2d.map.getContainer().style.cursor = 'crosshair';
      } else if (this.editorMode === 'remove') {
        hint.textContent = '💡 点击单位删除';
        this.map2d.map.getContainer().style.cursor = 'not-allowed';
      } else if (this.editorMode === 'move') {
        hint.textContent = '💡 点击选择要移动的单位，然后点击新位置放置';
        this.map2d.map.getContainer().style.cursor = 'move';
      } else if (this.editorMode === 'setPath') {
        hint.textContent = '💡 点击单位开始设置路径，然后在地图上点击添加路径点，双击结束';
        this.map2d.map.getContainer().style.cursor = 'crosshair';
      }
    });

    // 单位类型选择
    unitTypeSelect.addEventListener('change', (e) => {
      this.selectedUnitType = e.target.value;
    });

    // 地图点击事件 - 添加/删除单位/设置路径
    this.map2d.onMapClick = (e) => {
      if (this.editorMode === 'view') return;

      if (this.editorMode === 'remove') {
        // 删除模式：查找最近的单位并删除
        this.removeNearestEntity(e.latlng);
        return;
      }

      if (this.editorMode === 'move') {
        // 移动模式
        this.handleMoveEntity(e);
        return;
      }

      if (this.editorMode === 'setPath') {
        // 设置路径模式
        this.handlePathDrawing(e);
        return;
      }

      if (this.editorMode.startsWith('add')) {
        // 添加模式
        const side = this.editorMode === 'addRed' ? 'red' : 'blue';
        this.addEntityAt(side, this.selectedUnitType, e.latlng);
      }
    };

    // 按钮事件
    document.getElementById('btnClearAll').addEventListener('click', () => {
      if (confirm('确定要清空所有单位吗？')) {
        this.clearAllEntities();
      }
    });

    document.getElementById('btnSaveScenario').addEventListener('click', () => {
      this.saveScenario();
    });

    document.getElementById('btnExportLogs')?.addEventListener('click', () => {
      this.exportLogs();
    });

    // 预设想定加载
    document.getElementById('btnLoadPreset').addEventListener('click', () => {
      const preset = document.getElementById('presetScenario').value;
      if (preset) {
        this.loadPresetScenario(preset);
      } else {
        alert('请先选择一个预设想定');
      }
    });
  }

  // 加载预设想定
  loadPresetScenario(presetType) {
    const presets = {
      skirmish: {
        name: '遭遇战',
        entities: [
          { side: 'red', equipmentType: 'tank', x: 2000, y: 2000, aiType: 'combat' },
          { side: 'red', equipmentType: 'infantry', x: 2200, y: 2100, aiType: 'combat' },
          { side: 'blue', equipmentType: 'tank', x: 6000, y: 6000, aiType: 'defensive' },
          { side: 'blue', equipmentType: 'infantry', x: 5800, y: 5900, aiType: 'defensive' }
        ]
      },
      assault: {
        name: '进攻作战',
        entities: [
          { side: 'red', equipmentType: 'tank', x: 1500, y: 1500, aiType: 'combat' },
          { side: 'red', equipmentType: 'tank', x: 1800, y: 1600, aiType: 'combat' },
          { side: 'red', equipmentType: 'apc', x: 1600, y: 1700, aiType: 'combat' },
          { side: 'red', equipmentType: 'infantry', x: 1700, y: 1800, aiType: 'combat' },
          { side: 'red', equipmentType: 'artillery', x: 1000, y: 1000, aiType: 'artillery' },
          { side: 'blue', equipmentType: 'tank', x: 6500, y: 6500, aiType: 'defensive' },
          { side: 'blue', equipmentType: 'tank', x: 6200, y: 6400, aiType: 'defensive' },
          { side: 'blue', equipmentType: 'infantry', x: 6300, y: 6300, aiType: 'defensive' },
          { side: 'blue', equipmentType: 'air_defense', x: 6400, y: 6200, aiType: 'defensive' }
        ]
      },
      combined: {
        name: '联合作战',
        entities: [
          { side: 'red', equipmentType: 'tank', x: 2000, y: 2000, aiType: 'combat' },
          { side: 'red', equipmentType: 'tank', x: 2200, y: 2100, aiType: 'combat' },
          { side: 'red', equipmentType: 'apc', x: 2100, y: 1900, aiType: 'combat' },
          { side: 'red', equipmentType: 'infantry', x: 2300, y: 2000, aiType: 'combat' },
          { side: 'red', equipmentType: 'fighter', x: 2500, y: 2500, z: 5000, aiType: 'combat' },
          { side: 'red', equipmentType: 'artillery', x: 1500, y: 1500, aiType: 'artillery' },
          { side: 'blue', equipmentType: 'tank', x: 6000, y: 6000, aiType: 'defensive' },
          { side: 'blue', equipmentType: 'tank', x: 5800, y: 5900, aiType: 'defensive' },
          { side: 'blue', equipmentType: 'apc', x: 5900, y: 6100, aiType: 'defensive' },
          { side: 'blue', equipmentType: 'infantry', x: 5700, y: 5800, aiType: 'defensive' },
          { side: 'blue', equipmentType: 'fighter', x: 5500, y: 5500, z: 5000, aiType: 'combat' },
          { side: 'blue', equipmentType: 'air_defense', x: 6200, y: 6200, aiType: 'defensive' }
        ]
      },
      naval: {
        name: '海空对抗',
        entities: [
          { side: 'red', equipmentType: 'destroyer', x: 2000, y: 5000, aiType: 'combat' },
          { side: 'red', equipmentType: 'submarine', x: 2500, y: 5500, aiType: 'combat' },
          { side: 'red', equipmentType: 'fighter', x: 3000, y: 4000, z: 5000, aiType: 'combat' },
          { side: 'blue', equipmentType: 'carrier', x: 7000, y: 5000, aiType: 'defensive' },
          { side: 'blue', equipmentType: 'destroyer', x: 6500, y: 4500, aiType: 'defensive' },
          { side: 'blue', equipmentType: 'fighter', x: 6000, y: 4000, z: 5000, aiType: 'combat' }
        ]
      },
      asymmetric: {
        name: '非对称作战',
        entities: [
          { side: 'red', equipmentType: 'tank', x: 5000, y: 5000, aiType: 'combat' },
          { side: 'red', equipmentType: 'tank', x: 5200, y: 5100, aiType: 'combat' },
          { side: 'red', equipmentType: 'apc', x: 5100, y: 4900, aiType: 'combat' },
          { side: 'blue', equipmentType: 'infantry', x: 8000, y: 8000, aiType: 'defensive' },
          { side: 'blue', equipmentType: 'infantry', x: 8200, y: 7900, aiType: 'defensive' },
          { side: 'blue', equipmentType: 'uav', x: 7500, y: 7500, z: 300, aiType: 'scout' },
          { side: 'blue', equipmentType: 'artillery', x: 7800, y: 7800, aiType: 'artillery' }
        ]
      },
      air_superiority: {
        name: '制空权争夺',
        entities: [
          { side: 'red', equipmentType: 'fighter', x: 2000, y: 5000, z: 6000, aiType: 'combat' },
          { side: 'red', equipmentType: 'fighter', x: 2500, y: 5500, z: 6000, aiType: 'combat' },
          { side: 'red', equipmentType: 'bomber', x: 1500, y: 4500, z: 8000, aiType: 'combat' },
          { side: 'red', equipmentType: 'air_defense', x: 2000, y: 4000, aiType: 'defensive' },
          { side: 'blue', equipmentType: 'fighter', x: 7000, y: 5000, z: 6000, aiType: 'combat' },
          { side: 'blue', equipmentType: 'fighter', x: 6500, y: 5500, z: 6000, aiType: 'combat' },
          { side: 'blue', equipmentType: 'air_defense', x: 7500, y: 4500, aiType: 'defensive' },
          { side: 'blue', equipmentType: 'radar', x: 7200, y: 4800, aiType: 'defensive' }
        ]
      }
    };

    const scenario = presets[presetType];
    if (scenario) {
      this.send({ cmd: 'loadScenario', scenario });
      this.addLog(`已加载预设想定: ${scenario.name}`, 'success');
    }
  }

  // 在指定位置添加单位
  addEntityAt(side, equipmentType, latlng) {
    // 地理坐标 -> 仿真坐标
    const simPos = this.map2d.geoToSim(latlng.lat, latlng.lng);
    const clampedX = simPos.x;
    const clampedY = simPos.y;

    const id = `e${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

    this.send({
      cmd: 'createEntity',
      config: {
        id: id,
        side: side,
        equipmentType: equipmentType,
        x: clampedX,
        y: clampedY,
        aiType: 'combat'
      }
    });

    const sideName = side === 'red' ? '红军' : '蓝军';
    this.addLog(`已添加 ${sideName} ${equipmentType} 到 (${clampedX}, ${clampedY})`, 'success');
  }

  // 通过ID删除单位（用于地图点击删除）
  removeEntityById(entityId) {
    this.send({ cmd: 'removeEntity', entityId });
    this.addLog(`已删除单位 ${entityId}`, 'info');
  }

  // 删除最近的单位
  removeNearestEntity(latlng) {
    // 地理坐标 -> 仿真坐标
    const simPos = this.map2d.geoToSim(latlng.lat, latlng.lng);
    const x = simPos.x;
    const y = simPos.y;

    let nearest = null;
    let minDist = Infinity;

    for (const entity of this.state?.entities || []) {
      const dist = Math.hypot(entity.x - x, entity.y - y);
      if (dist < minDist && dist < 500) { // 500米范围内
        minDist = dist;
        nearest = entity;
      }
    }

    if (nearest) {
      this.send({ cmd: 'removeEntity', entityId: nearest.id });
      this.addLog(`已删除单位 ${nearest.id}`, 'info');
    }
  }

  // 清空所有单位
  clearAllEntities() {
    for (const entity of this.state?.entities || []) {
      this.send({ cmd: 'removeEntity', entityId: entity.id });
    }
    this.addLog('已清空所有单位', 'info');
  }

  // 保存想定
  saveScenario() {
    const scenario = {
      name: '自定义想定',
      description: '用户自定义兵力部署',
      createdAt: new Date().toISOString(),
      entities: this.state?.entities.map(e => ({
        side: e.side,
        equipmentType: e.equipmentType,
        x: e.x,
        y: e.y,
        z: e.z || 0,
        aiType: e.aiType || 'combat'
      })) || []
    };

    const blob = new Blob([JSON.stringify(scenario, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scenario_${Date.now()}.json`;
    a.click();
    this.addLog('想定已保存', 'success');
  }

  minimapRender() {
    // 可在需要时实现
  }

  // 聚焦到指定阵营的位置
  focusOnSide(side) {
    if (!this.state || !this.state.entities || this.state.entities.length === 0) {
      this.addLog('没有可查看的单位', 'warning');
      return;
    }

    // 获取指定阵营的所有单位
    const sideEntities = this.state.entities.filter(e => e.side === side);
    if (sideEntities.length === 0) {
      this.addLog(`${side === 'red' ? '红方' : '蓝方'}没有单位`, 'warning');
      return;
    }

    // 计算阵营中心点
    let totalX = 0, totalY = 0;
    for (const entity of sideEntities) {
      totalX += entity.x;
      totalY += entity.y;
    }
    const centerX = totalX / sideEntities.length;
    const centerY = totalY / sideEntities.length;

    // 移动2D地图视角
    const geoPos = this.map2d.simToGeo(centerX, centerY);
    this.map2d.map.setView([geoPos.lat, geoPos.lng], 12);

    // 移动3D相机视角
    this.view3d.focusOnPosition(centerX, centerY);

    const sideName = side === 'red' ? '红方' : '蓝方';
    this.addLog(`视角已移动到${sideName}位置 (${Math.round(centerX)}, ${Math.round(centerY)})`, 'info');
  }

  // 命令实体移动
  commandMove(entityId, targetX, targetY) {
    this.send({ cmd: 'commandMove', entityId, targetX, targetY });
  }

  // 命令实体攻击
  commandAttack(entityId, targetId) {
    this.send({ cmd: 'commandAttack', entityId, targetId });
  }

  // 命令实体原地部署/固守
  commandHold(entityId) {
    this.send({ cmd: 'commandHold', entityId });
  }

  // ========== 演习区域设置功能 ==========
  startAreaSelection() {
    const btn = document.getElementById('btnSetArea');
    if (btn.classList.contains('active')) {
      // 取消选择模式
      this.cancelAreaSelection();
      return;
    }

    btn.classList.add('active');
    btn.textContent = '📍 取消划定';
    this.addLog('请按住鼠标右键拖拽划出矩形演习区域', 'info');

    // 保存原始点击处理函数
    this._originalOnMapClick = this.map2d.onMapClick;

    // 禁用其他交互
    this.map2d.map.getContainer().style.cursor = 'crosshair';

    // 阻止地图拖拽
    this.map2d.map.dragging.disable();

    // 启用拖拽绘制矩形 - 使用右键
    let startPoint = null;
    let tempRect = null;
    let isRightMouseDown = false;

    const onMouseDown = (e) => {
      // 只处理右键 (button === 2)
      if (e.originalEvent.button !== 2) return;

      isRightMouseDown = true;
      startPoint = e.latlng;

      // 创建临时矩形
      tempRect = L.rectangle([startPoint, startPoint], {
        color: '#e94560',
        weight: 2,
        fillColor: '#e94560',
        fillOpacity: 0.1,
        dashArray: '5, 5'
      }).addTo(this.map2d.map);
    };

    const onMouseMove = (e) => {
      if (!isRightMouseDown || !tempRect || !startPoint) return;
      tempRect.setBounds([startPoint, e.latlng]);
    };

    const onMouseUp = (e) => {
      if (!isRightMouseDown || !startPoint || !tempRect) return;

      isRightMouseDown = false;
      const endPoint = e.latlng;
      const bounds = [
        [Math.min(startPoint.lat, endPoint.lat), Math.min(startPoint.lng, endPoint.lng)],
        [Math.max(startPoint.lat, endPoint.lat), Math.max(startPoint.lng, endPoint.lng)]
      ];

      // 应用新的演习区域
      this.map2d.setExerciseArea(bounds);
      this.exerciseAreaSet = true;
      const center = this.map2d.geoToSim(
        (bounds[0][0] + bounds[1][0]) / 2,
        (bounds[0][1] + bounds[1][1]) / 2
      );
      this.addLog(`演习区域已设置: 中心(${Math.round(center.x)}, ${Math.round(center.y)})，现在可以配置想定并开始推演`, 'success');

      // 清理
      this.cancelAreaSelection();
      if (tempRect) {
        this.map2d.map.removeLayer(tempRect);
      }
    };

    // 绑定事件 - 使用 Leaflet 事件
    this.map2d.map.on('mousedown', onMouseDown);
    this.map2d.map.on('mousemove', onMouseMove);
    this.map2d.map.on('mouseup', onMouseUp);

    // 保存引用以便取消
    this._areaSelectionHandlers = { onMouseDown, onMouseMove, onMouseUp };
  }

  cancelAreaSelection() {
    const btn = document.getElementById('btnSetArea');
    if (btn) {
      btn.classList.remove('active');
      btn.textContent = '📍 划定演习区域';
    }

    this.map2d.map.getContainer().style.cursor = '';

    // 恢复地图拖拽
    if (this.map2d.map.dragging) {
      this.map2d.map.dragging.enable();
    }

    // 移除事件监听
    if (this._areaSelectionHandlers) {
      this.map2d.map.off('mousedown', this._areaSelectionHandlers.onMouseDown);
      this.map2d.map.off('mousemove', this._areaSelectionHandlers.onMouseMove);
      this.map2d.map.off('mouseup', this._areaSelectionHandlers.onMouseUp);
      this._areaSelectionHandlers = null;
    }

    // 恢复原始点击处理
    if (this._originalOnMapClick) {
      this.map2d.onMapClick = this._originalOnMapClick;
      this._originalOnMapClick = null;
    }
  }

  // ========== 移动单位功能 ==========
  handleMoveEntity(e) {
    if (!this.movingEntity) {
      // 第一次点击，选择要移动的单位
      const clickedEntity = this.getEntityAt(e.latlng);
      if (clickedEntity) {
        this.movingEntity = clickedEntity;
        this.addLog(`已选择 ${clickedEntity.id}，请点击新位置放置`, 'info');
        // 高亮选中的单位
        this.map2d.highlightEntity(clickedEntity.id);
      } else {
        this.addLog('请先点击选择一个单位', 'warning');
      }
      return;
    }

    // 第二次点击，放置单位到新位置
    const simPos = this.map2d.geoToSim(e.latlng.lat, e.latlng.lng);

    // 发送移动命令到服务器
    this.send({
      cmd: 'moveEntity',
      entityId: this.movingEntity.id,
      x: simPos.x,
      y: simPos.y
    });

    this.addLog(`${this.movingEntity.id} 已移动到 (${Math.round(simPos.x)}, ${Math.round(simPos.y)})`, 'success');

    // 重置移动状态
    this.movingEntity = null;
  }

  // ========== 路径绘制功能 ==========
  startPathDrawing(entityId) {
    this.pathDrawing = {
      entityId: entityId,
      points: [],
      tempLine: null
    };
    this.addLog(`正在为 ${entityId} 设置路径，请点击地图添加路径点，双击结束`, 'info');
  }

  handlePathDrawing(e) {
    if (!this.pathDrawing) {
      // 第一次点击，选择单位
      const clickedEntity = this.getEntityAt(e.latlng);
      if (clickedEntity) {
        this.startPathDrawing(clickedEntity.id);
      } else {
        this.addLog('请先点击选择一个单位', 'warning');
      }
      return;
    }

    // 添加路径点
    const simPos = this.map2d.geoToSim(e.latlng.lat, e.latlng.lng);
    this.pathDrawing.points.push({ x: simPos.x, y: simPos.y });

    // 更新临时路径显示
    this.updateTempPath();

    this.addLog(`路径点 ${this.pathDrawing.points.length} 已添加: (${Math.round(simPos.x)}, ${Math.round(simPos.y)})`, 'info');
  }

  updateTempPath() {
    if (this.pathDrawing.tempLine) {
      this.map2d.map.removeLayer(this.pathDrawing.tempLine);
    }

    if (this.pathDrawing.points.length < 2) return;

    const latlngs = this.pathDrawing.points.map(p => {
      const geo = this.map2d.simToGeo(p.x, p.y);
      return [geo.lat, geo.lng];
    });

    this.pathDrawing.tempLine = L.polyline(latlngs, {
      color: '#ffd700',
      weight: 3,
      opacity: 0.6,
      dashArray: '5, 5'
    }).addTo(this.map2d.map);
  }

  finishPathDrawing() {
    if (!this.pathDrawing || this.pathDrawing.points.length < 2) {
      this.addLog('路径点不足，取消路径设置', 'warning');
      this.cancelPathDrawing();
      return;
    }

    // 发送路径到服务器
    this.send({
      cmd: 'setEntityPath',
      entityId: this.pathDrawing.entityId,
      path: this.pathDrawing.points
    });

    // 显示路径
    this.map2d.showPath(this.pathDrawing.entityId, this.pathDrawing.points);

    this.addLog(`路径设置完成，${this.pathDrawing.points.length} 个路径点`, 'success');
    this.cancelPathDrawing();
  }

  cancelPathDrawing() {
    if (this.pathDrawing) {
      if (this.pathDrawing.tempLine) {
        this.map2d.map.removeLayer(this.pathDrawing.tempLine);
      }
      this.pathDrawing = null;
    }
  }

  getEntityAt(latlng) {
    const simPos = this.map2d.geoToSim(latlng.lat, latlng.lng);
    let nearest = null;
    let minDist = Infinity;

    for (const entity of this.state?.entities || []) {
      const dist = Math.hypot(entity.x - simPos.x, entity.y - simPos.y);
      if (dist < minDist && dist < 200) { // 200米范围内
        minDist = dist;
        nearest = entity;
      }
    }

    return nearest;
  }

  resetExerciseArea() {
    // 重置为默认演习区域（北京周边）
    this.map2d.setExerciseArea([[39.4, 115.9], [40.4, 116.9]]);
    this.exerciseAreaSet = true;
    this.addLog('演习区域已重置为默认值', 'info');
  }

  // 删除演习区域
  deleteExerciseArea() {
    this.map2d.clearExerciseArea();
    this.exerciseAreaSet = false;
    this.addLog('演习区域已删除', 'info');
  }

  // 移动演习区域
  startAreaMove() {
    if (!this.map2d.exerciseArea) {
      this.addLog('⚠️ 没有可移动的演习区域，请先划定区域', 'warning');
      return;
    }

    const btn = document.getElementById('btnMoveArea');
    if (btn.classList.contains('active')) {
      this.cancelAreaMove();
      return;
    }

    btn.classList.add('active');
    btn.textContent = '✋ 取消移动';
    this.addLog('请按住鼠标右键拖拽移动演习区域', 'info');

    // 禁用地图拖拽
    this.map2d.map.dragging.disable();

    let isDragging = false;
    let startLat = 0;
    let startLng = 0;
    let initialBounds = null;

    const onMouseDown = (e) => {
      if (e.originalEvent.button !== 2) return; // 只处理右键

      // 检查点击是否在演习区域内
      const latlng = e.latlng;
      const bounds = this.map2d.exerciseArea.getBounds();
      if (!bounds.contains(latlng)) return;

      isDragging = true;
      startLat = latlng.lat;
      startLng = latlng.lng;
      initialBounds = bounds;
    };

    const onMouseMove = (e) => {
      if (!isDragging || !initialBounds) return;

      const deltaLat = e.latlng.lat - startLat;
      const deltaLng = e.latlng.lng - startLng;

      const newBounds = [
        [initialBounds.getSouth() + deltaLat, initialBounds.getWest() + deltaLng],
        [initialBounds.getNorth() + deltaLat, initialBounds.getEast() + deltaLng]
      ];

      this.map2d.setExerciseArea(newBounds);
    };

    const onMouseUp = () => {
      if (!isDragging) return;
      isDragging = false;
      initialBounds = this.map2d.exerciseArea.getBounds();
      this.addLog('演习区域已移动', 'success');
    };

    this.map2d.map.on('mousedown', onMouseDown);
    this.map2d.map.on('mousemove', onMouseMove);
    this.map2d.map.on('mouseup', onMouseUp);

    this._areaMoveHandlers = { onMouseDown, onMouseMove, onMouseUp };
  }

  cancelAreaMove() {
    const btn = document.getElementById('btnMoveArea');
    if (btn) {
      btn.classList.remove('active');
      btn.textContent = '✋ 移动区域';
    }

    // 恢复地图拖拽
    if (this.map2d.map.dragging) {
      this.map2d.map.dragging.enable();
    }

    // 移除事件监听
    if (this._areaMoveHandlers) {
      this.map2d.map.off('mousedown', this._areaMoveHandlers.onMouseDown);
      this.map2d.map.off('mousemove', this._areaMoveHandlers.onMouseMove);
      this.map2d.map.off('mouseup', this._areaMoveHandlers.onMouseUp);
      this._areaMoveHandlers = null;
    }
  }
}

// 启动
document.addEventListener('DOMContentLoaded', () => {
  window.app = new SimCombatApp();
});
