# CodeScene Bağımsız Teknik Borç Denetimi — 2026-11-24

## Kapsam ve yöntem

Bu rapor, CodeScene'de Proactive-Co-Creator projesi için görünen en son analizi, mevcut `main` kaynak revizyonu ve açık PR #2'nin rapor iddialarıyla karşılaştırır. İnceleme salt okunur yapıldı; analiz çalıştırılmadı, CodeScene ayarları değiştirilmedi, teknik borç koduna dokunulmadı. Proje kimliği 88207, analiz işi 8567730, kaynak SHA `3526c24fec45c60878937a331e487fc387e28d0b`; CodeScene analiz zamanı 2026-11-24 04:28:45 UTC (İstanbul 07:28:45). Bu SHA, denetim anında yerel ve uzak `main` ile eşleşiyordu.

Görüntülenen CodeScene panelleri: system map / Code Health, hotspot Code Health tablosu, ilgili dosyaların X-ray işlev tabloları ve change-coupling paneli. Kaynak doğrulaması repository içindeki gerçek sembol ve dosyalara karşı yapıldı. Bu, ürün kodunun bağımsız tam denetimi veya CodeScene'in tüm ücretli/metrik panellerine erişim iddiası değildir.

## Sistem düzeyi bulgular

| Gösterge | CodeScene değeri | Yorum / sınırlama |
| --- | ---: | --- |
| System-map Code Health | 6.25 (tam görünüm 6.2535) | Sağlık skoru; tek başına efor tahmini değildir. |
| Hotspot Code Health | 5.2 | En sık değişen kısım için keskin risk alanı. |
| Ortalama Code Health | 6.2 | Özet ortalaması. |
| Kod tabanı / incelenen dosyalar | 22,200 LoC; 94 entity; 53 file; 48 Code Health file | Analiz kapsamı için panel sayıları. |
| System-map dağılımı | %29 kırmızı, %51.2 sarı, %19.8 yeşil | 48 Code Health dosyasındaki dağılım. |
| Hotspot payı / hotspot eforu | %37.7 / %63 | CodeScene'in gösterdiği değişim ve geliştirici efor yoğunluğu. |
| Analiz geçmişi | 11 commit; tek yazar/aktif yazar; 2026-11-14'te başlıyor | Zaman içindeki eğilim ve ekip genellemesi düşük güvenilirlikte. |
| Uyarılar | 0 | Sadece bu analiz çalışmasının uyarı paneli. |

Bu görünümde mimari bileşenler yapılandırılmadığından mimari sağlık/komponent sınırları için puan yok. PR entegrasyonu ayarlı değildi. Quality Gate bu ay 0 kontrol/0 bulgu gösterdi; bunu “kod geçti” şeklinde yorumlamak mümkün değil. Team alignment ve delivery plan görünümü kullanılabilir değildi. Change coupling panelinde dört entity commit düzeyinde görünürken cross-commit/repository coupling 0 olarak kaldı; ayrıntı görünümü bekleme durumundaydı. Bu nedenle “bağlaşım yok” sonucuna varılamaz.

## Öncelikli hotspot'lar

| Sıra | Dosya | Health | LoC | Commit | Öncelik gerekçesi |
| ---: | --- | ---: | ---: | ---: | --- |
| 1 | `canonicalModel.ts` | 1.84 | 1,815 | 4 | En zayıf hotspot; karmaşık durum birleştirme ve inbox projeksiyonları. |
| 2 | `storageEngine.ts` | 2.41 | 2,054 | 8 | Yüksek değişim sıklığıyla migration, hydration, CAS ve silme sorumlulukları. |
| 3 | `nlBatchEngine.ts` | 2.79 | 901 | 3 | Doğal dil ayrıştırma, doğrulama ve işlem uygulama zinciri. |
| 4 | `ContextualInspector.tsx` | 3.97 | 1,551 | 4 | Büyük React bileşeni ve çok koşullu görünüm/eylem akışı. |
| 5 | `projectController.ts` | 5.36 | 1,258 | 6 | Review diff ve asenkron analiz/generation tamamlanma akışları. |
| 6 | `BeliefGraph.tsx` | 5.37 | 926 | 4 | Graf görselleştirme bileşeni; büyük/karmaşık metot sinyalleri. |
| 7 | `historyEngine.ts` | 6.18 | 409 | 4 | Undo/redo ve history state yönetimi. |
| 8 | `DecisionInboxPanel.tsx` | 6.75 | 678 | 4 | Karar inbox sunumu; karmaşık metot/koşul göstergeleri. |
| 9 | `App.tsx` | 6.79 | 2,147 | 8 | Uygulama kabuğunda çok sayıda akış ve büyük bileşen. |
| 10 | `storageLifecycle.test.ts` | 6.93 | 1,386 | 3 | Büyük lifecycle test yüzeyi; fixture/akışların bakımı. |
| 11–20 | `graphLayout.ts` (7.15), `server/aiService.ts` (7.59), `OutputGallery.tsx` (7.80), `releaseQualification.test.ts` (7.87), `server/routes.ts` (8.82), `PromptInput.tsx` (9.26), `WorkspaceBottomBar.tsx` (9.27), `shared/schemas.ts` (9.50), `tests/routes.test.ts` (10.00), `shared/types.ts` (method score yok) | — | — | — | İncelenen tabloda kalan sonuçlar; `shared/types.ts` için method-based health değeri yok. |

Örnek X-ray metrikleri, yalnızca aday daraltmak için kullanıldı:

