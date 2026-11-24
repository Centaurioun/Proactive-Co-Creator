# Faz 1 devri — Core Foundations & Writing Workspace

## Codex bağımsız yerel tekrar doğrulaması — 24 Kasım 2026

Bu bölüm mevcut çalışma ağacında, Phase 1 yayınından önce yapılan bağımsız yerel doğrulamayı kaydeder. Üstteki önceki çalışma raporunun yerine geçmez.

- Başlangıç commit'i `343b4a70b6a4232c75eadfb4746ed15d0c142d22`; `codex/phase-01-foundation-writing` dalı bu commit'teydi ve `origin/main` ile aynıydı. Faz 1 değişiklikleri henüz commit edilmemişti. `.gitignore` değişikliği ve izlenmeyen `.ignore` dosyası aşamaya eklenmedi.
- `npm ci`: PASS; kilit dosyası değişmedi. npm 7 orta düzey geliştirme ağacı bulgusu ve 3 kurulum betiği onay uyarısı verdi. `npm audit --omit=dev --json`: PASS, üretim bağımlılığı bulgusu 0. Tam `npm audit --json`: FAIL/rapor, 7 orta düzey bulgu; otomatik düzeltme çalıştırılmadı.
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` ve `node -e 'import("./server.ts")'`: PASS. Testler 117/117, 16 süit. Build çıktısı 634.32 kB JS / 178.13 kB gzip ve mevcut 500 kB uyarısı.
- `scripts/e2e-browser-smoke.sh`: Chromium A–I 9/9 PASS; sıfır sayfa/console hatası ve sıfır API çağrısı. Anahtarsız sunucu `/api/health` `configured:false` döndürdü.
- `scripts/stage0-audit-browser.sh`: J01–J12 PASS. Erişilebilirlik/taşma ölçümleri tüm görünür kontrollerde eşik geçişi anlamına gelmiyor: Plan alt çubuğu 390 px'de 189 px, 320 px'de 187 px; kırpılan kontroller 768/390/320 px ölçülerinde sırasıyla 2/1/2. Bu nedenle responsive kalite kapısı tam PASS değil.
- `scripts/e2e-narrative-workspace.sh`: PASS. Sentetik legacy JSON kopya geri yükleme, Unicode/IME olayları, sahne sırası, öykü benimseme, yeniden yükleme, undo/redo, yedek kopya ve değiştirme, iki sekme çatışması, IndexedDB yazma hatası ve taslak yeniden kaydı tarayıcıda doğrulandı. 320/390/768/1280/1440 genişliklerinde yazma senaryosu yatay taşma göstermedi.
- Ölçüm ve sentetik ekran görüntüsü/trace kanıtı `.playwright-cli/` altında yerel ve izlenmeyen dosyalardır. Gerçek Gemini ve Google AI Studio'da bu kod ağacı çalıştırılmadı. Phase 1 PR #8 için eşleşen SHA `cc4fd6b4cd657ba4ab8a919ee6a7aeb99ead098f` GitHub Actions run `45370155384` (workflow run #31) `completed / success` oldu: https://github.com/Centaurioun/Proactive-Co-Creator/actions/runs/45370155384. PR #8 açık/draft, birleştirilmedi.

## Kalan Phase 2 önkoşulları (tekrar doğrulandı)

Mevcut modelde issue disposition alanı var ancak yaşam döngüsü geçiş API'si, durum değişikliği gerekçesi ve hedefe bağlı freshness invalidation iş akışı yok. Kaynak kayıtları yalnızca metin/digest tutuyor; kaynak dosyanın özgün baytları yok. Import akışı ve gerçek kaynak parser'ı yok. Bunlar Phase 2'de tamamlanmadan gerçek import açılmamalı.

## Altı döngü için bağımsız doğrulama notu

1. **Envanter:** Branch/HEAD, değişmiş ve izlenmeyen dosyalar, kurulum ve paket komutları kontrol edildi. Değişikliklerin `.gitignore` ve `.ignore` dışındaki beklenen Phase 1 dosyaları olduğu görüldü.
2. **Sözleşme:** Mevcut project controller/IndexedDB yazarı, şema 3 uyumluluğu, şema 4 manuscript referansları ve doğrulanmış yedek sözleşmesi korundu; yeni paralel storage eklenmedi.
3. **Uygulama:** Bu doğrulama turunda Phase 1 kaynak değişikliği gerekmedi; mevcut 4 yeni Phase 1 test dosyası ve tam 117 test çalıştırıldı.
4. **Olumsuz durumlar:** Tarayıcıda iki sekme CAS, IndexedDB hata enjeksiyonu, hata sonrası taslak kaydı ve yedek değiştirme öncesi kontrol noktası senaryoları geçti.
5. **UX/güvenlik:** Anahtarsız API ve sıfır browser API çağrısı doğrulandı. Yazma görünümü beş genişlikte taşmadı; Stage 0 Plan/footer kırpılması açık kaldı. Tarayıcı denetimi erişilebilirlik sertifikası değildir.
6. **Nihai uzlaştırma:** Yerel komutlar, sentetik E2E kanıtları ve Phase 1 PR #8 için SHA eşleşen uzak CI PASS. Studio uyumluluğu NOT TESTED. Phase 2 önkoşulları bu handoff yazılırken tamamlanmamıştı.

24 Kasım 2026. Yazma, sürüm geçmişi, üretilmiş metin aktarımı ve proje kurtarma akışları yerel uygulamada çalışıyor. Faz 1 çalışma ağacının Google AI Studio doğrulaması açık. Faz 2 başlatılmadı.

## Taban ve teslim

- Başlangıç: `343b4a70b6a4232c75eadfb4746ed15d0c142d22` (PR #7 sonrası `origin/main`). Çalışma dizini `/Users/yusuf/Repos/Proactive-Co-Creator`, dal `codex/stage-0-final-qualification`. Bu dalın HEAD'i başlangıçta `origin/main` ile aynıydı. Yerel `main` referansı daha eski `3526c24` idi.
- Teslim, bu çalışma dizinindeki Faz 1 dosyalarıdır. HEAD değişmedi. Başlangıçta mevcut olan `.gitignore` değişikliği ve izlenmeyen `.ignore` korundu. Git ortamında eksik `GIT_CONFIG_KEY_0` nedeniyle salt okunur durum ve fark kontrolleri `GIT_CONFIG_COUNT=0` ile çalıştırıldı.
- TypeScript 5.8.3, Vite 6.4.6 ve mevcut kilit dosyaları kullanıldı. Paket, derleyici ve sunucu konfigürasyonunda Faz 1 değişikliği yok. PR #3 ve #6 ertelenmiş durumda.
- Google AI Studio uygulamasının mevcut Preview yüzeyi açıldı. Belief Graph, Story Bible ve Output kontrolleri görüldü. Studio ayrıca GitHub'a gönderilmeyi bekleyen kendi değişikliklerini gösterdi. O çalışma kopyası düzenlenmedi veya eşitlenmedi. Studio önizlemesindeki kesin kaynak revizyonu doğrulanmadı. Yeni Faz 1 çalışma ağacı yerelde çalıştırıldı.

## Uygulanan davranış

- **Write** düz metin ve Markdown kaynaklı yazı, bölüm ve sahne oluşturma, isteğe bağlı başlık, sıralama, bölme ve birleştirme, onaylı silme, arama, kelime sayısı, odak modu ve sahne ayrıntıları sunar. Bölüm ataması ile hikâye kronolojisi belge sırasından ayrı tutulur. Mobilde taslak alanı önceliklidir ve anahat açılabilir. Markdown işaretleri metin olarak korunur.
- Taslak, kompozisyon etkinliği sürerken otomatik kayda girmez. 900 ms düzenleme aralığından sonra veya **Save manuscript** ile kalıcı kayıt başlar. **Saved** göstergesi kalıcı onaya bağlıdır. Başarısız taslak editörde kalır ve tekrar kaydedilebilir ya da Markdown olarak dışarı alınabilir. Taslak varken çalışma alanı geçişi bekler. Tarayıcının kapanma uyarısı vardır. Kapanışta kalıcı kayıt garantisi yoktur.
- Galeriden tarihsel bir öykü seçilebilir. UTF-16 başlangıç ve bitişi doğrulanan tam metin veya seçim, önizlemeden sonra yeni sahneye, mevcut sahnenin sonuna veya yerine uygulanabilir. Kaynak öykü ve görseller korunur. Geri alma ve yineleme metin sürümü referansını geri getirir. Aktarımın kaynak alıntısı denetim kaydında kalır.
- **Plan** mevcut grafik, kararlar, Story Bible, istem, öykü ve görsel üretimi akışlarını taşır. Plan görünümü sekme değişiminde bağlı kalır. **Review** mevcut yerel denetimlere, Revision History ve Output Gallery'ye erişim verir. Evidence & Audit, kaydedilmiş iddiaları, sorunları ve yazı işlemlerini gösterir. Raporlar aynı kayıtları JSON ve Markdown olarak dışarı verir.
- **Projects** proje oluşturma ve değiştirme, içerik dışa aktarma, JSON yedek önizleme ve tarayıcı yedeklerini açar. Eski JSON dosya ve yapıştırma girişleri korunur. Önizleme sonrası varsayılan geri yükleme, iç proje kimliğini yeniden atayan ayrı bir kopya oluşturur. Yalnızca aynı proje ve uyumlu şemadaki yönetilen yedek, onay ve doğrulanmış kontrol noktasıyla mevcut projenin yerine yazılabilir.
- Yönetilen yedekler proje bazlı ve SHA-256 ile doğrulanır. Katalog, sabitleme, silme, taşınabilir JSON indirme ve geri yükleme sağlar. Silme işlemi tarayıcı kilidiyle seri hale getirilir ve son doğrulanmış kopyayı korur. Tarayıcı verisini silmek yönetilen yedekleri de kaldırır. Çalışma metni ve Story Bible Markdown, istem ve seçili kaynak veya üretilmiş öykü TXT, proje yedeği JSON olarak çıkar.

## Kalıcılık ve dosyalar

| Dosyalar | Sorumluluk |
|---|---|
| [App.tsx](../../../../App.tsx), [Header](../../../../components/Header.tsx), [ContextualInspector](../../../../components/ContextualInspector.tsx), [OutputGallery](../../../../components/OutputGallery.tsx) | Görünüm geçişleri, mevcut Plan ve galeri ile bağlantı, asenkron kayıt ve geri yükleme, içerik dışa aktarma |
| [ManuscriptEditor](../../../../components/manuscript/ManuscriptEditor.tsx), [AdoptArtifactDialog](../../../../components/manuscript/AdoptArtifactDialog.tsx) | Taslak, anahat, kompozisyon durumu ve kapsamı onaylanan aktarım |
| [ProjectHub](../../../../components/workspace/ProjectHub.tsx), [NarrativeReview](../../../../components/workspace/NarrativeReview.tsx) | Yedek, kurtarma ve kayıt inceleme yüzeyleri |
| [narrativeTypes](../../../../shared/narrativeTypes.ts), [narrativeSchemas](../../../../shared/narrativeSchemas.ts), [types](../../../../shared/types.ts) | Proje başına şema 4 kayıtları ve isteğe bağlı proje görüntüsü referansı |
| [manuscriptModel](../../../../lib/narrative/manuscriptModel.ts), [evidenceRegistry](../../../../lib/narrative/evidenceRegistry.ts), [changeAudit](../../../../lib/narrative/changeAudit.ts) | İşlem hazırlama, metin sınırı, proje sahipliği, referans ve sürüm doğrulaması, telafi kayıtları |
| [recovery](../../../../lib/narrative/recovery.ts), [storageEngine](../../../../lib/storageEngine.ts), [projectController](../../../../lib/projectController.ts), [historyEngine](../../../../lib/historyEngine.ts) | Yedek manifesti, mevcut IndexedDB kayıt otoritesi, tam taban revizyonu kontrolü ve geçmiş |
| [Birim testleri](../../../../tests/), [Faz 1 Chromium senaryosu](../../../../scripts/e2e-narrative-workspace.sh), [Stage 0 denetimi](../../../../scripts/stage0-audit-browser.sh) | Sentetik şema 3/4, yedek bütünlüğü, Unicode, geri alma ve tarayıcı geçişleri. Stage 0 J09 gerçek geri yükleme önizlemesi ve kopya onayını izler. |

Şema 3 projeleri okumada yükseltilmez. İlk başarılı yazı işlemi öncesinde önceki proje kalıcı kayda alınır ve bir tarayıcı yedeği okunarak doğrulanır. Yazı ve denetim kayıtları, ilgili anahat ve revizyon referanslarıyla birlikte mevcut proje kaydının tek IndexedDB işlemi içinde yazılır. `prepareManuscriptChange` proje kimliği, revizyon ve metin sürümünü kontrol eder. Kalıcı yazım, aynı projede tam taban revizyonunu tekrar kontrol eder. Eski veya daha yeni bir şema mevcut gelişmiş kaydın üzerine yazamaz. Şema 4 yazımı IndexedDB kullanır. LocalStorage, mevcut proje önbelleği ve ayrı doğrulanmış yedekler için kullanılır.

`snapshot.manuscriptVersionId`, `narrative.versions[].sectionVersionIds` üzerinden değişmez `sectionVersions` kayıtlarına ulaşır. Bir sahneyi düzenlemek değişmeyen sahne metinlerini kopyalamaz. Yapısal paylaşım testi, 20.000'i aşan karakter içeren dokunulmamış bir sahnenin iki yazı sürümünde bir kez serileştirildiğini doğruladı. Düzenlenen sahnenin kayıtlı sürümleri ve denetim kayıtları büyümeye devam eder. Yük veya kota nedeniyle kayıt tamamlanamazsa eski kalıcı sürüm ve açık taslak korunur.

Geri dönüş için şema 4'ü destekleyen bu çalışma ağacında yedeği **Restore a copy** ile sınayın. Faz 1 öncesi uygulama gerekiyorsa önce şema 4 projesini JSON olarak ayrıca saklayın. Daha sonra doğrulanmış şema 3 ön yükseltme yedeğini ayrı kopya olarak açın. Şema 4 verisini eski uygulama ile düzenlemek güvenli bir geri dönüş yolu olarak test edilmedi.

## Doğrulama

Yerel macOS arm64, Node 26.12.1, npm 11.20.0. Anahtarsız üretim önizlemesi `http://127.0.0.1:4373`; `/api/health` yanıtı `configured:false`. Yeni tarayıcı senaryosu ayrı bağlamda sentetik proje ve öykü artifaktı kullandı. API çağrısı ve yakalanmamış sayfa hatası sayısı sıfır.

