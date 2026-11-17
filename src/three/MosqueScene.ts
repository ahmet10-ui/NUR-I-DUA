import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { ScholarId, ScholarSettingsConfig } from '../types/nuridua';
import {
  createContactShadowTexture,
  createIznikTileTexture,
  createMosqueCarpetTexture,
  createWarmStoneTexture,
} from './mosqueTextures';
import { createScholarRig, ProceduralScholarRig } from './ScholarRig';

export type CameraPreset = 'broadcast_portrait' | 'wide_mihrab' | 'scholar_closeup';

export interface MosqueSceneOptions {
  container: HTMLElement;
  scholarsConfig: ScholarSettingsConfig;
  cameraPreset: CameraPreset;
  onWebGLContextLost?: () => void;
}

const CAMERA_PRESETS: Record<
  CameraPreset,
  { pos: THREE.Vector3; lookAt: THREE.Vector3; fov: number }
> = {
  broadcast_portrait: {
    pos: new THREE.Vector3(0, 0.96, 3.02),
    lookAt: new THREE.Vector3(0, 0.66, 0.15),
    fov: 38,
  },
  wide_mihrab: {
    pos: new THREE.Vector3(0, 1.38, 3.85),
    lookAt: new THREE.Vector3(0, 0.92, -0.45),
    fov: 42,
  },
  scholar_closeup: {
    pos: new THREE.Vector3(0, 0.92, 2.38),
    lookAt: new THREE.Vector3(0, 0.68, 0.25),
    fov: 36,
  },
};

function detectSoftwareWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

export class MosqueSceneController {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private isSoftwareGl: boolean;

  private scholar1Rig: ProceduralScholarRig;
  private scholar2Rig: ProceduralScholarRig;
  private chandelierGroup: THREE.Group;
  private mihrabLight: THREE.PointLight;

  private currentPreset: CameraPreset;
  private camTargetPos = new THREE.Vector3();
  private camCurrentLookAt = new THREE.Vector3();
  private camTargetLookAt = new THREE.Vector3();

  private clock = new THREE.Clock();
  private frameId = 0;
  private disposed = false;

  private disposables: Array<{ dispose: () => void }> = [];
  private resizeObserver: ResizeObserver | null = null;

