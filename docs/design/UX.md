# UX návrh – VCF Game (Sandbox v2)

Stav: návrh 2026-11-21 (ux-designer); doplněna **Část II – interakce v serverovně** (kap. 7–15: tracker, rack, tabule,
počítač, provoz v2, backlog v3, BMC mimo VCF scope + ESX management). Implementují `ui-dev` (render/UI) a `engine-dev` (příkazy, validace, snapshot).
Navazuje na `CLAUDE.md` (herní režimy, tok Sandboxu) a `docs/design/GRAPHICS.md` (útulná kreslená izometrie,
rozložení obrazovky).

> **Pravidlo faktů.** Tento dokument popisuje chování UI. Všude, kde UI ukazuje fakt o VCF (čísla, pravidla,
> hlášky), je uvedený odkaz na spec (`docs/spec/NN-*.md §x`). Texty v UI se berou z modelu / specu, ne z tohoto
> dokumentu. Čísla zde slouží jen jako příklad, odkud se berou. Ceny, rozpočty, trvání a „herní výchozí hodnoty“
> jsou herní mechanika a UI je tak vždy označí.

---

## 0. Cíl a cílový hráč

- **Hráč**: zná trochu IT (ví, co je server, switch, IP adresa), ale **VCF nezná**. Chce si „postavit cloud“
  a pochopit, proč se věci dělají v daném pořadí.
- **Pocit**: útulná „tycoon“ hra o serverovně, ne formulář. Každý krok je fyzická akce (koupit, postavit,
  zapojit, zapnout). Teprve potom přichází průvodce instalací a návrh.
- **Věrnost**: hra nikdy nedovolí to, co dokumentace zakazuje, a nikdy nezakáže to, co dokumentace dovoluje.
  Pokud něco hra zatím neumí, řekne to otevřeně jako **omezení hry**, ne jako pravidlo VCF.

### Tok Sandboxu v2 (fáze)

| # | Fáze (UI název) | Co hráč dělá | Opora ve specu |
|---|---|---|---|
| 1 | **Serverovna** | koupí a postaví racky, servery, switche | HW požadavky `10-planning §3.4`, `§6.2` |
| 2 | **Kabeláž** | zapojí NIC do switchů (ruka nebo auto-pomocník) | `10-planning §3.3` (ToR, uplinky, NIC) |
| 3 | **ESX** | nainstaluje ESX 9 na hosty, nastaví síť, NTP, certifikát → začne management provoz | `20-deployment §4.1.1–4.1.4`, `§3.2` |
| 4 | **Co nasadit** | v „VCF Installeru“ vybere, co nasazuje (use case) | `20-deployment §4.2` kroky 3–4 |
| 5 | **Návrh** | návrhová rozhodnutí omezená aktuálním HW, s doporučeními a odkazy | `05-design §4`, `§4.10` |
| 6 | **Příprava** | DNS, IP, VLAN, MTU, binárky | `10-planning §3.1–3.3`, `20-deployment §3.5`, `§4.1.6` |
| 7 | **Deploy** | průvodce krok za krokem, validace, nasazení, sledování úloh | `20-deployment §4.2` kroky 5–20 |

**Poznámka k pořadí.** Dokumentace řadí plánování a návrh **před** nákup HW (`10-planning §4` kroky 2–6).
Sandbox v2 začíná místností, protože je to srozumitelnější vstup. Aby hra nelhala o reálném postupu:
- panel Návrh (vpravo) je k dispozici **od první minuty**. Hráč si může nejdřív „rozmyslet návrh“ a podle něj
  nakupovat. Panel pak ukazuje „co tvůj návrh potřebuje“ (např. min. počet hostů pro zvolený storage
  a deployment model, `10-planning §6.1`);
- první tip v místnosti to řekne nahlas (viz 1.2, krok T3): „Ve skutečnosti se nejdřív navrhuje a plánuje,
  pak nakupuje. Tady si můžeš vybrat obojí.“

---

## 1. Hráčova cesta a onboarding (prvních 5 minut)

### 1.1 Principy
1. **Jeden jasný další krok.** Vždy je vidět právě jeden aktivní úkol („Další krok“) a k němu zvýrazněný
   ovládací prvek (pulzující obrys položky v inventáři, šipka nad objektem v místnosti).
2. **Nejdřív dělat, potom číst.** Výklad je maximálně 2 věty v bublině. Detaily a citace jsou o klik dál
   (expander „Proč?“).
3. **Rozumné výchozí hodnoty.** Každá konfigurace má předvyplněné hodnoty. Hráč je může přijmout jedním
   klikem. U každé výchozí hodnoty je vidět, odkud pochází: *dokumentace* (odkaz), *herní výchozí* (štítek),
   nebo *ilustrativní* (štítek).
4. **Pasti nejsou podrazy.** Když výchozí hodnota později nebude stačit (typicky MTU 1500 vs. požadavek
   pro NSX TEP, `10-planning §3.3`), hra to předem neschovává. Ukáže drobnou ikonu „ještě se k tomu vrátíme“.
   Chyba pak přijde jako validace se srozumitelnou opravou, ne jako game over.
5. **Žádná slepá ulička.** Všechno jde vrátit (undo, prodat, odinstalovat), kromě akcí, které jsou nevratné
   i podle dokumentace. Ty mají štítek **Nevratné** a potvrzení (např. volba principal storage,
   `20-deployment §4.2` krok 7).

### 1.2 Scénář prvních 5 minut

| Čas | Co hráč vidí | Další krok (tracker) | Vedení |
|---|---|---|---|
| 0:00 | Hlavní menu → **Sandbox** | – | Sandbox je první a předvybraná položka |
| 0:10 | Krátké intro (1 obrazovka, 3 odrážky, viz 6. review) + tlačítko **„Vstoupit do serverovny“** | – | odkaz na modelovanou verzi a TechDocs |
| 0:20 | Prázdná serverovna, avatar stojí u dveří, inventář dole, panel Návrh sbalený (odznak „16“) | **T1 Postav rack** | avatar „mávne“, bublina: „Tohle je tvoje serverovna. Začni rackem.“ Kategorie *Racky* v inventáři pulzuje. |
| 0:40 | Ghost racku sleduje kurzor, zelené/červené dlaždice | T1 | nápověda u kurzoru: „Klik = postavit · R = otočit · Esc = zrušit“ |
| 1:00 | Rack stojí, avatar k němu dojde | **T2 Kup server certifikovaný pro VCF 9.1** | kategorie *Servery* pulzuje. Karta prvního serveru má štítek „certified for VCF 9.1“. Bublina: „Server musí být v Broadcom Compatibility Guide.“ + odkaz (`10-planning §3.4`) |
| 1:30 | Server se zasune do racku (ghost ukáže volné U) | **T3 Kolik serverů?** | mini-karta: „Kolik hostů potřebuješ, závisí na návrhu (storage a deployment model). Otevři Návrh, nebo kup zatím 1 a pokračuj.“ Dvě tlačítka: *Otevřít Návrh* / *Pokračovat*. Tady zazní věta o reálném pořadí (sekce 0). |
| 2:00 | – | **T4 Kup switch** | kategorie *Switche* pulzuje. Bublina: „Každý host musí být připojený aspoň k jednomu switchi; doporučené jsou dva.“ (`10-planning §3.3`, VCF-NET-REQD-TOR-001 / RCMD-TOR-001) |
| 2:30 | Switch v racku, porty serveru a switche „blikají“ | **T5 Zapoj server** | tlačítko **„Zapojit doporučeně“** (auto-pomocník) nebo ruční klik port → port |
| 3:00 | Kabely vedou, zatím bez provozu (šedé) | **T6 Nainstaluj ESX** | klik na server → panel hosta → *Instalovat ESX 9*. Proběhne zkrácená animace kroků z `20-deployment §4.1.1` (ISO → disk → heslo → reboot), čas lze zrychlit. |
| 3:40 | Formulář „Síť hosta (DCUI)“ – IP, VLAN, DNS, FQDN, předvyplněné | T6 | předvyplněné hodnoty mají štítek *herní výchozí* (IP plán) – fakta o tom, **co** se vyplňuje, jsou z `20-deployment §4.1.2` |
| 4:10 | **Host online**: LED zezelená, po kabelu začnou jezdit šedomodré tečky (Management) | – | úspěch (viz 3.3): toast „První host online – teče management provoz“ + legenda provozu se poprvé vysune |
| 4:30 | – | **T7 Rozhodni, co postavíš** | panel Návrh se sám pootevře na kroku „Co nasadit“ (use case) a ukáže, kolik hostů tvůj výběr potřebuje vs. kolik jich máš |
| 5:00 | Hráč ví: místnost → HW → kabely → ESX → návrh. Tutoriál končí. | tracker přejde do běžného režimu | tip: „Nápovědy můžeš vypnout v ⚙.“ |

### 1.3 Objective tracker („Další krok“)
> Aktualizováno: podrobný návrh trackeru (volitelné úkoly, přeskočení, skrytí, datový model) je v **kap. 8**.
> Umístění se mění: tracker vlevo nahoře pod HUDem, HUD čip „Další krok“ zůstává.

- Umístění: v **horním HUDu** uprostřed (jedna řádka) a po kliknutí se rozbalí **checklist fáze** (dropdown
  pod HUDem, max. 8 položek).
- Stav položky: `○ čeká`, `◐ rozpracováno` (např. 2/4 hosty s ESX), `✓ hotovo`, `⚠ problém` (validace).
- Klik na položku = **„Ukaž mi“**: kamera najede na objekt / pulzuje prvek v inventáři / otevře panel.
- V Sandboxu je tracker **vodítko, ne zámek**: hráč smí dělat věci v jiném pořadí. Zamyká jen to, co
  zamyká i dokumentace nebo model (např. Deploy bez prošlé validace, `20-deployment §4.2` krok 19).
- Kariéra použije stejný tracker, jen s úkoly mise a body.

### 1.4 Kontextové tipy
- **Bublina avatara** (max. 2 věty, česky; VCF termín anglicky + vysvětlení v závorce při prvním výskytu,
  např. „ESX (hypervisor, který běží přímo na serveru)“).
- Každý tip má: `Rozumím` · `Proč?` (rozbalí citaci + odkaz) · `Už neukazovat tento typ`.
- Tipy se spouští **událostí**, ne časem: první nákup, první chybějící kabel, první validace, první
  nevratná volba.
- Max. 1 tip najednou, fronta; během drag-and-drop se tipy nezobrazují.
- Glosář: každé podtržené VCF slovo (tečkovaně) má tooltip s 1větným vysvětlením a odkazem do specu
  (`00-architektura` pro pojmy Fleet / Instance / Domain / Cluster).

### 1.5 Progresivní odhalování složitosti

| Úroveň | Kdy se objeví | Co hráč vidí / mění |
|---|---|---|
| **L0 Rychle** (výchozí) | vždy | koupit hotovou konfiguraci, „Zapojit doporučeně“, „Instalovat ESX“ s výchozími hodnotami |
| **L1 Přizpůsobit** | tlačítko *Upravit* na kartě / hostu | počet a typ NIC, disky, RAM; hostname, IP |
| **L2 Pokročilé** | tlačítko *Pokročilé* nebo automaticky, když na hodnotě závisí validace | MTU po portech / VMkernel, VLAN ID, trunk, mapování uplinků na pNIC, boot zařízení |

Pravidla:
- Když volba v Návrhu zvýší nároky (např. NSX overlay → MTU TEP, `10-planning §3.3`), u dotčené položky se
  objeví tečka „vyžaduje pozornost“ a L2 se odemkne s vysvětlením, **proč** teď.
- L2 nikdy neschovává chybu: pokud je problém v L2 hodnotě, validace odkáže přímo na pole (deep link).
- Nastavení „Vždy ukazovat pokročilé“ v ⚙ pro zkušené hráče.

### 1.6 Odkazy na dokumentaci bez zahlcení
Tři úrovně, vždy stejný vzor:
1. **Inline** – krátký český text (parafráze, štítek `parafráze`) + malá ikona `ⓘ`.
2. **„Proč?“ expander** – anglická citace (`<q lang="en">`), ID pravidla (např. `VCF-NET-REQD-SWT-002`),
   typ (požadavek / doporučení), odkaz „Otevřít v TechDocs ↗“ (nová karta), odkaz „spec §“.
3. **Knihovna** (klávesa `?` nebo ikona knihy v HUDu) – všechny odkazy, které hráč viděl, seskupené
   podle fáze. Nic se neztratí.

Odkazy nikdy nejsou jako holé URL. Max. 1 odkaz viditelný bez rozbalení na kartu / rozhodnutí.

---

## 2. Rozložení obrazovky

### 2.1 Hlavní obrazovka Sandboxu (desktop ≥ 1280 px)

```
┌───────────────────────────────────────────────────────────────────────────────────────────────┐
│ ☰  Sandbox · VCF 9.1.1 │ Fáze: ①Serverovna ②Kabeláž ③ESX ④Co nasadit ⑤Návrh ⑥Příprava ⑦Deploy│  HUD 40 px
│ 💰 ∞ (herní měna)      │ ▶ Další krok: Zapoj server do switche  [▾]   │ ⏸ 1× 4× 16×  📖 ? ⚙ │
├────────────────────────────────────────────────────────────────────────────────┬──────────────┤
│                                                                                │ ◀ Návrh (16) │
│                    ╱╲  stěna             stěna  ╱╲                             │──────────────│
│                  ╱    ╲  [klima]   [plakát]   ╱    ╲                           │ (sbalený:    │
│                ╱  ┌──┐  ╲                   ╱        ╲                         │  svislá lišta│
│              ╱    │▓▓│ rack   ┌──┐          ╲   dveře  ╲                       │  48 px s     │
│            ╱      │▓▓│        │░░│ switch                ╲                     │  odznakem    │
│            ╲      └──┘ ~~~~~~~└──┘                        ╱                    │  počtu       │
│              ╲        ☺ avatar                          ╱                      │  nevyřešených│
│                ╲      ◇◇◇ ghost (zelené dlaždice)     ╱                        │  rozhodnutí) │
│                  ╲                                  ╱                          │              │
│                    ╲──────────────────────────────╱                            │              │
│  ┌ legenda provozu (sbalitelná) ┐                       [⟲ undo] [🗑 prodat]   │              │
├────────────────────────────────────────────────────────────────────────────────┴──────────────┤
│ [Racky] [Servery•] [Switche] [Kabely] [Disky] [NIC]  │ 🔍 filtr  ☐ jen certified  ⇅ cena    │  Inventář
│ ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐                         [Porovnat]│  ~180 px
│ │ Vendor A ▮ │ │ Vendor B ▮ │ │ ...        │ │            │                                   │  (sbalitelný
│ │ 2U · 2×CPU │ │ 1U · ...   │ │            │ │            │                                   │   na 48 px)
│ │ ✔ certified│ │ ✔ certified│ │            │ │            │                                   │
│ │ ¤ 12 400 h │ │ ¤ 9 800 h  │ │            │ │            │                                   │
│ └────────────┘ └────────────┘ └────────────┘ └────────────┘                                   │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
```
- Scéna zabírá vždy ≥ 60 % výšky. Inventář a panel Návrh scénu **nepřekrývají**, ale zmenšují (canvas se
  přepočítá). Výjimka: tablet / úzké okno (2.8).
- Kamera při otevření panelu posune střed scény, aby vybraný objekt zůstal vidět.

### 2.2 Horní HUD
| Prvek | Chování |
|---|---|
| Menu ☰ | Pauza + menu (Uložit, Nastavení, Ukončit Sandbox – s potvrzením, pokud není uloženo) |
| Fáze | 7 malých kroků (číslo + název; pod 1440 px jen čísla s tooltipem). Hotové ✓, aktuální zvýrazněná, budoucí šedé, ale **klikací** (Sandbox nezamyká; skok jen ukáže, co chybí). |
| Peníze | `∞` + malý štítek „herní měna“. Tooltip: „V Sandboxu neomezené. Ceny jsou herní, nejsou z dokumentace.“ Útrata se přesto sčítá („utraceno ¤ 84 200“), aby hráč viděl rozdíl mezi návrhy. |
| Další krok | 1 řádek, klik = checklist (1.3) |
| Čas | `⏸ / 1× / 4× / 16×`. Pod tlačítky herní hodiny. Trvání úloh má štítek `ilustrativní` (`game/src/modes/sandbox/durations.ts`). Během dlouhé úlohy (ESX install, bring-up) se u tlačítka 16× objeví jemný tip. |
| 📖 Knihovna | odkazy na dokumentaci (1.6) |
| ? | nápověda ovládání + klávesové zkratky |
| ⚙ | nápovědy zap/vyp, „Vždy pokročilé“, reduced motion, zvuk, velikost UI (100 / 125 / 150 %) |

