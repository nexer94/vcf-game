# 15 – Hardware: servery, ReadyNode profily a herní katalog

> Modelovaná verze: **VCF 9.1.1** (viz `docs/spec/VERSION.md`). Rozdíly proti 9.0 jsou označeny **[9.0]** / **[9.1]**.
> Stav k 2026-11-21. Odkazy `[Hn]` vedou do sekce 9.
>
> **Překryv s jinými speci:** obecné HW požadavky na ESX hosty pro VCF (homogenita, CPU/RAM pro vSAN ESA, boot,
> ESA/OSA disky, NIC a rychlosti, minimální počty hostů) jsou v `10-planning.md` (3.3, 3.4, 6.1, 6.2). Tady se
> neopakují, jen se na ně odkazuje (`10-planning` §x). Tento spec přidává: **ReadyNode profily** z Broadcom
> Compatibility Guide (BCG), pravidla změn v ReadyNode, ESX boot požadavky 9.1, chybové stavy HCL validace,
> **reprezentativní certifikované modely** 5 vendorů a **návrh herního katalogu**.

## 0. Stav ověření zdrojů (DŮLEŽITÉ – čti jako první)

**Broadcom Compatibility Guide (compatibilityguide.broadcom.com) je JavaScriptová aplikace.** Přímé čtení
(WebFetch) všech jejích stránek – search (`program=vsanesa|server|io|vsanosa`), detail (`detail?productId=…`) i
statické stránky `pages/vsan-esa-readynode-hardware-guidance` – vrátilo jen hlavičku a patičku, **bez dat**.
Zkoušené alternativy:

| Pokus | Výsledek |
|---|---|
| `https://compatibilityguide.broadcom.com/search?program=vsanesa&persona=live&column=vendor&order=asc` | jen kostra stránky (JS) |
| `https://compatibilityguide.broadcom.com/detail?…productId=63908&program=vsanesa…` (Dell R470) | jen kostra stránky (JS) |
| `https://compatibilityguide.broadcom.com/pages/vsan-esa-readynode-hardware-guidance` | jen kostra stránky (JS) |
| Starý PDF export `partnerweb.vmware.com/comp_guide2/pdf/vi_vsanesa_guide.pdf` | 301 → BCG search (JS) |
| `vcg-prod-vip-1.broadcom.com/comp_guide2/pdf/vi_vsanesa_guide.pdf` | `ECONNRESET` (2×) |
| `vvs.broadcom.com/service/vsan/all.json` (vSAN HCL DB, na kterou odkazuje KB) | agent ho nestáhl (> 10 MB); **orchestrátor ho stáhl mimo agenta** – viz níže a [H22] |
| BCG „viewResults“ API (POST, neoficiální) | nástroj umí jen GET – nezkoušeno |

**Oficiální datový export BCG (vSAN HCL)** [H22]: `https://vvs.broadcom.com/service/vsan/all.json`,
`jsonUpdatedTime` „November 17, 2026, 8:59 AM UTC“, 9483 položek, kategorie **controller / hdd / ssd / nic**.
Každá položka má `vcglink` na detail v compatibilityguide.broadcom.com. Export **neobsahuje ReadyNode ani servery**,
jen komponenty. Orchestrátor z něj vytáhl CSV: disky s podporou ESXi 9.1 u partnerů Dell / HPE / Lenovo / Cisco a
NIC s podporou ESXi 9.1. NIC v exportu mají `vcglink` do programu **`rdmanic`** (vSAN over RDMA), tj. jde o
vSAN/RDMA certifikaci NIC, ne o obecný seznam I/O Devices (`program=io`), který v exportu není.

Proto se v tomto specu používají čtyři úrovně důvěry. **Model a engine smí jako pravidla použít jen [T]; jako
katalog dílů [T] a [BCG-data].**

| Značka | Význam |
|---|---|
| **[T]** | Ověřeno přímým čtením stránky techdocs.broadcom.com nebo knowledge.broadcom.com. |
| **[BCG-data]** | Ověřeno z oficiálního datového exportu BCG [H22] (stav 17. 11. 2026); u položky je uveden její `vcglink` (productId). Atributy jen ty, které export obsahuje (partner, model, kapacita, typ zařízení, typ flash, vSAN režimy vč. „vSAN ESA“, OSA tiery pro 9.1). |
| **[BCG-idx]** | Obsah stránky BCG, ale **jen z indexu vyhledávače** (WebSearch vrátil text BCG stránky; přímý fetch nešel). Odkaz vede na konkrétní BCG stránku. Hodnoty jsou konzistentní napříč několika dotazy, ale **nejsou ověřené přímým čtením** → před použitím jako fakt nutné potvrdit (sekce 8). |
| **[SIMPL]** | Herní zjednodušení / herní hodnota (sekce „Návrh herního katalogu“). Není to fakt z dokumentace. |

## 1. Shrnutí

Pro VCF 9.1 musí být server a BIOS v BCG **„certified for VCF 9.1“**, NIC a HBA ověřené v BCG I/O Devices; pro
vSAN ESA se „strongly recommended“ používají **vSAN ESA ReadyNodes**, u OSA lze bez ReadyNode ověřit I/O
controller, HDD a SSD jednotlivě [H1][T] (viz též `10-planning` §3.4). ReadyNode je certifikovaná kombinace
serveru (CPU generace) a certifikovaných komponent (NVMe, NIC) zařazená do **profilu**. Profil definuje minima
(jádra, RAM, kapacita, počet disků, síť) [H2][BCG-idx].

**[9.1]** Design Library 9.1 používá nová jména profilů **vSAN-HCI-SM** (HCI) a **vSAN-SC-SM** (vSAN Storage
Cluster) jako „smallest vSAN Ready node“ [H4][H5][T]. **[9.0]** Starší jména profilů ESA byla `vSAN-ESA-AF-0`,
`-AF-2`, `-AF-4`, `-AF-6`, `-AF-8` a `AF-HighDensity` – stále je uvádí KB 326717 [H6][T]. Hardware guidance v BCG
uvádí pro HCI profily **vSAN-HCI-SM / -MED / -LRG** a pro storage clustery **vSAN-SC-SM / -MED / -LRG** [H2][BCG-idx].

Pro hru je spec podkladem pro **obchod se servery v Sandboxu / Kariéře**: hráč vybírá vendora (Dell, HPE, Lenovo,
Cisco, Supermicro) a konfiguraci (CPU jádra, RAM, NVMe disky, NIC) a model validuje, zda je host použitelný pro
vSAN ESA, vSAN OSA nebo jen s externím úložištěm (NFS / FC).

## 2. Komponenty a vztahy

### 2.1 Programy (kategorie) v BCG relevantní pro VCF hosty

