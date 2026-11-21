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
- **Barvy a téma inspirované světem Broadcom/VCF** (uživatel 2026-11-21) – výrazná červená, tmavá navy,
  střídmé šedé, čisté „enterprise“ panely; jen inspirace, ne oficiální brand (detail v sekci „Téma a paleta (inspirace Broadcom/VCF)“, T0–T11).
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
  | Management | ocelově šedomodrá `#a9b6c9` (dříve `#8aa4c8`, změna kvůli barvosleposti – viz „Téma a paleta“ T5) |
  | vMotion | oranžová `#f0a14a` |
  | vSAN | zelená `#4cc38a` |
  | NFS / storage | tmavší tyrkysová `#1fa3b8` (dříve `#3fb8c9`) |
  | NSX overlay | fialová `#a37cf0` |
  | VM / north-south | bílá `#e8edf3` |
- ~~Tloušťka linky = vytížení~~ → **v3 (níže): šířka proudu = objem (Gb/s, mocninná škála)**; vytížení linky:
  nad 80 % jantarový lem + šrafa, nad 95 % červený lem + puls; zahozené pakety „odpadnou“ (tvar ✕) a zmizí.
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
  - **BMC (mimo VCF scope – herní)**: BMC nenese provoz VCF (`25` §10), proto nemá barvu typu provozu.
    **v3 (`UX.md` 19.6):** BMC se po zaracování zapojí sám a hned po kabelu jedou **šedé čtverečky ▫**
    (1 tečka / 3 s, mimo atlas tvarů VCF). Při vzdálené instalaci ESX navíc **šedá čárkovaná animace se
    symbolem ✚** („přenos ISO, herní“).
    V legendě je ve zvláštní skupině „Mimo VCF (herní)“. BMC LED na serveru svítí i při vypnutém hostu.
    V UI nikdy holé „OOB“ (kolize s „out-of-band operations“ = config drift), viz `UX.md` 15.1.
  - Legenda je „vždy viditelná“ jako **čip vlevo dole** s aktivními typy; plná legenda po rozbalení.
  - Kosmetické barvy kabelů (volba hráče v racku) se nesmí plést s barvami provozu: černá, bílá, žlutá,
    růžová, hnědá (odstíny ui-dev).
- **Provoz v3 (ux-designer 2026-11-22, `UX.md` kap. 28 – má přednost před v2 výše, kde se liší)**:
  - **Drát ≠ provoz.** Drát / svazek je klidný a neutrální (svazek max. 3 px, `×N` odznak). Provoz je
    samostatná **poloprůhledná stuha („proud“)** po trase: šířka `w = 1,5 + 8,5·(Gb/s / 100)^0,35` px, barva
    převládajícího typu (≥ 60 %) v alpha 0,45 s obrysem OUTLINE, jinak neutrální. Tečky jedou uvnitř.
  - **Každý tok vidět:** emise teček logaritmicky `0,4 + 2,6·t` / s (`t = log10(Gb/s·1000)/5`), min. 0,4 / s;
    velikost tečky `0,55 + 0,35·t`; rychlost konstantní, zpomaluje jen zácpa (fronta). Čísla `≈ 4,2 Gb/s`
    (znak `≈` = ilustrativní model) u top 3 linek v záběru, jinak hover.
  - **LED portů** blikají podle objemu (0,5–4 Hz), v místnosti 1 LED na server na čele racku (racky „žijí“).
  - **Síťový pohled (klávesa N)**: místnost ztlumená plochou `#0f1b2d` alpha 0,8 (efektivně ≈ `#3c4655`, všechny
    barvy provozu ≥ 3 : 1), toky jako barevné pruhy podle typu v pevném pořadí Management → vMotion → vSAN →
    NFS → overlay → VM, rack „rozevřený“ na sloupec hostů. Kritické vytížení v lens `#ff7a85` (3,8 : 1).
  - **Síť firmy (uplink) už není žlutá** – žlutá/jantarová patří jen varování vytížení. Uplink = neutrální kabel
    + ikona budovy na stěnovém panelu.
  - **BMC jednotně**: tenký čárkovaný šedý drát `#8592a3` + šedé čtverečky ▫ (1 / 3 s), nikdy proud ani Gb/s;
    přenos ISO jen hustší ▫ + štítek `✚ ISO n %`.
  - **Rack – cable management**: data kabely světle šedé `#b4bfcd` (6,9 : 1 na čele racku), BMC šedé čárkované,
    výběr modrý lem, chyba `#ff5a6a` čárkovaně + ikona; lanes podle polohy serveru (bez křížení), hřeben do
    portů ToR, pásky každých 6 U; volné porty ToR ztlumené (alpha 0,45).
  - Mikroanimace (link up záblesk, „ping“ kroužek prvního paketu, růst / zánik proudu) jen transform / alpha.
- **Čelní pohled racku (2D elevace)**: stejný kreslený styl (výrazné obrysy, syté barvy), plochý pohled zepředu,
  **v3: svislý rack, zařízení v měřítku U (1 U = 18 px / 22 px), ToR switch navy nahoře, pravítko U vlevo**
  (`UX.md` 19.3), zkomprimované prázdné úseky ≥ 6 U jako šrafovaný pás s lomem, porty jako zaoblené čtverečky s LED, kabely ortogonálně se
  zaoblenými rohy v bočních kanálech. Vendor jen barevný proužek + text.
- **Tabule**: téměř bílá plocha, hliníkový rám, polička s fixami jako nástrojová lišta. Auto diagram ručně
  kresleným stylem (deterministický jitter, dvojitý tah fixy, rukopisné OFL písmo s českou diakritikou)
  v **vyhrazené inkoustové barvě**, kterou hráč nemá v paletě; poznámky hráče barevnými fixami.
- **Počítač**: stůl s monitorem u levé stěny; plocha počítače je vlastní jednoduchý „OS“ (navy horní lišta, světlý
  dock vlevo, jedno maximalizované okno) – žádná napodobenina existujícího OS ani UI Broadcomu. „Konzolové“
  aplikace (installer, provoz, DCUI) smí použít tmavé téma `console` (T3), výukové aplikace (Návrh VCF, Library)
  zůstávají světlé.