Výška 40 px, světlý panel (GRAPHICS: světlé přátelské panely), text min. 13 px.

### 2.3 Inventář / obchod (dole)

**Kategorie** (záložky, pořadí = pořadí potřeby): Racky · Servery · Switche · Kabely · Disky · NIC · (později)
Ostatní. Záložka s čímkoliv, co tracker právě chce, má tečku `•`.

**Karta položky (serveru)**:
```
┌──────────────────────────────┐
│ ▮ Vendor B   „Model X200“    │  vendor = barevný štítek + text, bez loga
│ 2U · 2× CPU 24 jader         │  klíčové parametry (z BCG dat, viz níže)
│ RAM 512 GB · 4× NIC 25 GbE   │
│ Boot 2× 480 GB · 6× NVMe     │
│ ✔ certified for VCF 9.1  ⓘ  │  odznak + zdroj
│ ¤ 12 400  (herní cena)       │
│ [Koupit]  [Detail]  [☐ Porovnat]
└──────────────────────────────┘
```
- **Zdroj odznaku „certified for VCF 9.1“**: data z Broadcom Compatibility Guide (BCG), z kterých engine
  generuje katalog. Odznak se ukazuje jen tehdy, když to data uvádějí. Tooltip `ⓘ`: „Podle dokumentace se
  server a BIOS ověřují v Broadcom Compatibility Guide jako ‚certified for VCF 9.1‘; ověřují se i NIC a HBA.“
  + odkaz (`10-planning §3.4` [P33]) + datum exportu dat BCG. Pro vSAN ESA zvlášť odznak „vSAN ESA ReadyNode“,
  pokud ho data mají (`10-planning §3.4`: ReadyNode „strongly recommended“).
- **Necertifikované položky** (pokud je katalog obsahuje, např. disky pro PoC) mají šedý odznak „není
  certifikováno“. Nákup je povolený (Sandbox = laboratoř). Důsledek ukáže až validace (např. ESA disky,
  `10-planning §3.4`, `§5`).
- **Cena**: vždy `¤` + „herní cena“ (fiktivní měna, CLAUDE.md – ekonomika). Nikdy reálné ceny.
- **Filtry**: vendor, jen certifikované, výška (U), počet NIC, rychlost NIC, typ disků; řazení cena / jádra / RAM.
- **Porovnat** (max. 3): boční tabulka parametrů. Řádky, které se týkají VCF požadavků, mají vedle hodnoty
  indikátor splnění podle **aktuálně zvoleného návrhu** (např. „≥ 16 jader / uzel pro vSAN ESA“ ✔ / ✖,
  `10-planning §6.2`). Bez zvoleného návrhu indikátor chybí (neradíme naslepo).
- **Varování homogenity**: když hráč kupuje server jiného vendora / jiné konfigurace než už stojí
  v místnosti, karta ukáže `⚠ jiný vendor než tvé ostatní hosty` + Proč? (`20-deployment §3.2`:
  management domain = jeden vendor, homogenní první cluster). Nákup se neblokuje. Blokuje až validace
  bring-upu, pokud tak stanoví model.
- **Generické switche a racky**: karta bez odznaku certifikace, se štítkem „generický (herní zjednodušení)“.
  Parametry: počet portů, rychlost, podpora MTU (herní hodnota), výška.
- **Zásoba**: koupené a neumístěné kusy jsou v řádku „V batohu (n)“ na začátku inventáře, přetažitelné
  stejně jako z obchodu.
- **Prázdný stav kategorie** (filtry nic nenašly): „Žádná položka neodpovídá filtrům.“ + `Zrušit filtry`.
- **Načítání katalogu**: skeleton karty (3 šedé obdélníky), žádné spinnery přes celou obrazovku.

### 2.4 Umisťování (placement)
| Akce | Myš | Dotyk | Klávesnice |
|---|---|---|---|
| Vybrat položku | klik na kartu (nebo táhnout) | tap na kartu | `Tab` na kartu, `Enter` |
| Ghost náhled | sleduje kurzor po dlaždicích | sleduje prst; tap = přesun ghostu | šipky posouvají ghost po dlaždicích |
| Otočit | `R` / kolečko se `Shift` | tlačítko ⟳ u ghostu | `R` |
| Potvrdit | klik | tlačítko ✔ u ghostu (ne pouhý tap – prevence omylu) | `Enter` |
| Zrušit | pravé tlačítko / `Esc` | ✖ u ghostu | `Esc` |
| Opakovat (stejná položka) | `Shift`+klik ponechá ghost aktivní | – | `Shift+Enter` |
| Přesunout existující | táhnout objekt | dlouhý stisk → ghost | `M` na vybraném objektu |
| Undo / Redo | `Ctrl+Z` / `Ctrl+Shift+Z`, tlačítko ⟲ | tlačítko ⟲ | totéž |
| Odebrat / prodat | `Del`, tlačítko 🗑 | 🗑 v kontextovém menu | `Del` |

- **Barvy dlaždic**: platné = zelený obrys + jemná výplň; neplatné = červený obrys **a šrafování** (ne jen
  barva) + tooltip s důvodem („Tady stojí rack“, „Mimo místnost“, „Blokuje dveře“). Jde o pravidla místnosti
  (herní), ne o VCF.
- **Do racku**: ghost serveru nad rackem ukáže pozici v U. Neplatná pozice = červené U + důvod („Rack je
  plný“, „Na pozici 12U je switch“).
- **Undo** drží historii 50 akcí v rámci fáze Serverovna / Kabeláž. Po instalaci ESX je odebrání hosta
  akce s potvrzením („Host má nainstalovaný ESX; odebráním se ztratí konfigurace“). Po bring-upu je
  odebrání **zakázané** s vysvětlením, že jde o omezení hry (decommission zatím není modelovaný), pokud
  model neřekne jinak.
- **Prodej**: v Sandboxu vrací 100 % herní ceny (Sandbox nemá ekonomiku). V Kariéře se to řeší jinak.
- Avatar dojde k místu akce (krátká chůze, ≤ 1 s, lze vypnout v ⚙ „Okamžité akce“). Akce se provede hned,
  avatar je kosmetika – **nikdy nezdržuje hráče**.

### 2.5 Kabeláž
> Aktualizováno: hlavní místo kabeláže je **2D čelní pohled racku (kap. 9)**; patch panel níže zůstává jako
> přístupný seznam zapojení (9.7).

**Ruční**: klik na port A (port se zvětší, ostatní kompatibilní porty se rozsvítí, nekompatibilní ztmavnou)
→ kabel „visí“ za kurzorem → klik na port B. `Esc` zruší. Klik na existující kabel = vybrat (detail,
odpojit).

**Zoom na porty**: porty jsou malé, proto se při režimu kabeláže kamera přiblíží na rack (úroveň Rack / Host,
GRAPHICS – úrovně zoomu), nebo se otevře **2D „patch panel“ overlay** (seznam portů serveru vlevo, switche
vpravo, propojení čarami). Overlay je i klávesnicová / dotyková cesta. Ve scéně je to jen alternativa.

```
┌ Kabeláž – host esx-01 ─────────────────────────────────────────┐
│ esx-01                          switch-A        switch-B       │
│  vmnic0 25G ●───────────────────● p1                           │
│  vmnic1 25G ●──────────────────────────────────● p1            │
│  vmnic2 25G ○                                                  │
│  vmnic3 25G ○                                                  │
│ [Zapojit doporučeně]  [Odpojit vše]          ✔ 2 uplinky, 2 ToR │
└────────────────────────────────────────────────────────────────┘
```

**Auto-cable pomocník „Zapojit doporučeně“**: zapojí nezapojené NIC vybraných hostů tak, aby splnily
požadavky a doporučení ze specu a **řekne, co udělal**:
- každý host aspoň k jednomu switchi, při 2+ switchích rozložit uplinky střídavě na oba
  (`10-planning §3.3`, VCF-NET-REQD-TOR-001, VCF-NET-RCMD-TOR-001);
- každé spojení samostatný uplink (`10-planning §3.3`, VCF-NET-REQD-LAG-001);
- počet zapojených NIC podle zvoleného VDS modelu, pokud je zvolený (např. Single Distributed Switch = 2 pNIC,
  `10-planning §3.3`); jinak zapojí všechny;
- shrnutí po akci: „Zapojeno 8 kabelů. Každý host má 2 uplinky na 2 switche.“ + Proč? + Undo.

**Barva kabelu**: fyzický kabel nese víc typů provozu (trunk s VLAN, `10-planning §3.3`, VCF-NET-RCMD-SWT-001),
takže jednou barvou „podle typu provozu“ nejde poctivě obarvit. Návrh:
- **Nezapojený do provozu**: neutrální tmavý kabel (OUTLINE barva místnosti).
- **S provozem**: kabel zůstává neutrální, **tečky (pakety)** mají barvu typu provozu (GRAPHICS – tabulka
  barev). Kabel může mít tenký **barevný proužek**, pokud po mapování uplinků na VDS nese jen jeden typ
  provozu (např. oddělený storage VDS). U mixu se proužek nezobrazí.
- **Vytížení**: tloušťka a žlutá / červená nad 80 / 95 % (GRAPHICS). Hodnoty provozu jsou `ilustrativní model`.
- Barva nikdy není jediný nosič informace: hover / focus ukáže tooltip (porty, rychlost, VLAN, typy provozu)
  a legenda je vždy po ruce.

### 2.6 Panel konfigurace hosta (a switche)
Otevírá se klikem na server (pravý panel se přepne na záložku „Objekt“, nebo plovoucí karta u objektu na
širokých obrazovkách). Záložky:

```
┌ esx-01 · Vendor B Model X200 ───────────────────── [✖] ┐
│ Stav: ● ESX 9 běží · management online                  │
│ [Přehled] [Hardware] [Síť] [ESX]                        │
│─────────────────────────────────────────────────────────│
│ Síť                                    L0 ▸ L1 ▸ L2     │
│  Hostname (FQDN)  esx-01.lab.example  herní výchozí     │
│  IPv4 mgmt        10.0.10.11/24       herní výchozí     │
│  VLAN mgmt        10                  herní výchozí     │
│  vmk0 na          vSphere Standard Switch · vmnic0  ⓘ   │
│  MTU vmk0 (mgmt)  1500                dokumentace ⓘ     │
│  ▸ Pokročilé: MTU portů, VLAN pro vMotion / vSAN / TEP  │
│─────────────────────────────────────────────────────────│
│ ⚠ 1 věc k vyřešení pro tvůj návrh  [Ukázat]             │
└─────────────────────────────────────────────────────────┘
```
Co hráč edituje (a odkud jsou fakta):
| Oblast | Pole | Výchozí hodnota | Opora |
|---|---|---|---|
| Hardware | CPU, RAM, disky, NIC (výměna za položky z inventáře) | podle koupené konfigurace | `10-planning §3.4` (požadavky ESA, boot ≥ 128 GB doporučení…) |
| ESX | instalace, root heslo, NTP, regenerace certifikátu | předvyplněno, akce tlačítkem | `20-deployment §4.1.1–4.1.4` |
| Síť (DCUI) | statická IPv4, VLAN, DNS servery, FQDN, žádné custom DNS sufixy | herní IP plán | `20-deployment §3.2`, `§4.1.2` |
| Síť L2 | MTU portů switche, VMkernel MTU, VLAN per typ provozu, trunk | viz níže | `10-planning §3.3` |

**MTU – výchozí hodnoty a proč na nich záleží (příklad vzoru „realistický default“)**:
- VMkernel ESX management: 1500 je podle dokumentace výchozí („Recommended MTU Size“ tabulka,
  `10-planning §3.3` [P18]). UI: štítek *dokumentace*.
- Porty generického switche: hra začíná na 1500. **Herní výchozí hodnota** (generický switch nemá
  dokumentovaný default), štítek *herní výchozí*.
- Proč na tom záleží: porty pro NSX TEP vyžadují min. 1700 (VCF-NET-REQD-SWT-002) a doporučeno je 9000
  (VCF-NET-RCMD-SWT-004), přičemž MTU musí podporovat celá cesta (`10-planning §3.3`). Hráč s defaultem
  1500 projde fází ESX bez problému. Jakmile v Návrhu zvolí model s overlay, u switche a hostů se objeví
  „⚠ vyžaduje pozornost“ a validace v Deploy ukáže chybu s tlačítkem **Opravit** (deep link na L2 pole).
  Tohle je hlavní „učící past“ v Sandboxu.
- Helper „Nastavit MTU podle doporučení“ (L2): nastaví hodnoty z tabulky doporučení a vypíše, co změnil.

### 2.7 Pravý panel – Návrh (design decisions)
**Sbalený stav** (48 px svislá lišta): ikona, text „Návrh“ svisle, odznak s počtem **nevyřešených**
rozhodnutí (např. `16`). Barva odznaku: neutrální (nerozhodnuto není chyba), červená jen při **chybě** (zvolená
volba přestala platit, např. hráč prodal host). Klávesa `D`.

**Rozbalený stav** (360–420 px):
```
┌ Návrh ─────────────────────────────── [⇥ sbalit] ┐
│ Hotovo 3 / 16 ▓▓░░░░░░░░░░                        │
│ Tvůj HW: 3 hosty · Vendor B · 4× 25G · vSAN ESA ✔ │  ← souhrn z místnosti
│───────────────────────────────────────────────────│
│ ✓ 1 Fleet deployment model: Basic          [změnit]│
│ ✓ 2 Kde poběží workloady: …                [změnit]│
│ ● 3 Deployment model                               │
│    ○ Simple                                        │
│       Vyžaduje ≥ 3 hosty (vSAN) – máš 3 ✔          │
│    ○ High Availability  ★ doporučeno pro produkci  │
│       ✖ Vyžaduje 4 hosty pro vSAN – máš 3          │
│         [Přidat host v obchodě]   ▸ Proč?          │
│    ▸ Proč? (citace + TechDocs ↗ · spec 05 §4.3)   │
│ ○ 4 vSphere cluster model           (zamčeno: 3)   │
│ …                                                  │
│───────────────────────────────────────────────────│
│ [Shrnutí návrhu]                    [Potvrdit ▸]   │
└───────────────────────────────────────────────────┘
```
Chování:
- **Jedno rozhodnutí rozbalené najednou** (akordeon). Hotová rozhodnutí jsou 1 řádek s volbou a „změnit“.
  Tím odpadá dnešní dlouhý svitek (viz review).
- **Možnost omezená HW** = šedá, ale **čitelná** (kontrast textu ≥ 4.5:1) s řádkem `✖ důvod` z modelu
  a **akcí, která ji odemkne** (např. „Přidat host“, „Přidat NIC“). Důvod pochází z modelu, čísla ze specu
  (např. minima hostů `10-planning §6.1`).
- **Odlišit typ blokace** (viz 3.2): ✖ *dokumentace neumožňuje s tvým HW* vs. 🧩 *hra zatím nepodporuje*.
- **Hvězdička ★ = doporučení z dokumentace**, ne herní hodnocení. Zobrazí se jen tam, kde spec uvádí
  doporučení (RCMD pravidlo, nebo text typu „recommended for production“, např. HA v `20-deployment §4.2`
  krok 5). Žádné 1–5 hvězdiček, žádné herní „skóre návrhu“ v Sandboxu. Bez opory ve specu hvězdička není.
- **Odchylka od doporučení** (RCMD) = žlutý pruh „Odchylka od doporučení“, volbu jde zvolit, ale před
  pokračováním se potvrzuje (dnešní mechanika „acknowledge“; odpovídá chování průvodce: warnings se
  potvrzují, errors se opravují, `20-deployment §4.2` krok 19).
- **„Proč?“ expander**: 1 věta česky → anglická citace → ID pravidla + typ → „TechDocs ↗“ + „spec §“.
  Výchozí stav sbalený.
- **Nevratné volby** (např. principal storage, `20-deployment §4.2` krok 7) mají štítek **Nevratné**
  a potvrzovací dialog s textem ze specu.
- **Šablony (Design Blueprints)**: nad seznamem tlačítko „Začít podle blueprintu“. Nabídne blueprinty ze
  `05-design §2.7` (např. minimal footprint), předvyplní volby a označí je „z blueprintu“. Hráč je může
  měnit. Ideální onboarding pro nováčka: jedna volba místo šestnácti.
- **Živé propojení s místností**: najetí na volbu zvýrazní v místnosti dotčené objekty (např. hosty, které
  nesplňují požadavek, červeně pulzují; chybějící host = ghost obrys v racku „tady by měl být 4. host“).
- **Use case (krok „Co nasadit“)**: první sekce panelu, zrcadlí průvodce VCF Installeru
  (`20-deployment §4.2` kroky 3–4: „Deploy a new VCF fleet“ / „Deploy a new VCF Instance“, existující
  komponenty). Možnosti, které Sandbox zatím nemodeluje (např. konvergence), jsou vidět s 🧩 „zatím ve hře
  není“. Hráč tak ví, že existují.

