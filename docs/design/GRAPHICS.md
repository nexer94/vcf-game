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
- **Interaktivní objekty v serverovně** (uživatel 2026-11-21, inspirace dodanými screenshoty – jen jako nápad,
  vlastní originální provedení):
  - **Rack** – při najetí myší lupa/zvýraznění; klik → plynulý zoom na rack a přepnutí do **2D čelního pohledu**
    (zvětšený rack, servery s porty, LED) – tady probíhá **zapojování kabelů** (port → port). Zpět Esc / tlačítko.
  - **Tabule (whiteboard)** na stěně – zapojení a návrh automaticky **generují High-Level Design** (diagram:
    WAN/uplink, switche, hosty, sítě/VLAN, IP rozsahy) ručně kresleným stylem; klik → přiblížení; hráč si může
    **dokreslovat vlastní poznámky** (volné kreslení, text, smazat).
  - **Počítač na stole** – klik → „připojení“ na obrazovku počítače: tam se vybírá **návrh VCF pomocí dlaždic**
    (design decisions jako karty/dlaždice), use case, později VCF Installer / VCF Operations. Panel rozhodnutí
    vpravo zůstává jako rychlý přehled.
- **Provoz mezi hosty**: v místnosti se fyzické dráty kreslí jen decentně (může jich být hodně); hlavní je
  **barevné tečky „létající“ mezi zařízeními** podle typu provozu (styl vizualizace vmnic/uplinků s pakety
  jako na webových simulátorech – vlastní provedení). Detailní pohled na host = karty vmnic/uplinků
  s vytížením a pakety. Jako první dokumentovaná síť naběhne **ESX management (vmk0)**; OOB/BMC je podle dokumentace mimo scope VCF
  (`25` §10) – ve hře volitelný krok označený „mimo VCF scope – herní“, bez VCF provozu a bez vlivu na validace.
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
- **Provoz v2 (ux-designer 2026-11-21, `UX.md` kap. 12)**:
  - Kabely v místnosti jako **svazky** přes stropní žlab (neutrální, obrys OUTLINE), detail jednotlivých kabelů
    až v čelním pohledu racku. Tečky letí mezi zařízeními po trase svazku.
  - **Tvar tečky podle typu** (kvůli barvosleposti): Management ◆, vMotion ▲, vSAN ■, NFS ●, NSX overlay ⬟,
    VM ○ (prázdný kruh). Jeden atlas tvarů, tint barvou, tmavý obrys.
  - **BMC (mimo VCF scope – herní)**: BMC nenese provoz VCF (`25` §10), proto nemá barvu typu provozu. Jen při
    vzdálené instalaci ESX jede po kabelu BMC **šedá čárkovaná animace se symbolem ✚** („přenos ISO, herní“).
    V legendě je ve zvláštní skupině „Mimo VCF (herní)“. BMC LED na serveru svítí i při vypnutém hostu.
    V UI nikdy holé „OOB“ (kolize s „out-of-band operations“ = config drift), viz `UX.md` 15.1.
  - Legenda je „vždy viditelná“ jako **čip vlevo dole** s aktivními typy; plná legenda po rozbalení.
  - Kosmetické barvy kabelů (volba hráče v racku) se nesmí plést s barvami provozu: černá, bílá, žlutá,
    růžová, hnědá (odstíny ui-dev).
- **Čelní pohled racku (2D elevace)**: stejný kreslený styl (výrazné obrysy, syté barvy), plochý pohled zepředu,
  zkomprimované prázdné U jako šrafovaný pás, porty jako zaoblené čtverečky s LED, kabely ortogonálně se
  zaoblenými rohy v bočních kanálech. Vendor jen barevný proužek + text.
- **Tabule**: téměř bílá plocha, hliníkový rám, polička s fixami jako nástrojová lišta. Auto diagram ručně
  kresleným stylem (deterministický jitter, dvojitý tah fixy, rukopisné OFL písmo s českou diakritikou)
  v **vyhrazené inkoustové barvě**, kterou hráč nemá v paletě; poznámky hráče barevnými fixami.
- **Počítač**: stůl s monitorem u levé stěny; plocha počítače je vlastní jednoduchý světlý „OS“ (dock vlevo,
  jedno maximalizované okno) – žádná napodobenina existujícího OS ani UI Broadcomu.

## Technika
- PixiJS (WebGL), sprity generované z vektorů, batching, cíl 60 FPS i na Chromebooku.
- Herní logika oddělená od kreslení (engine → snapshot → render).
