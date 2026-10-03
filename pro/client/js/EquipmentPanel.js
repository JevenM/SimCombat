/**
 * EquipmentPanel - 装备参数编辑面板
 *
 * 能力：
 * 1. 调整内置机型（空中 / 地面 / 海上）的数值参数
 * 2. 以现有机型为模板复制出自定义机型，或直接新增机型
 * 3. 删除自定义机型、恢复内置机型为出厂参数
 *
 * 保存到服务端 data/equipment-overrides.json，重启后依然生效；
 * 参数变化会通过 WebSocket 广播给所有客户端（机型下拉同步刷新）。
 */
class EquipmentPanel {
  constructor(app) {
    this.app = app;
    this.database = {};
    this.custom = [];
    this.modified = [];
    this.category = 'air';
    this.selectedKey = null;
    this.draft = null;
    this.initUI();
  }

  // ==================== 字段定义 ====================
  static get SCHEMA() {
    return {
      base: {
        title: '📋 基础性能',
        fields: [
          { p: 'name', l: '名称', t: 'text' },
          { p: 'type', l: '兵种类别', t: 'select', opts: ['ground', 'air', 'naval'] },
          { p: 'mobility', l: '机动方式', t: 'select', opts: ['foot', 'tracked', 'wheeled', 'fixed', 'flight', 'naval'] },
          { p: 'hp', l: '生命值', step: 1 },
          { p: 'speed', l: '最大速度', unit: 'km/h', step: 1 },
          { p: 'range', l: '武器射程', unit: 'm', step: 10 },
          { p: 'damage', l: '单发伤害', step: 1 },
          { p: 'fireRate', l: '射速', unit: '发/秒', step: 0.1 },
          { p: 'accuracy', l: '命中率', unit: '0~1', step: 0.01 },
          { p: 'armor', l: '装甲减伤', unit: '0~1', step: 0.01 },
          { p: 'evasion', l: '机动规避', unit: '0~1', step: 0.01 },
          { p: 'detection', l: '探测能力', step: 5 },
          { p: 'vision', l: '视野距离', unit: 'm', step: 50 },
          { p: 'signature', l: '信号特征', unit: '0~1', step: 0.05 },
          { p: 'height', l: '作业高度', unit: 'm', step: 10 },
          { p: 'cost', l: '造价', step: 10 },
          { p: 'weapons', l: '武器挂点', unit: '逗号分隔', t: 'text' }
        ]
      },
      ground: {
        title: '🛡️ 地面特性',
        fields: [
          { p: 'transport', l: '载员/载重', step: 1 },
          { p: 'indirect', l: '间接射击（火炮）', t: 'bool' },
          { p: 'antiAir', l: '具备防空能力', t: 'bool' },
          { p: 'stealth', l: '低可探测', t: 'bool' }
        ]
      },
      naval: {
        title: '🚢 海上特性',
        fields: [
          { p: 'sonar', l: '声纳距离', unit: 'm', step: 10 },
          { p: 'maxDepth', l: '最大潜深', unit: 'm', step: 10 },
          { p: 'airwing', l: '舰载机数量', step: 1 },
          { p: 'transport', l: '运载量', step: 10 }
        ]
      },
      air: {
        title: '✈️ 飞行包线',
        fields: [
          { p: 'maxAltitude', l: '实用升限', unit: 'm', step: 500 },
          { p: 'fuel', l: '续航油量', unit: 's', step: 60 },
          { p: 'fuelConsumption', l: '油耗系数', step: 0.1 }
        ]
      },
      flight: {
        title: '🌀 空战机动（BFM）',
        fields: [
          { p: 'airCombat.turnRateDegPerSec', l: '最大稳定转弯率', unit: '°/s', step: 1 },
          { p: 'airCombat.maxG', l: '最大过载', unit: 'G', step: 0.5 },
          { p: 'airCombat.climbRate', l: '最大爬升率', unit: 'm/s', step: 10 },
          { p: 'airCombat.minSpeedMs', l: '失速下限', unit: 'm/s', step: 10 },
          { p: 'airCombat.maxSpeedMs', l: '极速上限', unit: 'm/s', step: 10 },
          { p: 'airCombat.flares', l: '红外干扰弹', unit: '枚', step: 1 }
        ]
      },
      cannon: {
        title: '🔫 航炮',
        fields: [
          { p: 'airCombat.cannon.range', l: '有效射程', unit: 'm', step: 50 },
          { p: 'airCombat.cannon.coneDeg', l: '射击锥半角', unit: '°', step: 0.5 },
          { p: 'airCombat.cannon.damage', l: '单发伤害', step: 1 },
          { p: 'airCombat.cannon.fireRate', l: '射速', unit: '发/秒', step: 0.5 },
          { p: 'airCombat.cannon.accuracy', l: '基础命中率', unit: '0~1', step: 0.01 }
        ]
      },
      missile: {
        title: '🚀 空空导弹',
        fields: [
          { p: 'airCombat.missile.count', l: '挂载数量', unit: '枚', step: 1 },
          { p: 'airCombat.missile.range', l: '最大射程', unit: 'm', step: 100 },
          { p: 'airCombat.missile.launchMin', l: '最小发射距离', unit: 'm', step: 50 },
          { p: 'airCombat.missile.speed', l: '飞行速度', unit: 'm/s', step: 10 },
          { p: 'airCombat.missile.damage', l: '战斗部伤害', step: 5 },
          { p: 'airCombat.missile.hitProb', l: '基础命中率', unit: '0~1', step: 0.01 },
          { p: 'airCombat.missile.lifeSec', l: '续航时间', unit: 's', step: 1 },
          { p: 'airCombat.missile.proxyFuze', l: '近炸引信半径', unit: 'm', step: 5 },
          { p: 'airCombat.missile.lockSec', l: '锁定耗时', unit: 's', step: 0.1 },
          { p: 'airCombat.missile.reloadSec', l: '装填间隔', unit: 's', step: 0.5 }
        ]
      }
    };
  }

