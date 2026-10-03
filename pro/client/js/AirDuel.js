/**
 * AirDuel - 空战对决面板控制器
 * 负责：机型与高度/风格选择、在地图上点取出身点、对称自动布置、
 *       发送 startDuel/stopDuel 命令、渲染双方态势条、双机跟随视角
 */
/**
 * 可选机型的中文名与战术特性
 * 用于在下拉框提示、日志与态势条中区分不同型号
 */
const DUEL_AIRCRAFT_INFO = {
  fighter:       { label: '歼-20 隐身型', trait: '高速隐身 · 4弹 · 盘旋30°/s' },
  fighter_heavy: { label: '歼-16 重型',   trait: '载弹量大 · 6弹 · 盘旋24°/s' },
  fighter_light: { label: '歼-10C 轻型',  trait: '极致灵活 · 2弹 · 盘旋36°/s' }
};

class AirDuel {
  constructor(app) {
    this.app = app;
    this.map2d = app.map2d;

    // 出生位置（仿真坐标）
    this.positions = { red: null, blue: null };
    this.pickMode = null; // 'red' | 'blue' | null
    this.markers = { red: null, blue: null };
    this.following = false;
    this.active = false;

    this.el = {
      redType: document.getElementById('duelRedType'),
      blueType: document.getElementById('duelBlueType'),
      altitude: document.getElementById('duelAltitude'),
      style: document.getElementById('duelStyle'),
      hint: document.getElementById('duelHint'),
      status: document.getElementById('duelStatus'),
      redName: document.getElementById('duelRedName'),
      blueName: document.getElementById('duelBlueName'),
      redHp: document.getElementById('duelRedHp'),
      blueHp: document.getElementById('duelBlueHp'),
      redMeta: document.getElementById('duelRedMeta'),
      blueMeta: document.getElementById('duelBlueMeta'),
      redManeuver: document.getElementById('duelRedManeuver'),
      blueManeuver: document.getElementById('duelBlueManeuver'),
      distance: document.getElementById('duelDistance'),
      time: document.getElementById('duelTime'),
      btnPickRed: document.getElementById('btnPickRed'),
      btnPickBlue: document.getElementById('btnPickBlue'),
      btnAutoDeploy: document.getElementById('btnAutoDeploy'),
      btnStartDuel: document.getElementById('btnStartDuel'),
      btnStopDuel: document.getElementById('btnStopDuel'),
      btnFollow: document.getElementById('btnFollowDuel')
    };
  }

  init() {
    this.el.btnPickRed?.addEventListener('click', () => this.togglePick('red'));
    this.el.btnPickBlue?.addEventListener('click', () => this.togglePick('blue'));
    this.el.btnAutoDeploy?.addEventListener('click', () => this.autoDeploy());
    this.el.btnStartDuel?.addEventListener('click', () => this.startDuel());
    this.el.btnStopDuel?.addEventListener('click', () => this.stopDuel());
    this.el.btnFollow?.addEventListener('click', () => this.toggleFollow());

    // 机型下拉联动：即时显示双方机型差异
    [this.el.redType, this.el.blueType].forEach(el => {
      el?.addEventListener('change', () => this.refreshTypeHint());
    });
    this.refreshTypeHint();
  }

  /**
   * 依据当前下拉选择刷新机型对比提示（格斗中或位置已确定时不覆盖状态提示）
   */
  refreshTypeHint() {
    if (this.active) return;
    if (this.positions.red && this.positions.blue) return;
    const info = t => DUEL_AIRCRAFT_INFO[t] || DUEL_AIRCRAFT_INFO.fighter;
    const r = info(this.el.redType?.value);
    const b = info(this.el.blueType?.value);
    this.setHint(`🔴 ${r.label}（${r.trait}）　VS　🔵 ${b.label}（${b.trait}）`);
  }

  // ====== 点取出身位置 ======

