import { uniform } from 'three/tsl'
import * as THREE from 'three/webgpu'
import {
  foldedPhoneColor,
  gameChangerTopColor,
  screenIrisMask,
} from '../../../shaders/screenEffects.js'
import Experience from '../../Experience.js'

export default class PhoneScreenSurface {
  constructor({
    topScreen,
    bottomScreen,
    phoneHomeTexture,
    gameHomeTexture,
    entryUniforms,
    onPreviewAngle,
    onDebugModeChange,
  }) {
    this.experience = new Experience()
    this.debug = this.experience.debug
    this.topScreen = topScreen
    this.bottomScreen = bottomScreen
    this.phoneHomeTexture = phoneHomeTexture
    this.gameHomeSourceTexture = gameHomeTexture
    this.entryUniforms = entryUniforms
    this.onPreviewAngle = onPreviewAngle
    this.onDebugModeChange = onDebugModeChange
    this.params = {
      phoneBrightness: 0.30,
      phoneDiffuseDetail: 0.14,
      phoneRoughness: 0.95,
      phoneMirrorX: false,
      phoneMirrorY: false,
      phoneRotation: 180,
      swapPhonePanels: false,
      foldPreviewAngle: 8,
      topBlurStartAngle: 16,
      topClearAngle: 75,
      topBlurPixels: 14,
      topParallax: 0.02,
      topFoldShade: 0.35,
      topShadeSide: 0,
      foldedBrightness: 0.45,
      bottomClearAngle: 45,
      wakeBlurPixels: 2,
      phoneExitBlurPixels: 14,
      phoneExitScale: 0.97,
      gameBlurPixels: 12,
      gameScale: 1.03,
      gameMirrorX: false,
      gameMirrorY: false,
      gameRotation: -90,
    }
    this.productAngle = 8
    this.phoneWakeProgress = 0
    this.transitionProgress = 0

    this.validateResources()
    this.createTextures()
    this.createUniforms()
    this.createMaterials()
    this.configurePhoneTextures()
    this.configureGameHomeTexture()
    this.configureMaterialNodes()
    this.applyFoldEffect()
    this.setTransitionProgress(0)
    this.debugInit()
  }

  validateResources() {
    if (!this.phoneHomeTexture?.isTexture) {
      throw new Error('phoneHomeTexture 未返回有效纹理。')
    }
    if (!this.gameHomeSourceTexture?.isTexture) {
      throw new Error('gameHomeTexture 未返回有效纹理。')
    }
  }

  createTextures() {
    this.phonePanelCanvases = []
    this.phonePanelTextures = this.createPhonePanelTextures()
    // 动态 Game Home CanvasTexture 由 ControllerDisplay 持有并更新，这里只配置采样方向。
    this.gameHomeTexture = this.gameHomeSourceTexture
    this.configureUiTexture(this.gameHomeTexture)
    this.gameTextureWidth = this.gameHomeTexture.image?.naturalWidth
      ?? this.gameHomeTexture.image?.width
      ?? 1484
  }

  createPhonePanelTextures() {
    const image = this.phoneHomeTexture.image
    const imageWidth = image?.naturalWidth ?? image?.width
    const imageHeight = image?.naturalHeight ?? image?.height

    if (!imageWidth || !imageHeight || imageWidth % 2 !== 0) {
      throw new Error('Phone UI 必须是可均分为左右面板的有效双联图片。')
    }

    this.phonePanelWidth = imageWidth / 2
    return [0, 1].map((panelIndex) => {
      const canvas = document.createElement('canvas')
      canvas.width = this.phonePanelWidth
      canvas.height = imageHeight
      const context = canvas.getContext('2d')
      if (!context) {
        throw new Error('无法创建 Phone UI Canvas 2D Context。')
      }
      context.drawImage(
        image,
        panelIndex * this.phonePanelWidth,
        0,
        this.phonePanelWidth,
        imageHeight,
        0,
        0,
        this.phonePanelWidth,
        imageHeight,
      )
      this.phonePanelCanvases.push(canvas)

      const texture = new THREE.CanvasTexture(canvas)
      texture.name = `Phone_Home_Panel_${panelIndex + 1}`
      this.configureUiTexture(texture)
      return texture
    })
  }

