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
### Hlavní menu: Kariéra · Hotové scénáře · Sandbox (uživatel 2026-11-22)
- Sandbox bez úkolů a bublin; checklist + bubliny jen v Kariéře
- [x] `doc-researcher` – `40-workload-domains`: WLD ve 9.1 (VCF Operations, vCenter + NSX WLD běží v mgmt doméně),
  inventář VM a součty pro 5 scénářů (Simple 10 VM / 76 vCPU / 251 GB / 7448 GB; HA-Small/Medium/Large; + WLD;
  více WLD; 2 instance)
- [x] `doc-researcher` – velikosti VM z Workbooku 9.1.1 (SDDC Manager, vCenter, NSX, VCF Ops, cloud proxy, Automation,
  control plane/worker, Edge/VNA, Supervisor); tabulky scénářů s dokumentovanými součty + per-VM součty
  - otevřené: License server (≈2 vCPU / 4 GB rozdíl, nedoloženo), počty workerů (stránka vs workbook), disk součty
- [x] `domain-modeler` – `model/deployedInventory.ts`: VM_SIZES (workbook 9.1.1), inventoryForFleet, totalsForFleet
  (documented vs per-VM vs planning), kapacita a vytížení clusteru (2:1 vCPU:pCPU), placeVms (game-scope),
  10 presetů scénářů s1–s5; 45 testů
- [ ] `engine-dev` – hotové scénáře v session (preset → nasazený stav) až po UI v3
- [ ] `scenario-designer` – 5 hotových scénářů (nejmenší Simple, HA, mgmt + WLD, více WLD, více instancí)
- [ ] `ui-dev` – prohlížeč hotového prostředí (VM, zdroje)

### Sandbox v3 – zjednodušení + Kariéra level 1 (uživatel 2026-11-22)
- [x] `ux-designer` – UX.md Část III (kap. 16–27) + GRAPHICS (bez červeného pruhu, šedý rošt místo jantarových žlabů,
  svislý rack s U pravítkem a ToR nahoře, BMC provoz hned); backlog ui-dev U1–U10, engine-dev E1–E8, scenario S1–S3
- [x] `doc-researcher` – `26-esx-install.md` (41 zdrojů): obrazovky instalátoru I-1…I-14 (Welcome Enter, EULA Enter,
  Select a Disk F1/Enter, Keyboard, Root password, Confirm Install F11, Installation Complete), DCUI klávesy a kroky
  (Configure Management Network, Restart/Test), HW minima, CPU deprecated/discontinued, hesla 9.0 vs 9.1
- [x] `doc-researcher` – výška serverů v U (30 modelů, vše 10 z B.3) → `docs/spec/data/server-rack-units.json`, 15 Příloha C
- [x] `engine-dev` – Sandbox v3 E1–E8: ToR-A automaticky nahoře v racku (+ volitelný ToR-B), addNic/removeNic do slotů,
  výšky serverů z dat, ESX konzole (openConsole/consoleKey/batch, data `scenarios/console/esx-console.json`),
  checklist s jedním aktivním krokem + bubliny, registr zdrojů s čitelnými názvy (`npm run gen:sources`),
  `SANDBOX_V3_OPTIONS` (bez úkolů), Kariéra `modes/career` (CareerSession, replay, body, rozpočet 80 000, hodnocení)
  - otevřené: uplink do sítě firmy jen pro první ToR; počet NIC pro storage-separation (model); pravidla hesla ESX
    přesunout do modelu; obsah obrazovek konzole + úkoly levelu 1 dokončí scenario-designer
- [x] `ui-dev` – Sandbox v3 U1–U10: menu Kariéra · Hotové scénáře (Připravujeme) · Sandbox (bez úkolů), zóny pro
  1366/1920, checklist + bubliny v Kariéře, obchod Racky/Servery podle vendora, svislý rack s ToR-A a „+ ToR-B“,
  NIC slot picker, BMC šedý provoz, Zdroj popover s čitelnými názvy, konzole ESX (instalátor + DCUI, batch),
  Kariéra level 1 (briefing, rozpočet, body, výsledek)
  - zbývá: „Zapojit doporučeně“ (engine), části úklidu místnosti, checklist z `objectives.checklist` enginu
