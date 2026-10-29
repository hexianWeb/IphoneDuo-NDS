import * as THREE from 'three/webgpu'
import Experience from '../../Experience.js'
import ControllerAssembly from './ControllerAssembly.js'

const BIND_ANGLE = 180
const DEFAULT_FOLDED_ANGLE = 8
const DEFAULT_ASSEMBLY_ANGLE = 110
// Hero：下半屏相对展台抬起 30°，夹角 120°，上半屏因此恰好竖直（30 + 90 = 120）。
const DEFAULT_HERO_ANGLE = 120
const DEFAULT_HERO_TILT = 30
const MAX_DISPLAY_TILT = 60
const DEFAULT_HINGE_AXIS_SIGN = 1

export default class ProductRig {
  constructor({ model, nodes }) {
    this.experience = new Experience()
    this.debug = this.experience.debug
    this.model = model
    this.nodes = nodes
    this.rotationQuaternion = new THREE.Quaternion()

    this.setHierarchy()
    this.setHingeFrame()
    this.attachProductParts()
    this.setParams()
    this.debugInit()
    this.setControllerAssembly()
    this.setStandFrame()
  }

  setHierarchy() {
    // StandRoot 只承担整机立起的展示倾角，位于 PresentationRoot 与 ProductRoot 之间，不参与折叠计算。
    this.standRoot = new THREE.Group()
    this.standRoot.name = 'StandRoot'
    this.productRoot = new THREE.Group()
    this.productRoot.name = 'ProductRoot'
    this.productRoot.add(this.model)
    this.standRoot.add(this.productRoot)

    this.bottomRig = new THREE.Group()
    this.bottomRig.name = 'BottomRig'
    this.hingePivot = new THREE.Group()
    this.hingePivot.name = 'HingePivot'
    this.hingeVisualRig = new THREE.Group()
    this.hingeVisualRig.name = 'HingeVisualRig'
    this.runtimeAnchors = new THREE.Group()
    this.runtimeAnchors.name = 'RuntimeAnchors'

    this.productRoot.add(
      this.bottomRig,
      this.hingePivot,
      this.hingeVisualRig,
      this.runtimeAnchors,
    )
  }

  setHingeFrame() {
    const hingeBounds = this.getLocalBounds(this.nodes.hinge)
    const hingeCenter = hingeBounds.getCenter(new THREE.Vector3())
    const hingeSize = hingeBounds.getSize(new THREE.Vector3())
    const axisName = ['x', 'y', 'z'].reduce(
      (longest, axis) => hingeSize[axis] > hingeSize[longest] ? axis : longest,
      'x',
    )

    this.hingeAxis = new THREE.Vector3(
      axisName === 'x' ? 1 : 0,
      axisName === 'y' ? 1 : 0,
      axisName === 'z' ? 1 : 0,
    )
    this.hingeAxisName = axisName.toUpperCase()

    this.productRoot.updateMatrixWorld(true)
    const hingeCenterWorld = this.nodes.hinge.localToWorld(hingeCenter.clone())
    const productWorldQuaternion = this.productRoot.getWorldQuaternion(new THREE.Quaternion())
    const hingeWorldQuaternion = this.nodes.hinge.getWorldQuaternion(new THREE.Quaternion())

    // Pivot 使用 Hinge 的局部坐标系，使包围盒推导出的长轴可直接作为旋转轴。
    const hingeLocalQuaternion = productWorldQuaternion.invert().multiply(hingeWorldQuaternion)
    const hingeCenterInProduct = this.productRoot.worldToLocal(hingeCenterWorld)
    const hingeRigs = [this.hingePivot, this.hingeVisualRig]
    hingeRigs.forEach((rig) => {
      rig.position.copy(hingeCenterInProduct)
      rig.quaternion.copy(hingeLocalQuaternion)
    })
  }

  getLocalBounds(object, space = object) {
    object.updateWorldMatrix(true, true)
    const inverseObjectMatrix = space.matrixWorld.clone().invert()
    const localBounds = new THREE.Box3().makeEmpty()

    object.traverse((child) => {
      if (!child.isMesh || !child.geometry)
        return

      child.geometry.computeBoundingBox()
      if (!child.geometry.boundingBox)
        return

      // 将每个子 Mesh 的包围盒变换回 Hinge 局部空间，避免依赖 Blender 世界轴。
      const childToObjectMatrix = inverseObjectMatrix.clone().multiply(child.matrixWorld)
      const childBounds = child.geometry.boundingBox.clone().applyMatrix4(childToObjectMatrix)
      localBounds.union(childBounds)
    })

    if (localBounds.isEmpty()) {
      throw new Error(`无法从 ${object.name} 推导有效包围盒。`)
    }

    return localBounds
  }

