# BreathPath — App Panel entegrasyon dokümantasyonu

Bu belge, **BreathPath mobil backend** (`breathpath_apis`) ile **Fly Work App Panel** arasındaki entegrasyonu tanımlar. Mobil uygulama `/api/*` rotalarına dokunulmaz; yönetim işlemleri yalnızca `/panel/*` altındadır.

| Öğe | Değer |
|-----|--------|
| Uygulama adı | BreathPath |
| `panel_slug` | `breathpath` |
| Sözleşme | v2 (`contractVersion: "2"`) |
| Prefix | `/panel` |
| Auth header | `X-Panel-Api-Key` (alternatif: `X-Panel-Key`, `Authorization: Bearer`) |

---

## 1. Base URL

| Ortam | API kökü | Panel base (`api_base_url`) |
|-------|----------|-----------------------------|
| Yerel geliştirme | `http://localhost:3000` | `http://localhost:3000/panel` |
| Üretim (önerilen) | `https://breathpath.fly-work.com` | `https://breathpath.fly-work.com/panel` |

App Panel `applications` tablosunda kayıt:

```text
panel_slug: breathpath
api_base_url: https://breathpath.fly-work.com/panel
panel_api_key: <PANEL_API_KEY ile aynı secret>
revenuecat_project_id: <RC proje id — gelir kartları için>
```

**Tam endpoint tablosu** (`{BASE}` = yukarıdaki panel base):

| Modül | Metot | Path |
|-------|-------|------|
| Health | GET | `{BASE}/health` |
| Analyse | GET | `{BASE}/analyse` |
| Users | GET | `{BASE}/users` |
| Users | GET | `{BASE}/users/:id` |
| Users | PATCH | `{BASE}/users/:id` |
| Workouts (egzersiz kataloğu) | GET | `{BASE}/workouts` |
| Workouts | POST | `{BASE}/workouts` |
| Workouts | GET | `{BASE}/workouts/:id` |
| Workouts | PATCH | `{BASE}/workouts/:id` |
| Workouts | DELETE | `{BASE}/workouts/:id` |
| User workouts | GET | `{BASE}/user-workouts` |
| User workouts | GET | `{BASE}/users/:userId/workouts` |
| User workouts | GET | `{BASE}/user-workouts/:id` |
| **Medya yükleme** | POST | `{BASE}/media/video`, `{BASE}/media/image` |
| Purchases | — | **Yok** (yalnızca RevenueCat) |

API tarafı (aynı auth): `POST /api/exercises/upload/video`, `POST /api/exercises/upload/image`

Mobil uygulama rotaları (panel **çağırmaz**, referans):

- `POST /api/auth/signin`
- `GET /api/exercises`
- `POST /api/exercises/complete`
- `GET /api/favorites`, `POST /api/moods`, …

**Admin egzersiz ekleme (API tarafı, alternatif):**

| Metot | Path | Auth |
|-------|------|------|
| POST | `/api/exercises` | `X-Panel-Api-Key` |

Panel `POST /panel/workouts` ile aynı veritabanına yazar; istek gövdesi mobil `GET /api/exercises` cevabıyla aynı şekil (`title`, `benefits`, `explain` objeleri).

Örnek:

```bash
curl -X POST "https://api.breathpath.com/api/exercises" \
  -H "X-Panel-Api-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "category": "emotion",
    "tabCategory": "anger_control",
    "level": "start",
    "subCategory": "calm",
    "duration": 180,
    "videoImageURL": "https://breathpath.b-cdn.net/exercises/cover.png",
    "videoUrl": "",
    "isPremium": false,
    "title": {
      "tr": "Öfkeni Kontrol Et",
      "en": "Control Your Anger",
      "ru": "Контролируй гнев",
      "zh": "控制愤怒"
    },
    "benefits": {
      "tr": ["Vagus siniri aktivasyonu desteklenebilir."],
      "en": ["Vagus nerve activation can be supported."]
    },
    "explain": {
      "tr": "Kısa nefes pratiği.",
      "en": "Short breath practice."
    },
    "steps": []
  }'
```

Zorunlu alanlar: `category`, `tabCategory`, `level`, `title` (en az `tr` veya `en`).

### 4.4b Medya yükleme (video / kapak görseli)

Panel CDN’e **doğrudan erişemez**. Dosya API’ye yüklenir; API Bunny Storage’a yazar ve **public URL** döner. Bu URL’leri egzersiz oluştururken `videoUrl` / `videoImageURL` (veya panel `coverImageUrl` / `extras.videoUrl`) alanlarına yazın.