  // ==================== DOM ====================
  initUI() {
    const cat = document.getElementById('equipCategory');
    const list = document.getElementById('equipType');
    if (!cat || !list) return;

    cat.addEventListener('change', () => {
      this.category = cat.value;
      this.renderTypeList();
    });
    list.addEventListener('change', () => {
      this.selectType(list.value);
    });

    document.getElementById('btnEquipSave')?.addEventListener('click', () => this.save());
    document.getElementById('btnEquipClone')?.addEventListener('click', () => this.clone());
    document.getElementById('btnEquipDelete')?.addEventListener('click', () => this.remove());
    document.getElementById('btnEquipReset')?.addEventListener('click', () => this.reset());
    document.getElementById('btnEquipResetAll')?.addEventListener('click', () => this.resetAll());
  }

  // ==================== 数据加载 ====================
  async load() {
    try {
      const res = await fetch('/api/equipment');
      const json = await res.json();
      // 兼容早期直接返回数据库的格式
      this.setDatabase(json.database ? json : { database: json, custom: [], modified: [] });
    } catch (err) {
      this.app?.addLog?.(`装备库加载失败: ${err.message}`, 'error');
    }
  }

  setDatabase(payload) {
    if (!payload || !payload.database) return;
    this.database = payload.database;
    this.custom = payload.custom || [];
    this.modified = payload.modified || [];

    if (!this.selectedKey || !this.database[this.selectedKey]) {
      const first = this.typesOfCategory(this.category)[0];
      this.selectedKey = first?.key || null;
    }
    this.renderTypeList();
    this.renderForm();
    // 同步各处机型下拉（想定编辑器 / 空战对决）
    this.app?.refreshEquipmentOptions?.(this.database, this.custom);
  }

  // ==================== 列表 ====================
  typesOfCategory(cat) {
    const entries = Object.entries(this.database);
    const pick = (t) => entries.filter(([, d]) => d.type === t)
      .map(([key, d]) => ({ key, name: d.name || key }));
    if (cat === 'custom') {
      return entries.filter(([key]) => this.custom.includes(key))
        .map(([key, d]) => ({ key, name: d.name || key }));
    }
    return pick(cat);
  }

