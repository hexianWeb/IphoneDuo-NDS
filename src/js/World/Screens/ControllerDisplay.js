import { uniform } from 'three/tsl'
import * as THREE from 'three/webgpu'
import { controllerTransitionColor } from '../../../shaders/screenEffects.js'
import Experience from '../../Experience.js'
import { ndsSources } from '../../sources.js'

const VIEWS = ['home', 'library', 'map', 'controller', 'media']
const TAB_ORDER = ['home', 'library', 'media']
const FONT = 'Inter, -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif'
// 上屏主封面与右侧预览的间距。滑动时按这个间距平移，预览才能落到主封面的位置。
const COVER_PITCH = 992
const COLORS = {
  light: {
    start: '#d3e8ff',
    end: '#f9f0ed',
    ink: '#142944',
    muted: '#627690',
    glass: 'rgba(255,255,255,0.75)',
    strong: '#ffffff',
    accent: '#086ee8',
    line: 'rgba(255,255,255,0.9)',
    shadow: 'rgba(30,50,85,0.18)',
  },
  dark: {
    start: '#111d37',
    end: '#332c4b',
    ink: '#f7f9ff',
    muted: '#b6c3da',
    glass: 'rgba(39,54,84,0.84)',
    strong: '#435a86',
    accent: '#a5d0ff',
    line: 'rgba(255,255,255,0.15)',
    shadow: 'rgba(0,0,0,0.28)',
  },
}

export default class ControllerDisplay {
  constructor({ screen, gameHomeReference, gameCovers }) {
    const experience = new Experience()
    this.debug = experience.debug
    this.events = experience.events
    this.screen = screen
    this.gameHomeReference = gameHomeReference.image
    this.gameCovers = gameCovers.map(texture => texture.image)
    this.coverIndex = 0
    // 封面逻辑索引先切到目标，像素偏移再缓动回 0，避免动画中途改索引造成跳变。
    this.coverOffset = 0
    this.coverMotion = null
    this.pageMotion = null
    this.params = { brightness: 0.72, blurPixels: 12, scale: 1.03 }
    this.theme = 'light'
    this.view = 'home'
    this.focusIndex = 0
    this.focusables = []
    this.bottomRegions = []
    this.topRegions = []
    this.transitionProgress = 0
    this.hasTestGame = Boolean(ndsSources.testRom)
    this.hasLoadedGame = false
    this.gameInfo = { title: 'Nintendo DS', detail: 'Two screens. One adventure.' }
    this.ndsStatus = 'idle'
    this.statusMessage = this.hasTestGame ? 'Demo ready to start' : 'Choose a local .nds game'
    this.createCanvases()
    this.createMaterial()
    this.drawGameHome()
    this.setTransitionProgress(0)
    this.debugInit()
  }

  createCanvases() {
    this.canvas = document.createElement('canvas')
    this.canvas.width = 1024
    this.canvas.height = 1024
    this.context = this.canvas.getContext('2d')
    this.topCanvas = document.createElement('canvas')
    this.topCanvas.width = 1400
    this.topCanvas.height = 1000
    this.topContext = this.topCanvas.getContext('2d')
    if (!this.context || !this.topContext)
      throw new Error('无法创建 Game Home Canvas 2D Context。')

    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.name = 'Controller_Display_UI'
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.minFilter = THREE.LinearFilter
    this.texture.magFilter = THREE.LinearFilter
    this.texture.generateMipmaps = false
    // 下屏模型 UV 的方向与画布相差四分之一圈，显示和点击共用同一矩阵。
    this.texture.center.set(0.5, 0.5)
    this.texture.repeat.set(-1, 1)
    this.texture.rotation = -Math.PI / 2
    this.texture.updateMatrix()

    this.topTexture = new THREE.CanvasTexture(this.topCanvas)
    this.topTexture.name = 'Game_Home_Top_Screen'
    this.topTexture.colorSpace = THREE.SRGBColorSpace
    this.topTexture.minFilter = THREE.LinearFilter
    this.topTexture.magFilter = THREE.LinearFilter
    this.topTexture.generateMipmaps = false
    this.bottomInteractionUv = new THREE.Vector2()
    this.topInteractionUv = new THREE.Vector2()
    this.frameDirty = false
  }

  createMaterial() {
    this.uniforms = {
      controllerBlur: uniform(0),
      controllerUvScale: uniform(1),
      controllerOpacity: uniform(0),
      controllerBrightness: uniform(this.params.brightness),
    }
    const original = Array.isArray(this.screen.material) ? this.screen.material[0] : this.screen.material
    this.material = new THREE.MeshBasicNodeMaterial({
      side: original?.side ?? THREE.FrontSide,
      transparent: true,
      depthWrite: false,
      toneMapped: true,
    })
    this.material.name = 'Controller_Display_UI_Material'
    this.material.colorNode = controllerTransitionColor(this.texture, this.uniforms)
      .mul(this.uniforms.controllerBrightness)
    this.material.opacityNode = this.uniforms.controllerOpacity
  }

  setTransitionProgress(progress) {
    const value = THREE.MathUtils.clamp(progress, 0, 1)
    this.transitionProgress = value
    this.uniforms.controllerBlur.value = this.params.blurPixels * (1 - value) / this.canvas.width
    this.uniforms.controllerUvScale.value = 1 / THREE.MathUtils.lerp(this.params.scale, 1, value)
    this.uniforms.controllerOpacity.value = value
    this.uniforms.controllerBrightness.value = this.params.brightness
  }

  get colors() {
    return COLORS[this.theme]
  }

  get primaryLabel() {
    if (this.ndsStatus === 'loading')
      return 'Preparing game…'
    if (this.hasLoadedGame)
      return 'Resume game'
    return this.hasTestGame ? 'Start demo' : 'Choose game'
  }

  get displayStatus() {
    if (this.ndsStatus === 'loading')
      return 'Preparing your game…'
    if (this.ndsStatus === 'error')
      return this.statusMessage
    if (this.hasLoadedGame)
      return 'Session paused · ready to resume'
    return this.hasTestGame ? 'Demo ready to start' : 'Choose a local .nds game'
  }

