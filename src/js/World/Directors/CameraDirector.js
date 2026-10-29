import { gsap } from 'gsap'
import * as THREE from 'three/webgpu'
import Experience from '../../Experience.js'

export default class CameraDirector {
  constructor() {
    this.experience = new Experience()
    this.camera = this.experience.camera
    this.events = this.experience.events
    this.debug = this.experience.debug
    this.params = {
      currentShot: 'none',
      orbitEnabled: false,
      // 相对当前镜头的摆动幅度。角度用度，距离是相对镜头距离的比例。
      orbitAzimuth: 25,
      orbitPolar: 15,
      orbitDistance: 0.35,
    }
    this.gestureOrbit = true
    this.orbitAnchor = null
    this.orbitOffset = new THREE.Vector3()
    this.orbitSpherical = new THREE.Spherical()
    this.lens = { fov: this.camera.instance.fov }
    // 镜头和 Target 都使用 PresentationRoot 归一化后的世界坐标，避免依赖 GLB 内的相机或原始毫米单位。
    this.shots = {
      folded: {
        positionX: 2.1,
        positionY: 2.6,
        positionZ: 4.5,
        targetX: 0,
        targetY: 0,
        targetZ: 0,
        fov: 30,
        duration: 1.2,
      },
      assembly: {
        positionX: 4.75,
        positionY: 9.15,
        positionZ: 1,
        targetX: -0.1,
        targetY: 0.2,
        targetZ: 1,
        fov: 27,
        duration: 2,
      },
      hero: {
        positionX: 0,
        positionY: 2.8,
        positionZ: 6.8,
        targetX: 0,
        targetY: 0.35,
        targetZ: 0.4,
        fov: 42,
        duration: 1.35,
      },
      // Hero 立起后上屏竖直、下屏仰 30°；注视点抬到两屏之间，视线约取两屏法线的中间方向。
      play: {
        positionX: 0,
        positionY: 3.9,
        positionZ: 5.5,
        targetX: 0,
        targetY: 1.05,
        targetZ: 0.6,
        fov: 36,
        duration: 1.1,
      },
    }
    this.stateShots = {
      'intro-folded': 'folded',
      'intro-unfold': 'assembly',
      'screen-wake': 'assembly',
      'controller-assembly': 'assembly',
      'game-changer': 'assembly',
      'hero': 'hero',
      'ready': 'hero',
    }
    this.productShots = {
      'game-home': 'hero',
      'playing': 'play',
    }

    this.camera.controls.enabled = true
    this.unsubscribeState = this.events.on('intro:state', ({ state }) => {
      this.handleState(state)
    })
    this.unsubscribeProductMode = this.events.on('product:mode', ({ mode }) => {
      this.handleProductMode(mode)
    })
    this.debugInit()
  }

  handleState(state) {
    const shotName = this.stateShots[state]
    if (!shotName)
      return

    this.transitionTo(shotName, {
      immediate: state === 'intro-folded',
    })
  }

  handleProductMode(mode) {
    const shotName = this.productShots[mode]
    if (!shotName)
      return

    // 已经在目标镜头上时不再重播过渡，但要按产品模式重新打开受限 Orbit。
    if (this.params.currentShot === shotName) {
      if (!this.timeline)
        this.restoreOrbitState({ recapture: true })
      return
    }

    this.transitionTo(shotName)
  }