  constructor(options: MosqueSceneOptions) {
    this.container = options.container;
    this.currentPreset = options.cameraPreset;
    this.isSoftwareGl = detectSoftwareWebGL();

    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';

    if (options.onWebGLContextLost) {
      this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        options.onWebGLContextLost?.();
      });
    }

    this.container.appendChild(this.renderer.domElement);

    // Scene & Atmosphere
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#070E21');
    this.scene.fog = new THREE.FogExp2('#070E21', 0.055);

    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    const envTex = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = envTex;
    this.disposables.push(envTex);
    pmremGenerator.dispose();

    // Camera
    const preset = CAMERA_PRESETS[this.currentPreset];
    this.camera = new THREE.PerspectiveCamera(preset.fov, width / height, 0.1, 60);
    this.camera.position.copy(preset.pos);
    this.camTargetPos.copy(preset.pos);
    this.camCurrentLookAt.copy(preset.lookAt);
    this.camTargetLookAt.copy(preset.lookAt);
    this.camera.lookAt(this.camCurrentLookAt);

    // Build Lighting + Ottoman Mosque + Two Scholars
    const { chandelierGroup, mihrabLight } = this.buildLightingAndMosque();
    this.chandelierGroup = chandelierGroup;
    this.mihrabLight = mihrabLight;

    const tuning = {
      blinkIntervalSec: options.scholarsConfig.blinkIntervalSec,
      headMovementIntensity: options.scholarsConfig.headMovementIntensity,
      idleBreathingIntensity: options.scholarsConfig.idleBreathingIntensity,
      listenerInteractionEnabled: options.scholarsConfig.listenerInteractionEnabled,
    };

    this.scholar1Rig = createScholarRig(options.scholarsConfig.profiles.scholar_1, tuning, 0.0);
    this.scholar1Rig.group.position.set(-0.36, 0.06, 0.42);
    this.scholar1Rig.group.rotation.y = 0.18;
    this.scene.add(this.scholar1Rig.group);

    this.scholar2Rig = createScholarRig(options.scholarsConfig.profiles.scholar_2, tuning, 1.7);
    this.scholar2Rig.group.position.set(0.36, 0.06, 0.42);
    this.scholar2Rig.group.rotation.y = -0.18;
    this.scene.add(this.scholar2Rig.group);

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.container);
    window.addEventListener('resize', this.handleResize);

    this.startLoop();
  }

  private track<T extends { dispose: () => void }>(item: T): T {
    this.disposables.push(item);
    return item;
  }

  private buildLightingAndMosque() {
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();

    // 3-Point Warm/Cool Architectural Lighting
    const hemi = new THREE.HemisphereLight(0x88a8e6, 0x2a2016, 0.85);
    this.scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xffe6bd, 1.85);
    keyLight.position.set(2.8, 4.6, 3.6);
    keyLight.castShadow = !this.isSoftwareGl;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 15;
    keyLight.shadow.camera.left = -3.2;
    keyLight.shadow.camera.right = 3.2;
    keyLight.shadow.camera.top = 3.2;
    keyLight.shadow.camera.bottom = -2;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    this.scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x6b95ff, 0.75);
    rimLight.position.set(-2.5, 3.2, -3.2);
    this.scene.add(rimLight);

    const mihrabLight = new THREE.PointLight(0xffbe63, 3.2, 6.5, 1.8);
    mihrabLight.position.set(0, 1.95, -1.55);
    this.scene.add(mihrabLight);

    const chandelierLight = new THREE.PointLight(0xffd48a, 2.4, 8, 1.6);
    chandelierLight.position.set(0, 2.55, 0.45);
    this.scene.add(chandelierLight);

    // Textures
    const carpetTex = this.track(createMosqueCarpetTexture(maxAniso));
    const tileTex = this.track(createIznikTileTexture(maxAniso));
    const stoneTex = this.track(createWarmStoneTexture(maxAniso));
    const contactTex = this.track(createContactShadowTexture());

    // Materials
    const carpetMat = this.track(
      new THREE.MeshStandardMaterial({
        map: carpetTex,
        roughness: 0.9,
        metalness: 0.02,
      })
    );
    const tileMat = this.track(
      new THREE.MeshStandardMaterial({
        map: tileTex,
        roughness: 0.35,
        metalness: 0.08,
      })
    );
    const stoneMat = this.track(
      new THREE.MeshStandardMaterial({
        map: stoneTex,
        roughness: 0.65,
        metalness: 0.04,
      })
    );
    const navyWallMat = this.track(
      new THREE.MeshStandardMaterial({
        color: 0x0d1b3d,
        roughness: 0.8,
        metalness: 0.05,
      })
    );
    const brassMat = this.track(
      new THREE.MeshStandardMaterial({
        color: 0xcfa557,
        roughness: 0.24,
        metalness: 0.92,
      })
    );
    const lanternGlassMat = this.track(
      new THREE.MeshStandardMaterial({
        color: 0xffe4aa,
        emissive: 0xffb347,
        emissiveIntensity: 1.45,
        roughness: 0.25,
      })
    );
    const contactMat = this.track(
      new THREE.MeshBasicMaterial({
        map: contactTex,
        transparent: true,
        depthWrite: false,
        opacity: 0.55,
      })
    );

    // Mosque Floor Carpet (y = 0)
    const floorGeo = this.track(new THREE.PlaneGeometry(11, 11));
    const floor = new THREE.Mesh(floorGeo, carpetMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Subtle Raised Dais / Carpet Platform for Scholars (y = 0.06 top)
    const daisGeo = this.track(new THREE.BoxGeometry(3.2, 0.06, 1.8));
    const dais = new THREE.Mesh(daisGeo, carpetMat);
    dais.position.set(0, 0.03, 0.32);
    dais.receiveShadow = true;
    this.scene.add(dais);

    const daisTrimGeo = this.track(new THREE.BoxGeometry(3.24, 0.02, 1.84));
    const daisTrim = new THREE.Mesh(daisTrimGeo, brassMat);
    daisTrim.position.set(0, 0.015, 0.32);
    this.scene.add(daisTrim);

    // Contact grounding shadows beneath each scholar
    const shadowPlaneGeo = this.track(new THREE.PlaneGeometry(1.0, 1.0));
    const shadow1 = new THREE.Mesh(shadowPlaneGeo, contactMat);
    shadow1.rotation.x = -Math.PI / 2;
    shadow1.position.set(-0.36, 0.063, 0.42);
    this.scene.add(shadow1);

    const shadow2 = new THREE.Mesh(shadowPlaneGeo, contactMat);
    shadow2.rotation.x = -Math.PI / 2;
    shadow2.position.set(0.36, 0.063, 0.42);
    this.scene.add(shadow2);

    // Back Qibla Wall & Iznik Tile Dado
    const qiblaWallGeo = this.track(new THREE.BoxGeometry(11, 6.5, 0.4));
    const qiblaWall = new THREE.Mesh(qiblaWallGeo, navyWallMat);
    qiblaWall.position.set(0, 3.25, -2.15);
    qiblaWall.receiveShadow = true;
    this.scene.add(qiblaWall);

    const dadoGeo = this.track(new THREE.BoxGeometry(10.6, 1.9, 0.06));
    const dado = new THREE.Mesh(dadoGeo, tileMat);
    dado.position.set(0, 0.95, -1.94);
    dado.receiveShadow = true;
    this.scene.add(dado);

    const dadoCapGeo = this.track(new THREE.BoxGeometry(10.6, 0.06, 0.1));
    const dadoCap = new THREE.Mesh(dadoCapGeo, brassMat);
    dadoCap.position.set(0, 1.92, -1.93);
    this.scene.add(dadoCap);

    // Grand Ottoman Mihrab Niche (ExtrudeGeometry pointed arch surround + recessed tiled niche)
    const mihrabGroup = new THREE.Group();
    mihrabGroup.position.set(0, 0, -1.86);
    this.scene.add(mihrabGroup);

    // Outer pointed arch frame via Shape + ExtrudeGeometry
    const archShape = new THREE.Shape();
    archShape.moveTo(-1.05, 0);
    archShape.lineTo(-1.05, 3.1);
    archShape.lineTo(1.05, 3.1);
    archShape.lineTo(1.05, 0);
    archShape.lineTo(0.76, 0);
    archShape.lineTo(0.76, 1.82);
    archShape.quadraticCurveTo(0.76, 2.45, 0, 2.78);
    archShape.quadraticCurveTo(-0.76, 2.45, -0.76, 1.82);
    archShape.lineTo(-0.76, 0);
    archShape.closePath();

    const mihrabFrameGeo = this.track(
      new THREE.ExtrudeGeometry(archShape, {
        depth: 0.24,
        bevelEnabled: true,
        bevelSegments: 2,
        steps: 1,
        bevelSize: 0.025,
        bevelThickness: 0.025,
      })
    );
    const mihrabFrame = new THREE.Mesh(mihrabFrameGeo, stoneMat);
    mihrabFrame.position.set(0, 0, -0.08);
    mihrabFrame.castShadow = true;
    mihrabFrame.receiveShadow = true;
    mihrabGroup.add(mihrabFrame);

    // Recessed niche back with Iznik tile texture
    const nicheBackGeo = this.track(new THREE.CylinderGeometry(0.75, 0.75, 2.75, 20, 1, true, Math.PI * 0.7, Math.PI * 0.6));
    const nicheBackMat = this.track(
      new THREE.MeshStandardMaterial({
        map: tileTex,
        roughness: 0.3,
        metalness: 0.1,
        side: THREE.BackSide,
      })
    );
    const nicheBack = new THREE.Mesh(nicheBackGeo, nicheBackMat);
    nicheBack.position.set(0, 1.38, 0.14);
    mihrabGroup.add(nicheBack);

    // Gold Mihrab Crest Trim
    const crestGeo = this.track(new THREE.BoxGeometry(2.26, 0.09, 0.3));
    const crest = new THREE.Mesh(crestGeo, brassMat);
    crest.position.set(0, 3.15, 0.04);
    mihrabGroup.add(crest);

    // Twin Mihrab Colonnettes
    const colGeo = this.track(new THREE.CylinderGeometry(0.06, 0.07, 1.85, 14));
    const capGeo = this.track(new THREE.CylinderGeometry(0.11, 0.065, 0.16, 12));
    for (const side of [-0.78, 0.78]) {
      const col = new THREE.Mesh(colGeo, stoneMat);
      col.position.set(side, 0.925, 0.14);
      col.castShadow = true;
      mihrabGroup.add(col);

      const cap = new THREE.Mesh(capGeo, brassMat);
      cap.position.set(side, 1.88, 0.14);
      mihrabGroup.add(cap);
    }

    // Flanking Grand Mosque Columns
    const bigColGeo = this.track(new THREE.CylinderGeometry(0.16, 0.18, 4.6, 18));
    const bigBaseGeo = this.track(new THREE.BoxGeometry(0.46, 0.24, 0.46));
    for (const side of [-2.45, 2.45]) {
      const col = new THREE.Mesh(bigColGeo, stoneMat);
      col.position.set(side, 2.3, -1.35);
      col.castShadow = true;
      col.receiveShadow = true;
      this.scene.add(col);

      const base = new THREE.Mesh(bigBaseGeo, stoneMat);
      base.position.set(side, 0.12, -1.35);
      this.scene.add(base);
    }

    // Clerestory Glowing Arched Windows on Upper Wall
    const winGeo = this.track(new THREE.CylinderGeometry(0.24, 0.24, 0.05, 16));
    const winMat = this.track(
      new THREE.MeshStandardMaterial({
        color: 0xffd584,
        emissive: 0xd99b38,
        emissiveIntensity: 0.7,
        roughness: 0.35,
      })
    );
    for (const wx of [-1.75, 1.75]) {
      const win = new THREE.Mesh(winGeo, winMat);
      win.rotation.x = Math.PI / 2;
      win.position.set(wx, 2.85, -1.93);
      this.scene.add(win);
    }

    // Suspended Ottoman Brass Chandelier (Kandil Ring)
    const chandelierGroup = new THREE.Group();
    chandelierGroup.position.set(0, 2.05, 0.28);
    this.scene.add(chandelierGroup);

    const chainGeo = this.track(new THREE.CylinderGeometry(0.012, 0.012, 1.8, 8));
    const chain = new THREE.Mesh(chainGeo, brassMat);
    chain.position.set(0, 0.9, 0);
    chandelierGroup.add(chain);

    const ringGeo = this.track(new THREE.TorusGeometry(0.68, 0.025, 10, 36));
    const ring = new THREE.Mesh(ringGeo, brassMat);
    ring.rotation.x = Math.PI / 2;
    chandelierGroup.add(ring);

    const globeGeo = this.track(new THREE.SphereGeometry(0.055, 12, 10));
    const lampCount = 6;
    for (let i = 0; i < lampCount; i++) {
      const ang = (i / lampCount) * Math.PI * 2;
      const gx = Math.cos(ang) * 0.68;
      const gz = Math.sin(ang) * 0.68;
      const globe = new THREE.Mesh(globeGeo, lanternGlassMat);
      globe.position.set(gx, 0.07, gz);
      chandelierGroup.add(globe);
    }

    return { chandelierGroup, mihrabLight };
  }

  updateScholarsConfig(config: ScholarSettingsConfig): void {
    const tuning = {
      blinkIntervalSec: config.blinkIntervalSec,
      headMovementIntensity: config.headMovementIntensity,
      idleBreathingIntensity: config.idleBreathingIntensity,
      listenerInteractionEnabled: config.listenerInteractionEnabled,
    };
    this.scholar1Rig.updateTuning(tuning);
    this.scholar2Rig.updateTuning(tuning);
  }

  setPlaybackState(params: {
    activeScholar: ScholarId;
    isSpeaking: boolean;
    mouthLevel: number;
  }): void {
    const { activeScholar, isSpeaking, mouthLevel } = params;
    const basePreset = CAMERA_PRESETS[this.currentPreset];
    if (!isSpeaking) {
      this.scholar1Rig.setSpeaking(false);
      this.scholar2Rig.setSpeaking(false);
      this.scholar1Rig.setListeningTo('center');
      this.scholar2Rig.setListeningTo('center');
      this.scholar1Rig.setMouthOpen(0);
      this.scholar2Rig.setMouthOpen(0);
      this.camTargetPos.copy(basePreset.pos);
      this.camTargetLookAt.copy(basePreset.lookAt);
      return;
    }

    if (activeScholar === 'scholar_1') {
      this.scholar1Rig.setSpeaking(true);
      this.scholar1Rig.setListeningTo('center');
      this.scholar1Rig.setMouthOpen(mouthLevel);

      this.scholar2Rig.setSpeaking(false);
      this.scholar2Rig.setListeningTo('left'); // Look left toward Scholar 1
      this.scholar2Rig.setMouthOpen(0);

      // Subtle visual emphasis toward speaking scholar while keeping both fully visible
      this.camTargetPos.set(basePreset.pos.x - 0.09, basePreset.pos.y, basePreset.pos.z - 0.08);
      this.camTargetLookAt.set(basePreset.lookAt.x - 0.07, basePreset.lookAt.y, basePreset.lookAt.z);
    } else {
      this.scholar2Rig.setSpeaking(true);
      this.scholar2Rig.setListeningTo('center');
      this.scholar2Rig.setMouthOpen(mouthLevel);

      this.scholar1Rig.setSpeaking(false);
      this.scholar1Rig.setListeningTo('right'); // Look right toward Scholar 2
      this.scholar1Rig.setMouthOpen(0);

      this.camTargetPos.set(basePreset.pos.x + 0.09, basePreset.pos.y, basePreset.pos.z - 0.08);
      this.camTargetLookAt.set(basePreset.lookAt.x + 0.07, basePreset.lookAt.y, basePreset.lookAt.z);
    }
  }

  setCameraPreset(preset: CameraPreset): void {
    this.currentPreset = preset;
    const cfg = CAMERA_PRESETS[preset];
    this.camTargetPos.copy(cfg.pos);
    this.camTargetLookAt.copy(cfg.lookAt);
    if (this.camera.fov !== cfg.fov) {
      this.camera.fov = cfg.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  private handleResize = () => {
    if (this.disposed) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  private afterDraw(cb: () => void) {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (!gl || typeof gl.fenceSync !== 'function') {
      this.frameId = window.setTimeout(cb, 80);
      return;
    }
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) return;
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private startLoop() {
    const tick = () => {
      if (this.disposed) return;
      const delta = this.clock.getDelta();
      const elapsed = this.clock.getElapsedTime();

      // Smooth camera preset damping
      this.camera.position.x = THREE.MathUtils.damp(this.camera.position.x, this.camTargetPos.x, 4.5, delta);
      this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, this.camTargetPos.y, 4.5, delta);
      this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z, this.camTargetPos.z, 4.5, delta);
      this.camCurrentLookAt.x = THREE.MathUtils.damp(this.camCurrentLookAt.x, this.camTargetLookAt.x, 4.5, delta);
      this.camCurrentLookAt.y = THREE.MathUtils.damp(this.camCurrentLookAt.y, this.camTargetLookAt.y, 4.5, delta);
      this.camCurrentLookAt.z = THREE.MathUtils.damp(this.camCurrentLookAt.z, this.camTargetLookAt.z, 4.5, delta);
      this.camera.lookAt(this.camCurrentLookAt);

      // Subtle architectural candle-warm shimmer & chandelier sway
      this.mihrabLight.intensity = 3.1 + Math.sin(elapsed * 2.1) * 0.14;
      this.chandelierGroup.rotation.z = Math.sin(elapsed * 0.45) * 0.008;

      this.scholar1Rig.update(delta, elapsed);
      this.scholar2Rig.update(delta, elapsed);

      this.renderer.render(this.scene, this.camera);

      if (this.isSoftwareGl) {
        this.afterDraw(tick);
      } else {
        this.frameId = requestAnimationFrame(tick);
      }
    };

    if (this.isSoftwareGl) {
      this.afterDraw(tick);
    } else {
      this.frameId = requestAnimationFrame(tick);
    }
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    window.clearTimeout(this.frameId);
    window.removeEventListener('resize', this.handleResize);
    this.resizeObserver?.disconnect();
    this.scholar1Rig.dispose();
    this.scholar2Rig.dispose();
    for (const item of this.disposables) {
      item.dispose();
    }
    this.disposables = [];
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
