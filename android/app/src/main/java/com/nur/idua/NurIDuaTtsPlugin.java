package com.nur.idua;

import android.os.Build;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

@CapacitorPlugin(name = "NurIDuaTts")
public class NurIDuaTtsPlugin extends Plugin {

    private final Object lock = new Object();
    private TextToSpeech tts;
    private volatile boolean initialized = false;
    private volatile boolean initFailed = false;
    private volatile String lastError = null;
    private CountDownLatch initLatch = new CountDownLatch(1);

    // Active utterance & pause tracking
    private volatile String activeUtteranceId = null;
    private volatile String lastText = "";
    private volatile String lastLang = "tr-TR";
    private volatile float lastRate = 0.86f;
    private volatile float lastPitch = 0.84f;
    private volatile float lastVolume = 0.95f;
    private volatile String lastVoiceName = null;
    private volatile boolean customVoiceApplied = false;
    private volatile int pauseBaseOffset = 0;
    private volatile int lastRangeStart = 0;
    private volatile boolean isPausedState = false;

    @Override
    public void load() {
        super.load();
        initTtsEngine();
    }

    private void initTtsEngine() {
        synchronized (lock) {
            if (tts != null) {
                try {
                    tts.stop();
                    tts.shutdown();
                } catch (Exception ignored) {
                }
                tts = null;
            }
            initialized = false;
            initFailed = false;
            lastError = null;
            initLatch = new CountDownLatch(1);

            // Do NOT pass an explicit engine package name; connect to Android's user-selected default TTS engine.
            tts = new TextToSpeech(getContext().getApplicationContext(), status -> {
                if (status == TextToSpeech.SUCCESS) {
                    initialized = true;
                    initFailed = false;
                    lastError = null;
                    attachProgressListener();
                } else {
                    initialized = false;
                    initFailed = true;
                    lastError = "Android TextToSpeech motoru başlatılamadı (status=" + status + "). Cihaz TTS ayarlarını kontrol edin.";
                }
                initLatch.countDown();
            });
        }
    }

