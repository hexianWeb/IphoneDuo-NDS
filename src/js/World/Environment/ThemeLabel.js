import * as THREE from 'three/webgpu'
import ExhibitLabel from './ExhibitLabel.js'
import { exhibitLabelLayout, getLabelImageSize, themeLabelPresets } from './exhibitLabelLayout.js'
import { drawThemeLabelArtwork } from './themeLabelArtwork.js'

// 预设只切换预加载 PNG，不新增 shader/绘制/Canvas。自定义颜色才按需分配一个可复用画布。
export default class ThemeLabel extends ExhibitLabel {
  constructor({ textures, themes }) {
    super({ ...exhibitLabelLayout.dock, texture: textures[0] })
    const size = getLabelImageSize(exhibitLabelLayout.dock)
    if (textures.length !== 3 || textures.some(texture => !texture?.isTexture || texture.image?.width !== size.width || texture.image?.height !== size.height)) {
      throw new Error('ControllerThemesLegend 缺少三套离线选中状态纹理')
    }
    this.textures = textures
    textures.forEach((texture, index) => {
      texture.colorSpace = THREE.SRGBColorSpace
      texture.flipY = true
      texture.anisotropy = 8
      texture.name = `ControllerThemesLegend_Labels_${themeLabelPresets[index].key}`
    })
    this.selectedTheme = 'classic'
    this.setPalette(themes)
  }

  setPalette(themes) {
    if (themes.length !== 3 || themes.some((theme, index) => theme.key !== themeLabelPresets[index].key))
      throw new Error('Dock 标签需要原顺序的三套主题')
    const color = new THREE.Color()
    const palette = themes.map(theme => ({ ...theme, ...Object.fromEntries(['shell', 'buttons', 'dpad']
      .map(key => [key, `#${color.set(theme[key]).getHexString()}`])) }))
    const signature = JSON.stringify(palette)
    if (signature === this.signature)
      return
    this.signature = signature
    this.themes = palette
    this.usePreset = palette.every((theme, index) => ['key', 'label', 'shell', 'buttons', 'dpad'].every(key => theme[key] === themeLabelPresets[index][key]))
    this.updateTexture()
  }

  setSelectedTheme(key) {
    if (this.selectedTheme === key)
      return
    this.selectedTheme = key
    this.updateTexture()
  }

  updateTexture() {
    const index = themeLabelPresets.findIndex(theme => theme.key === this.selectedTheme)
    if (this.usePreset && index >= 0) {
      this.texture = this.textures[index]
      this.material.map = this.texture
      this.releaseCanvas()
      return
    }
    if (!this.canvas) {
      this.canvas = document.createElement('canvas')
      Object.assign(this.canvas, getLabelImageSize(exhibitLabelLayout.dock))
      this.context = this.canvas.getContext('2d')
      if (!this.context)
        throw new Error('自定义 Dock 标签需要 Canvas 2D')
      this.dynamicTexture = new THREE.CanvasTexture(this.canvas)
      this.dynamicTexture.name = 'ControllerThemesLegend_Custom_Labels'
      this.dynamicTexture.colorSpace = THREE.SRGBColorSpace
      this.dynamicTexture.anisotropy = 8
    }
    const ctx = this.context
    const height = 1000 * exhibitLabelLayout.dock.height / exhibitLabelLayout.dock.width
    ctx.setTransform(this.canvas.width / 1000, 0, 0, this.canvas.height / height, 0, 0)
    ctx.clearRect(0, 0, 1000, height)
    ctx.fillStyle = '#e7e3dc'
    ctx.fillRect(0, 0, 1000, height)
    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = 'left'
    drawThemeLabelArtwork(ctx, this.themes, this.selectedTheme)
    this.dynamicTexture.needsUpdate = true
    this.texture = this.dynamicTexture
    this.material.map = this.texture
  }

  releaseCanvas() {
    this.dynamicTexture?.dispose()
    if (this.canvas)
      this.canvas.width = this.canvas.height = 1
    this.dynamicTexture = null
    this.context = null
    this.canvas = null
  }

  destroy() {
    this.releaseCanvas()
    super.destroy()
  }
}
