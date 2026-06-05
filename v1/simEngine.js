// Simple discrete-time simulation engine (unit-level, probabilistic combat)
class Simulation {
  constructor() {
    this.time = 0;
    this.ticking = null;
    this.dt = 1; // seconds per step
    this.entities = [];
    this.replay = [];
    this.sample = this.sampleScenario();
    this.loadScenario(this.sample);
  }

  sampleScenario() {
    return {
      meta: { name: 'sample' },
      entities: [
        { id: 'r1', side: 'red', type: 'tank', x: 100, y: 100, hp: 100 },
        { id: 'r2', side: 'red', type: 'infantry', x: 120, y: 110, hp: 50 },
        { id: 'b1', side: 'blue', type: 'tank', x: 400, y: 300, hp: 100 },
        { id: 'b2', side: 'blue', type: 'infantry', x: 380, y: 320, hp: 50 }
      ]
    };
  }

  loadScenario(scn) {
    this.time = 0;
    this.entities = scn.entities.map(e => Object.assign({}, e, this.getStatsForType(e.type)));
    this.replay = [{ time: this.time, entities: JSON.parse(JSON.stringify(this.entities)) }];
  }

  setEntities(list) { this.entities = list.map(e => Object.assign({}, e, this.getStatsForType(e.type))); }

  getStatsForType(type) {
    const map = {
      infantry: { speed: 10, range: 50, damage: 10, maxHp: 50 },
      tank: { speed: 6, range: 120, damage: 30, maxHp: 100 },
      apc: { speed: 8, range: 60, damage: 15, maxHp: 80 },
      plane: { speed: 50, range: 400, damage: 40, maxHp: 80 },
      ship: { speed: 12, range: 300, damage: 50, maxHp: 200 }
    };
    return map[type] || { speed: 5, range: 50, damage: 5, maxHp: 50 };
  }

  start(onTick) {
    if (this.ticking) return;
    this.ticking = setInterval(() => { this.step(); if (onTick) onTick(); }, 1000);
  }
  stop() { if (this.ticking) { clearInterval(this.ticking); this.ticking = null; } }

  step() {
    this.time += this.dt;
    // simple behavior: enemies move slightly towards average enemy position, and attack if in range
    const reds = this.entities.filter(e => e.hp > 0 && e.side === 'red');
    const blues = this.entities.filter(e => e.hp > 0 && e.side === 'blue');

    const stepMove = (unit, enemies) => {
      if (enemies.length === 0) return;
      const target = enemies[0];
      const dx = target.x - unit.x; const dy = target.y - unit.y;
      const dist = Math.hypot(dx, dy) || 1;
      const maxMove = unit.speed * (this.dt);
      unit.x += (dx / dist) * Math.min(maxMove, dist);
      unit.y += (dy / dist) * Math.min(maxMove, dist);
    };

    for (const u of this.entities) {
      if (u.hp <= 0) continue;
      const enemies = this.entities.filter(e => e.hp > 0 && e.side !== u.side);
      if (enemies.length === 0) continue;
      stepMove(u, enemies);
      // attack nearest
      const nearest = enemies.reduce((acc, e) => {
        const d = Math.hypot(e.x - u.x, e.y - u.y);
        return (!acc || d < acc.d) ? { e, d } : acc;
      }, null);
      if (nearest && nearest.d <= u.range) {
        const hitProb = 0.5; // simplified
        if (Math.random() < hitProb) {
          nearest.e.hp -= u.damage;
          if (nearest.e.hp < 0) nearest.e.hp = 0;
        }
      }
    }

    // record snapshot for replay
    this.replay.push({ time: this.time, entities: JSON.parse(JSON.stringify(this.entities)) });
    // cap replay length
    if (this.replay.length > 10000) this.replay.shift();
  }

  getState() { return { time: this.time, entities: this.entities }; }
  getReplay() { return this.replay; }
}

module.exports = Simulation;
