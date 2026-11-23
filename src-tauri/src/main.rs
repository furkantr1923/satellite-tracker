// SATELLITE TRACKER — Windows masaüstü kabuğu (Tauri 2).
// Arayüz WebView2 içinde çalışır; ağ istekleri bu dosyadaki `fetch_text` komutuyla,
// yalnızca izin verilen veri kaynaklarına yapılır (CORS'tan bağımsız, güvenli).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::time::Duration;

/// Uygulamanın erişebileceği tek alan adları. Başka adreslere istek reddedilir.
const ALLOWED_HOSTS: [&str; 2] = ["celestrak.org", "www.amsat.org"];

#[derive(serde::Serialize)]
struct FetchResult {
    status: u16,
    body: String,
}

#[tauri::command]
async fn fetch_text(url: String) -> Result<FetchResult, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|e| format!("geçersiz adres: {e}"))?;
    let host = parsed.host_str().unwrap_or_default();
    if parsed.scheme() != "https" || !ALLOWED_HOSTS.contains(&host) {
        return Err(format!("izin verilmeyen adres: {host}"));
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .user_agent(concat!("SatelliteTracker/", env!("CARGO_PKG_VERSION"), " (Windows; Furkan)"))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(parsed).send().await.map_err(|e| format!("network: {e}"))?;
    let status = resp.status().as_u16();
    let body = resp.text().await.map_err(|e| format!("network: {e}"))?;
    Ok(FetchResult { status, body })
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![fetch_text])
        .run(tauri::generate_context!())
        .expect("SATELLITE TRACKER başlatılamadı");
}
