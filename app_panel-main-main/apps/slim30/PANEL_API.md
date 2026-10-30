# Slim30 — App Panel v2 entegrasyon rehberi

Bu belge **Slim30 backend** (`slim30-backend`) ile harici **App Panel** arasındaki entegrasyonu tanımlar. Panel sunucusu bu API’yi proxy eder; mobil uygulama `/api/*` rotalarını kullanmaya devam eder.

| Alan | Değer |
|------|--------|
| Uygulama adı | Slim30 |
| `panel_slug` | `slim30` |
| Sözleşme sürümü | `2` |
| Prefix | `/panel` |
| Kimlik doğrulama | `X-Panel-Key: <PANEL_API_KEY>` |

Kanonik alan şeması: repodaki `EXTERNAL_API_CONTRACT.md`.

---

## 1. Base URL (api_base_url)

App Panel veritabanındaki `applications.api_base_url` alanına **prefix dahil tam kök URL** yazılır.

| Ortam | `api_base_url` |
|-------|----------------|
| Yerel geliştirme | `http://localhost:3000/panel` |
| Üretim (örnek) | `https://slim30.fly-work.com/panel` |

Panel proxy istekleri bu taban üzerine path ekler:

| Modül | Tam URL örneği (üretim) |
|-------|-------------------------|
| Health | `https://slim30.fly-work.com/panel/health` |
| Analyse | `https://slim30.fly-work.com/panel/analyse` |
| Users | `https://slim30.fly-work.com/panel/users` |
| Workouts | `https://slim30.fly-work.com/panel/workouts` |
| User workouts | `https://slim30.fly-work.com/panel/user-workouts` |
| Purchases | `https://slim30.fly-work.com/panel/purchases` |

> **Önemli:** `api_base_url` sonunda `/` olmamalı. Path’ler `/panel/...` ile başlar; mobil API `/api/...` ile ayrıdır.

---

## 2. Ortam değişkenleri

### 2.1 Slim30 backend (`.env`)

```env
PANEL_API_ENABLED=true
PANEL_API_KEY=uzun-rastgele-secret-aynı-panelde
PANEL_TIMEZONE=Europe/Istanbul
PANEL_DAILY_DAYS=30
PANEL_DEFAULT_LIMIT=20
PANEL_MAX_LIMIT=100
PANEL_ALLOWED_IPS=
```

| Değişken | Zorunlu | Açıklama |
|----------|---------|----------|
| `PANEL_API_ENABLED` | Evet (panel açıkken) | `true` değilse tüm panel uçları **404** `PANEL_DISABLED` |
| `PANEL_API_KEY` | Evet (panel açıkken) | Panel ile paylaşılan gizli anahtar |
| `PANEL_TIMEZONE` | Hayır | Analiz “bugün” ve `daily[]` tarihleri (varsayılan `Europe/Istanbul`) |
| `PANEL_DAILY_DAYS` | Hayır | `daily` serisi gün sayısı, 7–90 (varsayılan 30) |
| `PANEL_ALLOWED_IPS` | Hayır | Doluysa yalnızca listelenen IP’ler erişir |

### 2.2 App Panel (örnek)

```env
SLIM30_PANEL_API_KEY=<backend PANEL_API_KEY ile aynı>
SLIM30_REVENUECAT_PROJECT_ID=proj_xxxx
REVENUECAT_API_KEY=sk_v2_...
```

---

## 3. Kimlik doğrulama ve hatalar

| Header | Değer |
|--------|--------|
| `X-Panel-Key` | `PANEL_API_KEY` (tercih edilen) |
| `X-Panel-Api-Key` | Alternatif |
| `Authorization` | `Bearer <PANEL_API_KEY>` |

Mobil JWT panel uçlarında **kullanılmaz**.

| HTTP | `error` | Anlam |
|------|---------|--------|
| 403 | `FORBIDDEN` | Geçersiz anahtar veya IP |
| 404 | `PANEL_DISABLED` | `PANEL_API_ENABLED=false` |
| 404 | `NOT_FOUND` | Kayıt yok |
| 503 | `PANEL_NOT_CONFIGURED` | Panel açık ama `PANEL_API_KEY` yok |
| 400 | `BAD_REQUEST` | Geçersiz gövde / iş kuralı |

Örnek hata:

```json
{
  "error": "FORBIDDEN",
  "message": "Invalid panel API key"
}
```

---

## 4. Aktif modüller kontrol listesi

