# 15 – Hardware: servery, ReadyNode profily a herní katalog

> Modelovaná verze: **VCF 9.1.1** (viz `docs/spec/VERSION.md`). Rozdíly proti 9.0 jsou označeny **[9.0]** / **[9.1]**.
> Stav k 2026-11-21. Odkazy `[Hn]` vedou do sekce 9.
>
> **Překryv s jinými speci:** obecné HW požadavky na ESX hosty pro VCF (homogenita, CPU/RAM pro vSAN ESA, boot,
> ESA/OSA disky, NIC a rychlosti, minimální počty hostů) jsou v `10-planning.md` (3.3, 3.4, 6.1, 6.2). Tady se
> neopakují, jen se na ně odkazuje (`10-planning` §x). Tento spec přidává: **ReadyNode profily** z Broadcom
> Compatibility Guide (BCG), pravidla změn v ReadyNode, ESX boot požadavky 9.1, chybové stavy HCL validace,
> **ověřené certifikované modely** 5 vendorů (BCG data) a **návrh herního katalogu**.

## 0. Stav ověření zdrojů (DŮLEŽITÉ – čti jako první)

BCG (compatibilityguide.broadcom.com) je JavaScriptová aplikace; přímý WebFetch vrací jen kostru stránky.
Data proto stáhl orchestrátor **přes stejné JSON API, které volá webová aplikace BCG** (oficiální web BCG, ne
třetí strana):

| Soubor v repu | Co obsahuje | Jak vznikl |
|---|---|---|
| `docs/spec/data/bcg-vsan-esa-readynodes-esxi91.json` [H9] | **247 vSAN ESA ReadyNode** záznamů s filtrem Supported Release = „ESXi 9.1 (vSAN 9.1)“ pro Dell (32), HPE (26), Lenovo (76), Cisco (31), Supermicro (82); v BCG je pro 9.1 celkem 350 ESA ReadyNode všech vendorů (`meta.totalReadyNodesAllVendors`). Per záznam: `productId`, `model`, `cpuGeneration`, `supportedReleases`, `profiles`, `maxCoresPerSocket`, `maxSockets`, `maxMemoryGB`, `esaDrives` (názvy certifikovaných disků s DWPD), `cyberRecoveryDrives`, `maxDrives`, `nics`, `bootDevice`, `pcieSwitch`, `notes`, `bcgUrl`. `meta.fetchedAt` 2026-11-21T00:29Z. | `POST …/compguide/programs/viewResults` (seznam) + `POST …/viewDetails?programId=vsanesa&id=<productId>` (detail); obnova: `tools/bcg/fetch-readynodes.sh` |
| `docs/spec/data/bcg-vsan-esa-readynode-hardware-guidance.md` [H2] | doslovný text stránky BCG „vSAN ESA ReadyNode Hardware Guidance“ (tabulky profilů HCI / SC / Cyber Recovery, požadavky na disky, poznámky) | headless prohlížeč, 2026-11-21T00:29Z |
| `docs/spec/data/server-rack-units.json` [VEND] | výška v U pro 30 modelů z Přílohy A (`vendor`, `model`, `bcgProductIds`, `rackUnits`, doslovná citace, `url`) + `unresolved` | WebFetch vendorských stránek, 2026-11-21 (Příloha C) |
| (mimo repo) `all.json` [H22] | oficiální export vSAN HCL (komponenty: controller / hdd / ssd / nic), `jsonUpdatedTime` 17. 11. 2026 | stažen orchestrátorem dříve; v tomto specu jen výřezy v Příloze B.2 |

Úrovně důvěry. **Model a engine smí jako pravidla použít [T] a [BCG]; jako katalog dílů [BCG] a [BCG-data].**

| Značka | Význam |
|---|---|
| **[T]** | Ověřeno přímým čtením stránky techdocs.broadcom.com nebo knowledge.broadcom.com. |
| **[BCG]** | Ověřeno z oficiálního webu BCG – z dat jeho API (ReadyNode záznam, cituje se `bcgUrl` modelu) nebo z doslovného textu stránky Hardware Guidance [H2]. |
| **[BCG-data]** | Ověřeno z oficiálního datového exportu vSAN HCL `all.json` [H22] (stav 17. 11. 2026); u položky je její `vcglink`. Export obsahuje jen komponenty (ne ReadyNode ani servery). |
| **[VEND]** | **Jen výška serveru v U**, z oficiálního datasheetu / produktové stránky vendora (dell.com, hpe.com, lenovo.com / Lenovo Press, cisco.com, supermicro.com), s odkazem. Žádný jiný atribut se z vendorských zdrojů nepřebírá (Příloha C). |
| **[SIMPL]** | Herní zjednodušení / herní hodnota (výběr konkrétní hodnoty v mezích dokumentace, mapování názvů mezi datasety). Není to fakt z dokumentace. |

Dřívější úroveň **[BCG-idx]** (text BCG jen z indexu vyhledávače) je **zrušena** – všechna tvrzení byla buď
potvrzena daty [BCG], nebo odstraněna (přehled v sekci 8, „Uzavřené otázky“).

