# Friendify — Panel entegrasyonu

Friendify backend ekibinin hazırladığı dokümantasyon bu klasördedir.

| Dosya | İçerik |
|-------|--------|
| [PANEL_INTEGRATION_FRIENDIFY.md](./PANEL_INTEGRATION_FRIENDIFY.md) | Base URL, güvenlik, mapping, curl, deploy |
| [EXTERNAL_API_CONTRACT.md](./EXTERNAL_API_CONTRACT.md) | JSON sözleşmesi, hata kodları |
| [PANEL_AGENTS_API.md](./PANEL_AGENTS_API.md) | Agent listeleme, oluşturma, düzenleme, silme |

## App Panel ayarları

1. **API URL (taban):** `https://friendfy.fly-work.com/panel/v1`  
   (Mobil kök `https://friendfy.fly-work.com` değil — `/panel/v1` zorunlu.)

2. **Panel ekranı:** `friendify`

3. **API anahtarı:** Friendify sunucusundaki `PANEL_API_KEY` ile aynı değer  
   - Uygulama düzenlemede **Panel API Key** alanına yazın, veya  
   - Panel `.env` içinde `FRIENDIFY_PANEL_API_KEY=...` (Friendify slug için yedek)

4. Panel otomatik çağırır: `/health`, `/analyse`, `/users`, `/agents` (+ CRUD)  
   Header: `x-panel-api-key`

## Metrik notu

`loginsToday` ve `daily.logins` Friendify’da **günlük sohbet aktivitesi** (benzersiz kullanıcı) anlamına gelir; gerçek login event tablosu yoktur.