| Modül | Durum | Not |
|-------|--------|-----|
| Health | ✅ | |
| Analyse (+ antrenman) | ✅ | 30 günlük program metrikleri |
| Users (liste, detay, PATCH) | ✅ | |
| Workouts (katalog + admin CRUD) | ✅ | Program günleri salt okunur; özel kayıtlar DB |
| User workouts | ✅ | `user_workout_progress` |
| Purchases (backend) | ✅ | `subscriptions` tablosu |
| RevenueCat (panel tarafı) | ✅ Önerilen | Gelir grafikleri; backend `/panel/purchases` RC’ye ek |
| Agents / Guides | ❌ | Bu uygulamada yok |

**Üyelik stratejisi:** Birincil gelir kaynağı **RevenueCat** (mobil SDK + webhook). Panel ayrıca `GET /panel/purchases` ile `subscriptions` tablosunu listeler (trial, manuel, RC kayıtları).

---

## 5. Endpoint özeti

| Path | Metot | Açıklama |
|------|-------|----------|
| `/health` | GET | Canlılık |
| `/analyse` | GET | Özet + günlük seri + antrenman özeti |
| `/users` | GET | Sayfalı kullanıcı listesi |
| `/users/:id` | GET | Kullanıcı detayı |
| `/users/:id` | PATCH | Admin düzenleme |
| `/users/:userId/workouts` | GET | Kullanıcının antrenman oturumları |
| `/workouts` | GET | Katalog (program + özel) |
| `/workouts` | POST | Yeni özel antrenman (DB) |
| `/workouts/:id` | GET | Tek antrenman |
| `/workouts/:id` | PATCH | Özel antrenman güncelle |
| `/workouts/:id` | DELETE | Özel antrenman arşivle |
| `/user-workouts` | GET | Tüm oturumlar (filtreli) |
| `/user-workouts/:id` | GET | Oturum detayı |
| `/user-workouts/:id` | PATCH | Opsiyonel admin düzeltme |
| `/purchases` | GET | Abonelik / satın alım listesi |
| `/purchases/:id` | GET | Tek kayıt |

Sayfalama: `page` (≥1), `limit` (varsayılan 20, max 100).

---

## 6. Örnek JSON yanıtları

### 6.1 Health

```bash
curl -s -H "X-Panel-Key: $PANEL_API_KEY" \
  "http://localhost:3000/panel/health"
```

```json
{
  "ok": true,
  "service": "slim30-api",
  "contractVersion": "2"
}
```

### 6.2 Analyse

```json
{
  "contractVersion": "2",
  "generatedAt": "2026-05-18T10:00:00.000Z",
  "timezone": "Europe/Istanbul",
  "summary": {
    "totalUsers": 1200,
    "loginsToday": 85,
    "newUsersToday": 12,
    "totalWorkouts": 30,
    "publishedWorkouts": 22,
    "workoutsCompletedToday": 45,
    "activeWorkoutUsersToday": 38
  },
  "daily": [
    {
      "date": "2026-05-18",
      "logins": 85,
      "newUsers": 12,
      "workoutsCompleted": 45,
      "workoutMinutes": 1350
    }
  ],
  "workoutsSummary": {
    "topWorkoutsByCompletions": [
      { "workoutId": "program-1", "title": "Yağ Yakım Aktivasyonu", "completions": 120 }
    ]
  }
}
```

### 6.3 Users

Liste: `GET /panel/users?page=1&limit=20&search=ali`

```json
{
  "contractVersion": "2",
  "data": [
    {
      "id": "42",
      "email": "user@example.com",
      "displayName": "Ayşe",
      "phone": null,
      "status": "active",
      "createdAt": "2026-01-15T08:00:00.000Z",
      "lastLoginAt": "2026-05-18T07:30:00.000Z",
      "extras": {
        "firebaseUid": "abc123",
        "isPremium": true,
        "premiumExpiresAt": "2026-06-01T00:00:00.000Z",
        "trialUsed": true,
        "language": "tr",
        "activeSubscription": { "plan_type": "premium_monthly", "status": "active" }
      }
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

PATCH örneği:

```json
{
  "status": "active",
  "email": "yeni@example.com",
  "extras": { "isPremium": true, "premiumExpiresAt": "2026-12-31T23:59:59.000Z" }
}
```

### 6.4 Workouts (katalog)

Program günü (`program-1` … `program-30`):

```json
{
  "id": "program-3",
  "title": "HIIT Yakıcı",
  "description": "8 egzersiz",
  "status": "published",
  "difficulty": "intermediate",
  "durationMinutes": 30,
  "category": "workout",
  "coverImageUrl": null,
  "extras": {
    "source": "builtin",
    "programDay": 3,
    "locale": "tr",
    "exercises": [{ "name": "Burpee", "sets": 3, "reps": "12 tekrar" }]
  }
}
```

Admin **POST** (yalnızca özel katalog — mobil programı değiştirmez):

```bash
curl -s -X POST -H "X-Panel-Key: $PANEL_API_KEY" -H "Content-Type: application/json" \
  -d '{"title":"Panel Test HIIT","status":"published","durationMinutes":25,"category":"cardio","extras":{"locale":"tr"}}' \
  "http://localhost:3000/panel/workouts"
