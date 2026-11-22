import React, { useEffect, useRef, useState } from 'react';
import mosqueMasterUrl from '../assets/images/mosque_scholars_broadcast_1795080562181.jpg';
import { useStudio } from '../context/StudioContext';
import { CameraPreset, PhotorealisticMosqueStage } from '../scene/PhotorealisticMosqueStage';

interface MosqueViewportProps {
  cameraPreset?: CameraPreset;
  className?: string;
}

export const MosqueViewport: React.FC<MosqueViewportProps> = ({
  cameraPreset,
  className = '',
}) => {
  const { state, activeEvent, speakingState, subscribeMouthLevel } = useStudio();
  const mountRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<PhotorealisticMosqueStage | null>(null);
  const [useStaticFallback, setUseStaticFallback] = useState(false);

  const activeScholar = activeEvent?.scholarId || state.scholars.currentSpeaker;
  const isSpeaking = speakingState === 'speaking';
  const effectivePreset = cameraPreset || state.broadcast.cameraPreset;

  const latestRef = useRef({
    activeScholar,
    isSpeaking,
    mouthLevel: 0,
  });
  latestRef.current.activeScholar = activeScholar;
  latestRef.current.isSpeaking = isSpeaking;

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

      const unsubMouth = subscribeMouthLevel((lvl) => {
        latestRef.current.mouthLevel = lvl;
        stage.setPlaybackState({
          activeScholar: latestRef.current.activeScholar,
          isSpeaking: latestRef.current.isSpeaking,
          mouthLevel: lvl,
        });
      });

      return () => {
        unsubMouth();
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
    stageRef.current?.setPlaybackState({
      activeScholar,
      isSpeaking,
      mouthLevel: isSpeaking ? latestRef.current.mouthLevel : 0,
    });
  }, [activeScholar, isSpeaking]);

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