| İşlem | Sonuç |
|---|---|
| `npm ci --strict-peer-deps` | PASS, çıkış 0. Ön kontrol 7 orta düzey bağımlılık bulgusu ve npm install-script bildirimleri verdi. |
| `npm run typecheck`, `npm run lint`, `npm run build` | PASS. Derlemede mevcut Zod açıklama uyarısı ve Vite paket boyutu uyarısı görülüyor. |
| `npm test` | PASS, 117 test, 16 süit, 0 hata, 0 atlama. Başlangıç 106/106 idi. |
| `scripts/e2e-browser-smoke.sh` | PASS, A–I 9/9. Kontrollü hata çalıştırması da ekran görüntüsü, trace ve JSON hata sonucu üretti. |
| `scripts/stage0-audit-browser.sh` | J01–12 PASS. Mevcut Plan denetiminde 768, 390 ve 320 px genişliklerde sırasıyla 2, 1 ve 2 kırpılan kontrol gözlendi. 390 px Plan alt çubuğu 189 px kaldı. Erişilebilirlik sertifikası verilmedi. |
| `scripts/e2e-narrative-workspace.sh` | PASS. Eski JSON kopya geri yükleme, sentetik IME olayları, Unicode, iki sahne ve sıralama, öykü aktarımı, yeniden yükleme, geri alma/yineleme, yönetilen yedekten kopya ve kontrollü değiştirme, iki sekmeli kayıt çatışması, IndexedDB hata enjeksiyonu ve taslağı tekrar kaydetme. Write görünümü 320/390/768/1280/1440 px genişliklerde denetlendi. |
| `npm audit --json`; `npm audit --omit=dev --json` | Tam bağımlılık ağacı 7 orta düzey bulgu, çıkış 1. Üretim bağımlılıkları 0 bulgu, çıkış 0. |
| Google AI Studio | Mevcut uygulama görünür. Faz 1 kodu yüklü bir Studio örneği doğrulanmadı. |
| Gerçek işletim sistemi IME girişi, gerçek Gemini, Google AI Studio compatibility | TEST EDİLMEDİ. |
| Phase 1 PR #8 hosted CI | PASS, run `45370155384`, exact head `cc4fd6b4cd657ba4ab8a919ee6a7aeb99ead098f`; PR remains open/draft and unmerged. |

