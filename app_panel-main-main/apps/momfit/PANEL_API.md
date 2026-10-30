# MomFit — App Panel v2 entegrasyon rehberi

| Alan | Değer |
|------|--------|
| Uygulama adı | MomFit |
| `panel_slug` | `momfit` |
| Bundle | `com.flywork.momfit` |
| Sözleşme | `2` |
| Prefix | `/panel` |
| Auth | `X-Panel-Api-Key` / `X-Panel-Key` / `Authorization: Bearer` |

## Base URL

| Ortam | `api_base_url` |
|-------|----------------|
| Yerel | `http://localhost:3050/panel` |
| Üretim | `https://momfit.fly-work.com/panel` |

## Backend env

```env
PANEL_API_ENABLED=true
PANEL_API_KEY=<secret>
PANEL_TIMEZONE=Europe/Istanbul
PANEL_DAILY_DAYS=14
```

## App Panel env

```env
MOMFIT_PANEL_API_KEY=<backend PANEL_API_KEY ile aynı>
MOMFIT_REVENUECAT_API_KEY=
MOMFIT_REVENUECAT_PROJECT_ID=
```

## Endpointler

| Path | Açıklama |
|------|----------|
| `GET /panel/health` | Sağlık |
| `GET /panel/analyse` | Özet + günlük metrikler |
| `GET/PATCH /panel/users` | Kullanıcılar |
| `GET/POST/PATCH/DELETE /panel/workouts` | Egzersiz kataloğu |
| `GET/PATCH/DELETE /panel/templates` | Egzersiz kategorileri |
| `GET /panel/user-workouts` | Kullanıcı oturumları |

Panel UI: `/apps/:id/momfit`
