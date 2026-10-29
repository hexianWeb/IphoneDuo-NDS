import * as THREE from 'three/webgpu'

const KEY_ACTIONS = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyX: 'a',
  KeyZ: 'b',
  KeyS: 'x',
  KeyA: 'y',
  KeyQ: 'l',
  KeyW: 'r',
  Enter: 'start',
  ShiftLeft: 'select',
  ShiftRight: 'select',
}
const PAD_ACTIONS = {
  0: 'b',
  1: 'a',
  2: 'y',
  3: 'x',
  4: 'l',
  5: 'r',
  8: 'select',
  9: 'start',
  12: 'up',
  13: 'down',
  14: 'left',
  15: 'right',
}
const NAVIGATION_KEYS = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
}

export default class InputRouter {
  constructor({ camera, canvas, interactionSurfaces, exhibitSurfaces = [], resolveExhibitAction, onExhibitHover, resolvePointerAction, resolvePointerTouch, onAction, onGameButtons, onGameTouch, setOrbitGesture }) {
    this.camera = camera
    this.canvas = canvas
    this.interactionSurfaces = interactionSurfaces
    this.exhibitSurfaces = exhibitSurfaces
    this.resolveExhibitAction = resolveExhibitAction
    this.onExhibitHover = onExhibitHover
    this.resolvePointerAction = resolvePointerAction
    this.resolvePointerTouch = resolvePointerTouch
    this.onAction = onAction
    this.onGameButtons = onGameButtons
    this.onGameTouch = onGameTouch
    this.setOrbitGesture = setOrbitGesture
    this.raycaster = new THREE.Raycaster()
    this.pointer = new THREE.Vector2()
    this.homePadPrevious = new Map()
    this.keys = new Set()
    this.padActions = new Set()
    this.activeGamepads = []
    this.focused = document.hasFocus()
    this.listeners = new AbortController()
    const listen = (target, type, handler) => target.addEventListener(type, handler, { signal: this.listeners.signal })
    // 捕获阶段先于 OrbitControls：屏幕和配色样品都先锁住旋转，避免点击被拖拽抢走。
    const capture = { capture: true, signal: this.listeners.signal }
    canvas.addEventListener('pointerdown', event => this.holdOrbitForScreen(event), capture)
    // 松手可能发生在画布外；挂在 window 上才能把旋转交还。
    window.addEventListener('pointerup', event => this.releaseOrbitGesture(event), capture)
    window.addEventListener('pointercancel', event => this.releaseOrbitGesture(event), capture)
    listen(canvas, 'pointerdown', event => this.handlePointerDown(event))
    listen(canvas, 'pointermove', event => this.handlePointerMove(event))
    listen(canvas, 'pointerup', event => this.handlePointerUp(event))
    listen(canvas, 'pointercancel', () => this.clearPointer())
    listen(canvas, 'pointerleave', () => this.setHover(null))
    listen(canvas, 'lostpointercapture', (event) => {
      if (event.pointerId === this.pointerId || event.pointerId === this.homePointerId)
        this.clearPointer()
    })
    listen(window, 'keydown', event => this.handleKeyDown(event))
    listen(window, 'keyup', (event) => {
      this.keys.delete(event.code)
      this.publishButtons()
    })
    listen(window, 'blur', () => this.suspend())
    listen(window, 'focus', () => { this.focused = true })
    listen(document, 'visibilitychange', () => {
      if (document.hidden)
        this.suspend()
      else this.focused = document.hasFocus()
    })
    listen(window, 'pagehide', () => this.suspend())
    listen(document, 'focusin', (event) => {
      if (this.isEditableTarget(event.target))
        this.clearInputs()
    })
  }

  holdOrbitForScreen(event) {
    if (this.uiBlocked || event.button !== 0 || !this.hit(event))
      return
    this.setOrbitGesture(false)
  }

  releaseOrbitGesture(event) {
    if (event.buttons !== 0)
      return
    this.setOrbitGesture(true)
  }