  /**
   * 起飞点标记：旗标 + 「红/蓝方起飞点」文字，颜色区分阵营
   * （格斗开始后会淡化，避免被误认为战机当前位置）
   */
  createSpawnMarker(side, latlng) {
    const isRed = side === 'red';
    const color = isRed ? '#ff6b6b' : '#4dabf7';
    return L.marker(latlng, {
      icon: L.divIcon({
        className: `duel-spawn-marker ${isRed ? 'red' : 'blue'}`,
        html: `<div class="duel-spawn-flag" style="color:${color}">⚑</div>
               <div class="duel-spawn-text" style="color:${color}">${isRed ? '红' : '蓝'}方起飞点</div>`,
        iconSize: [64, 28],
        iconAnchor: [32, 24]
      })
    });
  }

  /**
   * 淡化/恢复起飞点标记
   */
  setSpawnMarkersFaded(faded) {
    for (const side of ['red', 'blue']) {
      const el = this.markers[side]?.getElement?.();
      if (el) el.classList.toggle('duel-spawn-faded', !!faded);
    }
  }

  isPicking() {
    return this.pickMode !== null;
  }

  togglePick(side) {
    this.pickMode = this.pickMode === side ? null : side;
    const other = side === 'red' ? this.el.btnPickBlue : this.el.btnPickRed;
    const self = side === 'red' ? this.el.btnPickRed : this.el.btnPickBlue;

    if (other) other.textContent = side === 'red' ? '📍 点选蓝方' : '📍 点选红方';
    if (self) {
      self.textContent = this.pickMode === side
        ? (side === 'red' ? '✅ 点击地图…' : '✅ 点击地图…')
        : (side === 'red' ? '📍 点选红方' : '📍 点选蓝方');
    }

    this.setHint(this.pickMode === side
      ? `💡 请点击地图确定${side === 'red' ? '红' : '蓝'}方战机的起飞位置`
      : '💡 点选双方出身位置后开始格斗，或直接「对称自动布置」');

    if (this.map2d?.map) {
      this.map2d.map.getContainer().style.cursor = this.pickMode ? 'crosshair' : '';
    }
  }

  handleMapClick(e) {
    if (!this.pickMode || !e?.latlng) return false;

    // 未划定演习区域时坐标无法换算，提示用户先设置区域
    if (!this.map2d?.coordTransform) {
      alert('请先点击工具栏「📍 划定区域」设置演习区域，或切换到实战模式后再布置战机');
      this.pickMode = null;
      if (this.map2d?.map) this.map2d.map.getContainer().style.cursor = '';
      return true;
    }

    const side = this.pickMode;
    const simPos = this.map2d.geoToSim(e.latlng.lat, e.latlng.lng);
    this.positions[side] = { x: simPos.x, y: simPos.y };

    // 清除旧标记
    if (this.markers[side] && this.map2d.map) {
      this.map2d.map.removeLayer(this.markers[side]);
    }

    // 起飞点用「旗标 + 文字」，与实时战机标签（▲/◆）明显区分
    this.markers[side] = this.createSpawnMarker(side, e.latlng).addTo(this.map2d.map);

    this.markers[side].bindTooltip(`${side === 'red' ? '红' : '蓝'}方起飞点 (${simPos.x}, ${simPos.y})`, {
      direction: 'top'
    });

    this.pickMode = null;
    if (this.map2d.map) this.map2d.map.getContainer().style.cursor = '';
    const btn = side === 'red' ? this.el.btnPickRed : this.el.btnPickBlue;
    if (btn) btn.textContent = side === 'red' ? '📍 点选红方（已选）' : '📍 点选蓝方（已选）';

    const red = this.positions.red;
    const blue = this.positions.blue;
    if (red && blue) {
      const d = Math.round(Math.hypot(blue.x - red.x, blue.y - red.y));
      this.setHint(`✅ 双方位置已确定，起始距离 ${d} 米，点击「⚔️ 开始格斗」`);
    } else {
      this.setHint(`💡 继续点选${side === 'red' ? '蓝' : '红'}方战机的起飞位置`);
    }
    return true;
  }

