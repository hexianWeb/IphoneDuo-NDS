import { float, Fn, mx_noise_float, normalView, positionView } from 'three/tsl'

// 高频细节小于像素时退回平均材质，避免镜头运动中产生颗粒闪烁。
export const filteredPlasticNoise = Fn(([coordinate]) => {
  const footprint = coordinate.dFdx().length().max(coordinate.dFdy().length())
  const visibility = float(1).sub(footprint.smoothstep(0.25, 0.75))
  return mx_noise_float(coordinate).mul(visibility)
})

// positionLocal 高度场不能交给基于 UV 重采样的 bumpMap。
// 用视空间曲面的余切基求高度梯度，height 必须与 positionView 使用相同长度单位。
export const plasticSurfaceNormal = Fn(([height]) => {
  const dx = positionView.dFdx().toVar()
  const dy = positionView.dFdy().toVar()
  const r1 = dy.cross(normalView).toVar()
  const r2 = normalView.cross(dx).toVar()
  const determinant = dx.dot(r1).toVar()
  const gradient = r1.mul(height.dFdx()).add(r2.mul(height.dFdy())).mul(determinant.sign()).div(determinant.abs().max(1e-12))
  return normalView.sub(gradient).normalize()
})
