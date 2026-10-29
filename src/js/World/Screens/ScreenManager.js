import { gsap } from 'gsap'
import * as THREE from 'three/webgpu'
import Experience from '../../Experience.js'
import NDSScreenBridge from '../../NDS/NDSScreenBridge.js'
import ControllerDisplay from './ControllerDisplay.js'
import GameEntryTransition from './GameEntryTransition.js'
import NDSGameSurface from './NDSGameSurface.js'
import PhoneScreenSurface from './PhoneScreenSurface.js'

export default class ScreenManager {
  constructor({
    topScreen,
    bottomScreen,
    bottomDisplay,
    phoneHomeTexture,
    gameHomeReference,
    gameCovers,
    onPreviewAngle,
    onDebugModeChange,
  }) {
    this.experience = new Experience()
    this.debug = this.experience.debug
    this.screens = { topScreen, bottomScreen, bottomDisplay }
    this.onDebugModeChange = onDebugModeChange
    this.params = {
      transitionProgress: 0,
      transitionHold: 0.15,
      transitionDuration: 0.75,
    }
    this.transitionState = { value: 0 }
    this.isRefreshingTransitionProgress = false
    this.mode = null

    this.validateScreens()
    this.captureOriginalState()
    this.createOffMaterials()
    this.gameEntry = new GameEntryTransition(topScreen, this.debug)
    this.controllerDisplay = new ControllerDisplay({
      screen: bottomDisplay,
      gameHomeReference,
      gameCovers,
    })
    this.phoneSurface = new PhoneScreenSurface({
      topScreen,
      bottomScreen,
      phoneHomeTexture,
      gameHomeTexture: this.controllerDisplay.topTexture,
      entryUniforms: this.gameEntry.uniforms,
      onPreviewAngle,
      onDebugModeChange,
    })
    this.ndsBridge = new NDSScreenBridge(document.createElement('canvas'), document.createElement('canvas'))
    this.ndsSurfaces = [
      new NDSGameSurface(topScreen, { flipY: false, mirrorX: false, aspect: 1.4, entryUniforms: this.gameEntry.uniforms }),
      new NDSGameSurface(bottomDisplay, { flipY: true, mirrorX: true, aspect: 1 }),
    ]
    this.applyMode()
    this.debugInit()
  }

  validateScreens() {
    Object.entries(this.screens).forEach(([key, screen]) => {
      if (!screen?.isMesh) {
        throw new Error(`${key} 必须是可渲染的屏幕 Mesh。`)
      }
      if (!screen.geometry?.attributes?.uv) {
        throw new Error(`${screen.name} 缺少屏幕 UV。`)
      }
    })
  }

  captureOriginalState() {
    this.originalState = new Map()
    Object.values(this.screens).forEach((screen) => {
      this.originalState.set(screen, {
        material: screen.material,
        visible: screen.visible,
      })
    })
  }

  createOffMaterials() {
    this.offMaterials = new Map()
    Object.values(this.screens).forEach((screen) => {
      const material = new THREE.MeshBasicNodeMaterial({
        color: '#000000',
        side: this.getPrimaryMaterial(screen)?.side ?? THREE.FrontSide,
        toneMapped: false,
      })
      material.name = `${screen.name}_Off_Material`
      this.offMaterials.set(screen, material)
    })
  }

  getPrimaryMaterial(screen) {
    return Array.isArray(screen.material) ? screen.material[0] : screen.material
  }

  setMode(mode) {
    if (this.mode === mode)
      return

    this.mode = mode
    if (mode === 'game-home')
      this.controllerDisplay.setView('home')
    this.applyMode()
  }