### 2.8 Malé obrazovky (Chromebook 1366×768, tablet)
- ≤ 1366 px: inventář výchozí výška 150 px, panel Návrh max. 340 px; HUD fáze jen čísla.
- ≤ 1024 px nebo dotyk na výšku: panel Návrh a konfigurace hosta jako **spodní list (bottom sheet)** přes
  inventář. Scéna se neposouvá pod panelem, panely se střídají (otevřený je vždy jen jeden).
- < 720 px šířky: hlášení „Sandbox je navržený pro širší obrazovku – otoč zařízení“. Nemusí se podporovat
  telefon na výšku (zatím).

---

## 3. Zpětná vazba a stavy

### 3.1 Prázdné stavy
| Kde | Prázdný stav |
|---|---|
| Místnost bez racku | podlaha s jemně pulzujícím obrysem 1 dlaždice „Sem postav první rack“ + bublina avatara |
| Rack bez serverů | rack má průsvitné „sloty“, při hover „Přetáhni sem server z inventáře“ |
| Host bez ESX | šedá LED, štítek nad serverem „bez OS“, klik = nabídka „Instalovat ESX 9“ |
| Panel Návrh bez HW | rozhodnutí jsou dostupná. Místo „máš 0 hostů ✖“ se ukazuje „Potřebuješ ≥ N hostů“ (neutrálně), dokud hráč nic nekoupil |
| Legenda provozu bez provozu | „Zatím žádný provoz – zapni první host s ESX.“ |
| Validace bez problémů | „✓ Vše v pořádku“ (zeleně, krátce) – ne prázdný box |

### 3.2 Čtyři druhy hlášení (+ štítky) – jednotný vizuální jazyk
> **Barvy a ikony (2026-11-21):** platí nové téma v `GRAPHICS.md` „Téma a paleta“ T4. Hra = vždy grafitová
> rodina s čárkovaným rámečkem, dokumentace = sémantické barvy. Emoji ikony níže nahradí vlastní SVG ikony (T9).
> Brand červená (`--brand`) není barva chyby: chyba nikdy nemá plnou červenou výplň.

To je nejdůležitější pravidlo věrnosti v UI. Hráč musí na první pohled poznat, **kdo** mu co říká.

| Typ | Kdo to říká | Vzhled | Text | Blokuje? |
|---|---|---|---|---|
| **Chyba VCF** (requirement / validace) | dokumentace | červený levý pruh, ikona ⛔, nadpis „Podle dokumentace nelze“ | popis + ID pravidla nebo citace hlášky (pokud ji spec má doslova, např. „vSAN ESA Disks Eligibility Validation Failed“, `10-planning §5`) + **Opravit** (deep link) + Proč? | ano – podle modelu |
| **Varování VCF** (warning, odchylka od RCMD) | dokumentace | žlutý pruh, ikona ⚠, „Odchylka od doporučení“ / „Varování validace“ | popis + pravidlo + **Potvrdit (Acknowledge)** nebo **Opravit** | do potvrzení (jako průvodce, `20-deployment §4.2` krok 19) |
| **Omezení hry** | hra | fialově-šedý čárkovaný rámeček, ikona 🧩, „Zatím ve hře není“ | „Dokumentace tohle umožňuje, simulace to zatím nemodeluje.“ + odkaz na dokumentaci pro zvědavé | ano, ale jasně jako hra |
| **Tip / doporučení hry** | hra | modrá bublina, ikona 💡 | herní rada (pořadí kroků, ovládání). **Nikdy** neobsahuje VCF fakt bez odkazu | ne |

Štítky hodnot (už existují, sjednotit vzhled):
- `ilustrativní model` – hodnota není z dokumentace (provoz, trvání),
- `herní výchozí` – hra zvolila výchozí hodnotu, kterou dokumentace neurčuje (IP plán, MTU generického switche),
- `herní cena` / `herní měna` – ekonomika,
- `parafráze` – český převod textu dokumentace,
- `neověřeno` – otevřená otázka ve specu,
- `Nevratné` – nevratné i podle dokumentace,
- `Day 2` – podle dokumentace až po nasazení,
- `mimo VCF scope – herní` – krok z reálné serverovny, který dokumentace VCF vyřazuje ze svého rozsahu (BMC, kap. 15).

Pravidla:
- Hlášky od modelu se ukazují **u objektu** (bublina nad serverem / switchem) a zároveň v **seznamu
  problémů** (Validace – v pravém panelu, záložka „Problémy (n)“). Klik v seznamu = kamera na objekt.
- Text je vždy: **co je špatně → proč (pravidlo) → jak opravit**. Nikdy jen kód chyby.
- Chyba se nezobrazuje dřív, než ji hráč mohl ovlivnit (nerozhodnuto ≠ chyba; viz review).

### 3.3 Úspěchy (malé oslavy, levné na výkon)
| Moment | Odezva |
|---|---|
| První rack / server / switch | „klap“ zvuk, objekt krátce poskočí (scale 1 → 1.06 → 1, 150 ms) |
| Kabel zapojen | port LED zezelená, krátké „cvak“ |
| **První host online** | LED zelená, po kabelu vyjede první vlna šedomodrých teček (Management), legenda se vysune, toast „První host online“ + 1 věta, co teče (z `20-deployment §7`, např. admin → ESX HTTPS, DNS). Avatar udělá „palec nahoru“. Hlavní okamžik onboardingu. |
| Všechny hosty online | tracker ✓ fáze, jemný konfetový efekt jen v HUDu (ne ve scéně) |
| Návrh potvrzen | „razítko“ na souhrnu návrhu |
| Validace bez chyb | zelený pruh „Validace prošla“ |
| Bring-up dokončen | delší sekvence: místnost se rozsvítí, provoz dalších typů (barvy GRAPHICS), shrnutí nasazených komponent (z modelu) |

### 3.4 Zvuk a animace (levné)
- Zvuk: 6–8 krátkých samplů (klik, klap, cvak, úspěch, varování, chyba), vlastní / CC0, výchozí hlasitost
  nízká, **vypnuto, dokud hráč neklikne** (autoplay politika), přepínač v ⚙. Ambient serverovny (tichý hum)
  volitelně, výchozí vyp.
- Animace: jen transform / alpha, žádné blur / shadow filtry v PixiJS za běhu. Částice max. ~200
  (sdílené s packetSim). Tooltips a panely CSS transition ≤ 200 ms.
- `prefers-reduced-motion` + přepínač ⚙: bez poskakování, kamera bez plynulých přeletů (skok), pakety jako
  statické pruhy hustoty místo pohybu, avatar se teleportuje.

### 3.5 Načítání a dlouhé úlohy
- Úlohy (ESX install, stahování binárek, validace, bring-up) mají **progress u objektu** (kroužek nad serverem)
  a v panelu **Úlohy** (jako Tasks panel průvodce, `20-deployment §4.2` krok 20). Trvání je `ilustrativní`.
- Selhání úlohy: červený kroužek, hláška typu Chyba VCF (3.2) s **Retry** po opravě (`20-deployment §4.2`
  krok 20).

---

## 4. Ovládání

### 4.1 Myš
- Levé tlačítko: vybrat / umístit / port. Pravé: zrušit režim (ne kontextové menu prohlížeče).
- Táhnutí prázdné plochy = posun kamery. Kolečko = zoom (ke kurzoru).
- Hover: obrys objektu + tooltip po 400 ms.

### 4.2 Dotyk (Chromebook, tablet)
- Tap = vybrat, tah jedním prstem po prázdné ploše = posun, pinch = zoom.
- Umístění vždy s potvrzením ✔ (žádné „tap = postav“).
- Dlouhý stisk (500 ms) = kontextové menu objektu (Přesunout, Konfigurovat, Prodat).
- Cíle dotyku min. 44×44 px (porty se proto zapojují přes patch panel overlay, 2.5).

### 4.3 Klávesnice
| Klávesa | Akce |
|---|---|
| `Tab` / `Shift+Tab` | HUD → inventář → scéna (objekty v pořadí rack → U pozice) → pravý panel |
| šipky | ve scéně: přechod mezi objekty / posun ghostu; v inventáři: mezi kartami |
| `Enter` / `Space` | vybrat / potvrdit |
| `Esc` | zrušit režim → zavřít panel → menu (postupně) |
| `R` | otočit ghost |
| `Del` | prodat / odebrat vybrané |
| `Ctrl+Z` / `Ctrl+Shift+Z` | undo / redo |
| `C` | režim kabeláže (patch panel pro vybraný host) |
| `D` | panel Návrh |
| `I` | inventář sbalit / rozbalit |
| `1`–`7` | kategorie inventáře (když má fokus inventář) |
| `P` / mezerník | pauza (mezerník jen když fokus není na tlačítku) |
| `,` `.` | zpomalit / zrychlit čas (1× / 4× / 16×) |
| `+` `-` `0` | zoom / reset kamery |
| `?` | přehled zkratek |
| `L` | legenda provozu |

Pozor: dnešní demo používá `1/2/3` pro rychlost času. V Sandboxu by kolidovalo s kategoriemi. Navrženo
`,` / `.`, v ukázce provozu může `1/2/3` zůstat.

### 4.4 Kamera
- **Pan + zoom ano, rotace ne** (v MVP). Pevný izometrický úhel drží čitelnost a levné sprity. Místnost má
  2 stěny, objekty u zadních stěn by se při rotaci schovávaly. Náhrada za rotaci: stěny se při překrytí
  objektu **zprůhlední** (cutaway) a tlačítko „Ukaž za stěnou“ není potřeba.
- Zoom ve stupních odpovídajících úrovním z GRAPHICS (místnost → rack → host). Dvojklik na rack = zoom na rack.
- Hranice posunu = místnost + okraj. Tlačítko „⌂ Celá místnost“ v rohu scény.

### 4.5 Přístupnost
- **Kontrast**: text ≥ 4.5:1 (AA), velký text a ikony/hrany ≥ 3:1. Na světlé podlaze místnosti mají barvy
  provozu z GRAPHICS příliš nízký kontrast (změřeno vůči `FLOOR.a #e9e5f2`: Management `#8aa4c8` 2.1:1,
  vSAN `#4cc38a` 1.8:1, VM `#e8edf3` 1.05:1). Proto se kabely a pakety v místnosti kreslí s tmavým obrysem
  (OUTLINE `#2e2645`, 11.5:1). Doplněno v GRAPHICS.md.
- **Ne jen barva**: neplatné dlaždice mají šrafu, chyby ikonu + text, provoz má legendu a tooltip, LED
  hostů mají i tvar (● online, ▲ varování, ■ vypnuto).
- **Fokus**: viditelný fokus ring (2 px, ≥ 3:1) na všech prvcích. Ve scéně focus = obrys objektu + popisek.
  Po zavření panelu se fokus vrací na prvek, který ho otevřel.
- **Klávesnicová cesta celou hrou**: koupit (inventář) → umístit (šipky + Enter) → zapojit (patch panel)
  → ESX (panel hosta) → Návrh (panel) → Deploy (průvodce). Každá akce ve scéně má DOM ekvivalent.
- **Čtečka obrazovky**: scéna má skrytý DOM „seznam objektů v místnosti“ (rack 1: esx-01 … stav), hlášení
  přes `aria-live="polite"` (úspěch) a `assertive` (chyba). Tracker je `role="status"`.
- **Velikost UI** 100 / 125 / 150 % (⚙), min. velikost textu 13 px (dnes 11 px v disclaimer / hint).
- **Reduced motion** viz 3.4.
- **Jazyk**: `lang="en"` u anglických citací a termínů (dnes už částečně).

---

## 5. Implementační backlog (prioritizovaný)
> Aktualizováno: pořadí pro interakce v místnosti je v **kap. 14 (backlog v3)**; položky #6, #8, #9 zpřesňuje.


Legenda: **UI** = ui-dev, **EN** = engine-dev, **MO** = domain-modeler, **SD** = scenario-designer. Velikost S/M/L.

### MVP – „první host online“ (cíl: prvních 5 minut hratelných)
| # | Položka | Kdo | Vel. |
|---|---|---|---|
| 1 | **Sandbox shell v2**: layout HUD / scéna / inventář / pravý panel (sbalitelné, resize canvasu), klávesy `I`, `D`, `Esc` | UI | M |
| 2 | **Sandbox room state v engine**: příkazy `buyItem`, `placeCabinet`, `mountDevice`, `connectCable`, `remove`, `undo/redo`; snapshot pro render; pravidla místnosti (herní) oddělená od VCF validací | EN | L |
| 3 | **Katalog z BCG dat**: model položky (vendor, specs, `certifiedFor: '9.1'` jen z dat, datum exportu), generické switche / racky s příznakem `generic`; herní ceny v odděleném souboru `economy` | EN + MO | M |
| 4 | **Inventář**: kategorie, karta (specs, odznak certified + ⓘ zdroj, herní cena), řádek „V batohu“, filtr „jen certified“ | UI | M |
| 5 | **Placement**: ghost, zelené / šrafované červené dlaždice s důvodem, rotace, potvrzení, montáž do U, undo | UI | M |
| 6 | **Kabeláž**: ruční port → port ve scéně + patch panel overlay + „Zapojit doporučeně“ se shrnutím (pravidla `10-planning §3.3`) | UI + EN | M |
| 7 | **ESX instalace a DCUI**: úloha s ilustrativním trváním, formulář sítě s výchozími hodnotami + štítky (`20-deployment §4.1`), stav hosta online | EN + UI | M |
| 8 | **Management provoz po online**: napojit room cables na trafficModel (Management typ, ilustrativní), úspěšný moment (3.3) | UI | S |
| 9 | **Objective tracker + tipy** (data-driven: kroky T1–T7 v JSON, spouštěné událostmi enginu) | UI + SD | M |
| 10 | **Jednotný systém hlášení** (3.2): komponenta Message s typy `vcf-error / vcf-warning / game-limit / tip` + štítky; seznam Problémy s „ukaž objekt“ | UI | M |
| 11 | **Pravý panel Návrh v2**: akordeon, souhrn HW, blokace s důvodem + odemykací akce, ★ jen z RCMD / doc doporučení, „Proč?“ | UI (+ EN: `optionAvailability(hw)` v modelu) | L |
| 12 | Kontrast a obrysy kabelů / paketů v místnosti, fokus ring, min. 13 px text | UI | S |

### Další (po MVP)
| # | Položka | Kdo | Vel. |
|---|---|---|---|
| 13 | Use case krok („Co nasadit“) podle průvodce, nemodelované volby jako 🧩 | UI + EN | S |
| 14 | Design Blueprints jako start („Začít podle blueprintu“, `05-design §2.7`) | MO + UI | M |
| 15 | L1 / L2 konfigurace hosta a switche (NIC, disky, MTU, VLAN), helper „MTU podle doporučení“ | UI + EN | M |
| 16 | Live propojení panelu Návrh se scénou (hover zvýrazní hosty, ghost chybějícího hosta) | UI | M |
| 17 | Porovnání položek (max. 3) s indikátory vůči zvolenému návrhu | UI | S |
| 18 | Panel Úlohy (tasks) + progress u objektu + retry | UI + EN | M |
| 19 | Knihovna odkazů (📖) a glosář pojmů | UI | S |
| 20 | Nastavení ⚙ (tipy, reduced motion, velikost UI, zvuk, okamžité akce) | UI | S |
| 21 | Skrytý DOM seznam objektů, aria-live, plná klávesnicová cesta, test bez myši | UI | M |
| 22 | Bottom-sheet layout pro ≤ 1024 px / dotyk | UI | M |
| 23 | Zvuky (6–8 samplů) | UI | S |
| 24 | Uložení / načtení Sandboxu (localStorage), potvrzení při odchodu | EN + UI | M |
| 25 | Kariéra: tracker s body, srážky za nápovědy, rozpočet (stejné komponenty, jiná vrstva) | SD + EN + UI | L |

---

## 6. Review současného UI (commit 856384e)

Screenshoty (headless Chromium, 1366×768 a 390×844):
`/tmp/claude-1000/-workspaces-vcf-game/79a2ed2c-cd7f-4ffa-b10c-8ab22e1fbc99/scratchpad/ux-menu.png`,
`ux-intro.png`, `ux-design.png`, `ux-design-mobile.png` (stejná složka). Místnost (`#/sandbox/mistnost`) se
v době review ještě nevykreslovala (rozpracovaná, nehodnoceno).

