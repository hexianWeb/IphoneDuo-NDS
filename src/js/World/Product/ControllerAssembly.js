import { gsap } from 'gsap'
import * as THREE from 'three/webgpu'
import Experience from '../../Experience.js'

const DEFAULT_RAIL_AXIS_SIGN = -1

export default class ControllerAssembly {
  constructor({ controller, bottomRig, installedMatrix, prepareAssembly }) {
    this.experience = new Experience()
    this.debug = this.experience.debug
    this.controller = controller
    this.bottomRig = bottomRig
    this.prepareAssembly = prepareAssembly
    this.installedPosition = new THREE.Vector3()
    this.installedQuaternion = new THREE.Quaternion()
    this.installedScale = new THREE.Vector3()
    installedMatrix.decompose(
      this.installedPosition,
      this.installedQuaternion,
      this.installedScale,
    )

    this.entryQuaternion = new THREE.Quaternion()
    this.alignRotationQuaternion = new THREE.Quaternion()
    this.motionState = {
      railDistance: 0,
      alignProgress: 0,
      revealProgress: 0,
    }
    this.controllerSize = this.getControllerSize()
    this.setAssemblyAxes()
    this.setParams()
    this.debugInit()
    this.applyInstalledPose()
  }

  getControllerSize() {
    this.bottomRig.updateMatrixWorld(true)
    this.controller.updateWorldMatrix(true, true)
    const inverseBottomMatrix = this.bottomRig.matrixWorld.clone().invert()
    const bounds = new THREE.Box3().makeEmpty()

    this.controller.traverse((child) => {
      if (!child.isMesh || !child.geometry)
        return

      child.geometry.computeBoundingBox()
      if (!child.geometry.boundingBox)
        return

      // 所有距离都在 BottomRig 局部空间计算，避免 PresentationRoot 缩放污染装配参数。
      const childToBottomMatrix = inverseBottomMatrix.clone().multiply(child.matrixWorld)
      const childBounds = child.geometry.boundingBox.clone().applyMatrix4(childToBottomMatrix)
      bounds.union(childBounds)
    })

    if (bounds.isEmpty()) {
      throw new Error('无法从 Controller 计算装配包围盒。')
    }

    return bounds.getSize(new THREE.Vector3())
  }

  setAssemblyAxes() {
    const axisNames = ['x', 'y', 'z']
      .sort((axisA, axisB) => this.controllerSize[axisB] - this.controllerSize[axisA])

    // Controller 最大尺寸是横向宽度、最小尺寸是厚度，中间尺寸即纵向滑轨方向。
    this.widthAxisName = axisNames[0]
    this.railAxisName = axisNames[1]
    this.alignAxisName = axisNames[2]
    this.railAxis = this.getNamedAxis(this.railAxisName)
    this.alignAxis = this.getNamedAxis(this.alignAxisName)
    this.railLength = this.controllerSize[this.railAxisName]
  }

  getNamedAxis(axisName) {
    return new THREE.Vector3(
      axisName === 'x' ? 1 : 0,
      axisName === 'y' ? 1 : 0,
      axisName === 'z' ? 1 : 0,
    )
  }

  getRailAxis() {
    const axis = new THREE.Vector3(
      this.params.slideDirectionX,
      this.params.slideDirectionY,
      this.params.slideDirectionZ,
    )
    return axis.lengthSq() > Number.EPSILON ? axis.normalize() : this.railAxis.clone()
  }

  setParams() {
    const alignOffsets = { x: 0, y: 0, z: 0 }
    alignOffsets[this.alignAxisName] = this.controllerSize[this.alignAxisName] * 0.45
    alignOffsets[this.widthAxisName] = this.controllerSize[this.widthAxisName] * 0.04

    this.params = {
      state: 'installed',
      railAxis: this.railAxisName.toUpperCase(),
      alignAxis: this.alignAxisName.toUpperCase(),
      slideDirectionX: this.railAxis.x * DEFAULT_RAIL_AXIS_SIGN,
      slideDirectionY: this.railAxis.y * DEFAULT_RAIL_AXIS_SIGN,
      slideDirectionZ: this.railAxis.z * DEFAULT_RAIL_AXIS_SIGN,
      entryDistance: this.railLength * 1.15,
      revealDistance: this.railLength * 0.35,
      alignOffsetX: alignOffsets.x,
      alignOffsetY: alignOffsets.y,
      alignOffsetZ: alignOffsets.z,
      arcHeight: this.controllerSize[this.alignAxisName] * 0.35,
      alignRotation: 3,
      revealDuration: 0.65,
      alignDuration: 0.5,
      alignOverlap: 0.25,
      slideDuration: 0.65,
      slideOverlap: 0.05,
      // 0.3%–0.5% 过冲会被 Slide 收尾吃掉；约 5% 才能看清压过卡槽再弹回。
      lockOvershoot: this.railLength * 0.05,
      lockDuration: 0.35,
      holdDuration: 0.4,
    }
  }

