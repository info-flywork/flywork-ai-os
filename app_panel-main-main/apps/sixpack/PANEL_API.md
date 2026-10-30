# SixPack30 — App Panel entegrasyon rehberi

Bu belge, **SixPack30 backend** ile **App Panel v2** arasındaki entegrasyonu tanımlar. Panel sunucusu bu uçları proxy eder; mobil uygulama `/api/*` rotalarını kullanmaya devam eder.

| Öğe | Değer |
|-----|--------|
| `panel_slug` | `sixpack30` |
| Sözleşme | v2 (`contractVersion: "2"`) |
| Prefix | `/panel` |
| Auth header | `X-Panel-Api-Key` (alternatif: `X-Panel-Key`, `Authorization: Bearer`) |
| Satın alım backend | **Yok** — yalnızca **RevenueCat** |
| Mobil rotalar | Değiştirilmedi |

---

## 1. Base URL tablosu

Panel veritabanında `applications.api_base_url` alanına **prefix dahil tam kök** yazılır.

| Ortam | `api_base_url` (Panel DB) | Örnek tam uç |
|-------|---------------------------|--------------|
| Yerel | `http://localhost:3000/panel` | `http://localhost:3000/panel/health` |
| Üretim | `https://api.sixpack30.com/panel` | `https://api.sixpack30.com/panel/analyse` |

> Üretim domain’i deploy ortamınıza göre güncellenir. Panel proxy istekleri `{api_base_url}/{path}` şeklinde yapar (`/health`, `/users`, …).

### Panel kayıt özeti

| Alan | Örnek |
|------|--------|
| `panel_slug` | `sixpack30` |
| `api_base_url` | `https://api.sixpack30.com/panel` |
| `panel_api_key` | Backend `.env` → `PANEL_API_KEY` ile **aynı** |
| `revenuecat_project_id` | RevenueCat proje id (gelir sekmesi) |

App Panel `.env` (örnek):

```env
SIXPACK30_PANEL_API_KEY=<PANEL_API_KEY ile aynı>
SIXPACK30_REVENUECAT_PROJECT_ID=proj_xxxx
REVENUECAT_API_KEY=sk_v2_...
REVENUECAT_CURRENCY=USD
```

---

## 2. Ortam değişkenleri (backend)

```env
PANEL_API_KEY=uzun-rastgele-secret
PANEL_API_ENABLED=true
PANEL_TIMEZONE=Europe/Istanbul
PANEL_DAILY_DAYS=30
PANEL_ALLOWED_IPS=
PANEL_SERVICE_NAME=sixpack30-api
```

| Değişken | Varsayılan | Açıklama |
|----------|------------|----------|
| `PANEL_API_KEY` | — | Zorunlu (üretim). Panel ile paylaşılan secret |
| `PANEL_API_ENABLED` | `true` | `false` → tüm `/panel` uçları **404** |
| `PANEL_TIMEZONE` | `Europe/Istanbul` | Analyse günlük serisi |
| `PANEL_DAILY_DAYS` | `30` | 7–90 arası günlük analiz günü |
| `PANEL_ALLOWED_IPS` | boş | Doluysa yalnızca listedeki IP’ler |
| `CDN_ACCESS_KEY` | — | Bunny Storage AccessKey (panel kapak/video yükleme) |
| `CDN_HOSTNAME` | `sixpack30.b-cdn.net` | Mobil ve panel CDN URL kökü |
| `CDN_STORAGE_ZONE` | `sixpack30` | Bunny storage zone adı |

Şema güncellemesi (ilk deploy):

```bash
npx prisma migrate deploy
# veya: prisma/migrations/20260518_panel_exercise_fields/migration.sql
```

---

## 3. Kimlik doğrulama

- Mobil Firebase JWT **`/panel` uçlarında kullanılmaz**.
- Her istekte panel anahtarı gerekir.

```http
X-Panel-Api-Key: <PANEL_API_KEY>
Content-Type: application/json
```

| HTTP | `error` | Anlam |
|------|---------|--------|
| 403 | `FORBIDDEN` | Geçersiz anahtar veya IP |
| 404 | `NOT_FOUND` | Panel kapalı (`PANEL_API_ENABLED=false`) |
| 503 | `NOT_CONFIGURED` | `PANEL_API_KEY` tanımsız |

