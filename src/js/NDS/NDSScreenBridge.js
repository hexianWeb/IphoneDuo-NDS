import { NDS_HEIGHT, NDS_WIDTH } from './NDSRuntime.js'

export default class NDSScreenBridge {
  constructor(topCanvas, bottomCanvas) {
    this.screens = [topCanvas, bottomCanvas].map((canvas) => {
      canvas.width = NDS_WIDTH
      canvas.height = NDS_HEIGHT
      const context = canvas.getContext('2d', { alpha: false })
      if (!context)
        throw new Error('无法创建 NDS 双屏 Canvas')
      return { canvas, context, image: context.createImageData(NDS_WIDTH, NDS_HEIGHT) }
    })
    this.version = 0
  }

  draw(pixels) {
    const screenBytes = NDS_WIDTH * NDS_HEIGHT * 4
    this.screens.forEach(({ context, image }, index) => {
      image.data.set(pixels.subarray(index * screenBytes, (index + 1) * screenBytes))
      context.putImageData(image, 0, 0)
    })
    this.version++
  }

  destroy() {
    this.screens.length = 0
  }
}
