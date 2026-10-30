# ChatFace — App Panel API (v2) — Toplu entegrasyon dökümanı

Bu belge, **dış yönetim panelinin** ChatFace backend ile konuşması için gereken tüm bilgileri tek yerde toplar. Paneli geliştiren ekip veya yapay zeka bu dosyayı referans alarak URL kaydı, kimlik doğrulama, JSON sözleşmesi ve alan eşlemelerini uygulayabilir.

**Önemli:** Mobil uygulama akışları (`/api/*`) bu API’den **etkilenmez**. Tüm panel uçları yalnızca `/panel/*` altında, ayrı güvenlik katmanıyla sunulur.

---

## İçindekiler

1. [Base URL ve panel kayıtları](#1-base-url-ve-panel-kayıtları)
2. [Etkinleştirme ve güvenlik](#2-etkinleştirme-ve-güvenlik)
3. [Endpoint özeti](#3-endpoint-özeti)
4. [Kimlik doğrulama](#4-kimlik-doğrulama)
5. [Health](#5-health)
6. [Analyse (metrikler)](#6-analyse-metrikler)
7. [Users (kullanıcılar)](#7-users-kullanıcılar)
8. [Purchases (üyelik satın alımları)](#8-purchases-üyelik-satın-alımları)
9. [Alan eşleme tabloları](#9-alan-eşleme-tabloları)
10. [Veritabanı migration](#10-veritabanı-migration)
11. [Test curl komutları](#11-test-curl-komutları)
12. [Panel kontrol listesi](#12-panel-kontrol-listesi)

---

## 1. Base URL ve panel kayıtları

### Base URL (kök)

| Ortam | Base URL |
|--------|----------|
| Yerel geliştirme | `http://localhost:3000/panel` |
| Üretim (örnek) | `https://chatface.fly-work.com/panel` |

Üretim domain’i deploy ortamınıza göre değişir (`BASE_URL`, reverse proxy).

### Panelde kaydedilecek tam URL’ler

| Panel alanı | Metot | Tam URL (örnek üretim) |
|-------------|-------|-------------------------|
| Health | GET | `https://chatface.fly-work.com/panel/health` |
| Analyse | GET | `https://chatface.fly-work.com/panel/analyse` |
| Users | GET / PATCH | `https://chatface.fly-work.com/panel/users` |
| Purchases | GET | `https://chatface.fly-work.com/panel/purchases` |

Ek path’ler:

| İşlem | URL |
|--------|-----|
| Tek kullanıcı | `GET {BASE}/users/{id}` |
| Kullanıcı güncelle | `PATCH {BASE}/users/{id}` |
| Tek satın alım | `GET {BASE}/purchases/{id}` |
| Kullanıcıya göre satın alımlar | `GET {BASE}/purchases?userId={id}` |

---

## 2. Etkinleştirme ve güvenlik

### Backend `.env`

```env
PANEL_API_ENABLED=true
PANEL_API_KEY=uzun_rastgele_bir_secret
PANEL_ALLOWED_IPS=1.2.3.4,5.6.7.8
PANEL_DAILY_DAYS=30
PANEL_TIMEZONE=Europe/Istanbul
PANEL_UTC_OFFSET_HOURS=3
```

| Değişken | Açıklama |
|----------|----------|
| `PANEL_API_ENABLED` | `true` değilse tüm `/panel/*` → **404** |
| `PANEL_API_KEY` | Boş = anahtar kontrolü yok (önerilmez) |
| `PANEL_ALLOWED_IPS` | Boş = IP kısıtı yok |
| `PANEL_DAILY_DAYS` | `analyse.daily` gün sayısı (7–90, varsayılan 30) |

---

## 3. Endpoint özeti

| Path | Metot | Açıklama |
|------|-------|----------|
| `/panel/health` | GET | Canlılık kontrolü |
| `/panel/analyse` | GET | Özet metrikler + günlük seri |
| `/panel/users` | GET | Sayfalı kullanıcı listesi |
| `/panel/users/:id` | GET | Tek kullanıcı |
| `/panel/users/:id` | PATCH | Kullanıcı güncelleme |
| `/panel/purchases` | GET | Sayfalı üyelik / satın alım geçmişi |
| `/panel/purchases/:id` | GET | Tek satın alım kaydı |

- Yanıt formatı: JSON (health minimal)
- Hedef yanıt boyutu: &lt; 64 KB
- Panel timeout: ~8 sn
- Sözleşme sürümü: **v2** (`analyse.contractVersion`)

---

## 4. Kimlik doğrulama

App Panel varsayılan olarak `Authorization: Bearer` **göndermez**.

Her istekte **biri** gerekli:

| Yöntem | Örnek |
|--------|--------|
| Header | `X-Panel-Key: <PANEL_API_KEY>` |
| Query | `?apiKey=<PANEL_API_KEY>` |

Opsiyonel: panel sunucusu IP’si `PANEL_ALLOWED_IPS` listesinde olmalı.

Mobil JWT panel uçlarında kullanılmaz.

**Hata kodları:**

| Kod | Anlam |
|-----|--------|
| 404 | Panel API kapalı (`PANEL_API_ENABLED=false`) |
| 403 | Geçersiz anahtar veya IP |
| 400 | Geçersiz parametre |
| 404 | Kayıt bulunamadı (users/purchases) |

---

## 5. Health

### `GET /panel/health`

**Yanıt (200):**

```json
{ "ok": true }
```

---

## 6. Analyse (metrikler)

### `GET /panel/analyse`

**Yanıt (200):**

```json
{
  "contractVersion": "2",
  "generatedAt": "2026-05-18T10:00:00.000Z",
  "summary": {
    "totalUsers": 15230,
    "loginsToday": 412,
    "newUsersToday": 89
  },
  "daily": [
    { "date": "2026-05-17", "logins": 380, "newUsers": 72 },
    { "date": "2026-05-18", "logins": 412, "newUsers": 89 }
  ]
}
```

### Metrik tanımları

| Panel alanı | Kaynak | Açıklama |
|-------------|--------|----------|
| `summary.totalUsers` | `COUNT(*)` `users` | Tüm kullanıcılar (guest dahil) |
| `summary.newUsersToday` | `users.created_at` | Bugün kayıt (Istanbul günü) |
| `summary.loginsToday` | `users.last_login_at` | Bugün son girişi bu güne düşen kullanıcı sayısı |
| `daily[].newUsers` | `created_at` GROUP BY gün | Son N gün |
| `daily[].logins` | `last_login_at` GROUP BY gün | Son N gün |

**Sınırlama:** Ayrı `login_events` tablosu yok. `last_login_at` çoğunlukla sosyal girişte güncellenir; misafir / token yenileme sayılmaz. Gerçek oturum-açma sayısı değil, yaklaşık metrik olarak yorumlayın.

Gün sınırı: `Europe/Istanbul` (UTC+3).

---

## 7. Users (kullanıcılar)

### Kanonik model: `PanelUser`

```json
{
  "id": "42",
  "email": "user@example.com",
  "displayName": "Ayşe Yılmaz",
  "phone": null,
  "status": "active",
  "createdAt": "2025-11-03T08:15:00.000Z",
  "lastLoginAt": "2026-05-14T19:22:00.000Z",
  "extras": {
    "authProvider": "google",
    "isGuest": false,
    "isPremium": true,
    "onboardingCompleted": true,
    "preferredLanguage": "tr",
    "country": "TR",
    "gender": "female",
    "aboutMe": null,
    "invitationCode": "ABC12XYZ",
    "premiumEndtime": "2026-12-01T00:00:00.000Z",
    "guestDeviceId": null,
    "onesignalPlayerId": "uuid-..."
  }
}
```

| Alan | Zorunlu | Tip | Not |
|------|---------|-----|-----|
| `id` | Evet | string | `users.id` |
| `email` | Hayır | string \| null | |
| `displayName` | Hayır | string \| null | `full_name` |
| `phone` | Hayır | null | ChatFace’te telefon alanı yok |
| `status` | Hayır | `active` \| `inactive` \| null | `is_active` |
| `createdAt` | Hayır | ISO-8601 \| null | |
| `lastLoginAt` | Hayır | ISO-8601 \| null | |
| `extras` | Hayır | object | Uygulamaya özel alanlar |

### `GET /panel/users`

| Parametre | Varsayılan | Max |
|-----------|------------|-----|
| `page` | 1 | — |
| `limit` | 20 | 100 |

**Yanıt:**

```json
{
  "users": [ /* PanelUser[] */ ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 15230,
    "totalPages": 762
  }
}
```

Sıralama: `created_at DESC`.

### `GET /panel/users/:id`

Tek `PanelUser` veya **404**.

### `PATCH /panel/users/:id`

Kısmi güncelleme; yalnızca gönderilen alanlar yazılır.

| Panel alanı | Veritabanı |
|-------------|------------|
| `email` | `email` |
| `displayName` | `full_name` |
| `status` | `is_active` (`active`→1, `inactive`/`banned`→0) |
| `extras.preferredLanguage` | `preferred_language` |
| `extras.country` | `country` |
| `extras.gender` | `gender` |
| `extras.aboutMe` | `about_me` |

`extras.isPremium`, `extras.authProvider` vb. **salt okunur** (RevenueCat / uygulama yönetir).

**Örnek PATCH:**

```json
{
  "displayName": "Yeni İsim",
  "status": "inactive",
  "extras": { "country": "DE", "preferredLanguage": "en" }
}
```

---

## 8. Purchases (üyelik satın alımları)

RevenueCat webhook’ları (`POST /api/webhooks/revenuecat`) işlendikçe `subscription_events` tablosuna kayıt düşer. Panel bu tablodan okur.

**Geçmiş veri:** Migration öncesi satın alımlar listede **yoktur**. Yalnızca migration sonrası gelen webhook olayları görünür.

### Kanonik model: `PanelPurchase`

```json
{
  "id": "99",
  "userId": "42",
  "userEmail": "user@example.com",
  "userDisplayName": "Ayşe Yılmaz",
  "eventType": "INITIAL_PURCHASE",
  "source": "revenuecat",
  "productId": "premium_monthly",
  "store": "APP_STORE",
  "periodType": "NORMAL",
  "purchasedAt": "2026-05-01T10:00:00.000Z",
  "expiresAt": "2026-06-01T10:00:00.000Z",
  "currency": "TRY",
  "price": 99.99,
  "premiumGranted": true,
  "status": "granted",
  "createdAt": "2026-05-01T10:00:01.000Z"
}
```

| Alan | Tip | Açıklama |
|------|-----|----------|
| `id` | string | `subscription_events.id` |
| `userId` | string | `users.id` |
| `userEmail` | string \| null | Join; liste/detayda dolu |
| `userDisplayName` | string \| null | Join `full_name` |
| `eventType` | string | RevenueCat event: `INITIAL_PURCHASE`, `RENEWAL`, `EXPIRATION`, … |
| `source` | string | Şu an: `revenuecat` |
| `productId` | string \| null | Mağaza ürün kimliği |
| `store` | string \| null | `APP_STORE`, `PLAY_STORE`, … |
| `periodType` | string \| null | `NORMAL`, `TRIAL`, … |
| `purchasedAt` | ISO-8601 \| null | Mağaza satın alma zamanı |
| `expiresAt` | ISO-8601 \| null | Abonelik bitiş |
| `currency` | string \| null | Örn. `TRY`, `USD` |
| `price` | number \| null | Satın alma para biriminde |
| `premiumGranted` | boolean | Premium verildi mi |
| `status` | string | `granted` \| `expired` \| `logged` |
| `createdAt` | ISO-8601 | Kaydın oluşturulma zamanı |

### `status` değerleri

| `status` | Koşul |
|----------|--------|
| `granted` | `premiumGranted === true` |
| `expired` | `eventType === EXPIRATION` |
| `logged` | Diğer (iptal, faturalama vb. — premium hemen değişmeyebilir) |

### RevenueCat event türleri (örnek)

| `eventType` | Premium etkisi |
|-------------|----------------|
| `INITIAL_PURCHASE` | Verilir |
| `RENEWAL` | Verilir |
| `PRODUCT_CHANGE` | Verilir |
| `UNCANCELLATION` | Verilir |
| `EXPIRATION` | Kaldırılır |
| `CANCELLATION`, `BILLING_ISSUE`, … | Loglanır; erişim genelde dönem sonuna kadar sürer |

### `GET /panel/purchases`

| Parametre | Açıklama |
|-----------|----------|
| `page` | Sayfa (varsayılan 1) |
| `limit` | Sayfa boyutu (varsayılan 20, max 100) |
| `userId` | Yalnızca bu kullanıcının kayıtları |
| `source` | Örn. `revenuecat` |
| `eventType` | Örn. `INITIAL_PURCHASE` |
| `premiumGranted` | `true` veya `false` |

**Örnek:** `GET /panel/purchases?page=1&limit=20&userId=42&premiumGranted=true`

**Yanıt (200):**

```json
{
  "purchases": [ /* PanelPurchase[] */ ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 340,
    "totalPages": 17
  }
}
```

Sıralama: `created_at DESC` (en yeni önce).

### `GET /panel/purchases/:id`

Tek `PanelPurchase` veya **404**.

### Panel UI önerisi

- **Satın alımlar tablosu:** `purchases[]` — tarih, kullanıcı, ürün, mağaza, fiyat, `eventType`, `status`
- **Kullanıcı detayında alt liste:** `GET /purchases?userId={id}`
- **Filtreler:** `eventType`, `premiumGranted`, tarih aralığı (panel tarafında client-side veya ileride `from`/`to` eklenebilir)

---

## 9. Alan eşleme tabloları

### PanelUser ↔ `users`

| Panel | ChatFace |
|-------|----------|
| `id` | `id` |
| `email` | `email` |
| `displayName` | `full_name` |
| `status` | `is_active` → active/inactive |
| `createdAt` | `created_at` |
| `lastLoginAt` | `last_login_at` |
| `extras.isPremium` | `is_premium` |
| `extras.premiumEndtime` | `premium_endtime` |
| `extras.authProvider` | `auth_provider` |
| `extras.isGuest` | `is_guest` |
| `extras.onboardingCompleted` | `onboarding_completed` |
| `extras.preferredLanguage` | `preferred_language` |
| `extras.country` | `country` |
| `extras.gender` | `gender` |
| `extras.aboutMe` | `about_me` |
| `extras.invitationCode` | `invitation_code` |

### PanelPurchase ↔ `subscription_events`

| Panel | Veritabanı |
|-------|------------|
| `id` | `id` |
| `userId` | `user_id` |
| `eventType` | `event_type` |
| `source` | `source` |
| `productId` | `product_id` |
| `store` | `store` |
| `periodType` | `period_type` |
| `purchasedAt` | `purchased_at` |
| `expiresAt` | `expires_at` |
| `currency` | `currency` |
| `price` | `price` |
| `premiumGranted` | `premium_granted` |
| `createdAt` | `created_at` |

Ham webhook gövdesi: `raw_payload` (JSON) — panel API yanıtında **döndürülmez**; gerekirse backend’de ayrı admin aracı ile incelenir.

---

## 10. Veritabanı migration

Satın alım listesi için tablo gerekir:

```bash
mysql -u ... -p ... < migrations/20260518_add_subscription_events.sql
```

Tablo: `subscription_events` — RevenueCat webhook’ları her olayda buraya yazılır (webhook başarısı bundan bağımsızdır; yazma hatası loglanır, RevenueCat yine 200 alır).

---

## 11. Test curl komutları

```bash
export PANEL_BASE=http://localhost:3000/panel
export PANEL_KEY=your_panel_secret

# Health
curl -s -H "X-Panel-Key: $PANEL_KEY" "$PANEL_BASE/health"

# Metrikler
curl -s -H "X-Panel-Key: $PANEL_KEY" "$PANEL_BASE/analyse" | jq .

# Kullanıcılar
curl -s -H "X-Panel-Key: $PANEL_KEY" "$PANEL_BASE/users?page=1&limit=5" | jq .
curl -s -H "X-Panel-Key: $PANEL_KEY" "$PANEL_BASE/users/1" | jq .

# Satın alımlar
curl -s -H "X-Panel-Key: $PANEL_KEY" "$PANEL_BASE/purchases?page=1&limit=10" | jq .
curl -s -H "X-Panel-Key: $PANEL_KEY" "$PANEL_BASE/purchases?userId=42" | jq .
curl -s -H "X-Panel-Key: $PANEL_KEY" "$PANEL_BASE/purchases/1" | jq .

# Kullanıcı güncelleme
curl -s -X PATCH -H "Content-Type: application/json" -H "X-Panel-Key: $PANEL_KEY" \
  -d '{"displayName":"Panel Test"}' \
  "$PANEL_BASE/users/1" | jq .
```

Query ile anahtar: `"$PANEL_BASE/health?apiKey=$PANEL_KEY"`

---

## 12. Panel kontrol listesi

- [ ] `PANEL_API_ENABLED=true` ve `PANEL_API_KEY` üretimde tanımlı
- [ ] Panel sunucusu IP’si `PANEL_ALLOWED_IPS` içinde (kullanılıyorsa)
- [ ] Health URL kayıtlı
- [ ] Analyse URL kayıtlı
- [ ] Users URL kayıtlı (`/users`, `/users/{id}`, PATCH)
- [ ] **Purchases URL kayıtlı** (`/purchases`, `/purchases/{id}`)
- [ ] İsteklerde `X-Panel-Key` veya `apiKey`
- [ ] Dashboard özet: `totalUsers`, `loginsToday`, `newUsersToday`
- [ ] Grafik: `daily[]`
- [ ] Kullanıcı listesi + düzenleme formu
- [ ] Satın alım listesi + kullanıcı detayında `?userId=`
- [ ] Migration `20260518_add_subscription_events.sql` çalıştırıldı

---

## Mimari (backend referans)

```
/panel
  routes/panel.js
  middleware/panelAuth.js
  controllers/panelController.js
  services/panel/
    panelUserMapper.js / panelUserService.js
    panelAnalyticsService.js
    panelPurchaseMapper.js / panelPurchaseService.js
  services/subscriptionEventRepository.js  ← RevenueCat webhook yazar
  utils/panelTimezone.js

/api/webhooks/revenuecat  ← mobil akış; panelden ayrı
```

---

## Sürüm

- **contractVersion:** `2` (`GET /panel/analyse`)
- Şablon kaynağı: `INTEGRATION_TEMPLATE.md` (App Panel v2)

Sorular veya `from`/`to` tarih filtresi, `raw_payload` panelde gösterme gibi genişletmeler için backend ekibiyle iletişime geçin.
