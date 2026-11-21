package com.nur.idua;

import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.os.Build;
import android.os.PowerManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/**
 * Native Android MediaPlayer plugin for uninterrupted long Quranic / Qari recitations
 * (e.g., full Yâsîn-i Şerîf, Âmenerrasûlü, Fâtiha).
 * Uses only built-in Android SDK MediaPlayer, AudioManager focus, and PARTIAL_WAKE_LOCK.
 */
@CapacitorPlugin(name = "NurIDuaAudio")
public class NurIDuaAudioPlugin extends Plugin {

    private final Object playerLock = new Object();
    private final ExecutorService prepExecutor = Executors.newSingleThreadExecutor();
    private final ScheduledExecutorService progressScheduler = Executors.newSingleThreadScheduledExecutor();

    private MediaPlayer mediaPlayer;
    private AssetFileDescriptor activeAssetFd;
    private AudioManager audioManager;
    private AudioFocusRequest audioFocusRequest;
    private PowerManager.WakeLock wakeLock;
    private ScheduledFuture<?> progressFuture;

    private volatile String activePlaybackId = null;
    private volatile float targetVolume = 1.0f;
    private volatile boolean isPausedState = false;
    private volatile boolean pausedByTransientFocusLoss = false;
    private volatile int cachedDurationMs = 0;

    private final AudioManager.OnAudioFocusChangeListener focusChangeListener = focusChange -> {
        synchronized (playerLock) {
            if (mediaPlayer == null || activePlaybackId == null) {
                return;
            }
            if (focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
                if (mediaPlayer.isPlaying()) {
                    try {
                        mediaPlayer.pause();
                        isPausedState = true;
                        pausedByTransientFocusLoss = true;
                        stopProgressTickerLocked();
                    } catch (Exception ignored) {
                    }
                }
            } else if (focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK) {
                try {
                    float duckVol = Math.max(0.1f, targetVolume * 0.35f);
                    mediaPlayer.setVolume(duckVol, duckVol);
                } catch (Exception ignored) {
                }
            } else if (focusChange == AudioManager.AUDIOFOCUS_GAIN) {
                try {
                    mediaPlayer.setVolume(targetVolume, targetVolume);
                    if (pausedByTransientFocusLoss && isPausedState) {
                        mediaPlayer.start();
                        isPausedState = false;
                        pausedByTransientFocusLoss = false;
                        startProgressTickerLocked(activePlaybackId);
                    }
                } catch (Exception ignored) {
                }
            } else if (focusChange == AudioManager.AUDIOFOCUS_LOSS) {
                String lostId = activePlaybackId;
                releaseMediaLocked();
                emitAudioError(lostId, -1, AudioManager.AUDIOFOCUS_LOSS, "Ses odağı kalıcı olarak kaybedildi.");
            }
        }
    };

    @Override
    public void load() {
        super.load();
        audioManager = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    }

    private AudioAttributes buildAudioAttributes() {
        return new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build();
    }

