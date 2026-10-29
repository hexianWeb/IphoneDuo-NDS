import { gsap } from 'gsap'
import Experience from '../../Experience.js'

export default class IntroDirector {
  constructor({
    productRig,
    onProductModeChange,
    onScreenWakeProgress,
    onGameChangerStart,
    onGameChangerStop,
    onGameChangerComplete,
  }) {
    this.experience = new Experience()
    this.events = this.experience.events
    this.state = this.experience.state
    this.debug = this.experience.debug
    this.productRig = productRig
    this.controllerAssembly = productRig.controllerAssembly
    this.onProductModeChange = onProductModeChange
    this.onScreenWakeProgress = onScreenWakeProgress
    this.onGameChangerStart = onGameChangerStart
    this.onGameChangerStop = onGameChangerStop
    this.onGameChangerComplete = onGameChangerComplete
    this.angleState = { value: productRig.params.foldedAngle }
    this.standState = { angle: 0, tilt: 0 }
    this.screenWakeState = { value: 0 }
    this.params = {
      state: 'idle',
      foldedHold: 1.2,
      unfoldCrackAngle: 24,
      unfoldCrackDuration: 0.45,
      unfoldDuration: 1.55,
      screenWakeDuration: 1.5,
      screenWakeHold: 0.2,
      pauseAtScreenWake: false,
      assemblyDelay: 0.35,
      standDuration: 1.3,
      heroHold: 1,
    }

    this.debugInit()
  }

  play() {
    this.killFlow()
    this.setInitialPose()

    this.timeline = gsap.timeline({
      onComplete: () => {
        this.timeline = null
      },
    })
    this.timeline
      .to({}, { duration: this.params.foldedHold })
      .call(() => this.setState('intro-unfold'))
      // 先用 in 曲线撕开近闭合态，再用 out 曲线落到展示角。
      // ease-in 终点速度高、ease-out 起点速度高，两拍衔接不会在开缝角停住。
      .to(this.angleState, {
        value: this.getUnfoldCrackAngle(),
        duration: this.params.unfoldCrackDuration,
        ease: 'power3.in',
        onUpdate: () => this.applyUnfoldAngle(),
      })
      .to(this.angleState, {
        value: this.productRig.params.assemblyAngle,
        duration: this.params.unfoldDuration,
        ease: 'power3.out',
        onUpdate: () => this.applyUnfoldAngle(),
      })
      .call(() => {
        this.productRig.productAngleBinding?.refresh()
        this.setState('screen-wake')
        this.onProductModeChange?.('phone')
        this.screenWakeState.value = 0
        this.applyScreenWake()
      })
      .to(this.screenWakeState, {
        value: 1,
        duration: this.params.screenWakeDuration,
        ease: 'power2.out',
        onUpdate: () => this.applyScreenWake(),
      })
      .to({}, { duration: this.params.screenWakeHold })
      .call(() => this.pauseForScreenWakeDebug())
      .to({}, { duration: this.params.assemblyDelay })
      .call(() => this.startAssembly())
  }

  setInitialPose() {
    this.onProductModeChange?.('phone')
    this.angleState.value = this.productRig.params.foldedAngle
    this.productRig.setDisplayTilt(0)
    this.productRig.setDebugAngle(this.angleState.value)
    this.controllerAssembly.setEntryPose({ prepare: false })
    this.controllerAssembly.setVisible(false)
    this.screenWakeState.value = 0
    this.applyScreenWake()
    this.setState('intro-folded')
  }

  getUnfoldCrackAngle() {
    return Math.min(this.params.unfoldCrackAngle, this.productRig.params.assemblyAngle)
  }

  applyUnfoldAngle() {
    this.productRig.setProductAngle(this.angleState.value)
  }

  applyScreenWake() {
    this.onScreenWakeProgress?.(this.screenWakeState.value)
  }

  pauseForScreenWakeDebug() {
    if (this.params.pauseAtScreenWake)
      this.timeline?.pause()
  }

