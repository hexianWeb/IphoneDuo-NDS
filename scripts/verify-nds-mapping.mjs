import assert from 'node:assert/strict'
import * as THREE from 'three/webgpu'
import { canvasUvToTouch, getContainRect, getCoverRect, getPixelCoverRect } from '../src/js/NDS/screenMapping.js'
import NDSGameSurface, { getScreenUvAspect } from '../src/js/World/Screens/NDSGameSurface.js'

const screen = new THREE.Mesh(new THREE.PlaneGeometry(2, 1), new THREE.MeshBasicNodeMaterial())
screen.rotation.set(0.8, 1.2, 0.4)
screen.scale.set(3, 2, 1)
assert.ok(Math.abs(getScreenUvAspect(screen) - 3) < 1e-6, '比例必须保留旋转和非均匀缩放后的 UV 物理尺寸')

const wide = getContainRect(512, 192)
assert.deepEqual(wide, { x: 128, y: 0, width: 256, height: 192 })
assert.equal(canvasUvToTouch({ x: 0.1, y: 0.5 }, 512, 192, wide), null)
assert.deepEqual(canvasUvToTouch({ x: 0.5, y: 0.5 }, 512, 192, wide), { x: 128, y: 96 })
assert.equal(canvasUvToTouch({ x: 0.75, y: 0.5 }, 512, 192, wide), null)
const squareCover = getCoverRect(128, 128, 1)
assert.ok(Math.abs(squareCover.x + 64 / 3) < 1e-9)
assert.ok(Math.abs(squareCover.width - 512 / 3) < 1e-9)
assert.equal(squareCover.y, 0)
assert.equal(squareCover.height, 128)
const topPixels = getPixelCoverRect(512, 366)
assert.deepEqual(topPixels, { x: 0, y: -9, width: 512, height: 384, pixelSize: 2 })
const bottomPixels = getPixelCoverRect(512, 512)
assert.deepEqual(bottomPixels, { x: -128, y: -32, width: 768, height: 576, pixelSize: 3 })

// Canvas 像素输出由浏览器检查；此处验证真实 Three Texture 矩阵与触控的闭环。
globalThis.document = {
  createElement: () => ({ getContext: () => ({
    fillRect() {},
    drawImage() {},
    save() {},
    restore() {},
  }) }),
}
for (const options of [
  { flipY: false, mirrorX: false, aspect: 1.4 },
  { flipY: true, mirrorX: true, aspect: 1 },
]) {
  const surface = new NDSGameSurface(screen, options)
  assert.equal(surface.aspect, options.aspect)
  const inverse = surface.texture.matrix.clone().invert()
  for (const [x, y] of [[12, 23], [128, 96], [242, 180]]) {
    const canvasUv = new THREE.Vector2(
      (surface.rect.x + (x + 0.5) / 256 * surface.rect.width) / surface.canvas.width,
      (surface.rect.y + (y + 0.5) / 192 * surface.rect.height) / surface.canvas.height,
    )
    if (options.flipY)
      canvasUv.y = 1 - canvasUv.y
    const meshUv = canvasUv.applyMatrix3(inverse)
    assert.deepEqual(surface.getTouchAtUv(meshUv), { x, y })
  }
  const version = surface.texture.version
  surface.draw({})
  assert.equal(surface.texture.version, version + 1)
  assert.equal(surface.pixelRect.width % 256, 0)
  assert.equal(surface.pixelRect.height % 192, 0)
  assert.ok(surface.pixelRect.width >= surface.canvas.width)
  assert.ok(surface.pixelRect.height >= surface.canvas.height)
  surface.destroy()
}
delete globalThis.document
screen.geometry.dispose()
screen.material.dispose()
console.log('NDS physical aspect, letterbox rejection, mirrored/rotated touch mapping and frame dirty checks: passed')