  setView(view) {
    if (!VIEWS.includes(view) || view === this.view)
      return
    const direction = this.pageDirection(this.view, view)
    this.beginPageMotion(direction, 460)
    this.coverMotion = null
    this.coverOffset = 0
    this.view = view
    this.focusIndex = 0
    this.drawGameHome()
  }

  pageDirection(from, to) {
    const fromTab = TAB_ORDER.indexOf(from)
    const toTab = TAB_ORDER.indexOf(to)
    if (fromTab >= 0 && toTab >= 0 && fromTab !== toTab)
      return Math.sign(toTab - fromTab)
    return to === 'home' ? -1 : 1
  }

  beginPageMotion(direction, duration) {
    this.ensureMotionBuffers()
    this.copyCanvas(this.topCanvas, this.motionFromTop)
    this.copyCanvas(this.canvas, this.motionFromBottom)
    this.pageMotion = { start: performance.now(), duration, direction }
  }

  shiftCover(nextIndex) {
    const count = this.gameCovers.length
    if (!count)
      return
    const index = ((nextIndex % count) + count) % count
    let delta = index - this.coverIndex
    if (delta > count / 2)
      delta -= count
    if (delta < -count / 2)
      delta += count
    if (delta === 0)
      return
    this.coverIndex = index
    if (this.pageMotion) {
      this.drawGameHome()
      return
    }
    this.coverOffset += delta * COVER_PITCH
    const distance = Math.abs(this.coverOffset)
    this.coverMotion = {
      start: performance.now(),
      from: this.coverOffset,
      duration: Math.min(860, 420 + (distance / COVER_PITCH) * 180),
    }
    this.drawGameHome()
  }

  ensureMotionBuffers() {
    if (this.motionFromTop)
      return
    this.motionFromTop = this.createMotionCanvas(1400, 1000)
    this.motionToTop = this.createMotionCanvas(1400, 1000)
    this.motionFromBottom = this.createMotionCanvas(1024, 1024)
    this.motionToBottom = this.createMotionCanvas(1024, 1024)
  }

  createMotionCanvas(width, height) {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    return canvas
  }

  copyCanvas(source, target) {
    const context = target.getContext('2d')
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.clearRect(0, 0, target.width, target.height)
    context.drawImage(source, 0, 0)
  }

