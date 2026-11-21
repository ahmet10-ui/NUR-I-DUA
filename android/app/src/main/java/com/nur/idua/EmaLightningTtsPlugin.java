package com.nur.idua;

import android.app.ActivityManager;
import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;
import android.os.Debug;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.nio.LongBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.Normalizer;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import ai.onnxruntime.NodeInfo;
import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OnnxValue;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;
import ai.onnxruntime.TensorInfo;

/**
 * On-device EMA Lightning (8.6M params, 48 kHz mono, Turkish, Apache-2.0) ONNX Runtime plugin.
 *
 * Uses `ozcancelik/ema-lightning-onnx` (converted from `canberk7/ema-lightning`):
 *   - meta.json (357 B)
 *   - text.onnx (4.8 MB)
 *   - sound.onnx (18.1 MB)
 *   - decoder.onnx (12.0 MB)
 *
 * Strictly zero `android.speech.tts.*` imports and zero PyTorch/Python runtime dependencies.
 * Keeps OrtEnvironment + 3 OrtSessions cached across utterances and streams 48 kHz mono PCM16
 * decoded windows directly to AudioTrack for minimal time-to-first-audio.
 */
@CapacitorPlugin(name = "EmaLightningTts")
public class EmaLightningTtsPlugin extends Plugin {

    private static final String TAG = "EmaLightningTts";
    private static final String MODEL_DIR_NAME = "ema_lightning";
    private static final String LAST_TEST_WAV_NAME = "last_test_ema.wav";

    private static final int SAMPLE_RATE = 48000;
    private static final int HOP_SAMPLES = 1920; // 40 ms grid (25 Hz frames)
    private static final int LATENT_DIM = 64;
    private static final int N_FLOW_STEPS = 4;
    private static final int FIRST_WINDOW = 25; // first decoded window = 1.0 s for low firstAudioMs
    private static final int WINDOW = 100;      // subsequent decoded windows = 4.0 s
    private static final int CONTEXT = 8;       // overlap context frames each side
    private static final int MAX_WORD_FRAMES = 250;
    private static final int MAX_FRAMES = 3000;
    private static final double LETTERS_PER_SECOND = 18.0;
    private static final double MAX_PIECE_SECONDS = 10.0;
    private static final int MAX_PIECE_LETTERS = 250;
    private static final double SENTENCE_PAUSE_SEC = 0.25;
    private static final double CLAUSE_PAUSE_SEC = 0.12;
    private static final long MIN_WARMUP_AVAIL_RAM_BYTES = 550L * 1024L * 1024L;

    private static final class ModelFileSpec {
        final String fileName;
        final String downloadUrl;
        final long expectedBytes;
        final String expectedSha256;

        ModelFileSpec(String fileName, String downloadUrl, long expectedBytes, String expectedSha256) {
            this.fileName = fileName;
            this.downloadUrl = downloadUrl;
            this.expectedBytes = expectedBytes;
            this.expectedSha256 = expectedSha256;
        }
    }

    private static final ModelFileSpec[] MODEL_FILES = new ModelFileSpec[] {
        new ModelFileSpec(
            "meta.json",
            "https://huggingface.co/ozcancelik/ema-lightning-onnx/resolve/main/meta.json",
            357L,
            "76627201405723633f5319a208ed7dea63c42acbf3ca997671bccdca9d9186b2"
        ),
        new ModelFileSpec(
            "text.onnx",
            "https://huggingface.co/ozcancelik/ema-lightning-onnx/resolve/main/text.onnx",
            4806400L,
            "ad5d4885b5d218f63d976a6e562334ea0194aec54847a6c6482d328e784089f0"
        ),
        new ModelFileSpec(
            "sound.onnx",
            "https://huggingface.co/ozcancelik/ema-lightning-onnx/resolve/main/sound.onnx",
            18120655L,
            "958364217360cecaa92dc5ff2170d19f3c9f6995fd5e61241ea4068971a46a59"
        ),
        new ModelFileSpec(
            "decoder.onnx",
            "https://huggingface.co/ozcancelik/ema-lightning-onnx/resolve/main/decoder.onnx",
            12031945L,
            "396c06a8e5711fd40bfd2c3f4f33851feb2ad07a86485833844e0ae8ff637b17"
        )
    };

    private static final long TOTAL_MODEL_BYTES = 34959357L;

    private static final String[] DEFAULT_VOCAB = new String[] {
        "<pad>", "<unk>", " ", "!", "\"", "%", "&", "'", "(", ")", ",", "-", ".", "/", ":", ";", "?",
        "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s",
        "t", "u", "v", "w", "x", "y", "z", "ç", "ö", "ü", "ğ", "ı", "ş"
    };

    private static final Set<Character> TURKISH_SPECIAL = new HashSet<>(Arrays.asList(
        'ç', 'ğ', 'ı', 'ö', 'ş', 'ü'
    ));

    private final ExecutorService downloadExecutor = Executors.newSingleThreadExecutor();
    private final ExecutorService synthesisExecutor = Executors.newSingleThreadExecutor();

    private final AtomicBoolean isDownloading = new AtomicBoolean(false);
    private final AtomicBoolean cancelDownloadRequested = new AtomicBoolean(false);
    private final AtomicBoolean warmUpScheduled = new AtomicBoolean(false);
    private final AtomicLong activePlaybackToken = new AtomicLong(0);
    private final AtomicBoolean isPlaybackPaused = new AtomicBoolean(false);
    private volatile String activeUtteranceId = null;

    private final Object ortLock = new Object();
    private OrtEnvironment ortEnv = null;
    private OrtSession textSession = null;
    private OrtSession soundSession = null;
    private OrtSession decoderSession = null;
    private Map<Character, Integer> vocabMap = null;
    private Set<Character> alphaSet = null;
    private int latentDim = LATENT_DIM;
    private int hopSamples = HOP_SAMPLES;
    private int sampleRate = SAMPLE_RATE;
    private int flowSteps = N_FLOW_STEPS;

    private AudioTrack activeAudioTrack = null;
    private final Object audioLock = new Object();
    private AudioManager audioManager = null;
    private AudioFocusRequest activeAudioFocusRequest = null;
    private final AudioManager.OnAudioFocusChangeListener speechFocusChangeListener = focusChange -> {
        // Transient speech focus listener
    };

    private final List<String> recentLogs = new ArrayList<>();
    private final Object logLock = new Object();