| Obrazovka | Problém / příležitost | Návrh | Priorita |
|---|---|---|---|
| Návrh | Na startu svítí červeně **„CHYBY (BLOKUJÍ) · 1 – Nerozhodnuto (16)“**. Nováček vidí chybu dřív, než cokoliv udělal. Nerozhodnuto není chyba. | Nerozhodnutá rozhodnutí ukazovat jako neutrální průběh („Hotovo 0 / 16“). Červeně jen skutečné porušení pravidla (3.2). | vysoká |
| Návrh | Jeden dlouhý svitek: všechna rozhodnutí, volby, důsledky a zdroje najednou. 16 rozhodnutí je pro nováčka zeď textu. | Akordeon (jedno rozhodnutí otevřené), hotová jako 1 řádek; nabídnout „Začít podle blueprintu“ (`05-design §2.7`). | vysoká |
| Návrh | Návrh je oddělený od HW (žádná vazba na místnost) – neodpovídá Sandboxu v2. | Přesunout do pravého panelu u místnosti; dostupnost voleb počítat z HW (backlog 11). | vysoká |
| Návrh | Úvodní řádek s legendou štítků (citace / parafráze / neověřeno / ilustrativní model) je hustý a nováček ho nepotřebuje hned. | Legendu dát do „?“ a štítky vysvětlit tooltipem na štítku samotném (už existuje `title`). | střední |
| Návrh | Žádné doporučení na první pohled; hráč neví, co zvolit. | ★ u voleb, které dokumentace doporučuje (jen se spec oporou), „Proč?“ expander. | vysoká |
| Návrh (mobil 390 px) | Obsah fieldsetu přetéká vpravo (rámeček rozhodnutí je oříznutý), stepper oříznutý, panel validace pod obsahem mimo dohled. | Bottom sheet / jednosloupcový layout, `min-width: 0` u flex / grid potomků, stepper jen čísla. | nízká (telefon není cíl) |
| Návrh | Volby mají jen radio + text. Chybí vizuální náhled důsledku (náhled `designPreview` existuje, ale je daleko od volby). | Při hover / výběru volby zvýraznit dotčenou část náhledu, v v2 rovnou ve scéně. | střední |
| Návrh | Tlačítko „Pokračovat na Přípravu →“ je disabled bez vysvětlení u tlačítka. | Tooltip / text pod tlačítkem „Zbývá rozhodnout 16“ s odkazem na první nerozhodnuté. | střední |
| Sandbox intro | Text je správný, ale dlouhý (3 bloky o věrnosti). Pro nováčka je to „smlouva“, ne pozvánka. Chybí obrázek, co ho čeká. | Zkrátit na 3 krátké odrážky (Postav serverovnu · Nainstaluj a navrhni · Nasaď podle dokumentace), malá ilustrace místnosti, podrobnosti o věrnosti za „Jak hra pracuje s dokumentací ▸“. CTA „Vstoupit do serverovny“. | vysoká |
| Sandbox intro | Fáze 1–3 (Návrh, Příprava, Deploy) neodpovídají toku v2 (Serverovna → … → Deploy). | Aktualizovat na fáze v2 (sekce 0) po implementaci místnosti. | střední |
| Hlavní menu | Tmavý technický vzhled (menu i backdrop) nesedí s novým útulným světlým stylem místnosti (GRAPHICS 2026-11-21). | Backdrop = světlá místnost (render/room) v pomalé kameře, menu karta světlá. | střední |
| Hlavní menu | Disclaimer `#66768a` na tmavém pozadí 11 px má kontrast 3.9:1 (< 4.5 AA). | Zesvětlit na ≥ `#8090a4` (nebo v novém světlém stylu tmavý text) a 12–13 px. | střední |
| Hlavní menu | „Ukázka provozu (ilustrativní)“ je rovnocenná položka se Sandboxem a mate nováčka. | Přesunout pod „Další“ / menší odkaz, nebo začlenit do Sandboxu (provoz po prvním hostu). | nízká |
| Hlavní menu | „Kariéra – Připravujeme“ je klikací a vede na prázdnou obrazovku. | Disabled se štítkem, nebo jasná „coming soon“ karta bez slepé uličky. | nízká |
| Ukázka provozu (HUD) | Text nápovědy `#6b7a8c` 11 px = 4.1:1 (< AA). Zkratky `1/2/3` budou kolidovat s inventářem v Sandboxu. | Zvýšit kontrast a velikost; v Sandboxu zkratky dle 4.3. | nízká |
| Obecně | Fokus ring existuje (`:focus-visible`), dobrý základ. Některé štítky mají `tabindex=0` jen kvůli `title`, takže hráč tabuje přes desítky štítků. | Tooltip štítků přes jedno `?` u legendy nebo `aria-describedby`; štítky z tab pořadí vyřadit. | střední |
| Obecně | Konzistentní a pečlivé označování (parafráze / citace / ilustrativní) – silná stránka, kterou v2 musí zachovat. | Zachovat a sjednotit do systému hlášení 3.2. | – (pozitivní) |
| Místnost (palette) | Barvy provozu z GRAPHICS jsou navržené pro tmavou scénu. Na světlé podlaze mají kontrast 1.05–2.5:1. | Kabely a pakety s tmavým obrysem (GRAPHICS doplněno), test kontrastu ve scéně. | vysoká |

---

# Část II – Interakce v serverovně (návrh v3, 2026-11-21)

Navazuje na `CLAUDE.md` (Sandbox: checkpointy, ovládání v místnosti) a `GRAPHICS.md` („Interaktivní objekty
v serverovně“, „Provoz mezi hosty“). Inspirace od uživatele (3D rack s porty, tabule s ručně kresleným diagramem,
počítač s „terminálovým“ obchodem, webový vizualizér vmnic karet) slouží **jen jako nápad**. Provedení je vlastní:
kreslená útulná izometrie, žádné převzaté rozložení ani assety.

Stav podkladů ve specu, ze kterých část II čerpá:
- fyzická síť, ToR, MTU, VLAN: `10-planning §3.3`; výchozí síť ESX (vmnic0, vSwitch0, vmk0, MTU 1500), hlášky
  validace MTU / uplinků: `25-usecases-and-physical §3.5, §5.3, §5.4, §6.3, §7`;
- toky provozu: `10-planning §7`, `20-deployment §7`, `25 §7`, NIC a rychlosti: `15-hardware §7`;
- **OOB management (BMC)**: `25 §10` (výzkum 2026-11-21). Verdikt: switche a konektivita pro OOB jsou podle
  designu VCF **mimo scope** („switches utilized for out-of-band connectivity to the ESX host are out of scope“,
  `25 §10.1` [U55]); OOB není v žádném seznamu sítí VCF (`§10.2.2`). Ve hře je proto BMC **volitelný herní krok
  „mimo VCF scope – herní“**, který nic neblokuje a nenese provoz VCF. Podrobně **kap. 15**. První dokumentovaná
  síť VCF je **ESX management (vmk0)**.
- **Pozor na termín**: ve VCF 9.1 znamená „out-of-band (OOB) operations“ i **změny mimo SDDC Manager** (config
  drift, `25 §10` úvod [U82]). Pravidla pojmenování v UI viz 15.1.

## 7. Společný rámec: režimy pohledu a přechody

### 7.1 Režimy (view stack)
Místnost je „domov“. Interaktivní objekty otevírají **celoobrazovkové pohledy**, které se skládají do zásobníku.
`Esc` (nebo tlačítko Zpět, nebo tlačítko Zpět v prohlížeči) vždy odebere jeden pohled.

```
Místnost ─┬─ Rack (2D čelní pohled) ── Host – síť (karty vmnic)
          ├─ Tabule (High-Level Design + kreslení)
          └─ Počítač ── aplikace (Návrh VCF · Use case · Knihovna · … )
```

| Pohled | URL (hash) | Co zůstává vidět | Co se skryje |
|---|---|---|---|
| Místnost | `#/sandbox/mistnost` | vše | – |
| Rack | `…/rack/<rackId>` | HUD, tracker (sbalený) | inventář (jen kategorie Kabely jako lišta), panel Návrh |
| Host – síť | `…/rack/<rackId>/host/<hostId>` | HUD, tracker | totéž |
| Tabule | `…/tabule` | HUD | inventář, panel Návrh, tracker se sbalí do čipu |
| Počítač | `…/pocitac/<app>` | HUD (čas, tracker čip) | inventář, panel Návrh (PC má plnou verzi) |

- Deep link funguje i po reloadu (otevře rovnou pohled, bez animace).
- Engine běží dál ve všech pohledech (čas, úlohy). Pauzu ovládá jen hráč.
- **Výkon**: aktivní je vždy jen jeden těžký pohled. Když je otevřený celoobrazovkový pohled, kontejner místnosti
  má `visible = false` a částice místnosti se nesimulují (sim se jen „přeskočí“ na aktuální stav po návratu).

### 7.2 Přechod Místnost → objekt (jednotný „zoom + prolnutí“)
1. **Hover** (myš): obrys objektu zesílí (2 px OUTLINE + světlý vnější lem), kurzor `zoom-in` (lupa),
   po 400 ms tooltip „Rack R1 · 3 servery · klik = otevřít“. Nad objektem se objeví malá ikona lupy
   (sprite, ne text), aby to bylo vidět i bez kurzoru (dotyk, klávesnice).
2. **Klik / tap / `E` / `Enter` na objektu ve fokusu**: avatar se vydá k objektu (kosmetika, nečeká se na něj),
   kamera plynule najede na objekt (tween 350 ms, ease-out cubic, cílový zoom tak, aby objekt vyplnil ~70 % výšky).
3. **Prolnutí** (150 ms): místnost alpha 1 → 0, nový pohled alpha 0 → 1, nový pohled začíná mírně zvětšený
   (scale 0.96 → 1), aby navazoval na pohyb kamery.
4. Zpět: obráceně (prolnutí 150 ms, pak kamera zpět na **uloženou kameru místnosti**, 250 ms).
- Celý přechod ≤ 500 ms. Jakýkoli vstup během přechodu (klik, `Esc`) ho **dokončí okamžitě**.
- `prefers-reduced-motion` / ⚙ „Omezit pohyb“: bez letu kamery, jen prolnutí 100 ms.
- Pokud je vybraná položka z inventáře (režim stavby), klik na rack **nemontuje do pohledu**, ale montuje server
  (stávající chování). Otevření racku v režimu stavby = `E` nebo dvojklik. Tooltip to řekne.
- Dvojklik na prázdnou podlahu = „celá místnost“ (zůstává).

### 7.3 Klávesy (doplněk k 4.3)
| Klávesa | Kde | Akce |
|---|---|---|
| `E` | místnost | použít objekt ve fokusu / pod kurzorem / nejbližší k avatarovi (rack, tabule, počítač) |
| `Tab` ve scéně | místnost | cyklus objektů: racky → stojany → tabule → počítač (fokus = obrys + popisek) |
| `T` | všude | tracker úkolů sbalit / rozbalit (`Shift+T` = skrýt / zobrazit úplně) |
| `Shift+D` | všude | otevřít Počítač → Návrh VCF |
| `Esc` | pohled | o úroveň zpět (zruší nejdřív rozdělanou akci, např. visící kabel) |
| `Backspace` | pohled | totéž jako `Esc` (mimo textová pole) |

Dnešní `D` (panel Návrh), `L` (legenda), `C` (kabeláž) zůstávají. `C` v místnosti otevře rack vybraného hosta.

---

## 8. Tracker úkolů (checkpointy v Sandboxu)

### 8.1 Cíl a vztah k onboardingu T1–T7
- `CLAUDE.md`: hráč vždy ví, co dělat dál; checkpointy jsou **volitelné**, dají se odkliknout a skrýt, **nic
  nezamykají**.
- Tento tracker **nahrazuje a zobecňuje** 1.3. Onboarding T1–T7 (1.2) se stává **prvními úkoly skupin A–D**
  téhož datového systému. Rozdíl mezi „tutoriálem“ a „trackerem“ je jen vrstva bublin avatara (1.4):
  - **Tracker** = co dělat (seznam, průběh, „Ukaž mi“).
  - **Tipy / bubliny** = proč a jak, jen u prvního výskytu. Spouští je aktivace úkolu (`onActivateTip`).
  - V ⚙ jsou to **dva nezávislé přepínače**: „Nápovědy (bubliny)“ a „Tracker úkolů“. Zkušený hráč může vypnout
    bubliny a nechat si tracker, nebo naopak.
- Kariéra použije stejnou komponentu, jen s úkoly mise, body a bez „Přeskočit“ (tam se přeskakuje za srážku).

### 8.2 Rozložení
Tracker sedí **vlevo nahoře pod HUDem** (místo dnešní velké legendy, která se přesune vlevo dolů jako čip, viz 11.4).
Šířka 280 px (≤ 1366 px: 248 px). Tři stavy:

```
Rozbalený (výchozí při prvním vstupu)          Sbalený (po dokončení T7 nebo klávesa T)
┌ Úkoly · A Serverovna 3/5 ──────── [–][⋯] ┐   ┌ ▶ Zapoj host esx-02 do switche  ◐ 1/2 ┐
│ ▶ Zapoj každý host do switche            │   └───────────────────────────────────────┘
│   ◐ zapojeno 1 / 2 hosty                 │
│   ▸ esx-01 ✓   ▸ esx-02 ○                │   Skrytý (Shift+T): nic na scéně,
│   [Ukaž mi]  [Proč?]   [Přeskočit]       │   v HUDu jen ikona ☰✓ „Úkoly skryté“
│ ──────────────────────────────────────── │   (klik = zobrazit)
│ ✓ Postav rack                            │
│ ✓ Kup server certifikovaný pro VCF 9.1   │
│ ✓ Kup switch                             │
│ ○ ★ Druhý switch (doporučeno)       [⤼]  │
│ ──────────────────────────────────────── │
│ ▸ B Hosty (ESX) 0/5   ▸ C Use case 0/1 … │  ← další skupiny sbalené
└──────────────────────────────────────────┘
```
- **HUD čip „Další krok“** (2.2) ukazuje totéž co první řádek sbaleného trackeru. Klik = rozbalit tracker.
- Skupiny = fáze toku v2 (A Serverovna, B Kabeláž, C Hosty, D Co nasadit, E Návrh, F Příprava, G Deploy).
  Aktuální skupina je rozbalená, hotové a budoucí jsou 1 řádek. Číslování fází v HUDu (2.2) bere průběh z trackeru.
- Max. 8 řádků ve skupině bez scrollu. Delší skupina: „+3 další“.

### 8.3 Stavy úkolu
| Stav | Ikona | Význam | Jak vzniká |
|---|---|---|---|
| čeká | `○` | ještě nezačal | predikát nesplněn, průběh 0 |
| rozpracováno | `◐ n/N` | část splněna | počítadlo > 0 |
| hotovo | `✓` | splněno ze stavu hry | predikát splněn |
| problém | `⚠` | bylo hotovo, teď ne (např. prodaný host, odpojený kabel) – jen u úkolů typu `doc-required` | predikát se vrátil na false po dřívějším ✓ |
| přeskočeno | `⤼` (šedě, přeškrtnuté) | hráč ho odklikl | akce hráče; **automaticky se změní na ✓**, když ho stav později splní |
| mimo VCF (herní) | `◇` | volitelný herní krok mimo scope VCF (BMC, kap. 15) – nepočítá se do průběhu fáze | druh `game-optional` |
| čeká na spec | `⏳` | obsah se připravuje | `featureFlag` – v buildu pro hráče se vůbec nezobrazí |

- Úkol má **druh** (zobrazený štítkem, sjednoceno s 3.2):
  - `doc-required` – požadavek dokumentace (červená tečka u ikony, „Proč?“ s ID pravidla),
  - `doc-recommended` – doporučení dokumentace (★, stejné pravidlo jako ★ v 2.7),
  - `game-step` – herní krok bez faktu VCF (např. „Postav rack“), bez „Proč?“ s citací, jen herní tip.
  - `game-optional` – volitelný herní krok **mimo scope VCF** (BMC, kap. 15): štítek „mimo VCF scope – herní“,
    nepočítá se do `n/N` skupiny, „Další krok“ na něj nikdy neukáže jako na jediný povinný; „Proč?“ vysvětlí,
    proč je mimo VCF (s odkazem `25 §10.1`).
- **Přeskočit** nikdy nemění stav hry ani nevypíná validace. Jen přestane vést. U `doc-required` úkolu se
  potvrzuje jednou větou: „Přeskočit vedení? Validace VCF tě na tohle později stejně upozorní.“