- [ ] `scenario-designer` – obsah úkolů v3 + Kariéra level 1 (po engine)

### Sandbox v2 – serverovna s panáčkem (rozhodnutí uživatele 2026-11-21, viz CLAUDE.md)
Tok: fyzická stavba (koupit servery z BCG, switche, rack, kabely, MTU) → hosty (ESX 9, management provoz
se rozběhne) → volba use case podle VCF Installeru → návrh omezený aktuálním HW → postupný deploy.
Grafika: útulná kreslená izometrie (GRAPHICS.md). Ceny = fiktivní měna, v Sandboxu neomezené peníze.
- [x] BCG přímo (orchestrátor, 2026-11-21): API BCG (`viewResults`/`viewDetails`) → `docs/spec/data/
  bcg-vsan-esa-readynodes-esxi91.json` (247 ESA ReadyNodes pro ESXi 9.1: Dell 32, HPE 26, Lenovo 76, Cisco 31,
  Supermicro 82 – profily, CPU, RAM, certifikované disky, NIC, boot) + `bcg-vsan-esa-readynode-hardware-guidance.md`
  (definice profilů HCI/SC/CR SM/MED/LRG); obnova dat: `tools/bcg/fetch-readynodes.sh`
- [x] `doc-researcher` – `15-hardware` přepsán na ověřená data BCG: profily HCI/SC/CR doslovně, třídy REQ/DEV/RCMD,
  Příloha A (aktuální generace 5 vendorů), Příloha B.3 startovní katalog 25 konfigurací (vč. pastí)
  - otevřené: kapacity disků v BOM (rozšířit `tools/bcg` o `program=ssd`), 10GbE na MED/LRG (BCG = odchylka,
    Design Library = REQD), rychlost NIC bez údaje v názvu
- [x] `doc-researcher` – `25-usecases-and-physical`: 10 use cases (UC-1 nová fleet … UC-9 vSphere 8 → 9.1 bez
  installeru) s pořadím kroků; cesta „nejdřív vSphere“ = UC-4/UC-9 + konvergence (VDS 8+, vLCM image, DRS FA…);
  výchozí síť ESX (vSwitch0, vmk0, MTU 1500), jumbo frames, MTU validace installeru s doslovnými hláškami; 13 otázek
- [x] `ui-dev` – serverovna (`render/room/`): místnost, panáček (A*), rack/server/switch jako nábytek, kabely
  s pakety, inventář dole, panel rozhodnutí vpravo, HUD; světlý styl menu; `#/sandbox/mistnost`
- [ ] `domain-modeler` – fyzická vrstva `model/hardware.ts`: katalog z BCG datasetu (15 B.3), validace REQ/DEV/RCMD,
  rack/kabely/switch/MTU, síť po instalaci ESX, aktivní toky podle zapojení, HW → bring-up a návrh *(běží – obnoveno po limitu)*
- [x] `ui-dev` – nálezy z UX review: Hotovo X/N + akordeon, `ui/messages.ts` (4 typy hlášení + 7 štítků), krátké
  intro → „Vstoupit do serverovny“, světlé menu, neutrální kabely s obrysem a proužkem typu, zkratky času `,`/`.`/P,
  a11y (focus ring, bez tabindex na štítcích, 390 px), gate fází přes URL (přesměrování)
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

### Sandbox v2 – interakce v místnosti (uživatel 2026-11-21, GRAPHICS.md „Interaktivní objekty“)
- [x] `ux-designer` – UX.md Část II (kap. 7–14): zásobník pohledů (Místnost → Rack → Host, Tabule, Počítač),
  tracker úkolů (odvozený ze stavu, přeskočitelný), 2D rack + kabeláž, tabule (auto HLD 3 vrstvy + kresba hráče),
  počítač s „OS“ (Návrh VCF v dlaždicích, Use case…), provoz v2 (svazky, tvary teček, karty vmnic); backlog v3
- [x] `doc-researcher` – OOB (`25` §10): OOB je podle docs **mimo scope VCF**, není mezi sítěmi mgmt domény;
  doloženo: BMC má vlastní NIC/IP, zapnutí hostů přes iLO/iDRAC, vzdálená instalace ESX (tabulka firmwaru),
  firmware přes vLCM HSM; KB 376173 (vSwitchBMC) jako možná příčina selhání bring-upu. → ve hře OOB volitelný
  krok „mimo VCF scope – herní“, první dokumentovaná síť = ESX management (vmk0)
