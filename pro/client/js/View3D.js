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
        geometry = new THREE.BoxGeometry(30, 4, 20);
        material = new THREE.MeshPhongMaterial({ color });
        mesh = new THREE.Mesh(geometry, material);
        mesh.position.y = entity.z || 50;

        // 机翼
        const wingGeo = new THREE.BoxGeometry(10, 2, 40);
        const wing = new THREE.Mesh(wingGeo, material);
        wing.position.y = entity.z || 50;
        group.add(mesh, wing);
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

    // 射程圈（可选）
    if (entity.range) {
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

  updateEntities(entities, showLabels = true, showRange = false) {
    const currentIds = new Set();

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

    // 更新旋转
    if (entity.heading !== undefined) {
      mesh.rotation.y = -entity.heading * Math.PI / 180;
    }

    // 更新高度
    if (entity.type === 'plane' || entity.type === 'air' || entity.type === 'fighter' || entity.type === 'bomber' || entity.type === 'helicopter' || entity.type === 'uav') {
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
