import { ScholarAnimationSnapshot } from '../types/nuridua';

export interface ScholarRigColors {
  jacketLit: [number, number, number];
  jacketMid: [number, number, number];
  jacketDark: [number, number, number];
  shirtLit: [number, number, number];
  shirtShadow: [number, number, number];
  skinLit: [number, number, number];
  skinMid: [number, number, number];
  skinShadow: [number, number, number];
  palmWarm: [number, number, number];
}

export interface ScholarPhotoTextures {
  jacketPatch?: HTMLCanvasElement;
  skinPatch?: HTMLCanvasElement;
  dorsalHandL?: HTMLCanvasElement;
  dorsalHandR?: HTMLCanvasElement;
}

export const DEFAULT_SCHOLAR_PALETTES: [ScholarRigColors, ScholarRigColors] = [
  {
    jacketLit: [0.14, 0.22, 0.36],
    jacketMid: [0.095, 0.155, 0.27],
    jacketDark: [0.055, 0.095, 0.18],
    shirtLit: [0.91, 0.89, 0.86],
    shirtShadow: [0.74, 0.71, 0.68],
    skinLit: [0.84, 0.66, 0.55],
    skinMid: [0.75, 0.56, 0.45],
    skinShadow: [0.56, 0.39, 0.31],
    palmWarm: [0.86, 0.64, 0.56],
  },
  {
    jacketLit: [0.13, 0.2, 0.34],
    jacketMid: [0.085, 0.14, 0.25],
    jacketDark: [0.05, 0.085, 0.165],
    shirtLit: [0.91, 0.89, 0.87],
    shirtShadow: [0.74, 0.72, 0.69],
    skinLit: [0.85, 0.68, 0.57],
    skinMid: [0.76, 0.58, 0.47],
    skinShadow: [0.57, 0.4, 0.32],
    palmWarm: [0.87, 0.66, 0.58],
  },
];

export interface UVPoint {
  x: number;
  y: number;
}

export interface ArmHandGeometrySide {
  side: 'left' | 'right';
  shoulder: UVPoint;
  elbow: UVPoint;
  wrist: UVPoint;
  palmCenter: UVPoint;
  /** Direction vector angle in UV space from wrist -> middle fingertip */
  handAngleRad: number;
  /** Perspective foreshortening 0.38..1.0 based on wrist pitch/supination */
  handLengthScale: number;
  /** -1 = dorsal (face wipe), +1 = palmar (🤲🏻), 0 = edge transition */
  palmFacingSign: number;
  /** 0..1 natural finger flexion curl */
  fingerCurl: number;
}

export interface ScholarArmGeometryResult {
  shouldRender: boolean;
  opacity: number;
  handHideFactor: number;
  left: ArmHandGeometrySide;
  right: ArmHandGeometrySide;
}

interface ScholarLandmarks {
  cx: number;
  mouthY: number;
  foreheadY: number;
  chestY: number;
  shoulderL: UVPoint;
  shoulderR: UVPoint;
  elbowRestL: UVPoint;
  elbowRestR: UVPoint;
  wristRestL: UVPoint;
  wristRestR: UVPoint;
  handRestL: UVPoint;
  handRestR: UVPoint;
}

