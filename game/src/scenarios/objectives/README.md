# Úkoly trackeru Sandboxu (`sandbox.json`)

Formát a vyhodnocení: `game/src/modes/sandbox/objectives.ts` (UX.md kap. 8). Obsah (scenario-designer): skupiny
A Stavba serverovny · B BMC (game-optional, mimo VCF scope) · C Hosty (ESX) · D Síť pro VCF · E Use case a návrh ·
F Příprava nasazení · G Nasazení. Fakta jen z odkazů ve specu – čísla VCF (např. minimum hostů) do JSON nepatří,
dodává je model přes selektor. Id úkolů jsou stabilní (uložené hry je mají v `skipped` / `everDone`) – neměnit.

Selektory pro DNS A + PTR (C), trunk / MTU / uplinky (D), homogenitu (A) a výběr use case (E) už existují (tabulka níže).
Pořadí skupin: úkoly ve skupině D, které závisí na návrhu (model VDS) nebo na VLAN / MTU z průvodce (Network details),
počítají s tím, co je **zatím známé** (viz tabulka). Hotové mohou být dřív, a když pozdější návrh / průvodce přidá
požadavek, ukážou `regressed` („problém“).

## Formát
```jsonc
{
  "version": 1,
  "groups": [{ "id": "A", "title": "Serverovna" }],
  "objectives": [{
    "id": "cabling.each-host-to-switch",   // unikátní (i přes subSteps)
    "group": "B",
    "title": "Zapoj každý host do switche", // česky, imperativ, ≤ 48 znaků doporučeno (max. 64)
    "kind": "doc-required",                 // doc-required | doc-recommended | game-step | game-optional
    "why": { "specRef": "10-planning §3.3 [P19]", "url": "https://techdocs.broadcom.com/…", "ruleId": "…", "paraphrase": "…", "quote": "…" },
    "selector": "hostsCabledToSwitch",      // jméno z registru níže
    "params": { "min": "all" },
    "after": ["room.switch"],               // doporučené pořadí, ne zámek
    "subSteps": [ … ],                      // 1 úroveň, skupina se dědí
    "showMe": { "view": "rack" },           // pro UI, engine neinterpretuje
    "onActivateTip": "tip-id",
    "featureFlag": "oob-pending-spec"       // → stav blocked-spec
  }]
}
```
- `why` je povinné pro `doc-required`, `doc-recommended` a `game-optional`; `url` jen https na techdocs / knowledge /
  compatibilityguide / developer.broadcom.com.
- Neplatný soubor → tracker „Úkoly nejsou k dispozici“ (`objectives.available = false`, `loadErrors`).
- `game-optional` (BMC, mimo VCF scope) se nepočítá do `n/N` skupiny a nikdy není „Další krok“.

## Parametr `min` (počty)
kladné celé číslo · `"all"` = všechny koupené servery (min. 1) · `"design"` = minimum hostů management domain
default clusteru z modelu pro aktuální návrh (10-planning §6.1), bez návrhu 1.

## Selektory
| Selektor | Parametry | Splněno když |
|---|---|---|
| `hasRack` | `min` | racky postavené v místnosti (s dlaždicí) ≥ min |
| `serversBought` | `min` | koupené servery ≥ min |
| `certifiedServerBought` | `min` | servery, jejichž model BCG uvádí pro „ESXi 9.1 (vSAN 9.1)“ ≥ min |
| `serversForDesign` | – | koupené servery ≥ minimum z modelu pro návrh (bez návrhu 1) |
| `serversMounted` | `min` | servery v racku ≥ min |
| `switchesBought` / `switchesMounted` | `min` | switche koupené / v racku ≥ min |
| `companyNetworkConnected` | – | uplink switche připojen do sítě firmy (herní abstrakce) |
| `hostsCabledToSwitch` | `min` | servery s ≥ 1 NIC zapojenou do switche (link up) ≥ min |
| `hostsOnTwoSwitches` | `min` | servery s NIC linky do ≥ 2 různých switchů ≥ min |
| `bmcCabled` | `min` | BMC port zapojen, link up ≥ min (herní) |
| `bmcConfigured` | `min` | BMC zapojen, má IP a je dosažitelný z počítače admina ≥ min (herní) |
| `esxInstalled` | `min` | servery s ESX ≥ min |
| `mgmtNetworkConfigured` | `min` | DCUI management síť nastavená (statická IPv4) ≥ min |
| `mgmtNetworkUp` | `min` | nastaveno + vmk0 dosáhne gateway po kabeláži ≥ min |
| `mgmtNetworkTested` | `min` | poslední DCUI „Test Management Network“ dosáhl gateway ≥ min |
| `mgmtTrafficFlowing` | – | viditelný aspoň jeden tok třídy management |
| `ntpConfigured` | `min` | hosty s běžícím NTP ≥ min |
| `certificateRegenerated` | `min` | hosty s CN certifikátu = FQDN ≥ min |
| `hostDnsRecordsValid` | `min` | hosty, jejichž FQDN z DCUI má A záznam na IP vmk0 a odpovídající PTR (model `validateDnsRecords`, 10 §3.1, 20 §3.5) ≥ min |
| `switchPortsTrunkVlans` | `min` | hosty, jejichž všechny zapojené porty switche jsou trunk 802.1Q a propouští VLAN všech známých typů provozu (management z DCUI, jinak z průvodce; vMotion, vSAN / NFS – ne u VMFS on FC – a Host TEP z průvodce) ≥ min |
| `switchMtuForTraffic` | `min`, `recommended` (bool) | hosty, jejichž všechny zapojené porty mají MTU ≥ největší MTU provozu, který nesou; min. 1500, port s Host TEP VLAN min. 1700 (10 §3.3, model `MTU_LIMITS`); s `recommended: true` navíc ≥ 9000 (VCF-NET-RCMD-SWT-004) ≥ min |
| `hostsWithUplinks` | `min`, `nics` | hosty s ≥ `nics` NIC zapojenými do switche (link up) ≥ min; `nics` = kladné celé číslo nebo `"design"` = počet pNIC zvoleného modelu Distributed Switch z modelu (`nicRequirementForVdsModel`: Single 2, Storage and Workload Separation 6), bez volby / u modelu bez dokumentovaného počtu 1 (VCF-NET-REQD-TOR-001) |
| `serversHomogeneous` | – | aspoň jeden server a žádný nález homogenity počátečního management clusteru (jeden vendor, stejná konfigurace; model `validateClusterHardware`, 20 §3.2, 10 §3.4) |
| `useCaseChosen` | – | hráč vybral use case UC-1 … UC-10 (25 §2.1; příkaz `chooseUseCase`, snapshot `useCase`) |
| `designDecided` | `decision?` | s `decision`: rozhodnutí zvoleno; bez: brána návrhu prochází |
| `phaseReached` | `phase` | fáze `design` / `planning` / `deploy` dosažena |
| `installerDeployed` | – | VCF Installer appliance nasazen |
| `binariesDownloaded` | – | všechny binárky stažené (n/N) |
| `validationPassed` | – | Review validation bez chyb (ready-to-deploy / deploying / completed) |
| `deploymentCompleted` | – | bring-up dokončen, fleet existuje |

## Stavy (`ObjectiveView.state`)
`pending` · `in-progress` (počítadlo > 0) · `done` · `regressed` (jen `doc-required`, bylo hotovo a už není) ·
`skipped` (hráč přeskočil; sám se změní na `done`) · `blocked-spec` (`featureFlag`).
