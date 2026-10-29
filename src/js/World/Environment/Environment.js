import { RectAreaLightTexturesLib } from 'three/addons/lights/RectAreaLightTexturesLib.js'
import * as THREE from 'three/webgpu'
import Experience from '../../Experience.js'

// 经实测放弃 HDR 环境贴图：studio HDR 与外壳 EXR Lightmap 重复计光，整体反而更平。
// 场景仍不设置 scene.environment；柔光箱通过面光源提供直接镜面与清漆高光，
// 不增加 IBL 或替换外壳烘焙。面光源不投影，主 DirectionalLight 继续承担阴影。
export default class Environment {
  constructor() {
    this.experience = new Experience()
    this.scene = this.experience.scene
    this.debug = this.experience.debug
    this.renderer = this.experience.renderer

    this.params = {
      background: '#f3f5f7',
      exposure: 1.03,
      hemisphereIntensity: 1.9,
      keyIntensity: 2.4,
      keyX: 2.9,
      keyY: 6,
      keyZ: 6.8,
      fillIntensity: 0.3,
      warmSoftbox: {
        enabled: true,
        color: '#ffffff',
        intensity: 5,
        width: 5,
        height: 3,
        x: -3.8,
        y: 4.8,
        z: 3.8,
        targetX: 0,
        targetY: 0.55,
        targetZ: -0.2,
      },
      neutralSoftbox: {
        enabled: true,
        color: '#f7f9fc',
        intensity: 1.4,
        width: 4,
        height: 2.5,
        x: 4.6,
        y: 2.8,
        z: 1.5,
        targetX: 0,
        targetY: 0.4,
        targetZ: -0.25,
      },
      shadowExtent: 4.0,
      shadowDepth: 6,
      shadowRadius: 10.0,
      shadowBias: 0,
      shadowNormalBias: 0.006,
      fitExhibitionShadow: true,
      showKeyLightHelper: false,
    }

    this.setLights()
    this.renderer.setExposure(this.params.exposure)
    this.debugInit()
  }

  setLights() {
    this.scene.background = new THREE.Color(this.params.background)

    this.hemisphereLight = new THREE.HemisphereLight('#f7f9fc', '#25282e', this.params.hemisphereIntensity)
    this.scene.add(this.hemisphereLight)

    this.keyLight = new THREE.DirectionalLight('#ffffff', this.params.keyIntensity)
    this.keyLight.castShadow = true
    this.keyLight.shadow.mapSize.set(2048, 2048)
    this.scene.add(this.keyLight)

    if (this.debug.enabled) {
      this.keyLightHelper = new THREE.DirectionalLightHelper(this.keyLight, 0.5, '#fbbf24')
      this.keyLightHelper.visible = this.params.showKeyLightHelper
      this.scene.add(this.keyLightHelper)
    }

    this.fillLight = new THREE.DirectionalLight('#dbe6ee', this.params.fillIntensity)
    this.fillLight.position.set(-4, 1.5, 3)
    this.scene.add(this.fillLight)

    this.setSoftboxes()
    this.applyKeyLight()
  }

  setSoftboxes() {
    // WebGPU 的面光源需要 LTC 纹理，不能使用 WebGL 的 UniformsLib 初始化路径。
    // 保存本实例的纹理引用，HMR 销毁时释放 GPU 资源，下一次初始化会创建新纹理。
    const library = RectAreaLightTexturesLib.init()
    this.ltcTextures = Object.fromEntries(
      ['LTC_FLOAT_1', 'LTC_FLOAT_2', 'LTC_HALF_1', 'LTC_HALF_2'].map(key => [key, library[key]]),
    )
    THREE.RectAreaLightNode.setLTC(this.ltcTextures)
    this.softboxes = [
      { name: 'Key softbox', params: this.params.warmSoftbox },
      { name: 'Neutral softbox', params: this.params.neutralSoftbox },
    ]
    for (const softbox of this.softboxes) {
      softbox.light = new THREE.RectAreaLight()
      softbox.light.name = softbox.name
      softbox.target = new THREE.Object3D()
      softbox.target.name = `${softbox.name} target`
      this.scene.add(softbox.light, softbox.target)
    }
    this.applySoftboxes()
  }

