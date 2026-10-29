import * as THREE from 'three/webgpu'
import Experience from '../../Experience.js'

const AXIS_LEGEND = 'X 红 · Y 绿 · Z 蓝'

export default class ModelInspector {
  constructor({ presentationRoot, nodes }) {
    this.experience = new Experience()
    this.scene = this.experience.scene
    this.debug = this.experience.debug
    this.presentationRoot = presentationRoot
    this.nodes = {
      presentationRoot,
      ...nodes,
    }

    this.tempPosition = new THREE.Vector3()
    this.tempQuaternion = new THREE.Quaternion()
    this.tempEuler = new THREE.Euler()
    this.selectedBounds = new THREE.Box3()
    this.lastPanelRefresh = 0

    this.params = {
      selectedNode: 'presentationRoot',
      axisLegend: AXIS_LEGEND,
      showWorldAxes: false,
      showGrid: false,
      showSelectedAxes: false,
      showSelectedBounds: false,
      showAllPartAxes: false,
      axisSize: 0.55,
      localPosition: '',
      localRotation: '',
      worldPosition: '',
      worldRotation: '',
    }

    this.setHelpers()
    this.debugInit()
    this.selectNode(this.params.selectedNode)
    this.update()
  }

  setHelpers() {
    this.worldAxes = new THREE.AxesHelper(1.25)
    this.worldAxes.name = 'DebugWorldAxes'
    this.configureOverlayHelper(this.worldAxes)
    this.scene.add(this.worldAxes)

    this.grid = new THREE.GridHelper(20, 20, '#526075', '#283241')
    this.grid.name = 'DebugWorldGrid'
    this.grid.visible = this.params.showGrid
    this.grid.position.y = -0.01
    this.scene.add(this.grid)

    this.selectedAxes = new THREE.AxesHelper(1)
    this.selectedAxes.name = 'DebugSelectedAxes'
    this.configureOverlayHelper(this.selectedAxes)
    this.scene.add(this.selectedAxes)

    this.boundsHelper = new THREE.Box3Helper(this.selectedBounds, '#f8fafc')
    this.boundsHelper.name = 'DebugSelectedBounds'
    this.configureOverlayHelper(this.boundsHelper, 0.75)
    this.scene.add(this.boundsHelper)

    this.partAxes = Object.entries(this.nodes).map(([key, node]) => {
      const helper = new THREE.AxesHelper(1)
      helper.name = `DebugAxes_${key}`
      helper.userData.targetNode = node
      helper.visible = false
      this.configureOverlayHelper(helper, 0.85)
      this.scene.add(helper)
      return helper
    })
  }

  configureOverlayHelper(helper, opacity = 1) {
    const materials = Array.isArray(helper.material) ? helper.material : [helper.material]
    materials.forEach((material) => {
      material.depthTest = false
      material.transparent = opacity < 1
      material.opacity = opacity
    })
    helper.renderOrder = 1000
  }

  debugInit() {
    const folder = this.debug.ui.addFolder({ title: 'Coordinate Inspector', expanded: false })
    const options = Object.fromEntries(
      Object.keys(this.nodes).map(key => [this.getNodeLabel(key), key]),
    )

    folder.addBinding(this.params, 'axisLegend', {
      label: 'Axis colors',
      readonly: true,
    })
    folder.addBinding(this.params, 'selectedNode', {
      label: 'Node',
      options,
    }).on('change', ({ value }) => this.selectNode(value))

    const helperFolder = folder.addFolder({ title: 'Helpers', expanded: false })
    helperFolder.addBinding(this.params, 'showWorldAxes', {
      label: 'World axes',
    }).on('change', ({ value }) => {
      this.worldAxes.visible = value
    })
    helperFolder.addBinding(this.params, 'showGrid', {
      label: 'World grid',
    }).on('change', ({ value }) => {
      this.grid.visible = value
    })
    helperFolder.addBinding(this.params, 'showSelectedAxes', {
      label: 'Selected axes',
    })
    helperFolder.addBinding(this.params, 'showSelectedBounds', {
      label: 'Selected bounds',
    })
    helperFolder.addBinding(this.params, 'showAllPartAxes', {
      label: 'All part axes',
    })
    helperFolder.addBinding(this.params, 'axisSize', {
      label: 'Axis size',
      min: 0.1,
      max: 2,
      step: 0.05,
    })

    const transformFolder = folder.addFolder({ title: 'Transform Readout', expanded: false })
    this.transformBindings = [
      transformFolder.addBinding(this.params, 'localPosition', {
        label: 'Local position',
        readonly: true,
      }),
      transformFolder.addBinding(this.params, 'localRotation', {
        label: 'Local rotation',
        readonly: true,
      }),
      transformFolder.addBinding(this.params, 'worldPosition', {
        label: 'World position',
        readonly: true,
      }),
      transformFolder.addBinding(this.params, 'worldRotation', {
        label: 'World rotation',
        readonly: true,
      }),
    ]
  }

