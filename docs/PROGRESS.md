# Stav projektu

## Hotovo
- [x] Noví agenti (2026-11-21): `code-reviewer` (správnost + bezpečnost, OK nutné pro hotovou oblast),
  `ux-designer` (user-friendly grafika a chování, `docs/design/UX.md`)
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
### Sandbox v2 – serverovna s panáčkem (rozhodnutí uživatele 2026-11-21, viz CLAUDE.md)
Tok: fyzická stavba (koupit servery z BCG, switche, rack, kabely, MTU) → hosty (ESX 9, management provoz
se rozběhne) → volba use case podle VCF Installeru → návrh omezený aktuálním HW → postupný deploy.
Grafika: útulná kreslená izometrie (GRAPHICS.md). Ceny = fiktivní měna, v Sandboxu neomezené peníze.
- [x] BCG přímo (orchestrátor, 2026-11-21): API BCG (`viewResults`/`viewDetails`) → `docs/spec/data/
  bcg-vsan-esa-readynodes-esxi91.json` (247 ESA ReadyNodes pro ESXi 9.1: Dell 32, HPE 26, Lenovo 76, Cisco 31,
  Supermicro 82 – profily, CPU, RAM, certifikované disky, NIC, boot) + `bcg-vsan-esa-readynode-hardware-guidance.md`
  (definice profilů HCI/SC/CR SM/MED/LRG); obnova dat: `tools/bcg/fetch-readynodes.sh`
- [ ] `doc-researcher` – přepsat `15-hardware` na ověřená data z `docs/spec/data/` (místo [BCG-idx])
- [x] `doc-researcher` – `25-usecases-and-physical`: 10 use cases (UC-1 nová fleet … UC-9 vSphere 8 → 9.1 bez
  installeru) s pořadím kroků; cesta „nejdřív vSphere“ = UC-4/UC-9 + konvergence (VDS 8+, vLCM image, DRS FA…);
  výchozí síť ESX (vSwitch0, vmk0, MTU 1500), jumbo frames, MTU validace installeru s doslovnými hláškami; 13 otázek
- [x] `ui-dev` – serverovna (`render/room/`): místnost, panáček (A*), rack/server/switch jako nábytek, kabely
  s pakety, inventář dole, panel rozhodnutí vpravo, HUD; světlý styl menu; `#/sandbox/mistnost`
- [ ] `domain-modeler` – fyzická vrstva: server (CPU/RAM/disky/NIC), switch, rack, kabely, MTU, validace HW
  proti ReadyNode/10-planning; katalog z `15-hardware`; use cases z `25`
- [ ] `engine-dev` – Sandbox v2: nákup (herní měna), stavba, provoz odvozený ze stavu (management flows),
  odemykání kroků; napojit stávající návrh a bring-up
- [ ] `ui-dev` – obchod, umisťování, kabeláž, konfigurace hostů; pak use case, návrh, deploy v novém stylu
- [ ] `fact-checker` – Sandbox v2
- [x] `ux-designer` – `docs/design/UX.md`: tok v2 (7 fází), onboarding T1–T7, 4 typy hlášení, backlog 25 položek
  (MVP „první host online“); review: „Nerozhodnuto“ ≠ chyba, akordeon místo svitku, kontrast paketů na světlé podlaze
- [x] `code-reviewer` – OK (0 blokujících); důležité: neomezený `expandPool` (IP pool /8 zamrzne), obejití gate
  přes hash, UI návrhu mimo `SandboxSession`, revision/snapshot cache se zahazuje každý tick
- [x] opravy z code review: IP pooly jako intervaly (`model/net.ts`, diferenciální test 400 scénářů); engine loop
  nezávislý na Pixi (`engine/loop.ts`), deep-freeze stavu (`engine/freeze.ts`), revision se nemění při nečinnosti,
  průběh úloh odděleně (`progressRevision`); render už nemění rychlost hry; chyba startu zobrazena
- [ ] (z review, zbývá – řeší UI v2) gate fází přes hash a UI návrhu napojit na `SandboxSession`

### Sandbox v1 (původní tok Návrh → Příprava → Deploy)
- [x] `ui-dev` – hash router, hlavní menu (Sandbox / Kariéra „Připravujeme“ / Ukázka provozu), úvod Sandboxu,
  stepper Návrh → Příprava → Deploy (placeholdery); extension point `ui/sandbox/designData.ts` →
  `loadDesignStepData()` + typy `DesignDecision`/`DesignOption` (povinné `sources`)
- [x] `doc-researcher` – `docs/spec/05-design.md` (44 zdrojů): workloady v management doméně **povolené**
  („Can also run business workloads“), doporučená samostatná WLD (VCF-WLD-RCMD-CFG-002); 8 návrhových
  rozhodnutí s volbami a závislostmi, 50+ design decision ID; termín „consolidated“ v 9.x nenalezen;
  část citací parafráze → ověřit při fact-checku; 12 otevřených otázek
