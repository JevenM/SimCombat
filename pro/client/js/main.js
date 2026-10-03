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
    this.replaySpeed = 1; // 默认1倍速

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

    // 初始化攻击动画管理器 - 立即创建（地图init是同步的）
    this.attackAnimations = null;
    if (this.map2d.map) {
      this.attackAnimations = new AttackAnimations(this.map2d);
      console.log('攻击动画管理器已初始化');
    }

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

      // 连接成功后请求回放列表
      this.refreshReplayList();

      // 根据当前模式初始化状态
      if (this.simMode === 'exercise') {
        this.send({ cmd: 'clearAllEntities' });
        console.log('演习模式：已发送清空实体命令');
      }
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
        if (this.map2d && this.terrain) {
          this.map2d.loadTerrain(this.terrain);
        }
        break;
      case 'replay':
        this.replay = data.replay;
        this.replayInitialScene = data.initialScene || null;
        this.replayFinalResult = data.finalResult || null;
        this.startReplay(data.name);
        break;
      case 'replayList':
        this.updateReplayList(data.replays);
        break;
      case 'replaySaved':
        this.addLog(`回放已保存: ${data.name} (${data.frameCount}帧)`, 'success');
        this.refreshReplayList();
        break;
      case 'replayDeleted':
        this.addLog(`回放已删除: ${data.name}`, 'info');
        this.refreshReplayList();
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

    // 更新空战对决可视化（航迹 / 导弹 / 3D 姿态）
    this.map2d?.updateDuelVisuals?.(state.missiles || [], state.trails || [], state.entities);
    this.view3d?.updateDuelVisuals?.(state.missiles || [], state.trails || [], state.entities);

    // 双机实时标签（只在空战对决模式下显示，并随推演跟随战机）
    this.map2d?.updateDuelAircraft?.(state.duel?.enabled ? (state.entities || []) : []);

    // 更新空战态势条
    if (this.airDuel && state.duel) {
      this.airDuel.update(state.duel);
    }

    // 更新攻击线位置（跟随移动的单位）
    if (this.attackAnimations && state.isRunning) {
      this.attackAnimations.updateAttackLinePositions(state.entities);
    }

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
      console.log(`收到 ${state.combatEvents.length} 个战斗事件:`, state.combatEvents);
      console.log(`当前实体数量: ${state.entities?.length || 0}`, state.entities);
      for (const event of state.combatEvents) {
        this.addCombatLog(event);
        // 触发攻击动画
        if (this.attackAnimations) {
          this.attackAnimations.handleCombatEvent(event, state.entities);
        } else {
          // 如果动画管理器未初始化，尝试立即创建
          if (this.map2d && this.map2d.map) {
            console.log('延迟初始化攻击动画管理器');
            this.attackAnimations = new AttackAnimations(this.map2d);
            this.attackAnimations.handleCombatEvent(event, state.entities);
          }
        }
      }
    }

    // 清理过期的持续攻击线（超过3秒未更新的攻击线）
    if (this.attackAnimations) {
      this.attackAnimations.cleanupStaleAttacks(3000);

      // 推演已停止：等最后的命中特效播完再统一清理，避免攻击线永久留在地图上
      if (state.isRunning) {
        this.cancelAttackAnimationsCleanup();
      } else {
        this.scheduleAttackAnimationsCleanup();
      }
    }

    // 更新按钮状态
    const startBtn = document.getElementById('btnStart');
    startBtn.textContent = state.isRunning ? '⏸ 暂停' : '▶ 开始';
    startBtn.className = state.isRunning ? 'btn btn-warning' : 'btn btn-primary';

    document.getElementById('statusText').textContent = state.isRunning ? '推演中' : '待机';
    document.getElementById('statusText').className = state.isRunning ? 'badge running' : 'badge stopped';

    // 推演结束只弹一次统一的结果对话框（胜负 + 回放保存）
    if (state.isRunning) {
      this._endDialogShown = false;
    } else if (!this._endDialogShown && !this.replayPlaying && (state.stats?.winner || state.stats?.endTime)) {
      this._endDialogShown = true;
      this.showEndGameDialog(state.stats);
    }
  }

  /**
   * 推演停止后延迟清理攻击动画：给最后的命中/爆炸特效留出播放时间，
   * 之后统一清除，避免攻击线（双向红蓝箭头）永远留在 2D 地图上
   */
  scheduleAttackAnimationsCleanup(delay = 1500) {
    if (this._attackCleanupTimer) return;
    this._attackCleanupTimer = setTimeout(() => {
      this._attackCleanupTimer = null;
      this.attackAnimations?.clearAll();
    }, delay);
  }

  cancelAttackAnimationsCleanup() {
    if (this._attackCleanupTimer) {
      clearTimeout(this._attackCleanupTimer);
      this._attackCleanupTimer = null;
    }
  }

  /**
   * 推演结束的统一对话框：结果 + 伤亡对比 + 回放保存（原来会同时弹出两个框）
   */
  showEndGameDialog(stats) {
    const winner = stats.winner;
    const endReason = stats.endReason || '推演完成';
    const sideClass = winner === 'red' ? 'side-red' : winner === 'blue' ? 'side-blue' : 'side-draw';
    const title = winner === 'red' ? '🔴 红军胜利' : winner === 'blue' ? '🔵 蓝军胜利' : '🤝 推演平局';
    const icon = winner === 'red' || winner === 'blue' ? '🏆' : '🤝';

    const resultHtml = `
      <div id="endGameModal" class="result-modal ${sideClass}">
        <div class="result-modal-card">
          <div class="result-modal-icon">${icon}</div>
          <h2>${title}</h2>
          <p class="result-modal-reason">${endReason}</p>
          <div class="result-modal-stats">
            <div class="result-stat red">
              <b>${stats.redCasualties || 0}</b>
              <span>红军伤亡</span>
            </div>
            <div class="result-stat blue">
              <b>${stats.blueCasualties || 0}</b>
              <span>蓝军伤亡</span>
            </div>
          </div>
          <p class="result-modal-tip">是否保存此次推演回放，便于后续回看？</p>
          <div class="result-modal-actions">
            <button id="btnSaveEndReplay" class="btn btn-primary">💾 保存回放</button>
            <button id="btnKeepBattlefield" class="btn btn-secondary">🗺️ 留在战场</button>
            <button id="btnSkipEndReplay" class="btn btn-secondary">🧹 清理场景</button>
          </div>
        </div>
      </div>
    `;

    const div = document.createElement('div');
    div.innerHTML = resultHtml;
    document.body.appendChild(div);

    const close = () => document.getElementById('endGameModal')?.remove();

    // 点击遮罩等同于「留在战场」
    document.getElementById('endGameModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'endGameModal') close();
    });

    const saveReplay = () => {
      const now = new Date();
      const name = `推演_${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}_${now.getHours().toString().padStart(2,'0')}${now.getMinutes().toString().padStart(2,'0')}`;
      this.send({ cmd: 'saveReplay', name });
      this.addLog(`正在保存回放: ${name}`, 'info');
    };

    // 保存回放（保存后清理场景）
    document.getElementById('btnSaveEndReplay')?.addEventListener('click', () => {
      saveReplay();
      close();
      this.cleanupAfterGame();
    });

    // 只关闭弹窗，保留最终态势供查看
    document.getElementById('btnKeepBattlefield')?.addEventListener('click', () => {
      close();
      this.addLog('已保留最终态势，可在地图上查看战果', 'info');
    });

    // 不保存，直接清理场景
    document.getElementById('btnSkipEndReplay')?.addEventListener('click', () => {
      close();
      this.cleanupAfterGame();
    });
  }

  /**
   * 推演结束后清理场景
   */
  cleanupAfterGame() {
    // 清除攻击动画
    if (this.attackAnimations) {
      this.attackAnimations.clearAll();
    }

    // 清除3D效果
    if (this.view3d) {
      this.view3d.clearEffects();
    }

    // 将编辑器模式改为仅查看
    this.editorMode = 'view';
    const modeSelect = document.getElementById('editorMode');
    if (modeSelect) {
      modeSelect.value = 'view';
    }

    //更新编辑器提示
    const hint = document.getElementById('editorHint');
    if (hint) {
      hint.textContent = '💡 推演已结束，当前为仅查看模式';
    }

    // 清除地图上的范围圆圈等特效
    this.map2d.clear();

    // 结束空战对决状态（保留出生点标记，便于再次开打）
    if (this.airDuel) {
      this.airDuel.onSimulationEnd();
    }

    // 重置结束标记（允许下次推演再次显示）
    this._endDialogShown = false;

    this.addLog('推演结束，场景已清理，切换为仅查看模式', 'info');
  }

  /**
   * 仅更新显示（不处理战斗事件）- 用于勾选框切换等场景
   */
  updateDisplayOnly(state) {
    this.state = state;
    const showLabels = document.getElementById('showLabels')?.checked ?? false;
    const showRange = document.getElementById('showRange')?.checked ?? false;

    // 只更新视图，不触发攻击动画
    this.map2d.updateEntities(state.entities, showLabels, showRange);
    this.view3d.updateEntities(state.entities, showLabels, showRange);
  }

  /**
   * 左侧面板按模块分页（想定 / 空战 / 视图 / AI）
   */
  initSidebarTabs() {
    const tabs = document.querySelectorAll('.sidebar-tabs .tab-btn');
    const panels = document.querySelectorAll('.tab-panels .tab-panel');
    tabs.forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.tab;
        tabs.forEach(b => b.classList.toggle('active', b === btn));
        panels.forEach(p => p.classList.toggle('active', p.dataset.panel === target));
      });
    });
  }

  bindEvents() {
    // 左侧模块化标签页
    this.initSidebarTabs();

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
      // 清除所有攻击动画
      if (this.attackAnimations) {
        this.attackAnimations.clearAll();
      }
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
    document.getElementById('viewMode')?.addEventListener('change', (e) => {
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

    // 空战对决面板
    if (window.AirDuel && this.map2d) {
      this.airDuel = new AirDuel(this);
      this.airDuel.init();
    }

    // 数据操作
    document.getElementById('btnLoad')?.addEventListener('click', () => {
      document.getElementById('fileInput')?.click();
    });

    document.getElementById('btnSaveScenario')?.addEventListener('click', () => this.saveState());

    // 回放管理
    this.initReplayManager();

    // 查看红方/蓝方位置
    document.getElementById('btnViewRed')?.addEventListener('click', () => this.focusOnSide('red'));
    document.getElementById('btnViewBlue')?.addEventListener('click', () => this.focusOnSide('blue'));

    document.getElementById('fileInput')?.addEventListener('change', (e) => {
      this.handleFileUpload(e.target.files[0]);
    });

    // 地图双击事件 - 结束路径绘制
    this.map2d.map.on('dblclick', () => {
      if (this.editorMode === 'setPath' && this.pathDrawing) {
        this.finishPathDrawing();
      }
    });

    // 设置变更 - 只更新显示，不处理战斗事件
    document.getElementById('showLabels')?.addEventListener('change', () => {
      if (this.state) this.updateDisplayOnly(this.state);
    });
    document.getElementById('showRange')?.addEventListener('change', () => {
      if (this.state) this.updateDisplayOnly(this.state);
    });
    document.getElementById('showTerrain')?.addEventListener('change', (e) => {
      this.map2d.showTerrainOverlay(e.target.checked);
    });

    // 底图切换
    document.getElementById('baseMapType')?.addEventListener('change', (e) => {
      this.map2d.switchBaseLayer(e.target.value);
      // 更新离线模式状态显示
      const isOffline = e.target.value === 'offline';
      const offlineStatus = document.getElementById('offlineStatus');
      if (offlineStatus) {
        offlineStatus.textContent = isOffline ? '离线模式' : '在线模式';
        offlineStatus.style.color = isOffline ? '#58a6ff' : '#6e7681';
      }
      // 显示/隐藏缓存控制按钮
      const cacheControls = document.getElementById('cacheControls');
      if (cacheControls) {
        cacheControls.style.display = isOffline ? 'flex' : 'none';
      }
    });

    // 离线模式切换
    document.getElementById('offlineMode')?.addEventListener('change', (e) => {
      const enabled = e.target.checked;
      this.map2d.setOfflineMode(enabled);
      document.getElementById('offlineStatus').textContent = enabled ? '离线模式' : '在线模式';
      document.getElementById('offlineStatus').style.color = enabled ? '#58a6ff' : '#6e7681';
      // 显示/隐藏缓存控制按钮
      const cacheControls = document.getElementById('cacheControls');
      if (cacheControls) {
        cacheControls.style.display = enabled ? 'flex' : 'none';
      }
      this.addLog(enabled ? '已切换到离线地图模式' : '已切换到在线地图模式', 'info');
    });

    // 缓存当前区域
    document.getElementById('btnCacheArea')?.addEventListener('click', async () => {
      if (!this.map2d) return;
      const bounds = this.map2d.map.getBounds();
      const zoom = this.map2d.map.getZoom();

      // 显示开始缓存提示
      this.addLog('开始缓存地图瓦片...', 'info');
      document.getElementById('btnCacheArea').disabled = true;
      document.getElementById('btnCacheArea').textContent = '缓存中...';

      try {
        const result = await this.map2d.prefetchArea(bounds, zoom, Math.min(zoom + 2, 17));
        this.addLog(`地图缓存完成: ${result.cached}/${result.total} 个瓦片`, 'success');
        if (result.failed > 0) {
          this.addLog(`缓存失败: ${result.failed} 个瓦片`, 'warning');
        }
      } catch (error) {
        this.addLog(`缓存失败: ${error.message}`, 'error');
      } finally {
        document.getElementById('btnCacheArea').disabled = false;
        document.getElementById('btnCacheArea').textContent = '缓存当前区域';
      }
    });

    // 清理缓存
    document.getElementById('btnClearCache')?.addEventListener('click', async () => {
      if (!this.map2d) return;
      await this.map2d.clearOldCache();
      this.addLog('已清理过期地图缓存', 'info');
    });

    // AI智能配置
    this.initAIConfig();

    // 回放控制
    document.getElementById('replayPlay')?.addEventListener('click', () => {
      this.toggleReplay();
    });

    document.getElementById('replaySlider')?.addEventListener('input', (e) => {
      this.replayIndex = parseInt(e.target.value);
      this.updateReplayFrame();
    });

    document.getElementById('replayClose')?.addEventListener('click', () => {
      // 关闭回放条即结束回放并清理场景
      this.clearSceneAfterReplay();
    });

    // 回放速率控制
    document.getElementById('replaySpeed')?.addEventListener('change', (e) => {
      this.replaySpeed = parseFloat(e.target.value);
      this.addLog(`回放速率调整为 ${this.replaySpeed}x`, 'info');
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

  startReplay(name) {
    if (!this.replay || this.replay.length === 0) {
      this.addLog('没有可用的回放数据', 'warning');
      return;
    }

    // 清掉上一轮推演的残留：攻击动画、地图上的航迹/导弹/单位标记、3D 特效
    if (this.attackAnimations) {
      this.attackAnimations.clearAll();
    }
    this.map2d?.clear();
    this.view3d?.clearEffects?.();

    // 重置统计（交战计数、伤害曲线、已处理事件），保证重复播放口径一致
    if (this.statsPanel) this.statsPanel.reset();

    const replayBar = document.getElementById('replayBar');
    const replaySlider = document.getElementById('replaySlider');
    if (replayBar) replayBar.style.display = 'flex';
    if (replaySlider) replaySlider.max = this.replay.length - 1;
    this.replayIndex = 0;
    this.replayPlaying = true;
    this.replaySpeed = this.replaySpeed || 1; // 默认1倍速

    // 显示初始场景（如果存在）
    if (this.replayInitialScene) {
      const showLabels = document.getElementById('showLabels')?.checked ?? true;
      const showRange = document.getElementById('showRange')?.checked ?? false;
      this.map2d.updateEntities(this.replayInitialScene.entities || [], showLabels, showRange);
      this.view3d.updateEntities(this.replayInitialScene.entities || [], showLabels, showRange);
      this.statsPanel.update(this.replayInitialScene.stats || {}, [], false, this.replayInitialScene.time || 0);
    }

    // 把视野定位到战场，避免战场落在视野之外看不到打斗画面
    this.fitReplayBounds(this.replayInitialScene?.entities || this.replay?.[0]?.entities || []);

    // 显示回放名称
    const replayTitle = name ? `回放: ${name}` : '推演回放';
    const replayTime = document.getElementById('replayTime');
    if (replayTime) replayTime.textContent = `${replayTitle} (0/${this.replay.length})`;

    this.addLog(`开始${replayTitle}`, 'info');

    // 清除之前的 interval
    if (this.replayInterval) {
      clearTimeout(this.replayInterval);
    }

    // 开始播放
    const initialDelay = 200 / this.replaySpeed;
    this.replayInterval = setTimeout(() => this.playReplayFrame(), initialDelay);
  }

  /**
   * 回放开始时把 2D 视野定位到战场范围（只做一次，避免每帧跳动）
   */
  fitReplayBounds(entities) {
    if (!entities || entities.length === 0) return;
    if (!this.map2d?.map || typeof L === 'undefined') return;

    const points = entities
      .filter(e => Number.isFinite(e.x) && Number.isFinite(e.y))
      .map(e => {
        const g = this.map2d.simToGeo(e.x, e.y);
        return [g.lat, g.lng];
      });
    if (points.length === 0) return;

    this.map2d.map.fitBounds(L.latLngBounds(points).pad(0.4), { animate: false });
  }

  /**
   * 回放的单帧推进：抽成方法，暂停后可从当前帧继续播放（原来暂停就再也放不动）
   */
  playReplayFrame() {
    if (!this.replayPlaying || !this.replay) return;

    if (this.replayIndex < this.replay.length - 1) {
      this.replayIndex++;
      this.updateReplayFrame();
      const delay = 200 / (this.replaySpeed || 1);
      this.replayInterval = setTimeout(() => this.playReplayFrame(), delay);
      return;
    }

    // 回放结束
    this.replayPlaying = false;
    const btn = document.getElementById('replayPlay');
    if (btn) btn.textContent = '▶';
    const statusText = document.getElementById('statusText');
    if (statusText) {
      statusText.textContent = '回放结束';
      statusText.className = 'badge stopped';
    }
    // 显示推演结果
    this.showReplayResult();
    // 停止场景中的动画，并清掉回放最后一帧的航迹/导弹与 3D 特效
    if (this.attackAnimations) {
      this.attackAnimations.clearAll();
    }
    this.map2d?.clearDuelVisuals?.();
    this.view3d?.clearEffects?.();
  }

  /**
   * 回放的播放/暂停切换
   */
  toggleReplay() {
    if (!this.replay || this.replay.length === 0) return;

    this.replayPlaying = !this.replayPlaying;
    const btn = document.getElementById('replayPlay');
    if (btn) btn.textContent = this.replayPlaying ? '⏸' : '▶';

    if (this.replayPlaying) {
      // 若已播到最后一帧，从头开始
      if (this.replayIndex >= this.replay.length - 1) {
        this.replayIndex = 0;
      }
      if (this.replayInterval) clearTimeout(this.replayInterval);
      this.replayInterval = setTimeout(() => this.playReplayFrame(), 200 / (this.replaySpeed || 1));
      const statusText = document.getElementById('statusText');
      if (statusText) {
        statusText.textContent = '回放中';
        statusText.className = 'badge running';
      }
    } else {
      if (this.replayInterval) clearTimeout(this.replayInterval);
      const statusText = document.getElementById('statusText');
      if (statusText) {
        statusText.textContent = '回放暂停';
        statusText.className = 'badge stopped';
      }
    }
  }

  stopReplay() {
    this.replayPlaying = false;
    if (this.replayInterval) {
      clearTimeout(this.replayInterval);
    }
  }

  /**
   * 显示回放结束时的推演结果
   */
  showReplayResult() {
    // 优先使用保存的最终结果（如果有）
    const finalData = this.replayFinalResult || {};
    const stats = finalData.stats || {};
    const winner = stats.winner || finalData.winner;
    const endReason = finalData.endReason || '推演完成';

    // 如果没有保存的最终结果，使用最后一帧
    if (!this.replayFinalResult && this.replay && this.replay.length > 0) {
      const lastFrame = this.replay[this.replay.length - 1];
      const lastStats = lastFrame.stats || {};
      this.replayFinalResult = {
        stats: lastStats,
        winner: lastStats.winner,
        endReason: lastStats.endReason || '推演完成'
      };
    }

    const finalStats = this.replayFinalResult?.stats || stats;

    // 创建结果弹窗
    const resultHtml = `
      <div style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
                  background: linear-gradient(135deg, #1a1f2e 0%, #0d1117 100%);
                  border: 2px solid ${winner === 'red' ? '#ff4444' : winner === 'blue' ? '#4488ff' : '#888'};
                  border-radius: 16px; padding: 30px; min-width: 350px; text-align: center; z-index: 10000;
                  box-shadow: 0 0 50px ${winner === 'red' ? 'rgba(255,68,68,0.3)' : winner === 'blue' ? 'rgba(68,136,255,0.3)' : 'rgba(128,128,128,0.3)'};">
        <div style="font-size: 48px; margin-bottom: 15px;">
          ${winner === 'red' ? '🏆 🔴 红军胜利' : winner === 'blue' ? '🏆 🔵 蓝军胜利' : '🤝 平局'}
        </div>
        <div style="color: #8b949e; margin-bottom: 20px; font-size: 14px;">${endReason}</div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 20px 0; padding: 15px; background: rgba(0,0,0,0.3); border-radius: 8px;">
          <div>
            <div style="color: #ff6b6b; font-size: 24px; font-weight: bold;">${finalStats.redCasualties || 0}</div>
            <div style="color: #8b949e; font-size: 12px;">红军伤亡</div>
          </div>
          <div>
            <div style="color: #4dabf7; font-size: 24px; font-weight: bold;">${finalStats.blueCasualties || 0}</div>
            <div style="color: #8b949e; font-size: 12px;">蓝军伤亡</div>
          </div>
          <div>
            <div style="color: #ff6b6b; font-size: 18px;">${Math.round(finalStats.redDamage || 0)}</div>
            <div style="color: #8b949e; font-size: 12px;">红军输出</div>
          </div>
          <div>
            <div style="color: #4dabf7; font-size: 18px;">${Math.round(finalStats.blueDamage || 0)}</div>
            <div style="color: #8b949e; font-size: 12px;">蓝军输出</div>
          </div>
        </div>
        <button id="replayResultCloseBtn" style="background: ${winner === 'red' ? '#ff4444' : winner === 'blue' ? '#4488ff' : '#666'};
                color: white; border: none; padding: 10px 30px; border-radius: 6px; cursor: pointer; font-size: 14px;">
          确定
        </button>
      </div>
      <div id="replayResultOverlay" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 9999;"></div>
    `;

    const div = document.createElement('div');
    div.id = 'replayResultModal';
    div.innerHTML = resultHtml;
    document.body.appendChild(div);

    // 绑定关闭按钮事件
    document.getElementById('replayResultCloseBtn')?.addEventListener('click', () => {
      // 清空场景
      this.clearSceneAfterReplay();
      // 移除弹窗
      document.getElementById('replayResultModal')?.remove();
    });

    // 点击背景也关闭并清理
    div.querySelector('div[style*="background: rgba(0,0,0,0.5)"]')?.addEventListener('click', function() {
      this.parentElement?.querySelector('#replayResultCloseBtn')?.click();
    });
  }

  updateReplayFrame() {
    if (!this.replay) return;
    const frame = this.replay[this.replayIndex];
    if (!frame) return;

    const slider = document.getElementById('replaySlider');
    if (slider) slider.value = this.replayIndex;

    const replayTime = document.getElementById('replayTime');
    if (replayTime) {
      replayTime.textContent =
        `T=${Math.round(frame.time)}s (${this.replayIndex}/${this.replay.length})`;
    }

    // 兼容旧回放文件：帧里只有 type 字段，补齐 equipmentType，保证图标/姿态与推演一致
    const entities = (frame.entities || []).map(e => ({
      ...e,
      equipmentType: e.equipmentType || e.type
    }));

    // 与实时推演一致：沿用「显示标签 / 显示射程」开关
    const showLabels = document.getElementById('showLabels')?.checked ?? true;
    const showRange = document.getElementById('showRange')?.checked ?? false;

    // 更新实体显示
    this.map2d.updateEntities(entities, showLabels, showRange);
    this.view3d.updateEntities(entities, showLabels, showRange);

    // 回放帧自带的空战航迹/导弹（帧里没有则清空，避免残留到回放画面中）
    this.map2d?.updateDuelVisuals?.(frame.missiles || [], frame.trails || [], entities);
    this.view3d?.updateDuelVisuals?.(frame.missiles || [], frame.trails || [], entities);
    this.map2d?.updateDuelAircraft?.(frame.duelMode ? entities : []);

    // 各面板数据与实时推演保持同一口径
    this.syncPanelsForReplay(frame, entities);

    // 播放战斗事件（攻击动画）
    if (frame.combatEvents && frame.combatEvents.length > 0) {
      for (const event of frame.combatEvents) {
        // 检查攻击者和目标是否都存在（避免显示错误效果）
        const attackerId = event.attacker || event.killer;
        const targetId = event.target || event.victim;
        const attacker = entities.find(e => e.id === attackerId);
        const target = entities.find(e => e.id === targetId);

        // 只有攻击者和目标都存在时才显示攻击动画
        if (attacker && target && target.hp > 0) {
          if (this.attackAnimations) {
            this.attackAnimations.handleCombatEvent(event, entities);
          }
        }
      }
    }
  }

  /**
   * 回放播放时的面板同步：统计大屏、顶部指标、状态徽章、空战态势条、战斗日志
   * 与实时推演（updateState）保持一致的显示口径
   */
  syncPanelsForReplay(frame, entities) {
    const stats = frame.stats || {};
    const events = frame.combatEvents || [];

    // 统计大屏（伤亡 / 伤害曲线 / 交战次数 / 战术主导 / 结论）
    this.statsPanel.update(stats, events, true, frame.time);

    // 顶部指标
    document.getElementById('simTime').textContent = `${Math.round(frame.time)}s`;
    const stepInfo = frame.stepCount !== undefined ? ` (步#${frame.stepCount})` : '';
    document.getElementById('entityCount').textContent = entities.length + stepInfo;
    document.getElementById('redUnits').textContent = stats.redUnits ?? 0;
    document.getElementById('blueUnits').textContent = stats.blueUnits ?? 0;

    const statusText = document.getElementById('statusText');
    if (statusText) {
      statusText.textContent = '回放中';
      statusText.className = 'badge running';
    }

    // 空战态势条（回放帧带 duel 快照）
    if (this.airDuel && frame.duel) {
      this.airDuel.update(frame.duel);
    }

    // 选中单位侧栏随回放刷新
    if (this.selectedEntity) {
      const current = entities.find(e => e.id === this.selectedEntity.id);
      if (current) {
        this.selectedEntity = current;
        this.showEntityInfo(current);
      }
    }

    // 战斗日志（与推演一致）
    for (const event of events) {
      this.addCombatLog(event);
    }
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
          <span style="font-weight:bold;">${entity.name || entity.id}</span>
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

    // 空战对决：按武器类型生成更有信息量的日志
    if (event.type === 'missile_launch') {
      this.addLog(`[步${event.step}] ${sideColor}方${event.attackerName} 发射空空导弹 → ${event.targetName}，距离 ${event.distance}m`, 'combat');
      return;
    }
    if (event.type === 'missile_miss') {
      const why = event.reason === 'flare' ? '被红外干扰弹诱骗' : '被高过载机动摆脱';
      this.addLog(`[步${event.step}] ${sideColor}方导弹脱靶：${event.targetName} ${why}`, 'combat');
      return;
    }
    if (event.type === 'missile_expired') {
      this.addLog(`[步${event.step}] ${sideColor}方导弹失去动力自毁`, 'combat');
      return;
    }
    if (event.type === 'flare') {
      this.addLog(`[步${event.step}] ${sideColor}方${event.attackerName} 投放红外干扰弹（剩余 ${event.remaining}）`, 'combat');
      return;
    }
    if (event.type === 'cannon' && !event.hit) {
      this.addLog(`[步${event.step}] ${sideColor}方${event.attackerName} 航炮射击未命中（${event.distance}m，偏角 ${event.ataDeg}°）`, 'combat');
      return;
    }

    const weaponLabel = { cannon: '航炮', missile_hit: '空空导弹' }[event.type] || '';
    const hitStatus = event.hit
      ? `命中! ${weaponLabel}伤害${event.damage}`
      : '未命中';

    // 处理未定义的名称 - 增强容错
    const attackerId = event.attacker || '?';
    const targetId = event.target || '?';
    const distance = event.distance || '?';

    // 名称处理：优先使用name字段，否则尝试从id提取，最后使用默认值
    let attackerName = event.attackerName;
    if (!attackerName && attackerId !== '?') {
      // 尝试从id提取名称（格式通常是 e时间戳_随机数）
      const idParts = attackerId.split('_');
      attackerName = idParts[0] || '未知单位';
    }
    attackerName = attackerName || '未知单位';

    let targetName = event.targetName;
    if (!targetName && targetId !== '?') {
      const idParts = targetId.split('_');
      targetName = idParts[0] || '目标';
    }
    targetName = targetName || '目标';

    const msg = `[步${event.step}] ${sideColor}方${attackerName}(${attackerId}) → ${targetName}(${targetId}), 距离${distance}m, ${hitStatus}`;
    this.addLog(msg, 'combat');
  }

  updateConnectionStatus(status) {
    const el = document.getElementById('connection');
    el.className = `connection-status ${status}`;
    el.textContent = { connected: '已连接', connecting: '连接中...', disconnected: '未连接' }[status];
  }

  // ========== AI智能配置 ==========
  initAIConfig() {
    const smartAIEnable = document.getElementById('enableSmartAI');
    const tacticalStyle = document.getElementById('tacticalStyle');
    const aiAggression = document.getElementById('aiAggression');
    const aiAggressionValue = document.getElementById('aiAggressionValue');
    const formationEnable = document.getElementById('enableFormation');
    const aiHintText = document.getElementById('aiHintText');
    const smartAIStatus = document.getElementById('smartAIStatus');

    if (!smartAIEnable) return;

    // SmartAI 开关
    smartAIEnable?.addEventListener('change', (e) => {
      const enabled = e.target.checked;
      this.send({ cmd: 'setSmartAI', enabled });

      if (smartAIStatus) {
        smartAIStatus.textContent = enabled ? '已启用' : '已禁用';
        smartAIStatus.style.color = enabled ? '#58a6ff' : '#6e7681';
      }
      if (aiHintText) {
        aiHintText.innerHTML = enabled
          ? '💡 智能AI启用：单位将自动选择最佳目标、利用地形、协同攻击'
          : '💡 传统行为树AI：单位按预设规则行动，攻击最近的敌人';
      }
    });

    // 战术风格切换
    tacticalStyle?.addEventListener('change', (e) => {
      const style = e.target.value;
      let aggression = 50;
      let formationEnabled = true;

      switch (style) {
        case 'aggressive':
          aggression = 75;
          if (aiHintText) aiHintText.innerHTML = '⚔️ 激进进攻：优先消灭敌人、主动追击、较少撤退';
          break;
        case 'defensive':
          aggression = 25;
          if (aiHintText) aiHintText.innerHTML = '🛡️ 保守防御：优先保全单位、依赖掩体、有序撤退';
          break;
        default: // balanced
          aggression = 50;
          if (aiHintText) aiHintText.innerHTML = '⚖️ 平衡战术：攻守兼备、灵活机动、协同作战';
      }

      if (aiAggression) aiAggression.value = aggression;
      if (aiAggressionValue) aiAggressionValue.textContent = aggression + '%';
      if (formationEnable) formationEnable.checked = formationEnabled;

      this.send({ cmd: 'setAITacticalStyle', style, aggression, formationEnabled });
    });

    // AI激进程度滑块
    aiAggression?.addEventListener('input', (e) => {
      const value = parseInt(e.target.value);
      if (aiAggressionValue) aiAggressionValue.textContent = value + '%';

      this.send({ cmd: 'setAIAggression', aggression: value });
    });

    // 编队协同开关
    formationEnable?.addEventListener('change', (e) => {
      const enabled = e.target.checked;
      this.send({ cmd: 'setAIFormation', enabled });

      if (enabled && aiHintText) {
        aiHintText.innerHTML += ' | 编队协同已启用';
      }
    });
  }

  // ========== 回放管理 ==========
  initReplayManager() {
    // 保存当前推演为回放（自动生成名称）
    document.getElementById('btnSaveReplay')?.addEventListener('click', () => {
      // 自动生成名称：推演_年月日_时分
      const now = new Date();
      const name = `推演_${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}_${now.getHours().toString().padStart(2,'0')}${now.getMinutes().toString().padStart(2,'0')}`;
      this.send({ cmd: 'saveReplay', name });
      this.addLog(`正在保存回放: ${name}`, 'info');
    });

    // 加载选定的回放
    document.getElementById('btnLoadReplay')?.addEventListener('click', () => {
      const select = document.getElementById('savedReplays');
      const name = select?.value;
      if (name) {
        this.send({ cmd: 'loadReplay', name });
        this.addLog(`正在加载并播放回放: ${name}`, 'info');
      } else {
        this.addLog('请先选择要加载的回放', 'warning');
      }
    });

    // 下拉框变化时更新回放信息
    document.getElementById('savedReplays')?.addEventListener('change', (e) => {
      this.updateReplayInfo(e.target.value);
    });

    // 页面加载时刷新回放列表
    this.refreshReplayList();

    // 应用默认地图设置（根据HTML中的默认状态）
    this.applyDefaultMapSettings();
  }

  /**
   * 应用默认地图设置
   */
  applyDefaultMapSettings() {
    // 获取默认底图类型
    const baseMapSelect = document.getElementById('baseMapType');
    if (baseMapSelect && baseMapSelect.value) {
      console.log(`[初始化] 应用默认底图: ${baseMapSelect.value}`);
      this.map2d.switchBaseLayer(baseMapSelect.value);
    }

    // 获取离线模式开关状态
    const offlineModeCheckbox = document.getElementById('offlineMode');
    if (offlineModeCheckbox && offlineModeCheckbox.checked) {
      console.log('[初始化] 应用默认离线模式');
      this.map2d.setOfflineMode(true);
    }
  }

  refreshReplayList() {
    this.send({ cmd: 'listReplays' });
  }

  updateReplayList(replays) {
    const select = document.getElementById('savedReplays');
    if (!select) return;

    // 保存当前选择
    const currentSelection = select.value;

    // 清空现有选项（保留第一个"-- 选择 --"）
    while (select.options.length > 1) {
      select.remove(1);
    }

    // 添加回放选项
    replays.forEach(replay => {
      const option = document.createElement('option');
      option.value = replay.name;
      // 缩短显示文本
      const shortName = replay.name.length > 15 ? replay.name.substring(0, 15) + '...' : replay.name;
      const winnerText = replay.winner ?
        (replay.winner === 'red' ? '🔴' : replay.winner === 'blue' ? '🔵' : '⚪') : '';
      option.textContent = `${shortName} ${winnerText}`;
      option.title = `${replay.name} (${replay.frameCount}帧)`; // 悬停提示
      select.appendChild(option);
    });

    // 恢复之前的选择
    if (currentSelection) {
      select.value = currentSelection;
    }

    console.log(`刷新回放列表: ${replays.length} 个回放`);
  }

  updateReplayInfo(name) {
    const infoDiv = document.getElementById('replayInfo');
    if (!infoDiv) return;

    if (!name) {
      infoDiv.style.display = 'none';
      return;
    }

    // 这里可以显示更详细的回放信息
    infoDiv.style.display = 'block';
    infoDiv.textContent = `已选择: ${name}`;
  }

  // ========== 想定编辑器功能 ==========
  initScenarioEditor() {
    this.editorMode = 'view'; // view, addRed, addBlue, remove
    // 从HTML元素读取默认单位类型
    const unitTypeSelect = document.getElementById('unitType');
    this.selectedUnitType = unitTypeSelect?.value || 'infantry'; // 默认与HTML第一个选项一致
    // 从DOM元素读取当前选择的模式，不要硬编码覆盖
    const simModeSelect = document.getElementById('simMode');
    this.simMode = simModeSelect?.value || 'exercise';
    this.exerciseAreaSet = this.simMode === 'combat'; // 实战模式默认已设置区域

    const modeSelect = document.getElementById('editorMode');
    const unitSelector = document.getElementById('unitSelector');
    // 注意：unitTypeSelect 和 simModeSelect 已在上方声明
    const hint = document.getElementById('editorHint');
    const modeHint = document.getElementById('modeHint');

    // 推演模式切换
    if (simModeSelect) {
      simModeSelect.addEventListener('change', (e) => {
        this.simMode = e.target.value;
        // 先清除所有攻击动画
        if (this.attackAnimations) {
          this.attackAnimations.clearAll();
        }
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
          // 实战模式下加载预设想定
          this.loadPresetScenario('skirmish');
        }
      });

      // 初始化时根据当前模式设置状态
      if (this.simMode === 'combat') {
        modeHint.innerHTML = '💡 实战模式：可直接部署兵力，系统已加载预设对抗态势';
        modeHint.style.borderLeftColor = '#238636';
      }
    }

    // 模式切换
    if (modeSelect) {
      modeSelect.addEventListener('change', (e) => {
        this.editorMode = e.target.value;
        const isAddMode = this.editorMode === 'addRed' || this.editorMode === 'addBlue';
        if (unitSelector) unitSelector.style.display = isAddMode ? 'block' : 'none';

        // 清除之前的路径绘制状态
        if (this.pathDrawing) {
          this.cancelPathDrawing();
        }

        if (!hint) return;
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
    }

    // 单位类型选择
    if (unitTypeSelect) {
      unitTypeSelect.addEventListener('change', (e) => {
        this.selectedUnitType = e.target.value;
      });
    }

    // 地图点击事件 - 添加/删除单位/设置路径
    if (this.map2d) {
      this.map2d.onMapClick = (e) => {
        // 空战对决点取出身点优先处理
        if (this.airDuel && this.airDuel.isPicking()) {
          this.airDuel.handleMapClick(e);
          return;
        }

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
    }

    // 按钮事件
    document.getElementById('btnClearAll')?.addEventListener('click', () => {
      if (confirm('确定要清空画布上的所有单位、战机标记与演习区域吗？')) {
        this.clearAllEntities();
      }
    });

    document.getElementById('btnSaveScenario')?.addEventListener('click', () => {
      this.saveScenario();
    });

    document.getElementById('btnExportLogs')?.addEventListener('click', () => {
      this.exportLogs();
    });

    document.getElementById('btnLoadPreset')?.addEventListener('click', () => {
      const preset = document.getElementById('presetScenario')?.value;
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
        name: '遭遇战（近距离）',
        entities: [
          // 红方 - 西北侧，距离蓝方约600米
          { side: 'red', equipmentType: 'tank', x: 4500, y: 4500, aiType: 'combat' },
          { side: 'red', equipmentType: 'infantry', x: 4300, y: 4400, aiType: 'combat' },
          // 蓝方 - 东南侧
          { side: 'blue', equipmentType: 'tank', x: 5100, y: 5100, aiType: 'defensive' },
          { side: 'blue', equipmentType: 'infantry', x: 4900, y: 5000, aiType: 'defensive' }
        ]
      },
      assault: {
        name: '进攻作战（中距离）',
        entities: [
          // 红方进攻集群 - 西侧，距离约1000米
          { side: 'red', equipmentType: 'tank', x: 4200, y: 4800, aiType: 'combat' },
          { side: 'red', equipmentType: 'tank', x: 4400, y: 4600, aiType: 'combat' },
          { side: 'red', equipmentType: 'apc', x: 4300, y: 4700, aiType: 'combat' },
          { side: 'red', equipmentType: 'infantry', x: 4100, y: 4900, aiType: 'combat' },
          { side: 'red', equipmentType: 'artillery', x: 3500, y: 4500, aiType: 'artillery' },
          // 蓝方防御阵地 - 东侧
          { side: 'blue', equipmentType: 'tank', x: 5200, y: 5200, aiType: 'defensive' },
          { side: 'blue', equipmentType: 'tank', x: 5400, y: 5000, aiType: 'defensive' },
          { side: 'blue', equipmentType: 'infantry', x: 5100, y: 5100, aiType: 'defensive' },
          { side: 'blue', equipmentType: 'air_defense', x: 5300, y: 4900, aiType: 'defensive' }
        ]
      },
      combined: {
        name: '联合作战（多兵种）',
        entities: [
          // 红方合成集群
          { side: 'red', equipmentType: 'tank', x: 4000, y: 4800, aiType: 'combat' },
          { side: 'red', equipmentType: 'tank', x: 4200, y: 4600, aiType: 'combat' },
          { side: 'red', equipmentType: 'apc', x: 4100, y: 4700, aiType: 'combat' },
          { side: 'red', equipmentType: 'infantry', x: 3900, y: 4900, aiType: 'combat' },
          { side: 'red', equipmentType: 'artillery', x: 3500, y: 4500, aiType: 'artillery' },
          // 蓝方防御体系
          { side: 'blue', equipmentType: 'tank', x: 5200, y: 5200, aiType: 'defensive' },
          { side: 'blue', equipmentType: 'tank', x: 5400, y: 5000, aiType: 'defensive' },
          { side: 'blue', equipmentType: 'apc', x: 5300, y: 5100, aiType: 'defensive' },
          { side: 'blue', equipmentType: 'infantry', x: 5500, y: 4900, aiType: 'defensive' },
          { side: 'blue', equipmentType: 'air_defense', x: 5600, y: 4800, aiType: 'defensive' }
        ]
      },
      urban: {
        name: '城市巷战（近距离）',
        entities: [
          // 红方突击队
          { side: 'red', equipmentType: 'infantry', x: 4800, y: 4800, aiType: 'combat' },
          { side: 'red', equipmentType: 'infantry', x: 4700, y: 4900, aiType: 'combat' },
          { side: 'red', equipmentType: 'apc', x: 4600, y: 5000, aiType: 'combat' },
          { side: 'red', equipmentType: 'tank', x: 4500, y: 5100, aiType: 'combat' },
          // 蓝方防守方 - 距离约400-600米
          { side: 'blue', equipmentType: 'infantry', x: 5200, y: 5200, aiType: 'defensive' },
          { side: 'blue', equipmentType: 'infantry', x: 5300, y: 5100, aiType: 'defensive' },
          { side: 'blue', equipmentType: 'tank', x: 5400, y: 5000, aiType: 'defensive' }
        ]
      },
      asymmetric: {
        name: '非对称作战（游击战）',
        entities: [
          // 红方重装部队
          { side: 'red', equipmentType: 'tank', x: 4500, y: 4800, aiType: 'combat' },
          { side: 'red', equipmentType: 'tank', x: 4700, y: 4600, aiType: 'combat' },
          { side: 'red', equipmentType: 'apc', x: 4600, y: 4700, aiType: 'combat' },
          // 蓝方轻装分散
          { side: 'blue', equipmentType: 'infantry', x: 5200, y: 5200, aiType: 'defensive' },
          { side: 'blue', equipmentType: 'infantry', x: 5400, y: 5000, aiType: 'defensive' },
          { side: 'blue', equipmentType: 'uav', x: 5500, y: 4800, z: 300, aiType: 'scout' },
          { side: 'blue', equipmentType: 'artillery', x: 5600, y: 4700, aiType: 'artillery' }
        ]
      },
      firepower: {
        name: '火力打击（炮兵支援）',
        entities: [
          // 红方突击部队
          { side: 'red', equipmentType: 'tank', x: 4000, y: 4800, aiType: 'combat' },
          { side: 'red', equipmentType: 'tank', x: 4200, y: 4700, aiType: 'combat' },
          { side: 'red', equipmentType: 'infantry', x: 4100, y: 4900, aiType: 'combat' },
          // 红方远程炮兵（后方）
          { side: 'red', equipmentType: 'artillery', x: 3200, y: 4400, aiType: 'artillery' },
          { side: 'red', equipmentType: 'artillery', x: 3300, y: 4300, aiType: 'artillery' },
          // 蓝方防御阵地
          { side: 'blue', equipmentType: 'tank', x: 5500, y: 5200, aiType: 'defensive' },
          { side: 'blue', equipmentType: 'tank', x: 5700, y: 5100, aiType: 'defensive' },
          { side: 'blue', equipmentType: 'infantry', x: 5600, y: 5300, aiType: 'defensive' },
          { side: 'blue', equipmentType: 'air_defense', x: 5800, y: 5000, aiType: 'defensive' }
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
  /**
   * 清空画布上的全部元素：单位标记（兵力/战机/人员）、射程与雷达圈、单位路径、
   * 空战航迹/导弹/双机标签、起飞点标记、攻击动画、3D 特效以及演习区域
   */
  clearAllEntities() {
    // 回放中会不断重绘实体，先停止回放
    if (this.replayPlaying) {
      this.stopReplay();
      const replayBar = document.getElementById('replayBar');
      if (replayBar) replayBar.style.display = 'none';
    }

    // 停止推演并让服务器清空实体（服务端同时重置统计与对决状态并广播新状态）
    this.send({ cmd: 'clearAllEntities' });

    // 攻击动画与 3D 特效
    if (this.attackAnimations) this.attackAnimations.clearAll();
    if (this.view3d) this.view3d.clearEffects();

    // 地图：单位标记、射程/视野/雷达圈、路径、空战航迹与导弹
    if (this.map2d) this.map2d.clear();

    // 空战对决：起飞点标记、已选位置、跟随与态势条
    if (this.airDuel) this.airDuel.reset();

    // 若正在划定区域，先取消（含拖拽中的临时矩形）
    if (this._areaSelectionHandlers) {
      this.cancelAreaSelection();
    }

    // 演习区域（矩形 / 网格 / 标签）
    if (this.map2d?.exerciseArea || this.exerciseAreaSet) {
      this.deleteExerciseArea();
    }

    // 选中态与侧边栏
    this.selectedEntity = null;
    const selPanel = document.getElementById('selectedEntity');
    if (selPanel) selPanel.innerHTML = '<p class="no-selection">未选择单位</p>';
    if (this.statsPanel) this.statsPanel.reset();

    // 广播到达前先清空本地状态，避免画面残留
    if (this.state) {
      this.state.entities = [];
      this.state.duel = null;
      this.state.missiles = [];
      this.state.trails = [];
    }
    document.getElementById('entityCount').textContent = '0';
    document.getElementById('redUnits').textContent = '0';
    document.getElementById('blueUnits').textContent = '0';

    this.addLog('🗑️ 已清空画布上的所有单位、战机标记与演习区域', 'info');
  }

  /**
   * 回放结束后清空场景
   */
  clearSceneAfterReplay() {
    // 停止回放
    this.stopReplay();

    // 清除攻击动画
    if (this.attackAnimations) {
      this.attackAnimations.clearAll();
    }

    // 清空地图上的实体与 3D 空战特效
    this.map2d.clear();
    if (this.view3d) this.view3d.clearEffects();

    // 清空状态
    this.state = null;
    this.replay = null;
    this.replayInitialScene = null;
    this.replayFinalResult = null;

    // 关闭回放控制条
    const replayBar = document.getElementById('replayBar');
    if (replayBar) replayBar.style.display = 'none';

    // 重置UI
    document.getElementById('simTime').textContent = '0s';
    document.getElementById('entityCount').textContent = '0';
    document.getElementById('redUnits').textContent = '0';
    document.getElementById('blueUnits').textContent = '0';
    if (this.statsPanel) {
      this.statsPanel.reset();
    }

    // 通知服务器清空实体（避免影响下次推演）
    this.send({ cmd: 'clearAllEntities' });

    this.addLog('回放结束，场景已清空', 'info');
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
      this._tempAreaRect = tempRect; // 保存引用，便于取消/清空时移除
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
      this._tempAreaRect = null;
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
      btn.textContent = '📍 划定区域';
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

    // 移除拖拽中的临时矩形
    if (this._tempAreaRect) {
      this.map2d.map.removeLayer(this._tempAreaRect);
      this._tempAreaRect = null;
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
