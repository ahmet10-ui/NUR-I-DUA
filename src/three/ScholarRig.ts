import * as THREE from 'three';
import { IScholarCharacterRig, ScholarId, ScholarProfile } from '../types/nuridua';

export interface RigTuningOptions {
  blinkIntervalSec: number;
  headMovementIntensity: number;
  idleBreathingIntensity: number;
  listenerInteractionEnabled: boolean;
}

/**
 * Composite multi-part Three.js character rig representing an elderly Turkish Muslim scholar
 * seated respectfully on a mosque cushion, wearing a blue prayer cap (takke),
 * navy blue suit jacket, crisp white shirt, and matching formal blue trousers.
 *
 * Designed strictly behind `IScholarCharacterRig` so a licensed GLTF/VRM photorealistic
 * humanoid model can drop in via `GLTFHumanoidAdapter` without changing the scene controller.
 */
export class ProceduralScholarRig implements IScholarCharacterRig {
  readonly id: ScholarId;
  readonly providerType = 'procedural' as const;
  readonly group: THREE.Group;

  private torsoGroup: THREE.Group;
  private headGroup: THREE.Group;
  private jawGroup: THREE.Group;
  private upperEyelidL: THREE.Mesh;
  private upperEyelidR: THREE.Mesh;
  private armLGroup: THREE.Group;
  private armRGroup: THREE.Group;
  private forearmLGroup: THREE.Group;
  private forearmRGroup: THREE.Group;

  private isSpeaking = false;
  private listeningTarget: 'left' | 'right' | 'center' = 'center';
  private targetMouthOpen = 0;
  private currentMouthOpen = 0;

  private blinkTimer = 1.8;
  private blinkProgress = 0;
  private isBlinking = false;
  private phaseOffset: number;
  private tuning: RigTuningOptions;

  private disposables: Array<{ dispose: () => void }> = [];