## Téma a paleta (inspirace Broadcom/VCF)
*ux-designer 2026-11-21, na přání uživatele. Implementuje `ui-dev`, viz T11 checklist.*

### T0. Pravidla (právní a identita)
- Je to **inspirace barevným světem** (výrazná červená + tmavá navy + chladné šedé + čisté enterprise panely),
  **ne** oficiální brand. Všechny hex hodnoty níže jsou **vlastní herní hodnoty**. Nikde netvrdíme, že jde
  o barvy Broadcomu ani VMware.
- **Zakázáno**: loga, wordmarky, ochranné známky, ikony produktů (včetně ikon z design systémů vendorů),
  pixelové kopie obrazovek VCF / vCenter / VCF Operations / Installeru, písma typicky spojená s UI vendorů
  (např. Metropolis z design systému Clarity). Názvy produktů jen jako **obyčejný text** (bez stylizace do loga).
- Hra má **vlastní značku**: textový název hry + vlastní jednoduchá ikona (izometrická kostka / rack z čar).
  Neumisťovat ji tam, kde mají produkty vendorů logo, a nekombinovat ji s červenou „bublinou“ nebo kruhem.
- **Disclaimer zůstává** (`ui/screens/disclaimer.ts`) na hlavním menu, úvodu Sandboxu a výběru blueprintu.
  Nově i v patičce okna „O hře“ v počítači. Barva `--muted` (≥ 4.5 : 1), min. 12.5 px.
- Celkový dojem: „výuková hra se seriózní enterprise lištou“, ne „produkt“. Pomáhá k tomu útulná kreslená
  místnost uprostřed, hravý avatar a kulaté ilustrace. Červená zabírá **≤ 5 % plochy** obrazovky.

### T1. Primitivní paleta (CSS proměnné v `:root`)
| Token | Hex | Použití |
|---|---|---|
| `--red-50` | `#fdebed` | jemné pozadí brand akcentu |
| `--red-200` | `#f3b3bb` | linka u brand-soft prvků |
| `--red-500` | `#c41f33` | **brand akcent** (primární CTA, aktivní záložka, proužky) |
| `--red-600` | `#a3192a` | hover / active brand |
| `--red-300d` | `#ff6b78` | brand akcent na tmavém (text, indikátor) |
| `--navy-950` | `#0f1b2d` | pozadí tmavé konzole |
| `--navy-900` | `#14233a` | obrys (OUTLINE), nejtmavší ink |
| `--navy-850` | `#172840` | plocha tmavé konzole |
| `--navy-800` | `#16304d` | horní lišta (HUD), záhlaví |
| `--navy-700` | `#1f4f8f` | interaktivní navy (vybraný stav, aktivní krok) |
| `--navy-600` | `#2b4a78` | switch, tmavé ilustrace |
| `--navy-500` | `#4a6a96` | sekundární ilustrace |
| `--graphite-900` | `#1a2538` | bok racku |
| `--graphite-800` | `#24324a` | čelo racku |
| `--graphite-700` | `#3b4a5f` | vršek racku |
| `--gray-0` | `#ffffff` | panel |
| `--gray-25` | `#f6f8fa` | panel-2, hover |
| `--gray-50` | `#f1f3f6` | panel-3, „herní“ pozadí |
| `--gray-100` | `#eef1f5` | podlaha A |
| `--gray-150` | `#e9edf2` | pozadí aplikace |
| `--gray-200` | `#dde3ea` | jemná linka |
| `--gray-300` | `#c5cdd8` | linka ovládacích prvků |
| `--gray-400` | `#8592a3` | silná linka / čárkovaný rámeček (≥ 3 : 1 na bílé) |
| `--gray-500` | `#6b7785` | ikony, placeholder (4.56 : 1 jen na bílé) |
| `--gray-600` | `#5c6878` | tlumený text (muted) |
| `--gray-700` | `#3a4656` | běžný text |
| `--gray-900` | `#1b2733` | nadpisy, ink |

### T2. Sémantické tokeny – světlé téma (výchozí)
Názvy záměrně **zachovávají současné proměnné** (`--panel`, `--ink`, `--accent`…), aby přechod byl mechanický.
Nové tokeny jsou označené *nový*.

| Token | Hodnota | Poznámka |
|---|---|---|
| `--font` | viz T7 | |
| `--bg` | `#e9edf2` | pozadí obrazovek |
| `--bg-2` | `#f6f8fa` | |
| `--panel` | `#ffffff` | |
| `--panel-2` | `#f6f8fa` | hover, sekundární plocha |
| `--panel-3` | `#eef1f5` | |
| `--line` | `#dde3ea` | oddělovače |
| `--line-2` | `#c5cdd8` | rámečky inputů a karet |
| `--line-strong` *nový* | `#8592a3` | rámeček nutný k rozpoznání prvku (≥ 3 : 1) |
| `--ink` | `#1b2733` | |
| `--text` | `#3a4656` | |
| `--muted` | `#5c6878` | |
| `--faint` | `#5c6878` | sloučeno s muted (původní hodnota by na nových plochách neměla AA) |
| `--outline` | `#14233a` | obrys kreslených objektů a „tvrdých“ prvků (HUD, modal) |
| `--brand` *nový* | `#c41f33` | primární CTA, aktivní záložka, brand proužek |
| `--brand-hover` *nový* | `#a3192a` | |
| `--brand-soft` *nový* | `#fdebed` | |
| `--brand-line` *nový* | `#f3b3bb` | |
| `--accent` | `#1f4f8f` | vybraný / stisknutý / aktivní stav (ne CTA) |
| `--accent-2` | `#163b6c` | hover accent |
| `--accent-soft` | `#e3ecf8` | pozadí vybrané položky |
| `--select` *nový* (nahrazuje `--orange`) | `#1d63c8` | výběr v inventáři / obchodu, cílová dlaždice |
| `--select-soft` *nový* | `#e6efff` | |
| `--focus` *nový* | `#1d63c8` | focus ring (světlé téma) |
| `--link` | `#1a5bb5` | |
| `--link-2` | `#12468f` | hover |
| `--ok` | `#1d7a46` | |
| `--ok-strong` *nový* | `#155e37` | text na `--ok-soft` u malých písmen |
| `--ok-soft` | `#e6f4ec` | |
| `--ok-line` *nový* | `#8fcfab` | |
| `--warn` | `#8a5300` | text varování |
| `--warn-stripe` *nový* | `#b76e00` | levý pruh varování |
| `--warn-soft` | `#fff4dc` | |
| `--warn-line` *nový* | `#e9b45a` | |
| `--bad` | `#b42318` | chyba |
| `--bad-soft` | `#fdecea` | |
| `--bad-line` *nový* | `#f0a8a2` | |
| `--info` *nový* | `#1d5fbf` | tip, informace |
| `--info-soft` *nový* | `#e8f1fd` | |
| `--info-line` *nový* | `#9cc0ef` | |
| `--info-text` *nový* | `#1a4f9c` | text na info-soft |
| `--game` *nový* | `#4a5566` | „říká hra“ – pruh |
| `--game-soft` *nový* | `#f1f3f6` | |
| `--game-line` *nový* | `#8592a3` | vždy **čárkovaně** |
| `--game-text` *nový* | `#3f4c5c` | |
| `--shadow` | `0 1px 2px rgba(20,35,58,.12), 0 4px 12px rgba(20,35,58,.10)` | plochý enterprise stín, bez „3D“ spodní hrany |
| `--shadow-sm` *nový* | `0 1px 2px rgba(20,35,58,.12)` | |
| `--radius` | `8px` | karty, panely (dříve 12) |
| `--radius-sm` *nový* | `6px` | tlačítka, inputy, štítky obdélníkové |

