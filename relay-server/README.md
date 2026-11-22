# NUR-I DUA — Harici TikTok LIVE Relay Sunucusu (`@fcproplayer7`)

Android Capacitor uygulaması ve web tarayıcısı doğrudan `tiktok-live-connector` (Node.js WebSocket/Protobuf katmanı) çalıştıramaz.
Bu klasör, Render gibi ücretsiz bir Node.js ortamında `process.env.PORT` ve `0.0.0.0` üzerinde çalıştırılabilecek bağımsız, sıfır-kimlik-bilgili (şifre/çerez istemeyen) Node.js ESM relay sunucusudur.

## Özellikler

- `process.env.PORT` (varsayılan `8080`) ve `0.0.0.0` üzerinde dinler (Render Web Service ile tam uyumludur).
- Yalnızca herkese açık yayıncı kullanıcı adı (`@fcproplayer7`) ile bağlanır; TikTok şifresi, çerezi veya gizli oturum bilgisi istemez ve saklamaz.
- `giftType === 1 && !repeatEnd` seri hediye paketlerini seri bitene kadar bekletir; seri tamamlandığında doğru toplam miktarla **tek bir** `gift` SSE olayı yayınlar.
- `X-Accel-Buffering: no` ve CORS açık olduğu için Render üzerinden hem Android Capacitor uygulamasına hem masaüstü tarayıcıya kesintisiz SSE aktarır.

## Uç Noktalar

- `GET /` ve `GET /health` — Sunucu sağlık kontrolü (`200 OK`, gecikme ve `simulationEnabled` bilgisi)
- `GET /status?username=fcproplayer7` — Anlık oturum durumu (`state`, `roomId`, `viewerCount`, `followerCount`, `lastEvent`, `lastError`)
- `POST /connect` — `{ "username": "fcproplayer7" }` ile canlı yayına bağlanır
- `POST /reconnect` — `{ "username": "fcproplayer7" }` ile mevcut oturumu sıfırlayıp yeniden bağlanır
- `POST /disconnect` — Aktif yayından ayrılır
- `GET /events?username=fcproplayer7` — `status`, `gift`, `follow` ve `recovery_gap` olaylarını SSE olarak yayınlar

## Gereksinimler ve Ortam Değişkenleri

- **Node.js `>=20.0.0`** (`tiktok-live-connector@2.5.0` için zorunludur)
- `TIKTOK_USERNAME=fcproplayer7` (varsayılan yayıncı kullanıcı adı)
- `SIMULATION_ENABLED=false` (varsayılan olarak kapalıdır)
- `SIGN_API_KEY=...` *(İsteğe bağlı)* — EulerStream WebCast imza servisi anahtarı (`SignConfig`)
- `SIGN_SERVER_URL=...` *(İsteğe bağlı)* — Kendi kendini barındıran harici imzalama servisi URL'i (`RouteConfig.fetchSignedWebSocketFromProvider`)

> **Not:** TikTok LIVE şifre, çerez veya özel hesap kimliği istenmez ve saklanmaz. EulerStream Business/Enterprise planı gerektiren kısıtlamalarda relay sunucusu bunu sahte başarı olarak maskelemez; açık hata mesajı döndürür.

## Yerel Çalıştırma

```bash
cd relay-server
npm install
npm start
```

## Render Üzerinde Ücretsiz Yayınlama

1. `relay-server/` klasörünü (içindeki `package.json`, `server.mjs`, `.gitignore`, `README.md` dosyalarıyla; `node_modules/` hariç) GitHub deponuza aktarın.
2. Render'da **New > Web Service** oluşturup GitHub deponuzu seçin.
3. **Root Directory:** `relay-server`
4. **Runtime:** `Node` (Node 20+)
5. **Build Command:** `npm install`
6. **Start Command:** `npm start`
7. Ortam değişkenleri: `TIKTOK_USERNAME=fcproplayer7`, `SIMULATION_ENABLED=false`, varsa `SIGN_API_KEY`
8. Health Check Path: `/health`
9. Oluşan `https://...onrender.com` adresini NUR-I DUA uygulamasındaki **TikTok Connection > External Node.js Relay Base URL** alanına girip **Relay Sağlık Testi** ve `@fcproplayer7` ile bağlanın.
