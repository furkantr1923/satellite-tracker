# Test Raporu: SATELLITE TRACKER v1.0.0

**Tarih:** 23.11.2026

Bu rapor, prompttaki **"Test edemediğin hiçbir özelliği test edilmiş gibi raporlama"** kuralına göre üç bölüme ayrılmıştır:

- ✅ **Geliştirme ortamında çalıştırıldı ve geçti**
- 🤖 **CI'da otomatik çalışacak** (GitHub Actions; depo yüklenince ilk kez çalışır)
- 📱 **Gerçek cihazda elle doğrulanmalı** (geliştirme ortamında Windows, Android ve GPU bulunmadığı için)

## 0. Geliştirme ortamının kısıtları (açıkça)

| Kısıt | Sonuç |
|---|---|
| İnternet erişimi yoktu (npm paketleri kurulamadı) | `three` ve `satellite.js` yerelde yoktu. Yerel testler yalnızca test amaçlı yer tutucu modüllerle yapıldı (aşağıda ayrıntılı) |
| Windows, Rust paketleri, Android SDK yoktu | **Setup.exe, Portable EXE ve APK bu ortamda derlenmedi.** Derleme GitHub Actions'ta yapılır |
| GPU / WebGL yoktu | 3D görüntü bu ortamda çizilip görülemedi. Uygulamanın WebGL'siz yedek yolu test edildi; WebGL testi CI'da yapılır |

## 1. ✅ Bu ortamda çalıştırılan testler

### 1.1 TypeScript tip denetimi: GEÇTİ
`tsc --noEmit` hatasız tamamlandı (strict, noUnusedLocals, verbatimModuleSyntax).
Not: `three` ve `satellite.js` tipleri yerelde yer tutucuydu. Gerçek tiplerle denetim CI'da `npm run typecheck` adımında yapılır.

### 1.2 Birim testleri: 19/19 GEÇTİ (`node --test`)
| # | Test | Sonuç |
|---|---|---|
| 1 | CSV: tırnaklı alan, virgül, CRLF, boş alanlar | ✅ |
| 2 | OMM EPOCH: mikrosaniye ve `Z` biçimleri | ✅ |
| 3 | GP CSV: geçerli kayıtlar alınır, bozuk kayıt reddedilir, **6 haneli NORAD** desteklenir | ✅ |
| 4 | GP CSV: beklenmeyen biçimde açık hata verir | ✅ |
| 5 | TLE: sağlama toplamı, Alpha-5, Vallado 00005 örneği | ✅ |
| 6 | SATCAT: yörüngeden düşmüş nesneler atlanır | ✅ |
| 7 | Yörünge sınıfı LEO/MEO/GEO/HEO; GEO irtifası 35.786 ± 20 km | ✅ |
| 8 | GMST: J2000'de 280,46061837° (1e-6 duyarlıkla) | ✅ |
| 9 | Güneş: gündönümü sapması 23,44°; öğlen/gece yarısı güneş altı boylamı | ✅ |
| 10 | Koordinat eşlemesi: Three.js küre UV ↔ ECEF boylam/kutup | ✅ |
| 11 | Katalog: tekilleştirme, kategori önceliği, **SATCAT yoksa ülke uydurulmaz**, filtreler | ✅ |
| 12 | Türkçe arama katlaması (İ/ı), ülke kodu, zaman ifadeleri | ✅ |
| 13 | DataService: ilk açılışta GP + SATCAT + gruplar, durum "live" | ✅ |
| 14 | **API sınırı:** vadesi gelmeyen veri tekrar indirilmez (30 dk → 0 istek; 2 sa → yalnızca GP) | ✅ |
| 15 | Önbellekten açılış: ağ isteği atılmadan veri gösterilir | ✅ |
| 16 | **Bağlantı kesintisi:** konumlar dondurulur, geri çekilmeli yeniden deneme yapılır, bağlantı gelince çözülür | ✅ |
| 17 | Cihaz çevrimdışı açılırsa son çevrimiçi anda dondurulur | ✅ |
| 18 | **HTTP 403:** otomatik sorgu durur, yalnızca "Tekrar dene" ile sürer | ✅ |
| 19 | Önbellek yokken birincil kaynak yoksa yedek (AMSAT) kullanılır ve açıkça belirtilir | ✅ |
| 20–22 | SGP4 doğruluğu (gerçek satellite.js) | ⏭ atlandı: kütüphane yerelde yok → 🤖 CI'da çalışır |

### 1.3 Uçtan uca duman testi (Chromium, WebGL'siz yedek yol): 13/13 GEÇTİ
Arayüz ve veri akışı gerçek Chrome tarayıcısında test edildi. Bu ortamda olmayan iki kütüphanenin yerine **yalnızca test için** yer tutucular kullanıldı: three.js yerine WebGL hatası fırlatan bir modül (yedek yolu sınamak için), satellite.js yerine iki cisim Kepler yaklaşımı. Bu yer tutucular depoda yer almaz ve uygulamaya girmez. Ağ istekleri sentetik CSV ile yanıtlandı; CelesTrak'a test yükü bindirilmedi.