**Brand červená ≠ chyba.** `--brand #c41f33` a `--bad #b42318` jsou barevně skoro stejné (1.12 : 1). Pravidlo:
- **Plná červená výplň** = jen primární akce (CTA) a dekorativní brand proužek.
- **Chyba** = vždy světlé pozadí `--bad-soft` + levý pruh `--bad` + ikona chyby + nadpis. Chyba nikdy nemá
  plnou červenou výplň. Destruktivní tlačítko je bílé s rámečkem a textem `--bad` a ikonou.
- V místnosti: **červená LED = porucha**. Dekorativní červená se proto nepoužívá na LED, jen na štítky a cedulky
  (viz T6).

### T3. Tmavé téma `console` (volitelné, jen aplikace v počítači)
Aktivace: `[data-theme="console"]` na kořeni okna aplikace (installer, provozní konzole, DCUI). Přepisuje stejné
sémantické tokeny, takže komponenty se nemění.

| Token | Hodnota | Kontrast (text na ploše) |
|---|---|---|
| `--bg` | `#0f1b2d` | – |
| `--panel` | `#172840` | – |
| `--panel-2` | `#1c3050` | – |
| `--panel-3` | `#223a5e` | – |
| `--line` | `#2d4466` | dekorativní |
| `--line-2` | `#3d5a80` | dekorativní |
| `--line-strong` | `#5a77a0` | 3.24 : 1 na panelu (hranice prvků) |
| `--ink` / `--text` | `#f2f5f9` / `#e6edf5` | 12.6 : 1 na panelu, 11.2 na panel-2 |
| `--muted` / `--faint` | `#a9b6c8` | 7.2 (panel), 6.4 (panel-2), 5.6 (panel-3) |
| `--outline` | `#5a77a0` | |
| `--brand` | `#c41f33` (výplň CTA, bílý text 5.85) | text/indikátor brand: `--brand-text #ff6b78` 5.39 |
| `--accent` / `--accent-soft` | `#6ea8ff` / `#1f3a63` | text na accent-soft 9.65 |
| `--focus` | `#6ea8ff` | 6.16 : 1 na panelu |
| `--link` | `#6ea8ff` | 6.16 |
| `--ok` / `--ok-soft` | `#4fd18b` / `#15372a` | 6.72 |
| `--warn` / `--warn-soft` | `#ffc861` / `#3a2f17` | 8.56 |
| `--bad` / `--bad-soft` | `#ff8a8a` / `#3a1d27` | 6.68 |
| `--info` / `--info-soft` | `#6ea8ff` / `#172f52` | 5.56 |
| `--game-soft` / `--game-text` / `--game-line` | `#1c3050` / `#c9d3ea` / `#8592a3` | 8.9 |

DCUI (`.dcui`) si nechá vlastní jantarovo-navy vzhled (je to „konzole serveru“, ne enterprise app), jen se
srovnají navy odstíny (T10). Nesmí napodobovat skutečné DCUI pixelově.

### T4. Čtyři druhy hlášení a štítky (`UX.md` 3.2)
Princip: **kdo to říká** = barevná rodina + ikona + nadpis. Dokumentace = sémantické barvy (červená / jantarová /
modrá). Hra = vždy **grafitová + čárkovaný rámeček**. Barva nikdy není jediný nosič informace.

| Typ | Pozadí | Rámeček | Levý pruh 4 px | Text zdroje | Ikona (vlastní, T9) |
|---|---|---|---|---|---|
| Chyba VCF | `--bad-soft` | 1px `--bad-line` | `--bad` | `--bad` 5.75 : 1 | `icon-error` (osmiúhelník s čárou) |
| Varování VCF | `--warn-soft` | 1px `--warn-line` | `--warn-stripe` | `--warn` 5.79 : 1 | `icon-warning` (trojúhelník !) |
| Omezení hry | `--game-soft` | 1.5px **čárkovaně** `--game-line` | `--game` | `--game-text` 7.87 : 1 | `icon-puzzle` |
| Tip hry | `--info-soft` | 1px `--info-line` | `--info` | `--info-text` 6.98 : 1 | `icon-bulb` |