### 8.4 Akce
| Akce | Myš / dotyk | Klávesnice | Výsledek |
|---|---|---|---|
| Ukaž mi | tlačítko | `Enter` na úkolu | podle `showMe`: kamera na objekt + pulz obrysu (1,5 s), nebo pulz kategorie inventáře, nebo otevře panel / PC aplikaci / rack |
| Proč? | tlačítko | `Space` na „Proč?“ | expander 1.6 (parafráze → citace → ID → TechDocs ↗ → spec §) |
| Přeskočit | `⤼` u úkolu | `Del` na úkolu | stav ⤼ + toast „Přeskočeno · Vrátit“ (undo 5 s) |
| Dílčí kroky | `▸` | šipka vpravo | rozbalí sub-steps (max. 1 úroveň) |
| Menu `⋯` | klik | `Shift+F10` | Zobrazit všechny skupiny · Skrýt tracker · Obnovit přeskočené · Nápovědy zap/vyp |
| Sbalit / skrýt | `[–]` | `T` / `Shift+T` | viz 8.2 |

Dokončení úkolu: řádek se odškrtne (✓ animace 200 ms, scale fajfky), po 1,5 s se posune do hotových a nahoře
se objeví další. Toast jen u **konce skupiny** („Serverovna hotová – 5/5“), ne u každého úkolu (bez spamu).
`aria-live="polite"`: „Hotovo: Kup switch. Další krok: Zapoj každý host do switche.“

### 8.5 Výběr „dalšího kroku“
1. Vezmi skupiny v pořadí toku v2 (sekce 0).
2. V první skupině, která má nehotový a nepřeskočený úkol, vyber první takový úkol, jehož `after` jsou hotové
   (nebo přeskočené). `after` je **doporučené pořadí, ne zámek**.
3. Když hráč dělá věci mimo pořadí (např. otevře Návrh dřív), tracker to nezpochybňuje: úkoly z pozdější skupiny
   se odškrtnou, jakmile je stav splní. „Další krok“ zůstane na první nehotové věci, ale čip ukáže `+2 hotovo
   napřed`.
4. Vše hotovo: „Sandbox je tvůj. Zkus rozbít síť a podívej se, co řekne validace.“ (herní tip) a tracker se sbalí.

### 8.6 Datový model (pro scenario-designer + engine-dev)
Úkoly jsou **data** (JSON), splnění se **odvozuje ze stavu** (snapshotu), ne z jednorázových událostí. Díky tomu
funguje undo, prodej, načtení uložené hry i pořadí mimo průvodce. Události slouží jen pro oslavu („poprvé
splněno“).

```ts
// game/src/modes/sandbox/objectives/schema.ts (návrh)
interface ObjectiveGroup { id: 'A'|'B'|'C'|'D'|'E'|'F'|'G'; title: string; objectives: Objective[] }
interface Objective {
  id: string;                      // 'cabling.each-host-to-switch'
  title: string;                   // imperativ, ≤ 48 znaků, česky
  kind: 'doc-required' | 'doc-recommended' | 'game-step' | 'game-optional';
  why?: { paraphrase: string; ref: SpecRef; ruleId?: string; quote?: string }; // povinné u doc-*
  done: PredicateRef;              // { sel: 'hostsConnectedToSwitch', min: 'allHosts' }
  progress?: CounterRef;           // { sel: 'hostsWithEsx', target: 'allHosts' | { fromModel: 'minHosts' } }
  subSteps?: Objective[];
  showMe?: ShowMeTarget;           // { object: 'firstHostWithout:cable' } | { inventory: 'switches' } | { view: 'pc/navrh' } …
  after?: string[];
  onActivateTip?: string;          // id tipu (1.4)
  featureFlag?: 'oob-pending-spec';
}
```
- `PredicateRef` / `CounterRef` jsou **jména selektorů** z registru v kódu (`objectiveSelectors.ts`, čisté funkce
  nad snapshotem), ne výrazy v JSON. Fakta VCF (např. minimum hostů pro zvolený návrh) dodává **model**
  (`10-planning §6.1` přes `optionAvailability` / `minHosts`), JSON je nikdy neobsahuje jako číslo.
- Vyhodnocení `evaluateObjectives(snapshot, defs, prefs) → ObjectiveView[]` je čistá funkce, memo podle `revision`.
- Stav hráče v uložené hře: `{ skipped: string[], celebrated: string[], trackerMode: 'open'|'collapsed'|'hidden' }`.
- `SpecRef` je stejný typ jako ve `scenarios/schema.ts` (rozšířit `SpecFile` o `15-hardware`, `25-usecases-and-physical`).

### 8.7 Obsah – návrh skupin (finalizuje scenario-designer, fakta jen z odkazů)
| Sk. | Úkol | Druh | Opora |
|---|---|---|---|
| A | Postav rack (T1) | game-step | – |
| A | Kup server certifikovaný pro VCF 9.1 (T2) | doc-required | `10-planning §3.4` [P33], `15-hardware` B.1 (`supportedReleases`) |
| A | Kolik hostů? – `n / N` (T3), N z modelu podle návrhu, bez návrhu „aspoň 1“ (herní) | doc-required, jen když je návrh zvolený | `10-planning §6.1` |
| A | Kup switch (T4) | doc-required | `10-planning §3.3` VCF-NET-REQD-TOR-001 |
| A | ★ Druhý switch | doc-recommended | `10-planning §3.3` VCF-NET-RCMD-TOR-001 |
| A | Připoj switch do sítě firmy (uplink na stěně, 10.2) | game-step (zjednodušení) | proč: hosty potřebují gateway a DNS – DCUI test sítě, `25 §6.3` [U34]; `20-deployment §4.1.2` |
| B | Zapoj každý host do switche `n/N` (T5) | doc-required | VCF-NET-REQD-TOR-001 |
| B | ★ Uplinky hosta na dva různé switche | doc-recommended | VCF-NET-RCMD-TOR-001; každý uplink samostatně, ne LAG: VCF-NET-REQD-LAG-001 (`10-planning §3.3`) |
| B | ◇ Zapoj a nastav BMC (vzdálená správa serveru) – volitelné, kap. 15 | game-optional, „mimo VCF scope – herní“ | `25 §10.1` (OOB mimo scope), `§10.2.1` (vlastní NIC a IP BMC) |
| C | Nainstaluj ESX `n/N` (T6), sub-steps ISO → disk → heslo → reboot; dvě cesty: u serveru (fyzické médium) / vzdáleně přes BMC (kap. 15.3) | doc-required | `20-deployment §4.1.1`, `25 §10.4.1` |
| C | **ESX management (vmk0)** – první síť VCF: VLAN v DCUI, statická IPv4, vmk0 na vSwitch0 s vmnic0 → začne management provoz | doc-required | `25 §3.5`, `§6.3`, `§10.2.2`; `20-deployment §4.1.2` |
| C | Nastav síť v DCUI (VLAN, IPv4, DNS, FQDN, bez custom sufixů) | doc-required | `20-deployment §4.1.2`, `§3.2` |
| C | Otestuj management síť (gateway, DNS, hostname) → **první provoz** | game-step s odkazem (spec test nepopisuje jako povinný) | `25 §6.3` [U34], tok N2 `25 §7` |
| C | NTP na hostech | doc-required | `20-deployment §4.1.3` |
| C | Regeneruj certifikát | doc-required | `20-deployment §4.1.4` |
| D | Vyber, co nasazuješ (use case) (T7) | doc-required | `25 §2.1`, `20-deployment §4.2` kroky 3–4 |
| E | Návrh `Hotovo n/N` (sub-steps = kroky návrhu) | doc-required | `05-design §4`, `§4.10` |
| E | Potvrď principal storage (štítek Nevratné) | doc-required | `20-deployment §4.2` krok 7 |
| F | DNS záznamy A + PTR, NTP | doc-required | `10-planning §4` krok 8, `20-deployment §3.5` |
| F | Nasaď VCF Installer appliance, stáhni binárky | doc-required | `20-deployment §4.1.5`, `§4.1.6` |
| G | Projdi validaci (warnings potvrď, errors oprav) | doc-required | `20-deployment §4.2` krok 19 |
| G | Deploy a sledování úloh | doc-required | `20-deployment §4.2` krok 20 |

Pozn.: pořadí skupin je **herní** (Sandbox začíná místností). Věta o reálném pořadí (plánovat → kupovat,
`10-planning §4`) zazní v tipu u úkolu „Kolik hostů?“ (T3, viz 1.2).

### 8.8 Prázdné a chybové stavy
- Data úkolů se nenačetla (chyba JSON / schéma): tracker ukáže „Úkoly nejsou k dispozici“ + hra běží dál
  (tracker není kritický). V dev buildu konzolová chyba se schématem.
- Uložená hra má přeskočené id, které už neexistuje: tiše ignorovat.
- Žádný hardware: první úkol „Postav rack“ s pulzující dlaždicí (3.1).

---

## 9. Rack – zoom a 2D čelní pohled (kabeláž)

Nahrazuje kabeláž ve scéně a patch panel overlay z 2.5 jako **hlavní** místo zapojování. Patch panel seznam
zůstává jako přístupná (klávesnice / čtečka) varianta téhož pohledu (9.7).

### 9.1 Rozložení (1366×768)
```
┌ HUD ─────────────────────────────────────────────────────────────────────────────────────────┐
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ ← Místnost   Rack R1 · 3 servery · 1 switch      [◀ R0] [R2 ▶]   Zobrazit: ☑ kabely ☑ provoz ☐ popisky │
│  ┌──────────────── R1 ─────────────────┐ ┌─ stojan S1 ─┐                                       │
│  │42┆ ░░░░░░░░ 30 U volné ░░░░░░░░  ┆  │ │ ▣▣▣▣▣▣▣▣ │← switch sw-A, 16 portů, LED link   │
│  │12┆┌───────────────────────────┐ ┆  │ │ ▣▣▣▣▣▣▣▣ │                                    │
│  │11┆│ ▮Vendor B  esx-03  ● ◌◌◌◌ ▢│ ┆  │ └────────────┘                                     │
│  │10┆└───────────────────────────┘ ┆  │      ▲ kabelový žlab (nahoře, auto-trasa)          │
│  │ 9┆┌───────────────────────────┐ ┆  │                                                     │
│  │ 8┆│ ▮Vendor B  esx-02  ● ●●◌◌ ▢│═╪══╪══════════╗                                       │
│  │ 7┆└───────────────────────────┘ ┆  │           ║                                       │
│  │ …┆   ● LED stavu   ◌ NIC port   ▢ BMC (herní)   ║                                       │
│  └──────────────────────────────────┘             ╚═► sw-A p2                             │
│ ┌ Kabely ─────────────────────────────────────────────────────────────────────────────────┐ │
│ │ [Zapojit doporučeně]  barva: ◯ neutrální ● ● ● ●   ☐ popisky   Odpojit vše   ⟲ ⟳         │ │
│ └──────────────────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```
- Vlevo **vybraný rack**, vpravo **cílová zařízení mimo rack** (stojany se switchi, další racky) jako užší sloupce.
  Max. 3 sloupce vedle sebe. Další racky přes `◀ ▶` (nebo `[` `]`).
- **Komprese prázdných U**: souvislé prázdné pozice ≥ 4 U se kreslí jako jeden šrafovaný pás „30 U volné“
  (klik = rozbalit). Tím se 42 U rack s pár servery vejde na výšku a servery jsou velké (cíl 1 U ≈ 22–28 px).
- Rack obsazený od shora dolů (plný) → vertikální scroll kolečkem / tahem; zoom `+ / -` (1×–3×).
- Spodní lišta „Kabely“ nahrazuje inventář (kabely jsou v Sandboxu zdarma a nekonečné – herní zjednodušení).

### 9.2 Kresba zařízení (vlastní styl, žádná loga)
- Server: čelní panel ve barvě vendor štítku (jen barevný proužek + text vendoru), hostname, LED stavu
  (tvar + barva: `●` zapnuto / online, `▲` varování, `■` vypnuto, 4.5), NIC porty jako zaoblené čtverečky
  s malou LED linku nad nimi, popisek `vmnic0…` při zoomu ≥ 1,5× nebo hoveru.
  - Počet a rychlost NIC portů z konfigurace serveru (katalog z BCG, `15-hardware` B.1–B.3). Pořadí a názvy
    `vmnicN` jsou z ESX (`vmnic0` = výchozí management NIC, `25 §6.3` [U32]); před instalací ESX se porty
    jmenují neutrálně „NIC 1…“ (herní zjednodušení) a po instalaci dostanou `vmnic` jména.
  - **BMC port**: samostatný port odlišného tvaru (čtvercový, šedý) se štítkem „BMC“ a odznakem
    `mimo VCF scope – herní`. BMC má vlastní NIC a IP, odlišnou od IP hosta, a je napájený i při vypnutém hostu
    (`25 §10.2.1` [U74]). Kam ho zapojit, VCF nepopisuje (`25 §10.1`, §10.2.3), proto hra dovolí **jakýkoli**
    port switche a nic nehlásí. Podrobně kap. 15.
- Switch: řada portů (generický, herní), číslování p1…pN, LED linku a aktivity, jeden **uplink port** odlišený
  barvou rámečku (pro připojení do sítě firmy, 10.2).
- LED aktivity bliká podle provozu (alpha toggle, max 4 Hz, bez nových textur). Reduced motion: LED svítí trvale.

### 9.3 Zapojování
| Akce | Myš | Dotyk | Klávesnice |
|---|---|---|---|
| Začít kabel | stisk na portu a táhnout, **nebo** klik na port | tap na port (port se zvětší na 44 px „lupou“) | fokus portu (šipky), `Enter` |
| Vést | kabel visí za kurzorem (pružná bezier), kompatibilní porty se rozsvítí, obsazené / nekompatibilní ztmavnou se šrafou | tah prstem nebo tap na cíl | šipky skáčou mezi **kompatibilními** porty |
| Dokončit | puštění / klik na cílový port | tap na cíl | `Enter` |
| Zrušit | `Esc`, pravé tlačítko, puštění mimo port | tlačítko ✖ u visícího konce | `Esc` |
| Vybrat kabel | klik na kabel nebo jeho konektor | tap | `Tab` na kabel v seznamu (9.7) |
| Odpojit | vybrat → `Del` / „Odpojit“ v popoveru; nebo vytáhnout konektor z portu do prázdna | popover → Odpojit | `Del` |
| Přepojit | táhnout konektor na jiný port | popover → Přepojit | `M` na vybraném kabelu |
| Undo / Redo | `Ctrl+Z` / `Ctrl+Shift+Z` | ⟲ ⟳ v liště | totéž |

- **Zvětšení portu pod kurzorem**: port v okruhu 24 px pod kurzorem se zvětší 1,6× (jen transform), aby šlo trefit
  i malé porty bez zoomu. Cíl kliknutí je vždy ≥ 24×24 px (WCAG 2.5.8), na dotyku 44×44 px.
- **Popover kabelu**: `esx-02 vmnic1 ⇄ sw-A p2` · rychlost · barva (kosmetická) · popisek (volný text, max. 24 zn.) ·
  Odpojit · „Detail hosta“ (9.6).
- **Zapojit doporučeně** (2.5) funguje i tady: animuje kabely jeden po druhém (40 ms rozestup, max 1 s celkem) a
  vypíše shrnutí + Proč? + Undo.
- Zvuk „cvak“ při zapojení, LED linku zezelená (link up, herní), port dostane fajfku na 600 ms.

### 9.4 Auto-trasa a vzhled kabelů
- Trasa je **ortogonální se zaoblenými rohy**: z portu vodorovně do bočního kabelového kanálu racku → svisle →
  (jiný rack / stojan) nahoru do horního žlabu → přes → dolů ke kanálu cíle → do portu. Uvnitř jednoho racku
  jen kanál. Každý kabel dostane **pruh** (lane) v kanálu, rozestup 3 px, aby se nepřekrývaly. Výpočet trasy je
  čistá funkce (`rackRoute.ts`, testovatelná), přepočet jen při změně zapojení.
- Barva: výchozí **neutrální** (tmavě šedý plášť s OUTLINE obrysem). Hráč může kabelu nastavit **kosmetickou
  barvu** z palety 5 barev pláště, které se **nepřekrývají s barvami provozu** (např. černá, bílá, žlutá
  `#e0b400`, růžová `#e86fb0`, hnědá `#8a5a3c` – finální odstíny ui-dev, kontrola kontrastu ≥ 3:1 vůči pozadí
  pohledu). Popis v UI: „Barva kabelu je jen tvoje značení (jako v reálné serverovně).“
- Vybraný kabel: zvýrazněný (světlý lem), ostatní ztlumené na 40 %. Hover na port = zvýrazní jeho kabel.
- „Zobrazit: provoz“ = po kabelech jezdí tečky (stejný jazyk jako v místnosti, 12). V racku je to nejpodrobnější
  úroveň: tečky jedou po **konkrétním kabelu** (vmnic → port).
- „Zobrazit: popisky“ = vlaječky na obou koncích kabelu (`vmnic1 → sw-A p2`), jinak jen při hoveru.

