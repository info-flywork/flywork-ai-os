# App Panel

Mobil uygulamalarin durumunu ve analiz metriklerini takip etmek icin yonetim paneli.

Bu ilk adimda sadece giris (auth) altyapisi kuruldu.

## Roller

- `SUPER_ADMIN`
- `ADMIN`
- `USER`

## Kurulum

1. Ornek ortam dosyasini kopyalayin:

```bash
cp .env.example .env
```

2. Paketleri kurun:

```bash
npm install
```

3. MySQL'de veritabani olusturun (isterseniz `database/schema.sql` dosyasini calistirin).

4. Super Admin olusturun:

```bash
npm run seed
```

5. Ornek uygulamalari ekleyin:

```bash
npm run seed:apps
```

6. Uygulamayi baslatin:

```bash
npm run dev
```

## Giris Akisi

- `GET /login.html`: Giris sayfasi
- `POST /api/auth/login`: Email/sifre ile cookie tabanli giris
- `POST /api/auth/logout`: Cikis
- `GET /api/auth/me`: Aktif kullanici bilgisi
- `GET /panel`: App Store Connect benzeri uygulama secim ekrani
- `GET /api/apps`: Uygulama listesi
- `GET /apps/new`: Uygulama ekleme sayfasi
- `GET /apps/:id/edit`: Uygulama duzenleme sayfasi
- `POST /api/apps`: Yeni uygulama ekleme (SUPER_ADMIN ve ADMIN)
- `GET /api/apps/:id`: Uygulama detay bilgisi
- `PUT /api/apps/:id`: Uygulama guncelleme (SUPER_ADMIN ve ADMIN)
- `GET /api/apps/:id/ping`: Kayitli Health ve Analyse URL'lerine sunucudan test istegi (cookie ile giris gerekir)

## Veritabani guncellemesi (mevcut kurulum)

Eksik kolonlar icin migration dosyalarini **sirayla** calistirin. `#1060 Duplicate column` alirsaniz o dosyayi atlayin (kolon zaten var):

```bash
# 001/002 — analyse/health/users URL (varsa atla)
mysql -u root -p < database/migrations/003_application_api_base_and_panel_slug.sql
mysql -u root -p < database/migrations/004_application_panel_api_key.sql
```

Alternatif: sunucu acilista `ensureAppColumns` eksik kolonlari eklemeye calisir; `npm run seed:apps` Friendify kaydini gunceller.

## Dis API entegrasyonu (AI ve gelistiriciler icin)

| Dosya | Icerik |
|-------|--------|
| `docs/EXTERNAL_API_CONTRACT.md` | Genel v2 sozlesme |
| `docs/INTEGRATION_TEMPLATE.md` | Mapping + AI prompt sablonu |
| `apps/friendify/README.md` | **Friendify** ozel entegrasyon (taban URL, API key) |
| `apps/friendify/PANEL_INTEGRATION_FRIENDIFY.md` | Friendify ekibinin hazirladigi rehber |
| `apps/friendify/EXTERNAL_API_CONTRACT.md` | Friendify JSON alanlari |

Friendify icin `.env`: `FRIENDIFY_PANEL_API_KEY=` (Friendify `PANEL_API_KEY` ile ayni).

Slim30 icin: `apps/slim30/PANEL_API.md`, panel ekrani `slim30`, `.env` → `SLIM30_PANEL_API_KEY`, `SLIM30_REVENUECAT_PROJECT_ID`.

Sixpack30 icin: `apps/sixpack/PANEL_API.md`, panel ekrani `sixpack30`, `.env` → `SIXPACK30_PANEL_API_KEY`, `SIXPACK30_REVENUECAT_PROJECT_ID` (satın alım listesi yalnızca RevenueCat).

Her uygulama icin zorunlu veriler: toplam kullanici, gunluk giris, gunluk yeni kullanici, tarihe gore giris serisi, tum kullanici listesi ve PATCH ile duzenleme. Uygulama bazinda farkli user modelleri `extras` ve mapping tablosu ile kanonik **PanelUser** semasina map edilir.

## Sonraki Adim

Bir sonraki iterasyonda:

- Yetki bazli sayfa erisimi
- Uygulama listesi ve gunluk saglik durumu takibi
- Hata loglari ve temel metrik panelleri
