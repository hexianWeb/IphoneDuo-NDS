import { NDS_HEIGHT, NDS_WIDTH } from './NDSRuntime.js'

export function getContainRect(width, height) {
  const scale = Math.min(width / NDS_WIDTH, height / NDS_HEIGHT)
  const contentWidth = NDS_WIDTH * scale
  const contentHeight = NDS_HEIGHT * scale
  return {
    x: (width - contentWidth) / 2,
    y: (height - contentHeight) / 2,
    width: contentWidth,
    height: contentHeight,
  }
}

export function getCoverRect(width, height, overscan = 1) {
  const scale = Math.max(width / NDS_WIDTH, height / NDS_HEIGHT) * overscan
  const contentWidth = NDS_WIDTH * scale
  const contentHeight = NDS_HEIGHT * scale
  return {
    x: (width - contentWidth) / 2,
    y: (height - contentHeight) / 2,
    width: contentWidth,
    height: contentHeight,
  }
}

export function getPixelCoverRect(width, height) {
  // 最小整数倍才能盖住目标画布；最近邻放大后每一格都是完整方块，不会插值发糊。
  const pixelSize = Math.max(1, Math.ceil(Math.max(width / NDS_WIDTH, height / NDS_HEIGHT)))
  const contentWidth = NDS_WIDTH * pixelSize
  const contentHeight = NDS_HEIGHT * pixelSize
  return {
    x: Math.round((width - contentWidth) / 2),
    y: Math.round((height - contentHeight) / 2),
    width: contentWidth,
    height: contentHeight,
    pixelSize,
  }
}

export function canvasUvToTouch(uv, width, height, rect) {
  const x = (uv.x * width - rect.x) / rect.width
  const y = (uv.y * height - rect.y) / rect.height
  // 黑边不产生触控，右/下边界也不能溢出到 256 / 192。
  if (x < 0 || x >= 1 || y < 0 || y >= 1)
    return null
  return { x: Math.floor(x * NDS_WIDTH), y: Math.floor(y * NDS_HEIGHT) }
}
