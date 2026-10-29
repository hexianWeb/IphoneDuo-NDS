import * as THREE from 'three/webgpu'
import ButtonClickSound from './ButtonClickSound.js'

const FACE_BUTTONS = ['a', 'b', 'x', 'y']
const DPAD_ACTIONS = ['up', 'down', 'left', 'right']
// 高刚度弹簧在 60 Hz 单步显式积分下会抖动甚至发散；固定子步长也让手感不随帧率变化。
const SPRING_STEP = 1 / 240
// 切回标签页时 delta 可能长达数秒，限幅后按键直接收敛，不会一帧内飞出。
const MAX_DELTA = 0.05
// 松开回弹允许越过静止位的上限（行程比例），防止极端参数把键帽弹出外壳。
const FACE_OVERSHOOT_LIMIT = -0.35
// 震动相对强度随按键类型递减：面键最实，D-Pad 与小按键更轻，避免方向键连按时手柄持续嗡鸣。
const HAPTIC_SCALE = { face: 1, dpad: 0.7, small: 0.6 }

export default class ControllerFeedback {
  constructor({ buttons, shell, debug, onHaptic }) {
    this.onHaptic = onHaptic
    this.params = {
      pressDepth: 0.22,
      dpadTilt: 6,
      pressStiffness: 3200,
      releaseStiffness: 900,
      dampingRatio: 0.45,
      soundEnabled: true,
      soundVolume: 0.20,
      hapticEnabled: true,
      hapticStrength: 0.35,
      hapticDuration: 24,
      testAction: 'a',
    }
    this.inputActions = new Set()
    this.testActions = new Set()
    this.activeActions = new Set()
    this.testTimer = 0
    this.tiltAxis = new THREE.Vector3()
    this.tiltQuaternion = new THREE.Quaternion()
    this.sound = new ButtonClickSound({
      enabled: this.params.soundEnabled,
      volume: this.params.soundVolume,
    })
    this.setPressables(buttons, shell)
    this.debugInit(debug)
  }

  setPressables(buttons, shell) {
    shell.updateWorldMatrix(true, false)
    shell.geometry.computeBoundingBox()
    const shellCenter = shell.geometry.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(shell.matrixWorld)

    this.faceButtons = FACE_BUTTONS.map(action => ({
      action,
      ...this.createPressable(buttons[action], shellCenter),
      spring: { value: 0, velocity: 0 },
    }))
    this.dpad = {
      ...this.createPressable(buttons.dpad, shellCenter),
      springX: { value: 0, velocity: 0 },
      springY: { value: 0, velocity: 0 },
    }

    // D-Pad 的“上 / 右”取自 ABXY 菱形布局（X 在上、A 在右），与 NDS 语义一致，不依赖 GLB 世界轴。
    const parent = this.dpad.mesh.parent
    const toDpadSpace = mesh => parent.worldToLocal(mesh.getWorldPosition(new THREE.Vector3()))
    const outward = this.dpad.pressAxis.clone().negate()
    // 投影到 D-Pad 面内，避免 ABXY 与 D-Pad 的高度差把倾斜轴带歪。
    const up = toDpadSpace(buttons.x).sub(toDpadSpace(buttons.b)).projectOnPlane(outward).normalize()
    const right = toDpadSpace(buttons.a).sub(toDpadSpace(buttons.y)).projectOnPlane(outward).normalize()
    // 绕 outward × d 正向旋转时，(outward × d) × d = -outward，即方向 d 的一臂压向机身。
    this.dpad.upTiltAxis = new THREE.Vector3().crossVectors(outward, up)
    this.dpad.rightTiltAxis = new THREE.Vector3().crossVectors(outward, right)
  }

