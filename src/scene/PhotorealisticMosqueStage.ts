import mosqueMasterUrl from '../assets/images/mosque_scholars_broadcast_1795080562181.jpg';
import {
  LipSyncFrame,
  QueueEvent,
  ScholarAnimationSnapshot,
  ScholarId,
  ScholarSettingsConfig,
} from '../types/nuridua';
import {
  createIdleScholarAnimationSnapshot,
  resolveLiveScholarSnapshotAt,
} from '../services/scholarAnimationController';
import {
  createRestingLipSyncFrame,
  resolveStageScholarArticulation,
  type ScholarArticulationTargets,
  type StagePlaybackState,
} from '../services/turkishLipSync';
import {
  computeScholarArmGeometry,
  DEFAULT_SCHOLAR_PALETTES,
  renderScholarArmsAndHands,
  type ScholarArmGeometryResult,
  type ScholarPhotoTextures,
  type ScholarRigColors,
  type UVPoint,
  type UVToCanvasMapper,
} from './ScholarArmHandRenderer';

export {
  resolveStageScholarArticulation,
  type ScholarArticulationTargets,
  type StagePlaybackState,
};

export type CameraPreset = 'broadcast_portrait' | 'wide_mihrab' | 'scholar_closeup';

export interface PhotorealisticStageOptions {
  container: HTMLElement;
  scholarsConfig: ScholarSettingsConfig;
  cameraPreset: CameraPreset;
  onFallbackReady?: () => void;
}

interface ScholarMotionState {
  blinkProgress: number;
  nextBlinkAt: number;
  calmEye: number;
  jawOpen: number;
  lipRound: number;
  lipClose: number;
  lipSpread: number;
  lowerLipTuck: number;
  speakEnergy: number;
  headTurn: number;
  headNod: number;
  headTilt: number;
  handLift: number;
  handHide: number;
  shoulderLift: number;
  nextNodAt: number;
  nodPulse: number;
}

const IMAGE_WIDTH = 768;
const IMAGE_HEIGHT = 1376;
const IMAGE_ASPECT = IMAGE_WIDTH / IMAGE_HEIGHT;

const CAMERA_PRESETS: Record<CameraPreset, { zoom: number; panX: number; panY: number }> = {
  broadcast_portrait: { zoom: 1.06, panX: 0.0, panY: -0.012 },
  wide_mihrab: { zoom: 1.0, panX: 0.0, panY: 0.0 },
  scholar_closeup: { zoom: 1.38, panX: 0.0, panY: -0.045 },
};

const VERTEX_SHADER_SRC = `
  attribute vec2 aPos;
  varying vec2 vScreenUv;
  void main() {
    vScreenUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
    gl_Position = vec4(aPos, 0.0, 1.0);
  }
`;

