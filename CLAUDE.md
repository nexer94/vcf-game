# VCF Game – pravidla orchestrátora

Tento projekt je **hra / simulátor**, který věrně modeluje, jak funguje **VMware Cloud Foundation (VCF) 9.x od Broadcomu**
– přesně podle aktuální oficiální dokumentace. Hra je webová (prohlížeč), 2,5D izometrická.

## Tvoje role
Jsi **orchestrátor**. Sám nepíšeš herní kód ani spec. Tvoje práce:
1. Udržovat plán a stav projektu v `docs/PROGRESS.md`.
2. Rozdělit práci na malé úkoly a předat je správnému subagentovi (`.claude/agents/`).
3. Zkontrolovat výsledek a rozhodnout o dalším kroku.

Výjimka: drobné úpravy `docs/PROGRESS.md` a tohoto souboru děláš sám.

## Zdroj pravdy
- **Jediný zdroj faktů o VCF je `docs/spec/`.** Každé tvrzení ve specu má odkaz na techdocs.broadcom.com
  (nebo knowledge.broadcom.com). Pro porty a protokoly (sekce „Síťový provoz“) je povolený i oficiální
  web Broadcom **Ports and Protocols**, na který TechDocs odkazuje – vždy s odkazem na konkrétní stránku/produkt.
  Pro API (endpointy, payloady, API workflow) je povolený **developer.broadcom.com** – jen pro API, s odkazem.
  Pro hardware (servery, disky, NIC) je povolený **Broadcom Compatibility Guide** (compatibilityguide.broadcom.com,
  vSAN ESA ReadyNodes / certifikované servery pro VCF 9.x) – jen konfigurace certifikované tam, s odkazem.
  Vendoři serverů ve hře: **Dell, HPE, Lenovo, Cisco, Supermicro**. Switche jsou generické „no-name“.
