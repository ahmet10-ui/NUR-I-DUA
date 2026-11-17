import React, { useEffect, useRef, useState } from 'react';
import { useStudio } from '../context/StudioContext';
import { CameraPreset, MosqueSceneController } from '../three/MosqueScene';

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
  const controllerRef = useRef<MosqueSceneController | null>(null);
  const [webglError, setWebglError] = useState(false);

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
      const controller = new MosqueSceneController({
        container: el,
        scholarsConfig: state.scholars,
        cameraPreset: effectivePreset,
        onWebGLContextLost: () => setWebglError(true),
      });
      controllerRef.current = controller;

      const unsubMouth = subscribeMouthLevel((lvl) => {
        latestRef.current.mouthLevel = lvl;
        controller.setPlaybackState({
          activeScholar: latestRef.current.activeScholar,
          isSpeaking: latestRef.current.isSpeaking,
          mouthLevel: lvl,
        });
      });

      return () => {
        unsubMouth();
        controller.dispose();
        controllerRef.current = null;
      };
    } catch {
      setWebglError(true);
    }
    // Mount WebGL canvas once per component lifecycle
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    controllerRef.current?.updateScholarsConfig(state.scholars);
  }, [state.scholars]);

  useEffect(() => {
    controllerRef.current?.setCameraPreset(effectivePreset);
  }, [effectivePreset]);

  useEffect(() => {
    controllerRef.current?.setPlaybackState({
      activeScholar,
      isSpeaking,
      mouthLevel: isSpeaking ? latestRef.current.mouthLevel : 0,
    });
  }, [activeScholar, isSpeaking]);

  return (
    <div className={`relative w-full h-full overflow-hidden bg-[#070E21] ${className}`}>
      <div ref={mountRef} className="w-full h-full" />
      {webglError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-[#09122A]">
          <p className="font-display text-2xl text-[#E5C88B]">3D Viewport Unavailable</p>
          <p className="mt-2 max-w-sm text-sm text-slate-300">
            WebGL context could not be initialized on this device. Audio playback and prayer overlays continue normally.
          </p>
        </div>
      )}
    </div>
  );
};
