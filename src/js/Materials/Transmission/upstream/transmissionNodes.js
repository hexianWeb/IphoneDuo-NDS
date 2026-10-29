import {
  abs,
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
  clamp,
  cross,
  dFdx,
  dFdy,
  DFGLUT,
  diffuseColor,
  dispersion,
  div,
  exp,
  float,
  Fn,
  int,
  interleavedGradientNoise,
  length,
  log,
  log2,
  Loop,
  max,
  metalness,
  mix,
  modelWorldMatrix,
  normalize,
  normalWorld,
  positionWorld,
  pow,
  refract,
  roughness,
  screenCoordinate,
  screenSize,
  select,
  specularColor,
  specularF90,
  triNoise3D,
  vec2,
  vec3,
  vec4,
  vogelDiskSample,
} from 'three/tsl'

const MAX_TRANSMISSION_SAMPLES = 16
const SPECTRAL_LOBE_WIDTH = 1.0
const PI2 = 6.28318530718

const spectralWeight = Fn(([t]) => {
  const x = t.mul(3.0)
  const lobeWidth = float(SPECTRAL_LOBE_WIDTH)
  const r = max(float(0), float(1).sub(abs(x.sub(0.5)).div(lobeWidth)))
  const g = max(float(0), float(1).sub(abs(x.sub(1.5)).div(lobeWidth)))
  const b = max(float(0), float(1).sub(abs(x.sub(2.5)).div(lobeWidth)))
  return vec3(r, g, b)
}).setLayout({
  name: 'spectralWeight',
  type: 'vec3',
  inputs: [{ name: 't', type: 'float' }],
})

const getVolumeTransmissionRay = Fn(
  ([n, v, thicknessVal, iorVal, modelMatrix]) => {
    const refractionVector = vec3(
      refract(v.negate(), normalize(n), div(1.0, iorVal)),
    )
    const modelScale = vec3(
      length(modelMatrix[0].xyz),
      length(modelMatrix[1].xyz),
      length(modelMatrix[2].xyz),
    )
    return normalize(refractionVector).mul(thicknessVal.mul(modelScale))
  },
).setLayout({
  name: 'getVolumeTransmissionRay',
  type: 'vec3',
  inputs: [
    { name: 'n', type: 'vec3' },
    { name: 'v', type: 'vec3' },
    { name: 'thicknessVal', type: 'float' },
    { name: 'iorVal', type: 'float' },
    { name: 'modelMatrix', type: 'mat4' },
  ],
})

const applyIorToRoughness = Fn(([roughnessVal, iorVal]) =>
  roughnessVal.mul(clamp(iorVal.mul(2.0).sub(2.0), 0.0, 1.0)),
).setLayout({
  name: 'applyIorToRoughness',
  type: 'float',
  inputs: [
    { name: 'roughnessVal', type: 'float' },
    { name: 'iorVal', type: 'float' },
  ],
})

const volumeAttenuation = Fn(
  ([transmissionDistance, attColor, attDistance]) => {
    const attenuationCoefficient = log(attColor).negate().div(attDistance)
    const transmittance = exp(
      attenuationCoefficient.negate().mul(transmissionDistance),
    )
    return select(attDistance.notEqual(0.0), transmittance, vec3(1.0))
  },
).setLayout({
  name: 'volumeAttenuation',
  type: 'vec3',
  inputs: [
    { name: 'transmissionDistance', type: 'float' },
    { name: 'attColor', type: 'vec3' },
    { name: 'attDistance', type: 'float' },
  ],
})

const refractionCoordsFor = Fn(
  ([
    n,
    v,
    iorVal,
    thicknessVal,
    position,
    modelMatrix,
    viewMatrix,
    projMatrix,
  ]) => {
    const transmissionRay = getVolumeTransmissionRay(
      n,
      v,
      thicknessVal,
      iorVal,
      modelMatrix,
    )
    const refractedRayExit = position.add(transmissionRay)
    const ndcPos = projMatrix.mul(viewMatrix.mul(vec4(refractedRayExit, 1.0)))
    const coords = vec2(ndcPos.xy.div(ndcPos.w)).toVar()
    coords.addAssign(1.0)
    coords.divAssign(2.0)
    coords.assign(vec2(coords.x, coords.y.oneMinus()))
    return coords
  },
)

