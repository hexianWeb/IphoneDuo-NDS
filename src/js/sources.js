// Spike 资源按需加载，不进入产品首屏的 Resources.load()。
export const ndsSources = {
  core: '/vendor/pilas-melonds/pilas-melonds-core.js',
  wasm: '/vendor/pilas-melonds/pilas-melonds-core.wasm',
  audioWorklet: '/vendor/pilas-melonds/audio-worklet.js',
  // 临时演示：开发模式默认载入本地马里奥赛车。生产构建仍为 null，不打包 ROM。
  testRom: import.meta.env.DEV
    ? '/nds/Mario%20Kart%20DS%20(USA)%20(En,Fr,De,Es,It).nds'
    : null,
}

// optimized 副本由 scripts/optimize-textures.mjs 统一生成；原始大图留在 public 供重新加工。
export default [
  {
    name: 'iphoneModel',
    type: 'gltfModel',
    path: '/iphone.glb',
  },
  {
    name: 'rhyzomePlant',
    type: 'gltfModel',
    path: '/optimized/glb/rhyzome_plant.glb',
  },
  {
    name: 'airpodsModel',
    type: 'gltfModel',
    path: '/glb/airpods_pro.glb',
  },
  {
    name: 'controllerDetailModel',
    type: 'gltfModel',
    path: '/optimized/glb/detail.glb',
  },
  {
    name: 'controllerShellLightmap',
    type: 'exrTexture',
    // 原始烘焙保留；派生图在线性浮点域降采样，不经 PNG / sRGB 转换。
    path: '/optimized/lightmaps/controller-shell-1024.exr',
  },
  {
    name: 'stagePlasticColor',
    type: 'texture',
    path: '/texture/Plastic010_1K-JPG_Color.jpg',
  },
  {
    name: 'stagePlasticNormal',
    type: 'texture',
    path: '/texture/Plastic010_1K-JPG_NormalGL.jpg',
  },
  {
    name: 'stagePlasticRoughness',
    type: 'texture',
    path: '/texture/Plastic010_1K-JPG_Roughness.jpg',
  },
  {
    name: 'phoneHomeTexture',
    type: 'texture',
    path: '/optimized/img/phone-home.webp',
  },
  {
    name: 'gameHomeReference',
    type: 'texture',
    path: '/optimized/img/game-home-reference.webp',
  },
  {
    name: 'gameCardCover',
    type: 'texture',
    path: '/img/cover.png',
  },
  ...[2, 3, 4, 5].map(index => ({
    name: `gameCardCover${index}`,
    type: 'texture',
    path: `/img/cover${index}.png`,
  })),
  ...Array.from({ length: 6 }, (_, index) => ({
    name: `gameCover${index}`,
    type: 'texture',
    path: `/optimized/img/game${index}.webp`,
  })),
]