  createPressable(mesh, shellCenterWorld) {
    mesh.updateWorldMatrix(true, false)
    mesh.geometry.computeBoundingBox()
    const size = mesh.geometry.boundingBox.getSize(new THREE.Vector3())
    const extents = size.toArray().map((value, index) => Math.abs(value * mesh.scale.getComponent(index)))
    const thinIndex = extents.indexOf(Math.min(...extents))
    // 位移写在 position 上，所以按压轴必须在父节点空间：取最薄局部轴经静止姿态旋转，
    // 再令其指向外壳中心，保证“按下”是压进机身而不是弹出。
    const pressAxis = new THREE.Vector3().setComponent(thinIndex, 1).applyQuaternion(mesh.quaternion)
    const shellCenter = mesh.parent.worldToLocal(shellCenterWorld.clone())
    if (pressAxis.dot(shellCenter.sub(mesh.position)) < 0)
      pressAxis.negate()
    if (!Number.isFinite(extents[thinIndex]) || extents[thinIndex] <= 0) {
      throw new Error(`${mesh.name} 无有效厚度，无法建立按键行程。`)
    }
    return {
      mesh,
      pressAxis,
      thickness: extents[thinIndex],
      restPosition: mesh.position.clone(),
      restQuaternion: mesh.quaternion.clone(),
    }
  }

  setActions(actions) {
    this.inputActions = new Set(actions)
    this.refreshActions()
  }

  refreshActions() {
    const next = new Set([...this.inputActions, ...this.testActions])
    // 声音跟随输入边沿而非弹簧触底：触底约晚 40 ms，仍在视听同步容差内，且快速轻点也不会漏声。
    next.forEach((action) => {
      if (this.activeActions.has(action))
        return
      const voice = this.getVoice(action)
      this.sound.play(voice, true)
      this.pulse(voice)
    })
    this.activeActions.forEach((action) => {
      if (!next.has(action))
        this.sound.play(this.getVoice(action), false)
    })
    this.activeActions = next
  }

  // 只在按下时短促一震：松开也震会让快速连按变成连续嗡鸣。
  pulse(voice) {
    if (!this.params.hapticEnabled || this.params.hapticStrength <= 0)
      return
    const magnitude = this.params.hapticStrength * HAPTIC_SCALE[voice]
    // weak 为高频小马达，提供“咔”的清脆感；strong 低频大马达只给一点重量，保持轻微。
    this.onHaptic?.({
      startDelay: 0,
      duration: this.params.hapticDuration,
      weakMagnitude: magnitude,
      strongMagnitude: magnitude * 0.25,
    })
  }

  getVoice(action) {
    if (DPAD_ACTIONS.includes(action))
      return 'dpad'
    return FACE_BUTTONS.includes(action) ? 'face' : 'small'
  }

  tapTest() {
    this.testActions = new Set([this.params.testAction])
    this.testTimer = 0.12
    this.refreshActions()
  }

  stepSpring(spring, target, dt, min, max) {
    const stiffness = target === 0 ? this.params.releaseStiffness : this.params.pressStiffness
    // PRD 28.5 的指数阻尼形式；阻尼率由阻尼比换算，使刚度调节时回弹次数保持一致。
    const damping = 2 * this.params.dampingRatio * Math.sqrt(stiffness)
    spring.velocity += (target - spring.value) * stiffness * dt
    spring.velocity *= Math.exp(-damping * dt)
    spring.value += spring.velocity * dt
    // 行程两端是硬限位：按到底立即停住形成“触底”手感，回弹只发生在松开方向。
    if (spring.value > max) {
      spring.value = max
      spring.velocity = Math.min(spring.velocity, 0)
    }
    else if (spring.value < min) {
      spring.value = min
      spring.velocity = Math.max(spring.velocity, 0)
    }
  }