- `canonicalModel.ts`: `mergeAnalysisIntoSnapshot` 314 LoC / complexity 115; `buildDecisionInboxFromSnapshot` 189 / 86; `syncStoryBibleWithSceneEntity` 81 / 25; `setEntityAttribute` 107 / 34; `upsertRelationship` 90 / 37.
- `storageEngine.ts`: `migrateProjectPayload` 277 / 80; `reconcileHydratedProjects` 242 / 51; `reloadLatestProjectsFromStorage` 197 / 42; `verifyProjectCacheParity` 90 / 44.
- `nlBatchEngine.ts`: `parseSingleClause` 424 / 73; `validateProposedOperations` 250 / 63; `interpretBatchInstructionLocally` 136 / 25; `applyProposedOperations` 111 / 28.
- `projectController.ts`: `buildReviewDiffModel` 170 / 50; async completion ve preview-commit işlevleri ayrı risk yüzeyleridir.

Bu değerler CodeScene X-ray ekranında görülen satır/complexity değerleridir; bütün işlevler için tam envanter değildir. Biomarker örnekleri arasında Bumpy Road Ahead, Deep/Nested Complexity, Complex Method/Conditional ve Large Method yer alıyordu.

## Açık PR #2 ile karşılaştırma

PR #2 (`refactor/codescene-decision-inbox-projection`) açık ve draft durumundaydı; head `4b9da6eb60f74e67f331ec233a92f8281f25f23c`. Ayrı bir taze GitHub Actions çalışması `45328138604` başarıyla tamamlandı. PR #2'nin kendi raporunda ana hotspot puanları ve 20 satırlık sıralama CodeScene tablosuyla büyük ölçüde uyuşuyor. PR #2 bu bağımsız denetim sırasında değiştirilmedi.

Bu yeni incelemenin düzeltmesi: PR #2 raporunda analiz SHA'sının CodeScene ekranında gösterilmediği yazıyordu; bu oturumdaki Analysis Scope görünümü analiz kaynağını `3526c24fec45c60878937a331e487fc387e28d0b` olarak gösterdi. Bu nedenle SHA belirsizliği giderilmiştir. Buna karşılık CodeScene'in mevcut görünümü PR entegrasyonu veya quality gate'in gerçek kontrolleri hakkında PASS kanıtı sağlamıyor.

PR #2'deki öneriler bir başlangıç adayı olarak değerlendirilebilir; metrikler doğrudan modül çıkarma kararı vermez. Özellikle CodeScene'in boş coupling görünümünü “yapısal öneri yok” diye okumak desteklenmiyor. Değişiklik sırası test kapsamı ve veri bütünlüğü sınırlarını korumalı; her işlev grubu için dar davranış testleri ve ayrı inceleme gerekir.

## Önerilen borç ödeme sırası

Bu sıra **öneridir; uygulama veya owner kararı değildir**. Küçük, davranış koruyucu dilimlerle ilerlenmeli ve her dilim ayrı doğrulanmalıdır.

1. **`canonicalModel.ts` – saf karar projeksiyonlarını ayır.** Önce `mergeAnalysisIntoSnapshot` ve `buildDecisionInboxFromSnapshot` için mevcut davranış karakterizasyonu kur; sonra saf dönüştürücüleri çıkar. Öncelik en düşük sağlık puanı ve yüksek karmaşıklıktır. Canonical snapshot alanları veya karar anlamı değiştirilmemeli.
2. **`storageEngine.ts` – migration/hydration kümelerini daralt.** `migrateProjectPayload`, `reconcileHydratedProjects` ve cache parity için geçiş testlerini sabitle; storage API'leri ve CAS çatışma politikası aynı kalırken iç yardımcıları ayır. Veri kaybı ve eski payload uyumluluğu başlıca risklerdir.
3. **`nlBatchEngine.ts` – parse/validate/apply sınırlarını netleştir.** Parse çıktısı, öneri doğrulaması ve uygulama adımları için tablolı testler ekleyip saf parse/validation çekirdeğini ayır. Onay kapısı ve uygulama sırası değişmemeli.
4. **`ContextualInspector.tsx` ve `projectController.ts` – UI ile asenkron durum sınırları.** Önce render/model kuralları ve stale completion davranışı test edilmeli; görünüm parçaları ancak davranış stabilken ayrılmalı. Review preview/apply/revision korumaları değişmemeli.
5. **`BeliefGraph.tsx`, `App.tsx`, `DecisionInboxPanel.tsx` – sonraki dilimler.** Önce component state/props sahipliği tanımla ve küçük sunum kümeleri ayır; büyük çaplı yeniden yazım önerilmiyor.
6. **`storageLifecycle.test.ts` ve diğer büyük testler – test bakımı.** Ortak fixture'ları ayırmak ancak senaryo adları ve kapsam korunuyorsa değerlendirilmeli; test satırlarını azaltmak tek başına hedef değil.

## Gözlem sınırları

- CodeScene ekranı 11 commit ve tek yazarlı dar tarihe dayanıyor; hotspot sırası yararlı bir tarama sinyali olsa da trend veya kişi performansı değerlendirmesi değildir.
- CodeScene bileşen modeli, PR entegrasyonu ve bazı analiz görünümleri ayarlı/erişilebilir değildi. Ürün koduna ait tahmini maliyet, hata sayısı, çevrim süresi veya cross-commit coupling iddiası raporlanmıyor.
- Bu belge teknik borç denetimidir; test, değişiklik, release onayı veya Stage 0/Stage 1 kararı değildir.
- PR #2 ve PR #1 bu çalışmada güncellenmedi. Bu doküman ayrı bir docs-only PR olarak sunulacaktır.
