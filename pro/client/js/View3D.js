/**
 * View3D - Three.js 3D视图
 * 简化的3D态势显示
 */
class View3D {
  constructor(containerId) {
    this.containerId = containerId;
    this.container = document.getElementById(containerId);
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.entities = new Map();
    this.controls = null;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    // 空战对决可视化
    this.trailLines = new Map();    // entityId -> THREE.Line
    this.missileMeshes = new Map(); // missileId -> THREE.Mesh
    this.effects = [];              // 爆炸等临时特效
    this.followDuel = false;        // 双机跟随相机
    this.airTargets = [];           // 最近一次更新的空中单位（跟随相机用）
    this.explodedIds = new Set();   // 已生成爆炸特效的实体

    this.init();
  }

  init() {
    // 场景
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d1117);

    // 相机 - 俯瞰整个战场 (10000x10000米)
    const aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(45, aspect, 1, 50000);
    // 设置相机位置：战场中心上方，斜向俯瞰
    this.camera.position.set(5000, 12000, 8000);
    this.camera.lookAt(5000, 0, 5000);

    // 渲染器
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setClearColor(0x0d1117, 1);
    this.renderer.shadowMap.enabled = true;
    this.container.appendChild(this.renderer.domElement);

    // 灯光
    const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(200, 400, 200);
    dirLight.castShadow = true;
    this.scene.add(dirLight);

    // 地面网格
    this.createGround();

    // 事件
    this.bindEvents();