  getEntryQuaternion() {
    this.alignRotationQuaternion.setFromAxisAngle(
      this.alignAxis,
      THREE.MathUtils.degToRad(this.params.alignRotation),
    )
    return this.entryQuaternion
      .copy(this.installedQuaternion)
      .multiply(this.alignRotationQuaternion)
  }

  play({ prepare = true, onComplete } = {}) {
    this.killTimeline()
    if (prepare)
      this.prepareAssembly?.()
    this.setVisible(true)
    this.applyEntryPose()

    const alignStart = Math.max(0, this.params.revealDuration - this.params.alignOverlap)
    const slideStart = Math.max(
      alignStart,
      alignStart + this.params.alignDuration - this.params.slideOverlap,
    )
    const lockStart = slideStart + this.params.slideDuration
    const holdStart = lockStart + this.params.lockDuration

    this.timeline = gsap.timeline({
      onComplete: () => {
        this.applyInstalledPose()
        this.timeline = null
        onComplete?.()
      },
    })
    this.timeline
      .call(() => this.setState('reveal'), null, 0)
      .to(this.motionState, {
        railDistance: this.params.entryDistance,
        revealProgress: 1,
        duration: this.params.revealDuration,
        ease: 'power2.out',
        onUpdate: () => this.applyMotionPose(),
      }, 0)
      .call(() => this.setState('align'), null, alignStart)
      .to(this.motionState, {
        alignProgress: 1,
        duration: this.params.alignDuration,
        ease: 'power2.inOut',
        onUpdate: () => this.applyMotionPose(),
      }, alignStart)
      .call(() => this.setState('slide'), null, slideStart)
      .to(this.motionState, {
        railDistance: -this.params.lockOvershoot,
        duration: this.params.slideDuration,
        ease: 'power3.in',
        onUpdate: () => this.applyMotionPose(),
      }, slideStart)
      .call(() => this.setState('lock'), null, lockStart)
      .to(this.motionState, {
        railDistance: 0,
        duration: this.params.lockDuration,
        ease: 'back.out(1.8)',
        onUpdate: () => this.applyMotionPose(),
      }, lockStart)
      .call(() => this.setState('hold'), null, holdStart)
      .to({}, { duration: this.params.holdDuration }, holdStart)
  }

  setEntryPose({ prepare = true } = {}) {
    this.killTimeline()
    if (prepare)
      this.prepareAssembly?.()
    this.setVisible(true)
    this.applyEntryPose()
  }

  applyEntryPose() {
    this.motionState.railDistance = this.params.entryDistance + this.params.revealDistance
    this.motionState.alignProgress = 0
    this.motionState.revealProgress = 0
    this.getEntryQuaternion()
    this.applyMotionPose()
    this.setState('entry')
  }

  applyMotionPose() {
    const alignProgress = THREE.MathUtils.clamp(this.motionState.alignProgress, 0, 1)
    const revealProgress = THREE.MathUtils.clamp(this.motionState.revealProgress, 0, 1)
    const offsetScale = 1 - alignProgress
    const arcOffset = Math.sin(revealProgress * Math.PI) * this.params.arcHeight
    const position = this.installedPosition.clone()
      .addScaledVector(this.getRailAxis(), -this.motionState.railDistance)
      .add(new THREE.Vector3(
        this.params.alignOffsetX * offsetScale,
        this.params.alignOffsetY * offsetScale,
        this.params.alignOffsetZ * offsetScale,
      ))
      .addScaledVector(this.alignAxis, arcOffset)

    this.controller.position.copy(position)
    this.controller.quaternion.slerpQuaternions(
      this.entryQuaternion,
      this.installedQuaternion,
      alignProgress,
    )
    this.controller.scale.copy(this.installedScale)
    this.controller.updateMatrix()
  }