Štítky (`.ui-badge`, výška 20 px, `--radius-sm`, 12 px / 600):
| Štítek | Rodina | Pozadí / text / rámeček | Kontrast |
|---|---|---|---|
| `ilustrativní model` (výchozí `.ui-badge`) | hra | `--game-soft` / `--game-text` / čárkovaně `--game-line` | 7.87 |
| `herní výchozí`, `herní cena`, `herní měna` | hra | dtto, plný rámeček | 7.87 |
| `herní zjednodušení`, `generický`, `mimo VCF scope – herní` | hra | dtto, čárkovaně | 7.87 |
| `parafráze` | dokumentace (převod) | `#ffffff` / `--navy-800` / `--line-strong`, prefix „≈“ | 13.4 |
| `dokumentováno`, `Day 2`, profil HW | dokumentace | `--info-soft` / `--info-text` / `--info-line` | 6.98 |
| `neověřeno`, `čeká` (pending) | varování | `--warn-soft` / `--warn` / `--warn-line` | 5.79 |
| `Nevratné` | chyba | `--bad-soft` / `--bad` / `--bad-line` | 5.75 |
| `certifikováno (BCG)` | úspěch | `--ok-soft` / `--ok-strong` / `--ok-line` | 6.89 |
| `★ doporučeno` | doporučení dokumentace | `#fff6d6` / `#5c4300` / `#d9a514` | 8.59 |

AZ štítky (místo): AZ1 `#e3ecf8`, AZ2 `#efe8f7`, Witness `#fff4dc`, 2. instance `#e6f4ec` (text `--ink`, vždy i textový
popisek). AZ2 už není růžová/červená – nesmí působit jako chyba.

### T5. Barvy provozu – kontrola proti novým pozadím
Změněny **2 barvy** (Management, NFS); tvary teček zůstávají (◆ ▲ ■ ● ⬟ ○). Důvod: simulace deuteranopie
(Machado 2009, ΔE76) ukázala, že Management `#8aa4c8` a NFS `#3fb8c9` jsou pro deuteranopa **prakticky
totožné (ΔE ≈ 1)**. Nové hodnoty: deutan ΔE 18, protan 11, tritan vSAN/NFS 11 (dříve 6).

Kontrast výplně (WCAG poměr) – sloupce jsou plochy, přes které tečka letí / kde se kreslí:
| Typ | Hex | bílý panel | podlaha `#eef1f5` | podlaha B `#e4e8ef` | čelo racku `#24324a` | konzole `#0f1b2d` | konzole panel `#172840` | proti OUTLINE `#14233a` | tabule `#fbfbf7` |
|---|---|---|---|---|---|---|---|---|---|
| Management | `#a9b6c9` | 2.05 | 1.81 | 1.67 | 6.27 | 8.41 | 7.23 | 7.68 | 1.98 |
| vMotion | `#f0a14a` | 2.12 | 1.87 | 1.73 | 6.07 | 8.15 | 7.00 | 7.44 | 2.04 |
| vSAN | `#4cc38a` | 2.22 | 1.96 | 1.80 | 5.82 | 7.80 | 6.70 | 7.12 | 2.14 |
| NFS / storage | `#1fa3b8` | 3.00 | 2.65 | 2.44 | 4.29 | 5.75 | 4.94 | 5.25 | 2.90 |
| NSX overlay | `#a37cf0` | 3.13 | 2.77 | 2.55 | 4.11 | 5.51 | 4.74 | 5.03 | 3.02 |
| VM / north-south | `#e8edf3` | 1.18 | 1.04 | 1.04 | 10.94 | 14.68 | 12.62 | 13.40 | 1.13 |

Závěr a pravidla:
- Na **tmavých** plochách (racky, konzole) mají všechny barvy ≥ 4.1 : 1 i bez obrysu.
- Na **světlých** plochách (panel, podlaha, tabule) samotná výplň nestačí (1.0–3.1). Platí dál povinný tmavý
  obrys `OUTLINE #14233a`: obrys proti podlaze 13.9 : 1, výplň proti obrysu ≥ 5.0 : 1 (WCAG 1.4.11 splněno přes obrys).
  Legenda a tooltip: tečka s 1.5px obrysem `--outline`.
- Žádná barva provozu není červená, takže nekoliduje s brand akcentem ani s chybou. Rezervy, které zůstávají:
  vMotion × vytížení „warn“ (deutan ΔE 12) a brand × vytížení „crit“ (ΔE 11). Řeší se jiným nosičem:
  vytížení = tloušťka linky + text pásma, vMotion = tvar ▲.
- Kosmetické barvy kabelů (`ui/sandbox/sessionPort.ts`) se nemění. **Nepřidávat červenou ani modrou**:
  červená = brand/chyba, modrá = výběr.
- Na tabuli (`boardRenderer.ts`) se mění `management` a `nfs` stejně. Barvy jsou jen ve
  `render/traffic/trafficTypes.ts` a v kopii v `boardRenderer.ts` – sjednotit import (T11).

### T6. Paleta místnosti (`render/room/palette.ts`)
Směr: **chladná světlá serverovna** (šedomodrá podlaha a stěny), **grafitovo-navy racky**, navy switche.
Útulnost drží teplé protiváhy: dřevěný stůl, rostlina, hrnek, lampa. **v3 (2026-11-22, `UX.md` kap. 23):** místnost
má působit jako skutečná serverovna – **bez** červeného pruhu na stěnách a **bez** jantarových žlabů podél stěn;
kabelové žlaby jen jako tenký šedý drátěný rošt nad řadami racků (`alpha 0.35`), lišty racků nenápadné.
Červená jen **střídmě**: mikina avatara, štítek s číslem racku, hasicí přístroj, plakát.

