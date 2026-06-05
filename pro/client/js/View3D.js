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
    this.scene.background = new THREE.Color(0x1a1a2e);
    this.scene.fog = new THREE.Fog(0x1a1a2e, 100, 1000);

    // 相机
    const aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 10000);
    this.camera.position.set(500, 300, 500);
    this.camera.lookAt(0, 0, 0);

    // 渲染器
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
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
    // 地面
    const geometry = new THREE.PlaneGeometry(10000, 10000, 100, 100);
    const material = new THREE.MeshLambertMaterial({
      color: 0x3d5a80,
      transparent: true,
      opacity: 0.5
    });
    const ground = new THREE.Mesh(geometry, material);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // 网格
    const gridHelper = new THREE.GridHelper(10000, 100, 0x0f3460, 0x1a1a2e);
    this.scene.add(gridHelper);

    // 坐标轴
    const axesHelper = new THREE.AxesHelper(200);
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

    // 更新位置
    mesh.position.x = entity.x - 5000; // 居中
    mesh.position.z = entity.y - 5000;

    // 更新旋转
    if (entity.heading !== undefined) {
      mesh.rotation.y = -entity.heading * Math.PI / 180;
    }

    // 更新高度
    if (entity.type === 'plane' || entity.type === 'air') {
      mesh.position.y = entity.z || 50;
    } else {
      mesh.position.y = 0;
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

    // 简单的相机控制
    let isDragging = false;
    let previousMousePosition = { x: 0, y: 0 };

    this.renderer.domElement.addEventListener('mousedown', (e) => {
      isDragging = true;
      previousMousePosition = { x: e.clientX, y: e.clientY };
    });

    this.renderer.domElement.addEventListener('mousemove', (e) => {
      if (!isDragging) return;

      const deltaMove = {
        x: e.clientX - previousMousePosition.x,
        y: e.clientY - previousMousePosition.y
      };

      // 旋转相机
      const angle = deltaMove.x * 0.01;
      const radius = Math.sqrt(
        this.camera.position.x ** 2 +
        this.camera.position.z ** 2
      );
      const currentAngle = Math.atan2(this.camera.position.z, this.camera.position.x);
      const newAngle = currentAngle + angle;

      this.camera.position.x = radius * Math.cos(newAngle);
      this.camera.position.z = radius * Math.sin(newAngle);
      this.camera.lookAt(0, 0, 0);

      previousMousePosition = { x: e.clientX, y: e.clientY };
    });

    this.renderer.domElement.addEventListener('mouseup', () => {
      isDragging = false;
    });

    // 滚轮缩放
    this.renderer.domElement.addEventListener('wheel', (e) => {
      const scale = e.deltaY > 0 ? 1.1 : 0.9;
      this.camera.position.multiplyScalar(scale);
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

  destroy() {
    if (this.renderer) {
      this.renderer.dispose();
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
