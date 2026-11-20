# Stav projektu

## Hotovo
- [x] Kostra projektu: CLAUDE.md, agenti, VERSION.md (9.1.1), grafický design
- [x] `version-scout` 2026-11-20 – nejnovější GA stále 9.1.1; nové patche vCenter 9.1.1.0200 (CVE fix, 19. 11.)
  a vSAN File Services 9.1.1.0200 (SMB fix, 26. 10.) – bez nových funkcí; až vzniknou spec `52-vsphere`, `50-vsan`,
  `60-lifecycle`, zohlednit je
- [x] `engine-dev` – projekt v `game/`: Vite 8 + TS 7 (strict) + PixiJS 8 + Vitest 5; GameClock (0/1/4/16×),
  EventBus, GameSnapshot, GameEngine; oddělení vrstev hlídá `tsconfig.core.json` + `architecture.test.ts`;
  placeholder izometrická mřížka 10×10 (13 testů OK, build OK)
- [x] `doc-researcher` – `docs/spec/00-architektura.md` (21 zdrojů; hierarchie, komponenty 9.1, management services,
  topologie, sizing; 11 otevřených otázek ve specu, sekce 8) – čeká na fact-checker spolu s bring-up
- [x] `doc-researcher` – `docs/spec/20-deployment.md` (36 stránek TechDocs; VCF Installer, příprava ESX, depot,
  20 kroků wizardu 9.1 + rozdíly 9.0, JSON spec, známé chyby, sizing, IP/FQDN, 17 síťových toků; konvergence
  a upgrade high-level; 14 otevřených otázek ve specu, sekce 8)
- [x] `doc-researcher` – porty v sekci 7 obou speců (00: 26 toků / 17 s portem; 20: 31 toků / 23 s portem).
  ports.broadcom.com je JS aplikace a nejde stáhnout → porty z TechDocs + KB, část jen pro 9.0.x / 5.2.2
- [x] `ui-dev` – izometrický prototyp: 2 racky (ToR-A/B + 4 hosty), bezier kabely, pakety podle typu provozu
  (ParticleContainer, pool), zátěž 80/95 %, dropy, legenda, čas 0/1/4/16×, hover tooltip, pan/zoom, LOD;
  demo data v `render/demo/` (ilustrativní); kontrakt `TrafficSource`/`LinkTraffic` pro budoucí engine.
  Neověřeno: 60 FPS na reálném slabém HW, pinch-zoom, refit při resize
- [x] `domain-modeler` – bring-up: `model/architecture.ts`, `bringup.ts`, `validation.ts`, `net.ts`; installer
  (installer → SDDC Manager mode), příprava ESX, depot/binárky, vstupy wizardu 9.1.1, 99 kódů validací
  (error/warning + specRef), stavový automat nasazení, `buildFleetFromBringup()`; 201 testů. 18 TODO (viz níže)
- [x] `doc-researcher` – `docs/spec/10-planning.md` (42 zdrojů, hlavně Design Library 9.1): DNS, IP, MTU/VLAN,
  NIC, HW ESX (ESA/OSA), **min. hostů mgmt domény: vSAN 3 Simple / 4 HA, NFS/FC 2 / 4; stretched 6 / 8**,
  HA admission control, vCPU:pCPU ≤ 2:1, resource check installeru = warning [9.0.x]; 13 otevřených otázek

## Další kroky
### Sandbox (priorita uživatele, 2026-11-20)
- [x] `ui-dev` – hash router, hlavní menu (Sandbox / Kariéra „Připravujeme“ / Ukázka provozu), úvod Sandboxu,
  stepper Návrh → Příprava → Deploy (placeholdery); extension point `ui/sandbox/designData.ts` →
  `loadDesignStepData()` + typy `DesignDecision`/`DesignOption` (povinné `sources`)
- [x] `doc-researcher` – `docs/spec/05-design.md` (44 zdrojů): workloady v management doméně **povolené**
  („Can also run business workloads“), doporučená samostatná WLD (VCF-WLD-RCMD-CFG-002); 8 návrhových
  rozhodnutí s volbami a závislostmi, 50+ design decision ID; termín „consolidated“ v 9.x nenalezen;
  část citací parafráze → ověřit při fact-checku; 12 otevřených otázek