const FRAGMENT_SHADER_SRC = `
  precision highp float;

  uniform sampler2D uTex;
  uniform float uContainerAspect;
  uniform float uImageAspect;
  uniform float uZoom;
  uniform vec2 uPan;
  uniform float uTime;

  // Per-scholar animation state (0 = scholar_1 left, 1 = scholar_2 right)
  // uMouthMorph[i] = vec4(jawOpen, lipRound, lipClose, lipSpread)
  uniform vec4 uMouthMorph[2];
  uniform float uLowerLipTuck[2];
  uniform float uBlink[2];
  uniform float uCalmEye[2];
  uniform float uBreath[2];
  uniform float uHeadTurn[2];
  uniform float uHeadNod[2];
  uniform float uHeadTilt[2];
  uniform float uHandLift[2];
  uniform float uHandHide[2];
  uniform float uShoulderLift[2];
  uniform float uSpeakEnergy[2];
  uniform vec3 uLidColor[2];

  varying vec2 vScreenUv;

  vec2 rotateAround(vec2 p, vec2 pivot, float angle) {
    vec2 d = p - pivot;
    d.x *= uImageAspect;
    float c = cos(angle);
    float s = sin(angle);
    vec2 r = vec2(d.x * c - d.y * s, d.x * s + d.y * c);
    r.x /= uImageAspect;
    return pivot + r;
  }

  float ellipseWeight(vec2 uv, vec2 center, vec2 radii, float featherStart) {
    vec2 d = (uv - center) / radii;
    float dist = length(d);
    return 1.0 - smoothstep(featherStart, 1.0, dist);
  }

  // Computes inverse warp & overlays for one scholar
  void applyScholarDeformation(
    inout vec2 uv,
    inout float oralShadow,
    inout float lipCrease,
    inout float upperTeethHint,
    inout vec4 lidOverlay,
    vec2 eyeL,
    vec2 eyeR,
    vec2 mouthC,
    vec2 headC,
    vec2 neckP,
    vec2 chestC,
    vec2 handL,
    vec2 handR,
    vec4 mouthMorph,
    float lowerLipTuck,
    float blink,
    float calmEye,
    float breath,
    float headTurn,
    float headNod,
    float headTilt,
    float handLift,
    float handHide,
    float shoulderLift,
    float speakEnergy,
    vec3 lidTint
  ) {
    float jawOpen = mouthMorph.x;
    float lipRound = mouthMorph.y;
    float lipClose = mouthMorph.z;
    float lipSpread = mouthMorph.w;

    // 1. Torso & shoulders breathing + gentle upper-arm engagement during dua hand lift
    float chestW = ellipseWeight(uv, chestC, vec2(0.185, 0.145), 0.25);
    if (chestW > 0.001) {
      float lift = breath * 0.0036 + speakEnergy * 0.0012 * sin(uTime * 3.1) + shoulderLift * 0.0028;
      float expand = breath * 0.0045 - shoulderLift * 0.0055;
      vec2 fromChest = uv - chestC;
      uv.y += chestW * lift;
      uv.x -= chestW * fromChest.x * expand;
    }

    // 2. Foreground hands & forearms subtle dua cadence when resting on thighs (suppressed once arms lift)
    float lapFade = 1.0 - smoothstep(0.05, 0.45, handHide);
    if (lapFade > 0.01) {
      float handLW = ellipseWeight(uv, handL, vec2(0.062, 0.055), 0.25);
      float handRW = ellipseWeight(uv, handR, vec2(0.062, 0.055), 0.25);
      if (handLW > 0.001) {
        float hMove = (handLift * 0.0062 + breath * 0.0016) * lapFade;
        uv.y += handLW * hMove;
        uv.x -= handLW * handLift * 0.0020 * lapFade;
      }
      if (handRW > 0.001) {
        float hMove = (handLift * 0.0060 + breath * 0.0016) * lapFade;
        uv.y += handRW * hMove;
        uv.x += handRW * handLift * 0.0020 * lapFade;
      }
    }

    // 3. Head, beard, face & takke rotation / nod / listener turn around neck pivot
    float headW = ellipseWeight(uv, headC, vec2(0.082, 0.102), 0.42);
    if (headW > 0.001) {
      vec2 rotated = rotateAround(uv, neckP, -headTilt);
      vec2 headDelta = rotated - uv;
      headDelta.y -= headNod * 0.0055 + breath * 0.0014;
      headDelta.x -= headTurn * 0.0050;
      uv += headW * headDelta;
    }

    // 4. Multi-viseme Turkish mouth, lip & jaw articulation
    if (jawOpen > 0.004 || lipRound > 0.004 || lipClose > 0.004 || lipSpread > 0.004 || lowerLipTuck > 0.004) {
      vec2 dMouth = uv - mouthC;
      float effJaw = jawOpen * (1.0 - lipClose * 0.94) * (1.0 - lowerLipTuck * 0.56);

      // 4a. Lip rounding & protrusion (O / Ö / U / Ü): pulls mouth corners inward and rounds lip ring
      if (lipRound > 0.004) {
        float roundW = ellipseWeight(uv, mouthC + vec2(0.0, 0.001), vec2(0.024, 0.017), 0.18);
        if (roundW > 0.001) {
          uv.x += roundW * dMouth.x * lipRound * 0.24;
          uv.y -= roundW * dMouth.y * lipRound * 0.07;
        }
      }

      // 4b. Unrounded horizontal spread (İ / I / E): gently widens mouth corners
      if (lipSpread > 0.004 && lipRound < 0.5) {
        float spreadW = ellipseWeight(uv, mouthC, vec2(0.024, 0.013), 0.2);
        if (spreadW > 0.001) {
          uv.x -= spreadW * dMouth.x * lipSpread * (1.0 - lipRound) * 0.14;
        }
      }

      // 4c. Bilabial closure (M / B / P): draws upper & lower lips smoothly together along seam
      if (lipClose > 0.004) {
        float sealW = ellipseWeight(uv, mouthC, vec2(0.0185, 0.0095), 0.14);
        if (sealW > 0.001) {
          float dirY = dMouth.y >= 0.0 ? 1.0 : -1.0;
          float pressAmt = min(abs(dMouth.y), 0.0055);
          uv.y += sealW * dirY * pressAmt * lipClose * 0.34;
          float seamLine = (1.0 - smoothstep(0.0004, 0.0022, abs(dMouth.y))) *
                           (1.0 - smoothstep(0.008, 0.015, abs(dMouth.x)));
          lipCrease = max(lipCrease, seamLine * lipClose);
        }
      }

      // 4d. Labiodental tuck (F / V): lifts lower lip subtly to upper teeth edge
      if (lowerLipTuck > 0.004) {
        float tuckW = ellipseWeight(uv, mouthC + vec2(0.0, 0.0042), vec2(0.018, 0.009), 0.18);
        if (tuckW > 0.001) {
          uv.y += tuckW * lowerLipTuck * 0.0026;
        }
      }

      // 4e. Upper lip subtle lift & lower jaw/beard vertical drop (open A / E / O)
      if (effJaw > 0.004) {
        float upperLift = ellipseWeight(uv, mouthC - vec2(0.0, 0.0042), vec2(0.016, 0.0075), 0.25);
        uv.y += upperLift * effJaw * 0.0014;

        float belowLip = smoothstep(-0.0014, 0.0020, dMouth.y);
        float jawW = ellipseWeight(uv, mouthC + vec2(0.0, 0.017), vec2(0.026, 0.032), 0.24) * belowLip;
        if (jawW > 0.001) {
          float jawDrop = effJaw * 0.0068;
          uv.y -= jawW * jawDrop;
          uv.x += jawW * dMouth.x * effJaw * 0.025;
        }
      }

      // 4f. Viseme-shaped oral cavity strictly tucked between parted lips (never overlapping white chin beard)
      float cavityW = 0.0084 * (1.0 - lipRound * 0.40 + lipSpread * 0.20) * (1.0 - lipClose * 0.65);
      float cavityH = (0.0003 + effJaw * 0.0023) * (1.0 - lipClose * 0.96) * (1.0 - lowerLipTuck * 0.55);
      if (cavityH > 0.0005 && lipClose < 0.85) {
        vec2 mCenter = mouthC + vec2(0.0, effJaw * 0.0007);
        vec2 mRadii = vec2(max(0.0042, cavityW), cavityH);
        float mDist = length((uv - mCenter) / mRadii);
        float openVis = smoothstep(0.06, 0.24, effJaw + lowerLipTuck * 0.32) * (1.0 - lipClose * 0.95);
        float cavity = (1.0 - smoothstep(0.32, 1.0, mDist)) * openVis;
        oralShadow = max(oralShadow, cavity);

        // Very subtle warm ivory hint right beneath the upper lip during open vowels or F/V
        if (cavity > 0.16 && (effJaw > 0.32 || lowerLipTuck > 0.28)) {
          float upperEdge = (1.0 - smoothstep(mCenter.y - mRadii.y * 0.85, mCenter.y - mRadii.y * 0.1, uv.y)) *
                            smoothstep(mCenter.y - mRadii.y * 1.05, mCenter.y - mRadii.y * 0.65, uv.y);
          float hintWeight = clamp(effJaw * 0.40 + lowerLipTuck * 0.80, 0.0, 1.0) * (1.0 - lipRound * 0.65);
          upperTeethHint = max(upperTeethHint, cavity * upperEdge * hintWeight * 0.16);
        }
      }
    }

    // 5. Natural eye blinking & calm reverent eyelid lowering during AMEEN / WIPING_FACE
    float effEyeClose = clamp(max(blink, calmEye * 0.86), 0.0, 1.0);
    if (effEyeClose > 0.01) {
      vec2 eyeRadii = vec2(0.0145, 0.0085);
      for (int e = 0; e < 2; e++) {
        vec2 ec = (e == 0) ? eyeL : eyeR;
        vec2 ed = (uv - ec) / eyeRadii;
        float eDist = length(ed);
        if (eDist < 1.15) {
          float lidBottomY = ec.y - eyeRadii.y * 0.85 + effEyeClose * eyeRadii.y * 1.62;
          if (uv.y <= lidBottomY) {
            float edgeFeather = 1.0 - smoothstep(0.75, 1.12, eDist);
            float bottomCrease = smoothstep(lidBottomY - 0.0022, lidBottomY, uv.y);
            vec2 skinSampleUv = vec2(
              uv.x,
              ec.y - eyeRadii.y * 1.25 - max(0.0, lidBottomY - uv.y) * 0.35
            );
            vec3 sampledSkin = texture2D(uTex, skinSampleUv).rgb;
            vec3 lidCol = mix(sampledSkin, lidTint, 0.22) * (0.94 - bottomCrease * 0.24);
            float alpha = edgeFeather * smoothstep(0.02, 0.22, effEyeClose);
            if (alpha > lidOverlay.a) {
              lidOverlay = vec4(lidCol, alpha);
            }
          }
        }
      }
    }
  }

  float superEllipseWeight(vec2 uv, vec2 center, vec2 radii, float featherStart) {
    vec2 d = abs((uv - center) / radii);
    float dist = pow(pow(d.x, 3.0) + pow(d.y, 3.0), 1.0 / 3.0);
    return 1.0 - smoothstep(featherStart, 1.0, dist);
  }

  // Seamlessly replaces resting lap hand + fingertip pixels with strictly verified pure navy trouser wool
  // sampled strictly below maxSkinY on each thigh (zero risk of grabbing fingertips, cuffs, or wooden armrests).
  void applyRestingHandTrouserFill(
    inout vec3 color,
    vec2 sampleUv,
    vec2 handL,
    vec2 handR,
    vec2 radiiL,
    vec2 radiiR,
    vec4 cleanBoxL, // (minU, maxU, minV, maxV)
    vec4 cleanBoxR,
    float hideAmt
  ) {
    if (hideAmt <= 0.005) return;

    float wL = superEllipseWeight(sampleUv, handL, radiiL, 0.72);
    if (wL > 0.005) {
      float boxHL = max(0.01, cleanBoxL.w - cleanBoxL.z);
      float triVL = abs(fract((sampleUv.y - cleanBoxL.z) / boxHL * 0.5) * 2.0 - 1.0);
      float u1L = clamp(sampleUv.x, cleanBoxL.x, cleanBoxL.y);
      float v1L = mix(cleanBoxL.z, cleanBoxL.w, triVL);
      vec3 trouserL = texture2D(uTex, vec2(u1L, v1L)).rgb;
      float crownL = smoothstep(handL.y + radiiL.y, handL.y - radiiL.y * 0.5, sampleUv.y);
      trouserL *= (1.0 + crownL * 0.07);
      color = mix(color, trouserL, clamp(wL * 1.05, 0.0, 1.0) * hideAmt);
    }

    float wR = superEllipseWeight(sampleUv, handR, radiiR, 0.72);
    if (wR > 0.005) {
      float boxHR = max(0.01, cleanBoxR.w - cleanBoxR.z);
      float triVR = abs(fract((sampleUv.y - cleanBoxR.z) / boxHR * 0.5) * 2.0 - 1.0);
      float u1R = clamp(sampleUv.x, cleanBoxR.x, cleanBoxR.y);
      float v1R = mix(cleanBoxR.z, cleanBoxR.w, triVR);
      vec3 trouserR = texture2D(uTex, vec2(u1R, v1R)).rgb;
      float crownR = smoothstep(handR.y + radiiR.y, handR.y - radiiR.y * 0.5, sampleUv.y);
      trouserR *= (1.0 + crownR * 0.07);
      color = mix(color, trouserR, clamp(wR * 1.05, 0.0, 1.0) * hideAmt);
    }
  }

  void main() {
    // Cover-fit image cleanly inside container aspect ratio
    vec2 centered = vScreenUv - 0.5;
    if (uContainerAspect > uImageAspect) {
      centered.y *= (uImageAspect / uContainerAspect);
    } else {
      centered.x *= (uContainerAspect / uImageAspect);
    }

    // Apply smooth camera preset zoom & pan with subtle camera breathing
    float camBreath = sin(uTime * 0.55) * 0.0014;
    vec2 baseUv = centered / (uZoom + camBreath) + 0.5 + uPan;

    // 2.5D subtle depth parallax between background mosque & foreground scholars
    float bgWeight = 1.0 - smoothstep(0.30, 0.50, baseUv.y);
    baseUv -= uPan * (bgWeight * 0.22);

    vec2 uv = clamp(baseUv, vec2(0.001), vec2(0.999));
    float oralShadow = 0.0;
    float lipCrease = 0.0;
    float upperTeethHint = 0.0;
    vec4 lidOverlay = vec4(0.0);

    // Scholar 1 (Left: Haci Ahmet Efendi)
    applyScholarDeformation(
      uv,
      oralShadow,
      lipCrease,
      upperTeethHint,
      lidOverlay,
      vec2(0.2448, 0.4041), // left eye
      vec2(0.2969, 0.4041), // right eye
      vec2(0.2721, 0.4384), // symmetric center of lip line
      vec2(0.2708, 0.4080), // head center
      vec2(0.2708, 0.4724), // neck pivot
      vec2(0.2695, 0.5450), // chest center
      vec2(0.1450, 0.6380), // left hand center
      vec2(0.3520, 0.6280), // right hand center
      uMouthMorph[0],
      uLowerLipTuck[0],
      uBlink[0],
      uCalmEye[0],
      uBreath[0],
      uHeadTurn[0],
      uHeadNod[0],
      uHeadTilt[0],
      uHandLift[0],
      uHandHide[0],
      uShoulderLift[0],
      uSpeakEnergy[0],
      uLidColor[0]
    );

    // Scholar 2 (Right: Haci Mehmet Efendi)
    applyScholarDeformation(
      uv,
      oralShadow,
      lipCrease,
      upperTeethHint,
      lidOverlay,
      vec2(0.7188, 0.3975), // left eye
      vec2(0.7734, 0.3975), // right eye
      vec2(0.7445, 0.4336), // symmetric center of lip line
      vec2(0.7455, 0.4010), // head center
      vec2(0.7455, 0.4666), // neck pivot
      vec2(0.7435, 0.5400), // chest center
      vec2(0.6350, 0.6280), // left hand center
      vec2(0.8620, 0.6340), // right hand center
      uMouthMorph[1],
      uLowerLipTuck[1],
      uBlink[1],
      uCalmEye[1],
      uBreath[1],
      uHeadTurn[1],
      uHeadNod[1],
      uHeadTilt[1],
      uHandLift[1],
      uHandHide[1],
      uShoulderLift[1],
      uSpeakEnergy[1],
      uLidColor[1]
    );

    vec2 clampedUv = clamp(uv, vec2(0.001), vec2(0.999));
    vec3 color = texture2D(uTex, clampedUv).rgb;

    // Cleanly replace entire resting lap hand + fingertip zone strictly from skin-free lower-thigh cloth bands
    applyRestingHandTrouserFill(
      color,
      clampedUv,
      vec2(0.1320, 0.6380),
      vec2(0.3520, 0.6300),
      vec2(0.078, 0.049),
      vec2(0.074, 0.049),
      vec4(0.105, 0.190, 0.682, 0.706),
      vec4(0.305, 0.390, 0.680, 0.704),
      uHandHide[0]
    );
    applyRestingHandTrouserFill(
      color,
      clampedUv,
      vec2(0.6320, 0.6290),
      vec2(0.8700, 0.6380),
      vec2(0.080, 0.049),
      vec2(0.098, 0.058),
      vec4(0.590, 0.680, 0.680, 0.704),
      vec4(0.795, 0.870, 0.682, 0.706),
      uHandHide[1]
    );

    // Blend eyelid skin cleanly when blinking
    if (lidOverlay.a > 0.001) {
      color = mix(color, lidOverlay.rgb, lidOverlay.a);
    }

    // Subtle sealed lip contact crease during bilabial M/B/P stops
    if (lipCrease > 0.005) {
      color *= (1.0 - lipCrease * 0.14);
    }

    // Blend warm shaded oral cavity cleanly between parted lips
    if (oralShadow > 0.005) {
      vec3 cavityColor = vec3(0.19, 0.095, 0.085);
      color = mix(color, cavityColor, oralShadow * 0.66);
      if (upperTeethHint > 0.003) {
        vec3 warmIvory = vec3(0.78, 0.72, 0.64);
        color = mix(color, warmIvory, upperTeethHint);
      }
    }

    // Subtle warm chandelier & daylight atmospheric breathing near upper mihrab/chandelier
    float warmZone = (1.0 - smoothstep(0.05, 0.42, baseUv.y)) * smoothstep(0.35, 0.88, baseUv.x);
    float shimmer = 1.0 + warmZone * (0.016 * sin(uTime * 1.4) + 0.008 * sin(uTime * 2.7));
    color *= vec3(shimmer, shimmer * 0.999, 1.0);

    // Subtle filmic micro-grain & gentle broadcast lens vignette
    float grain = fract(sin(dot(vScreenUv * 412.0 + fract(uTime * 12.0), vec2(12.9898, 78.233))) * 43758.5453);
    color += (grain - 0.5) * 0.007;

    float vigDist = length((vScreenUv - 0.5) * vec2(0.95, 1.05));
    float vig = 1.0 - smoothstep(0.45, 0.95, vigDist) * 0.14;
    color *= vig;

    gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
  }
`;

function compileShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('WebGL shader allocation failed');
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) || 'Unknown shader compile error';
    gl.deleteShader(shader);
    throw new Error(info);
  }
  return shader;
}

function sampleRegionAverage(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  nx: number,
  ny: number
): [number, number, number] {
  const px = Math.max(2, Math.min(w - 3, Math.round(nx * w)));
  const py = Math.max(2, Math.min(h - 3, Math.round(ny * h)));
  const data = ctx.getImageData(px - 2, py - 2, 5, 5).data;
  let r = 0;
  let g = 0;
  let b = 0;
  const count = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  return [r / (count * 255), g / (count * 255), b / (count * 255)];
}

export class PhotorealisticMosqueStage {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private armCanvas: HTMLCanvasElement;
  private armCtx: CanvasRenderingContext2D | null = null;
  private hadRenderedArmOverlay = false;
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private texture: WebGLTexture | null = null;
  private quadBuffer: WebGLBuffer | null = null;

  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private imageLoaded = false;
  private disposed = false;
  private rafId = 0;
  private startTime = performance.now();
  private lastTime = performance.now();
  private resizeObserver: ResizeObserver | null = null;

  private config: ScholarSettingsConfig;
  private playback: StagePlaybackState = {
    activeScholar: 'scholar_1',
    isSpeaking: false,
    mouthLevel: 0,
    lipSync: createRestingLipSyncFrame('scholar_1'),
    scholarAnimation: {
      scholar_1: createIdleScholarAnimationSnapshot('scholar_1'),
      scholar_2: createIdleScholarAnimationSnapshot('scholar_2'),
    },
  };