| Program | URL (z KB) | K čemu | Zdroj |
|---|---|---|---|
| Systems / Servers (`program=server`) | https://compatibilityguide.broadcom.com/search?program=server&persona=live&column=partnerName&order=asc | server + CPU + BIOS, „certified for VCF 9.1“ | [H1][H7][T] |
| I/O Devices (`program=io`) | https://compatibilityguide.broadcom.com/search?program=io&persona=live | NIC, HBA (min. firmware, odkaz na driver) | [H1][H8][T] |
| vSAN ESA ReadyNodes (`program=vsanesa`) | https://compatibilityguide.broadcom.com/search?program=vsanesa&persona=live&column=vendor&order=asc | ReadyNode pro ESA | [H1][T] |
| vSAN ESA ReadyNode Hardware Guidance | https://compatibilityguide.broadcom.com/pages/vsan-esa-readynode-hardware-guidance | definice profilů | [H1][H3][T] (odkaz), obsah [BCG-idx] |
| vSAN I/O controller (`program=vsanio`) | https://compatibilityguide.broadcom.com/search?program=vsanio&persona=live&column=brandName&order=asc | OSA bez ReadyNode | [H1][T] |
| vSAN HDD (`program=hdd`) | https://compatibilityguide.broadcom.com/search?program=hdd&persona=live&column=partnerName&order=asc | OSA bez ReadyNode | [H1][T] |
| vSAN SSD (`program=ssd`) | https://compatibilityguide.broadcom.com/search?program=ssd&persona=live&column=partnerName&order=asc | OSA bez ReadyNode | [H1][T] |

### 2.2 Struktura záznamu ReadyNode (co BCG eviduje)
Podle indexovaného detailu Dell PowerEdge R470 [H9][BCG-idx]: vendor a model, **ReadyNode profily** (víc profilů
na jeden model), **CPU generace** (rodina, max. počet socketů, max. jader na socket), max. paměť, **Supported
Releases** (např. „ESXi 9.1 (vSAN 9.1)“), seznam certifikovaných **NVMe disků** (s endurance třídou DWPD) a max.
počet disků, certifikované **NIC**, **boot zařízení** a poznámky (např. PCIe switch / direct-connect).
KB 427591 ukazuje pole záznamu: Component: Server, ReadyNode Profile: vSAN-HCI-SM, CPU Series, Storage: vSAN ESA,
Supported Releases [H10][T].

### 2.3 Vztahy
- Host ve VCF clusteru → certifikovaný server (`program=server`) pro cílovou verzi ESX [H1][T].
- vSAN ESA host → ReadyNode (`program=vsanesa`) → profil → certifikované NVMe, CPU, NIC [H1][T]; „Certified
  components: NVMe devices, CPU, NICs“ [H2][BCG-idx].
- vSAN OSA host → ReadyNode (`program=vsanosa`) **nebo** ověření controller + HDD/SSD jednotlivě [H1][T].
- Host s externím principal storage (NFS v3 / VMFS na FC, `10-planning` §3.5) → server + I/O devices (NIC, HBA)
  [H1][T]. FC HBA kompatibilitu s úložištěm řeší „storage vendor“ (`10-planning` §3.5).
- VCF Installer při bring-upu validuje hosty proti **vSAN HCL databázi** (`all.json`) [H10][H11][T].

## 3. Prerekvizity

### 3.1 ESX 9.1 – obecné HW minimum (vSphere 9.1) [H12][T]
- CPU: „requires a host with at least two CPU cores“; NX/XD bit zapnutý v BIOSu; Intel VT-x / AMD RVI zapnuté.
- RAM: minimum **8 GB**, „Provide at least 12 GB of RAM“ pro typické produkční použití.
- Síť: „One or more Gigabit or faster Ethernet controllers“, modely ověřit v BCG.
- Boot: min. **32 GB** persistentního úložiště (HDD, SSD, NVMe), nesdílené mezi hosty; pro nové servery
  doporučeno **≥ 128 GB**; endurance ≥ 128 TBW, ≥ 100 MB/s sekvenční zápis, RAID 1 pro odolnost.
- Boot mode: UEFI doporučeno, legacy BIOS omezeně; DPU bootují jen UEFI.
- **[9.1] Deprecated** („will be removed in the next major release“): USB a SD boot zařízení, ESX bez
  persistentního OSDATA zařízení, systémová zařízení < 32 GB.

Pozn.: VCF má přísnější doporučení než obecné ESX minimum – viz `10-planning` §3.4 (boot ≥ 128 GB high-endurance,
ESA ≥ 16 jader a ≥ 128 GB RAM) [H4][T].

### 3.2 vSAN – hardware (vSAN 9.1) [H13][T]
- Všechna capacity zařízení, drivery a firmware musí být certifikované a v sekci vSAN v BCG.
- **ESA**: „each storage pool needs at least one NVMe TLC device“ (cache i capacity). RAM ≥ **128 GB**, potřeba
  roste s počtem zařízení ve storage poolu (odkaz na ESA ReadyNode Hardware Guidance).
- **OSA**: disk group = 1 cache (SAS/SATA SSD nebo PCIe flash) + capacity (all-flash: SAS/SATA SSD nebo PCIe flash;
  hybrid: SAS/NL-SAS HDD). Hybrid cache ≥ 10 % očekávané spotřebované kapacity. Controller: SAS/SATA HBA nebo RAID
  controller v passthrough / RAID 0. RAM pro OSA podle vSAN Sizeru.
- Boot u vSAN hostů: ≤ 512 GB RAM → USB/SD/SATADOM (USB/SD ≥ 32 GB); > 512 GB RAM → SATADOM nebo disk ≥ 16 GB
  (SLC SATADOM); s vSAN nutné zvětšit coredump partition při bootu z USB/SD. (Pozor: v 9.1 je USB/SD boot
  deprecated [H12].)

### 3.3 vSAN ESA ReadyNode – pravidla změn (KB 326717) [H6][T]
- Měnit lze „CPU, Storage Device, Memory, NIC, Boot Device“.
- Disky: ≥ **1 DWPD**, performance **Class F** nebo vyšší, kapacita ≥ **1,6 TB**; make/model z ESA ReadyNode BOM.
  „SAS and SATA are not currently planned for vSAN ESA.“ Míchat 1 DWPD a 3 DWPD v clusteru se nedoporučuje.
  1 DWPD → 3 DWPD lze (celý cluster, fresh install), opačně ne. Disky jen v rámci stejného OEM.
- **[9.0 jména profilů]** 1 DWPD nepodporováno v `vSAN-ESA-AF-8`; od vSAN 8.0U1 podporováno v AF-0/2/4/6 a
  AF-HighDensity.
- Počty zařízení: „vSAN ESA ReadyNode Minimum # Device/Host: 1“, „vSAN SC ReadyNode Minimum # Device/Host: 2“,
  „vSAN ESA and vSAN SC Maximum # Device/Host: 24“.
- NIC: „No separate NIC certification“ – IOVP kvalifikované NIC; vSAN-certifikovaná RDMA NIC může nahradit běžnou;
  minimum **10GbE**.
- Boot zařízení Broadcom pro vSAN necertifikuje (odkaz na KB 85685).
- PMem pro ESA nepodporována.

### 3.4 vSAN OSA ReadyNode – pravidla změn (KB 326476) [H14][T]
- CPU: 2 sockety → 1 socket lze, „but the total core counts must remain the same“; platforma musí být ESXi certifikovaná.
- RAM: „Adding more memory than what is listed is supported“; nemíchat velikosti DIMM, stejná či vyšší frekvence.
- Disky: lze jiné make/model dle pravidel, přechod na vyšší profil; **nelze** nahradit HDD za SSD v capacity tieru
  ani míchat typy („You cannot mix and match“).
- NIC: „There is no separate NIC certification required for vSAN“ (IOVP).
- Boot: „We do not need to certify the boot device for vSAN“; doporučeny mirrored M.2 v RAID 1 na controlleru
  odděleném od vSAN controlleru.