- [ ] **Sprint 1** (2026-11-21):
  - [x] `engine-dev` – SandboxSession v2: nákup (herní měna, ∞), umístění/montáž, kabeláž, porty (VLAN/MTU), síť firmy,
    instalace ESX (fyzicky / BMC Dell-HPE-Lenovo), DCUI + test, undo/redo, snapshot physical/flows/hw/objectives,
    engine úkolů (32 selektorů), use cases UC-1…UC-10 (hratelný jen UC-1)
  - [x] `ui-dev` – zásobník pohledů (Místnost → Rack → Host, zoom+crossfade), lupa/hover, 2D rack s kabeláží
    (auto-trasa, a11y vrstva), obchod z BCG katalogu (filtry, porovnání, batoh), provoz v2 (svazky, tvary teček, čip
    Provoz), tracker v HUD
  - [x] `scenario-designer` + `engine-dev` – obsah úkolů A–G (≈40 úkolů s „Proč?“ odkazy)
  - [ ] další: UI pro instalaci ESX/DCUI/síť firmy/use case (API hotové, UI chybí), karty vmnic (host view),
    tabule, počítač; profil `dell-r670-sm` hlásí „pod SM“ (ověřit); bundle 930 kB (dynamický import datasetu)
- [ ] **Sprint 2** (2026-11-21):
  - [x] `ui-dev` A – panel serveru (HW, úprava konfigurace, ESX fyzicky/BMC), DCUI konzole + test sítě, panel switche
    (porty, VLAN, MTU, síť firmy), DNS A+PTR, BMC krok, detail hosta (VMkernel → vSwitch → karty vmnic, řetěz MTU),
    „Ukaž mi“ z trackeru, undo/redo; oprava karty obchodu (id sestavy)
  - [x] `ui-dev` B – stůl + počítač s „OS“ (Use case, Návrh VCF v dlaždicích s HW omezením, Knihovna), tabule s auto
    HLD (Fyzicky/Síť/Logicky) + kresba hráče
  - [x] `domain-modeler` – `dell-r670-sm` v modelu správně HCI-SM (chyba v UI obchodu → ui-dev A); regresní test
    všech 25 řádků B.3 přímo ze specu; `USE_CASE_NOT_MODELLED`; `hostPortRequirements`; `loadHardwareCatalog()`
  - [ ] přepnout session/UI na líné načítání katalogu (bundle) – postup v reportu domain-modelera
  - [ ] **Výběr blueprintu / lokality na startu** (uživatel 2026-11-21):
  - [x] `doc-researcher` – `06-blueprints` (45 zdrojů): 5 fleet blueprintů (Minimal Footprint/Basic 3 hosty,
    Single Site/Basic 4, Multiple Sites in a Single Region/Site HA 4+4, Across Multiple Regions/DR 4+4,
    Single Region plus Additional Region/Fault Domains+DR 4+4+4) – přiřazení modelů k blueprintům je přímo
    v dokumentaci; Site HA: RTT < 5 ms, ≥ 10 GbE, stejný počet hostů v AZ, witness ve 3. lokalitě RTT ≤ 200 ms;
    Edge/DR/Backup blueprinty; mapování na herní lokality (§7a)
  - [x] `domain-modeler` – `model/sites.ts`: 5 lokalit (malá/velká místnost, 2 místnosti v budově, kampus, DR),
    role místností AZ1/AZ2/witness/druhá instance, linky (herní RTT/propustnost) vs. limit 10 §3.3 (≥10 Gbps,
    RTT < 5 ms = error), minima hostů na AZ, kabely mezi místnostmi jen switch–switch, návrh omezený lokalitou
    s odemykacími akcemi; tabulka blueprint → lokalita čeká na `06`
    - doplněno: 5 fleet blueprintů z `06`, předvolba `two-buildings-plus-dr` (Fault Domains+DR), witness RTT ≤ 200 ms,
      stejný počet hostů v AZ, minima stretched (mgmt HA 8 Day 2, WLD 6); DR mezi regiony bez čísel (spec)
  - [x] `ui-dev` C – obrazovka „Vyber design blueprint“ (5 fleet blueprintů z modelu, varianty rozvržení, SVG
    miniatury), parametrická velikost místnosti, areál (budova/kampus/DR mapa), přechody mezi místnostmi, role
    místností v HUD (zatím jen v UI adaptéru `ui/sandbox/siteLayout.ts`)
  - [x] `engine-dev` – `chooseBlueprint` (blueprint ↔ rozvržení), `assignRoomRole`, `moveRackToRoom`, `placeRack` s místností,
    `snapshot.site` (blueprint, odchylky, místnosti, AZ, kontroly), předvyplnění návrhu z blueprintu, cíl hostů
    podle blueprintu, skupina úkolů L (AZ link, witness, 2. instance, hosty na AZ); `autoBmc` (OOB switch v každé
    místnosti, BMC se zapojí po montáži, IP 10.0.99.x – herní; skupina B skrytá)
    - otevřené: kapacita místnosti počítá i racky v inventáři (model)
