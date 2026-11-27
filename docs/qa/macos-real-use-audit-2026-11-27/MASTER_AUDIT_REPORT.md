# PCC installed macOS app audit — 2026-11-27

> **Qualification status: PARTIAL / NOT READY FOR RELEASE SIGN-OFF.** This evidence branch records the installed-app observations and confirmed source mechanisms available in this audit session. It does not claim complete coverage of every advertised control, import/export format, restart path, or provider operation.

## Yönetici özeti

Kurulu Proactive Co-Creator uygulaması gerçek macOS penceresinde açıldı. Sahip verisini korumak için uygulama içindeki sentetik `PCC QA Synthetic 2026-11-27` projesinde çalışıldı; Archangel metni düzenlenmedi ve AI sağlayıcısına gönderilmedi. Sentetik yazı alanı düzenlenip kaydedildi, Preview/Edit arasında geçiş yapıldı ve Review içindeki yerel deterministik kontroller çalıştırıldı.

Tekrarlanabilen ana bulgu ayarlardaki model kataloğu durumuyla ilgili: GPT-6 Luna ve Medium, AI Settings ilk açıldığında görünüyordu. Katalog yenilendikten sonra modal kapatılıp açılınca varsayılan model ve reasoning `Saved ... unavailable` oldu; ayrı ChatGPT tercihi GPT-6 Luna / Medium olarak görünmeye devam etti. Bu, görünen tercihlerin silinmesinden ziyade modal açılışında katalog seçilebilirlik durumunun stale yapılmasıyla uyumlu. Kaynak kodda aynı davranışı açıklayan durum akışı bulundu.

Review'de yerel kontrol çalıştı ve takip edilen sorun değişikliği bulmadı. AI semantik analiz, manuscript değişikliği analizi ve otomatik analiz kontrolleri Gemini sunucu anahtarı olmadığı gerekçesiyle devre dışıydı. Writing Assistant da aynı Gemini anahtarı mesajını gösterdi. Bu kontrollerin ChatGPT bağlantısını kullanmasının beklenip beklenmediği, ürün politikası ve kaynak akışı tam uçtan uca doğrulanamadığından burada “beklenen kısıt” ile “yanıltıcı/bozuk kullanılabilirlik” kesin biçimde ayrıştırılamıyor.

**Kritik sınır olayı:** Plan'da Reanalyze Idea görsel olarak kullanılamaz gibi görünürken tıklama bir analiz yüklenme durumuna geçti. Escape ile yüklenme kapandı. O sırada uygulama sürecinde dış TLS bağlantısı kısa süre gözlendi; hedef, istek içeriği, upstream kabulü ve olası kullanım/billing etkisi kanıtlanamadı. Bu işlem planlanan izin kapsamının dışında olabilecek bir provider isteği olduğundan raporda olası yetki/admission sorunu ve denetim sırasında yanlışlıkla başlatıldığı açıkça kayda geçirildi. Eylem tekrar edilmedi; üretilmiş story yok.

Plan'ın bazı Story Bible/Opportunities ve Review kısayollarına tıklama yeni içerik göstermedi veya Plan'a geri döndürdü. More views menüsü Timeline ve Mind map seçeneklerini gösterdi; Timeline görünür değişiklik yapmadı. Review'de yerel kontrol dışında AI kontrolleri devre dışıydı. Bunlar UI gözlemidir; her tıklama için ayrı ekran görüntüsü kaydedilmedi.

Bu rapor onarım uygulamaz, PR #21'i birleştirmez ve uygulamayı dağıtmaz. Bağımsız incelemeye sunulan kapsam, eksik testleri açıkça listeler.

## English technical summary

### Confirmed runtime observations

