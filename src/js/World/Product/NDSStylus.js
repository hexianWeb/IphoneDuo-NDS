import * as THREE from 'three/webgpu'
import '../../../nds-stylus.css'

const SURFACE_WIDTH = 320
const SURFACE_HEIGHT = 480
const TIP_X = 56
const TIP_Y = 448
const SPRING_STEP = 1 / 240

export default class NDSStylus {
  constructor({ debug }) {
    this.params = { enabled: true, length: 324, thickness: 17.4, lean: 12, sway: 1, damping: 0.36 }
    this.pointer = new THREE.Vector2(window.innerWidth * 0.72, window.innerHeight * 0.62)
    this.previousPointer = this.pointer.clone()
    this.velocity = new THREE.Vector2()
    this.movement = new THREE.Vector2()
    this.renderedPose = new Float64Array(8).fill(NaN)
    this.renderRequested = true
    this.swing = { value: 0, velocity: 0 }
    this.tilt = { value: 0, velocity: 0 }
    this.press = 0
    this.tapTime = 0
    this.pulseAge = 1
    this.surfaceWidth = SURFACE_WIDTH
    this.surfaceHeight = SURFACE_HEIGHT
    this.geometries = new Set()
    this.materials = new Set()
    this.listeners = new AbortController()
    this.scene = new THREE.Scene()
    // 正交镜头以 CSS 像素为单位，笔尖投影固定在 (TIP_X, TIP_Y)，不依赖产品镜头或屏幕 UV。
    this.camera = new THREE.OrthographicCamera(-TIP_X, SURFACE_WIDTH - TIP_X, TIP_Y, TIP_Y - SURFACE_HEIGHT, 1, 1000)
    this.camera.position.z = 200
    this.pen = new THREE.Group()
    this.pen.name = 'NDS_Mini_Pencil'
    this.scene.add(this.pen)
    this.createPen()
    this.createFeedback()
    this.createLights()
    this.createCanvas()
    this.bindPointer()
    this.debugInit(debug)
    this.update(0)
  }

  material(options) {
    const material = new THREE.MeshPhysicalNodeMaterial(options)
    this.materials.add(material)
    return material
  }

  profile(points, material) {
    const geometry = new THREE.LatheGeometry(points.map(([radius, height]) => new THREE.Vector2(radius, height)), 48)
    this.geometries.add(geometry)
    const mesh = new THREE.Mesh(geometry, material)
    this.pen.add(mesh)
    return mesh
  }

  createPen() {
    const shell = this.material({ color: '#f5f5f4', roughness: 0.32, clearcoat: 0.22, clearcoatRoughness: 0.35 })
    const nib = this.material({ color: '#e3e3df', roughness: 0.58 })
    const seam = this.material({ color: '#c7c9cc', roughness: 0.5 })
    // 连续白色笔身、细锥形笔尖和圆润尾盖；轮廓由旋转剖面生成，不加载外部模型。
    this.profile([[0, 0], [0.10, 0.003], [0.18, 0.012], [0.28, 0.032], [0.39, 0.065], [0.48, 0.105], [0.49, 0.12]], nib)
    this.profile([[0.49, 0.12], [0.5, 0.14], [0.5, 0.95], [0.496, 0.962]], shell)
    this.profile([[0.496, 0.962], [0.496, 0.966]], seam)
    this.profile([[0.496, 0.966], [0.49, 0.986], [0.42, 0.996], [0.26, 1.002], [0, 1.005]], shell)
  }

  createFeedback() {
    const geometry = new THREE.RingGeometry(0.82, 1, 48)
    const material = new THREE.MeshBasicNodeMaterial({ color: '#6cbcff', transparent: true, opacity: 0, depthWrite: false, toneMapped: false })
    this.geometries.add(geometry)
    this.materials.add(material)
    this.pulse = new THREE.Mesh(geometry, material)
    this.pulse.position.z = -1
    this.scene.add(this.pulse)
  }

  createLights() {
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#a5abb5', 2))
    const key = new THREE.DirectionalLight('#ffffff', 3)
    key.position.set(-45, 70, 100)
    const fill = new THREE.DirectionalLight('#cad8ea', 0.8)
    fill.position.set(80, -20, 60)
    this.scene.add(key, fill)
  }