Yerel kanıtlar: [masaüstü Write](../../../../.playwright-cli/phase-01-write-1440.png), [mobil Write](../../../../.playwright-cli/phase-01-write-390.png), [A–I](../../../../.playwright-cli/e2e-results.json), [J01–12](../../../../.playwright-cli/stage0-journeys.json), [Stage 0 ölçümleri](../../../../.playwright-cli/stage0-audit-metrics.json). Bunlar yerel, izlenmeyen test çıktılarıdır.

## Altı iyileştirme döngüsü

1. **Envanter.** Şema 3 kalıcı proje gövdesi, IndexedDB ve yerel önbellek, seri kayıt kuyruğu, tombstone ve geçmiş akışı izlendi. Başlangıçta 106 test ve A–I yerelde geçti. Mevcut depolama ve bileşen yapısı geniş çapta yeniden düzenlenmedi.
2. **Sözleşme.** Zengin metin bağımlılığı ile yerleşik textarea değerlendirildi. Düz metin ve Markdown kaynağı seçildi. Şema 4 ekleri proje ilk yazıldığında ve doğrulanmış yedekten sonra etkinleşir. Sürüm referansları yoluyla önceki kayıtlar ve üretim bağımsız kalır.
3. **Uygulama.** RED kontrolleri şema 4 reddini ve yinelenen uzun sahne metnini yakaladı. Yazı, kurtarma, aktarım ve kanıt doğrulaması odaklı testlerle eklendi. Plan bileşenleri görünüm değişiminde bağlı tutularak sahnelenen karar ve istem kontrolleri korundu.
4. **Olumsuz durumlar.** İki sekmeli Chromium denemesinde eski taslak kazanan kaydı ezmedi. Senkron `IDBObjectStore.put` hatası, işlem tamamlanırken yanlış başarı üretebiliyordu. Yazım eklenmediğinde işlem iptal edilir. Çalışan tekrar denemede IndexedDB'deki önceki metin yerinde kaldı ve kayıt hata kaldırıldığında tamamlandı.
5. **UX ve depolama.** Mobil ekran görüntüsü açık anahattın editörü aşağı ittiğini gösterdi. Mobilde açılır anahat kullanıldı. Sağ panelde doğrudan proje, dışa aktarma ve geçmiş konumlarına odak verildi. Uzun değişmeyen metin için tek bölüm sürümü tutuldu. Çalışma metni için HTML işleme yolu eklenmedi.
6. **Uzlaştırma.** Son yerel koşularda yeni Chromium senaryosu, A–I, J01–12, testler, derleyici ve lint kontrol edildi. GitHub'a gönderilmeyi bekleyen değişiklikler içeren Studio kopyasına müdahale edilmedi. İnceleme ve yayın onayı ayrı tutuldu.