- [ ] **Racky a rack awareness** (uživatel 2026-11-21):
  - [x] `domain-modeler` – 3 racky (24U/42U/48U, herní ceny), `model/roomLayout.ts`: orientace, studená/teplá
    ulička, zákaz racku před jiným, řady se stejnou orientací, dveře/vybavení, kapacita; `suggestRackTiles` pro náhled
    - otevřené (herní): průchod od dveří ke každé uličce, širší uličky, 48U větší půdorys
  - [x] `engine-dev` – `validateRackPlacement` v `placeRack`/`moveRackToRoom`, nový `rotateRack`, `model/roomFixtures.ts`
    (sdílené dlaždice stolu, tabule, patch panelu, dveří, OOB switche v rohu 0,0), snapshot `placement`/`aisles`/hints,
    kapacita místnosti jen pro umístěné racky
  - [x] `ui-dev` – ghost z `placement` (modré/šrafované dlaždice s důvodem z modelu), studená/teplá ulička, šipky čela,
    3 výšky racků, otočení R, OOB switch na zdi, velikost místnosti z enginu
  - [x] `doc-researcher` – `50-vsan` (37 zdrojů): fault domain = rack; multi-rack min. 3 racky (REQD), doporučeno 4;
    FTT=n → 2n+1 FD; ESA RAID minima, Auto-RAID 9.1 (RAID-6 default); FD ručně ve vCenter, vypnout auto-policy,
    bez Reserved Capacity; L2 vs L3 (per-rack VLAN/subnet/TEP pool/uplink profile/sub-TNP); výpadek racku
  - [x] `domain-modeler` – `model/rackAwareness.ts`: `deriveClusterTopology` (single/multi-rack L2/L3/stretched/
    inconsistent z rozmístění hostů a cest vmk0), fault domains (doslovné hlášky), ESA RAID tabulka + Auto-RAID 9.1,
    multi-rack checklist (REQD-CFG-002..005), L3 per rack (uplink profile, TEP pool, sub-TNP, HA isolation address),
    design vs. fyzika (`RACK_CLUSTER_MODEL_MISMATCH`), `simulateRackFailure`; 29 kódů, 46 testů
    - otevřené: OQ1 (FD v mgmt default clusteru „Non Supported“ vs L2 podporováno), rezerva na výpadek racku
      nedokumentovaná, hosty WLD clusteru zatím mimo HardwareContext, UI pro FD/policy (vSphere Client v PC)
  - [x] `ui-dev` – nové téma (GRAPHICS.md T0–T11): navy HUD, brand červená jen CTA, enterprise panely, téma console
    v PC, vlastní SVG ikony místo emoji, okno „O hře“ s disclaimerem
    - neověřeno: kontrast přes devtools, grayscale test
- [x] `ux-designer` – téma inspirované Broadcom/VCF (GRAPHICS.md T0–T11): brand červená jen pro CTA, navy/grafit,
  enterprise panely, téma `console` pro PC, AA kontrasty, úprava barev Management/NFS kvůli barvosleposti,
  tmavší vendor štítky, vlastní SVG ikony; checklist 15 bodů pro ui-dev
- [ ] (odloženo do funkčního milníku) `code-reviewer` + `ux-designer` review → `fact-checker`

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