- [ ] `domain-modeler` – model návrhu `model/design.ts` (rozhodnutí, závislosti, REQD=error / RCMD=warning) *(běží)*
- [ ] `engine-dev` – Sandbox režim: návrh → příprava → bring-up přes model, stav sandboxu
- [ ] `ui-dev` – obsah fáze Návrh (data z modelu) a wizard bring-upu (kroky 9.1.1 ze specu 20)
- [ ] `fact-checker` – Sandbox: návrh + bring-up proti specu

### Ostatní
- [x] `scenario-designer` – kampaň 1 (bring-up), 6 misí: tutoriál installer → ESX hosty → depot → bring-up Simple
  → troubleshooting (8 chyb validace) → návrh HA pro produkci; schéma misí `scenarios/schema.ts`
  (úkoly, pasti na validační kódy, body/srážky, rozpočet jako herní mechanika), README
- [x] `domain-modeler` – registr `VALIDATION_CODES` (117 kódů, typově vynucený) + `MGMT_DOMAIN_TOO_FEW_HOSTS`
  (single-rack / multi-rack L2: vSAN 3/4, NFS/FC 2/4; stretched vSAN 6/8) zapnuto ve výchozím stavu
- [x] `scenario-designer` – mise 6: past `MGMT_DOMAIN_TOO_FEW_HOSTS` (3 hosty pro HA + vSAN), 270 / 175 bodů;
  README a schema pročištěny
- [ ] `fact-checker` pro bring-up (spec 00/10/20 + model + mise) *(běží)*
- [ ] `engine-dev` – vrstva režimů `game/src/modes/` (viz CLAUDE.md „Herní režimy“):
  - [ ] Sandbox – volné akce nad modelem, bez misí a peněz
  - [ ] Kariéra – mise, úkoly a body (formát dohodnout se `scenario-designer`)
  - [ ] Kariéra – ekonomika: rozpočet, katalog HW (fiktivní ceny), nákup, kapacita/HA podle specu
- [ ] `ui-dev` – HUD kariéry (rozpočet, body, úkoly)
- [ ] `doc-researcher` – pro ekonomiku a HA dál: `50-vsan` (storage policies, FTT), `52-vsphere` (HA, DRS)

## Kampaně – režim Kariéra (rozcestník: VCF Upgrade Planner)
1. [ ] Nové prostředí – bring-up první instance (spec `20-deployment`)
2. [ ] Migrace – konvergence existujícího vSphere do VCF 9.1 (spec: konvergence v `20-deployment`, rozšířit)
3. [ ] Upgrade VCF 5.2 → 9.1 a 9.0 → 9.1 – pořadí komponent (spec: upgrade v `20-deployment` + `60-lifecycle`)
4. [ ] Den 2 – nová workload doména (`40-workload-domains`), nová instance ve fleetu

## Otevřené otázky
- Min. hosty: stretched NFS/FC (vMSC, KB 417356 „doubled“?), další clustery mgmt/WLD (sloučené buňky) – nemodelováno;
  `Cluster` v architecture.ts nemá storage → doplnit v oblasti 40/50
- Sizing: vzorec z Planning and Preparation Workbooku (xlsx, tab „Management Domain Sizing“) – agent ho
  nerozbalil; HA řádky tabulky minim hostů (sloučené buňky) ověřit v PDF
- Model bring-up – TODO (detail v reportu domain-modelera, kód má komentáře TODO):
  min. počet hostů greenfield mgmt domény (parametr, vypnuto); replica FQDN v Simple; workery services runtime
  Simple (2 vs 3); VCF Automation HA-Small (1 vs 3 uzly); texty validačních hlášek (doslovně jen z RN);
  pole „ESX host details“/„vCenter details“; názvy interních úloh bring-upu; konvergence, VVF, deferred
  komponenty a 9.0 wizard nemodelovány; kontrola kapacity hostů vs. sizing chybí (→ `10-planning`)
- Porty: ports.broadcom.com nejde agentem přečíst (JS) – uživatel může tabulky pro VCF 9.1 exportovat/zkopírovat
  ručně; chybí porty pro vSAN, vMotion, NSX TEP/Edge, Identity broker, Salt, cloud proxy → VCF Ops
- Rozpory ve specu 00 (Simple model – 2 vs 3 workery; VCF Automation HA-Small) → ověřit při fact-checku
- Minimální počty hostů domén/clusterů → oblast `10-planning` (spec 20 má jen čísla ze stránky o konvergenci)
- API VCF Installeru: developer.broadcom.com povolen pro API (uživatel, 2026-11-20) → doplnit při misích s API
