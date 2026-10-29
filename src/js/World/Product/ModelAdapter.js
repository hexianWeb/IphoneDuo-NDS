import * as THREE from 'three/webgpu'
import Experience from '../../Experience.js'
import ButtonPrint, { getButtonFrame } from './ButtonPrint.js'
import ControllerButtonMaterial from './ControllerButtonMaterial.js'
import ControllerShellMaterial from './ControllerShellMaterial.js'
import ModelInspector from './ModelInspector.js'
import ProductRig from './ProductRig.js'

const REQUIRED_NODES = {
  phoneRoot: 'PHONE_ROOT',
  bottomHalf: 'BottomHalf_NO_CAM',
  topHalf: 'TopHalf_CAM',
  hinge: 'Hinge',
  controllerAssembly: 'CONTROLLER_ASSEMBLY_ROOT',
  controllerRoot: 'Controller_ROOT',
  controllerShell: 'Controller_Shell',
  topScreen: 'Top_Screen_Plane',
  bottomScreen: 'Bottom_Screen_Plane',
  bottomDisplay: 'Bottom_Display_Plane',
}

const BUTTON_NODES = { a: 'Button_A', b: 'Button_B', x: 'Button_X', y: 'Button_Y', dpad: 'DPad' }

// 用户在 Blender 中确认的桌面上表面位于 Z = -0.035，导出后对应 GLB 模型局部 Y。
const STAGE_SURFACE_MODEL_Y = -0.035

export default class ModelAdapter {
  constructor(model) {
    this.experience = new Experience()
    this.scene = this.experience.scene
    this.debug = this.experience.debug
    this.resources = this.experience.resources
    this.model = model
    this.resolveNodes()
    this.configureMeshes()
    this.configureControllerLightmap()
    this.configureButtonMaterials()

    this.presentationRoot = new THREE.Group()
    this.presentationRoot.name = 'PresentationRoot'
    this.productRig = new ProductRig({
      model: this.model,
      nodes: this.nodes,
    })
    this.presentationRoot.add(this.productRig.standRoot)

    this.fitModel()
    this.productRig.applyInitialPose()
    this.scene.add(this.presentationRoot)
    this.debugInit()
    if (this.debug.enabled) {
      this.inspector = new ModelInspector({
        presentationRoot: this.presentationRoot,
        nodes: {
          ...this.nodes,
          ...this.productRig.getInspectableNodes(),
        },
      })
    }
  }

  resolveNodes() {
    this.nodes = {}
    const missingNodes = []

    Object.entries(REQUIRED_NODES).forEach(([key, nodeName]) => {
      const node = this.model.getObjectByName(nodeName)

      if (node) {
        this.nodes[key] = node
      }
      else {
        missingNodes.push(nodeName)
      }
    })

    if (missingNodes.length > 0) {
      throw new Error(`GLB 缺少必要节点：${missingNodes.join('、')}`)
    }
  }

  configureMeshes() {
    this.meshes = []

    this.model.traverse((child) => {
      if (!child.isMesh)
        return

      child.castShadow = true
      child.receiveShadow = true
      this.meshes.push(child)
    })
  }

  configureButtonMaterials() {
    this.buttons = Object.fromEntries(Object.entries(BUTTON_NODES).map(([key, name]) => {
      const node = this.nodes.controllerRoot.getObjectByName(name)
      if (!node?.isMesh)
        throw new Error(`Controller 缺少按键 Mesh：${name}`)
      return [key, node]
    }))
    this.buttonPrint = new ButtonPrint(this.debug)
    this.controllerButtonMaterial = new ControllerButtonMaterial({ buttons: this.buttons, debug: this.debug, buttonPrint: this.buttonPrint })
  }

  configureControllerLightmap() {
    this.controllerShellLightmap = this.resources.items.controllerShellLightmap
    const controllerShell = this.nodes.controllerShell

    if (!this.controllerShellLightmap?.isTexture) {
      throw new Error('controllerShellLightmap 未返回有效纹理。')
    }
    if (!controllerShell.isMesh || !controllerShell.geometry.attributes.uv1) {
      throw new Error('Controller_Shell 缺少 Lightmap UV（TEXCOORD_1 / uv1）。')
    }

    this.controllerShellMaterial = new ControllerShellMaterial({ shell: controllerShell, debug: this.debug })

    // bake 写在 Blender 的 Lightmap 层，导出为 TEXCOORD_1；Three.js 对应 uv1 / channel 1。
    // 当前 EXR 与 glTF UV 的 V 方向相反，视觉校验确认需要 flipY 才能正确对齐。
    this.controllerShellLightmap.name = 'Controller_Shell_Lightmap'
    this.controllerShellLightmap.colorSpace = THREE.LinearSRGBColorSpace
    this.controllerShellLightmap.flipY = true
    this.controllerShellLightmap.channel = 1
    this.controllerShellLightmap.needsUpdate = true
    this.controllerShellMaterials = Array.isArray(controllerShell.material)
      ? controllerShell.material
      : [controllerShell.material]

    this.controllerShellMaterials.forEach((material) => {
      material.lightMap = this.controllerShellLightmap
      material.lightMapIntensity = 1
      material.needsUpdate = true
    })
  }