| Endpoint | Alan adı | Format | Max boyut |
|----------|----------|--------|-----------|
| `POST {BASE}/media/video` | `video` | MP4, MOV, WEBM, M4V | `PANEL_VIDEO_MAX_MB` (varsayılan 150) |
| `POST {BASE}/media/image` | `image` | JPEG, PNG, GIF, WebP | `PANEL_IMAGE_MAX_MB` (varsayılan 10) |

**İstek:** `Content-Type: multipart/form-data` + `X-Panel-Api-Key`

```bash
# Video yükle
curl -X POST "$BASE/media/video" \
  -H "X-Panel-Api-Key: $KEY" \
  -F "video=@/path/to/exercise.mp4"

# Kapak görseli
curl -X POST "$BASE/media/image" \
  -H "X-Panel-Api-Key: $KEY" \
  -F "image=@/path/to/cover.png"
```

**Yanıt (panel):**

```json
{
  "contractVersion": "2",
  "data": {
    "url": "https://breathpath.b-cdn.net/exercises/videos/video-1716200000000.mp4",
    "kind": "video",
    "fileName": "exercise.mp4",
    "mimeType": "video/mp4",
    "sizeBytes": 5242880
  }
}
```

**Önerilen panel akışı:**

1. `POST /panel/media/video` → `data.url` → egzersiz `videoUrl`
2. `POST /panel/media/image` → `data.url` → `coverImageUrl` / `videoImageURL`
3. `POST /panel/workouts` veya `POST /api/exercises` ile metin + URL’leri kaydet

CDN path’leri: `exercises/videos/`, `exercises/images/` (profil fotoğrafları `profiles/` altında kalır).

---

## 2. Ortam değişkenleri (BreathPath backend `.env`)

```env
# Panel
PANEL_API_ENABLED=true
PANEL_API_KEY=uzun-rastgele-secret-uretin
PANEL_TIMEZONE=Europe/Istanbul
PANEL_DAILY_DAYS=30
# Opsiyonel: virgülle ayrılmış IP listesi
PANEL_ALLOWED_IPS=

# App Panel tarafı (örnek)
# BREATHPATH_PANEL_API_KEY=<aynı PANEL_API_KEY>
# BREATHPATH_REVENUECAT_PROJECT_ID=proj_xxxx
```

| Değişken | Zorunlu | Açıklama |
|----------|---------|----------|
| `PANEL_API_KEY` | Evet | Panel proxy’nin gönderdiği secret |
| `PANEL_API_ENABLED` | Hayır | `false` ise panel 404 döner |
| `PANEL_TIMEZONE` | Hayır | Analyse günlük serisi (varsayılan `Europe/Istanbul`) |
| `PANEL_DAILY_DAYS` | Hayır | Analyse `daily[]` gün sayısı (7–90, varsayılan 30) |

**Veritabanı migration:** `migrations/001_panel_support.sql` bir kez çalıştırılmalı (`panel_status`, `exercise_completion_events`).

---

## 3. Kimlik doğrulama

Her panel isteğinde:

```http
X-Panel-Api-Key: <PANEL_API_KEY>
Content-Type: application/json
```

| HTTP | `error` | Anlam |
|------|---------|--------|
| 403 | `FORBIDDEN` | Yanlış/eksik anahtar veya IP engeli |
| 404 | `PANEL_DISABLED` | `PANEL_API_ENABLED=false` |
| 503 | `PANEL_NOT_CONFIGURED` | `PANEL_API_KEY` tanımlı değil |

Mobil JWT panel uçlarında **kullanılmaz**.

---

## 4. Endpoint detayları ve örnekler

### 4.1 Health

`GET /panel/health`

```json
{
  "ok": true,
  "service": "breathpath-api",
  "contractVersion": "2"
}
```

### 4.2 Analyse

`GET /panel/analyse`

**Metrik tanımları:**

| Panel alanı | Kaynak / kural |
|-------------|----------------|
| `summary.totalUsers` | `users` WHERE `is_active = TRUE` |
| `summary.loginsToday` | Bugün `last_active` tarihi (timezone: `PANEL_TIMEZONE`) |
| `summary.newUsersToday` | Bugün `account_created_date` |
| `summary.totalWorkouts` | `exercises` (arşivlenmemiş) |
| `summary.publishedWorkouts` | `exercises.panel_status = 'published'` |
| `summary.workoutsCompletedToday` | `exercise_completion_events` bugün `status=completed` |
| `summary.activeWorkoutUsersToday` | Bugün tamamlama yapan benzersiz `uid` |
| `daily[].logins` | Gün bazında `last_active` olan kullanıcı sayısı |
| `daily[].newUsers` | Gün bazında yeni kayıt |
| `daily[].workoutsCompleted` | Gün bazında tamamlama event sayısı |
| `daily[].workoutMinutes` | Gün bazında `duration_seconds` toplamı / 60 |