  transitionTo(name, { immediate = false, force = false } = {}) {
    const shot = this.shots[name]
    if (!shot || (!force && this.params.currentShot === name))
      return

    this.killTransition()
    this.params.currentShot = name
    this.currentShotBinding?.refresh()
    // 过渡期间先放开角度钳制。controls.update() 每帧都会按限制回写相机，否则镜头会被夹在旧锚点上。
    this.camera.controls.enabled = false
    this.clearOrbitSpan()

    if (immediate || shot.duration === 0) {
      this.applyShot(shot)
      this.restoreOrbitState({ recapture: true })
      return
    }

    this.timeline = gsap.timeline({
      defaults: {
        duration: shot.duration,
        ease: 'power2.inOut',
      },
      onComplete: () => {
        this.timeline = null
        this.restoreOrbitState({ recapture: true })
      },
    })
    this.timeline
      .to(this.camera.instance.position, {
        x: shot.positionX,
        y: shot.positionY,
        z: shot.positionZ,
      }, 0)
      .to(this.camera.controls.target, {
        x: shot.targetX,
        y: shot.targetY,
        z: shot.targetZ,
      }, 0)
      .to(this.lens, {
        fov: shot.fov,
        onUpdate: () => this.updateProjection(),
      }, 0)
  }

  applyShot(shot) {
    this.camera.instance.position.set(
      shot.positionX,
      shot.positionY,
      shot.positionZ,
    )
    this.camera.controls.target.set(
      shot.targetX,
      shot.targetY,
      shot.targetZ,
    )
    this.lens.fov = shot.fov
    this.updateProjection()
    this.camera.controls.update()
  }