    // 启动渲染
    this.animate();
  }

  createGround() {
    // 创建仿真区域地面 (10000 x 10000 米)
    const width = 10000;
    const depth = 10000;

    // 主地面
    const geometry = new THREE.PlaneGeometry(width, depth);
    const material = new THREE.MeshLambertMaterial({
      color: 0x1a2332,
      side: THREE.DoubleSide
    });
    const ground = new THREE.Mesh(geometry, material);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(width/2, 0, depth/2);
    ground.receiveShadow = true;
    this.scene.add(ground);

    // 网格线 - 每1000米一条
    const gridHelper = new THREE.GridHelper(width, 10, 0x4a5568, 0x2d3748);
    gridHelper.position.set(width/2, 0.5, depth/2);
    this.scene.add(gridHelper);

    // 边界线
    const edges = new THREE.EdgesGeometry(geometry);
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0xe94560, linewidth: 2 });
    const border = new THREE.LineSegments(edges, lineMaterial);
    border.rotation.x = -Math.PI / 2;
    border.position.set(width/2, 1, depth/2);
    this.scene.add(border);

    // 坐标轴指示器 (在左下角)
    const axesHelper = new THREE.AxesHelper(500);
    axesHelper.position.set(100, 10, 100);
    this.scene.add(axesHelper);
  }

  createEntityMesh(entity) {
    const color = entity.side === 'red' ? 0xdc3545 : 0x007bff;
    const group = new THREE.Group();

    // 主体
    let geometry, material, mesh;

    switch (entity.type) {
      case 'tank':
        geometry = new THREE.BoxGeometry(20, 10, 30);
        material = new THREE.MeshPhongMaterial({ color });
        mesh = new THREE.Mesh(geometry, material);
        mesh.position.y = 5;

        // 炮塔
        const turretGeo = new THREE.BoxGeometry(12, 8, 15);
        const turret = new THREE.Mesh(turretGeo, material);
        turret.position.y = 10;
        group.add(mesh, turret);
        break;

      case 'infantry':
        geometry = new THREE.ConeGeometry(5, 15, 8);
        material = new THREE.MeshPhongMaterial({ color });
        mesh = new THREE.Mesh(geometry, material);
        mesh.position.y = 7.5;
        group.add(mesh);
        break;

      case 'plane':
      case 'air':
      case 'fighter':
      case 'fighter_heavy':
      case 'fighter_light':
      case 'bomber':
      case 'helicopter':
      case 'uav':
      case 'awacs':
        this.buildAircraft(group, entity, color);
        break;

      case 'ship':
        geometry = new THREE.BoxGeometry(40, 15, 80);
        material = new THREE.MeshPhongMaterial({ color });
        mesh = new THREE.Mesh(geometry, material);
        mesh.position.y = 7.5;
        group.add(mesh);
        break;

      default:
        geometry = new THREE.BoxGeometry(15, 15, 15);
        material = new THREE.MeshPhongMaterial({ color });
        mesh = new THREE.Mesh(geometry, material);
        mesh.position.y = 7.5;
        group.add(mesh);
    }

    // 健康指示器
    const hpPercent = entity.hp / (entity.maxHp || entity.hp);
    const hpBarGeo = new THREE.BoxGeometry(20, 3, 3);
    const hpBarMat = new THREE.MeshBasicMaterial({
      color: hpPercent > 0.5 ? 0x00ff00 : hpPercent > 0.25 ? 0xffff00 : 0xff0000
    });
    const hpBar = new THREE.Mesh(hpBarGeo, hpBarMat);
    hpBar.position.y = 25;
    hpBar.scale.x = hpPercent;
    group.add(hpBar);

    // 空中单位不绘制地面射程圈（避免超大圈遮挡态势）
    const isAircraft = this.isAirType(entity);

    // 射程圈（可选）
    if (entity.range && !isAircraft) {
      const rangeGeo = new THREE.CircleGeometry(entity.range, 32);
      const rangeMat = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.1,
        side: THREE.DoubleSide
      });
      const rangeCircle = new THREE.Mesh(rangeGeo, rangeMat);
      rangeCircle.rotation.x = -Math.PI / 2;
      rangeCircle.position.y = 1;
      rangeCircle.name = 'range';
      group.add(rangeCircle);
    }

    group.castShadow = true;
    group.userData = { entityId: entity.id };

    return group;
  }

  // ====== 空战可视化 ======

  // 判断是否空中单位
  isAirType(entity) {
    if (!entity) return false;
    if (entity.category === 'air') return true;
    return ['fighter', 'fighter_heavy', 'fighter_light', 'plane', 'air', 'bomber', 'helicopter', 'uav', 'awacs']
      .includes(entity.type || entity.equipmentType);
  }

  /**
   * 构建战机模型（机头指向 +X，机翼沿 ±Z 展开）
   * 尺寸按可视化需要放大，便于在 10km 级战场中观察
   */
  buildAircraft(group, entity, color) {
    const dark = entity.side === 'red' ? 0x7a1a1f : 0x0f3f7a;
    const bodyMat = new THREE.MeshPhongMaterial({ color });
    const wingMat = new THREE.MeshPhongMaterial({ color: dark });

    // 机身
    const fuselageGeo = new THREE.CylinderGeometry(16, 24, 240, 12);
    fuselageGeo.rotateZ(-Math.PI / 2);
    const fuselage = new THREE.Mesh(fuselageGeo, bodyMat);
    group.add(fuselage);

    // 机头锥
    const noseGeo = new THREE.ConeGeometry(16, 70, 12);
    noseGeo.rotateZ(-Math.PI / 2);
    const nose = new THREE.Mesh(noseGeo, bodyMat);
    nose.position.x = 150;
    group.add(nose);

    // 主翼
    const wingGeo = new THREE.BoxGeometry(70, 7, 280);
    const wing = new THREE.Mesh(wingGeo, wingMat);
    wing.position.set(-10, 0, 0);
    group.add(wing);

    // 平尾
    const tailGeo = new THREE.BoxGeometry(40, 6, 120);
    const tail = new THREE.Mesh(tailGeo, wingMat);
    tail.position.set(-100, 0, 0);
    group.add(tail);

    // 垂尾
    const finGeo = new THREE.BoxGeometry(50, 70, 7);
    const fin = new THREE.Mesh(finGeo, wingMat);
    fin.position.set(-105, 35, 0);
    group.add(fin);

    // 尾焰（远距离也能看到航向）
    const flameGeo = new THREE.ConeGeometry(13, 45, 8);
    flameGeo.rotateZ(Math.PI / 2);
    const flame = new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial({
      color: 0xffa500, transparent: true, opacity: 0.75
    }));
    flame.position.x = -150;
    flame.name = 'flame';
    group.add(flame);
  }

  /**
   * 更新空战可视化：航迹、导弹、击落爆炸
   */
  updateDuelVisuals(missiles = [], trails = [], entities = []) {
    if (!this.scene) return;

    // ---- 航迹 ----
    const activeTrailIds = new Set();
    for (const trail of trails) {
      if (!trail || !Array.isArray(trail.points) || trail.points.length < 2) continue;
      activeTrailIds.add(trail.entityId);

      const pts = trail.points.map(p => new THREE.Vector3(p[0], p[2] || 0, p[1]));
      const geometry = new THREE.BufferGeometry().setFromPoints(pts);
      const entityMeta = entities.find(e => e.id === trail.entityId);
      const color = entityMeta?.side === 'blue' ? 0x4dabf7 : 0xff6b6b;

      let line = this.trailLines.get(trail.entityId);
      if (!line) {
        line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8 }));
        line.userData.entityId = trail.entityId;
        this.scene.add(line);
        this.trailLines.set(trail.entityId, line);
      } else {
        line.geometry.dispose();
        line.geometry = geometry;
        line.material.color.setHex(color);
      }
    }
    for (const [id, line] of this.trailLines) {
      if (!activeTrailIds.has(id)) {
        this.scene.remove(line);
        line.geometry.dispose();
        this.trailLines.delete(id);
      }
    }

    // ---- 导弹 ----
    const activeMissileIds = new Set();
    for (const m of missiles) {
      if (!m || !m.id) continue;
      activeMissileIds.add(m.id);

      let mesh = this.missileMeshes.get(m.id);
      if (!mesh) {
        const geo = new THREE.ConeGeometry(9, 45, 8);
        geo.rotateZ(-Math.PI / 2);
        mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
          color: m.side === 'blue' ? 0x9ad0ff : 0xffb3b3
        }));
        mesh.userData.missileId = m.id;
        this.scene.add(mesh);
        this.missileMeshes.set(m.id, mesh);
      }
      mesh.position.set(m.x, m.z || 0, m.y);
      mesh.rotation.set(0, -(m.heading || 0) * Math.PI / 180, 0);
    }
    for (const [id, mesh] of this.missileMeshes) {
      if (!activeMissileIds.has(id)) {
        this.scene.remove(mesh);
        this.missileMeshes.delete(id);
      }
    }

    // ---- 击落爆炸 ----
    for (const e of entities) {
      if (e.hp <= 0 && !this.explodedIds.has(e.id)) {
        this.explodedIds.add(e.id);
        this.createExplosion(e.x, e.z || 0, e.y);
      }
    }
  }

  /**
   * 生成爆炸特效（扩散球体 + 淡出）
   */
  createExplosion(x, y, z) {
    const geo = new THREE.SphereGeometry(60, 12, 12);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff6b35, transparent: true, opacity: 0.9 });
    const sphere = new THREE.Mesh(geo, mat);
    sphere.position.set(x, Math.max(y, 60), z);
    sphere.userData.life = 1.6;
    this.scene.add(sphere);
    this.effects.push(sphere);
  }

  /**
   * 推进临时特效（爆炸扩散/淡出）
   */
  updateEffects(dt = 0.03) {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const fx = this.effects[i];
      fx.userData.life -= dt;
      const t = Math.max(0, fx.userData.life / 1.6);
      const scale = 1 + (1 - t) * 3;
      fx.scale.setScalar(scale);
      fx.material.opacity = t * 0.9;
      if (fx.userData.life <= 0) {
        this.scene.remove(fx);
        fx.geometry.dispose();
        this.effects.splice(i, 1);
      }
    }
  }

  /**
   * 清空所有空战临时图形（main.js cleanupAfterGame 会调用）
   */
  clearEffects() {
    if (!this.scene) return;
    this.trailLines.forEach(line => {
      this.scene.remove(line);
      line.geometry.dispose();
    });
    this.trailLines.clear();

    this.missileMeshes.forEach(mesh => this.scene.remove(mesh));
    this.missileMeshes.clear();

    this.effects.forEach(fx => {
      this.scene.remove(fx);
      fx.geometry.dispose();
    });
    this.effects = [];
    this.explodedIds.clear();
  }

  /**
   * 双机跟随相机：视角自动锁定两机中点
   */
  setFollowDuel(enabled) {
    this.followDuel = !!enabled;
    if (!this.followDuel && this.camera) {
      // 恢复全局俯瞰视角
      this.camera.position.set(5000, 12000, 8000);
      this.camera.lookAt(5000, 0, 5000);
    }
  }

  updateFollowCamera() {
    if (!this.followDuel || !this.camera || this.airTargets.length === 0) return;

    const alive = this.airTargets.filter(e => e.hp > 0);
    if (alive.length === 0) return;

    const cx = alive.reduce((s, e) => s + e.x, 0) / alive.length;
    const cy = alive.reduce((s, e) => s + e.y, 0) / alive.length;
    const cz = alive.reduce((s, e) => s + (e.z || 0), 0) / alive.length;

    // 相机保持在中点斜后上方，随双机间距自适应
    const spread = Math.max(1500, Math.hypot(
      alive[0].x - (alive[1]?.x ?? alive[0].x),
      alive[0].y - (alive[1]?.y ?? alive[0].y)
    ));
    const dist = Math.min(9000, spread * 1.6 + 1200);

    const target = new THREE.Vector3(cx, cz, cy);
    const dir = new THREE.Vector3(0.6, 0.75, 0.9).normalize().multiplyScalar(dist);
    this.camera.position.lerp(target.clone().add(dir), 0.12);
    this.camera.lookAt(target);
  }

  updateEntities(entities, showLabels = true, showRange = false) {
    const currentIds = new Set();

    // 记录空中单位，供双机跟随相机使用
    this.airTargets = entities.filter(e => this.isAirType(e));

    for (const entity of entities) {
      currentIds.add(entity.id);
      this.updateEntity(entity, showLabels, showRange);
    }

    // 移除不存在的
    for (const [id, mesh] of this.entities) {
      if (!currentIds.has(id)) {
        this.scene.remove(mesh);
        this.entities.delete(id);
      }
    }
  }

  updateEntity(entity, showLabels, showRange) {
    const id = entity.id;
    let mesh = this.entities.get(id);

    if (!mesh) {
      mesh = this.createEntityMesh(entity);
      this.scene.add(mesh);
      this.entities.set(id, mesh);
    }

    // 更新位置 - 直接使用仿真坐标 (0-10000)
    // Three.js: X轴向右，Z轴向屏幕深处（对应仿真的Y轴）
    mesh.position.x = entity.x;
    mesh.position.z = entity.y; // Three.js Z对应仿真的Y（深度）

    // 更新旋转：空中单位额外应用俯仰与滚转（YXZ 顺序下为 航向→俯仰→滚转）
    if (entity.heading !== undefined) {
      if (this.isAirType(entity)) {
        mesh.rotation.order = 'YZX';
        const roll = (entity.roll || 0) * Math.PI / 180;
        const pitch = (entity.pitch || 0) * Math.PI / 180;
        mesh.rotation.set(roll, -entity.heading * Math.PI / 180, pitch);
      } else {
        mesh.rotation.y = -entity.heading * Math.PI / 180;
      }
    }

    // 更新高度
    if (this.isAirType(entity)) {
      mesh.position.y = (entity.z || 50);
    } else if (entity.type === 'ship' || entity.type === 'submarine' || entity.type === 'destroyer' || entity.type === 'carrier' || entity.type === 'landing_ship') {
      mesh.position.y = 5; // 船在水面
    } else {
      mesh.position.y = 3; // 地面单位稍微抬高
    }

    // 更新射程圈显示
    const rangeMesh = mesh.getObjectByName('range');
    if (rangeMesh) {
      rangeMesh.visible = showRange;
    }
  }

  bindEvents() {
    // 鼠标点击选择
    this.renderer.domElement.addEventListener('click', (e) => {
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      this.raycaster.setFromCamera(this.mouse, this.camera);
      const intersects = this.raycaster.intersectObjects(this.scene.children, true);

      for (const intersect of intersects) {
        let obj = intersect.object;
        while (obj.parent && !obj.userData.entityId) {
          obj = obj.parent;
        }
        if (obj.userData.entityId) {
          this.onEntityClick?.(obj.userData.entityId);
          break;
        }
      }
    });

    // 简单的相机控制 - 修复版
    let isDragging = false;
    let isPanning = false;
    let isRotating = false;
    let previousMousePosition = { x: 0, y: 0 };

    // 相机目标点（战场中心）
    const target = new THREE.Vector3(5000, 0, 5000);

    this.renderer.domElement.addEventListener('mousedown', (e) => {
      isDragging = true;
      previousMousePosition = { x: e.clientX, y: e.clientY };

      // 左键旋转，右键平移
      if (e.button === 0) {
        isRotating = true;
        isPanning = false;
      } else if (e.button === 2) {
        isPanning = true;
        isRotating = false;
      }
    });

    this.renderer.domElement.addEventListener('contextmenu', (e) => {
      e.preventDefault(); // 禁用右键菜单
    });

    this.renderer.domElement.addEventListener('mousemove', (e) => {
      if (!isDragging) return;

      const deltaMove = {
        x: e.clientX - previousMousePosition.x,
        y: e.clientY - previousMousePosition.y
      };

      if (isRotating) {
        // 围绕目标点旋转
        const offset = new THREE.Vector3().subVectors(this.camera.position, target);
        const spherical = new THREE.Spherical().setFromVector3(offset);

        // 水平旋转
        spherical.theta -= deltaMove.x * 0.005;
        // 垂直旋转（限制俯仰角）
        spherical.phi += deltaMove.y * 0.005;
        spherical.phi = Math.max(0.1, Math.min(Math.PI / 2 - 0.1, spherical.phi));

        offset.setFromSpherical(spherical);
        this.camera.position.copy(target).add(offset);
        this.camera.lookAt(target);
      } else if (isPanning) {
        // 平移相机和目标点
        const moveSpeed = 5;
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);

        const moveX = right.multiplyScalar(-deltaMove.x * moveSpeed);
        const moveY = up.multiplyScalar(deltaMove.y * moveSpeed);

        this.camera.position.add(moveX).add(moveY);
        target.add(moveX).add(moveY);
      }

      previousMousePosition = { x: e.clientX, y: e.clientY };
    });

    this.renderer.domElement.addEventListener('mouseup', () => {
      isDragging = false;
      isRotating = false;
      isPanning = false;
    });

    // 滚轮缩放
    this.renderer.domElement.addEventListener('wheel', (e) => {
      e.preventDefault();
      const scale = e.deltaY > 0 ? 1.1 : 0.9;
      const offset = new THREE.Vector3().subVectors(this.camera.position, target);
      offset.multiplyScalar(scale);
      // 限制最小和最大距离
      const dist = offset.length();
      if (dist > 100 && dist < 30000) {
        this.camera.position.copy(target).add(offset);
      }
    });
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    this.updateEffects();
    this.updateFollowCamera();
    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    const aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
  }

  setVisible(visible) {
    this.container.style.display = visible ? 'block' : 'none';
  }

  // 聚焦到指定位置
  focusOnPosition(x, y) {
    // 计算新的相机位置 - 保持相机高度和角度，只改变目标点
    const targetX = x;
    const targetZ = y; // Three.js Z对应仿真的Y

    // 创建新的目标点
    const newTarget = new THREE.Vector3(targetX, 0, targetZ);

    // 计算当前相机相对目标的偏移
    const offset = new THREE.Vector3().subVectors(this.camera.position, newTarget);

    // 如果偏移太小（相机离目标太近），设置一个默认距离
    if (offset.length() < 1000) {
      offset.set(5000, 8000, 5000);
    }

    // 设置新的相机位置
    this.camera.position.copy(newTarget).add(offset);
    this.camera.lookAt(newTarget);
  }

  destroy() {
    if (this.renderer) {
      this.renderer.dispose();
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