    private boolean requestAudioFocusLocked() {
        if (audioManager == null) return true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            AudioFocusRequest req = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(buildAudioAttributes())
                .setAcceptsDelayedFocusGain(false)
                .setOnAudioFocusChangeListener(focusChangeListener)
                .build();
            audioFocusRequest = req;
            int res = audioManager.requestAudioFocus(req);
            return res == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        } else {
            @SuppressWarnings("deprecation")
            int res = audioManager.requestAudioFocus(
                focusChangeListener,
                AudioManager.STREAM_MUSIC,
                AudioManager.AUDIOFOCUS_GAIN
            );
            return res == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        }
    }

    private void abandonAudioFocusLocked() {
        if (audioManager == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && audioFocusRequest != null) {
                audioManager.abandonAudioFocusRequest(audioFocusRequest);
                audioFocusRequest = null;
            } else {
                @SuppressWarnings("deprecation")
                int ignored = audioManager.abandonAudioFocus(focusChangeListener);
            }
        } catch (Exception ignored) {
        }
    }

    private void acquireWakeLockLocked() {
        try {
            if (wakeLock == null) {
                PowerManager pm = (PowerManager) getContext().getApplicationContext().getSystemService(Context.POWER_SERVICE);
                if (pm != null) {
                    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "NurIDua:QariAudioWakeLock");
                    wakeLock.setReferenceCounted(false);
                }
            }
            if (wakeLock != null && !wakeLock.isHeld()) {
                // Up to 25 minutes safety timeout for long full-surah recitations
                wakeLock.acquire(25 * 60 * 1000L);
            }
        } catch (Exception ignored) {
        }
    }

    private void releaseWakeLockLocked() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
            }
        } catch (Exception ignored) {
        }
    }

    private void startProgressTickerLocked(final String playbackId) {
        stopProgressTickerLocked();
        progressFuture = progressScheduler.scheduleAtFixedRate(() -> {
            synchronized (playerLock) {
                if (mediaPlayer == null || activePlaybackId == null || !activePlaybackId.equals(playbackId)) {
                    return;
                }
                if (isPausedState) {
                    return;
                }
                try {
                    if (mediaPlayer.isPlaying()) {
                        int pos = Math.max(0, mediaPlayer.getCurrentPosition());
                        int dur = Math.max(cachedDurationMs, mediaPlayer.getDuration());
                        double t = pos / 1000.0;
                        double level = Math.max(0.08, Math.min(0.88, 0.30 + 0.36 * Math.abs(Math.sin(t * 6.8))));
                        JSObject payload = new JSObject();
                        payload.put("playbackId", playbackId);
                        payload.put("positionMs", pos);
                        payload.put("durationMs", dur);
                        payload.put("level", level);
                        notifyListeners("audioProgress", payload);
                    }
                } catch (Exception ignored) {
                }
            }
        }, 60, 80, TimeUnit.MILLISECONDS);
    }

    private void stopProgressTickerLocked() {
        if (progressFuture != null) {
            progressFuture.cancel(false);
            progressFuture = null;
        }
    }

    private void releaseMediaLocked() {
        activePlaybackId = null;
        isPausedState = false;
        pausedByTransientFocusLoss = false;
        cachedDurationMs = 0;
        stopProgressTickerLocked();

        if (mediaPlayer != null) {
            try {
                if (mediaPlayer.isPlaying()) {
                    mediaPlayer.stop();
                }
            } catch (Exception ignored) {
            }
            try {
                mediaPlayer.reset();
                mediaPlayer.release();
            } catch (Exception ignored) {
            }
            mediaPlayer = null;
        }

        if (activeAssetFd != null) {
            try {
                activeAssetFd.close();
            } catch (Exception ignored) {
            }
            activeAssetFd = null;
        }

        abandonAudioFocusLocked();
        releaseWakeLockLocked();
    }

    private void emitAudioError(String playbackId, int what, int extra, String message) {
        JSObject payload = new JSObject();
        payload.put("playbackId", playbackId != null ? playbackId : "");
        payload.put("what", what);
        payload.put("extra", extra);
        payload.put("message", message);
        notifyListeners("audioError", payload);
    }

    private static String computeSha256(InputStream in) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) {
            digest.update(buf, 0, n);
        }
        byte[] hash = digest.digest();
        StringBuilder sb = new StringBuilder(hash.length * 2);
        for (byte b : hash) {
            sb.append(String.format(Locale.ROOT, "%02x", b));
        }
        return sb.toString();
    }

    private String resolveAssetCandidate(String rawUrl) {
        String clean = rawUrl.trim();
        if (clean.startsWith("/")) {
            clean = clean.substring(1);
        }
        if (clean.startsWith("public/")) {
            return clean;
        }
        return "public/" + clean;
    }

    private void verifySha256IfRequired(String rawUrl, String expectedSha256) throws Exception {
        if (expectedSha256 == null || expectedSha256.trim().isEmpty()) {
            return;
        }
        String normalizedExpected = expectedSha256.trim().toLowerCase(Locale.ROOT);
        if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
            return; // Remote streams cannot be pre-hashed from local assets cleanly without double download
        }

        String actualHash;
        if (rawUrl.startsWith("file://") || rawUrl.startsWith("/data/") || rawUrl.startsWith("/storage/")) {
            String path = rawUrl.startsWith("file://") ? rawUrl.substring("file://".length()) : rawUrl;
            File file = new File(path);
            if (!file.exists() || !file.isFile()) {
                throw new IOException("Ses dosyası bulunamadı: " + path);
            }
            try (FileInputStream fis = new FileInputStream(file)) {
                actualHash = computeSha256(fis);
            }
        } else {
            String assetPath = resolveAssetCandidate(rawUrl);
            try (InputStream is = getContext().getAssets().open(assetPath)) {
                actualHash = computeSha256(is);
            }
        }

        if (!normalizedExpected.equals(actualHash)) {
            throw new IOException("Ses dosyası SHA-256 doğrulaması başarısız oldu (bozuk veya değiştirilmiş dosya).");
        }
    }

    @PluginMethod
    public void play(PluginCall call) {
        String rawUrl = call.getString("url", "");
        String playbackIdArg = call.getString("playbackId", "");
        String expectedSha256 = call.getString("expectedSha256", "");
        Double volumeVal = call.getDouble("volume", 1.0);

        final String cleanUrl = rawUrl != null ? rawUrl.trim() : "";
        if (cleanUrl.isEmpty()) {
            JSObject res = new JSObject();
            res.put("ok", false);
            res.put("playbackId", playbackIdArg);
            res.put("error", "Arapça kârî ses dosyası yolu boş.");
            call.resolve(res);
            return;
        }

        final String playbackId = (playbackIdArg != null && !playbackIdArg.trim().isEmpty())
            ? playbackIdArg.trim()
            : ("audio_" + System.currentTimeMillis());
        final float volume = (float) Math.max(0.0, Math.min(1.0, volumeVal != null ? volumeVal : 1.0));

        synchronized (playerLock) {
            releaseMediaLocked();
            activePlaybackId = playbackId;
            targetVolume = volume;
        }

        prepExecutor.execute(() -> {
            synchronized (playerLock) {
                if (!playbackId.equals(activePlaybackId)) {
                    return;
                }
                try {
                    verifySha256IfRequired(cleanUrl, expectedSha256);

                    if (!requestAudioFocusLocked()) {
                        releaseMediaLocked();
                        JSObject errRes = new JSObject();
                        errRes.put("ok", false);
                        errRes.put("playbackId", playbackId);
                        errRes.put("error", "Android ses odağı (AudioFocus) alınamadı.");
                        call.resolve(errRes);
                        return;
                    }

                    acquireWakeLockLocked();

                    MediaPlayer mp = new MediaPlayer();
                    mp.setAudioAttributes(buildAudioAttributes());
                    mp.setWakeMode(getContext().getApplicationContext(), PowerManager.PARTIAL_WAKE_LOCK);
                    mp.setVolume(volume, volume);

                    if (cleanUrl.startsWith("http://") || cleanUrl.startsWith("https://")) {
                        mp.setDataSource(cleanUrl);
                    } else if (cleanUrl.startsWith("file://") || cleanUrl.startsWith("/data/") || cleanUrl.startsWith("/storage/")) {
                        String fsPath = cleanUrl.startsWith("file://") ? cleanUrl.substring("file://".length()) : cleanUrl;
                        File audioFile = new File(fsPath);
                        if (!audioFile.exists() || !audioFile.isFile()) {
                            throw new IOException("Ses dosyası cihazda bulunamadı: " + fsPath);
                        }
                        try (FileInputStream fis = new FileInputStream(audioFile)) {
                            mp.setDataSource(fis.getFD());
                        }
                    } else {
                        String primaryAsset = resolveAssetCandidate(cleanUrl);
                        AssetFileDescriptor afd;
                        try {
                            afd = getContext().getAssets().openFd(primaryAsset);
                        } catch (IOException primaryEx) {
                            String fallbackAsset = cleanUrl.startsWith("/") ? cleanUrl.substring(1) : cleanUrl;
                            try {
                                afd = getContext().getAssets().openFd(fallbackAsset);
                            } catch (IOException fallbackEx) {
                                throw new IOException(
                                    "Arapça ses dosyası uygulama paketinde bulunamadı (" + primaryAsset + ")."
                                );
                            }
                        }
                        activeAssetFd = afd;
                        mp.setDataSource(afd.getFileDescriptor(), afd.getStartOffset(), afd.getLength());
                    }

                    mp.setOnPreparedListener(preparedPlayer -> {
                        synchronized (playerLock) {
                            if (mediaPlayer != preparedPlayer || !playbackId.equals(activePlaybackId)) {
                                return;
                            }
                            try {
                                cachedDurationMs = Math.max(0, preparedPlayer.getDuration());
                                preparedPlayer.start();
                                isPausedState = false;
                                JSObject startPayload = new JSObject();
                                startPayload.put("playbackId", playbackId);
                                startPayload.put("durationMs", cachedDurationMs);
                                notifyListeners("audioStart", startPayload);
                                startProgressTickerLocked(playbackId);
                            } catch (Exception startEx) {
                                releaseMediaLocked();
                                emitAudioError(playbackId, -1, -1, "Ses oynatma başlatılamadı: " + startEx.getMessage());
                            }
                        }
                    });

                    mp.setOnCompletionListener(completedPlayer -> {
                        synchronized (playerLock) {
                            if (mediaPlayer != completedPlayer || !playbackId.equals(activePlaybackId)) {
                                return;
                            }
                            int dur = cachedDurationMs;
                            try {
                                dur = Math.max(dur, completedPlayer.getDuration());
                            } catch (Exception ignored) {
                            }
                            releaseMediaLocked();
                            JSObject donePayload = new JSObject();
                            donePayload.put("playbackId", playbackId);
                            donePayload.put("durationMs", dur);
                            notifyListeners("audioDone", donePayload);
                        }
                    });

                    mp.setOnErrorListener((errPlayer, what, extra) -> {
                        synchronized (playerLock) {
                            if (mediaPlayer != errPlayer || !playbackId.equals(activePlaybackId)) {
                                return true;
                            }
                            releaseMediaLocked();
                            emitAudioError(
                                playbackId,
                                what,
                                extra,
                                "Android MediaPlayer ses çalma hatası (what=" + what + ", extra=" + extra + ")."
                            );
                        }
                        return true;
                    });

                    mediaPlayer = mp;
                    mp.prepareAsync();

                    JSObject okRes = new JSObject();
                    okRes.put("ok", true);
                    okRes.put("playbackId", playbackId);
                    call.resolve(okRes);
                } catch (Exception ex) {
                    releaseMediaLocked();
                    JSObject errRes = new JSObject();
                    errRes.put("ok", false);
                    errRes.put("playbackId", playbackId);
                    errRes.put("error", ex.getMessage() != null ? ex.getMessage() : "Arapça ses dosyası yüklenemedi.");
                    call.resolve(errRes);
                }
            }
        });
    }

    @PluginMethod
    public void pause(PluginCall call) {
        JSObject res = new JSObject();
        synchronized (playerLock) {
            if (mediaPlayer != null && activePlaybackId != null) {
                try {
                    if (mediaPlayer.isPlaying()) {
                        mediaPlayer.pause();
                    }
                    isPausedState = true;
                    pausedByTransientFocusLoss = false;
                    stopProgressTickerLocked();
                    res.put("ok", true);
                    res.put("playbackId", activePlaybackId);
                    res.put("positionMs", Math.max(0, mediaPlayer.getCurrentPosition()));
                    call.resolve(res);
                    return;
                } catch (Exception e) {
                    res.put("ok", false);
                    res.put("error", e.getMessage());
                    call.resolve(res);
                    return;
                }
            }
        }
        res.put("ok", false);
        res.put("error", "Duraklatılacak aktif ses kaydı yok.");
        call.resolve(res);
    }

    @PluginMethod
    public void resume(PluginCall call) {
        JSObject res = new JSObject();
        synchronized (playerLock) {
            if (mediaPlayer != null && activePlaybackId != null) {
                try {
                    if (requestAudioFocusLocked()) {
                        acquireWakeLockLocked();
                        mediaPlayer.setVolume(targetVolume, targetVolume);
                        mediaPlayer.start();
                        isPausedState = false;
                        pausedByTransientFocusLoss = false;
                        startProgressTickerLocked(activePlaybackId);
                        res.put("ok", true);
                        res.put("playbackId", activePlaybackId);
                        call.resolve(res);
                        return;
                    } else {
                        res.put("ok", false);
                        res.put("error", "Ses odağı yeniden alınamadı.");
                        call.resolve(res);
                        return;
                    }
                } catch (Exception e) {
                    res.put("ok", false);
                    res.put("error", e.getMessage());
                    call.resolve(res);
                    return;
                }
            }
        }
        res.put("ok", false);
        res.put("error", "Devam ettirilecek aktif ses kaydı yok.");
        call.resolve(res);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        synchronized (playerLock) {
            releaseMediaLocked();
        }
        JSObject res = new JSObject();
        res.put("ok", true);
        call.resolve(res);
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject res = new JSObject();
        synchronized (playerLock) {
            boolean playing = false;
            int positionMs = 0;
            int durationMs = cachedDurationMs;
            if (mediaPlayer != null) {
                try {
                    playing = mediaPlayer.isPlaying();
                    positionMs = Math.max(0, mediaPlayer.getCurrentPosition());
                    durationMs = Math.max(durationMs, mediaPlayer.getDuration());
                } catch (Exception ignored) {
                }
            }
            res.put("playing", playing);
            res.put("paused", isPausedState);
            res.put("playbackId", activePlaybackId);
            res.put("positionMs", positionMs);
            res.put("durationMs", durationMs);
        }
        call.resolve(res);
    }

    @Override
    protected void handleOnDestroy() {
        synchronized (playerLock) {
            releaseMediaLocked();
        }
        prepExecutor.shutdownNow();
        progressScheduler.shutdownNow();
        super.handleOnDestroy();
    }
}