  autoDeploy() {
    if (!this.map2d?.coordTransform) {
      alert('请先点击工具栏「📍 划定区域」设置演习区域，或切换到实战模式后再自动布置');
      return;
    }

    // 以演习区中心为基准，东西对称、相向而飞
    this.positions.red = { x: 3000, y: 5000 };
    this.positions.blue = { x: 7000, y: 5000 };

    for (const side of ['red', 'blue']) {
      const pos = this.positions[side];
      const geo = this.map2d.simToGeo(pos.x, pos.y);
      if (this.markers[side] && this.map2d.map) {
        this.map2d.map.removeLayer(this.markers[side]);
      }
      this.markers[side] = this.createSpawnMarker(side, [geo.lat, geo.lng]).addTo(this.map2d.map);
    }

    if (this.el.btnPickRed) this.el.btnPickRed.textContent = '📍 点选红方（已选）';
    if (this.el.btnPickBlue) this.el.btnPickBlue.textContent = '📍 点选蓝方（已选）';
    this.setHint('✅ 已对称自动布置：红方西侧、蓝方东侧，相距约 4000 米，相向而飞');
  }

  // ====== 开始 / 结束 ======

  startDuel() {
    if (!this.positions.red || !this.positions.blue) {
      alert('请先点选红方与蓝方战机的起飞位置（或点击「对称自动布置」）');
      return;
    }

    const altitude = Number(this.el.altitude?.value || 5000);
    const style = this.el.style?.value || 'balanced';

    const config = {
      red: {
        type: this.el.redType?.value || 'fighter',
        x: this.positions.red.x,
        y: this.positions.red.y,
        altitude
      },
      blue: {
        type: this.el.blueType?.value || 'fighter_heavy',
        x: this.positions.blue.x,
        y: this.positions.blue.y,
        altitude
      },
      style
    };

    this.active = true;
    this.app._endDialogShown = false; // 允许新一轮对决再次弹出结算
    this.app.send({ cmd: 'startDuel', config });

    const info = t => DUEL_AIRCRAFT_INFO[t] || DUEL_AIRCRAFT_INFO.fighter;
    this.app.addLog(
      `⚔️ 空战对决开始：🔴 ${info(config.red.type).label} VS 🔵 ${info(config.blue.type).label}，初始高度 ${altitude}m`,
      'info'
    );

    // 起飞点标记淡化：实时位置由地图上的 ▲/◆ 标签表示
    this.setSpawnMarkersFaded(true);

    // 自动切到分屏视图，便于同时看 2D 态势与 3D 高度
    this.setViewMode('split');
    if (this.el.status) this.el.status.style.display = 'block';
    this.setHint('🔥 格斗进行中：咬尾追击 / 规避机动 / 航炮与中距弹交替');
  }

  stopDuel() {
    this.active = false;
    this.following = false;
    this.app.view3d?.setFollowDuel?.(false);
    this.app.send({ cmd: 'stopDuel' });
    this.clearMarkers();
    this.refreshTypeHint();
    if (this.el.status) this.el.status.style.display = 'none';
    if (this.el.btnFollow) this.el.btnFollow.textContent = '🎥 双机跟随';
    this.setHint('💡 点选双方出身位置后开始格斗，或直接「对称自动布置」');
  }

  toggleFollow() {
    this.following = !this.following;
    this.app.view3d?.setFollowDuel?.(this.following);
    if (this.el.btnFollow) {
      this.el.btnFollow.textContent = this.following ? '🎥 跟随中' : '🎥 双机跟随';
    }
  }

  clearMarkers() {
    for (const side of ['red', 'blue']) {
      if (this.markers[side] && this.map2d?.map) {
        this.map2d.map.removeLayer(this.markers[side]);
        this.markers[side] = null;
      }
    }
  }