```

Yanıt `id`: `custom-<db_id>`.

### 6.5 User workouts

```json
{
  "id": "15",
  "userId": "42",
  "workoutId": "program-3",
  "workoutTitle": "HIIT Yakıcı",
  "status": "completed",
  "startedAt": "2026-05-17T18:00:00.000Z",
  "completedAt": "2026-05-17T18:28:00.000Z",
  "durationMinutes": 30,
  "caloriesBurned": 600,
  "progressPercent": 100,
  "extras": { "programDay": 3, "dayType": "workout" }
}
```

Oturumlar mobilde `PUT /api/progress/days/:day` ile yazılır; panel **okur**, isteğe bağlı PATCH ile düzeltir.

### 6.6 Purchases

```json
{
  "id": "7",
  "userId": "42",
  "productId": "premium_monthly",
  "productName": "premium_monthly",
  "status": "active",
  "store": "app_store",
  "purchasedAt": "2026-03-01T10:00:00.000Z",
  "expiresAt": "2026-04-01T10:00:00.000Z",
  "amount": 9.99,
  "currency": "TRY",
  "extras": { "source": "revenuecat", "externalSubscriptionId": "txn_xxx" }
}
```

---

## 7. Alan eşleme tabloları

### 7.1 PanelUser ← `users`

| Kanonik alan | DB / kaynak |
|--------------|-------------|
| `id` | `users.id` (string) |
| `email` | `users.email` |
| `displayName` | `users.name` |
| `phone` | — (yok) |
| `status` | `active` if `is_deleted=0`, else `inactive` |
| `createdAt` | `users.created_at` |
| `lastLoginAt` | `users.updated_at` (giriş/profil güncellemesi vekili) |
| `extras.firebaseUid` | `users.firebase_uid` |
| `extras.isPremium` | `users.is_premium` |
| `extras.premiumExpiresAt` | `users.premium_expires_at` |
| `extras.trialUsed` | `users.trial_used` |
| `extras.activeSubscription` | `subscriptions` aktif kayıt |

### 7.2 PanelWorkout

| Kaynak | `id` formatı | Düzenlenebilir |
|--------|--------------|----------------|
| 30 günlük kod programı | `program-1` … `program-30` | Hayır (GET only) |
| Panel katalog tablosu | `custom-<id>` | Evet (POST/PATCH/DELETE) |

| Kanonik alan | Program (kod) | `panel_workout_catalog` |
|--------------|---------------|-------------------------|
| `title` | `slim30Program[].title` | `title` |
| `status` | `published` / dinlenme → `archived` | `status` |
| `durationMinutes` | `estimated_minutes` | `duration_minutes` |
| `category` | `type` (`workout` / `rest`) | `category` |
| `extras.exercises` | program JSON | `extras` JSON |

### 7.3 PanelUserWorkout ← `user_workout_progress`

| Kanonik alan | DB |
|--------------|-----|
| `id` | `user_workout_progress.id` |
| `userId` | `user_id` |
| `workoutId` | `program-{day_number}` |
| `workoutTitle` | `workoutProgramService` gün başlığı |
| `status` | `completed=1` → `completed`, aksi → `started` |
| `startedAt` | `created_at` |
| `completedAt` | `completed_at` |
| `durationMinutes` | program `estimated_minutes` (tamamlanınca) |
| `caloriesBurned` | `progressService.getWorkoutCalorieTarget(day)` |

### 7.4 PanelPurchase ← `subscriptions`

| Kanonik alan | DB |
|--------------|-----|
| `id` | `subscriptions.id` |
| `userId` | `user_id` |
| `productId` | `plan_type` |
| `status` | `status` |
| `store` | `source` → `revenuecat`/`trial` → `app_store`, `manual` → `stripe` |
| `purchasedAt` | `starts_at` veya `created_at` |
| `expiresAt` | `expires_at` |
| `amount` | `price` |
| `currency` | `currency` |

---

## 8. Metrik tanımları (Analyse)

Tüm “bugün” hesapları `PANEL_TIMEZONE` içindeki takvim gününe göre UTC aralığına çevrilir.

| Panel alanı | Hesap |
|-------------|--------|
| `summary.totalUsers` | `users` WHERE `is_deleted = 0` |
| `summary.newUsersToday` | `created_at` bugün aralığında |
| `summary.loginsToday` | `updated_at` bugün aralığında (Firebase giriş / profil güncellemesi vekili; ayrı login tablosu yok) |
| `summary.totalWorkouts` | 30 program günü + `panel_workout_catalog` kayıt sayısı |
| `summary.publishedWorkouts` | Programda `type != rest` + katalog `status=published` |
| `summary.workoutsCompletedToday` | `user_workout_progress` WHERE `completed=1` AND `completed_at` bugün |
| `summary.activeWorkoutUsersToday` | Bugün tamamlayan benzersiz `user_id` |
| `daily[].workoutsCompleted` | Gün bazlı tamamlanan oturum sayısı |
| `daily[].workoutMinutes` | Tamamlanan günlerin program `estimated_minutes` toplamı |
| `workoutsSummary.topWorkoutsByCompletions` | `day_number` GROUP BY, en yüksek 5 |

---

## 9. Antrenman modülü — iş kuralları

### Program günleri (salt okunur)

- Mobil uygulama `GET /api/workouts/program` ile **kod içi** 30 günlük programı kullanır.
- Panel `GET /workouts` bu günleri `program-{n}` kimliğiyle listeler.
- `PATCH` / `DELETE` program kimliklerinde **400** döner.

### Özel katalog (admin CRUD)

- `POST /panel/workouts` → `panel_workout_catalog` tablosu.
- `status`: `draft` | `published` | `archived`.
- `published` seçilince `publishedAt` otomatik set edilir.
- `DELETE` → soft delete (`is_deleted=1`, `status=archived`).

### Kullanıcı oturumları

- Oluşturma **yalnızca mobil** (`PUT /api/progress/days/:day`).
- Panel listeler ve isteğe bağlı `PATCH` ile `status` düzeltir.

---

## 10. Mimari (panel AI için özet)

```
┌─────────────────┐     X-Panel-Key      ┌──────────────────────┐
│  App Panel      │ ──────────────────► │  slim30-backend       │
│  (Node proxy)   │   /panel/*         │  src/routes/panel.js  │
└────────┬────────┘                    └──────────┬───────────┘
         │                                          │
         │ RevenueCat API v2                        │ MySQL
         └────────────────────────────────────────►│ users, subscriptions,
                                                   │ user_workout_progress,
                                                   │ panel_workout_catalog
         Mobil uygulama (dokunulmaz):
         Authorization: Bearer <JWT>  →  /api/*
```

**Kod konumları (backend repo):**

| Bileşen | Dosya |
|---------|--------|
| Mount | `src/app.js` → `app.use('/panel', ...)` |
| Rotalar | `src/routes/panel.js` |
| Auth | `src/middleware/panelAuth.js` |
| İş mantığı | `src/services/panel/panelService.js` |
| Eşleme | `src/services/panel/panelMappers.js` |
| Migration | `migrations/008_panel_workout_catalog.sql` |

---

## 11. curl test paketi

```bash
export BASE="http://localhost:3000/panel"
export KEY="your-panel-api-key"

# 1 Health
curl -s -H "X-Panel-Key: $KEY" "$BASE/health"

# 2 Analyse
curl -s -H "X-Panel-Key: $KEY" "$BASE/analyse"

# 3 Users
curl -s -H "X-Panel-Key: $KEY" "$BASE/users?page=1&limit=5"

# 4 Workouts katalog
curl -s -H "X-Panel-Key: $KEY" "$BASE/workouts?limit=5"

# 5 User workouts
curl -s -H "X-Panel-Key: $KEY" "$BASE/user-workouts?status=completed&limit=5"
```

---

## 12. App Panel kayıt özeti

`applications` tablosuna eklenecek örnek:

| Alan | Değer |
|------|--------|
| `panel_slug` | `slim30` |
| `api_base_url` | `https://slim30.fly-work.com/panel` |
| `panel_api_key` | Backend `PANEL_API_KEY` ile aynı |
| `revenuecat_project_id` | RC proje kimliği (gelir sekmesi) |

Panel UI sekmeleri: **Özet** (analyse + RC), **Kullanıcılar**, **Antrenmanlar** (katalog + yeni özel antrenman), **Satın alımlar** (purchases + RC feed).

---

## 13. Sürüm

| Öğe | Değer |
|-----|--------|
| Entegrasyon | v2 |
| Mobil API | Değiştirilmedi (`/api/*`) |
| Panel prefix | `/panel` |
