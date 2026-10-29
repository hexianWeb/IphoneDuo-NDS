import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import * as THREE from 'three/webgpu'
import Experience from '../Experience.js'

export default class Camera {
  constructor() {
    this.experience = new Experience()
    this.canvas = this.experience.canvas
    this.scene = this.experience.scene
    this.sizes = this.experience.sizes
    this.debug = this.experience.debug

    this.params = {
      fov: 38,
    }

    this.setInstance()
    this.setControls()
    this.debugInit()
  }

  setInstance() {
    this.instance = new THREE.PerspectiveCamera(
      this.params.fov,
      this.sizes.width / this.sizes.height,
      0.01,
      100,
    )
    this.instance.position.set(4.5, 2.5, 5.5)
    this.scene.add(this.instance)
  }

  setControls() {
    this.controls = new OrbitControls(this.instance, this.canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.06
    this.controls.target.set(0, 0, 0)
  }

  debugInit() {
    if (!this.debug.ui)
      return
    const folder = this.debug.ui.addFolder({ title: 'Camera', expanded: false })
    folder.addBinding(this.params, 'fov', {
      label: 'FOV',
      min: 20,
      max: 75,
      step: 1,
    }).on('change', ({ value }) => {
      this.instance.fov = value
      this.instance.updateProjectionMatrix()
    })
  }

  update() {
    this.controls.update()
  }

  resize() {
    this.instance.aspect = this.sizes.width / this.sizes.height
    this.instance.updateProjectionMatrix()
  }

  destroy() {
    this.controls.dispose()
    this.scene.remove(this.instance)
  }
}
