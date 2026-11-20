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

## Další kroky
- [ ] `doc-researcher` – doplnit porty a protokoly do sekce „Síťový provoz“ ve `00-architektura` (a `20-deployment`)
  z webu Broadcom Ports and Protocols (povoleno uživatelem 2026-11-20)
- [ ] `ui-dev` – izometrický prototyp: rack s hosty a animovaný provoz *(běží)*
- [ ] `domain-modeler` → `scenario-designer` → `fact-checker` pro bring-up (vzorová oblast)
- [ ] `engine-dev` – vrstva režimů `game/src/modes/` (viz CLAUDE.md „Herní režimy“):
  - [ ] Sandbox – volné akce nad modelem, bez misí a peněz
  - [ ] Kariéra – mise, úkoly a body (formát dohodnout se `scenario-designer`)
  - [ ] Kariéra – ekonomika: rozpočet, katalog HW (fiktivní ceny), nákup, kapacita/HA podle specu
- [ ] `ui-dev` – hlavní menu (Sandbox / Kariéra), HUD kariéry (rozpočet, body, úkoly)
- [ ] `doc-researcher` – pro ekonomiku a HA: požadavky na HW, minimální počty hostů, HA/failure tolerance
  (oblasti `10-planning`, `50-vsan`, `52-vsphere`)

## Kampaně – režim Kariéra (rozcestník: VCF Upgrade Planner)
1. [ ] Nové prostředí – bring-up první instance (spec `20-deployment`)
2. [ ] Migrace – konvergence existujícího vSphere do VCF 9.1 (spec: konvergence v `20-deployment`, rozšířit)
3. [ ] Upgrade VCF 5.2 → 9.1 a 9.0 → 9.1 – pořadí komponent (spec: upgrade v `20-deployment` + `60-lifecycle`)
4. [ ] Den 2 – nová workload doména (`40-workload-domains`), nová instance ve fleetu

## Otevřené otázky
- Rozpory ve specu 00 (Simple model – 2 vs 3 workery; VCF Automation HA-Small) → ověřit při fact-checku
- Minimální počty hostů domén/clusterů → oblast `10-planning` (spec 20 má jen čísla ze stránky o konvergenci)
- API VCF Installeru: dokumentace odkazuje na developer.broadcom.com (není povolený zdroj) – povolit? (uživatel)
