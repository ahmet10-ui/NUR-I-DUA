import React, { useEffect, useRef, useState } from 'react';
import mosqueMasterUrl from '../assets/images/mosque_scholars_broadcast_1795080562181.jpg';
import { useStudio } from '../context/StudioContext';
import { CameraPreset, PhotorealisticMosqueStage } from '../scene/PhotorealisticMosqueStage';
import { createDefaultScholarAnimations } from '../services/scholarAnimationController';
import { createRestingLipSyncFrame } from '../services/turkishLipSync';
import {
  LipSyncFrame,
  QueueEvent,
  ScholarAnimationSnapshot,
  ScholarId,
} from '../types/nuridua';

interface MosqueViewportProps {
  cameraPreset?: CameraPreset;
  className?: string;
}

export const MosqueViewport: React.FC<MosqueViewportProps> = ({
  cameraPreset,
  className = '',
}) => {
  const {
    state,
    activeEvent,
    speakingState,
    subscribeLipSyncFrame,
    subscribeScholarAnimation,
  } = useStudio();
  const mountRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<PhotorealisticMosqueStage | null>(null);
  const [useStaticFallback, setUseStaticFallback] = useState(false);

  const activeScholar = activeEvent?.scholarId || state.scholars.currentSpeaker;
  const playbackPhase = activeEvent?.playbackPhase;
  const isTurkishSpeaking = speakingState === 'speaking' && playbackPhase !== 'arabic_audio';
  const effectivePreset = cameraPreset || state.broadcast.cameraPreset;

  const latestRef = useRef<{
    activeScholar: ScholarId;
    isSpeaking: boolean;
    playbackPhase: QueueEvent['playbackPhase'];
    mouthLevel: number;
    lipSync: LipSyncFrame;
    scholarAnimation: Record<ScholarId, ScholarAnimationSnapshot>;
  }>({
    activeScholar,
    isSpeaking: isTurkishSpeaking,
    playbackPhase,
    mouthLevel: 0,
    lipSync: createRestingLipSyncFrame(activeScholar),
    scholarAnimation: createDefaultScholarAnimations(),
  });
  latestRef.current.activeScholar = activeScholar;
  latestRef.current.isSpeaking = isTurkishSpeaking;
  latestRef.current.playbackPhase = playbackPhase;

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    try {
      const stage = new PhotorealisticMosqueStage({
        container: el,
        scholarsConfig: state.scholars,
        cameraPreset: effectivePreset,
        onFallbackReady: () => setUseStaticFallback(true),
      });
      stageRef.current = stage;

      const pushToStage = () => {
        stage.setPlaybackState({
          activeScholar: latestRef.current.activeScholar,
          isSpeaking: latestRef.current.isSpeaking,
          mouthLevel: latestRef.current.mouthLevel,
          lipSync: latestRef.current.lipSync,
          playbackPhase: latestRef.current.playbackPhase,
          scholarAnimation: latestRef.current.scholarAnimation,
        });
      };

      const unsubAnim = subscribeScholarAnimation((animStates) => {
        latestRef.current.scholarAnimation = animStates;
        const activeAnim = animStates[latestRef.current.activeScholar];
        if (activeAnim && !activeAnim.mouthAllowed) {
          latestRef.current.mouthLevel = 0;
          latestRef.current.lipSync = createRestingLipSyncFrame(latestRef.current.activeScholar);
        }
        pushToStage();
      });

      const unsubLipSync = subscribeLipSyncFrame((frame) => {
        const activeAnim = latestRef.current.scholarAnimation[latestRef.current.activeScholar];
        const animMouthBlocked = activeAnim ? !activeAnim.mouthAllowed : false;
        const allowMouth =
          latestRef.current.playbackPhase !== 'arabic_audio' &&
          !animMouthBlocked &&
          (frame.active || latestRef.current.isSpeaking);
        const effectiveFrame = allowMouth
          ? frame
          : createRestingLipSyncFrame(latestRef.current.activeScholar);
        latestRef.current.mouthLevel = effectiveFrame.level;
        latestRef.current.lipSync = effectiveFrame;
        pushToStage();
      });

      return () => {
        unsubAnim();
        unsubLipSync();
        stage.dispose();
        stageRef.current = null;
      };
    } catch {
      setUseStaticFallback(true);
    }
    // Mount GPU photorealistic stage once per component lifecycle
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    stageRef.current?.updateScholarsConfig(state.scholars);
  }, [state.scholars]);

  useEffect(() => {
    stageRef.current?.setCameraPreset(effectivePreset);
  }, [effectivePreset]);

  useEffect(() => {
    const activeAnim = latestRef.current.scholarAnimation[activeScholar];
    const ameenMouthOpen = activeAnim?.phase === 'AMEEN' && activeAnim.mouthAllowed;
    const allowMouth = playbackPhase !== 'arabic_audio' && (isTurkishSpeaking || ameenMouthOpen);
    const resting = createRestingLipSyncFrame(activeScholar);
    if (!allowMouth) {
      latestRef.current.mouthLevel = 0;
      latestRef.current.lipSync = resting;
    }
    stageRef.current?.setPlaybackState({
      activeScholar,
      isSpeaking: isTurkishSpeaking,
      mouthLevel: allowMouth ? latestRef.current.mouthLevel : 0,
      lipSync: allowMouth ? latestRef.current.lipSync : resting,
      playbackPhase,
      scholarAnimation: latestRef.current.scholarAnimation,
    });
  }, [activeScholar, isTurkishSpeaking, playbackPhase]);

  const hasExplicitPosition = /\b(absolute|fixed|sticky|static)\b/.test(className);

  return (
    <div
      className={`${
        hasExplicitPosition ? '' : 'relative'
      } w-full h-full overflow-hidden bg-[#070E21] ${className}`.trim()}
    >
      <div ref={mountRef} className="w-full h-full" />
      {useStaticFallback && (
        <div className="absolute inset-0 overflow-hidden bg-[#09122A]">
          <img
            src={mosqueMasterUrl}
            alt="Traditional Turkish mosque broadcast scene with two elderly scholars"
            referrerPolicy="no-referrer"
            className={`w-full h-full object-cover transition-transform duration-700 ${
              effectivePreset === 'scholar_closeup'
                ? activeScholar === 'scholar_1'
                  ? 'scale-[1.28] translate-x-[10%]'
                  : 'scale-[1.28] -translate-x-[10%]'
                : effectivePreset === 'broadcast_portrait'
                ? 'scale-[1.06]'
                : 'scale-100'
            }`}
          />
        </div>
      )}
    </div>
  );
};