// Width, in backdrop texels, of the area this pixel's refracted tap covers.
// `.level()` needs an explicit value here rather than relying on the GPU's
// own implicit derivative: that implicit path only sees a well-defined
// screen-space gradient outside of dynamic control flow, and inside the
// sample Loop below it produced garbage per-pixel LOD values — visible as
// speckle, worse than the flat mip-0 read it was meant to replace. Measuring
// it once here, before the loop, keeps the derivative in real uniform flow.
function backdropFootprintLod(coords) {
  const coordsPx = coords.mul(screenSize)
  const footprint = max(length(dFdx(coordsPx)), length(dFdy(coordsPx)))
  return log2(max(footprint, 1.0))
}

function createGetTransmissionSample(backdropTextureNode) {
  return Fn(([fragCoord, roughnessVal, iorVal, minLod]) => {
    // A single hardware trilinear tap instead of a bicubic reconstruction:
    // select() would evaluate both branches, so the bicubic cost was paid on
    // every sample even at roughness 0, where its result was discarded.
    const roughnessLod = applyIorToRoughness(roughnessVal, iorVal)
    const lod = max(log2(screenSize.x).mul(roughnessLod), minLod)
    return backdropTextureNode.sample(fragCoord).level(lod)
  })
}

function createRefractSample(getTransmissionSample) {
  return Fn(
    ([
      n,
      v,
      roughnessVal,
      iorVal,
      thicknessVal,
      position,
      modelMatrix,
      viewMatrix,
      projMatrix,
      minLod,
    ]) => {
      const coords = refractionCoordsFor(
        n,
        v,
        iorVal,
        thicknessVal,
        position,
        modelMatrix,
        viewMatrix,
        projMatrix,
      )

      return getTransmissionSample(coords, roughnessVal, iorVal, minLod)
    },
  )
}