  renderTypeList() {
    const list = document.getElementById('equipType');
    if (!list) return;
    const types = this.typesOfCategory(this.category);
    const value = this.selectedKey && types.some(t => t.key === this.selectedKey)
      ? this.selectedKey
      : (types[0]?.key || '');

    list.innerHTML = types.length
      ? types.map(t => {
        const tag = this.custom.includes(t.key) ? '⭐ ' : '';
        const mod = this.modified.includes(t.key) ? '✏️ ' : '';
        return `<option value="${t.key}">${tag}${mod}${t.name}</option>`;
      }).join('')
      : '<option value="">-- 无可用机型 --</option>';

    list.value = value;
    this.selectedKey = value || null;
  }

  selectType(key) {
    if (!key) return;
    this.selectedKey = key;
    this.renderForm();
  }

  currentData() {
    return this.selectedKey ? this.database[this.selectedKey] : null;
  }

  // ==================== 表单 ====================
  renderForm() {
    const form = document.getElementById('equipForm');
    const meta = document.getElementById('equipMeta');
    const data = this.currentData();
    if (!form) return;

    if (!data) {
      form.innerHTML = '<div class="editor-hint">请在上方选择机型</div>';
      if (meta) meta.textContent = '';
      return;
    }

    // 深拷贝到草稿；weapons 数组转为可编辑文本
    this.draft = JSON.parse(JSON.stringify(data));
    const groups = this.groupsFor(data);
    form.innerHTML = groups.map(g => `
      <fieldset class="equip-group">
        <legend>${g.title}</legend>
        ${g.fields.map(f => this.renderField(f)).join('')}
      </fieldset>
    `).join('');

    // 下拉需要先回填当前值（模板里没有 selected）
    form.querySelectorAll('select[data-field]').forEach(sel => {
      const value = this.getByPath(this.draft, sel.dataset.field);
      if (value !== undefined && value !== null) sel.value = value;
    });

    // 绑定输入
    form.querySelectorAll('[data-field]').forEach(el => {
      el.addEventListener('input', () => {
        this.setValue(el.dataset.field, this.readInput(el));
      });
      el.addEventListener('change', () => {
        this.setValue(el.dataset.field, this.readInput(el));
      });
    });

    if (meta) {
      const tags = [this.custom.includes(this.selectedKey) ? '自定义机型' : '内置机型'];
      if (this.modified.includes(this.selectedKey)) tags.push('已修改');
      meta.innerHTML = `键名 <code>${this.selectedKey}</code> · ${tags.join(' · ')}`;
    }

    const delBtn = document.getElementById('btnEquipDelete');
    if (delBtn) delBtn.disabled = !this.custom.includes(this.selectedKey);
  }

  groupsFor(data) {
    const schema = EquipmentPanel.SCHEMA;
    const groups = [schema.base];
    if (data.type === 'ground') groups.push(schema.ground);
    if (data.type === 'naval') groups.push(schema.naval);
    if (data.type === 'air') {
      groups.push(schema.air, schema.flight, schema.cannon, schema.missile);
    }
    return groups;
  }

  renderField(f) {
    const raw = this.getByPath(this.draft, f.p);
    const label = f.unit ? `${f.l} (${f.unit})` : f.l;
    let input = '';

    if (f.t === 'select') {
      const opts = (f.opts || []).map(o => `<option value="${o}">${o}</option>`).join('');
      input = `<select data-field="${f.p}">${opts}</select>`;
    } else if (f.t === 'bool') {
      input = `<input type="checkbox" data-field="${f.p}">`;
    } else if (f.t === 'text') {
      let value = raw;
      if (f.p === 'weapons' && Array.isArray(raw)) value = raw.join(',');
      input = `<input type="text" data-field="${f.p}" value="${value ?? ''}">`;
    } else {
      const value = typeof raw === 'number' ? raw : 0;
      input = `<input type="number" step="${f.step || 0.01}" data-field="${f.p}" value="${value}">`;
    }

    return `<label class="equip-field"><span>${label}</span>${input}</label>`;
  }