  setInstalledPose() {
    this.killTimeline()
    this.setVisible(true)
    this.applyInstalledPose()
  }

  setVisible(visible) {
    this.controller.visible = visible
  }

  applyInstalledPose() {
    this.controller.position.copy(this.installedPosition)
    this.controller.quaternion.copy(this.installedQuaternion)
    this.controller.scale.copy(this.installedScale)
    this.controller.updateMatrix()
    this.setState('installed')
  }

  setState(state) {
    this.params.state = state
    this.stateBinding?.refresh()
  }

  killTimeline() {
    this.timeline?.kill()
    this.timeline = null
  }

  debugInit() {
    if (!this.debug.ui)
      return
    const folder = this.debug.ui.addFolder({ title: 'Controller Assembly', expanded: false })
    this.stateBinding = folder.addBinding(this.params, 'state', {
      label: 'State',
      readonly: true,
      expanded: false,
    })

    folder.addBinding(this.params, 'railAxis', {
      label: 'Derived rail axis',
      readonly: true,
    })
    folder.addBinding(this.params, 'alignAxis', {
      label: 'Derived align axis',
      readonly: true,
    })
    const directionKeys = ['slideDirectionX', 'slideDirectionY', 'slideDirectionZ']
    directionKeys.forEach((key) => {
      folder.addBinding(this.params, key, {
        label: key,
        min: -1,
        max: 1,
        step: 0.05,
      })
    })
    folder.addBinding(this.params, 'entryDistance', {
      label: 'Entry distance',
      min: this.railLength * 0.25,
      max: this.railLength * 3,
      step: this.railLength * 0.01,
    })
    folder.addBinding(this.params, 'revealDistance', {
      label: 'Reveal distance',
      min: 0,
      max: this.railLength * 2,
      step: this.railLength * 0.01,
    })
    const offsetAxisNames = ['x', 'y', 'z']
    offsetAxisNames.forEach((axisName) => {
      const key = `alignOffset${axisName.toUpperCase()}`
      folder.addBinding(this.params, key, {
        label: key,
        min: -this.controllerSize[axisName] * 2,
        max: this.controllerSize[axisName] * 2,
        step: this.controllerSize[axisName] * 0.01,
      })
    })
    folder.addBinding(this.params, 'arcHeight', {
      label: 'Arc height',
      min: 0,
      max: this.controllerSize[this.alignAxisName] * 2,
      step: this.controllerSize[this.alignAxisName] * 0.01,
    })
    folder.addBinding(this.params, 'alignRotation', {
      label: 'Align rotation',
      min: -15,
      max: 15,
      step: 0.5,
    })

    const timingFolder = folder.addFolder({ title: 'Timing', expanded: false })
    const timingKeys = [
      'revealDuration',
      'alignDuration',
      'slideDuration',
      'lockDuration',
      'holdDuration',
    ]
    timingKeys.forEach((key) => {
      timingFolder.addBinding(this.params, key, {
        label: key,
        min: 0.1,
        max: 2,
        step: 0.05,
      })
    })
    timingFolder.addBinding(this.params, 'alignOverlap', {
      label: 'Align overlap',
      min: 0,
      max: 0.6,
      step: 0.05,
    })
    timingFolder.addBinding(this.params, 'slideOverlap', {
      label: 'Slide overlap',
      min: 0,
      max: 0.3,
      step: 0.05,
    })
    timingFolder.addBinding(this.params, 'lockOvershoot', {
      label: 'Lock overshoot',
      min: 0,
      max: this.railLength * 0.12,
      step: this.railLength * 0.001,
    })

    const actions = folder.addFolder({ title: 'Actions' })
    actions.addButton({ title: 'Replay Assembly' }).on('click', () => this.play())
    actions.addButton({ title: 'Entry Pose' }).on('click', () => this.setEntryPose())
    actions.addButton({ title: 'Skip / Installed' }).on('click', () => this.setInstalledPose())
  }

  destroy() {
    this.killTimeline()
    this.applyInstalledPose()
  }
}