---

## 4. Modül kontrol listesi

| Modül | Durum |
|-------|--------|
| Health | ✅ |
| Analyse (+ antrenman metrikleri) | ✅ |
| Users (liste, detay, PATCH) | ✅ |
| Workouts (katalog admin CRUD) | ✅ |
| User workouts (okuma, sınırlı PATCH) | ✅ |
| Purchases (`/panel/purchases`) | ❌ — RevenueCat only |
| RevenueCat gelir grafikleri | Panel tarafı (`revenuecat_project_id`) |
| Agents / Guides | ❌ |

---

## 5. Endpoint tablosu

`{BASE}` = `api_base_url` (ör. `https://api.sixpack30.com/panel`)

| Path | Metot | Açıklama |
|------|-------|----------|
| `{BASE}/health` | GET | Canlılık |
| `{BASE}/analyse` | GET | Özet + günlük seri + antrenman özeti |
| `{BASE}/users` | GET | Sayfalı kullanıcı listesi |
| `{BASE}/users/:id` | GET | Kullanıcı detayı |
| `{BASE}/users/:id` | PATCH | Admin düzenleme |
| `{BASE}/users/:userId/workouts` | GET | Kullanıcının antrenman oturumları |
| `{BASE}/workouts` | GET | Antrenman kataloğu |
| `{BASE}/workouts` | POST | Yeni antrenman (admin) |
| `{BASE}/workouts/:id` | GET | Antrenman detayı |
| `{BASE}/workouts/:id` | PATCH | Güncelle |
| `{BASE}/workouts/:id` | DELETE | Soft delete → `archived` |
| `{BASE}/user-workouts` | GET | Tüm oturumlar (filtreli) |
| `{BASE}/user-workouts/:id` | GET | Oturum detayı (`p_*` veya `cd_*`) |
| `{BASE}/user-workouts/:id` | PATCH | Yalnızca `p_*` kayıtları (metadata) |

Sayfalama: `page` (≥1), `limit` (varsayılan 20, max 100).

---

## 6. Örnek JSON yanıtları

### 6.1 Health

```http
GET {BASE}/health
```

```json
{
  "ok": true,
  "service": "sixpack30-api",
  "contractVersion": "2"
}
```

### 6.2 Analyse

