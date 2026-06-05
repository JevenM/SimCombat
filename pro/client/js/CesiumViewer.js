/**
 * CesiumViewer - 3D地图可视化器
 * 使用CesiumJS进行军事态势展示
 */
class CesiumViewer {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.viewer = null;
    this.entities = new Map(); // entityId -> CesiumEntity
    this.labels = new Map();
    this.rangeCircles = new Map();

    this.init();
  }

  init() {
    // 初始化Cesium Viewer
    Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJlYWE1OWVlMi05ZGU3LTRkMzAtYjNlMC0wYjY3ZTA5YjE0YzciLCJpZCI6NTYwODUsImlhdCI6MTY5NjA0MjE3OH0.MmK0RXva9E8Z7aW3F9X7v3z9z9z9z9z9z9z9z9z9z9z'; // demo token

    this.viewer = new Cesium.Viewer(this.container, {
      terrainProvider: new Cesium.EllipsoidTerrainProvider(),
      sceneMode: Cesium.SceneMode.SCENE3D,
      baseLayerPicker: true,
      geocoder: false,
      homeButton: true,
      sceneModePicker: true,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false
    });

    // 设置深色主题
    this.viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#1a1a2e');
    this.viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#1a1a2e');

    // 光照
    this.viewer.scene.light = new Cesium.DirectionalLight({
      direction: new Cesium.Cartesian3(0.5, -0.5, -1),
      intensity: 1.5
    });

    // 相机控制
    this.viewer.scene.screenSpaceCameraController.enableTilt = true;
    this.viewer.scene.screenSpaceCameraController.enableRotate = true;

    // 设置初始视角
    this.viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(0, 0, 15000),
      orientation: {
        heading: Cesium.Math.toRadians(0),
        pitch: Cesium.Math.toRadians(-60),
        roll: 0
      }
    });

    // 鼠标事件
    this.setupEvents();
  }

  setupEvents() {
    const handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);

    handler.setInputAction((click) => {
      const picked = this.viewer.scene.pick(click.position);
      if (Cesium.defined(picked) && picked.id) {
        this.onEntityClick?.(picked.id);
      } else {
        this.onMapClick?.(this.pickPosition(click.position));
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    handler.setInputAction((movement) => {
      const picked = this.viewer.scene.pick(movement.endPosition);
      this.container.style.cursor = Cesium.defined(picked) ? 'pointer' : 'default';
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  }

  pickPosition(windowPosition) {
    const ray = this.viewer.camera.getPickRay(windowPosition);
    const position = this.viewer.scene.globe.pick(ray, this.viewer.scene);
    if (position) {
      const carto = Cesium.Cartographic.fromCartesian(position);
      return {
        longitude: Cesium.Math.toDegrees(carto.longitude),
        latitude: Cesium.Math.toDegrees(carto.latitude),
        height: carto.height
      };
    }
    return null;
  }

  // 创建模型URI（使用简单几何体代替）
  getModelUri(type, side) {
    const color = side === 'red' ? 'DC3545' : '007BFF';

    const models = {
      tank: `/api/model/tank?color=${color}`,
      infantry: `/api/model/infantry?color=${color}`,
      plane: `/api/model/plane?color=${color}`,
      ship: `/api/model/ship?color=${color}`,
      default: `/api/model/box?color=${color}`
    };

    return models[type] || models.default;
  }

  // 添加/更新实体
  updateEntity(entity) {
    const id = entity.id;
    let cesiumEntity = this.entities.get(id);

    const longitude = entity.x / 111000; // 简化投影
    const latitude = entity.y / 111000;
    const height = entity.z || 0;

    // 颜色根据阵营
    const color = entity.side === 'red'
      ? Cesium.Color.fromCssColorString('#ff4444')
      : Cesium.Color.fromCssColorString('#4444ff');

    // 创建或更新
    if (!cesiumEntity) {
      cesiumEntity = this.viewer.entities.add({
        id: id,
        position: Cesium.Cartesian3.fromDegrees(longitude, latitude, height),
        model: {
          uri: this.getModelUri(entity.type, entity.side),
          minimumPixelSize: 32,
          maximumScale: 200
        },
        point: {
          pixelSize: 12,
          color: color,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
          scaleByDistance: new Cesium.NearFarScalar(1000, 2, 10000, 0.5)
        },
        box: {
          dimensions: new Cesium.Cartesian3(20, 20, this.getEntityHeight(entity.type)),
          material: color.withAlpha(0.3),
          outline: true,
          outlineColor: color
        },
        label: {
          text: `${entity.name || id}\nHP:${Math.round(entity.hp)}`,
          font: '12px sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -20),
          show: document.getElementById('showLabels')?.checked ?? true
        },
        properties: entity
      });

      this.entities.set(id, cesiumEntity);
    } else {
      // 更新位置
      cesiumEntity.position = Cesium.Cartesian3.fromDegrees(longitude, latitude, height);

      // 更新朝向
      if (entity.heading !== undefined) {
        cesiumEntity.orientation = Cesium.Transforms.headingPitchRollQuaternion(
          Cesium.Cartesian3.fromDegrees(longitude, latitude, height),
          new Cesium.HeadingPitchRoll(
            Cesium.Math.toRadians(entity.heading),
            0,
            0
          )
        );
      }

      // 更新标签
      if (cesiumEntity.label) {
        cesiumEntity.label.text = `${entity.name || id}\nHP:${Math.round(entity.hp)}`;
        cesiumEntity.label.show = document.getElementById('showLabels')?.checked ?? true;
      }

      // 更新颜色（根据血量）
      const hpPercent = entity.hp / (entity.maxHp || entity.hp);
      cesiumEntity.box.material = color.withAlpha(0.3 * hpPercent);
    }

    // 射程圆圈
    this.updateRangeCircle(entity, longitude, latitude, height, color);
  }

  getEntityHeight(type) {
    const heights = {
      infantry: 10,
      tank: 15,
      apc: 12,
      plane: 5,
      ship: 20,
      default: 15
    };
    return heights[type] || heights.default;
  }

  updateRangeCircle(entity, longitude, latitude, height, color) {
    const showRange = document.getElementById('showRange')?.checked;
    let rangeEntity = this.rangeCircles.get(entity.id);

    if (showRange && entity.range) {
      if (!rangeEntity) {
        rangeEntity = this.viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(longitude, latitude, height),
          ellipse: {
            semiMinorAxis: entity.range,
            semiMajorAxis: entity.range,
            material: color.withAlpha(0.1),
            outline: true,
            outlineColor: color.withAlpha(0.5),
            outlineWidth: 1,
            heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND
          }
        });
        this.rangeCircles.set(entity.id, rangeEntity);
      } else {
        rangeEntity.position = Cesium.Cartesian3.fromDegrees(longitude, latitude, height);
        rangeEntity.ellipse.show = true;
      }
    } else if (rangeEntity) {
      rangeEntity.ellipse.show = false;
    }
  }

  // 移除实体
  removeEntity(entityId) {
    const cesiumEntity = this.entities.get(entityId);
    if (cesiumEntity) {
      this.viewer.entities.remove(cesiumEntity);
      this.entities.delete(entityId);
    }

    const rangeEntity = this.rangeCircles.get(entityId);
    if (rangeEntity) {
      this.viewer.entities.remove(rangeEntity);
      this.rangeCircles.delete(entityId);
    }
  }

  // 添加特效（爆炸等）
  addExplosion(position, intensity = 1) {
    const { longitude, latitude, height } = position;

    // 爆炸粒子效果（简化）
    this.viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(longitude, latitude, height),
      ellipse: {
        semiMinorAxis: 50 * intensity,
        semiMajorAxis: 50 * intensity,
        material: Cesium.Color.ORANGE.withAlpha(0.8),
        outline: false
      },
      show: true
    });

    // 1秒后移除
    setTimeout(() => {
      const entities = this.viewer.entities.values;
      for (let i = entities.length - 1; i >= 0; i--) {
        const e = entities[i];
        if (e.ellipse && !e.properties) {
          // 移除特效实体
          this.viewer.entities.remove(e);
          break;
        }
      }
    }, 1000);
  }

  // 添加轨迹线
  addTrail(from, to, type = 'attack') {
    const color = type === 'attack' ? Cesium.Color.RED : Cesium.Color.YELLOW;

    this.viewer.entities.add({
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArrayHeights([
          from.longitude, from.latitude, from.height,
          to.longitude, to.latitude, to.height
        ]),
        width: 2,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.2,
          color: color
        })
      }
    });
  }

  // 清除所有
  clear() {
    this.entities.forEach((entity, id) => {
      this.viewer.entities.remove(entity);
    });
    this.rangeCircles.forEach((circle) => {
      this.viewer.entities.remove(circle);
    });
    this.entities.clear();
    this.rangeCircles.clear();
  }

  // 更新所有实体
  updateEntities(entities) {
    const currentIds = new Set(entities.map(e => e.id));

    // 移除不存在的
    for (const [id] of this.entities) {
      if (!currentIds.has(id)) {
        this.removeEntity(id);
      }
    }

    // 添加/更新
    for (const entity of entities) {
      this.updateEntity(entity);
    }
  }

  // 跟随实体
  followEntity(entityId) {
    const entity = this.entities.get(entityId);
    if (entity) {
      this.viewer.trackedEntity = entity;
    }
  }

  // 设置视角
  setView(mode, position) {
    switch (mode) {
      case 'top':
        this.viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(position.lon, position.lat, 5000),
          orientation: { heading: 0, pitch: -90, roll: 0 }
        });
        break;
      case 'global':
        this.viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(0, 0, 15000),
          orientation: { heading: 0, pitch: -45, roll: 0 }
        });
        break;
      default:
        break;
    }
  }

  // 加载地形数据
  loadTerrain(terrainData) {
    // 简化：创建程序化地形
    // 实际应用中可加载真实DEM数据
  }

  destroy() {
    if (this.viewer) {
      this.viewer.destroy();
      this.viewer = null;
    }
  }
}