| Konstanta | Staré | Nové | Poznámka |
|---|---|---|---|
| `OUTLINE` | `0x2e2645` | `0x14233a` | navy ink (13.9 : 1 na podlaze) |
| `OUTLINE_SOFT` | `0x5a4f78` | `0x4a5b73` | |
| `ROOM_BG` | `0xf4ead8` | `0xe4e9f0` | i `stage.ts` (`room`, `site`) |
| `FLOOR.a / b` | `0xe9e5f2 / 0xdfdaee` | `0xeef1f5 / 0xe4e8ef` | zdvojená podlaha |
| `FLOOR.grout` | `0xc7c0dc` | `0xc9d1dc` | |
| `FLOOR.perforated` | `0xb3abcf` | `0xb4bfcd` | |
| `FLOOR.slabLeft / slabRight` | `0xb9b0d6 / 0x9e94c4` | `0xa9b5c5 / 0x8e9cb0` | |
| `WALL.right / rightDark` | `0x9fdccf / 0x86cbbd` | `0xd5dde8 / 0xc3cddb` | světlejší (osvětlená) stěna |
| `WALL.left / leftDark` | `0x82c6c9 / 0x6db3b7` | `0xb9c5d5 / 0xa7b4c6` | |
| `WALL.cap` | `0xf7f2e8` | `0xf7f9fb` | |
| `WALL.base` | `0x5d8f9a` | `0x2b4a78` | navy sokl |
| ~~`WALL.stripe`~~ | – | **zrušeno v3** | pruh na stěnách se nekreslí (`UX.md` 23) |
| `DECOR.door / doorDark` | `0xf2a65a / 0xd98a3d` | `0x3b5f8f / 0x2b4a78` | navy dveře |
| `DECOR.doorFrame` | `0xfff4e0` | `0xf7f9fb` | |
| `DECOR.handle` | `0xffd34d` | `0xffd34d` | beze změny (teplý detail) |
| `DECOR.tray / trayDark` | `0xffcf4a / 0xe0a92a` | **v3:** `0x8592a3 / 0x6c7c93`, `alpha 0.35` | drátěný rošt jen nad řadami racků, žádný žlab podél stěn (`UX.md` 23) |
| `DECOR.posterA / B / C` | `0xff7a8a / 0x5b9cf0 / 0x4cc38a` | `0xc41f33 / 0x2b4a78 / 0x4cc38a` | |
| `DECOR.extinguisher` | `0xe5484d` | `0xd42e3f` | |
| `DECOR.ac / acShade / acVent` | | `0xfbfcfd / 0xd5dde8 / 0x8592a3` | |
| `CABINET.top / front / side` | `0x6a6a9a / 0x4a4a78 / 0x383862` | `0x3b4a5f / 0x24324a / 0x1a2538` | grafit |
| `CABINET.inner` | `0x27274a` | `0x111a29` | |
| `CABINET.rail` | `0x8a8ab8` | `0x6c7c93` | v3: 1 px, `alpha 0.5` |
| `CABINET.label` *nový* | – | `0xc41f33` + bílé číslo | malá cedulka nahoře na čele racku s číslem racku (bílý text na červené 5.85 : 1) |
| `CABINET.netTop / netFront / netSide` | `0x7fa8e8 / 0x5b86d0 / 0x4870b8` | `0x4a6a96 / 0x34527c / 0x284268` | |
| `DEVICE.serverFace / serverShade / bay` | `0xeef0f7 / 0xcfd3e3 / 0xb7bcd2` | `0xeef1f5 / 0xcdd4de / 0xb3bdca` | |
| `DEVICE.switchFace / switchShade` | `0x3d6fd1 / 0x2f58aa` | `0x2b4a78 / 0x213a60` | navy switch, porty `0xe6edf6` (7.6 : 1) |
| `DEVICE.ledOk / ledAct` | `0x47d18c / 0xffc94d` | `0x3ccf7a / 0xffc24a` | 6.4 / 8.0 : 1 na čele racku |
| `DEVICE.ledFault` *nový* | – | `0xff5a6a` | jen porucha (4.25 : 1 na grafitu), vždy i ikona / bublina |
| `AVATAR.hoodie / hoodieDark` | `0xff8a3d / 0xe0702a` | `0xc41f33 / 0x9e1f2e` | hráč = brand akcent ve scéně (5.2 : 1 proti podlaze) |
| `AVATAR.pants` / `shoe` | `0x3d5aa8` / `0x2e2645` | `0x1f3550` / `0x14233a` | |
| `SHADOW` | `0x3a2f5a` | `0x1a2a40` | alfa beze změny |
| `TARGET_TILE` | `0xff8a3d` | `0x1d63c8` | výběr = modrá (5.05 : 1 na podlaze) |
| `BLOCKED_TILE` | `0xe5484d` | `0xe5484d` | + šrafování (barva není jediný nosič) |
| `CABLE.body` | `0xf7f5fc` | `0xf6f8fa` | |
| `VENDOR_TAG` | Dell `0x3d8bfd`, HPE `0x2bb673`, Lenovo `0xe5484d`, Cisco `0x1fb6c9`, Supermicro `0x9b59e0` | Dell `0x2560c4`, HPE `0x187a4e`, Lenovo `0xa3245a`, Cisco `0x0f6f80`, Supermicro `0x6b3fb5` | bílý text 5.3–7.1 : 1 (staré 2.4–3.3 nesplňovaly AA). Lenovo už není červená (kolize s brand/chybou). Herní barvy, ne barvy firem. |
| `TAG_COLORS` | | stejných 5 + `0xb76e00` | |

`render/room/fixtures.ts`: `monitor / monitorSide` → `0x24324a / 0x1a2538`; `chair / chairDark / chairTop` →
`0x3b5f8f / 0x2b4a78 / 0x6f8fb8`; plakát `0x5b4fd6` → `0xc41f33`; ostatní (dřevo, rostlina, hrnek, tabule) beze změny.
`render/rack/rackView.ts`: prázdné U `0x3a3a62` → `0x2e3d55`, šrafa `0x55557e` → `0x4a5b73`, text `0xe9e7ff` → `0xe6edf6`,
`0x3e3e68` → `0x33435c`, `0x5a4f78` → `0x4a5566`, zapojený port `0x3a3550` → `0x24324a`, `LED_OFF 0x9a96ad` → `0x8592a3`,
ztmavení `0x1b1730` → `0x0f1b2d`, zvýraznění `0xffc94d` (hover pin) → `0x1d63c8`.
`render/site/siteScene.ts`: tráva a voda beze změny; `BUILDING` → slab `0xf6f8fa`, slabFront `0xc5cdd8`, slabSide
`0xa9b6c8`, corridor `0xeef1f5`, corridorLine `0xdde3ea`; výběr místnosti `0xff8a3d` → `0x1d63c8`; vlajka
`0xe5484d` → `0xc41f33`; `AZ_FILL` podle T4; `0xefe9f8` → `0xeef1f5`. `FIBRE 0xffc94d` beze změny.
`render/whiteboard/boardRenderer.ts`: `AUTO_INK 0x1f3477` beze změny (vyhrazený inkoust, 11.2 : 1), problém
`0xc0322e` → `0xb42318`, `0x6a6585` → `0x5c6878`, zvýraznění `0xffc94d` → `0x1d63c8`.

