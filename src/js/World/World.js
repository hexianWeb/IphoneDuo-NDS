import Experience from '../Experience.js'
import NDSPlayer from '../NDS/NDSPlayer.js'
import CameraDirector from './Directors/CameraDirector.js'
import IntroDirector from './Directors/IntroDirector.js'
import Environment from './Environment/Environment.js'
import Exhibition from './Environment/Exhibition.js'
import Stage from './Environment/Stage.js'
import InputRouter from './Input/InputRouter.js'
import ControllerFeedback from './Product/ControllerFeedback.js'
import ControllerThemes from './Product/ControllerThemes.js'
import ModelAdapter from './Product/ModelAdapter.js'
import NDSStylus from './Product/NDSStylus.js'
import ScreenManager from './Screens/ScreenManager.js'
import ProductHeader from './Screens/ProductHeader.js'
import ProductIntroCopy from './Screens/ProductIntroCopy.js'
import ProductToolbar from './Screens/ProductToolbar.js'

export default class World {
  constructor() {
    this.experience = new Experience()
    this.scene = this.experience.scene
    this.resources = this.experience.resources
    this.debug = this.experience.debug
    this.events = this.experience.events
    this.state = this.experience.state

    this.setEnvironment()
    this.setProduct()
    this.setControllerFeedback()
    this.setStage()
    this.exhibition = new Exhibition({
      metrics: this.product.getExhibitionMetrics(),
      sources: this.product.getExhibitSources(),
      plantGltf: this.resources.items.rhyzomePlant,
      stage: this.stage,
      onLayout: bounds => this.environment.setShadowBounds(bounds),
    })
    this.setScreenManager()
    this.setCameraDirector()
    this.setIntro()
    this.setNDSPlayer()
    this.controllerThemes = new ControllerThemes({
      product: this.product, colorDock: this.exhibition.colorDock, state: this.state, events: this.events,
    })
    this.stylus = new NDSStylus({ debug: this.debug })
    this.setInputRouter()
    this.toolbar = new ProductToolbar({
      state: this.state, events: this.events, themes: this.exhibition.colorDock.themes, canvas: this.experience.canvas,
    })
    this.header = new ProductHeader({ state: this.state, events: this.events, canvas: this.experience.canvas })
    this.introCopy = new ProductIntroCopy({ state: this.state, events: this.events })
    this.removeToolbarListeners = [
      this.events.on('product:action', ({ action, options }) => this.handleAction(action, options)),
      this.events.on('product:help', ({ open }) => this.inputRouter.setUIBlocked(open)),
      this.events.on('nds:state', ({ loading }) => this.inputRouter.setLaunching(loading)),
    ]
    this.ndsPlayer.render()
  }

  setEnvironment() {
    this.environment = new Environment()
  }

  setStage() {
    this.stage = new Stage({
      surfaceY: this.product.getStageSurfaceWorldY(),
      textures: {
        color: this.resources.items.stagePlasticColor,
        normal: this.resources.items.stagePlasticNormal,
        roughness: this.resources.items.stagePlasticRoughness,
      },
    })
  }

  setProduct() {
    const gltf = this.resources.items.iphoneModel

    if (!gltf?.scene) {
      throw new Error('iphoneModel 未返回有效的 GLTF Scene。')
    }

    this.product = new ModelAdapter(gltf.scene)
  }

  setControllerFeedback() {
    this.controllerFeedback = new ControllerFeedback({
      buttons: this.product.buttons,
      shell: this.product.nodes.controllerShell,
      debug: this.debug,
      onHaptic: effect => this.inputRouter?.rumble(effect),
    })
  }

  setCameraDirector() {
    this.cameraDirector = new CameraDirector()
  }

  setScreenManager() {
    this.screenManager = new ScreenManager({
      topScreen: this.product.nodes.topScreen,
      bottomScreen: this.product.nodes.bottomScreen,
      bottomDisplay: this.product.nodes.bottomDisplay,
      phoneHomeTexture: this.resources.items.phoneHomeTexture,
      gameHomeReference: this.resources.items.gameHomeReference,
      gameCovers: Array.from({ length: 6 }, (_, index) => this.resources.items[`gameCover${index}`]),
      onPreviewAngle: angle => this.product.productRig.setDebugAngle(angle),
      onDebugModeChange: mode => this.setProductMode(mode),
    })
  }

  setIntro() {
    this.intro = new IntroDirector({
      productRig: this.product.productRig,
      onProductModeChange: mode => this.setProductMode(mode),
      onScreenWakeProgress: progress => this.screenManager.setPhoneWakeProgress(progress),
      onGameChangerStart: onComplete => this.screenManager.playGameChangerTransition({ onComplete }),
      onGameChangerStop: () => this.screenManager.killGameChangerTransition(),
      onGameChangerComplete: () => this.screenManager.completeGameChangerTransition(),
    })
  }

  setInputRouter() {
    this.inputRouter = new InputRouter({
      camera: this.experience.camera.instance,
      canvas: this.experience.canvas,
      interactionSurfaces: [this.product.nodes.topScreen, this.product.nodes.bottomDisplay],
      exhibitSurfaces: this.exhibition.colorDock.getInteractionSurfaces(),
      resolveExhibitAction: (intersection) => {
        if (this.state.introState !== 'ready' || this.ndsPlayer.loading) return null
        const key = this.exhibition.colorDock.getThemeAtHit(intersection)
        return key ? `theme:${key}` : null
      },
      onExhibitHover: key => this.exhibition.colorDock.setHoveredTheme(key),
      resolvePointerAction: (uv, screen) => this.screenManager.getActionAtUv(uv, screen),
      resolvePointerTouch: uv => this.screenManager.getNDSTouchAtUv(uv),
      onGameButtons: (actions) => {
        this.controllerFeedback.setActions(actions)
        // Game Home 只驱动 3D 按键；模拟器在暂停后不再接收按键，清空仍要送到 Runtime。
        if (this.state.productMode === 'playing' || actions.length === 0) this.ndsPlayer.setButtons(actions)
      },
      setOrbitGesture: allowed => this.cameraDirector.setGestureOrbit(allowed),
      onGameTouch: point => this.ndsPlayer.touch(point),
      onAction: (action, options) => this.handleAction(action, options),
    })
  }

