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
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.FloatBuffer;
import java.nio.LongBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import ai.onnxruntime.NodeInfo;
import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;
import ai.onnxruntime.TensorInfo;

/**
 * ZerreTtsPlugin — Saf yerel ONNX Runtime (Zerre-TTS SES-A / MK erkek sesi)
 *
 * Kurallar:
 * - android.speech.tts.* (Antalia-2 Mini / Google TTS) ASLA import edilmez ve kullanılmaz.
 * - Yalnızca voice=0L ("MK" SES-A erkek sesi) kullanılır; voice=1L ("NK" kadın sesi) asla seçilmez.
 * - Seslen-TTS Hasan varsayılanını bozmaz; kullanıcı isteğe bağlı olarak geçebilir.
 */
@CapacitorPlugin(name = "ZerreTts")
public class ZerreTtsPlugin extends Plugin {
    private static final String MODEL_DIR_NAME = "zerre_ses_a_v1";
    private static final String LAST_TEST_WAV_NAME = "last_test_zerre.wav";
    private static final int SAMPLE_RATE = 24000;
    private static final long VOICE_INDEX_MK = 0L; // Strictly MK (SES-A male)
    private static final float PEAK_LIMIT = 0.99f;

    private static final class ArtifactSpec {
        final String fileName;
        final String url;
        final long expectedBytes;
        final String sha256;

        ArtifactSpec(String fileName, String url, long expectedBytes, String sha256) {
            this.fileName = fileName;
            this.url = url;
            this.expectedBytes = expectedBytes;
            this.sha256 = sha256;
        }
    }

    private static final String BASE_URL =
            "https://raw.githubusercontent.com/erkinemreta1/zerre-tts/main/web/public";

    private static final ArtifactSpec[] ARTIFACTS = new ArtifactSpec[] {
            new ArtifactSpec(
                    "model.json",
                    BASE_URL + "/model.json",
                    893L,
                    "6676fda5a30fa4a3aefe6b7a453bec8ae92d2128be0646706ac262b267ca9ec9"
            ),
            new ArtifactSpec(
                    "lexicon-tr.json",
                    BASE_URL + "/lexicon-tr.json",
                    1174675L,
                    "31ea64f92811e555885f4d80dba01444db078ef45963f3cf67e86ffffeb64e8f"
            ),
            new ArtifactSpec(
                    "model.onnx",
                    BASE_URL + "/model.onnx",
                    8549070L,
                    "4c3d0d989a0376675f27645e4a6116bbff0dd8cd12208185c8069b6f7330115e"
            ),
    };

    private static final Locale TR_LOCALE = Locale.forLanguageTag("tr-TR");
    private static final Set<String> VOWEL_PHONES = new HashSet<>(
            Arrays.asList("a", "e", "i", "o", "u", "y", "ø", "œ", "ɯ")
    );
    private static final Set<Character> BACK_VOWELS = new HashSet<>(
            Arrays.asList('a', 'ı', 'o', 'u')
    );
    private static final Map<Character, String> BASE_PHONES = new HashMap<>();
    static {
        BASE_PHONES.put('a', "a");
        BASE_PHONES.put('b', "b");
        BASE_PHONES.put('c', "dʒ");
        BASE_PHONES.put('ç', "tʃ");
        BASE_PHONES.put('d', "d");
        BASE_PHONES.put('e', "e");
        BASE_PHONES.put('f', "f");
        BASE_PHONES.put('g', "g");
        BASE_PHONES.put('h', "h");
        BASE_PHONES.put('ı', "ɯ");
        BASE_PHONES.put('i', "i");
        BASE_PHONES.put('j', "ʒ");
        BASE_PHONES.put('k', "k");
        BASE_PHONES.put('l', "l");
        BASE_PHONES.put('m', "m");
        BASE_PHONES.put('n', "n");
        BASE_PHONES.put('o', "o");
        BASE_PHONES.put('ö', "œ");
        BASE_PHONES.put('p', "p");
        BASE_PHONES.put('r', "ɾ");
        BASE_PHONES.put('s', "s");
        BASE_PHONES.put('ş', "ʃ");
        BASE_PHONES.put('t', "t");
        BASE_PHONES.put('u', "u");
        BASE_PHONES.put('ü', "y");
        BASE_PHONES.put('v', "v");
        BASE_PHONES.put('y', "j");
        BASE_PHONES.put('z', "z");
    }

    private final ExecutorService downloadExecutor = Executors.newSingleThreadExecutor();
    private final ExecutorService speechExecutor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean isDownloading = new AtomicBoolean(false);
    private final AtomicBoolean cancelDownloadFlag = new AtomicBoolean(false);
    private final AtomicInteger speechTokenGen = new AtomicInteger(0);
    private final AtomicBoolean isPaused = new AtomicBoolean(false);
    private final Object pauseLock = new Object();
    private final Object modelLock = new Object();
    private final Object trackLock = new Object();
    private final List<String> recentLogs = new ArrayList<>();

    private OrtEnvironment ortEnv;
    private OrtSession onnxSession;
    private int modelMaxTokens = 512;
    private Map<String, Integer> symbolIndex = new HashMap<>();
    private Map<String, String[]> lexiconWords = new HashMap<>();
    private AudioTrack activeTrack;
    private AudioFocusRequest activeFocusRequest;
    private volatile String activeUtteranceId = null;

    private File getModelDir() {
        File dir = new File(getContext().getFilesDir(), MODEL_DIR_NAME);
        if (!dir.exists()) {
            dir.mkdirs();
        }
        return dir;
    }

    private synchronized void appendLog(String msg) {
        String ts = new SimpleDateFormat("HH:mm:ss.SSS", Locale.US).format(new Date());
        String line = "[" + ts + "] " + msg;
        recentLogs.add(line);
        if (recentLogs.size() > 120) {
            recentLogs.remove(0);
        }
        JSObject payload = new JSObject();
        payload.put("line", line);
        notifyListeners("zerreLog", payload);
    }

    private synchronized JSArray getLogsArray() {
        JSArray arr = new JSArray();
        for (String line : recentLogs) {
            arr.put(line);
        }
        return arr;
    }