  private targetPreset: CameraPreset;
  private currentZoom = CAMERA_PRESETS.broadcast_portrait.zoom;
  private currentPanX = CAMERA_PRESETS.broadcast_portrait.panX;
  private currentPanY = CAMERA_PRESETS.broadcast_portrait.panY;

  private lidColors: [[number, number, number], [number, number, number]] = [
    [0.72, 0.56, 0.46],
    [0.74, 0.58, 0.48],
  ];

  private scholarPalettes: [ScholarRigColors, ScholarRigColors] = [
    { ...DEFAULT_SCHOLAR_PALETTES[0] },
    { ...DEFAULT_SCHOLAR_PALETTES[1] },
  ];

  private photoTextures?: [ScholarPhotoTextures, ScholarPhotoTextures];

  private scholars: [ScholarMotionState, ScholarMotionState] = [
    {
      blinkProgress: 0,
      nextBlinkAt: 1.8,
      calmEye: 0,
      jawOpen: 0,
      lipRound: 0,
      lipClose: 0,
      lipSpread: 0,
      lowerLipTuck: 0,
      speakEnergy: 0,
      headTurn: 0,
      headNod: 0,
      headTilt: 0,
      handLift: 0,
      handHide: 0,
      shoulderLift: 0,
      nextNodAt: 2.5,
      nodPulse: 0,
    },
    {
      blinkProgress: 0,
      nextBlinkAt: 3.1,
      calmEye: 0,
      jawOpen: 0,
      lipRound: 0,
      lipClose: 0,
      lipSpread: 0,
      lowerLipTuck: 0,
      speakEnergy: 0,
      headTurn: 0,
      headNod: 0,
      headTilt: 0,
      handLift: 0,
      handHide: 0,
      shoulderLift: 0,
      nextNodAt: 3.8,
      nodPulse: 0,
    },
  ];

