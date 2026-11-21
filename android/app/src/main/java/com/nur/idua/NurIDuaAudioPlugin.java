package com.nur.idua;

import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
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
 *
 * Hardened against false early-completion on MIUI / MediaTek Android devices:
 * - Verifies SHA-256 off the main/player locks before preparing MediaPlayer.
 * - Normalizes Capacitor local origins (`http(s)://localhost/...`, `capacitor://localhost/...`)
 *   into local `assets/public/...` files so SHA-256 verification and AssetFD always apply.
 * - Instantiates and prepares MediaPlayer on the main Looper thread.
 * - Enforces `hasPrepared` + `hasPlaybackStarted` + `completionEmitted` guards so `audioDone`
 *   can NEVER be emitted unless actual audio playback started and reached completion.
 */
@CapacitorPlugin(name = "NurIDuaAudio")
public class NurIDuaAudioPlugin extends Plugin {

    private final Object playerLock = new Object();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
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
    private volatile boolean hasPrepared = false;
    private volatile boolean hasPlaybackStarted = false;
    private volatile boolean completionEmitted = false;
    private volatile int cachedDurationMs = 0;
    private volatile int lastKnownPositionMs = 0;

    private final AudioManager.OnAudioFocusChangeListener focusChangeListener = focusChange -> {
        synchronized (playerLock) {
            if (mediaPlayer == null || activePlaybackId == null) {
                return;
            }
            if (focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
                try {
                    if (mediaPlayer.isPlaying()) {
                        mediaPlayer.pause();
                        isPausedState = true;
                        pausedByTransientFocusLoss = true;
                        stopProgressTickerLocked();
                    }
                } catch (Exception ignored) {
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
                    if (pausedByTransientFocusLoss && isPausedState && hasPrepared) {
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
                if (isPausedState || !hasPlaybackStarted) {
                    return;
                }
                try {
                    if (mediaPlayer.isPlaying()) {
                        int pos = Math.max(0, mediaPlayer.getCurrentPosition());
                        int dur = Math.max(cachedDurationMs, mediaPlayer.getDuration());
                        lastKnownPositionMs = Math.max(lastKnownPositionMs, pos);
                        cachedDurationMs = dur;
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
        }, 60, 120, TimeUnit.MILLISECONDS);
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
        hasPrepared = false;
        hasPlaybackStarted = false;
        completionEmitted = false;
        cachedDurationMs = 0;
        lastKnownPositionMs = 0;
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
        byte[] buf = new byte[16384];
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

    /**
     * Unwraps Capacitor local WebView origins (`http://localhost/...`, `https://localhost/...`,
     * `capacitor://localhost/...`) into clean relative paths so MediaPlayer reads the bundled APK asset directly.
     */
    private static String normalizePlayableSource(String rawUrl) {
        String clean = rawUrl == null ? "" : rawUrl.trim();
        if (clean.isEmpty()) return "";
        String lower = clean.toLowerCase(Locale.ROOT);
        if (lower.startsWith("http://localhost/")
            || lower.startsWith("https://localhost/")
            || lower.startsWith("http://127.0.0.1/")
            || lower.startsWith("https://127.0.0.1/")
            || lower.startsWith("capacitor://localhost/")) {
            try {
                Uri parsed = Uri.parse(clean);
                String path = parsed.getPath();
                if (path != null && !path.isEmpty()) {
                    return path;
                }
            } catch (Exception ignored) {
            }
        }
        return clean;
    }

    private static boolean isRemoteHttpUrl(String normalizedUrl) {
        String lower = normalizedUrl.toLowerCase(Locale.ROOT);
        return lower.startsWith("http://") || lower.startsWith("https://");
    }

    private static boolean isLocalFilePath(String normalizedUrl) {
        return normalizedUrl.startsWith("file://")
            || normalizedUrl.startsWith("/data/")
            || normalizedUrl.startsWith("/storage/");
    }

    private String resolveAssetCandidate(String rawUrl) {
        String clean = rawUrl.trim();
        int qIdx = clean.indexOf('?');
        if (qIdx >= 0) clean = clean.substring(0, qIdx);
        int hIdx = clean.indexOf('#');
        if (hIdx >= 0) clean = clean.substring(0, hIdx);
        if (clean.startsWith("/")) {
            clean = clean.substring(1);
        }
        if (clean.startsWith("public/")) {
            return clean;
        }
        return "public/" + clean;
    }

    private AssetFileDescriptor openAssetFdWithFallback(String normalizedUrl) throws IOException {
        String primaryAsset = resolveAssetCandidate(normalizedUrl);
        try {
            return getContext().getAssets().openFd(primaryAsset);
        } catch (IOException primaryEx) {
            String fallbackAsset = normalizedUrl.startsWith("/") ? normalizedUrl.substring(1) : normalizedUrl;
            try {
                return getContext().getAssets().openFd(fallbackAsset);
            } catch (IOException fallbackEx) {
                throw new IOException(
                    "Arapça ses dosyası uygulama paketinde bulunamadı (" + primaryAsset + ")."
                );
            }
        }
    }

    private void verifySha256IfRequired(String normalizedUrl, String expectedSha256) throws Exception {
        if (expectedSha256 == null || expectedSha256.trim().isEmpty()) {
            return;
        }
        String normalizedExpected = expectedSha256.trim().toLowerCase(Locale.ROOT);
        if (isRemoteHttpUrl(normalizedUrl)) {
            throw new IOException("SHA-256 doğrulaması zorunlu olan Yâsîn kaydı harici ağ URL'si yerine yerel paketten çalınmalıdır.");
        }

        String actualHash;
        if (isLocalFilePath(normalizedUrl)) {
            String path = normalizedUrl.startsWith("file://") ? normalizedUrl.substring("file://".length()) : normalizedUrl;
            File file = new File(path);
            if (!file.exists() || !file.isFile() || file.length() <= 0) {
                throw new IOException("Ses dosyası cihazda bulunamadı veya boş: " + path);
            }
            try (FileInputStream fis = new FileInputStream(file)) {
                actualHash = computeSha256(fis);
            }
        } else {
            String assetPath = resolveAssetCandidate(normalizedUrl);
            try (InputStream is = getContext().getAssets().open(assetPath)) {
                actualHash = computeSha256(is);
            } catch (IOException primaryOpenErr) {
                String fallbackAsset = normalizedUrl.startsWith("/") ? normalizedUrl.substring(1) : normalizedUrl;
                try (InputStream isFallback = getContext().getAssets().open(fallbackAsset)) {
                    actualHash = computeSha256(isFallback);
                }
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

        final String normalizedUrl = normalizePlayableSource(rawUrl);
        if (normalizedUrl.isEmpty()) {
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
            // Perform 12+ MB SHA-256 hashing BEFORE holding playerLock
            try {
                verifySha256IfRequired(normalizedUrl, expectedSha256);
            } catch (Exception hashEx) {
                synchronized (playerLock) {
                    if (playbackId.equals(activePlaybackId)) {
                        releaseMediaLocked();
                    }
                }
                JSObject errRes = new JSObject();
                errRes.put("ok", false);
                errRes.put("playbackId", playbackId);
                errRes.put("error", hashEx.getMessage() != null ? hashEx.getMessage() : "Ses dosyası bütünlüğü doğrulanamadı.");
                call.resolve(errRes);
                return;
            }

            mainHandler.post(() -> {
                synchronized (playerLock) {
                    if (!playbackId.equals(activePlaybackId)) {
                        JSObject cancelRes = new JSObject();
                        cancelRes.put("ok", false);
                        cancelRes.put("playbackId", playbackId);
                        cancelRes.put("error", "Oynatma hazırlık aşamasında iptal edildi.");
                        call.resolve(cancelRes);
                        return;
                    }
                    try {
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

                        if (isRemoteHttpUrl(normalizedUrl)) {
                            mp.setDataSource(normalizedUrl);
                        } else if (isLocalFilePath(normalizedUrl)) {
                            String fsPath = normalizedUrl.startsWith("file://")
                                ? normalizedUrl.substring("file://".length())
                                : normalizedUrl;
                            File audioFile = new File(fsPath);
                            if (!audioFile.exists() || !audioFile.isFile()) {
                                throw new IOException("Ses dosyası cihazda bulunamadı: " + fsPath);
                            }
                            try (FileInputStream fis = new FileInputStream(audioFile)) {
                                mp.setDataSource(fis.getFD());
                            }
                        } else {
                            AssetFileDescriptor afd = openAssetFdWithFallback(normalizedUrl);
                            activeAssetFd = afd;
                            mp.setDataSource(afd.getFileDescriptor(), afd.getStartOffset(), afd.getLength());
                        }

                        mp.setOnPreparedListener(preparedPlayer -> {
                            synchronized (playerLock) {
                                if (mediaPlayer != preparedPlayer || !playbackId.equals(activePlaybackId)) {
                                    return;
                                }
                                try {
                                    int dur = Math.max(0, preparedPlayer.getDuration());
                                    if (!isRemoteHttpUrl(normalizedUrl) && dur <= 0) {
                                        releaseMediaLocked();
                                        emitAudioError(
                                            playbackId,
                                            -1,
                                            -1,
                                            "Ses dosyası süresi geçersiz (duration=" + dur + " ms)."
                                        );
                                        return;
                                    }
                                    hasPrepared = true;
                                    cachedDurationMs = dur;
                                    preparedPlayer.start();
                                    isPausedState = false;
                                    hasPlaybackStarted = true;
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
                                if (completionEmitted) {
                                    return;
                                }
                                if (!hasPrepared || !hasPlaybackStarted) {
                                    releaseMediaLocked();
                                    emitAudioError(
                                        playbackId,
                                        -1,
                                        -1,
                                        "Android MediaPlayer ses başlamadan erken tamamlandı hatası verdi."
                                    );
                                    return;
                                }
                                int dur = cachedDurationMs;
                                int pos = lastKnownPositionMs;
                                try {
                                    dur = Math.max(dur, completedPlayer.getDuration());
                                    pos = Math.max(pos, completedPlayer.getCurrentPosition());
                                } catch (Exception ignored) {
                                }
                                if (dur >= 30000 && pos < Math.round(dur * 0.80f)) {
                                    releaseMediaLocked();
                                    emitAudioError(
                                        playbackId,
                                        -1,
                                        -1,
                                        "Ses kaydı tam süresi dolmadan erken kesildi (pos=" + pos + " ms / dur=" + dur + " ms); tamamlandı sayılmadı."
                                    );
                                    return;
                                }
                                completionEmitted = true;
                                releaseMediaLocked();
                                JSObject donePayload = new JSObject();
                                donePayload.put("playbackId", playbackId);
                                donePayload.put("durationMs", dur);
                                donePayload.put("positionMs", pos);
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
        });
    }

    @PluginMethod
    public void pause(PluginCall call) {
        JSObject res = new JSObject();
        synchronized (playerLock) {
            if (mediaPlayer != null && activePlaybackId != null && hasPrepared) {
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
            if (mediaPlayer != null && activePlaybackId != null && hasPrepared) {
                try {
                    if (requestAudioFocusLocked()) {
                        acquireWakeLockLocked();
                        mediaPlayer.setVolume(targetVolume, targetVolume);
                        mediaPlayer.start();
                        isPausedState = false;
                        pausedByTransientFocusLoss = false;
                        hasPlaybackStarted = true;
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
            if (mediaPlayer != null && hasPrepared) {
                try {
                    playing = mediaPlayer.isPlaying();
                    positionMs = Math.max(0, mediaPlayer.getCurrentPosition());
                    durationMs = Math.max(durationMs, mediaPlayer.getDuration());
                } catch (Exception ignored) {
                }
            }
            res.put("playing", playing);
            res.put("paused", isPausedState);
            res.put("started", hasPlaybackStarted);
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
