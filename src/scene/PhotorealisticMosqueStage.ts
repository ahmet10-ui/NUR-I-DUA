import mosqueMasterUrl from '../assets/images/mosque_scholars_broadcast_1795080562181.jpg';
import { ScholarId, ScholarSettingsConfig } from '../types/nuridua';

export type CameraPreset = 'broadcast_portrait' | 'wide_mihrab' | 'scholar_closeup';

export interface PhotorealisticStageOptions {
  container: HTMLElement;
  scholarsConfig: ScholarSettingsConfig;
  cameraPreset: CameraPreset;
  onFallbackReady?: () => void;
}

export interface StagePlaybackState {
  activeScholar: ScholarId;
  isSpeaking: boolean;
  mouthLevel: number;
}

interface ScholarMotionState {
  blinkProgress: number;
  nextBlinkAt: number;
  mouthOpen: number;
  speakEnergy: number;
  headTurn: number;
  headNod: number;
  headTilt: number;
  handLift: number;
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
  uniform float uMouthOpen[2];
  uniform float uBlink[2];
  uniform float uBreath[2];
  uniform float uHeadTurn[2];
  uniform float uHeadNod[2];
  uniform float uHeadTilt[2];
  uniform float uHandLift[2];
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
    inout vec4 lidOverlay,
    vec2 eyeL,
    vec2 eyeR,
    vec2 mouthC,
    vec2 headC,
    vec2 neckP,
    vec2 chestC,
    vec2 handL,
    vec2 handR,
    float mouthOpen,
    float blink,
    float breath,
    float headTurn,
    float headNod,
    float headTilt,
    float handLift,
    float speakEnergy,
    vec3 lidTint
  ) {
    // 1. Torso & shoulders breathing (gentle chest lift & subtle horizontal expand)
    float chestW = ellipseWeight(uv, chestC, vec2(0.185, 0.145), 0.25);
    if (chestW > 0.001) {
      float lift = breath * 0.0036 + speakEnergy * 0.0014 * sin(uTime * 3.1);
      float expand = breath * 0.0045;
      vec2 fromChest = uv - chestC;
      uv.y += chestW * lift;
      uv.x -= chestW * fromChest.x * expand;
    }

    // 2. Foreground hands & forearms subtle dua cadence
    float handLW = ellipseWeight(uv, handL, vec2(0.062, 0.055), 0.25);
    float handRW = ellipseWeight(uv, handR, vec2(0.062, 0.055), 0.25);
    if (handLW > 0.001) {
      float hMove = handLift * 0.0075 + breath * 0.0016;
      uv.y += handLW * hMove;
      uv.x -= handLW * handLift * 0.0024;
    }
    if (handRW > 0.001) {
      float hMove = handLift * 0.0072 + breath * 0.0016;
      uv.y += handRW * hMove;
      uv.x += handRW * handLift * 0.0024;
    }

    // 3. Head, beard, face & takke rotation / nod / listener turn around neck pivot
    float headW = ellipseWeight(uv, headC, vec2(0.082, 0.102), 0.42);
    if (headW > 0.001) {
      vec2 rotated = rotateAround(uv, neckP, -headTilt);
      vec2 headDelta = rotated - uv;
      // Nodding shifts head subtly vertically + tiny perspective turn
      headDelta.y -= headNod * 0.0058 + breath * 0.0014;
      headDelta.x -= headTurn * 0.0052;
      uv += headW * headDelta;
    }

    // 4. Jaw / chin / lower beard drop during speech
    if (mouthOpen > 0.005) {
      float belowLip = smoothstep(-0.004, 0.009, uv.y - mouthC.y);
      float jawW = ellipseWeight(uv, mouthC + vec2(0.0, 0.022), vec2(0.036, 0.042), 0.20) * belowLip;
      if (jawW > 0.001) {
        float jawDrop = mouthOpen * 0.0092;
        uv.y -= jawW * jawDrop;
        // Subtle horizontal cheek tuck when jaw drops
        uv.x += jawW * (uv.x - mouthC.x) * mouthOpen * 0.065;
      }

      // Soft shadowed oral cavity inside parting lips
      vec2 mCenter = mouthC + vec2(0.0, mouthOpen * 0.0020);
      vec2 mRadii = vec2(0.0135, 0.0014 + mouthOpen * 0.0046);
      float mDist = length((uv - mCenter) / mRadii);
      float cavity = (1.0 - smoothstep(0.32, 1.0, mDist)) * smoothstep(0.04, 0.24, mouthOpen);
      oralShadow = max(oralShadow, cavity);
    }

    // 5. Natural eye blinking (self-sampled upper eyelid skin)
    if (blink > 0.01) {
      vec2 eyeRadii = vec2(0.0145, 0.0085);
      for (int e = 0; e < 2; e++) {
        vec2 ec = (e == 0) ? eyeL : eyeR;
        vec2 ed = (uv - ec) / eyeRadii;
        float eDist = length(ed);
        if (eDist < 1.15) {
          float lidBottomY = ec.y - eyeRadii.y * 0.85 + blink * eyeRadii.y * 1.62;
          if (uv.y <= lidBottomY) {
            float edgeFeather = 1.0 - smoothstep(0.75, 1.12, eDist);
            float bottomCrease = smoothstep(lidBottomY - 0.0022, lidBottomY, uv.y);
            // Sample actual upper eyelid skin just above the eye
            vec2 skinSampleUv = vec2(
              uv.x,
              ec.y - eyeRadii.y * 1.25 - max(0.0, lidBottomY - uv.y) * 0.35
            );
            vec3 sampledSkin = texture2D(uTex, skinSampleUv).rgb;
            vec3 lidCol = mix(sampledSkin, lidTint, 0.22) * (0.94 - bottomCrease * 0.24);
            float alpha = edgeFeather * smoothstep(0.02, 0.22, blink);
            if (alpha > lidOverlay.a) {
              lidOverlay = vec4(lidCol, alpha);
            }
          }
        }
      }
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
    vec4 lidOverlay = vec4(0.0);

    // Scholar 1 (Left: Haci Ahmet Efendi)
    applyScholarDeformation(
      uv,
      oralShadow,
      lidOverlay,
      vec2(0.2448, 0.4041), // left eye
      vec2(0.2969, 0.4041), // right eye
      vec2(0.2721, 0.4404), // mouth
      vec2(0.2721, 0.4080), // head center
      vec2(0.2721, 0.4724), // neck pivot
      vec2(0.2695, 0.5450), // chest center
      vec2(0.1510, 0.6308), // left hand
      vec2(0.3672, 0.6308), // right hand
      uMouthOpen[0],
      uBlink[0],
      uBreath[0],
      uHeadTurn[0],
      uHeadNod[0],
      uHeadTilt[0],
      uHandLift[0],
      uSpeakEnergy[0],
      uLidColor[0]
    );

    // Scholar 2 (Right: Haci Mehmet Efendi)
    applyScholarDeformation(
      uv,
      oralShadow,
      lidOverlay,
      vec2(0.7188, 0.3975), // left eye
      vec2(0.7734, 0.3975), // right eye
      vec2(0.7461, 0.4339), // mouth
      vec2(0.7461, 0.4010), // head center
      vec2(0.7461, 0.4666), // neck pivot
      vec2(0.7435, 0.5400), // chest center
      vec2(0.6250, 0.6265), // left hand
      vec2(0.8763, 0.6265), // right hand
      uMouthOpen[1],
      uBlink[1],
      uBreath[1],
      uHeadTurn[1],
      uHeadNod[1],
      uHeadTilt[1],
      uHandLift[1],
      uSpeakEnergy[1],
      uLidColor[1]
    );

    vec3 color = texture2D(uTex, clamp(uv, vec2(0.001), vec2(0.999))).rgb;

    // Blend eyelid skin cleanly when blinking
    if (lidOverlay.a > 0.001) {
      color = mix(color, lidOverlay.rgb, lidOverlay.a);
    }

    // Blend soft shadowed oral cavity when jaw opens
    if (oralShadow > 0.005) {
      vec3 cavityColor = vec3(0.095, 0.042, 0.036);
      color = mix(color, cavityColor, oralShadow * 0.86);
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
  };

  private targetPreset: CameraPreset;
  private currentZoom = CAMERA_PRESETS.broadcast_portrait.zoom;
  private currentPanX = CAMERA_PRESETS.broadcast_portrait.panX;
  private currentPanY = CAMERA_PRESETS.broadcast_portrait.panY;

  private lidColors: [[number, number, number], [number, number, number]] = [
    [0.72, 0.56, 0.46],
    [0.74, 0.58, 0.48],
  ];

  private scholars: [ScholarMotionState, ScholarMotionState] = [
    {
      blinkProgress: 0,
      nextBlinkAt: 1.8,
      mouthOpen: 0,
      speakEnergy: 0,
      headTurn: 0,
      headNod: 0,
      headTilt: 0,
      handLift: 0,
      nextNodAt: 2.5,
      nodPulse: 0,
    },
    {
      blinkProgress: 0,
      nextBlinkAt: 3.1,
      mouthOpen: 0,
      speakEnergy: 0,
      headTurn: 0,
      headNod: 0,
      headTilt: 0,
      handLift: 0,
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
      'uMouthOpen',
      'uBlink',
      'uBreath',
      'uHeadTurn',
      'uHeadNod',
      'uHeadTilt',
      'uHandLift',
      'uSpeakEnergy',
      'uLidColor',
    ];
    const arrayUniforms = new Set([
      'uMouthOpen',
      'uBlink',
      'uBreath',
      'uHeadTurn',
      'uHeadNod',
      'uHeadTilt',
      'uHandLift',
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
    // 1x1 dark navy placeholder until image completes decoding
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

      // Sample natural eyelid skin tone right above each scholar's eyes
      try {
        const sampleCanvas = document.createElement('canvas');
        sampleCanvas.width = 256;
        sampleCanvas.height = 459;
        const ctx = sampleCanvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(img, 0, 0, sampleCanvas.width, sampleCanvas.height);
          this.lidColors[0] = sampleRegionAverage(ctx, sampleCanvas.width, sampleCanvas.height, 0.245, 0.394);
          this.lidColors[1] = sampleRegionAverage(ctx, sampleCanvas.width, sampleCanvas.height, 0.719, 0.388);
        }
      } catch {
        // Retain default warm lid tints if canvas readback fails
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

  private updateKinematics(dt: number, elapsed: number): void {
    const breathStrength = this.config.idleBreathingIntensity ?? 0.7;
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

    for (let i = 0; i < 2; i++) {
      const s = this.scholars[i];
      const isSpeaker = this.playback.isSpeaking && activeIdx === i;
      const isListener = this.playback.isSpeaking && activeIdx !== i;
      const phase = i === 0 ? 0.0 : 2.15;

      // Natural blinking cycle with organic jitter
      if (elapsed >= s.nextBlinkAt) {
        const blinkDur = 0.21;
        const bAge = elapsed - s.nextBlinkAt;
        if (bAge < blinkDur) {
          const norm = bAge / blinkDur;
          // Asymmetric fast close (0..0.35), smooth open (0.35..1.0)
          s.blinkProgress = norm < 0.35 ? norm / 0.35 : 1.0 - (norm - 0.35) / 0.65;
        } else {
          s.blinkProgress = 0;
          const jitter = 0.72 + ((Math.sin(elapsed * 7.3 + i * 3.1) + 1) * 0.5) * 0.62;
          s.nextBlinkAt = elapsed + blinkBase * jitter;
        }
      } else {
        s.blinkProgress = 0;
      }

      // Speech energy & mouth articulation
      const targetEnergy = isSpeaker ? 1.0 : 0.0;
      s.speakEnergy += (targetEnergy - s.speakEnergy) * (1 - Math.exp(-6.0 * dt));

      const rawMouth = isSpeaker
        ? Math.max(0.08, Math.min(1.0, this.playback.mouthLevel * 0.85 + 0.18 * Math.abs(Math.sin(elapsed * 10.2 + phase))))
        : 0.0;
      const mouthLerp = rawMouth > s.mouthOpen ? 1 - Math.exp(-22 * dt) : 1 - Math.exp(-12 * dt);
      s.mouthOpen += (rawMouth - s.mouthOpen) * mouthLerp;

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

      // Head turn (listener faces toward speaker; speaker subtly engages center)
      let targetTurn = Math.sin(elapsed * 0.42 + phase) * 0.14 * headStrength;
      let targetNod = Math.sin(elapsed * 0.58 + phase) * 0.12 * headStrength;
      let targetTilt = Math.sin(elapsed * 0.33 + phase) * 0.011 * headStrength;
      let targetHand = 0.0;

      if (isSpeaker) {
        targetTurn += (i === 0 ? 0.25 : -0.25) * headStrength + Math.sin(elapsed * 1.9 + phase) * 0.38 * headStrength;
        targetNod += Math.sin(elapsed * 3.1 + phase) * 0.42 * headStrength + this.playback.mouthLevel * 0.28 * headStrength;
        targetTilt += Math.sin(elapsed * 1.45 + phase) * 0.018 * headStrength;
        targetHand = (0.45 + 0.55 * (0.5 + 0.5 * Math.sin(elapsed * 2.1 + phase))) * (0.65 + 0.35 * this.playback.mouthLevel);
      } else if (isListener && listenerActive) {
        // Turn gently toward the speaking brother (left scholar turns right +, right scholar turns left -)
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
  }

  private tick = (now: number): void => {
    if (this.disposed) return;
    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastTime) / 1000));
    this.lastTime = now;
    const elapsed = (now - this.startTime) / 1000;

    this.updateKinematics(dt, elapsed);

    const gl = this.gl;
    if (gl && this.program && this.imageLoaded) {
      gl.useProgram(this.program);
      const containerAspect = Math.max(0.1, this.canvas.width / Math.max(1, this.canvas.height));
      const breathAmp = this.config.idleBreathingIntensity ?? 0.7;

      const breath0 = (0.5 + 0.5 * Math.sin(elapsed * 1.35)) * breathAmp;
      const breath1 = (0.5 + 0.5 * Math.sin(elapsed * 1.28 + 1.9)) * breathAmp;

      gl.uniform1i(this.uniforms.uTex, 0);
      gl.uniform1f(this.uniforms.uContainerAspect, containerAspect);
      gl.uniform1f(this.uniforms.uImageAspect, IMAGE_ASPECT);
      gl.uniform1f(this.uniforms.uZoom, this.currentZoom);
      gl.uniform2f(this.uniforms.uPan, this.currentPanX, this.currentPanY);
      gl.uniform1f(this.uniforms.uTime, elapsed);

      gl.uniform1fv(this.uniforms.uMouthOpen, [this.scholars[0].mouthOpen, this.scholars[1].mouthOpen]);
      gl.uniform1fv(this.uniforms.uBlink, [this.scholars[0].blinkProgress, this.scholars[1].blinkProgress]);
      gl.uniform1fv(this.uniforms.uBreath, [breath0, breath1]);
      gl.uniform1fv(this.uniforms.uHeadTurn, [this.scholars[0].headTurn, this.scholars[1].headTurn]);
      gl.uniform1fv(this.uniforms.uHeadNod, [this.scholars[0].headNod, this.scholars[1].headNod]);
      gl.uniform1fv(this.uniforms.uHeadTilt, [this.scholars[0].headTilt, this.scholars[1].headTilt]);
      gl.uniform1fv(this.uniforms.uHandLift, [this.scholars[0].handLift, this.scholars[1].handLift]);
      gl.uniform1fv(this.uniforms.uSpeakEnergy, [this.scholars[0].speakEnergy, this.scholars[1].speakEnergy]);
      gl.uniform3fv(this.uniforms.uLidColor, [...this.lidColors[0], ...this.lidColors[1]]);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
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
  }
}
