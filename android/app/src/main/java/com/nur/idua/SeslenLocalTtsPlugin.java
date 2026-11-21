package com.nur.idua;

import android.app.ActivityManager;
import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Debug;
import android.util.Log;

import com.chaquo.python.PyObject;
import com.chaquo.python.Python;
import com.chaquo.python.android.AndroidPlatform;
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
import java.security.MessageDigest;
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
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

import ai.onnxruntime.NodeInfo;
import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OnnxValue;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;
import ai.onnxruntime.TensorInfo;

/**
 * On-device Seslen-TTS ("hasan" elderly Turkish male voice) plugin for Hacı Ahmet Efendi ONLY.
 *
 * Strictly isolated from NurIDuaTtsPlugin (Antalia-2 Mini for Hacı Mehmet Efendi).
 * Imports ZERO android.speech.tts.* classes so Android TTS / Antalia-2 Mini can never be called here.
 * Target hardware: Redmi Note 10T 5G (6 GB RAM, arm64-v8a).
 */
@CapacitorPlugin(name = "SeslenLocalTts")
public class SeslenLocalTtsPlugin extends Plugin {

    private static final String TAG = "SeslenLocalTts";
    private static final String MODEL_DIR_NAME = "seslen_hasan";
    private static final String LAST_TEST_WAV_NAME = "last_test_hasan.wav";
    private static final String OFFICIAL_SAMPLE_WAV_NAME = "official_hasan_sample.wav";
    private static final String OFFICIAL_SAMPLE_URL =
        "https://huggingface.co/seslen-tr/seslen-tts/resolve/main/ornekler/hasan.wav";
    private static final long OFFICIAL_SAMPLE_BYTES = 244644L;
    private static final String OFFICIAL_SAMPLE_SHA256 =
        "be267fea9c5dc18269f2300b8f7064d104c7bbe9703705fb25991bc0bc620d4d";

    private static final int SAMPLE_RATE = 24000;
    private static final int BAS_DOLGU = 4;
    private static final int BIRIM_MS = 25;
    private static final int ORNEK_BIRIM = 600;
    private static final int DURAK_KALAN = 2;
    private static final int VIRGUL_MS = 125;
    private static final int NOKTALI_MS = 200;
    private static final int IKI_NOKTA_MS = 200;
    private static final int GECIS = 120;
    private static final int MAX_ALIGNMENT_FRAMES = 2400;
    private static final int STATIC_MAX_BYTES = SAMPLE_RATE * 2 * 25; // up to 25s static AudioTrack
    private static final long MIN_WARMUP_AVAIL_RAM_BYTES = 850L * 1024L * 1024L; // safe headroom on 6 GB RAM device