### 9.5 Validace a zpětná vazba při kabeláži
Tři vrstvy, aby hráč poznal, kdo co říká (3.2):

| Vrstva | Příklad | Kdy | Blokuje? | Opora |
|---|---|---|---|---|
| **Fyzika hry** (herní pravidla) | port obsazený; kabel do vlastního portu; kabel z BMC do NIC jiného serveru (server–server) | při vedení kabelu (port ztmavne + důvod v tooltipu) | ano (nejde zapojit) | herní, štítek `herní pravidlo` |
| **Chyba / varování VCF** – topologie | host bez switche; jen 1 switch; oba uplinky hosta do stejného switche | po zapojení, jako odznak `⚠` / `⛔` u hosta + položka v Problémy + úkol v trackeru | ne při kabeláži; blokuje až validace, kde to říká spec | `10-planning §3.3` (REQD-TOR-001, RCMD-TOR-001, REQD-LAG-001) |
| **Chyba / varování VCF** – konfigurace portu (později) | MTU portu menší než potřebuje provoz (TEP ≥ 1700, ostatní ≥ 1500, dop. 9000); port není trunk 802.1Q; VLAN chybí na portu | jen když je hodnota relevantní (návrh zvolil overlay / jumbo; host má vmk na VLAN) – „nerozhodnuto ≠ chyba“ | ne; validace installeru hlásí doslovné hlášky | `10-planning §3.3`, `25 §5.4`, `25 §3.5` |

- **Konfigurace portu switche** (L2, později): klik na port switche → popover „Port p2“: režim (trunk 802.1Q /
  access), povolené VLAN, MTU (výchozí 1500 = `herní výchozí`, 2.6). Pomocník „Nastavit podle doporučení“.
  Nesoulad MTU po cestě se ukáže i v detailu hosta (9.6) jako řetěz `vmk → vSwitch → port switche`.
- **Hlášky validace installeru** (např. vmkping MTU 9000 selže, `25 §5.4`) se v racku zobrazí u dotčených portů
  jako `⛔` s textem hlášky v `lang="en"` a tlačítkem **Opravit** (otevře popover portu).
- Nic z výše uvedeného se neukazuje dřív, než to hráč mohl ovlivnit.

### 9.6 Detail hosta – síť (karty vmnic) → viz 12.3
Otevírá se z racku (`Enter` / dvojklik na server / „Detail hosta“ v popoveru). V místnosti klik na server
otevře nejdřív rack s fokusem na server.

### 9.7 Přístupnost
- **DOM vrstva cílů**: nad Pixi plátnem leží průhledná vrstva `<button>` prvků přesně na pozicích portů a kabelů
  (přepočet jen při layoutu / zoomu). Dává nativní fokus, `aria-label` („esx-02, vmnic1, 25 GbE, zapojeno do sw-A
  port 2“), `aria-pressed` u vybraného portu a velké cíle pro dotyk. Kreslí se dál v Pixi.
- **Seznam zapojení** (tlačítko „Seznam“ / klávesa `S`): tabulka `host · port · → zařízení · port · stav`
  (= patch panel z 2.5) se stejnými akcemi. Je to plnohodnotná cesta pro klávesnici a čtečku.
- Ohlášení `aria-live`: „Zapojeno: esx-02 vmnic1 do sw-A port 2.“ / „Nelze: port je obsazený.“
- Kontrast: porty a LED mají tvarové rozlišení (link = vyplněný, bez linku = prázdný kroužek).

### 9.8 Výkon
- Pohled racku je samostatný Pixi kontejner; statická kresba racku a zařízení se **zapéká do textury** při změně
  obsahu (cacheAsTexture). Dynamické jsou jen kabely (1 Graphics na kabel, přepočet při změně stylu – už dnes
  `RoomCableView`), LED (sdílená textura, tint) a tečky (pool spritů).
- Cíl: 40 zařízení + 120 kabelů + 150 teček na Chromebooku 60 FPS.

---

## 10. Tabule (whiteboard) – automatický High-Level Design + kreslení hráče

### 10.1 Umístění a vstup
- Tabule visí na **pravé stěně** místnosti (nahrazuje dnešní plakát v `roomStatic.ts`). Pevný objekt, nekupuje se.
- V místnosti ukazuje **miniaturu** aktuálního diagramu (jen obdélníky a čáry, bez textu = LOD), obnovenou při
  změně stavu (throttle ≥ 1 s). Tabule tím „žije“ a láká ke kliknutí.
- Hover = obrys + lupa (7.2), tooltip „Tabule – návrh tvé serverovny (klik)“. Klik / `E` = přechod 7.2.
- Nový obsah od posledního otevření = malá „!“ samolepka v rohu tabule v místnosti.

### 10.2 Co se kreslí automaticky (ze stavu hry, žádná vymyšlená fakta)
Diagram je **odvozený ze snapshotu** (čistá funkce `hld/layout.ts` → uzly a hrany → render). Vrstvy:

| Vrstva | Obsah | Kdy | Zdroj dat |
|---|---|---|---|
| **Fyzicky** (výchozí) | „Síť firmy / uplink“ (mrak u stěny, herní abstrakce gateway, DNS, NTP, internet pro depot) → switche (název, počet portů) → racky s hosty (hostname, vendor štítek, počet zapojených uplinků `2/4`) | od prvního objektu | stav místnosti |
| **Síť** | sítě a VLAN: management (VLAN, subnet, gateway z DCUI), později vMotion, vSAN, NFS, Host TEP; barevný čtvereček typu provozu (stejné barvy jako tečky); IP rozsahy / pooly | jakmile host má síť z DCUI; další sítě po vyplnění v installeru / návrhu | konfigurace hostů, `model/net.ts`; význam sítí `10-planning §3.2–3.3` |
| **Logicky** | Fleet → Instance → Management domain → cluster → hosty; komponenty z bring-up specifikace (vCenter, NSX Manager, SDDC Manager, VCF Operations …) | po zvolení use case / návrhu; plně po bring-upu | návrh + `00-architektura §1–2` (hierarchie), `20-deployment §2.1` |

- Hodnoty, které hra zvolila (IP plán), mají v diagramu malý štítek `herní výchozí`, stejně jako v panelu hosta.
- Nerozhodnuté věci = čárkovaný obdélník s „?“ a textem „zatím nerozhodnuto“ (ne chyba).
- Problémy z validace = zakroužkované „!“ u prvku (kresleno fixou). Klik = hlášení dle 3.2 s odkazem do specu.
- Hover na prvek (auto vrstva) = zvýrazní ho a ukáže tooltip; klik = „Ukaž v místnosti“ / „Otevři rack“.
- Přepínač vrstev nahoře: `Fyzicky · Síť · Logicky` (záložky = **stránky tabule**; každá má vlastní vrstvu
  poznámek hráče).
- **Škálování**: > 8 hostů v racku → „esx-01 … esx-12 (12)“ jako jeden blok s rozbalením; > 4 racky → racky
  v mřížce. Layout je **deterministický a stabilní** (nové objekty se přidávají na konec, nic neposkakuje), aby
  poznámky hráče nezůstávaly mimo.
- Virtuální plocha tabule 1600 × 1000 jednotek: auto diagram zabírá levých ~70 %, **pravý pruh „Poznámky“
  (~30 %) je rezervovaný pro hráče** a auto layout do něj nikdy nekreslí.

### 10.3 Ručně kreslený styl – levně a ostře
- Žádné filtry, žádný blur. Všechno Pixi `Graphics` + text.
- **Čáry**: polyline rozdělená po ~24 px, každý bod posunutý kolmo o šum ±0,8–1,5 px. Šum je **deterministický**
  (seed = hash id prvku), takže se čára při překreslení nehýbe. Druhý tah s alpha 0,35 a posunem 0,6 px = efekt
  fixy. Rohy obdélníků s přesahem 2–3 px. Šipky jako dvě krátké čárky.
- **Písmo**: rukopisné písmo s licencí OFL, self-hosted, **s ověřenou podporou češtiny (latin-ext)**; výběr
  ui-dev (kandidáti ověřit na diakritiku). Text se renderuje s `resolution = DPR × zoomStep`.
- **Ostrost při zoomu**: auto vrstva se zapéká do textury pro 3 stupně zoomu (1×, 2×, 3×); při změně stupně se
  přepeče (jednorázově, < 30 ms). Mezi stupni se textura jen škáluje.
- **Inkoust**: auto obsah má **vyhrazenou tmavě modrou** (`OUTLINE #2e2645` nebo podobnou „inkoustovou“) a
  stejnou tloušťku. Tuto barvu hráč nemá v paletě. Barevné akcenty auto vrstvy jsou jen barvy typů provozu.
- Tabule: téměř bílá (`#fbfbf7`) s hliníkovým rámem a poličkou na fixy dole (= nástrojová lišta, 10.4).
  Všechny barvy fix ≥ 3:1 vůči ploše tabule.

### 10.4 Kreslení hráče
```
┌ Tabule · Fyzicky | Síť | Logicky ─────────────── ☑ auto diagram ☑ moje poznámky   [Popis] [✖] ┐
│                                                                 ┆ Poznámky                  │
│   ☁ síť firmy                                                    ┆  „koupit 4. host?“         │
│      │                                                           ┆   ~~~~ (hráčova kresba)   │
│   [sw-A]════[sw-B]                                               ┆                           │
│    ║   ╲   ╱  ║                                                  ┆                           │
│   [esx-01][esx-02][esx-03]  ? 4. host (návrh: HA)                ┆                           │
├───────────────────────────────────────────────────────────────────────────────────────────────┤
│ polička:  ✎ fix ▸ ● ● ● ●   tloušťka ▪ ▪▪ ▪▪▪   T text   ⌫ houba   ⟲ ⟳   🗑 smazat moje   │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
```
| Nástroj | Myš / pero | Dotyk | Klávesa (v pohledu Tabule) |
|---|---|---|---|
| Fix (pero) | tah levým tlačítkem | tah 1 prstem | `B` |
| Barva | 4–5 fix (červená, zelená, oranžová, černá, fialová – ne inkoust auto vrstvy) | tap | `1`–`5` |
| Tloušťka | 3 stupně | tap | `[` `]` |
| Text | klik = textové pole (DOM `<input>` na místě, IME, diakritika), `Enter` uloží, `Esc` zruší; dvojklik na text = upravit | tap | `N` |
| Houba (guma) | maže **celé tahy / texty** pod kurzorem (ne pixely) | tah | `G` |
| Undo / Redo | `Ctrl+Z` / `Ctrl+Shift+Z` (vlastní zásobník tabule, max 100 kroků) | ⟲ ⟳ | totéž |
| Smazat moje | 🗑 → potvrzení „Smazat všechny tvoje poznámky na této stránce? Auto diagram zůstane.“ → toast „Smazáno · Vrátit“ | | – |
| Posun / zoom | kolečko, prostřední tlačítko / mezerník + tah | 2 prsty | `+` `-` `0` |
| Skrýt vrstvy | `☑ auto diagram` / `☑ moje poznámky` | | `A` / `M` |

- Pero (`pointerType === 'pen'`): kreslí pero, prst posouvá (palm rejection). Myš: levé kreslí, pravé = posun.
- Při aktivním nástroji Fix se auto vrstva nedá omylem „vybrat“; hover tooltipy auto prvků jen v režimu „ukazovátko“
  (výchozí nástroj `V`).
- **Rozlišení auto vs. hráč**: (1) vyhrazený inkoust auto vrstvy, (2) přepínače vrstev, (3) v rohu tabule razítko
  „Diagram kreslí hra podle tvé serverovny“, (4) auto prvky mají tooltip, kresby hráče ne. Hráč auto obsah
  nemůže smazat ani posunout (houba ho ignoruje; tooltip „Tohle kreslí hra – změň serverovnu“).

### 10.5 Uložení
- Součást uložení Sandboxu: `board: { v: 1, pages: { fyzicky|sit|logicky: { strokes, texts } } }`.
- Tah: barva, tloušťka, body zjednodušené (Ramer–Douglas–Peucker, ε ≈ 0,75 jednotky) a zaokrouhlené na celé
  jednotky plochy, uložené jako pole čísel (delta kódování). Text: x, y, barva, velikost, obsah (max 200 znaků).
- Limity (herní): 1 000 tahů / 100 000 bodů na stránku. Při 90 % toast „Tabule je skoro plná – smaž staré
  poznámky“. Nad limitem se nový tah neuloží (s hláškou), nic se neztratí potichu.
- Ukládá se s debounce 1 s po úpravě a při odchodu z pohledu. Historie undo se neukládá.
- Volitelně (později): „Uložit jako obrázek“ (PNG z renderTexture).

### 10.6 Přístupnost
- Tlačítko **Popis** otevře textovou alternativu auto diagramu (strukturovaný seznam z téhož layout modelu:
  „Síť firmy → sw-A, sw-B. sw-A: esx-01 vmnic0, esx-02 vmnic0 …“, sítě s VLAN a subnety, problémy).
- Texty hráče jsou v seznamu „Moje poznámky (3)“ (čitelné čtečkou), kresby jako „5 kreseb“.
- Celá tabule ovladatelná klávesnicí: nástroje v liště (`Tab`), text přes `N`, posun šipkami.

### 10.7 Výkon
- Auto vrstva = zapečená textura (10.3), přepočet layoutu jen při změně `revision` (throttle 250 ms v pohledu
  tabule, 1 s pro miniaturu v místnosti).
- Kresba hráče: rozdělaný tah = 1 Graphics s přírůstkovým `lineTo`; hotové tahy se slévají do bloků po 50 tazích
  (1 Graphics na blok), aby počet objektů zůstal malý.

---

## 11. Počítač na stole – „připojení“ k herním aplikacím

### 11.1 Objekt a vstup
- **Stůl s monitorem a židlí** u levé stěny vedle dveří (volné místo v dnešní místnosti). Pevný objekt.
- Je to **pracovní stanice admina**. Herní zjednodušení: je připojená do „sítě firmy“ bez kabelu. Ve vizualizaci
  provozu z ní později vychází provoz admina (prohlížeč → ESX Host Client, prohlížeč → VCF Installer, oba HTTPS,
  `20-deployment §7` řádky 1 a 3).
- Monitor v místnosti tiše svítí (statická textura; po nové události bliká malá tečka na monitoru, max 1 Hz).
- Hover = obrys + lupa + tooltip „Počítač – návrh VCF, use case (klik)“. Klávesa `E` u objektu ve fokusu.
- Přechod: avatar dojde a sedne si (kosmetika ≤ 1 s, bez čekání; ⚙ „Okamžité akce“ ji vypne) → kamera na monitor
  (300 ms) → obdélník obrazovky monitoru se **zvětší na celou plochu** pod HUDem (CSS transform DOM vrstvy z pozice
  monitoru, 200 ms) → plocha počítače. Zpět obráceně. Reduced motion: jen prolnutí.

### 11.2 Plocha počítače (DOM, světlý vlastní styl – žádná kopie OS ani UI Broadcomu)
```
┌ HUD hry (čas, tracker čip) ──────────────────────────────────────────────────────────────────┐
├ ◉ AdminPC ──────────────────────────────────────────────── 10:42 (herní čas) ── [⏻ Odejít] ┤
│  aplikace (dock vlevo)  │  okno aplikace (vždy maximalizované, 1 najednou)                   │
│  ┌──────┐               │                                                                     │
│  │ ▦    │ Návrh VCF     │                                                                     │
│  │ ⇶    │ Use case      │                                                                     │
│  │ 📖   │ Knihovna      │                                                                     │
│  │ 🛒   │ Obchod (pozd.)│                                                                     │
│  │ 🌐🔒 │ Prohlížeč     │  ← zamčeno s důvodem (11.5)                                          │
│  │ ⚙🔒  │ VCF Installer │                                                                     │
│  │ 📈🔒 │ VCF Operations│                                                                     │
│  └──────┘               │                                                                     │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```
- Dock = svislý seznam (`role="tablist"`, šipky nahoru/dolů), aplikace = `tabpanel`. Ikony vlastní, jednoduché.
- Klávesy: `Alt+1…7` přepnutí aplikace, `Esc` = zpět o úroveň uvnitř aplikace, na ploše = odejít od počítače.
- Inventář a pravý panel Návrh jsou v počítači skryté (počítač je jejich plná verze).