  // 立起绕与铰链平行的水平轴旋转，铰链一侧抬起、机身前沿留在展台上（启动时算一次）。
  // 全部在 ProductRoot 空间推导；ProductRoot 相对 StandRoot 只有平移，所以轴向可直接复用。
  setStandFrame() {
    this.productRoot.updateMatrixWorld(true)
    const center = this.getLocalBounds(this.bottomRig, this.productRoot).getCenter(new THREE.Vector3())
    const hingeCenter = this.hingePivot.position.clone()
    this.standAxis = this.hingeAxis.clone().applyQuaternion(this.hingeBindQuaternion).setY(0)
    // 模型局部 +Y 为展台法线；side 垂直于转轴并指向机身前方（铰链 → 下半部中心）。
    const side = new THREE.Vector3(0, 1, 0).cross(this.standAxis)
    if (side.lengthSq() < 1e-10)
      throw new Error('铰链轴接近竖直，无法推导立起转轴。')
    side.normalize()
    if (side.dot(center.sub(hingeCenter)) < 0)
      side.negate()
    this.standAxis.normalize()
    this.standProfile = this.getStandProfile(side)
    // 转心取剖面前沿与底面的交点；圆角使它不一定落在几何上，真实触点由 setDisplayTilt 的抬升补偿。
    const front = Math.max(...this.standProfile.map(point => point.dot(side)))
    this.standFloorY = Math.min(...this.standProfile.map(point => point.y))
    this.standPivot = side.multiplyScalar(front).setY(this.standFloorY)
    // 取使铰链升高的旋转方向，不假设 GLB 的轴向正负。
    const lever = hingeCenter.sub(this.standPivot).setY(0)
    if (lever.clone().applyAxisAngle(this.standAxis, 0.1).y < 0)
      this.standAxis.negate()
    this.standPoint = new THREE.Vector3()
  }

  // 下半部与 Controller 沿转轴方向投影后的二维凸包（side, y）。绕平行于转轴的线旋转时，
  // 最低点必在凸包顶点上，逐帧只需遍历少量顶点就能让圆角前沿真实贴住展台。
  getStandProfile(side) {
    const inverse = this.productRoot.matrixWorld.clone().invert()
    const matrix = new THREE.Matrix4()
    const point = new THREE.Vector3()
    const points = []
    this.bottomRig.traverse((child) => {
      if (!child.isMesh || !child.geometry?.attributes.position)
        return
      matrix.multiplyMatrices(inverse, child.matrixWorld)
      const positions = child.geometry.attributes.position
      for (let i = 0; i < positions.count; i++) {
        point.fromBufferAttribute(positions, i).applyMatrix4(matrix)
        points.push([point.dot(side), point.y])
      }
    })
    if (points.length < 3)
      throw new Error('下半部顶点不足，无法建立立起剖面。')
    // Andrew monotone chain；cross ≤ 0 时剔除共线点，凸包顶点数通常只有几十到几百。
    points.sort((a, b) => a[0] - b[0] || a[1] - b[1])
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    const chain = (list) => {
      const result = []
      for (const p of list) {
        while (result.length >= 2 && cross(result.at(-2), result.at(-1), p) <= 0) result.pop()
        result.push(p)
      }
      result.pop()
      return result
    }
    const hull = [...chain(points), ...chain(points.slice().reverse())]
    return hull.map(([u, y]) => side.clone().multiplyScalar(u).setY(y))
  }

  setDisplayTilt(angle) {
    this.params.displayTilt = THREE.MathUtils.clamp(angle, 0, MAX_DISPLAY_TILT)
    const quaternion = this.standRoot.quaternion.setFromAxisAngle(
      this.standAxis,
      THREE.MathUtils.degToRad(this.params.displayTilt),
    )
    // 旋转后剖面最低点相对转心的高度；转心可能在圆角外侧的空处，所以正负都可能，
    // 反向平移同等距离，使最低点回到平放时的底面。
    let lowest = Infinity
    for (const point of this.standProfile) {
      lowest = Math.min(lowest, this.standPoint.copy(point).sub(this.standPivot).applyQuaternion(quaternion).y)
    }
    // 绕固定点 p 旋转：StandRoot = T(p)·R·T(-p)，平移项为 p - R·p；p 需加上 fitModel 写入的居中偏移。
    const pivot = this.standPivot.clone().add(this.productRoot.position)
    this.standRoot.position.copy(pivot).sub(pivot.applyQuaternion(quaternion))
    this.standRoot.position.y -= lowest
    this.displayTiltBinding?.refresh()
  }

  setAssemblyPose() {
    this.setDisplayTilt(0)
    this.setDebugAngle(this.params.assemblyAngle)
  }

  setHeroPose() {
    this.setDisplayTilt(this.params.heroTilt)
    this.setDebugAngle(this.params.heroAngle)
  }

