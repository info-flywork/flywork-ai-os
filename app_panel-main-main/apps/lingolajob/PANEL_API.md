# Lingola Job — App Panel entegrasyon rehberi

| Alan | Değer |
|------|--------|
| Uygulama adı | Lingola Job |
| `panel_slug` | `lingolajob` |
| Bundle | `com.flywork.lingolajobapp` |
| Flutter | `lingola_job` |
| Backend | `lingola-job-backend` |
| Sözleşme | `1` |
| Prefix | `/panel/v1` |
| Auth | `X-Panel-Api-Key` / `X-Panel-Key` / `Authorization: Bearer` |

## Base URL

| Ortam | `api_base_url` |
|-------|----------------|
| Üretim | `https://lingolajob.fly-work.com/panel/v1` |

## Backend env (`src/.env` — PM2 cwd `src`)

```env
LINGOLAJOB_PANEL_API_KEY=<secret>
# veya PANEL_API_KEY / ADMIN_API_KEY
PORT=3022
```

## App Panel env

```env
LINGOLAJOB_PANEL_API_KEY=<backend ile aynı>
LINGOLAJOB_REVENUECAT_API_KEY=
LINGOLAJOB_REVENUECAT_PROJECT_ID=
```

## Endpointler

| Path | Açıklama |
|------|----------|
| `GET /panel/v1/health` | Sağlık |
| `GET /panel/v1/analyse` | Özet + günlük metrikler |
| `GET /panel/v1/options` | Dil/track/seviye seçenekleri |
| `GET/PATCH /panel/v1/users` | Kullanıcılar |
| `GET/POST/PATCH /panel/v1/languages` | Diller |
| `GET/POST/PATCH/DELETE /panel/v1/tracks` | Trackler |
| `GET/POST/PATCH/DELETE /panel/v1/words` | Kelimeler |
| `GET /panel/v1/notifications` | Bildirimler |

Panel UI: `/apps/:id/lingolajob`