**Interpretace polí datasetu** (z `tools/bcg/build_dataset.py`): `profiles` = všechny řetězce `vSAN-XXX-YYY` ze
sekce „ReadyNode…“ detailu; `maxCoresPerSocket` / `maxSockets` / `maxMemoryGB` / `maxDrives` = pole „Maximum CPU
Cores…“, „Max CPU Sockets“, „Maximum Total Memory“, „Maximum Drives“; `esaDrives` = „Storage Devices (ESA…“;
`cyberRecoveryDrives` = „Storage Devices (Cyber…“. Názvy disků v BOM **neobsahují kapacitu** – kapacitní body se
berou z [BCG-data] (jen tam, kde jde název spárovat) nebo jsou [SIMPL].

## 1. Shrnutí

Pro VCF 9.1 musí být server a BIOS v BCG **„certified for VCF 9.1“**, NIC a HBA ověřené v BCG I/O Devices; pro
vSAN ESA se „strongly recommended“ používají **vSAN ESA ReadyNodes**, u OSA lze bez ReadyNode ověřit I/O
controller, HDD a SSD jednotlivě [H1][T] (viz též `10-planning` §3.4). ReadyNode je certifikovaný server (CPU
generace) s certifikovanými komponentami – „Certified components: NVMe devices, CPU, NICs.“ [H2][BCG] – zařazený
do **profilů**. Profil definuje minima (kapacita uzlu, jádra, RAM, síť) a „base“ počet zařízení [H2][BCG].

Profily podle Hardware Guidance [H2][BCG]: **vSAN HCI** `vSAN-HCI-SM / -MED / -LRG`, **vSAN Storage Cluster**
`vSAN-SC-SM / -MED / -LRG` a **Cyber Recovery** (v tabulce guidance `CyberRecovery-SM / -MED / -LRG`, v ReadyNode
záznamech `vSAN-CR-SM / -MED / -LRG` [H9][BCG]). Klíčová pravidla z guidance (doslovně):
- „Deviations from recommended specs are supported but may affect performance and availability.“ Příklad: „Using
  25 Gb networking instead of the recommended 100 Gb on a vSAN-HCI-LRG profile.“ → hodnoty MED/LRG jsou
  **doporučení**; odchylka je podporovaná.
- „All ReadyNodes must meet or exceed the vSAN-HCI-SM (or vSAN-SC-SM) configuration for VMware Global Services (GS)
  support.“ → minimum SM je **požadavek** (pro podporu GS).

**[9.1]** Design Library 9.1 používá stejná jména (**vSAN-HCI-SM**, **vSAN-SC-SM**) jako „smallest vSAN Ready node“
[H4][H5][T]. **[9.0]** Starší jména ESA profilů `vSAN-ESA-AF-0 / -2 / -4 / -6 / -8` a `AF-HighDensity` stále uvádí
KB 326717 [H6][T]; v BCG záznamech pro ESXi 9.1 se **nevyskytují** (0 výskytů „vSAN-ESA“ / „AF-“ v [H9]) [BCG].

Pro hru je spec podkladem pro **obchod se servery v Sandboxu / Kariéře**: hráč vybírá vendora (Dell, HPE, Lenovo,
Cisco, Supermicro), reálný model a konfiguraci (CPU jádra, RAM, NVMe disky, NIC) a model validuje, zda je host
použitelný pro vSAN ESA (a v jakém profilu), vSAN OSA, nebo jen s externím úložištěm (NFS / FC).

## 2. Komponenty a vztahy

### 2.1 Programy (kategorie) v BCG relevantní pro VCF hosty

| Program | URL (z KB) | K čemu | Zdroj |
|---|---|---|---|
| Systems / Servers (`program=server`) | https://compatibilityguide.broadcom.com/search?program=server&persona=live&column=partnerName&order=asc | server + CPU + BIOS, „certified for VCF 9.1“ | [H1][H7][T] |
| I/O Devices (`program=io`) | https://compatibilityguide.broadcom.com/search?program=io&persona=live | NIC, HBA (min. firmware, odkaz na driver) | [H1][H8][T] |
| vSAN ESA ReadyNodes (`program=vsanesa`) | https://compatibilityguide.broadcom.com/search?program=vsanesa&persona=live&column=vendor&order=asc | ReadyNode pro ESA | [H1][T]; data [H9][BCG] |
| vSAN ESA ReadyNode Hardware Guidance | https://compatibilityguide.broadcom.com/pages/vsan-esa-readynode-hardware-guidance | definice profilů | odkaz [H1][T], obsah [H2][BCG] |
| vSAN I/O controller (`program=vsanio`) | https://compatibilityguide.broadcom.com/search?program=vsanio&persona=live&column=brandName&order=asc | OSA bez ReadyNode | [H1][T] |
| vSAN HDD (`program=hdd`) | https://compatibilityguide.broadcom.com/search?program=hdd&persona=live&column=partnerName&order=asc | OSA bez ReadyNode | [H1][T] |
| vSAN SSD (`program=ssd`) | https://compatibilityguide.broadcom.com/search?program=ssd&persona=live&column=partnerName&order=asc | OSA bez ReadyNode | [H1][T] |

### 2.2 Struktura záznamu ReadyNode (co BCG eviduje) [H9][BCG]
Vendor a model; **CPU generace** (např. „Intel Xeon 6700P/6500P (Granite-Rapids-SP)“, „AMD EPYC (Turin)“);
**Supported Releases** (např. „ESXi 8.0 U3 (vSAN 8.0 Update 3)“, „ESXi 9.0 (vSAN 9.0)“, „ESXi 9.1 (vSAN 9.1)“);
**ReadyNode profily** (víc profilů na jeden model); max. jader na socket; max. socketů; max. paměť (GB);
**certifikované ESA disky** (rodina + formát + DWPD, např. „Dell E3.S PS1030 [3 DWPD]“) a zvlášť disky pro Cyber
Recovery; **max. počet disků**; certifikované **NIC**; **boot zařízení**; **PCIe switch** (u všech vybraných
modelů „Not Supported, Direct Connect Only“); poznámky. KB 427591 ukazuje stejná pole záznamu (Component: Server,
ReadyNode Profile, CPU Series, Storage: vSAN ESA, Supported Releases) [H10][T].

### 2.3 Vztahy
- Host ve VCF clusteru → certifikovaný server (`program=server`) pro cílovou verzi ESX [H1][T].
- vSAN ESA host → ReadyNode (`program=vsanesa`) → profil → certifikované NVMe, CPU, NIC [H1][T][H2][BCG].
- Profil je vlastnost **konfigurace**; model uvádí, pro které profily je certifikovaný (např. Dell R7715 jen
  HCI-SM/MED + CR, bez HCI-LRG [H9][BCG]).
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
ESA ≥ 16 jader a ≥ 128 GB RAM) [H4][T]. Hardware Guidance pro boot odkazuje na KB 85685 („Please refer to KB 85685
for boot guidance“) [H2][BCG].

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

### 3.3 vSAN ESA ReadyNode – požadavky na disky a pravidla změn

Hardware Guidance, „Storage Devices“ [H2][BCG] (doslovně):
- „Type: NVMe TLC“; „Performance Class: F (100 K–349 K writes/s) or higher“; „Endurance Class: ≥ 1 DWPD“;
  „Capacity: ≥ 1.6 TB“; „Min Devices per Host Supported: 1“; „Large Capacity (> 8 TB): Supported on ESXi 8.0 U1+“;
  „Read-Intensive Devices: Supported on ESXi 8.0 U1+“.
- Třídy výkonu: **F** = 100 000–349 999 writes/s, **G** = 350 000+.
- „The ReadyNode™ is certified for a specific device type (NVMe). Changing the device type is not permitted.“
- „The capacity point is for reference only. You may select alternative capacity points as long as the Node
  Capacity and Performance/Endurance requirements are satisfied.“
- „Increasing the number of devices improves vSAN ESA performance.“
- **NVMe QLC (jen Cyber Recovery)**: „supported exclusively for the Cyber Recovery use case“, „4K IU“, min. 4
  zařízení / host, kapacita 15.36 TB nebo 30.72 TB, „QLC support requires ESXi 9.1 or later“; „not supported for
  vSAN HCI or Storage Cluster workloads“. **[9.1]** (v 9.0 QLC pro CR není).
- **vSAN Storage Clusters**: „Min Capacity per Node: 20 TB“, „Min Devices per Host Supported: 2“, „vSAN SC
  Profiles: ESXi 8.0 U2+“.

KB 326717 – Supported Hardware Changes (ESA a SC ReadyNodes) [H6][T]:
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
  BCG guidance: „Dual-port NICs recommended for redundancy.“ [H2][BCG].
- Storage Cluster uzly: „Select the same minimum requirements for vSAN Storage cluster nodes as vSAN ESA HCI
  nodes.“ (VCF-VSAN-ESA-RCMD-CFG-005) [H4][T].
- Doporučen TPM (VCF-VSAN-RCMD-CFG-002) [H4][T].

### 3.6 Granite Rapids (Intel Xeon 6700P/6500P) a vSAN – KB 393469 [H23][T]
Všechny ReadyNode s CPU „Intel Xeon 6700P/6500P (Granite-Rapids-SP)“ mají v BCG poznámku „Please refer to
https://knowledge.broadcom.com/external/article?articleId=393469 for performance guidance when running vSAN on
Intel® Xeon® 6700/6500-Series Processors systems.“ [H9][BCG]. KB 393469: prostředí „vSAN in VCF 5.2 (vSAN 8.0
U3e)“; „performance may drop noticeably on high-core systems and potentially more on low-core multi-die systems“
(vyšší cross-socket / cross-NUMA latence paměti); **„This issue is resolved in VCF 9.1.“**, „Broadcom recommends
upgrading to VCF 9.1 to benefit from the performance improvements“. KB neuvádí čísla ani BIOS nastavení.
**[9.0]** pro 9.0 KB nic výslovně neříká (OQ 10).

## 4. Workflow – jak vybrat HW podle dokumentace

KB 452580 „How to Verify ESXi Host Compatibility for VCF 9.1“ [H1][T]:
1. **Server a BIOS** – BCG Server search (`program=server`): model a BIOS „certified for VCF 9.1“.
2. **NIC a HBA** – BCG I/O Devices (`program=io`). Na existujícím hostu zjistit HW přes
   `esxcli storage core adapter list` (HBA) a `esxcli network nic list` (NIC).
3. **vSAN**:
   - ESA: použít vSAN ESA ReadyNode (strongly recommended) – `program=vsanesa` + ESA ReadyNode Hardware Guidance.
   - OSA: ReadyNode, kde je to možné; jinak ověřit jednotlivě I/O controller (`vsanio`), HDD (`hdd`), SSD (`ssd`).
4. Firmware/driver verze ověřit podle KB 323110 / skriptu z KB 369320 (odkazy z [H1]).

Postup podle Hardware Guidance („How to use this document“) [H2][BCG]:
1. „Define workload requirements for your use case.“
2. „Filter and search vSAN ESA ReadyNode™ offerings that align with your needs.“
3. „Select a vSAN HCI or vSAN Storage Cluster ReadyNode™ using the vSAN ESA BCG from your preferred OEM vendor.“

Postup v BCG UI (KB 381824) [H7][T]: otevřít BCG → kategorie **„Systems / Servers“** → hledat vendor + model →
vybrat Partnera → porovnat CPU hostu s CPU v záznamu → otevřít odkaz modelu → zkontrolovat cílovou verzi ESXi,
požadavky na BIOS a firmware → případně aktualizovat BIOS. KB doporučuje nejnovější BIOS od vendora, i když je
novější než v BCG.

Před upgradem na vSAN 9.1 (KB 450117) [H15][T]: validace BOM proti HCL je „mandatory“; ověřit firmware/driver
storage controllerů, že každý model disku je podporovaný pro daný profil (příklad „AF-0 or AF-2“), a u ESA, že
všechny disky jsou NVMe ≥ 1,6 TB.

Herní interpretace (pro model): `vyber vendora → vyber model (ReadyNode s „ESXi 9.1 (vSAN 9.1)“) → vyber
konfiguraci (jádra, RAM, disky z esaDrives, NIC z nics) → odvoď profil (sekce 6.1, B.1) → validace (sekce 5) →
nákup → hosty do clusteru (homogenita, `10-planning` §3.4)`.

## 5. Chybové stavy (nevalidní konfigurace)

Sloupec **Třída** (pro model): **REQ** = požadavek (konfigurace pro dané použití neplatná / nepodporovaná);
**DEV** = podporovaná odchylka s dopadem na výkon/dostupnost (varování, ne blokace); **RCMD** = doporučení.

| Situace | Projev / hláška | Třída | Verze | Zdroj |
|---|---|---|---|---|
| Server není v BCG certifikován pro cílovou verzi | Validace „ESX Host vSAN HCL Compatibility“ selže: „ESX Host is not HCL compatible.“ / „0 Host test.com is not HCL compatible.“ Řešení: použít HW podporovaný pro VCF 9.x. (Příklad z KB – Dell XR4510C „only certified till ESXi 8.0 U3“ – je **zastaralý**: BCG dnes XR4510C uvádí s „ESXi 9.0“ i „ESXi 9.1“ [H20][BCG]; viz OQ 2.) | REQ | 9.x | [H10][T] |
| vSAN HCL DB v installeru > 90 dní | ESA disk check selže (KB 412606); detail viz `10-planning` §5 | REQ | 9.0.x | [H10][T] |
| NVMe za Tri-Mode controllerem | ESA disk check v installeru selže (KB 409486); VCF-VSAN-REQD-CFG-005 | REQ | 9.x | [H10][H4][T] |
| Necertifikované ESA disky / disk mimo BOM daného ReadyNode / disk jiného OEM | „VCF automated workflows may block cluster creation“ (`10-planning` §5); make/model z ESA ReadyNode BOM, disky jen v rámci OEM | REQ | 9.1 | [H4][H6][T] |
| ESA disk < 1,6 TB, < 1 DWPD, třída pod F, > 24 disků / uzel | porušení VCF-VSAN-ESA-REQD-CFG-002 / KB 326717 / guidance „Storage Devices“ (hláška v docs neuvedena) | REQ | 9.1 | [H4][H6][T][H2][BCG] |
| SAS / SATA disk v ESA ReadyNode | „SAS and SATA are not currently planned for vSAN ESA“; „Changing the device type is not permitted.“ | REQ | – | [H6][T][H2][BCG] |
| QLC / Cyber Recovery disk (např. „HPE E3.S VRO P5430 [0.51 DWPD]“ ze sekce Cyber Recovery) v HCI / SC | QLC „not supported for vSAN HCI or Storage Cluster workloads“; navíc 0.51 DWPD < 1 DWPD | REQ | 9.1 | [H2][H9][BCG] |
| ESA uzel < 16 jader nebo < 128 GB RAM | porušení VCF-VSAN-ESA-REQD-CFG-003/004 (hláška neuvedena) | REQ | 9.1 | [H4][T] |
| Konfigurace pod vSAN-HCI-SM / vSAN-SC-SM (např. kapacita uzlu < 3.2 TB, i když každý disk ≥ 1.6 TB) | „All ReadyNodes must meet or exceed the vSAN-HCI-SM (or vSAN-SC-SM) configuration for VMware Global Services (GS) support.“ → bez podpory GS | REQ (podpora) | – | [H2][BCG] |
| Storage Cluster uzel < 20 TB nebo < 2 zařízení; SC cluster pod min. počtem uzlů (4 / 6 / 6) | porušení „vSAN Storage Clusters“ minim / tabulky SC profilů | REQ (SM min.) / DEV (MED/LRG) | – | [H2][BCG][H6][T] |
| Konfigurace nad SM, ale pod minimem vyššího profilu v jednom parametru (např. LRG výpočetně, ale 25 GbE místo 100 GbE) | „Deviations from recommended specs are supported but may affect performance and availability.“ – herně: profil se odvodí nižší / varování | DEV | – | [H2][BCG] |
| Větší ESA uzel (nad SM) na 10GbE | BCG: odchylka (DEV, uzel stále splňuje SM síť 10 GbE). VCF Design Library: „Larger vSAN ESA nodes require 25GbE“ (VCF-VSAN-NET-REQD-CFG-001) → nesoulad s VCF designem. Konkrétní hláška ani blokace v installeru nejsou zdokumentované (OQ 6). | DEV + design REQD | 9.1 | [H2][BCG][H4][T] |
| vSAN ESA na 10GbE (jakýkoli profil) | spustí vSAN cluster compliance check (KB 372309); doporučený workaround `/VSAN/DOMNetworkSchedulerThrottleComponent = 1` (pro 8.0U2 až < 9.1); při 10Gb nepřekračovat 75 % kapacity (used + reserved) | DEV | 9.x | [H4][H16][H17][T] |
| Více disků než `maxDrives` modelu | fyzicky / certifikačně nemožné – max. počet disků je atribut ReadyNode záznamu | REQ | – | [H9][BCG] |
| Míchání 1 DWPD a 3 DWPD v clusteru | nedoporučeno | RCMD | – | [H6][T] |
| Jen 1 pNIC / single-port NIC | „Dual-port NICs recommended for redundancy.“ | RCMD | – | [H2][BCG] |
| Granite Rapids ReadyNode na VCF < 9.1 | možný pokles výkonu vSAN; „resolved in VCF 9.1“ | RCMD (upgrade) | 5.2 / [9.0]? | [H23][T] |
| OSA: SSD místo HDD v capacity tieru hybrid ReadyNode / míchání typů | nepodporovaná změna ReadyNode | REQ | – | [H14][T] |
| OSA: necertifikovaný I/O controller | „performance and availability issues“, nepodporováno | REQ | – | [H14][T] |
| ESX bez persistentního zařízení (jen USB/SD) | alarm „Secondary persistent device not found.“; v 9.1 deprecated | DEV | 9.1 | [H12][T] |
| Boot disk < 8 GB | upgrade blokován | REQ | 9.1 | [H12][T] |

## 6. Limity a čísla

### 6.1 vSAN ESA ReadyNode profily – Hardware Guidance [H2][BCG] (doslovná čísla)

**vSAN ESA HCI ReadyNode™ Hardware Guidance**

| Popis | vSAN-HCI-SM | vSAN-HCI-MED | vSAN-HCI-LRG |
|---|---|---|---|
| Node Capacity (TB, min) | 3.2 | 20 | 50 |
| CPU (cores/node, min) | 16 | 32 | 48 |
| Memory (GB/node, min) | 128 | 256 | 512 |
| Max Storage Devices for base configuration | 12 | 18 | 24 |
| Networking (GbE, min) | 10 | 25 | 100 |
| Performance for base configuration (IOPS/node, up to) | 50 K | 100 K | 150 K |

**vSAN ESA Storage Cluster ReadyNode™ Hardware Guidance**

| Popis | vSAN-SC-SM | vSAN-SC-MED | vSAN-SC-LRG |
|---|---|---|---|
| CPU (cores/node, min) | 16 | 32 | 48 |
| Memory (GB/node, min) | 128 | 192 | 256 |
| Nodes per Cluster (min) | 4 | 6 | 6 |
| Max Storage Devices for base configuration | 12 | 18 | 24 |
| Networking (E/W GbE) (min) | 25 | 25 | 100 |
| Networking (N/S GbE) (min) | 10 | 25 | 25 |
| Performance for base configuration (IOPS/node, up to) | 50 K | 75 K | 125 K |

SC kapacita: „Min Capacity per Node: 20 TB“, „Min Devices per Host Supported: 2“ (pro všechny SC profily).

**vSAN ESA Cyber Recovery ReadyNode™ Hardware Guidance** (pro hru zatím mimo rozsah)

| Popis | CyberRecovery-SM | CyberRecovery-MED | CyberRecovery-LRG |
|---|---|---|---|
| CPU (cores/node, min) | 16 | 24 | 32 |
| Memory (GB/node, min) | 128 | 192 | 256 |
| Nodes per Cluster (min) | 4 | 6 | 6 |
| Max Storage Devices for base configuration | 8 | 18 | 24 |
| Networking (GbE, min) | 10 | 25 | 25 |
| Replication Throughput (node, up to) | 150 MB/s | 225 MB/s | 300 MB/s |

„Note: Minimum number of devices across profiles must be 4“ (u tabulky Cyber Recovery).

Další body guidance [H2][BCG]:
- Výkonová čísla: „compute-bound mixed workloads using minimum configurations. vSAN can achieve much higher IOPS
  for storage-bound workloads.“
- „vSAN-HCI-SM or vSAN-SC-SM: ESXi 8.0 P04+ (see KB 372309 and KB 372311)“ – pro 9.x splněno automaticky.
- „Max Storage Devices for base configuration“ (12/18/24) je počet v **base** konfiguraci profilu; absolutní limit
  je 24 zařízení / host [H6][T] a `maxDrives` konkrétního modelu [H9][BCG].
- Shoda s [T]: SM minima 16 jader / 128 GB / 10GbE / ≥ 1.6 TB disk / max. 24 disků se shodují s Design Library 9.1
  [H4][T]. Pravidlo VCF „Larger vSAN ESA nodes require 25GbE“ [H4][T] je přísnější než BCG (MED 25 GbE min, LRG 100
  GbE doporučeno, odchylky podporované) – viz sekce 5 a OQ 6.

**Odvození profilu (pro model)** [SIMPL nad [BCG]]: profil konfigurace = nejvyšší profil, jehož **všechna** minima
(kapacita uzlu, jádra, RAM, síť) konfigurace splňuje **a** pro který je model v BCG certifikován (`profiles`).
Konfigurace, která nesplní ani SM → „pod HCI-SM“ (REQ, bez podpory GS). Pokud konfigurace splňuje výpočetní a
kapacitní minima vyššího profilu, ale ne síťové, hra ji vede v nižším profilu a ukáže DEV varování (guidance
příklad 25 Gb místo 100 Gb na LRG).

### 6.2 Statistika ReadyNode pro ESXi 9.1 [H9][BCG]

| Ukazatel | Hodnota |
|---|---|
| ReadyNode záznamů 5 vendorů s „ESXi 9.1 (vSAN 9.1)“ | 247 (Dell 32, HPE 26, Lenovo 76, Cisco 31, Supermicro 82); BCG celkem pro 9.1: 350 |
| Záznamů s profilem vSAN-HCI-SM / -MED / -LRG | 243 / 225 / 146 |
| Záznamů s profilem vSAN-SC-SM | 58 |
| Výskyt starých jmen `vSAN-ESA-AF-*` | 0 |
| PCIe switch u aktuálních generací (Příloha A) | „Not Supported, Direct Connect Only“ |
| Poznámka u Granite Rapids modelů | odkaz na KB 393469 (sekce 3.6) |

### 6.3 Ostatní čísla

| Položka | Hodnota | Zdroj |
|---|---|---|
| ESX min. jader / RAM | 2 jádra / 8 GB (produkčně ≥ 12 GB) | [H12][T] |
| ESX boot | min. 32 GB, doporučeno ≥ 128 GB, ≥ 128 TBW | [H12][T] |
| ESA zařízení / host | min. 1 (SC: 2; CR/QLC: 4), max. 24 | [H6][T][H2][BCG] |
| ESA disk | NVMe TLC, ≥ 1,6 TB, ≥ 1 DWPD, Class F+ (100 K–349 K writes/s), > 8 TB od ESXi 8.0 U1 | [H6][T][H2][BCG] |
| Kapacita uzlu (min) | HCI 3.2 / 20 / 50 TB (SM/MED/LRG); SC 20 TB | [H2][BCG] |
| NIC pro vSAN | min. 10GbE (HCI-SM); BCG MED ≥ 25, LRG ≥ 100 (doporučení); VCF: větší ESA uzly 25GbE | [H2][BCG][H4][H6][T] |
| 10Gb ESA kapacita | used + reserved ≤ 75 % | [H17][T] |
| OSA RAM pro max. disk groups | 32 GB | `10-planning` §6.2 |
| Hosty / cluster, pNIC / VDS | viz `10-planning` §6.1, §6.2 | – |

### 6.4 Statistika komponent v exportu `all.json` (ESXi 9.1) [BCG-data]

Zdroj: oficiální export [H22] (17. 11. 2026), výřez „podpora ESXi 9.1“ připravený orchestrátorem. Disky jsou
počítané podle pole `partnername` (OEM, pod kterým je disk certifikovaný).

| Partner | Flash disky (kategorie ssd) s 9.1 | z toho NVMe | NVMe s režimem „vSAN ESA“ | Pozn. |
|---|---|---|---|---|
| Dell | 1025 | 604 | **409** | |
| HPE | 1142 | 374 | **142** | |
| Cisco | 395 | 126 | **61** | |
| Lenovo | 368 | 71 | **0** | pod partnerem Lenovo jen disky pro vSAN OSA; Lenovo ESA disky („ThinkSystem …“) jsou ale v BOM Lenovo ReadyNode [H9][BCG] |
| Supermicro | – | – | – | žádné položky s partnerem Supermicro; v BOM Supermicro ReadyNode jsou disky výrobců (Kioxia, Solidigm, Samsung, Intel) [H9][BCG] |

| NIC (ESXi 9.1) | Počet | Pozn. |
|---|---|---|
| Všechny NIC v exportu s podporou 9.1 | 293 | všechny mají režim „vSAN ESA“; `vcglink` vede do `program=rdmanic` |
| z toho partner Supermicro | 1 | `AOC-A25G-m2SM` |

Pozn.: Export neuvádí u disků endurance (DWPD) ani performance class; DWPD je u disků v BOM ReadyNode [H9][BCG].

## 7. Síťový provoz (NIC / uplinky)

Jen fyzická vrstva hosta; logické toky (vmk, VLAN, MTU) jsou v `10-planning` §7.

| # | Odkud | Kam | Médium / rychlost | Pozn. | Zdroj |
|---|---|---|---|---|---|
| 1 | pNIC hosta (uplink VDS) | ToR switch (ve hře generický) | Ethernet, min. 10GbE pro vSAN; 25GbE doporučeno | Single VDS = 2 pNIC; Storage and Workload Separation = 6 pNIC (`10-planning` §3.3); dual-port NIC doporučeny | [H4][T][H2][BCG] |
| 2 | vSAN vmk přes pNIC (HCI) | ostatní hosty clusteru | HCI-SM 10 GbE, HCI-MED 25 GbE, HCI-LRG 100 GbE (min. dle guidance; odchylky podporované); VCF: větší ESA ≥ 25GbE | 2 pNIC (malé profily) / 4 pNIC (velké) | [H2][BCG][H4][H5][T] |
| 3 | vSAN Storage Cluster uzly | ostatní uzly SC (E/W) | E/W: SC-SM 25, SC-MED 25, SC-LRG 100 GbE | | [H2][BCG] |
| 4 | vSAN Storage Cluster uzly | klientské (compute) clustery (N/S) | N/S: SC-SM 10, SC-MED 25, SC-LRG 25 GbE | | [H2][BCG] |
| 5 | Cyber Recovery uzly | replikace | 10 / 25 / 25 GbE; replikace až 150 / 225 / 300 MB/s na uzel | mimo rozsah hry | [H2][BCG] |
| 6 | RDMA NIC (volitelné) | ostatní vSAN hosty | vSAN over RDMA – certifikované RDMA NIC (`program=rdmanic`) | může nahradit běžnou NIC v ESA ReadyNode | [H6][T] |
| 7 | FC HBA | FC fabric / pole | FC | jen při VMFS na FC principal storage | `10-planning` §3.5 |

## 8. Otevřené otázky

**Zbývající**
1. **Kapacitní body disků** – BOM ReadyNode uvádí jen rodinu disku a DWPD (např. „ThinkSystem U.3 7500 MAX
   [3 DWPD]“), ne kapacity. Kapacity jsou ověřené jen tam, kde jde položku spárovat s `all.json` (Dell, HPE, Cisco –
   párování podle názvu je [SIMPL]); pro Lenovo a Supermicro chybí → v katalogu [SIMPL] (guidance povoluje
   „alternative capacity points“). Řešení: rozšířit `tools/bcg` o stažení `program=ssd` detailů pro názvy z BOM.
2. **KB 427591 vs. BCG**: KB uvádí Dell XR4510C jako „only certified till ESXi 8.0 U3“, BCG data dnes XR4510C
   (productId 62959) vedou s „ESXi 9.0 (vSAN 9.0)“ a „ESXi 9.1 (vSAN 9.1)“, profil jen vSAN-HCI-SM, max. 20 jader,
   256 GB [H20][BCG]. KB je zřejmě starší než aktualizace BCG; chybový stav platí, příklad ne. Herně nepoužívat XR4510C
   jako „nekompatibilní“ server.
3. **Profily per release** – `profiles` v datasetu je sjednocení profilů ze sekce „ReadyNode…“ detailu; není
   ověřeno, zda BCG může mít pro různé releases (8.0 vs 9.x) různé profily jednoho modelu.
4. **[9.0] vs [9.1] profily** – pro 9.1 v BCG jen HCI/SC/CR jména (0 × AF-x). Zda záznamy s filtrem „ESXi 9.0“
   používají stejná jména, nestaženo (stačí spustit `tools/bcg/fetch-readynodes.sh "ESXi 9.0 (vSAN  9.0)"`).
   Design Library 9.0 ESA stránka dříve vrátila 404 (`10-planning` OQ 8).
5. **NIC bez rychlosti v názvu** – Dell „BCM57412“, „BCM57504“, „BCM57508“, Cisco „UCS VIC 15xxx“: dataset rychlost
   neuvádí. V katalogu se nepoužívají; Dell „Broadcom 57412 10G BT Dual Port“ a ostatní s rychlostí v názvu ano
   (rychlost z názvu = [SIMPL] interpretace názvu).
6. **10GbE na MED/LRG – co platí pro VCF**: BCG guidance = podporovaná odchylka (DEV); Design Library 9.1 = „REQD“
   25GbE pro větší ESA uzly. Není zdokumentováno, zda VCF Installer / SDDC Manager takový host blokuje, ani hláška.
   Hra: varování DEV + příznak „nesoulad s VCF Design Library“, ne blokace.
7. **vSAN OSA ReadyNode profily pro 9.1** (`program=vsanosa`) – nestaženy. Dřívější indexová zmínka „the listings
   for 9.1 is a preview and contains preliminary data“ u OSA (Dell) byla [BCG-idx] a je odstraněna; ověřit při
   stažení OSA dat.
8. **Boot zařízení**: KB 326717 a guidance odkazují na KB 85685, KB 326476 na KB 313169 – nečteno. Některé ReadyNode
   uvádějí jediné boot SSD (např. Cisco C240-M8E3S „480GB M.2 Boot Solidigm S4520 SATA 1X SSD“) – ESX docs RAID 1 jen
   doporučují [H12].
9. **Homogenita vs. ReadyNode profil**: dokumentace nespecifikuje, zda smí v jednom clusteru být hosty stejného
   modelu, ale různého profilu (např. SM + MED). `10-planning` vyžaduje homogenní konfiguraci → hra zatím: ne.
10. **KB 393469 a VCF 9.0**: KB popisuje VCF 5.2 a opravu ve VCF 9.1; dopad na 9.0 neuveden.
11. Přesná hláška validace installeru pro ESA host pod minimem jader / RAM / kapacity uzlu není v dokumentaci →
    hra použije obecnou herní hlášku označenou jako herní.
12. **Výška v U – nedohledané / neověřené modely** (Příloha C): Cisco UCSX-215c-M8 (63602) je compute node
    X-Series, který se zasouvá do šasi, ne přímo do racku, takže vlastní výšku v U nemá. Výška šasi nebyla
    dohledána. Pro ostatní „další aktuální záznamy“ z A.2–A.5 (např. DL325/DL345 Gen11/Gen12, SR645/SR665/SR675 V3,
    ThinkAgile VX/FX, HCIVS*/HCIX*, další Supermicro) výška zatím dohledaná není. U Cisco 64136 je ověřen jen part
    number UCSC-C240-M8SX, ne HCIVS240C-M8SN.
13. **Multi-node šasi** (Supermicro SYS-222BT-DNR, BigTwin): vendor uvádí „A 2U 2-node BigTwin® server“. Jeden BCG
    záznam tedy zřejmě odpovídá jednomu nodu, ale dokumentace BCG to výslovně neříká. Otevřené je, jak to má
    hra modelovat (2 nody v jednom 2U šasi, nebo model vynechat) – v B.3 se nepoužívá.

**Uzavřené (zodpovězeno daty [BCG])**
- ~~ReadyNode / servery jen z indexu~~ → 247 záznamů z BCG API [H9].
- ~~MED/LRG profily neověřené~~ → doslovná tabulka guidance [H2] (sekce 6.1); čísla z indexu se potvrdila beze změny.
- ~~Konkrétní konfigurace modelů HPE / Lenovo / Cisco / Supermicro~~ → Příloha A.
- ~~Lenovo ESA disky~~ → v BOM Lenovo ReadyNode jsou „ThinkSystem …“ NVMe disky s DWPD (např. SR650 V4: U.3 7500
  PRO/MAX, U.2/E3.S CD8P, PM9D3a, PM9D5a, U.2 7600 PRO/MAX) [H9]; jen v `all.json` nejsou pod partnerem Lenovo.
- ~~Supermicro disky~~ → BOM Supermicro uvádí disky výrobců (Kioxia CM7/CD8P, Solidigm D7-P5520/P5620/PS1010,
  Samsung PM9D3a, Intel D7-P5520/P5620) [H9].
- ~~Je díl v BOM konkrétního serveru?~~ → ano, `esaDrives` a `nics` per model [H9] (párování s `all.json` viz OQ 1).
- ~~Rozpor „Max. zařízení v base konfiguraci 12“ vs. „max 24“~~ → guidance výslovně „for base configuration“;
  absolutní limit 24 / host [H6] a `maxDrives` modelu.
- ~~QLC jen pro CR, 9.1+, min. 4 zařízení~~; ~~HCI-SM / SC-SM ESXi 8.0 P04+~~; ~~dual-port NIC doporučeny~~ →
  potvrzeno doslovným textem guidance [H2].

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
- [H23] KB 393469 – Guidance for vSAN on Intel® Xeon® 6700/6500-Series Processors with P-Cores (codenamed „Granite Rapids“) (přečteno 2026-11-21; odkaz z poznámky ReadyNode v BCG): https://knowledge.broadcom.com/external/article/393469

Oficiální web BCG [BCG]:
- [H2] vSAN ESA ReadyNode Hardware Guidance: https://compatibilityguide.broadcom.com/pages/vsan-esa-readynode-hardware-guidance –
  doslovný text v `docs/spec/data/bcg-vsan-esa-readynode-hardware-guidance.md` (2026-11-21).
- [H3] BCG – vSAN ESA ReadyNodes search: https://compatibilityguide.broadcom.com/search?program=vsanesa&persona=live&column=vendor&order=asc
- [H9] BCG ReadyNode data (API `POST https://compatibilityguide.broadcom.com/compguide/programs/viewResults` a
  `…/viewDetails?programId=vsanesa&id=<productId>`), filtr „ESXi 9.1 (vSAN 9.1)“, staženo 2026-11-21T00:29Z:
  `docs/spec/data/bcg-vsan-esa-readynodes-esxi91.json`; u každého modelu je odkaz `bcgUrl`
  (`https://compatibilityguide.broadcom.com/detail?program=vsanesa&productId=<id>&persona=live`). Obnova:
  `tools/bcg/fetch-readynodes.sh`.
- [H20] BCG – Dell PowerEdge XR4510C (vSAN ESA): https://compatibilityguide.broadcom.com/detail?program=vsanesa&productId=62959&persona=live

Oficiální datový export BCG [BCG-data]:
- [H22] vSAN HCL data export (BCG backend), `jsonUpdatedTime` „November 17, 2026, 8:59 AM UTC“, 9483 položek
  (controller / hdd / ssd / nic), staženo orchestrátorem: https://vvs.broadcom.com/service/vsan/all.json –
  na tento soubor odkazuje KB 427591 → KB 412606 (aktualizace vSAN HCL DB pro VCF Installer). U každé položky
  v katalogu je uveden její `vcglink` (BCG detail).

Vendorské datasheety [VEND] (jen výška v U; odkaz per model v Příloze C a v `docs/spec/data/server-rack-units.json`):
- [V1] Dell – PowerEdge Installation and Service Manual, kapitola „system configurations and features“ (dell.com/support)
- [V2] HPE – produktové stránky HPE Store (buy.hpe.com); stránky QuickSpecs na hpe.com při čtení vypršely (timeout)
- [V3] Lenovo – Lenovo Press Product Guides (lenovopress.lenovo.com), tabulka specifikací, řádek „Form factor“
- [V4] Cisco – UCS C-Series Data Sheets (cisco.com), „Form factor“ a „Ordering information“
- [V5] Supermicro – produktové stránky (supermicro.com), Chassis → „Form Factor“

---

## Příloha A – Aktuální generace ReadyNode 5 vendorů (ESXi 9.1) [BCG]

Zdroj: [H9] (filtr „ESXi 9.1 (vSAN 9.1)“), odkaz = `bcgUrl` modelu
(`https://compatibilityguide.broadcom.com/detail?program=vsanesa&productId=<ID>&persona=live`). Vybrány jsou
generace **Intel Xeon 6700P/6500P (Granite-Rapids-SP)** a **AMD EPYC (Turin)**. Zkratky profilů: HCI = vSAN-HCI,
SC = vSAN-SC, CR = vSAN-CR; „S/M/L“ = SM/MED/LRG. Všechny uvedené modely mají Supported Releases „ESXi 8.0 U3“,
„ESXi 9.0“ a „ESXi 9.1“ a PCIe switch „Not Supported, Direct Connect Only“. Granite Rapids modely mají poznámku
o KB 393469 (sekce 3.6).

### A.1 Dell

| Model (productId) | CPU | Profily | Max. socket × jader | Max. RAM GB | Max. disků | Boot |
|---|---|---|---|---|---|---|
| PowerEdge R470 ([63908](https://compatibilityguide.broadcom.com/detail?program=vsanesa&productId=63908&persona=live)) | Granite Rapids | HCI S/M/L, CR S/M/L | 1 × 86 | 4096 | 16 | BOSS + 2 M.2 ≥ 480 GB (RAID 1) |
| PowerEdge R570 ([63907](https://compatibilityguide.broadcom.com/detail?program=vsanesa&productId=63907&persona=live)) | Granite Rapids | HCI S/M/L, CR S/M/L | 1 × 86 | 4096 | 16 | BOSS + 2 M.2 ≥ 480 GB (RAID 1) |
| PowerEdge R670 ([63567](https://compatibilityguide.broadcom.com/detail?program=vsanesa&productId=63567&persona=live)) | Granite Rapids | HCI S/M/L, CR S/M/L | 2 × 86 | 8192 | 20 | BOSS + 2 M.2 ≥ 480 GB (RAID 1) |
| PowerEdge R770 ([63566](https://compatibilityguide.broadcom.com/detail?program=vsanesa&productId=63566&persona=live)) | Granite Rapids | HCI S/M/L, CR S/M/L | 2 × 86 | 8192 | 24 | BOSS + 2 M.2 ≥ 480 GB (RAID 1) |
| PowerEdge R6715 ([63414](https://compatibilityguide.broadcom.com/detail?program=vsanesa&productId=63414&persona=live)) | EPYC Turin | HCI S/M, CR S/M/L (bez HCI-LRG) | 1 × 192 | 3072 | 16 | BOSS … |
| PowerEdge R7715 ([63413](https://compatibilityguide.broadcom.com/detail?program=vsanesa&productId=63413&persona=live)) | EPYC Turin | HCI S/M, CR S/M/L (bez HCI-LRG) | 1 × 192 | 6144 | 16 | BOSS … |
| PowerEdge R6725 ([63648](https://compatibilityguide.broadcom.com/detail?program=vsanesa&productId=63648&persona=live)) | EPYC Turin | HCI S/M/L, CR S/M/L | 2 × 192 | 3072 | 16 | BOSS … |
| PowerEdge R7725 ([63559](https://compatibilityguide.broadcom.com/detail?program=vsanesa&productId=63559&persona=live)) | EPYC Turin | HCI S/M/L, CR S/M/L | 2 × 192 | 6144 | 24 | BOSS … |

- **ESA disky** (vše E3.S): PS1010 [1], PS1030 [3], CM7 [1]/[3], 9550 [1]/[3], 9550 FIPS [1]/[3], PE1010 [1],
  PE1030 [3], CD8P [1], CD8p [3], PM1743 [1], PM1745 [3]; R770 navíc „Dell E3.S PM9D5a [3 DWPD]“ a „Dell U.2 PM9D5a
  [3 DWPD]“ ([číslo] = DWPD). Žádný z 8 Dell modelů v tabulce nemá SC profily.
- **NIC**: R470 / R570: „BCM57412“, „BCM57504“, „NVIDIA ConnectX-6 Dx Dual Port 100GbE QSFP56“. R670 / R770:
  „Broadcom 57412 10G BT Dual Port“, „BCM57504“, „NVIDIA ConnectX-6 LX Dual Port 25 GbE SFP OCP3.0 Network Adapter“,
  „NVIDIA ConnectX-6 Dx Dual Port 100GbE QSFP56“. R7715: „BCM57412“, „BCM57504“, „NVIDIA ConnectX-6LX Dual Port 25G
  GbE SFP28 Network Adapter“. R6715: „BCM57412“, „BCM57504“. R6725 / R7725: „BCM57412“, „BCM57504“, „BCM57508“.

### A.2 HPE

| Model (productId) | CPU | Profily | Max. socket × jader | Max. RAM GB | Max. disků | Boot |
|---|---|---|---|---|---|---|
| ProLiant DL360 Gen12 ([63562](https://compatibilityguide.broadcom.com/detail?program=vsanesa&productId=63562&persona=live)) | Granite Rapids | HCI S/M/L, SC M/L, CR S/M/L | 2 × 86 | 8192 | 20 | HPE NS204i-u V2 480GB NVMe … P78279-B21 |
| ProLiant DL380 Gen12 ([63561](https://compatibilityguide.broadcom.com/detail?program=vsanesa&productId=63561&persona=live)) | Granite Rapids | HCI S/M/L, SC M/L, CR S/M/L | 2 × 86 | 8192 | 24 | HPE NS204i-u V2 480GB NVMe … P78279-B21 |
| ProLiant DL320 Gen12 ([63564](https://compatibilityguide.broadcom.com/detail?program=vsanesa&productId=63564&persona=live)) | Granite Rapids | HCI S/M/L, SC M/L, CR S/M/L | 1 × 80 | 4096 | 20 | NS204i-u V2 480GB |
| ProLiant DL340 Gen12 ([63563](https://compatibilityguide.broadcom.com/detail?program=vsanesa&productId=63563&persona=live)) | Granite Rapids | HCI S/M/L, SC M/L, CR S/M/L | 1 × 80 | 4096 | 24 | NS204i-u V2 480GB |
| ProLiant DL365 Gen11 ([63148](https://compatibilityguide.broadcom.com/detail?program=vsanesa&productId=63148&persona=live)) | EPYC Turin | HCI S/M/L, SC S/M/L, CR S/M/L | 2 × 160 | 6144 | 20 | HPE NS204i-u Gen11 NVMe … P48183-B21 |
| ProLiant DL385 Gen11 ([63146](https://compatibilityguide.broadcom.com/detail?program=vsanesa&productId=63146&persona=live)) | EPYC Turin | HCI S/M/L, SC S/M/L, CR S/M/L | 2 × 160 | 6144 | 24 | HPE NS204i-u Gen11 NVMe … P48183-B21 |

- Další aktuální HPE záznamy (jen název + CPU z [H9], detail neopsán): DL325 Gen11 (63107), DL345 Gen11 (63106),
  DL325 Gen12 (63900), DL345 Gen12 (63899) – EPYC Turin; Synergy 480 Gen12 (63650) – Granite Rapids.
- DL320 / DL340 / DL360 / DL380 Gen12 (Granite Rapids) nemají **vSAN-SC-SM** (jen SC-MED/LRG); Turin DL365/DL385
  Gen11 mají i SC-SM.
- **ESA disky** (36 položek u DL380 Gen12): E3.S a U.3, „MU“ = 3 DWPD, „RI“ = 1 DWPD dle názvů v BOM, např. „HPE E3.S
  MU CM7 [3 DWPD]“, „HPE E3.S MU 9550 [3 DWPD]“, „HPE U.3 MU CM7 [3 DWPD]“, „HPE E3.S RI PS1010 [1 DWPD]“, „HPE E3.S
  MU CD9P [3 DWPD]“. **Cyber Recovery disk**: „HPE E3.S VRO P5430 [0.51 DWPD]“.
- **NIC** (všechny uvedené HPE modely): „Mellanox MCX623106AS-CDAT Ethernet 100Gb 2-port QSFP56 Adapter for HPE
  P25960-B21“ (Turin modely: „HPE Ethernet 100Gb 2-port QSFP56 MCX623106AS-CDAT Adapter P25960-B21“), „Broadcom
  BCM57414 Ethernet 10/25Gb 2-port SFP28 Adapter for HPE P26262-B21“, „Mellanox MCX631102AS-ADAT Ethernet 10/25Gb
  2-port SFP28 Adapter for HPE P42044-B21“.

### A.3 Lenovo

| Model (productId) | CPU | Profily | Max. socket × jader | Max. RAM GB | Max. disků | Boot |
|---|---|---|---|---|---|---|
| ThinkSystem SR630 V4 ([63600](https://compatibilityguide.broadcom.com/detail?program=vsanesa&productId=63600&persona=live)) | Granite Rapids | HCI S/M/L, CR S/M/L | 2 × 86 | 8192 | 16 | ThinkSystem M.2 RAID B545i-2i SATA/NVMe Enablement Kit |
| ThinkSystem SR650 V4 ([63599](https://compatibilityguide.broadcom.com/detail?program=vsanesa&productId=63599&persona=live)) | Granite Rapids | HCI S/M/L, CR S/M/L | 2 × 86 | 8192 | 24 | ThinkSystem M.2 RAID B545i-2i SATA/NVMe Enablement Kit |
| ThinkSystem SR650a V4 ([63624](https://compatibilityguide.broadcom.com/detail?program=vsanesa&productId=63624&persona=live)) | Granite Rapids | HCI S/M/L, CR S/M/L | 2 × 86 | 8192 | 8 | ThinkSystem M.2 RAID B545i-2i … |
| ThinkSystem SR635 V3 ([63179](https://compatibilityguide.broadcom.com/detail?program=vsanesa&productId=63179&persona=live)) | EPYC Turin | HCI S/M/L, CR S/M/L | 1 × 160 | 3072 | 16 | ThinkSystem M.2 NVMe 2-Bay RAID Adapter |
| ThinkSystem SR655 V3 ([63180](https://compatibilityguide.broadcom.com/detail?program=vsanesa&productId=63180&persona=live)) | EPYC Turin | HCI S/M/L, CR S/M/L | 1 × 160 | 3072 | 24 | ThinkSystem M.2 NVMe 2-Bay RAID Adapter |

- Další aktuální Lenovo záznamy (název + CPU z [H9]): SR645 V3, SR665 V3, SR675 V3 (Turin); ThinkAgile VX630 V4,
  VX650 V4, VX650a V4, FX630 V4, FX650 V4 (Granite Rapids); VX635/VX645/VX655/VX665 V3 (Turin); VX850 V4 („Intel Xeon
  6700P 4-Socket“).
- **ESA disky** SR630 V4 / SR650 V4: „ThinkSystem E3.S CD8P [1/3 DWPD]“, „U.3 7500 PRO [1]“, „U.3 7500 MAX [3]“,
  „U.2 PM9D3a [1]“, „U.2 PM9D5a [3]“, „U.2 CD8P [1/3]“, „E3.S PM9D3a [1]“, „U.2 7600 PRO [1]“, „U.2 7600 MAX [3]“.
- **NIC** SR630 V4 / SR650 V4: „Lenovo-4XC7A62582-ThinkSystem Mellanox ConnectX-6 Lx 10/25GbE SFP28 2-port OCP
  Ethernet Adapter“, „ThinkSystem Broadcom 57414 10/25GbE SFP28 2-port OCP Ethernet Adapter(4XC7A08237)“,
  „ThinkSystem Broadcom 57508 100GbE QSFP56 2-Port OCP Ethernet Adapter (4XC7A08243)“. SR635/SR655 V3: CX-6 Lx 10/25GbE
  (4XC7A62582) a „Lenovo- 4XC7A08248-ThinkSystem Mellanox ConnectX-6 Dx 100GbE QSFP56 2-port PCIe Ethernet Adapter“.
- Žádný z Lenovo modelů v tabulce (ani přečtené VX630/VX650 V4, FX630/FX650 V4, VX635/VX655 V3) nemá SC profily.

### A.4 Cisco

| Model (productId) | CPU | Profily | Max. socket × jader | Max. RAM GB | Max. disků | Boot |
|---|---|---|---|---|---|---|
| UCSC-C220-M8S ([64247](https://compatibilityguide.broadcom.com/detail?program=vsanesa&productId=64247&persona=live)) | Granite Rapids | HCI S/M/L, SC S/M/L, CR S/M/L | 2 × 86 | 8192 | 8 | Micron_5400_MTFDDAV480TGA – 480GB M.2 SATA SSD |
| UCSC-C220-M8E3S ([64134](https://compatibilityguide.broadcom.com/detail?program=vsanesa&productId=64134&persona=live)) | Granite Rapids | HCI S/M/L, SC S/M/L, CR S/M/L | 2 × 86 | 8192 | 16 | Micron_5400_MTFDDAV240TGA – 240GB SATA M.2 |
| UCSC-C240-M8SX, HCIVS240C-M8SN ([64136](https://compatibilityguide.broadcom.com/detail?program=vsanesa&productId=64136&persona=live)) | Granite Rapids | HCI S/M/L, SC S/M/L (bez CR) | 2 × 86 | 8192 | 8 | 2x Micron_5400_MTFDDAV240TGA – 240GB SATA M.2 |
| UCSC-C240-M8E3S ([63932](https://compatibilityguide.broadcom.com/detail?program=vsanesa&productId=63932&persona=live)) | Granite Rapids | HCI S/M/L, SC S/M/L, CR S/M/L | 2 × 86 | 8192 | 24 | 480GB M.2 Boot Solidigm S4520 SATA 1X SSD |
| UCSC-C225-M8N ([63601](https://compatibilityguide.broadcom.com/detail?program=vsanesa&productId=63601&persona=live)) | EPYC Turin | HCI S/M/L, SC S/M/L, CR S/M/L | 1 × 160 | 3072 | 10 | UCS-M2-HWRAID |
| UCSC-C245-M8SX ([63625](https://compatibilityguide.broadcom.com/detail?program=vsanesa&productId=63625&persona=live)) | EPYC Turin | HCI S/M/L, SC S/M/L, CR S/M/L | 2 × 192 | 6144 | 8 | UCS-M2-HWRAID |
| UCSX-215c-M8 ([63602](https://compatibilityguide.broadcom.com/detail?program=vsanesa&productId=63602&persona=live)) | EPYC Turin | HCI S/M/L, SC S/M, CR S/M/L | 2 × 192 | 6144 | 8 | UCS-M2-HWRAID |

- Další aktuální Cisco záznamy (název + CPU z [H9]): UCSX-210C-M8, HCIVS220C-M8E3S (jen HCI-SM/MED), HCIVS220C-M8SN,
  HCIVS240C-M8E3S, HCIXVS210C-M8SN (Granite Rapids); HCIVS225C-M8SN, HCIXVS215C-M8SN, HCIVS245C-M8SN (Turin).
- **ESA disky**: C220-M8S / C240-M8SX: „Cisco U.3 7450 [1]/[3]“, „Cisco U.3 7500 [1]/[3]“; C220-M8E3S / C240-M8E3S:
  „Cisco E3.S CD8P-R SIE [1]“, „Cisco E3.S CD8P-V SIE [3]“, „Cisco E3.S PM1743 [1]“, „Cisco E3.S PM1745 [3]“.
- **NIC** C220-M8S (13 položek): UCS VIC 15425 / 15427, „Cisco-NVDA MCX631432AC-ADAB CX6 Lx 2x25G SFP28 x8 OCP NIC“,
  „Cisco-NVDA MCX623436AC-CDAB CX6Dx 2x100G QSFP56 x16 OCP NIC“, „Cisco(R) X710T2LG 2x10 GbE RJ45 PCIe NIC“, „Cisco(R)
  X710T4LG 4x10 GbE RJ45 PCIe NIC“, „Cisco(R) E810XXVDA2 2x25/10 GbE SFP28 PCIe NIC“, „Cisco(R) E810XXVDA4 4x25/10 GbE
  SFP28 PCIe NIC“, „Cisco-MLNX MCX623106AC-CDAT 2x100GbE QSFP56 PCIe NIC“, „Cisco-MLNX MCX623106AS-CDAT 2x100GbE QSFP56
  PCIe NIC“, „Cisco(R) E810CQDA2 2x100 GbE QSFP28 PCIe NIC“, „Cisco-NVDA MCX631102AS-ADAT CX6 Lx 2x25G SFP28 x8 PCIe“,
  „Cisco-NVDA MCX713104AS-ADAT 4x25GbE SFP56 Gen4 x16 PCIe NIC“. C240-M8E3S má stejnou sadu + UCS VIC 15235 / 15237.

### A.5 Supermicro

| Model (productId) | CPU | Profily | Max. socket × jader | Max. RAM GB | Max. disků | Boot |
|---|---|---|---|---|---|---|
| SYS-122H-TN ([64010](https://compatibilityguide.broadcom.com/detail?program=vsanesa&productId=64010&persona=live)) | Granite Rapids | HCI S/M/L, CR S/M/L | 2 × 86 | 1024 | 12 | „M.2 NVMe 480GB or higher“ |
| SYS-222H-TN ([63933](https://compatibilityguide.broadcom.com/detail?program=vsanesa&productId=63933&persona=live)) | Granite Rapids | HCI S/M/L, SC S/M/L, CR S/M/L | 2 × 86 | 1024 | 24 | „HDS-MMN-MTFDKBA960TFR1BC“ |
| SYS-122C-TN ([64009](https://compatibilityguide.broadcom.com/detail?program=vsanesa&productId=64009&persona=live)) | Granite Rapids | HCI S/M/L, SC S/M/L, CR S/M/L | 2 × 86 | 1024 | 12 | „HDS-MMN-MTFDKBA960TFR1BC“ |
| SYS-222BT-DNR ([63934](https://compatibilityguide.broadcom.com/detail?program=vsanesa&productId=63934&persona=live)) | Granite Rapids | HCI S/M/L, SC S/M/L, CR S/M/L | 2 × 86 | 1024 | 12 | „HDS-MMN-MTFDKBA960TFR1BC“ |
| AS-2126HS-TN ([63173](https://compatibilityguide.broadcom.com/detail?program=vsanesa&productId=63173&persona=live)) | EPYC Turin | HCI S/M/L, SC S/M/L, CR S/M/L | 2 × 192 | 1024 | 24 | „Samsung MZ1LW960HMJP-00003“ |

- Další aktuální Supermicro záznamy (název + CPU z [H9]): SYS-112H-TN, SYS-112C-TN, SYS-222C-TN, Sys-212H-TN,
  SYS-222BT-HER/-HNR/-HNC8R/-HNC9R/-HNR-LCC (LCC: jen HCI-SM/MED, max. 6 disků), SYS-622BT-*, SBI-612B-1NE34
  (Granite Rapids); AS-1116CS-TN, AS-1126HS-TN, AS-2015HS-TNR, AS-1115HS-TNR, AS-2115HS-TNR (Turin); SYS-442B-NR,
  SYS-242B-NR, SYS-242H-NR („Intel Xeon 6700P 4-Socket“).
- **Max. RAM 1024 GB** u všech uvedených Supermicro modelů – nižší než u ostatních vendorů.
- **ESA disky** SYS-122H-TN / SYS-222H-TN: „Intel U.2 D7-P5520 [1]“, „Intel U.2 D7-P5620 [3]“, „Kioxia U.2 CD8P-R
  Series [1]“, „Kioxia U.2 CD8P-V Series [3]“, „Kioxia U.2 CM7-R Series [1]“, „Kioxia U.2 CM7-V Series [3]“, „Samsung
  U.2 PM9D3a Series [1]“, „Solidigm U.2 D7-P5520 [1]“, „Solidigm U.2 D7-P5620 [3]“, „Solidigm U.2 D7-PS1010 Series [1]“.
  SYS-122C-TN / SYS-222BT-DNR jen Kioxia CM7-R/-V, CD8P-R/-V.
- **NIC** (Granite Rapids modely): „AOC-A100G-m2CM“, „AOC-A25G-m2SM“, „AOC-A25G-i2SM“; AS-2126HS-TN: „AOC-A25G-m2SM“,
  „AOC-A100G-m2CM“.

### A.6 Starší generace použitelné pro 9.1 (výběr, pro scénáře migrace / upgradu) [H9][BCG]
- HPE ProLiant DL380 Gen11 – dva záznamy: Sapphire-Rapids-SP (62979) a Emerald-Rapids-SP
  ([62980](https://compatibilityguide.broadcom.com/detail?program=vsanesa&productId=62980&persona=live); releases
  ESXi 8.0 U1 – 9.1; HCI S/M/L, SC M/L, CR S/M/L; 2 × 64 jader; 8192 GB).
- Supermicro SYS-421GE-TNRT ([63110](https://compatibilityguide.broadcom.com/detail?program=vsanesa&productId=63110&persona=live);
  Emerald-Rapids-SP; ESXi 8.0 U1 – 9.1; HCI S/M/L, SC M/L, CR S/M/L; 2 × 64; 1024 GB; 16 disků; ESA disk jen
  „Kioxia U.2 CD8-V [3 DWPD]“; NIC AOC-A100G-m2CM, AOC-A25G-m2SM; boot MTFDKBG960TFR1B).
- Dell PowerEdge XR4510C ([62959](https://compatibilityguide.broadcom.com/detail?program=vsanesa&productId=62959&persona=live);
  Intel Xeon D (Ice Lake-D); ESXi 8.0 U2 – 9.1; **jen HCI-SM**; 1 × 20 jader; 256 GB; 4 disky; NIC BCM57416) – viz OQ 2.
- Lenovo ThinkAgile VX3331 Node (62873; Ice-Lake-SP; ESXi 8.0 – 9.1; HCI S/M + CR) – příklad starší generace,
  která má 9.1 certifikaci.

---

## Příloha B – Návrh herního katalogu

**Pravidla pro model:** validace smí používat pravidla [T] a [BCG] (sekce 3, 5, 6). **Servery, jejich limity
(max. jader/socket, socketů, RAM, disků), seznam povolených disků (rodina + DWPD), NIC a boot** jsou [BCG] z [H9].
**Kapacitní body disků** jsou [BCG-data] tam, kde jde položku `all.json` spárovat s názvem v BOM (párování podle
názvu = [SIMPL]); jinak [SIMPL] v mezích guidance („You may select alternative capacity points as long as the Node
Capacity and Performance/Endurance requirements are satisfied“ [H2]). **Počet jader, RAM, počet disků a počet NIC
v konkrétní konfiguraci jsou [SIMPL]** (v mezích modelu a nad minimy profilu). Rychlost NIC = z názvu NIC [SIMPL].
Bez cen (ceny a rozpočty jsou herní mechanika Kariéry).

### B.1 Atributy, které model validuje

| Atribut | Typ | Pravidlo (zdroj) |
|---|---|---|
| `vendor` | Dell / HPE / Lenovo / Cisco / Supermicro | homogenita vendora v počátečním mgmt clusteru (`10-planning` §3.4) |
| `bcgProductId`, `supportedReleases` | int, seznam | musí obsahovat cílovou verzi („ESXi 9.1 (vSAN 9.1)“; **[9.0]** „ESXi 9.0 (vSAN 9.0)“), jinak „ESX Host is not HCL compatible.“ [H10][T][H9][BCG] |
| `certifiedProfiles` | seznam | z `profiles` modelu [H9][BCG]; strop pro odvozený profil (6.1) |
| `sockets`, `coresPerSocket` | int | ≤ `maxSockets`, ≤ `maxCoresPerSocket` [H9][BCG]; jádra / uzel ≥ 16 (SM) / 32 (MED) / 48 (LRG) [H2][BCG][H4][T]; SMT se nepočítá (`10-planning` §3.4) |
| `ramGB` | int | ≤ `maxMemoryGB` [H9][BCG]; ≥ 128 / 256 / 512 (HCI) [H2][BCG]; ESX ≥ 8 [H12][T] |
| `drives` | count × rodina z `esaDrives` × TB | ESA: jen rodiny z `esaDrives` modelu [H9][BCG]; NVMe TLC, ≥ 1,6 TB, ≥ 1 DWPD, ≥ Class F, 1–24 ks a ≤ `maxDrives` [H6][T][H2][H9][BCG]; kapacita uzlu ≥ 3.2 / 20 / 50 TB [H2][BCG]; disky z `cyberRecoveryDrives` jen pro CR; OSA: ≥ 1 disk group (`10-planning` §3.4) |
| `triModeController` | bool | NVMe za Tri-Mode → ESA nevalidní [H4][T] |
| `nics` | count × NIC z `nics` × GbE | ≥ 10GbE (SM) / 25 (MED) / 100 (LRG) – pod MED/LRG = DEV [H2][BCG]; VCF: nad SM ≥ 25GbE [H4][T]; dual-port doporučeno [H2][BCG]; počet portů dle VDS modelu (2 / 4 / 6, `10-planning` §3.3) |
| `boot` | `bootDevice` modelu | [H9][BCG]; ≥ 32 GB min., ≥ 128 GB doporučeno [H12][T] |
| `esaProfile` (odvozený) | pod-SM / SM / MED / LRG | sekce 6.1 (pravidlo odvození [SIMPL] nad [BCG]) |
| `findings` (odvozené) | seznam {třída REQ/DEV/RCMD, zdroj} | sekce 5 |

### B.2 Katalog dílů [BCG-data] ↔ BOM [BCG]

Disky a NIC z `all.json` [H22] (ESXi 9.1, režim „vSAN ESA“), u každé položky odkaz `vcglink`, a k nim název z BOM
ReadyNode [H9], se kterým je herně spárovaná (párování podle rodiny / formátu / part number = [SIMPL]).

**Disky – vSAN ESA**

| Part ID | Název v `all.json` (GB) | Odkaz [BCG-data] | Rodina v BOM [BCG] | V BOM modelů |
|---|---|---|---|---|
| `drv-dell-ps1030-e3s-1600` | Dell NVMe ISE PS1030 MU E3.S 1.6TB (1600) | https://compatibilityguide.broadcom.com/detail?program=ssd&productId=62524&persona=live | „Dell E3.S PS1030 [3 DWPD]“ | R470, R570, R670, R770, R6715, R7715, R6725, R7725 |
| `drv-dell-ps1030-e3s-3200` | Dell NVMe ISE PS1030 MU E3.S 3.2TB (3200) | https://compatibilityguide.broadcom.com/detail?program=ssd&productId=62526&persona=live | „Dell E3.S PS1030 [3 DWPD]“ | dtto |
| `drv-dell-ps1030-e3s-6400` | Dell NVMe ISE PS1030 MU E3.S 6.4TB (6400) | https://compatibilityguide.broadcom.com/detail?program=ssd&productId=62528&persona=live | „Dell E3.S PS1030 [3 DWPD]“ | dtto |
| `drv-hpe-cm7-u3-1600` | HPE 1.6TB NVMe MU SFF BC U.3 CM7 SSD (1600) | https://compatibilityguide.broadcom.com/detail?program=ssd&productId=57501&persona=live | „HPE U.3 MU CM7 [3 DWPD]“ | DL320/DL360/DL380 Gen12, DL385 Gen11 (ne DL340 Gen12, DL365 Gen11) |
| `drv-hpe-cm7-e3s-3200` | HPE 3.2TB NVMe MU E3S EC1 CM7 SSD (3200) | https://compatibilityguide.broadcom.com/detail?program=ssd&productId=56417&persona=live | „HPE E3.S MU CM7 [3 DWPD]“ | všechny HPE z A.2 |
| `drv-hpe-9550-e3s-6400` | HPE 6.4TB NVMe MU E3S EC1 9550 SSD (6400) | https://compatibilityguide.broadcom.com/detail?program=ssd&productId=63347&persona=live | „HPE E3.S MU 9550 [3 DWPD]“ | všechny HPE z A.2 |
| `drv-cisco-7500-1600` | 1.6TB 2.5in U.3 Micron 7500 NVMe High Perf High Endurance (UCS-NVB1T6M2P, UCSX-NVB1T6M2P) (1600) | https://compatibilityguide.broadcom.com/detail?program=ssd&productId=64569&persona=live | „Cisco U.3 7500 [3 DWPD]“ (High Endurance ↔ 3 DWPD = [SIMPL]) | C220-M8S, C240-M8SX, C225-M8N, C245-M8SX |
| `drv-cisco-7500-3200` | 3.2TB … Micron 7500 … High Endurance (UCS-NVB3T2M2P, UCSX-NVB3T2M2P) (3200) | https://compatibilityguide.broadcom.com/detail?program=ssd&productId=64570&persona=live | dtto | dtto |
| `drv-cisco-7500-6400` | 6.4TB … Micron 7500 … High Endurance (UCS-NVB6T4M2P, UCSX-NVB6T4M2P) (6400) | https://compatibilityguide.broadcom.com/detail?program=ssd&productId=64571&persona=live | dtto | dtto |

Disky **bez** [BCG-data] kapacity (rodina [BCG], kapacita [SIMPL] – OQ 1):

| Part ID | Rodina v BOM [BCG] | Kapacity ve hře [SIMPL] | V BOM modelů |
|---|---|---|---|
| `drv-len-7500max-u3-<cap>` | „ThinkSystem U.3 7500 MAX [3 DWPD]“ | 1.6 / 3.2 / 6.4 TB | SR630 V4, SR650 V4, SR650a V4, SR635/SR655 V3 |
| `drv-cisco-pm1745-e3s-<cap>` | „Cisco E3.S PM1745 [3 DWPD]“ | 3.2 / 6.4 TB | C220-M8E3S, C240-M8E3S |
| `drv-smc-kioxia-cm7v-u2-<cap>` | „Kioxia U.2 CM7-V Series [3 DWPD]“ | 1.6 / 3.2 / 6.4 TB | SYS-122H-TN, SYS-222H-TN, SYS-122C-TN, SYS-222BT-DNR |
| `drv-smc-solidigm-p5620-u2-<cap>` | „Solidigm U.2 D7-P5620 [3 DWPD]“ | 3.2 / 6.4 TB | SYS-122H-TN, SYS-222H-TN |
| `drv-hpe-p5430-cr` (past) | „HPE E3.S VRO P5430 [0.51 DWPD]“ (sekce Cyber Recovery) | 15.36 TB (kapacita QLC z guidance; že P5430 je QLC, data neříkají) | DL360/DL380 Gen12 … |

**Disky – vSAN OSA (SAS, jen pro past „SAS v ESA“ a OSA scénáře)** [BCG-data]

| Part ID | Partner | Model (export) | GB | Typ | Tiery 9.1 | Odkaz |
|---|---|---|---|---|---|---|
| `drv-hpe-pm1655a-sas-1600` | HPE | DRV, 1.6TB SAS MU SFF PM1655a SSD-SAM | 1600 | SAS TLC | AF-Cache, AF-Cap | https://compatibilityguide.broadcom.com/detail?program=ssd&productId=62573&persona=live |
| `drv-hpe-pm1653a-sas-3840` | HPE | DRV, 3.84TB SAS RI SFF PM1653a SSD-SAM | 3840 | SAS TLC | AF-Cache, AF-Cap | https://compatibilityguide.broadcom.com/detail?program=ssd&productId=62566&persona=live |
| `drv-len-pm1635a-sas-1600` | Lenovo | PM1635a 1600GB | 1600 | SAS TLC | AF-Cache, AF-Cap, HY-Cache | https://compatibilityguide.broadcom.com/detail?program=ssd&productId=41881&persona=live |
| `drv-len-pm1633a-sas-3840` | Lenovo | PM1633a 3840GB | 3840 | SAS TLC | AF-Cache, AF-Cap, HY-Cache | https://compatibilityguide.broadcom.com/detail?program=ssd&productId=41887&persona=live |

**NIC** – název z BOM [BCG]; kde existuje shodná položka v `all.json` (shoda part number / názvu), je uveden
`vcglink` [BCG-data]. Rychlost × porty z názvu [SIMPL].

| Part ID | Název v BOM [BCG] | GbE × porty | [BCG-data] odkaz | Modely |
|---|---|---|---|---|
| `nic-dell-57412-10gbt-2p` | Broadcom 57412 10G BT Dual Port | 10 × 2 | – | R670, R770 |
| `nic-dell-cx6lx-25g-2p` | NVIDIA ConnectX-6 LX Dual Port 25 GbE SFP OCP3.0 Network Adapter | 25 × 2 | – | R670, R770 |
| `nic-dell-cx6dx-100g-2p` | NVIDIA ConnectX-6 Dx Dual Port 100GbE QSFP56 | 100 × 2 | https://compatibilityguide.broadcom.com/detail?program=rdmanic&productId=59418&persona=live (OCP 3.0 varianta) | R470, R570, R670, R770 |
| `nic-hpe-57414-25g-2p` | Broadcom BCM57414 Ethernet 10/25Gb 2-port SFP28 Adapter for HPE P26262-B21 | 10/25 × 2 | – | HPE z A.2 |
| `nic-hpe-cx6lx-25g-2p` | Mellanox MCX631102AS-ADAT Ethernet 10/25Gb 2-port SFP28 Adapter for HPE P42044-B21 | 10/25 × 2 | – | HPE z A.2 |
| `nic-hpe-cx6-100g-2p` | Mellanox MCX623106AS-CDAT Ethernet 100Gb 2-port QSFP56 Adapter for HPE P25960-B21 | 100 × 2 | https://compatibilityguide.broadcom.com/detail?program=rdmanic&productId=52038&persona=live | HPE z A.2 |
| `nic-len-cx6lx-25g-2p` | Lenovo-4XC7A62582-ThinkSystem Mellanox ConnectX-6 Lx 10/25GbE SFP28 2-port OCP Ethernet Adapter | 10/25 × 2 | – | SR630/SR650 V4, SR635/SR655 V3 |
| `nic-len-57414-25g-2p-ocp` | ThinkSystem Broadcom 57414 10/25GbE SFP28 2-port OCP Ethernet Adapter(4XC7A08237) | 10/25 × 2 | – (v `all.json` je jen PCIe varianta 4XC7A08238) | SR630/SR650 V4 |
| `nic-len-57508-100g-2p` | ThinkSystem Broadcom 57508 100GbE QSFP56 2-Port OCP Ethernet Adapter (4XC7A08243) | 100 × 2 | https://compatibilityguide.broadcom.com/detail?program=rdmanic&productId=63572&persona=live | SR630/SR650 V4 |
| `nic-cisco-x710t2lg-10g-2p` | Cisco(R) X710T2LG 2x10 GbE RJ45 PCIe NIC | 10 × 2 | – | C220-M8S, C240-M8E3S |
| `nic-cisco-cx6lx-25g-2p` | Cisco-NVDA MCX631102AS-ADAT CX6 Lx 2x25G SFP28 x8 PCIe | 25 × 2 | https://compatibilityguide.broadcom.com/detail?program=rdmanic&productId=64422&persona=live | C220-M8S, C240-M8E3S |
| `nic-cisco-cx7-25g-4p` | Cisco-NVDA MCX713104AS-ADAT 4x25GbE SFP56 Gen4 x16 PCIe NIC | 25 × 4 | https://compatibilityguide.broadcom.com/detail?program=rdmanic&productId=64652&persona=live | C220-M8S, C240-M8E3S |
| `nic-cisco-cx6-100g-2p` | Cisco-MLNX MCX623106AS-CDAT 2x100GbE QSFP56 PCIe NIC | 100 × 2 | https://compatibilityguide.broadcom.com/detail?program=rdmanic&productId=64367&persona=live | C220-M8S, C240-M8SX, C240-M8E3S |
| `nic-smc-a25g-m2sm` | AOC-A25G-m2SM | 25 × ? (porty z názvu nejdou) → hra 2 [SIMPL] | https://compatibilityguide.broadcom.com/detail?program=rdmanic&productId=52102&persona=live | Supermicro z A.5 |
| `nic-smc-a25g-i2sm` | AOC-A25G-i2SM | 25 × 2 [SIMPL] | – | Supermicro Granite Rapids |
| `nic-smc-a100g-m2cm` | AOC-A100G-m2CM | 100 × 2 [SIMPL] | – | Supermicro z A.5 |

### B.3 Startovní konfigurace serverů

Legenda: **Profil** = odvozený HCI profil (6.1). **✓** = splňuje pravidla [T]/[BCG] pro vSAN ESA HCI;
**DEV** = podporovaná odchylka (varování); **✗** = záměrná past (REQ porušení). Model, limity, rodiny disků, NIC a
boot = [BCG] (odkaz v Příloze A). Jádra, RAM, počty kusů a kapacitní bod disku = [SIMPL] (pokud není u disku
[BCG-data] v B.2). Všechny konfigurace jsou zároveň použitelné jako EXT (NFS / FC) hosty, pokud mají NIC (a HBA).

**Dell**

| ID | Model | Profil | Jádra (socket × jader) | RAM GB | Disky | Kapacita uzlu | NIC | Boot | Stav |
|---|---|---|---|---|---|---|---|---|---|
| `dell-r670-sm` | PowerEdge R670 (63567) | HCI-SM | 16 (1 × 16) | 128 | 4 × `drv-dell-ps1030-e3s-1600` | 6.4 TB | 1 × `nic-dell-57412-10gbt-2p` (2 × 10 GbE) | BOSS + 2 M.2 ≥ 480 GB RAID 1 | ✓ (10 GbE → KB 372309/372311: compliance check, ≤ 75 % kapacity) |
| `dell-r670-med` | PowerEdge R670 (63567) | HCI-MED | 32 (2 × 16) | 256 | 8 × `drv-dell-ps1030-e3s-3200` | 25.6 TB | 1 × `nic-dell-cx6lx-25g-2p` (2 × 25 GbE) | dtto | ✓ |
| `dell-r770-lrg` | PowerEdge R770 (63566) | HCI-LRG | 48 (2 × 24) | 512 | 8 × `drv-dell-ps1030-e3s-6400` | 51.2 TB | 2 × `nic-dell-cx6dx-100g-2p` (4 × 100 GbE) | dtto | ✓ |
| `dell-r670-med-10g` | PowerEdge R670 (63567) | HCI-SM (výpočetně MED) | 32 (2 × 16) | 256 | 8 × `drv-dell-ps1030-e3s-3200` | 25.6 TB | 1 × `nic-dell-57412-10gbt-2p` (2 × 10 GbE) | dtto | **DEV** – BCG: odchylka podporovaná (výkon/dostupnost); VCF Design Library: „Larger vSAN ESA nodes require 25GbE“ (REQD) → nesoulad s designem (OQ 6) |
| `dell-r670-undersized` | PowerEdge R670 (63567) | pod HCI-SM | 12 (1 × 12) | 96 | 2 × `drv-dell-ps1030-e3s-1600` | 3.2 TB | 1 × `nic-dell-cx6lx-25g-2p` | dtto | **✗** REQ – < 16 jader, < 128 GB (VCF-VSAN-ESA-REQD-CFG-003/004 [H4]); pod HCI-SM → bez podpory GS [H2] |

**HPE**

| ID | Model | Profil | Jádra | RAM GB | Disky | Kapacita uzlu | NIC | Boot | Stav |
|---|---|---|---|---|---|---|---|---|---|
| `hpe-dl360g12-sm` | ProLiant DL360 Gen12 (63562) | HCI-SM | 16 (1 × 16) | 128 | 2 × `drv-hpe-cm7-u3-1600` | 3.2 TB (přesně minimum) | 1 × `nic-hpe-57414-25g-2p` | NS204i-u V2 480GB NVMe | ✓ |
| `hpe-dl380g12-med` | ProLiant DL380 Gen12 (63561) | HCI-MED | 32 (2 × 16) | 256 | 8 × `drv-hpe-cm7-e3s-3200` | 25.6 TB | 1 × `nic-hpe-cx6lx-25g-2p` (25 GbE) | dtto | ✓ |
| `hpe-dl380g12-lrg` | ProLiant DL380 Gen12 (63561) | HCI-LRG | 48 (2 × 24) | 512 | 8 × `drv-hpe-9550-e3s-6400` | 51.2 TB | 2 × `nic-hpe-cx6-100g-2p` (4 × 100 GbE) | dtto | ✓ |
| `hpe-dl380g12-crdrive` | ProLiant DL380 Gen12 (63561) | – | 32 | 256 | 4 × `drv-hpe-p5430-cr` | 61.4 TB [SIMPL] | 1 × `nic-hpe-cx6lx-25g-2p` | dtto | **✗** REQ – disk ze sekce Cyber Recovery v HCI; 0.51 DWPD < 1 DWPD; QLC „not supported for vSAN HCI“ [H2][H9] |
| `hpe-dl380g12-dell-drive` | ProLiant DL380 Gen12 (63561) | – | 32 | 256 | 8 × `drv-dell-ps1030-e3s-3200` | 25.6 TB | 1 × `nic-hpe-cx6lx-25g-2p` | dtto | **✗** REQ – disk mimo BOM / jiný OEM (KB 326717 [H6]); „VCF automated workflows may block cluster creation“ [H4] |

**Lenovo**

| ID | Model | Profil | Jádra | RAM GB | Disky | Kapacita uzlu | NIC | Boot | Stav |
|---|---|---|---|---|---|---|---|---|---|
| `len-sr630v4-sm` | ThinkSystem SR630 V4 (63600) | HCI-SM | 16 (1 × 16) | 128 | 4 × `drv-len-7500max-u3-1600` [SIMPL kap.] | 6.4 TB | 1 × `nic-len-cx6lx-25g-2p` | M.2 RAID B545i-2i | ✓ |
| `len-sr650v4-med` | ThinkSystem SR650 V4 (63599) | HCI-MED | 32 (2 × 16) | 256 | 8 × `drv-len-7500max-u3-3200` [SIMPL kap.] | 25.6 TB | 1 × `nic-len-57414-25g-2p-ocp` | dtto | ✓ |
| `len-sr650v4-lrg` | ThinkSystem SR650 V4 (63599) | HCI-LRG | 48 (2 × 24) | 512 | 8 × `drv-len-7500max-u3-6400` [SIMPL kap.] | 51.2 TB | 2 × `nic-len-57508-100g-2p` | dtto | ✓ |
| `len-sr650v4-sas` | ThinkSystem SR650 V4 (63599) | – | 32 | 256 | 8 × `drv-len-pm1633a-sas-3840` | 30.7 TB | 1 × `nic-len-57414-25g-2p-ocp` | dtto | **✗** REQ pro ESA – SAS v ESA („Changing the device type is not permitted“ [H2]; „SAS and SATA are not currently planned for vSAN ESA“ [H6]); OSA by navíc vyžadovala certifikovaný controller a cache tier (OSA ReadyNode pro 9.1 nestaženy, OQ 7) |
| `len-sr630v4-compute` | ThinkSystem SR630 V4 (63600) | – | 32 | 512 | žádné vSAN disky | – | 1 × `nic-len-cx6lx-25g-2p` + FC HBA [SIMPL] | dtto | EXT (NFS / FC principal storage) |

**Cisco**

| ID | Model | Profil | Jádra | RAM GB | Disky | Kapacita uzlu | NIC | Boot | Stav |
|---|---|---|---|---|---|---|---|---|---|
| `cisco-c220m8s-sm` | UCSC-C220-M8S (64247) | HCI-SM | 16 (1 × 16) | 128 | 2 × `drv-cisco-7500-1600` | 3.2 TB | 1 × `nic-cisco-x710t2lg-10g-2p` (2 × 10 GbE) | Micron 5400 480GB M.2 SATA | ✓ (10 GbE → KB 372309/372311) |
| `cisco-c220m8s-med` | UCSC-C220-M8S (64247) | HCI-MED | 32 (2 × 16) | 256 | 4 × `drv-cisco-7500-6400` | 25.6 TB | 1 × `nic-cisco-cx6lx-25g-2p` | dtto | ✓ |
| `cisco-c240m8e3s-lrg` | UCSC-C240-M8E3S (63932) | HCI-LRG | 48 (2 × 24) | 512 | 16 × `drv-cisco-pm1745-e3s-3200` [SIMPL kap.] | 51.2 TB | 2 × `nic-cisco-cx6-100g-2p` | Solidigm S4520 480GB SATA 1X (jediné boot SSD, RAID 1 jen doporučeno [H12]) | ✓ |
| `cisco-c240m8e3s-lrg-25g` | UCSC-C240-M8E3S (63932) | HCI-MED (výpočetně LRG) | 48 | 512 | 16 × `drv-cisco-pm1745-e3s-3200` | 51.2 TB | 1 × `nic-cisco-cx7-25g-4p` (4 × 25 GbE) | dtto | **DEV** – přesně příklad z guidance: „25 Gb networking instead of the recommended 100 Gb on a vSAN-HCI-LRG profile“ → podporováno, dopad na výkon/dostupnost [H2]; VCF 25GbE splněno |
| `cisco-c220m8s-9drives` | UCSC-C220-M8S (64247) | – | 32 | 256 | 9 × `drv-cisco-7500-3200` | 28.8 TB | 1 × `nic-cisco-cx6lx-25g-2p` | dtto | **✗** – víc disků než `maxDrives` = 8 [H9]; hra nákup nedovolí |

**Supermicro**

| ID | Model | Profil | Jádra | RAM GB | Disky | Kapacita uzlu | NIC | Boot | Stav |
|---|---|---|---|---|---|---|---|---|---|
| `smc-122h-sm` | SYS-122H-TN (64010) | HCI-SM | 16 (1 × 16) | 128 | 2 × `drv-smc-kioxia-cm7v-u2-1600` [SIMPL kap.] | 3.2 TB | 1 × `nic-smc-a25g-m2sm` | M.2 NVMe ≥ 480 GB | ✓ |
| `smc-222h-med` | SYS-222H-TN (63933) | HCI-MED | 32 (2 × 16) | 256 | 8 × `drv-smc-kioxia-cm7v-u2-3200` [SIMPL kap.] | 25.6 TB | 1 × `nic-smc-a25g-i2sm` | HDS-MMN-MTFDKBA960TFR1BC | ✓ |
| `smc-222h-lrg` | SYS-222H-TN (63933) | HCI-LRG | 48 (2 × 24) | 512 | 8 × `drv-smc-solidigm-p5620-u2-6400` [SIMPL kap.] | 51.2 TB | 2 × `nic-smc-a100g-m2cm` | dtto | ✓ |
| `smc-122h-onedisk` | SYS-122H-TN (64010) | pod HCI-SM | 16 | 128 | 1 × `drv-smc-kioxia-cm7v-u2-1600` | 1.6 TB | 1 × `nic-smc-a25g-m2sm` | M.2 NVMe ≥ 480 GB | **✗** REQ (podpora) – každý jednotlivý disk OK (≥ 1 zařízení, ≥ 1.6 TB [H6]), ale kapacita uzlu < 3.2 TB → pod HCI-SM → bez podpory GS [H2] |
| `smc-222h-trimode` | SYS-222H-TN (63933) | – | 32 | 256 | 6 × `drv-smc-kioxia-cm7v-u2-3200` za Tri-Mode controllerem [SIMPL] | 19.2 TB | 1 × `nic-smc-a25g-i2sm` | dtto | **✗** REQ – VCF-VSAN-REQD-CFG-005 / KB 409486 [H4][H10]; (BCG uvádí u modelu jen „PCIe Switch: Not Supported, Direct Connect Only“) |

Poznámky:
- **[BCG]**: modely, CPU generace, profily, max. jader/socketů/RAM/disků, rodiny disků s DWPD, NIC, boot – z [H9]
  s odkazem `bcgUrl` (Příloha A); minima profilů z [H2]. **[BCG-data]**: kapacity Dell PS1030, HPE CM7/9550,
  Cisco Micron 7500 a vybraných NIC (B.2). **[SIMPL]**: jádra, RAM, počty kusů, kapacitní body Lenovo / Cisco E3.S /
  Supermicro disků a CR disku, párování názvů mezi `all.json` a BOM, rychlost/porty NIC z názvu, FC HBA, Tri-Mode
  controller, odvozování profilu.
- Konfigurace odpovídají minimům profilů z guidance (16/128/3.2 TB/10 GbE; 32/256/20 TB/25 GbE; 48/512/50 TB/100 GbE)
  a počty disků jsou pod „Max Storage Devices for base configuration“ (12/18/24) i pod `maxDrives` modelu.
- Pasti v Kariéře: v Sandboxu je hráč smí koupit (kromě fyzicky nemožných – nad `maxDrives`), validace je pro dané
  použití odmítne (REQ) nebo varuje (DEV) – s hláškou ze sekce 5, kde existuje, jinak s herní hláškou označenou jako
  herní.
- Žádné ceny – fiktivní měna se doplní v ekonomice Kariéry.

---

## Příloha C – Výška serverů (U) [VEND]

**Pravidlo:** z vendorských zdrojů (oficiální datasheet / spec sheet / produktová stránka / manuál vendora) se
přebírá **jen výška serveru v U**, vždy s odkazem. Všechny ostatní atributy (CPU, RAM, disky, NIC, boot, profily)
platí jen z BCG (Příloha A). Data: `docs/spec/data/server-rack-units.json` (stav 2026-11-21, u každého modelu
doslovná citace). Modely ze startovního katalogu (B.3) jsou **tučně**.

| Vendor | Model (BCG productId) | U | Zdroj (citace) |
|---|---|---|---|
| Dell | PowerEdge R470 (63908) | 1 | [ISM: „The PowerEdge R470 system is a 1U server“](https://www.dell.com/support/manuals/en-us/poweredge-r470/r470_ism/poweredge-r470-system-configurations-and-features?guid=guid-446b9ab8-12a3-47f3-9c36-afe3578c5183&lang=en-us) |
| Dell | PowerEdge R570 (63907) | 2 | [ISM: „… is a 2U server“](https://www.dell.com/support/manuals/en-us/poweredge-r570/r570_ism_pub/poweredge-r570-system-configurations-and-features?guid=guid-ed44effc-50f1-44d2-99d3-5cda6a624b05&lang=en-us) |
| Dell | **PowerEdge R670** (63567) | 1 | [ISM: „… is a 1U server“](https://www.dell.com/support/manuals/en-us/poweredge-r670/r670_ism_pub/poweredge-r670-system-configurations-and-features?guid=guid-9e3e2ff9-5ef3-4526-96ec-293a36f5735f&lang=en-us) |
| Dell | **PowerEdge R770** (63566) | 2 | [ISM: „… is a 2U server“](https://www.dell.com/support/manuals/en-us/poweredge-r770/r770_ism_pub/poweredge-r770-system-configurations-and-features?guid=guid-01a358f4-bfc5-4207-ad85-51052333bdce&lang=en-us) |
| Dell | PowerEdge R6715 (63414) | 1 | [ISM: „… is a 1U server“](https://www.dell.com/support/manuals/en-us/poweredge-r6715/per6715_ism_pub/poweredge-r6715-system-configurations-and-features?guid=guid-acb30e42-9d10-4089-94c4-8da377f0c19b&lang=en-us) |
| Dell | PowerEdge R7715 (63413) | 2 | [ISM: „… is a 2U server“](https://www.dell.com/support/manuals/en-us/poweredge-r7715/r7715_ism_pub/poweredge-r7715-system-configurations-and-features?guid=guid-9221c3b4-1346-4fe6-8a8d-5cd85038219b&lang=en-us) |
| Dell | PowerEdge R6725 (63648) | 1 | [ISM: „… is a 1U server“](https://www.dell.com/support/manuals/en-us/oth-xlr6725/r6725_ism/poweredge-r6725-system-configurations-and-features?guid=guid-6ad52ba4-ba51-4ad8-acac-f56a394a91e4&lang=en-us) |
| Dell | PowerEdge R7725 (63559) | 2 | [ISM: „… is a 2U server“](https://www.dell.com/support/manuals/en-us/poweredge-r7725/per7725_ism/poweredge-r7725-system-configurations-and-features?guid=guid-e1fb7b4d-d967-4667-9b8f-44cbc387277c&lang=en-us) |
| HPE | ProLiant DL320 Gen12 (63564) | 1 | [HPE Store: „1U single-socket rackmount server“](https://buy.hpe.com/us/en/compute/rack-servers/proliant-dl300-servers/hpe-proliant-compute-dl320-gen12/p/1014835186) |
| HPE | ProLiant DL340 Gen12 (63563) | 2 | [HPE Store: „a 2U 1P server“](https://buy.hpe.com/us/en/compute/rack-servers/proliant-dl300-servers/hpe-proliant-compute-dl340-gen12/p/1014835192) |
| HPE | **ProLiant DL360 Gen12** (63562) | 1 | [HPE Store: „a compact 1U 2P server“](https://buy.hpe.com/us/en/compute/rack-servers/proliant-dl300-servers/hpe-proliant-compute-dl360-gen12/p/1014865649) |
| HPE | **ProLiant DL380 Gen12** (63561) | 2 | [HPE Store: „a scalable 2U 2P server“](https://buy.hpe.com/us/en/compute/rack-servers/proliant-dl300-servers/hpe-proliant-compute-dl380-gen12/p/1014865653) |
| HPE | ProLiant DL365 Gen11 (63148, 62977) | 1 | [HPE Store: „rack-optimized 1U 2P“](https://buy.hpe.com/us/en/compute/rack-servers/proliant-dl300-servers/proliant-dl365-server/hpe-proliant-dl365-gen11/p/1014689131) |
| HPE | ProLiant DL385 Gen11 (63146, 62981) | 2 | [HPE Store: „a 2U 2P solution“](https://buy.hpe.com/us/en/compute/rack-servers/proliant-dl300-servers/hpe-proliant-dl385-gen11/p/1014689137) |
| Lenovo | **ThinkSystem SR630 V4** (63600) | 1 | [Lenovo Press LP1971: „Form factor 1U rack“](https://lenovopress.lenovo.com/lp1971-thinksystem-sr630-v4-server) |
| Lenovo | **ThinkSystem SR650 V4** (63599) | 2 | [Lenovo Press LP2127: „2U rack“](https://lenovopress.lenovo.com/lp2127-thinksystem-sr650-v4-server) |
| Lenovo | ThinkSystem SR650a V4 (63624) | 2 | [Lenovo Press LP2128: „2U rack“](https://lenovopress.lenovo.com/lp2128-thinksystem-sr650a-v4-server) |
| Lenovo | ThinkSystem SR635 V3 (63179, 62913) | 1 | [Lenovo Press LP1609: „1U rack“](https://lenovopress.lenovo.com/lp1609-thinksystem-sr635-v3-server) |
| Lenovo | ThinkSystem SR655 V3 (63180, 62920) | 2 | [Lenovo Press LP1610: „2U rack“](https://lenovopress.lenovo.com/lp1610-thinksystem-sr655-v3-server) |
| Cisco | **UCSC-C220-M8S** (64247) | 1 | [C220 M8 Data Sheet: „C220 M8 1RU standard server“](https://www.cisco.com/c/en/us/products/collateral/servers-unified-computing/ucs-c-series-rack-servers/ucs-c220-m8-rack-server-ds.html) |
| Cisco | UCSC-C220-M8E3S (64134) | 1 | [C220 M8 Data Sheet: „C220 M8 1RU NVMe optimized server“](https://www.cisco.com/c/en/us/products/collateral/servers-unified-computing/ucs-c-series-rack-servers/ucs-c220-m8-rack-server-ds.html) |
| Cisco | UCSC-C240-M8SX, HCIVS240C-M8SN (64136) | 2 | [C240 M8 Data Sheet: „C240 M8 2RU standard server“](https://www.cisco.com/c/en/us/products/collateral/servers-unified-computing/ucs-c-series-rack-servers/ucs-c240-m8-rack-server-ds.html) (ověřen jen UCSC-C240-M8SX, OQ 12) |
| Cisco | **UCSC-C240-M8E3S** (63932) | 2 | [C240 M8 Data Sheet: „C240 M8 2RU NVMe optimized server“](https://www.cisco.com/c/en/us/products/collateral/servers-unified-computing/ucs-c-series-rack-servers/ucs-c240-m8-rack-server-ds.html) |
| Cisco | UCSC-C225-M8N (63601, 63221) | 1 | [C225 M8 Data Sheet: „C225 M8 1RU NVMe optimized server“](https://www.cisco.com/c/en/us/products/collateral/servers-unified-computing/ucs-c-series-rack-servers/ucs-c225-m8-rack-server-ds.html) |
| Cisco | UCSC-C245-M8SX (63625, 63415) | 2 | [C245 M8 Data Sheet: „C245 M8 2RU standard server“](https://www.cisco.com/c/en/us/products/collateral/servers-unified-computing/ucs-c-series-rack-servers/ucs-c245-m8-rack-server-ds.html) |
| Supermicro | **SYS-122H-TN** (64010) | 1 | [supermicro.com: „Form Factor 1U Rackmount“](https://www.supermicro.com/en/products/system/hyper/1u/sys-122h-tn) |
| Supermicro | **SYS-222H-TN** (63933) | 2 | [supermicro.com: „Form Factor 2U Rackmount“](https://www.supermicro.com/en/products/system/hyper/2u/sys-222h-tn) |
| Supermicro | SYS-122C-TN (64009) | 1 | [supermicro.com: „1U Rackmount“](https://www.supermicro.com/en/products/system/cloudcomputing/1u/sys-122c-tn) |
| Supermicro | SYS-222BT-DNR (63934) | 2 (šasi, 2 nody) | [supermicro.com: „A 2U 2-node BigTwin® server“](https://www.supermicro.com/en/products/system/bigtwin/2u/sys-222bt-dnr) (OQ 13) |
| Supermicro | AS-2126HS-TN (63173) | 2 | [supermicro.com: „2U Rackmount“](https://www.supermicro.com/en/products/system/hyper/2u/as-2126hs-tn) |

- **Startovní katalog B.3** pokrývá všech 10 modelů: R670 = 1U, R770 = 2U, DL360 Gen12 = 1U, DL380 Gen12 = 2U,
  SR630 V4 = 1U, SR650 V4 = 2U, C220-M8S = 1U, C240-M8E3S = 2U, SYS-122H-TN = 1U, SYS-222H-TN = 2U.
- Nedohledáno: Cisco UCSX-215c-M8 (63602) – compute node X-Series do šasi, ne rack server (OQ 12).