### T7. Typografie (jen otevřené licence, čeština)
- **UI**: `--font: 'Inter', 'Noto Sans', system-ui, -apple-system, 'Segoe UI', Roboto, 'Liberation Sans', Arial, sans-serif;`
  - MVP: **bez stahování písma** (systémový stack, nulové načítání – Chromebook má Roboto / Noto).
  - Volitelně později: Inter (SIL OFL) nebo Noto Sans (SIL OFL) **self-hosted** jako `woff2` se subsety
    latin + latin-ext (české znaky), `font-display: swap`. Žádné CDN (offline, soukromí).
  - Konec zaobleného `ui-rounded / Nunito` v UI chrome. Kulatost zůstává jen ve scéně (kreslený styl).
- **Mono** (IP, FQDN, VLAN, příkazy, DCUI): `ui-monospace, 'JetBrains Mono', 'DejaVu Sans Mono', 'Cascadia Mono', monospace`
  (JetBrains Mono = OFL).
- **Ručně psané** (jen tabule): `'Patrick Hand'` (OFL) beze změny. Před bundlem ověřit, že použitý soubor má subset latin-ext.
- Velikosti: základ **14 px** (dříve 13), malý text **≥ 12.5 px**, štítky 12 px / 600, nadpisy panelů 16 px / 700,
  nadpis obrazovky 22 px / 700, řádkování 1.4. Čísla `font-variant-numeric: tabular-nums`.
- VERZÁLKY jen u malých nadpisů sekcí (11–12 px, `letter-spacing: .06em`, barva `--muted`).
- Názvy produktů VCF píšeme obyčejným písmem v textu (žádná stylizace, žádná vlastní „brand“ typografie).

### T8. Komponenty (čistý enterprise styl)
Dvě vrstvy: **scéna** = kreslená, tlusté navy obrysy (2–3 px), kulaté tvary. **Chrome** (HUD, panely,
okna) = plochý, 1 px linky, malé radiusy, jemné stíny. Neplést: v chrome už není „3D“ spodní hrana `0 3px 0 outline`.

- **Tlačítka** (výška 32 px, na dotyku `@media (pointer: coarse)` 44 px; padding 0 14 px; `--radius-sm`; 14 px / 600):
  | Varianta | Klid | Hover | Stisk / disabled |
  |---|---|---|---|
  | Primární (CTA, **max. 1 na pohled**) | `--brand`, bílý text 5.85 | `--brand-hover` 7.69 | stisk `--red-600` + `translateY(1px)`; disabled `opacity .45` |
  | Sekundární | `--panel`, text `--accent`, 1px `--line-strong` | `--panel-2` | stisk `--accent-soft` |
  | Tichá (ghost) | průhledné, text `--accent` | `--panel-2` | |
  | Destruktivní | `--panel`, text a rámeček `--bad`, ikona | `--bad-soft` | + potvrzení u nevratných |
  | Přepínač (aria-pressed, rychlost času) | sekundární | | zapnuto: `--accent` výplň, bílý text 8.16 |
- **Focus** (všechny interaktivní prvky): `outline: 2px solid var(--focus); outline-offset: 2px; box-shadow: 0 0 0 4px var(--panel)`
  (halo), na tmavém tématu `--focus #6ea8ff`. 5.72 : 1 na bílé. Focus ≠ výběr (výběr = výplň + rámeček).
- **Karty** (obchod, use case, dlaždice návrhu): `--panel`, 1px `--line-2`, `--radius`, `--shadow-sm`. Hover:
  rámeček `--line-strong`. Vybraná: 2px `--select` + `--select-soft`. Blokovaná HW: `--panel-3`, text `--text`
  (čitelný), řádek důvodu s ikonou. Doporučená: štítek `★ doporučeno`, žádná barevná výplň.
- **Záložky**: text `--text` 14 px / 600, aktivní = text `--ink` + **3px spodní linka `--brand`** (hlavní
  „střídmý“ brand akcent v UI). `role="tablist"`, šipky ←/→.
- **Panely** (pravý panel, inventář, popovery): `--panel`, 1px `--line-2`, záhlaví 40 px `--panel-2` se spodní linkou
  `--line`, nadpis 16 px. Modal: + `--shadow`, rámeček 1px `--outline`.
- **Horní HUD**: `--navy-800` plocha, bílý text 13.4 : 1, 2px brand proužek **jen pod názvem hry** vlevo. Čipy:
  `rgba(255,255,255,.10)` výplň, 1px `#3d5a80`, bílý text. Tlačítka v HUD = varianta „na tmavém“ (bílý text, rámeček `#5a77a0`).
- **Inventář (dole)**: světlý panel; vybraná položka `--select` (dříve oranžová).
- **Průběh / progress**: dráha `--panel-3` + 1px `--line-strong`, výplň `--accent` (pruhy `--accent` / `#2b5fa3`).
  Ne červená – červená by četla jako chyba.
- **Tabulky**: hlavička `--panel-2` 12 px / 600 `--muted`, řádky 32 px, vybraný řádek `--select-soft`.
- **Vstupy**: `--panel`, 1px `--line-strong` (3.16 : 1), `--radius-sm`, focus viz výše, chyba = rámeček `--bad` + text pod polem.
- **Počítač**: horní lišta `--navy-800` s 3px brand proužkem nahoře, dock `--panel` s pravou linkou `--line`,
  pozadí plochy `--bg` (bez barevného gradientu). Aktivní položka docku: `--accent-soft` + 3px levá linka `--brand`.

### T9. Ikonografie (vlastní, jednoduché, linkové)
- Mřížka 24 px, tah 1.75 px, kulaté konce a spoje, `stroke="currentColor"`, bez výplní (výjimka: tečky LED).
  Velikosti 16 / 20 / 24 px. Inline SVG sprite (`<symbol>`), žádný icon font.
