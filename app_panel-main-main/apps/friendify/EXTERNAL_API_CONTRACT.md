# App Panel — Harici API sözleşmesi (v2)

Friendfy backend bu sözleşmeyi `/panel/v1` prefix'i altında uygular.

## Kimlik doğrulama

Panel sunucusu isteklerde şu header'lardan birini göndermelidir:

| Header | Değer |
|--------|--------|
| `x-panel-api-key` | Sunucudaki `PANEL_API_KEY` ile aynı |
| `x-api-key` | (alternatif) |

Alternatif (önerilmez): query `?panel_key=` veya `?api_key=`

`PANEL_API_KEY` tanımlı değilse tüm panel uçları **503** `PANEL_NOT_CONFIGURED` döner.

Mobil uygulama JWT (`x-auth-token`) bu uçlarda **kullanılmaz**.

---

## Endpoint'ler

Base path: `{ORIGIN}/panel/v1`

| Path | Metot | Açıklama |
|------|-------|----------|
| `/health` | GET | Canlılık |
| `/analyse` | GET | Özet + günlük seri |
| `/users` | GET | Sayfalı kullanıcı listesi |
| `/users/:id` | GET | Tek kullanıcı |
| `/users/:id` | PATCH | Kısmi güncelleme |
| `/users/:id/agents` | GET | Kullanıcının agentları |
| `/agents` | GET | Agent listesi (sayfalı) |
| `/agents` | POST | Agent oluştur |
| `/agents/:id` | GET | Tek agent + sahip |
| `/agents/:id` | PATCH | Agent güncelle |
| `/agents/:id` | DELETE | Agent sil |

Agent detayı: [`PANEL_AGENTS_API.md`](./PANEL_AGENTS_API.md)

---

## GET /health

**200**

```json
{
  "ok": true,
  "service": "friendfy-panel-api",
  "contractVersion": "2"
}
```

---

## GET /analyse

**200**

```json
{
  "contractVersion": "2",
  "generatedAt": "2026-05-15T12:00:00.000Z",
  "timezone": "Europe/Istanbul",
  "summary": {
    "totalUsers": 1200,
    "loginsToday": 45,
    "newUsersToday": 8
  },
  "metricsNotes": {
    "loginsToday": "...",
    "newUsersToday": "..."
  },
  "daily": [
    { "date": "2026-05-14", "logins": 40, "newUsers": 5 }
  ]
}
```

| Alan | Tip | Açıklama |
|------|-----|----------|
| `summary.totalUsers` | number | `users` tablosu kayıt sayısı |
| `summary.loginsToday` | number | Bugün sohbet aktivitesi olan benzersiz `userId` |
| `summary.newUsersToday` | number | `accountCreatedDate` bugün olan kayıtlar |
| `daily[].date` | string | `YYYY-MM-DD` |
| `daily[].logins` | number | Gün bazlı aktivite (sohbet) |
| `daily[].newUsers` | number | Gün bazlı yeni kayıt |
| `agentsSummary` | object | Agent özet metrikleri (bkz. PANEL_AGENTS_API.md) |

Varsayılan son **30** gün (`PANEL_ANALYTICS_DAYS`, min 7 max 90).

---

## GET /users

Query: `page` (varsayılan 1), `limit` (varsayılan 20, max 100), `search` (opsiyonel: email, username, phone).

**200**

```json
{
  "contractVersion": "2",
  "users": [ { "id": "42", "email": "...", "displayName": "...", "phone": null, "status": "active", "createdAt": "...", "lastLoginAt": null, "extras": {} } ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 1200,
    "totalPages": 60
  }
}
```

---

## GET /users/:id

**200** — `{ "contractVersion": "2", "user": PanelUser }`  
**404** — kullanıcı yok

---

## PATCH /users/:id

Kısmi gövde. Desteklenen üst seviye alanlar:

| Panel alanı | Friendfy DB |
|-------------|-------------|
| `displayName` | `username` |
| `email` | `email` |
| `phone` | `phoneNumber` |
| `status` | `verificated` (active→1, inactive→0, banned→2) |
| `extras.gender` | `gender` |
| `extras.country` | `country` |
| `extras.photoURL` | `photoURL` |
| `extras.hobbies` | `hobbies` (string veya JSON string) |

`extras.membershipsSummary`, `extras.credential`, `extras.isGuest` **salt okunur** (PATCH ile yazılmaz).

**200** — `{ "contractVersion": "2", "ok": true, "user": PanelUser }`  
**409** — `EMAIL_IN_USE`

---

## PanelUser

```json
{
  "id": "42",
  "email": "user@example.com",
  "displayName": "Ayşe",
  "phone": "+90555...",
  "status": "active",
  "createdAt": "2025-01-01T00:00:00.000Z",
  "lastLoginAt": null,
  "extras": {
    "credential": "google",
    "verificated": 1,
    "gender": "female",
    "country": "TR",
    "birthdate": "1990-01-01T00:00:00.000Z",
    "photoURL": "https://...",
    "hobbies": null,
    "isGuest": false,
    "membershipsSummary": { "count": 1, "activeCount": 1, "types": ["freeTrial"] }
  }
}
```

`status`: `active` | `inactive` | `banned`  
`id`: string (DB `users.id`).

---

## Hata kodları (panel)

| HTTP | code | Anlam |
|------|------|--------|
| 401 | PANEL_UNAUTHORIZED | API anahtarı hatalı |
| 503 | PANEL_NOT_CONFIGURED | `PANEL_API_KEY` yok |
| 409 | EMAIL_IN_USE | PATCH email çakışması |

---

## Kısıtlar

- HTTPS (prod)
- Yanıt boyutu hedefi &lt; 64 KB (liste `limit` ile)
- Timeout ~8 sn (panel tarafı)
