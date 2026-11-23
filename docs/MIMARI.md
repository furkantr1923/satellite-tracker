# Teknik Mimari

## Teknoloji kararları

| İhtiyaç | Seçim | Gerekçe |
|---|---|---|
| Windows ve Android için ortak kod | **TypeScript + Vite** web çekirdeği | Kodun %95'i iki platformda ortaktır. 3D için en olgun ekosistem budur |
| 3D Dünya | **Three.js** + özel GLSL gölgelendiriciler | 16.000+ uydu **tek çizim çağrısıyla** (Points + shader) çizilir. Gece-gündüz sınırı GPU'da hesaplanır |
| Yörünge hesabı | **satellite.js** (SGP4/SDP4) | CelesTrak'ın SGP4 eğitiminde resmî USSF çıktısıyla karşılaştırılarak doğrulanmıştır. OMM girdisini destekler |
| Windows paketi | **Tauri 2** (Rust + WebView2) | Electron'a göre çok küçük kurulum dosyası ve düşük bellek kullanımı sağlar. NSIS ile Türkçe kurulum sihirbazı sunar |
| Android paketi | **Capacitor 6** | Aynı web paketini yerel WebView'de çalıştırır. CapacitorHttp ile CORS'tan bağımsız istek yapılabilir |
| Önbellek | IndexedDB (yoksa bellek içi) | Ham CSV ve işlenmiş SATCAT ile grup verisini saklar |
| Derleme | GitHub Actions | Windows ve Android paketleri temiz makinelerde, her etikette yeniden üretilebilir |

## Katmanlar

```
┌──────────────────────────────── UI (src/ui) ───────────────────────────────┐
│  Açılış · Üst çubuk/durum · Sol panel (arama, filtre, sanal liste)           │
│  Bilgi kartı · Hakkında · Mobil alt panel (aynı DOM, CSS ile uyarlanır)      │
└───────────────▲─────────────────────────────▲───────────────────────────────┘
                │ olaylar                       │ durum
┌───────────────┴──────────┐     ┌──────────────┴───────────────┐
│ main.ts (orkestrasyon)    │◄────┤ DataService (src/core)       │◄── HTTP (Tauri/Capacitor/fetch)
│ simTime = donma ?? şimdi  │     │ önbellek → vade → ağ → yedek  │◄── IndexedDB
└───────┬──────────▲────────┘     └──────────────────────────────┘
        │ load/tick │ Float32Array (transfer)
┌───────▼──────────┴────────┐     ┌──────────────────────────────┐
│ Web Worker: SGP4           │     │ GlobeView (src/render)        │
│ satellite.js · TEME → sahne│────►│ Dünya + atmosfer + bulut      │
└───────────────────────────┘     │ Uydu noktaları (tek çizim)    │
                                  │ Seçim, yön oku, yörünge, odak │
                                  └──────────────────────────────┘
```

## Koordinat sistemi

- Sahne, **ataletsel (TEME) çerçevedir**. Birim Dünya yarıçapıdır ve Y ekseni kuzeyi gösterir. Eşleme `(x, y, z)_TEME → (x, z, −y)` şeklindedir; bu, x ekseni etrafında −90°'lik bir dönüştür ve sağ el kuralını korur.
- Dünya küresi `rotation.y = GMST` ile döndürülür. Böylece Dünya gerçek hızında döner ve yörüngeler kapalı elips olarak görünür.
- Three.js küre UV düzeninin ECEF boylamıyla uyumu birim testle doğrulanmıştır.
- Güneş yönü, Astronomical Almanac düşük duyarlıklı formülüyle hesaplanır. Testte gündönümü sapması 23,44° ± 0,1°, ekinoks gününde 12:00 UTC'de güneş altı boylamı 0° ± 5° (zaman denklemi payıyla) çıkar.

## Performans tasarımı

| Teknik | Etki |
|---|---|
| SGP4 hesabı Web Worker'da, sonuçlar `Transferable` dizilerle aktarılır | Ana iş parçacığı ve çizim hiç bloklanmaz, kopyalama maliyeti yoktur |
| Hesap aralığı: Windows 1 sn, Android 2 sn, düşük profil 3 sn | İşlemci ve pil tasarrufu |
| Ara karelerde GPU'da `konum + hız·Δt` | 120 Hz ekranda akıcı hareket; CPU maliyeti yoktur |
| Tüm uydular tek `THREE.Points` çağrısıyla çizilir | 16.000 uydu için 1 çizim çağrısı |
| Sanal liste (yalnızca görünen ~20 satır DOM'da) | Liste uzunluğundan bağımsız akıcı kaydırma |
| Etiketler 220 ms'de bir ve yalnızca yakınlaştırınca güncellenir | DOM maliyeti sınırlıdır |
| FPS < 28 olursa 2 kademede kalite düşer: piksel oranı 1, bulut kapalı; ardından yıldız ve atmosfer kapalı | Zayıf cihazda akıcılık korunur |
| Profiller: masaüstü (AA, 128 segment, bulut) / mobil (AA yok, 72 segment) / düşük | Platforma göre denge |
| Sekme görünmezken hesap durur, rAF zaten durur | Arka planda pil tüketimi olmaz |

## Güvenlik

- Windows'ta ağ erişimi, Rust tarafındaki `fetch_text` komutuyla **iki alan adına** sınırlıdır ve yalnızca HTTPS kullanılır.
- İçerik Güvenlik Politikası (CSP) yalnızca uygulamanın kendi kaynaklarına izin verir.
- Kaynaktan gelen uydu adları DOM'a `textContent` veya kaçışlı HTML ile yazılır (XSS koruması).
- Android'de bildirim izni yoktur, yalnızca INTERNET izni vardır.