  constructor(profile: ScholarProfile, tuning: RigTuningOptions, phaseOffset = 0) {
    this.id = profile.id;
    this.tuning = { ...tuning };
    this.phaseOffset = phaseOffset;
    this.blinkTimer = 1.5 + phaseOffset * 0.9;

    this.group = new THREE.Group();
    this.group.name = `Scholar_${profile.id}`;

    const track = <T extends { dispose: () => void }>(item: T): T => {
      this.disposables.push(item);
      return item;
    };

    // Calibrated PBR materials with distinct roughness separation
    const jacketMat = track(
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(profile.jacketColor || '#101F42'),
        roughness: 0.78,
        metalness: 0.04,
      })
    );
    const trousersMat = track(
      new THREE.MeshStandardMaterial({
        color: new THREE.Color('#142856'),
        roughness: 0.74,
        metalness: 0.05,
      })
    );
    const shirtMat = track(
      new THREE.MeshStandardMaterial({
        color: new THREE.Color('#F5F7FA'),
        roughness: 0.62,
        metalness: 0.02,
      })
    );
    const capMat = track(
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(profile.capColor || '#1E3A8A'),
        roughness: 0.72,
        metalness: 0.06,
      })
    );
    const goldTrimMat = track(
      new THREE.MeshStandardMaterial({
        color: new THREE.Color('#C9A45C'),
        roughness: 0.32,
        metalness: 0.85,
      })
    );
    const skinMat = track(
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(profile.id === 'scholar_1' ? '#D9AA88' : '#D2A17E'),
        roughness: 0.58,
        metalness: 0.02,
      })
    );
    const beardMat = track(
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(profile.beardStyle === 'full_white' ? '#EAECEF' : '#CFD5DF'),
        roughness: 0.88,
        metalness: 0.02,
      })
    );
    const eyeWhiteMat = track(
      new THREE.MeshStandardMaterial({
        color: 0xf8fafc,
        roughness: 0.22,
        metalness: 0.0,
      })
    );
    const irisMat = track(
      new THREE.MeshStandardMaterial({
        color: 0x3b2618,
        roughness: 0.18,
        metalness: 0.05,
      })
    );
    const lipMat = track(
      new THREE.MeshStandardMaterial({
        color: 0xb67b67,
        roughness: 0.55,
      })
    );
    const cushionMat = track(
      new THREE.MeshStandardMaterial({
        color: 0x162b5c,
        roughness: 0.82,
        metalness: 0.05,
      })
    );
    const shoeMat = track(
      new THREE.MeshStandardMaterial({
        color: 0x1a1d24,
        roughness: 0.45,
        metalness: 0.12,
      })
    );

    // 1. Seated Cushion (Minder) grounded at y = 0
    const cushionGeo = track(new THREE.CylinderGeometry(0.42, 0.46, 0.11, 28));
    const cushion = new THREE.Mesh(cushionGeo, cushionMat);
    cushion.position.set(0, 0.055, 0);
    cushion.scale.set(1.1, 1, 0.92);
    cushion.castShadow = true;
    cushion.receiveShadow = true;
    this.group.add(cushion);

    const cushionPipingGeo = track(new THREE.TorusGeometry(0.43, 0.012, 10, 32));
    const cushionPiping = new THREE.Mesh(cushionPipingGeo, goldTrimMat);
    cushionPiping.rotation.x = Math.PI / 2;
    cushionPiping.position.set(0, 0.105, 0);
    cushionPiping.scale.set(1.08, 0.9, 1);
    this.group.add(cushionPiping);

    // 2. Respectful Seated Lower Body (Formal Blue Trousers, cross-legged / kneeling base)
    const pelvisGeo = track(new THREE.CylinderGeometry(0.21, 0.24, 0.14, 18));
    const pelvis = new THREE.Mesh(pelvisGeo, trousersMat);
    pelvis.position.set(0, 0.16, -0.02);
    pelvis.scale.set(1.15, 1, 0.9);
    pelvis.castShadow = true;
    pelvis.receiveShadow = true;
    this.group.add(pelvis);

    const thighGeo = track(new THREE.CapsuleGeometry(0.088, 0.27, 8, 14));
    const thighL = new THREE.Mesh(thighGeo, trousersMat);
    thighL.position.set(-0.17, 0.15, 0.12);
    thighL.rotation.set(Math.PI / 2 - 0.1, 0, -0.45);
    thighL.castShadow = true;
    this.group.add(thighL);

    const thighR = new THREE.Mesh(thighGeo, trousersMat);
    thighR.position.set(0.17, 0.15, 0.12);
    thighR.rotation.set(Math.PI / 2 - 0.1, 0, 0.45);
    thighR.castShadow = true;
    this.group.add(thighR);

    const shinGeo = track(new THREE.CapsuleGeometry(0.072, 0.25, 8, 14));
    const shinL = new THREE.Mesh(shinGeo, trousersMat);
    shinL.position.set(-0.08, 0.11, 0.24);
    shinL.rotation.set(0, 0.2, Math.PI / 2 - 0.12);
    shinL.castShadow = true;
    this.group.add(shinL);

    const shinR = new THREE.Mesh(shinGeo, trousersMat);
    shinR.position.set(0.08, 0.12, 0.21);
    shinR.rotation.set(0, -0.2, -Math.PI / 2 + 0.12);
    shinR.castShadow = true;
    this.group.add(shinR);

    const footGeo = track(new THREE.SphereGeometry(0.06, 12, 10));
    const footL = new THREE.Mesh(footGeo, shoeMat);
    footL.position.set(0.16, 0.1, 0.21);
    footL.scale.set(1.2, 0.7, 0.85);
    this.group.add(footL);

    const footR = new THREE.Mesh(footGeo, shoeMat);
    footR.position.set(-0.16, 0.1, 0.23);
    footR.scale.set(1.2, 0.7, 0.85);
    this.group.add(footR);

    // 3. Torso (Navy Blue Suit Jacket + Crisp White Shirt)
    this.torsoGroup = new THREE.Group();
    this.torsoGroup.position.set(0, 0.21, -0.02);
    this.group.add(this.torsoGroup);

    const chestGeo = track(new THREE.CylinderGeometry(0.21, 0.20, 0.44, 20));
    const chest = new THREE.Mesh(chestGeo, jacketMat);
    chest.position.set(0, 0.23, 0);
    chest.scale.set(1.18, 1, 0.78);
    chest.castShadow = true;
    chest.receiveShadow = true;
    this.torsoGroup.add(chest);

    // Shoulders roundness
    const shouldersGeo = track(new THREE.CapsuleGeometry(0.095, 0.34, 8, 16));
    const shoulders = new THREE.Mesh(shouldersGeo, jacketMat);
    shoulders.position.set(0, 0.41, 0);
    shoulders.rotation.z = Math.PI / 2;
    shoulders.scale.set(1, 1, 0.88);
    shoulders.castShadow = true;
    this.torsoGroup.add(shoulders);

    // White dress shirt front V-placket & collar
    const shirtFrontGeo = track(new THREE.ConeGeometry(0.11, 0.28, 4));
    const shirtFront = new THREE.Mesh(shirtFrontGeo, shirtMat);
    shirtFront.position.set(0, 0.33, 0.115);
    shirtFront.rotation.z = Math.PI;
    shirtFront.rotation.y = Math.PI / 4;
    shirtFront.scale.set(0.95, 1, 0.45);
    this.torsoGroup.add(shirtFront);

    const collarGeo = track(new THREE.TorusGeometry(0.088, 0.02, 10, 20));
    const shirtCollar = new THREE.Mesh(collarGeo, shirtMat);
    shirtCollar.position.set(0, 0.47, 0.015);
    shirtCollar.rotation.x = Math.PI / 2 + 0.18;
    this.torsoGroup.add(shirtCollar);

    // Suit jacket lapels
    const lapelGeo = track(new THREE.BoxGeometry(0.045, 0.24, 0.025));
    const lapelL = new THREE.Mesh(lapelGeo, jacketMat);
    lapelL.position.set(-0.068, 0.34, 0.145);
    lapelL.rotation.set(-0.1, 0.2, -0.22);
    this.torsoGroup.add(lapelL);

    const lapelR = new THREE.Mesh(lapelGeo, jacketMat);
    lapelR.position.set(0.068, 0.34, 0.145);
    lapelR.rotation.set(-0.1, -0.2, 0.22);
    this.torsoGroup.add(lapelR);

    // Subtle pocket square accent on jacket
    const pocketSquareGeo = track(new THREE.BoxGeometry(0.045, 0.018, 0.01));
    const pocketSquare = new THREE.Mesh(pocketSquareGeo, shirtMat);
    pocketSquare.position.set(0.125, 0.35, 0.14);
    pocketSquare.rotation.z = 0.08;
    this.torsoGroup.add(pocketSquare);

    // 4. Arms & Forearms (Respectful resting / gentle dua gesture)
    const upperArmGeo = track(new THREE.CapsuleGeometry(0.062, 0.22, 8, 12));
    const forearmGeo = track(new THREE.CapsuleGeometry(0.052, 0.20, 8, 12));
    const cuffGeo = track(new THREE.CylinderGeometry(0.05, 0.05, 0.022, 12));
    const handGeo = track(new THREE.SphereGeometry(0.048, 12, 10));

    this.armLGroup = new THREE.Group();
    this.armLGroup.position.set(-0.23, 0.41, 0.0);
    this.torsoGroup.add(this.armLGroup);

    const upperArmL = new THREE.Mesh(upperArmGeo, jacketMat);
    upperArmL.position.set(-0.02, -0.14, 0.03);
    upperArmL.rotation.set(-0.22, 0, 0.16);
    upperArmL.castShadow = true;
    this.armLGroup.add(upperArmL);

    this.forearmLGroup = new THREE.Group();
    this.forearmLGroup.position.set(-0.04, -0.26, 0.07);
    this.armLGroup.add(this.forearmLGroup);

    const forearmL = new THREE.Mesh(forearmGeo, jacketMat);
    forearmL.position.set(0.06, -0.02, 0.12);
    forearmL.rotation.set(Math.PI / 2 - 0.15, 0, -0.35);
    forearmL.castShadow = true;
    this.forearmLGroup.add(forearmL);

    const cuffL = new THREE.Mesh(cuffGeo, shirtMat);
    cuffL.position.set(0.11, -0.04, 0.22);
    cuffL.rotation.set(Math.PI / 2 - 0.15, 0, -0.35);
    this.forearmLGroup.add(cuffL);

    const handL = new THREE.Mesh(handGeo, skinMat);
    handL.position.set(0.13, -0.04, 0.26);
    handL.scale.set(0.95, 0.65, 1.25);
    handL.castShadow = true;
    this.forearmLGroup.add(handL);

    this.armRGroup = new THREE.Group();
    this.armRGroup.position.set(0.23, 0.41, 0.0);
    this.torsoGroup.add(this.armRGroup);

    const upperArmR = new THREE.Mesh(upperArmGeo, jacketMat);
    upperArmR.position.set(0.02, -0.14, 0.03);
    upperArmR.rotation.set(-0.22, 0, -0.16);
    upperArmR.castShadow = true;
    this.armRGroup.add(upperArmR);

    this.forearmRGroup = new THREE.Group();
    this.forearmRGroup.position.set(0.04, -0.26, 0.07);
    this.armRGroup.add(this.forearmRGroup);

    const forearmR = new THREE.Mesh(forearmGeo, jacketMat);
    forearmR.position.set(-0.06, -0.02, 0.12);
    forearmR.rotation.set(Math.PI / 2 - 0.15, 0, 0.35);
    forearmR.castShadow = true;
    this.forearmRGroup.add(forearmR);

    const cuffR = new THREE.Mesh(cuffGeo, shirtMat);
    cuffR.position.set(-0.11, -0.04, 0.22);
    cuffR.rotation.set(Math.PI / 2 - 0.15, 0, 0.35);
    this.forearmRGroup.add(cuffR);

    const handR = new THREE.Mesh(handGeo, skinMat);
    handR.position.set(-0.13, -0.04, 0.26);
    handR.scale.set(0.95, 0.65, 1.25);
    handR.castShadow = true;
    this.forearmRGroup.add(handR);

    // 5. Neck & Head Assembly
    const neckGeo = track(new THREE.CylinderGeometry(0.062, 0.072, 0.09, 14));
    const neck = new THREE.Mesh(neckGeo, skinMat);
    neck.position.set(0, 0.49, 0.01);
    this.torsoGroup.add(neck);

    this.headGroup = new THREE.Group();
    this.headGroup.position.set(0, 0.56, 0.02);
    this.torsoGroup.add(this.headGroup);

    // Cranium & cheeks (human proportions)
    const headGeo = track(new THREE.SphereGeometry(0.118, 24, 20));
    const headMesh = new THREE.Mesh(headGeo, skinMat);
    headMesh.position.set(0, 0.08, 0);
    headMesh.scale.set(0.88, 1.06, 0.94);
    headMesh.castShadow = true;
    this.headGroup.add(headMesh);

    // Ears
    const earGeo = track(new THREE.SphereGeometry(0.026, 10, 10));
    const earL = new THREE.Mesh(earGeo, skinMat);
    earL.position.set(-0.104, 0.072, -0.005);
    earL.scale.set(0.45, 1.15, 0.75);
    this.headGroup.add(earL);

    const earR = new THREE.Mesh(earGeo, skinMat);
    earR.position.set(0.104, 0.072, -0.005);
    earR.scale.set(0.45, 1.15, 0.75);
    this.headGroup.add(earR);

    // Nose
    const noseGeo = track(new THREE.ConeGeometry(0.019, 0.052, 8));
    const nose = new THREE.Mesh(noseGeo, skinMat);
    nose.position.set(0, 0.075, 0.112);
    nose.rotation.x = Math.PI * 0.42;
    this.headGroup.add(nose);

    // Eyebrows (silver-white elderly brows)
    const browGeo = track(new THREE.BoxGeometry(0.036, 0.009, 0.014));
    const browL = new THREE.Mesh(browGeo, beardMat);
    browL.position.set(-0.038, 0.116, 0.098);
    browL.rotation.z = 0.08;
    this.headGroup.add(browL);

    const browR = new THREE.Mesh(browGeo, beardMat);
    browR.position.set(0.038, 0.116, 0.098);
    browR.rotation.z = -0.08;
    this.headGroup.add(browR);

    // Eyes + Iris + Eyelids for natural blinking
    const scleraGeo = track(new THREE.SphereGeometry(0.017, 12, 12));
    const irisGeo = track(new THREE.SphereGeometry(0.0095, 10, 10));
    const eyelidGeo = track(
      new THREE.SphereGeometry(0.0185, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.52)
    );

    const eyeL = new THREE.Mesh(scleraGeo, eyeWhiteMat);
    eyeL.position.set(-0.036, 0.094, 0.094);
    this.headGroup.add(eyeL);

    const irisL = new THREE.Mesh(irisGeo, irisMat);
    irisL.position.set(-0.036, 0.094, 0.104);
    this.headGroup.add(irisL);

    this.upperEyelidL = new THREE.Mesh(eyelidGeo, skinMat);
    this.upperEyelidL.position.set(-0.036, 0.095, 0.095);
    this.upperEyelidL.rotation.x = -0.35; // Open position
    this.headGroup.add(this.upperEyelidL);

    const eyeR = new THREE.Mesh(scleraGeo, eyeWhiteMat);
    eyeR.position.set(0.036, 0.094, 0.094);
    this.headGroup.add(eyeR);

    const irisR = new THREE.Mesh(irisGeo, irisMat);
    irisR.position.set(0.036, 0.094, 0.104);
    this.headGroup.add(irisR);

    this.upperEyelidR = new THREE.Mesh(eyelidGeo, skinMat);
    this.upperEyelidR.position.set(0.036, 0.095, 0.095);
    this.upperEyelidR.rotation.x = -0.35;
    this.headGroup.add(this.upperEyelidR);

    // Optional gold-rimmed spectacles for Scholar 1
    if (profile.hasSpectacles) {
      const rimGeo = track(new THREE.TorusGeometry(0.024, 0.0022, 8, 20));
      const rimL = new THREE.Mesh(rimGeo, goldTrimMat);
      rimL.position.set(-0.036, 0.093, 0.114);
      this.headGroup.add(rimL);

      const rimR = new THREE.Mesh(rimGeo, goldTrimMat);
      rimR.position.set(0.036, 0.093, 0.114);
      this.headGroup.add(rimR);

      const bridgeGeo = track(new THREE.BoxGeometry(0.024, 0.0025, 0.0025));
      const bridge = new THREE.Mesh(bridgeGeo, goldTrimMat);
      bridge.position.set(0, 0.096, 0.115);
      this.headGroup.add(bridge);
    }

    // Mustache
    const mustacheGeo = track(new THREE.BoxGeometry(0.068, 0.016, 0.024));
    const mustache = new THREE.Mesh(mustacheGeo, beardMat);
    mustache.position.set(0, 0.044, 0.103);
    this.headGroup.add(mustache);

    // Upper lip
    const lipGeo = track(new THREE.BoxGeometry(0.036, 0.009, 0.016));
    const upperLip = new THREE.Mesh(lipGeo, lipMat);
    upperLip.position.set(0, 0.033, 0.102);
    this.headGroup.add(upperLip);

    // Articulated Jaw + Beard (moves smoothly with mouthOpen)
    this.jawGroup = new THREE.Group();
    this.jawGroup.position.set(0, 0.032, 0.04);
    this.headGroup.add(this.jawGroup);

    const lowerLip = new THREE.Mesh(lipGeo, lipMat);
    lowerLip.position.set(0, -0.008, 0.061);
    this.jawGroup.add(lowerLip);

    const beardHeight = profile.beardStyle === 'full_white' ? 0.115 : 0.082;
    const beardGeo = track(new THREE.ConeGeometry(0.088, beardHeight, 14));
    const beard = new THREE.Mesh(beardGeo, beardMat);
    beard.position.set(0, -beardHeight * 0.42, 0.026);
    beard.rotation.x = Math.PI - 0.14;
    beard.scale.set(0.95, 1, 0.72);
    beard.castShadow = true;
    this.jawGroup.add(beard);

    // Sideburns / cheek beard
    const sideBeardGeo = track(new THREE.BoxGeometry(0.145, 0.065, 0.085));
    const sideBeard = new THREE.Mesh(sideBeardGeo, beardMat);
    sideBeard.position.set(0, 0.005, 0.015);
    this.jawGroup.add(sideBeard);

    // 6. Blue Prayer Cap (Takke) with subtle embroidered gold/navy rim
    const capDomeGeo = track(
      new THREE.SphereGeometry(0.114, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.52)
    );
    const capDome = new THREE.Mesh(capDomeGeo, capMat);
    capDome.position.set(0, 0.132, -0.004);
    capDome.scale.set(0.91, 0.88, 0.96);
    capDome.castShadow = true;
    this.headGroup.add(capDome);

    const capRimGeo = track(new THREE.CylinderGeometry(0.105, 0.107, 0.022, 24, 1, true));
    const capRim = new THREE.Mesh(capRimGeo, capMat);
    capRim.position.set(0, 0.134, -0.004);
    capRim.scale.set(0.91, 1, 0.96);
    this.headGroup.add(capRim);

    const capGoldBandGeo = track(new THREE.TorusGeometry(0.105, 0.0035, 8, 32));
    const capGoldBand = new THREE.Mesh(capGoldBandGeo, goldTrimMat);
    capGoldBand.position.set(0, 0.128, -0.004);
    capGoldBand.rotation.x = Math.PI / 2;
    capGoldBand.scale.set(0.91, 0.96, 1);
    this.headGroup.add(capGoldBand);
  }

  updateTuning(tuning: RigTuningOptions): void {
    this.tuning = { ...tuning };
  }

  setSpeaking(isSpeaking: boolean): void {
    this.isSpeaking = isSpeaking;
    if (!isSpeaking) {
      this.targetMouthOpen = 0;
    }
  }

  setListeningTo(targetSide: 'left' | 'right' | 'center'): void {
    this.listeningTarget = targetSide;
  }

  setMouthOpen(amount: number): void {
    this.targetMouthOpen = THREE.MathUtils.clamp(amount, 0, 1);
  }

  update(deltaSec: number, elapsedSec: number): void {
    const dt = Math.min(deltaSec, 0.1);
    const t = elapsedSec + this.phaseOffset;

    // 1. Natural Blinking
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0 && !this.isBlinking) {
      this.isBlinking = true;
      this.blinkProgress = 0;
      const baseInterval = Math.max(2.0, this.tuning.blinkIntervalSec);
      this.blinkTimer = baseInterval * (0.72 + Math.random() * 0.56);
    }

    let eyelidRotX = -0.35; // Open
    if (this.isBlinking) {
      this.blinkProgress += dt / 0.15; // 150ms crisp blink
      if (this.blinkProgress >= 1) {
        this.isBlinking = false;
        this.blinkProgress = 0;
      } else {
        const blinkWave = Math.sin(this.blinkProgress * Math.PI);
        eyelidRotX = THREE.MathUtils.lerp(-0.35, 0.55, blinkWave);
      }
    }
    this.upperEyelidL.rotation.x = eyelidRotX;
    this.upperEyelidR.rotation.x = eyelidRotX;

    // 2. Idle Breathing & Respectful Posture
    const breathAmp = 0.012 * this.tuning.idleBreathingIntensity;
    const breath = Math.sin(t * 1.45) * breathAmp;
    this.torsoGroup.position.y = 0.21 + breath;
    const targetTorsoPitch = this.isSpeaking ? 0.065 : 0.015;
    this.torsoGroup.rotation.x = THREE.MathUtils.damp(
      this.torsoGroup.rotation.x,
      targetTorsoPitch + Math.sin(t * 0.7) * 0.012,
      4.5,
      dt
    );

    // 3. Head Movement (Speaking vs Listening Interaction)
    const headAmp = this.tuning.headMovementIntensity;
    let targetHeadYaw = Math.sin(t * 0.42) * 0.06 * headAmp;
    let targetHeadPitch = Math.sin(t * 0.65) * 0.03 * headAmp;
    let targetHeadRoll = Math.sin(t * 0.35) * 0.025 * headAmp;

    if (this.isSpeaking) {
      // Expressive gentle nod and occasional glance toward camera/listener
      targetHeadYaw = Math.sin(t * 1.15) * 0.08 * headAmp;
      targetHeadPitch = 0.04 + Math.sin(t * 2.6) * 0.045 * headAmp;
      targetHeadRoll = Math.sin(t * 0.9) * 0.03 * headAmp;
    } else if (this.tuning.listenerInteractionEnabled && this.listeningTarget !== 'center') {
      // Listener turns subtly toward the speaking scholar and nods attentively
      const sideSign = this.listeningTarget === 'left' ? 0.22 : -0.22;
      targetHeadYaw = sideSign + Math.sin(t * 0.6) * 0.03 * headAmp;
      targetHeadPitch = 0.035 + Math.max(0, Math.sin(t * 1.8)) * 0.04 * headAmp;
    }

    this.headGroup.rotation.y = THREE.MathUtils.damp(this.headGroup.rotation.y, targetHeadYaw, 5, dt);
    this.headGroup.rotation.x = THREE.MathUtils.damp(this.headGroup.rotation.x, targetHeadPitch, 5, dt);
    this.headGroup.rotation.z = THREE.MathUtils.damp(this.headGroup.rotation.z, targetHeadRoll, 5, dt);

    // 4. Audio-Reactive Jaw / Mouth Animation
    const desiredMouth = this.isSpeaking ? this.targetMouthOpen : 0;
    this.currentMouthOpen = THREE.MathUtils.damp(this.currentMouthOpen, desiredMouth, 18, dt);
    this.jawGroup.rotation.x = this.currentMouthOpen * 0.24;
    this.jawGroup.position.y = 0.032 - this.currentMouthOpen * 0.011;

    // 5. Respectful Dua Hand Gesture when Speaking
    const gestureLift = this.isSpeaking ? 1 : 0;
    const targetForearmLift = gestureLift * (-0.36 + Math.sin(t * 2.1) * 0.035);
    const targetArmForward = gestureLift * -0.18;

    this.armLGroup.rotation.x = THREE.MathUtils.damp(this.armLGroup.rotation.x, targetArmForward, 4.2, dt);
    this.armRGroup.rotation.x = THREE.MathUtils.damp(this.armRGroup.rotation.x, targetArmForward, 4.2, dt);
    this.forearmLGroup.rotation.x = THREE.MathUtils.damp(
      this.forearmLGroup.rotation.x,
      targetForearmLift,
      4.2,
      dt
    );
    this.forearmRGroup.rotation.x = THREE.MathUtils.damp(
      this.forearmRGroup.rotation.x,
      targetForearmLift,
      4.2,
      dt
    );
  }

  dispose(): void {
    for (const item of this.disposables) {
      item.dispose();
    }
    this.disposables = [];
  }
}

/**
 * Factory creating a scholar rig. Preserves the `IScholarCharacterRig` boundary so
 * future licensed GLTF/VRM humanoids can be instantiated here without changing MosqueScene.
 */
export function createScholarRig(
  profile: ScholarProfile,
  tuning: RigTuningOptions,
  phaseOffset: number
): ProceduralScholarRig {
  return new ProceduralScholarRig(profile, tuning, phaseOffset);
}