  attachProductParts() {
    this.productRoot.updateMatrixWorld(true)

    // attach 在更换父级时保持世界变换；当前 GLB 父级均为均匀缩放。
    this.bottomRig.attach(this.nodes.bottomHalf)
    this.bottomRig.attach(this.nodes.controllerAssembly)
    this.hingePivot.attach(this.nodes.topHalf)
    this.hingeVisualRig.attach(this.nodes.hinge)
    this.productRoot.updateMatrixWorld(true)

    this.hingeBindQuaternion = this.hingePivot.quaternion.clone()
    this.hingeVisualBindQuaternion = this.hingeVisualRig.quaternion.clone()
    this.nodes.controllerAssembly.updateMatrix()
    this.controllerInstalledMatrix = this.nodes.controllerAssembly.matrix.clone()
  }

  setParams() {
    this.params = {
      productAngle: DEFAULT_FOLDED_ANGLE,
      foldedAngle: DEFAULT_FOLDED_ANGLE,
      assemblyAngle: DEFAULT_ASSEMBLY_ANGLE,
      heroAngle: DEFAULT_HERO_ANGLE,
      heroTilt: DEFAULT_HERO_TILT,
      displayTilt: 0,
      hingeAxis: this.hingeAxisName,
      hingeAxisSign: DEFAULT_HINGE_AXIS_SIGN,
      hingeVisualMix: 0.5,
    }
  }

  setProductAngle(angle) {
    this.params.productAngle = THREE.MathUtils.clamp(angle, 0, BIND_ANGLE)
    const foldRotation = THREE.MathUtils.degToRad(BIND_ANGLE - this.params.productAngle)
    const signedRotation = this.params.hingeAxisSign * foldRotation

    this.rotationQuaternion.setFromAxisAngle(this.hingeAxis, signedRotation)
    this.hingePivot.quaternion
      .copy(this.hingeBindQuaternion)
      .multiply(this.rotationQuaternion)

    this.rotationQuaternion.setFromAxisAngle(
      this.hingeAxis,
      signedRotation * this.params.hingeVisualMix,
    )
    this.hingeVisualRig.quaternion
      .copy(this.hingeVisualBindQuaternion)
      .multiply(this.rotationQuaternion)
  }

  applyInitialPose() {
    this.setProductAngle(this.params.foldedAngle)
  }

  setControllerAssembly() {
    this.controllerAssembly = new ControllerAssembly({
      controller: this.nodes.controllerAssembly,
      bottomRig: this.bottomRig,
      installedMatrix: this.controllerInstalledMatrix,
      prepareAssembly: () => this.setAssemblyPose(),
    })
  }

  debugInit() {
    if (!this.debug.ui)
      return
    const folder = this.debug.ui.addFolder({ title: 'Product Rig', expanded: false })
    folder.addBinding(this.params, 'hingeAxis', {
      label: 'Hinge axis',
      readonly: true,
    })
    this.productAngleBinding = folder.addBinding(this.params, 'productAngle', {
      label: 'Product angle',
      min: 0,
      max: BIND_ANGLE,
      step: 1,
    }).on('change', ({ value }) => this.setProductAngle(value))
    folder.addBinding(this.params, 'hingeAxisSign', {
      label: 'Axis sign',
      options: {
        Positive: 1,
        Negative: -1,
      },
    }).on('change', () => this.setProductAngle(this.params.productAngle))
    folder.addBinding(this.params, 'hingeVisualMix', {
      label: 'Hinge visual mix',
      min: 0,
      max: 1,
      step: 0.05,
    }).on('change', () => this.setProductAngle(this.params.productAngle))
    this.displayTiltBinding = folder.addBinding(this.params, 'displayTilt', {
      label: 'Display tilt',
      min: 0,
      max: MAX_DISPLAY_TILT,
      step: 0.5,
    }).on('change', ({ value }) => this.setDisplayTilt(value))
    folder.addBinding(this.params, 'heroAngle', { label: 'Hero angle', min: 90, max: 180, step: 1 })
    folder.addBinding(this.params, 'heroTilt', { label: 'Hero tilt', min: 0, max: MAX_DISPLAY_TILT, step: 0.5 })

    const poses = folder.addFolder({ title: 'Pose checks' })
    poses.addButton({ title: 'Folded 8°' }).on('click', () => {
      this.setDisplayTilt(0)
      this.setDebugAngle(this.params.foldedAngle)
    })
    poses.addButton({ title: 'Assembly 110°' }).on('click', () => this.setAssemblyPose())
    poses.addButton({ title: 'Hero 120° / 30°' }).on('click', () => this.setHeroPose())
    poses.addButton({ title: 'Bind 180°' }).on('click', () => {
      this.setDisplayTilt(0)
      this.setDebugAngle(BIND_ANGLE)
    })
  }

  setDebugAngle(angle) {
    this.setProductAngle(angle)
    this.productAngleBinding?.refresh()
  }

  getInspectableNodes() {
    return {
      standRoot: this.standRoot,
      productRoot: this.productRoot,
      bottomRig: this.bottomRig,
      hingePivot: this.hingePivot,
      hingeVisualRig: this.hingeVisualRig,
      runtimeAnchors: this.runtimeAnchors,
    }
  }

  destroy() {
    this.controllerAssembly?.destroy()
  }
}