### 11.3 Aplikace „Návrh VCF“ – rozhodnutí jako dlaždice
```
┌ Návrh VCF ───────────────────────────────────────────────────────────────────────────────────┐
│ Hotovo 5 / 16 ▓▓▓▓░░░░░░  · Tvůj HW: 4 hosty · Vendor B · 2 switche · 4× 25 GbE              │
│ [Začít podle blueprintu ▾]   Filtr: ○ vše ● čeká na mě ○ problémy        [Shrnutí návrhu]     │
├───────────────────────────────────────────────┬──────────────────────────────────────────────┤
│ ① Topologie                                    │ ● Deployment model                           │
│ ┌─────────────┐ ┌─────────────┐                │ Jak odolné mají být management komponenty.  │
│ │✓ Fleet model│ │✓ Kde poběží │                │ ┌───────────────┐ ┌──────────────────────┐ │
│ │  Basic      │ │  workloady  │                │ │ ○ Simple      │ │ ● High Availability  │ │
│ └─────────────┘ └─────────────┘                │ │ ≥ 3 hosty ✔   │ │ ★ doporučeno pro     │ │
│ ③ Deployment model                             │ │ (vSAN)        │ │   produkci           │ │
│ ┌─────────────┐ ┌─────────────┐                │ │               │ │ ≥ 4 hosty (vSAN) ✔   │ │
│ │● Deployment │ │🔒 Velikost  │ ← zamčeno:     │ └───────────────┘ └──────────────────────┘ │
│ │  model  ?   │ │  (po ③)     │   nejdřív ③    │ ▸ Proč? (citace · TechDocs ↗ · spec 05 §4.3)│
│ └─────────────┘ └─────────────┘                │ Dopad: ve scéně zvýrazněno 4 hosty          │
│ …                                              │ [Potvrdit volbu]                             │
└───────────────────────────────────────────────┴──────────────────────────────────────────────┘
```
- Čísla hostů ve wireframu jsou příklad z `10-planning §6.1` (vSAN: Simple 3, HA 4); v UI je dodává model.
- **Dlaždice** = jedno rozhodnutí z modelu (`model/design.ts`, 8 kroků = 8 řad, `05-design §4`). Stav dlaždice:
  `?` nerozhodnuto (neutrální) · `✓` rozhodnuto (ukazuje volbu) · `⚠` odchylka od doporučení · `⛔` chyba VCF ·
  `🔒` závisí na dřívějším rozhodnutí (text „nejdřív …“) · `🧩` zatím ve hře není.
- Klik na dlaždici = **detail vpravo**: volby jako karty (název, 1 věta parafráze, splnění vůči HW `✔/✖` s čísly
  z modelu, ★ jen s oporou v doporučení dokumentace, „Proč?“). Pravidla shodná s 2.7 (nevratné volby, odchylky,
  „nerozhodnuto ≠ chyba“).
- **Dopad ve scéně**: při hoveru volby se v miniatuře místnosti (malý náhled v rohu detailu) zvýrazní dotčené
  hosty / chybějící host jako ghost. Plné zvýraznění ve scéně až po odchodu od počítače (2.7 „živé propojení“).
- **Shrnutí návrhu**: přehled všech voleb + nároky (sizing, `20-deployment §6.2`; počty IP / FQDN `§6.4`) +
  tlačítko „Ukázat na tabuli“ (otevře stránku Logicky).
- Blueprinty (`05-design §2.7`) = rychlá cesta pro nováčka (2.7).

### 11.4 Vztah pravého panelu „Návrh“ a aplikace v počítači
| | Pravý panel (rychlý přehled) | Počítač → Návrh VCF (plná verze) |
|---|---|---|
| Účel | rozhodovat „za chůze“ bez opuštění místnosti, vidět průběh a problémy | přehled všech rozhodnutí naráz, srovnání voleb, blueprinty, shrnutí a nároky |
| Obsah | Hotovo n/N, souhrn HW, **akordeon s jedním rozhodnutím**, Problémy | mřížka dlaždic po krocích + detail s kartami voleb + shrnutí |
| Vstup | `D`, záložka vpravo | `Shift+D`, počítač v místnosti, tlačítko „Otevřít na počítači ▸“ v panelu |
| Stav | **sdílený** – jeden zdroj pravdy (`SandboxSession`, design slice); změna v jednom se hned projeví ve druhém | |
| Komponenty | sdílené: `OptionCard` (kompaktní hustota), `WhyExpander`, `Message` (3.2) | `OptionCard` (plná hustota) |

Pravý panel tedy zůstává plnohodnotný (přístupnost, rychlost), počítač je „pohodlná pracovna“. Žádná funkce
nesmí být **jen** v počítači, kromě čistě přehledových (mřížka, shrnutí).