  applyMode() {
    const { topScreen, bottomScreen, bottomDisplay } = this.screens

    if (this.mode === 'phone' || this.mode === 'attaching') {
      this.setGameChangerProgress(0)
      this.setScreenMaterial(topScreen, this.phoneSurface.topMaterial, true)
      this.setScreenMaterial(bottomScreen, this.phoneSurface.bottomMaterial, true)
      // 显示层隐藏后，Controller 中央镂空会直接露出手机原生下屏。
      this.setScreenMaterial(bottomDisplay, this.controllerDisplay.material, false)
      return
    }

    if (this.mode === 'game-home') {
      this.controllerDisplay.drawGameHome()
      this.setScreenMaterial(topScreen, this.phoneSurface.topMaterial, true)
      this.setScreenMaterial(bottomScreen, this.phoneSurface.bottomMaterial, false)
      this.setScreenMaterial(bottomDisplay, this.controllerDisplay.material, true)
      this.setGameChangerProgress(1)
      return
    }

    if (this.mode === 'playing') {
      this.setScreenMaterial(topScreen, this.ndsSurfaces[0].material, true)
      this.setScreenMaterial(bottomScreen, this.phoneSurface.bottomMaterial, false)
      this.setScreenMaterial(bottomDisplay, this.ndsSurfaces[1].material, true)
      this.setGameChangerProgress(1)
      return
    }

    this.setScreenOff(topScreen, true)
    this.setScreenOff(bottomScreen, true)
    this.setScreenMaterial(bottomDisplay, this.controllerDisplay.material, false)
  }

  setProductAngle(angle) {
    this.phoneSurface.setProductAngle(angle)
  }

  setPhoneWakeProgress(progress) {
    this.phoneSurface.setWakeProgress(progress)
  }

  beginGameEntry(options) {
    return this.gameEntry.close(options)
  }

  async revealGameEntry() {
    // 遮罩完全合拢且 Runtime 已呈现首帧后才替换材质；产品模式仍保持 Home，禁止提前接收游戏输入。
    this.setScreenMaterial(this.screens.topScreen, this.ndsSurfaces[0].material, true)
    this.setScreenMaterial(this.screens.bottomDisplay, this.ndsSurfaces[1].material, true)
    const generation = this.gameEntry.generation
    // 主产品初始化已预热 NDS 两屏；按需重编译时也覆盖实际 GTAO/透射渲染通道。
    if (!this.gameMaterialsPrepared) {
      const prepared = await this.experience.renderer.warmup()
      if (!prepared || this.gameEntry.destroyed || generation !== this.gameEntry.generation)
        return false
      this.gameMaterialsPrepared = true
    }
    // 编译期间取消或 Replay 后，不得重新打开旧启动请求的遮罩。
    if (this.gameEntry.destroyed || generation !== this.gameEntry.generation)
      return false
    return this.gameEntry.open()
  }

  markGameMaterialsPrepared() {
    this.gameMaterialsPrepared = true
  }

  cancelGameEntry() {
    this.gameEntry.cancel()
    this.applyMode()
  }

  playGameChangerTransition({ onComplete } = {}) {
    this.killGameChangerTransition()
    this.controllerDisplay.drawGameHome()
    this.setScreenMaterial(
      this.screens.bottomDisplay,
      this.controllerDisplay.material,
      false,
    )
    this.transitionState.value = 0
    this.setGameChangerProgress(0)

    this.gameChangerTimeline = gsap.timeline({
      onComplete: () => {
        this.gameChangerTimeline = null
        this.setGameChangerProgress(1)
        onComplete?.()
      },
    })
    this.gameChangerTimeline
      .to({}, { duration: this.params.transitionHold })
      .to(this.transitionState, {
        value: 1,
        duration: this.params.transitionDuration,
        ease: 'power2.inOut',
        onUpdate: () => this.setGameChangerProgress(this.transitionState.value),
      })
  }

  setGameChangerProgress(progress) {
    const value = THREE.MathUtils.clamp(progress, 0, 1)
    this.params.transitionProgress = value
    this.transitionState.value = value
    this.phoneSurface.setTransitionProgress(value)
    this.controllerDisplay.setTransitionProgress(value)

    if (this.mode === 'attaching' || this.mode === 'game-home') {
      this.screens.bottomScreen.visible = value < 0.999
      this.screens.bottomDisplay.visible = value > 0.001
    }
    this.isRefreshingTransitionProgress = true
    this.transitionProgressBinding?.refresh()
    this.isRefreshingTransitionProgress = false
  }

