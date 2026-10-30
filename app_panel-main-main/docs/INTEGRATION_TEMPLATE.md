# App Panel — Entegrasyon şablonu (v2)

Bu belge, **mobil uygulama backend ekiplerinin** App Panel ile entegrasyon için hazırlaması gereken API katmanını tanımlar. Panel sunucusu bu şablondaki uçları proxy eder; karşı taraf önce **kendi uygulamasına özel dokümantasyonu** üretir, ardından App Panel ekibi UI ve route’ları bağlar.

**İlgili dosyalar:**

| Dosya | Rol |
|-------|-----|
| `docs/EXTERNAL_API_CONTRACT.md` | Kanonik JSON alanları (tüm uygulamalar) |
| `apps/{slug}/PANEL_API.md` | **Sizin üreteceğiniz** uygulama özel rehber (zorunlu teslim) |
| `apps/{slug}/EXTERNAL_API_CONTRACT.md` | Alan eşleme + `extras` sözlüğü (önerilir) |

---

## 1. Bu turda entegre edilecek 3 uygulama

Aşağıdaki tabloda her uygulama için **hangi modüllerin zorunlu / opsiyonel** olduğunu işaretleyin. Panel tarafı `panel_slug` ve `api_base_url` ile eşleşir.

| Modül | Açıklama | Uygulama A | Uygulama B | Uygulama C |
|-------|----------|------------|------------|------------|
| Health | Canlılık | ☐ | ☐ | ☐ |
| Analyse | Kullanıcı metrikleri + günlük seri | ☐ | ☐ | ☐ |
| Analyse (antrenman) | `workoutsSummary`, günlük tamamlama | ☐ | ☐ | ☐ |
| Users | Liste, detay, PATCH | ☐ | ☐ | ☐ |
| **Workouts** | Katalog + **admin CRUD** | ☐ | ☐ | ☐ |
| **User workouts** | Kullanıcı oturum geçmişi | ☐ | ☐ | ☐ |
| Purchases (backend) | `/panel/purchases` listesi | ☐ | ☐ | ☐ |
| RevenueCat (panel) | Sadece `revenuecat_project_id` — backend uç yok | ☐ | ☐ | ☐ |
| Agents / diğer | Uygulamaya özel | ☐ | ☐ | ☐ |

**Örnek doldurma (mevcut panel uygulamaları):**

| `panel_slug` | Zorunlu çekirdek | Antrenman | Satın alım | Gelir |
|--------------|------------------|-----------|------------|--------|
| `friendify` | health, analyse, users, agents | — | — | RevenueCat |
| `mindcoach` | health, analyse, users, agents | — | — | RevenueCat |
| `chatface` | health, analyse, users | — | `/panel/purchases` | RevenueCat + backend liste |
| `sixpack30` | health, analyse, users, workouts, user-workouts | — | — | RevenueCat only |

**Yeni fitness / antrenman odaklı 3 uygulama** için genelde şunlar **zorunlu** kabul edilir:

- Health, Analyse (+ antrenman özeti), Users  
- **Workouts** (admin antrenman ekleyebilmeli)  
- **User workouts**  
- RevenueCat project id (gelir kartları) ve isteğe bağlı `/panel/purchases`

---

## 2. Mimari ilke

```
┌──────────────────┐   API Key (header)    ┌─────────────────────────┐
│  App Panel       │ ────────────────────► │  Uygulama API           │
│  (Node, proxy)   │   GET/PATCH/POST      │  /panel veya /panel/v1  │
└────────┬─────────┘                       └───────────┬─────────────┘
         │                                             │
         │  RevenueCat v2 (gelir grafikleri)           │  Mobil /api/*
         └────────────────────────────────────────────►│  (dokunulmaz)
```

1. Tüm panel uçları **ayrı prefix** altında (`/panel`, `/panel/v1`, …).  
2. Mobil JWT veya kullanıcı oturumu panelde **kullanılmaz**.  
3. Tek paylaşılan secret: `PANEL_API_KEY` (uygulama `.env`) = App Panel `applications.panel_api_key`.  
4. Mapping katmanı: DB alanları → kanonik `PanelUser`, `PanelWorkout`, … (`docs/EXTERNAL_API_CONTRACT.md`).

---

## 3. Karşı API ekibinin teslim etmesi gerekenler

