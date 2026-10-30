# Signivo — App Panel v2 entegrasyon rehberi

| Alan | Değer |
|------|--------|
| Uygulama adı | Signivo |
| `panel_slug` | `signivo` |
| Bundle | `com.flywork.signivo` |
| Flutter | `esign_pro` |
| Backend | `signivo_api` |
| Sözleşme | `2` |
| Prefix | `/panel` |
| Auth | `X-Panel-Api-Key` / `X-Panel-Key` / `Authorization: Bearer` |

## Base URL

| Ortam | `api_base_url` |
|-------|----------------|
| Yerel | `http://localhost:3043/panel` |
| Üretim | `https://signivov2.fly-work.com/panel` |

## Backend env (`signivo_api`)

```env
PANEL_API_ENABLED=true
PANEL_API_KEY=<secret>
# veya SIGNIVO_PANEL_API_KEY / ADMIN_API_KEY fallback
PANEL_TIMEZONE=Europe/Istanbul
PANEL_DAILY_DAYS=14
```

## App Panel env

```env
SIGNIVO_PANEL_API_KEY=<backend PANEL_API_KEY ile aynı>
SIGNIVO_REVENUECAT_API_KEY=
SIGNIVO_REVENUECAT_PROJECT_ID=
```

## Endpointler

| Path | Açıklama |
|------|----------|
| `GET /panel/health` | Sağlık |
| `GET /panel/analyse` | Özet + günlük metrikler |
| `GET/PATCH /panel/users` | Kullanıcılar |
| `GET /panel/documents` | Belgeler |
| `DELETE /panel/documents/:id` | Belge sil |

Panel UI: `/apps/:id/signivo`