  configureUiTexture(texture) {
    texture.colorSpace = THREE.SRGBColorSpace
    texture.flipY = false
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.generateMipmaps = false
    texture.needsUpdate = true
  }

  createUniforms() {
    const createPhoneUniforms = () => ({
      blur: uniform(0),
      parallax: uniform(0),
      shade: uniform(0),
      shadeSide: uniform(0),
      diffuse: uniform(0),
      emissive: uniform(0),
    })
    this.phoneUniforms = {
      top: createPhoneUniforms(),
      bottom: createPhoneUniforms(),
    }
    this.transitionUniforms = {
      progress: uniform(0),
      phoneBlur: uniform(0),
      phoneUvScale: uniform(1),
      gameBlur: uniform(0),
      gameUvScale: uniform(1),
      bottomOpacity: uniform(1),
    }
  }

  createMaterials() {
    this.topMaterial = this.createPhoneMaterial(this.topScreen)
    this.bottomMaterial = this.createPhoneMaterial(this.bottomScreen)
    this.bottomMaterial.transparent = true
    this.bottomMaterial.opacityNode = this.transitionUniforms.bottomOpacity
  }

  createPhoneMaterial(screen) {
    const material = new THREE.MeshStandardNodeMaterial({
      color: '#ffffff',
      emissive: '#ffffff',
      metalness: 0,
      roughness: this.params.phoneRoughness,
      side: this.getPrimaryMaterial(screen)?.side ?? THREE.FrontSide,
      toneMapped: true,
    })
    material.name = `${screen.name}_Phone_Surface_Material`
    return material
  }

  configurePhoneTextures() {
    const repeatX = this.params.phoneMirrorX ? -1 : 1
    const repeatY = this.params.phoneMirrorY ? -1 : 1
    const rotation = THREE.MathUtils.degToRad(this.params.phoneRotation)

    this.phonePanelTextures.forEach((texture) => {
      texture.center.set(0.5, 0.5)
      texture.repeat.set(repeatX, repeatY)
      texture.rotation = rotation
      texture.updateMatrix()
    })
  }

  configureGameHomeTexture() {
    // Game Mode 上屏采样需要相对 Mesh UV 旋转 90°；镜像仍可在调试面板覆盖。
    this.gameHomeTexture.center.set(0.5, 0.5)
    this.gameHomeTexture.repeat.set(
      this.params.gameMirrorX ? -1 : 1,
      this.params.gameMirrorY ? -1 : 1,
    )
    this.gameHomeTexture.rotation = THREE.MathUtils.degToRad(this.params.gameRotation)
    this.gameHomeTexture.updateMatrix()
  }

  configureMaterialNodes() {
    const panelIndices = this.params.swapPhonePanels ? [1, 0] : [0, 1]
    const topTexture = this.phonePanelTextures[panelIndices[0]]
    const bottomTexture = this.phonePanelTextures[panelIndices[1]]
    let topColor = gameChangerTopColor(
      topTexture,
      this.gameHomeTexture,
      this.phoneUniforms.top,
      this.transitionUniforms,
    )
    if (this.entryUniforms)
      topColor = topColor.mul(screenIrisMask(this.entryUniforms))
    const bottomColor = foldedPhoneColor(bottomTexture, this.phoneUniforms.bottom)

    this.topMaterial.colorNode = topColor.mul(this.phoneUniforms.top.diffuse)
    this.topMaterial.emissiveNode = topColor.mul(this.phoneUniforms.top.emissive)
    this.bottomMaterial.colorNode = bottomColor.mul(this.phoneUniforms.bottom.diffuse)
    this.bottomMaterial.emissiveNode = bottomColor.mul(this.phoneUniforms.bottom.emissive)
    this.topMaterial.needsUpdate = true
    this.bottomMaterial.needsUpdate = true
  }