- Sada (MVP): server, switch, rack, kabel, disk, NIC, host, cluster, doména, fleet, DNS, NTP, tabule, počítač,
  uživatel, nastavení, odkaz na dokumentaci (kniha + šipka ven), chyba (osmiúhelník), varování (trojúhelník),
  informace (kruh i), tip (žárovka), omezení hry (dílek puzzle), nevratné (zámek), ilustrativní (vlnovka ≈),
  herní měna (mince), undo, zavřít, zpět.
- **Nahradit emoji** v hlášeních (⛔ ⚠ 🧩 💡). Emoji se na Chromebooku / Windows / macOS kreslí různě a ruší
  enterprise vzhled. Tvary teček provozu (◆ ▲ ■ ● ⬟ ○) zůstávají – nejsou to emoji, kreslí je atlas.
- Zakázáno: ikony z design systémů vendorů, ikony produktů VCF/vSphere/NSX, napodobeniny log.
- Ikona vždy s textovým popiskem nebo `aria-label`. Dekorativní ikony `aria-hidden="true"`.

### T10. Mapování starý → nový (mechanicky)
**A. CSS proměnné** (`ui/styles.css :root`) – název zůstává, mění se hodnota, pokud není uvedeno jinak:
| Starý token = hodnota | Nový token = hodnota |
|---|---|
| `--font` = ui-rounded, Nunito… | `--font` = T7 |
| `--bg` `#f4ead8` | `--bg` `#e9edf2` |
| `--bg-2` `#fbf5ea` | `--bg-2` `#f6f8fa` |
| `--panel-2` `#f7f3fc` | `--panel-2` `#f6f8fa` |
| `--panel-3` `#efe9f8` | `--panel-3` `#eef1f5` |
| `--line` `#ddd4ec` | `--line` `#dde3ea` |
| `--line-2` `#c9bde0` | `--line-2` `#c5cdd8` |
| `--ink` `#2a2440` | `--ink` `#1b2733` |
| `--text` `#3b3555` | `--text` `#3a4656` |
| `--muted` `#6a6585` | `--muted` `#5c6878` |
| `--faint` `#6d6887` | `--faint` `#5c6878` |
| `--outline` `#2e2645` | `--outline` `#14233a` |
| `--accent` `#5b4fd6` | `--accent` `#1f4f8f`; **v `.btn-primary` použít `--brand`** |
| `--accent-2` `#4a3fc0` | `--accent-2` `#163b6c`; **focus ring → `--focus`** |
| `--accent-soft` `#ebe8ff` | `--accent-soft` `#e3ecf8` |
| `--link` `#2f5fcf` / `--link-2` `#1d47a8` | `#1a5bb5` / `#12468f` |
| `--ok` `#1d8a57` / `--ok-soft` `#e2f6ec` | `#1d7a46` / `#e6f4ec` |
| `--warn` `#9a5a0a` / `--warn-soft` `#fff1dc` | `#8a5300` / `#fff4dc` |
| `--bad` `#c0322e` / `--bad-soft` `#fde6e5` | `#b42318` / `#fdecea` |
| `--orange` `#ff8a3d` | **odstranit** → `--select` `#1d63c8` (+ `--select-soft` `#e6efff` místo `#ffe9d6`) |
| `--shadow` (3D hrana) | `--shadow` z T2 |
| `--radius` `12px` | `--radius` `8px` (+ `--radius-sm` `6px`) |

**B. Natvrdo zapsané barvy v CSS → token**
| Starý hex | Kde | Nový |
|---|---|---|
| `#ef9f9c` | border chyby, Nevratné | `var(--bad-line)` |
| `#eab26a`, `#e8b860` | border varování, chip „brzy“, neověřeno, pending | `var(--warn-line)` |
| `#d98a1d` | pruh varování | `var(--warn-stripe)` |
| `#fff1dc`, `#fff1d6` | pozadí varování / neověřeno | `var(--warn-soft)` |
| `#7a4f00` | text neověřeno | `var(--warn)` |
| `#a99bc9`, `#7c6fa3` | čárkovaný rámeček hry / mimo scope | `var(--game-line)` |
| `#7b6aa8` | pruh omezení hry | `var(--game)` |
| `#5a4a8a`, `#5a4f78`, `#4c4270` | text „hra“ | `var(--game-text)` |
| `#f3effa`, `#f1ecfa`, `#f6f2fd`, `#f1eef8` | pozadí „hra“ / dráha | `var(--game-soft)` |
| `#9dbbeb` | border tip / Day 2 / dokumentováno | `var(--info-line)` |
| `#e9f1ff`, `#e5efff`, `#e2f0ff`, `#eef3ff` | pozadí tip / Day 2 / profil | `var(--info-soft)` |
| `#1d4fa8`, `#1d3f8a` | text Day 2 / dokumentováno / profil | `var(--info-text)` |
| `#2f5fcf` (border profilu) | room.css | `var(--info-line)` |
| `#efe8ff` / `#5a3db8` / `#b9a6ee` | parafráze | `#fff` / `var(--navy-800)` / `var(--line-strong)` + prefix „≈“ |
| `#e9f7f1` / `#1d6b48` / `#8fd1b3` | herní výchozí / cena | **rodina hra**: `var(--game-soft)` / `var(--game-text)` / `var(--game-line)` |
| `#135c3a` | text certifikace | `var(--ok-strong)` |
| `#fff4c7` / `#6e5300` / `#e8c547` | výchozí `.ui-badge` (ilustrativní) | rodina hra (T4) |
| `#fff1c2` / `#6b4d00` / `#b88a00` | `★ doporučeno` | `#fff6d6` / `#5c4300` / `#d9a514` |
| `#6b4d00` (`.opt-rec`) | pc.css | `#5c4300` |
| `#fff6e8`, `#fff7e8` | hover položky menu / inventáře | `var(--panel-2)` |
| `#ffe9d6` | vybraná položka inventáře / obchodu | `var(--select-soft)` |
| `#ffd34d` (mince) | room.css | beze změny (herní měna, teplý detail) |
| `#ffc94d` (výběr dlaždice v PC) | pc.css | `var(--select)` |
| `rgba(255,201,77,.18)` | hover dev-btn | `var(--panel-2)` |
| `#fff9e6` / `#e8c25c` | `.op-company` | `var(--game-soft)` / `var(--game-line)` (jde o herní firmu) |
| `#fff3d6` | vybraný řádek tabulky | `var(--select-soft)` |
| `#5b4fd6` / `#7a6ff0` | pruhy progress | `var(--accent)` / `#2b5fa3` |
| `#7d6bff → #4cc38a` gradient | dlaždice menu | `var(--navy-800)` plná + 3px horní `--brand` proužek |
| `#f4ead8`, `#f1e5d0`, `#fbf5ea` | pozadí úvodu / site | `var(--bg)`, `var(--panel-3)`, `var(--bg-2)` |
| `rgba(244,234,216,…)` | závoje přes scénu | `rgba(233,237,242,…)` (stejné alfy) |
| `rgba(46,38,69,…)` | stíny | `rgba(20,35,58,…)` |
| `#eef3ff → #f7f1ff → #fff6ea` | pozadí PC | `var(--bg)` |
| `#2f2a4a` / `#d6d0ee` | lišta PC / muted v liště | `var(--navy-800)` / `#c9d3ea` |
| `#4cc38a` (tečka PC, NIC ikona) | | `#3ccf7a` (LED ok) |
| `#faf9fc`, `#faf8fd`, `#f4f2f7`, `#f3f1f6` | karty „po“ / blokované | `var(--panel-2)` / `var(--panel-3)` |
| `#dfe3ea` | lišta tabule | `var(--gray-200)` |
| `#dfe6f7` | vSwitch v detailu hosta | `var(--accent-soft)` |
| `#8aa4c8` | proužek vSwitch | nová Management `#a9b6c9` (import z trafficTypes) |
| `#4a4a78` / `#27274a` / `#eef0f7` / `#3d6fd1` / `#e8f0ff` / `#cfd3e3` / `#2f8f63` / `#a37cf0` | ikony inventáře | `#24324a` / `#111a29` / `#eef1f5` / `#2b4a78` / `#e6edf6` / `#cdd4de` / `#187a4e` / `var(--line-strong)` (kabel je neutrální) |
| `#3d8bfd` / `#2bb673` / `#e5484d` | proužky serverů v ikonách | nové `VENDOR_TAG` (T6) |
| `#10171f` | pozadí náhledu designu | `var(--navy-950)` |
| DCUI `#1f2a44` / `#11192e` / `#18233f` / `#34426a` / `#5d6b92` / `#9aa6c4` | panels.css | `#16304d` / `#0f1b2d` / `#172840` / `#2b4a78` / `#4a6a96` / `#a9b6c8` (jantar `#e8a33d`, `#ffd27a`, `#f3ead2` beze změny; 6.2–11.2 : 1) |

