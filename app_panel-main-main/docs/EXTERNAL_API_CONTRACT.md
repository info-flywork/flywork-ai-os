# Harici API sözleşmesi (v2) — App Panel

Uygulama backend’leri bu kanonik JSON şemasını **`/panel`** (veya dokümanda belirtilen prefix, örn. `/panel/v1`) altında uygular. Mobil rotalar değiştirilmez.

**Sürüm:** `contractVersion: "2"`

---

## Kimlik doğrulama

Panel sunucusu isteklerde **bir** yöntem kullanır (uygulama dokümanında hangisi geçerliyse):

| Yöntem | Örnek |
|--------|--------|
| `X-Panel-Key` | `X-Panel-Key: <secret>` |
| `X-Panel-Api-Key` | `X-Panel-Api-Key: <secret>` |
| `Authorization` | `Authorization: Bearer <secret>` |

Mobil JWT panel uçlarında kullanılmaz.

---

## Ortak yanıt kuralları

| Kural | Değer |
|-------|--------|
| Format | JSON (`Content-Type: application/json`) |
| Hedef boyut | &lt; 64 KB (liste endpoint’leri sayfalı) |
| Panel timeout | ~8 sn |
| Sayfalama | `page` (≥1), `limit` (varsayılan 20, max 100) |

### Hata gövdesi (önerilen)

```json
{
  "error": "NOT_FOUND",
  "message": "İnsan okunur açıklama"
}
```

| HTTP | Anlam |
|------|--------|
| 400 | Geçersiz parametre / gövde |
| 403 | Geçersiz API anahtarı veya IP |
| 404 | Kayıt yok veya panel kapalı |
| 503 | Panel yapılandırılmamış |

---

## Health

`GET /panel/health` → **200**

```json
{
  "ok": true,
  "service": "my-app-api",
  "contractVersion": "2"
}
```

---

## Analyse (genel metrikler)

`GET /panel/analyse` → **200**

```json
{
  "contractVersion": "2",
  "generatedAt": "2026-05-18T10:00:00.000Z",
  "timezone": "Europe/Istanbul",
  "summary": {
    "totalUsers": 0,
    "loginsToday": 0,
    "newUsersToday": 0
  },
  "daily": [
    { "date": "2026-05-17", "logins": 0, "newUsers": 0 }
  ]
}
```

### Analyse — antrenman uzantısı (fitness uygulamaları)

`summary` ve `daily` içine **opsiyonel** antrenman alanları eklenebilir:

```json
{
  "summary": {
    "totalUsers": 1000,
    "loginsToday": 120,
    "newUsersToday": 15,
    "totalWorkouts": 48,
    "publishedWorkouts": 40,
    "workoutsCompletedToday": 230,
    "activeWorkoutUsersToday": 85
  },
  "daily": [
    {
      "date": "2026-05-18",
      "logins": 120,
      "newUsers": 15,
      "workoutsCompleted": 230,
      "workoutMinutes": 12400
    }
  ],
  "workoutsSummary": {
    "topWorkoutsByCompletions": [
      { "workoutId": "w1", "title": "Sabah HIIT", "completions": 42 }
    ]
  }
}
```

| Alan | Tip | Açıklama |
|------|-----|----------|
| `summary.totalWorkouts` | number | Katalogdaki tüm antrenman kayıtları |
| `summary.publishedWorkouts` | number | Yayında / aktif antrenman sayısı |
| `summary.workoutsCompletedToday` | number | Bugün tamamlanan oturum sayısı |
| `summary.activeWorkoutUsersToday` | number | Bugün en az bir antrenman bitiren benzersiz kullanıcı |
| `daily[].workoutsCompleted` | number | Gün bazlı tamamlanan oturum |
| `daily[].workoutMinutes` | number | Gün bazlı toplam süre (dakika) |
| `workoutsSummary` | object | Uygulamaya özel özet (isteğe bağlı) |

---

## Users

### Liste

`GET /panel/users?page=1&limit=20&search=` → **200**

```json
{
  "contractVersion": "2",
  "data": [],
  "pagination": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 }
}
```

> **Not:** Bazı uygulamalar kökte `users` dizisi kullanır (`{ "users": [], "pagination": {} }`). Panel her iki biçimi de okuyabilir; yeni entegrasyonlarda yukarıdaki `data` + `pagination` tercih edilir.

### PanelUser

| Alan | Tip | Zorunlu |
|------|-----|---------|
| `id` | string | evet |
| `email` | string \| null | hayır |
| `displayName` | string \| null | hayır |
| `phone` | string \| null | hayır |
| `status` | `active` \| `inactive` \| `banned` \| null | hayır |
| `createdAt` | ISO-8601 \| null | hayır |
| `lastLoginAt` | ISO-8601 \| null | hayır |
| `extras` | object | hayır |

### Tek kayıt

`GET /panel/users/:id` → **200** `{ "contractVersion": "2", "data": PanelUser }` | **404**

### Güncelleme

`PATCH /panel/users/:id` — kısmi gövde; `extras` shallow merge.

---

## Workouts (antrenman kataloğu — admin)

Katalog antrenmanları panelden **listeleme, oluşturma, düzenleme, silme** (soft delete önerilir).

| Path | Metot | Açıklama |
|------|-------|----------|
| `/panel/workouts` | GET | Sayfalı katalog listesi |
| `/panel/workouts` | POST | Yeni antrenman (admin) |
| `/panel/workouts/:id` | GET | Tek antrenman |
| `/panel/workouts/:id` | PATCH | Güncelle |
| `/panel/workouts/:id` | DELETE | Sil veya arşivle |

Query (GET): `page`, `limit`, `search`, `status` (`draft` \| `published` \| `archived`), `category`, `difficulty`.

### PanelWorkout