Her uygulama için **tek bir ana dosya** oluşturun (ChatFace örneği: `apps/chatface/PANEL_API.md`):

### 3.1 Zorunlu bölümler (`PANEL_API.md`)

1. **Base URL** — yerel ve üretim; panelde kayıtlı tam URL tablosu (health, analyse, users, workouts, …).  
2. **Ortam değişkenleri** — `PANEL_API_KEY`, timezone, sayfalama limitleri.  
3. **Kimlik doğrulama** — hangi header, hata kodları (403/404/503).  
4. **Endpoint tablosu** — path, metot, kısa açıklama.  
5. **JSON örnekleri** — her endpoint için gerçekçi request/response.  
6. **Alan eşleme** — DB kolonu → kanonik alan (`extras` dahil).  
7. **Metrik tanımları** — `loginsToday`, `workoutsCompletedToday` nasıl hesaplanıyor.  
8. **Test curl** — en az health + analyse + bir liste endpoint.  
9. **Panel kontrol listesi** — hangi modüller açık, hangileri “yok / RC only”.

### 3.2 Antrenman modülü dokümantasyonu (fitness uygulamaları)

Ayrı alt başlık veya `PANEL_WORKOUTS_API.md` ile:

| Konu | Dokümante edin |
|------|----------------|
| Admin oluşturma | `POST /panel/workouts` zorunlu alanlar, validasyon |
| Yayın akışı | `draft` → `published` → `archived` |
| Medya | Kapak / video URL nerede saklanıyor (`extras` mi ayrı kolon mu) |
| Egzersiz detayı | Set/tekrar listesi `extras.exercises` şeması |
| Silme | Hard delete mi soft delete mi |
| Kullanıcı oturumu | `user-workouts` oluşturma mobilde mi; panel sadece okur mu |
| Analiz | `analyse` içindeki antrenman alanlarının SQL/logic kaynağı |

### 3.3 Üyelik ve gelir

| Yöntem | Backend yapması gereken | App Panel yapması gereken |
|--------|-------------------------|---------------------------|
| **RevenueCat** | Mobil SDK + RC proje; panelde `revenuecat_project_id` | `.env` `REVENUECAT_API_KEY`, overview / grafik / satın alım feed |
| **Backend purchases** | `GET /panel/purchases` implementasyonu | Proxy + “Satın alımlar” sekmesi |
| **Hibrit** | RC + kendi webhook tablosu | Dokümanda hangi sekmenin hangi kaynağı kullandığını yazın |

Backend ekibi RC kullanıyorsa **`/panel/purchases` implement etmek zorunda değildir**; bunu `PANEL_API.md` içinde açıkça belirtin.

---

## 4. Standart endpoint seti

Prefix: `{BASE}` = örn. `https://api.example.com/panel` veya `.../panel/v1`

### 4.1 Çekirdek (tüm uygulamalar)

| Path | Metot | Açıklama |
|------|-------|----------|
| `{BASE}/health` | GET | Canlılık |
| `{BASE}/analyse` | GET | Özet + `daily[]` |
| `{BASE}/users` | GET | Sayfalı liste |
| `{BASE}/users/:id` | GET | Detay |
| `{BASE}/users/:id` | PATCH | Admin düzenleme |

### 4.2 Antrenman kataloğu (admin)

| Path | Metot | Açıklama |
|------|-------|----------|
| `{BASE}/workouts` | GET | Katalog listesi |
| `{BASE}/workouts` | **POST** | **Yeni antrenman (admin)** |
| `{BASE}/workouts/:id` | GET | Detay |
| `{BASE}/workouts/:id` | PATCH | Güncelle |
| `{BASE}/workouts/:id` | DELETE | Sil / arşivle |

**Admin antrenman ekleme** panel UI’dan `POST` ile yapılır; backend validasyon ve yetki yalnızca `PANEL_API_KEY` ile sınırlıdır (ayrı admin JWT gerekmez).

Örnek **POST** gövdesi:

```json
{
  "title": "Sabah HIIT",
  "description": "20 dk tam vücut",
  "status": "published",
  "difficulty": "intermediate",
  "durationMinutes": 20,
  "category": "cardio",
  "coverImageUrl": "https://cdn.example.com/cover.jpg",
  "extras": {
    "exercises": [
      { "name": "Jumping Jack", "sets": 3, "reps": 20, "restSeconds": 30 }
    ],
    "locale": "tr"
  }
}
```

