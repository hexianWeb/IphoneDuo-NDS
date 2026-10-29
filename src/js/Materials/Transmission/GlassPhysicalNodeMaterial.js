import { uniform } from 'three/tsl'
import { Color, FrontSide, MeshPhysicalNodeMaterial } from 'three/webgpu'
import { buildTransmissionBackdropNode } from './upstream/transmissionNodes.js'
import TransmissionPhysicalLightingModel from './upstream/TransmissionPhysicalLightingModel.js'

// 从 ektogamat 的 GlassMaterial.jsx 抽出非 React 生命周期；TSL 折射与光照模型保持上游实现。
export default class GlassPhysicalNodeMaterial extends MeshPhysicalNodeMaterial {
  constructor(backdropNode, params) {
    super({
      name: 'Parts_Transmission_Glass',
      color: params.boardColor,
      roughness: params.glassRoughness,
      ior: params.glassIor,
      transmission: 0,
      dispersion: params.glassDispersion,
      clearcoat: 1,
      clearcoatRoughness: 0.1,
      side: FrontSide,
      transparent: true,
      depthWrite: false,
      forceSinglePass: true,
    })
    this.isTransmissionGlassMaterial = true
    this.backdropTextureNode = backdropNode
    this.transmissionUniforms = {
      ior: uniform(params.glassIor),
      thickness: uniform(params.glassThickness),
      anisotropicBlur: uniform(params.glassBlur),
      attenuationDistance: uniform(1),
      attenuationColor: uniform(new Color('#ffffff')),
      distortion: uniform(0),
      distortionScale: uniform(0.3),
      temporalDistortion: uniform(0),
      time: uniform(0),
    }
    this.transmissionNode = uniform(params.glassTransmission)
    this.iorNode = this.transmissionUniforms.ior
    this.thicknessNode = this.transmissionUniforms.thickness
    this.attenuationDistanceNode = this.transmissionUniforms.attenuationDistance
    this.attenuationColorNode = this.transmissionUniforms.attenuationColor
    this.setSamples(params.glassSamples)
  }

  setupLightingModel() {
    return new TransmissionPhysicalLightingModel(
      this.useClearcoat,
      this.useSheen,
      this.useIridescence,
      this.useAnisotropy,
      this.useTransmission,
      this.transmissionBackdropNode,
    )
  }

  setSamples(value) {
    this.transmissionBackdropNode = buildTransmissionBackdropNode(this.backdropTextureNode, this.transmissionUniforms, value)
    this.needsUpdate = true
  }

  setOptics(params) {
    this.color.set(params.boardColor)
    this.roughness = params.glassRoughness
    this.dispersion = params.glassDispersion
    this.transmissionNode.value = params.glassTransmission
    this.transmissionUniforms.ior.value = params.glassIor
    // 上游会乘 modelWorldMatrix 的缩放；这里使用竖板自身的局部厚度，不能重复乘 W。
    this.transmissionUniforms.thickness.value = params.glassThickness
    this.transmissionUniforms.anisotropicBlur.value = params.glassBlur
  }
}
