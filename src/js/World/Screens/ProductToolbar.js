import '../../../product-toolbar.css'

const ICONS = {
  play: '<path d="m8 5 11 7-11 7V5Z"/>',
  back: '<path d="m10 6-6 6 6 6M4 12h16"/>',
  replay: '<path d="M4 10a8 8 0 1 1 1 8M4 4v6h6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .6-1.5 1-1.5 2M12 16h.01"/>',
  skip: '<path d="m5 5 10 7-10 7V5ZM19 5v14"/>',
  cancel: '<path d="m6 6 12 12M18 6 6 18"/>',
  sound: '<path d="m11 5-6 4H2v6h3l6 4V5ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/>',
}

const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`

export default class ProductToolbar {
  constructor({ state, events, themes, canvas }) {
    this.state = state
    this.events = events
    this.themes = themes
    this.canvas = canvas
    this.nds = { loading: false, loaded: false, audioEnabled: false, audioBusy: false }
    this.listeners = new AbortController()
    this.element = document.createElement('section')
    this.element.className = 'product-toolbar'
    this.element.setAttribute('aria-label', '产品展示操作')
    this.element.innerHTML = `
      <div class="product-toolbar__surface">
        <div class="product-toolbar__identity"><span class="product-toolbar__wordmark">iPhone Duo</span><span class="product-toolbar__eyebrow">双屏，随你玩。</span></div>
        <div class="product-toolbar__themes" role="group" aria-label="Controller 配色">
          <span class="product-toolbar__eyebrow">选择你的配色</span>
          <div class="product-toolbar__swatches"></div>
        </div>
        <div class="product-toolbar__actions">
          <button class="product-toolbar__button product-toolbar__replay" type="button" data-action="replay-intro">${icon('replay')}<span>重播装配</span></button>
          <button class="product-toolbar__button product-toolbar__icon-button" type="button" data-action="help" aria-label="操作说明" title="操作说明">${icon('help')}</button>
          <button class="product-toolbar__button product-toolbar__icon-button" type="button" data-action="toggle-audio" aria-label="启用声音" title="启用声音" hidden>${icon('sound')}</button>
          <button class="product-toolbar__button product-toolbar__primary" type="button" data-action="primary"><span data-field="primary-icon">${icon('play')}</span><span data-field="primary-label">开始试玩</span></button>
        </div>
      </div>
      <p class="product-toolbar__note" role="status" aria-live="polite" aria-atomic="true"></p>`
    this.buttons = Object.fromEntries([...this.element.querySelectorAll('[data-action]')].map(node => [node.dataset.action, node]))
    this.themeGroup = this.element.querySelector('.product-toolbar__themes')
    this.note = this.element.querySelector('.product-toolbar__note')
    this.primaryIcon = this.element.querySelector('[data-field="primary-icon"]')
    this.primaryLabel = this.element.querySelector('[data-field="primary-label"]')
    this.notice = document.createElement('p')
    this.notice.className = 'product-toolbar__notice'
    this.notice.setAttribute('role', 'status')
    this.notice.setAttribute('aria-live', 'polite')
    this.notice.hidden = true
    this.element.append(this.notice)
    const swatches = this.element.querySelector('.product-toolbar__swatches')
    this.themeButtons = themes.map((theme) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'product-toolbar__swatch'
      button.dataset.theme = theme.key
      button.setAttribute('aria-label', `${theme.label} 配色`)
      button.innerHTML = '<span class="product-toolbar__color" aria-hidden="true"><i></i><i></i></span><span></span>'
      button.lastElementChild.textContent = theme.label
      button.addEventListener('click', () => events.emit('controller:theme-request', { key: theme.key }), { signal: this.listeners.signal })
      swatches.append(button)
      return button
    })
    this.createHelp()
    for (const [action, button] of Object.entries(this.buttons)) {
      button.addEventListener('click', () => this.handleAction(action), { signal: this.listeners.signal })
    }
    this.removeListeners = [
      ...['intro:state', 'product:mode', 'controller:theme', 'controller:themes-updated'].map(event => events.on(event, () => this.render())),
      events.on('nds:state', (info) => { this.nds = info; this.render() }),
      events.on('game:unavailable', ({ message }) => this.showNotice(message)),
      events.on('product:help-request', ({ trigger }) => this.openHelp(trigger)),
    ]
    document.body.append(this.element, this.help)
    this.render()
  }

  createHelp() {
    this.help = document.createElement('dialog')
    this.help.className = 'product-help'
    this.help.setAttribute('aria-labelledby', 'duo-help-title')
    this.help.innerHTML = `
      <div class="product-help__content">
        <div class="product-help__header"><span class="product-toolbar__eyebrow">iPhone Duo · 操作指南</span><button class="product-toolbar__button product-toolbar__icon-button" type="button" aria-label="关闭操作说明">${icon('cancel')}</button></div>
        <h2 id="duo-help-title">从展示到试玩</h2>
        <p class="product-help__intro">点击右侧样品或底栏切换配色；拖动场景空白处，小范围旋转查看产品。</p>
        <dl class="product-help__keys">
          <div><dt>菜单选择 / 确认</dt><dd>方向键 · <kbd>Enter</kbd></dd></div>
          <div><dt>游戏移动</dt><dd>方向键</dd></div>
          <div><dt>A / B 按键</dt><dd><kbd>X</kbd> / <kbd>Z</kbd></dd></div>
          <div><dt>X / Y 按键</dt><dd><kbd>S</kbd> / <kbd>A</kbd></dd></div>
          <div><dt>L / R 肩键</dt><dd><kbd>Q</kbd> / <kbd>W</kbd></dd></div>
          <div><dt>Start / Select</dt><dd><kbd>Enter</kbd> / <kbd>Shift</kbd></dd></div>
          <div><dt>暂停 / 返回展区</dt><dd><kbd>Esc</kbd></dd></div>
        </dl>
        <p class="product-help__detail">迷你触控笔会跟随鼠标；下屏支持左键点击和拖动触控，也可直接触屏或连接标准手柄。首次试玩按当前配置载入游戏，或选择本地 .nds 文件。</p>
        <p class="product-help__footnote">切换窗口会自动暂停；再次试玩可继续当前会话，刷新页面后会话不会保留。</p>
      </div>`
    const options = { signal: this.listeners.signal }
    this.help.querySelector('button').addEventListener('click', () => this.help.close(), options)
    this.help.addEventListener('click', (event) => {
      if (event.target === this.help)
        this.help.close()
    }, options)
    this.help.addEventListener('close', () => {
      this.events.emit('product:help', { open: false })
      // 页头与底栏共享同一说明弹窗，关闭后回到本次实际触发按钮。
      const target = this.helpTrigger?.isConnected ? this.helpTrigger : this.buttons.help
      target.focus({ preventScroll: true })
      this.helpTrigger = null
    }, options)
  }

  handleAction(action) {
    if (action === 'help') {
      this.openHelp()
      return
    }
    if (action === 'primary') {
      action = this.state.productMode === 'playing' || this.nds.loading
        ? 'back'
        : this.state.introState !== 'ready' ? 'skip-intro' : 'continue'
    }
    this.events.emit('product:action', { action, options: { userGesture: true } })
    if (action === 'replay-intro')
      this.canvas.focus({ preventScroll: true })
  }

  openHelp(trigger = this.buttons.help) {
    if (this.help.open)
      return
    this.helpTrigger = trigger
    // 模态说明打开前暂停游戏，并释放键盘、手柄与触控；关闭后由访客显式继续。
    if (this.state.productMode === 'playing' || this.nds.loading)
      this.events.emit('product:action', { action: 'back' })
    this.events.emit('product:help', { open: true })
    this.help.showModal()
  }

  showNotice(message) {
    clearTimeout(this.noticeTimer)
    this.notice.textContent = message
    this.notice.hidden = false
    this.noticeTimer = setTimeout(() => { this.notice.hidden = true }, 3600)
  }

  render() {
    const playing = this.state.productMode === 'playing'
    const intro = this.state.introState !== 'ready' && !playing
    this.element.hidden = !this.state.productMode
    this.element.dataset.mode = playing ? 'playing' : intro ? 'intro' : 'home'
    this.themeGroup.hidden = playing || intro
    this.buttons['replay-intro'].hidden = playing || intro
    this.buttons['toggle-audio'].hidden = !playing
    this.buttons['toggle-audio'].disabled = this.nds.audioBusy
    const audioLabel = this.nds.audioEnabled ? '静音' : '启用声音'
    this.buttons['toggle-audio'].setAttribute('aria-label', audioLabel)
    this.buttons['toggle-audio'].setAttribute('aria-pressed', String(Boolean(this.nds.audioEnabled)))
    this.buttons['toggle-audio'].title = audioLabel
    const primaryLabel = playing ? '返回展区' : intro ? '跳过动画' : this.nds.loading ? '取消启动' : this.nds.loaded ? '继续试玩' : '开始试玩'
    const primaryIcon = playing ? 'back' : intro ? 'skip' : this.nds.loading ? 'cancel' : 'play'
    if (this.primaryLabel.textContent !== primaryLabel) {
      this.primaryLabel.textContent = primaryLabel
      this.primaryIcon.innerHTML = icon(primaryIcon)
    }
    this.themeButtons.forEach((button, index) => {
      const theme = this.themes[index]
      button.setAttribute('aria-pressed', String(theme.key === this.state.controllerTheme))
      button.disabled = intro || playing || this.nds.loading
      const colors = button.querySelectorAll('i')
      colors[0].style.background = theme.shell
      colors[1].style.background = theme.buttons
    })
    this.note.textContent = this.nds.loading || this.state.ndsStatus === 'error'
      ? this.nds.message
      : playing
        ? '触控笔跟随鼠标 · 下屏点击或拖动 · Esc 暂停返回'
        : intro
          ? '展开 · 装配 · 双屏唤醒'
          : '点击样品切换配色 · 拖动空白区域旋转 · 点击屏幕操作'
  }

  destroy() {
    clearTimeout(this.noticeTimer)
    this.listeners.abort()
    this.removeListeners.forEach(remove => remove())
    this.events.emit('product:help', { open: false })
    this.help.close()
    this.help.remove()
    this.element.remove()
  }
}