### 4.3 Kullanıcı antrenman verileri

| Path | Metot | Açıklama |
|------|-------|----------|
| `{BASE}/user-workouts` | GET | Filtreli tüm oturumlar |
| `{BASE}/users/:userId/workouts` | GET | Tek kullanıcı oturumları |
| `{BASE}/user-workouts/:id` | GET | Oturum detayı |
| `{BASE}/user-workouts/:id` | PATCH | Opsiyonel admin düzeltme |

### 4.4 Üyelik (backend listesi — opsiyonel)

| Path | Metot | Açıklama |
|------|-------|----------|
| `{BASE}/purchases` | GET | Sayfalı satın alımlar |
| `{BASE}/purchases/:id` | GET | Tek kayıt |

Şema: `docs/EXTERNAL_API_CONTRACT.md` → PanelPurchase.

---

## 5. Analyse — kullanıcı ve antrenman analitiği

### 5.1 Kullanıcı metrikleri (zorunlu)

| Panel alanı | Beklenti |
|-------------|----------|
| `summary.totalUsers` | Kayıtlı kullanıcı sayısı |
| `summary.loginsToday` | Tanımı dokümante edin (son giriş / oturum tablosu / aktivite) |
| `summary.newUsersToday` | Bugün oluşturulan hesaplar |
| `daily[].date` | `YYYY-MM-DD`, timezone dokümanda |
| `daily[].logins` | Gün bazlı |
| `daily[].newUsers` | Gün bazlı |

### 5.2 Antrenman metrikleri (fitness — önerilen)

| Panel alanı | Beklenti |
|-------------|----------|
| `summary.totalWorkouts` | Katalog kayıt sayısı |
| `summary.publishedWorkouts` | Yayında olanlar |
| `summary.workoutsCompletedToday` | Bugün `status=completed` oturum sayısı |
| `summary.activeWorkoutUsersToday` | Bugün tamamlayan benzersiz `userId` |
| `daily[].workoutsCompleted` | Gün bazlı tamamlanan oturum |
| `daily[].workoutMinutes` | Gün bazlı toplam süre |
| `workoutsSummary` | İsteğe bağlı: en çok yapılan antrenmanlar, kategori dağılımı |

`PANEL_DAILY_DAYS` veya eşdeğeri: 7–90 gün (varsayılan 30).

---

## 6. Kullanıcı verileri (`PanelUser`)

- Liste: arama (`search`) email, isim, telefon — hangi kolonlar dokümanda.  
- `extras`: premium, cihaz, onboarding, **aktif abonelik özeti** (RC’den kopyalanmış alanlar olabilir).  
- PATCH: hangi alanların yazılabildiği (ör. `status`, `email`, `extras.isPremium`).

Kullanıcı detay ekranında panel şunları birleştirir:

1. `GET /users/:id`  
2. `GET /users/:userId/workouts` (varsa)  
3. RevenueCat müşteri araması (e-posta / app user id) — backend uç gerekmez  

---

## 7. App Panel tarafı (entegrasyon sonrası)

Backend dokümantasyonu onaylandıktan sonra App Panel ekibi:

| Adım | Dosya / iş |
|------|------------|
| DB | `applications`: `api_base_url`, `panel_api_key`, `panel_slug`, `revenuecat_project_id` |
| Proxy | `src/utils/appApi.js` → `workouts`, `userWorkouts` path’leri |
| Routes | `src/routes/apps.routes.js` → `GET/POST/PATCH/DELETE .../workouts` |
| UI | `apps-{slug}.html` + `{slug}-panel.js` — sekmeler: Özet, Kullanıcılar, **Antrenmanlar**, Satın alımlar / Gelir |
| RC | `revenuecat-panel.js`, `rc-purchases-panel.js` (proje id varsa) |
| Seed | `src/scripts/seedApps.js` |

Antrenman sekmesi minimum özellikler:

- Katalog tablosu (durum, süre, kategori filtreleri)  
- **Yeni antrenman** formu → `POST /workouts`  
- Düzenle / arşivle → `PATCH`, `DELETE`  
- Kullanıcı sayfasında “Antrenman geçmişi” alt listesi  

---

## 8. Ortam değişkenleri özeti

### 8.1 Uygulama backend `.env`