## Açık kapsam ve Faz 2 önkoşulları

- **G0 — yerel sentetik kapsam geçti.** Tam taban revizyonu, tek proje yazımı, yeni şema koruması, taslak ve yedek kanıtı var. Büyük medya ile dolu mevcut gerçek kullanıcı projelerinde tarayıcı yedek kotası ve gerçek süreç kapanması denetlenmedi. Yedek kotası doluysa ilk yazı yükseltmesi veya değiştirme engellenir.
- **G1 — yerel önizleme geçti, barındırılan Faz 1 önizlemesi bekliyor.** Studio'da mevcut çalışma kopyasının değişiklikleri uzlaştırılmalı ve onaylanan Faz 1 ağacı ayrı bir oturumda doğrulanmalı. Depoya yayın veya birleştirme yapılmadı.
- **G2 — temel yazı ve kurtarma akışları yerelde geçti.** Sorun ve kanıt kayıtlarının doğrulanması ve görüntülenmesi var. Yeni sorun oluşturma, durum değiştirme ve otomatik eskime denetimi için uygulama akışı henüz yok. Kaynak kaydı yalnızca metin ile sürüm/digest kimliğini taşır. Özgün dosya baytları, ayrı paragraf blokları ve kaynak alımı bu ağaçta yok. Yeni sürümler sahne/bölüm granülerliğinde.
- **G3 — yerel araçlar ve tarayıcı geçti.** Gerçek IME, barındırılan tarayıcı ve uzak CI bekliyor. Stage 0 Plan'ın mobil kırpılma ve çubuk boyutu sorunları açık. Yerel tarayıcı çıktıları resmi erişilebilirlik veya üretim onayı kapsamına girmez.
- Faz 2 öncesi bağımsız inceleme, Studio senkronizasyon kararı, barındırılan yazı ve kurtarma denemesi, ayrıca gerçek dosya kaynağı için SHA-256/byte saklama ve doğrulanmış kanıt sözleşmesinin genişletilmesi gerekir. Mevcut 8.000 karakterlik AI isteği koruması sürer. Yeni semantik AI, kaynak analizi, ZIP ve harici klasör işi başlamadı.