**C. Pixi barvy mimo palette.ts** – viz T6 (fixtures, rackView, siteScene, boardRenderer). `stage.ts` datacenter
`0x0f141b` → `0x0f1b2d`. `render/scene/*` (starý tmavý demo pohled) jen pokud je ještě používaný; jinak beze změny.
`render/traffic/loadStyle.ts` beze změny (normal `#5b6b80` 5.4 : 1, warn `#f2c94c` + text pásma, crit `#e5484d` 3.9 : 1).

### T11. Checklist implementace (`ui-dev`)
1. `game/src/ui/styles.css` – `:root` podle T2/T10-A (+ nové tokeny), `[data-theme="console"]` podle T3; `.ui-badge`
   výchozí = rodina hra; HUD chipy a tlačítka; `.legend .bar-neutral` stín `#4cc38a` → `var(--line-strong)`.
2. `game/src/ui/screens.css` – `.btn*` podle T8 (bez 3D hrany), `.btn-primary` → `--brand`, focus → `--focus`, menu dlaždice,
   hlášení `.msg-*` a štítky `.badge-*` podle T4, náhrady z T10-B.
3. `game/src/ui/screens/room.css` – HUD navy, `--orange` → `--select`, ikony inventáře, vendor štítky, `.badge-*`.
4. `game/src/ui/screens/site.css` – pozadí, AZ štítky (T4), pending.
5. `game/src/ui/sandbox/panels.css` – štítky, záložky `.op-tab` (spodní brand linka), progress, DCUI navy, detail hosta.
6. `game/src/ui/pc/pc.css` – lišta, dock, pozadí, dlaždice (výběr `--select`), `★ doporučeno`; `data-theme="console"`
   na oknech konzolových aplikací.
7. `game/src/ui/whiteboard/whiteboard.css` – lišta `--gray-200`, aktivní záložka podle T8.
8. `game/src/render/room/palette.ts` – T6 (+ nové `WALL.stripe`, `CABINET.label`, `DEVICE.ledFault`), `VENDOR_TAG`, `TAG_COLORS`.
9. `game/src/render/room/fixtures.ts`, `roomStatic.ts` (kreslení proužku na stěně, cedulky racku) a `avatarArt.ts` (mikina).
10. `game/src/render/rack/rackView.ts`, `game/src/render/site/siteScene.ts`, `game/src/render/stage.ts` – T6 / T10-C.
11. `game/src/render/traffic/trafficTypes.ts` – Management `#a9b6c9`, NFS `#1fa3b8`;
    `game/src/render/whiteboard/boardRenderer.ts` – importovat barvy z `trafficTypes` místo kopie + T6.
12. Ikony: nový `game/src/ui/icons.ts` (SVG sprite, T9); nahradit emoji v hlášeních (`ui/screens/*`, `ui/sandbox/*`).
13. `game/src/ui/screens/disclaimer.ts` – text beze změny; ověřit, že je na menu, úvodu, výběru blueprintu a v „O hře“.
14. Testy: `loadStyle.test.ts`, `roomCables.test.ts` a další testy, které porovnávají hex hodnoty, aktualizovat.
    `npm test` + `npm run build`.
15. Ověření: screenshot menu, místnosti, racku, tabule, PC (světlé i console). Kontrast textů přes devtools ≥ 4.5 : 1.
    Grayscale test: hlášení se dají rozlišit bez barvy (ikona + nadpis + čárkování).

## Technika
- PixiJS (WebGL), sprity generované z vektorů, batching, cíl 60 FPS i na Chromebooku.
- Herní logika oddělená od kreslení (engine → snapshot → render).