Örnek özet parçası:

```json
{
  "contractVersion": "2",
  "generatedAt": "2026-05-20T12:00:00.000Z",
  "timezone": "Europe/Istanbul",
  "summary": {
    "totalUsers": 1200,
    "loginsToday": 85,
    "newUsersToday": 12,
    "totalWorkouts": 48,
    "publishedWorkouts": 45,
    "workoutsCompletedToday": 230,
    "activeWorkoutUsersToday": 85
  },
  "daily": [
    {
      "date": "2026-05-19",
      "logins": 90,
      "newUsers": 10,
      "workoutsCompleted": 210,
      "workoutMinutes": 620
    }
  ]
}
```

### 4.3 Users

`GET /panel/users?page=1&limit=20&search=ali`

Arama: `uid`, `email`, `username` (LIKE).

`PATCH /panel/users/:id` — `id` = Firebase `uid`.

Yazılabilir alanlar:

| Panel alanı | DB |
|-------------|-----|
| `displayName` | `users.username` |
| `email` | `users.email` |
| `status` | `active` → `is_active=1`, `inactive`/`banned` → `0` |
| `extras.isPremium` | `premium_datas` JSON dizisi |

Örnek `PanelUser`:

```json
{
  "id": "firebase_uid_abc",
  "email": "user@example.com",
  "displayName": "Ayşe",
  "phone": null,
  "status": "active",
  "createdAt": "2026-01-10T08:00:00.000Z",
  "lastLoginAt": "2026-05-20T07:30:00.000Z",
  "extras": {
    "authProvider": "google",
    "profilePhotoUrl": "https://cdn.../photo.jpg",
    "isPremium": true,
    "completedExercisesCount": 42,
    "currentStreak": 5,
    "totalExerciseTimeSeconds": 12600,
    "favoritesExercises": [5, 12]
  }
}
```

### 4.4 Workouts (= egzersiz kataloğu)

BreathPath’te **workout = `exercises` tablosu**. Panel admin CRUD bu tabloyu yönetir; mobil `GET /api/exercises` aynı veriyi okur.

| PanelWorkout | DB (`exercises`) |
|--------------|------------------|
| `id` | `id` |
| `title` | `title_en` (fallback `title_tr`) |
| `description` | `explain_en` |
| `status` | `panel_status` (`draft` \| `published` \| `archived`) |
| `difficulty` | `level` (`start`, …) |
| `durationMinutes` | `duration` (DB: **saniye**, panel: dakika) |
| `category` | `category` |
| `coverImageUrl` | `video_image_url` |
| `extras.videoUrl` | `video_url` |
| `extras.isPremium` | `is_premium` |
| `extras.localizedTitles` | `title_tr`, `title_en`, `title_ru`, `title_zh`, … |
| `extras.steps` | `steps` (JSON) |

**POST /panel/workouts** — zorunlu: `title` (veya `extras.localizedTitles.en`).

```json
{
  "title": "Control Your Anger",
  "description": "Short breathing practice",
  "status": "published",
  "difficulty": "start",
  "durationMinutes": 3,
  "category": "emotion",
  "coverImageUrl": "https://breathpath.b-cdn.net/exercises/cover.png",
  "extras": {
    "tabCategory": "anger_control",
    "subCategory": "calm",
    "videoUrl": "https://...",
    "isPremium": false,
    "localizedTitles": {
      "tr": "Öfkeni Kontrol Et",
      "en": "Control Your Anger",
      "ru": "Контролируй гнев",
      "zh": "控制愤怒"
    },
    "steps": []
  }
}
```

**DELETE:** `panel_status` kolonu varsa **soft** (`archived`); yoksa hard delete.

### 4.5 User workouts (tamamlama geçmişi)

Mobil: `POST /api/exercises/complete` → kullanıcı istatistikleri güncellenir **ve** (migration sonrası) `exercise_completion_events` satırı eklenir.

| PanelUserWorkout | Kaynak |
|------------------|--------|
| `id` | `exercise_completion_events.id` |
| `userId` | `uid` |
| `workoutId` | `exercise_id` |
| `workoutTitle` | `exercises.title_en` / `title_tr` |
| `status` | `completed` |
| `completedAt` | `completed_at` |
| `durationMinutes` | `duration_seconds` / 60 |

Migration öncesi liste boş döner; `note` alanında açıklama olabilir.

### 4.6 Purchases / gelir

| Yöntem | Durum |
|--------|--------|
| `GET /panel/purchases` | **Implement edilmedi** |
| RevenueCat | **Önerilen** — App Panel `revenuecat_project_id` + `REVENUECAT_API_KEY` ile grafik/özet |

Premium bilgisi kullanıcı `extras.isPremium` içinde (`users.premium_datas`).