    private boolean isWifiConnected() {
        try {
            ConnectivityManager cm =
                    (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return false;
            Network active = cm.getActiveNetwork();
            if (active == null) return false;
            NetworkCapabilities caps = cm.getNetworkCapabilities(active);
            return caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI);
        } catch (Throwable ignored) {
            return false;
        }
    }

    private JSObject collectMemoryStats() {
        JSObject mem = new JSObject();
        Runtime rt = Runtime.getRuntime();
        long jvmUsed = (rt.totalMemory() - rt.freeMemory()) / (1024L * 1024L);
        long jvmMax = rt.maxMemory() / (1024L * 1024L);
        long nativeHeap = Debug.getNativeHeapAllocatedSize() / (1024L * 1024L);
        mem.put("jvmUsedMb", jvmUsed);
        mem.put("jvmMaxMb", jvmMax);
        mem.put("nativeHeapMb", nativeHeap);
        try {
            ActivityManager am =
                    (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
            if (am != null) {
                ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
                am.getMemoryInfo(mi);
                mem.put("systemAvailMb", mi.availMem / (1024L * 1024L));
                mem.put("systemTotalMb", mi.totalMem / (1024L * 1024L));
                mem.put("isLowMemory", mi.lowMemory);
            }
        } catch (Throwable ignored) {
            // ignore
        }
        return mem;
    }

    private boolean allFilesInstalled() {
        File dir = getModelDir();
        for (ArtifactSpec spec : ARTIFACTS) {
            File f = new File(dir, spec.fileName);
            if (!f.exists() || f.length() != spec.expectedBytes) {
                return false;
            }
        }
        return true;
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        File dir = getModelDir();
        long downloaded = 0L;
        long total = 0L;
        JSArray files = new JSArray();
        boolean allOk = true;

        for (ArtifactSpec spec : ARTIFACTS) {
            total += spec.expectedBytes;
            File f = new File(dir, spec.fileName);
            long actual = f.exists() ? f.length() : 0L;
            boolean matched = f.exists() && actual == spec.expectedBytes;
            if (!matched) {
                allOk = false;
            }
            downloaded += Math.min(actual, spec.expectedBytes);

            JSObject row = new JSObject();
            row.put("fileName", spec.fileName);
            row.put("exists", f.exists());
            row.put("actualBytes", actual);
            row.put("expectedBytes", spec.expectedBytes);
            row.put("sizeMatched", matched);
            files.put(row);
        }

        File lastWav = new File(dir, LAST_TEST_WAV_NAME);
        JSObject res = new JSObject();
        res.put("modelInstalled", allOk);
        res.put("isDownloading", isDownloading.get());
        res.put("wifiConnected", isWifiConnected());
        res.put("downloadedBytes", downloaded);
        res.put("totalBytes", total);
        res.put("percent", total > 0 ? (int) Math.round((downloaded * 100.0) / total) : 0);
        res.put("storagePath", dir.getAbsolutePath());
        res.put("sessionLoaded", onnxSession != null && !lexiconWords.isEmpty());
        res.put("hasLastTestWav", lastWav.exists() && lastWav.length() > 44);
        res.put("voiceLabel", "SES-A (MK)");
        res.put("sampleRate", SAMPLE_RATE);
        res.put("files", files);
        res.put("memory", collectMemoryStats());
        res.put("logs", getLogsArray());
        call.resolve(res);
    }

    @PluginMethod
    public void verifyModelIntegrity(PluginCall call) {
        downloadExecutor.execute(() -> {
            File dir = getModelDir();
            JSArray files = new JSArray();
            boolean allValid = true;
            String firstError = null;

            for (ArtifactSpec spec : ARTIFACTS) {
                File f = new File(dir, spec.fileName);
                JSObject row = new JSObject();
                row.put("fileName", spec.fileName);
                row.put("expectedBytes", spec.expectedBytes);
                row.put("expectedSha256", spec.sha256);

                if (!f.exists()) {
                    allValid = false;
                    row.put("actualBytes", 0);
                    row.put("actualSha256", JSObject.NULL);
                    row.put("valid", false);
                    row.put("error", "Dosya bulunamadı");
                    if (firstError == null) firstError = spec.fileName + " eksik";
                    files.put(row);
                    continue;
                }

                long actualBytes = f.length();
                row.put("actualBytes", actualBytes);
                try {
                    String sha = sha256Hex(f);
                    boolean valid = actualBytes == spec.expectedBytes && spec.sha256.equalsIgnoreCase(sha);
                    row.put("actualSha256", sha);
                    row.put("valid", valid);
                    if (!valid) {
                        allValid = false;
                        String msg = spec.fileName + " SHA-256/boyut uyuşmadı";
                        row.put("error", msg);
                        if (firstError == null) firstError = msg;
                    }
                } catch (Exception e) {
                    allValid = false;
                    row.put("actualSha256", JSObject.NULL);
                    row.put("valid", false);
                    row.put("error", e.getMessage());
                    if (firstError == null) firstError = e.getMessage();
                }
                files.put(row);
            }

            appendLog("Zerre SHA-256 doğrulama sonucu: " + (allValid ? "BAŞARILI" : firstError));
            JSObject out = new JSObject();
            out.put("ok", allValid);
            out.put("files", files);
            out.put("logs", getLogsArray());
            if (!allValid && firstError != null) {
                out.put("error", firstError);
            }
            call.resolve(out);
        });
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        cancelDownloadFlag.set(true);
        JSObject out = new JSObject();
        out.put("ok", true);
        call.resolve(out);
    }

    @PluginMethod
    public void downloadModel(PluginCall call) {
        if (!isWifiConnected()) {
            JSObject res = new JSObject();
            res.put("ok", false);
            res.put("wifiRequired", true);
            res.put("error", "Model dosyaları (~9.7 MB) yalnızca Wi-Fi bağlantısı üzerinden indirilebilir.");
            call.resolve(res);
            return;
        }
        if (!isDownloading.compareAndSet(false, true)) {
            JSObject res = new JSObject();
            res.put("ok", false);
            res.put("error", "İndirme zaten devam ediyor.");
            call.resolve(res);
            return;
        }

        cancelDownloadFlag.set(false);
        downloadExecutor.execute(() -> {
            long totalBytes = 0L;
            for (ArtifactSpec s : ARTIFACTS) {
                totalBytes += s.expectedBytes;
            }
            long completedBeforeCurrent = 0L;
            File dir = getModelDir();

            try {
                for (ArtifactSpec spec : ARTIFACTS) {
                    File dest = new File(dir, spec.fileName);
                    if (dest.exists() && dest.length() == spec.expectedBytes) {
                        String existingSha = sha256Hex(dest);
                        if (spec.sha256.equalsIgnoreCase(existingSha)) {
                            completedBeforeCurrent += spec.expectedBytes;
                            emitDownloadProgress("verifying", spec.fileName, completedBeforeCurrent, totalBytes);
                            continue;
                        }
                    }

                    File part = new File(dir, spec.fileName + ".part");
                    if (part.exists()) part.delete();

                    appendLog("Zerre dosyası indiriliyor: " + spec.fileName);
                    HttpURLConnection conn = (HttpURLConnection) new URL(spec.url).openConnection();
                    conn.setConnectTimeout(15000);
                    conn.setReadTimeout(30000);
                    conn.setInstanceFollowRedirects(true);
                    int code = conn.getResponseCode();
                    if (code < 200 || code >= 300) {
                        throw new IOException(spec.fileName + " HTTP " + code);
                    }

                    long fileWritten = 0L;
                    byte[] buf = new byte[16384];
                    try (InputStream in = new BufferedInputStream(conn.getInputStream());
                         FileOutputStream fos = new FileOutputStream(part)) {
                        int n;
                        while ((n = in.read(buf)) != -1) {
                            if (cancelDownloadFlag.get()) {
                                throw new IOException("İndirme kullanıcı tarafından iptal edildi.");
                            }
                            fos.write(buf, 0, n);
                            fileWritten += n;
                            if ((fileWritten & 65535L) == 0L) {
                                emitDownloadProgress(
                                        "downloading",
                                        spec.fileName,
                                        completedBeforeCurrent + fileWritten,
                                        totalBytes
                                );
                            }
                        }
                        fos.getFD().sync();
                    } finally {
                        conn.disconnect();
                    }

                    emitDownloadProgress("verifying", spec.fileName, completedBeforeCurrent + fileWritten, totalBytes);
                    if (part.length() != spec.expectedBytes) {
                        part.delete();
                        throw new IOException(spec.fileName + " boyut uyumsuz: " + part.length() + " != " + spec.expectedBytes);
                    }
                    String sha = sha256Hex(part);
                    if (!spec.sha256.equalsIgnoreCase(sha)) {
                        part.delete();
                        throw new IOException(spec.fileName + " SHA-256 uyuşmadı.");
                    }
                    if (dest.exists()) dest.delete();
                    if (!part.renameTo(dest)) {
                        throw new IOException(spec.fileName + " taşınamadı.");
                    }
                    completedBeforeCurrent += spec.expectedBytes;
                }

                emitDownloadProgress("ready", "model.onnx", totalBytes, totalBytes);
                appendLog("Zerre SES-A (MK) dosyaları indirilip SHA-256 doğrulandı.");

                JSObject ok = new JSObject();
                ok.put("ok", true);
                ok.put("percent", 100);
                call.resolve(ok);
            } catch (Exception e) {
                appendLog("Zerre indirme hatası: " + e.getMessage());
                JSObject errEv = new JSObject();
                errEv.put("message", e.getMessage() != null ? e.getMessage() : "İndirme hatası");
                notifyListeners("zerreDownloadError", errEv);

                JSObject res = new JSObject();
                res.put("ok", false);
                res.put("error", e.getMessage());
                call.resolve(res);
            } finally {
                isDownloading.set(false);
            }
        });
    }

    private void emitDownloadProgress(String phase, String currentFile, long downloaded, long total) {
        JSObject ev = new JSObject();
        ev.put("phase", phase);
        ev.put("currentFile", currentFile);
        ev.put("downloadedBytes", downloaded);
        ev.put("totalBytes", total);
        ev.put("percent", total > 0 ? Math.min(100, (int) Math.round((downloaded * 100.0) / total)) : 0);
        notifyListeners("zerreDownloadProgress", ev);
    }

    private void ensureLoaded() throws Exception {
        synchronized (modelLock) {
            if (!allFilesInstalled()) {
                throw new IllegalStateException("Zerre SES-A (MK) model dosyaları cihazda kurulu değil.");
            }
            if (onnxSession != null && !lexiconWords.isEmpty() && !symbolIndex.isEmpty()) {
                return;
            }
            long t0 = System.currentTimeMillis();
            File dir = getModelDir();

            String modelJsonStr = readTextFile(new File(dir, "model.json"));
            JSONObject modelCfg = new JSONObject(modelJsonStr);
            modelMaxTokens = modelCfg.optInt("max_tokens", 512);

            String lexiconStr = readTextFile(new File(dir, "lexicon-tr.json"));
            JSONObject lexJson = new JSONObject(lexiconStr);
            JSONArray symbolsArr = lexJson.getJSONArray("symbols");
            Map<String, Integer> nextSymbols = new HashMap<>(symbolsArr.length() * 2);
            for (int i = 0; i < symbolsArr.length(); i++) {
                nextSymbols.put(symbolsArr.getString(i), i);
            }

            JSONObject wordsObj = lexJson.getJSONObject("words");
            Map<String, String[]> nextWords = new HashMap<>(wordsObj.length() * 2);
            Iterator<String> keys = wordsObj.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                JSONArray pair = wordsObj.getJSONArray(k);
                nextWords.put(k, new String[] { pair.getString(0), pair.getString(1) });
            }

            if (ortEnv == null) {
                ortEnv = OrtEnvironment.getEnvironment();
            }
            OrtSession.SessionOptions opts = new OrtSession.SessionOptions();
            opts.setIntraOpNumThreads(2);
            opts.setInterOpNumThreads(1);
            opts.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT);
            OrtSession nextSession = ortEnv.createSession(new File(dir, "model.onnx").getAbsolutePath(), opts);

            symbolIndex = nextSymbols;
            lexiconWords = nextWords;
            onnxSession = nextSession;
            long elapsed = System.currentTimeMillis() - t0;
            appendLog("Zerre SES-A (MK) ONNX + sözlük yüklendi (" + elapsed + " ms, " + nextWords.size() + " kelime).");
        }
    }

    @PluginMethod
    public void verifyInferenceContract(PluginCall call) {
        String text = call.getString("text", "Selamün aleyküm. Hayırlı dualar.");
        speechExecutor.execute(() -> {
            try {
                ensureLoaded();
                JSObject inputsMeta = new JSObject();
                for (Map.Entry<String, NodeInfo> entry : onnxSession.getInputInfo().entrySet()) {
                    inputsMeta.put(entry.getKey(), tensorMetaToJson(entry.getValue()));
                }
                JSObject outputsMeta = new JSObject();
                for (Map.Entry<String, NodeInfo> entry : onnxSession.getOutputInfo().entrySet()) {
                    outputsMeta.put(entry.getKey(), tensorMetaToJson(entry.getValue()));
                }

                PhonemeResult ph = phonemizeSentence(text);
                JSObject out = new JSObject();
                out.put("ok", true);
                out.put("voiceSelected", "MK (SES-A)");
                out.put("voiceIndex", (int) VOICE_INDEX_MK);
                out.put("sampleRate", SAMPLE_RATE);
                out.put("symbolCount", symbolIndex.size());
                out.put("lexiconWordCount", lexiconWords.size());
                out.put("tokensLength", ph.ids.length);
                out.put("inputs", inputsMeta);
                out.put("outputs", outputsMeta);
                out.put("memory", collectMemoryStats());
                out.put("logs", getLogsArray());
                call.resolve(out);
            } catch (Exception e) {
                JSObject out = new JSObject();
                out.put("ok", false);
                out.put("error", e.getMessage());
                out.put("logs", getLogsArray());
                call.resolve(out);
            }
        });
    }

    private JSObject tensorMetaToJson(NodeInfo ni) {
        JSObject obj = new JSObject();
        if (ni != null && ni.getInfo() instanceof TensorInfo) {
            TensorInfo ti = (TensorInfo) ni.getInfo();
            obj.put("type", ti.type.toString());
            JSArray shp = new JSArray();
            for (long d : ti.getShape()) {
                shp.put(d);
            }
            obj.put("shape", shp);
        }
        return obj;
    }

    @PluginMethod
    public void speakTest(PluginCall call) {
        String text = call.getString("text", "Allah'ım cümlemize sağlık ve afiyet ihsan eyle. Âmin.");
        float rate = clampSpeed(call.getFloat("rate", 0.94f));
        float volume = clampVolume(call.getFloat("volume", 0.95f));
        int token = speechTokenGen.incrementAndGet();
        isPaused.set(false);
        stopCurrentTrackOnly();

        speechExecutor.execute(() -> runSynthesisAndPlay(text, rate, volume, token, "zerre-test", true, call));
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "");
        String utteranceId = call.getString("utteranceId", "zerre-utt-" + System.currentTimeMillis());
        float rate = clampSpeed(call.getFloat("rate", 0.94f));
        float volume = clampVolume(call.getFloat("volume", 0.95f));

        if (!allFilesInstalled()) {
            JSObject missing = new JSObject();
            missing.put("ok", false);
            missing.put("utteranceId", utteranceId);
            missing.put("engineUsed", "zerre_ses_a");
            missing.put("antaliaUsed", false);
            missing.put("modelMissing", true);
            missing.put("error", "Zerre SES-A (MK) model dosyaları cihazda kurulu değil.");
            call.resolve(missing);
            return;
        }

        int token = speechTokenGen.incrementAndGet();
        isPaused.set(false);
        stopCurrentTrackOnly();
        activeUtteranceId = utteranceId;

        JSObject accepted = new JSObject();
        accepted.put("ok", true);
        accepted.put("utteranceId", utteranceId);
        accepted.put("engineUsed", "zerre_ses_a");
        accepted.put("antaliaUsed", false);
        call.resolve(accepted);

        speechExecutor.execute(() -> runSynthesisAndPlay(text, rate, volume, token, utteranceId, false, null));
    }

    @PluginMethod
    public void pause(PluginCall call) {
        isPaused.set(true);
        synchronized (trackLock) {
            if (activeTrack != null) {
                try {
                    if (activeTrack.getPlayState() == AudioTrack.PLAYSTATE_PLAYING) {
                        activeTrack.pause();
                    }
                } catch (Throwable ignored) {
                    // ignore
                }
            }
        }
        JSObject out = new JSObject();
        out.put("ok", true);
        call.resolve(out);
    }

    @PluginMethod
    public void resume(PluginCall call) {
        isPaused.set(false);
        synchronized (pauseLock) {
            pauseLock.notifyAll();
        }
        synchronized (trackLock) {
            if (activeTrack != null) {
                try {
                    if (activeTrack.getPlayState() == AudioTrack.PLAYSTATE_PAUSED) {
                        activeTrack.play();
                    }
                } catch (Throwable ignored) {
                    // ignore
                }
            }
        }
        JSObject out = new JSObject();
        out.put("ok", true);
        if (activeUtteranceId != null) {
            out.put("utteranceId", activeUtteranceId);
        }
        call.resolve(out);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        speechTokenGen.incrementAndGet();
        isPaused.set(false);
        synchronized (pauseLock) {
            pauseLock.notifyAll();
        }
        stopCurrentTrackOnly();
        activeUtteranceId = null;
        JSObject out = new JSObject();
        out.put("ok", true);
        call.resolve(out);
    }

    @PluginMethod
    public void stopTest(PluginCall call) {
        stop(call);
    }

    @PluginMethod
    public void replayLastTestWav(PluginCall call) {
        float volume = clampVolume(call.getFloat("volume", 0.95f));
        File wav = new File(getModelDir(), LAST_TEST_WAV_NAME);
        if (!wav.exists() || wav.length() <= 44) {
            JSObject out = new JSObject();
            out.put("ok", false);
            out.put("error", "Tekrar oynatılacak Zerre test WAV kaydı bulunamadı.");
            call.resolve(out);
            return;
        }
        int token = speechTokenGen.incrementAndGet();
        isPaused.set(false);
        stopCurrentTrackOnly();

        speechExecutor.execute(() -> {
            AudioTrack track = null;
            try {
                byte[] all = readBytesFile(wav);
                int pcmLen = all.length - 44;
                short[] pcm = new short[pcmLen / 2];
                for (int i = 0; i < pcm.length; i++) {
                    int lo = all[44 + i * 2] & 0xFF;
                    int hi = all[44 + i * 2 + 1];
                    pcm[i] = (short) ((hi << 8) | lo);
                }
                requestSpeechAudioFocus();
                track = createAudioTrack();
                synchronized (trackLock) {
                    activeTrack = track;
                }
                track.play();
                writePcmWithMouthEvents(track, pcm, volume, token, "zerre-replay");
                JSObject out = new JSObject();
                out.put("ok", true);
                out.put("playedPcmStats", computePcmStats(pcm));
                out.put("logs", getLogsArray());
                call.resolve(out);
            } catch (Exception e) {
                JSObject out = new JSObject();
                out.put("ok", false);
                out.put("error", e.getMessage());
                call.resolve(out);
            } finally {
                releaseAudioTrack(track);
                abandonSpeechAudioFocus();
            }
        });
    }

    private void runSynthesisAndPlay(
            String rawText,
            float rate,
            float volume,
            int token,
            String utteranceId,
            boolean saveTestWav,
            PluginCall resolveCall
    ) {
        long wallStart = System.currentTimeMillis();
        AudioTrack track = null;
        try {
            long loadStart = System.currentTimeMillis();
            boolean wasUnloaded = onnxSession == null;
            ensureLoaded();
            long modelLoadMs = wasUnloaded ? (System.currentTimeMillis() - loadStart) : 0L;

            List<String> sentences = splitSentences(rawText);
            if (sentences.isEmpty()) {
                throw new IllegalArgumentException("Okunacak Türkçe metin boş.");
            }

            long phonemizeMsTotal = 0L;
            long synthMsTotal = 0L;
            long firstAudioMs = -1L;
            boolean startEmitted = false;
            int chunkCount = 0;
            ByteArrayOutputStream fullWavPcm = saveTestWav ? new ByteArrayOutputStream() : null;
            long totalPcmSamples = 0L;

            requestSpeechAudioFocus();
            track = createAudioTrack();
            synchronized (trackLock) {
                activeTrack = track;
            }
            track.play();

            for (String sentence : sentences) {
                if (speechTokenGen.get() != token) {
                    throw new CancelledSpeechException();
                }
                waitWhilePaused(token);

                long pStart = System.currentTimeMillis();
                PhonemeResult ph = phonemizeSentence(sentence);
                phonemizeMsTotal += (System.currentTimeMillis() - pStart);
                if (ph.ids.length < 3 || ph.ids.length > modelMaxTokens) {
                    continue;
                }

                long sStart = System.currentTimeMillis();
                float[] audioFloat = synthesizeOne(ph, rate);
                synthMsTotal += (System.currentTimeMillis() - sStart);
                if (audioFloat.length == 0) {
                    continue;
                }

                short[] pcm = floatToLimitedPcm16(audioFloat);
                if (fullWavPcm != null) {
                    for (short s : pcm) {
                        fullWavPcm.write(s & 0xFF);
                        fullWavPcm.write((s >> 8) & 0xFF);
                    }
                }
                totalPcmSamples += pcm.length;
                chunkCount += 1;

                if (!startEmitted) {
                    startEmitted = true;
                    firstAudioMs = System.currentTimeMillis() - wallStart;
                    JSObject startEv = new JSObject();
                    startEv.put("token", token);
                    startEv.put("utteranceId", utteranceId);
                    startEv.put("timeToFirstAudioMs", firstAudioMs);
                    notifyListeners("zerreStart", startEv);
                }

                writePcmWithMouthEvents(track, pcm, volume, token, utteranceId);
            }

            if (chunkCount == 0 || totalPcmSamples == 0L) {
                throw new IllegalStateException("Zerre SES-A ses çıkışı üretmedi.");
            }

            if (saveTestWav && fullWavPcm != null) {
                byte[] pcmBytes = fullWavPcm.toByteArray();
                writeWavFile(new File(getModelDir(), LAST_TEST_WAV_NAME), pcmBytes, SAMPLE_RATE);
            }

            long totalWallMs = System.currentTimeMillis() - wallStart;
            double audioDurationMs = (totalPcmSamples * 1000.0) / SAMPLE_RATE;
            double rtf = audioDurationMs > 0 ? synthMsTotal / audioDurationMs : 0.0;

            JSObject donePayload = new JSObject();
            donePayload.put("ok", true);
            donePayload.put("token", token);
            donePayload.put("utteranceId", utteranceId);
            donePayload.put("engineUsed", "zerre_ses_a");
            donePayload.put("voiceSelected", "MK (SES-A)");
            donePayload.put("voiceIndex", (int) VOICE_INDEX_MK);
            donePayload.put("antaliaUsed", false);
            donePayload.put("modelLoadMs", modelLoadMs);
            donePayload.put("phonemizeMs", phonemizeMsTotal);
            donePayload.put("timeToFirstAudioMs", Math.max(0L, firstAudioMs));
            donePayload.put("synthesisMs", synthMsTotal);
            donePayload.put("audioDurationMs", Math.round(audioDurationMs));
            donePayload.put("totalWallMs", totalWallMs);
            donePayload.put("chunkCount", chunkCount);
            donePayload.put("streamingUsed", chunkCount > 1);
            donePayload.put("rtf", Math.round(rtf * 1000.0) / 1000.0);
            if (saveTestWav && fullWavPcm != null) {
                byte[] bytes = fullWavPcm.toByteArray();
                short[] allSamples = new short[bytes.length / 2];
                for (int i = 0; i < allSamples.length; i++) {
                    allSamples[i] = (short) (((bytes[i * 2 + 1]) << 8) | (bytes[i * 2] & 0xFF));
                }
                JSObject stats = computePcmStats(allSamples);
                donePayload.put("rawPcmStats", stats);
                donePayload.put("playedPcmStats", stats);
                donePayload.put("wavFile", LAST_TEST_WAV_NAME);
            }
            donePayload.put("memory", collectMemoryStats());
            donePayload.put("logs", getLogsArray());

            appendLog(String.format(
                    Locale.US,
                    "Zerre SES-A tamamlandı: %d parça, %d ms ses, sentez %d ms (RTF %.3f)",
                    chunkCount,
                    Math.round(audioDurationMs),
                    synthMsTotal,
                    rtf
            ));
            notifyListeners("zerreDone", donePayload);
            if (resolveCall != null) {
                resolveCall.resolve(donePayload);
            }
        } catch (CancelledSpeechException cancelled) {
            JSObject out = new JSObject();
            out.put("ok", false);
            out.put("cancelled", true);
            out.put("engineUsed", "zerre_ses_a");
            out.put("antaliaUsed", false);
            if (resolveCall != null) {
                resolveCall.resolve(out);
            }
        } catch (Exception e) {
            appendLog("Zerre SES-A hatası: " + e.getMessage());
            JSObject errEv = new JSObject();
            errEv.put("token", token);
            errEv.put("utteranceId", utteranceId);
            errEv.put("message", e.getMessage() != null ? e.getMessage() : "Zerre sentez hatası");
            notifyListeners("zerreError", errEv);
            if (resolveCall != null) {
                JSObject res = new JSObject();
                res.put("ok", false);
                res.put("engineUsed", "zerre_ses_a");
                res.put("antaliaUsed", false);
                res.put("error", e.getMessage());
                res.put("logs", getLogsArray());
                resolveCall.resolve(res);
            }
        } finally {
            if (utteranceId.equals(activeUtteranceId)) {
                activeUtteranceId = null;
            }
            releaseAudioTrack(track);
            abandonSpeechAudioFocus();
        }
    }

    private float[] synthesizeOne(PhonemeResult ph, float rate) throws Exception {
        long count = ph.ids.length;
        long[] ids = ph.ids;
        long[] stress = ph.stress;
        long[] voiceArr = new long[] { VOICE_INDEX_MK }; // Always MK (0L)
        float[] speedArr = new float[] { rate };
        float[] shiftArr = new float[] { 0.0f };
        float[] rangeArr = new float[] { 1.0f };

        Map<String, OnnxTensor> feeds = new HashMap<>();
        try {
            feeds.put("tokens", OnnxTensor.createTensor(ortEnv, LongBuffer.wrap(ids), new long[] { 1L, count }));
            feeds.put("stress", OnnxTensor.createTensor(ortEnv, LongBuffer.wrap(stress), new long[] { 1L, count }));
            feeds.put("voice", OnnxTensor.createTensor(ortEnv, LongBuffer.wrap(voiceArr), new long[] { 1L }));
            feeds.put("speed", OnnxTensor.createTensor(ortEnv, FloatBuffer.wrap(speedArr), new long[] { 1L }));
            feeds.put("pitch_shift", OnnxTensor.createTensor(ortEnv, FloatBuffer.wrap(shiftArr), new long[] { 1L }));
            feeds.put("pitch_range", OnnxTensor.createTensor(ortEnv, FloatBuffer.wrap(rangeArr), new long[] { 1L }));

            try (OrtSession.Result result = onnxSession.run(feeds)) {
                Object val = result.get(0).getValue();
                return flattenAudioTensor(val);
            }
        } finally {
            for (OnnxTensor t : feeds.values()) {
                try {
                    t.close();
                } catch (Throwable ignored) {
                    // ignore
                }
            }
        }
    }

    private float[] flattenAudioTensor(Object val) {
        if (val instanceof float[]) {
            return (float[]) val;
        }
        if (val instanceof float[][]) {
            float[][] rows = (float[][]) val;
            return rows.length > 0 ? rows[0] : new float[0];
        }
        if (val instanceof float[][][]) {
            float[][][] cube = (float[][][]) val;
            return (cube.length > 0 && cube[0].length > 0) ? cube[0][0] : new float[0];
        }
        return new float[0];
    }

    private short[] floatToLimitedPcm16(float[] samples) {
        float peak = 0f;
        for (float s : samples) {
            float a = Math.abs(s);
            if (!Float.isNaN(a) && !Float.isInfinite(a) && a > peak) {
                peak = a;
            }
        }
        float scale = peak > PEAK_LIMIT ? (PEAK_LIMIT / peak) : 1.0f;
        short[] out = new short[samples.length];
        for (int i = 0; i < samples.length; i++) {
            float v = samples[i];
            if (Float.isNaN(v) || Float.isInfinite(v)) {
                v = 0f;
            } else {
                v = Math.max(-1f, Math.min(1f, v * scale));
            }
            out[i] = (short) Math.round(v * 32767.0f);
        }
        return out;
    }

    private AudioTrack createAudioTrack() {
        int minBuf = AudioTrack.getMinBufferSize(
                SAMPLE_RATE,
                AudioFormat.CHANNEL_OUT_MONO,
                AudioFormat.ENCODING_PCM_16BIT
        );
        int bufBytes = Math.max(minBuf, SAMPLE_RATE / 2 * 2);
        AudioTrack track = new AudioTrack.Builder()
                .setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build())
                .setAudioFormat(new AudioFormat.Builder()
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(SAMPLE_RATE)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                        .build())
                .setBufferSizeInBytes(bufBytes)
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build();
        if (track.getState() != AudioTrack.STATE_INITIALIZED) {
            track.release();
            throw new IllegalStateException("Zerre AudioTrack başlatılamadı (STATE_INITIALIZED değil).");
        }
        return track;
    }

    private void writePcmWithMouthEvents(
            AudioTrack track,
            short[] pcm,
            float volume,
            int token,
            String utteranceId
    ) throws CancelledSpeechException {
        try {
            track.setVolume(volume);
        } catch (Throwable ignored) {
            // ignore
        }

        int frameSize = 1200; // 50ms at 24 kHz
        for (int off = 0; off < pcm.length; off += frameSize) {
            if (speechTokenGen.get() != token) {
                throw new CancelledSpeechException();
            }
            waitWhilePaused(token);

            int len = Math.min(frameSize, pcm.length - off);
            double sumSq = 0.0;
            double diffSq = 0.0;
            double prevV = 0.0;
            for (int i = 0; i < len; i++) {
                double n = pcm[off + i] / 32768.0;
                sumSq += n * n;
                if (i > 0) {
                    double d = n - prevV;
                    diffSq += d * d;
                }
                prevV = n;
            }
            double rms = Math.sqrt(sumSq / Math.max(1, len));
            double level = Math.min(1.0, rms * 3.8);
            double hfRatio = sumSq > 1e-7
                ? Math.max(0.0, Math.min(1.0, Math.sqrt(diffSq / Math.max(1e-9, sumSq)) * 0.55))
                : 0.0;
            long posMs = 0L;
            try {
                posMs = Math.max(0L, Math.round((track.getPlaybackHeadPosition() * 1000.0) / SAMPLE_RATE));
            } catch (Throwable ignored) {
            }

            JSObject mouth = new JSObject();
            mouth.put("level", level);
            mouth.put("positionMs", posMs);
            mouth.put("hfRatio", Math.round(hfRatio * 1000.0) / 1000.0);
            mouth.put("utteranceId", utteranceId);
            notifyListeners("zerreMouth", mouth);

            int written = track.write(pcm, off, len);
            if (written < 0) {
                throw new IllegalStateException("Zerre AudioTrack write hatası: " + written);
            }
        }
    }

    private void waitWhilePaused(int token) throws CancelledSpeechException {
        synchronized (pauseLock) {
            while (isPaused.get() && speechTokenGen.get() == token) {
                try {
                    pauseLock.wait(120);
                } catch (InterruptedException ignored) {
                    break;
                }
            }
        }
        if (speechTokenGen.get() != token) {
            throw new CancelledSpeechException();
        }
    }

    private void stopCurrentTrackOnly() {
        synchronized (trackLock) {
            if (activeTrack != null) {
                try {
                    activeTrack.pause();
                    activeTrack.flush();
                } catch (Throwable ignored) {
                    // ignore
                }
            }
        }
    }

    private void releaseAudioTrack(AudioTrack track) {
        if (track == null) return;
        synchronized (trackLock) {
            if (activeTrack == track) {
                activeTrack = null;
            }
        }
        try {
            track.stop();
        } catch (Throwable ignored) {
            // ignore
        }
        try {
            track.release();
        } catch (Throwable ignored) {
            // ignore
        }
    }

    private void requestSpeechAudioFocus() {
        try {
            AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            if (am == null) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                AudioFocusRequest req = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                        .setAudioAttributes(new AudioAttributes.Builder()
                                .setUsage(AudioAttributes.USAGE_MEDIA)
                                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                                .build())
                        .build();
                activeFocusRequest = req;
                am.requestAudioFocus(req);
            } else {
                am.requestAudioFocus(null, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK);
            }
        } catch (Throwable ignored) {
            // ignore
        }
    }

    private void abandonSpeechAudioFocus() {
        try {
            AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            if (am == null) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && activeFocusRequest != null) {
                am.abandonAudioFocusRequest(activeFocusRequest);
                activeFocusRequest = null;
            }
        } catch (Throwable ignored) {
            // ignore
        }
    }

    private static final class PhonemeResult {
        final long[] ids;
        final long[] stress;

        PhonemeResult(long[] ids, long[] stress) {
            this.ids = ids;
            this.stress = stress;
        }
    }

    private static final Pattern TOKEN_PATTERN = Pattern.compile("[\\p{L}]+|[.,!?;:—…]");

    private PhonemeResult phonemizeSentence(String text) {
        String normalized = text
                .replace('\u2019', '\'')
                .replace('\u2018', '\'')
                .replaceAll("\\s+", " ")
                .trim();

        List<Integer> ids = new ArrayList<>();
        List<Integer> stresses = new ArrayList<>();

        pushSymbol(ids, stresses, "<bos>", 0);
        boolean lastWasWord = false;
        Matcher m = TOKEN_PATTERN.matcher(normalized);
        while (m.find()) {
            String token = m.group();
            if (Character.isLetter(token.codePointAt(0))) {
                if (lastWasWord) {
                    pushSymbol(ids, stresses, "<sp>", 0);
                }
                String key = token.toLowerCase(TR_LOCALE);
                String[] entry = lexiconWords.get(key);
                if (entry != null) {
                    String[] phones = entry[0].split(" ");
                    String levelStr = entry[1];
                    for (int i = 0; i < phones.length; i++) {
                        String p = phones[i].trim();
                        if (p.isEmpty()) continue;
                        int lvl = (i < levelStr.length()) ? (levelStr.charAt(i) - '0') : 0;
                        if (lvl < 0 || lvl > 2) lvl = 0;
                        pushSymbol(ids, stresses, p, lvl);
                    }
                } else {
                    FallbackPhones fb = fallbackPhones(key);
                    for (int i = 0; i < fb.phones.size(); i++) {
                        pushSymbol(ids, stresses, fb.phones.get(i), fb.stress.get(i));
                    }
                }
                lastWasWord = true;
            } else {
                pushSymbol(ids, stresses, token, 0);
                lastWasWord = false;
            }
        }
        pushSymbol(ids, stresses, "<eos>", 0);

        long[] idArr = new long[ids.size()];
        long[] stArr = new long[stresses.size()];
        for (int i = 0; i < ids.size(); i++) {
            idArr[i] = ids.get(i);
            stArr[i] = stresses.get(i);
        }
        return new PhonemeResult(idArr, stArr);
    }

    private void pushSymbol(List<Integer> ids, List<Integer> stresses, String sym, int level) {
        Integer id = symbolIndex.get(sym);
        if (id == null) return;
        ids.add(id);
        stresses.add(level);
    }

    private static final class FallbackPhones {
        final List<String> phones = new ArrayList<>();
        final List<Integer> stress = new ArrayList<>();
    }

    private FallbackPhones fallbackPhones(String word) {
        FallbackPhones out = new FallbackPhones();
        for (int i = 0; i < word.length(); i++) {
            char letter = word.charAt(i);
            if (letter == 'ğ') {
                if (!out.phones.isEmpty() && i > 0 && isTrVowel(word.charAt(i - 1))) {
                    int last = out.phones.size() - 1;
                    out.phones.set(last, out.phones.get(last) + "ː");
                }
                continue;
            }
            String base = BASE_PHONES.get(letter);
            if (base == null) continue;
            char next = (i + 1 < word.length()) ? word.charAt(i + 1) : '\0';
            boolean front = (next == 'e' || next == 'i' || next == 'ö' || next == 'ü');
            String phone = base;
            if (letter == 'k' && front) phone = "c";
            if (letter == 'g' && front) phone = "ɟ";
            if (letter == 'l' && i > 0 && BACK_VOWELS.contains(word.charAt(i - 1))) phone = "ɫ";
            out.phones.add(phone);
            out.stress.add(0);
        }
        for (int i = out.phones.size() - 1; i >= 0; i--) {
            String stripped = out.phones.get(i).replace("ː", "");
            if (VOWEL_PHONES.contains(stripped)) {
                out.stress.set(i, 1);
                break;
            }
        }
        return out;
    }

    private boolean isTrVowel(char c) {
        return c == 'a' || c == 'e' || c == 'ı' || c == 'i' || c == 'o' || c == 'ö' || c == 'u' || c == 'ü';
    }

    private List<String> splitSentences(String rawText) {
        if (rawText == null) return Collections.emptyList();
        String cleaned = rawText.replaceAll("\\s+", " ").trim();
        if (cleaned.isEmpty()) return Collections.emptyList();
        String[] parts = cleaned.split("(?<=[.!?…])\\s+");
        List<String> out = new ArrayList<>();
        for (String p : parts) {
            String trimmed = p.trim();
            if (trimmed.isEmpty()) continue;
            if (trimmed.length() <= 220) {
                out.add(trimmed);
            } else {
                String[] words = trimmed.split("\\s+");
                StringBuilder sb = new StringBuilder();
                for (String w : words) {
                    if (sb.length() + w.length() + 1 > 220 && sb.length() > 0) {
                        out.add(sb.toString().trim());
                        sb.setLength(0);
                    }
                    if (sb.length() > 0) sb.append(' ');
                    sb.append(w);
                }
                if (sb.length() > 0) out.add(sb.toString().trim());
            }
        }
        return out;
    }

    private JSObject computePcmStats(short[] pcm) {
        double min = 1.0, max = -1.0, peak = 0.0, sumSq = 0.0, sum = 0.0;
        for (short s : pcm) {
            double v = s / 32768.0;
            if (v < min) min = v;
            if (v > max) max = v;
            double a = Math.abs(v);
            if (a > peak) peak = a;
            sumSq += v * v;
            sum += v;
        }
        int n = Math.max(1, pcm.length);
        JSObject obj = new JSObject();
        obj.put("sampleRate", SAMPLE_RATE);
        obj.put("channels", 1);
        obj.put("encoding", "PCM_16BIT");
        obj.put("sampleCount", pcm.length);
        obj.put("durationMs", Math.round((pcm.length * 1000.0) / SAMPLE_RATE));
        obj.put("min", min);
        obj.put("max", max);
        obj.put("peak", peak);
        obj.put("rms", Math.sqrt(sumSq / n));
        obj.put("dcOffset", sum / n);
        obj.put("nanOrInfCount", 0);
        return obj;
    }

    private static float clampSpeed(float rate) {
        if (Float.isNaN(rate) || Float.isInfinite(rate)) return 0.94f;
        return Math.max(0.65f, Math.min(1.45f, rate));
    }

    private static float clampVolume(float vol) {
        if (Float.isNaN(vol) || Float.isInfinite(vol)) return 0.95f;
        return Math.max(0.05f, Math.min(1.0f, vol));
    }

    private static String sha256Hex(File file) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        byte[] buf = new byte[16384];
        try (InputStream in = new BufferedInputStream(new FileInputStream(file))) {
            int n;
            while ((n = in.read(buf)) != -1) {
                md.update(buf, 0, n);
            }
        }
        byte[] digest = md.digest();
        StringBuilder sb = new StringBuilder(digest.length * 2);
        for (byte b : digest) {
            sb.append(String.format(Locale.US, "%02x", b & 0xff));
        }
        return sb.toString();
    }

    private static String readTextFile(File f) throws IOException {
        return new String(readBytesFile(f), StandardCharsets.UTF_8);
    }

    private static byte[] readBytesFile(File f) throws IOException {
        byte[] buf = new byte[16384];
        ByteArrayOutputStream out = new ByteArrayOutputStream((int) f.length());
        try (InputStream in = new BufferedInputStream(new FileInputStream(f))) {
            int n;
            while ((n = in.read(buf)) != -1) {
                out.write(buf, 0, n);
            }
        }
        return out.toByteArray();
    }

    private static void writeWavFile(File file, byte[] pcmBytes, int sampleRate) throws IOException {
        int totalDataLen = pcmBytes.length + 36;
        int byteRate = sampleRate * 2;
        byte[] header = new byte[44];
        header[0] = 'R'; header[1] = 'I'; header[2] = 'F'; header[3] = 'F';
        header[4] = (byte) (totalDataLen & 0xff);
        header[5] = (byte) ((totalDataLen >> 8) & 0xff);
        header[6] = (byte) ((totalDataLen >> 16) & 0xff);
        header[7] = (byte) ((totalDataLen >> 24) & 0xff);
        header[8] = 'W'; header[9] = 'A'; header[10] = 'V'; header[11] = 'E';
        header[12] = 'f'; header[13] = 'm'; header[14] = 't'; header[15] = ' ';
        header[16] = 16; header[17] = 0; header[18] = 0; header[19] = 0;
        header[20] = 1; header[21] = 0; // PCM
        header[22] = 1; header[23] = 0; // Mono
        header[24] = (byte) (sampleRate & 0xff);
        header[25] = (byte) ((sampleRate >> 8) & 0xff);
        header[26] = (byte) ((sampleRate >> 16) & 0xff);
        header[27] = (byte) ((sampleRate >> 24) & 0xff);
        header[28] = (byte) (byteRate & 0xff);
        header[29] = (byte) ((byteRate >> 8) & 0xff);
        header[30] = (byte) ((byteRate >> 16) & 0xff);
        header[31] = (byte) ((byteRate >> 24) & 0xff);
        header[32] = 2; header[33] = 0; // block align
        header[34] = 16; header[35] = 0; // bits per sample
        header[36] = 'd'; header[37] = 'a'; header[38] = 't'; header[39] = 'a';
        header[40] = (byte) (pcmBytes.length & 0xff);
        header[41] = (byte) ((pcmBytes.length >> 8) & 0xff);
        header[42] = (byte) ((pcmBytes.length >> 16) & 0xff);
        header[43] = (byte) ((pcmBytes.length >> 24) & 0xff);

        try (FileOutputStream fos = new FileOutputStream(file)) {
            fos.write(header);
            fos.write(pcmBytes);
            fos.getFD().sync();
        }
    }

    private static final class CancelledSpeechException extends Exception {
    }
}