  completeGameChangerTransition() {
    this.killGameChangerTransition()
    this.controllerDisplay.drawGameHome()
    this.setScreenMaterial(
      this.screens.bottomDisplay,
      this.controllerDisplay.material,
      true,
    )
    this.setGameChangerProgress(1)
  }

  killGameChangerTransition() {
    this.gameChangerTimeline?.kill()
    this.gameChangerTimeline = null
  }

  inspectTransparentController() {
    this.killGameChangerTransition()
    this.onDebugModeChange?.('attaching')
    this.setGameChangerProgress(0)
  }

  replayGameChangerTransition() {
    this.onDebugModeChange?.('attaching')
    this.playGameChangerTransition({
      onComplete: () => this.onDebugModeChange?.('game-home'),
    })
  }

  setScreenMaterial(screen, material, visible) {
    screen.material = material
    screen.visible = visible
  }

  setScreenOff(screen, visible) {
    this.setScreenMaterial(screen, this.offMaterials.get(screen), visible)
  }

  getActionAtUv(uv, screen) {
    if (this.mode !== 'game-home')
      return null
    return this.controllerDisplay.getActionAtUv(
      uv,
      screen === this.screens.topScreen ? 'top' : 'bottom',
    )
  }

  handleUiAction(action) {
    if (this.mode !== 'game-home')
      return undefined
    return this.controllerDisplay.handleAction(action)
  }

  drawNDSFrame(pixels) {
    this.ndsBridge.draw(pixels)
    this.ndsSurfaces.forEach((surface, index) => surface.draw(this.ndsBridge.screens[index].canvas))
  }

  getNDSTouchAtUv(uv) {
    if (this.mode !== 'playing')
      return null
    return this.ndsSurfaces[1].getTouchAtUv(uv)
  }

  setGameInfo(info) {
    this.controllerDisplay.setGameInfo(info)
  }

  setNDSStatus(info) {
    this.controllerDisplay.setNDSStatus(info)
  }

  debugInit() {
    if (!this.debug.ui)
      return
    const folder = this.debug.ui.addFolder({ title: 'Game Changer Transition' })
    this.transitionProgressBinding = folder.addBinding(this.params, 'transitionProgress', {
      label: 'Progress',
      min: 0,
      max: 1,
      step: 0.01,
    }).on('change', ({ value }) => {
      // Tweakpane refresh 也会发出 change，程序刷新不能反向取消正在播放的 Timeline。
      if (this.isRefreshingTransitionProgress)
        return

      this.killGameChangerTransition()
      this.onDebugModeChange?.('attaching')
      this.setGameChangerProgress(value)
    })
    folder.addBinding(this.params, 'transitionHold', {
      label: 'Hold',
      min: 0,
      max: 2,
      step: 0.05,
    })
    folder.addBinding(this.params, 'transitionDuration', {
      label: 'Duration',
      min: 0.1,
      max: 3,
      step: 0.05,
    })
    folder.addButton({ title: 'Inspect Transparent' })
      .on('click', () => this.inspectTransparentController())
    folder.addButton({ title: 'Replay Transition' })
      .on('click', () => this.replayGameChangerTransition())
    folder.addButton({ title: 'Complete Transition' })
      .on('click', () => {
        this.completeGameChangerTransition()
        this.onDebugModeChange?.('game-home')
      })
  }

  update() {
    this.controllerDisplay.update()
  }

  destroy() {
    this.killGameChangerTransition()
    this.gameEntry.destroy()
    Object.values(this.screens).forEach((screen) => {
      const original = this.originalState.get(screen)
      screen.material = original.material
      screen.visible = original.visible
    })
    this.phoneSurface.destroy()
    this.controllerDisplay.destroy()
    this.ndsSurfaces.forEach(surface => surface.destroy())
    this.ndsBridge.destroy()
    this.offMaterials.forEach(material => material.dispose())
    this.offMaterials.clear()
  }
}