---

## 5. Alan eşleme özeti (`extras` sözlüğü)

### PanelUser.extras

| Anahtar | Tip | Açıklama |
|---------|-----|----------|
| `authProvider` | string | google, apple, facebook, guest |
| `profilePhotoUrl` | string \| null | CDN URL |
| `isPremium` | boolean | `premium_datas` dolu mu |
| `premiumDatas` | array | Ham premium JSON |
| `favoritesExercises` | number[] | Favori egzersiz id |
| `totalExerciseTimeSeconds` | number | Toplam süre (sn) |
| `completedExercisesCount` | number | Tamamlanan sayı |
| `currentStreak` | number | Seri |
| `lastExerciseDate` | string \| null | YYYY-MM-DD |
| `internalUserId` | number | DB `users.id` |

### PanelWorkout.extras

| Anahtar | Açıklama |
|---------|----------|
| `tabCategory` | `tab_category` |
| `subCategory` | `sub_category` |
| `videoUrl` | Video CDN |
| `isPremium` | Ücretli içerik |
| `localizedTitles` | Çok dilli başlıklar |
| `localizedBenefits` | tr/en/ru/zh fayda listeleri |
| `localizedExplain` | Açıklama metinleri |
| `steps` | Adım JSON dizisi |

---

## 6. Test curl örnekleri

```bash
export BASE="http://localhost:3000/panel"
export KEY="your-panel-api-key"

# 1) Health
curl -s -H "X-Panel-Api-Key: $KEY" "$BASE/health" | jq

# 2) Analyse
curl -s -H "X-Panel-Api-Key: $KEY" "$BASE/analyse" | jq

# 3) Users
curl -s -H "X-Panel-Api-Key: $KEY" "$BASE/users?page=1&limit=5" | jq

# 4) Workouts list
curl -s -H "X-Panel-Api-Key: $KEY" "$BASE/workouts?page=1&limit=5" | jq

# 5) Create workout
curl -s -X POST -H "X-Panel-Api-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"title":"Test Egzersiz","status":"draft","durationMinutes":5,"category":"test"}' \
  "$BASE/workouts" | jq
```

---

## 7. Panel modül kontrol listesi

| Modül | Durum |
|-------|--------|
| Health | ✅ |
| Analyse (+ antrenman metrikleri) | ✅ (events tablosu + migration gerekli) |
| Users liste/detay/PATCH | ✅ |
| Workouts admin CRUD | ✅ |
| User workouts | ✅ (migration sonrası dolu veri) |
| Purchases backend | ❌ — yalnızca RevenueCat |
| RevenueCat | App Panel tarafı — `revenuecat_project_id` gerekli |
| Agents / diğer | ❌ |

---

## 8. Mimari özet (yönetim paneli AI için)

```
┌─────────────────────┐     X-Panel-Api-Key      ┌──────────────────────────┐
│  Fly Work App Panel │ ───────────────────────► │  breathpath_apis         │
│  (Node proxy/UI)    │   GET/PATCH/POST/DELETE  │  /panel/*                │
└──────────┬──────────┘                          └────────────┬─────────────┘
           │                                                  │
           │ RevenueCat API v2                                │ MySQL
           └──────────────────────────────────────────────────┤
                                                              │
┌─────────────────────┐                                       │
│  BreathPath Mobil   │ ───── JWT /api/* ────────────────────►│ (aynı DB)
└─────────────────────┘                                       │
```

**İşleyiş:**

1. Panel UI kullanıcı işlemi yapar → App Panel sunucusu `api_base_url` + `panel_api_key` ile BreathPath’e proxy eder.
2. BreathPath `middleware/panelAuth.js` anahtarı doğrular → `controllers/panelController.js` → `services/panelService.js` → MySQL.
3. Egzersizler panelde **workout** olarak adlandırılır; DB tablosu `exercises`.
4. Mobil tamamlama akışı değişmez; ek olarak event log yazılır (panel analitiği).
5. Gelir ekranları BreathPath backend’den değil, RevenueCat’ten beslenir.

**Kod konumları (breathpath_apis):**

| Dosya | Rol |
|-------|-----|
| `routes/panelRoutes.js` | Panel route tanımları |
| `middleware/panelAuth.js` | API key doğrulama |
| `controllers/panelController.js` | HTTP handlers |
| `services/panelService.js` | Sorgular ve iş kuralları |
| `utils/panelMappers.js` | DB → kanonik JSON |
| `migrations/001_panel_support.sql` | Şema genişletme |

---

## 9. Sürüm

| Öğe | Değer |
|-----|--------|
| Doküman tarihi | 2026-05-20 |
| API sözleşmesi | v2 |
| Mobil API | Değişmedi (`/api/*`) |
