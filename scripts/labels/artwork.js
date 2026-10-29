import { exhibitLabelLayout, getLabelImageSize, getLabelLayout, internalComponents, labelAssetKeys, themeLabelPresets, themeLabelVariantKeys } from '../../src/js/World/Environment/exhibitLabelLayout.js'
import { drawThemeLabelArtwork } from '../../src/js/World/Environment/themeLabelArtwork.js'

// 仅离线脚本引用；不进入产品 bundle，也不在用户设备上请求字体或创建标签 Canvas。
const uiFont = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
const painters = {
  parts(ctx, height) {
    ctx.fillStyle = '#f0eee7'
    for (const [x, y, width, h] of [[28, 20, 590, 65], [30, 647, 425, 115], [711, 372, 255, 116], [711, 787, 255, 153], [30, height - 72, 390, 50]]) {
      ctx.fillRect(x, y, width, h)
    }
    const text = (value, x, y, size, weight = 700, color = '#35414b') => {
      ctx.fillStyle = color
      ctx.font = `${weight} ${size}px ${uiFont}`
      ctx.fillText(value, x, y)
    }
    text('01 / COMPONENT STUDY', 44, 70, 40, 800)
    ctx.strokeStyle = '#c5c6c1'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(44, 100)
    ctx.lineTo(956, 100)
    ctx.moveTo(688, 150)
    ctx.lineTo(688, 880)
    ctx.stroke()
    text('Controller Shell', 46, 698, 44, 800, '#202c36')
    text('3D Printed', 46, 746, 32)
    text('D-Pad', 728, 424, 44, 800, '#202c36')
    text('3D Printed', 728, 472, 30)
    text('Button', 728, 833, 40, 800, '#202c36')
    text('Caps', 728, 878, 40, 800, '#202c36')
    text('3D Printed', 728, 924, 30)
    text('DUO / MODULAR INPUT', 46, height - 35, 28)
  },
  plaque(ctx) {
    ctx.fillStyle = '#476177'
    ctx.fillRect(48, 48, 70, 8)
    ctx.font = '700 40px sans-serif'
    ctx.fillText('DUO / PRODUCT STUDY', 145, 63)
    ctx.fillStyle = '#18232d'
    ctx.font = '800 132px sans-serif'
    ctx.fillText('iPhone Duo', 45, 222)
    ctx.font = '700 58px sans-serif'
    ctx.fillText('3D Printed Controller', 48, 302)
    ctx.fillStyle = '#354652'
    ctx.font = '700 46px sans-serif'
    ctx.fillText('GAME CHANGER', 48, 389)
  },
  internalLegend(ctx) {
    ctx.fillStyle = '#202c36'
    ctx.font = `800 24px ${uiFont}`
    ctx.fillText('Controller Inside', 18, 20)
    ctx.fillStyle = '#4a5660'
    ctx.font = `600 12px ${uiFont}`
    ctx.fillText('03 / INTERNAL COMPONENTS', 20, 29)
  },
  internalNames(ctx) {
    ctx.textAlign = 'center'
    ctx.fillStyle = '#26333e'
    ctx.font = `700 26px ${uiFont}`
    for (const component of internalComponents) ctx.fillText(component.label, (component.x / exhibitLabelLayout.internalNames.width + 0.5) * 1000, 27)
  },
  library(ctx) {
    ctx.fillStyle = '#202c36'
    ctx.font = `800 29px ${uiFont}`
    ctx.fillText('Game Library', 24, 36)
    ctx.fillStyle = '#6e7881'
    ctx.font = `600 15px ${uiFont}`
    ctx.textAlign = 'right'
    ctx.fillText('DUO COMPATIBLE', 970, 35)
  },
}

const backgrounds = { parts: null, plaque: '#edeae3', internalLegend: '#e8eaec', internalNames: null, library: '#e8eaec', dock: '#e7e3dc' }

export function drawLabelImage(key) {
  const layout = getLabelLayout(key)
  const dockIndex = themeLabelVariantKeys.indexOf(key)
  if (!layout || (dockIndex < 0 && !painters[key]))
    throw new Error(`未知标签：${key}`)
  const canvas = document.createElement('canvas')
  Object.assign(canvas, getLabelImageSize(layout))
  const ctx = canvas.getContext('2d')
  if (!ctx)
    throw new Error('离线标签生成需要 Canvas 2D')
  const height = 1000 * layout.height / layout.width
  ctx.setTransform(canvas.width / 1000, 0, 0, canvas.height / height, 0, 0)
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  const background = backgrounds[dockIndex < 0 ? key : 'dock']
  if (background) {
    ctx.fillStyle = background
    ctx.fillRect(0, 0, 1000, height)
  }
  if (dockIndex >= 0)
    drawThemeLabelArtwork(ctx, themeLabelPresets, themeLabelPresets[dockIndex].key)
  else painters[key](ctx, height)
  return canvas
}

export async function generateLabelImages() {
  // 显式等待本地字体准备；输出 PNG 后其它设备不再依赖字体安装情况。
  await Promise.all([document.fonts.load('800 46px "Segoe UI"'), document.fonts.load('600 15px "Segoe UI"'), document.fonts.load('800 132px Arial')])
  await document.fonts.ready
  return labelAssetKeys.map((key) => {
    const canvas = drawLabelImage(key)
    return { key, width: canvas.width, height: canvas.height, png: canvas.toDataURL('image/png').split(',')[1] }
  })
}