  getPrimaryMaterial(screen) {
    return Array.isArray(screen.material) ? screen.material[0] : screen.material
  }

  setProductAngle(angle) {
    if (this.productAngle === angle)
      return
    this.productAngle = angle
    this.applyFoldEffect()
  }

  setWakeProgress(progress) {
    const value = THREE.MathUtils.clamp(progress, 0, 1)
    if (this.phoneWakeProgress === value)
      return
    this.phoneWakeProgress = value
    this.applyFoldEffect()
  }

  applyFoldEffect() {
    const topRecovery = THREE.MathUtils.smoothstep(
      this.productAngle,
      this.params.topBlurStartAngle,
      this.params.topClearAngle,
    )
    const topFoldEffect = 1 - topRecovery
    const bottomRecovery = THREE.MathUtils.smoothstep(
      this.productAngle,
      8,
      this.params.bottomClearAngle,
    )
    const wakeEffect = 1 - this.phoneWakeProgress
    const wakeBrightness = THREE.MathUtils.lerp(0.88, 1, this.phoneWakeProgress)
    const topBrightness = THREE.MathUtils.lerp(
      this.params.foldedBrightness,
      1,
      topRecovery,
    ) * wakeBrightness
    const bottomBrightness = THREE.MathUtils.lerp(
      this.params.foldedBrightness,
      1,
      bottomRecovery,
    ) * wakeBrightness

    this.phoneUniforms.top.blur.value = (
      this.params.topBlurPixels * topFoldEffect
      + this.params.wakeBlurPixels * wakeEffect
    ) / this.phonePanelWidth
    this.phoneUniforms.top.parallax.value = this.params.topParallax * topFoldEffect
    this.phoneUniforms.top.shade.value = this.params.topFoldShade * topFoldEffect
    this.phoneUniforms.top.shadeSide.value = this.params.topShadeSide
    this.phoneUniforms.bottom.blur.value = 0
    this.phoneUniforms.bottom.parallax.value = 0
    this.phoneUniforms.bottom.shade.value = 0
    this.applyPhoneLevels(this.phoneUniforms.top, topBrightness)
    this.applyPhoneLevels(this.phoneUniforms.bottom, bottomBrightness)
  }

  applyPhoneLevels(screenUniforms, level) {
    screenUniforms.diffuse.value = this.params.phoneDiffuseDetail * level
    screenUniforms.emissive.value = this.params.phoneBrightness * level
  }

  applySurfaceSettings() {
    this.topMaterial.roughness = this.params.phoneRoughness
    this.bottomMaterial.roughness = this.params.phoneRoughness
    this.applyFoldEffect()
  }

  setTransitionProgress(progress) {
    const value = THREE.MathUtils.clamp(progress, 0, 1)
    this.transitionProgress = value
    this.transitionUniforms.progress.value = value
    this.transitionUniforms.phoneBlur.value = (
      this.params.phoneExitBlurPixels * value
    ) / this.phonePanelWidth
    this.transitionUniforms.phoneUvScale.value = 1 / THREE.MathUtils.lerp(
      1,
      this.params.phoneExitScale,
      value,
    )
    this.transitionUniforms.gameBlur.value = (
      this.params.gameBlurPixels * (1 - value)
    ) / this.gameTextureWidth
    this.transitionUniforms.gameUvScale.value = 1 / THREE.MathUtils.lerp(
      this.params.gameScale,
      1,
      value,
    )
    this.transitionUniforms.bottomOpacity.value = 1 - value
  }

  previewFoldEffect() {
    this.onDebugModeChange?.('phone')
    this.setWakeProgress(1)
    this.onPreviewAngle?.(this.params.foldPreviewAngle)
  }