  fitModel() {
    this.productRig.productRoot.updateMatrixWorld(true)

    const bounds = new THREE.Box3().setFromObject(this.productRig.productRoot)
    const size = bounds.getSize(new THREE.Vector3())
    const center = bounds.getCenter(new THREE.Vector3())
    const maxDimension = Math.max(size.x, size.y, size.z)

    if (!Number.isFinite(maxDimension) || maxDimension <= 0) {
      throw new Error('无法从 iPhone GLB 计算有效包围盒。')
    }

    // ProductRoot 统一承担居中偏移，避免修改 GLB 节点及运行时 Rig 的相对变换。
    this.productRig.productRoot.position.sub(center)
    this.fitScale = 3.2 / maxDimension
    this.params = {
      positionX: 0,
      positionY: 0,
      positionZ: 0,
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      scale: this.fitScale,
      wireframe: false,
      controllerLightmapEnabled: true,
      controllerLightmapIntensity: 1,
      nodeStatus: `${Object.keys(this.nodes).length} / ${Object.keys(REQUIRED_NODES).length}`,
    }

    this.applyTransform()
    this.applyControllerLightmap()
  }

  // 桌面高度受 fitModel() 的居中偏移与 PresentationRoot 展示变换共同影响，
  // 因此走运行时矩阵换算，不能把推导出的世界坐标写死。
  getStageSurfaceWorldY() {
    this.presentationRoot.updateMatrixWorld(true)
    return this.model.localToWorld(new THREE.Vector3(0, STAGE_SURFACE_MODEL_Y, 0)).y
  }

  getControllerColors() {
    return {
      shell: this.controllerShellMaterial.uniforms.color.value.clone(),
      buttons: Object.fromEntries(Object.entries(this.buttons).map(([key, button]) => [
        key,
        this.controllerButtonMaterial.getColors(button),
      ])),
    }
  }

  setControllerColors({ shell, buttons }) {
    // 只更新已有材质的颜色，保留 uv1 Lightmap、清漆节点及按键动画的所有权。
    this.controllerShellMaterial.setColor(shell)
    Object.entries(this.buttons).forEach(([key, button]) => {
      this.controllerButtonMaterial.setColors(button, buttons[key])
    })
  }

  getExhibitionMetrics() {
    const rig = this.productRig
    const controller = this.nodes.controllerAssembly
    const angle = rig.params.productAngle
    const hinge = rig.hingePivot.quaternion.clone()
    const visual = rig.hingeVisualRig.quaternion.clone()
    const position = controller.position.clone()
    const quaternion = controller.quaternion.clone()
    const scale = controller.scale.clone()
    try {
      // 仅在 World 初始化、首帧渲染前测量安装完成的 110° 平放占地，不运行装配或 Intro 时间线。
      // Hero 立起绕前下边缘旋转，占地只会收进这个范围内，因此底座仍以平放态为准。
      rig.setProductAngle(rig.params.assemblyAngle)
      rig.controllerInstalledMatrix.decompose(controller.position, controller.quaternion, controller.scale)
      this.presentationRoot.updateMatrixWorld(true)
      const bounds = new THREE.Box3().setFromObject(rig.productRoot, true)
      const size = bounds.getSize(new THREE.Vector3())
      return {
        width: size.x,
        depth: size.z,
        bounds,
        center: bounds.getCenter(new THREE.Vector3()),
        supportY: this.getStageSurfaceWorldY(),
      }
    }
    finally {
      // 精确恢复首帧近闭合态与 Controller 位姿，避免测量把 Rig 推到另一产品状态。
      rig.params.productAngle = angle
      rig.hingePivot.quaternion.copy(hinge)
      rig.hingeVisualRig.quaternion.copy(visual)
      controller.position.copy(position)
      controller.quaternion.copy(quaternion)
      controller.scale.copy(scale)
      this.presentationRoot.updateMatrixWorld(true)
    }
  }