- I/O controller: „needs to be specifically certified and listed for vSAN in vSAN HCL“.

### 3.5 VCF-specifická HW pravidla (odkazy do 10-planning, nová fakta jen z [H4])
- Homogenita, jeden vendor v počátečním management clusteru, pNIC stejné rychlosti/výrobce/modelu → `10-planning` §3.4.
- ESA: certifikované disky (VCF-VSAN-ESA-REQD-CFG-001), ≥ 1,6 TB a max. 24 disků/uzel (…-002), ≥ 16 jader
  (…-003), ≥ 128 GB RAM (…-004) – **všechno „for the smallest vSAN Ready node“, tj. vSAN-HCI-SM / vSAN-SC-SM** [H4][T].
- „Smaller memory footprint per node will limit number of vSAN drives per node.“ (…-004) [H5][T].
- NVMe za Tri-Mode controllerem nepodporováno (VCF-VSAN-REQD-CFG-005) [H4][T].
- Síť: „For vSAN ESA ready node, vSAN-HCI-SM profile, only supports 10GbE.“ „Larger vSAN ESA nodes require
  25GbE.“ (VCF-VSAN-NET-REQD-CFG-001) [H4][T]. 2 pNIC pro malé profily, 4 pNIC pro velké / IO intenzivní
  (VCF-VSAN-NET-RCMD-CFG-002/003); „100GbE networking might be required“ pro high IO [H5][T].
- Storage Cluster uzly: „Select the same minimum requirements for vSAN Storage cluster nodes as vSAN ESA HCI
  nodes.“ (VCF-VSAN-ESA-RCMD-CFG-005) [H4][T].
- Doporučen TPM (VCF-VSAN-RCMD-CFG-002) [H4][T].

## 4. Workflow – jak vybrat HW podle dokumentace

KB 452580 „How to Verify ESXi Host Compatibility for VCF 9.1“ [H1][T]:
1. **Server a BIOS** – BCG Server search (`program=server`): model a BIOS „certified for VCF 9.1“.
2. **NIC a HBA** – BCG I/O Devices (`program=io`). Na existujícím hostu zjistit HW přes
   `esxcli storage core adapter list` (HBA) a `esxcli network nic list` (NIC).
3. **vSAN**:
   - ESA: použít vSAN ESA ReadyNode (strongly recommended) – `program=vsanesa` + ESA ReadyNode Hardware Guidance.
   - OSA: ReadyNode, kde je to možné; jinak ověřit jednotlivě I/O controller (`vsanio`), HDD (`hdd`), SSD (`ssd`).
4. Firmware/driver verze ověřit podle KB 323110 / skriptu z KB 369320 (odkazy z [H1]).

Postup v BCG UI (KB 381824) [H7][T]: otevřít BCG → kategorie **„Systems / Servers“** → hledat vendor + model →
vybrat Partnera → porovnat CPU hostu s CPU v záznamu → otevřít odkaz modelu → zkontrolovat cílovou verzi ESXi,
požadavky na BIOS a firmware → případně aktualizovat BIOS. KB doporučuje nejnovější BIOS od vendora, i když je
novější než v BCG.

Před upgradem na vSAN 9.1 (KB 450117) [H15][T]: validace BOM proti HCL je „mandatory“; ověřit firmware/driver
storage controllerů, že každý model disku je podporovaný pro daný profil (příklad „AF-0 or AF-2“), a u ESA, že
všechny disky jsou NVMe ≥ 1,6 TB.

Herní interpretace (pro model): `vyber vendora → vyber model (certifikovaný pro ESX 9.1) → vyber profil / konfiguraci
→ validace (sekce 5) → nákup → hosty do clusteru (homogenita, `10-planning` §3.4)`.

## 5. Chybové stavy (nevalidní konfigurace)

| Situace | Projev / hláška | Verze | Zdroj |
|---|---|---|---|
| Server není v BCG certifikován pro VCF 9.x (např. Dell XR4510C, ESA jen do ESXi 8.0 U3) | Validace „ESX Host vSAN HCL Compatibility“ selže: „ESX Host is not HCL compatible.“ / „0 Host test.com is not HCL compatible.“ Řešení: HW podporovaný pro VCF 9.0 | 9.x | [H10][T] |
| vSAN HCL DB v installeru > 90 dní | ESA disk check selže (KB 412606); detail viz `10-planning` §5 | 9.0.x | [H10][T] |
| NVMe za Tri-Mode controllerem | ESA disk check v installeru selže (KB 409486); VCF-VSAN-REQD-CFG-005 | 9.x | [H10][H4][T] |
| Necertifikované ESA disky | „VCF automated workflows may block cluster creation“ (`10-planning` §5) | 9.1 | [H4][T] |
| ESA disk < 1,6 TB, SAS/SATA disk pro ESA, > 24 disků / uzel | porušení VCF-VSAN-ESA-REQD-CFG-002 / KB 326717 – host není ESA-eligible (konkrétní hláška v docs neuvedena) | 9.1 | [H4][H6][T] |
| ESA uzel < 16 jader nebo < 128 GB RAM | porušení VCF-VSAN-ESA-REQD-CFG-003/004 (hláška neuvedena) | 9.1 | [H4][T] |
| vSAN ESA na 10GbE | spustí vSAN cluster compliance check (KB 372309); doporučený workaround `/VSAN/DOMNetworkSchedulerThrottleComponent = 1` (pro 8.0U2 až < 9.1); při 10Gb nepřekračovat 75 % kapacity (used + reserved) | 9.x | [H4][H16][H17][T] |
| Větší ESA profil (nad SM) na 10GbE | porušení „Larger vSAN ESA nodes require 25GbE“ | 9.1 | [H4][T] |
| OSA: SSD místo HDD v capacity tieru hybrid ReadyNode / míchání typů | nepodporovaná změna ReadyNode | – | [H14][T] |
| OSA: necertifikovaný I/O controller | „performance and availability issues“, nepodporováno | – | [H14][T] |
| ESX bez persistentního zařízení (jen USB/SD) | alarm „Secondary persistent device not found.“; v 9.1 deprecated | 9.1 | [H12][T] |
| Boot disk < 8 GB | upgrade blokován | 9.1 | [H12][T] |
| Konfigurace pod vSAN-HCI-SM / vSAN-SC-SM | „All ReadyNodes must meet or exceed the vSAN-HCI-SM (or vSAN-SC-SM) configuration“ pro podporu VMware Global Services | – | [H2][BCG-idx] |
| QLC NVMe pro HCI / Storage Cluster | QLC (4K IU) jen pro Cyber Recovery, ne pro vSAN HCI ani SC; vyžaduje ESXi 9.1+ a min. 4 zařízení/host | 9.1 | [H2][BCG-idx] |

## 6. Limity a čísla

### 6.1 vSAN ESA ReadyNode profily

Ověřeno [T] je jen **nejmenší profil** (Design Library 9.1) [H4][H5]:

| Profil | Jádra / uzel | RAM / uzel | Síť | Disky | Zdroj |
|---|---|---|---|---|---|
| vSAN-HCI-SM | ≥ 16 | ≥ 128 GB | „only supports 10GbE“ (tj. 10GbE stačí) | ≥ 1,6 TB/disk, ≤ 24 disků/uzel | [H4][T] |
| vSAN-SC-SM | ≥ 16 | ≥ 128 GB | – | stejná minima jako HCI (…-RCMD-CFG-005) | [H4][T] |
| „Larger vSAN ESA nodes“ | – | – | ≥ 25GbE | – | [H4][T] |