  captureShot(name) {
    const shot = this.shots[name]
    const position = this.camera.instance.position
    const target = this.camera.controls.target

    shot.positionX = position.x
    shot.positionY = position.y
    shot.positionZ = position.z
    shot.targetX = target.x
    shot.targetY = target.y
    shot.targetZ = target.z
    // 将窄屏补偿逆变换回镜头基准，避免 Capture / resize 多次叠加 FOV。
    const aspectScale = this.getAspectScale()
    shot.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(this.camera.instance.fov / 2)) * aspectScale))
    this.lens.fov = shot.fov
    this.shotBindings[name].forEach(binding => binding.refresh())
  }

  killTransition() {
    this.timeline?.kill()
    this.timeline = null
  }

  updateProjection() {
    // 窄屏保留 1.4:1 画幅的水平视角，让底座和斜看的 Folded 也能入画；不移动 Orbit 锚点。
    const aspectScale = this.getAspectScale()
    this.camera.instance.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(this.lens.fov / 2)) / aspectScale))
    this.camera.instance.updateProjectionMatrix()
  }

  getAspectScale() {
    return Math.max(0.1, Math.min(1, this.camera.instance.aspect / 1.4))
  }

  resize() {
    this.updateProjection()
  }

  setGestureOrbit(allowed) {
    if (this.gestureOrbit === allowed)
      return
    this.gestureOrbit = allowed
    this.restoreOrbitState()
  }

  captureOrbitAnchor() {
    const controls = this.camera.controls
    // 与 OrbitControls 一致：camera.up 为 +Y 时，球坐标不再做额外旋转。
    this.orbitOffset.copy(this.camera.instance.position).sub(controls.target)
    this.orbitSpherical.setFromVector3(this.orbitOffset)
    this.orbitAnchor = {
      azimuth: this.orbitSpherical.theta,
      polar: this.orbitSpherical.phi,
      distance: this.orbitSpherical.radius,
    }
  }

  clearOrbitSpan() {
    this.applyOrbitSpan(null)
  }

  applyOrbitSpan(anchor) {
    const controls = this.camera.controls
    if (!anchor) {
      controls.minAzimuthAngle = -Infinity
      controls.maxAzimuthAngle = Infinity
      controls.minPolarAngle = 0
      controls.maxPolarAngle = Math.PI
      controls.minDistance = 0
      controls.maxDistance = Infinity
      controls.enablePan = true
      return
    }

    const azimuth = THREE.MathUtils.degToRad(this.params.orbitAzimuth)
    const polar = THREE.MathUtils.degToRad(this.params.orbitPolar)
    controls.minAzimuthAngle = anchor.azimuth - azimuth
    controls.maxAzimuthAngle = anchor.azimuth + azimuth
    controls.minPolarAngle = Math.max(0.05, anchor.polar - polar)
    controls.maxPolarAngle = Math.min(Math.PI - 0.05, anchor.polar + polar)
    const scale = this.params.orbitDistance
    controls.minDistance = anchor.distance * (1 - scale)
    controls.maxDistance = anchor.distance * (1 + scale)
    // 只让用户绕掌机看一小圈，不把注视点拖离机身。
    controls.enablePan = false
  }

  restoreOrbitState({ recapture = false } = {}) {
    const mode = this.experience.state.productMode
    const settled = !this.timeline
    const browsing = settled && (mode === 'game-home' || mode === 'playing')
    // 调试开关是自由取景，会盖过产品的小范围限制。
    const freeOrbit = settled && this.params.orbitEnabled

    if (!settled || freeOrbit || !browsing) {
      if (freeOrbit)
        this.orbitAnchor = null
      this.clearOrbitSpan()
    }
    else {
      if (recapture || !this.orbitAnchor)
        this.captureOrbitAnchor()
      this.applyOrbitSpan(this.orbitAnchor)
    }

    // 点在上下屏上时 gestureOrbit 为 false，把这只指针留给点击和 NDS 触控。
    this.camera.controls.enabled = this.gestureOrbit && (freeOrbit || browsing)
  }

  debugInit() {
    if (!this.debug.ui)
      return
    const folder = this.debug.ui.addFolder({
      title: 'Camera Director',
      expanded: true,
    })
    this.folder = folder
    this.currentShotBinding = folder.addBinding(this.params, 'currentShot', {
      label: 'Current Shot',
      readonly: true,
    })
    folder.addBinding(this.params, 'orbitEnabled', {
      label: 'Orbit Enabled',
    }).on('change', () => this.restoreOrbitState({ recapture: true }))
    const orbitRanges = {
      orbitAzimuth: ['Orbit azimuth (°)', 0, 40, 1],
      orbitPolar: ['Orbit polar (°)', 0, 30, 1],
      orbitDistance: ['Orbit distance (±)', 0, 0.35, 0.01],
    }
    Object.entries(orbitRanges).forEach(([key, [label, min, max, step]]) => {
      folder.addBinding(this.params, key, { label, min, max, step })
        .on('change', () => {
          if (this.orbitAnchor)
            this.applyOrbitSpan(this.orbitAnchor)
        })
    })

    this.shotBindings = {}
    Object.entries(this.shots).forEach(([name, shot]) => {
      const shotFolder = folder.addFolder({
        title: name[0].toUpperCase() + name.slice(1),
        expanded: false,
      })
      const bindings = []
      const addBinding = (key, options) => {
        const binding = shotFolder.addBinding(shot, key, options)
        binding.on('change', () => {
          if (this.params.currentShot === name && !this.timeline) {
            this.applyShot(shot)
          }
        })
        bindings.push(binding)
      }

      const positionKeys = ['positionX', 'positionY', 'positionZ']
      positionKeys.forEach((key) => {
        addBinding(key, { label: key, min: -12, max: 12, step: 0.05 })
      })
      const targetKeys = ['targetX', 'targetY', 'targetZ']
      targetKeys.forEach((key) => {
        addBinding(key, { label: key, min: -6, max: 6, step: 0.05 })
      })
      addBinding('fov', { label: 'fov', min: 15, max: 70, step: 1 })
      addBinding('duration', {
        label: 'duration',
        min: 0,
        max: 4,
        step: 0.05,
      })
      this.shotBindings[name] = bindings

      shotFolder.addButton({ title: 'Preview Shot' }).on('click', () => {
        this.transitionTo(name, { force: true })
      })
      shotFolder.addButton({ title: 'Capture Current' }).on('click', () => {
        this.captureShot(name)
      })
    })
  }

  destroy() {
    this.folder?.dispose()
    this.killTransition()
    this.unsubscribeState?.()
    this.unsubscribeProductMode?.()
    this.clearOrbitSpan()
    this.camera.controls.enabled = true
  }
}