  createCanvas() {
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'nds-stylus'
    this.canvas.setAttribute('aria-hidden', 'true')
    this.canvas.style.width = `${SURFACE_WIDTH}px`
    this.canvas.style.height = `${SURFACE_HEIGHT}px`
    document.body.append(this.canvas)
    // 原生 dialog 位于 top layer；非交互 popover 让鼠标伴随模型也能显示在操作说明上方。
    this.popover = typeof this.canvas.showPopover === 'function'
    if (this.popover)
      this.canvas.setAttribute('popover', 'manual')
  }

  bindPointer() {
    const options = { capture: true, signal: this.listeners.signal }
    window.addEventListener('pointermove', event => this.movePointer(event), options)
    window.addEventListener('pointerdown', (event) => {
      if (event.pointerType !== 'mouse' || event.button !== 0)
        return
      this.movePointer(event)
      this.pressed = true
      this.tapTime = 0.07
      this.pulseAge = 0
    }, options)
    window.addEventListener('pointerup', (event) => {
      if (event.pointerType === 'mouse' && event.button === 0)
        this.pressed = false
    }, options)
    window.addEventListener('pointercancel', () => this.release(), options)
    window.addEventListener('blur', () => this.release(), options)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden)
        this.release()
    }, options)
    document.documentElement.addEventListener('pointerleave', () => this.release(), options)
  }

  movePointer(event) {
    if (event.pointerType !== 'mouse')
      return
    this.pointer.set(event.clientX, event.clientY)
    // 移出窗口后再次进入不沿历史距离计算速度，避免重新聚焦时猛烈摆动。
    if (!this.mouseInside)
      this.previousPointer.copy(this.pointer)
    this.mouseInside = true
    this.syncVisibility()
    const dialog = document.querySelector('dialog[open]')
    if (this.popover && dialog !== this.overlayDialog) {
      this.overlayDialog = dialog
      this.canvas.hidePopover()
      this.canvas.showPopover()
    }
  }

  release() {
    this.pressed = false
    this.tapTime = 0
    this.mouseInside = false
    this.velocity.set(0, 0)
    this.previousPointer.copy(this.pointer)
    this.syncVisibility()
  }

  syncVisibility() {
    if (this.visibilityEnabled === this.params.enabled && this.visibilityInside === Boolean(this.mouseInside))
      return
    if (this.visibilityEnabled !== this.params.enabled)
      this.renderRequested = true
    this.visibilityEnabled = this.params.enabled
    this.visibilityInside = Boolean(this.mouseInside)
    this.canvas.hidden = !this.params.enabled
    if (this.popover) {
      const open = this.canvas.matches(':popover-open')
      if (this.params.enabled && !open)
        this.canvas.showPopover()
      else if (!this.params.enabled && open)
        this.canvas.hidePopover()
    }
    document.documentElement.classList.toggle('nds-stylus-active', this.params.enabled && Boolean(this.mouseInside))
  }

  stepSpring(spring, target, dt) {
    const stiffness = 180
    const damping = 2 * this.params.damping * Math.sqrt(stiffness)
    spring.velocity += ((target - spring.value) * stiffness - damping * spring.velocity) * dt
    spring.value += spring.velocity * dt
    // 给尾部晃动硬限位，极端鼠标速度与调试参数都不会让整支笔翻转。
    if (Math.abs(spring.value) > 0.15) {
      spring.value = Math.sign(spring.value) * 0.15
      spring.velocity = 0
    }
  }

  update(delta) {
    const dt = Math.min(Math.max(delta, 0), 0.05)
    this.syncVisibility()
    if (!this.params.enabled) {
      this.previousPointer.copy(this.pointer)
      this.velocity.set(0, 0)
      return
    }
    const reducedMotion = this.reducedMotion ??= window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const movement = this.movement.subVectors(this.pointer, this.previousPointer)
    this.previousPointer.copy(this.pointer)
    const blend = 1 - Math.exp(-24 * dt)
    const speed = dt > 0 ? movement.divideScalar(dt).clampLength(0, 2400) : movement.set(0, 0)
    this.velocity.lerp(speed, blend)
    const sway = reducedMotion ? 0 : this.params.sway
    // +Z 旋转会让沿 +Y 的笔杆向左偏：移动时笔杆略滞后，急停归零时先沿鼠标移动方向摆回。
    // 水平速度同号驱动角度，避免向左移动后首次回摆反而向右；笔尖仍严格对准鼠标。
    const swingTarget = THREE.MathUtils.clamp((this.velocity.x + this.velocity.y * 0.7) * 0.00005 * sway, -0.075, 0.075)
    const tiltTarget = THREE.MathUtils.clamp(this.velocity.y * 0.000045 * sway, -0.075, 0.075)
    let remaining = dt
    while (remaining > 0) {
      const step = Math.min(remaining, SPRING_STEP)
      this.stepSpring(this.swing, swingTarget, step)
      this.stepSpring(this.tilt, tiltTarget, step)
      remaining -= step
    }
    this.tapTime = Math.max(0, this.tapTime - dt)
    const touching = this.pressed || this.tapTime > 0
    this.press = THREE.MathUtils.damp(this.press, touching ? 1 : 0, 32, dt)
    this.pen.rotation.set(0.08 + this.tilt.value, 0.04, THREE.MathUtils.degToRad(-this.params.lean) + this.swing.value + this.press * 0.012)
    this.pen.scale.set(this.params.thickness, this.params.length * (1 - this.press * 0.012), this.params.thickness)
    this.pulseAge = Math.min(1, this.pulseAge + dt / 0.32)
    this.pulse.scale.setScalar(3 + this.pulseAge * 14)
    this.pulse.material.opacity = 0.55 * (1 - this.pulseAge) ** 2
    this.canvas.style.transform = `translate3d(${this.pointer.x - TIP_X}px, ${this.pointer.y - TIP_Y}px, 0)`
  }

  resize() {
    this.renderRequested = true
    this.pointer.x = THREE.MathUtils.clamp(this.pointer.x, 0, window.innerWidth)
    this.pointer.y = THREE.MathUtils.clamp(this.pointer.y, 0, window.innerHeight)
    this.previousPointer.copy(this.pointer)
  }

  consumeRenderRequest() {
    if (!this.params.enabled)
      return false
    const pose = [this.pen.rotation.x, this.pen.rotation.y, this.pen.rotation.z, this.pen.scale.x, this.pen.scale.y, this.pen.scale.z, this.pulse.scale.x, this.pulse.material.opacity]
    // CSS 平移无需重绘 GPU 画布；弹簧、落笔和波纹停稳后复用最后一帧，微小误差低于可见像素。
    const changed = this.renderRequested || pose.some((value, index) => !Number.isFinite(this.renderedPose[index])
      || Math.abs(value - this.renderedPose[index]) > 0.000001)
    if (!changed)
      return false
    this.renderedPose.set(pose)
    this.renderRequested = false
    return true
  }

  debugInit(debug) {
    if (!debug?.ui)
      return
    this.folder = debug.ui.addFolder({ title: 'NDS Stylus', expanded: false })
    this.folder.addBinding(this.params, 'enabled', { label: 'Enabled' }).on('change', () => this.syncVisibility())
    this.folder.addBinding(this.params, 'length', { label: 'Length (px)', min: 195, max: 420, step: 1 })
    this.folder.addBinding(this.params, 'thickness', { label: 'Thickness (px)', min: 9, max: 27, step: 0.1 })
    this.folder.addBinding(this.params, 'lean', { label: 'Lean °', min: 0, max: 25, step: 1 })
    this.folder.addBinding(this.params, 'sway', { label: 'Sway', min: 0, max: 2, step: 0.05 })
    this.folder.addBinding(this.params, 'damping', { label: 'Damping', min: 0.2, max: 0.9, step: 0.01 })
  }

  destroy() {
    this.listeners.abort()
    document.documentElement.classList.remove('nds-stylus-active')
    this.folder?.dispose()
    if (this.popover && this.canvas.matches(':popover-open'))
      this.canvas.hidePopover()
    this.canvas.remove()
    this.scene.clear()
    this.geometries.forEach(geometry => geometry.dispose())
    this.materials.forEach(material => material.dispose())
    this.geometries.clear()
    this.materials.clear()
  }
}