Kompletní tabulka profilů z BCG Hardware Guidance – **[BCG-idx], neověřeno přímým čtením** [H2]:

| HCI profil | Min. kapacita uzlu | Min. jader | Min. RAM | Max. zařízení v base konfiguraci | Min. síť |
|---|---|---|---|---|---|
| vSAN-HCI-SM | 3,2 TB | 16 | 128 GB | 12 | 10 GbE |
| vSAN-HCI-MED | 20 TB | 32 | 256 GB | 18 | 25 GbE |
| vSAN-HCI-LRG | 50 TB | 48 | 512 GB | 24 | 100 GbE |

| Storage Cluster profil | Min. jader | Min. RAM | Min. uzlů / cluster | Max. zařízení (base) | E/W síť | N/S síť |
|---|---|---|---|---|---|---|
| vSAN-SC-SM | 16 | 128 GB | 4 | 12 | 25 GbE | 10 GbE |
| vSAN-SC-MED | 32 | 192 GB | 6 | 18 | 25 GbE | 25 GbE |
| vSAN-SC-LRG | 48 | 256 GB | 6 | 24 | 100 GbE | 25 GbE |

Další body z indexu BCG Hardware Guidance [H2][BCG-idx]: HCI-SM / SC-SM vyžadují „ESXi 8.0 P04+“ (s odkazem na
KB 372309 a 372311); profily jsou minima, odchylky (např. 25 Gb místo doporučených 100 Gb u LRG) „supported but may
affect performance and availability“; více disků vyžaduje více RAM; standardní NVMe tier: „Type: NVMe TLC,
Endurance Class: ≥ 1 DWPD, Capacity: ≥ 1.6 TB“; změna typu zařízení (NVMe) „not permitted“; doporučeny dual-port
NIC. Existují i profily Cyber Recovery (vSAN-CR-SM/-MED/-LRG) – viditelné v záznamu Dell R470 [H9][BCG-idx];
pro hru zatím mimo rozsah.

Pozn. k rozporu: ve vSAN-HCI-SM „Max. zařízení v base konfiguraci 12“ [BCG-idx] vs. „Minimum # Device/Host: 1“ a
„Maximum # Device/Host: 24“ [H6][T] – nejde o rozpor (base konfigurace profilu vs. absolutní limit), ale ověřit.

### 6.2 Ostatní čísla

| Položka | Hodnota | Zdroj |
|---|---|---|
| ESX min. jader / RAM | 2 jádra / 8 GB (produkčně ≥ 12 GB) | [H12][T] |
| ESX boot | min. 32 GB, doporučeno ≥ 128 GB, ≥ 128 TBW | [H12][T] |
| ESA zařízení / host | min. 1 (SC: 2), max. 24 | [H6][T] |
| ESA disk | NVMe, ≥ 1,6 TB, ≥ 1 DWPD, Class F+ (VCF doporučuje 3 DWPD, TLC) | [H6][H4][T] |
| NIC pro vSAN | min. 10GbE; větší ESA uzly 25GbE; doporučeno ≥ 25GbE | [H4][H6][T] |
| 10Gb ESA kapacita | used + reserved ≤ 75 % | [H17][T] |
| OSA RAM pro max. disk groups | 32 GB | `10-planning` §6.2 |
| Hosty / cluster, pNIC / VDS | viz `10-planning` §6.1, §6.2 | – |

### 6.3 Statistika komponent v BCG exportu (ESXi 9.1) [BCG-data]

Zdroj: oficiální export [H22] (17. 11. 2026), výřez „podpora ESXi 9.1“ připravený orchestrátorem. Disky jsou
počítané podle pole `partnername` (OEM, pod kterým je disk certifikovaný).

| Partner | Flash disky (kategorie ssd) s 9.1 | z toho NVMe | NVMe s režimem „vSAN ESA“ | Pozn. |
|---|---|---|---|---|
| Dell | 1025 | 604 | **409** | |
| HPE | 1142 | 374 | **142** | |
| Cisco | 395 | 126 | **61** | |
| Lenovo | 368 | 71 | **0** | pod partnerem Lenovo jen disky pro vSAN OSA (tiery AF-Cache / AF-Cap / HY-Cache) |
| Supermicro | – | – | – | žádné položky s partnerem Supermicro; jeho disky jsou vedené pod výrobci disků |

| NIC (ESXi 9.1) | Počet | Pozn. |
|---|---|---|
| Všechny NIC v exportu s podporou 9.1 | 293 | všechny mají režim „vSAN ESA“; `vcglink` vede do `program=rdmanic` |
| z toho partner Supermicro | 1 | `AOC-A25G-m2SM` |

Pozn.: Export neuvádí u disků endurance (DWPD) ani performance class, takže pravidla „≥ 1 DWPD, Class F“ [H6]
nejde z exportu ověřit po položkách. Rozhoduje příznak „vSAN ESA“ u disku.

## 7. Síťový provoz (NIC / uplinky)

Jen fyzická vrstva hosta; logické toky (vmk, VLAN, MTU) jsou v `10-planning` §7.

| # | Odkud | Kam | Médium / rychlost | Pozn. | Zdroj |
|---|---|---|---|---|---|
| 1 | pNIC hosta (uplink VDS) | ToR switch (ve hře generický) | Ethernet, min. 10GbE pro vSAN; 25GbE doporučeno | Single VDS = 2 pNIC; Storage and Workload Separation = 6 pNIC (`10-planning` §3.3) | [H4][T] |
| 2 | vSAN vmk přes pNIC | ostatní hosty clusteru | 10GbE jen u vSAN-HCI-SM; větší ESA ≥ 25GbE; high IO až 100GbE | 2 pNIC (malé profily) / 4 pNIC (velké) | [H4][H5][T] |
| 3 | vSAN Storage Cluster uzly | klienti (N/S) a uzly SC (E/W) | E/W 25–100 GbE, N/S 10–25 GbE dle profilu | [BCG-idx] | [H2] |
| 4 | RDMA NIC (volitelné) | ostatní vSAN hosty | vSAN over RDMA – certifikované RDMA NIC (`program=rdmanic`) | může nahradit běžnou NIC v ESA ReadyNode | [H6][T] |
| 5 | FC HBA | FC fabric / pole | FC | jen při VMFS na FC principal storage | `10-planning` §3.5 |

## 8. Otevřené otázky

1. **ReadyNode / servery zůstávají [BCG-idx].** Disky a NIC jsou nově ověřené z exportu `all.json` [H22]
   ([BCG-data]), ale export **neobsahuje ReadyNode ani servery**. Nadále je potřeba potvrdit ručně v prohlížeči
   (BCG je JS SPA): seznam modelů a jejich profily (Příloha A), CPU generace, max. počet disků a certifikaci
   konkrétních NIC/disků **v ReadyNode BOM** daného serveru (export říká jen „disk/NIC je certifikovaný pro vSAN ESA
   na 9.1“, ne „je v BOM serveru X“), a profilovou tabulku MED/LRG.