  readInput(el) {
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'number') return el.value === '' ? 0 : Number(el.value);
    if (el.dataset.field === 'weapons') {
      return el.value.split(',').map(s => s.trim()).filter(Boolean);
    }
    if (el.dataset.field === 'mobility' || el.dataset.field === 'type') return el.value;
    return el.value;
  }

  getByPath(obj, path) {
    return path.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
  }

  setValue(path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    let target = this.draft;
    for (const k of keys) {
      if (target[k] == null) target[k] = {};
      target = target[k];
    }
    target[last] = value;
    // 生命值联动：hp 不会自动同步 maxHp，交由服务端补齐
    if (path === 'hp') target.maxHp = Math.max(value, target.maxHp ?? value);
  }

  collect() {
    const data = JSON.parse(JSON.stringify(this.draft));
    // 表单只编辑 hp，maxHp 随之对齐（不允许生命值超出上限）
    data.maxHp = Math.max(data.maxHp ?? 0, data.hp ?? 0);
    return data;
  }

  // ==================== 操作 ====================
  async save() {
    if (!this.selectedKey || !this.draft) return;
    try {
      const res = await fetch('/api/equipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'upsert', type: this.selectedKey, data: this.collect() })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || '保存失败');
      this.app?.addLog?.(`已保存机型参数: ${this.selectedKey}`, 'success');
    } catch (err) {
      this.app?.addLog?.(`机型参数保存失败: ${err.message}`, 'error');
    }
  }

  async clone() {
    const data = this.currentData();
    if (!data) return;
    const key = prompt('新机型键名（英文，如 my_fighter）：');
    if (!key) return;
    if (this.database[key] && !confirm(`键名 ${key} 已存在，是否覆盖？`)) return;

    const copy = JSON.parse(JSON.stringify(this.draft || data));
    copy.name = `${copy.name || this.selectedKey} 改型`;
    if (typeof copy.name === 'string') copy.name = String(copy.name);

    try {
      const res = await fetch('/api/equipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'upsert', type: key, data: copy })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || '创建失败');
      this.selectedKey = key;
      this.category = 'custom';
      const cat = document.getElementById('equipCategory');
      if (cat) cat.value = 'custom';
      this.app?.addLog?.(`已新增自定义机型: ${key}`, 'success');
    } catch (err) {
      this.app?.addLog?.(`新增机型失败: ${err.message}`, 'error');
    }
  }

  async remove() {
    if (!this.selectedKey || !this.custom.includes(this.selectedKey)) return;
    if (!confirm(`确认删除自定义机型「${this.database[this.selectedKey]?.name || this.selectedKey}」？`)) return;
    try {
      const res = await fetch('/api/equipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'delete', type: this.selectedKey })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || '删除失败');
      this.selectedKey = null;
      this.app?.addLog?.(`已删除自定义机型`, 'info');
    } catch (err) {
      this.app?.addLog?.(`删除失败: ${err.message}`, 'error');
    }
  }

  async reset() {
    if (!this.selectedKey) return;
    if (!confirm('将该机型恢复为出厂参数？（自定义机型会被删除）')) return;
    try {
      const res = await fetch('/api/equipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'reset', type: this.selectedKey })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || '恢复失败');
      this.app?.addLog?.(`已恢复默认参数`, 'info');
    } catch (err) {
      this.app?.addLog?.(`恢复失败: ${err.message}`, 'error');
    }
  }

  async resetAll() {
    if (!confirm('确认将全部装备恢复出厂设置？所有自定义机型将被删除。')) return;
    try {
      const res = await fetch('/api/equipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'resetAll' })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || '恢复失败');
      this.selectedKey = null;
      this.app?.addLog?.('装备库已恢复出厂设置', 'info');
    } catch (err) {
      this.app?.addLog?.(`恢复失败: ${err.message}`, 'error');
    }
  }
}

if (typeof window !== 'undefined') window.EquipmentPanel = EquipmentPanel;