  update(delta) {
    const dt = Math.min(delta, MAX_DELTA)
    if (this.testTimer > 0) {
      this.testTimer -= dt
      if (this.testTimer <= 0) {
        this.testActions.clear()
        this.refreshActions()
      }
    }

    const has = action => (this.activeActions.has(action) ? 1 : 0)
    let targetX = has('right') - has('left')
    let targetY = has('up') - has('down')
    // 斜向按住时总倾角保持为单方向的最大值，不因两轴叠加而倾得更深。
    if (targetX !== 0 && targetY !== 0) {
      targetX *= Math.SQRT1_2
      targetY *= Math.SQRT1_2
    }

    const steps = Math.ceil(dt / SPRING_STEP)
    const step = steps > 0 ? dt / steps : 0
    for (let index = 0; index < steps; index++) {
      this.faceButtons.forEach(button => this.stepSpring(button.spring, has(button.action), step, FACE_OVERSHOOT_LIMIT, 1))
      this.stepSpring(this.dpad.springX, targetX, step, -1, 1)
      this.stepSpring(this.dpad.springY, targetY, step, -1, 1)
    }
    this.applyPose()
  }

  applyPose() {
    this.faceButtons.forEach(({ mesh, restPosition, pressAxis, thickness, spring }) => {
      mesh.position.copy(restPosition).addScaledVector(pressAxis, thickness * this.params.pressDepth * spring.value)
    })

    const { mesh, restQuaternion, upTiltAxis, rightTiltAxis, springX, springY } = this.dpad
    // 两个方向的倾斜轴在父空间线性叠加；倾斜四元数左乘静止姿态，即在父空间绕 D-Pad 原点旋转。
    this.tiltAxis.copy(upTiltAxis).multiplyScalar(springY.value).addScaledVector(rightTiltAxis, springX.value)
    const amount = this.tiltAxis.length()
    if (amount < 1e-6) {
      mesh.quaternion.copy(restQuaternion)
      return
    }
    this.tiltQuaternion.setFromAxisAngle(this.tiltAxis.divideScalar(amount), amount * THREE.MathUtils.degToRad(this.params.dpadTilt))
    mesh.quaternion.multiplyQuaternions(this.tiltQuaternion, restQuaternion)
  }

  debugInit(debug) {
    if (!debug?.ui)
      return
    this.folder = debug.ui.addFolder({ title: 'Controller Feedback', expanded: false })
    const ranges = {
      pressDepth: ['Press depth (× thickness)', 0, 0.6, 0.01],
      dpadTilt: ['D-Pad tilt (°)', 0, 15, 0.1],
      pressStiffness: ['Press stiffness', 200, 8000, 10],
      releaseStiffness: ['Release stiffness', 100, 4000, 10],
      dampingRatio: ['Damping ratio', 0.1, 1.5, 0.01],
    }
    Object.entries(ranges).forEach(([key, [label, min, max, step]]) => {
      this.folder.addBinding(this.params, key, { label, min, max, step })
    })
    this.folder.addBinding(this.params, 'soundEnabled', { label: 'Click sound' })
      .on('change', ({ value }) => { this.sound.enabled = value })
    this.folder.addBinding(this.params, 'soundVolume', { label: 'Click volume', min: 0, max: 1, step: 0.01 })
      .on('change', ({ value }) => this.sound.setVolume(value))
    this.folder.addBinding(this.params, 'hapticEnabled', { label: 'Gamepad rumble' })
    this.folder.addBinding(this.params, 'hapticStrength', { label: 'Rumble strength', min: 0, max: 1, step: 0.01 })
    // 多数手柄马达需要约 20 ms 才能起转，过短的脉冲会完全感觉不到。
    this.folder.addBinding(this.params, 'hapticDuration', { label: 'Rumble (ms)', min: 10, max: 80, step: 1 })
    this.folder.addBinding(this.params, 'testAction', {
      label: 'Test button',
      options: { A: 'a', B: 'b', X: 'x', Y: 'y', Up: 'up', Down: 'down', Left: 'left', Right: 'right', Start: 'start' },
    })
    this.folder.addButton({ title: 'Tap test button' }).on('click', () => this.tapTest())
  }

  destroy() {
    this.folder?.dispose()
    this.sound.destroy()
    this.faceButtons.forEach(({ mesh, restPosition }) => mesh.position.copy(restPosition))
    this.dpad.mesh.quaternion.copy(this.dpad.restQuaternion)
  }
}