```http
GET {BASE}/analyse
```

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
    "publishedWorkouts": 30,
    "workoutsCompletedToday": 140,
    "activeWorkoutUsersToday": 62
  },
  "daily": [
    {
      "date": "2026-05-18",
      "logins": 85,
      "newUsers": 12,
      "workoutsCompleted": 140,
      "workoutMinutes": 820
    }
  ],
  "workoutsSummary": {
    "topWorkoutsByCompletions": [
      { "workoutId": "5", "title": "Güçlendirme", "completions": 42 }
    ]
  }
}
```

### 6.3 Users

**Liste**

```http
GET {BASE}/users?page=1&limit=20&search=ali
```

```json
{
  "contractVersion": "2",
  "data": [
    {
      "id": "42",
      "email": "ali@example.com",
      "displayName": "Ali",
      "phone": null,
      "status": "active",
      "createdAt": "2026-01-10T08:00:00.000Z",
      "lastLoginAt": "2026-05-18T07:30:00.000Z",
      "extras": {
        "firebaseUid": "firebase_uid_xxx",
        "isPremium": true,
        "photoUrl": "https://...",
        "waterIntake": 1.5,
        "healthConnected": true,
        "notificationsEnabled": true,
        "hasQuestionnaire": true,
        "goal": "lose_weight",
        "gender": "male",
        "trainingDays": "3"
      }
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

**PATCH**

```http
PATCH {BASE}/users/42
Content-Type: application/json

{
  "displayName": "Ali Y.",
  "extras": { "isPremium": true }
}
```

### 6.4 Workouts (katalog = `Exercise` tablosu)

#### Medya yükleme (önemli)

Kapak görseli ve video **panelden BunnyCDN’e doğrudan yüklenmez**. Panel dosyaları API’ye gönderir; backend `CDN_ACCESS_KEY` ile Bunny Storage’a yükler ve dönen URL’leri kaydeder.

| Dosya alanı | Tür | Max boyut | CDN path örneği |
|-------------|-----|-----------|-----------------|
| `coverImage` | jpeg, png, webp, gif | 10 MB | `exercises/{id}/cover_{ts}.jpg` |
| `video` | mp4, webm, mov | 150 MB | `exercises/{id}/video_{ts}.mp4` |

- `coverImageUrl` / `videoUrl` ile JSON gövdesi **kabul edilmez** (400).
- Yanıtta `coverImageUrl` ve `extras.videoUrl` API’nin ürettiği CDN URL’leridir.

**POST / PATCH — `multipart/form-data` (önerilen)**

```http
POST {BASE}/workouts
X-Panel-Api-Key: <key>
Content-Type: multipart/form-data
```

| Form alanı | Tip | Zorunlu | Açıklama |
|------------|-----|---------|----------|
| `title` | text | evet | Antrenman başlığı (TR) |
| `description` | text | hayır | |
| `status` | text | hayır | `draft` \| `published` \| `archived` |
| `difficulty` | text | hayır | `beginner` \| `intermediate` \| `advanced` |
| `durationMinutes` | text/number | hayır | Varsayılan 10 |
| `category` | text | hayır | Varsayılan `program` |
| `isPremium` | text | hayır | `true` / `false` |
| `extras` | text (JSON string) | hayır | `{"title_en":"Morning Core"}` |
| `coverImage` | file | hayır | Kapak — API Bunny’e yükler |
| `video` | file | hayır | Video — API Bunny’e yükler |

**curl örneği**

```bash
curl -X POST "$BASE/workouts" \
  -H "X-Panel-Api-Key: $KEY" \
  -F "title=Sabah Core" \
  -F "description=10 dk karın aktivasyonu" \
  -F "status=published" \
  -F "difficulty=intermediate" \
  -F "durationMinutes=10" \
  -F 'extras={"title_en":"Morning Core","isPremium":false}' \
  -F "coverImage=@./cover.jpg;type=image/jpeg" \
  -F "video=@./workout.mp4;type=video/mp4"
```

**Yanıt örneği**

```json
{
  "contractVersion": "2",
  "data": {
    "id": "31",
    "title": "Sabah Core",
    "coverImageUrl": "https://sixpack30.b-cdn.net/exercises/31/cover_1716028800000.jpg",
    "extras": {
      "videoUrl": "https://sixpack30.b-cdn.net/exercises/31/video_1716028800001.mp4",
      "title_en": "Morning Core"
    }
  }
}
```

**PATCH** — yalnızca yeni dosya gönderilen alanlar güncellenir; metin alanları aynı formatta.

**DELETE** → kayıt silinmez; `status: "archived"` olur.

### 6.5 User workouts

Oturumlar iki kaynaktan birleştirilir:

| Kaynak | Panel `id` | DB |
|--------|------------|-----|
| Egzersiz ilerlemesi | `p_{progressId}` | `Progress` |
| 30 günlük program günü | `cd_{completedDayId}` | `CompletedDay` |

```http
GET {BASE}/user-workouts?userId=42&status=completed&from=2026-05-01&to=2026-05-18
```

```json
{
  "contractVersion": "2",
  "data": [
    {
      "id": "cd_15",
      "userId": "42",
      "workoutId": "5",
      "workoutTitle": "Güçlendirme",
      "status": "completed",
      "startedAt": "2026-05-18T07:00:00.000Z",
      "completedAt": "2026-05-18T07:10:00.000Z",
      "durationMinutes": 10,
      "caloriesBurned": null,
      "progressPercent": 100,
      "extras": { "source": "completed_day", "dayNumber": 5 }
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

> Oturum **oluşturma** yalnızca mobilde (`POST /api/training/progress`, `POST /api/training/complete-day`). Panel okur; `PATCH` yalnızca metadata amaçlıdır.

---

## 7. Alan eşleme tabloları

### 7.1 PanelUser ← `User` + `Questionnaire`

| Kanonik alan | DB / kaynak |
|--------------|-------------|
| `id` | `User.id` (string) |
| `email` | `User.email` |
| `displayName` | `User.name` |
| `phone` | — (yok) |
| `status` | Sabit `active` (PATCH `banned` yalnızca yanıtta işaret) |
| `createdAt` | `User.createdAt` |
| `lastLoginAt` | `User.updatedAt` (son aktivite proxy) |
| `extras.firebaseUid` | `User.firebaseUid` |
| `extras.isPremium` | `User.isPremium` (RC webhook günceller) |
| `extras.photoUrl` | `User.photoUrl` |
| `extras.hasQuestionnaire` | `Questionnaire` var mı |
| `extras.goal`, `gender`, `trainingDays` | Son anket |

**PATCH yazılabilir:** `email`, `displayName` → `name`, `extras.isPremium`, `extras.notificationsEnabled`, `extras.healthConnected`

### 7.2 PanelWorkout ← `Exercise`

| Kanonik alan | DB |
|--------------|-----|
| `id` | `Exercise.id` |
| `title` | `Exercise.title_tr` |
| `description` | `Exercise.description_tr` |
| `status` | `Exercise.status` (`draft` \| `published` \| `archived`) |
| `difficulty` | `Exercise.difficulty` → `beginner` \| `intermediate` \| `advanced` |
| `durationMinutes` | `Exercise.duration` ÷ 60 (DB **saniye**) |
| `category` | `Exercise.category` (varsayılan `program`) |
| `coverImageUrl` | `getCdnUrl(Exercise.imagePath)` — panel dosya yükler, API yazar |
| `extras.videoUrl` | `getCdnUrl(Exercise.videoPath)` — panel dosya yükler, API yazar |
| `publishedAt` | `Exercise.publishedAt` |
| `extras.title_en` | `Exercise.title_en` |
| `extras.isPremium` | `Exercise.isPremium` |
| `extras.programDay` | `Exercise.id` (30 günlük program gün no) |

### 7.3 PanelUserWorkout

| Kanonik | Progress | CompletedDay |
|---------|----------|--------------|
| `id` | `p_{id}` | `cd_{id}` |
| `userId` | `userId` | `userId` |
| `workoutId` | `exerciseId` | `dayNumber` |
| `status` | süre ≥ %90 → `completed`, aksi `started` | `completed` |
| `completedAt` | `completedAt` | `completedAt` |
| `durationMinutes` | `duration` saniye → dk | egzersiz süresi |
| `caloriesBurned` | `calories` | — |

### 7.4 PanelPurchase

**Implement edilmedi.** Gelir ve abonelik detayı için:

- RevenueCat API v2 (Panel)
- Kullanıcı eşlemesi: `extras.firebaseUid` = RC `app_user_id`
- Premium bayrağı: `User.isPremium` (webhook: `POST /api/webhooks/revenuecat`)

---

## 8. Metrik tanımları (Analyse)

Tüm “bugün” hesapları `PANEL_TIMEZONE` (varsayılan `Europe/Istanbul`) takvim gününe göredir.

| Panel alanı | Hesap |
|-------------|--------|
| `summary.totalUsers` | `COUNT(User)` |
| `summary.newUsersToday` | `User.createdAt` bugün |
| `summary.loginsToday` | Bugün **en az bir** aktivitesi olan benzersiz kullanıcı: `Progress`, `CompletedDay` veya `User.updatedAt` |
| `summary.totalWorkouts` | `COUNT(Exercise)` |
| `summary.publishedWorkouts` | `Exercise.status = 'published'` |
| `summary.workoutsCompletedToday` | Bugünkü `Progress` + `CompletedDay` kayıt sayısı |
| `summary.activeWorkoutUsersToday` | Bugün antrenman tamamlayan benzersiz `userId` |
| `daily[].logins` | Gün bazlı aktif kullanıcı (yukarıdaki mantık) |
| `daily[].workoutsCompleted` | Gün bazlı progress + completed day |
| `daily[].workoutMinutes` | Gün bazlı `SUM(Progress.duration)` / 60 |
| `workoutsSummary.topWorkoutsByCompletions` | `Progress` group by `exerciseId`, top 5 |

---

## 9. Admin antrenman akışı

| `status` | Davranış |
|----------|----------|
| `draft` | Katalogda taslak |
| `published` | Mobil listede görünür (`status` filtresi yoksa tümü döner; mobil mevcut API değişmedi) |
| `archived` | DELETE sonrası; listeden çıkarılabilir |

**POST zorunlu:** `title` (string)

**Süre:** Panel `durationMinutes` gönderir; DB’de saniye saklanır (`× 60`).

**Medya akışı (panel UI):**

1. Kullanıcı formda kapak/video dosyası seçer.
2. Panel `multipart/form-data` ile `POST /workouts` veya `PATCH /workouts/:id` çağırır.
3. Backend önce kaydı oluşturur/günceller, ardından dosyaları Bunny’e yükler, `imagePath` / `videoPath` günceller.
4. Panel yanıttaki `coverImageUrl` ve `extras.videoUrl` ile önizleme gösterir.

Panel **Bunny Storage API key’ine sahip olmamalı**; yalnızca `X-Panel-Api-Key` yeterlidir.

---

## 10. Üyelik / gelir

| Kaynak | Kullanım |
|--------|----------|
| RevenueCat | Gelir özeti, grafikler, müşteri arama (Panel) |
| `/panel/purchases` | **Yok** |
| Webhook | `POST /api/webhooks/revenuecat` → `User.isPremium` |

Panel kullanıcı detayında:

1. `GET /users/:id`
2. `GET /users/:userId/workouts`
3. RC arama: e-posta veya `firebaseUid`

---

## 11. Test curl örnekleri

```bash
export BASE="http://localhost:3000/panel"
export KEY="your-panel-api-key"

# 1 Health
curl -s -H "X-Panel-Api-Key: $KEY" "$BASE/health" | jq

# 2 Analyse
curl -s -H "X-Panel-Api-Key: $KEY" "$BASE/analyse" | jq

# 3 Users
curl -s -H "X-Panel-Api-Key: $KEY" "$BASE/users?page=1&limit=5" | jq

# 4 Workouts
curl -s -H "X-Panel-Api-Key: $KEY" "$BASE/workouts?status=published" | jq

# 5 User workouts
curl -s -H "X-Panel-Api-Key: $KEY" "$BASE/users/1/workouts" | jq

# 6 POST workout + medya (admin)
curl -s -X POST -H "X-Panel-Api-Key: $KEY" \
  -F "title=Test Antrenman" \
  -F "durationMinutes=10" \
  -F "status=draft" \
  -F "coverImage=@./cover.jpg;type=image/jpeg" \
  "$BASE/workouts" | jq
```

---

## 12. Mimari özet (Panel AI için)

```
┌─────────────────┐     X-Panel-Api-Key      ┌──────────────────────────┐
│  App Panel      │ ───────────────────────► │  SixPack30 Backend       │
│  (Node proxy)   │   GET/PATCH/POST/DELETE  │  /panel/*                │
└────────┬────────┘                          └───────────┬──────────────┘
         │                                                │
         │ RevenueCat v2                                  │ Mobil uygulama
         └──────────────────────────────────────────────►│ /api/* + Firebase JWT
                                                          │ (değiştirilmedi)
```

**Kod konumları (backend repo):**

| Parça | Dosya |
|-------|--------|
| Mount | `src/index.js` → `app.use('/panel', panelRoutes)` |
| Rotalar | `src/routes/panel.routes.js` |
| Auth | `src/middlewares/panelAuth.middleware.js` |
| Mapping | `src/panel/mappers.js` |
| Config | `src/panel/config.js` |

**Veri modeli:**

- Katalog antrenman = `Exercise` (30 günlük program günleri)
- Kullanıcı oturumu = `Progress` + `CompletedDay`
- Kullanıcı = `User` + isteğe bağlı `Questionnaire`

---

## 13. Sürüm

| Öğe | Değer |
|-----|--------|
| Sözleşme | v2 |
| Kanonik şema | `EXTERNAL_API_CONTRACT.md` |
| Entegrasyon şablonu | `INTEGRATION_TEMPLATE.md` |

---

*Son güncelleme: 2026-05-18 — SixPack30 backend panel katmanı.*
