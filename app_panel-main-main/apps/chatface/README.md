# ChatFace — Panel entegrasyonu

| Dosya | İçerik |
|-------|--------|
| [PANEL_API.md](./PANEL_API.md) | Tam API dökümanı (health, analyse, users, purchases) |
| [PANEL_INTEGRATION.md](./PANEL_INTEGRATION.md) | Kısa yönlendirme |

## App Panel ayarları

1. **API URL (taban):** `https://chatface.fly-work.com/panel`  
   (Yerel: `http://localhost:3000/panel`)

2. **Panel ekranı:** `chatface`

3. **API anahtarı:** ChatFace `PANEL_API_KEY` ile aynı  
   - Uygulama düzenlemede **Panel API Key**, veya  
   - `.env` → `CHATFACE_PANEL_API_KEY=...`

4. Header: `X-Panel-Key` (panel proxy üzerinden)

5. Panel çağırır: `/health`, `/analyse`, `/users`, `/purchases`

## Seed

```bash
npm run seed:apps
```

`com.company.chatface` kaydı `panel_slug=chatface` ile güncellenir.