export function createMtmVolumeRefraction(
  backdropTextureNode,
  uniforms,
  requestedSamples = 10,
  { spectral = false } = {},
) {
  // Baked into the loop bounds so unused iterations are not executed at all.
  // The uniform variant always ran MAX_TRANSMISSION_SAMPLES times and masked
  // the surplus with a multiply.
  const samples = Math.min(
    MAX_TRANSMISSION_SAMPLES,
    Math.max(1, Math.round(requestedSamples)),
  )

  const getTransmissionSample
    = createGetTransmissionSample(backdropTextureNode)
  const refractSample = createRefractSample(getTransmissionSample)

  return Fn(() => {
    const n = normalWorld
    const position = positionWorld
    const v = cameraPosition.sub(positionWorld).normalize()
    const roughnessVal = roughness
    const diffuse = diffuseColor
    const specColor = mix(specularColor, diffuseColor.rgb, metalness)
    const specF90 = specularF90
    const modelMatrix = modelWorldMatrix
    const viewMatrix = cameraViewMatrix
    const projMatrix = cameraProjectionMatrix
    const iorVal = uniforms.ior
    const thicknessVal = uniforms.thickness
    const attColor = uniforms.attenuationColor
    const attDistance = uniforms.attenuationDistance
    const sampleCount = float(samples)

    const transmissionAccum = vec3(0.0).toVar()
    const weightAccum = vec3(0.0).toVar()
    const randomCoords = interleavedGradientNoise(screenCoordinate.xy)
    const phi = interleavedGradientNoise(
      screenCoordinate.xy.add(vec2(17.0, 31.0)),
    ).mul(PI2)

    const thicknessSmear = thicknessVal.mul(
      max(pow(roughnessVal, 0.33), uniforms.anisotropicBlur),
    )

    const distortionAmt = uniforms.distortion
    const temporalOffset = vec3(
      uniforms.time,
      uniforms.time.negate(),
      uniforms.time.negate(),
    ).mul(uniforms.temporalDistortion)
    const noisePos = position.mul(uniforms.distortionScale).add(temporalOffset)
    const distortionNormal = distortionAmt.mul(
      vec3(
        triNoise3D(noisePos, float(0.2), uniforms.time),
        triNoise3D(noisePos.zxy, float(0.2), uniforms.time),
        triNoise3D(noisePos.yxz, float(0.2), uniforms.time),
      ),
    )

    // three.js PhysicalLightingModel dispersion — per-channel IOR spread
    const halfSpread = iorVal.sub(1.0).mul(dispersion.mul(0.025))
    const iorR = iorVal.sub(halfSpread)
    const iorG = iorVal
    const iorB = iorVal.add(halfSpread)

    // Measured once from the un-jittered geometric normal/thickness, in real
    // uniform control flow — see backdropFootprintLod for why this can't be
    // measured per sample inside the loop below.
    const refractionLod = backdropFootprintLod(
      refractionCoordsFor(
        n,
        v,
        iorVal,
        thicknessVal,
        position,
        modelMatrix,
        viewMatrix,
        projMatrix,
      ),
    )

    // Branchless orthonormal basis for roughness jitter — no mesh tangents needed.
    const basisUp = abs(n.z)
      .lessThan(0.999)
      .select(vec3(0.0, 0.0, 1.0), vec3(1.0, 0.0, 0.0))
    const tangent = normalize(cross(basisUp, n))
    const bitangent = cross(n, tangent)
    const roughnessScale = roughnessVal.mul(roughnessVal).mul(2.0)

    Loop(
      {
        start: 0,
        end: samples,
        type: 'float',
        condition: '<',
      },
      ({ i }) => {
        const disk = vogelDiskSample(int(i), int(samples), phi)
        const jitter = tangent.mul(disk.x).add(bitangent.mul(disk.y))

        const sampleNorm = normalize(
          n.add(roughnessScale.mul(jitter)).add(distortionNormal),
        )

        // Phase of the thickness-smear sweep. A white-noise hash here offsets
        // each pixel's backdrop tap by a couple of pixels at random, which
        // speckles high-contrast backdrops, so it uses an ordered dither.
        const sampleOffset = i.add(randomCoords).div(sampleCount)
        const sampleThickness = thicknessVal.add(
          thicknessSmear.mul(sampleOffset),
        )

        if (spectral) {
          // Every pixel walks the same stratified spectrum. Randomising the
          // phase per pixel trades banding for chroma noise, which reads as
          // coloured speckle against a high-contrast backdrop.
          const t = i.add(0.5).div(sampleCount)
          const iorT = mix(iorR, iorB, t)
          const w = spectralWeight(t)
          const sample = refractSample(
            sampleNorm,
            v,
            roughnessVal,
            iorT,
            sampleThickness,
            position,
            modelMatrix,
            viewMatrix,
            projMatrix,
            refractionLod,
          )

          transmissionAccum.addAssign(sample.rgb.mul(w))
          weightAccum.addAssign(w)
        }
        else {
          const sampleR = refractSample(
            sampleNorm,
            v,
            roughnessVal,
            iorR,
            sampleThickness,
            position,
            modelMatrix,
            viewMatrix,
            projMatrix,
            refractionLod,
          ).r

          const sampleG = refractSample(
            sampleNorm,
            v,
            roughnessVal,
            iorG,
            sampleThickness,
            position,
            modelMatrix,
            viewMatrix,
            projMatrix,
            refractionLod,
          ).g

          const sampleB = refractSample(
            sampleNorm,
            v,
            roughnessVal,
            iorB,
            sampleThickness,
            position,
            modelMatrix,
            viewMatrix,
            projMatrix,
            refractionLod,
          ).b

          transmissionAccum.addAssign(vec3(sampleR, sampleG, sampleB))
        }
      },
    )

    if (spectral) {
      transmissionAccum.divAssign(max(weightAccum, vec3(1e-4)))
    }
    else {
      transmissionAccum.divAssign(sampleCount)
    }

    const transmissionRay = getVolumeTransmissionRay(
      n,
      v,
      thicknessVal,
      iorVal,
      modelMatrix,
    )
    const attenuatedColor = diffuse
      .mul(volumeAttenuation(length(transmissionRay), attColor, attDistance))
      .mul(transmissionAccum)

    const dotNV = n.dot(v).clamp()
    const fab = DFGLUT({ dotNV, roughness: roughnessVal })
    const F = specColor.mul(fab.x).add(specF90.mul(fab.y))

    const rgb = F.oneMinus().mul(attenuatedColor)
    // Opaque backdrop buffer — matches three.js getIBLVolumeRefraction alpha (~1.0)
    return vec4(rgb.x, rgb.y, rgb.z, float(1.0))
  })
}

export function buildTransmissionBackdropNode(
  backdropTextureNode,
  uniforms,
  requestedSamples = 10,
  { spectral = false } = {},
) {
  if (!backdropTextureNode)
    return null

  const mtmVolumeRefraction = createMtmVolumeRefraction(
    backdropTextureNode,
    uniforms,
    requestedSamples,
    { spectral },
  )

  return mtmVolumeRefraction()
}