  inspectScreenWake() {
    this.killFlow()
    this.productRig.setAssemblyPose()
    this.controllerAssembly.setEntryPose({ prepare: false })
    this.controllerAssembly.setVisible(false)
    this.screenWakeState.value = 1
    this.applyScreenWake()
    this.setState('screen-wake')
    this.onProductModeChange?.('phone')
  }

  continueAssembly() {
    if (this.state.introState !== 'screen-wake')
      return

    if (this.timeline?.paused()) {
      this.timeline.resume()
      return
    }

    this.killFlow()
    this.startAssembly()
  }

  startAssembly() {
    this.setState('controller-assembly')
    this.onProductModeChange?.('attaching')
    this.controllerAssembly.play({
      prepare: false,
      onComplete: () => this.startGameChanger(),
    })
  }

  startGameChanger() {
    this.setState('game-changer')
    this.onGameChangerStart?.(() => this.enterHero())
  }

  // 装配在平放 110° 完成；进入 Hero 时再把夹角开到 120° 并整机立起，与镜头过渡同时进行。
  enterHero() {
    const rig = this.productRig
    this.onProductModeChange?.('game-home')
    this.setState('hero')
    this.standState.angle = rig.params.productAngle
    this.standState.tilt = rig.params.displayTilt
    this.heroTimeline = gsap.timeline({
      onComplete: () => {
        this.heroTimeline = null
        this.setState('ready')
      },
    })
    this.heroTimeline
      .to(this.standState, {
        angle: rig.params.heroAngle,
        tilt: rig.params.heroTilt,
        duration: this.params.standDuration,
        ease: 'power2.inOut',
        onUpdate: () => {
          rig.setProductAngle(this.standState.angle)
          rig.setDisplayTilt(this.standState.tilt)
        },
        onComplete: () => rig.productAngleBinding?.refresh(),
      })
      .to({}, { duration: this.params.heroHold })
  }

  skip() {
    this.complete()
    this.onProductModeChange?.('game-home')
  }

  complete() {
    this.killFlow()
    this.productRig.setHeroPose()
    this.controllerAssembly.setInstalledPose()
    this.screenWakeState.value = 1
    this.applyScreenWake()
    this.onGameChangerComplete?.()
    this.setState('ready')
  }

  setState(state) {
    this.params.state = state
    this.state.setIntroState(state)
    this.stateBinding?.refresh()
    this.events.emit('intro:state', { state })
  }

  killFlow() {
    this.timeline?.kill()
    this.timeline = null
    this.heroTimeline?.kill()
    this.heroTimeline = null
    this.controllerAssembly.killTimeline()
    this.onGameChangerStop?.()
  }

  debugInit() {
    if (!this.debug.ui)
      return
    const folder = this.debug.ui.addFolder({ title: 'Intro Director' })
    this.stateBinding = folder.addBinding(this.params, 'state', {
      label: 'State',
      readonly: true,
    })

    folder.addBinding(this.params, 'unfoldCrackAngle', {
      label: 'unfoldCrackAngle',
      min: 8,
      max: 90,
      step: 1,
    })

    const timingKeys = [
      'foldedHold',
      'unfoldCrackDuration',
      'unfoldDuration',
      'screenWakeDuration',
      'screenWakeHold',
      'assemblyDelay',
      'standDuration',
      'heroHold',
    ]
    timingKeys.forEach((key) => {
      folder.addBinding(this.params, key, {
        label: key,
        min: 0,
        max: key === 'screenWakeHold' ? 30 : 10,
        step: 0.05,
      })
    })

    folder.addBinding(this.params, 'pauseAtScreenWake', {
      label: 'Pause at Screen Wake',
    })

    const actions = folder.addFolder({ title: 'Actions' })
    actions.addButton({ title: 'Inspect Screen Wake' }).on('click', () => this.inspectScreenWake())
    actions.addButton({ title: 'Continue Assembly' }).on('click', () => this.continueAssembly())
    actions.addButton({ title: 'Replay Intro' }).on('click', () => this.play())
    actions.addButton({ title: 'Skip Intro' }).on('click', () => this.skip())
  }

  destroy() {
    this.killFlow()
  }
}