- [x] `domain-modeler` – `model/design.ts`: 19 rozhodnutí v 8 krocích, 37 design decision ID, 20 omezení
  (REQD/nepodporované/Day 2 = error, RCMD = warning), `validateDesign`, `optionAvailability`,
  `deriveBringupParams` (→ min. hostů), `summarizeDesign`; 18 nových kódů
  - rozpor 00 §6 vs 05 §2.3 (Multi-Rack L2 v mgmt doméně podle fleet modelu) – zatím warning → ověřit
  - mapování management network / VDS modelu na kroky wizardu je inference → ověřit fact-checkerem
- [x] `engine-dev` – `modes/sandbox`: `SandboxSession` (dispatch/snapshot/subscribe/attachTo), brány fází jen přes
  model, předvyplnění wizardu z návrhu (zamčená pole), úlohy s průběhem (`engine/tasks.ts`, ilustrativní trvání)
  - otevřené: selhání nasazení/retry nemodelováno (spec 20 §8 q6), rozdělení provozu mezi VDS ilustrativní
- [x] `ui-dev` – fáze Návrh: 8 kroků z modelu, odchylky RCMD, důsledky, souhrn + izometrický náhled; úvod upraven
- [~] `ui-dev` – napojení na `SandboxSession`, Příprava a Deploy – přerušeno limitem; nahrazeno Sandboxem v2
- [ ] `fact-checker` – Sandbox: návrh + bring-up proti specu

### Ostatní
- [x] `scenario-designer` – kampaň 1 (bring-up), 6 misí: tutoriál installer → ESX hosty → depot → bring-up Simple
  → troubleshooting (8 chyb validace) → návrh HA pro produkci; schéma misí `scenarios/schema.ts`
  (úkoly, pasti na validační kódy, body/srážky, rozpočet jako herní mechanika), README
- [x] `domain-modeler` – registr `VALIDATION_CODES` (117 kódů, typově vynucený) + `MGMT_DOMAIN_TOO_FEW_HOSTS`
  (single-rack / multi-rack L2: vSAN 3/4, NFS/FC 2/4; stretched vSAN 6/8) zapnuto ve výchozím stavu
- [x] `scenario-designer` – mise 6: past `MGMT_DOMAIN_TOO_FEW_HOSTS` (3 hosty pro HA + vSAN), 270 / 175 bodů;
  README a schema pročištěny
- [x] `fact-checker` bring-up 2026-11-20 → **NEOK**: 23 tvrzení ověřeno (čísla, limity, wizard, sizing OK);
  blokující: zákaz `.local` platí jen pro FQDN VCF management services / kontejnerových služeb, ne pro
  vCenter/ESX/NSX/SDDC Manager [S19] – model `validateFqdnSyntax` + mise 5 (past `tr-local`) + spec 20 §3.5/§5.1
- [ ] Opravy po fact-checku:
  - [x] `doc-researcher` – spec 20 §3.5/§5.1: `.local` zakázané jen pro Fleet/Instance components, Identity broker,
    VCF services runtime, VCF Automation (+ jeho services runtime); povolené pro vCenter, ESX, NSX, SDDC Manager,
    VCF Operations; nejasné Cloud Proxy / License Server / installer (q15) → nevalidovat; replica FQDN jen HA (q10)
  - [x] `domain-modeler` – `FQDN_LOCAL_DOMAIN` jen pro management services pole;
    drobné: `SERVICES_RUNTIME_IPS_BELOW_RECOMMENDED` není doložený warning, `CONVERGENCE_NOT_MODELLED` není VCF
    chyba (zakázat v UI), `new-instance` vkládá fleet-level služby, NFS + installer na mgmt hostu (ruční mount),
    plné znění hlášky NFS, heslo „part of“ slova/jména
  - [x] `scenario-designer` – pořadí misí podle [S5] (1 ESX hosty → 2 VCF Installer → 3 depot …); mise 2: past
    chybějící PTR installeru + kontroly po nasazení; mise 5: `.local` past na VCF services runtime FQDN + kvíz;
    texty o 30 IP jako doporučení. Mezera: „SSH jako vcf“ a „ping na hosty“ jen v kvízu
  - [x] `ui-dev` – úvod Sandboxu: zmírnit „každá chybová hláška vychází z dokumentace“ (hlášky jsou popisné)
  - [ ] `fact-checker` – znovu po opravách
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
- ReadyNode servery (modely 5 vendorů) nejdou z BCG strojově číst – buď uživatel exportuje seznam ESA ReadyNodes
  pro 9.1 z prohlížeče (CSV), nebo ve hře zůstanou modely označené „neověřeno“ [BCG-idx]
- FQDN třídy: load balancer VCF Operations, Cloud Proxy, License Server, installer = „unclassified“ (spec je
  nezařazuje) → `.local`/velká písmena se nekontrolují; software depot v nové instanci – spec neříká (model vynechává)
- Nové úrovně v modelu: severity `recommendation` (doporučení z docs, ne hláška systému), `scope: 'game-scope'`
  (omezení hry, ne chyba VCF) – UI je musí zobrazovat odlišně
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