  constructor(options: PhotorealisticStageOptions) {
    this.container = options.container;
    this.config = options.scholarsConfig;
    this.targetPreset = options.cameraPreset;

    const initCam = CAMERA_PRESETS[this.targetPreset];
    this.currentZoom = initCam.zoom;
    this.currentPanX = initCam.panX;
    this.currentPanY = initCam.panY;

    this.canvas = document.createElement('canvas');
    this.canvas.style.display = 'block';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.container.appendChild(this.canvas);

    this.armCanvas = document.createElement('canvas');
    this.armCanvas.style.position = 'absolute';
    this.armCanvas.style.inset = '0';
    this.armCanvas.style.width = '100%';
    this.armCanvas.style.height = '100%';
    this.armCanvas.style.pointerEvents = 'none';
    this.armCtx = this.armCanvas.getContext('2d');
    this.container.appendChild(this.armCanvas);

    const gl = this.canvas.getContext('webgl', {
      alpha: false,
      antialias: true,
      powerPreference: 'default',
      preserveDrawingBuffer: false,
    });

    if (!gl) {
      options.onFallbackReady?.();
      return;
    }

    this.gl = gl;
    this.initGl(gl);
    this.loadMasterPhotograph(options.onFallbackReady);
    this.handleResize();

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.container);

    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      options.onFallbackReady?.();
    });

    this.rafId = window.requestAnimationFrame(this.tick);
  }

  private initGl(gl: WebGLRenderingContext): void {
    const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SRC);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SRC);
    const program = gl.createProgram();
    if (!program) throw new Error('Failed to create WebGL program');
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || 'WebGL program link error');
    }

    this.program = program;
    gl.useProgram(program);

    const quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );
    this.quadBuffer = quadBuffer;

    const aPos = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const names = [
      'uTex',
      'uContainerAspect',
      'uImageAspect',
      'uZoom',
      'uPan',
      'uTime',
      'uMouthMorph',
      'uLowerLipTuck',
      'uBlink',
      'uCalmEye',
      'uBreath',
      'uHeadTurn',
      'uHeadNod',
      'uHeadTilt',
      'uHandLift',
      'uHandHide',
      'uShoulderLift',
      'uSpeakEnergy',
      'uLidColor',
    ];
    const arrayUniforms = new Set([
      'uMouthMorph',
      'uLowerLipTuck',
      'uBlink',
      'uCalmEye',
      'uBreath',
      'uHeadTurn',
      'uHeadNod',
      'uHeadTilt',
      'uHandLift',
      'uHandHide',
      'uShoulderLift',
      'uSpeakEnergy',
      'uLidColor',
    ]);
    for (const n of names) {
      this.uniforms[n] = arrayUniforms.has(n)
        ? gl.getUniformLocation(program, `${n}[0]`) ?? gl.getUniformLocation(program, n)
        : gl.getUniformLocation(program, n);
    }

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([7, 14, 33, 255])
    );
    this.texture = texture;
  }

  private loadMasterPhotograph(onFallback?: () => void): void {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (this.disposed || !this.gl || !this.texture) return;

      try {
        const sampleCanvas = document.createElement('canvas');
        sampleCanvas.width = 256;
        sampleCanvas.height = 459;
        const ctx = sampleCanvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(img, 0, 0, sampleCanvas.width, sampleCanvas.height);
          const w = sampleCanvas.width;
          const h = sampleCanvas.height;
          this.lidColors[0] = sampleRegionAverage(ctx, w, h, 0.245, 0.394);
          this.lidColors[1] = sampleRegionAverage(ctx, w, h, 0.719, 0.388);

          // Sample exact jacket, shirt & hand skin tones directly from each scholar in master photograph
          const scaleRgb = (c: [number, number, number], f: number): [number, number, number] => [
            Math.max(0, Math.min(1, c[0] * f)),
            Math.max(0, Math.min(1, c[1] * f)),
            Math.max(0, Math.min(1, c[2] * f)),
          ];
          const j1 = sampleRegionAverage(ctx, w, h, 0.145, 0.545);
          const j2 = sampleRegionAverage(ctx, w, h, 0.618, 0.540);
          const s1 = sampleRegionAverage(ctx, w, h, 0.272, 0.505);
          const s2 = sampleRegionAverage(ctx, w, h, 0.746, 0.500);
          const sk1 = sampleRegionAverage(ctx, w, h, 0.145, 0.636);
          const sk2 = sampleRegionAverage(ctx, w, h, 0.628, 0.632);

          this.scholarPalettes = [
            {
              jacketLit: scaleRgb(j1, 1.32),
              jacketMid: j1,
              jacketDark: scaleRgb(j1, 0.66),
              shirtLit: s1,
              shirtShadow: scaleRgb(s1, 0.82),
              skinLit: scaleRgb(sk1, 1.03),
              skinMid: scaleRgb(sk1, 0.92),
              skinShadow: scaleRgb(sk1, 0.68),
              palmWarm: [
                Math.min(1, sk1[0] * 0.94),
                Math.min(1, sk1[1] * 0.89),
                Math.min(1, sk1[2] * 0.87),
              ],
            },
            {
              jacketLit: scaleRgb(j2, 1.32),
              jacketMid: j2,
              jacketDark: scaleRgb(j2, 0.66),
              shirtLit: s2,
              shirtShadow: scaleRgb(s2, 0.82),
              skinLit: scaleRgb(sk2, 1.03),
              skinMid: scaleRgb(sk2, 0.92),
              skinShadow: scaleRgb(sk2, 0.68),
              palmWarm: [
                Math.min(1, sk2[0] * 0.94),
                Math.min(1, sk2[1] * 0.89),
                Math.min(1, sk2[2] * 0.87),
              ],
            },
          ];

          // Build mirrored seamless wool-jacket & skin textures plus feathered real dorsal hand sprites directly from full-res photo
          const makeSeamlessTile = (nx: number, ny: number, sw: number, sh: number): HTMLCanvasElement => {
            const tile = document.createElement('canvas');
            const sz = 64;
            tile.width = sz * 2;
            tile.height = sz * 2;
            const tctx = tile.getContext('2d');
            if (tctx) {
              const sx = Math.max(0, Math.round(nx * img.width));
              const sy = Math.max(0, Math.round(ny * img.height));
              const pw = Math.max(8, Math.round(sw * img.width));
              const ph = Math.max(8, Math.round(sh * img.height));
              tctx.drawImage(img, sx, sy, pw, ph, 0, 0, sz, sz);
              tctx.save(); tctx.translate(sz * 2, 0); tctx.scale(-1, 1);
              tctx.drawImage(img, sx, sy, pw, ph, 0, 0, sz, sz);
              tctx.restore();
              tctx.save(); tctx.translate(0, sz * 2); tctx.scale(1, -1);
              tctx.drawImage(img, sx, sy, pw, ph, 0, 0, sz, sz);
              tctx.restore();
              tctx.save(); tctx.translate(sz * 2, sz * 2); tctx.scale(-1, -1);
              tctx.drawImage(img, sx, sy, pw, ph, 0, 0, sz, sz);
              tctx.restore();
            }
            return tile;
          };

          const makeDorsalHandSprite = (
            nxMin: number,
            nyMin: number,
            nxMax: number,
            nyMax: number
          ): HTMLCanvasElement => {
            const sx = Math.max(0, Math.round(nxMin * img.width));
            const sy = Math.max(0, Math.round(nyMin * img.height));
            const pw = Math.max(16, Math.round((nxMax - nxMin) * img.width));
            const ph = Math.max(16, Math.round((nyMax - nyMin) * img.height));
            const c = document.createElement('canvas');
            c.width = pw;
            c.height = ph;
            const dctx = c.getContext('2d');
            if (dctx) {
              // Rotate 180deg so wrist sits at bottom (+Y), fingertips point up (-Y), and thumb aligns on outer rim matching 🤲🏻 -> wipe
              dctx.save();
              dctx.translate(pw, ph);
              dctx.scale(-1, -1);
              dctx.drawImage(img, sx, sy, pw, ph, 0, 0, pw, ph);
              dctx.restore();

              // Keep real warm skin/knuckle pixels intact while fading dark navy trouser pixels around hand to transparent
              const imgData = dctx.getImageData(0, 0, pw, ph);
              const px = imgData.data;
              for (let y = 0; y < ph; y++) {
                const ny = y / ph; // 0 = fingertip top, 1 = wrist bottom
                for (let x = 0; x < pw; x++) {
                  const nx = (x / pw - 0.5) * 2;
                  const i = (y * pw + x) * 4;
                  const r = px[i], g = px[i + 1], b = px[i + 2];
                  const warmth = r - b;
                  const rOverG = r - g;
                  const lum = r * 0.3 + g * 0.5 + b * 0.2;
                  const skinScore =
                    Math.max(0, Math.min(1, (warmth - 24) / 18)) *
                    Math.max(0, Math.min(1, (rOverG - 7) / 13)) *
                    Math.max(0, Math.min(1, (lum - 85) / 50));
                  const radialMask = Math.max(0, Math.min(1, 1.04 - Math.hypot(nx * 1.05, (ny - 0.52) * 1.08)));
                  const edgeFeather =
                    Math.max(0, Math.min(1, (0.92 - Math.abs(nx)) * 4.5)) *
                    Math.max(0, Math.min(1, (0.94 - Math.abs(ny - 0.5) * 1.9) * 3.5));
                  px[i + 3] = Math.round(255 * skinScore * Math.min(1, radialMask * 1.35) * edgeFeather);
                }
              }
              dctx.putImageData(imgData, 0, 0);
            }
            return c;
          };

          this.photoTextures = [
            {
              jacketPatch: makeSeamlessTile(0.102, 0.528, 0.052, 0.042),
              skinPatch: makeSeamlessTile(0.132, 0.618, 0.036, 0.028),
              dorsalHandL: makeDorsalHandSprite(0.082, 0.606, 0.200, 0.672),
              dorsalHandR: makeDorsalHandSprite(0.295, 0.596, 0.412, 0.666),
            },
            {
              jacketPatch: makeSeamlessTile(0.578, 0.522, 0.052, 0.042),
              skinPatch: makeSeamlessTile(0.612, 0.612, 0.036, 0.028),
              dorsalHandL: makeDorsalHandSprite(0.568, 0.594, 0.698, 0.666),
              dorsalHandR: makeDorsalHandSprite(0.790, 0.594, 0.942, 0.676),
            },
          ];
        }
      } catch {
        // Retain default warm lid tints & palettes if canvas readback fails
      }

      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      this.imageLoaded = true;
    };
    img.onerror = () => {
      onFallback?.();
    };
    img.src = mosqueMasterUrl;
  }

  private handleResize(): void {
    if (this.disposed) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
    const maxDpr = isMobile ? 1.5 : 2.0;
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);

    const targetW = Math.round(width * dpr);
    const targetH = Math.round(height * dpr);
    if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
      this.canvas.width = targetW;
      this.canvas.height = targetH;
      this.gl?.viewport(0, 0, targetW, targetH);
    }
    if (this.armCanvas.width !== targetW || this.armCanvas.height !== targetH) {
      this.armCanvas.width = targetW;
      this.armCanvas.height = targetH;
    }
  }

  updateScholarsConfig(config: ScholarSettingsConfig): void {
    this.config = config;
  }

  setCameraPreset(preset: CameraPreset): void {
    this.targetPreset = preset;
  }

  setPlaybackState(state: StagePlaybackState): void {
    this.playback = state;
  }

  private updateKinematics(
    dt: number,
    elapsed: number,
    liveSnaps: [ScholarAnimationSnapshot, ScholarAnimationSnapshot]
  ): [ScholarArmGeometryResult, ScholarArmGeometryResult] {
    const headStrength = this.config.headMovementIntensity ?? 0.75;
    const blinkBase = Math.max(2.0, this.config.blinkIntervalSec ?? 3.8);
    const listenerActive = this.config.listenerInteractionEnabled ?? true;

    const activeIdx = this.playback.activeScholar === 'scholar_2' ? 1 : 0;

    // Smooth camera preset & dynamic closeup pan toward speaker
    const preset = CAMERA_PRESETS[this.targetPreset];
    let targetPanX = preset.panX;
    if (this.targetPreset === 'scholar_closeup') {
      targetPanX = activeIdx === 0 ? -0.115 : 0.115;
    }
    const camLerp = 1 - Math.exp(-3.8 * dt);
    this.currentZoom += (preset.zoom - this.currentZoom) * camLerp;
    this.currentPanX += (targetPanX - this.currentPanX) * camLerp;
    this.currentPanY += (preset.panY - this.currentPanY) * camLerp;

    const geoms: [ScholarArmGeometryResult, ScholarArmGeometryResult] = [
      computeScholarArmGeometry(0, liveSnaps[0], elapsed),
      computeScholarArmGeometry(1, liveSnaps[1], elapsed),
    ];

    for (let i = 0; i < 2; i++) {
      const s = this.scholars[i];
      const idx = i as 0 | 1;
      const snap = liveSnaps[idx];
      const geom = geoms[idx];
      const art = resolveStageScholarArticulation(this.playback, idx);
      const isSpeaker = art.isSpeakerPosture;
      const isListener = art.isListenerPosture;
      const phase = i === 0 ? 0.0 : 2.15;

      // Natural blinking cycle with organic jitter
      if (elapsed >= s.nextBlinkAt) {
        const blinkDur = 0.21;
        const bAge = elapsed - s.nextBlinkAt;
        if (bAge < blinkDur) {
          const norm = bAge / blinkDur;
          s.blinkProgress = norm < 0.35 ? norm / 0.35 : 1.0 - (norm - 0.35) / 0.65;
        } else {
          s.blinkProgress = 0;
          const jitter = 0.72 + ((Math.sin(elapsed * 7.3 + i * 3.1) + 1) * 0.5) * 0.62;
          s.nextBlinkAt = elapsed + blinkBase * jitter;
        }
      } else {
        s.blinkProgress = 0;
      }

      // Smooth reverent eye closure during AMEEN & WIPING_FACE
      s.calmEye += (snap.calmEyeSoftness - s.calmEye) * (1 - Math.exp(-8.5 * dt));

      // Speech posture energy & phoneme-driven multi-viseme smoothing (no fake sine flapping)
      const targetEnergy =
        isSpeaker && this.playback.playbackPhase !== 'arabic_audio' ? 1.0 : 0.0;
      s.speakEnergy += (targetEnergy - s.speakEnergy) * (1 - Math.exp(-6.0 * dt));

      const damp = (curr: number, target: number, atkRate: number, relRate: number) => {
        const k = target > curr ? atkRate : relRate;
        return curr + (target - curr) * (1 - Math.exp(-k * dt));
      };

      s.jawOpen = damp(s.jawOpen, art.jawOpen, 28, 18);
      s.lipRound = damp(s.lipRound, art.lipRound, 26, 16);
      s.lipClose = damp(s.lipClose, art.lipClose, 36, 20);
      s.lipSpread = damp(s.lipSpread, art.lipSpread, 24, 16);
      s.lowerLipTuck = damp(s.lowerLipTuck, art.lowerLipTuck, 30, 18);

      // Trouser hand-hide & shoulder engagement linked strictly to live arm lift progress
      s.handHide = geom.handHideFactor;
      s.shoulderLift += (snap.handLiftProgress - s.shoulderLift) * (1 - Math.exp(-6.5 * dt));

      // Listener occasional dignified affirmation nod
      if (isListener && listenerActive) {
        if (elapsed >= s.nextNodAt) {
          const nAge = elapsed - s.nextNodAt;
          if (nAge < 0.85) {
            s.nodPulse = Math.sin((nAge / 0.85) * Math.PI);
          } else {
            s.nodPulse = 0;
            s.nextNodAt = elapsed + 2.4 + ((Math.cos(elapsed * 3.7 + i) + 1) * 0.5) * 2.2;
          }
        }
      } else {
        s.nodPulse += (0 - s.nodPulse) * (1 - Math.exp(-4.0 * dt));
      }

      let targetTurn = Math.sin(elapsed * 0.42 + phase) * 0.14 * headStrength;
      let targetNod = Math.sin(elapsed * 0.58 + phase) * 0.12 * headStrength;
      let targetTilt = Math.sin(elapsed * 0.33 + phase) * 0.011 * headStrength;
      let targetHand = 0.0;

      const isPostDuaRitual =
        snap.phase === 'RAISING_HANDS' ||
        snap.phase === 'AMEEN' ||
        snap.phase === 'WIPING_FACE' ||
        snap.phase === 'RETURNING_TO_IDLE';

      if (isPostDuaRitual) {
        // Serene, centered posture with gentle reverent nod while hands lift, say Âmin, and wipe face
        targetTurn = 0;
        targetNod += snap.gestureHeadNod * 0.85;
        targetTilt = Math.sin(elapsed * 0.7 + phase) * 0.005 * headStrength;
        targetHand = 0;
      } else if (isSpeaker && this.playback.playbackPhase !== 'arabic_audio') {
        targetTurn +=
          (i === 0 ? 0.22 : -0.22) * headStrength +
          Math.sin(elapsed * 1.7 + phase) * 0.32 * headStrength;
        targetNod +=
          Math.sin(elapsed * 2.6 + phase) * 0.3 * headStrength +
          s.jawOpen * 0.22 * headStrength;
        targetTilt += Math.sin(elapsed * 1.35 + phase) * 0.015 * headStrength;
        targetHand =
          (0.42 + 0.58 * (0.5 + 0.5 * Math.sin(elapsed * 1.9 + phase))) *
          (0.65 + 0.35 * s.speakEnergy);
      } else if (isListener && listenerActive) {
        targetTurn = (i === 0 ? 0.68 : -0.68) * headStrength;
        targetNod += s.nodPulse * 0.72 * headStrength;
        targetTilt += (i === 0 ? 0.016 : -0.016) * headStrength;
      }

      const hLerp = 1 - Math.exp(-4.5 * dt);
      s.headTurn += (targetTurn - s.headTurn) * hLerp;
      s.headNod += (targetNod - s.headNod) * hLerp;
      s.headTilt += (targetTilt - s.headTilt) * hLerp;
      s.handLift += (targetHand - s.handLift) * (1 - Math.exp(-3.5 * dt));
    }

    return geoms;
  }

  private buildUvToCanvasMapper(
    containerAspect: number,
    zoom: number,
    panX: number,
    panY: number,
    width: number,
    height: number
  ): UVToCanvasMapper {
    const smoothstep = (e0: number, e1: number, x: number) => {
      const t = Math.max(0, Math.min(1, (x - e0) / Math.max(1e-5, e1 - e0)));
      return t * t * (3 - 2 * t);
    };

    const mapPoint = (pt: UVPoint) => {
      const bgW = 1 - smoothstep(0.3, 0.5, pt.y);
      const effPanX = panX * (1 - bgW * 0.22);
      const effPanY = panY * (1 - bgW * 0.22);
      const cx = (pt.x - 0.5 - effPanX) * zoom;
      const cy = (pt.y - 0.5 - effPanY) * zoom;
      let sx = cx;
      let sy = cy;
      if (containerAspect > IMAGE_ASPECT) {
        sy = cy / (IMAGE_ASPECT / containerAspect);
      } else {
        sx = cx / (containerAspect / IMAGE_ASPECT);
      }
      return {
        px: (sx + 0.5) * width,
        py: (sy + 0.5) * height,
      };
    };

    const p0 = mapPoint({ x: 0, y: 0.6 });
    const p1 = mapPoint({ x: 1, y: 0.6 });
    const fn = mapPoint as UVToCanvasMapper;
    fn.scalePx = Math.max(100, p1.px - p0.px);
    return fn;
  }

  private tick = (now: number): void => {
    if (this.disposed) return;
    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastTime) / 1000));
    this.lastTime = now;
    const elapsed = (now - this.startTime) / 1000;
    const wallNowMs = Date.now();

    const snap0 = resolveLiveScholarSnapshotAt(
      this.playback.scholarAnimation?.scholar_1 ??
        createIdleScholarAnimationSnapshot('scholar_1', wallNowMs),
      wallNowMs
    );
    const snap1 = resolveLiveScholarSnapshotAt(
      this.playback.scholarAnimation?.scholar_2 ??
        createIdleScholarAnimationSnapshot('scholar_2', wallNowMs),
      wallNowMs
    );

    const geoms = this.updateKinematics(dt, elapsed, [snap0, snap1]);
    const containerAspect = Math.max(0.1, this.canvas.width / Math.max(1, this.canvas.height));
    const camBreath = Math.sin(elapsed * 0.55) * 0.0014;

    const gl = this.gl;
    if (gl && this.program && this.imageLoaded) {
      gl.useProgram(this.program);
      const breathAmp = this.config.idleBreathingIntensity ?? 0.7;

      const breath0 = (0.5 + 0.5 * Math.sin(elapsed * 1.35)) * breathAmp;
      const breath1 = (0.5 + 0.5 * Math.sin(elapsed * 1.28 + 1.9)) * breathAmp;

      gl.uniform1i(this.uniforms.uTex, 0);
      gl.uniform1f(this.uniforms.uContainerAspect, containerAspect);
      gl.uniform1f(this.uniforms.uImageAspect, IMAGE_ASPECT);
      gl.uniform1f(this.uniforms.uZoom, this.currentZoom);
      gl.uniform2f(this.uniforms.uPan, this.currentPanX, this.currentPanY);
      gl.uniform1f(this.uniforms.uTime, elapsed);

      gl.uniform4fv(this.uniforms.uMouthMorph, [
        this.scholars[0].jawOpen,
        this.scholars[0].lipRound,
        this.scholars[0].lipClose,
        this.scholars[0].lipSpread,
        this.scholars[1].jawOpen,
        this.scholars[1].lipRound,
        this.scholars[1].lipClose,
        this.scholars[1].lipSpread,
      ]);
      gl.uniform1fv(this.uniforms.uLowerLipTuck, [
        this.scholars[0].lowerLipTuck,
        this.scholars[1].lowerLipTuck,
      ]);
      gl.uniform1fv(this.uniforms.uBlink, [
        this.scholars[0].blinkProgress,
        this.scholars[1].blinkProgress,
      ]);
      gl.uniform1fv(this.uniforms.uCalmEye, [this.scholars[0].calmEye, this.scholars[1].calmEye]);
      gl.uniform1fv(this.uniforms.uBreath, [breath0, breath1]);
      gl.uniform1fv(this.uniforms.uHeadTurn, [this.scholars[0].headTurn, this.scholars[1].headTurn]);
      gl.uniform1fv(this.uniforms.uHeadNod, [this.scholars[0].headNod, this.scholars[1].headNod]);
      gl.uniform1fv(this.uniforms.uHeadTilt, [this.scholars[0].headTilt, this.scholars[1].headTilt]);
      gl.uniform1fv(this.uniforms.uHandLift, [this.scholars[0].handLift, this.scholars[1].handLift]);
      gl.uniform1fv(this.uniforms.uHandHide, [this.scholars[0].handHide, this.scholars[1].handHide]);
      gl.uniform1fv(this.uniforms.uShoulderLift, [
        this.scholars[0].shoulderLift,
        this.scholars[1].shoulderLift,
      ]);
      gl.uniform1fv(this.uniforms.uSpeakEnergy, [
        this.scholars[0].speakEnergy,
        this.scholars[1].speakEnergy,
      ]);
      gl.uniform3fv(this.uniforms.uLidColor, [...this.lidColors[0], ...this.lidColors[1]]);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    if (this.armCtx && this.imageLoaded) {
      const anyArmActive = geoms[0].shouldRender || geoms[1].shouldRender;
      if (anyArmActive) {
        const mapper = this.buildUvToCanvasMapper(
          containerAspect,
          this.currentZoom + camBreath,
          this.currentPanX,
          this.currentPanY,
          this.armCanvas.width,
          this.armCanvas.height
        );
        renderScholarArmsAndHands(
          this.armCtx,
          this.armCanvas.width,
          this.armCanvas.height,
          geoms,
          this.scholarPalettes,
          mapper,
          this.photoTextures
        );
        this.hadRenderedArmOverlay = true;
      } else if (this.hadRenderedArmOverlay) {
        this.armCtx.clearRect(0, 0, this.armCanvas.width, this.armCanvas.height);
        this.hadRenderedArmOverlay = false;
      }
    }

    this.rafId = window.requestAnimationFrame(this.tick);
  };

  dispose(): void {
    this.disposed = true;
    if (this.rafId) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    const gl = this.gl;
    if (gl) {
      if (this.texture) gl.deleteTexture(this.texture);
      if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer);
      if (this.program) gl.deleteProgram(this.program);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
    this.gl = null;
    this.canvas.remove();
    this.armCanvas.remove();
  }
}
