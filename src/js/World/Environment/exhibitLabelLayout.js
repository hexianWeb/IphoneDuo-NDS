// 几何与离线 PNG 共用物理尺寸；仍按 1000 宽逻辑坐标绘制，避免换图改变排版或触控分区。
export const exhibitLabelLayout = {
  parts: { width: 0.61, height: 0.62, name: 'PartsLegend', cutout: true },
  dock: { width: 0.57, height: 0.065, name: 'ControllerThemesLegend' },
  plaque: { width: 0.268, height: 0.122, name: 'ProductPlaqueLabel' },
  internalLegend: { width: 0.83, height: 0.026, name: 'InternalComponentsLegend', anisotropy: 16 },
  internalNames: { width: 0.84, height: 0.031, name: 'InternalComponentNames', cutout: true, anisotropy: 16 },
  library: { width: 0.718, height: 0.039, name: 'GameLibraryLabel', anisotropy: 16 },
}

export const internalComponents = [
  { node: 'memory', label: 'Memory', x: -0.29, width: 0.105, depth: 0.225 },
  { node: 'bash', label: 'Mainboard', x: 0, width: 0.23, depth: 0.225 },
  { node: 'cpu', label: 'Processor', x: 0.29, width: 0.215, depth: 0.215 },
]

export const themeLabelLayout = { firstCenter: 622, gap: 145, hitMin: 550, hitMax: 985 }

// Classic 来自当前模型的已验收颜色；如果模型默认色或调参变化，Dock 会按需绘制而不显示过期色点。
export const themeLabelPresets = [
  { key: 'classic', label: 'Classic', shell: '#3e5f7c', buttons: '#eceaca', dpad: '#eceaca' },
  { key: 'retro', label: 'Retro', shell: '#d9d7d0', buttons: '#6c4f9e', dpad: '#34373c' },
  { key: 'midnight', label: 'Midnight', shell: '#272c32', buttons: '#e8743b', dpad: '#aab2ba' },
]

export const themeLabelVariantKeys = ['dock', 'dockRetro', 'dockMidnight']
export const labelAssetKeys = [...Object.keys(exhibitLabelLayout), ...themeLabelVariantKeys.slice(1)]

export function getLabelLayout(key) {
  return exhibitLabelLayout[themeLabelVariantKeys.includes(key) ? 'dock' : key]
}

export function getLabelImageSize({ width, height, resolution = 1024 }) {
  return { width: resolution, height: Math.max(Math.round(resolution / 8), Math.round(resolution * height / width)) }
}