  setNDSPlayer() {
    this.unsubscribeNDSStatus = this.events.on('nds:status', info => this.screenManager.setNDSStatus(info))
    this.ndsPlayer = new NDSPlayer({
      state: this.state,
      events: this.events,
      onFrame: pixels => this.screenManager.drawNDSFrame(pixels),
      onGameInfo: info => this.screenManager.setGameInfo(info),
      onLaunchStart: options => this.screenManager.beginGameEntry(options),
      onLaunchReady: () => this.screenManager.revealGameEntry(),
      onLaunchCancel: () => this.screenManager.cancelGameEntry(),
      onEnter: () => {
        this.intro.complete()
        this.setProductMode('playing')
      },
      onExit: () => this.setProductMode('game-home'),
      onFocus: () => this.experience.canvas.focus({ preventScroll: true }),
    })
  }

  setProductMode(mode) {
    if (this.state.productMode === mode) return

    this.state.setProductMode(mode)
    this.ndsPlayer?.setMode(mode)
    this.inputRouter?.setMode(mode)
    this.screenManager.setMode(mode)
    this.events.emit('product:mode', { mode })
  }

  handleAction(action, options) {
    if (action?.startsWith('theme:')) {
      this.events.emit('controller:theme-request', { key: action.slice(6) })
      return
    }
    if (action === 'skip-intro' && this.state.productMode !== 'playing') {
      this.intro.skip()
      this.experience.canvas.focus({ preventScroll: true })
      return
    }
    if (action === 'toggle-audio') {
      this.ndsPlayer.toggleAudio()
      return
    }
    const uiAction = this.screenManager.handleUiAction(action)
    if (uiAction === null) return
    if (uiAction !== undefined) action = uiAction
    if (action === 'continue' && this.state.productMode === 'game-home') {
      return this.ndsPlayer.play(null, options)
    }
    else if (action === 'choose-file' && this.state.productMode === 'game-home') {
      this.ndsPlayer.chooseFile()
    }
    else if (action === 'replay-intro' && this.state.productMode === 'game-home') {
      this.intro.play()
    }
    else if (action === 'back' || action === 'suspend') {
      this.ndsPlayer.back()
    }
  }

  start() {
    this.intro.play()
  }

  async preparePresentation() {
    const rig = this.product.productRig
    const renderer = this.experience.renderer
    const culling = new Map()
    // 编译也会做视锥剔除；Loading 内临时覆盖，避免 Hero 才露出的配件留到动画中首次编译。
    this.scene.traverse(object => {
      if (!object.isMesh) return
      culling.set(object, object.frustumCulled)
      object.frustumCulled = false
    })
    try {
      // 全部屏幕材质只在 Loading 下临时绑定；不发产品模式事件，也不启动音频或模拟器。
      rig.setHeroPose()
      rig.controllerAssembly.setInstalledPose()
      this.cameraDirector.transitionTo('hero', { immediate: true })
      for (const mode of ['phone', 'game-home', 'playing']) {
        this.experience.performanceMonitor?.setPhase(`warmup-${mode}`)
        this.screenManager.setMode(mode)
        this.screenManager.update()
        const prepared = await renderer.warmup()
        if (!prepared || this.experience.destroyed) return false
        this.events.emit('experience:scene-progress', { progress: (['phone', 'game-home', 'playing'].indexOf(mode) + 1) / 3 })
      }
      this.screenManager.markGameMaterialsPrepared()
    }
    finally {
      for (const [object, value] of culling) object.frustumCulled = value
      if (!this.experience.destroyed) {
        this.screenManager.setMode('phone')
        this.intro.setInitialPose()
        // 预热结束精确还原近闭合态与 Folded 镜头，避免首帧短暂露出装配终点。
      }
    }
    if (this.experience.destroyed) return false
    this.experience.performanceMonitor?.setPhase('warmup-folded')
    return renderer.warmup()
  }

  resize() {
    this.stylus?.resize()
    this.exhibition?.resize()
    this.cameraDirector?.resize()
  }

  update() {
    this.product.update()
    this.inputRouter.update()
    this.stylus.update(this.experience.time.delta)
    this.controllerFeedback.update(this.experience.time.delta)
    // Time.delta 是秒，模拟器使用毫秒；由 Experience 唯一循环驱动，不能另起 rAF。
    this.ndsPlayer.update(this.experience.time.delta * 1000)
    this.screenManager.setProductAngle(this.product.productRig.params.productAngle)
    this.screenManager.update()
    this.exhibition.update(this.experience.time.elapsed)
    this.environment.update()
  }

  destroy() {
    this.introCopy?.destroy()
    this.header?.destroy()
    this.toolbar?.destroy()
    this.removeToolbarListeners?.forEach(remove => remove())
    this.controllerThemes?.destroy()
    this.unsubscribeNDSStatus?.()
    this.inputRouter?.destroy()
    this.stylus?.destroy()
    this.ndsPlayer?.destroy()
    this.intro?.destroy()
    this.cameraDirector?.destroy()
    this.screenManager?.destroy()
    this.exhibition?.destroy()
    this.stage?.destroy()
    this.controllerFeedback?.destroy()
    this.product?.destroy()
    this.environment?.destroy()
  }
}