  // ease-in-out：起步和落位都减速，页面切换不会在第一帧跳到终态。
  easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2
  }

  paintPageMotion(progress) {
    const travel = this.pageMotion.direction === 0 ? 0 : 168
    this.blitMotion(this.topContext, this.motionFromTop, this.motionToTop, progress, travel)
    this.blitMotion(this.context, this.motionFromBottom, this.motionToBottom, progress, travel)
    this.frameDirty = true
  }

  blitMotion(context, from, to, progress, travel) {
    const direction = this.pageMotion.direction
    const width = context.canvas.width
    const height = context.canvas.height
    context.save()
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.clearRect(0, 0, width, height)
    context.globalAlpha = 1 - progress
    context.drawImage(from, -direction * travel * progress, 0)
    context.globalAlpha = progress
    context.drawImage(to, direction * travel * (1 - progress), 0)
    context.restore()
  }

  setNDSStatus({ status, message }) {
    this.ndsStatus = status
    this.statusMessage = message
    this.drawGameHome()
  }

  setGameInfo(info) {
    this.gameInfo = { ...this.gameInfo, ...info }
    this.hasLoadedGame = true
    this.drawGameHome()
  }

  navigate(direction) {
    if (this.view === 'home') {
      const column = this.focusIndex % 2
      const row = Math.floor(this.focusIndex / 2)
      if (direction === 'left' && column === 1)
        this.focusIndex--
      if (direction === 'right' && column === 0)
        this.focusIndex++
      if (direction === 'up' && row === 1)
        this.focusIndex -= 2
      if (direction === 'down' && row === 0)
        this.focusIndex += 2
      this.drawGameHome()
      return
    }
    if (!this.focusables.length)
      return
    const step = direction === 'down' || direction === 'right' ? 1 : -1
    this.focusIndex = (this.focusIndex + step + this.focusables.length) % this.focusables.length
    this.drawGameHome()
  }

  activate() {
    return this.focusables[this.focusIndex] ?? null
  }

  handleAction(action) {
    if (action === 'ui:cover:prev' || action === 'ui:cover:next') {
      const step = action.endsWith('next') ? 1 : -1
      this.shiftCover(this.coverIndex + step)
      return null
    }
    if (action.startsWith('ui:cover:select:')) {
      const index = Number(action.slice('ui:cover:select:'.length))
      if (Number.isInteger(index) && index >= 0 && index < this.gameCovers.length) {
        this.coverIndex = index
        this.coverOffset = 0
        this.coverMotion = null
        this.setView('home')
        if (index !== 0)
          this.showUnavailableGame(index)
      }
      return null
    }
    if (action.startsWith('ui:cover:jump:')) {
      const index = Number(action.slice('ui:cover:jump:'.length))
      if (Number.isInteger(index) && index >= 0 && index < this.gameCovers.length)
        this.shiftCover(index)
      return null
    }
    if (action.startsWith('ui:tab:')) {
      this.setView(action.slice(7))
      return null
    }
    if (action.startsWith('ui:move:')) {
      this.navigate(action.slice(8))
      return null
    }
    if (action === 'ui:activate') {
      const selected = this.activate()
      return selected ? this.handleAction(selected) : null
    }
    if (action === 'ui:back') {
      if (this.ndsStatus === 'loading')
        return 'back'
      if (this.view !== 'home')
        this.setView('home')
      return null
    }
    if (action === 'ui:theme') {
      this.beginPageMotion(0, 320)
      this.theme = this.theme === 'light' ? 'dark' : 'light'
      this.drawGameHome()
      return null
    }
    if (action.startsWith('ui:game:play:')) {
      const index = Number(action.slice('ui:game:play:'.length))
      if (!Number.isInteger(index) || index < 0 || index >= this.gameCovers.length)
        return null
      if (index !== 0)
        return this.showUnavailableGame(index)
      return this.ndsStatus === 'loading' ? null : 'continue'
    }
    if (action === 'continue' || action === 'choose-file') {
      if (this.coverIndex !== 0)
        return this.showUnavailableGame(this.coverIndex)
      return this.ndsStatus === 'loading' ? null : action
    }
    if (action === 'replay-intro')
      return action
    return undefined
  }

  showUnavailableGame(index) {
    this.events.emit('game:unavailable', { index, message: '暂不可玩，目前仅开放第一款游戏。' })
    return null
  }

  drawGameHome() {
    this.bottomRegions = []
    this.topRegions = []
    this.focusables = []
    this.drawTop()
    this.drawBottom()
    if (this.pageMotion) {
      this.copyCanvas(this.topCanvas, this.motionToTop)
      this.copyCanvas(this.canvas, this.motionToBottom)
      const elapsed = performance.now() - this.pageMotion.start
      const progress = Math.min(1, elapsed / this.pageMotion.duration)
      this.paintPageMotion(this.easeInOutCubic(progress))
    }
    this.frameDirty = true
  }

  round(context, x, y, width, height, radius, fill) {
    context.beginPath()
    context.roundRect(x, y, width, height, radius)
    context.fillStyle = fill
    context.fill()
  }

  label(context, value, x, y, size, weight = 500, color = this.colors.ink, maxWidth) {
    context.font = `${weight} ${size}px ${FONT}`
    context.textAlign = 'left'
    context.fillStyle = color
    context.fillText(String(value), x, y, maxWidth)
  }

  short(context, value, width, size, weight = 700) {
    context.font = `${weight} ${size}px ${FONT}`
    const source = String(value)
    if (context.measureText(source).width <= width)
      return source
    let length = source.length
    while (length && context.measureText(`${source.slice(0, length)}…`).width > width) length--
    return `${source.slice(0, length)}…`
  }

  backdrop(context, width, height) {
    const gradient = context.createLinearGradient(0, 0, width, height)
    gradient.addColorStop(0, this.colors.start)
    gradient.addColorStop(1, this.colors.end)
    context.fillStyle = gradient
    context.fillRect(0, 0, width, height)
    context.save()
    context.globalAlpha = this.theme === 'light' ? 0.3 : 0.1
    context.fillStyle = '#ffffff'
    context.beginPath()
    context.ellipse(width * 0.73, height * 0.08, width * 0.48, height * 0.3, -0.2, 0, Math.PI * 2)
    context.fill()
    context.restore()
  }

  glass(context, x, y, width, height, radius = 36) {
    context.save()
    context.shadowColor = this.colors.shadow
    context.shadowBlur = 40
    context.shadowOffsetY = 17
    this.round(context, x, y, width, height, radius, this.colors.glass)
    context.restore()
    context.strokeStyle = this.colors.line
    context.lineWidth = 2
    context.beginPath()
    context.roundRect(x, y, width, height, radius)
    context.stroke()
  }

  art(context, x, y, width, height) {
    context.save()
    context.beginPath()
    context.roundRect(x, y, width, height, 38)
    context.clip()
    const sky = context.createLinearGradient(x, y, x + width, y + height)
    sky.addColorStop(0, '#191d48')
    sky.addColorStop(0.55, '#51569f')
    sky.addColorStop(1, '#f49a88')
    context.fillStyle = sky
    context.fillRect(x, y, width, height)
    const glow = context.createRadialGradient(x + width * 0.78, y + height * 0.36, 1, x + width * 0.78, y + height * 0.36, width * 0.38)
    glow.addColorStop(0, 'rgba(255,232,193,0.95)')
    glow.addColorStop(0.45, 'rgba(255,178,146,0.65)')
    glow.addColorStop(1, 'rgba(255,178,146,0)')
    context.fillStyle = glow
    context.fillRect(x, y, width, height)
    context.fillStyle = '#ffe3be'
    context.beginPath()
    context.arc(x + width * 0.78, y + height * 0.36, width * 0.095, 0, Math.PI * 2)
    context.fill()
    for (let layer = 0; layer < 3; layer++) {
      const base = y + height * (0.67 + layer * 0.1)
      context.fillStyle = ['#7180b5', '#415488', '#22315d'][layer]
      context.beginPath()
      context.moveTo(x, y + height)
      context.lineTo(x, base)
      for (let step = 0; step <= 10; step++) {
        context.lineTo(x + step * width / 10, base - Math.sin(step * 1.5 + layer) * height * (0.07 + layer * 0.008))
      }
      context.lineTo(x + width, y + height)
      context.fill()
    }
    context.fillStyle = 'rgba(255,255,255,0.8)'
    for (let index = 0; index < 24; index++) {
      context.beginPath()
      context.arc(x + width * ((index * 0.217 + 0.1) % 1), y + height * ((index * 0.383 + 0.07) % 0.56), index % 5 ? 1.5 : 2.5, 0, Math.PI * 2)
      context.fill()
    }
    const shade = context.createLinearGradient(x, y, x + width * 0.8, y)
    shade.addColorStop(0, 'rgba(12,22,54,0.9)')
    shade.addColorStop(1, 'rgba(12,22,54,0)')
    context.fillStyle = shade
    context.fillRect(x, y, width, height)
    // 自绘手柄轮廓让无 ROM 的首屏也能一眼识别为游戏入口。
    const padX = x + width * 0.69
    const padY = y + height * 0.64
    const padW = width * 0.2
    const padH = height * 0.16
    context.fillStyle = 'rgba(255,255,255,0.2)'
    context.strokeStyle = 'rgba(255,255,255,0.85)'
    context.lineWidth = 2
    context.beginPath()
    context.roundRect(padX, padY, padW, padH, padH * 0.45)
    context.fill()
    context.stroke()
    context.lineWidth = 5
    context.beginPath()
    context.moveTo(padX + padW * 0.27, padY + padH * 0.24)
    context.lineTo(padX + padW * 0.27, padY + padH * 0.76)
    context.moveTo(padX + padW * 0.16, padY + padH * 0.5)
    context.lineTo(padX + padW * 0.38, padY + padH * 0.5)
    context.stroke()
    for (const [offsetX, offsetY] of [[0.71, 0.38], [0.8, 0.61]]) {
      context.beginPath()
      context.arc(padX + padW * offsetX, padY + padH * offsetY, 5, 0, Math.PI * 2)
      context.fillStyle = '#ffffff'
      context.fill()
    }
    context.restore()
  }

  region(list, x, y, width, height, action) {
    list.push({ x, y, width, height, action })
  }

  focus(context, x, y, width, height, radius) {
    context.strokeStyle = this.theme === 'light' ? '#0878f6' : '#a7d4ff'
    context.lineWidth = 5
    context.beginPath()
    context.roundRect(x + 3, y + 3, width - 6, height - 6, radius)
    context.stroke()
  }

  button(context, x, y, width, height, text, action, style = 'white') {
    if (this.ndsStatus === 'loading' && (action === 'continue' || action === 'choose-file'))
      return
    this.round(context, x, y, width, height, height / 2, style === 'blue' ? '#1679e9' : this.colors.strong)
    this.label(context, `${text}  ›`, x + 31, y + height * 0.67, 27, 750, style === 'blue' ? '#ffffff' : (this.theme === 'light' ? '#174071' : '#ffffff'), width - 55)
    if (this.focusables.length === this.focusIndex)
      this.focus(context, x, y, width, height, height / 2)
    this.focusables.push(action)
    this.region(this.bottomRegions, x, y, width, height, action)
  }

  tile(context, x, y, width, height, icon, title, detail, action) {
    this.glass(context, x, y, width, height, 34)
    this.round(context, x + 23, y + (height - 76) / 2, 76, 76, 22, this.theme === 'light' ? '#deedff' : '#536c97')
    this.label(context, icon, x + 45, y + (height - 76) / 2 + 51, 34, 750, this.colors.accent)
    this.label(context, title, x + 120, y + (detail ? 66 : height / 2 + 10), 29, 750)
    if (detail)
      this.label(context, detail, x + 120, y + 103, 21, 500, this.colors.muted, width - 167)
    this.label(context, '›', x + width - 53, y + height / 2 + 13, 42, 500, this.colors.muted)
    if (this.focusables.length === this.focusIndex)
      this.focus(context, x, y, width, height, 34)
    this.focusables.push(action)
    this.region(this.bottomRegions, x, y, width, height, action)
  }

  drawReferenceBackdrop(context) {
    const background = context.createLinearGradient(0, 0, 1024, 1024)
    background.addColorStop(0, this.theme === 'light' ? '#b8c9eb' : '#121c38')
    background.addColorStop(0.52, this.theme === 'light' ? '#edf1fe' : '#293656')
    background.addColorStop(1, this.theme === 'light' ? '#fff3f0' : '#342c4b')
    context.fillStyle = background
    context.fillRect(0, 0, 1024, 1024)

    const panel = context.createLinearGradient(26, 78, 1000, 970)
    panel.addColorStop(0, this.theme === 'light' ? '#dbe8ff' : '#263f6d')
    panel.addColorStop(0.58, this.theme === 'light' ? '#eef0ff' : '#333b63')
    panel.addColorStop(1, this.theme === 'light' ? '#faf6ff' : '#403956')
    context.save()
    context.shadowColor = this.theme === 'light' ? 'rgba(94,109,167,0.22)' : 'rgba(0,0,0,0.4)'
    context.shadowBlur = 46
    context.shadowOffsetY = 26
    this.round(context, 23, 76, 978, 897, 80, panel)
    context.restore()
    context.save()
    context.beginPath()
    context.roundRect(23, 76, 978, 897, 80)
    context.clip()
    const coolGlow = context.createRadialGradient(210, 180, 50, 210, 180, 700)
    coolGlow.addColorStop(0, 'rgba(255,255,255,0.55)')
    coolGlow.addColorStop(1, 'rgba(255,255,255,0)')
    context.fillStyle = coolGlow
    context.fillRect(0, 0, 1024, 1024)
    context.restore()
    context.strokeStyle = 'rgba(255,255,255,0.95)'
    context.lineWidth = 4
    context.beginPath()
    context.roundRect(23, 76, 978, 897, 80)
    context.stroke()
  }

  spacedLabel(context, value, x, y, size, tracking, color) {
    context.font = `600 ${size}px ${FONT}`
    context.fillStyle = color
    context.textAlign = 'left'
    let cursor = x
    for (const letter of value) {
      context.fillText(letter, cursor, y)
      cursor += context.measureText(letter).width + tracking
    }
  }

  drawReferenceTile(context, { x, y, width, height, icon, chinese, english, action }) {
    const active = this.focusables.length === this.focusIndex
    const blue = context.createLinearGradient(x, y, x + width, y + height)
    blue.addColorStop(0, '#74b3ff')
    blue.addColorStop(0.47, '#2b69dc')
    blue.addColorStop(0.79, '#4f85ef')
    blue.addColorStop(1, '#9bdbf8')
    const pale = context.createLinearGradient(x, y, x + width, y + height)
    pale.addColorStop(0, this.theme === 'light' ? '#f5faff' : '#44577e')
    pale.addColorStop(0.52, this.theme === 'light' ? '#f9f9ff' : '#3b496f')
    pale.addColorStop(1, this.theme === 'light' ? '#f7f3fb' : '#50455f')
    context.save()
    context.shadowColor = active ? 'rgba(68,126,242,0.32)' : 'rgba(104,114,166,0.17)'
    context.shadowBlur = active ? 27 : 18
    context.shadowOffsetY = 12
    this.round(context, x, y, width, height, 52, active ? blue : pale)
    context.restore()
    context.save()
    context.beginPath()
    context.roundRect(x, y, width, height, 52)
    context.clip()
    // 参考图卡片中部的宽弧形光带是几何层，而非静态图片。
    context.beginPath()
    context.moveTo(x, y + height * 0.16)
    context.bezierCurveTo(
      x + width * 0.45,
      y + height * 0.66,
      x + width * 0.68,
      y + height * 0.79,
      x + width,
      y + height * 0.3,
    )
    context.lineTo(x + width, y + height)
    context.lineTo(x, y + height)
    context.closePath()
    context.fillStyle = active ? 'rgba(36,88,202,0.18)' : 'rgba(193,211,249,0.13)'
    context.fill()
    context.restore()
    context.strokeStyle = active ? '#e9ffff' : '#ffffff'
    context.lineWidth = 4
    context.beginPath()
    context.roundRect(x + 2, y + 2, width - 4, height - 4, 51)
    context.stroke()

    const iconColor = active ? '#ffffff' : '#668bd1'
    const centerX = x + width / 2
    const centerY = y + (height > 370 ? 0.39 : 0.38) * height
    if (icon === 'compass')
      this.drawCompassIcon(context, centerX, centerY, iconColor)
    if (icon === 'library')
      this.drawLibraryIcon(context, centerX, centerY)
    if (icon === 'map')
      this.drawMapIcon(context, centerX, centerY)
    if (icon === 'controller')
      this.drawControllerIcon(context, centerX, centerY)

    const textColor = active ? '#ffffff' : '#293248'
    const subColor = active ? '#d4eaff' : '#637696'
    this.label(context, chinese, x + 47, y + height - 81, 44, 780, textColor)
    this.spacedLabel(context, english, x + 48, y + height - 38, 22, 6, subColor)
    this.drawArrowCircle(context, x + width - 76, y + height - 80, active)
    this.focusables.push(action)
    this.region(this.bottomRegions, x, y, width, height, action)
  }

  drawArrowCircle(context, x, y, active) {
    context.save()
    context.shadowColor = active ? 'rgba(31,79,172,0.17)' : 'rgba(104,113,154,0.13)'
    context.shadowBlur = 16
    const fill = context.createLinearGradient(x - 40, y - 40, x + 40, y + 40)
    fill.addColorStop(0, active ? '#edf3ff' : '#ffffff')
    fill.addColorStop(1, active ? '#dce7ff' : '#f4f2fb')
    context.fillStyle = fill
    context.beginPath()
    context.arc(x, y, 42, 0, Math.PI * 2)
    context.fill()
    context.restore()
    context.strokeStyle = '#ffffff'
    context.lineWidth = 3
    context.beginPath()
    context.arc(x, y, 42, 0, Math.PI * 2)
    context.stroke()
    context.strokeStyle = '#3e5d9b'
    context.lineWidth = 6
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.beginPath()
    context.moveTo(x - 7, y - 14)
    context.lineTo(x + 7, y)
    context.lineTo(x - 7, y + 14)
    context.stroke()
  }

  drawCompassIcon(context, x, y, color) {
    context.save()
    context.strokeStyle = color
    context.lineWidth = 12
    context.beginPath()
    context.arc(x, y, 80, -Math.PI / 2 + 0.08, Math.PI / 2 - 0.08)
    context.stroke()
    context.beginPath()
    context.arc(x, y, 80, Math.PI / 2 + 0.08, Math.PI * 1.5 - 0.08)
    context.stroke()
    context.fillStyle = color
    context.beginPath()
    context.moveTo(x, y - 61)
    context.lineTo(x + 14, y - 15)
    context.lineTo(x + 61, y)
    context.lineTo(x + 14, y + 15)
    context.lineTo(x, y + 61)
    context.lineTo(x - 14, y + 15)
    context.lineTo(x - 61, y)
    context.lineTo(x - 14, y - 15)
    context.closePath()
    context.fill()
    context.fillStyle = color === '#ffffff' ? '#3c78df' : '#f6f9ff'
    context.beginPath()
    context.arc(x, y, 9, 0, Math.PI * 2)
    context.fill()
    context.restore()
  }

  drawLibraryIcon(context, x, y) {
    context.save()
    const gradient = context.createLinearGradient(x - 85, y - 80, x + 95, y + 80)
    gradient.addColorStop(0, '#5385dc')
    gradient.addColorStop(1, '#9eafd8')
    for (let layer = 0; layer < 3; layer++) {
      context.save()
      context.translate(x - 84 + layer * 17, y - 65 + layer * 18)
      context.rotate(-0.13)
      this.round(context, 0, 0, 145, 111, 22, gradient)
      context.strokeStyle = '#f5f8ff'
      context.lineWidth = 8
      context.beginPath()
      context.roundRect(0, 0, 145, 111, 22)
      context.stroke()
      context.restore()
    }
    context.restore()
  }

  drawMapIcon(context, x, y) {
    const gradient = context.createLinearGradient(x - 90, y - 80, x + 90, y + 80)
    gradient.addColorStop(0, '#8bbaff')
    gradient.addColorStop(1, '#a4b9e2')
    context.fillStyle = gradient
    const panels = [
      [[-81, -17], [-31, -34], [-31, 83], [-81, 101]],
      [[-26, -34], [25, -16], [25, 101], [-26, 83]],
      [[30, -16], [82, -34], [82, 83], [30, 101]],
    ]
    panels.forEach((points) => {
      context.beginPath()
      points.forEach(([px, py], index) => {
        if (index === 0)
          context.moveTo(x + px, y + py)
        else context.lineTo(x + px, y + py)
      })
      context.closePath()
      context.fill()
    })
    context.fillStyle = '#5c8fe5'
    context.strokeStyle = '#ffffff'
    context.lineWidth = 6
    context.beginPath()
    context.moveTo(x, y + 36)
    context.bezierCurveTo(x - 31, y + 8, x - 45, y - 12, x - 45, y - 37)
    context.arc(x, y - 37, 45, Math.PI, 0)
    context.bezierCurveTo(x + 45, y - 12, x + 31, y + 8, x, y + 36)
    context.closePath()
    context.fill()
    context.stroke()
    context.fillStyle = '#ffffff'
    context.beginPath()
    context.arc(x, y - 39, 12, 0, Math.PI * 2)
    context.fill()
  }

  drawControllerIcon(context, x, y) {
    const gradient = context.createLinearGradient(x - 110, y - 70, x + 110, y + 90)
    gradient.addColorStop(0, '#668ed9')
    gradient.addColorStop(1, '#8ba7d7')
    context.fillStyle = gradient
    context.beginPath()
    context.moveTo(x - 89, y - 44)
    context.bezierCurveTo(x - 108, y - 36, x - 123, y + 51, x - 105, y + 68)
    context.bezierCurveTo(x - 89, y + 87, x - 66, y + 63, x - 53, y + 46)
    context.lineTo(x + 52, y + 46)
    context.bezierCurveTo(x + 67, y + 65, x + 91, y + 86, x + 108, y + 66)
    context.bezierCurveTo(x + 124, y + 47, x + 107, y - 37, x + 88, y - 44)
    context.bezierCurveTo(x + 67, y - 54, x + 49, y - 39, x + 41, y - 32)
    context.lineTo(x - 41, y - 32)
    context.bezierCurveTo(x - 49, y - 39, x - 69, y - 54, x - 89, y - 44)
    context.fill()
    context.strokeStyle = '#ffffff'
    context.lineWidth = 11
    context.lineCap = 'round'
    context.beginPath()
    context.moveTo(x - 61, y - 14)
    context.lineTo(x - 61, y + 21)
    context.moveTo(x - 79, y + 3)
    context.lineTo(x - 43, y + 3)
    context.stroke()
    context.fillStyle = '#ffffff'
    for (const [dx, dy] of [[61, -16], [79, 1], [43, 1], [61, 18]]) {
      context.beginPath()
      context.arc(x + dx, y + dy, 7, 0, Math.PI * 2)
      context.fill()
    }
  }

  drawTop() {
    const c = this.topContext
    this.drawTopWallpaper(c)
    if (this.view === 'home' || this.view === 'media')
      this.drawTopCarousel(c)
    else if (this.view === 'library')
      this.drawTopLibrary(c)
    else this.drawTopInfo(c)
    if (this.view === 'home' || this.view === 'media')
      this.drawTopDots(c)
    this.drawTopNavigation(c)
  }

  drawTopWallpaper(context) {
    const reference = this.gameHomeReference
    const width = reference.width
    const height = reference.height
    const scale = 1400 / width
    const sky = context.createLinearGradient(0, 160, 0, 755)
    sky.addColorStop(0, '#bad3f6')
    sky.addColorStop(0.7, '#d4d8f2')
    sky.addColorStop(1, '#f5e4dd')
    context.fillStyle = sky
    context.fillRect(0, 0, 1400, 1000)
    // 仅复用参考图的天空和沙丘带，卡片与导航始终由可点击的 Canvas UI 绘制。
    context.drawImage(reference, 0, 0, width, 180, 0, 0, 1400, 180 * scale)
    context.drawImage(reference, 0, 745, width, height - 745, 0, 745 * scale, 1400, (height - 745) * scale)
    // 小范围采样沙丘纹理，擦去原图的三颗静态分页点。
    for (const x of [668, 700, 731]) {
      context.drawImage(reference, 620, 762, 26, 28, x - 11, 721, 22, 27)
    }
  }

  drawTopCover(context, image, x, y, width, height) {
    const scale = Math.max(width / image.width, height / image.height)
    const imageWidth = image.width * scale
    const imageHeight = image.height * scale
    context.save()
    context.shadowColor = 'rgba(49,59,102,0.2)'
    context.shadowBlur = 23
    context.shadowOffsetY = 14
    this.round(context, x, y, width, height, 39, '#ffffff')
    context.restore()
    context.save()
    context.beginPath()
    context.roundRect(x, y, width, height, 39)
    context.clip()
    context.drawImage(image, x + (width - imageWidth) / 2, y + (height - imageHeight) / 2, imageWidth, imageHeight)
    context.restore()
    context.strokeStyle = 'rgba(255,255,255,0.95)'
    context.lineWidth = 1.5
    context.beginPath()
    context.roundRect(x + 0.75, y + 0.75, width - 1.5, height - 1.5, 39)
    context.stroke()
  }

  getCoverAction(index = this.coverIndex) {
    // 封面携带自己的索引，滑动过程中点击也不会误启动相邻游戏；仅 game0 开放试玩。
    return `ui:game:play:${index}`
  }

  drawTopCarousel(context) {
    const reference = this.gameHomeReference
    // 这两条窄带还原卡片两侧的壁纸细节，主体始终是六张可切换的封面。
    context.drawImage(reference, 0, 180, 93, 565, 0, 170, 88, 533)
    context.drawImage(reference, 1125, 180, 19, 565, 1062, 170, 18, 533)
    const count = this.gameCovers.length
    const slots = []
    context.save()
    context.beginPath()
    context.rect(0, 150, 1400, 575)
    context.clip()
    const firstSlot = Math.floor((-974 - 88 - this.coverOffset) / COVER_PITCH)
    const lastSlot = Math.ceil((1400 - 88 - this.coverOffset) / COVER_PITCH)
    for (let slot = firstSlot; slot <= lastSlot; slot++) {
      const x = 88 + this.coverOffset + slot * COVER_PITCH
      const index = (this.coverIndex + slot % count + count) % count
      this.drawTopCover(context, this.gameCovers[index], x, 172, 974, 531)
      slots.push({ slot, x, index })
    }
    context.restore()
    const main = slots.reduce((best, item) => (
      Math.abs(item.x - 88) < Math.abs(best.x - 88) ? item : best
    ), slots[0])
    if (this.ndsStatus !== 'loading' && main) {
      this.addVisibleRegion(this.topRegions, main.x, 172, 974, 531, this.getCoverAction(main.index), 1400)
    }
    const next = slots.find(item => item.slot === (main?.slot ?? 0) + 1)
    if (next)
      this.addVisibleRegion(this.topRegions, next.x, 172, 974, 531, 'ui:cover:next', 1400)
  }

  drawTopLibrary(context) {
    const grid = { x: 88, y: 179, width: 386, height: 211, gapX: 30, gapY: 30 }
    this.gameCovers.forEach((image, index) => {
      const x = grid.x + (index % 3) * (grid.width + grid.gapX)
      const y = grid.y + Math.floor(index / 3) * (grid.height + grid.gapY)
      this.drawTopCover(context, image, x, y, grid.width, grid.height)
      this.region(this.topRegions, x, y, grid.width, grid.height, `ui:cover:select:${index}`)
    })
    this.label(context, '选择封面查看  ·  PageUp / PageDown 切换', 91, 682, 21, 600, '#476083')
  }

  drawTopInfo(context) {
    this.glass(context, 88, 172, 1224, 531, 40)
    const isMap = this.view === 'map'
    if (isMap)
      this.drawMapIcon(context, 370, 400)
    else this.drawControllerIcon(context, 370, 400)
    this.label(context, isMap ? '游戏地图' : '控制器已就绪', 610, 337, 57, 780)
    this.label(context, isMap ? '进入游戏后查看当前游戏的地图。' : '方向键选择  ·  Enter 确认', 614, 401, 28, 550, this.colors.muted)
    this.label(context, isMap ? '继续你的双屏冒险。' : 'PageUp / PageDown 切换游戏封面', 614, 446, 26, 500, this.colors.muted)
    this.round(context, 610, 533, 240, 82, 41, '#ffffff')
    this.label(context, isMap ? '继续游戏  ›' : '返回首页  ›', 649, 586, 27, 750, '#174071')
    this.region(this.topRegions, 610, 533, 240, 82, isMap ? 'continue' : 'ui:tab:home')
  }

  drawTopDots(context) {
    const start = 638
    this.gameCovers.forEach((_, index) => {
      const x = start + index * 25
      context.fillStyle = index === this.coverIndex ? '#ffffff' : 'rgba(255,255,255,0.55)'
      context.beginPath()
      context.arc(x, 735, 7, 0, Math.PI * 2)
      context.fill()
      this.region(this.topRegions, x - 12, 721, 24, 28, `ui:cover:jump:${index}`)
    })
  }

  drawTopNavigation(context) {
    const x = 294
    const y = 761
    const width = 812
    const height = 106
    const glass = context.createLinearGradient(x, y, x, y + height)
    glass.addColorStop(0, 'rgba(249,248,255,0.91)')
    glass.addColorStop(1, 'rgba(235,232,244,0.93)')
    context.save()
    context.shadowColor = 'rgba(83,78,126,0.15)'
    context.shadowBlur = 23
    context.shadowOffsetY = 10
    this.round(context, x, y, width, height, 53, glass)
    context.restore()
    context.strokeStyle = 'rgba(255,255,255,0.96)'
    context.lineWidth = 1.6
    context.beginPath()
    context.roundRect(x, y, width, height, 53)
    context.stroke()
    const tabs = [
      { x: 355, width: 207, label: 'Home', icon: 'home', view: 'home' },
      { x: 597, width: 218, label: 'Library', icon: 'library', view: 'library' },
      { x: 842, width: 217, label: 'Media', icon: 'media', view: 'media' },
    ]
    tabs.forEach((tab) => {
      const active = this.view === tab.view
      if (active) {
        context.save()
        context.shadowColor = 'rgba(82,94,134,0.12)'
        context.shadowBlur = 13
        context.shadowOffsetY = 4
        this.round(context, tab.x, y + 14, tab.width, 77, 39, '#ffffff')
        context.restore()
      }
      const color = active ? '#076de0' : '#687182'
      this.drawTopNavIcon(context, tab.icon, tab.x + 53, y + 52, color)
      this.label(context, tab.label, tab.x + 89, y + 65, 23, active ? 740 : 650, color)
      this.region(this.topRegions, tab.x, y + 10, tab.width, 85, `ui:tab:${tab.view}`)
    })
  }

  drawTopNavIcon(context, icon, x, y, color) {
    context.save()
    context.fillStyle = color
    if (icon === 'home') {
      context.beginPath()
      context.moveTo(x - 18, y - 3)
      context.lineTo(x, y - 20)
      context.lineTo(x + 18, y - 3)
      context.lineTo(x + 18, y + 17)
      context.quadraticCurveTo(x + 18, y + 21, x + 14, y + 21)
      context.lineTo(x + 5, y + 21)
      context.lineTo(x + 5, y + 6)
      context.lineTo(x - 5, y + 6)
      context.lineTo(x - 5, y + 21)
      context.lineTo(x - 14, y + 21)
      context.quadraticCurveTo(x - 18, y + 21, x - 18, y + 17)
      context.closePath()
      context.fill()
    }
    if (icon === 'library') {
      for (let row = 0; row < 2; row++) {
        for (let column = 0; column < 2; column++) {
          this.round(context, x - 19 + column * 22, y - 19 + row * 22, 18, 18, 5, color)
        }
      }
    }
    if (icon === 'media') {
      context.beginPath()
      context.arc(x, y, 21, 0, Math.PI * 2)
      context.fill()
      context.fillStyle = '#ffffff'
      context.beginPath()
      context.moveTo(x - 5, y - 10)
      context.lineTo(x + 10, y)
      context.lineTo(x - 5, y + 10)
      context.closePath()
      context.fill()
    }
    context.restore()
  }

  drawBottom() {
    const c = this.context
    this.drawReferenceBackdrop(c)
    if (this.view === 'home') {
      this.drawReferenceTile(c, {
        x: 54,
        y: 144,
        width: 451,
        height: 393,
        icon: 'compass',
        chinese: '继续冒险',
        english: 'CONTINUE',
        action: 'continue',
      })
      this.drawReferenceTile(c, {
        x: 519,
        y: 144,
        width: 455,
        height: 393,
        icon: 'library',
        chinese: '收藏库',
        english: 'LIBRARY',
        action: 'ui:tab:library',
      })
      this.drawReferenceTile(c, {
        x: 54,
        y: 555,
        width: 451,
        height: 353,
        icon: 'map',
        chinese: '地图',
        english: 'MAP',
        action: 'ui:tab:map',
      })
      this.drawReferenceTile(c, {
        x: 519,
        y: 555,
        width: 455,
        height: 353,
        icon: 'controller',
        chinese: '控制器',
        english: 'CONTROLLER',
        action: 'ui:tab:controller',
      })
      return
    }

    const titles = {
      library: ['收藏库', 'LIBRARY'],
      map: ['地图', 'MAP'],
      controller: ['控制器', 'CONTROLLER'],
      media: ['封面画廊', 'MEDIA'],
    }
    this.label(c, titles[this.view][0], 70, 183, 56, 780)
    this.spacedLabel(c, titles[this.view][1], 72, 221, 22, 6, this.colors.muted)
    this.label(c, 'ESC  返回主菜单', 731, 185, 23, 650, this.colors.muted)

    if (this.view === 'library') {
      this.glass(c, 60, 260, 904, 355, 48)
      this.art(c, 86, 286, 260, 303)
      this.label(c, '当前游戏', 383, 334, 24, 700, this.colors.muted)
      this.label(c, this.short(c, this.gameInfo.title, 520, 40, 760), 383, 398, 40, 760)
      this.label(c, this.short(c, this.displayStatus, 525, 23, 500), 383, 444, 23, 500, this.colors.muted)
      this.button(c, 383, 492, 307, 81, this.primaryLabel, 'continue', 'blue')
      this.tile(c, 60, 640, 904, 141, '▷', '游戏试玩', '目前仅开放第一款游戏', 'continue')
      this.tile(c, 60, 800, 904, 124, '⌂', '返回主菜单', '', 'ui:tab:home')
    }
    if (this.view === 'map') {
      this.glass(c, 60, 260, 904, 445, 48)
      this.drawMapIcon(c, 283, 440)
      this.label(c, '游戏内地图', 458, 365, 39, 760)
      this.label(c, '地图内容由当前 NDS 游戏提供。', 458, 418, 23, 500, this.colors.muted)
      this.label(c, '进入游戏后可在游戏中查看。', 458, 454, 23, 500, this.colors.muted)
      this.button(c, 458, 539, 318, 82, this.primaryLabel, 'continue', 'blue')
      this.tile(c, 60, 735, 904, 186, '⌂', '返回主菜单', '继续使用四宫格导航', 'ui:tab:home')
    }
    if (this.view === 'controller') {
      this.glass(c, 60, 260, 904, 430, 48)
      this.drawControllerIcon(c, 295, 426)
      this.label(c, '方向键', 487, 352, 24, 650, this.colors.muted)
      this.label(c, '移动 / 选择', 487, 390, 30, 750)
      this.label(c, 'X / Z  ·  S / A', 487, 456, 24, 650, this.colors.muted)
      this.label(c, 'A / B  ·  X / Y', 487, 494, 30, 750)
      this.label(c, 'ENTER 确认    ESC 返回', 487, 577, 22, 650, this.colors.muted)
      this.tile(c, 60, 719, 438, 203, '◐', '切换主题', this.theme === 'light' ? '日间 · 切至夜间' : '夜间 · 切至日间', 'ui:theme')
      this.tile(c, 517, 719, 447, 203, '↻', '重播装配', '再次观看产品动画', 'replay-intro')
    }
    if (this.view === 'media') {
      const width = 880
      const height = 471
      const pitch = 940
      const offset = this.coverOffset * (pitch / COVER_PITCH)
      const count = this.gameCovers.length
      c.save()
      c.beginPath()
      c.rect(36, 248, 952, 510)
      c.clip()
      const firstSlot = Math.floor((-width - 72 - offset) / pitch)
      const lastSlot = Math.ceil((1024 - 72 - offset) / pitch)
      for (let slot = firstSlot; slot <= lastSlot; slot++) {
        const x = 72 + offset + slot * pitch
        const index = (this.coverIndex + slot % count + count) % count
        this.drawTopCover(c, this.gameCovers[index], x, 268, width, height)
      }
      c.restore()
      this.tile(c, 60, 759, 438, 165, '‹', '上一张封面', '', 'ui:cover:prev')
      this.tile(c, 517, 759, 447, 165, '›', '下一张封面', '', 'ui:cover:next')
    }
  }

  addVisibleRegion(list, x, y, width, height, action, boundsWidth) {
    const left = Math.max(0, x)
    const right = Math.min(boundsWidth, x + width)
    if (right - left < 24)
      return
    this.region(list, left, y, right - left, height, action)
  }

  getActionAtUv(uv, surface = 'bottom') {
    if (!uv)
      return null
    const top = surface === 'top'
    const texture = top ? this.topTexture : this.texture
    const transformed = texture.transformUv((top ? this.topInteractionUv : this.bottomInteractionUv).copy(uv))
    // Canvas 2D 的 y 向下；transformUv 已包含旋转、镜像与 flipY。
    const x = transformed.x * (top ? 1400 : 1024)
    const y = transformed.y * (top ? 1000 : 1024)
    const regions = top ? this.topRegions : this.bottomRegions
    return regions.find(region => x >= region.x && x <= region.x + region.width
      && y >= region.y && y <= region.y + region.height)?.action ?? null
  }

  debugInit() {
    if (!this.debug.ui)
      return
    const folder = this.debug.ui.addFolder({ title: 'Controller Display' })
    const ranges = { brightness: [0, 2, 0.01], blurPixels: [0, 30, 1], scale: [1, 1.12, 0.005] }
    Object.entries(ranges).forEach(([key, [min, max, step]]) => {
      folder.addBinding(this.params, key, { label: key, min, max, step })
        .on('change', () => this.setTransitionProgress(this.transitionProgress))
    })
  }

  update() {
    const now = performance.now()
    let redrew = false
    if (this.coverMotion && !this.pageMotion) {
      const t = Math.min(1, (now - this.coverMotion.start) / this.coverMotion.duration)
      const eased = 1 - ((1 - t) ** 3)
      this.coverOffset = this.coverMotion.from * (1 - eased)
      if (t >= 1) {
        this.coverOffset = 0
        this.coverMotion = null
      }
      this.drawGameHome()
      redrew = true
    }
    if (this.pageMotion) {
      const t = Math.min(1, (now - this.pageMotion.start) / this.pageMotion.duration)
      if (t >= 1) {
        this.pageMotion = null
        this.drawGameHome()
      }
      else {
        this.paintPageMotion(this.easeInOutCubic(t))
      }
    }
    else if (!redrew) {
      const minute = Math.floor(Date.now() / 60000)
      if (minute !== this.lastDrawnMinute) {
        this.lastDrawnMinute = minute
        this.drawGameHome()
      }
    }
    if (!this.frameDirty)
      return
    this.texture.needsUpdate = true
    this.topTexture.needsUpdate = true
    this.frameDirty = false
  }

  destroy() {
    this.material.dispose()
    this.texture.dispose()
    this.topTexture.dispose()
    this.context = null
    this.topContext = null
    this.canvas = null
    this.topCanvas?.remove()
    this.topCanvas = null
    this.pageMotion = null
    this.coverMotion = null
    this.motionFromTop = null
    this.motionToTop = null
    this.motionFromBottom = null
    this.motionToBottom = null
  }
}