  applySoftboxes() {
    for (const { light, target, params } of this.softboxes) {
      // 灯与目标直接挂 Scene，参数均为场景世界坐标；RectAreaLight 向局部 -Z 发光。
      // 尺寸决定高光轮廓，降低半球填光后由它们补回有方向的照明，不靠曝光抬平。
      light.visible = params.enabled
      light.color.set(params.color)
      light.intensity = params.intensity
      light.width = params.width
      light.height = params.height
      light.position.set(params.x, params.y, params.z)
      target.position.set(params.targetX, params.targetY, params.targetZ)
      light.lookAt(target.position)
    }
  }

  applyKeyLight() {
    this.keyLight.position.set(this.params.keyX, this.params.keyY, this.params.keyZ)
    this.applyShadowSettings()
  }

  setShadowBounds(bounds) {
    this.shadowBounds = bounds.clone()
    this.applyShadowSettings()
  }

  applyShadowSettings() {
    const { shadow } = this.keyLight
    const camera = shadow.camera
    const extent = this.params.shadowExtent
    // 主光 target 保持在原点，因此光源到取景中心的距离就是位置向量长度。
    // 以该距离为中心收紧 near/far，替代默认的 0.5–500，避免深度精度全部浪费在空区间上。
    const distance = this.keyLight.position.length()

    camera.left = -extent
    camera.right = extent
    camera.top = extent
    camera.bottom = -extent
    camera.near = Math.max(0.1, distance - this.params.shadowDepth)
    camera.far = distance + this.params.shadowDepth
    if (this.params.fitExhibitionShadow && this.shadowBounds) {
      // 在灯光视空间包围展品及其落到地面的投影，保持用户的灯位/方向，
      // 只扩大必要的投影边界；2048² 贴图与原有主机覆盖范围保持不变。
      camera.position.copy(this.keyLight.position)
      camera.lookAt(this.keyLight.target.position)
      camera.updateMatrixWorld(true)
      const bounds = this.shadowBounds
      const lightBounds = new THREE.Box3()
      const point = new THREE.Vector3()
      const direction = this.keyLight.target.position.clone().sub(this.keyLight.position).normalize()
      for (const x of [bounds.min.x, bounds.max.x]) {
        for (const y of [bounds.min.y, bounds.max.y]) {
          for (const z of [bounds.min.z, bounds.max.z]) {
            point.set(x, y, z)
            lightBounds.expandByPoint(point.clone().applyMatrix4(camera.matrixWorldInverse))
            if (direction.y < -0.01) {
              point.addScaledVector(direction, (bounds.min.y - y) / direction.y)
              lightBounds.expandByPoint(point.applyMatrix4(camera.matrixWorldInverse))
            }
          }
        }
      }
      camera.left = Math.min(camera.left, lightBounds.min.x)
      camera.right = Math.max(camera.right, lightBounds.max.x)
      camera.bottom = Math.min(camera.bottom, lightBounds.min.y)
      camera.top = Math.max(camera.top, lightBounds.max.y)
      camera.near = Math.max(0.1, Math.min(camera.near, -lightBounds.max.z))
      camera.far = Math.max(camera.far, -lightBounds.min.z)
    }
    camera.updateProjectionMatrix()

    // PCFShadowMap 的软边由 radius 控制，单位是阴影贴图像素；1 接近硬边。
    shadow.radius = this.params.shadowRadius
    shadow.bias = this.params.shadowBias
    shadow.normalBias = this.params.shadowNormalBias
  }

