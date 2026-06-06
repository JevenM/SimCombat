/**
 * StatsPanel - 统计数据大屏控制
 */
class StatsPanel {
  constructor() {
    this.damageHistory = { red: [], blue: [] };
    this.maxHistory = 50;
    this.engagementCount = 0;
  }

  update(stats, combatEvents = [], isRunning = false, time = 0) {
    this.updateCasualtyStats(stats);
    this.updateDamageStats(stats);
    this.updateValueStats(stats);
    this.updateBattleStatus(stats, combatEvents, isRunning);
    this.checkConclusion(stats, isRunning, time);
  }

  updateCasualtyStats(stats) {
    const red = stats.redCasualties || 0;
    const blue = stats.blueCasualties || 0;
    const total = red + blue || 1;

    document.getElementById('redCasualties').textContent = red;
    document.getElementById('blueCasualties').textContent = blue;

    document.getElementById('redCasualtyBar').style.width = `${(red / total) * 100}%`;
    document.getElementById('blueCasualtyBar').style.width = `${(blue / total) * 100}%`;
  }

  updateDamageStats(stats) {
    const redDamage = Math.round(stats.redDamage || 0);
    const blueDamage = Math.round(stats.blueDamage || 0);

    document.getElementById('redDamage').textContent = redDamage;
    document.getElementById('blueDamage').textContent = blueDamage;

    // 添加到历史
    this.damageHistory.red.push(redDamage);
    this.damageHistory.blue.push(blueDamage);

    if (this.damageHistory.red.length > this.maxHistory) {
      this.damageHistory.red.shift();
      this.damageHistory.blue.shift();
    }

    // 绘制图表
    this.drawDamageChart();
  }

  drawDamageChart() {
    const canvas = document.getElementById('damageChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;

    ctx.clearRect(0, 0, width, height);

    const maxVal = Math.max(
      ...this.damageHistory.red,
      ...this.damageHistory.blue,
      100
    );

    // 绘制红色线
    ctx.strokeStyle = '#ff4444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < this.damageHistory.red.length; i++) {
      const x = (i / (this.maxHistory - 1)) * width;
      const y = height - (this.damageHistory.red[i] / maxVal) * height;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // 绘制蓝色线
    ctx.strokeStyle = '#4444ff';
    ctx.beginPath();
    for (let i = 0; i < this.damageHistory.blue.length; i++) {
      const x = (i / (this.maxHistory - 1)) * width;
      const y = height - (this.damageHistory.blue[i] / maxVal) * height;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  updateValueStats(stats) {
    const redValue = stats.redValue || 0;
    const blueValue = stats.blueValue || 0;
    const total = redValue + blueValue || 1;

    document.getElementById('redValue').textContent = redValue;
    document.getElementById('blueValue').textContent = blueValue;

    document.getElementById('redValueBar').style.width = `${(redValue / total) * 100}%`;
    document.getElementById('blueValueBar').style.width = `${(blueValue / total) * 100}%`;
  }

  updateBattleStatus(stats, combatEvents) {
    this.engagementCount += combatEvents.length;

    const statusEl = document.getElementById('statusText');
    if (stats.isRunning) {
      statusEl.textContent = '推演进行中';
      statusEl.className = 'value active';
    } else {
      statusEl.textContent = '推演暂停';
      statusEl.className = 'value paused';
    }

    document.getElementById('engagementCount').textContent = this.engagementCount;

    // 计算战术主导
    const dominantEl = document.getElementById('dominantSide');
    const redScore = (stats.redValue || 0) + (stats.blueCasualties || 0) * 10;
    const blueScore = (stats.blueValue || 0) + (stats.redCasualties || 0) * 10;

    if (redScore > blueScore * 1.2) {
      dominantEl.textContent = '红军优势';
      dominantEl.style.color = '#ff4444';
    } else if (blueScore > redScore * 1.2) {
      dominantEl.textContent = '蓝军优势';
      dominantEl.style.color = '#4444ff';
    } else {
      dominantEl.textContent = '相对均势';
      dominantEl.style.color = '#ffc107';
    }
  }

  checkConclusion(stats, isRunning = false, time = 0) {
    const conclusionEl = document.getElementById('conclusion');

    // 推演还未开始
    if (time === 0 && !isRunning && !stats.endTime) {
      conclusionEl.innerHTML = '<p class="pending">推演准备就绪 - 点击"开始推演"启动</p>';
      return;
    }

    // 推演正在进行中
    if (!stats.endTime) {
      conclusionEl.innerHTML = `<p class="pending">推演进行中... (时间: ${time}s)</p>`;
      return;
    }

    // 推演已结束 - 显示结果
    const winner = stats.winner;
    const reason = stats.endReason;

    let result = '';
    let className = '';

    if (winner === 'draw') {
      result = `推演结束：平局 - ${reason}`;
      className = 'draw';
    } else if (winner === 'red') {
      result = `推演结束：红军胜利！${reason}`;
      className = 'red-win';
    } else if (winner === 'blue') {
      result = `推演结束：蓝军胜利！${reason}`;
      className = 'blue-win';
    } else {
      // 向后兼容
      const redUnits = stats.redUnits || 0;
      const blueUnits = stats.blueUnits || 0;

      if (redUnits === 0 && blueUnits === 0) {
        result = '推演结果：两败俱伤，平局';
        className = 'draw';
      } else if (redUnits === 0) {
        result = '推演结果：蓝军胜利';
        className = 'blue-win';
      } else if (blueUnits === 0) {
        result = '推演结果：红军胜利';
        className = 'red-win';
      } else {
        const redRatio = stats.redValue / (stats.blueValue + 1);
        if (redRatio > 1.5) {
          result = '推演结果：红军决定性胜利';
          className = 'red-win';
        } else if (redRatio < 0.67) {
          result = '推演结果：蓝军决定性胜利';
          className = 'blue-win';
        } else {
          result = '推演结果：战术僵持';
          className = 'draw';
        }
      }
    }

    conclusionEl.innerHTML = `<p class="result ${className}">${result}</p>`;

    // 显示结束弹窗
    this.showEndGameModal(result, className);
  }

  showEndGameModal(result, className) {
    // 检查是否已经显示过弹窗
    if (this.endGameModalShown) return;
    this.endGameModalShown = true;

    const modal = document.createElement('div');
    modal.className = 'endgame-modal';
    modal.innerHTML = `
      <div class="endgame-overlay"></div>
      <div class="endgame-content">
        <h2>🎯 推演结束</h2>
        <div class="endgame-result ${className}">${result}</div>
        <div class="endgame-actions">
          <button id="btnSaveReplay" class="btn btn-primary">💾 保存回放</button>
          <button id="btnCloseModal" class="btn btn-secondary">关闭</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // 绑定按钮事件
    modal.querySelector('#btnSaveReplay').addEventListener('click', () => {
      window.app.saveReplay();
      modal.remove();
    });

    modal.querySelector('#btnCloseModal').addEventListener('click', () => {
      modal.remove();
    });
  }

  reset() {
    this.damageHistory = { red: [], blue: [] };
    this.engagementCount = 0;
    this.endGameModalShown = false;
  }
}