- Installed application: `/Applications/Proactive Co-Creator.app`, bundle ID `com.centaurioun.proactive-co-creator`, app-reported version/build `0.0.0`, runtime origin `127.0.0.1:4319`.
- Bundle `app.asar` SHA-256: `b1d85c3ab2a05fcc84b56e3484a6dc1dec83e869789c11d9db93fa290e0f5000`.
- Host: macOS 27.0.1 (26A434), arm64 / Apple Silicon. The installed process was observed as PID 98994 during initial inspection.
- Repository comparison base for this evidence branch: candidate `feat/macos-desktop-app` at `ba6ab324cb023d26f53381cbc0d253a43724c688`. Exact source-to-installed-bundle identity was **not established**. The host Node version is not evidence of Electron's bundled Node version. Embedded Node and Chromium versions remain unknown.
- Synthetic manuscript editing and Preview/Edit interaction succeeded; app showed a saved revision. Review local deterministic checks completed and reported no tracked issue changes.
- AI Writing Assistant stated that it was unavailable because the server Gemini API key was not configured. Review's AI semantic analysis, manuscript analysis, and auto-analysis controls were disabled for the same reason.
- Reopening AI Settings reproduced unavailable default model/reasoning selectors while separate ChatGPT preferences remained GPT-6 Luna / Medium.
- Reanalyze Idea produced a spinner after a click; cancellation closed it. A transient outbound TLS socket was observed, but the destination and request outcome were not verified.

### Findings and confidence

| ID | Severity | Status | Finding | Root cause confidence |
|---|---:|---|---|---|
| PCC-MAC-D01 | P1 | Confirmed UI defect | Default model and reasoning controls become unavailable after reopening settings although the separate ChatGPT preference remains saved. | High for renderer mechanism; exact persisted-value behavior after relaunch remains untested. |
| PCC-MAC-D02 | P2 | PARTIAL | Review AI controls and Writing Assistant are Gemini-key gated while ChatGPT is connected. Whether this is policy or stale legacy availability propagation is unresolved. | Low / not confirmed. |
| PCC-MAC-D03 | P1 candidate | PARTIAL / safety incident | A seemingly unavailable Reanalyze control started a spinner and a transient external TLS socket appeared. Provider receipt/billing is unknown. | Source-level admission concern confirmed; live request completion unknown. |
| PCC-MAC-NAV-01 | P2 | PARTIAL | Several Plan/Review shortcut clicks failed to expose a distinct destination; some returned to Plan. | Runtime observation only; exact handler/root cause unverified. |
| PCC-MAC-D05 | P2 candidate | PARTIAL | Writing Assistant displayed a Gemini-key-specific unavailable notice despite connected ChatGPT. Manual editing remained available. | Mismatch observed; expected policy vs availability bug unresolved. |

### Application verdict

The installed app supports basic synthetic manual writing, save, Preview/Edit, and local Review checks. AI-assisted writing/review and several navigation controls did not qualify in this run. The app is **not qualified for release based on this partial audit**. No real provider generation was intended or confirmed. D03 leaves uncertainty about whether an outbound request reached a provider.

No independent defect count is claimed beyond the one reproduced settings UI defect. D02/D03/D05 are explicitly partial or candidate findings pending controlled no-network validation. Credential persistence security was not empirically qualified; source inspection found a plaintext fallback when Electron `safeStorage` encryption is unavailable (see Security review).

## Scope and method

Native macOS UI observation of the installed app; synthetic project; screenshots for settings, synthetic editor, Writing Assistant, Plan preflight and the interrupted analysis state. Supplemented by source inspection of the matching desktop candidate. No real provider inference test was intentionally run. Only local deterministic checks ran in Review.

## Related evidence

- [Owner-reported issues](OWNER_REPORTED_ISSUES.md)
- [Functional matrix](FUNCTIONAL_TEST_MATRIX.md)
- [Provider operation matrix](AI_PROVIDER_OPERATION_MATRIX.md)
- [Findings ledger](FINDINGS_LEDGER.md)
- [Security and data integrity review](SECURITY_AND_DATA_INTEGRITY_REVIEW.md)
- [Repair plan](RECOMMENDED_REPAIR_PLAN.md)
- [Coverage and limitations](COVERAGE_AND_LIMITATIONS.md)
- [Evidence manifest](EVIDENCE_MANIFEST.md)