```json
{
  "id": "w_12",
  "title": "Sabah HIIT",
  "description": "20 dakika",
  "status": "published",
  "difficulty": "intermediate",
  "durationMinutes": 20,
  "category": "cardio",
  "coverImageUrl": "https://cdn.example.com/w12.jpg",
  "createdAt": "2026-01-10T08:00:00.000Z",
  "updatedAt": "2026-05-01T12:00:00.000Z",
  "publishedAt": "2026-01-15T09:00:00.000Z",
  "extras": {
    "equipment": ["mat"],
    "caloriesEstimate": 180,
    "locale": "tr"
  }
}
```

| Alan | Tip | Zorunlu | Not |
|------|-----|---------|-----|
| `id` | string | evet | |
| `title` | string | evet | POST’ta zorunlu |
| `description` | string \| null | hayır | |
| `status` | string | hayır | `draft`, `published`, `archived` |
| `difficulty` | string \| null | hayır | örn. `beginner`, `intermediate`, `advanced` |
| `durationMinutes` | number \| null | hayır | |
| `category` | string \| null | hayır | |
| `coverImageUrl` | string \| null | hayır | |
| `createdAt` | ISO-8601 | hayır | |
| `updatedAt` | ISO-8601 | hayır | |
| `publishedAt` | ISO-8601 \| null | hayır | |
| `extras` | object | hayır | egzersiz listesi, video URL, hedef kas grubu vb. |

**POST / PATCH** gövdesi: aynı alan adları (id POST’ta sunucu üretir).

---

## User workouts (kullanıcı antrenman geçmişi)

Kullanıcının başlattığı / tamamladığı oturumlar; panelde kullanıcı detayında ve analizde kullanılır.

| Path | Metot | Açıklama |
|------|-------|----------|
| `/panel/user-workouts` | GET | Tüm oturumlar (filtreli, sayfalı) |
| `/panel/users/:userId/workouts` | GET | Tek kullanıcının oturumları |
| `/panel/user-workouts/:id` | GET | Tek oturum detayı |
| `/panel/user-workouts/:id` | PATCH | Opsiyonel: admin düzeltme (durum, not) |

Query: `page`, `limit`, `userId`, `workoutId`, `status` (`started` \| `completed` \| `abandoned`), `from`, `to` (ISO tarih veya `YYYY-MM-DD`).

### PanelUserWorkout

```json
{
  "id": "uw_99",
  "userId": "42",
  "workoutId": "w_12",
  "workoutTitle": "Sabah HIIT",
  "status": "completed",
  "startedAt": "2026-05-18T07:00:00.000Z",
  "completedAt": "2026-05-18T07:22:00.000Z",
  "durationMinutes": 22,
  "caloriesBurned": 165,
  "progressPercent": 100,
  "extras": {
    "device": "ios",
    "appVersion": "2.1.0"
  }
}
```

| Alan | Tip | Zorunlu |
|------|-----|---------|
| `id` | string | evet |
| `userId` | string | evet |
| `workoutId` | string | evet |
| `workoutTitle` | string \| null | hayır (denormalize, liste için) |
| `status` | string | evet |
| `startedAt` | ISO-8601 \| null | hayır |
| `completedAt` | ISO-8601 \| null | hayır |
| `durationMinutes` | number \| null | hayır |
| `caloriesBurned` | number \| null | hayır |
| `progressPercent` | number \| null | hayır |
| `extras` | object | hayır |

---

## Purchases (üyelik / satın alım — backend)

Uygulama kendi satın alım tablosunu panelde göstermek istiyorsa:

| Path | Metot | Açıklama |
|------|-------|----------|
| `/panel/purchases` | GET | Sayfalı liste |
| `/panel/purchases/:id` | GET | Tek kayıt |

Query: `page`, `limit`, `userId`, `status`, `productId`, `from`, `to`.

### PanelPurchase

```json
{
  "id": "p_1",
  "userId": "42",
  "productId": "premium_monthly",
  "productName": "Premium Aylık",
  "status": "active",
  "store": "app_store",
  "purchasedAt": "2026-03-01T10:00:00.000Z",
  "expiresAt": "2026-04-01T10:00:00.000Z",
  "amount": 9.99,
  "currency": "USD",
  "extras": {
    "transactionId": "..."
  }
}
```

| Alan | Tip | Zorunlu |
|------|-----|---------|
| `id` | string | evet |
| `userId` | string | evet |
| `productId` | string | hayır |
| `productName` | string \| null | hayır |
| `status` | string | hayır | örn. `active`, `expired`, `refunded`, `cancelled` |
| `store` | string \| null | hayır | `app_store`, `play_store`, `stripe`, … |
| `purchasedAt` | ISO-8601 | hayır |
| `expiresAt` | ISO-8601 \| null | hayır |
| `amount` | number \| null | hayır |
| `currency` | string \| null | hayır |
| `extras` | object | hayır |

> **RevenueCat:** Gelir özeti ve grafikler App Panel tarafında doğrudan RevenueCat API v2 ile çekilir (`revenuecat_project_id` + `REVENUECAT_API_KEY`). Backend `/panel/purchases` **zorunlu değildir**; RC kullanılıyorsa uygulama ekibi bunu dokümanda belirtir.

---

## Uzantılar (uygulamaya özel)

Aşağıdaki modüller şablonda tanımlıdır; her uygulama hangilerini desteklediğini kendi `PANEL_API.md` dosyasında işaretler:

| Modül | Path öneki | Örnek |
|-------|------------|--------|
| Agents / AI rehber | `/panel/agents` | MindCoach, Friendify |
| Guides / içerik | `/panel/guides` | MindCoach |
| Purchases | `/panel/purchases` | ChatFace |

Tüm uzantılar aynı auth ve sayfalama kurallarına uyar.