  debugInit() {
    if (!this.debug.ui)
      return
    const phoneFolder = this.debug.ui.addFolder({
      title: 'Phone Screens',
      expanded: true,
    })
    phoneFolder.addBinding(this.params, 'phoneBrightness', {
      label: 'Brightness',
      min: 0,
      max: 2,
      step: 0.01,
    }).on('change', () => this.applySurfaceSettings())
    phoneFolder.addBinding(this.params, 'phoneDiffuseDetail', {
      label: 'Diffuse detail',
      min: 0,
      max: 1,
      step: 0.01,
    }).on('change', () => this.applySurfaceSettings())
    phoneFolder.addBinding(this.params, 'phoneRoughness', {
      label: 'Roughness',
      min: 0,
      max: 1,
      step: 0.01,
    }).on('change', () => this.applySurfaceSettings())

    const orientation = phoneFolder.addFolder({ title: 'UI orientation' })
    orientation.addBinding(this.params, 'phoneMirrorX', { label: 'Mirror X' })
      .on('change', () => this.configurePhoneTextures())
    orientation.addBinding(this.params, 'phoneMirrorY', { label: 'Mirror Y' })
      .on('change', () => this.configurePhoneTextures())
    orientation.addBinding(this.params, 'phoneRotation', {
      label: 'Rotation',
      options: { '-90°': -90, '0°': 0, '90°': 90, '180°': 180 },
    }).on('change', () => this.configurePhoneTextures())
    orientation.addBinding(this.params, 'swapPhonePanels', { label: 'Swap panels' })
      .on('change', () => this.configureMaterialNodes())

    const foldFolder = this.debug.ui.addFolder({ title: 'Fold Screen Effect' })
    const foldRanges = {
      foldPreviewAngle: [8, 110, 1],
      topBlurStartAngle: [8, 60, 1],
      topClearAngle: [30, 110, 1],
      topBlurPixels: [0, 40, 1],
      topParallax: [0, 0.08, 0.001],
      topFoldShade: [0, 1, 0.01],
      foldedBrightness: [0, 1, 0.01],
      bottomClearAngle: [8, 90, 1],
      wakeBlurPixels: [0, 10, 0.5],
    }
    Object.entries(foldRanges).forEach(([key, [min, max, step]]) => {
      foldFolder.addBinding(this.params, key, { label: key, min, max, step })
        .on('change', () => {
          if (key === 'foldPreviewAngle')
            this.previewFoldEffect()
          else this.applyFoldEffect()
        })
    })
    foldFolder.addBinding(this.params, 'topShadeSide', {
      label: 'Hinge shade side',
      options: { Left: 0, Right: 1 },
    }).on('change', () => this.applyFoldEffect())
    foldFolder.addButton({ title: 'Inspect Fold Effect' })
      .on('click', () => this.previewFoldEffect())

    const gameFolder = this.debug.ui.addFolder({ title: 'Top Game UI' })
    const transitionRanges = {
      phoneExitBlurPixels: [0, 30, 1],
      phoneExitScale: [0.9, 1, 0.005],
      gameBlurPixels: [0, 30, 1],
      gameScale: [1, 1.12, 0.005],
    }
    Object.entries(transitionRanges).forEach(([key, [min, max, step]]) => {
      gameFolder.addBinding(this.params, key, { label: key, min, max, step })
        .on('change', () => this.setTransitionProgress(this.transitionProgress))
    })
    gameFolder.addBinding(this.params, 'gameMirrorX', { label: 'Mirror X' })
      .on('change', () => this.configureGameHomeTexture())
    gameFolder.addBinding(this.params, 'gameMirrorY', { label: 'Mirror Y' })
      .on('change', () => this.configureGameHomeTexture())
    gameFolder.addBinding(this.params, 'gameRotation', {
      label: 'Rotation',
      options: { '-90°': -90, '0°': 0, '90°': 90, '180°': 180 },
    }).on('change', () => this.configureGameHomeTexture())
  }

  destroy() {
    this.topMaterial.dispose()
    this.bottomMaterial.dispose()
    this.phonePanelTextures.forEach(texture => texture.dispose())
    this.phonePanelTextures.length = 0
    this.phonePanelCanvases.length = 0
  }
}