    private void attachProgressListener() {
        if (tts == null) return;
        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override
            public void onStart(String utteranceId) {
                if (utteranceId == null || !utteranceId.equals(activeUtteranceId)) {
                    return;
                }
                JSObject payload = new JSObject();
                payload.put("utteranceId", utteranceId);
                notifyListeners("ttsStart", payload);
            }

            @Override
            public void onRangeStart(String utteranceId, int start, int end, int frame) {
                if (utteranceId == null || !utteranceId.equals(activeUtteranceId)) {
                    return;
                }
                lastRangeStart = Math.max(0, start);
                JSObject payload = new JSObject();
                payload.put("utteranceId", utteranceId);
                payload.put("start", start);
                payload.put("end", end);
                payload.put("frame", frame);
                notifyListeners("ttsRange", payload);
            }

            @Override
            public void onDone(String utteranceId) {
                if (utteranceId == null || !utteranceId.equals(activeUtteranceId)) {
                    // Ignore delayed onDone from stopped or superseded prayers
                    return;
                }
                activeUtteranceId = null;
                isPausedState = false;
                JSObject payload = new JSObject();
                payload.put("utteranceId", utteranceId);
                notifyListeners("ttsDone", payload);
            }

            @Override
            @Deprecated
            public void onError(String utteranceId) {
                emitUtteranceError(utteranceId, -1, "Android TextToSpeech seslendirme sırasında hata oluştu.");
            }

            @Override
            public void onError(String utteranceId, int errorCode) {
                emitUtteranceError(utteranceId, errorCode, describeTtsErrorCode(errorCode));
            }

            @Override
            public void onStop(String utteranceId, boolean interrupted) {
                // Intentionally do NOT emit ttsDone when stopped/interrupted so cancelled prayers do not advance queue.
                if (utteranceId != null && utteranceId.equals(activeUtteranceId)) {
                    activeUtteranceId = null;
                }
            }
        });
    }

    private void emitUtteranceError(String utteranceId, int errorCode, String message) {
        if (utteranceId != null && activeUtteranceId != null && !utteranceId.equals(activeUtteranceId)) {
            return;
        }
        activeUtteranceId = null;
        isPausedState = false;
        lastError = message;
        JSObject payload = new JSObject();
        payload.put("utteranceId", utteranceId != null ? utteranceId : "");
        payload.put("errorCode", errorCode);
        payload.put("message", message);
        notifyListeners("ttsError", payload);
    }

    private String describeTtsErrorCode(int errorCode) {
        switch (errorCode) {
            case TextToSpeech.ERROR_SYNTHESIS:
                return "Android TTS sentezleme hatası (ERROR_SYNTHESIS).";
            case TextToSpeech.ERROR_SERVICE:
                return "Android TTS servis bağlantısı kesildi (ERROR_SERVICE).";
            case TextToSpeech.ERROR_OUTPUT:
                return "Ses çıkış hatası (ERROR_OUTPUT).";
            case TextToSpeech.ERROR_NETWORK:
                return "Ağ tabanlı TTS sesine ulaşılamadı (ERROR_NETWORK).";
            case TextToSpeech.ERROR_NETWORK_TIMEOUT:
                return "Ağ TTS zaman aşımı (ERROR_NETWORK_TIMEOUT).";
            case TextToSpeech.ERROR_INVALID_REQUEST:
                return "Geçersiz TTS isteği (ERROR_INVALID_REQUEST).";
            case TextToSpeech.ERROR_NOT_INSTALLED_YET:
                return "Seçili TTS motorunun Türkçe ses verisi henüz yüklenmemiş (ERROR_NOT_INSTALLED_YET).";
            default:
                return "Android TextToSpeech hatası (kod=" + errorCode + ").";
        }
    }

    private boolean ensureReady() {
        if (initialized && tts != null) return true;
        if (tts == null || initFailed) {
            initTtsEngine();
        }
        try {
            initLatch.await(3500, TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        return initialized && tts != null;
    }

    private Locale parseLocale(String langTag) {
        if (langTag == null || langTag.trim().isEmpty()) {
            return new Locale("tr", "TR");
        }
        String normalized = langTag.trim().replace('_', '-');
        String[] parts = normalized.split("-");
        if (parts.length >= 2) {
            return new Locale(parts[0].toLowerCase(Locale.ROOT), parts[1].toUpperCase(Locale.ROOT));
        }
        if ("tr".equalsIgnoreCase(parts[0])) {
            return new Locale("tr", "TR");
        }
        return new Locale(parts[0].toLowerCase(Locale.ROOT));
    }

    private String mapTurkishSupportLabel(int code) {
        switch (code) {
            case TextToSpeech.LANG_COUNTRY_VAR_AVAILABLE:
            case TextToSpeech.LANG_COUNTRY_AVAILABLE:
                return "supported";
            case TextToSpeech.LANG_AVAILABLE:
                return "country_available";
            case TextToSpeech.LANG_MISSING_DATA:
                return "missing_data";
            case TextToSpeech.LANG_NOT_SUPPORTED:
                return "not_supported";
            default:
                return "unknown";
        }
    }

    @PluginMethod
    public void getEngineInfo(PluginCall call) {
        boolean ready = ensureReady();
        JSObject result = new JSObject();
        result.put("initialized", ready);

        if (!ready || tts == null) {
            result.put("defaultEngine", null);
            result.put("defaultEngineLabel", null);
            result.put("engines", new JSArray());
            result.put("turkishSupport", "unknown");
            result.put("turkishSupportCode", null);
            result.put("voices", new JSArray());
            result.put("antaliaEngineMatched", false);
            result.put("antaliaVoiceMatched", false);
            result.put("lastError", lastError != null ? lastError : "Android TextToSpeech henüz hazır değil.");
            call.resolve(result);
            return;
        }

        String defaultEngine = null;
        try {
            defaultEngine = tts.getDefaultEngine();
        } catch (Exception e) {
            lastError = e.getMessage();
        }

        String defaultEngineLabel = null;
        boolean antaliaEngineMatched = defaultEngine != null && defaultEngine.toLowerCase(Locale.ROOT).contains("antalia");

        JSArray enginesArray = new JSArray();
        try {
            List<TextToSpeech.EngineInfo> engineList = tts.getEngines();
            if (engineList != null) {
                for (TextToSpeech.EngineInfo info : engineList) {
                    if (info == null) continue;
                    boolean isDef = defaultEngine != null && defaultEngine.equals(info.name);
                    if (isDef) {
                        defaultEngineLabel = info.label;
                    }
                    String combined = ((info.name != null ? info.name : "") + " " + (info.label != null ? info.label : "")).toLowerCase(Locale.ROOT);
                    if (combined.contains("antalia")) {
                        if (isDef) antaliaEngineMatched = true;
                    }
                    JSObject engObj = new JSObject();
                    engObj.put("name", info.name != null ? info.name : "");
                    engObj.put("label", info.label != null ? info.label : "");
                    engObj.put("isDefault", isDef);
                    enginesArray.put(engObj);
                }
            }
        } catch (Exception e) {
            lastError = "TTS motorları sorgulanırken hata: " + e.getMessage();
        }

        int trCode = TextToSpeech.LANG_NOT_SUPPORTED;
        try {
            trCode = tts.isLanguageAvailable(new Locale("tr", "TR"));
        } catch (Exception e) {
            lastError = "Türkçe dil desteği sorgulanamadı: " + e.getMessage();
        }

        JSArray voicesArray = new JSArray();
        boolean antaliaVoiceMatched = false;
        try {
            Set<Voice> voiceSet = tts.getVoices();
            if (voiceSet != null) {
                List<Voice> sortedVoices = new ArrayList<>(voiceSet);
                for (Voice v : sortedVoices) {
                    if (v == null) continue;
                    String vName = v.getName() != null ? v.getName() : "";
                    String vLocale = v.getLocale() != null ? v.getLocale().toLanguageTag() : "";
                    boolean matchesAntalia = vName.toLowerCase(Locale.ROOT).contains("antalia");
                    if (matchesAntalia) {
                        antaliaVoiceMatched = true;
                    }

                    JSArray featArr = new JSArray();
                    Set<String> features = v.getFeatures();
                    if (features != null) {
                        for (String f : features) {
                            featArr.put(f);
                        }
                    }

                    JSObject vObj = new JSObject();
                    vObj.put("name", vName);
                    vObj.put("locale", vLocale);
                    vObj.put("quality", v.getQuality());
                    vObj.put("latency", v.getLatency());
                    vObj.put("isNetworkConnectionRequired", v.isNetworkConnectionRequired());
                    vObj.put("features", featArr);
                    vObj.put("matchesAntalia", matchesAntalia);
                    voicesArray.put(vObj);
                }
            }
        } catch (Exception e) {
            // Some third-party engines throw or return null on getVoices(); report cleanly without crashing.
            if (lastError == null) {
                lastError = "Motor ses listesi (getVoices) okunamadı: " + e.getMessage();
            }
        }

        result.put("defaultEngine", defaultEngine);
        result.put("defaultEngineLabel", defaultEngineLabel);
        result.put("engines", enginesArray);
        result.put("turkishSupport", mapTurkishSupportLabel(trCode));
        result.put("turkishSupportCode", trCode);
        result.put("voices", voicesArray);
        result.put("antaliaEngineMatched", antaliaEngineMatched);
        result.put("antaliaVoiceMatched", antaliaVoiceMatched);
        result.put("lastError", lastError);
        call.resolve(result);
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "");
        String utteranceId = call.getString("utteranceId", "");
        String lang = call.getString("lang", "tr-TR");
        Double rateVal = call.getDouble("rate", 0.86);
        Double pitchVal = call.getDouble("pitch", 0.84);
        Double volumeVal = call.getDouble("volume", 0.95);
        String voiceName = call.getString("voiceName", null);

        if (text == null || text.trim().isEmpty()) {
            JSObject errRes = new JSObject();
            errRes.put("ok", false);
            errRes.put("utteranceId", utteranceId);
            errRes.put("error", "Seslendirilecek metin boş.");
            call.resolve(errRes);
            return;
        }

        if (utteranceId == null || utteranceId.trim().isEmpty()) {
            utteranceId = "nuri_" + System.currentTimeMillis();
        }

        if (!ensureReady() || tts == null) {
            JSObject errRes = new JSObject();
            errRes.put("ok", false);
            errRes.put("utteranceId", utteranceId);
            errRes.put("error", lastError != null ? lastError : "Android TextToSpeech motoru hazır değil.");
            call.resolve(errRes);
            return;
        }

        float rate = (float) Math.max(0.4, Math.min(2.0, rateVal != null ? rateVal : 0.86));
        float pitch = (float) Math.max(0.4, Math.min(2.0, pitchVal != null ? pitchVal : 0.84));
        float volume = (float) Math.max(0.0, Math.min(1.0, volumeVal != null ? volumeVal : 0.95));

        lastText = text;
        lastLang = lang != null ? lang : "tr-TR";
        lastRate = rate;
        lastPitch = pitch;
        lastVolume = volume;
        lastVoiceName = (voiceName != null && !voiceName.trim().isEmpty()) ? voiceName.trim() : null;
        pauseBaseOffset = 0;
        lastRangeStart = 0;
        isPausedState = false;

        int status = speakInternal(text, lastLang, rate, pitch, volume, lastVoiceName, utteranceId);
        JSObject res = new JSObject();
        if (status == TextToSpeech.SUCCESS) {
            res.put("ok", true);
            res.put("utteranceId", utteranceId);
        } else {
            res.put("ok", false);
            res.put("utteranceId", utteranceId);
            res.put("error", lastError != null ? lastError : "Android TextToSpeech speak() çağrısı başarısız oldu.");
        }
        call.resolve(res);
    }

    private int speakInternal(
            String text,
            String lang,
            float rate,
            float pitch,
            float volume,
            String voiceName,
            String utteranceId
    ) {
        if (tts == null) return TextToSpeech.ERROR;

        try {
            // Invalidate previous utterance ID before stopping so old onDone/onStop events are ignored
            activeUtteranceId = null;
            tts.stop();

            Locale targetLocale = parseLocale(lang);
            int langAvailability = tts.setLanguage(targetLocale);
            if (langAvailability == TextToSpeech.LANG_MISSING_DATA) {
                lastError = "Seçili Android TTS motorunda Türkçe (" + lang + ") ses paketi eksik (LANG_MISSING_DATA).";
                return TextToSpeech.ERROR;
            }
            if (langAvailability == TextToSpeech.LANG_NOT_SUPPORTED) {
                lastError = "Seçili Android TTS motoru Türkçe (" + lang + ") dilini desteklemiyor (LANG_NOT_SUPPORTED).";
                return TextToSpeech.ERROR;
            }

            if (voiceName != null && !voiceName.isEmpty()) {
                try {
                    Set<Voice> voices = tts.getVoices();
                    if (voices != null) {
                        for (Voice v : voices) {
                            if (v != null && voiceName.equals(v.getName())) {
                                tts.setVoice(v);
                                customVoiceApplied = true;
                                break;
                            }
                        }
                    }
                } catch (Exception ignored) {
                    // Keep default engine voice if explicit voice lookup fails
                }
            } else if (customVoiceApplied) {
                try {
                    Voice defaultVoice = tts.getDefaultVoice();
                    if (defaultVoice != null) {
                        tts.setVoice(defaultVoice);
                    }
                } catch (Exception ignored) {
                    // Ignore if engine does not expose getDefaultVoice()
                }
                customVoiceApplied = false;
            }

            tts.setSpeechRate(rate);
            tts.setPitch(pitch);

            Bundle params = new Bundle();
            params.putString(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, utteranceId);
            params.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, volume);

            activeUtteranceId = utteranceId;
            int speakStatus = tts.speak(text, TextToSpeech.QUEUE_FLUSH, params, utteranceId);
            if (speakStatus != TextToSpeech.SUCCESS) {
                activeUtteranceId = null;
                lastError = "Android TextToSpeech.speak() hata kodu döndürdü: " + speakStatus;
            } else {
                lastError = null;
            }
            return speakStatus;
        } catch (Exception e) {
            activeUtteranceId = null;
            lastError = "Android TTS çalıştırma hatası: " + e.getMessage();
            return TextToSpeech.ERROR;
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        activeUtteranceId = null;
        isPausedState = false;
        pauseBaseOffset = 0;
        lastRangeStart = 0;
        if (tts != null) {
            try {
                tts.stop();
            } catch (Exception ignored) {
            }
        }
        JSObject res = new JSObject();
        res.put("ok", true);
        call.resolve(res);
    }

    @PluginMethod
    public void pause(PluginCall call) {
        if (activeUtteranceId != null && tts != null) {
            isPausedState = true;
            pauseBaseOffset = Math.min(lastText.length(), pauseBaseOffset + lastRangeStart);
            lastRangeStart = 0;
            activeUtteranceId = null;
            try {
                tts.stop();
            } catch (Exception ignored) {
            }
        }
        JSObject res = new JSObject();
        res.put("ok", true);
        res.put("pausedAtOffset", pauseBaseOffset);
        call.resolve(res);
    }

    @PluginMethod
    public void resume(PluginCall call) {
        JSObject res = new JSObject();
        if (!isPausedState || lastText == null || lastText.isEmpty()) {
            res.put("ok", false);
            res.put("error", "Devam ettirilecek duraklatılmış konuşma yok.");
            call.resolve(res);
            return;
        }

        int safeOffset = Math.max(0, Math.min(pauseBaseOffset, Math.max(0, lastText.length() - 1)));
        String remaining = lastText.substring(safeOffset).trim();
        if (remaining.isEmpty()) {
            remaining = lastText;
            pauseBaseOffset = 0;
        }

        String resumedUtteranceId = "nuri_resume_" + System.currentTimeMillis();
        isPausedState = false;
        lastRangeStart = 0;
        int status = speakInternal(remaining, lastLang, lastRate, lastPitch, lastVolume, lastVoiceName, resumedUtteranceId);
        if (status == TextToSpeech.SUCCESS) {
            res.put("ok", true);
            res.put("utteranceId", resumedUtteranceId);
        } else {
            res.put("ok", false);
            res.put("error", lastError != null ? lastError : "Duraklatılan konuşma devam ettirilemedi.");
        }
        call.resolve(res);
    }

    @Override
    protected void handleOnDestroy() {
        activeUtteranceId = null;
        if (tts != null) {
            try {
                tts.stop();
                tts.shutdown();
            } catch (Exception ignored) {
            }
            tts = null;
        }
        initialized = false;
        super.handleOnDestroy();
    }
}
