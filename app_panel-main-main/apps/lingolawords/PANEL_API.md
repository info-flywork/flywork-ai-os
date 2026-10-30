# Lingola Words — App Panel v2 entegrasyon rehberi

| Alan | Değer |
|------|--------|
| Uygulama adı | Lingola Words |
| Teknik ad | lingoladailywords |
| `panel_slug` | `lingolawords` |
| Bundle | `com.flywork.lingoladailywords` |
| Flutter | `lingoladailywords` |
| Backend | `lingola-daily-words-api` |
| Sözleşme | `2` |
| Prefix | `/panel` |
| Auth | `X-Panel-Api-Key` / `X-Panel-Key` / `Authorization: Bearer` / `X-Admin-Api-Key` |

## Base URL

| Ortam | `api_base_url` |
|-------|----------------|
| Üretim | `https://lingoladailywords.fly-work.com/panel` |

## Backend env (`src/.env` — PM2 cwd `src`)

```env
PANEL_API_ENABLED=true
PANEL_API_KEY=<secret veya boş bırakıp ADMIN_API_KEY kullan>
PANEL_TIMEZONE=Europe/Istanbul
PANEL_DAILY_DAYS=14
```

## App Panel env

```env
LINGOLAWORDS_PANEL_API_KEY=<backend PANEL_API_KEY veya ADMIN_API_KEY ile aynı>
LINGOLAWORDS_REVENUECAT_API_KEY=
LINGOLAWORDS_REVENUECAT_PROJECT_ID=
```

## Endpointler

| Path | Açıklama |
|------|----------|
| `GET /panel/health` | Sağlık |
| `GET /panel/analyse` | Özet + günlük metrikler |
| `GET/PATCH /panel/users` | Kullanıcılar |
| `GET/POST/PATCH/DELETE /panel/words` | Kelime kataloğu |

Panel UI: `/apps/:id/lingolawords`