  debugInit() {
    if (!this.debug.ui)
      return
    this.folder = this.debug.ui.addFolder({ title: 'Environment', expanded: false })

    this.folder.addBinding(this.params, 'background', { label: 'Background' })
      .on('change', ({ value }) => this.scene.background.set(value))
    this.folder.addBinding(this.params, 'exposure', {
      label: 'Exposure',
      min: 0.2,
      max: 3,
      step: 0.01,
    }).on('change', ({ value }) => this.renderer.setExposure(value))

    const lights = this.folder.addFolder({ title: 'Lights' })
    lights.addBinding(this.params, 'hemisphereIntensity', {
      label: 'Hemisphere',
      min: 0,
      max: 6,
      step: 0.05,
    }).on('change', ({ value }) => { this.hemisphereLight.intensity = value })
    lights.addBinding(this.params, 'keyIntensity', {
      label: 'Key',
      min: 0,
      max: 15,
      step: 0.1,
    }).on('change', ({ value }) => { this.keyLight.intensity = value })
    lights.addBinding(this.params, 'fillIntensity', {
      label: 'Fill',
      min: 0,
      max: 8,
      step: 0.05,
    }).on('change', ({ value }) => { this.fillLight.intensity = value })
    Object.entries({ keyX: 'Key X', keyY: 'Key Y', keyZ: 'Key Z' }).forEach(([key, label]) => {
      lights.addBinding(this.params, key, {
        label,
        min: -12,
        max: 12,
        step: 0.1,
      }).on('change', () => this.applyKeyLight())
    })
    lights.addBinding(this.params, 'showKeyLightHelper', {
      label: 'Key light helper',
    }).on('change', ({ value }) => { this.keyLightHelper.visible = value })

    for (const { name, params } of this.softboxes) {
      const softbox = lights.addFolder({ title: name, expanded: false })
      softbox.addBinding(params, 'enabled', { label: 'Enabled' }).on('change', () => this.applySoftboxes())
      softbox.addBinding(params, 'color', { label: 'Color' }).on('change', () => this.applySoftboxes())
      softbox.addBinding(params, 'intensity', { label: 'Intensity', min: 0, max: 12, step: 0.1 })
        .on('change', () => this.applySoftboxes())
      for (const key of ['width', 'height']) {
        softbox.addBinding(params, key, { min: 0.25, max: 10, step: 0.1 })
          .on('change', () => this.applySoftboxes())
      }
      for (const key of ['x', 'y', 'z', 'targetX', 'targetY', 'targetZ']) {
        softbox.addBinding(params, key, { min: -12, max: 12, step: 0.1 })
          .on('change', () => this.applySoftboxes())
      }
    }

    const shadows = this.folder.addFolder({ title: 'Key shadow' })
    shadows.addBinding(this.params, 'fitExhibitionShadow', { label: 'Fit exhibition' })
      .on('change', () => this.applyShadowSettings())
    shadows.addBinding(this.params, 'shadowExtent', {
      label: 'Extent',
      min: 1,
      max: 12,
      step: 0.1,
    }).on('change', () => this.applyShadowSettings())
    shadows.addBinding(this.params, 'shadowDepth', {
      label: 'Depth range',
      min: 1,
      max: 20,
      step: 0.1,
    }).on('change', () => this.applyShadowSettings())
    shadows.addBinding(this.params, 'shadowRadius', {
      label: 'Radius',
      min: 0,
      max: 20,
      step: 0.1,
    }).on('change', () => this.applyShadowSettings())
    shadows.addBinding(this.params, 'shadowBias', {
      label: 'Bias',
      min: -0.01,
      max: 0.01,
      step: 0.0001,
    }).on('change', () => this.applyShadowSettings())
    shadows.addBinding(this.params, 'shadowNormalBias', {
      label: 'Normal bias',
      min: 0,
      max: 0.2,
      step: 0.001,
    }).on('change', () => this.applyShadowSettings())
  }

  update() {
    if (this.keyLightHelper?.visible)
      this.keyLightHelper.update()
  }

  destroy() {
    this.folder?.dispose()
    this.scene.remove(this.hemisphereLight, this.keyLight, this.fillLight)
    this.keyLightHelper?.removeFromParent()
    this.keyLightHelper?.dispose()
    this.keyLight.shadow.map?.dispose()
    this.hemisphereLight.dispose()
    this.keyLight.dispose()
    this.fillLight.dispose()
    for (const { light, target } of this.softboxes) {
      this.scene.remove(light, target)
      light.dispose()
    }
    // LTC 是 Three 模块级输入；旧实例不得清掉新实例已替换的全局纹理。
    const ownsCurrentLTC = Object.entries(this.ltcTextures)
      .every(([key, texture]) => RectAreaLightTexturesLib[key] === texture)
    if (ownsCurrentLTC)
      THREE.RectAreaLightNode.setLTC(null)
    for (const [key, texture] of Object.entries(this.ltcTextures)) {
      texture.dispose()
      if (RectAreaLightTexturesLib[key] === texture)
        RectAreaLightTexturesLib[key] = null
    }
    this.scene.background = null
  }
}