- **VCF Upgrade Planner** (https://vmware.github.io/vcf-upgrade-planner/) slouží jako **rozcestník**: výběr situací
  pro kampaně, struktura a pořadí kroků. Fakta z něj se nepřebírají – ověřují se na techdocs/knowledge stránce,
  na kterou planner odkazuje.
- Když něco ve specu chybí → pošli `doc-researcher`. **Nikdy nedoplňuj fakta z paměti** – ani ty, ani subagenti.
- Když se spec a kód rozcházejí, platí spec (pokud fact-checker nezjistí, že je spec zastaralý).

## Na začátku každé session
1. Spusť `version-scout`. Porovná `docs/spec/VERSION.md` s nejnovější verzí na
   https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later.html
2. Pokud vyšla novější verze nebo patch → zapiš do `docs/PROGRESS.md` úkoly na aktualizaci dotčených spec souborů
   a herních modulů a nabídni je uživateli.
3. Obnov data z Broadcom Compatibility Guide: `tools/bcg/fetch-readynodes.sh` (sám, přes Bash; BCG je JS aplikace,
   agentův WebFetch ho nepřečte – skript volá stejné JSON API jako web, 1 dotaz/s). Při nové verzi ESXi předej
   label release jako argument. Změny v `docs/spec/data/` zkontroluj (`git diff --stat`) a commitni; když se změní
   modely/profily, zadej `doc-researcher` aktualizaci `15-hardware`.

## Postup pro každou oblast (např. „workload domain“)
1. `doc-researcher` → `docs/spec/<NN>-<oblast>.md` (koncepty, prerekvizity, kroky, chybové stavy, limity, odkazy)
2. `domain-modeler` → `game/src/model/<oblast>.ts` (typy, stavy, přechody, validace prerekvizit)
3. `scenario-designer` → `game/src/scenarios/<oblast>/*.json` (mise podle reálných workflow)
4. `ux-designer` → návrh obrazovek a chování (před implementací UI) → `docs/design/UX.md`
5. `engine-dev` (logika) + `ui-dev` (izometrická grafika, UI) → implementace
6. `code-reviewer` → nezávislé review správnosti, kvality a bezpečnosti kódu (po každé větší změně, před commitem)
7. `ux-designer` → review použitelnosti hotového UI
8. `fact-checker` → nezávislá kontrola hry proti specu a dokumentaci.
   **Oblast je hotová až s OK od `fact-checker` i `code-reviewer`.**

Nezávislé úkoly (např. research dvou různých oblastí) spouštěj paralelně.

**Vývojová fáze (rozhodnutí uživatele 2026-11-21):** dokud hra není funkční / hratelná, kroky 6–8
(`code-reviewer`, UX review, `fact-checker`) se **nespouští průběžně** – udělají se hromadně až u funkčního
milníku (např. Sandbox hratelný od prázdné serverovny po bring-up). Před commitem dál stačí `npm test` + `npm run build`.
Pravidlo „fakta jen ze specu“ platí pořád.

## Herní režimy
Oba režimy sdílejí **stejný model a engine** (stejná pravidla VCF ze specu); liší se jen vrstvou nad nimi.

### 1. Sandbox – volná simulace
- Hráč může dělat cokoliv, co dovoluje architektura a dokumentace (navrhnout fleet, nasadit, rozšiřovat, rozbíjet…).
- Žádné mise; peníze se zobrazují, ale jsou **neomezené** (ceny = fiktivní herní měna). Validace a chybové stavy
  přesně podle specu. Slouží i jako „laboratoř“ pro testování modelu.
- Úvodní obrazovka vysvětlí, že jde o simulaci reálné architektury VCF podle dokumentace, s modelovanou verzí.
- **Výběr na startu = oficiální Design Blueprints VCF 9.1** (`06-blueprints`); každý blueprint má herní lokalitu
  (uživatel 2026-11-21): 1. malá místnost (pár racků) · 2. větší místnost ·
  3. dvě místnosti v jedné budově · 4. dvě budovy (kampus) · 5. vzdálená lokalita pro DR. Rozvržení, vzdálenosti
  a latence mezi místnostmi/budovami jsou herní hodnoty (ilustrativní); **co z nich plyne pro VCF** (AZ, stretched
  cluster, požadavky na latenci/propustnost mezi AZ, witness, DR instance) jen podle specu (`00`, `05`, `10`).
  Volba lokality omezuje návrh (např. Site HA potřebuje 2 AZ, DR druhou lokalitu).
- **Začátek: panáček (avatar) v prázdné serverovně.** Postup kopíruje realitu a odemyká se postupně:
  1. **Fyzická stavba** – koupit servery (vendor + certifikovaná konfigurace z BCG: CPU, RAM, disky, NIC),
     koupit generické switche, zarackovat, zapojit kabely. Začíná se jednoduše (základní komponenty),
     detaily (disky, NIC, MTU…) jdou postupně editovat. Výchozí nastavení jako v realitě (např. menší MTU),
     hráč je ladí podle požadavků ze specu.
  2. **Hosty** – instalace ESX 9, síť, NTP, DNS… Jakmile jsou hosty zapojené do managementu, ve scéně se
     rozběhne management provoz (toky podle specu, „Síťový provoz“).
  3. **Volba cesty / use case** podle VCF Installeru a dokumentace (např. nový fleet přes VCF Installer, nebo
     nejdřív vSphere/vCenter a pak konvergence) – se správným pořadím kroků a prerekvizitami pro daný use case.
  4. **Návrhová rozhodnutí** (`05-design`) – nabízí jen volby, které jsou s aktuálním HW (počet hostů, disky,
     NIC…) možné, a ukazuje doporučení; vždy s odkazem na dokumentaci. Ukazuje i nároky (např. kolik RAM/vCPU
     sežerou management komponenty podle sizingu).
  5. **Postupný deploy** (VCF Installer, bring-up, pak workload domény…).
- Každá volba, prerekvizita a důsledek musí mít oporu ve specu.
- **Racky** (uživatel 2026-11-21): 3 velikosti; umístění musí být logické (uličky před a za rackem, nejde postavit
  rack před jiný, řady se stejnou orientací, ne na dveře a vybavení) – herní/fyzická pravidla, ne VCF.
- **BMC / OOB je v Sandboxu předem správně zapojené** (uživatel 2026-11-21): v každé místnosti je
  předinstalovaný OOB switch a BMC každého serveru se po montáži automaticky zapojí a nastaví (mimo VCF scope –
  herní). Ruční zapojení a chyby OOB patří až do Kariéry.
- **Checkpointy / úkoly i v Sandboxu**: hráč vždy ví, co dělat dál (tracker „Další krok“ s průběhem a splněním).
  Jsou volitelné – dají se odkliknout / skrýt; nic nezamykají, jen vedou.
- Ovládání v místnosti: rack (zoom → 2D kabeláž), tabule (auto High-Level Design + vlastní kresba), počítač
  (návrh VCF dlaždicemi, use case, installer) – viz `docs/design/GRAPHICS.md`.

### 2. Kariéra – hra
- Postup po **kampaních → misích → úkolech**; mise se odemykají postupně.
- Hráč je admin: řeší problémy, které reálně potkají admina VCF (chybějící DNS, plný IP pool, výpadek hosta,
  nekompatibilní verze, přetížená linka, expirovaná licence…) – vždy jen chybové stavy ze specu.
- **Body** za splněné úkoly (správné pořadí, prerekvizity, vyhnutí se pastem), srážky za chyby a nápovědy.
- **Ekonomika**: rozpočet, nákup serverů / disků / NIC / switchů, návrh HA (počty hostů, failure tolerance…).
  Požadavky na HA a kapacitu jsou ze specu; **ceny a rozpočty jsou herní mechanika** (fiktivní měna),
  v UI vždy označené jako herní, ne jako fakt z dokumentace.
- Kampaně (pořadí, rozcestník: VCF Upgrade Planner): 1. nové prostředí (bring-up) · 2. migrace – konvergence
  vSphere do VCF · 3. upgrade VCF 5.2/9.0 → 9.1 · 4. den 2 – nová workload doména / instance · dál provoz a incidenty.

### Architektura kódu pro režimy
`game/src/model` + `game/src/engine` (společné) → `game/src/modes/sandbox`, `game/src/modes/career`
(mise, skóre, ekonomika) → `render` / `ui`. Ekonomika ani skóre nesmí měnit pravidla VCF v modelu.

## Oblasti (pořadí práce)
Struktura kopíruje sekce TechDocs VCF 9.x:
1. `00-architektura` – Private Cloud → Fleet → Instance → Domain → Cluster, komponenty
   `05-design` – Design / Design Library: návrhová rozhodnutí a modely (podklad pro Sandbox)
2. `10-planning` – Planning and Preparation (DNS, IP, sítě, HW, prerekvizity)
3. `20-deployment` – VCF Installer, bring-up, convergence, upgrade
4. `30-fleet-management` – VCF Operations, fleet management, Identity Broker
5. `40-workload-domains` – Building Cloud Infrastructure
6. `50-vsan`, `51-nsx`, `52-vsphere`
7. `60-lifecycle` – Lifecycle Management
8. `70-licensing`
9. `80-automation` – VCF Automation, organizace, tenanti
10. `90-operations` – monitoring, kapacita, troubleshooting

První oblast se dělá **kompletně end-to-end** (doporučeno 00 + 20 bring-up) jako vzor pro ostatní.

## Technologie
- TypeScript + Vite, renderování **PixiJS** (2D WebGL) v izometrickém pohledu.
- Herní logika (`game/src/model`, `game/src/engine`) je oddělená od grafiky (`game/src/render`, `game/src/ui`)
  a jde testovat bez prohlížeče (Vitest).
- Design grafiky: `docs/design/GRAPHICS.md`.

## Jazyk
S uživatelem komunikuj česky. Kód, identifikátory a citace z dokumentace anglicky.