1a. **Lenovo ESA disky**: pod partnerem Lenovo nejsou v exportu žádné NVMe disky s „vSAN ESA“. Zda jsou Lenovo
   ESA disky vedené pod výrobci disků (s Lenovo part numbery), agent neověřil: `all.json` je jeden 22 MB řádek a
   nástroj Grep z něj obsah nevypíše. Potřeba extrakce mimo agenta (filtr `vSAN ESA` + ESXi 9.1 + text „Lenovo“
   nebo PN `4XB7A…` v názvu).
1b. **Supermicro disky**: totéž – CSV obsahuje jen 4 OEM partnery; disky výrobců (Micron, Samsung, Kioxia,
   Solidigm…), které by Supermicro použil, nebyly extrahovány. Do té doby jsou disky Supermicro v katalogu [SIMPL].
1c. **Rychlost NIC** export neobsahuje jako pole; v katalogu je rychlost převzata jen z názvu modelu (např.
   „2x25G“, „100GbE“). U NIC bez rychlosti v názvu (Dell BCM57412/57414/57416/57504/57508, Supermicro
   AOC-A25G-m2SM) rychlost neuvádím.
2. **MED/LRG profily** – čísla z tabulky 6.1 (druhá a třetí tabulka) nejsou na žádné stránce techdocs/KB, kterou šlo
   přečíst. Pro model zatím použít jen SM minima [T] a obecné pravidlo „Larger vSAN ESA nodes require 25GbE“.
3. **[9.0] vs [9.1] profily** – 9.0 Design Library (dle vyhledávače) uváděla `vSAN-ESA-AF-0`; stránka 9.0 ESA storage
   modelu vrátila 404 (stejně jako v `10-planning` OQ 8). Kdy přesně BCG přešel z AF-x na HCI-SM/MED/LRG a zda staré
   AF-x záznamy platí pro 9.1, není ověřeno.
4. **Konkrétní konfigurace modelů** – pro HPE, Lenovo, Cisco a Supermicro index neukázal detail (disky, NIC, boot,
   profily). Jen Dell R470 má detail [BCG-idx].
5. Některé 9.1 listingy v BCG (vSAN OSA, Dell) nesly poznámku „the listings for 9.1 is a preview and contains
   preliminary data“ [BCG-idx] – nejasné, zda platí i pro ESA a zda už po GA 9.1.1 zmizela.
6. **vSAN OSA ReadyNode profily pro 9.1** (AF-x / HY-x) – nezjištěno, zda se v 9.1 OSA ReadyNode dál certifikují a
   s jakými profily.
7. **Boot zařízení**: KB 326717 odkazuje na KB 85685, KB 326476 na KB 313169 – nečteno.
8. **Homogenita vs. ReadyNode profil**: dokumentace nespecifikuje, zda smí v jednom clusteru být hosty stejného
   modelu, ale různého profilu (např. SM + MED). `10-planning` vyžaduje homogenní konfiguraci → hra zatím: ne.
9. Přesná hláška validace installeru pro ESA host pod minimem jader / RAM nebo s 10GbE na MED/LRG není
   v dokumentaci → hra použije obecnou herní hlášku označenou jako herní.

## 9. Zdroje

