import { gsap } from 'gsap'
import { uniform } from 'three/tsl'
import GameEntrySound from './GameEntrySound.js'
import { getScreenUvAspect } from './NDSGameSurface.js'

export default class GameEntryTransition {
  constructor(screen, debug) {
    this.aspect = getScreenUvAspect(screen)
    // UV 横纵单位的物理长度不同，半径按 V 的长度计，完全展开须覆盖屏幕对角线。
    this.fullRadius = Math.hypot(this.aspect, 1) * 0.5 + 0.025
    this.uniforms = { radius: uniform(this.fullRadius), aspect: uniform(this.aspect) }
    this.params = { closeDuration: 0.48, openDuration: 0.62 }
    this.generation = 0
    this.sound = new GameEntrySound()
    if (!debug?.ui)
      return
    this.folder = debug.ui.addFolder({ title: 'NDS Entry Transition', expanded: false })
    for (const key of ['closeDuration', 'openDuration']) {
      this.folder.addBinding(this.params, key, { min: 0.15, max: 1.5, step: 0.01 })
    }
  }

  close(options) {
    this.cancel()
    this.sound.unlock(options)
    return this.animate(false)
  }

  open() {
    return this.animate(true)
  }

  animate(opening) {
    if (this.destroyed)
      return Promise.resolve(false)
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const duration = reduced ? 0.08 : this.params[opening ? 'openDuration' : 'closeDuration']
    this.sound.play(opening, duration)
    return new Promise((resolve) => {
      this.resolve = resolve
      this.tween = gsap.to(this.uniforms.radius, {
        value: opening ? this.fullRadius : -0.015,
        duration,
        ease: opening ? 'power2.out' : 'power2.inOut',
        onComplete: () => {
          this.tween = null
          this.resolve = null
          resolve(true)
        },
      })
    })
  }

  cancel() {
    this.generation++
    this.tween?.kill()
    this.tween = null
    this.resolve?.(false)
    this.resolve = null
    this.uniforms.radius.value = this.fullRadius
    this.sound.stop()
  }

  destroy() {
    this.destroyed = true
    this.cancel()
    this.sound.destroy()
    this.folder?.dispose()
  }
}