```env
PANEL_API_KEY=uzun-rastgele-secret
PANEL_API_ENABLED=true
PANEL_TIMEZONE=Europe/Istanbul
PANEL_DAILY_DAYS=30
# Opsiyonel IP kısıtı
PANEL_ALLOWED_IPS=
```

### 8.2 App Panel `.env` (her uygulama)

```env
{SLUG_UPPER}_PANEL_API_KEY=...          # backend PANEL_API_KEY ile aynı
{SLUG_UPPER}_REVENUECAT_PROJECT_ID=proj_...
REVENUECAT_API_KEY=sk_v2_...
REVENUECAT_CURRENCY=USD
```

---

## 9. Uygulama ekibi kontrol listesi

- [ ] `/panel` mount edildi; mobil rotalar etkilenmedi  
- [ ] `PANEL_API_KEY` üretimde tanımlı  
- [ ] `PANEL_API.md` oluşturuldu (Bölüm 3.1)  
- [ ] Health + Analyse curl ile test edildi  
- [ ] Users liste/detay/PATCH örnek JSON verildi  
- [ ] **Workouts:** POST/PATCH/DELETE admin akışı dokümante ve test edildi  
- [ ] **User workouts:** liste + filtreler dokümante edildi  
- [ ] Analyse antrenman alanları (varsa) hesap mantığı yazıldı  
- [ ] Purchases veya “yalnızca RevenueCat” kararı net  
- [ ] `revenuecat_project_id` Fly Work panel ekibine iletildi  
- [ ] `extras` alan sözlüğü tablo halinde  

---

## 10. Yapay zeka / geliştirici prompt’u (kopyala-yapıştır)

Aşağıdaki metni uygulama reposuna vererek `apps/{slug}/PANEL_API.md` üretin:

```text
Görev: App Panel v2 entegrasyon dokümantasyonu yaz.

Kaynak şablonlar (App Panel reposu):
- docs/INTEGRATION_TEMPLATE.md
- docs/EXTERNAL_API_CONTRACT.md

Uygulama: [AD]
panel_slug: [slug]
Base path: [/panel veya /panel/v1]
Auth header: [X-Panel-Key | X-Panel-Api-Key | Bearer]

Üretilecek dosya: apps/[slug]/PANEL_API.md

Zorunlu içerik:
1) Base URL tablosu (health, analyse, users, workouts, user-workouts, purchases varsa)
2) .env değişkenleri
3) Tüm endpoint'ler (metot + path + açıklama)
4) Her endpoint için örnek JSON request/response
5) PanelUser, PanelWorkout, PanelUserWorkout, PanelPurchase alan eşleme tabloları (DB kolonu → kanonik alan)
6) Analyse metriklerinin SQL/iş kuralı tanımı (loginsToday, workoutsCompletedToday, daily serisi)
7) Admin antrenman: POST /workouts zorunlu alanlar ve status akışı (draft/published/archived)
8) Üyelik: /panel/purchases var mı yoksa sadece RevenueCat mi — açıkça belirt
9) En az 5 curl örneği
10) Panel kontrol listesi (işaretli modüller)

Kanonik şemaya uy; alan adlarını değiştirme. Uygulamaya özel verileri extras içinde dokümante et.
Mobil /api rotalarına dokunma; yalnızca /panel katmanı.
```

---

## 11. Sürüm ve uyumluluk

| Öğe | Değer |
|-----|--------|
| Sözleşme | v2 (`contractVersion: "2"`) |
| Geriye dönük | v1 uçları kaldırılmadan yeni path eklenir |
| Friendify prefix | `/panel/v1` (diğerleri genelde `/panel`) |

Şablon güncellemeleri `docs/INTEGRATION_TEMPLATE.md` üzerinden yapılır; uygulama özel dosyalar `apps/{slug}/` altında kalır.

---

## 12. Referans implementasyonlar

| Uygulama | Doküman | Not |
|----------|---------|-----|
| ChatFace | `apps/chatface/PANEL_API.md` | purchases backend |
| MindCoach | `apps/mindcoach/PANEL_ENTEGRASYON.md` | agents, rehberler |
| Friendify | `apps/friendify/PANEL_INTEGRATION_FRIENDIFY.md` | `/panel/v1`, agents |

Antrenman modülü için henüz referans uygulama yok; ilk fitness backend bu şablona göre `PANEL_API.md` üretecek.
