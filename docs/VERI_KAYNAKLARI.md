# Veri Kaynakları, Lisanslar ve Doğruluk Politikası

## 1. Araştırılan kaynaklar

| Kaynak | Ne sağlar | Doğrudan konum? | Kimlik doğrulama | Sınırlar / şartlar | Karar |
|---|---|---|---|---|---|
| **CelesTrak GP** (`celestrak.org/NORAD/elements/gp.php`) | Tüm aktif uydular için yörünge elemanları (OMM: JSON/CSV/XML, eski TLE) | **Hayır.** Konum SGP4 ile hesaplanmalıdır | Yok | Veri yaklaşık 2 saatte bir güncellenir. Kullanım politikası aşırı sorguyu yasaklar ve büyük listelerde (Active, Starlink) sınır uygulamaya başlamıştır. 200 dışı yanıtta yazılımın sorguyu durdurması istenir | **Birincil kaynak** |
| **CelesTrak SATCAT** (`celestrak.org/pub/satcat.csv`) | Sahip/ülke, fırlatma ve düşüş tarihi, apoje/perije | Hayır | Yok | Büyük veri kümesi; seyrek indirilmelidir | **Ülke ve fırlatma bilgisi** |
| **Space-Track.org** (ABD Uzay Kuvvetleri) | GP/OMM, SATCAT (verinin asıl kaynağı) | Hayır | **Ücretsiz hesap zorunlu** | Kullanıcı sözleşmesi üçüncü taraflara yeniden dağıtımı kısıtlar; API hız sınırları vardır | Kullanılmadı: hesap zorunluluğu istenmedi |
| **N2YO API** | Seçilen uydu için konum ve geçiş tahmini | Konum döner, ancak sunucuda TLE'den hesaplanır | Ücretsiz API anahtarı | Saatlik işlem sınırı vardır ve istek uydu başınadır. Binlerce uydu için uygun değildir | Kullanılmadı |
| **wheretheiss.at / Open Notify** | Yalnızca ISS konumu | Tek uydu; sunucuda hesaplanır | Yok | Yalnızca ISS | Kullanılmadı: kapsam yetersiz |
| **AMSAT** (`amsat.org/tle/current/nasabare.txt`) | Amatör uydular için TLE | Hayır | Yok | Küçük liste | **Yedek kaynak** (yalnızca hiç önbellek yokken ve CelesTrak'a ulaşılamadığında) |

> Not: Sınırlar ve şartlar zamanla değişebilir. Yayın öncesinde her kaynağın güncel kullanım sayfası kontrol edilmelidir. CelesTrak kullanım politikası bu proje geliştirilirken (Kasım 2026) incelenmiştir.

## 2. Neden CSV (OMM), neden TLE değil?

CelesTrak'ın duyurusuna göre 5 haneli katalog numaraları 2026 ortasında tükenmiştir. Yeni nesneler 6 haneli numara (100000+) alır ve **bu nesnelerin verisi TLE biçiminde yayınlanamaz**. CelesTrak bu nedenle CSV biçimini önerir; CSV ayrıca TLE'den yaklaşık %10 daha küçüktür. Uygulama GP verisini **CSV (OMM anahtar kelimeleri)** olarak alır ve `satellite.js` kütüphanesinin `json2satrec` fonksiyonuyla doğrudan SGP4'e verir. Testlerde 6 haneli bir katalog numarası da doğrulanır.

## 3. Konum doğruluğu kuralı ve uygulanışı

Ücretsiz hiçbir kaynak binlerce uydu için doğrudan konum yayınlamaz. Kullanıcı onayıyla (*"en basit ve ücretsiz yol"*) şu model seçilmiştir:

1. **Kaynak verisi:** Yörünge elemanları, eleman tarihi (epoch), ad, NORAD numarası, sahip ve fırlatma tarihi. Arayüzde `CELESTRAK` veya `SATCAT` etiketiyle gösterilir.
2. **Hesaplanan veri:** Konum, yükseklik, hız ve yörünge çizgisi. Endüstri standardı SGP4/SDP4 ile hesaplanır ve her yerde `HESAPLANAN` etiketi taşır. Bilgi kartında ayrıca şu açıklama yer alır: *"…kaynağın doğrudan yayınladığı canlı konum değildir."*
3. **Uydurma yasağı:** SATCAT'te sahibi bulunmayan uydu için ülke "Veri mevcut değil" olarak gösterilir. Bilinmeyen sahip kodu tahmin edilmez, "Sahip kodu: XYZ" şeklinde ham hâliyle gösterilir. Grup verisi henüz gelmediyse kategori "Kategori verisi bekleniyor" olarak görünür. Hesaplanamayan uydu (ör. yörüngeden düşmüş) haritada gösterilmez.
4. **Çevrimdışı durum:** Bağlantı kesildiğinde simülasyon zamanı o anda dondurulur, dolayısıyla Dünya'nın dönüşü dahil hiçbir hareket devam etmez. Durum çubuğunda kırmızı "Çevrimdışı" ve dondurma anı gösterilir.
5. **Ara değer:** Kare hızını korumak için iki SGP4 hesabı arasındaki kısa süre (1–3 sn) için aynı SGP4 sonucunun **hız vektörüyle** doğrusal ara değer kullanılır. Bu, modelin kendi türevidir; uydurma bir hareket değildir. Çevrimdışıyken bu ara değer de sıfırlanır.

## 4. Yenileme ve ağ kullanımı

| Veri | İndirme sıklığı | Gerekçe |
|---|---|---|
| Durum kontrolü | 30 sn | İstenen varsayılan aralık. **Ağ isteği atmaz**, yalnızca vade ve bağlantı durumuna bakar |
| GP yörünge elemanları (active) | En fazla 2 saatte bir | CelesTrak verisi yaklaşık 2 saatte bir güncellenir. Daha sık indirmek aynı veriyi tekrar indirmek olur |
| SATCAT | 7 günde bir | Sahip ve fırlatma bilgisi nadiren değişir |
| Kategori grupları (25 küçük liste) | 7 günde bir, istekler arası 1,5 sn | Üyelik nadiren değişir; istekler sunucuyu yormayacak şekilde aralıklı gönderilir |

- **200 dışı yanıt** (403, 404, 5xx) alındığında otomatik sorgu durdurulur ve kullanıcıya gösterilir. Kullanıcı isterse "Tekrar dene" düğmesine basabilir. Bu, CelesTrak politikasının istediği davranıştır. Tek istisna, var olmayan bir kategori grubunun (404) atlanmasıdır.
- **Bağlantı hatasında** geri çekilmeli yeniden deneme yapılır: 30 sn → 1 dk → 2 dk … en fazla 10 dk.
- Windows sürümündeki HTTP köprüsü (Rust) yalnızca `celestrak.org` ve `www.amsat.org` adreslerine istek atabilir.

## 5. Kategori eşlemesi (CelesTrak grupları → uygulama)

Bir uydu birden çok grupta yer alıyorsa öncelik sırası yukarıdan aşağıyadır:

| Kategori | CelesTrak grupları |
|---|---|
| Uzay İstasyonu | stations |
| Meteoroloji | weather |
| Navigasyon | gnss, sbas |
| Yer Gözlemi | resource, planet, spire, dmc, argos |
| Bilimsel | science, geodetic, engineering, education |
| Askerî | military |
| Haberleşme | starlink, oneweb, iridium-NEXT, intelsat, ses, globalstar, orbcomm, tdrss, amateur, x-comm, other-comm |
| Diğer | Yukarıdakilerin hiçbirinde olmayan aktif uydular |

## 6. Yörünge sınıfı kuralı

Kaynağın verdiği ortalama hareket (*n*, tur/gün) ve dışmerkezlik (*e*) değerlerinden:

- **HEO:** e ≥ 0,25
- **GEO:** 0,95 ≤ n ≤ 1,05 ve e < 0,05 (yer eşzamanlı)
- **LEO:** apoje < 2.000 km
- **MEO:** apoje < 35.000 km
- **Diğer:** geri kalanlar

## 7. Lisanslar

| Bileşen | Lisans |
|---|---|
| Uygulama kodu | MIT © 2026 Furkan |
| CelesTrak verisi | Ücretsiz kamu hizmeti; kullanım politikasına uyulur, kaynak gösterilir |
| NASA Visible Earth görselleri | Kamu malı. NASA kaynak gösterilmesini rica eder ("Görüntü: NASA") |
| three.js | MIT |
| satellite.js | MIT |
| Tauri | MIT / Apache-2.0 |
| Capacitor | MIT |