    // Verified reference values of stiller.npz -> hasan/notr.npy
    private static final float[] EXPECTED_HASAN_REF_HEAD = new float[] {
        -0.11776f, 0.33438f, -0.28443f, 0.13914f
    };
    private static final float[] EXPECTED_HASAN_STYLE_HEAD = new float[] {
        -0.24243f, -0.02583f, -0.36668f, 0.19413f
    };

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
            "semboller.json",
            "https://huggingface.co/seslen-tr/seslen-tts/resolve/main/semboller.json",
            1787L,
            "97dd4e1809503a998803d05ce54fa1fbec94a6d16b41e2f328213778902c2544"
        ),
        new ModelFileSpec(
            "sesler.json",
            "https://huggingface.co/seslen-tr/seslen-tts/resolve/main/sesler.json",
            4098L,
            "284c9ee754dd22e969b0d47261fd97eda7da02471f6d8bb441205c8638ac77fd"
        ),
        new ModelFileSpec(
            "stiller.npz",
            "https://huggingface.co/seslen-tr/seslen-tts/resolve/main/stiller.npz",
            184092L,
            "67ec8b23ffa928ae00ad4f60356f5f1657411da7424b07b485b7d92f7c78ea45"
        ),
        new ModelFileSpec(
            "metin.onnx",
            "https://huggingface.co/seslen-tr/seslen-tts/resolve/main/metin.onnx",
            78259392L,
            "f89d8a62c4274788105badcdbecf170a2a91a308f4cf3774beff550b85c2548c"
        ),
        new ModelFileSpec(
            "ses.onnx",
            "https://huggingface.co/seslen-tr/seslen-tts/resolve/main/ses.onnx",
            247289667L,
            "35e02cb65cf5b3007d84c0d9e21f8f1d424430521a3f8328c2e8037a5c111eea"
        )
    };

    private static final long TOTAL_MODEL_BYTES = 325739036L;

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
    private OrtSession metinSession = null;
    private OrtSession sesSession = null;
    private float[] hasanStyleVector = null; // 256 floats from stiller.npz -> hasan/notr.npy
    private String styleHeaderText = "";
    private OnnxTensor cachedStil256Tensor = null;
    private OnnxTensor cachedRef128Tensor = null;
    private OnnxTensor cachedS128Tensor = null;
    private OnnxTensor cachedPerdeTensor = null;
    private OnnxTensor cachedTonlamaTensor = null;

    private AudioTrack activeAudioTrack = null;
    private final Object audioLock = new Object();

    private final List<String> recentLogs = new ArrayList<>();
    private final Object logLock = new Object();

    @Override
    public void load() {
        super.load();
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
                        addLog("Arka plan ön yükleme ertelendi (" + reason + "): RAM eşiği altında (boş="
                            + Math.round(mi.availMem / (1024.0 * 1024.0)) + " MB).");
                        return;
                    }
                }
                long t0 = System.currentTimeMillis();
                ensurePythonStarted();
                File sembollerFile = new File(dir, "semboller.json");
                Python.getInstance().getModule("seslen_g2p").callAttr("warm_up", sembollerFile.getAbsolutePath());
                ensureSessionsLoaded();
                addLog("Hasan motoru arka planda ön yüklendi (" + reason + "): " + (System.currentTimeMillis() - t0) + " ms.");
            } catch (Exception e) {
                addLog("Arka plan ön yükleme atlandı (" + reason + "): " + e.getMessage());
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
        notifyListeners("seslenLog", new JSObject().put("line", line));
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

    private void ensurePythonStarted() {
        if (!Python.isStarted()) {
            Python.start(new AndroidPlatform(getContext().getApplicationContext()));
            addLog("Chaquopy Python ortamı başlatıldı.");
        }
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
        boolean filesPresent = allFilesPresentWithExpectedSize(dir);
        long presentBytes = sumPresentBytes(dir);
        int percent = (int) Math.min(100, Math.round((presentBytes * 100.0) / TOTAL_MODEL_BYTES));

        File lastTestWav = new File(dir, LAST_TEST_WAV_NAME);
        File officialSample = new File(dir, OFFICIAL_SAMPLE_WAV_NAME);

        JSArray filesArr = new JSArray();
        for (ModelFileSpec spec : MODEL_FILES) {
            File f = new File(dir, spec.fileName);
            JSObject fo = new JSObject();
            fo.put("fileName", spec.fileName);
            fo.put("exists", f.exists());
            fo.put("actualBytes", f.exists() ? f.length() : 0L);
            fo.put("expectedBytes", spec.expectedBytes);
            fo.put("sizeMatched", f.exists() && f.length() == spec.expectedBytes);
            filesArr.put(fo);
        }

        JSObject res = new JSObject();
        res.put("modelInstalled", filesPresent);
        res.put("isDownloading", isDownloading.get());
        res.put("wifiConnected", isWifiConnected());
        res.put("downloadedBytes", presentBytes);
        res.put("totalBytes", TOTAL_MODEL_BYTES);
        res.put("percent", filesPresent ? 100 : percent);
        res.put("storagePath", dir.getAbsolutePath());
        res.put("sessionsLoaded", metinSession != null && sesSession != null);
        res.put("hasLastTestWav", lastTestWav.exists() && lastTestWav.length() > 44);
        res.put("hasOfficialSampleWav", officialSample.exists() && officialSample.length() == OFFICIAL_SAMPLE_BYTES);
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
            boolean allValid = true;
            String firstError = null;

            for (ModelFileSpec spec : MODEL_FILES) {
                File f = new File(dir, spec.fileName);
                JSObject item = new JSObject();
                item.put("fileName", spec.fileName);
                item.put("expectedBytes", spec.expectedBytes);
                item.put("expectedSha256", spec.expectedSha256);

                if (!f.exists() || f.length() != spec.expectedBytes) {
                    allValid = false;
                    item.put("valid", false);
                    item.put("actualBytes", f.exists() ? f.length() : 0L);
                    item.put("actualSha256", null);
                    if (firstError == null) {
                        firstError = spec.fileName + " eksik veya boyutu uyuşmuyor.";
                    }
                    results.put(item);
                    continue;
                }

                try {
                    String actualHash = computeSha256Hex(f);
                    boolean hashOk = spec.expectedSha256.equalsIgnoreCase(actualHash);
                    item.put("actualBytes", f.length());
                    item.put("actualSha256", actualHash);
                    item.put("valid", hashOk);
                    if (!hashOk) {
                        allValid = false;
                        if (firstError == null) {
                            firstError = spec.fileName + " SHA-256 doğrulaması başarısız.";
                        }
                    }
                } catch (Exception e) {
                    allValid = false;
                    item.put("valid", false);
                    item.put("error", e.getMessage());
                    if (firstError == null) {
                        firstError = spec.fileName + " okunamadı: " + e.getMessage();
                    }
                }
                results.put(item);
            }

            addLog("Model SHA-256 bütünlük doğrulaması: " + (allValid ? "BAŞARILI" : ("HATALI - " + firstError)));
            JSObject res = new JSObject();
            res.put("ok", allValid);
            res.put("files", results);
            res.put("logs", getRecentLogsArray());
            if (!allValid && firstError != null) {
                res.put("error", firstError);
            }
            call.resolve(res);
        });
    }

    @PluginMethod
    public void downloadModel(PluginCall call) {
        if (!isWifiConnected()) {
            JSObject res = new JSObject();
            res.put("ok", false);
            res.put("wifiRequired", true);
            res.put("error", "Seslen-TTS Hasan modeli (~311 MB) ilk kullanımda yalnızca Wi-Fi üzerinden indirilir. Lütfen Wi-Fi bağlantısı kurup tekrar deneyin.");
            call.resolve(res);
            return;
        }

        if (isDownloading.get()) {
            JSObject res = new JSObject();
            res.put("ok", false);
            res.put("alreadyDownloading", true);
            res.put("error", "Model indirme işlemi zaten devam ediyor.");
            call.resolve(res);
            return;
        }

        isDownloading.set(true);
        cancelDownloadRequested.set(false);

        downloadExecutor.execute(() -> {
            File dir = getModelDir();
            long completedBaseBytes = 0L;

            try {
                for (ModelFileSpec spec : MODEL_FILES) {
                    File target = new File(dir, spec.fileName);
                    if (target.exists() && target.length() == spec.expectedBytes) {
                        emitDownloadProgress("verifying", spec.fileName, completedBaseBytes + spec.expectedBytes, TOTAL_MODEL_BYTES);
                        String existingSha = computeSha256Hex(target);
                        if (spec.expectedSha256.equalsIgnoreCase(existingSha)) {
                            completedBaseBytes += spec.expectedBytes;
                            emitDownloadProgress("downloading", spec.fileName, completedBaseBytes, TOTAL_MODEL_BYTES);
                            continue;
                        }
                        //noinspection ResultOfMethodCallIgnored
                        target.delete();
                    }

                    if (cancelDownloadRequested.get()) {
                        throw new InterruptedException("İndirme kullanıcı tarafından iptal edildi.");
                    }

                    downloadSingleFileVerified(spec.downloadUrl, target, spec.expectedBytes, spec.expectedSha256, spec.fileName, completedBaseBytes, TOTAL_MODEL_BYTES);
                    completedBaseBytes += spec.expectedBytes;
                    emitDownloadProgress("downloading", spec.fileName, completedBaseBytes, TOTAL_MODEL_BYTES);
                }

                addLog("Seslen-TTS Hasan tüm model dosyaları Wi-Fi ile indirildi ve SHA-256 doğrulandı.");
                emitDownloadProgress("ready", "Tamamlandı", TOTAL_MODEL_BYTES, TOTAL_MODEL_BYTES);
                scheduleBackgroundWarmUp("post_download");
                JSObject okRes = new JSObject();
                okRes.put("ok", true);
                okRes.put("percent", 100);
                okRes.put("downloadedBytes", TOTAL_MODEL_BYTES);
                okRes.put("totalBytes", TOTAL_MODEL_BYTES);
                call.resolve(okRes);
            } catch (Exception e) {
                String msg = e.getMessage() != null ? e.getMessage() : "Model indirme hatası.";
                addLog("İndirme hatası: " + msg);
                JSObject errEvent = new JSObject();
                errEvent.put("message", msg);
                notifyListeners("seslenDownloadError", errEvent);

                JSObject errRes = new JSObject();
                errRes.put("ok", false);
                errRes.put("error", msg);
                call.resolve(errRes);
            } finally {
                isDownloading.set(false);
            }
        });
    }

    private void downloadSingleFileVerified(
        String urlStr,
        File target,
        long expectedBytes,
        String expectedSha256,
        String displayName,
        long completedBaseBytes,
        long totalProgressBytes
    ) throws Exception {
        File partFile = new File(target.getParentFile(), target.getName() + ".part");
        if (partFile.exists()) {
            //noinspection ResultOfMethodCallIgnored
            partFile.delete();
        }

        HttpURLConnection conn = null;
        MessageDigest sha256 = MessageDigest.getInstance("SHA-256");
        long fileDownloaded = 0L;
        long lastEmitMs = 0L;

        try {
            URL url = new URL(urlStr);
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(20000);
            conn.setReadTimeout(45000);
            conn.setInstanceFollowRedirects(true);
            conn.connect();

            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) {
                throw new RuntimeException(displayName + " indirilemedi (HTTP " + code + ").");
            }

            byte[] buf = new byte[65536];
            try (InputStream in = new BufferedInputStream(conn.getInputStream(), 65536);
                 FileOutputStream out = new FileOutputStream(partFile)) {
                int n;
                while ((n = in.read(buf)) != -1) {
                    if (cancelDownloadRequested.get()) {
                        throw new InterruptedException("İndirme kullanıcı tarafından iptal edildi.");
                    }
                    if (!isWifiConnected()) {
                        throw new RuntimeException("Wi-Fi bağlantısı kesildi. Mobil veri tüketmemek için indirme durduruldu.");
                    }
                    out.write(buf, 0, n);
                    sha256.update(buf, 0, n);
                    fileDownloaded += n;

                    long now = System.currentTimeMillis();
                    if (totalProgressBytes > 0 && now - lastEmitMs >= 180) {
                        lastEmitMs = now;
                        emitDownloadProgress("downloading", displayName, completedBaseBytes + fileDownloaded, totalProgressBytes);
                    }
                }
                out.flush();
            }
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }

        if (totalProgressBytes > 0) {
            emitDownloadProgress("verifying", displayName, completedBaseBytes + fileDownloaded, totalProgressBytes);
        }

        if (fileDownloaded != expectedBytes) {
            //noinspection ResultOfMethodCallIgnored
            partFile.delete();
            throw new RuntimeException(displayName + " boyut doğrulaması başarısız (beklenen: " + expectedBytes + ", gelen: " + fileDownloaded + ").");
        }

        byte[] digestBytes = sha256.digest();
        StringBuilder hex = new StringBuilder(digestBytes.length * 2);
        for (byte b : digestBytes) {
            hex.append(String.format(Locale.ROOT, "%02x", b & 0xff));
        }
        if (!expectedSha256.equalsIgnoreCase(hex.toString())) {
            //noinspection ResultOfMethodCallIgnored
            partFile.delete();
            throw new RuntimeException(displayName + " SHA-256 bütünlük doğrulaması başarısız oldu.");
        }

        if (target.exists()) {
            //noinspection ResultOfMethodCallIgnored
            target.delete();
        }
        if (!partFile.renameTo(target)) {
            //noinspection ResultOfMethodCallIgnored
            partFile.delete();
            throw new RuntimeException(displayName + " kalıcı dahili hafızaya taşınamadı.");
        }
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        cancelDownloadRequested.set(true);
        JSObject res = new JSObject();
        res.put("ok", true);
        call.resolve(res);
    }

    private void emitDownloadProgress(String phase, String currentFile, long downloadedBytes, long totalBytes) {
        int percent = (int) Math.min(100, Math.max(0, Math.round((downloadedBytes * 100.0) / totalBytes)));
        JSObject ev = new JSObject();
        ev.put("phase", phase);
        ev.put("currentFile", currentFile);
        ev.put("downloadedBytes", downloadedBytes);
        ev.put("totalBytes", totalBytes);
        ev.put("percent", percent);
        notifyListeners("seslenDownloadProgress", ev);
    }

    private static FloatBuffer allocateDirectFloatBuffer(float[] data, int offset, int length) {
        ByteBuffer bb = ByteBuffer.allocateDirect(length * 4).order(ByteOrder.nativeOrder());
        FloatBuffer fb = bb.asFloatBuffer();
        fb.put(data, offset, length);
        fb.rewind();
        return fb;
    }

    private void ensureSessionsLoaded() throws Exception {
        File dir = getModelDir();
        if (!allFilesPresentWithExpectedSize(dir)) {
            throw new IllegalStateException("Seslen-TTS Hasan model dosyaları henüz tam olarak indirilmemiş.");
        }

        synchronized (ortLock) {
            if (ortEnv == null) {
                ortEnv = OrtEnvironment.getEnvironment();
            }
            if (hasanStyleVector == null) {
                StyleLoadResult loaded = loadHasanNotrStyle(new File(dir, "stiller.npz"));
                hasanStyleVector = loaded.vector;
                styleHeaderText = loaded.headerText;
                addLog("Stil vektörü doğrulandı: key=hasan/notr.npy, dim=" + hasanStyleVector.length
                    + ", ref[0..3]=" + formatHead(hasanStyleVector, 0, 4)
                    + ", s[128..131]=" + formatHead(hasanStyleVector, 128, 4)
                    + ", L2=" + String.format(Locale.ROOT, "%.4f", computeL2(hasanStyleVector)));
            }
            if (cachedStil256Tensor == null) {
                cachedStil256Tensor = OnnxTensor.createTensor(
                    ortEnv,
                    allocateDirectFloatBuffer(hasanStyleVector, 0, 256),
                    new long[] { 1L, 256L }
                );
            }
            if (cachedRef128Tensor == null) {
                cachedRef128Tensor = OnnxTensor.createTensor(
                    ortEnv,
                    allocateDirectFloatBuffer(hasanStyleVector, 0, 128),
                    new long[] { 1L, 128L }
                );
            }
            if (cachedS128Tensor == null) {
                cachedS128Tensor = OnnxTensor.createTensor(
                    ortEnv,
                    allocateDirectFloatBuffer(hasanStyleVector, 128, 128),
                    new long[] { 1L, 128L }
                );
            }
            if (cachedPerdeTensor == null) {
                cachedPerdeTensor = OnnxTensor.createTensor(ortEnv, new float[] { 1.0f });
            }
            if (cachedTonlamaTensor == null) {
                cachedTonlamaTensor = OnnxTensor.createTensor(ortEnv, new float[] { 1.0f });
            }
            if (metinSession == null || sesSession == null) {
                OrtSession.SessionOptions opts = new OrtSession.SessionOptions();
                opts.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT);
                opts.setIntraOpNumThreads(4);
                opts.setMemoryPatternOptimization(true);
                if (metinSession == null) {
                    metinSession = ortEnv.createSession(new File(dir, "metin.onnx").getAbsolutePath(), opts);
                    addLog("ONNX metin.onnx yüklendi (78.2 MB).");
                }
                if (sesSession == null) {
                    sesSession = ortEnv.createSession(new File(dir, "ses.onnx").getAbsolutePath(), opts);
                    addLog("ONNX ses.onnx yüklendi (247.3 MB).");
                }
                opts.close();
            }
        }
    }

    private static final class StyleLoadResult {
        final float[] vector;
        final String headerText;

        StyleLoadResult(float[] vector, String headerText) {
            this.vector = vector;
            this.headerText = headerText;
        }
    }

    private static StyleLoadResult loadHasanNotrStyle(File npzFile) throws Exception {
        try (ZipInputStream zis = new ZipInputStream(new BufferedInputStream(new FileInputStream(npzFile)))) {
            ZipEntry entry;
            while ((entry = zis.getNextEntry()) != null) {
                if ("hasan/notr.npy".equals(entry.getName())) {
                    ByteArrayOutputStream baos = new ByteArrayOutputStream(2048);
                    byte[] buf = new byte[1024];
                    int read;
                    while ((read = zis.read(buf)) != -1) {
                        baos.write(buf, 0, read);
                    }
                    byte[] raw = baos.toByteArray();
                    if (raw.length < 10 || raw[0] != (byte) 0x93 || raw[1] != 'N') {
                        throw new RuntimeException("stiller.npz içindeki hasan/notr.npy NPY başlığı geçersiz.");
                    }
                    int major = raw[6] & 0xFF;
                    int headerLen;
                    int payloadOffset;
                    if (major == 1) {
                        headerLen = (raw[8] & 0xFF) | ((raw[9] & 0xFF) << 8);
                        payloadOffset = 10 + headerLen;
                    } else {
                        headerLen = ByteBuffer.wrap(raw, 8, 4).order(ByteOrder.LITTLE_ENDIAN).getInt();
                        payloadOffset = 12 + headerLen;
                    }
                    String hdrText = new String(raw, major == 1 ? 10 : 12, headerLen, "US-ASCII").trim();
                    if (!hdrText.contains("'<f4'") || !hdrText.contains("(256,)") || hdrText.contains("True")) {
                        throw new RuntimeException("hasan/notr.npy biçimi beklenenden farklı: " + hdrText);
                    }
                    if (raw.length - payloadOffset < 256 * 4) {
                        throw new RuntimeException("hasan/notr.npy vektör boyutu beklenenden kısa.");
                    }
                    float[] vec = new float[256];
                    FloatBuffer fb = ByteBuffer.wrap(raw, payloadOffset, 256 * 4)
                        .order(ByteOrder.LITTLE_ENDIAN)
                        .asFloatBuffer();
                    fb.get(vec);

                    // Verify exact Hasan reference floats (prevents silent byte-order or wrong-speaker corruption)
                    for (int i = 0; i < 4; i++) {
                        if (Math.abs(vec[i] - EXPECTED_HASAN_REF_HEAD[i]) > 1e-3f) {
                            throw new RuntimeException("hasan/notr.npy ref[" + i + "] beklenen değerle uyuşmuyor: " + vec[i]);
                        }
                        if (Math.abs(vec[128 + i] - EXPECTED_HASAN_STYLE_HEAD[i]) > 1e-3f) {
                            throw new RuntimeException("hasan/notr.npy s[" + (128 + i) + "] beklenen değerle uyuşmuyor: " + vec[128 + i]);
                        }
                    }

                    return new StyleLoadResult(vec, hdrText);
                }
            }
        }
        throw new RuntimeException("stiller.npz içinde hasan/notr.npy vektörü bulunamadı.");
    }

    private static String formatHead(float[] v, int start, int count) {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < count && start + i < v.length; i++) {
            if (i > 0) sb.append(", ");
            sb.append(String.format(Locale.ROOT, "%.5f", v[start + i]));
        }
        sb.append("]");
        return sb.toString();
    }

    private static double computeL2(float[] v) {
        double sum = 0.0;
        for (float f : v) sum += f * f;
        return Math.sqrt(sum);
    }

    private JSObject buildStyleVerificationObj() {
        JSObject sv = new JSObject();
        if (hasanStyleVector != null) {
            sv.put("speakerKey", "hasan/notr");
            sv.put("dim", hasanStyleVector.length);
            sv.put("npyHeader", styleHeaderText);
            sv.put("refHead", formatHead(hasanStyleVector, 0, 4));
            sv.put("styleHead", formatHead(hasanStyleVector, 128, 4));
            sv.put("l2Norm", Math.round(computeL2(hasanStyleVector) * 10000.0) / 10000.0);
            sv.put("matchesExpectedHasan", true);
        }
        return sv;
    }

    private JSObject serializeNodeMap(Map<String, NodeInfo> map) {
        JSObject out = new JSObject();
        for (Map.Entry<String, NodeInfo> entry : map.entrySet()) {
            JSObject infoObj = new JSObject();
            if (entry.getValue().getInfo() instanceof TensorInfo) {
                TensorInfo ti = (TensorInfo) entry.getValue().getInfo();
                infoObj.put("type", String.valueOf(ti.type));
                JSArray shapeArr = new JSArray();
                for (long d : ti.getShape()) {
                    shapeArr.put(d);
                }
                infoObj.put("shape", shapeArr);
            }
            out.put(entry.getKey(), infoObj);
        }
        return out;
    }

    @PluginMethod
    public void verifyInferenceContract(PluginCall call) {
        String sampleText = call.getString("text", "Esselâmü aleyküm. Allah dualarımızı kabul eylesin.");
        synthesisExecutor.execute(() -> {
            try {
                ensurePythonStarted();
                ensureSessionsLoaded();

                File sembollerFile = new File(getModelDir(), "semboller.json");
                Python py = Python.getInstance();
                PyObject g2pMod = py.getModule("seslen_g2p");
                String preparedJson = g2pMod.callAttr("prepare_chunks", sampleText, sembollerFile.getAbsolutePath()).toString();
                JSONObject prep = new JSONObject(preparedJson);
                JSONArray chunks = prep.getJSONArray("chunks");
                if (chunks.length() == 0) {
                    throw new RuntimeException("Python G2P ön işleme boş parça listesi döndürdü.");
                }
                JSONObject first = chunks.getJSONObject(0);
                int tokenLen = first.getJSONArray("tokens").length();
                int egriLen = first.getJSONArray("egri").length();
                if (tokenLen != egriLen) {
                    throw new RuntimeException("Token uzunluğu (" + tokenLen + ") ile egri uzunluğu (" + egriLen + ") uyuşmuyor.");
                }

                addLog("Kontrat doğrulandı: L=" + tokenLen + ", parça=" + chunks.length() + ", okunuş=" + first.getString("okunus"));

                JSObject res = new JSObject();
                res.put("ok", true);
                res.put("styleDim", hasanStyleVector != null ? hasanStyleVector.length : 0);
                res.put("styleVerification", buildStyleVerificationObj());
                res.put("pythonOkunus", first.getString("okunus"));
                res.put("tokenLengthL", tokenLen);
                res.put("chunkCount", chunks.length());
                res.put("metinInputs", serializeNodeMap(metinSession.getInputInfo()));
                res.put("metinOutputs", serializeNodeMap(metinSession.getOutputInfo()));
                res.put("sesInputs", serializeNodeMap(sesSession.getInputInfo()));
                res.put("sesOutputs", serializeNodeMap(sesSession.getOutputInfo()));
                res.put("memory", collectMemoryStats());
                res.put("logs", getRecentLogsArray());
                call.resolve(res);
            } catch (Exception e) {
                addLog("Kontrat doğrulama hatası: " + e.getMessage());
                JSObject err = new JSObject();
                err.put("ok", false);
                err.put("error", e.getMessage() != null ? e.getMessage() : "ONNX kontrat doğrulaması başarısız.");
                err.put("memory", collectMemoryStats());
                err.put("logs", getRecentLogsArray());
                call.resolve(err);
            }
        });
    }

    private static final class PcmStats {
        final int sampleCount;
        final long durationMs;
        final float min;
        final float max;
        final float peak;
        final float rms;
        final float dcOffset;
        final int nanOrInfCount;

        PcmStats(int sampleCount, long durationMs, float min, float max, float peak, float rms, float dcOffset, int nanOrInfCount) {
            this.sampleCount = sampleCount;
            this.durationMs = durationMs;
            this.min = min;
            this.max = max;
            this.peak = peak;
            this.rms = rms;
            this.dcOffset = dcOffset;
            this.nanOrInfCount = nanOrInfCount;
        }

        JSObject toJson() {
            JSObject o = new JSObject();
            o.put("sampleRate", SAMPLE_RATE);
            o.put("channels", 1);
            o.put("encoding", "PCM_16BIT");
            o.put("sampleCount", sampleCount);
            o.put("durationMs", durationMs);
            o.put("min", Math.round(min * 10000.0) / 10000.0);
            o.put("max", Math.round(max * 10000.0) / 10000.0);
            o.put("peak", Math.round(peak * 10000.0) / 10000.0);
            o.put("rms", Math.round(rms * 10000.0) / 10000.0);
            o.put("dcOffset", Math.round(dcOffset * 100000.0) / 100000.0);
            o.put("nanOrInfCount", nanOrInfCount);
            return o;
        }
    }

    private static PcmStats analyzeFloatPcm(float[] samples) {
        if (samples.length == 0) {
            return new PcmStats(0, 0L, 0f, 0f, 0f, 0f, 0f, 0);
        }
        float min = Float.MAX_VALUE;
        float max = -Float.MAX_VALUE;
        float peak = 0f;
        double sum = 0.0;
        double sumSq = 0.0;
        int bad = 0;

        for (float v : samples) {
            if (Float.isNaN(v) || Float.isInfinite(v)) {
                bad++;
                continue;
            }
            if (v < min) min = v;
            if (v > max) max = v;
            float av = Math.abs(v);
            if (av > peak) peak = av;
            sum += v;
            sumSq += (double) v * v;
        }
        int valid = Math.max(1, samples.length - bad);
        float mean = (float) (sum / valid);
        float rms = (float) Math.sqrt(sumSq / valid);
        long durMs = (samples.length * 1000L) / SAMPLE_RATE;
        return new PcmStats(samples.length, durMs, min == Float.MAX_VALUE ? 0f : min, max == -Float.MAX_VALUE ? 0f : max, peak, rms, mean, bad);
    }

    private static float[] concatChunksWithGaps(List<float[]> waves, List<Integer> silenceMsAfter) {
        int totalLen = 0;
        for (int i = 0; i < waves.size(); i++) {
            totalLen += waves.get(i).length;
            if (i < waves.size() - 1) {
                totalLen += (SAMPLE_RATE * Math.max(0, silenceMsAfter.get(i))) / 1000;
            }
        }
        float[] merged = new float[totalLen];
        int pos = 0;
        for (int i = 0; i < waves.size(); i++) {
            float[] w = waves.get(i);
            System.arraycopy(w, 0, merged, pos, w.length);
            pos += w.length;
            if (i < waves.size() - 1) {
                pos += (SAMPLE_RATE * Math.max(0, silenceMsAfter.get(i))) / 1000;
            }
        }
        return merged;
    }

    /**
     * Produces clean peak-normalized 16-bit PCM matching official `wav_yaz` (0.90 peak, 24 kHz mono),
     * with DC removal, 10 ms fade-in, 25 ms fade-out, and 150 ms trailing silence pad so hardware never clicks.
     */
    private static short[] preparePlaybackPcm16(float[] rawMerged, PcmStats rawStats) {
        int padTail = (SAMPLE_RATE * 150) / 1000; // 150 ms silent tail
        float[] clean = new float[rawMerged.length + padTail];

        float dc = Math.abs(rawStats.dcOffset) > 0.001f ? rawStats.dcOffset : 0.0f;
        float peakAfterDc = 0.0f;
        for (int i = 0; i < rawMerged.length; i++) {
            float v = (Float.isNaN(rawMerged[i]) || Float.isInfinite(rawMerged[i])) ? 0.0f : (rawMerged[i] - dc);
            clean[i] = v;
            float av = Math.abs(v);
            if (av > peakAfterDc) peakAfterDc = av;
        }

        if (peakAfterDc < 1e-5f) {
            throw new RuntimeException("ses.onnx çıktısı neredeyse tamamen sessiz/sıfır (peak=" + peakAfterDc + ").");
        }

        float scale = 0.90f / peakAfterDc;
        int fadeInSamples = Math.min(rawMerged.length, (SAMPLE_RATE * 10) / 1000);
        int fadeOutSamples = Math.min(rawMerged.length, (SAMPLE_RATE * 25) / 1000);

        short[] pcm16 = new short[clean.length];
        for (int i = 0; i < clean.length; i++) {
            float sample = clean[i] * scale;
            if (i < fadeInSamples && fadeInSamples > 1) {
                sample *= (i / (float) (fadeInSamples - 1));
            }
            if (i >= rawMerged.length - fadeOutSamples && i < rawMerged.length && fadeOutSamples > 1) {
                int k = i - (rawMerged.length - fadeOutSamples);
                sample *= (1.0f - (k / (float) (fadeOutSamples - 1)));
            }
            sample = Math.max(-1.0f, Math.min(1.0f, sample));
            pcm16[i] = (short) Math.round(sample * 32767.0f);
        }
        return pcm16;
    }

    private static void writeWavFile(File wavFile, short[] pcm16, int sampleRate) throws Exception {
        int dataBytes = pcm16.length * 2;
        byte[] hdr = new byte[44];
        ByteBuffer hb = ByteBuffer.wrap(hdr).order(ByteOrder.LITTLE_ENDIAN);
        hb.put((byte) 'R').put((byte) 'I').put((byte) 'F').put((byte) 'F');
        hb.putInt(36 + dataBytes);
        hb.put((byte) 'W').put((byte) 'A').put((byte) 'V').put((byte) 'E');
        hb.put((byte) 'f').put((byte) 'm').put((byte) 't').put((byte) ' ');
        hb.putInt(16); // PCM chunk size
        hb.putShort((short) 1); // PCM format
        hb.putShort((short) 1); // mono
        hb.putInt(sampleRate);
        hb.putInt(sampleRate * 2); // byte rate
        hb.putShort((short) 2); // block align
        hb.putShort((short) 16); // bits per sample
        hb.put((byte) 'd').put((byte) 'a').put((byte) 't').put((byte) 'a');
        hb.putInt(dataBytes);

        byte[] pcmBytes = new byte[dataBytes];
        ByteBuffer pb = ByteBuffer.wrap(pcmBytes).order(ByteOrder.LITTLE_ENDIAN);
        for (short s : pcm16) {
            pb.putShort(s);
        }

        try (FileOutputStream fos = new FileOutputStream(wavFile)) {
            fos.write(hdr);
            fos.write(pcmBytes);
            fos.flush();
        }
    }

    private static short[] readWavPcm16(File wavFile) throws Exception {
        byte[] all = new byte[(int) wavFile.length()];
        try (FileInputStream fis = new FileInputStream(wavFile)) {
            int offset = 0;
            while (offset < all.length) {
                int r = fis.read(all, offset, all.length - offset);
                if (r <= 0) break;
                offset += r;
            }
        }
        if (all.length < 44) {
            throw new RuntimeException("WAV dosyası geçersiz/kısa: " + wavFile.getName());
        }
        ByteBuffer bb = ByteBuffer.wrap(all).order(ByteOrder.LITTLE_ENDIAN);
        int channels = bb.getShort(22) & 0xFFFF;
        int sampleRate = bb.getInt(24);
        int bits = bb.getShort(34) & 0xFFFF;
        if (channels != 1 || sampleRate != SAMPLE_RATE || bits != 16) {
            throw new RuntimeException("Beklenmeyen WAV biçimi: " + sampleRate + "Hz, ch=" + channels + ", bits=" + bits);
        }
        // Locate 'data' chunk robustly
        int pos = 12;
        int dataOffset = 44;
        int dataSize = all.length - 44;
        while (pos + 8 <= all.length) {
            String cid = new String(all, pos, 4, "US-ASCII");
            int csize = ByteBuffer.wrap(all, pos + 4, 4).order(ByteOrder.LITTLE_ENDIAN).getInt();
            if ("data".equals(cid)) {
                dataOffset = pos + 8;
                dataSize = Math.min(csize, all.length - dataOffset);
                break;
            }
            pos += 8 + csize + (csize & 1);
        }
        int count = dataSize / 2;
        short[] samples = new short[count];
        ByteBuffer.wrap(all, dataOffset, count * 2).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(samples);
        return samples;
    }

    private static PcmStats analyzeShortPcm(short[] samples) {
        if (samples.length == 0) {
            return new PcmStats(0, 0L, 0f, 0f, 0f, 0f, 0f, 0);
        }
        float min = 1f;
        float max = -1f;
        float peak = 0f;
        double sum = 0.0;
        double sumSq = 0.0;
        for (short s : samples) {
            float v = s / 32768.0f;
            if (v < min) min = v;
            if (v > max) max = v;
            float av = Math.abs(v);
            if (av > peak) peak = av;
            sum += v;
            sumSq += (double) v * v;
        }
        float mean = (float) (sum / samples.length);
        float rms = (float) Math.sqrt(sumSq / samples.length);
        long durMs = (samples.length * 1000L) / SAMPLE_RATE;
        return new PcmStats(samples.length, durMs, min, max, peak, rms, mean, 0);
    }

    /**
     * Stage 4 isolated test playback ONLY for Hacı Ahmet Efendi ("hasan" voice).
     * Resolves after completion and saves `last_test_hasan.wav` for diagnostic inspection.
     */
    @PluginMethod
    public void speakTest(PluginCall call) {
        String text = call.getString("text", "Esselâmü aleyküm. Allah dualarımızı kabul eylesin.");
        double rateVal = call.getDouble("rate", 0.94);
        double volumeVal = call.getDouble("volume", 0.95);
        final float rate = (float) Math.max(0.65, Math.min(1.30, rateVal));
        final float volume = (float) Math.max(0.0, Math.min(1.0, volumeVal));
        final String utteranceId = "test_" + System.currentTimeMillis();

        if (text == null || text.trim().isEmpty()) {
            JSObject err = new JSObject();
            err.put("ok", false);
            err.put("antaliaUsed", false);
            err.put("error", "Test cümlesi boş olamaz.");
            call.resolve(err);
            return;
        }

        if (!allFilesPresentWithExpectedSize(getModelDir())) {
            JSObject err = new JSObject();
            err.put("ok", false);
            err.put("modelMissing", true);
            err.put("antaliaUsed", false);
            err.put("error", "Seslen-TTS Hasan model dosyaları henüz indirilmemiş.");
            call.resolve(err);
            return;
        }

        final long token = activePlaybackToken.incrementAndGet();
        activeUtteranceId = utteranceId;
        isPlaybackPaused.set(false);
        stopAudioTrackImmediate();

        synthesisExecutor.execute(() -> executeSynthesisAndPlayback(call, false, utteranceId, text, rate, volume, token, true, "ONNX Hasan Test"));
    }

    /**
     * Stage 5 prayer queue playback ONLY for Hacı Ahmet Efendi (scholar_1, "hasan" voice).
     * Resolves immediately once queued on synthesisExecutor; lifecycle events (`seslenStart`,
     * `seslenMouth`, `seslenDone`, `seslenError`) carry `utteranceId` so cancelled/skipped items
     * never corrupt queue ordering. Never falls back to Antalia-2 Mini / Android TextToSpeech.
     */
    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "");
        String utteranceId = call.getString("utteranceId", "seslen_" + System.currentTimeMillis());
        double rateVal = call.getDouble("rate", 0.94);
        double volumeVal = call.getDouble("volume", 0.95);
        final float rate = (float) Math.max(0.65, Math.min(1.30, rateVal));
        final float volume = (float) Math.max(0.0, Math.min(1.0, volumeVal));

        if (text == null || text.trim().isEmpty()) {
            JSObject err = new JSObject();
            err.put("ok", false);
            err.put("utteranceId", utteranceId);
            err.put("antaliaUsed", false);
            err.put("error", "Seslendirilecek dua metni boş.");
            call.resolve(err);
            return;
        }

        if (!allFilesPresentWithExpectedSize(getModelDir())) {
            String msg = "Seslen-TTS Hasan model dosyaları cihazda kurulu değil. Hacı Ahmet Efendi için Antalia-2 Mini'ye geçiş yapılmadı; lütfen Ses Ayarları ekranından Hasan modelini Wi-Fi ile indirin.";
            addLog("Kuyruk konuşması reddedildi (" + utteranceId + "): " + msg);
            JSObject err = new JSObject();
            err.put("ok", false);
            err.put("modelMissing", true);
            err.put("utteranceId", utteranceId);
            err.put("antaliaUsed", false);
            err.put("error", msg);
            call.resolve(err);
            return;
        }

        final long token = activePlaybackToken.incrementAndGet();
        activeUtteranceId = utteranceId;
        isPlaybackPaused.set(false);
        stopAudioTrackImmediate();

        JSObject ack = new JSObject();
        ack.put("ok", true);
        ack.put("utteranceId", utteranceId);
        ack.put("engineUsed", "SESLEN_ONNX_HASAN_LOCAL");
        ack.put("antaliaUsed", false);
        call.resolve(ack);

        synthesisExecutor.execute(() -> executeSynthesisAndPlayback(null, true, utteranceId, text, rate, volume, token, false, "ONNX Hasan Kuyruk"));
    }

    private static final class StreamBlock {
        static final StreamBlock END = new StreamBlock(null, true);
        final short[] pcm16;
        final boolean isEnd;

        StreamBlock(short[] pcm16, boolean isEnd) {
            this.pcm16 = pcm16;
            this.isEnd = isEnd;
        }
    }

    private static final class RunningPcmAccumulator {
        int sampleCount = 0;
        float min = Float.MAX_VALUE;
        float max = -Float.MAX_VALUE;
        float peak = 0f;
        double sum = 0.0;
        double sumSq = 0.0;
        int bad = 0;

        void addFloats(float[] arr) {
            for (float v : arr) {
                sampleCount++;
                if (Float.isNaN(v) || Float.isInfinite(v)) {
                    bad++;
                    continue;
                }
                if (v < min) min = v;
                if (v > max) max = v;
                float av = Math.abs(v);
                if (av > peak) peak = av;
                sum += v;
                sumSq += (double) v * v;
            }
        }

        void addGapSamples(int gapSamples) {
            if (gapSamples <= 0) return;
            sampleCount += gapSamples;
            if (0f < min) min = 0f;
            if (0f > max) max = 0f;
        }

        void addShorts(short[] arr) {
            for (short s : arr) {
                sampleCount++;
                float v = s / 32768.0f;
                if (v < min) min = v;
                if (v > max) max = v;
                float av = Math.abs(v);
                if (av > peak) peak = av;
                sum += v;
                sumSq += (double) v * v;
            }
        }

        PcmStats toStats() {
            if (sampleCount == 0) {
                return new PcmStats(0, 0L, 0f, 0f, 0f, 0f, 0f, 0);
            }
            int valid = Math.max(1, sampleCount - bad);
            long durMs = (sampleCount * 1000L) / SAMPLE_RATE;
            return new PcmStats(
                sampleCount,
                durMs,
                min == Float.MAX_VALUE ? 0f : min,
                max == -Float.MAX_VALUE ? 0f : max,
                peak,
                (float) Math.sqrt(sumSq / valid),
                (float) (sum / valid),
                bad
            );
        }
    }

    private static short[] convertStreamingChunkToPcm16(
        float[] wave,
        boolean isFirst,
        boolean isLast,
        int silenceMsAfter,
        float dcOffset,
        float utteranceScale
    ) {
        int extraTailSamples = isLast
            ? (SAMPLE_RATE * 150) / 1000
            : (SAMPLE_RATE * Math.max(0, silenceMsAfter)) / 1000;
        short[] pcm16 = new short[wave.length + extraTailSamples];
        int fadeInSamples = isFirst ? Math.min(wave.length, (SAMPLE_RATE * 10) / 1000) : Math.min(wave.length, (SAMPLE_RATE * 4) / 1000);
        int fadeOutSamples = isLast ? Math.min(wave.length, (SAMPLE_RATE * 25) / 1000) : Math.min(wave.length, (SAMPLE_RATE * 8) / 1000);

        for (int i = 0; i < wave.length; i++) {
            float v = (Float.isNaN(wave[i]) || Float.isInfinite(wave[i])) ? 0.0f : ((wave[i] - dcOffset) * utteranceScale);
            if (i < fadeInSamples && fadeInSamples > 1) {
                v *= (i / (float) (fadeInSamples - 1));
            }
            if (i >= wave.length - fadeOutSamples && fadeOutSamples > 1) {
                int k = i - (wave.length - fadeOutSamples);
                v *= (1.0f - (k / (float) (fadeOutSamples - 1)));
            }
            // Transparent soft-knee limiter above 0.94 prevents rare inter-chunk peak clipping without altering normal speech
            float av = Math.abs(v);
            if (av > 0.94f) {
                float excess = av - 0.94f;
                float limited = 0.94f + 0.059f * (excess / (excess + 0.10f));
                v = v >= 0.0f ? limited : -limited;
            }
            v = Math.max(-1.0f, Math.min(1.0f, v));
            pcm16[i] = (short) Math.round(v * 32767.0f);
        }
        return pcm16;
    }

    private void executeSynthesisAndPlayback(
        PluginCall resolveCall,
        boolean queueMode,
        String utteranceId,
        String text,
        float rate,
        float volume,
        long token,
        boolean saveDebugWav,
        String logLabel
    ) {
        long startWallMs = System.currentTimeMillis();
        long modelLoadMs = 0L;
        long g2pMs = 0L;
        long synthElapsedMs = 0L;
        long timeToFirstAudioMs = 0L;
        Thread playerThread = null;
        BlockingQueue<StreamBlock> streamQueue = null;

        try {
            if (activePlaybackToken.get() != token) {
                return;
            }
            addLog(logLabel + " başlatıldı (utteranceId=" + utteranceId + ", rate=" + rate + ") -> ENGINE=SeslenLocalTts (ONNX Runtime). Android TextToSpeech / Antalia-2 Mini ÇAĞRILMADI.");

            long loadStartMs = System.currentTimeMillis();
            ensurePythonStarted();
            ensureSessionsLoaded();
            modelLoadMs = System.currentTimeMillis() - loadStartMs;

            File dir = getModelDir();
            File sembollerFile = new File(dir, "semboller.json");
            long g2pStartMs = System.currentTimeMillis();
            Python py = Python.getInstance();
            PyObject g2pMod = py.getModule("seslen_g2p");
            String preparedJson = g2pMod.callAttr("prepare_chunks", text, sembollerFile.getAbsolutePath()).toString();
            JSONObject prep = new JSONObject(preparedJson);
            JSONArray chunks = prep.getJSONArray("chunks");
            g2pMs = System.currentTimeMillis() - g2pStartMs;

            int chunkCount = chunks.length();
            if (chunkCount == 0) {
                throw new RuntimeException("Seslendirilecek Türkçe metin parçası oluşturulamadı.");
            }
            addLog("Python G2P hazır (" + g2pMs + " ms, modelLoad=" + modelLoadMs + " ms): " + chunkCount
                + " parça, ilk okunuş=\"" + chunks.getJSONObject(0).getString("okunus") + "\"");

            PcmStats rawStats;
            PcmStats playedStats;
            String wavPath = null;
            boolean streamingUsed = chunkCount > 1;

            if (!streamingUsed) {
                // Single-chunk fast path: synthesize once and play via zero-underrun AudioTrack.MODE_STATIC
                if (activePlaybackToken.get() != token) {
                    throw new InterruptedException("Konuşma başlatılmadan durduruldu.");
                }
                JSONObject chunk0 = chunks.getJSONObject(0);
                long sStart = System.currentTimeMillis();
                float[] chunkPcm = synthesizeSingleChunk(chunk0, rate, 0);
                synthElapsedMs += (System.currentTimeMillis() - sStart);

                rawStats = analyzeFloatPcm(chunkPcm);
                addLog("Ham ses.onnx çıktısı: samples=" + rawStats.sampleCount + ", dur=" + rawStats.durationMs
                    + "ms, peak=" + rawStats.peak + ", rms=" + rawStats.rms + ", NaN=" + rawStats.nanOrInfCount);

                if (rawStats.nanOrInfCount > 0) {
                    throw new RuntimeException("ONNX ses.onnx çıktısında NaN/Inf değer tespit edildi (" + rawStats.nanOrInfCount + ").");
                }

                short[] pcm16 = preparePlaybackPcm16(chunkPcm, rawStats);
                playedStats = analyzeShortPcm(pcm16);

                if (saveDebugWav) {
                    File wavFile = new File(dir, LAST_TEST_WAV_NAME);
                    writeWavFile(wavFile, pcm16, SAMPLE_RATE);
                    wavPath = wavFile.getAbsolutePath();
                    addLog("24 kHz 16-bit mono WAV yazıldı: " + wavFile.getName() + " (" + wavFile.length() + " bayt)");
                }

                if (activePlaybackToken.get() != token) {
                    throw new InterruptedException("Konuşma durduruldu.");
                }

                timeToFirstAudioMs = System.currentTimeMillis() - startWallMs;
                JSObject startPayload = new JSObject();
                startPayload.put("token", token);
                startPayload.put("utteranceId", utteranceId);
                startPayload.put("engineUsed", "SESLEN_ONNX_HASAN_LOCAL");
                startPayload.put("antaliaUsed", false);
                startPayload.put("timeToFirstAudioMs", timeToFirstAudioMs);
                notifyListeners("seslenStart", startPayload);

                playShortPcm16Clean(pcm16, volume, token, utteranceId, logLabel);
            } else {
                // Multi-chunk pipelined streaming path: synthesize Chunk 0, start AudioTrack immediately,
                // then synthesize Chunks 1..N-1 concurrently while Chunk 0..k play.
                streamQueue = new LinkedBlockingQueue<>();
                RunningPcmAccumulator rawAcc = new RunningPcmAccumulator();
                RunningPcmAccumulator playedAcc = new RunningPcmAccumulator();
                List<short[]> wavBlocks = saveDebugWav ? new ArrayList<>(chunkCount) : null;

                JSONObject chunk0 = chunks.getJSONObject(0);
                long s0Start = System.currentTimeMillis();
                float[] wave0 = synthesizeSingleChunk(chunk0, rate, 0);
                synthElapsedMs += (System.currentTimeMillis() - s0Start);

                PcmStats chunk0RawStats = analyzeFloatPcm(wave0);
                if (chunk0RawStats.nanOrInfCount > 0) {
                    throw new RuntimeException("ONNX ses.onnx çıktısında NaN/Inf değer tespit edildi (" + chunk0RawStats.nanOrInfCount + ").");
                }
                float dc0 = Math.abs(chunk0RawStats.dcOffset) > 0.001f ? chunk0RawStats.dcOffset : 0.0f;
                float peak0AfterDc = 0.0f;
                for (float v : wave0) {
                    float av = Math.abs((Float.isNaN(v) || Float.isInfinite(v)) ? 0.0f : (v - dc0));
                    if (av > peak0AfterDc) peak0AfterDc = av;
                }
                if (peak0AfterDc < 1e-5f) {
                    throw new RuntimeException("ses.onnx ilk parça çıktısı sessiz/sıfır (peak=" + peak0AfterDc + ").");
                }
                float utteranceScale = Math.min(2.2f, 0.90f / Math.max(peak0AfterDc, 0.35f));

                int silence0Ms = chunk0.optInt("silenceAfterMs", 450);
                rawAcc.addFloats(wave0);
                rawAcc.addGapSamples((SAMPLE_RATE * Math.max(0, silence0Ms)) / 1000);

                short[] pcm0 = convertStreamingChunkToPcm16(wave0, true, false, silence0Ms, dc0, utteranceScale);
                playedAcc.addShorts(pcm0);
                if (wavBlocks != null) wavBlocks.add(pcm0);
                streamQueue.put(new StreamBlock(pcm0, false));

                if (activePlaybackToken.get() != token) {
                    throw new InterruptedException("Konuşma durduruldu.");
                }

                final BlockingQueue<StreamBlock> qRef = streamQueue;
                final AtomicReference<Throwable> playErrRef = new AtomicReference<>(null);
                playerThread = new Thread(
                    () -> streamPlaybackLoop(qRef, volume, token, utteranceId, logLabel, playErrRef),
                    "SeslenStreamPlayer"
                );

                timeToFirstAudioMs = System.currentTimeMillis() - startWallMs;
                JSObject startPayload = new JSObject();
                startPayload.put("token", token);
                startPayload.put("utteranceId", utteranceId);
                startPayload.put("engineUsed", "SESLEN_ONNX_HASAN_LOCAL");
                startPayload.put("antaliaUsed", false);
                startPayload.put("timeToFirstAudioMs", timeToFirstAudioMs);
                notifyListeners("seslenStart", startPayload);

                addLog("Streaming boru hattı başlatıldı (parça=0/" + chunkCount + ", ilk ses=" + timeToFirstAudioMs + " ms).");
                playerThread.start();

                for (int c = 1; c < chunkCount; c++) {
                    if (activePlaybackToken.get() != token) {
                        throw new InterruptedException("Konuşma oynatma sırasında durduruldu.");
                    }
                    if (playErrRef.get() != null) {
                        throw new RuntimeException(playErrRef.get());
                    }
                    JSONObject chunk = chunks.getJSONObject(c);
                    long sStart = System.currentTimeMillis();
                    float[] wave = synthesizeSingleChunk(chunk, rate, c);
                    synthElapsedMs += (System.currentTimeMillis() - sStart);

                    PcmStats chunkRawStats = analyzeFloatPcm(wave);
                    if (chunkRawStats.nanOrInfCount > 0) {
                        throw new RuntimeException("ONNX ses.onnx parça #" + c + " çıktısında NaN/Inf tespit edildi.");
                    }
                    boolean isLast = (c == chunkCount - 1);
                    int silenceMs = chunk.optInt("silenceAfterMs", 450);
                    rawAcc.addFloats(wave);
                    if (!isLast) {
                        rawAcc.addGapSamples((SAMPLE_RATE * Math.max(0, silenceMs)) / 1000);
                    }

                    short[] pcmBlock = convertStreamingChunkToPcm16(wave, false, isLast, silenceMs, dc0, utteranceScale);
                    playedAcc.addShorts(pcmBlock);
                    if (wavBlocks != null) wavBlocks.add(pcmBlock);
                    streamQueue.put(new StreamBlock(pcmBlock, false));
                }

                streamQueue.put(StreamBlock.END);
                playerThread.join();

                if (playErrRef.get() != null) {
                    throw new RuntimeException(playErrRef.get());
                }

                rawStats = rawAcc.toStats();
                playedStats = playedAcc.toStats();

                if (saveDebugWav && wavBlocks != null && activePlaybackToken.get() == token) {
                    int totalShorts = 0;
                    for (short[] b : wavBlocks) totalShorts += b.length;
                    short[] mergedWav = new short[totalShorts];
                    int off = 0;
                    for (short[] b : wavBlocks) {
                        System.arraycopy(b, 0, mergedWav, off, b.length);
                        off += b.length;
                    }
                    File wavFile = new File(dir, LAST_TEST_WAV_NAME);
                    writeWavFile(wavFile, mergedWav, SAMPLE_RATE);
                    wavPath = wavFile.getAbsolutePath();
                    addLog("24 kHz 16-bit mono WAV yazıldı: " + wavFile.getName() + " (" + wavFile.length() + " bayt)");
                }
            }

            if (activePlaybackToken.get() == token) {
                long totalWallMs = System.currentTimeMillis() - startWallMs;
                double rtf = playedStats.durationMs > 0 ? (synthElapsedMs / (double) playedStats.durationMs) : 0.0;
                addLog("AudioTrack 24 kHz mono oynatma tamamlandı (utteranceId=" + utteranceId
                    + ", yük=" + modelLoadMs + "ms, g2p=" + g2pMs + "ms, ilkSes=" + timeToFirstAudioMs
                    + "ms, sentez=" + synthElapsedMs + "ms, ses=" + playedStats.durationMs
                    + "ms, toplam=" + totalWallMs + "ms, RTF=" + String.format(Locale.ROOT, "%.3f", rtf)
                    + "). Antalia-2 Mini'ye hiç başvurulmadı.");

                JSObject donePayload = new JSObject();
                donePayload.put("ok", true);
                donePayload.put("token", token);
                donePayload.put("utteranceId", utteranceId);
                donePayload.put("engineUsed", "SESLEN_ONNX_HASAN_LOCAL");
                donePayload.put("antaliaUsed", false);
                donePayload.put("modelLoadMs", modelLoadMs);
                donePayload.put("g2pMs", g2pMs);
                donePayload.put("timeToFirstAudioMs", timeToFirstAudioMs);
                donePayload.put("synthesisMs", synthElapsedMs);
                donePayload.put("audioDurationMs", playedStats.durationMs);
                donePayload.put("totalWallMs", totalWallMs);
                donePayload.put("chunkCount", chunkCount);
                donePayload.put("streamingUsed", streamingUsed);
                donePayload.put("rtf", Math.round(rtf * 1000.0) / 1000.0);
                donePayload.put("styleVerification", buildStyleVerificationObj());
                donePayload.put("rawPcmStats", rawStats.toJson());
                donePayload.put("playedPcmStats", playedStats.toJson());
                if (wavPath != null) donePayload.put("wavFile", wavPath);
                donePayload.put("memory", collectMemoryStats());
                donePayload.put("logs", getRecentLogsArray());
                notifyListeners("seslenDone", donePayload);

                if (resolveCall != null) {
                    resolveCall.resolve(donePayload);
                }
            } else if (resolveCall != null) {
                JSObject res = new JSObject();
                res.put("ok", false);
                res.put("cancelled", true);
                res.put("utteranceId", utteranceId);
                res.put("antaliaUsed", false);
                res.put("error", "Test oynatımı durduruldu.");
                res.put("logs", getRecentLogsArray());
                resolveCall.resolve(res);
            }
        } catch (InterruptedException ie) {
            if (streamQueue != null) {
                streamQueue.clear();
                streamQueue.offer(StreamBlock.END);
            }
            if (playerThread != null && playerThread.isAlive()) {
                playerThread.interrupt();
                try {
                    playerThread.join(1200);
                } catch (InterruptedException ignored) {
                }
            }
            stopAudioTrackImmediate();
            notifyListeners("seslenMouth", new JSObject().put("level", 0.0));
            if (resolveCall != null) {
                JSObject res = new JSObject();
                res.put("ok", false);
                res.put("cancelled", true);
                res.put("utteranceId", utteranceId);
                res.put("antaliaUsed", false);
                res.put("error", ie.getMessage() != null ? ie.getMessage() : "Oynatım durduruldu.");
                res.put("logs", getRecentLogsArray());
                resolveCall.resolve(res);
            }
        } catch (Exception e) {
            if (streamQueue != null) {
                streamQueue.clear();
                streamQueue.offer(StreamBlock.END);
            }
            if (playerThread != null && playerThread.isAlive()) {
                playerThread.interrupt();
                try {
                    playerThread.join(1200);
                } catch (InterruptedException ignored) {
                }
            }
            stopAudioTrackImmediate();
            notifyListeners("seslenMouth", new JSObject().put("level", 0.0));
            String msg = e.getMessage() != null ? e.getMessage() : "Seslen-TTS sentezi başarısız.";
            addLog("Sentez/oynatma hatası (utteranceId=" + utteranceId + "): " + msg);

            if (!queueMode || activePlaybackToken.get() == token) {
                JSObject errEv = new JSObject();
                errEv.put("token", token);
                errEv.put("utteranceId", utteranceId);
                errEv.put("antaliaUsed", false);
                errEv.put("message", msg);
                notifyListeners("seslenError", errEv);
            }

            if (resolveCall != null) {
                JSObject res = new JSObject();
                res.put("ok", false);
                res.put("utteranceId", utteranceId);
                res.put("antaliaUsed", false);
                res.put("error", msg);
                res.put("memory", collectMemoryStats());
                res.put("logs", getRecentLogsArray());
                resolveCall.resolve(res);
            }
        }
    }

    private void streamPlaybackLoop(
        BlockingQueue<StreamBlock> queue,
        float volume,
        long token,
        String utteranceId,
        String logLabel,
        AtomicReference<Throwable> errRef
    ) {
        AudioTrack track = null;
        try {
            AudioAttributes attrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build();
            AudioFormat fmt = new AudioFormat.Builder()
                .setSampleRate(SAMPLE_RATE)
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                .build();
            int minBuf = AudioTrack.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT);
            int bufBytes = Math.max(minBuf, SAMPLE_RATE * 2); // 1 second PCM16 ring buffer
            track = new AudioTrack(
                attrs,
                fmt,
                bufBytes,
                AudioTrack.MODE_STREAM,
                AudioManager.AUDIO_SESSION_ID_GENERATE
            );
            track.setVolume(volume);
            synchronized (audioLock) {
                activeAudioTrack = track;
            }
            addLog("AudioTrack STREAM (" + labelForStream(logLabel) + "): 24000Hz, mono, PCM_16BIT, bufBytes=" + bufBytes);
            track.play();

            final int sliceShorts = 2400; // 100 ms blocks -> crisp mouth animation without flooding bridge
            while (activePlaybackToken.get() == token) {
                StreamBlock block = queue.poll(50, TimeUnit.MILLISECONDS);
                if (block == null) {
                    continue;
                }
                if (block.isEnd) {
                    break;
                }
                short[] pcm = block.pcm16;
                int offset = 0;
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
                        Thread.sleep(45);
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

                    int count = Math.min(sliceShorts, pcm.length - offset);
                    double sumSq = 0.0;
                    for (int i = 0; i < count; i++) {
                        double v = pcm[offset + i] / 32768.0;
                        sumSq += v * v;
                    }
                    double rms = Math.sqrt(sumSq / Math.max(1, count));
                    emitMouthLevel(Math.max(0.0, Math.min(1.0, (rms - 0.015) * 4.8)), utteranceId);
                    int written = track.write(pcm, offset, count);
                    if (written < 0) {
                        break;
                    }
                    offset += count;
                }
            }
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
        } catch (Throwable t) {
            errRef.set(t);
        } finally {
            emitMouthLevel(0.0, utteranceId);
            if (activePlaybackToken.get() == token) {
                releaseTrackAfterCompletion();
            } else {
                stopAudioTrackImmediate();
            }
        }
    }

    private static String labelForStream(String label) {
        return label != null ? label : "SeslenStream";
    }

    private void emitMouthLevel(double level, String utteranceId) {
        JSObject ev = new JSObject().put("level", level);
        if (utteranceId != null) {
            ev.put("utteranceId", utteranceId);
        }
        notifyListeners("seslenMouth", ev);
    }

    /**
     * Replays the exact synthesized `last_test_hasan.wav` through AudioTrack without re-running ONNX
     * so playback hardware behavior can be verified independently of inference.
     */
    @PluginMethod
    public void replayLastTestWav(PluginCall call) {
        double volumeVal = call.getDouble("volume", 0.95);
        final float volume = (float) Math.max(0.0, Math.min(1.0, volumeVal));
        final long token = activePlaybackToken.incrementAndGet();
        stopAudioTrackImmediate();

        synthesisExecutor.execute(() -> {
            try {
                File wavFile = new File(getModelDir(), LAST_TEST_WAV_NAME);
                if (!wavFile.exists()) {
                    throw new RuntimeException("Henüz üretilmiş test WAV dosyası bulunamadı. Önce Hasan test cümlesini üretin.");
                }
                short[] pcm16 = readWavPcm16(wavFile);
                PcmStats stats = analyzeShortPcm(pcm16);
                addLog("Kaydedilmiş test WAV yeniden çalınıyor: " + LAST_TEST_WAV_NAME + " (" + stats.durationMs + "ms, rms=" + stats.rms + ")");
                notifyListeners("seslenStart", new JSObject().put("token", token));
                playShortPcm16Clean(pcm16, volume, token, null, "LastTestWAV");

                JSObject res = new JSObject();
                res.put("ok", activePlaybackToken.get() == token);
                res.put("playedPcmStats", stats.toJson());
                res.put("logs", getRecentLogsArray());
                call.resolve(res);
            } catch (Exception e) {
                JSObject res = new JSObject();
                res.put("ok", false);
                res.put("error", e.getMessage());
                res.put("logs", getRecentLogsArray());
                call.resolve(res);
            }
        });
    }

    /**
     * Downloads (if needed over Wi-Fi) and plays the official Hugging Face sample `ornekler/hasan.wav`
     * through the exact same 24 kHz AudioTrack path for direct A/B comparison with local synthesis.
     */
    @PluginMethod
    public void playOfficialHasanSample(PluginCall call) {
        double volumeVal = call.getDouble("volume", 0.95);
        final float volume = (float) Math.max(0.0, Math.min(1.0, volumeVal));
        final long token = activePlaybackToken.incrementAndGet();
        stopAudioTrackImmediate();

        synthesisExecutor.execute(() -> {
            try {
                File dir = getModelDir();
                File sampleFile = new File(dir, OFFICIAL_SAMPLE_WAV_NAME);
                if (!sampleFile.exists() || sampleFile.length() != OFFICIAL_SAMPLE_BYTES) {
                    if (!isWifiConnected()) {
                        throw new RuntimeException("Resmi ornekler/hasan.wav örneğini (239 KB) indirmek için Wi-Fi bağlantısı gereklidir.");
                    }
                    addLog("Resmi Hasan referans örneği indiriliyor (ornekler/hasan.wav)...");
                    downloadSingleFileVerified(OFFICIAL_SAMPLE_URL, sampleFile, OFFICIAL_SAMPLE_BYTES, OFFICIAL_SAMPLE_SHA256, "ornekler/hasan.wav", 0L, 0L);
                }

                short[] pcm16 = readWavPcm16(sampleFile);
                PcmStats stats = analyzeShortPcm(pcm16);
                addLog("Resmi Hasan örneği çalınıyor: 24kHz mono 16-bit, dur=" + stats.durationMs + "ms, peak=" + stats.peak + ", rms=" + stats.rms);

                notifyListeners("seslenStart", new JSObject().put("token", token));
                playShortPcm16Clean(pcm16, volume, token, null, "OfficialHasanSample");

                JSObject res = new JSObject();
                res.put("ok", activePlaybackToken.get() == token);
                res.put("officialSampleStats", stats.toJson());
                res.put("logs", getRecentLogsArray());
                call.resolve(res);
            } catch (Exception e) {
                addLog("Resmi örnek oynatma hatası: " + e.getMessage());
                JSObject res = new JSObject();
                res.put("ok", false);
                res.put("error", e.getMessage());
                res.put("logs", getRecentLogsArray());
                call.resolve(res);
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
        notifyListeners("seslenMouth", new JSObject().put("level", 0.0));
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
        if (activeUtteranceId != null) {
            res.put("utteranceId", activeUtteranceId);
        }
        call.resolve(res);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        activePlaybackToken.incrementAndGet();
        activeUtteranceId = null;
        isPlaybackPaused.set(false);
        stopAudioTrackImmediate();
        notifyListeners("seslenMouth", new JSObject().put("level", 0.0));
        call.resolve(new JSObject().put("ok", true));
    }

    @PluginMethod
    public void stopTest(PluginCall call) {
        activePlaybackToken.incrementAndGet();
        activeUtteranceId = null;
        isPlaybackPaused.set(false);
        stopAudioTrackImmediate();
        notifyListeners("seslenMouth", new JSObject().put("level", 0.0));
        JSObject res = new JSObject();
        res.put("ok", true);
        call.resolve(res);
    }

    private float[] synthesizeSingleChunk(JSONObject chunk, float rate, int chunkIdx) throws Exception {
        JSONArray tokensArr = chunk.getJSONArray("tokens");
        JSONArray egriArr = chunk.getJSONArray("egri");
        int L = tokensArr.length();

        ByteBuffer tokDirect = ByteBuffer.allocateDirect(L * 8).order(ByteOrder.nativeOrder());
        LongBuffer tokensBuf = tokDirect.asLongBuffer();
        ByteBuffer egriDirect = ByteBuffer.allocateDirect(L * 4).order(ByteOrder.nativeOrder());
        FloatBuffer egriBuf = egriDirect.asFloatBuffer();
        for (int i = 0; i < L; i++) {
            tokensBuf.put(i, tokensArr.getLong(i));
            egriBuf.put(i, (float) egriArr.getDouble(i));
        }
        tokensBuf.rewind();
        egriBuf.rewind();

        Set<Integer> commaSet = jsonIntSet(chunk.optJSONArray("commaIdx"));
        Set<Integer> semiSet = jsonIntSet(chunk.optJSONArray("semiIdx"));
        Set<Integer> colonSet = jsonIntSet(chunk.optJSONArray("colonIdx"));
        int sonHarf = chunk.optInt("sonHarf", 0);
        int payBirim = chunk.optInt("payBirim", 2);

        try (OnnxTensor tokensTensor = OnnxTensor.createTensor(ortEnv, tokensBuf, new long[] { 1L, L });
             OnnxTensor egriTensor = OnnxTensor.createTensor(ortEnv, egriBuf, new long[] { 1L, L })) {

            Map<String, OnnxTensor> metinInputs = new HashMap<>(4);
            metinInputs.put("tokens", tokensTensor);
            metinInputs.put("stil", cachedStil256Tensor);

            try (OrtSession.Result metinResult = metinSession.run(metinInputs)) {
                OnnxTensor dTensor = extractTensor(metinResult, "d");
                OnnxTensor tEnTensor = extractTensor(metinResult, "t_en");
                OnnxTensor sureTensor = extractTensor(metinResult, "sure");

                float[] sureRaw = new float[L];
                FloatBuffer sureBuf = sureTensor.getFloatBuffer();
                sureBuf.rewind();
                sureBuf.get(sureRaw, 0, Math.min(L, sureBuf.remaining()));

                int[] sureInt = new int[L];
                for (int i = 0; i < L; i++) {
                    float scaled = sureRaw[i] / rate;
                    sureInt[i] = Math.max(1, Math.round(scaled));
                }
                sureInt[0] = Math.min(sureInt[0], BAS_DOLGU);

                List<int[]> duraklar = new ArrayList<>();
                for (int idx = 1; idx < L - 1; idx++) {
                    int minMs = -1;
                    if (commaSet.contains(idx)) minMs = VIRGUL_MS;
                    else if (semiSet.contains(idx)) minMs = NOKTALI_MS;
                    else if (colonSet.contains(idx)) minMs = IKI_NOKTA_MS;

                    if (minMs >= 0) {
                        int wanted = Math.max(sureInt[idx], Math.round(minMs / (float) BIRIM_MS));
                        sureInt[idx] = Math.min(sureInt[idx], DURAK_KALAN);
                        if (wanted > sureInt[idx]) {
                            duraklar.add(new int[] { idx, wanted - sureInt[idx] });
                        }
                    }
                }

                int totalFrames = 0;
                for (int val : sureInt) totalFrames += val;
                if (totalFrames <= 0 || totalFrames > MAX_ALIGNMENT_FRAMES) {
                    throw new RuntimeException("ONNX hizalama çerçeve sayısı sınır dışında (F=" + totalFrames + ").");
                }

                addLog("Parça #" + chunkIdx + " metin.onnx: tokens=[1," + L + "], d="
                    + Arrays.toString(dTensor.getInfo().getShape()) + ", t_en="
                    + Arrays.toString(tEnTensor.getInfo().getShape()) + ", hiza=[1," + L + "," + totalFrames + "]");

                // Flat zero-initialized direct buffer eliminates jagged 3D float[][][] allocations and JNI copying
                ByteBuffer hizaDirect = ByteBuffer.allocateDirect(L * totalFrames * 4).order(ByteOrder.nativeOrder());
                FloatBuffer hizaBuf = hizaDirect.asFloatBuffer();
                int framePos = 0;
                for (int i = 0; i < L; i++) {
                    int dur = sureInt[i];
                    int rowBase = i * totalFrames + framePos;
                    for (int f = 0; f < dur; f++) {
                        hizaBuf.put(rowBase + f, 1.0f);
                    }
                    framePos += dur;
                }
                hizaBuf.rewind();

                try (OnnxTensor hizaTensor = OnnxTensor.createTensor(ortEnv, hizaBuf, new long[] { 1L, L, totalFrames })) {
                    Map<String, OnnxTensor> sesInputs = new HashMap<>(10);
                    sesInputs.put("d", dTensor);
                    sesInputs.put("t_en", tEnTensor);
                    sesInputs.put("hiza", hizaTensor);
                    sesInputs.put("s", cachedS128Tensor);
                    sesInputs.put("ref", cachedRef128Tensor);
                    sesInputs.put("perde", cachedPerdeTensor);
                    sesInputs.put("tonlama", cachedTonlamaTensor);
                    sesInputs.put("egri", egriTensor);

                    try (OrtSession.Result sesResult = sesSession.run(sesInputs)) {
                        OnnxTensor outTensor = extractTensor(sesResult, "ses");
                        FloatBuffer outBuf = outTensor.getFloatBuffer();
                        outBuf.rewind();
                        int rawLen = outBuf.remaining();
                        int trimLen = Math.max(0, rawLen - 50);
                        float[] wave = new float[trimLen];
                        outBuf.get(wave, 0, trimLen);
                        return applyDurationCutsAndPauses(wave, sureInt, duraklar, sonHarf, payBirim);
                    }
                }
            }
        }
    }

    private static float[] applyDurationCutsAndPauses(
        float[] wave,
        int[] sureInt,
        List<int[]> duraklar,
        int sonHarf,
        int payBirim
    ) {
        int[] sinir = new int[sureInt.length];
        int running = 0;
        for (int i = 0; i < sureInt.length; i++) {
            running += sureInt[i];
            sinir[i] = running * ORNEK_BIRIM;
        }

        int effectiveLen = wave.length;
        if (sonHarf > 0 && sonHarf < sinir.length) {
            effectiveLen = Math.min(wave.length, sinir[sonHarf] + payBirim * ORNEK_BIRIM);
            if (effectiveLen < wave.length) {
                wave = Arrays.copyOf(wave, effectiveLen);
            }
            int fadeN = Math.min(wave.length, ORNEK_BIRIM);
            int startIdx = wave.length - fadeN;
            for (int k = 0; k < fadeN; k++) {
                float factor = fadeN > 1 ? 1.0f - (k / (float) (fadeN - 1)) : 0.0f;
                wave[startIdx + k] *= factor;
            }
        }

        if (duraklar.isEmpty()) {
            return wave;
        }

        int extraSamples = 0;
        for (int[] p : duraklar) {
            int pSample = p[0] > 0 && p[0] - 1 < sinir.length ? sinir[p[0] - 1] : wave.length;
            if (pSample < wave.length) {
                extraSamples += p[1] * ORNEK_BIRIM;
            }
        }

        float[] out = new float[wave.length + extraSamples];
        int srcPos = 0;
        int dstPos = 0;
        for (int[] pause : duraklar) {
            int tokIdx = pause[0];
            int pSample = tokIdx > 0 && tokIdx - 1 < sinir.length ? sinir[tokIdx - 1] : wave.length;
            if (pSample >= wave.length) break;
            if (pSample <= srcPos) continue;

            int fade = Math.min(GECIS, Math.min(pSample - srcPos, wave.length - pSample));
            for (int k = 0; k < fade; k++) {
                float factorOut = fade > 1 ? 1.0f - (k / (float) (fade - 1)) : 0.0f;
                wave[pSample - fade + k] *= factorOut;
                float factorIn = fade > 1 ? (k / (float) (fade - 1)) : 1.0f;
                wave[pSample + k] *= factorIn;
            }

            int segLen = pSample - srcPos;
            System.arraycopy(wave, srcPos, out, dstPos, segLen);
            dstPos += segLen;
            dstPos += pause[1] * ORNEK_BIRIM;
            srcPos = pSample;
        }
        int rem = wave.length - srcPos;
        if (rem > 0) {
            System.arraycopy(wave, srcPos, out, dstPos, rem);
        }
        return out;
    }

    private static OnnxTensor extractTensor(OrtSession.Result result, String name) throws Exception {
        Optional<OnnxValue> opt = result.get(name);
        if (!opt.isPresent() || !(opt.get() instanceof OnnxTensor)) {
            throw new RuntimeException("ONNX çıkış tensoru bulunamadı: " + name);
        }
        return (OnnxTensor) opt.get();
    }

    private static Set<Integer> jsonIntSet(JSONArray arr) {
        Set<Integer> set = new HashSet<>();
        if (arr != null) {
            for (int i = 0; i < arr.length(); i++) {
                set.add(arr.optInt(i, -1));
            }
        }
        return set;
    }

    private void playShortPcm16Clean(short[] pcm16, float volume, long token, String utteranceId, String label) {
        int totalFrames = pcm16.length;
        int totalBytes = totalFrames * 2;
        if (totalBytes <= 0) return;

        byte[] pcmBytes = new byte[totalBytes];
        ByteBuffer.wrap(pcmBytes).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().put(pcm16);

        AudioAttributes attrs = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build();
        AudioFormat fmt = new AudioFormat.Builder()
            .setSampleRate(SAMPLE_RATE)
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
            .build();

        if (totalBytes <= STATIC_MAX_BYTES) {
            // MODE_STATIC: zero underruns/starvation because full 24 kHz PCM is pre-loaded before play()
            AudioTrack track = new AudioTrack(
                attrs,
                fmt,
                totalBytes,
                AudioTrack.MODE_STATIC,
                AudioManager.AUDIO_SESSION_ID_GENERATE
            );
            int written = track.write(pcmBytes, 0, totalBytes);
            addLog("AudioTrack MODE_STATIC (" + label + "): 24000Hz, mono, PCM_16BIT, written=" + written + "/" + totalBytes + " bytes");
            track.setVolume(volume);
            synchronized (audioLock) {
                activeAudioTrack = track;
            }
            track.play();

            long activePlayedMs = 0L;
            long lastLoopMs = System.currentTimeMillis();
            long maxWaitMs = ((totalFrames * 1000L) / SAMPLE_RATE) + 2500L;
            while (activePlaybackToken.get() == token) {
                long nowMs = System.currentTimeMillis();
                long dt = Math.max(0L, nowMs - lastLoopMs);
                lastLoopMs = nowMs;

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
                        break;
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

                activePlayedMs += dt;
                int head = track.getPlaybackHeadPosition();
                if (head >= totalFrames || activePlayedMs > maxWaitMs) {
                    break;
                }
                int windowStart = Math.max(0, Math.min(head, totalFrames - 1));
                int windowEnd = Math.min(totalFrames, windowStart + 960);
                double sumSq = 0.0;
                int cnt = Math.max(1, windowEnd - windowStart);
                for (int i = windowStart; i < windowEnd; i++) {
                    double v = pcm16[i] / 32768.0;
                    sumSq += v * v;
                }
                double rms = Math.sqrt(sumSq / cnt);
                double mouthLevel = Math.max(0.0, Math.min(1.0, (rms - 0.015) * 4.8));
                emitMouthLevel(mouthLevel, utteranceId);
                try {
                    Thread.sleep(45);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
            releaseTrackAfterCompletion();
        } else {
            // Fallback MODE_STREAM with generous 1-second hardware buffer and natural drain
            int minBuf = AudioTrack.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT);
            int bufBytes = Math.max(minBuf, SAMPLE_RATE * 2);
            AudioTrack track = new AudioTrack(
                attrs,
                fmt,
                bufBytes,
                AudioTrack.MODE_STREAM,
                AudioManager.AUDIO_SESSION_ID_GENERATE
            );
            track.setVolume(volume);
            synchronized (audioLock) {
                activeAudioTrack = track;
            }
            addLog("AudioTrack MODE_STREAM (" + label + "): 24000Hz, mono, PCM_16BIT, bufBytes=" + bufBytes);
            track.play();

            int offset = 0;
            int chunkShorts = 2400; // 100 ms blocks -> zero bridge flooding
            while (offset < pcm16.length && activePlaybackToken.get() == token) {
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
                        break;
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
                int count = Math.min(chunkShorts, pcm16.length - offset);
                double sumSq = 0.0;
                for (int i = 0; i < count; i++) {
                    double v = pcm16[offset + i] / 32768.0;
                    sumSq += v * v;
                }
                double rms = Math.sqrt(sumSq / Math.max(1, count));
                emitMouthLevel(Math.max(0.0, Math.min(1.0, (rms - 0.015) * 4.8)), utteranceId);
                track.write(pcm16, offset, count);
                offset += count;
            }
            releaseTrackAfterCompletion();
        }
        emitMouthLevel(0.0, utteranceId);
    }

    private void releaseTrackAfterCompletion() {
        synchronized (audioLock) {
            if (activeAudioTrack != null) {
                try {
                    activeAudioTrack.stop(); // drains buffered stream without flush() truncation
                } catch (Exception ignored) {
                }
                try {
                    activeAudioTrack.release();
                } catch (Exception ignored) {
                }
                activeAudioTrack = null;
            }
        }
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
    }

    private static void closeTensorQuietly(OnnxTensor t) {
        if (t != null) {
            try {
                t.close();
            } catch (Exception ignored) {
            }
        }
    }

    @Override
    protected void handleOnDestroy() {
        activePlaybackToken.incrementAndGet();
        cancelDownloadRequested.set(true);
        stopAudioTrackImmediate();
        synchronized (ortLock) {
            closeTensorQuietly(cachedStil256Tensor);
            cachedStil256Tensor = null;
            closeTensorQuietly(cachedRef128Tensor);
            cachedRef128Tensor = null;
            closeTensorQuietly(cachedS128Tensor);
            cachedS128Tensor = null;
            closeTensorQuietly(cachedPerdeTensor);
            cachedPerdeTensor = null;
            closeTensorQuietly(cachedTonlamaTensor);
            cachedTonlamaTensor = null;
            if (metinSession != null) {
                try {
                    metinSession.close();
                } catch (Exception ignored) {
                }
                metinSession = null;
            }
            if (sesSession != null) {
                try {
                    sesSession.close();
                } catch (Exception ignored) {
                }
                sesSession = null;
            }
        }
        downloadExecutor.shutdownNow();
        synthesisExecutor.shutdownNow();
        super.handleOnDestroy();
    }
}