  getExhibitSources() {
    this.presentationRoot.updateMatrixWorld(true)
    const centerOf = (mesh) => {
      mesh.geometry.computeBoundingBox()
      return mesh.geometry.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(mesh.matrixWorld)
    }
    // 用 ABXY 静止菱形定义展品面内的右/上，面外法线为 right × up；不假设 GLB 的轴向。
    const { right, up, normal } = getButtonFrame(this.buttons)
    const frame = new THREE.Matrix4().makeBasis(right, up, normal)
    frame.setPosition(centerOf(this.nodes.controllerShell))
    const inverseFrame = frame.clone().invert()
    const describe = (mesh, part) => {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      return {
        name: mesh.name,
        part,
        geometry: mesh.geometry,
        // 保留完整仿射矩阵；副本的矩阵与 GLB 节点脱钩，非均匀缩放也无需分解成不准确的 TRS。
        matrix: inverseFrame.clone().multiply(mesh.matrixWorld),
        materials: materials.map(material => ({ color: material.color.clone(), side: material.side, vertexColors: material.vertexColors })),
      }
    }
    return {
      shell: describe(this.nodes.controllerShell, 'shell'),
      buttons: Object.fromEntries(Object.entries(this.buttons).map(([key, mesh]) => [key, describe(mesh, key)])),
      plasticParams: { ...this.controllerShellMaterial.params },
      buttonPrint: this.buttonPrint,
    }
  }

  applyTransform() {
    this.presentationRoot.position.set(
      this.params.positionX,
      this.params.positionY,
      this.params.positionZ,
    )
    this.presentationRoot.rotation.set(
      THREE.MathUtils.degToRad(this.params.rotationX),
      THREE.MathUtils.degToRad(this.params.rotationY),
      THREE.MathUtils.degToRad(this.params.rotationZ),
    )
    this.presentationRoot.scale.setScalar(this.params.scale)
  }

  setWireframe(enabled) {
    this.meshes.forEach((mesh) => {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      materials.forEach((material) => {
        material.wireframe = enabled
        material.needsUpdate = true
      })
    })
  }

  applyControllerLightmap() {
    this.controllerShellMaterials.forEach((material) => {
      material.lightMap = this.params.controllerLightmapEnabled
        ? this.controllerShellLightmap
        : null
      material.lightMapIntensity = this.params.controllerLightmapIntensity
      material.needsUpdate = true
    })
  }

  debugInit() {
    if (!this.debug.ui)
      return
    const folder = this.debug.ui.addFolder({ title: 'Product Model', expanded: false })
    folder.addBinding(this.params, 'nodeStatus', {
      label: 'Required nodes',
      readonly: true,
    })

    const lightmapFolder = folder.addFolder({ title: 'Controller Lightmap' })
    lightmapFolder.addBinding(this.params, 'controllerLightmapEnabled', {
      label: 'Enabled',
    }).on('change', () => this.applyControllerLightmap())
    lightmapFolder.addBinding(this.params, 'controllerLightmapIntensity', {
      label: 'Intensity',
      min: 0,
      max: 5,
      step: 0.05,
    }).on('change', () => this.applyControllerLightmap())

    const transformFolder = folder.addFolder({ title: 'Transform' })
    const positionKeys = ['positionX', 'positionY', 'positionZ']
    const rotationKeys = ['rotationX', 'rotationY', 'rotationZ']

    positionKeys.forEach((key) => {
      transformFolder.addBinding(this.params, key, {
        label: key,
        min: -3,
        max: 3,
        step: 0.01,
      }).on('change', () => this.applyTransform())
    })
    rotationKeys.forEach((key) => {
      transformFolder.addBinding(this.params, key, {
        label: key,
        min: -180,
        max: 180,
        step: 1,
      }).on('change', () => this.applyTransform())
    })
    transformFolder.addBinding(this.params, 'scale', {
      label: 'scale',
      min: this.fitScale * 0.25,
      max: this.fitScale * 3,
      step: this.fitScale * 0.01,
    }).on('change', () => this.applyTransform())

    folder.addBinding(this.params, 'wireframe', {
      label: 'Wireframe',
    }).on('change', ({ value }) => this.setWireframe(value))
  }

  update() {
    this.inspector?.update()
  }

  destroy() {
    this.inspector?.destroy()
    this.productRig?.destroy()
    // 先恢复 GLB 原材质，使下方去重回收同时覆盖被替换的原材质及其共享纹理。
    this.controllerShellMaterial?.destroy()
    this.controllerButtonMaterial?.destroy()
    this.buttonPrint?.destroy()
    const geometries = new Set()
    const materials = new Set()
    const textures = new Set()

    this.meshes.forEach((mesh) => {
      geometries.add(mesh.geometry)
      const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      meshMaterials.forEach((material) => {
        materials.add(material)
        Object.values(material).forEach((value) => {
          if (value?.isTexture)
            textures.add(value)
        })
      })
    })

    textures.add(this.controllerShellLightmap)
    textures.forEach(texture => texture.dispose())
    materials.forEach(material => material.dispose())
    geometries.forEach(geometry => geometry.dispose())
    this.scene.remove(this.presentationRoot)
  }
}
