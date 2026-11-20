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
  (nebo knowledge.broadcom.com).
- Když něco ve specu chybí → pošli `doc-researcher`. **Nikdy nedoplňuj fakta z paměti** – ani ty, ani subagenti.
- Když se spec a kód rozcházejí, platí spec (pokud fact-checker nezjistí, že je spec zastaralý).

## Na začátku každé session
1. Spusť `version-scout`. Porovná `docs/spec/VERSION.md` s nejnovější verzí na
   https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later.html
2. Pokud vyšla novější verze nebo patch → zapiš do `docs/PROGRESS.md` úkoly na aktualizaci dotčených spec souborů
   a herních modulů a nabídni je uživateli.

## Postup pro každou oblast (např. „workload domain“)
1. `doc-researcher` → `docs/spec/<NN>-<oblast>.md` (koncepty, prerekvizity, kroky, chybové stavy, limity, odkazy)
2. `domain-modeler` → `game/src/model/<oblast>.ts` (typy, stavy, přechody, validace prerekvizit)
3. `scenario-designer` → `game/src/scenarios/<oblast>/*.json` (mise podle reálných workflow)
4. `engine-dev` (logika) + `ui-dev` (izometrická grafika, UI ve stylu VCF Operations) → implementace
5. `fact-checker` → nezávislá kontrola hry proti specu a dokumentaci.
   **Bez jeho OK není oblast hotová.**

Nezávislé úkoly (např. research dvou různých oblastí) spouštěj paralelně.

## Oblasti (pořadí práce)
Struktura kopíruje sekce TechDocs VCF 9.x:
1. `00-architektura` – Private Cloud → Fleet → Instance → Domain → Cluster, komponenty
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
