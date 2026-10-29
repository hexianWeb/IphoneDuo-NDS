import { float, mix, smoothstep, texture, uv, vec2 } from 'three/tsl'

export function screenIrisMask({ radius, aspect }) {
  // 使用原始 Mesh UV，纹理自身的旋转与镜像不改变遮罩的物理圆形。
  const distance = uv().sub(0.5).mul(vec2(aspect, 1)).length()
  return float(1).sub(smoothstep(radius.sub(0.004), radius.add(0.004), distance))
}

const BLUR_TAPS = [
  [-4, 0.03],
  [-3, 0.07],
  [-2, 0.12],
  [-1, 0.18],
  [0, 0.2],
  [1, 0.18],
  [2, 0.12],
  [3, 0.07],
  [4, 0.03],
]

function sampleScreen(textureValue, sampleUv, applyTextureMatrix) {
  const textureNode = texture(textureValue, sampleUv)
  // 传入自定义 UV 时 TextureNode 默认不乘 texture.matrix。
  // Game Mode 的旋转 / 镜像写在 Texture 上，采样时必须显式打开。
  if (applyTextureMatrix)
    textureNode.setUpdateMatrix(true)
  return textureNode
}

export function directionalBlur(
  textureValue,
  blurStep,
  uvNode = uv(),
  applyTextureMatrix = false,
) {
  let colorNode = sampleScreen(textureValue, uvNode, applyTextureMatrix).mul(0)

  BLUR_TAPS.forEach(([offset, weight]) => {
    const sampleUv = uvNode.add(vec2(blurStep.mul(offset), 0))
    colorNode = colorNode.add(
      sampleScreen(textureValue, sampleUv, applyTextureMatrix).mul(weight),
    )
  })

  return colorNode.rgb
}

export function foldedPhoneColor(
  textureValue,
  uniforms,
  applyFoldShade = false,
  baseUv = uv(),
  extraBlur = float(0),
) {
  const sampleUv = baseUv.add(vec2(uniforms.parallax, 0))
  let colorNode = directionalBlur(
    textureValue,
    uniforms.blur.add(extraBlur),
    sampleUv,
  )

  if (applyFoldShade) {
    // 阴影固定在屏幕铰链侧，模拟内容在翻页时被折痕逐步吞没。
    const leftEdge = float(1).sub(uv().x)
    const hingeEdge = mix(leftEdge, uv().x, uniforms.shadeSide)
    const hingeShade = hingeEdge.pow(3).mul(uniforms.shade)
    colorNode = colorNode.mul(float(1).sub(hingeShade))
  }

  return colorNode
}

export function gameChangerTopColor(phoneTexture, gameTexture, phoneUniforms, transitionUniforms) {
  const phoneUv = uv()
    .sub(0.5)
    .mul(transitionUniforms.phoneUvScale)
    .add(0.5)
  const phoneColor = foldedPhoneColor(
    phoneTexture,
    phoneUniforms,
    true,
    phoneUv,
    transitionUniforms.phoneBlur,
  )
  const gameUv = uv()
    .sub(0.5)
    .mul(transitionUniforms.gameUvScale)
    .add(0.5)
  const gameColor = directionalBlur(
    gameTexture,
    transitionUniforms.gameBlur,
    gameUv,
    true,
  )

  return mix(phoneColor, gameColor, transitionUniforms.progress)
}

export function controllerTransitionColor(controllerTexture, transitionUniforms) {
  const controllerUv = uv()
    .sub(0.5)
    .mul(transitionUniforms.controllerUvScale)
    .add(0.5)

  return directionalBlur(
    controllerTexture,
    transitionUniforms.controllerBlur,
    controllerUv,
    true,
  )
}
