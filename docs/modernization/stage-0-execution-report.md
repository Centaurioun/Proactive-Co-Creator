# Stage 0 — Ürün, UX ve Teknik Taban (Baseline) İcra Raporu

**Proje:** Proactive Co-Creator 2.0 (`https://github.com/Centaurioun/Proactive-Co-Creator`)  
**Spesifikasyon:** `docs/modernization/2026-11-24-stage-0-product-ux-technical-baseline-execution-plan.md`  
**Rapor Tarihi:** `2026-11-23`  
**Kapsam Sınırı:** Yalnızca **Stage 0** (UI yeniden tasarımı yok, Figma dosyası üretimi yok, yeni özellik yok, Schema v3 değişikliği yok, ücretli Gemini API çağrısı yok).

---

## 1. Yönetici Özeti (Executive Outcome)

### Ne Tamamlandı?
- **CI Tarayıcı Kurulum Kök Nedeni Onarıldı (S0.1 — Yerel Olarak Doğrulandı):** `.github/workflows/ci.yml` içindeki `--only-shell` uyumsuzluğu kaldırıldı (`playwright-cli install-browser chromium --with-deps`), `/api/health` (`"configured":false`) ön kontrolü, hata ekran görüntüsü/trace kaydı ve fail-closed JSON doğrulaması (`e2e-results.json`) eklendi. Mevcut 9 senaryo (`E2E-A`–`E2E-I`) gerçek headless Chromium üzerinde anahtarsız production sunucusuna karşı **9/9 PASS** (`0` ücretli/mocksuz API isteği) ile doğrulandı.
- **Deterministik Görsel Taban ve 16 Ekran Görüntüsü Üretildi (S0.2):** Schema v3 üreten deterministik fikstürler (`FX-EMPTY`, `FX-SIMPLE`, `FX-BUSY`, `FX-OUT`, `FX-STRESS-10/30/100/250`) ve tek komutluk yakalama hattı (`scripts/capture-ux-baseline.sh`) oluşturuldu. **`SC-01.png`–`SC-16.png`** üretildi, IHDR/boyut kontrolünden geçti ve görsel olarak tek tek incelendi.
- **Gerçek Tarayıcıda 12 Kullanıcı Yolculuğu (J01–J12) Çalıştırıldı (S0.3):** Tüm 12 yolculuk gerçek Chromium üzerinde tamamlandı (`12/12 PASS`, `0` mocksuz API isteği). Ekran envanteri, yolculuk haritası ve kanıta dayalı bulgu kaydı (`F-01`–`F-15`) dokümante edildi.
- **Erişilebilirlik, Responsive ve Performans Ölçüldü (S0.4 & S0.5):** 6 kırılım noktasında (`1440×900`, `1280×800`, `768×1024`, `390×844`, `320×568`, `720×450`) gerçek DOM/kontrast/odak ölçümleri, Vite bundle profili, Node.js `computeForceLayout` (`10`/`30`/`100`/`250` düğüm) ve `8.000+` karakter prompt sınırı ile Chromium render/bellek ölçümleri alındı.
- **Doğrulanmış 2 Kritik P1 Erişilebilirlik Hatası RED → GREEN → REFACTOR ile Onarıldı (S0.7):**
  1. `F-02` (`components/BeliefGraph.tsx`): Tablo Görünümü satırları klavye ile erişilebilir hale getirildi (`0/28` → **`28/28`** odaklanabilir satır).
  2. `F-03` (`components/OutputGallery.tsx` & `components/InfoModal.tsx`): Tam ekran görsel Lightbox ve Hakkında modalına odak girişi, `Tab`/`Shift+Tab` odak tuzağı ve `Escape` sonrası tetikleyiciye odak iadesi eklendi.
