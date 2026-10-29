import { themeLabelLayout } from './exhibitLabelLayout.js'

// 与离线生成共用绘图定义；运行时仅自定义颜色/文字偏离预设时执行，不为常规切换创建 Canvas。
export function drawThemeLabelArtwork(ctx, themes, selectedTheme) {
  ctx.fillStyle = '#202c36'
  ctx.font = '800 46px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  ctx.fillText('Controller Themes', 30, 50)
  ctx.fillStyle = '#35414b'
  ctx.font = '700 27px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  ctx.fillText('02 / SHELL + BUTTONS', 30, 93)
  themes.forEach((theme, index) => {
    const x = themeLabelLayout.firstCenter + index * themeLabelLayout.gap
    for (const [dot, value] of [theme.shell, theme.buttons, theme.dpad].entries()) {
      ctx.fillStyle = value
      ctx.beginPath()
      ctx.arc(x + (dot - 1) * 26, 42, 11, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#b2b5b1'
      ctx.lineWidth = 1
      ctx.stroke()
    }
    ctx.fillStyle = '#25343f'
    ctx.textAlign = 'center'
    ctx.font = '700 28px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    ctx.fillText(theme.label, x, 92)
    if (theme.key === selectedTheme) {
      ctx.fillStyle = '#32668b'
      ctx.fillRect(x - 35, 103, 70, 4)
    }
  })
}