    private void requestSpeechAudioFocus() {
        if (audioManager == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                AudioAttributes attrs = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build();
                AudioFocusRequest req = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                    .setAudioAttributes(attrs)
                    .setAcceptsDelayedFocusGain(false)
                    .setOnAudioFocusChangeListener(speechFocusChangeListener)
                    .build();
                activeAudioFocusRequest = req;
                audioManager.requestAudioFocus(req);
            } else {
                @SuppressWarnings("deprecation")
                int ignored = audioManager.requestAudioFocus(
                    speechFocusChangeListener,
                    AudioManager.STREAM_MUSIC,
                    AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK
                );
            }
        } catch (Exception ignored) {
        }
    }

    private void abandonSpeechAudioFocus() {
        if (audioManager == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && activeAudioFocusRequest != null) {
                audioManager.abandonAudioFocusRequest(activeAudioFocusRequest);
                activeAudioFocusRequest = null;
            } else {
                @SuppressWarnings("deprecation")
                int ignored = audioManager.abandonAudioFocus(speechFocusChangeListener);
            }
        } catch (Exception ignored) {
        }
    }

    @Override
    public void load() {
        super.load();
        audioManager = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        if (allFilesPresentWithExpectedSize(getModelDir())) {
            scheduleBackgroundWarmUp("startup");
        }
    }

    private void scheduleBackgroundWarmUp(String reason) {
        if (!warmUpScheduled.compareAndSet(false, true)) {
            return;
        }
        synthesisExecutor.execute(() -> {
            try {
                File dir = getModelDir();
                if (!allFilesPresentWithExpectedSize(dir)) {
                    return;
                }
                ActivityManager am = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
                if (am != null) {
                    ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
                    am.getMemoryInfo(mi);
                    if (mi.lowMemory || mi.availMem < MIN_WARMUP_AVAIL_RAM_BYTES) {
                        addLog("EMA arka plan ön yükleme ertelendi (" + reason + "): boş RAM="
                            + Math.round(mi.availMem / (1024.0 * 1024.0)) + " MB.");
                        return;
                    }
                }
                long t0 = System.currentTimeMillis();
                ensureSessionsLoaded();
                addLog("EMA Lightning oturumları ön yüklendi (" + reason + "): " + (System.currentTimeMillis() - t0) + " ms.");
            } catch (Exception e) {
                addLog("EMA ön yükleme atlandı (" + reason + "): " + e.getMessage());
            }
        });
    }

    private void addLog(String message) {
        String ts = new SimpleDateFormat("HH:mm:ss.SSS", Locale.ROOT).format(new Date());
        String line = "[" + ts + "] " + message;
        Log.i(TAG, line);
        synchronized (logLock) {
            recentLogs.add(line);
            while (recentLogs.size() > 80) {
                recentLogs.remove(0);
            }
        }
        notifyListeners("emaLog", new JSObject().put("line", line));
    }

    private JSArray getRecentLogsArray() {
        JSArray arr = new JSArray();
        synchronized (logLock) {
            for (String s : recentLogs) {
                arr.put(s);
            }
        }
        return arr;
    }

    private File getModelDir() {
        File dir = new File(getContext().getFilesDir(), MODEL_DIR_NAME);
        if (!dir.exists()) {
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
        }
        return dir;
    }

    private boolean isWifiConnected() {
        ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return false;
        Network activeNetwork = cm.getActiveNetwork();
        if (activeNetwork == null) return false;
        NetworkCapabilities caps = cm.getNetworkCapabilities(activeNetwork);
        return caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI);
    }

    private JSObject collectMemoryStats() {
        JSObject mem = new JSObject();
        Runtime rt = Runtime.getRuntime();
        double jvmUsedMb = (rt.totalMemory() - rt.freeMemory()) / (1024.0 * 1024.0);
        double jvmMaxMb = rt.maxMemory() / (1024.0 * 1024.0);
        double nativeHeapMb = Debug.getNativeHeapAllocatedSize() / (1024.0 * 1024.0);

        mem.put("jvmUsedMb", Math.round(jvmUsedMb * 10.0) / 10.0);
        mem.put("jvmMaxMb", Math.round(jvmMaxMb * 10.0) / 10.0);
        mem.put("nativeHeapMb", Math.round(nativeHeapMb * 10.0) / 10.0);

        ActivityManager am = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
        if (am != null) {
            ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
            am.getMemoryInfo(mi);
            mem.put("systemAvailMb", Math.round((mi.availMem / (1024.0 * 1024.0)) * 10.0) / 10.0);
            mem.put("systemTotalMb", Math.round((mi.totalMem / (1024.0 * 1024.0)) * 10.0) / 10.0);
            mem.put("isLowMemory", mi.lowMemory);
        }
        return mem;
    }

    private static String computeSha256Hex(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] buffer = new byte[65536];
        try (InputStream in = new BufferedInputStream(new FileInputStream(file), 65536)) {
            int read;
            while ((read = in.read(buffer)) != -1) {
                digest.update(buffer, 0, read);
            }
        }
        byte[] hash = digest.digest();
        StringBuilder sb = new StringBuilder(hash.length * 2);
        for (byte b : hash) {
            sb.append(String.format(Locale.ROOT, "%02x", b & 0xff));
        }
        return sb.toString();
    }

    private boolean allFilesPresentWithExpectedSize(File dir) {
        for (ModelFileSpec spec : MODEL_FILES) {
            File f = new File(dir, spec.fileName);
            if (!f.exists() || f.length() != spec.expectedBytes) {
                return false;
            }
        }
        return true;
    }

    private long sumPresentBytes(File dir) {
        long sum = 0;
        for (ModelFileSpec spec : MODEL_FILES) {
            File f = new File(dir, spec.fileName);
            if (f.exists()) {
                sum += Math.min(f.length(), spec.expectedBytes);
            } else {
                File part = new File(dir, spec.fileName + ".part");
                if (part.exists()) {
                    sum += Math.min(part.length(), spec.expectedBytes);
                }
            }
        }
        return sum;
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        File dir = getModelDir();
        boolean installed = allFilesPresentWithExpectedSize(dir);
        long presentBytes = sumPresentBytes(dir);
        int percent = (int) Math.min(100, Math.round((presentBytes * 100.0) / TOTAL_MODEL_BYTES));
        File lastWav = new File(dir, LAST_TEST_WAV_NAME);

        JSArray filesArr = new JSArray();
        for (ModelFileSpec spec : MODEL_FILES) {
            File f = new File(dir, spec.fileName);
            JSObject item = new JSObject();
            item.put("fileName", spec.fileName);
            item.put("exists", f.exists());
            item.put("actualBytes", f.exists() ? f.length() : 0L);
            item.put("expectedBytes", spec.expectedBytes);
            item.put("sizeMatched", f.exists() && f.length() == spec.expectedBytes);
            filesArr.put(item);
        }

        JSObject res = new JSObject();
        res.put("modelInstalled", installed);
        res.put("isDownloading", isDownloading.get());
        res.put("wifiConnected", isWifiConnected());
        res.put("downloadedBytes", presentBytes);
        res.put("totalBytes", TOTAL_MODEL_BYTES);
        res.put("percent", percent);
        res.put("storagePath", dir.getAbsolutePath());
        res.put("sessionsLoaded", textSession != null && soundSession != null && decoderSession != null);
        res.put("hasLastTestWav", lastWav.exists() && lastWav.length() > 44);
        res.put("sampleRate", SAMPLE_RATE);
        res.put("files", filesArr);
        res.put("memory", collectMemoryStats());
        res.put("logs", getRecentLogsArray());
        call.resolve(res);
    }

    @PluginMethod
    public void verifyModelIntegrity(PluginCall call) {
        downloadExecutor.execute(() -> {
            File dir = getModelDir();
            JSArray results = new JSArray();
            boolean allOk = true;
            String firstError = null;

            for (ModelFileSpec spec : MODEL_FILES) {
                File f = new File(dir, spec.fileName);
                JSObject entry = new JSObject();
                entry.put("fileName", spec.fileName);
                entry.put("expectedBytes", spec.expectedBytes);
                entry.put("expectedSha256", spec.expectedSha256);

                if (!f.exists()) {
                    allOk = false;
                    entry.put("actualBytes", 0);
                    entry.put("actualSha256", JSONObject.NULL);
                    entry.put("valid", false);
                    entry.put("error", "Dosya mevcut değil");
                    if (firstError == null) firstError = spec.fileName + " bulunamadı.";
                } else {
                    long len = f.length();
                    entry.put("actualBytes", len);
                    try {
                        String actualSha = computeSha256Hex(f);
                        boolean valid = (len == spec.expectedBytes) && spec.expectedSha256.equalsIgnoreCase(actualSha);
                        entry.put("actualSha256", actualSha);
                        entry.put("valid", valid);
                        if (!valid) {
                            allOk = false;
                            String msg = len != spec.expectedBytes
                                ? spec.fileName + " boyut uyumsuz (" + len + " != " + spec.expectedBytes + ")"
                                : spec.fileName + " SHA-256 uyuşmuyor";
                            entry.put("error", msg);
                            if (firstError == null) firstError = msg;
                        }
                    } catch (Exception e) {
                        allOk = false;
                        entry.put("actualSha256", JSONObject.NULL);
                        entry.put("valid", false);
                        entry.put("error", e.getMessage());
                        if (firstError == null) firstError = e.getMessage();
                    }
                }
                results.put(entry);
            }

            addLog(allOk
                ? "EMA Lightning SHA-256 doğrulaması BAŞARILI (4/4 dosya · 33.3 MiB)."
                : "EMA Lightning doğrulama hatası: " + firstError);

            JSObject res = new JSObject();
            res.put("ok", allOk);
            res.put("files", results);
            res.put("logs", getRecentLogsArray());
            if (firstError != null) res.put("error", firstError);
            call.resolve(res);
        });
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        cancelDownloadRequested.set(true);
        JSObject res = new JSObject();
        res.put("ok", true);
        call.resolve(res);
    }

    @PluginMethod
    public void downloadModel(PluginCall call) {
        if (!isDownloading.compareAndSet(false, true)) {
            JSObject res = new JSObject();
            res.put("ok", false);
            res.put("error", "EMA Lightning model indirmesi zaten devam ediyor.");
            call.resolve(res);
            return;
        }
        cancelDownloadRequested.set(false);

        if (!isWifiConnected()) {
            isDownloading.set(false);
            JSObject res = new JSObject();
            res.put("ok", false);
            res.put("wifiRequired", true);
            res.put("error", "EMA Lightning (33.3 MiB) indirmesi için Wi-Fi bağlantısı gereklidir.");
            call.resolve(res);
            return;
        }

        downloadExecutor.execute(() -> {
            File dir = getModelDir();
            try {
                for (ModelFileSpec spec : MODEL_FILES) {
                    if (cancelDownloadRequested.get()) {
                        throw new InterruptedException("İndirme kullanıcı tarafından iptal edildi.");
                    }

                    File target = new File(dir, spec.fileName);
                    if (target.exists() && target.length() == spec.expectedBytes) {
                        String existingSha = computeSha256Hex(target);
                        if (spec.expectedSha256.equalsIgnoreCase(existingSha)) {
                            addLog("Zaten mevcut ve SHA-256 doğrulandı: " + spec.fileName);
                            continue;
                        }
                        //noinspection ResultOfMethodCallIgnored
                        target.delete();
                    }

                    File part = new File(dir, spec.fileName + ".part");
                    if (part.exists()) {
                        //noinspection ResultOfMethodCallIgnored
                        part.delete();
                    }

                    addLog("Wi-Fi indiriliyor: " + spec.fileName + " (" + spec.expectedBytes + " bayt)");
                    downloadSingleFile(spec, part, dir);

                    if (cancelDownloadRequested.get()) {
                        throw new InterruptedException("İndirme iptal edildi.");
                    }

                    emitDownloadProgress("verifying", spec.fileName, sumPresentBytes(dir));
                    String sha = computeSha256Hex(part);
                    if (part.length() != spec.expectedBytes || !spec.expectedSha256.equalsIgnoreCase(sha)) {
                        //noinspection ResultOfMethodCallIgnored
                        part.delete();
                        throw new RuntimeException(spec.fileName + " SHA-256 veya boyut doğrulaması başarısız.");
                    }
                    if (target.exists()) {
                        //noinspection ResultOfMethodCallIgnored
                        target.delete();
                    }
                    if (!part.renameTo(target)) {
                        throw new RuntimeException(spec.fileName + " geçici dosyadan taşınamadı.");
                    }
                    addLog("Doğrulandı ve kaydedildi: " + spec.fileName);
                }

                emitDownloadProgress("ready", "Tamamlandı", TOTAL_MODEL_BYTES);
                scheduleBackgroundWarmUp("download");
                JSObject res = new JSObject();
                res.put("ok", true);
                res.put("percent", 100);
                call.resolve(res);
            } catch (Exception e) {
                addLog("EMA indirme hatası: " + e.getMessage());
                notifyListeners("emaDownloadError", new JSObject().put("message", e.getMessage()));
                JSObject res = new JSObject();
                res.put("ok", false);
                res.put("error", e.getMessage());
                call.resolve(res);
            } finally {
                isDownloading.set(false);
            }
        });
    }

    private void downloadSingleFile(ModelFileSpec spec, File part, File dir) throws Exception {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(spec.downloadUrl);
            conn = (HttpURLConnection) url.openConnection();
            conn.setInstanceFollowRedirects(true);
            conn.setConnectTimeout(20000);
            conn.setReadTimeout(45000);
            conn.setRequestProperty("User-Agent", "NUR-I-DUA-Android/1.0");
            conn.connect();

            int code = conn.getResponseCode();
            if (code == HttpURLConnection.HTTP_MOVED_PERM
                || code == HttpURLConnection.HTTP_MOVED_TEMP
                || code == 307
                || code == 308) {
                String loc = conn.getHeaderField("Location");
                conn.disconnect();
                URL nextUrl = new URL(url, loc);
                conn = (HttpURLConnection) nextUrl.openConnection();
                conn.setInstanceFollowRedirects(true);
                conn.setConnectTimeout(20000);
                conn.setReadTimeout(45000);
                conn.setRequestProperty("User-Agent", "NUR-I-DUA-Android/1.0");
                conn.connect();
                code = conn.getResponseCode();
            }

            if (code < 200 || code >= 300) {
                throw new RuntimeException(spec.fileName + " indirilemedi (HTTP " + code + ")");
            }

            byte[] buf = new byte[32768];
            long lastEmitAt = 0L;
            try (
                InputStream in = new BufferedInputStream(conn.getInputStream(), 32768);
                FileOutputStream out = new FileOutputStream(part)
            ) {
                int read;
                while ((read = in.read(buf)) != -1) {
                    if (cancelDownloadRequested.get()) {
                        return;
                    }
                    out.write(buf, 0, read);
                    long now = System.currentTimeMillis();
                    if (now - lastEmitAt >= 200L) {
                        lastEmitAt = now;
                        emitDownloadProgress("downloading", spec.fileName, sumPresentBytes(dir));
                    }
                }
                out.flush();
            }
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private void emitDownloadProgress(String phase, String currentFile, long downloadedBytes) {
        int percent = (int) Math.min(100, Math.round((downloadedBytes * 100.0) / TOTAL_MODEL_BYTES));
        JSObject payload = new JSObject();
        payload.put("phase", phase);
        payload.put("currentFile", currentFile);
        payload.put("downloadedBytes", downloadedBytes);
        payload.put("totalBytes", TOTAL_MODEL_BYTES);
        payload.put("percent", percent);
        notifyListeners("emaDownloadProgress", payload);
    }

    private long ensureSessionsLoaded() throws Exception {
        synchronized (ortLock) {
            if (textSession != null && soundSession != null && decoderSession != null && vocabMap != null) {
                return 0L;
            }
            long t0 = System.currentTimeMillis();
            File dir = getModelDir();
            if (!allFilesPresentWithExpectedSize(dir)) {
                throw new IllegalStateException("EMA Lightning model dosyaları cihazda kurulu değil.");
            }

            // Parse meta.json
            File metaFile = new File(dir, "meta.json");
            byte[] metaBytes = readFileBytes(metaFile);
            JSONObject metaObj = new JSONObject(new String(metaBytes, StandardCharsets.UTF_8));
            JSONArray vocabArr = metaObj.optJSONArray("vocab");
            Map<Character, Integer> vMap = new HashMap<>();
            Set<Character> aSet = new HashSet<>();
            if (vocabArr != null && vocabArr.length() > 0) {
                for (int i = 0; i < vocabArr.length(); i++) {
                    String tok = vocabArr.getString(i);
                    if (tok.length() == 1) {
                        char c = tok.charAt(0);
                        vMap.put(c, i);
                        aSet.add(c);
                    }
                }
            } else {
                for (int i = 0; i < DEFAULT_VOCAB.length; i++) {
                    if (DEFAULT_VOCAB[i].length() == 1) {
                        char c = DEFAULT_VOCAB[i].charAt(0);
                        vMap.put(c, i);
                        aSet.add(c);
                    }
                }
            }
            vocabMap = vMap;
            alphaSet = aSet;
            latentDim = metaObj.optInt("latent_dim", LATENT_DIM);
            hopSamples = metaObj.optInt("hop", HOP_SAMPLES);
            sampleRate = metaObj.optInt("sample_rate", SAMPLE_RATE);
            JSONArray timesArr = metaObj.optJSONArray("times");
            flowSteps = timesArr != null && timesArr.length() > 0 ? timesArr.length() : N_FLOW_STEPS;

            if (ortEnv == null) {
                ortEnv = OrtEnvironment.getEnvironment();
            }

            int cpuCores = Math.max(2, Math.min(4, Runtime.getRuntime().availableProcessors() / 2));
            OrtSession.SessionOptions opts = new OrtSession.SessionOptions();
            opts.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT);
            opts.setIntraOpNumThreads(cpuCores);
            opts.setInterOpNumThreads(1);

            if (textSession == null) {
                textSession = ortEnv.createSession(new File(dir, "text.onnx").getAbsolutePath(), opts);
            }
            if (soundSession == null) {
                soundSession = ortEnv.createSession(new File(dir, "sound.onnx").getAbsolutePath(), opts);
            }
            if (decoderSession == null) {
                decoderSession = ortEnv.createSession(new File(dir, "decoder.onnx").getAbsolutePath(), opts);
            }
            long elapsed = System.currentTimeMillis() - t0;
            addLog("EMA Lightning ONNX oturumları yüklendi (" + elapsed + " ms, threads=" + cpuCores + ").");
            return elapsed;
        }
    }

    private static byte[] readFileBytes(File f) throws Exception {
        ByteArrayOutputStream baos = new ByteArrayOutputStream((int) f.length());
        try (InputStream in = new FileInputStream(f)) {
            byte[] buf = new byte[8192];
            int r;
            while ((r = in.read(buf)) != -1) {
                baos.write(buf, 0, r);
            }
        }
        return baos.toByteArray();
    }

    private static JSObject serializeTensorMetaMap(Map<String, NodeInfo> map) {
        JSObject obj = new JSObject();
        for (Map.Entry<String, NodeInfo> entry : map.entrySet()) {
            JSObject meta = new JSObject();
            if (entry.getValue().getInfo() instanceof TensorInfo) {
                TensorInfo ti = (TensorInfo) entry.getValue().getInfo();
                meta.put("type", ti.type != null ? ti.type.name() : "UNKNOWN");
                JSArray shape = new JSArray();
                for (long d : ti.getShape()) {
                    shape.put(d);
                }
                meta.put("shape", shape);
            }
            obj.put(entry.getKey(), meta);
        }
        return obj;
    }

    @PluginMethod
    public void verifyInferenceContract(PluginCall call) {
        String sampleText = call.getString("text", "Esselâmü aleyküm. Allah dualarımızı kabul eylesin.");
        synthesisExecutor.execute(() -> {
            try {
                ensureSessionsLoaded();
                String normalized = normalizeTurkishForEma(sampleText, alphaSet);
                List<Piece> pieces = chunkTextForEma(normalized, 1.0);
                int firstTokenLen = pieces.isEmpty() ? 0 : pieces.get(0).text.length();

                JSObject res = new JSObject();
                res.put("ok", true);
                res.put("normalizedText", normalized);
                res.put("tokenLengthL", firstTokenLen);
                res.put("chunkCount", pieces.size());
                res.put("sampleRate", sampleRate);
                res.put("textInputs", serializeTensorMetaMap(textSession.getInputInfo()));
                res.put("textOutputs", serializeTensorMetaMap(textSession.getOutputInfo()));
                res.put("soundInputs", serializeTensorMetaMap(soundSession.getInputInfo()));
                res.put("soundOutputs", serializeTensorMetaMap(soundSession.getOutputInfo()));
                res.put("decoderInputs", serializeTensorMetaMap(decoderSession.getInputInfo()));
                res.put("decoderOutputs", serializeTensorMetaMap(decoderSession.getOutputInfo()));
                res.put("memory", collectMemoryStats());
                res.put("logs", getRecentLogsArray());
                call.resolve(res);
            } catch (Exception e) {
                addLog("EMA kontrat hatası: " + e.getMessage());
                JSObject err = new JSObject();
                err.put("ok", false);
                err.put("error", e.getMessage());
                err.put("logs", getRecentLogsArray());
                call.resolve(err);
            }
        });
    }

    @PluginMethod
    public void speakTest(PluginCall call) {
        String rawText = call.getString("text", "");
        double rate = Math.max(0.5, Math.min(1.6, call.getDouble("rate", 1.0)));
        long seed = call.getInt("seed", 0).longValue();
        float volume = (float) Math.max(0.0, Math.min(1.0, call.getDouble("volume", 0.95)));

        if (rawText == null || rawText.trim().isEmpty()) {
            JSObject err = new JSObject();
            err.put("ok", false);
            err.put("error", "Test metni boş olamaz.");
            call.resolve(err);
            return;
        }

        final long myToken = activePlaybackToken.incrementAndGet();
        isPlaybackPaused.set(false);
        activeUtteranceId = "ema_test_" + myToken;
        stopAudioTrackImmediate();

        synthesisExecutor.execute(() -> {
            JSObject result = runSynthesisAndStreamPlayback(rawText, rate, seed, volume, myToken, activeUtteranceId, true);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String rawText = call.getString("text", "");
        String utteranceIdArg = call.getString("utteranceId", "");
        double rate = Math.max(0.5, Math.min(1.6, call.getDouble("rate", 1.0)));
        long seed = call.getInt("seed", 0).longValue();
        float volume = (float) Math.max(0.0, Math.min(1.0, call.getDouble("volume", 0.95)));

        final String cleanText = rawText == null ? "" : rawText.replaceAll("\\s+", " ").trim();
        if (cleanText.isEmpty()) {
            JSObject err = new JSObject();
            err.put("ok", false);
            err.put("antaliaUsed", false);
            err.put("error", "Seslendirilecek Türkçe metin boş.");
            call.resolve(err);
            return;
        }

        if (!allFilesPresentWithExpectedSize(getModelDir())) {
            JSObject err = new JSObject();
            err.put("ok", false);
            err.put("antaliaUsed", false);
            err.put("modelMissing", true);
            err.put("error", "EMA Lightning model dosyaları (33.3 MiB) cihazda yüklü değil.");
            call.resolve(err);
            return;
        }

        final String utteranceId = (utteranceIdArg != null && !utteranceIdArg.trim().isEmpty())
            ? utteranceIdArg.trim()
            : ("ema_" + System.currentTimeMillis());

        final long myToken = activePlaybackToken.incrementAndGet();
        isPlaybackPaused.set(false);
        activeUtteranceId = utteranceId;
        stopAudioTrackImmediate();

        JSObject accepted = new JSObject();
        accepted.put("ok", true);
        accepted.put("utteranceId", utteranceId);
        accepted.put("engineUsed", "ema_lightning");
        accepted.put("antaliaUsed", false);
        call.resolve(accepted);

        synthesisExecutor.execute(() -> {
            JSObject result = runSynthesisAndStreamPlayback(cleanText, rate, seed, volume, myToken, utteranceId, false);
            if (activePlaybackToken.get() != myToken || Boolean.TRUE.equals(result.optBoolean("cancelled", false))) {
                return;
            }
            if (Boolean.TRUE.equals(result.optBoolean("ok", false))) {
                notifyListeners("emaDone", result);
            } else {
                JSObject errPayload = new JSObject();
                errPayload.put("token", myToken);
                errPayload.put("utteranceId", utteranceId);
                errPayload.put("message", result.optString("error", "EMA Lightning sentezi başarısız oldu."));
                notifyListeners("emaError", errPayload);
            }
        });
    }

    private JSObject runSynthesisAndStreamPlayback(
        String rawText,
        double speed,
        long seed,
        float volume,
        long token,
        String utteranceId,
        boolean saveWav
    ) {
        long wallStartMs = System.currentTimeMillis();
        long modelLoadMs = 0L;
        long preprocessMs = 0L;
        long synthesisMs = 0L;
        long firstAudioMs = -1L;
        int totalSamplesGenerated = 0;
        int windowCount = 0;

        AudioTrack track = null;
        List<short[]> wavChunks = saveWav ? new ArrayList<>() : null;
        long rawNanCount = 0L;
        double sumSqAll = 0.0;
        double sumAll = 0.0;
        float minAll = Float.POSITIVE_INFINITY;
        float maxAll = Float.NEGATIVE_INFINITY;

        try {
            modelLoadMs = ensureSessionsLoaded();
            if (activePlaybackToken.get() != token) {
                return cancelledResult(token, utteranceId);
            }

            long preStart = System.currentTimeMillis();
            String normalized = normalizeTurkishForEma(rawText, alphaSet);
            List<Piece> pieces = chunkTextForEma(normalized, speed);
            preprocessMs = System.currentTimeMillis() - preStart;

            if (pieces.isEmpty()) {
                throw new IllegalArgumentException("Metin normalleştirme sonrasında seslendirilecek Türkçe karakter kalmadı.");
            }

            int minBuf = AudioTrack.getMinBufferSize(sampleRate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT);
            int bufBytes = Math.max(minBuf, sampleRate * 2); // 1 second audio buffer
            AudioAttributes attrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build();
            AudioFormat fmt = new AudioFormat.Builder()
                .setSampleRate(sampleRate)
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                .build();

            track = new AudioTrack(
                attrs,
                fmt,
                bufBytes,
                AudioTrack.MODE_STREAM,
                AudioManager.AUDIO_SESSION_ID_GENERATE
            );
            if (track.getState() != AudioTrack.STATE_INITIALIZED) {
                try {
                    track.release();
                } catch (Exception ignored) {
                }
                throw new IllegalStateException("EMA Lightning AudioTrack başlatılamadı (state=" + track.getState() + ").");
            }
            requestSpeechAudioFocus();
            track.setVolume(volume);
            synchronized (audioLock) {
                activeAudioTrack = track;
            }
            track.play();

            boolean startEmitted = false;
            for (int k = 0; k < pieces.size(); k++) {
                if (activePlaybackToken.get() != token) {
                    return cancelledResult(token, utteranceId);
                }

                Piece piece = pieces.get(k);
                long[] ids = encodePieceIds(piece.text);
                WordMapping wm = computeWords(piece.text);

                long synthStepStart = System.currentTimeMillis();
                float[] hData;
                long[] hShape;
                float[] durData;

                synchronized (ortLock) {
                    try (OnnxTensor idsTensor = OnnxTensor.createTensor(ortEnv, LongBuffer.wrap(ids), new long[] { 1, ids.length })) {
                        Map<String, OnnxTensor> tInputs = new HashMap<>();
                        tInputs.put("ids", idsTensor);
                        try (OrtSession.Result tRes = textSession.run(tInputs)) {
                            OnnxTensor hTensor = extractTensor(tRes, "h");
                            OnnxTensor durTensor = extractTensor(tRes, "dur");
                            hShape = ((TensorInfo) hTensor.getInfo()).getShape();
                            FloatBuffer hb = hTensor.getFloatBuffer();
                            hb.rewind();
                            hData = new float[hb.remaining()];
                            hb.get(hData);
                            FloatBuffer db = durTensor.getFloatBuffer();
                            db.rewind();
                            durData = new float[db.remaining()];
                            db.get(durData);
                        }
                    }
                }

                FramePlan plan = planFrames(wm.cw, wm.wstart, durData, speed);
                int T = plan.T;
                float[] noise = generateGaussianNoise(seed * 1000003L + k, flowSteps * T * latentDim);
                float[] latents;

                synchronized (ortLock) {
                    try (
                        OnnxTensor hIn = OnnxTensor.createTensor(ortEnv, FloatBuffer.wrap(hData), hShape);
                        OnnxTensor cgIn = OnnxTensor.createTensor(ortEnv, FloatBuffer.wrap(plan.cg), new long[] { 1, plan.cg.length });
                        OnnxTensor fgIn = OnnxTensor.createTensor(ortEnv, FloatBuffer.wrap(plan.fg), new long[] { 1, T });
                        OnnxTensor cwIn = OnnxTensor.createTensor(ortEnv, LongBuffer.wrap(wm.cw), new long[] { 1, wm.cw.length });
                        OnnxTensor fwIn = OnnxTensor.createTensor(ortEnv, LongBuffer.wrap(plan.fw), new long[] { 1, T });
                        OnnxTensor noiseIn = OnnxTensor.createTensor(ortEnv, FloatBuffer.wrap(noise), new long[] { 1, flowSteps, T, latentDim })
                    ) {
                        Map<String, OnnxTensor> sInputs = new HashMap<>();
                        sInputs.put("h", hIn);
                        sInputs.put("cg", cgIn);
                        sInputs.put("fg", fgIn);
                        sInputs.put("cw", cwIn);
                        sInputs.put("fw", fwIn);
                        sInputs.put("noise", noiseIn);
                        try (OrtSession.Result sRes = soundSession.run(sInputs)) {
                            OnnxTensor latTensor = extractTensor(sRes, "latents");
                            FloatBuffer lb = latTensor.getFloatBuffer();
                            lb.rewind();
                            latents = new float[lb.remaining()];
                            lb.get(latents);
                        }
                    }
                }
                synthesisMs += (System.currentTimeMillis() - synthStepStart);

                int firstWin = (k == 0) ? FIRST_WINDOW : WINDOW;
                List<int[]> wins = computeWindows(T, firstWin);

                for (int[] win : wins) {
                    if (activePlaybackToken.get() != token) {
                        return cancelledResult(token, utteranceId);
                    }
                    int s = win[0];
                    int e = win[1];
                    int a = Math.max(0, s - CONTEXT);
                    int b = Math.min(T, e + CONTEXT);
                    int n = b - a;
                    int cropStart = (s - a) * hopSamples;
                    int cropEnd = (e - a) * hopSamples;
                    int cropLen = Math.max(0, cropEnd - cropStart);

                    float[] z = new float[latentDim * n];
                    for (int f = 0; f < n; f++) {
                        int srcBase = (a + f) * latentDim;
                        for (int d = 0; d < latentDim; d++) {
                            z[d * n + f] = latents[srcBase + d];
                        }
                    }

                    long decStart = System.currentTimeMillis();
                    float[] decodedWindow;
                    synchronized (ortLock) {
                        try (OnnxTensor zIn = OnnxTensor.createTensor(ortEnv, FloatBuffer.wrap(z), new long[] { 1, latentDim, n })) {
                            Map<String, OnnxTensor> dInputs = new HashMap<>();
                            dInputs.put("z", zIn);
                            try (OrtSession.Result dRes = decoderSession.run(dInputs)) {
                                OnnxTensor audioOut = extractTensor(dRes, "audio");
                                FloatBuffer ab = audioOut.getFloatBuffer();
                                ab.rewind();
                                int totalOut = ab.remaining();
                                int safeStart = Math.min(cropStart, totalOut);
                                int safeEnd = Math.min(cropEnd, totalOut);
                                decodedWindow = new float[Math.max(0, safeEnd - safeStart)];
                                if (safeStart > 0) {
                                    ab.position(safeStart);
                                }
                                if (decodedWindow.length > 0) {
                                    ab.get(decodedWindow, 0, decodedWindow.length);
                                }
                            }
                        }
                    }
                    synthesisMs += (System.currentTimeMillis() - decStart);
                    windowCount++;

                    if (decodedWindow.length == 0) continue;

                    short[] pcm = new short[decodedWindow.length];
                    for (int i = 0; i < decodedWindow.length; i++) {
                        float sample = decodedWindow[i];
                        if (Float.isNaN(sample) || Float.isInfinite(sample)) {
                            rawNanCount++;
                            sample = 0.0f;
                        }
                        if (sample < minAll) minAll = sample;
                        if (sample > maxAll) maxAll = sample;
                        sumAll += sample;
                        sumSqAll += (double) sample * sample;

                        float clamped = Math.max(-1.0f, Math.min(1.0f, sample));
                        pcm[i] = (short) Math.round(clamped * 32767.0f);
                    }
                    totalSamplesGenerated += pcm.length;
                    if (wavChunks != null) wavChunks.add(pcm);

                    if (!startEmitted) {
                        startEmitted = true;
                        firstAudioMs = System.currentTimeMillis() - wallStartMs;
                        JSObject startPayload = new JSObject();
                        startPayload.put("token", token);
                        startPayload.put("utteranceId", utteranceId);
                        startPayload.put("firstAudioMs", firstAudioMs);
                        startPayload.put("timeToFirstAudioMs", firstAudioMs);
                        notifyListeners("emaStart", startPayload);
                    }

                    writePcmChunkWithPauseSupport(track, pcm, token, utteranceId);
                }

                if (piece.pauseSec > 0.0 && k < pieces.size() - 1 && activePlaybackToken.get() == token) {
                    int silenceLen = (int) Math.round(piece.pauseSec * sampleRate);
                    if (silenceLen > 0) {
                        short[] silence = new short[silenceLen];
                        totalSamplesGenerated += silenceLen;
                        if (wavChunks != null) wavChunks.add(silence);
                        writePcmChunkWithPauseSupport(track, silence, token, utteranceId);
                    }
                }
            }

            emitMouthLevel(0.0, utteranceId);
            releaseTrackAfterCompletion();

            if (activePlaybackToken.get() != token) {
                return cancelledResult(token, utteranceId);
            }

            if (saveWav && wavChunks != null && totalSamplesGenerated > 0) {
                writeWavFile(new File(getModelDir(), LAST_TEST_WAV_NAME), wavChunks, totalSamplesGenerated, sampleRate);
            }

            long audioDurationMs = Math.round((totalSamplesGenerated * 1000.0) / sampleRate);
            long totalWallMs = System.currentTimeMillis() - wallStartMs;
            double rtf = audioDurationMs > 0
                ? Math.round(((double) synthesisMs / audioDurationMs) * 1000.0) / 1000.0
                : 0.0;

            double mean = totalSamplesGenerated > 0 ? sumAll / totalSamplesGenerated : 0.0;
            double rms = totalSamplesGenerated > 0 ? Math.sqrt(sumSqAll / totalSamplesGenerated) : 0.0;
            double peak = Math.max(Math.abs(minAll == Float.POSITIVE_INFINITY ? 0f : minAll), Math.abs(maxAll == Float.NEGATIVE_INFINITY ? 0f : maxAll));

            JSObject pcmStats = new JSObject();
            pcmStats.put("sampleRate", sampleRate);
            pcmStats.put("channels", 1);
            pcmStats.put("encoding", "PCM_16BIT");
            pcmStats.put("sampleCount", totalSamplesGenerated);
            pcmStats.put("durationMs", audioDurationMs);
            pcmStats.put("min", minAll == Float.POSITIVE_INFINITY ? 0.0 : Math.round(minAll * 10000.0) / 10000.0);
            pcmStats.put("max", maxAll == Float.NEGATIVE_INFINITY ? 0.0 : Math.round(maxAll * 10000.0) / 10000.0);
            pcmStats.put("peak", Math.round(peak * 10000.0) / 10000.0);
            pcmStats.put("rms", Math.round(rms * 10000.0) / 10000.0);
            pcmStats.put("dcOffset", Math.round(mean * 100000.0) / 100000.0);
            pcmStats.put("nanOrInfCount", rawNanCount);

            addLog("EMA Lightning sentez/oynatım tamamlandı: firstAudio=" + firstAudioMs + "ms, synth=" + synthesisMs
                + "ms, audio=" + audioDurationMs + "ms, RTF=" + rtf + ", chunks=" + pieces.size() + ", windows=" + windowCount);

            JSObject out = new JSObject();
            out.put("ok", true);
            out.put("token", token);
            out.put("utteranceId", utteranceId);
            out.put("engineUsed", "ema_lightning");
            out.put("antaliaUsed", false);
            out.put("sampleRate", sampleRate);
            out.put("modelLoadMs", modelLoadMs);
            out.put("preprocessMs", preprocessMs);
            out.put("firstAudioMs", Math.max(0L, firstAudioMs));
            out.put("timeToFirstAudioMs", Math.max(0L, firstAudioMs));
            out.put("synthesisMs", synthesisMs);
            out.put("audioDurationMs", audioDurationMs);
            out.put("totalWallMs", totalWallMs);
            out.put("chunkCount", pieces.size());
            out.put("windowCount", windowCount);
            out.put("streamingUsed", true);
            out.put("rtf", rtf);
            out.put("realTimeFactor", rtf);
            out.put("rawPcmStats", pcmStats);
            out.put("playedPcmStats", pcmStats);
            out.put("memory", collectMemoryStats());
            out.put("logs", getRecentLogsArray());
            if (saveWav) {
                out.put("wavFile", new File(getModelDir(), LAST_TEST_WAV_NAME).getAbsolutePath());
            }
            return out;
        } catch (Exception e) {
            stopAudioTrackImmediate();
            emitMouthLevel(0.0, utteranceId);
            addLog("EMA Lightning sentez hatası: " + e.getMessage());
            JSObject err = new JSObject();
            err.put("ok", false);
            err.put("token", token);
            err.put("utteranceId", utteranceId);
            err.put("engineUsed", "ema_lightning");
            err.put("antaliaUsed", false);
            err.put("error", e.getMessage() != null ? e.getMessage() : "EMA Lightning sentezi başarısız.");
            err.put("logs", getRecentLogsArray());
            return err;
        }
    }

    private JSObject cancelledResult(long token, String utteranceId) {
        stopAudioTrackImmediate();
        emitMouthLevel(0.0, utteranceId);
        JSObject res = new JSObject();
        res.put("ok", false);
        res.put("cancelled", true);
        res.put("token", token);
        res.put("utteranceId", utteranceId);
        res.put("logs", getRecentLogsArray());
        return res;
    }

    private void writePcmChunkWithPauseSupport(AudioTrack track, short[] pcm, long token, String utteranceId) {
        int offset = 0;
        int blockShorts = 4800; // 100 ms blocks at 48 kHz
        while (offset < pcm.length && activePlaybackToken.get() == token) {
            if (isPlaybackPaused.get()) {
                synchronized (audioLock) {
                    if (activeAudioTrack != null && activeAudioTrack.getPlayState() == AudioTrack.PLAYSTATE_PLAYING) {
                        try {
                            activeAudioTrack.pause();
                        } catch (Exception ignored) {
                        }
                    }
                }
                emitMouthLevel(0.0, utteranceId);
                try {
                    Thread.sleep(45);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    return;
                }
                continue;
            } else {
                synchronized (audioLock) {
                    if (activeAudioTrack != null && activeAudioTrack.getPlayState() == AudioTrack.PLAYSTATE_PAUSED) {
                        try {
                            activeAudioTrack.play();
                        } catch (Exception ignored) {
                        }
                    }
                }
            }

            int count = Math.min(blockShorts, pcm.length - offset);
            double sumSq = 0.0;
            for (int i = 0; i < count; i++) {
                double v = pcm[offset + i] / 32768.0;
                sumSq += v * v;
            }
            double rms = Math.sqrt(sumSq / Math.max(1, count));
            emitMouthLevel(Math.max(0.0, Math.min(1.0, (rms - 0.012) * 4.8)), utteranceId);
            int written = track.write(pcm, offset, count);
            if (written < 0) {
                throw new RuntimeException("EMA AudioTrack write hatası (code=" + written + ").");
            }
            offset += count;
        }
    }

    private void emitMouthLevel(double level, String utteranceId) {
        JSObject payload = new JSObject();
        payload.put("level", level);
        if (utteranceId != null) {
            payload.put("utteranceId", utteranceId);
        }
        notifyListeners("emaMouth", payload);
    }

    @PluginMethod
    public void replayLastTestWav(PluginCall call) {
        float volume = (float) Math.max(0.0, Math.min(1.0, call.getDouble("volume", 0.95)));
        File wav = new File(getModelDir(), LAST_TEST_WAV_NAME);
        if (!wav.exists() || wav.length() <= 44) {
            JSObject err = new JSObject();
            err.put("ok", false);
            err.put("error", "Tekrar çalınacak son EMA WAV kaydı bulunamadı.");
            call.resolve(err);
            return;
        }

        final long myToken = activePlaybackToken.incrementAndGet();
        isPlaybackPaused.set(false);
        activeUtteranceId = "ema_replay_" + myToken;
        stopAudioTrackImmediate();

        synthesisExecutor.execute(() -> {
            try {
                byte[] allBytes = readFileBytes(wav);
                int pcmBytesLen = allBytes.length - 44;
                int totalSamples = pcmBytesLen / 2;
                short[] pcm = new short[totalSamples];
                ByteBuffer.wrap(allBytes, 44, pcmBytesLen).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(pcm);

                int minBuf = AudioTrack.getMinBufferSize(sampleRate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT);
                AudioAttributes attrs = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build();
                AudioFormat fmt = new AudioFormat.Builder()
                    .setSampleRate(sampleRate)
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build();
                AudioTrack track = new AudioTrack(attrs, fmt, Math.max(minBuf, sampleRate * 2), AudioTrack.MODE_STREAM, AudioManager.AUDIO_SESSION_ID_GENERATE);
                if (track.getState() != AudioTrack.STATE_INITIALIZED) {
                    try {
                        track.release();
                    } catch (Exception ignored) {
                    }
                    throw new IllegalStateException("EMA replay AudioTrack başlatılamadı (state=" + track.getState() + ").");
                }
                requestSpeechAudioFocus();
                track.setVolume(volume);
                synchronized (audioLock) {
                    activeAudioTrack = track;
                }
                track.play();
                writePcmChunkWithPauseSupport(track, pcm, myToken, activeUtteranceId);
                emitMouthLevel(0.0, activeUtteranceId);
                releaseTrackAfterCompletion();

                JSObject res = new JSObject();
                res.put("ok", true);
                res.put("logs", getRecentLogsArray());
                call.resolve(res);
            } catch (Exception e) {
                stopAudioTrackImmediate();
                JSObject err = new JSObject();
                err.put("ok", false);
                err.put("error", e.getMessage());
                call.resolve(err);
            }
        });
    }

    @PluginMethod
    public void pause(PluginCall call) {
        isPlaybackPaused.set(true);
        synchronized (audioLock) {
            if (activeAudioTrack != null && activeAudioTrack.getPlayState() == AudioTrack.PLAYSTATE_PLAYING) {
                try {
                    activeAudioTrack.pause();
                } catch (Exception ignored) {
                }
            }
        }
        emitMouthLevel(0.0, activeUtteranceId);
        call.resolve(new JSObject().put("ok", true));
    }

    @PluginMethod
    public void resume(PluginCall call) {
        isPlaybackPaused.set(false);
        synchronized (audioLock) {
            if (activeAudioTrack != null && activeAudioTrack.getPlayState() == AudioTrack.PLAYSTATE_PAUSED) {
                try {
                    activeAudioTrack.play();
                } catch (Exception ignored) {
                }
            }
        }
        JSObject res = new JSObject();
        res.put("ok", true);
        res.put("utteranceId", activeUtteranceId);
        call.resolve(res);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        activePlaybackToken.incrementAndGet();
        isPlaybackPaused.set(false);
        activeUtteranceId = null;
        stopAudioTrackImmediate();
        call.resolve(new JSObject().put("ok", true));
    }

    @PluginMethod
    public void stopTest(PluginCall call) {
        activePlaybackToken.incrementAndGet();
        isPlaybackPaused.set(false);
        activeUtteranceId = null;
        stopAudioTrackImmediate();
        call.resolve(new JSObject().put("ok", true));
    }

    private void releaseTrackAfterCompletion() {
        synchronized (audioLock) {
            if (activeAudioTrack != null) {
                try {
                    activeAudioTrack.stop();
                } catch (Exception ignored) {
                }
                try {
                    activeAudioTrack.release();
                } catch (Exception ignored) {
                }
                activeAudioTrack = null;
            }
        }
        abandonSpeechAudioFocus();
    }

    private void stopAudioTrackImmediate() {
        synchronized (audioLock) {
            if (activeAudioTrack != null) {
                try {
                    activeAudioTrack.pause();
                    activeAudioTrack.flush();
                    activeAudioTrack.stop();
                } catch (Exception ignored) {
                }
                try {
                    activeAudioTrack.release();
                } catch (Exception ignored) {
                }
                activeAudioTrack = null;
            }
        }
        abandonSpeechAudioFocus();
    }

    // ---------- Pure Java Turkish Text Normalization, Chunker, Frame Planner & Noise ----------

    private static final String[] ONES = { "", "bir", "iki", "üç", "dört", "beş", "altı", "yedi", "sekiz", "dokuz" };
    private static final String[] TENS = { "", "on", "yirmi", "otuz", "kırk", "elli", "altmış", "yetmiş", "seksen", "doksan" };
    private static final String[] SCALES = { "", "bin", "milyon", "milyar", "trilyon" };

    private static String hundredsToTurkish(int n) {
        int h = n / 100;
        int t = (n % 100) / 10;
        int o = n % 10;
        StringBuilder sb = new StringBuilder();
        if (h > 0) sb.append(h == 1 ? "yüz" : ONES[h] + " yüz");
        if (t > 0) {
            if (sb.length() > 0) sb.append(' ');
            sb.append(TENS[t]);
        }
        if (o > 0) {
            if (sb.length() > 0) sb.append(' ');
            sb.append(ONES[o]);
        }
        return sb.toString();
    }

    private static String integerToTurkishWords(String rawDigits) {
        if (rawDigits == null || rawDigits.isEmpty()) return "";
        if (rawDigits.length() > 1 && rawDigits.startsWith("0")) {
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < rawDigits.length(); i++) {
                if (i > 0) sb.append(' ');
                int d = rawDigits.charAt(i) - '0';
                sb.append(d == 0 ? "sıfır" : (d >= 1 && d <= 9 ? ONES[d] : ""));
            }
            return sb.toString().trim();
        }
        String trimmed = rawDigits.replaceFirst("^0+", "");
        if (trimmed.isEmpty()) return "sıfır";
        long num;
        try {
            num = Long.parseLong(trimmed);
        } catch (NumberFormatException e) {
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < rawDigits.length(); i++) {
                if (i > 0) sb.append(' ');
                int d = rawDigits.charAt(i) - '0';
                sb.append(d == 0 ? "sıfır" : (d >= 1 && d <= 9 ? ONES[d] : ""));
            }
            return sb.toString().trim();
        }
        if (num == 0) return "sıfır";
        List<Integer> groups = new ArrayList<>();
        long rem = num;
        while (rem > 0) {
            groups.add((int) (rem % 1000L));
            rem /= 1000L;
        }
        StringBuilder out = new StringBuilder();
        for (int i = groups.size() - 1; i >= 0; i--) {
            int g = groups.get(i);
            if (g == 0) continue;
            if (out.length() > 0) out.append(' ');
            if (i == 1 && g == 1) {
                out.append("bin");
            } else {
                out.append(hundredsToTurkish(g));
                if (i < SCALES.length && !SCALES[i].isEmpty()) {
                    out.append(' ').append(SCALES[i]);
                }
            }
        }
        return out.toString();
    }

    private static String ordinalSuffix(String word) {
        if (word.endsWith("dört")) {
            return word.substring(0, word.length() - 1) + "üncü";
        }
        char lastVowel = 0;
        for (int i = word.length() - 1; i >= 0; i--) {
            char c = word.charAt(i);
            if ("aeıioöuü".indexOf(c) >= 0) {
                lastVowel = c;
                break;
            }
        }
        boolean endsWithVowel = !word.isEmpty() && "aeıioöuü".indexOf(word.charAt(word.length() - 1)) >= 0;
        if (lastVowel == 0) return word;
        String suffix;
        if (lastVowel == 'a' || lastVowel == 'ı') suffix = endsWithVowel ? "ncı" : "ıncı";
        else if (lastVowel == 'e' || lastVowel == 'i') suffix = endsWithVowel ? "nci" : "inci";
        else if (lastVowel == 'o' || lastVowel == 'u') suffix = endsWithVowel ? "ncu" : "uncu";
        else suffix = endsWithVowel ? "ncü" : "üncü";
        return word + suffix;
    }

    private static String replacePattern(String input, Pattern pattern, java.util.function.Function<Matcher, String> fn) {
        Matcher m = pattern.matcher(input);
        StringBuffer sb = new StringBuffer();
        while (m.find()) {
            m.appendReplacement(sb, Matcher.quoteReplacement(fn.apply(m)));
        }
        m.appendTail(sb);
        return sb.toString();
    }

    private static String normalizeTurkishForEma(String rawText, Set<Character> allowedAlpha) {
        if (rawText == null || rawText.trim().isEmpty()) return "";
        String text = rawText
            .replaceAll("[\\x00-\\x08\\x0b-\\x1f\\x7f-\\x9f\\u061c\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069]", " ")
            .replace('’', '\'').replace('‘', '\'').replace('ʼ', '\'').replace('´', '\'').replace('`', '\'')
            .replace('“', '"').replace('”', '"').replace('„', '"').replace('«', '"').replace('»', '"')
            .replace('–', '-').replace('—', '-').replace('−', '-').replace("…", "...")
            .replace("@", "")
            .replaceAll("[_/\\\\]+", " ");

        text = text.replaceAll("(?i)\\bDr\\.", "Doktor")
            .replaceAll("(?i)\\bProf\\.", "Profesör")
            .replaceAll("(?i)\\bHz\\.", "Hazreti")
            .replaceAll("(?i)(\\d+)\\s*kg\\b", "$1 kilogram")
            .replaceAll("(?i)(\\d+)\\s*km\\b", "$1 kilometre")
            .replaceAll("(?i)(\\d+)\\s*dk\\b", "$1 dakika")
            .replaceAll("(?i)(\\d+)\\s*sn\\b", "$1 saniye")
            .replaceAll("₺\\s*(\\d+(?:,\\d+)?)", "$1 Türk lirası")
            .replaceAll("(\\d+(?:,\\d+)?)\\s*TL\\b", "$1 Türk lirası");

        text = replacePattern(text, Pattern.compile("\\b(\\d{1,2}):(\\d{2})\\b"), m -> {
            String h = integerToTurkishWords(String.valueOf(Integer.parseInt(m.group(1))));
            String mm = m.group(2);
            int mVal = Integer.parseInt(mm);
            if (mVal == 0) return h + " sıfır sıfır";
            if (mm.startsWith("0")) return h + " sıfır " + integerToTurkishWords(String.valueOf(mVal));
            return h + " " + integerToTurkishWords(mm);
        });

        text = text.replaceAll("%\\s*(\\d+(?:[,.]\\d+)?)", "yüzde $1");

        text = replacePattern(text, Pattern.compile("\\b(\\d+),(\\d+)\\b"),
            m -> integerToTurkishWords(m.group(1)) + " virgül " + integerToTurkishWords(m.group(2)));

        text = replacePattern(text, Pattern.compile("\\b(\\d+)\\.(?=\\s+[A-Za-zÇĞİÖŞÜçğıöşü])"),
            m -> ordinalSuffix(integerToTurkishWords(m.group(1))));

        text = replacePattern(text, Pattern.compile("\\b\\d+\\b"),
            m -> integerToTurkishWords(m.group(0)));

        Locale tr = new Locale("tr", "TR");
        String lowered = text.replace("İ", "i").replace("I", "ı").toLowerCase(tr);
        StringBuilder out = new StringBuilder(lowered.length());
        for (int i = 0; i < lowered.length(); i++) {
            char ch = lowered.charAt(i);
            if (!TURKISH_SPECIAL.contains(ch)) {
                String decomposed = Normalizer.normalize(String.valueOf(ch), Normalizer.Form.NFKD);
                StringBuilder cleaned = new StringBuilder();
                for (int j = 0; j < decomposed.length(); j++) {
                    char dc = decomposed.charAt(j);
                    if (Character.getType(dc) != Character.NON_SPACING_MARK && Character.getType(dc) != Character.COMBINING_SPACING_MARK) {
                        cleaned.append(dc);
                    }
                }
                for (int j = 0; j < cleaned.length(); j++) {
                    char cc = cleaned.charAt(j);
                    out.append(allowedAlpha.contains(cc) ? cc : ' ');
                }
            } else {
                out.append(allowedAlpha.contains(ch) ? ch : ' ');
            }
        }
        return out.toString().replaceAll("\\s+", " ").trim();
    }

    private static final class Piece {
        final String text;
        final double pauseSec;

        Piece(String text, double pauseSec) {
            this.text = text;
            this.pauseSec = pauseSec;
        }
    }

    private static String finishPiece(String piece) {
        String stripped = piece.replaceAll("[\"')]+$", "");
        if (stripped.endsWith(".") || stripped.endsWith("!") || stripped.endsWith("?")) {
            return piece;
        }
        return piece.replaceAll("[,;:\\- ]+$", "") + ".";
    }

    private static List<Piece> chunkTextForEma(String text, double speed) {
        int limit = (int) Math.floor(Math.min(MAX_PIECE_LETTERS, LETTERS_PER_SECOND * MAX_PIECE_SECONDS * speed));
        limit = Math.max(40, limit);
        List<Piece> pieces = new ArrayList<>();
        String rest = text == null ? "" : text.trim();
        Pattern[] cutPatterns = new Pattern[] {
            Pattern.compile("[.!?]+[\"')]*(?= )"),
            Pattern.compile("[,;:](?= )"),
            Pattern.compile("\\S(?= )")
        };
        double[] cutGaps = new double[] { SENTENCE_PAUSE_SEC, CLAUSE_PAUSE_SEC, CLAUSE_PAUSE_SEC };
        Pattern hasLetter = Pattern.compile("\\p{L}");

        while (!rest.isEmpty()) {
            int cut = rest.length();
            double pause = 0.0;
            if (rest.length() > limit) {
                cut = limit;
                String head = rest.substring(0, Math.min(rest.length(), limit + 1));
                for (int p = 0; p < cutPatterns.length; p++) {
                    Matcher m = cutPatterns[p].matcher(head);
                    int lastEnd = -1;
                    while (m.find()) {
                        lastEnd = m.end();
                    }
                    if (lastEnd > 0) {
                        cut = lastEnd;
                        pause = cutGaps[p];
                        break;
                    }
                }
            }
            String piece = rest.substring(0, cut).trim();
            rest = rest.substring(cut).trim();
            if (hasLetter.matcher(piece).find()) {
                pieces.add(new Piece(finishPiece(piece), pause));
            }
        }
        if (!pieces.isEmpty()) {
            Piece last = pieces.get(pieces.size() - 1);
            pieces.set(pieces.size() - 1, new Piece(last.text, 0.0));
        }
        return pieces;
    }

    private long[] encodePieceIds(String piece) {
        long[] ids = new long[piece.length()];
        for (int i = 0; i < piece.length(); i++) {
            Integer idx = vocabMap.get(piece.charAt(i));
            ids[i] = idx != null ? idx : 1L;
        }
        return ids;
    }

    private static final class WordMapping {
        final long[] cw;
        final int[] wstart;

        WordMapping(long[] cw, int[] wstart) {
            this.cw = cw;
            this.wstart = wstart;
        }
    }

    private static WordMapping computeWords(String text) {
        List<Integer> starts = new ArrayList<>();
        for (int i = 0; i < text.length(); i++) {
            if (text.charAt(i) != ' ' && (i == 0 || text.charAt(i - 1) == ' ')) {
                starts.add(i);
            }
        }
        if (starts.isEmpty()) starts.add(0);
        int[] bounds = new int[starts.size() + 1];
        bounds[0] = 0;
        for (int i = 1; i < starts.size(); i++) bounds[i] = starts.get(i);
        bounds[starts.size()] = text.length();

        long[] cw = new long[text.length()];
        int[] wstart = new int[text.length()];
        for (int w = 0; w + 1 < bounds.length; w++) {
            for (int i = bounds[w]; i < bounds[w + 1]; i++) {
                cw[i] = w;
                wstart[i] = bounds[w];
            }
        }
        return new WordMapping(cw, wstart);
    }

    private static final class FramePlan {
        final int T;
        final long[] fw;
        final float[] cg;
        final float[] fg;

        FramePlan(int T, long[] fw, float[] cg, float[] fg) {
            this.T = T;
            this.fw = fw;
            this.cg = cg;
            this.fg = fg;
        }
    }

    private static FramePlan planFrames(long[] cw, int[] wstart, float[] dur, double speed) {
        int L = cw.length;
        int nWords = (int) cw[L - 1] + 1;
        float[] d = new float[L];
        for (int i = 0; i < L; i++) {
            d[i] = (float) (dur[i] / speed);
        }
        double[] sums = new double[nWords];
        for (int i = 0; i < L; i++) {
            sums[(int) cw[i]] += d[i];
        }
        int[] counts = new int[nWords];
        int totalFrames = 0;
        for (int w = 0; w < nWords; w++) {
            counts[w] = Math.min(MAX_WORD_FRAMES, Math.max(1, (int) Math.round(sums[w])));
            totalFrames += counts[w];
        }
        int T = Math.min(totalFrames, MAX_FRAMES);
        long[] fw = new long[T];
        float[] fp = new float[T];
        for (int w = 0, f = 0; w < nWords; w++) {
            for (int j = 0; j < counts[w] && f < T; j++, f++) {
                fw[f] = w;
                fp[f] = j / (float) counts[w];
            }
        }

        float[] c = new float[L];
        float[] done = new float[L];
        float[] total = new float[nWords];
        float acc = 0.0f;
        for (int i = 0; i < L; i++) {
            c[i] = Math.max(d[i], 1e-4f);
            acc += c[i];
            done[i] = acc;
            total[(int) cw[i]] += c[i];
        }

        float[] wlen = new float[nWords];
        for (long w : cw) wlen[(int) w] += 1.0f;
        float[] woff = new float[nWords];
        for (int w = 1; w < nWords; w++) {
            woff[w] = woff[w - 1] + Math.max(wlen[w - 1], 1.0f);
        }

        float[] cg = new float[L];
        float[] fg = new float[T];
        for (int i = 0; i < L; i++) {
            int ws = wstart[i];
            float before = done[ws] - c[ws];
            int wordIdx = (int) cw[i];
            float cp = Math.min(1.0f, Math.max(0.0f, (done[i] - before - 0.5f * c[i]) / Math.max(total[wordIdx], 1e-8f)));
            cg[i] = woff[wordIdx] + cp * Math.max(wlen[wordIdx], 1.0f);
        }
        for (int f = 0; f < T; f++) {
            int wordIdx = (int) fw[f];
            fg[f] = woff[wordIdx] + fp[f] * Math.max(wlen[wordIdx], 1.0f);
        }
        return new FramePlan(T, fw, cg, fg);
    }

    private static List<int[]> computeWindows(int frames, int firstWindow) {
        List<int[]> spans = new ArrayList<>();
        for (int s = 0; s < frames; ) {
            int e = Math.min(frames, s + (s == 0 ? firstWindow : WINDOW));
            spans.add(new int[] { s, e });
            s = e;
        }
        return spans;
    }

    private static float[] generateGaussianNoise(long seed, int n) {
        final int[] state = new int[] { (int) seed };
        float[] out = new float[n];
        for (int i = 0; i < n; i += 2) {
            double u1 = nextMulberry32(state);
            double u2 = nextMulberry32(state);
            double r = Math.sqrt(-2.0 * Math.log(Math.max(1e-12, 1.0 - u1)));
            double th = 2.0 * Math.PI * u2;
            out[i] = (float) (r * Math.cos(th));
            if (i + 1 < n) {
                out[i + 1] = (float) (r * Math.sin(th));
            }
        }
        return out;
    }

    private static double nextMulberry32(int[] state) {
        int a = state[0] + 0x6d2b79f5;
        state[0] = a;
        int t = (a ^ (a >>> 15)) * (a | 1);
        t ^= t + (t ^ (t >>> 7)) * (t | 61);
        long unsigned = (t ^ (t >>> 14)) & 0xffffffffL;
        return unsigned / 4294967296.0;
    }

    private static OnnxTensor extractTensor(OrtSession.Result result, String name) throws Exception {
        Optional<OnnxValue> opt = result.get(name);
        if (!opt.isPresent() || !(opt.get() instanceof OnnxTensor)) {
            throw new RuntimeException("EMA ONNX çıkış tensörü bulunamadı: " + name);
        }
        return (OnnxTensor) opt.get();
    }

    private static void writeWavFile(File outFile, List<short[]> chunks, int totalSamples, int sr) throws Exception {
        int dataBytes = totalSamples * 2;
        byte[] header = new byte[44];
        ByteBuffer hb = ByteBuffer.wrap(header).order(ByteOrder.LITTLE_ENDIAN);
        hb.put(new byte[] { 'R', 'I', 'F', 'F' });
        hb.putInt(36 + dataBytes);
        hb.put(new byte[] { 'W', 'A', 'V', 'E', 'f', 'm', 't', ' ' });
        hb.putInt(16);
        hb.putShort((short) 1);
        hb.putShort((short) 1);
        hb.putInt(sr);
        hb.putInt(sr * 2);
        hb.putShort((short) 2);
        hb.putShort((short) 16);
        hb.put(new byte[] { 'd', 'a', 't', 'a' });
        hb.putInt(dataBytes);

        try (FileOutputStream fos = new FileOutputStream(outFile)) {
            fos.write(header);
            for (short[] chunk : chunks) {
                byte[] bytes = new byte[chunk.length * 2];
                ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().put(chunk);
                fos.write(bytes);
            }
            fos.flush();
        }
    }

    @Override
    protected void handleOnDestroy() {
        activePlaybackToken.incrementAndGet();
        cancelDownloadRequested.set(true);
        stopAudioTrackImmediate();
        synchronized (ortLock) {
            if (textSession != null) {
                try { textSession.close(); } catch (Exception ignored) {}
                textSession = null;
            }
            if (soundSession != null) {
                try { soundSession.close(); } catch (Exception ignored) {}
                soundSession = null;
            }
            if (decoderSession != null) {
                try { decoderSession.close(); } catch (Exception ignored) {}
                decoderSession = null;
            }
        }
        downloadExecutor.shutdownNow();
        synthesisExecutor.shutdownNow();
        super.handleOnDestroy();
    }
}
