# UX návrh – VCF Game (Sandbox v2)

Stav: návrh 2026-11-21 (ux-designer). Implementují `ui-dev` (render/UI) a `engine-dev` (příkazy, validace, snapshot).
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
- `Day 2` – podle dokumentace až po nasazení.

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