### 11.5 Další aplikace (postupně)
| Aplikace | Kdy se odemkne | Obsah | Opora |
|---|---|---|---|
| Vzdálená konzole (BMC) ◇ | BMC hosta je zapojený a nastavený | obrazovka serveru, zapnout / vypnout, instalace ESX přes virtual media; štítek „mimo VCF scope – herní“ | `25 §10.1`, `§10.4.1`, `§10.6`; kap. 15 |
| Use case | hned | katalog use cases jako karty (nová fleet, nová instance, VVF, konvergence …), nemodelované s 🧩; vybraný ukáže pořadí kroků a prerekvizity | `25 §2.1–2.3`, `§4`; `20-deployment §4.2` kroky 3–4 |
| Knihovna | hned | odkazy na dokumentaci, které hráč viděl (1.6), glosář | – |
| Obchod (volitelně) | hned | stejný katalog jako inventář, ale široký: filtry, porovnání 3 položek (backlog #17) | `15-hardware` |
| Prohlížeč → ESX Host Client | host má ESX a IP | NTP, SSH služba, certifikát (kroky jako tlačítka), provoz admin → host HTTPS ve vizualizaci | `20-deployment §4.1.3–4.1.4`, `§7` řádek 3 |
| VCF Installer | appliance nasazená | průvodce `Deploy a new VCF fleet` (2.7 / backlog), login `admin@local` | `20-deployment §4.1.5`, `§4.2` |
| VCF Operations | po bring-upu | později (`30-fleet-management`) | – |

Zamčená aplikace: ikona s 🔒 a **důvodem z modelu / specu** („Nejdřív nasaď VCF Installer appliance –
`20-deployment §4.1.5`“). Aplikace, kterou hra ještě nemá: 🧩 „Zatím ve hře není“.

### 11.6 Přístupnost a výkon
- Celý počítač je DOM (formuláře, text, dlaždice = `button` s `aria-describedby` pro stav). Fokus po otevření
  na první aplikaci v docku, po zavření zpět na objekt počítače v místnosti.
- Pixi místnost je pod počítačem skrytá (`visible = false`), takže počítač neubírá FPS.

---

## 12. Vizualizace provozu v2

### 12.1 Principy
1. **Dráty decentně, provoz výrazně.** V místnosti může být desítky kabelů. Kabely jsou tenké a neutrální,
   informaci nesou **barevné tečky** letící mezi zařízeními.
2. **Jen toky ze specu.** Každý typ teček odpovídá toku z tabulek „Síťový provoz“ (`10-planning §7`,
   `20-deployment §7`, `25 §7`). Tooltip toku vždy ukazuje odkaz na řádek tabulky. Objemy a rychlosti teček jsou
   `ilustrativní model`.
3. **Barva nikdy sama.** Tvar tečky + legenda + tooltip.

### 12.2 V místnosti
- **Kabely jako svazky**: kabely mezi stejnou dvojicí (rack ↔ stojan / rack) vedou společnou trasou přes **žlab
  pod stropem** (žluté žlaby už v místnosti jsou) jako jeden svazek. Tloušťka svazku roste s počtem kabelů
  (log škála, max 6 px), na svazku malý odznak počtu (`×8`) při zoomu ≥ 1. Dnešní „fontány“ kabelů z racku
  (screenshot `ux2-room-demo.png`) tím zmizí. Obrys svazku ≥ 3:1 (OUTLINE), výplň neutrální.
- Hover na svazek = rozvine se na jednotlivé kabely (jen ten svazek) a tooltip vypíše zapojení.
- **Tečky** letí po trase svazku od zařízení k zařízení (agregace na dvojici zařízení × typ provozu). Rychlost
  a hustota = ilustrativní objem. Tečka má tmavý obrys (kontrast na světlé podlaze, 4.5).
- **„Síť firmy“** (uplink panel na stěně) je cílem toků do gateway / DNS / NTP / internetu (herní abstrakce,
  10.2). Tečky k němu letí po uplinku switche.

### 12.3 Co poběží jako první (pořadí podle specu)
| Moment | Tok (co hráč uvidí) | Opora |
|---|---|---|
| **První síť VCF = ESX management (vmk0)** | vše níže jede po vmk0 → vSwitch0 → vmnic0 → port switche | `25 §10.2.2`, `§3.5`, `§6.3` |
| Host po instalaci ESX, bez statické IP | tečky Management host → síť firmy (DHCP) – „host si říká o adresu“ | `25 §6.3` (výchozí DHCP), `§7` N1 |
| DCUI „Test Management Network“ | krátká vlna: host → gateway, DNS (ping, resolve) | `25 §6.3` [U34], `§7` N2 |
| Admin u počítače otevře Host Client | počítač → host, HTTPS | `20-deployment §7` řádek 3 |
| NTP na hostu | host → síť firmy (NTP) | `20-deployment §4.1.3`, `§7` řádek 7 |
| VCF Installer validace | installer → hosty (ping, kontrola obsazené IP), → DNS; vmkping vMotion / vSAN / TEP mezi hosty | `20-deployment §7` řádky 5, 6; `25 §7` N3–N6 |
| Po bring-upu | vCenter ↔ hosty (443 / 902), heartbeats, vMotion, vSAN, overlay … | `20-deployment §7` řádky 18–20, `10-planning §7` |
| **BMC (mimo VCF)** | žádný provoz VCF. Jen během vzdálené instalace ESX šedá čárkovaná „herní“ animace přenosu ISO po kabelu BMC (kap. 15.4), v legendě ve skupině „Mimo VCF (herní)“ | `25 §10.1`, `§10.4.1` |

Před bring-upem jde management provoz přes **jednu** pNIC na vSwitch0 (`vmnic0`), ostatní NIC jsou bez provozu
(`25 §3.5`, `§7` „Fyzicky“). Vizualizace to musí respektovat: v detailu hosta svítí jen vmnic0.

### 12.4 Detail hosta – karty vmnic (inspirace vizualizérem, vlastní provedení)
Otevírá se z racku (9.6). Pixi pohled + DOM tabulka jako alternativa.
```
┌ esx-02 · síť hosta ────────────────────────────────────── stav: ● ESX online · před bring-upem ─┐
│ PROVOZ (VMkernel)                                                                                │
│ ┌ ◆ Management ─┐ ┌ ▲ vMotion ──┐ ┌ ■ vSAN ─────┐ ┌ ⬟ Host TEP ─┐                              │
│ │ vmk0          │ │ nenastaveno │ │ nenastaveno │ │ nenastaveno │   (šedé = zatím neexistuje)   │
│ │ 10.0.10.12/24 │ │             │ │             │ │             │                              │
│ │ VLAN 10       │                                                                                │
│ │ MTU 1500      │                                                                                │
│ └───────┬───────┘                                                                                │
│ ════════╪═══════ vSwitch0 (Standard) · MTU 1500 · uplink: 1 ══════════════════════════════════  │
│  ┌──────┴───────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                            │
│  │ vmnic0  ●up  │ │ vmnic1  ●up  │ │ vmnic2  ○    │ │ vmnic3  ○    │                            │
│  │ 25 GbE       │ │ 25 GbE       │ │ 25 GbE       │ │ 25 GbE       │                            │
│  │ ▓▓░░░░  3 %  │ │ nevyužito    │ │ bez kabelu   │ │ bez kabelu   │                            │
│  │ → sw-A p1    │ │ → sw-B p1    │ │              │ │              │                            │
│  │ port: MTU 1500 trunk          │ │              │ │              │                            │
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘                            │
│ ⓘ Před VCF Installerem: vmk0 na vSwitch0 s právě jedním uplinkem, ostatní NIC „unclaimed“ (25 §3.5) │
│ [Tabulka] [Konfigurovat síť] [Otevřít port switche]                             ilustrativní model │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```
- Tři pásy shora dolů: **typy provozu (VMkernel)** → **virtuální switch** (vSwitch0 před bring-upem, VDS po něm,
  `25 §7`) → **fyzické NIC (vmnic)** → (dole) **port switche**. Tečky letí z boxu typu provozu přes pás switche
  do vmnic, kterou daný provoz používá, a ven. Mapování provoz → vmnic je z konfigurace modelu (teaming), ne
  vymyšlené.
- **Karta vmnic**: název, stav linku (tvar + barva), rychlost (z HW katalogu, `15-hardware`), vytížení jako pruh
  (% = `ilustrativní model`, žlutá > 80 %, červená > 95 %, GRAPHICS), kam je zapojená, MTU a režim **portu
  switche** (konfigurace hry, L2).
- **MTU jako řetěz**: MTU se ukazuje tam, kde ho spec definuje – VMkernel (`25 §6.3`), virtuální switch (VSS max.
  9000, VDS max. 9190, `25 §6.3`), port fyzického switche (`10-planning §3.3`). Když článek řetězu nestačí,
  řetěz se zvýrazní na tom místě (`⛔`/`⚠` + hláška 3.2). Inspirace měla MTU a „queues“ na každé kartě; fronty
  ve specu nejsou, proto je **nezobrazujeme**.
- Nenastavené typy provozu jsou šedé boxy „nenastaveno“ (vysvětlí, co přijde: „vMotion nastaví VCF Installer“ –
  jen pokud to spec říká, jinak bez textu).
- „Tabulka“ = DOM tabulka téhož (přístupnost, kopírování hodnot).

### 12.5 Tečky – tvary a legenda
- Tvar podle typu (čitelné i pro barvoslepé a v šedi): Management `◆`, vMotion `▲`, vSAN `■`, NFS `●`,
  NSX overlay `⬟` (pětiúhelník), VM `○` (prázdný kruh); mimo VCF (herní, BMC) `✚` šedý, jen v legendě „Mimo VCF (herní)“. Velikost 5–7 px + obrys.
  Jedna sdílená textura (atlas 7 tvarů), tint barvou.
- **Legenda v2**: místo velkého panelu vlevo nahoře (dnes ~350×290 px přes scénu) **čip vlevo dole** „Provoz ▾“,
  který ukazuje jen **právě aktivní** typy (tvar + barva + název). Klik = rozbalí plnou legendu (typy, vytížení,
  zahozené pakety, štítek ilustrativní). Klik na typ = **filtr** (zobrazit jen tento provoz, ostatní tečky 15 %
  alpha). Hover na typ = zvýrazní jeho toky. Při prvním provozu se legenda jednou sama rozbalí (3.3), pak sbalí.
- Klávesa `L` = rozbalit / sbalit, `Shift+L` + číslo = filtr (volitelně).
- Tooltip toku (hover na tečky / svazek): `odkud → kam · typ · síť / VLAN · protokol (jen když ho spec uvádí) ·
  „spec 25 §7 N2“ · objem ilustrativní`.

### 12.6 Škálování (mnoho hostů) a LOD
| Situace | Řešení |
|---|---|
| Hodně kabelů | svazky (12.2); v racku lanes (9.4) |
| Hodně teček | globální rozpočet **≈ 200 teček** (sdílený s packetSim). Emise každého toku se škáluje dolů, každý aktivní tok má ale min. 1 tečku / 2 s, aby žádný „nezmizel“ |
| Oddálená kamera (scale < 0,6) | agregace na **rack ↔ switch / síť firmy** (jeden proud na typ), tečky o 30 % větší, bez odznaků |
| Přiblížená (scale ≥ 1,2) | agregace na **zařízení ↔ zařízení**; kabely ve svazku při hoveru |
| Rack pohled | nejpodrobnější: konkrétní kabel (vmnic → port) |
| > 32 hostů nebo FPS < 50 po 2 s | automaticky „úsporný režim“: místo teček animovaná čárkovaná linka (posun texture offsetu, 1 Graphics na svazek) + hláška v ⚙ |
| Mimo obraz | culling – tečky mimo viewport se nesimulují vizuálně (jen čas) |
| Reduced motion | statické pruhy hustoty (3.4) |

### 12.7 Výkon (shrnutí)
- Tečky = pool spritů v `ParticleContainer` (jen pozice, tint, alpha). Žádné filtry, glow jen předpečený v textuře.
- Trasy (bezier / ortogonální) se vzorkují jednou při změně zapojení (`sampleBezier`, už existuje).
- Měření: debug overlay FPS + počet teček; test na 1366×768, 16 hostů, 2 switche, 200 teček → 60 FPS.

---

## 13. Review současné místnosti (2026-11-21, `#/sandbox/mistnost/ukazka`)

Screenshot 1366×768: `/tmp/claude-1000/-workspaces-vcf-game/79a2ed2c-cd7f-4ffa-b10c-8ab22e1fbc99/scratchpad/ux2-room-demo.png`.

| Obrazovka | Problém / příležitost | Návrh | Priorita |
|---|---|---|---|
| Místnost | Rack nemá žádnou „interaktivní“ nápovědu (kurzor, obrys, tooltip). Klik na rack bez vybrané položky jen pošle panáčka. | Hover obrys + kurzor lupa + tooltip, klik = pohled racku (7.2, 9) | vysoká |
| Místnost | Kabely z racku ke stojanu tvoří vysoký „vodotrysk“ 8 oblouků. Už s 1 switchem je scéna rušná, s 10 hosty bude nečitelná. | Svazky přes stropní žlab, detail až v racku (12.2) | vysoká |
| Místnost | Legenda provozu (~350×290 px) trvale zakrývá levou část scény, i když žádný provoz neběží (bez ukázky). | Čip „Provoz ▾“ vlevo dole s aktivními typy (12.5); místo vlevo nahoře pro tracker | vysoká |
| HUD | Čip „1. Fyzická stavba → postav rack“ je statický text (v ukázce s postaveným rackem pořád radí postavit rack). | Napojit na tracker (8): čip = „Další krok“ ze stavu | vysoká |
| Místnost | Plakát na pravé stěně je dekorace bez funkce; chybí stůl s počítačem. | Plakát nahradit tabulí (10.1), stůl k levé stěně u dveří (11.1) | střední |
| HUD | Přepínač „Ukázka (ilustrativní)“ je v HUDu stejně výrazný jako herní ovládání. | Přesunout do ⚙ / dev menu, v HUDu nechat jen pro `?debug` | nízká |
| Místnost | Toast dole uprostřed je `role="status"` s `aria-live` – dobré. Text „Klikni na podlahu – panáček tam dojde“ ale neříká, co dělat **dál**. | Po zavedení trackeru toast jen pro výsledky akcí, vedení přebírá tracker | střední |
| Inventář | Karta „Rack (prázdný)“ je čitelná, kategorie jsou `role="tab"` s klávesami 1–6 – dobré. | Zachovat; v pohledu racku inventář nahradit lištou Kabely (9.1) | – (pozitivní) |

---

## 14. Backlog v3 (prioritizovaný, MVP pořadí)

Legenda: **UI** = ui-dev, **EN** = engine-dev, **MO** = domain-modeler, **SD** = scenario-designer, **RES** =
doc-researcher. Velikost S / M / L. Nahrazuje / zpřesňuje položky #6, #8, #9 z kapitoly 5. Ostatní položky
kapitoly 5 platí dál.

### MVP-A „Vím, co dělat, a umím zapojit“ (nejvyšší priorita)
| # | Položka | Kdo | Vel. | Závisí na |
|---|---|---|---|---|
| A1 | **View stack + přechody** (7.1–7.2): režimy Místnost / Rack / Tabule / PC, hash routy, `Esc`/Zpět, uložená kamera, hover obrys + lupa + tooltip u interaktivních objektů, reduced motion, skrytí místnosti při celoobrazovkovém pohledu | UI | M | – |
| A2 | **Objective tracker** (8): schéma + registr selektorů nad snapshotem + `evaluateObjectives` (čistá funkce, testy) | EN | M | room state v engine (#2 z kap. 5) |
| A3 | Tracker UI (8.2–8.5): 3 stavy, Ukaž mi, Proč?, Přeskočit + undo, `T`/`Shift+T`, HUD čip, aria-live; ⚙ dva přepínače (tracker / bubliny) | UI | M | A2 |
| A4 | Obsah úkolů skupin A–C v JSON s `SpecRef` (8.7), T1–T7 jako první úkoly; BMC jako `game-optional` (kap. 15) | SD | S | A2 |
| A5 | **Rack pohled** (9.1–9.3): elevace se zkomprimovanými prázdnými U, server / switch s porty a LED, kabeláž drag + click-click, popover kabelu, odpojit / přepojit, Zapojit doporučeně | UI | L | A1 |
| A6 | Auto-trasa kabelů v racku (`rackRoute.ts`, lanes, čistá funkce + testy) | UI | M | A5 |
| A7 | DOM vrstva cílů portů + seznam zapojení (9.7) | UI | M | A5 |
| A8 | Model portů v engine: NIC porty z HW konfigurace (`15-hardware` B), porty switche, uplink port, BMC port (vlastní IP, napájení nezávislé na hostu, žádná VCF pravidla, `25 §10.2.1`); příkazy `connect / disconnect / recolor / label` | EN + MO | M | – |
| A9 | Topologické validace kabeláže jako odznaky + Problémy (REQD-TOR-001, RCMD-TOR-001, REQD-LAG-001; 9.5) | MO + UI | S | A8 |

### MVP-B „Vidím, co se děje“
| # | Položka | Kdo | Vel. | Závisí na |
|---|---|---|---|---|
| B1 | Kabely v místnosti jako **svazky** přes stropní žlab + rozvinutí při hoveru (12.2) | UI | M | A8 |
| B2 | **Toky provozu ze stavu** (12.3): DHCP / Test Management Network / NTP / admin HTTPS; „Síť firmy“ jako objekt na stěně; agregace na dvojice zařízení × typ | EN + UI | M | A8, ESX/DCUI (#7 z kap. 5) |
| B3 | Tvary teček (atlas), legenda v2 jako čip s aktivními typy + filtr (12.5) | UI | S | – |
| B4 | **Detail hosta – karty vmnic** (12.4): pásy VMkernel / vSwitch / vmnic / port, tečky, MTU řetěz, DOM tabulka | UI | L | A5, B2 |
| B5 | LOD a rozpočet teček, úsporný režim, culling (12.6) | UI | M | B2 |

### MVP-C „Pracovna a tabule“
| # | Položka | Kdo | Vel. | Závisí na |
|---|---|---|---|---|
| C1 | **Počítač**: objekt na stole, přechod, plocha s dockem (11.1–11.2) | UI | M | A1 |
| C2 | PC aplikace **Návrh VCF** – mřížka dlaždic + detail se sdílenými `OptionCard` / `WhyExpander` / `Message`; sdílený stav s pravým panelem přes `SandboxSession` (11.3–11.4) | UI (+ EN napojení session) | L | Návrh v2 (#11 z kap. 5) |
| C3 | PC aplikace **Use case** (karty z `25 §2.1`, 🧩 pro nemodelované) | UI + MO | M | C1 |
| C4 | **Tabule – auto HLD**, vrstva Fyzicky: `hld/layout.ts` (deterministický, testy) + ručně kreslený render s jitterem, miniatura v místnosti, Popis (a11y) (10.1–10.3, 10.6) | UI | L | A1 |
| C5 | **Tabule – kreslení hráče**: fix, barvy, tloušťka, text, houba, undo/redo, smazat moje, uložení do save (10.4–10.5) | UI + EN (save) | M | C4, ukládání (#24 z kap. 5) |
| C6 | Tabule – stránky Síť a Logicky | UI | M | C4, data sítí / návrhu |

### Později
| # | Položka | Kdo | Vel. |
|---|---|---|---|
| D1 | Konfigurace portu switche (trunk / VLAN / MTU) + MTU řetěz s hláškami installeru (`25 §5.4`) | MO + EN + UI | M |
| D2 | PC: Prohlížeč → Host Client (NTP, certifikát), VCF Installer jako aplikace | UI + EN | L |
| D3 | **BMC krok** (kap. 15): BMC IP, vzdálená konzole, virtual media instalace ESX s varováním a fallbackem, past vSwitchBMC; tooltip vendorů BMC z `25 §10.2.1` | EN + UI | M |
| D4 | PC: Obchod s porovnáním; Uložit tabuli jako PNG | UI | S |
| D5 | Kariéra: tracker s body (stejná komponenta, bez Přeskočit) | SD + UI | M |

**Doporučené pořadí pro první sprint**: A1 → A8 → A2 → A3 + A4 → A5 → A6 → A7 → A9 → B1 → B3. Tím vznikne
hratelná smyčka „úkol → otevřu rack → zapojím → úkol hotový → kabely v místnosti čisté“. B2/B4 navazují hned po
instalaci ESX (#7 z kap. 5).

---

## 15. BMC (mimo VCF scope) a ESX management (vmk0) – dva kroky fáze Hosty

Podklad: `25-usecases-and-physical §10` (OOB management) a `§3.5`, `§6.3`, `§7` (výchozí síť ESX).

### 15.1 Terminologie v UI (závazné)
Ve VCF 9.1 má „out-of-band“ dva různé významy (`25 §10` úvod):
1. **OOB management** = vzdálená správa hardwaru přes BMC (iDRAC, iLO, XCC, Cisco IMC). Ve VCF design mimo scope.
2. **Out-of-band (OOB) operations** = změny provedené přímo ve vCenteru nebo NSX Manageru mimo workflow SDDC
   Manageru (config drift) [U82]. Patří do provozu (`90-operations`, později).

Pravidla:
- V UI **nikdy holé „OOB“**. Pro hardware vždy **„BMC (vzdálená správa serveru)“**, případně „síť pro BMC“.
  Pro drift vždy **„Změny mimo SDDC Manager (out-of-band operations)“**.
- Glosář (1.4) má dvě oddělená hesla s křížovým odkazem „Nezaměňovat s …“.
- Identifikátory v kódu: `bmc*` pro hardware, `configDrift*` / `outOfBandOperation*` pro drift. Nikdy `oob*`.
- Štítek kroku BMC: **`mimo VCF scope – herní`** (nový štítek v systému 3.2, fialově-šedý jako omezení hry,
  ikona `◇`). Tooltip: „Dokumentace VCF považuje síť pro BMC za mimo svůj rozsah. Ve hře je to volitelný krok
  z reálné serverovny, který nic neblokuje.“ + Proč? (citace „switches utilized for out-of-band connectivity
  to the ESX host are out of scope“, `25 §10.1` [U55]).

### 15.2 Tok (fáze Hosty)
```
 Kabeláž ──► [◇ krok 1: BMC – volitelný, mimo VCF scope – herní] ──► krok 2: ESX management (vmk0) ──► NTP, certifikát …
                 │  zapojit BMC port, BMC IP + účet                     │  instalace ESX (u serveru NEBO přes BMC)
                 │  vzdálená konzole, zapnout/vypnout host              │  DCUI: VLAN, statická IPv4, DNS, FQDN
                 └► umožní „vzdálenou“ instalaci ESX (virtual media)    └► vmk0 na vSwitch0 + vmnic0 → MANAGEMENT PROVOZ
```
- **Krok 1 (BMC) je volitelný.** Přeskočení nemá žádný důsledek ve validacích VCF ani v trackeru (druh
  `game-optional`, 8.3). Bez BMC se ESX instaluje „u serveru“ (avatar dojde k racku = fyzické médium).
- **Krok 2 (ESX management) je první dokumentovaná síť VCF** (`25 §10.2.2`): vmk0, VLAN nastavená v DCUI,
  vmk0 na vSwitch0 s jedním uplinkem vmnic0 (`25 §3.5`, `§6.3`). Až tady se rozběhne management provoz (12.3).
- BMC nenese **žádný** provoz VCF a nikdy se nezobrazí jako management síť.

### 15.3 Krok 1 – BMC (UI)
**Zapojení**: BMC port na serveru (9.2) do libovolného portu switche. Hra nic nevaliduje, protože VCF kabeláž
BMC nepopisuje (`25 §10.1`, `§10.2.3`). LED BMC svítí, i když je host vypnutý („The BMC is powered-on even when the
host itself is powered-off“, `25 §10.2.1` [U74]) – na serveru je to malá LED zvlášť od LED stavu hosta.

**Nastavení BMC** (popover na BMC portu nebo záložka „BMC“ v panelu hosta):
```
┌ esx-01 · BMC (vzdálená správa serveru)  ◇ mimo VCF scope – herní ┐
│ Typ BMC        iDRAC (Dell)                ⓘ 25 §10.2.1          │
│ IP BMC         10.0.99.11   herní výchozí  ≠ IP hosta ⓘ          │
│ Účet           admin / ••••  herní                                │
│ [Otevřít vzdálenou konzoli]  [Zapnout host] [Vypnout host]        │
└───────────────────────────────────────────────────────────────────┘
```
- Typ BMC podle vendora jen z tabulky `25 §10.2.1` (Dell iDRAC, HPE iLO, Lenovo XCC, Cisco IMC). **Supermicro**:
  dokumentace BMC neuvádí → zobrazit jen „BMC“ bez názvu.
- IP BMC je **jiná** než IP hosta (`25 §10.2.1` [U74]). Hodnota je `herní výchozí`. Hra neříká, zda má být ve
  stejné VLAN jako vmk0, protože to VCF neurčuje (`25 §10.2.3`).
- **Vzdálená konzole** = okno v počítači (aplikace „Vzdálená konzole“, 11.5) s obrazovkou serveru. Odtud jde
  host zapnout / vypnout a instalovat ESX.

**Instalace ESX – volba cesty** (panel hosta → Instalovat ESX):
```
Jak nainstalovat ESX 9?
 (•) U serveru – fyzické médium               (vždy dostupné)
 ( ) Vzdáleně přes BMC – virtual media  ◇ mimo VCF scope – herní
     ⓘ Vzdálenou instalaci popisuje dokumentace vSphere (25 §10.4.1).
     ⚠ „the virtual CD might encounter corruption problems with systems or networks operating at peak capacity“
       → při selhání dokonči instalaci z fyzického média.
```
- Vzdálená cesta je **aktivní jen tehdy**, když je BMC zapojený a nastavený **a** typ BMC je v tabulce podporovaných
  aplikací pro vzdálenou instalaci (`25 §10.6`: Dell DRAC, HPE iLO, Lenovo XCC). Cisco IMC a Supermicro v tabulce
  nejsou → volba je šedá s důvodem „Dokumentace pro tento BMC vzdálenou instalaci ESX neuvádí (25 §10.6)“.
  Minimální firmware z tabulky hra zatím nemodeluje (🧩).
- Kroky instalace jsou v obou cestách **stejné** (`20-deployment §4.1.1`). Rozdíl je jen v tom, kde je hráč:
  u racku (avatar) nebo u počítače (konzole). Pořadí „BMC → virtual media → instalace → DCUI“ dokumentace jako
  postup VCF nepopisuje (`25 §10.4.1`), proto má štítek `herní zjednodušení`.
- **Poškození virtual CD**: v Sandboxu se **nesimuluje náhodně** (laboratoř bez náhody). Ukáže se jen jako varování
  výše. V Kariéře může být incidentem mise (scenario-designer), vždy s podmínkou ze specu (systém / síť na
  špičce) a řešením „dokonči z fyzického média“.

### 15.4 Vizualizace
- Kabel BMC je neutrální jako ostatní. **Žádné tečky v barvách provozu VCF.**
- Během vzdálené instalace jede po kabelu BMC šedá čárkovaná animace se symbolem `✚` „přenos ISO (herní)“.
  V legendě je ve zvláštní skupině **„Mimo VCF (herní)“**, oddělené od typů provozu VCF.
- V detailu hosta (12.4) BMC **není** mezi kartami vmnic. Pod nimi je jen řádek „BMC: zapojeno do sw-A p9 ·
  vlastní IP · mimo VCF scope – herní“. BMC není vmnic a ESX ho jako síťovou kartu hosta nevidí.
- Tabule (10.2): BMC jen na stránce **Fyzicky** jako čárkovaný šedý blok „BMC (mimo VCF)“. Na stránce **Síť**,
  kde jsou sítě VCF, BMC není.

### 15.5 Past z dokumentace (později, k ověření)
- KB [U78][U79]: zapnuté USB-NIC rozhraní mezi OS a BMC způsobí, že ESX vytvoří `vSwitchBMC` s uplinkem `vusb0`.
  KB uvádí, že to „might cause the VMware Cloud Foundation Bring-Up process to fail“. Jde o **VCF důsledek** (bring-up),
  takže by šel ukázat jako varování validace s řešením „vypnout USB rozhraní v BMC před instalací“. KB ale uvádí
  vSphere 8.0 / 8.0.3. Pro 9.1 **neověřeno**: před implementací rozhodne fact-checker, do té doby se nezobrazuje.

### 15.6 Tracker, klávesnice, přístupnost
- Úkol „◇ Zapoj a nastav BMC“ (8.7, skupina B) je `game-optional`. Nezvyšuje `n/N`, má tlačítko Přeskočit a po
  přeskočení se už znovu nenabízí.
- Úkol „ESX management (vmk0)“ (skupina C) je první `doc-required` úkol sítě. Jeho splnění spustí moment
  „První host online“ (3.3).
- BMC popover i volba cesty instalace jsou DOM formuláře (fokus, popisky, `aria-describedby` pro štítek mimo
  scope). Vzdálená konzole má textovou alternativu (stav instalace jako text).
