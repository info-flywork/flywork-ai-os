# MindCoach — Panel entegrasyonu

| Dosya | İçerik |
|-------|--------|
| [APP_PANEL_INTEGRATION.md](./APP_PANEL_INTEGRATION.md) | Base URL, endpoint’ler, mapping, curl |
| [EXTERNAL_API_CONTRACT.md](./EXTERNAL_API_CONTRACT.md) | JSON sözleşmesi v2 |
| [PANEL_ENTEGRASYON.md](./PANEL_ENTEGRASYON.md) | Türkçe özet + AI prompt |

## App Panel ayarları

1. **API URL (taban):** `https://mindcoach.fly-work.com/panel`  
   (Yerel: `http://localhost:3010/panel`)

2. **Panel ekranı:** `mindcoach`

3. **API anahtarı:** MindCoach `PANEL_API_KEY` ile aynı  
   - Uygulama düzenlemede **Panel API Key**, veya  
   - `.env` → `MINDCOACH_PANEL_API_KEY=...`

4. Panel çağırır: `/health`, `/analyse`, `/users`, `/agents`, `/agents/options`  
   Header: `X-Panel-Api-Key` ve `Authorization: Bearer`

## Seed

```bash
npm run seed:apps
```

`com.company.mindcoach` kaydı `panel_slug=mindcoach` ve üretim base URL ile güncellenir.