- **Eksiksiz Figma Handoff Paketi Hazırlandı (S0.6):** `docs/ux-baseline/figma-handoff.md` (korunan yetenekler matrisi, "icat etme" sınırları, veri akışı, tasarım token'ları, 3 aday yön analizi, ilk 5 test edilebilir UX hipotezi) ve `docs/ux-baseline/quality-gates.md` yazıldı.

### Ne Tamamlanamadı? (Şeffaf BLOKLU Durum)
- **Uzak GitHub Push ve Canlı GitHub Actions Çalıştırması (`G8`):** Çalıştırma sandbox'ında `.git` deposu ve GitHub push kimlik bilgileri bulunmadığı için değişiklikler uzak `main` dalına push edilemedi ve yeni bir uzak GitHub Actions koşusu tetiklenemedi. Bu nedenle **`G8` açıkça `BLOCKED`** olarak işaretlenmiştir (sahte `PASS` verilmemiştir).

### Figma Tasarım Aşaması İçin Karar (Go / No-Go)
- **Figma Keşfi İçin Karar: KOŞULLU GO (Conditional GO)**
  - Tasarım ekibi `docs/ux-baseline/figma-handoff.md`, `screen-inventory.md`, `journey-map.md`, `findings.md`, `measurements.md` ve `SC-01`–`SC-16` ekran görüntüleriyle Figma keşfine **hemen başlayabilir** (kod deposu erişimi gerekmeden kendi kendine yeterlidir).
  - **Stage 1 Kodlamasına Geçiş İçin Ön Koşul (No-Go until cleared):** Depo sahibi bu oturumdaki yerel değişiklikleri `main` dalına commit/push edip GitHub Actions üzerinde hem `Verify (Node 22.x)` hem de `Browser E2E Smoke (Chromium)` işlerinin canlı yeşil (`PASS`) olduğunu doğrulayarak **`G8` kapısını açmalıdır**.

---

## 2. Depo Gerçekleri (Repo Facts & Changed-File Inventory)

| Alan | Gerçek Gözlemlenen Değer |
| :--- | :--- |
| **Başlangıç Uzak `main` SHA** | `03e9fda79f00fc9d27984142dcb188f099f28fde` (`2026-11-23T22:07:36Z` — plandaki tarihsel `faf580e` SHA'sından 1 commit ileride) |
| **Yerel Kontrol Noktası (Checkpoint)** | `/tmp/stage0-checkpoint-03e9fda` (SHA-256: `6ca96f21fae03cb356984f6b70e6160bbbdbc4bcfbcbf9274357c7585ad02266`) |
| **Final Yerel Git SHA** | `YOK` (sandbox çalışma alanında `.git` dizini mevcut değil; yerel dosyalar doğrulandı) |
| **Final Uzak `main` SHA** | `03e9fda79f00fc9d27984142dcb188f099f28fde` (**değişmedi** — uzak push yapılmadı) |
| **Dal / Push Durumu** | `BLOCKED` (git deposu/kimlik bilgisi eksikliği; force-push kesinlikle yapılmadı) |

### Değiştirilen ve Eklenen Dosya Envanteri (`diff -rq` vs `/tmp/stage0-checkpoint-03e9fda`)

**Değiştirilen Mevcut Dosyalar (6 dosya):**
1. `.github/workflows/ci.yml` — `--only-shell` kaldırıldı, `/api/health` (`configured:false`) ön kontrolü ve 14 günlük başarısızlık/sonuç artefakt yüklemesi eklendi (`GEMINI_API_KEY` dizesi **0** kez geçer).
2. `scripts/e2e-browser-smoke.sh` — `/api/health` ön kontrolü, eyleme dönük tarayıcı kurulum tanısı, hata ekran görüntüsü + Playwright trace (`.zip`), yapısal `e2e-results.json` ve fail-closed Node doğrulaması eklendi.
3. `tests/releaseQualification.test.ts` — `Task 3c (S0.1)` CI/E2E gerileme kilit testleri eklendi.
4. `components/BeliefGraph.tsx` — `S0.7-FIX-1`: Tablo Görünümü varlık ve ilişki `<tr>` satırlarına `tabIndex={0}`, `role="button"`, `aria-label`, `Enter`/`Space` klavye desteği ve `focus-visible` halkası eklendi.
5. `components/OutputGallery.tsx` — `S0.7-FIX-2a`: Tam ekran görsel Lightbox için odak girişi, `Tab`/`Shift+Tab` odak tuzağı ve `Escape`/kapatma sonrası odak iadesi eklendi.
6. `components/InfoModal.tsx` — `S0.7-FIX-2b`: Hakkında modalı için odak girişi, `Tab`/`Shift+Tab` odak tuzağı ve `Escape`/kapatma sonrası odak iadesi eklendi.

**Yeni Eklenen Test, Betik ve Dokümantasyon Dosyaları:**
- `tests/stage0Accessibility.test.ts` — `F-02` ve `F-03` için 3 RED → GREEN erişilebilirlik birim testi.
- `scripts/stage0-fixtures.ts` — Deterministik Schema v3 fikstür üreteci (`FX-EMPTY`, `FX-SIMPLE`, `FX-BUSY`, `FX-OUT`, `FX-STRESS-10/30/100/250`).
- `scripts/stage0-perf-bench.ts` — Node.js `computeForceLayout`, prompt sentezi, tutarlılık denetimi ve `8.000+` karakter sınırı ölçüm betiği.
- `scripts/capture-ux-baseline.sh` — 16 ekran görüntüsünü ve `manifest.json` dosyasını anahtarsız/ücretsiz üreten betik.
- `scripts/stage0-audit-browser.sh` — `J01`–`J12` yolculukları + 6 kırılım noktası a11y/kontrast/odak + Chromium performans ölçüm betiği.
- `docs/ux-baseline/README.md`
- `docs/ux-baseline/screen-inventory.md`
- `docs/ux-baseline/journey-map.md`
- `docs/ux-baseline/findings.md`
- `docs/ux-baseline/measurements.md`
- `docs/ux-baseline/figma-handoff.md`
- `docs/ux-baseline/quality-gates.md`
- `docs/ux-baseline/assets/SC-01.png` … `SC-16.png` (16 adet doğrulanmış PNG) + `docs/ux-baseline/assets/manifest.json`
- `docs/modernization/stage-0-execution-report.md` (bu rapor)

**%100 Değişmeden Korunan Kritik Dizinler (`diff -rq` ile doğrulandı):**
- `lib/` — `0` değişiklik (`canonicalModel.ts`, `storageEngine.ts`, `projectController.ts`, `historyEngine.ts`, `nlBatchEngine.ts`, `promptBuilder.ts`, `consistencyChecker.ts`, `graphLayout.ts`)
- `shared/` — `0` değişiklik (`schemas.ts`, `types.ts`)
- `server/` — `0` değişiklik (`routes.ts`, `aiService.ts`, `geminiClient.ts`, `errors.ts`, `retry.ts`, `models.ts`)

---

## 3. İş Paketleri (`S0.0`–`S0.7`) ve Teslimat Kapıları (`G0`–`G9`) Matrisi

### İş Paketleri

| Paket | Durum | Doğrulama Kanıtı (Komut / Dosya / Çıktı) |
| :--- | :---: | :--- |
| **S0.0** — Taban, Checkpoint & README-UI Denetimi | **PASS** | Uzak `03e9fda` okundu; `/tmp/stage0-checkpoint-03e9fda` oluşturuldu; taban `102/102` test ve README-UI farkları doğrulandı. |
| **S0.1** — CI Tarayıcı Kurulum Kök Neden Onarımı | **PASS (Yerel) / BLOCKED (Uzak CI)** | `tests/releaseQualification.test.ts` Task 3c RED→GREEN; `E2E_BASE_URL=http://127.0.0.1:3100 bash scripts/e2e-browser-smoke.sh` → **9/9 PASS** (`.playwright-cli/e2e-results.json`). Uzak push/CI: `BLOCKED`. |
| **S0.2** — Fikstürler & 16 Görsel Taban Yakalama | **PASS** | `bash scripts/capture-ux-baseline.sh` → `docs/ux-baseline/assets/SC-01.png`–`SC-16.png` + `manifest.json` (`16/16 sanityCheck: PASS`, tümü görsel incelendi). |
| **S0.3** — J01–J12 Yolculuklar & Bulgu Envanteri | **PASS** | `bash scripts/stage0-audit-browser.sh` → `12/12 PASS` (`.playwright-cli/stage0-journeys.json`); `screen-inventory.md`, `journey-map.md`, `findings.md` yazıldı. |
| **S0.4** — Erişilebilirlik & Responsive Denetim | **PASS** | 6 viewport, kontrast, başlık/ARIA, odak, `prefers-reduced-motion` ölçüldü (`.playwright-cli/stage0-audit-metrics.json`, `docs/ux-baseline/measurements.md`). |
| **S0.5** — Performans, Bundle & Bakım Analizi | **PASS** | `npm run build` (`861.58 kB` raw / `231.67 kB` gz), `npx tsx scripts/stage0-perf-bench.ts` (`.playwright-cli/stage0-node-perf.json`) & Chromium 10/30/100/250 ölçümü. |
| **S0.6** — Figma Handoff & Kalite Kapıları | **PASS** | `docs/ux-baseline/figma-handoff.md` + `docs/ux-baseline/quality-gates.md` (sıfır UI yeniden tasarım kodu). |
| **S0.7** — Dar P1 Onarımlar & P1–P6 Adversarial İnceleme | **PASS** | `F-02` & `F-03` RED→GREEN (`tests/stage0Accessibility.test.ts` 3/3 + canlı Chromium doğrulaması); `106/106` test, `9/9` E2E yeniden koşuldu; P1–P6 tamamlandı. |

### Teslimat Kapıları (`G0`–`G9`)

| Kapı | Gereksinim | Durum | Kanıt / Gerekçe |
| :---: | :--- | :---: | :--- |
| **G0** | Güncel uzak SHA, checkpoint ve taban doğrulaması | **PASS** | `03e9fda79f00fc9d27984142dcb188f099f28fde` + `/tmp/stage0-checkpoint-03e9fda` |
| **G1** | Tarayıcı kurulum kök nedeni onarıldı | **PASS** | `.github/workflows/ci.yml` (`--only-shell` kaldırıldı) + `tests/releaseQualification.test.ts` Task 3c |
| **G2** | `E2E-A`–`E2E-I` gerçek Chromium üzerinde geçti | **PASS** | `scripts/e2e-browser-smoke.sh` → **9/9 PASS**, `apiHits: 0`, `pageErrors: 0`, `consoleErrors: 0` |
| **G3** | Tekrarlanabilir fikstür/yakalama + görsel incelenmiş 16 PNG | **PASS** | `SC-01.png`–`SC-16.png` + `manifest.json` (`16/16 PASS`) |
| **G4** | `J01`–`J12` akış envanteri ve gerçek tarayıcı kanıtı | **PASS** | `.playwright-cli/stage0-journeys.json` (`12/12 PASS`) + `journey-map.md` |
| **G5** | Gerçek odak/ekranlarla erişilebilirlik & responsive değerlendirme | **PASS** | `.playwright-cli/stage0-audit-metrics.json` + `measurements.md` + S0.7 P1 onarımları |
| **G6** | Bundle, graf ve UX performans ölçümleri + ortam bilgisi | **PASS** | `.playwright-cli/stage0-node-perf.json` + `measurements.md` (Node `v22.23.5`, 4 vCPU, 12.288 MB) |
| **G7** | Figma handoff ve "icat etme" yetenek matrisi | **PASS** | `docs/ux-baseline/figma-handoff.md` (sıfır UI kodu) |
| **G8** | Taze Node kontrolleri **VE** canlı uzak GitHub Actions browser CI | **BLOCKED** | Yerel Node (`106/106`), `build`, `lint`, `typecheck`, `server.ts` import ve yerel Chromium `9/9` **PASS**; ancak sandbox'ta `.git` ve GitHub push yetkisi olmadığı için **uzak GitHub Actions koşusu doğrulanamadı**. |
| **G9** | Gerçek uygulama sonrası altı döngülü adversarial inceleme (`P1`–`P6`) | **PASS** | Bölüm 12'de gerçek diff, yeniden test ve bulgu düzeltmeleriyle belgelendi. |

---

## 4. CI Regresyon Analizi (`45270690374` & `45276592557`)

- **Tarihsel Başarısızlık Nedeni:** Hem `faf580e` (`https://github.com/Centaurioun/Proactive-Co-Creator/actions/runs/45270690374`) hem de `03e9fda` (`https://github.com/Centaurioun/Proactive-Co-Creator/actions/runs/45276592557`) koşularında `Verify (Node 22.x)` başarılı olmuş, ancak `Browser E2E Smoke (Chromium)` işi tek bir E2E senaryosu bile başlamadan düşmüştür. Kök neden: `.github/workflows/ci.yml` dosyasında `playwright-cli install-browser chromium --only-shell` çağrısı yalnızca `chromium_headless_shell` indirirken, `@playwright/cli@0.1.22` başlatıcısı tam `chrome-for-testing` yürütülebilir dosyasını aramaktadır.
- **Yapılan Kesin Değişiklikler:**
  1. `.github/workflows/ci.yml`: `--only-shell` bayrağı kaldırıldı → `playwright-cli install-browser chromium --with-deps` + `playwright-cli install-browser --list` doğrulaması eklendi.
  2. `.github/workflows/ci.yml`: Sunucu açılışında `/api/health` yanıtının `"configured":false` döndürdüğünü doğrulayan ön kontrol eklendi.
  3. `.github/workflows/ci.yml`: `if: always()`, `retention-days: 14` ile `.playwright-cli/*.png`, `*.zip`, `e2e-results.json`, `e2e-server.log`, `console-*.log` yüklemesi eklendi.
  4. `scripts/e2e-browser-smoke.sh`: `/api/health` ön kontrolü, başlatma hatasında `playwright-cli install-browser chromium --with-deps` yönlendirmesi, başarısız senaryoda PNG + Playwright trace (`.zip`), ve `### Error` veya `passed !== true` durumunda kesin çıkış kodu `1` veren Node doğrulayıcı eklendi.
- **Yerel RED → GREEN Kanıtı:**
  - **RED:** `tests/releaseQualification.test.ts` içine `Task 3c (S0.1)` eklendiğinde, yama öncesi `npm test` beklenen şekilde **FAIL** verdi (`--only-shell` ve eksik preflight yakalandı).
  - **GREEN:** Yama sonrasında `npm test` → **106/106 PASS**; anahtarsız `NODE_ENV=production PORT=3100 node server.ts` (`/api/health` → `{"status":"ok","configured":false}`) karşısında `E2E_BASE_URL=http://127.0.0.1:3100 bash scripts/e2e-browser-smoke.sh` → **`E2E-A`–`E2E-I` 9/9 PASS** (toplam `44,4s`, `0` API çağrısı, `0` sayfa hatası, `0` konsol hatası).
- **Uzak GitHub Actions Durumu (`BLOCKED`):** Depo sahibi değişiklikleri `main` dalına push ettikten sonra yeni oluşan Workflow Run URL'sini ve her iki işin (`Verify (Node 22.x)` + `Browser E2E Smoke (Chromium)`) ham loglarını kontrol ederek `G8` kapısını kapatmalıdır.

---

## 5. Mevcut Kullanıcı Yolculukları (`J01`–`J12` — Gerçek Chromium Kanıtı)

Kaynak: `.playwright-cli/stage0-journeys.json` (`bash scripts/stage0-audit-browser.sh`, `0` mocksuz API isteği, `0` sayfa hatası).

| ID | Yolculuk | Fikstür | Tıklanan Yol (Özet) | DOM Kanıtı / Ekran ID | Sürtünme / Zorluk | Durum |
| :---: | :--- | :--- | :--- | :--- | :--- | :---: |
| **J01** | İlk açılış, fikir girişi & Analyze (mock) | `FX-EMPTY` | Fikir gir → `Reanalyze Idea` | `clockmakerRendered=true`, `clarificationRendered=true` (`SC-01`) | Boş projede `"Untitled creative project"` ön-dolumu; boş tuvalde CTA yok; buton adı `"Reanalyze Idea"` (`F-11`) | **PASS** |
| **J02** | Decision Inbox Accept/Reject/Defer & Inspect | `FX-SIMPLE` | Accept → Defer → Reject → `Inspect →` | `13 pending → 10 pending · 1 confirmed`, `inspectedTarget=true` (`SC-02`) | 3 sütunda kategori filtre şeridi sağdan kesiliyor (`F-06`) | **PASS** |
| **J03** | Özel yanıt, Defer & More Questions (mock) | `FX-SIMPLE` | `Custom...` → yaz → `Accept` → `Defer` → `More Questions` | `customAnswerAccepted=true`, `refreshedQuestionVisible=true` (`SC-02`) | `Custom...` içinde Enter otomatik göndermiyor; Skip ayrı değil | **PASS** |
| **J04** | Story Bible düzenleme, Clear yetkisi, Undo/Redo, reload | `FX-SIMPLE` | `Story Bible` → `#bible-setting` düzenle → Clear → Undo → Redo → Reload | `Rainy Harbor` → `""` → `Rainy Harbor` → `""` → reload `""` (`SC-05`) | 2 sütunlu ızgara dar sağ panelde etiketleri kesiyor (`Point of Vi...`) | **PASS** |
| **J05** | Graf arama, filtre, Zoom/Fit, Tablo görünümü & ilişki düzenleme | `FX-BUSY` | Ara `Badger` → `location` → Zoom+Fit → `Table` → satırlar → ilişki düzenle | `filteredNodes=1`, `locationNodes=3`, `keyboardFocusableRows=28/28` (`SC-04`) | `15` varlıkta Fit sonrası SVG düğüm metinleri `<8px` okunmaz oluyor (`F-10`) | **PASS** |
| **J06** | NL Batch önizleme, kısmi seçim, Bayat (Stale) koruma & Review modal | `FX-BUSY` | NL talimat → `Preview` → Fox kaldır → `Review Plan & Prompt` → `Escape` → setting değiştir → re-preview & Apply | `modalFocus=Close`, `returnFocus=Review Plan & Prompt`, `staleVisible=true`, `applyDisabledWhileStale=true`, `appliedTone=mysterious` (`SC-07`) | Batch önizleme kutusu sol Inbox akışında bekleyen kartları aşağı itiyor | **PASS** |
| **J07** | Story üretimi (mock), kopyala/indir & Outdated rozeti | `FX-SIMPLE` | `Generate Story` (mock) → Copy/Download kontrolü → Tone düzenle → `Outdated` | `copyVisible=true`, `dlVisible=true`, `outdatedVisible=true` (`SC-08`) | Aynı anda **3 adet** `Generate Story` butonu (`F-09`); hikâye alanı ~5 satıra sıkışık (`F-07`) | **PASS** |
| **J08** | Story ↔ Image geçişi, görsel üretimi (mock) & Lightbox Escape | `FX-OUT` | `Image` → `Generate Images` (mock) → `Preview generated image 1` → odak kontrolü → `Escape` | `focusInsideLightbox=true`, `focusAfterEscape="Preview generated image 1"` (`SC-09`) | S0.7 sonrası sıfır odak sürtünmesi | **PASS** |
| **J09** | Çoklu proje A/B, geçiş, reload & JSON Export/Import | `FX-SIMPLE` | `History` → `Project Alpha J09` oluştur → genre düzenle → geçiş → reload → JSON paste import | `survivedGenre="Maritime Noir"`, `importedVisible=true` (`SC-10`) | Projeler `History` sekmesine gömülü (`F-12`); buton `.txt` yazarken `.md` indiriyor (`F-13`) | **PASS** |
| **J10** | Consistency Checks hedefe atlama (revizyon artmadan) | `FX-BUSY` | `Checks` → `Inspect Fox` → `Checks` → `Edit Tone` | `revBefore=3`, `revAfter=3`, `focusedId="bible-tone"` (`SC-06`) | Hedefe atladıktan sonra `"Back to Checks"` geri dönüş izi yok | **PASS** |
| **J11** | IndexedDB `read_error` yazma kilidi, kurtarma & 503 API hatası | `FX-SIMPLE` | IDB `read_error` enjekte → reload → `Retry Storage Read` → mock 503 | `bannerVisible=true`, `idbPutsWhileBlocked=0`, `apiErrVisible=true` (`SC-15`) | 390px mobilde uyarı bandı çalışma alanını ciddi daraltıyor | **PASS** |
| **J12** | Revision History Restore, güvenlik kopyası & Undo/Redo | `FX-BUSY` | `History` → alta kaydır → `Restore` → `Undo` → `Redo` | `statusVisible=true`, `undoEnabled=true`, `redoEnabled=true`, `mdBtnVisible=true` (`SC-10`) | `Revision History` sekmenin en altında gizli; tek tıkla önizlemesiz Restore | **PASS** |

---

## 6. Ekran Görüntüleri Manifestosu (`SC-01`–`SC-16`)

Tüm 16 görüntü `bash scripts/capture-ux-baseline.sh` ile gerçek production build üzerinden (`0` ücretli API isteği, `0` sayfa/konsol hatası, `0` sahte CAS banner'ı) üretilmiş ve tek tek görsel olarak doğrulanmıştır (`docs/ux-baseline/assets/manifest.json`).

| ID | Viewport | Fikstür | Tema | Çözünürlük | Boyut | Durum | Görsel İnceleme Özeti & Dosya Yolu |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **SC-01** | `1440×900` | `FX-EMPTY` | Light | `1440×900` | `114.3 KB` | **ACCEPTED** | İlk açılışta `"Untitled creative project"` ve boş graf tuvali görünür (`docs/ux-baseline/assets/SC-01.png`). |
| **SC-02** | `1440×900` | `FX-SIMPLE` | Light | `1440×900` | `187.7 KB` | **ACCEPTED** | Sol Decision Inbox'ta pending/confirmed kartlar ve filtre taşması görünür (`docs/ux-baseline/assets/SC-02.png`). |
| **SC-03** | `1440×900` | `FX-SIMPLE` | Light | `1440×900` | `185.2 KB` | **ACCEPTED** | Grafta `Fox` seçili, sağ Contextual Inspector provenance rozetleriyle açık (`docs/ux-baseline/assets/SC-03.png`). |
| **SC-04** | `1440×900` | `FX-BUSY` | Light | `1440×900` | `207.6 KB` | **ACCEPTED** | 15 varlık + Fit görünümü; etiketlerin aşırı küçüldüğü açıkça seçiliyor (`docs/ux-baseline/assets/SC-04.png`). |
| **SC-05** | `1440×900` | `FX-BUSY` | Light | `1440×900` | `213.2 KB` | **ACCEPTED** | Story Bible kontrol karakteri satır içi doğrulama uyarısı (`docs/ux-baseline/assets/SC-05.png`). |
| **SC-06** | `1440×900` | `FX-BUSY` | Light | `1440×900` | `203.5 KB` | **ACCEPTED** | Consistency Checks çakışma listesi ve `Inspect Fox` aksiyonu (`docs/ux-baseline/assets/SC-06.png`). |
| **SC-07** | `1440×900` | `FX-BUSY` | Light | `1440×900` | `239.4 KB` | **ACCEPTED** | NL Batch önizleme + `Review Plan & Prompt` Before/After modalı (`19` diff satırı) (`docs/ux-baseline/assets/SC-07.png`). |
| **SC-08** | `1440×900` | `FX-OUT` | Light | `1440×900` | `197.7 KB` | **ACCEPTED** | Üretilmiş hikâye + `Outdated` rozeti; dar alt okuma yüksekliği belirgin (`docs/ux-baseline/assets/SC-08.png`). |
| **SC-09** | `1440×900` | `FX-OUT` | Light | `1440×900` | `129.4 KB` | **ACCEPTED** | Görsel modu + 4 yer tutucu görsel + tam ekran Lightbox açık (`docs/ux-baseline/assets/SC-09.png`). *(Not: S0.7 odak yamasından önce yakalandı; odak düzeltmesi `J08` ile doğrulandı.)* |
| **SC-10** | `1440×900` | `FX-BUSY` | Light | `1440×900` | `205.8 KB` | **ACCEPTED** | History sekmesi: JSON/MD dışa aktarma, projeler ve Restore denetimleri (`docs/ux-baseline/assets/SC-10.png`). |
| **SC-11** | `390×844` | `FX-SIMPLE` | Light | `390×844` | `55.0 KB` | **ACCEPTED** | Mobil görünüm + 4 satıra sarmalanan `189px` alt çubuk (`docs/ux-baseline/assets/SC-11.png`). |
| **SC-12** | `390×844` | `FX-OUT` | Light | `390×844` | `57.5 KB` | **ACCEPTED** | Mobil Story çıktısı ve sıkışmış alt aksiyon çubuğu (`docs/ux-baseline/assets/SC-12.png`). |
| **SC-13** | `1280×800` | `FX-BUSY` | Light | `1280×800` | `184.7 KB` | **ACCEPTED** | Sıkışık 1280×800 dizüstü 3 sütun düzeni ve 3 eşzamanlı Generate CTA (`docs/ux-baseline/assets/SC-13.png`). |
| **SC-14** | `768×1024` | `FX-SIMPLE` | Light | `768×1024` | `95.6 KB` | **ACCEPTED** | Tablet portre navigasyon ve Story Bible görünümü (`docs/ux-baseline/assets/SC-14.png`). |
| **SC-15** | `390×844` | `FX-SIMPLE` | Light | `390×844` | `66.5 KB` | **ACCEPTED** | Mobil `IndexedDB read_error` kurtarma bandı ve `Retry Storage Read` CTA (`docs/ux-baseline/assets/SC-15.png`). |
| **SC-16** | `1440×900` | `FX-SIMPLE` | Dark | `1440×900` | `188.5 KB` | **ACCEPTED** | Gerçek koyu tema (`oklch(0.21 0.034 264.665)` başlık) yüksek kontrast doğrulaması (`docs/ux-baseline/assets/SC-16.png`). |

---

## 7. Erişilebilirlik & Responsive Bulgular (`F-01`–`F-15`)

### Stage 0 İçinde Onarılan P1 Bulgular
- **`F-01` (P1 — CI Engelleyici):** `--only-shell` tarayıcı kurulum hatası → **ONARILDI (Yerel PASS / Uzak CI BLOCKED)**.
- **`F-02` (P1 — Erişilebilirlik):** `BeliefGraph` Tablo Görünümü satırları klavyeyle seçilemiyordu (`0/28`) → **ONARILDI (`28/28` satır `tabIndex={0}`, `Enter`/`Space`, `focus-visible`)**.
- **`F-03` (P1 — Erişilebilirlik):** `OutputGallery` Lightbox ve `InfoModal` açıldığında odak içeri taşınmıyor, `Tab` tuzağı yoktu ve `Escape` sonrası odak tetikleyiciye dönmüyordu → **ONARILDI (her ikisi de canlı Chromium'da doğrulandı)**.

### Stage 1 / Figma'ya Ertelenen Doğrulanmış Bulgular (P2)
- **`F-04` (P2):** `Header.tsx` aktif sekme durumu yanlış (`Story Bible` tıklansa bile `"Workspace"` mavi altı çizili kalıyor; `App.tsx` `activeSection` prop'unu geçirmiyor).
- **`F-05` (P2):** Mobil `390×844` ve `320×568` ekranlarında `WorkspaceBottomBar` 4 satıra sarılarak **`189px` / `187px`** (ekranın `%22.4–%32.9`'u) kaplıyor (`SC-11`, `SC-12`).
- **`F-06` (P2):** `overflow-hidden` kapsayıcılar nedeniyle sağ kenar kırpılmaları: `768×1024`'te `Reset Sample Plan` (`910px`) ve `Dark Theme` (`1012px`), `390×844`'te karakter sayacı (`450px`), `320×568`'de `Dark Theme` (`330px`) + sayaç (`450px`), masaüstünde Inbox kategori filtreleri (`SC-02`, `SC-14`).
- **`F-07` (P2):** Hikâye çıktı alanı grafın altında dar bir kutuya sıkışıyor (`SC-08`, ~5 satır görünür).
- **`F-08` (P2):** Sayfada hiç **`<h1>`** yok (başlık hiyerarşisi `<h2> Decision Inbox` ile başlıyor); ayrıca masaüstünde `53/231` kontrol `<24px` (WCAG 2.2 SC 2.5.8 alt sınırı — ör. üst menü `20px`, `Select All` `16px`).
- **`F-09` (P2):** Aynı anda **3 farklı `Generate Story` butonu** görünerek odak karmaşası yaratıyor (`SC-13`).
- **`F-10` / `F-15` (P2):** `15+` varlıkta Fit sonrası SVG düğüm yazıları `<8px` oluyor; `100`/`250` varlıkta ilk kamera konumu düğümleri sağ Inspector arkasına itiyor.
- **`F-11`–`F-14` (P2):** Boş projede `"Untitled creative project"` ön-dolumu (`SC-01`), projelerin `History` sekmesine gömülü olması (`SC-10`), `Export Refined Prompt (.txt)` etiketinin `.md` indirmesi (`J09`), ve `250` varlıkta promptun `8.000` karakter sunucu sınırını aşması (`17.814` karakter).

### Kontrast ve WCAG Sınırı (Zorunlu Uyarı)
- Örneklenen 5 temel kontrol grubunda hesaplanan kontrast oranları Light (`4.84:1`–`7.56:1`) ve Dark (`5.25:1`–`12.05:1`) modlarda `4.5:1` AA normal metin eşiğinin üzerindedir; `prefers-reduced-motion: reduce` kuralı `/index.css` içinde mevcuttur.
- **WCAG Uyumluluk Uyarısı:** Otomatik DOM/kontrast ölçümleri **WCAG 2.1/2.2 uyumluluğu kanıtlamaz**. NVDA/VoiceOver/TalkBack ile ekran okuyucu testi, zoom altındaki SVG düğüm etiketleri, Forced Colors modu ve tam klavye uçtan uca gezintisi Stage 1 öncesi manuel olarak yapılmalıdır. Ayrıca tüm bulguların gerçek kullanıcı sıklığı (prevalence) telemetri olmadığı için **`UNKNOWN`** olarak işaretlenmiştir.

---

## 8. Performans Tabanı (`S0.5`)

**Ölçüm Ortamı:** Node `v22.23.5`, npm `10.9.9`, Linux `4.19.0-gvisor x64`, `4` vCPU, `12.288 MB` RAM, `@playwright/cli@0.1.22` (Chromium `1247`), tek makine sentetik laboratuvar ölçümü.

### Production Bundle (`npm run build`, Vite 6.4.6)
- `dist/index.html`: `1.49 kB` (gzip `0.65 kB`)
- `dist/assets/index-*.css`: `61.18 kB` → `61.77 kB` (gzip `10.12 kB` → `10.23 kB`, `+0.11 kB` gz)
- `dist/assets/index-*.js`: `859.64 kB` → `861.58 kB` (gzip `231.17 kB` → `231.67 kB`, `+0.50 kB` gz — tek parça, Vite `>500 kB` uyarısı + Zod v4 `util.js`/`regexes.js` 2 Rollup uyarısı)
- Derleme süresi: `3.31 s` (`145` modül)

### Graf Ölçeklenme & Prompt Sınırı (Node.js + Headless Chromium `1440×900`)

| Ölçek (Varlık) | Node `computeForceLayout` Medyan | Prompt Uzunluğu (Sentez Süresi) | JSON Boyutu | Chromium Ready | FCP | Node Seçim | Sekme Geçiş | DOM / SVG Öğesi | JS Heap |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **10** | `3.50 ms` | `814` krk (`0.09 ms`) | `17.4 KB` | `902 ms` | `344 ms` | `158 ms` | `95 ms` | `366` / `64` | `11 MB` |
| **30** | `31.51 ms` | `2.218` krk (`0.15 ms`) | `46.0 KB` | `1.123 ms` | `456 ms` | `58 ms` | `121 ms` | `486` / `184` | `11 MB` |
| **100** | **`117.77 ms`** | `7.131` krk (`0.25 ms`) | `146.0 KB` | `1.299 ms` | `684 ms` | `97 ms` | `307 ms` | `906` / `604` | `20 MB` |
| **250** | **`69.55 ms`**\* | **`17.814` krk** (`0.31 ms`) | `362.2 KB` | `1.315 ms` | `824 ms` | `145 ms` | `243 ms` | `1.806` / `1.504` | `28 MB` |

*\*250 varlıkta medyan sürenin 100 varlıktan düşük çıkması, `lib/graphLayout.ts`'nin yüksek düğüm sayısında iterasyon sayısını azaltmasındandır; bunun bedeli `5435 × 1138 px` yatay dağılma ve ilk görünümde kırpılmadır (`F-15`). `10.661` karakterlik uzun prompt sınırı `0.15 ms`'de sentezlenmiş ancak `8.000` karakter sunucu sınırını aşmıştır (`F-14`).*

---

## 9. Teknik ve Güvenlik Riskleri

1. **Depolama & Çoklu Sekme Bütünlüğü:** IndexedDB `read_error` yazma kilidi (`0` yıkıcı `put`) ve kota aşımında yedek koruma testlerle doğrulandı (`E2E-F`, `E2E-G`, `J11`); ancak veriler yalnızca tarayıcı yerel deposundadır (site verisi temizlenirse yedeklenmemiş projeler silinir).
2. **Yanıltıcı Arayüz Durumları:** Üst menüde `Workspace` sekmesinin her zaman aktif görünmesi (`F-04`) ve `.txt` yazılı butonun `.md` indirmesi (`F-13`) kullanıcı güvenini zedeler.
3. **API Anahtarı & Kamuya Açık Dağıtım Sınırı (Koşullu — Stage 0 Kapsam Dışı):** Mevcut mimari yerel/tek kullanıcılıdır; kullanıcı kimlik doğrulaması veya kullanıcı başına Gemini/Imagen bütçe kotası yoktur ve rate-limit bellek içindedir. Kimlik doğrulama ve kalıcı kota olmadan internete açık dağıtım **yapılmamalıdır**.
4. **Bekleyen (Pending) vs Onaylı (Confirmed) AI Otoritesi:** Çekirdek veri modeli (`lib/canonicalModel.ts`) kullanıcı otoritesini sıkı biçimde korumaktadır (`J02`, `J04`, `J06`), ancak görsel yoğunluk (`SC-02`, `SC-13`) yeni kullanıcıların bu ayrımı ilk bakışta algılamasını zorlaştırmaktadır.
5. **Uzak CI Kapanış Riski:** S0.1 yaması yerel olarak kanıtlanmıştır ancak uzak `main` dalına push edilip GitHub Actions üzerinde çalıştırılmadan uzak CI hâlâ kırmızı (`45276592557`) durumdadır.
6. **Kod Bakım Yoğunluğu:** `lib/storageEngine.ts` (`2.343` satır), `App.tsx` (`2.332` satır), `lib/canonicalModel.ts` (`2.004` satır) ve `components/ContextualInspector.tsx` (`1.613` satır) monolitik boyutlardadır; Stage 1'de `App.tsx` ve `ContextualInspector.tsx` bölünmelidir.

---

## 10. Korunan İşlevsellik Doğrulaması (`feature-preservation-matrix.md`)

| Yetenek | Regresyon Testi & Tarayıcı Kanıtı | Durum |
| :--- | :--- | :---: |
| Üretim Modları (`story` \| `image`, video yok) | `E2E-H`, `J08`, `tests/proactiveCoCreator2.test.ts` | **KORUNDU (PASS)** |
| Belief Graph Görselleştirme + Tablo Görünümü | `E2E-C`, `E2E-H`, `J05`, `tests/stage0Accessibility.test.ts` (`28/28` klavye) | **KORUNDU + İYİLEŞTİRİLDİ** |
| Varlık & İlişki Düzenleme (Inspector + Popover) | `J05`, `SC-03`, `tests/proactiveCoCreator2.test.ts` | **KORUNDU (PASS)** |
| Uyarlanabilir Clarifications & Taslak Koruma | `E2E-A`, `J03`, `tests/storyBibleClearAuthority.test.ts` | **KORUNDU (PASS)** |
| Story Bible & Clear Yetkisi | `E2E-A`, `E2E-B`, `J04`, `SC-05` | **KORUNDU (PASS)** |
| Consistency Checks & Hedefe Atlama | `E2E-C`, `E2E-I`, `J10`, `SC-06` | **KORUNDU (PASS)** |
| Decision Inbox (Tekli/Toplu Accept/Reject/Defer) | `J02`, `SC-02` | **KORUNDU (PASS)** |
| Doğal Dil Toplu Düzenleme (NL Batch + Stale Guard) | `E2E-D`, `E2E-E`, `J06`, `SC-07` | **KORUNDU (PASS)** |
| Undo / Redo & Güvenli Sürüm Geçmişi Restore | `E2E-A`, `J04`, `J12`, `SC-10` | **KORUNDU (PASS)** |
| IndexedDB/localStorage Güvenliği, Çoklu Proje & Export/Import | `E2E-F`, `E2E-G`, `J09`, `J11`, `SC-15` | **KORUNDU (PASS)** |
| Açık Tetiklemeli Story/Image Üretimi & Outdated Göstergesi | `J07`, `J08`, `SC-08`, `SC-09` (mock API, `0` ücretli çağrı) | **KORUNDU (PASS)** |

---

## 11. Figma Handoff Özeti (`docs/ux-baseline/figma-handoff.md`)

- **Önerilen Aday Yön:** **Seçenek A — İş Akışı Odaklı Yaratıcı Stüdyo (Workflow-First Creative Studio)** (geniş `≥1440px` ekranlarda isteğe bağlı bölünmüş görünüm + hikâye/görsel çıktıları için tam yükseklikte özel çıktı sahnesi + üst düzey Proje Seçici + tek satır mobil alt aksiyon çubuğu).
- **Diğer Değerlendirilen Yönler:** Seçenek B (Tam Ekran Uzamsal Graf Tuvali — hikâye okuma ve mobil için zayıf) ve Seçenek C (Yazı Odaklı Editör — grafı geri plana itip "uzun roman editörü" yanılgısı yaratma riski).
- **Test Edilecek İlk 5 UX Hipotezi:**
  1. `H1`: 3 eşzamanlı `Generate Story` butonunu tek bağlamsal birincil CTA'ya indirmek tereddütü azaltır.
  2. `H2`: Çıktı alanını tam yükseklikli (`≥65%`) görünüm/çekmeceye almak okuma ve `Outdated` farkındalığını iyileştirir.
  3. `H3`: Proje Seçici ve Yedekleme/Export'u üst başlığa çıkarmak çoklu proje keşfini ≤2 tıklamaya indirir.
  4. `H4`: Mobil `189px` alt çubuğu tek satır `56px` + taşma menüsüne indirmek `390×844` kullanımını kurtarır.
  5. `H5`: Tutarlı `AI-Önerisi (Bekleyen)` vs `Kullanıcı Onaylı` görsel dili ve `Back to Checks` geri izi güveni artırır.
- **Sahip (Owner) Tarafından Karar Bekleyen Konular:** `1280px` varsayılan 2 sütun politikası; `100+` varlıkta `8.000` karakter prompt önceliklendirme stratejisi; NL Batch'in komut çubuğuna taşınması; Restore öncesi diff önizlemesi; ileride bulut/hesap planı olup olmadığı.
- **Kesin Teyit:** Bu oturumda **sıfır** UI yeniden tasarım kodu yazılmıştır.

---

## 12. Uygulama Sonrası Altı Döngülü Adversarial İnceleme (`P1`–`P6`)

| Döngü | Odak | Gerçek Kanıt / Çalıştırılan Komut | Tespit Edilen Bulgu & Karar | Final Durum |
| :---: | :--- | :--- | :--- | :---: |
| **P1** | Nihai diff & kapsam disiplini | `diff -rq /tmp/stage0-checkpoint-03e9fda .` + `grep -n "GEMINI_API_KEY" .github/workflows/ci.yml` | Yalnızca 6 mevcut dosya (CI, smoke betik, 1 test, 3 hedefli a11y bileşeni) değişti; sıfır UI yeniden tasarımı, sıfır `GEMINI_API_KEY` referansı, zayıflatılmış test yok. | **PASS** |
| **P2** | Kullanıcı verisi & provenance dokunulmazlığı | `diff -rq` üzerinde `lib/`, `shared/`, `server/` | `lib/`, `shared/` ve `server/` dizinlerinde **0 byte** değişiklik. Schema v3, Undo/Redo, yedekleme ve AI otoritesi tamamen korundu. | **PASS** |
| **P3** | S0.7 sonrası tam adversarial tarayıcı & kalite kapıları | `npm run typecheck && npm run lint && npm test && npm run build && node -e 'import("./server.ts")'` + `PORT=3100` anahtarsız `bash scripts/e2e-browser-smoke.sh` | `typecheck` 0 hata, `lint` 0 hata, `test` **`106/106 PASS`** (`4332ms`), `build` `3.31s`, `SERVER_IMPORT_OK`, ve S0.7 sonrası **`E2E-A`–`E2E-I` 9/9 PASS** (`apiHits: 0`, `pageErrors: 0`). | **PASS** |
| **P4** | Responsive, erişilebilirlik & ekran görüntüsü doğrulaması | `ls -la docs/ux-baseline/assets/SC-*.png` + `manifest.json` incelemesi + `stage0-audit-metrics.json` | 16/16 PNG `sanityCheck: PASS`. **Yakalanan nüanslar:** (1) `SC-09.png` S0.7 odak yamasından hemen önce çekildiği için manifestte önceki odak etiketi kayıtlıydı — raporda şeffaf biçimde not düşüldü ve odak düzeltmesi `J08` ile canlı doğrulandı; (2) `stage0-audit-metrics.json`'daki 2 kontrast satırı üst konteynere düştüğü için `measurements.md` tablosundan dürüstçe çıkarıldı. | **PASS** |
| **P5** | CI, bundle & performans kanıt dürüstlüğü | Baseline (`102` test, `859.64 kB` JS, `61.18 kB` CSS) vs Final (`106` test, `861.58 kB` JS, `61.77 kB` CSS) | **Yakalanan sapma:** İlk `measurements.md` taslağında CSS boyutu `61.44 kB` ve Rollup uyarı yolu `classic/schemas.js` yazılmıştı; final `npm run build` çıktısıyla (`61.77 kB` / `10.23 kB` gz, `core/util.js` & `core/regexes.js`, `3.31s`) birebir eşitlendi. Uzak CI sahte PASS yapılmadan `BLOCKED` korundu. | **PASS** |
| **P6** | Bağımsız Figma tasarımcısı okuma testi | `figma-handoff.md` + `screen-inventory.md` + `measurements.md` + `SC-01`–`SC-16` bütünlük kontrolü | Bir Figma tasarımcısı kod deposunu açmadan tüm mevcut ekranları, veri akışını, renk/font token'larını, "icat etme" sınırlarını ve 3 tasarım yönünü eksiksiz okuyabilir. Kalan tek dış blokaj: uzak GitHub CI doğrulaması (`G8`). | **PASS** |

---

## 13. Sonraki Adım Önerisi (Next-Step Recommendation)

1. **Depo Sahibi — Öncelik 1 (`G8` Kapanışı):**
   - Bu çalışma alanındaki Stage 0 değişikliklerini kendi yerel git kopyanızda tek veya iki temiz commit (`fix(ci): repair Playwright Chromium install & E2E verification` + `docs(stage0): add UX baseline, measurements, Figma handoff & P1 a11y fixes`) halinde `main` dalına push edin (force-push **yapmayın**).
   - GitHub Actions üzerinde yeni tetiklenen koşuda hem `Verify (Node 22.x)` (`106/106` test) hem de `Browser E2E Smoke (Chromium)` (`E2E-A`–`E2E-I` 9/9 PASS + `.playwright-cli` artefakt yüklemesi) işlerinin yeşil geçtiğini doğrulayın.
2. **Ürün Sahibi — Öncelik 2 (Kapsam Kararları):**
   - `docs/ux-baseline/figma-handoff.md` Bölüm 9'daki 5 açık karar maddesini (1280px varsayılan sütun sayısı, `8.000` karakter prompt politikası, NL Batch konumu, Restore önizlemesi, yerel-öncelikli vs bulut hedefi) netleştirin.
3. **Figma / Ürün Tasarımı — Öncelik 3 (Keşif & Prototip):**
   - **Seçenek A (Workflow-First Creative Studio)** doğrultusunda `1440×900`, `1280×800`, `768×1024` ve `390×844` ekranları için düşük/orta doğruluklu prototip hazırlayın ve `H1`–`H5` hipotezlerini test edin.
   - **Neyi Yeniden Tasarlamayın / İcat Etmeyin:** Video modu, çok bölümlü roman editörü, zaman çizelgesi (timeline), bulut senkronizasyonu, otomatik/gizli AI üretimi veya piksel-kilitli görsel karakter tutarlılığı vaat eden ekranlar **çizmeyin**.
4. **Stage 1 Kodlamasına Geçiş Kuralı:**
   - Yalnızca `G8` uzak CI yeşil olduktan, 5 kapsam kararı verildikten ve Figma tasarımı onaylandıktan sonra Stage 1 kodlamasına geçin; geçişte `docs/ux-baseline/quality-gates.md` içindeki `QG-01`–`QG-08` kapılarını zorunlu kabul kriteri olarak kullanın.