  getNodeLabel(key) {
    if (key === 'presentationRoot')
      return 'PresentationRoot'
    return this.nodes[key].name || key
  }

  selectNode(key) {
    this.selectedNode = this.nodes[key] ?? this.presentationRoot
    this.params.selectedNode = this.nodes[key] ? key : 'presentationRoot'
    this.updateHelpers()
    this.updateReadout(true)
  }

  update() {
    this.updateHelpers()
    this.updateReadout()
  }

  updateHelpers() {
    this.worldAxes.visible = this.params.showWorldAxes
    this.grid.visible = this.params.showGrid

    this.selectedAxes.visible = this.params.showSelectedAxes
    if (this.params.showSelectedAxes) {
      this.selectedNode.getWorldPosition(this.tempPosition)
      this.selectedNode.getWorldQuaternion(this.tempQuaternion)
      this.selectedAxes.position.copy(this.tempPosition)
      this.selectedAxes.quaternion.copy(this.tempQuaternion)
      this.selectedAxes.scale.setScalar(this.params.axisSize)
    }
    this.boundsHelper.visible = this.params.showSelectedBounds
    if (this.params.showSelectedBounds) {
      this.selectedBounds.setFromObject(this.selectedNode)
      this.boundsHelper.visible = !this.selectedBounds.isEmpty()
    }

    this.partAxes.forEach((helper) => {
      helper.visible = this.params.showAllPartAxes
      if (!helper.visible)
        return
      const targetNode = helper.userData.targetNode
      targetNode.getWorldPosition(this.tempPosition)
      targetNode.getWorldQuaternion(this.tempQuaternion)
      helper.position.copy(this.tempPosition)
      helper.quaternion.copy(this.tempQuaternion)
      helper.scale.setScalar(this.params.axisSize * 0.7)
    })
  }

  updateReadout(force = false) {
    if (!force && !this.debug.ui.expanded)
      return
    const now = performance.now()
    if (!force && now - this.lastPanelRefresh < 100)
      return

    this.lastPanelRefresh = now
    this.params.localPosition = this.formatVector(this.selectedNode.position)
    this.params.localRotation = this.formatEuler(this.selectedNode.rotation)

    this.selectedNode.getWorldPosition(this.tempPosition)
    this.params.worldPosition = this.formatVector(this.tempPosition)
    this.selectedNode.getWorldQuaternion(this.tempQuaternion)
    this.tempEuler.setFromQuaternion(this.tempQuaternion, 'XYZ')
    this.params.worldRotation = this.formatEuler(this.tempEuler)
    this.transformBindings?.forEach(binding => binding.refresh())
  }

  formatVector(vector) {
    return `${vector.x.toFixed(3)}, ${vector.y.toFixed(3)}, ${vector.z.toFixed(3)}`
  }

  formatEuler(euler) {
    return [euler.x, euler.y, euler.z]
      .map(value => `${THREE.MathUtils.radToDeg(value).toFixed(1)}°`)
      .join(', ')
  }

  destroy() {
    const helpers = [
      this.worldAxes,
      this.grid,
      this.selectedAxes,
      this.boundsHelper,
      ...this.partAxes,
    ]

    helpers.forEach((helper) => {
      this.scene.remove(helper)
      helper.dispose?.()
    })
  }
}
