# Grafický design – VCF Game

## Styl
- **Útulná kreslená izometrie** (úhel ~30°, rozhodnutí uživatele 2026-11-21): žánr „tycoon / simulátor místnosti“
  – místnost s dvěma stěnami a dlaždicovou podlahou, jasné syté barvy, měkké stíny, lehce pixel-art / cartoon
  objekty s výraznými obrysy, hravé. Vlastní originální grafika – nekopírovat assety ani vzhled konkrétní hry.
- Hlavní scéna Sandboxu: **serverovna** (podlaha, stěny, dveře, okno/klimatizace), **panáček (avatar)**, který
  chodí k objektům; racky, servery, switche a kabely jako „nábytek“, který hráč kupuje a umisťuje.
- Čitelnost má přednost: důležité objekty (racky, kabely, provoz) výrazné, dekorace tlumené.
- **Rozložení obrazovky Sandboxu** (uživatel 2026-11-21): uprostřed izometrická serverovna;
  **dole inventář / obchod** – lišta s kategoriemi (servery, switche, racky, kabely, disky, NIC…), hráč si z ní
  vybírá a táhne/umisťuje do místnosti; **vpravo panel návrhových rozhodnutí** (design decisions podle
  dokumentace, odkazy, doporučení, co je s aktuálním HW možné) – vysouvací, aby nezakrýval scénu.
  Nahoře tenký HUD (peníze – v Sandboxu ∞, herní čas a rychlost, fáze / další krok).
- UI panely (obchod, konfigurace, wizardy) světlé a přátelské, ale přehledné; data a odkazy na dokumentaci vždy čitelné.
- Žádná loga ani přesné kopie UI Broadcomu ani vendorů – vlastní ikony a barvy (vendor jen jako text/barevný štítek).

## Úrovně zoomu
| Úroveň | Co je vidět |
|---|---|
| Private Cloud | ostrovy = fleety, mezi nimi linky |
| Fleet | fleet management komponenty (VCF Operations, VCF Automation, …) + instance jako „budovy“ |
| Instance | management doména + workload domény jako oddělené „čtvrti“ |
| Domain / Cluster | racky v řadách, NSX segmenty jako barevné zóny na podlaze |
| Rack / Host | jednotlivé servery, NIC, uplinky, VM jako malé kostičky |

Přechody mezi úrovněmi plynulým zoomem (jako přelet nad mapou).

## Vizualizace provozu
- Pakety = malé svítící tečky jedoucí po kabelech (bezier křivky), hustota = objem provozu.
- Barvy typů provozu:
  | Typ | Barva |
  |---|---|
  | Management | šedomodrá `#8aa4c8` |
  | vMotion | oranžová `#f0a14a` |
  | vSAN | zelená `#4cc38a` |
  | NFS / storage | tyrkysová `#3fb8c9` |
  | NSX overlay | fialová `#a37cf0` |
  | VM / north-south | bílá `#e8edf3` |
- Tloušťka linky = vytížení, nad 80 % žlutá, nad 95 % červená; zahozené pakety „odpadnou“ a zmizí.
- Vždy viditelná legenda, ovládání času (pauza / 1× / 4× / 16×), hover = detail linky
  (throughput, latence, fronta, dropy).
- Hodnoty, které nejsou přímo z dokumentace, UI označí jako „ilustrativní model“.
- **Světlá serverovna (kontrast, ux-designer 2026-11-21)**: barvy provozu výše jsou laděné pro tmavou scénu;
  na světlé podlaze místnosti mají kontrast jen ~1–2,5 : 1. Proto se kabely a pakety v místnosti kreslí
  s tmavým obrysem (`OUTLINE` z `render/room/palette.ts`), aby grafika měla ≥ 3 : 1 (WCAG 1.4.11). Fyzický
  kabel nese víc typů provozu (trunk) → kabel je neutrální, barvu typu provozu nesou pakety (volitelně
  proužek, když kabel nese jediný typ). Barva nikdy není jediný nosič informace (legenda, tooltip). Viz `UX.md` 2.5, 4.5.

## Technika
- PixiJS (WebGL), sprity generované z vektorů, batching, cíl 60 FPS i na Chromebooku.
- Herní logika oddělená od kreslení (engine → snapshot → render).