Ověřeno přímým čtením [T]:
- [H1] KB 452580 – How to Verify ESXi Host Compatibility for VCF 9.1: https://knowledge.broadcom.com/external/article/452580
- [H4] Single-Rack vSAN ESA Storage Model (Design Library 9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/storage-models-9-x/standard-vsan-storage-model/single-rack-storage-models/vcf-hardware-configuration-for-vsan.html
- [H5] Single-Rack vSAN ESA Storage Model (blueprint Minimal Footprint, 9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/infrastructure-modernization/vcf-fleet-in-a-single-site-with-minimal-footprint-blueprint/management-domain-design-selections/virtual-infrastructure-layer/vsan-single-rack-hci-esa-storage-model.html
- [H6] KB 326717 – Supported Hardware Changes: vSAN ESA and vSAN Storage Clusters ReadyNodes: https://knowledge.broadcom.com/external/article/326717
- [H7] KB 381824 – Checking VMware ESXi Host Compatibility Before Upgrade Using the Broadcom Compatibility Guide: https://knowledge.broadcom.com/external/article/381824/checking-vmware-esxi-host-compatibility.html
- [H8] KB 315329 – Supported drivers and firmware versions for I/O devices (odkaz z vyhledávání, nečteno celé): https://knowledge.broadcom.com/external/article/315329/supported-drivers-and-firmware-versions.html
- [H10] KB 427591 – The VCF 9.0 deployment validation fails during ESX Host vSAN HCL Compatibility: https://knowledge.broadcom.com/external/article/427591/the-vcf-90-deployment-validation-fails-d.html
- [H11] `10-planning` [P34] KB 442952: https://knowledge.broadcom.com/external/article/442952
- [H12] ESX Hardware Requirements (vSphere 9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/esx-installation-and-setup/installing-and-setting-up-esxi/esxi-requirements/esxi-hardware-requirements.html
- [H13] Hardware Requirements for vSAN (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/vsan-deployment-administration-and-monitoring/vsan-planning-and-deployment/requirements-for-creating-a-virtual-san-cluster/hardware-requirements-for-virtual-san.html
- [H14] KB 326476 – What You Can (and Cannot) Change in a vSAN ReadyNode: https://knowledge.broadcom.com/external/article/326476
- [H15] KB 450117 – Hardware compatibility validation for vSAN 9.1 upgrade: https://knowledge.broadcom.com/external/article/450117
- [H16] KB 372309 – Workaround to reduce impact of resync traffic in vSAN ESA clusters utilizing a 10/25G network: https://knowledge.broadcom.com/external/article/372309
- [H17] KB 372311 – System performance may degrade when cluster capacity utilization exceeds 75% and vSAN ESA is configured with 10Gb networking: https://knowledge.broadcom.com/external/article/372311

Oficiální datový export BCG [BCG-data]:
- [H22] vSAN HCL data export (BCG backend), `jsonUpdatedTime` „November 17, 2026, 8:59 AM UTC“, 9483 položek
  (controller / hdd / ssd / nic), staženo orchestrátorem: https://vvs.broadcom.com/service/vsan/all.json –
  na tento soubor odkazuje KB 427591 → KB 412606 (aktualizace vSAN HCL DB pro VCF Installer). U každé položky
  v katalogu je uveden její `vcglink` (BCG detail).

BCG – obsah jen z indexu vyhledávače [BCG-idx] (přímý fetch vrací prázdnou JS kostru):
- [H2] vSAN ESA ReadyNode Hardware Guidance: https://compatibilityguide.broadcom.com/pages/vsan-esa-readynode-hardware-guidance
- [H3] BCG – vSAN ESA ReadyNodes search: https://compatibilityguide.broadcom.com/search?program=vsanesa&persona=live&column=vendor&order=asc
- [H9] BCG – Dell PowerEdge R470 (vSAN ESA, ESXi 9.1 filtr): https://compatibilityguide.broadcom.com/detail?activeDelta=20&activePage=1&column=vendor&order=asc&persona=live&productId=63908&program=vsanesa&redirectFrom=Dell+PowerEdge+R470&vsanEsaReadynodeVendors=%5BDell%5D&vsanReadynodeSupportedReleases=%5BESXi+9.1+%28vSAN+9.1%29%5D
- [H18] BCG – vSAN ESA ReadyNodes, filtr HPE: https://compatibilityguide.broadcom.com/search?program=vsanesa&persona=live&column=vendor&order=asc&vsanEsaReadynodeVendors=%5BHewlett+Packard+Enterprise%5D&activePage=1&activeDelta=20
- [H19] BCG – vSAN ESA ReadyNodes, filtr Supermicro SYS-421GE-TNRT: https://compatibilityguide.broadcom.com/search?activeDelta=20&activePage=1&column=vendor&order=asc&persona=live&program=vsanesa&vsanEsaReadynodeVendors=%5BSupermicro+Computer%2C+Inc%5D&vsanEsaServerModel=%5BSYS-421GE-TNRT%5D
- [H20] BCG – XR4510C vSAN ESA detail (odkaz z KB 427591): https://compatibilityguide.broadcom.com/detail?program=vsanesa&productId=62959&persona=live
- [H21] BCG – vSAN OSA ReadyNodes, filtr Dell (poznámka „9.1 … preview“): https://compatibilityguide.broadcom.com/search?activeDelta=20&activePage=1&column=vendor&order=asc&persona=live&program=vsanosa&vsanReadynodeVendors=%5BDell%5D

---

## Příloha A – Reprezentativní modely 5 vendorů (certifikované pro ESX 9.x / vSAN ESA)

**Celá příloha je [BCG-idx]** – názvy a atributy pocházejí z indexované verze BCG stránek, ne z přímého čtení.
Atributy, které index neukázal, jsou „?“ (= otevřená otázka 4). Nic tu není doplněno z paměti.

### Dell
| Model | Profily | CPU | Paměť | Disky | NIC | Boot | Releases | BCG |
|---|---|---|---|---|---|---|---|---|
| PowerEdge R470 | vSAN-HCI-SM, -MED, -LRG; vSAN-CR-SM, -MED, -LRG | Intel Xeon 6700P/6500P (Granite Rapids-SP), max. 1 socket, max. 86 jader/socket | max. 4096 GB | E3.S NVMe, 1 DWPD i 3 DWPD (modely PS1010, PS1030, CM7, 9550, PM1745), max. 16 | Broadcom BCM57412, BCM57504; NVIDIA ConnectX-6 Dx dual-port 100GbE QSFP56 | BOSS, 2× M.2 ≥ 480 GB, RAID 1 | ESXi 8.0 U3, 9.0, 9.1 | [H9] |
| PowerEdge R670, R770 | ? | ? | ? | ? | ? | ? | v seznamu Dell ESA ReadyNodes, releases ? | [H3] |

### HPE
| Model | Profily | CPU | Releases | BCG |
|---|---|---|---|---|
| ProLiant DL380 Gen11 | ? | Intel Xeon Scalable (Emerald Rapids-SP) | ESXi 8.0 U1–U3, 9.0, 9.1 (vSAN 9.1) | [H18] |

### Lenovo
| Model | Profily / detail | BCG |
|---|---|---|
| ThinkSystem SR630 V4, SR650 V4, SR650a V4 | v seznamu Lenovo ESA ReadyNodes; detail (profil, CPU, disky, NIC, releases) nezjištěn | [H3] |

### Cisco
| Model | Profily / detail | BCG |
|---|---|---|
| UCSC-C240-M8E3S, UCSC-C240-M8SX, HCIVS240C-M8SN, UCSC-C220-M8S | v seznamu ESA ReadyNodes, kde je dostupný filtr ESXi 9.1; per-model releases a detail nezjištěny | [H3] |

### Supermicro
| Model | Profily | CPU | Releases | BCG |
|---|---|---|---|---|
| SYS-421GE-TNRT | ? | Intel Xeon Scalable (Emerald Rapids-SP) | ESXi 8.0 U1–U3, 9.0, 9.1 (vSAN 9.1) | [H19] |
| SYS-521GE-TNRT a další SYS-* | v seznamu ESA ReadyNodes; detail nezjištěn | – | ? | [H3] |

---

## Příloha B – Návrh herního katalogu

**Pravidlo pro model:** validace smí používat jen pravidla [T] (sekce 3, 5, 6). **Díly (disky, NIC)** jsou, kde to
šlo, skutečné certifikované položky z BCG exportu **[BCG-data]** (B.2) – s ESXi 9.1 a příznakem „vSAN ESA“ (resp.
OSA tiery). **Servery** (názvy modelů) jsou [BCG-idx]. **Jádra, RAM, počty kusů a přiřazení dílu k serveru jsou
[SIMPL]** – export neříká, zda je díl v ReadyNode BOM konkrétního serveru (OQ 1). Bez cen.

### B.1 Atributy, které model validuje

| Atribut | Typ | Pravidlo (zdroj) |
|---|---|---|
| `vendor` | Dell / HPE / Lenovo / Cisco / Supermicro | homogenita vendora v počátečním mgmt clusteru (`10-planning` §3.4) |
| `bcgCertifiedFor` | seznam verzí ESX | musí obsahovat 9.1, jinak „ESX Host is not HCL compatible.“ [H10][T] |
| `esaReadyNode` | bool | ESA jen na ReadyNode (strongly recommended) [H1][T]; necertifikované disky → blokace [H4][T] |
| `cores` (fyzická) | int | ESA ≥ 16 [H4][T]; SMT se nepočítá (`10-planning` §3.4) |
| `ramGB` | int | ESA ≥ 128 [H4][T]; ESX ≥ 8 [H12][T] |
| `drives` | count × TB × typ (NVMe TLC / SAS SSD / SATA SSD / HDD) | ESA: NVMe, ≥ 1,6 TB, 1–24 ks [H6][H4][T]; OSA: ≥ 1 disk group = 1 cache + ≥ 1 capacity (`10-planning` §3.4) |
| `triModeController` | bool | NVMe za Tri-Mode → ESA nevalidní [H4][T] |
| `nics` | count × GbE | ≥ 10GbE pro vSAN; ESA nad SM profilem ≥ 25GbE [H4][T]; počet dle VDS modelu (2 / 4 / 6, `10-planning` §3.3) |
| `bootGB` | int | ≥ 32 GB min., ≥ 128 GB doporučeno [H12][T] |
| `esaProfile` (odvozený) | SM / „larger“ | SM, pokud konfigurace odpovídá 16 jader / 128 GB / 10GbE; jinak „larger“ → vyžaduje 25GbE [H4][T] |

### B.2 Katalog dílů [BCG-data]

Všechny položky: podpora ESXi 9.1 v exportu [H22] (17. 11. 2026). Odkaz = `vcglink` položky. Kapacita v GB je
pole `capacityGB` z exportu. Rychlost NIC je **jen z názvu modelu** (export ji nemá jako pole, OQ 1c);
u „10/25Gb“ NIC hra počítá s 25GbE [SIMPL].

**Disky – vSAN ESA (NVMe, TLC, režim „vSAN ESA“)**

| Part ID | Partner | Model (export) | GB | Odkaz |
|---|---|---|---|---|
| `drv-dell-ps1030-e3s-1600` | Dell | Dell NVMe ISE PS1030 MU E3.S 1.6TB | 1600 | https://compatibilityguide.broadcom.com/detail?program=ssd&productId=62524&persona=live |
| `drv-dell-ps1030-e3s-3200` | Dell | Dell NVMe ISE PS1030 MU E3.S 3.2TB | 3200 | https://compatibilityguide.broadcom.com/detail?program=ssd&productId=62526&persona=live |
| `drv-dell-ps1030-e3s-6400` | Dell | Dell NVMe ISE PS1030 MU E3.S 6.4TB | 6400 | https://compatibilityguide.broadcom.com/detail?program=ssd&productId=62528&persona=live |
| `drv-hpe-cm7-u3-1600` | HPE | HPE 1.6TB NVMe MU SFF BC U.3 CM7 SSD | 1600 | https://compatibilityguide.broadcom.com/detail?program=ssd&productId=57501&persona=live |
| `drv-hpe-cm7-e3s-3200` | HPE | HPE 3.2TB NVMe MU E3S EC1 CM7 SSD | 3200 | https://compatibilityguide.broadcom.com/detail?program=ssd&productId=56417&persona=live |
| `drv-hpe-9550-e3s-6400` | HPE | HPE 6.4TB NVMe MU E3S EC1 9550 SSD | 6400 | https://compatibilityguide.broadcom.com/detail?program=ssd&productId=63347&persona=live |
| `drv-cisco-7500-1600` | Cisco | 1.6TB 2.5in U.3 Micron 7500 NVMe High Perf High Endurance (UCS-NVB1T6M2P, UCSX-NVB1T6M2P) | 1600 | https://compatibilityguide.broadcom.com/detail?program=ssd&productId=64569&persona=live |
| `drv-cisco-7500-3200` | Cisco | 3.2TB 2.5in U.3 Micron 7500 NVMe High Perf High Endurance(UCS-NVB3T2M2P, UCSX-NVB3T2M2P) | 3200 | https://compatibilityguide.broadcom.com/detail?program=ssd&productId=64570&persona=live |
| `drv-cisco-7500-6400` | Cisco | 6.4TB 2.5in U.3 Micron 7500 NVMe High Perf High Endurance(UCS-NVB6T4M2P, UCSX-NVB6T4M2P) | 6400 | https://compatibilityguide.broadcom.com/detail?program=ssd&productId=64571&persona=live |
| – | Lenovo | **žádný** – pod partnerem Lenovo nejsou v exportu NVMe disky s „vSAN ESA“; zda jsou Lenovo ESA disky vedené pod výrobci disků, neověřeno (OQ 1a) | – | – |
| – | Supermicro | **neextrahováno** – Supermicro nemá partner položky; disky jsou pod výrobci disků, ty v CSV nejsou (OQ 1b) | – | – |

**Disky – vSAN OSA (all-flash, tiery pro 9.1 z pole `tiers91`)**

| Part ID | Partner | Model (export) | GB | Typ | Tiery 9.1 | Odkaz |
|---|---|---|---|---|---|---|
| `drv-hpe-pm1655a-sas-1600` | HPE | DRV, 1.6TB SAS MU SFF PM1655a SSD-SAM | 1600 | SAS TLC | AF-Cache, AF-Cap | https://compatibilityguide.broadcom.com/detail?program=ssd&productId=62573&persona=live |
| `drv-hpe-pm1653a-sas-3840` | HPE | DRV, 3.84TB SAS RI SFF PM1653a SSD-SAM | 3840 | SAS TLC | AF-Cache, AF-Cap | https://compatibilityguide.broadcom.com/detail?program=ssd&productId=62566&persona=live |
| `drv-len-pm1635a-sas-1600` | Lenovo | PM1635a 1600GB | 1600 | SAS TLC | AF-Cache, AF-Cap, HY-Cache | https://compatibilityguide.broadcom.com/detail?program=ssd&productId=41881&persona=live |
| `drv-len-pm1633a-sas-3840` | Lenovo | PM1633a 3840GB | 3840 | SAS TLC | AF-Cache, AF-Cap, HY-Cache | https://compatibilityguide.broadcom.com/detail?program=ssd&productId=41887&persona=live |

**NIC (režim „vSAN ESA“, ESXi 9.1; certifikace v programu `rdmanic`)**

| Part ID | Partner | Model (export) | Rychlost × porty (z názvu) | Odkaz |
|---|---|---|---|---|
| `nic-dell-cx5-25g-2p` | Dell | ConnectX®-5 EN network interface card, 25GbE Dual-port SFP28 for OCP3.0 | 25GbE × 2 | https://compatibilityguide.broadcom.com/detail?program=rdmanic&productId=50015&persona=live |
| `nic-dell-cx6dx-100g-2p` | Dell | Nvidia Connect X-6 DX Dual Port 100Gbe QSFP56 OCP 3.0 Network Adapter | 100GbE × 2 | https://compatibilityguide.broadcom.com/detail?program=rdmanic&productId=59418&persona=live |
| `nic-hpe-57412-10g-2p` | HPE | HPE Ethernet 10Gb 2-port SFP+ BCM57412 Adapter | 10GbE × 2 | https://compatibilityguide.broadcom.com/detail?program=rdmanic&productId=52839&persona=live |
| `nic-hpe-57504-25g-4p` | HPE | Broadcom BCM57504 Ethernet 10/25Gb 4-port SFP28 Adapter for HPE | 10/25GbE × 4 | https://compatibilityguide.broadcom.com/detail?program=rdmanic&productId=52604&persona=live |
| `nic-hpe-cx6-100g-2p` | HPE | HPE Ethernet 100Gb 2-port QSFP56 MCX623106AS-CDAT Adapter(P25962-001/P25960-B21) | 100GbE × 2 | https://compatibilityguide.broadcom.com/detail?program=rdmanic&productId=52038&persona=live |
| `nic-len-57414-25g-2p` | Lenovo | ThinkSystem Broadcom 57414 10/25GbE SFP28 2-port PCIe Ethernet Adapter (4XC7A08238) | 10/25GbE × 2 | https://compatibilityguide.broadcom.com/detail?program=rdmanic&productId=63576&persona=live |
| `nic-len-57504-25g-4p` | Lenovo | ThinkSystem Broadcom 57504 10/25GbE SFP28 4-port OCP Ethernet Adapter (4XC7A80567) | 10/25GbE × 4 | https://compatibilityguide.broadcom.com/detail?program=rdmanic&productId=63111&persona=live |
| `nic-len-57508-100g-2p` | Lenovo | ThinkSystem Broadcom 57508 100GbE QSFP56 2-Port OCP Ethernet Adapter (4XC7A08243) | 100GbE × 2 | https://compatibilityguide.broadcom.com/detail?program=rdmanic&productId=63572&persona=live |
| `nic-cisco-cx6lx-25g-2p` | Cisco | Cisco-NVDA MCX631102AS-ADAT CX6 Lx 2x25G SFP28 x8 PCIe NIC | 25GbE × 2 | https://compatibilityguide.broadcom.com/detail?program=rdmanic&productId=64422&persona=live |
| `nic-cisco-cx7-25g-4p` | Cisco | Cisco-NVDA MCX713104AS-ADAT 4x25GbE SFP56 Gen4 x16 PCIe NIC | 25GbE × 4 | https://compatibilityguide.broadcom.com/detail?program=rdmanic&productId=64652&persona=live |
| `nic-cisco-cx6-100g-2p` | Cisco | Cisco-MLNX MCX623106AS-CDAT 2x100GbE QSFP56 PCIe NIC | 100GbE × 2 | https://compatibilityguide.broadcom.com/detail?program=rdmanic&productId=64367&persona=live |
| `nic-smc-a25g` | Supermicro | AOC-A25G-m2SM | neuvedena (OQ 1c); hra 25GbE × 2 [SIMPL] | https://compatibilityguide.broadcom.com/detail?program=rdmanic&productId=52102&persona=live |

### B.3 Startovní konfigurace serverů

Legenda: **ESA** = splňuje pravidla [T] pro vSAN ESA; **OSA** = splňuje pravidla OSA; **EXT** = jen externí
storage (NFS v3 / FC); ✗ = záměrně nesplňuje (past pro Kariéru). Jádra, RAM, počty kusů a boot = [SIMPL].

| ID | Server [BCG-idx] | Jádra | RAM GB | Disky (part ID z B.2) | NIC (part ID z B.2) | Boot | ESA | OSA | EXT | Pozn. |
|---|---|---|---|---|---|---|---|---|---|---|
| `dell-r470-sm` | Dell PowerEdge R470 | 16 | 128 | 4 × `drv-dell-ps1030-e3s-3200` | 1 × `nic-dell-cx5-25g-2p` (2 × 25GbE) | 2 × 480 GB M.2 RAID 1 (BCG-idx) | ano (SM) | – | ano | SM minimum |
| `dell-r470-med` | Dell PowerEdge R470 | 32 | 512 | 8 × `drv-dell-ps1030-e3s-6400` | 2 × `nic-dell-cx5-25g-2p` (4 × 25GbE) | 2 × 480 GB M.2 RAID 1 (BCG-idx) | ano | – | ano | doporučená volba pro mgmt doménu |
| `dell-r470-100g` | Dell PowerEdge R470 | 64 | 1024 | 16 × `drv-dell-ps1030-e3s-6400` (max. 16 = BCG-idx) | 1 × `nic-dell-cx6dx-100g-2p` (2 × 100GbE) | 2 × 480 GB M.2 RAID 1 | ano | – | ano | high IO |
| `hpe-dl380g11-sm` | HPE ProLiant DL380 Gen11 | 16 | 128 | 4 × `drv-hpe-cm7-e3s-3200` | 1 × `nic-hpe-57412-10g-2p` (2 × 10GbE) | 2 × 480 GB | ano (SM) | – | ano | 10GbE povoleno jen pro SM; spustí compliance check [H4] |
| `hpe-dl380g11-10g` | HPE ProLiant DL380 Gen11 | 32 | 256 | 6 × `drv-hpe-cm7-e3s-3200` | 1 × `nic-hpe-57412-10g-2p` (2 × 10GbE) | 2 × 480 GB | ✗ | – | ano | past: větší než SM na 10GbE → „Larger vSAN ESA nodes require 25GbE“ [H4] |
| `hpe-dl380g11-osa` | HPE ProLiant DL380 Gen11 | 32 | 384 | 2 disk groups: 2 × `drv-hpe-pm1655a-sas-1600` (cache) + 6 × `drv-hpe-pm1653a-sas-3840` (capacity) | 1 × `nic-hpe-57504-25g-4p` (4 × 25GbE) | 2 × 480 GB | ✗ (SAS) | ano | ano | ESA vs OSA; OSA ReadyNode pro 9.1 neověřen (OQ 6) |
| `lenovo-sr650v4-osa` | Lenovo ThinkSystem SR650 V4 | 32 | 512 | 2 disk groups: 2 × `drv-len-pm1635a-sas-1600` (cache) + 6 × `drv-len-pm1633a-sas-3840` (capacity) | 1 × `nic-len-57504-25g-4p` (4 × 25GbE) | 2 × 480 GB | ✗ (SAS) | ano | ano | ESA varianta Lenovo zatím nejde z [BCG-data] (OQ 1a) |
| `lenovo-sr650v4-med` | Lenovo ThinkSystem SR650 V4 | 32 | 512 | 8 × NVMe TLC 6,4 TB **[SIMPL]** | 1 × `nic-len-57504-25g-4p` (4 × 25GbE) | 2 × 480 GB | ano* | – | ano | *disk není z exportu – před použitím OQ 1a |
| `lenovo-sr630v4-compute` | Lenovo ThinkSystem SR630 V4 | 32 | 512 | žádné vSAN disky | 1 × `nic-len-57414-25g-2p` (2 × 25GbE) + FC HBA [SIMPL] | 2 × 480 GB | ✗ | ✗ | ano | compute host pro NFS/FC principal storage |
| `cisco-c240m8-med` | Cisco UCSC-C240-M8SX | 32 | 512 | 8 × `drv-cisco-7500-6400` | 1 × `nic-cisco-cx7-25g-4p` (4 × 25GbE) | 2 × 480 GB | ano | – | ano | |
| `cisco-c220m8-sm` | Cisco UCSC-C220-M8S | 16 | 128 | 4 × `drv-cisco-7500-1600` | 1 × `nic-cisco-cx6lx-25g-2p` (2 × 25GbE) | 2 × 480 GB | ano (SM) | – | ano | |
| `cisco-c240m8-100g` | Cisco UCSC-C240-M8SX | 48 | 768 | 12 × `drv-cisco-7500-6400` | 1 × `nic-cisco-cx6-100g-2p` (2 × 100GbE) | 2 × 480 GB | ano | – | ano | high IO |
| `smc-421ge-sm` | Supermicro SYS-421GE-TNRT | 16 | 128 | 2 × NVMe TLC 1,6 TB **[SIMPL]** | 1 × `nic-smc-a25g` | 2 × 480 GB | ano* | – | ano | *disk není z exportu (OQ 1b) |
| `smc-421ge-trimode` | Supermicro SYS-421GE-TNRT | 32 | 256 | 6 × NVMe TLC 3,2 TB **[SIMPL]** za Tri-Mode controllerem | 1 × `nic-smc-a25g` | 2 × 480 GB | ✗ | – | ano | past: VCF-VSAN-REQD-CFG-005 / KB 409486 |

Poznámky:
- **[BCG-data]**: modely disků a NIC, jejich kapacita, typ (NVMe/SAS, TLC), režim „vSAN ESA“ / OSA tiery a podpora
  ESXi 9.1 – s odkazem na položku. **[BCG-idx]**: názvy serverů; u Dell R470 max. 16 disků, E3.S formát,
  BOSS 2× M.2 ≥ 480 GB RAID 1, max. 86 jader/socket, max. 4096 GB RAM. **[SIMPL]**: jádra, RAM, počty kusů, boot
  u ne-Dell serverů, FC HBA, rychlost Supermicro NIC, Lenovo ESA a Supermicro disky.
- Export nepotvrzuje, že díl je v ReadyNode BOM daného serveru (OQ 1); párování díl ↔ server je herní (stejný OEM
  partner jako server; u Dell R470 je zvolen E3.S PS1030, který indexovaný detail R470 jmenuje mezi certifikovanými disky [H9]).
- Zařazení konkrétního modelu do profilu (SM / MED) je herní – BCG záznam profily per model (kromě R470) neukázal.
- Herní varianty, které porušují pravidla [T] (✗), slouží pro Kariéru; v Sandboxu je hráč smí koupit, ale validace
  je odmítne pro dané použití – s hláškou ze sekce 5, kde existuje, jinak s herní hláškou označenou jako herní.
- Žádné ceny – fiktivní měna se doplní v ekonomice Kariéry.