export const SCHOLAR_LANDMARKS: [ScholarLandmarks, ScholarLandmarks] = [
  {
    // Scholar 1: Hacı Ahmet Efendi (Left) — aligned to real elbow creases & hand centers
    cx: 0.2721,
    mouthY: 0.439,
    foreheadY: 0.392,
    chestY: 0.548,
    shoulderL: { x: 0.118, y: 0.494 },
    shoulderR: { x: 0.415, y: 0.494 },
    elbowRestL: { x: 0.082, y: 0.546 },
    elbowRestR: { x: 0.432, y: 0.546 },
    wristRestL: { x: 0.132, y: 0.596 },
    wristRestR: { x: 0.376, y: 0.592 },
    handRestL: { x: 0.1497, y: 0.6403 },
    handRestR: { x: 0.3548, y: 0.6265 },
  },
  {
    // Scholar 2: Hacı Mehmet Efendi (Right) — aligned to real elbow creases & hand centers
    cx: 0.7461,
    mouthY: 0.4342,
    foreheadY: 0.386,
    chestY: 0.544,
    shoulderL: { x: 0.595, y: 0.488 },
    shoulderR: { x: 0.892, y: 0.488 },
    elbowRestL: { x: 0.558, y: 0.542 },
    elbowRestR: { x: 0.908, y: 0.542 },
    wristRestL: { x: 0.612, y: 0.592 },
    wristRestR: { x: 0.888, y: 0.592 },
    handRestL: { x: 0.6348, y: 0.6261 },
    handRestR: { x: 0.8757, y: 0.6268 },
  },
];

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpPt(a: UVPoint, b: UVPoint, t: number): UVPoint {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / Math.max(1e-5, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * Computes exact anatomical arm, wrist, and palm coordinates in image UV space [0..1]
 * for one scholar across IDLE -> RAISING_HANDS -> AMEEN -> WIPING_FACE -> RETURNING_TO_IDLE.
 */
export function computeScholarArmGeometry(
  scholarIndex: 0 | 1,
  snapshot: Pick<
    ScholarAnimationSnapshot,
    'phase' | 'handLiftProgress' | 'palmOrientation' | 'wipeProgress' | 'fingerCurl'
  >,
  elapsedSec = 0
): ScholarArmGeometryResult {
  const lm = SCHOLAR_LANDMARKS[scholarIndex];
  const lift = clamp01(snapshot.handLiftProgress);
  const wipe = clamp01(snapshot.wipeProgress);

  // Subtle living breathing micro-sway only while hands are raised
  const breathFloatY = lift > 0.2 ? Math.sin(elapsedSec * 2.1 + scholarIndex * 1.4) * 0.002 * lift : 0;

  // Dual-hand target coordinates for open 🤲🏻 chest posture:
  // Elbows remain cleanly anchored at the real seated elbow fold while forearms angle upward to open chest palms.
  const duaElbowL: UVPoint = { x: lm.elbowRestL.x + 0.012, y: lm.elbowRestL.y - 0.002 };
  const duaElbowR: UVPoint = { x: lm.elbowRestR.x - 0.012, y: lm.elbowRestR.y - 0.002 };
  const duaWristL: UVPoint = { x: lm.cx - 0.056, y: lm.chestY - 0.008 + breathFloatY };
  const duaWristR: UVPoint = { x: lm.cx + 0.056, y: lm.chestY - 0.008 + breathFloatY };
  const duaPalmL: UVPoint = { x: lm.cx - 0.031, y: lm.chestY - 0.046 + breathFloatY };
  const duaPalmR: UVPoint = { x: lm.cx + 0.031, y: lm.chestY - 0.046 + breathFloatY };

  // Face wipe spline (chest 🤲🏻 -> temples/upper cheeks -> cheekbones & beard -> gentle downward release)
  const wLift = smoothstep(0.0, 0.30, wipe);
  const wGlide = smoothstep(0.28, 0.84, wipe);
  const wRelease = smoothstep(0.80, 1.0, wipe);

  // Lateral clearance glides along temples, cheekbones & outer beard cleanly without colliding with glasses/nose
  const wipeOffsetX =
    0.034 +
    0.012 * wLift -
    0.008 * wGlide +
    0.010 * wRelease;

  const templePalmY = lm.foreheadY + 0.010;
  const cheekBeardPalmY = lm.mouthY + 0.006;
  const wipePalmY =
    duaPalmL.y +
    (templePalmY - duaPalmL.y) * wLift +
    (cheekBeardPalmY - templePalmY) * wGlide +
    0.018 * wRelease;

  const wipeWristY = wipePalmY + lerp(0.036, 0.033, wLift) + 0.004 * wRelease;
  const wipeWristXOff = wipeOffsetX + lerp(0.024, 0.016, wLift);
  const wipeElbowLiftY = -0.012 * wLift + 0.006 * wGlide + 0.006 * wRelease;

  // Blend from Dua chest posture -> Wipe face trajectory seamlessly (C0 continuous at wipe = 0)
  const wipeBlend = smoothstep(0.0, 0.14, wipe);
  const targetElbowL: UVPoint = { x: lm.elbowRestL.x + 0.008 - 0.003 * wLift, y: lm.elbowRestL.y - 0.004 + wipeElbowLiftY };
  const targetElbowR: UVPoint = { x: lm.elbowRestR.x - 0.008 + 0.003 * wLift, y: lm.elbowRestR.y - 0.004 + wipeElbowLiftY };

  const targetWristL: UVPoint = lerpPt(duaWristL, { x: lm.cx - wipeWristXOff, y: wipeWristY }, wipeBlend);
  const targetWristR: UVPoint = lerpPt(duaWristR, { x: lm.cx + wipeWristXOff, y: wipeWristY }, wipeBlend);

  const targetPalmL: UVPoint = lerpPt(duaPalmL, { x: lm.cx - wipeOffsetX, y: wipePalmY }, wipeBlend);
  const targetPalmR: UVPoint = lerpPt(duaPalmR, { x: lm.cx + wipeOffsetX, y: wipePalmY }, wipeBlend);

  // Smooth natural upward-inward wrist arc from lap
  const liftArc = Math.sin(lift * Math.PI) * 0.010;
  const elbowL = lerpPt(lm.elbowRestL, targetElbowL, lift);
  const elbowR = lerpPt(lm.elbowRestR, targetElbowR, lift);
  const wristL: UVPoint = {
    x: lerp(lm.wristRestL.x, targetWristL.x, lift) - liftArc,
    y: lerp(lm.wristRestL.y, targetWristL.y, lift) - liftArc * 0.4,
  };
  const wristR: UVPoint = {
    x: lerp(lm.wristRestR.x, targetWristR.x, lift) + liftArc,
    y: lerp(lm.wristRestR.y, targetWristR.y, lift) - liftArc * 0.4,
  };
  const palmL = lerpPt(lm.handRestL, targetPalmL, lift);
  const palmR = lerpPt(lm.handRestR, targetPalmR, lift);

  // Hand orientation angle (in pixel space aspect ~1.7916)
  const uvAspectY = 1376 / 768;
  const angleFromWristToPalm = (w: UVPoint, p: UVPoint) =>
    Math.atan2((p.y - w.y) * uvAspectY, p.x - w.x);

  const handAngleL = angleFromWristToPalm(wristL, palmL);
  const handAngleR = angleFromWristToPalm(wristR, palmR);

  const isWiping = wipe > 0.02;
  const handLengthScale = lerp(0.95, isWiping ? 0.96 : 0.96, lift);

  const opacity = smoothstep(0.02, 0.24, lift);
  const handHideFactor = smoothstep(0.04, 0.28, lift);

  return {
    shouldRender: lift > 0.015 && opacity > 0.01,
    opacity,
    handHideFactor,
    left: {
      side: 'left',
      shoulder: lm.shoulderL,
      elbow: elbowL,
      wrist: wristL,
      palmCenter: palmL,
      handAngleRad: handAngleL,
      handLengthScale,
      palmFacingSign: snapshot.palmOrientation,
      fingerCurl: snapshot.fingerCurl,
    },
    right: {
      side: 'right',
      shoulder: lm.shoulderR,
      elbow: elbowR,
      wrist: wristR,
      palmCenter: palmR,
      handAngleRad: handAngleR,
      handLengthScale,
      palmFacingSign: snapshot.palmOrientation,
      fingerCurl: snapshot.fingerCurl,
    },
  };
}

function rgbStr(c: [number, number, number], alpha = 1): string {
  const r = Math.round(Math.max(0, Math.min(1, c[0])) * 255);
  const g = Math.round(Math.max(0, Math.min(1, c[1])) * 255);
  const b = Math.round(Math.max(0, Math.min(1, c[2])) * 255);
  return alpha >= 0.999 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
}

function mixRgb(
  a: [number, number, number],
  b: [number, number, number],
  t: number
): [number, number, number] {
  const k = clamp01(t);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

export interface UVToCanvasMapper {
  (pt: UVPoint): { px: number; py: number };
  scalePx: number;
}

function drawSleeveWithPhotoTexture(
  ctx: CanvasRenderingContext2D,
  s: { px: number; py: number },
  e: { px: number; py: number },
  w: { px: number; py: number },
  u: number,
  colors: ScholarRigColors,
  jacketPattern: CanvasPattern | null,
  showShirtCuff = true
): void {
  const armDx = w.px - e.px;
  const armDy = w.py - e.py;
  const armLen = Math.max(4, Math.hypot(armDx, armDy));
  const armAngle = Math.atan2(armDy, armDx);
  const perpX = -Math.sin(armAngle);
  const perpY = Math.cos(armAngle);

  // Anchor gently inside real elbow bend so sleeve dissolves seamlessly into upper arm without a bulky lump
  const originX = e.px + (s.px - e.px) * 0.08;
  const originY = e.py + (s.py - e.py) * 0.08;

  const elbowRadius = u * 0.032;
  const cuffRadius = u * 0.022;

  const traceSleevePath = () => {
    ctx.beginPath();
    ctx.moveTo(originX - perpX * elbowRadius, originY - perpY * elbowRadius);
    ctx.quadraticCurveTo(
      (originX + w.px) * 0.5 - perpX * (elbowRadius + cuffRadius) * 0.52,
      (originY + w.py) * 0.5 - perpY * (elbowRadius + cuffRadius) * 0.52,
      w.px - perpX * cuffRadius,
      w.py - perpY * cuffRadius
    );
    // Slightly rounded tailored cuff rim
    ctx.quadraticCurveTo(
      w.px + (armDx / armLen) * (u * 0.004),
      w.py + (armDy / armLen) * (u * 0.004),
      w.px + perpX * cuffRadius,
      w.py + perpY * cuffRadius
    );
    ctx.quadraticCurveTo(
      (originX + w.px) * 0.5 + perpX * (elbowRadius + cuffRadius) * 0.52,
      (originY + w.py) * 0.5 + perpY * (elbowRadius + cuffRadius) * 0.52,
      originX + perpX * elbowRadius,
      originY + perpY * elbowRadius
    );
    // Rounded elbow curve so there is never a hard straight rectangle edge
    ctx.quadraticCurveTo(
      originX - (armDx / armLen) * (elbowRadius * 0.38),
      originY - (armDy / armLen) * (elbowRadius * 0.38),
      originX - perpX * elbowRadius,
      originY - perpY * elbowRadius
    );
    ctx.closePath();
  };

  ctx.save();

  // Build directional wool-fabric fill + cylindrical light wrap + wide elbow origin fade
  traceSleevePath();
  ctx.clip();

  if (jacketPattern) {
    ctx.save();
    ctx.translate(w.px, w.py);
    ctx.rotate(armAngle);
    ctx.fillStyle = jacketPattern;
    ctx.fillRect(-armLen * 1.4, -elbowRadius * 1.4, armLen * 1.6, elbowRadius * 2.8);
    ctx.restore();
  } else {
    ctx.fillStyle = rgbStr(colors.jacketMid);
    traceSleevePath();
    ctx.fill();
  }

  // Cylindrical suit lighting gradient matched to crisp navy wool
  const cylGrad = ctx.createLinearGradient(
    w.px - perpX * cuffRadius,
    w.py - perpY * cuffRadius,
    w.px + perpX * cuffRadius,
    w.py + perpY * cuffRadius
  );
  cylGrad.addColorStop(0, rgbStr(colors.jacketLit, 0.48));
  cylGrad.addColorStop(0.50, 'rgba(0,0,0,0)');
  cylGrad.addColorStop(1, rgbStr(colors.jacketDark, 0.16));
  ctx.fillStyle = cylGrad;
  traceSleevePath();
  ctx.fill();

  // Gentle longitudinal fabric crease
  ctx.strokeStyle = rgbStr(colors.jacketDark, 0.22);
  ctx.lineWidth = Math.max(1, u * 0.0018);
  ctx.beginPath();
  ctx.moveTo(lerp(originX, w.px, 0.28) - perpX * cuffRadius * 0.25, lerp(originY, w.py, 0.28) - perpY * cuffRadius * 0.25);
  ctx.quadraticCurveTo(
    lerp(originX, w.px, 0.62),
    lerp(originY, w.py, 0.62),
    lerp(originX, w.px, 0.88) + perpX * cuffRadius * 0.32,
    lerp(originY, w.py, 0.88) + perpY * cuffRadius * 0.32
  );
  ctx.stroke();

  // Smooth destination-out feather across upper half of forearm so sleeve merges invisibly into upper arm photo
  const featherGrad = ctx.createLinearGradient(originX, originY, lerp(originX, w.px, 0.46), lerp(originY, w.py, 0.46));
  featherGrad.addColorStop(0, 'rgba(0,0,0,0.95)');
  featherGrad.addColorStop(0.48, 'rgba(0,0,0,0.45)');
  featherGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = featherGrad;
  ctx.fillRect(
    Math.min(originX, w.px) - elbowRadius * 1.5,
    Math.min(originY, w.py) - elbowRadius * 1.5,
    Math.abs(w.px - originX) + elbowRadius * 3,
    Math.abs(w.py - originY) + elbowRadius * 3
  );
  ctx.restore();

  if (showShirtCuff) {
    // Subtle tucked ivory-white shirt cuff peeking softly inside sleeve end
    ctx.save();
    const cuffExt = u * 0.0028;
    const cuffCx = w.px - (armDx / armLen) * (u * 0.0012);
    const cuffCy = w.py - (armDy / armLen) * (u * 0.0012);
    const softShirt = mixRgb(colors.shirtLit, colors.shirtShadow, 0.38);
    const shirtGrad = ctx.createLinearGradient(
      cuffCx - perpX * cuffRadius * 0.56,
      cuffCy - perpY * cuffRadius * 0.56,
      cuffCx + perpX * cuffRadius * 0.56,
      cuffCy + perpY * cuffRadius * 0.56
    );
    shirtGrad.addColorStop(0, rgbStr(softShirt, 0.72));
    shirtGrad.addColorStop(0.65, rgbStr(colors.shirtShadow, 0.72));
    shirtGrad.addColorStop(1, rgbStr(mixRgb(colors.shirtShadow, colors.jacketDark, 0.45), 0.72));

    ctx.translate(cuffCx, cuffCy);
    ctx.rotate(armAngle);
    ctx.fillStyle = shirtGrad;
    ctx.beginPath();
    ctx.roundRect(-cuffExt * 0.5, -cuffRadius * 0.52, cuffExt * 0.9, cuffRadius * 1.04, u * 0.0022);
    ctx.fill();
    ctx.restore();
  }
}

/**
 * Draws one articulated sleeve + shirt cuff + photorealistically textured 5-finger hand
 * onto Canvas2D. Uses photographic skin/fabric patches & real dorsal hand sprites when supplied.
 */
function drawArmAndHandSide(
  ctx: CanvasRenderingContext2D,
  geom: ArmHandGeometrySide,
  colors: ScholarRigColors,
  opacity: number,
  mapPt: UVToCanvasMapper,
  textures?: ScholarPhotoTextures
): void {
  const s = mapPt(geom.shoulder);
  const e = mapPt(geom.elbow);
  const w = mapPt(geom.wrist);
  const p = mapPt(geom.palmCenter);
  const u = mapPt.scalePx;
  const isViewerLeft = geom.side === 'left';

  const jacketPattern =
    textures?.jacketPatch && typeof ctx.createPattern === 'function'
      ? ctx.createPattern(textures.jacketPatch, 'repeat')
      : null;
  const skinPattern =
    textures?.skinPatch && typeof ctx.createPattern === 'function'
      ? ctx.createPattern(textures.skinPatch, 'repeat')
      : null;

  const armDx = w.px - e.px;
  const armDy = w.py - e.py;

  ctx.save();
  ctx.globalAlpha = opacity;

  // 1. Subtle diffused ambient occlusion under wrist & raised hand (zero dark elbow smear)
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const traceAoPath = () => {
    ctx.beginPath();
    ctx.moveTo(e.px + armDx * 0.45, e.py + armDy * 0.45 + u * 0.008);
    ctx.lineTo(w.px, w.py + u * 0.011);
    ctx.lineTo(p.px, p.py + u * 0.013);
  };
  ctx.lineWidth = u * 0.036;
  ctx.strokeStyle = 'rgba(10, 8, 6, 0.05)';
  traceAoPath();
  ctx.stroke();
  ctx.lineWidth = u * 0.024;
  ctx.strokeStyle = 'rgba(10, 8, 6, 0.09)';
  traceAoPath();
  ctx.stroke();
  ctx.restore();

  const isPalmar = geom.palmFacingSign >= -0.05;

  // 2. Photographic navy wool forearm sleeve (+ tucked shirt cuff during raised palms)
  drawSleeveWithPhotoTexture(ctx, s, e, w, u, colors, jacketPattern, isPalmar);

  // 3. Hand Rendering:
  //    - If dorsal (palmFacingSign < -0.05, i.e., WIPING_FACE) AND photographic hand sprite exists:
  //      composite the scholar's ACTUAL photographic dorsal hand sprite across temples/cheeks/beard
  //    - If palmar 🤲🏻 (AMEEN / RAISING_HANDS):
  //      render sculpted anatomical 5-finger cupped palm filled with real photographic skin texture!
  const dorsalSprite = isViewerLeft ? textures?.dorsalHandL : textures?.dorsalHandR;

  if (!isPalmar && dorsalSprite && dorsalSprite.width > 8 && dorsalSprite.height > 8) {
    ctx.save();
    ctx.translate(w.px, w.py);
    ctx.rotate(geom.handAngleRad + Math.PI * 0.5);
    const handH = u * 0.118 * geom.handLengthScale;
    const clampedAspect = Math.max(0.76, Math.min(1.06, dorsalSprite.width / dorsalSprite.height));
    const handW = handH * clampedAspect;
    // Align wrist base at (0,0), fingers extending toward -Y onto temples/cheeks
    ctx.drawImage(dorsalSprite, -handW * 0.5, -handH * 0.88, handW, handH);
    ctx.restore();
    ctx.restore();
    return;
  }

  // Palmar 🤲🏻 sculpted 5-finger hand with real sampled skin texture & rich 3D lighting
  ctx.save();
  ctx.translate(w.px, w.py);
  ctx.rotate(geom.handAngleRad);
  if (!isViewerLeft) {
    ctx.scale(1, -1);
  }

  const lenScale = geom.handLengthScale;
  const wristToKnuckle = u * 0.056 * lenScale;
  const palmHalfW = u * 0.0285 * (0.82 + 0.18 * Math.abs(geom.palmFacingSign));
  const palmCenterX = wristToKnuckle * 0.54;
  const curl = clamp01(geom.fingerCurl);

  const mainSkin = isPalmar
    ? mixRgb(colors.skinMid, colors.palmWarm, 0.42)
    : colors.skinLit;
  const edgeSkin = colors.skinShadow;
  const tipSkin = mixRgb(mainSkin, colors.skinLit, 0.22);

  // Soft realistic cast shadow behind palm & fingers onto white shirt/chest
  ctx.save();
  ctx.translate(u * 0.004, u * 0.007);
  ctx.fillStyle = 'rgba(14, 18, 30, 0.18)';
  ctx.beginPath();
  ctx.ellipse(palmCenterX * 1.15, 0, wristToKnuckle * 0.85, palmHalfW * 1.05, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const applySkinTextureOverlay = () => {
    if (!skinPattern) return;
    ctx.save();
    ctx.globalAlpha = opacity * 0.72;
    ctx.fillStyle = skinPattern;
    ctx.fill();
    ctx.restore();
  };

  // Wrist heel
  const wristGrad = ctx.createLinearGradient(0, -palmHalfW * 0.72, 0, palmHalfW * 0.72);
  wristGrad.addColorStop(0, rgbStr(colors.skinLit));
  wristGrad.addColorStop(0.55, rgbStr(mainSkin));
  wristGrad.addColorStop(1, rgbStr(edgeSkin));
  ctx.fillStyle = wristGrad;
  ctx.beginPath();
  ctx.ellipse(u * 0.01, 0, u * 0.017, palmHalfW * 0.68, 0, 0, Math.PI * 2);
  ctx.fill();
  applySkinTextureOverlay();

  // Four articulated fingers with 3D cylindrical cross-shading & deep inter-finger creases
  const fingerSpecs = [
    { yOffset: -palmHalfW * 0.58, length: u * 0.053 * lenScale, width: u * 0.0124, spreadAngle: -0.045 },
    { yOffset: -palmHalfW * 0.18, length: u * 0.058 * lenScale, width: u * 0.0128, spreadAngle: -0.012 },
    { yOffset: palmHalfW * 0.22, length: u * 0.054 * lenScale, width: u * 0.0122, spreadAngle: 0.018 },
    { yOffset: palmHalfW * 0.6, length: u * 0.043 * lenScale, width: u * 0.0108, spreadAngle: 0.052 },
  ];
  const curlLenScale = 1 - curl * 0.16;

  for (const f of fingerSpecs) {
    const baseX = wristToKnuckle * 0.86;
    const baseY = f.yOffset;
    const fLen = f.length * curlLenScale;
    const hw = f.width * 0.5;

    ctx.save();
    ctx.translate(baseX, baseY);
    ctx.rotate(f.spreadAngle - curl * 0.04);

    // Base photographic skin + longitudinal gradient
    const fGrad = ctx.createLinearGradient(0, -hw, fLen, hw);
    fGrad.addColorStop(0, rgbStr(mixRgb(mainSkin, edgeSkin, 0.14)));
    fGrad.addColorStop(0.55, rgbStr(tipSkin));
    fGrad.addColorStop(1, rgbStr(mixRgb(tipSkin, edgeSkin, 0.38)));

    ctx.fillStyle = fGrad;
    ctx.beginPath();
    ctx.moveTo(0, -hw);
    ctx.quadraticCurveTo(fLen * 0.55, -hw * 0.92, fLen - hw * 0.85, -hw * 0.78);
    ctx.arc(fLen - hw * 0.85, 0, hw * 0.78, -Math.PI * 0.5, Math.PI * 0.5);
    ctx.quadraticCurveTo(fLen * 0.55, hw * 0.92, 0, hw);
    ctx.closePath();
    ctx.fill();
    applySkinTextureOverlay();

    // Cylindrical cross-finger 3D volume shading (soft lit ridge -> natural shadow)
    const fCross = ctx.createLinearGradient(0, -hw, 0, hw);
    fCross.addColorStop(0, rgbStr(edgeSkin, 0.22));
    fCross.addColorStop(0.34, 'rgba(255,245,235,0.10)');
    fCross.addColorStop(0.75, 'rgba(0,0,0,0)');
    fCross.addColorStop(1, rgbStr(edgeSkin, 0.28));
    ctx.fillStyle = fCross;
    ctx.fill();

    // Soft natural inter-finger edge occlusion
    ctx.strokeStyle = rgbStr(edgeSkin, 0.22);
    ctx.lineWidth = Math.max(0.8, u * 0.0011);
    ctx.stroke();

    // Subtle phalanx creases
    ctx.strokeStyle = rgbStr(edgeSkin, 0.32);
    ctx.lineWidth = Math.max(0.7, u * 0.001);
    for (const frac of [0.38, 0.68]) {
      ctx.beginPath();
      ctx.moveTo(fLen * frac, -hw * 0.52);
      ctx.lineTo(fLen * frac, hw * 0.52);
      ctx.stroke();
    }

    ctx.restore();
  }

  // Sculpted cupped palm body
  const palmGrad = isPalmar
    ? ctx.createRadialGradient(
        palmCenterX * 1.02,
        0,
        u * 0.004,
        palmCenterX,
        0,
        palmHalfW * 1.4
      )
    : ctx.createLinearGradient(
        palmCenterX - u * 0.018,
        -palmHalfW,
        palmCenterX + u * 0.022,
        palmHalfW
      );

  if (isPalmar) {
    palmGrad.addColorStop(0, rgbStr(mixRgb(colors.palmWarm, colors.skinShadow, 0.22)));
    palmGrad.addColorStop(0.55, rgbStr(mainSkin));
    palmGrad.addColorStop(1, rgbStr(colors.skinLit));
  } else {
    palmGrad.addColorStop(0, rgbStr(colors.skinLit));
    palmGrad.addColorStop(0.6, rgbStr(mainSkin));
    palmGrad.addColorStop(1, rgbStr(edgeSkin));
  }

  ctx.fillStyle = palmGrad;
  ctx.beginPath();
  ctx.ellipse(palmCenterX, 0, wristToKnuckle * 0.54, palmHalfW * 0.94, 0, 0, Math.PI * 2);
  ctx.fill();
  applySkinTextureOverlay();

  // Subtle palmar life/head creases
  if (isPalmar) {
    ctx.strokeStyle = rgbStr(edgeSkin, 0.24);
    ctx.lineWidth = Math.max(0.7, u * 0.0011);
    ctx.beginPath();
    ctx.moveTo(palmCenterX - u * 0.01, -palmHalfW * 0.26);
    ctx.quadraticCurveTo(palmCenterX + u * 0.007, -palmHalfW * 0.02, palmCenterX + u * 0.012, palmHalfW * 0.54);
    ctx.stroke();
  }

  // Outer Thumb (natural relaxed anatomical angle on local -Y)
  ctx.save();
  const thumbX = wristToKnuckle * 0.4;
  const thumbY = -palmHalfW * 0.74;
  const thumbAngle = isPalmar ? -0.44 : -0.22;
  const thumbLen = u * (isPalmar ? 0.039 : 0.034) * lenScale;
  const thumbHw = u * 0.006;

  ctx.translate(thumbX, thumbY);
  ctx.rotate(thumbAngle);

  const thumbGrad = ctx.createLinearGradient(0, -thumbHw, thumbLen, thumbHw);
  thumbGrad.addColorStop(0, rgbStr(colors.skinLit));
  thumbGrad.addColorStop(0.65, rgbStr(mainSkin));
  thumbGrad.addColorStop(1, rgbStr(mixRgb(mainSkin, edgeSkin, 0.35)));

  ctx.fillStyle = thumbGrad;
  ctx.beginPath();
  ctx.moveTo(-u * 0.007, -thumbHw * 1.12);
  ctx.quadraticCurveTo(thumbLen * 0.5, -thumbHw * 1.02, thumbLen - thumbHw * 0.85, -thumbHw * 0.85);
  ctx.arc(thumbLen - thumbHw * 0.85, 0, thumbHw * 0.85, -Math.PI * 0.5, Math.PI * 0.5);
  ctx.quadraticCurveTo(thumbLen * 0.45, thumbHw * 1.02, -u * 0.009, thumbHw * 1.2);
  ctx.closePath();
  ctx.fill();
  applySkinTextureOverlay();

  ctx.strokeStyle = rgbStr(edgeSkin, 0.16);
  ctx.lineWidth = Math.max(0.6, u * 0.001);
  ctx.stroke();
  ctx.restore();

  ctx.restore(); // end hand local transform
  ctx.restore(); // end side opacity
}

export function renderScholarArmsAndHands(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  geometries: [ScholarArmGeometryResult, ScholarArmGeometryResult],
  palettes: [ScholarRigColors, ScholarRigColors],
  mapPt: UVToCanvasMapper,
  photoTextures?: [ScholarPhotoTextures, ScholarPhotoTextures]
): void {
  ctx.clearRect(0, 0, width, height);
  for (let i = 0; i < 2; i++) {
    const geom = geometries[i];
    if (!geom.shouldRender) continue;
    const tex = photoTextures?.[i];
    drawArmAndHandSide(ctx, geom.left, palettes[i], geom.opacity, mapPt, tex);
    drawArmAndHandSide(ctx, geom.right, palettes[i], geom.opacity, mapPt, tex);
  }
}
