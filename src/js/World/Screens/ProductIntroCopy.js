import '../../../product-intro-copy.css'

const FEATURES = [
  { title: '双屏扩展', description: '更大的游戏视野', icon: '<rect x="4" y="4.5" width="16" height="12" rx="2"/><path d="M2.5 20h19M8 16.5v3.5m8-3.5V20"/>' },
  { title: '模块化设计', description: '自由装配组合', icon: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Zm-8 4.5 8 4.5 8-4.5M12 12v9"/>' },
  { title: '丰富主题', description: '打造专属风格', icon: '<path d="M7.5 7h9c2.1 0 3.1 1.5 3.7 3.9l1.2 5.3c.5 2.2-1.7 3.5-3.2 2l-2.3-2.4H8.1l-2.3 2.4c-1.5 1.5-3.7.2-3.2-2l1.2-5.3C4.4 8.5 5.4 7 7.5 7Z"/><path d="M7 10v4m-2-2h4"/><circle cx="16" cy="10.5" r=".7"/><circle cx="18" cy="13" r=".7"/>' },
]

export default class ProductIntroCopy {
  constructor({ state, events }) {
    this.state = state
    this.loading = state.ndsStatus === 'loading'
    this.element = document.createElement('section')
    this.element.className = 'product-intro-copy'
    this.element.setAttribute('aria-labelledby', 'duo-intro-copy-title')
    this.element.innerHTML = `
      <p class="product-intro-copy__eyebrow">IPHONE DUO</p>
      <h1 class="product-intro-copy__title" id="duo-intro-copy-title"><span>双屏之间，</span><span class="product-intro-copy__accent">更多可能。</span></h1>
      <p class="product-intro-copy__description">展开视野，装上 Controller。<br>让熟悉的游戏，拥有新的玩法。</p>
      <ul class="product-intro-copy__features" aria-label="产品特点">
        ${FEATURES.map(feature => `<li class="product-intro-copy__feature">
          <span class="product-intro-copy__icon"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${feature.icon}</svg></span>
          <span class="product-intro-copy__feature-title">${feature.title}</span>
          <span class="product-intro-copy__feature-description">${feature.description}</span>
        </li>`).join('')}
      </ul>`
    this.removeListeners = [
      ...['intro:state', 'product:mode'].map(event => events.on(event, () => this.render())),
      events.on('nds:state', (info) => { this.loading = info.loading; this.render() }),
    ]
    document.body.append(this.element)
    this.render()
  }

  render() {
    this.element.hidden = this.state.introState !== 'ready' || this.state.productMode !== 'game-home' || this.loading
  }

  destroy() {
    this.removeListeners.forEach(remove => remove())
    this.element.remove()
  }
}