| Adım | Sonuç |
|---|---|
| Uygulama açılıyor, açılış ekranı kapanıyor | ✅ |
| WebGL yokken uygulama çökmeden yedek mesaj gösteriyor | ✅ |
| 400 uydu yüklendi, konumlar işçide hesaplandı | ✅ |
| Kategori (grup) verisi uygulandı | ✅ |
| Arama: ada göre | ✅ |
| Arama: ülkeye göre ("türkiye" → 67 sonuç) | ✅ |
| Filtre: yörünge sınıfı + sıfırlama | ✅ |
| Seçim: doğru uydu açılıyor, bilgi kartında "hesaplanan" etiketi ve SATCAT ülkesi görünüyor | ✅ |
| Takip modu açılıp kapanıyor | ✅ |
| **Çevrimdışı:** durum "Çevrimdışı", "Konum anı (donduruldu)" gösteriliyor; bağlantı gelince düzeliyor | ✅ |
| Hakkında penceresi + "Furkan tarafından geliştirildi" ifadesi | ✅ |
| Konsolda beklenmeyen hata yok | ✅ |
| Mobil (390×844, dokunmatik): alt panel, liste, alttan açılan bilgi kartı | ✅ |

Ekran görüntüleri: `e2e/artifacts/` (desktop.png, desktop-offline.png, mobile*.png)

### 1.4 Diğer doğrulamalar
| Kontrol | Sonuç |
|---|---|
| Android son ayar betiği, sahte proje üzerinde çalıştırıldı (ikon kopyalama, açılış PNG'si üretimi) | ✅ PNG'ler geçerli; boyut korunuyor, renk #02060F |
| İkon üretimi (Windows .ico çok boyutlu, Android mipmap'leri) | ✅ |
| `tauri.conf.json` ve `package.json` JSON geçerliliği | ✅ |

## 2. 🤖 CI'da otomatik çalışacak testler (`.github/workflows/build.yml`)

| İş | İçerik |
|---|---|
| `test` | Gerçek tiplerle `typecheck`, 22 birim testi (**Vallado SGP4 test vektörü**, OMM → SGP4, 6 haneli NORAD, GEO/HEO derin uzay yayılımı), NASA dokularının indirilmesi, web paketi |
| `e2e` | Aynı duman testi; bu kez **gerçek three.js + satellite.js ve WebGL (SwiftShader)** ile ve WebGL zorunlu. Ekran görüntüleri artefakt olarak yüklenir |
| `windows` | Tauri derlemesi → `Setup.exe` + `Portable.exe` |
| `android` | Capacitor → `APK` (secret varsa imzalı release, yoksa debug imzalı) |
| `release` | `v*` etiketinde tüm dosyalar GitHub Release'e eklenir |

> Bu iş akışı henüz hiç çalıştırılmadı. İlk çalıştırmanın sonucu Actions sekmesinde görülecek. Hata çıkarsa düzeltilip yeniden çalıştırılmalıdır.

## 3. 📱 Gerçek cihazda elle doğrulanması gerekenler

| Platform | Kontrol | Durum |
|---|---|---|
| Windows 10/11 | Setup.exe kuruluyor mu, portable açılıyor mu | 📱 Bekliyor |
| Windows | 3D Dünya, dokular, gece-gündüz sınırı görsel olarak doğru mu | 📱 Bekliyor |
| Windows | GTX 1650 + 120 Hz ekranda FPS ve bellek kullanımı (Görev Yöneticisi) | 📱 Bekliyor |
| Windows | Gerçek CelesTrak bağlantısı (Rust HTTP köprüsü) | 📱 Bekliyor |
| Android | APK kuruluyor mu, açılıyor mu, dikey/yatay yerleşim | 📱 Bekliyor |
| Android | Dokunmatik döndürme, kıstırarak yakınlaştırma, uyduya dokunma | 📱 Bekliyor |
| Android | Uçak modu → "Çevrimdışı" ve dondurma; geri açınca yenileme | 📱 Bekliyor |
| Her ikisi | Gerçek veride bir uydunun konumunu bağımsız bir kaynakla (ör. CelesTrak Orbit Visualization) karşılaştırma | 📱 Bekliyor |

**Önerilen hızlı kontrol listesi (5 dk):** Uygulamayı açın → "ISS" arayın → seçin → yükseklik yaklaşık 400–420 km, hız yaklaşık 7,66 km/sn olmalı → *Takip et* → uçak modunu açın: durum kırmızıya dönmeli ve hareket durmalı → uçak modunu kapatın: durum yeşile dönmeli.

## 4. Bilinen sınırlamalar

- Konumlar kaynaktan doğrudan alınmaz, SGP4 ile hesaplanır (bkz. VERI_KAYNAKLARI.md). SGP4'ün tipik hatası eleman tarihinde ~1 km'dir ve günde birkaç km artar.
- Hiçbir CelesTrak grubunda yer almayan uydular "Diğer" kategorisinde görünür.
- Windows paketi kod imzalama sertifikası olmadan yayımlanır; SmartScreen uyarısı görülebilir.
- Android'de 16.000 noktalı çizim için güncel bir Android System WebView gerekir. Çok eski cihazlarda "Düşük" profil otomatik olarak seçilir.