  /**
   * 完全重置面板：清除起飞点标记、已选位置、跟随与态势条（用于「清空所有」）
   */
  reset() {
    this.pickMode = null;
    this.following = false;
    this.active = false;
    this.positions = { red: null, blue: null };
    this.clearMarkers();
    this.app.view3d?.setFollowDuel?.(false);

    if (this.el.btnPickRed) this.el.btnPickRed.textContent = '📍 点选红方';
    if (this.el.btnPickBlue) this.el.btnPickBlue.textContent = '📍 点选蓝方';
    if (this.el.btnFollow) this.el.btnFollow.textContent = '🎥 双机跟随';
    if (this.el.status) this.el.status.style.display = 'none';
    if (this.el.redHp) this.el.redHp.style.width = '100%';
    if (this.el.blueHp) this.el.blueHp.style.width = '100%';
    if (this.el.redMeta) this.el.redMeta.textContent = '--';
    if (this.el.blueMeta) this.el.blueMeta.textContent = '--';
    if (this.el.redManeuver) this.el.redManeuver.textContent = '待战';
    if (this.el.blueManeuver) this.el.blueManeuver.textContent = '待战';
    if (this.el.distance) this.el.distance.textContent = '距离 --';
    if (this.el.time) this.el.time.textContent = '⏱ 0s';
    if (this.map2d?.map) this.map2d.map.getContainer().style.cursor = '';

    this.refreshTypeHint();
  }

  setHint(text) {
    if (this.el.hint) this.el.hint.textContent = text;
  }

  setViewMode(mode) {
    const sel = document.getElementById('viewMode');
    if (!sel) return;
    sel.value = mode;
    sel.dispatchEvent(new Event('change'));
  }

  // ====== 态势渲染 ======

  update(duel) {
    if (!duel || !duel.enabled) return;

    if (this.el.status) this.el.status.style.display = 'block';

    const red = duel.parties?.red;
    const blue = duel.parties?.blue;

    if (red) {
      this.el.redName.textContent = `🔴 ${red.name || '红方'}`;
      this.el.redHp.style.width = `${red.hpPercent}%`;
      this.el.redMeta.textContent = `HP ${red.hp}/${red.maxHp} · ${red.speedKmh}km/h · ${red.altitude}m · 弹 ${red.missiles} · 焰 ${red.flares}`;
      this.el.redManeuver.textContent = `${red.maneuverLabel || '机动中'}${red.alive ? '' : '（已击落）'}${red.lockedBy ? ' ⚠️被锁定' : ''}`;
    }
    if (blue) {
      this.el.blueName.textContent = `🔵 ${blue.name || '蓝方'}`;
      this.el.blueHp.style.width = `${blue.hpPercent}%`;
      this.el.blueMeta.textContent = `HP ${blue.hp}/${blue.maxHp} · ${blue.speedKmh}km/h · ${blue.altitude}m · 弹 ${blue.missiles} · 焰 ${blue.flares}`;
      this.el.blueManeuver.textContent = `${blue.maneuverLabel || '机动中'}${blue.alive ? '' : '（已击落）'}${blue.lockedBy ? ' ⚠️被锁定' : ''}`;
    }

    if (this.el.distance) {
      const aspectText = {
        red_tail_chase: '红方咬尾',
        head_on: '对头迎击',
        beam: '侧向占位'
      }[duel.aspect] || '';
      this.el.distance.textContent = `距离 ${duel.distance ?? '--'}m ${aspectText ? '· ' + aspectText : ''}`;
    }
    if (this.el.time) {
      this.el.time.textContent = `⏱ ${duel.time}s / ${duel.maxTime}s`;
    }

    if (duel.missileCount > 0) {
      this.setHint(`🚀 ${duel.missileCount} 枚导弹在飞行中！`);
    } else if (duel.winner) {
      this.setHint(`🏆 ${duel.reason || '对决结束'}`);
    }
  }

  /**
   * 推演结束后清理临时图形（保留出生点标记便于再次开始）
   */
  onSimulationEnd() {
    this.active = false;
    this.setSpawnMarkersFaded(false);
  }
}

window.AirDuel = AirDuel;