  hit(event, surfaces = [...this.interactionSurfaces, ...(this.mode === 'game-home' ? this.exhibitSurfaces : [])]) {
    const visibleSurfaces = surfaces.filter((surface) => {
      for (let node = surface; node; node = node.parent) {
        if (!node.visible)
          return false
      }
      return true
    })
    if (!visibleSurfaces.length)
      return null
    const bounds = this.canvas.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0)
      return null
    this.pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    )
    visibleSurfaces.forEach(surface => surface.updateWorldMatrix(true, false))
    this.camera.updateWorldMatrix(true, false)
    this.raycaster.setFromCamera(this.pointer, this.camera)
    return this.raycaster.intersectObjects(visibleSurfaces, false)[0] ?? null
  }

  hitUv(event) {
    return this.hit(event, [this.interactionSurfaces[1]])?.uv ?? null
  }

  hitAction(event) {
    const intersection = this.hit(event)
    if (!intersection)
      return null
    if (this.interactionSurfaces.includes(intersection.object)) {
      return this.resolvePointerAction(intersection.uv, intersection.object)
    }
    return this.resolveExhibitAction?.(intersection) ?? null
  }

  handlePointerDown(event) {
    if (this.uiBlocked || this.launching || event.button !== 0 || this.pointerId != null || this.homePointerId != null)
      return
    if (this.mode === 'game-home') {
      const action = this.hitAction(event)
      if (!action)
        return
      event.preventDefault()
      this.canvas.focus({ preventScroll: true })
      this.homePointerId = event.pointerId
      this.homePressAction = action
      this.homePressPoint = { x: event.clientX, y: event.clientY }
      this.homeDragged = false
      this.canvas.setPointerCapture(event.pointerId)
      return
    }
    if (this.mode !== 'playing')
      return
    const point = this.resolvePointerTouch(this.hitUv(event))
    if (!point)
      return
    event.preventDefault()
    this.canvas.focus({ preventScroll: true })
    this.pointerId = event.pointerId
    this.canvas.setPointerCapture(event.pointerId)
    this.onGameTouch(point)
  }

  handlePointerMove(event) {
    if (this.uiBlocked || this.launching)
      return
    if (this.mode === 'game-home') {
      if (event.pointerId === this.homePointerId) {
        this.homeDragged ||= Math.hypot(event.clientX - this.homePressPoint.x, event.clientY - this.homePressPoint.y) > 8
      }
      const action = this.hitAction(event)
      this.setHover(action)
      return
    }
    if (event.pointerId !== this.pointerId || this.mode !== 'playing')
      return
    this.onGameTouch(this.resolvePointerTouch(this.hitUv(event)))
  }

  handlePointerUp(event) {
    if (event.pointerId === this.pointerId) {
      this.clearPointer()
      return
    }
    if (event.button !== 0 || event.pointerId !== this.homePointerId)
      return
    this.homePointerId = null
    const pressedAction = this.homePressAction
    const dragged = this.homeDragged || Math.hypot(event.clientX - this.homePressPoint.x, event.clientY - this.homePressPoint.y) > 8
    this.homePressAction = null
    this.homePressPoint = null
    if (this.canvas.hasPointerCapture(event.pointerId))
      this.canvas.releasePointerCapture(event.pointerId)
    if (this.uiBlocked || this.mode !== 'game-home' || dragged)
      return
    const action = this.hitAction(event)
    if (action && action === pressedAction) {
      event.preventDefault()
      this.dispatch(action, { userGesture: true })
    }
  }

  handleKeyDown(event) {
    if (this.uiBlocked || event.defaultPrevented)
      return
    if (event.code === 'Escape' && !event.repeat) {
      if (this.launching)
        this.dispatch('back')
      else if (this.mode === 'game-home')
        this.dispatch('ui:back')
      else this.dispatch('back')
      return
    }
    if (this.launching)
      return
    if (this.isEditableTarget(event.target))
      return
    if (this.mode === 'game-home') {
      const direction = NAVIGATION_KEYS[event.code]
      if (direction) {
        event.preventDefault()
        this.dispatch(`ui:move:${direction}`)
      }
      else if ((event.code === 'PageUp' || event.code === 'PageDown') && !event.repeat) {
        event.preventDefault()
        this.dispatch(event.code === 'PageUp' ? 'ui:cover:prev' : 'ui:cover:next')
      }
      else if ((event.code === 'Enter' || event.code === 'Space') && !event.repeat) {
        event.preventDefault()
        this.dispatch('ui:activate', { userGesture: true })
      }
      // Enter 只确认菜单。其余映射键从 Controller 锁上就开始压 3D 按键，不等进入游戏。
      if (KEY_ACTIONS[event.code] && event.code !== 'Enter' && !event.repeat) {
        event.preventDefault()
        this.keys.add(event.code)
        this.publishButtons()
      }
      return
    }
    if (this.mode !== 'playing' || !KEY_ACTIONS[event.code])
      return
    event.preventDefault()
    // 导航 Enter 的 repeat 不得变成游戏 Start；必须松开再按一次。
    if (event.repeat)
      return
    this.keys.add(event.code)
    this.publishButtons()
  }

  isEditableTarget(target) {
    return target instanceof HTMLElement
      && (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'SUMMARY'].includes(target.tagName))
  }

  dispatch(action, options) {
    this.onAction?.(action, options)
  }

  setMode(mode) {
    this.clearInputs()
    this.mode = mode
  }

  setHover(action) {
    this.canvas.style.cursor = action ? 'pointer' : ''
    this.onExhibitHover?.(action?.startsWith('theme:') ? action.slice(6) : null)
  }

  setUIBlocked(blocked) {
    this.uiBlocked = blocked
    if (blocked)
      this.clearInputs()
  }

  setLaunching(blocked) {
    if (this.launching === blocked)
      return
    this.launching = blocked
    if (blocked)
      this.clearInputs()
  }

  clearPointer() {
    const pointerId = this.pointerId
    const homePointerId = this.homePointerId
    this.pointerId = null
    this.homePointerId = null
    this.homePressAction = null
    this.homePressPoint = null
    this.homeDragged = false
    this.setHover(null)
    if (pointerId != null && this.canvas.hasPointerCapture(pointerId))
      this.canvas.releasePointerCapture(pointerId)
    if (homePointerId != null && this.canvas.hasPointerCapture(homePointerId))
      this.canvas.releasePointerCapture(homePointerId)
    this.onGameTouch(null)
    this.setOrbitGesture(true)
  }

  clearInputs() {
    this.keys.clear()
    this.padActions.clear()
    this.activeGamepads = []
    this.gamepadArmed = false
    this.navigationArmed = false
    this.homePadPrevious.clear()
    this.clearPointer()
    this.lastButtons = ''
    this.onGameButtons([])
  }

  suspend() {
    this.focused = false
    this.clearInputs()
    this.dispatch('suspend')
  }

  publishButtons() {
    if (this.mode !== 'playing' && this.mode !== 'game-home')
      return
    const actions = new Set([...this.keys].map(code => KEY_ACTIONS[code]))
    this.padActions.forEach(action => actions.add(action))
    const key = [...actions].sort().join(',')
    if (key === this.lastButtons)
      return
    this.lastButtons = key
    this.onGameButtons([...actions])
  }

  update() {
    if (this.uiBlocked || this.launching || !this.focused || document.hidden)
      return
    const gamepads = navigator.getGamepads?.() ?? []
    const connectedIndices = new Set()
    const actions = new Set()
    const activeGamepads = []

    for (const gamepad of gamepads) {
      if (!gamepad || gamepad.mapping !== 'standard')
        continue

      connectedIndices.add(gamepad.index)
      const padActions = new Set()
      Object.entries(PAD_ACTIONS).forEach(([index, action]) => {
        if (gamepad.buttons[index]?.pressed)
          padActions.add(action)
      })
      if (gamepad.axes[0] > 0.5)
        padActions.add('right')
      if (gamepad.axes[0] < -0.5)
        padActions.add('left')
      if (gamepad.axes[1] > 0.5)
        padActions.add('down')
      if (gamepad.axes[1] < -0.5)
        padActions.add('up')
      const previous = this.homePadPrevious.get(gamepad.index) ?? new Set()
      if (this.mode === 'game-home' && this.navigationArmed) {
        // 导航只在按下边沿触发，长按不会逐帧越过多个卡片。
        for (const direction of ['up', 'down', 'left', 'right']) {
          if (padActions.has(direction) && !previous.has(direction))
            this.dispatch(`ui:move:${direction}`)
        }
        if (padActions.has('l') && !previous.has('l'))
          this.dispatch('ui:cover:prev')
        if (padActions.has('r') && !previous.has('r'))
          this.dispatch('ui:cover:next')
        if (padActions.has('b') && !previous.has('b'))
          this.dispatch('ui:activate')
      }
      this.homePadPrevious.set(gamepad.index, padActions)
      padActions.forEach(action => actions.add(action))
      if (padActions.size > 0)
        activeGamepads.push(gamepad)
    }

    this.homePadPrevious.forEach((_, index) => {
      if (!connectedIndices.has(index))
        this.homePadPrevious.delete(index)
    })
    // Continue 使用的手柄按键须回到中立后才接管游戏，断开也会清空该来源的按键。
    if (actions.size === 0) {
      this.gamepadArmed = true
      this.navigationArmed = true
    }
    // Playing 要等启动键松开才把这帧交给模拟器；Game Home 立刻用于 3D 按键动画。
    const showController = this.mode === 'game-home' || (this.mode === 'playing' && this.gamepadArmed)
    this.padActions = showController ? actions : new Set()
    // 须在 publishButtons 之前更新：本帧的按下边沿会同步回调 rumble()，要震到正在按的那只手柄。
    this.activeGamepads = showController ? activeGamepads : []
    this.publishButtons()
  }

  // 只震动当前正在提供输入的手柄，纯键盘操作时不会惊动闲置在一旁的手柄。
  rumble(effect) {
    this.activeGamepads.forEach((gamepad) => {
      const actuator = gamepad.vibrationActuator
      if (!actuator || actuator.effects?.includes('dual-rumble') === false)
        return
      actuator.playEffect('dual-rumble', effect).catch(() => {})
    })
  }

  destroy() {
    this.listeners.abort()
    this.clearInputs()
    this.homePadPrevious.clear()
  }
}
