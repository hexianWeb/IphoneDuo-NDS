import { float, mix, normalWorld, positionWorld, texture, vec3 } from 'three/tsl'

export function exhibitionFloorNodes(map, u) {
  const offset = positionWorld.xz.sub(u.center)
  const distance = offset.length()
  const top = normalWorld.y.smoothstep(0.9, 0.999)
  const cell = offset.div(u.gridSpacing)
  const footprint = cell.fwidth().max(0.00001)
  const edge = cell.add(0.5).fract().sub(0.5).abs()
  const halfLine = float(0.0015).div(u.gridSpacing)
  const lines = float(1).sub(edge.smoothstep(halfLine, footprint.mul(0.75).add(halfLine)))
  // 在亚像素网格出现前淡出，避免远处和掠射角下的摩尔纹；宽度包含屏幕导数。
  const gridFade = float(1).sub(footprint.x.max(footprint.y).smoothstep(0.12, 0.5)).mul(float(1).sub(distance.smoothstep(u.gridFade.mul(0.45), u.gridFade)))
  const grid = lines.x.max(lines.y).mul(gridFade).mul(u.gridOpacity).mul(top)
  const radial = offset.div(u.haloAxes).length()
  const halo = float(1).sub(radial.smoothstep(0.1, 1.55)).mul(u.haloStrength).mul(top)
  const ringWidth = u.ringWidth.add(radial.fwidth())
  const ring = float(1).sub(radial.sub(1).abs().smoothstep(u.ringWidth, ringWidth)).mul(u.ringStrength).mul(top)
  const base = u.tint.mul(mix(vec3(1), texture(map).rgb, 0.35))
  const highlighted = mix(base, u.haloColor, halo)
  return {
    color: highlighted.mul(float(1).sub(grid)),
    // 细环只是表面发光；宽渐变仍接受投影与 AO，不用透明贴片盖住接触阴影。
    emissive: u.ringColor.mul(ring),
  }
}
