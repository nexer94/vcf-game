# 10 – Planning and Preparation

> Modelovaná verze: **VCF 9.1.1** (viz `docs/spec/VERSION.md`). Rozdíly proti 9.0 jsou označeny **[9.0]** / **[9.1]** / **[9.1.1+]**.
> Stav k 2026-11-20. Zdroje: techdocs.broadcom.com a knowledge.broadcom.com; odkazy `[Pn]` vedou do sekce 9.
>
> **Překryv s jinými speci:** DNS/FQDN/IP tabulky první instance, příprava ESX (NTP, certifikát, vmk0), sizing
> profily a minima pro konvergenci jsou už v `20-deployment.md` (sekce 3, 6) a `00-architektura.md` (sekce 6).
> Tady jsou jen odkazy na ně a **nová** fakta: minimální počty hostů podle cluster modelu, požadavky na HW ESX,
> vSAN ESA/OSA, síť (MTU, VLAN, NIC), HA / admission control a plánování kapacity.

## 1. Shrnutí

Sekce TechDocs **Planning and Preparation** (9.1.x) „helps a VI administrator size an environment and specify the
software, tools, and external services“ potřebné pro VCF private cloud [P1]. V 9.1 je sekce tenká: obsahuje
Planning and Preparation Workbook (Excel, verze pro **9.1.0 a 9.1.1**), odkazy na nástroje Configuration
Maximums a Ports and Protocols a tři podstránky: Public URLs, VCF Components FQDNs and IP addresses a Network
Deployment Options [P1]. Konkrétní čísla pro plánování hardwaru (minima hostů, CPU/RAM, NIC, MTU, admission
control) jsou v **Design Library** (cluster modely, ESX model, vSAN storage modely, síťové modely). Na ni odkazuje
KB 392993 jako na zdroj požadavků na management domain [P32].

**[9.0]** Stránka Planning and Preparation 9.0 měla jen Workbook pro 9.0, odkazy na configmax a ports.broadcom.com
a odkazy na Overview/Design/Release Notes, bez podstránek ve stromu sekce [P37].

**[9.1]** VCF Installer má nově **integrovaný planning workflow**: „allows you to define your deployment topology
and component selection directly in the UI“. Installer z toho „generates a list of CPU, Memory, Storage, VLAN,
and FQDN requirements“, které se „validated against the target infrastructure to ensure resource sufficiency
prior to deployment“ [P27].

Pro hru (Kariéra – ekonomika) je klíčová tabulka minimálních počtů hostů podle cluster modelu, typu úložiště a
deployment modelu (Simple / High Availability) v sekci 6.1 a pravidla HA rezervy v sekci 6.3.

## 2. Komponenty a vztahy

### 2.1 Plánovací artefakty a nástroje
| Artefakt | Účel | Zdroj |
|---|---|---|
| Planning and Preparation Workbook (xlsx; 9.1.0 a 9.1.1) | sběr vstupů pro nasazení; tab „Management Domain Sizing“ slouží „to determine resource requirements based on your desired design“ | [P1][P26] |
| VCF Installer – integrovaný planning workflow **[9.1]** | topologie + výběr komponent → požadavky na CPU/RAM/Storage/VLAN/FQDN, validace proti cílové infrastruktuře | [P27] |
| Configuration Maximums (configmax.broadcom.com) | limity škálování | [P1][P40] |
| Ports and Protocols (ports.broadcom.com) | porty | [P1][P39] |
| Broadcom Compatibility Guide | certifikace serveru/BIOS „for VCF 9.1“, NIC, HBA, vSAN ESA/OSA | [P33] |

### 2.2 Na čem závisí počet hostů
Minimální počet ESX hostů v clusteru určují tři volby [P9][P11][P12][P13]:
1. **vSphere cluster model**: Single-Rack, Multi-Rack Layer 2, Multi-Rack Layer 3, Stretched (viz `00-architektura` 6).
2. **Typ principal storage**: vSAN, nebo NFS / VMFS na FC.
3. **VCF Installer deployment model**: Simple, nebo High Availability. Model určuje počty uzlů management
   komponent: NSX Manager 1 nebo 3, VCF management services 1 nebo 3 control plane uzly atd.
   Detail je v `00-architektura` 6 a `20-deployment` 6.2.

Navíc záleží na **typu domény / clusteru**: první (default) cluster management domain, nebo další clustery
management domain a clustery workload domain. Tabulky je rozlišují [P9][P11][P13].

### 2.3 Vazby management komponent na hosty
- HA NSX Manager: 3 uzly v default clusteru management domain (VCF-NSX-LM-REQD-CFG-005). Doporučené DRS VM-VM
  anti-affinity a „You must allocate at least four physical hosts“, aby 3 appliance běžely i po výpadku jednoho
  hostu (VCF-NSX-LM-RCMD-CFG-003) [P23].
- Simple NSX Manager: 1 uzel (VCF-NSX-LM-REQD-CFG-004). Doporučení VCF-NSX-LM-RCMD-CFG-001 přesto uvádí:
  „You must have sufficient resources in the management domain default vSphere cluster to run three (3) NSX
  Manager nodes“ [P24].
- HA VCF management services: 3 control plane uzly + workery v default clusteru management domain
  (VCF-MS-REQD-HA-001). Uzly drží na různých hostech **CAPV node anti-affinity**, ne DRS pravidla
  (VCF-MS-REQD-COM-002). Uzly musí chránit vSphere HA (VCF-MS-REQD-COM-003). Minimální počet hostů stránka
  neuvádí [P25].
- Management domain (první instance) hostí fleet i instance komponenty a může hostit NSX Edge i business
  workloady. Requirement VCF-WLD-REQD-CFG-001 říká, že ji je třeba „size carefully for planned workload domains“
  [P7].
- Workload domain má vlastní vCenter a NSX Manager. NSX Manager může být dedikovaný, nebo sdílený s jinou
  doménou včetně management domain [P8].

## 3. Prerekvizity

### 3.1 DNS a NTP
- Každá komponenta má unikátní FQDN s funkčním forward (A) i reverse (PTR) záznamem. Top-level label smí
  obsahovat jen ASCII písmena [P2]. Requirement VCF-NET-REQD-IPA-002: „Configure forward and reverse DNS records
  for all management components“ [P21].
- Statické IPv4 adresy a hostnames pro všechny management komponenty (VCF-NET-REQD-IPA-001) [P21].
- FQDN se píše malými písmeny. Kontejnerové služby (VCF management services, VCF Automation, VCF Identity Broker,
  vSphere Supervisor) **nepodporují `.local`**. Klasické appliance (vCenter, ESX, NSX Manager, SDDC Manager, VCF
  Operations) `.local` používat mohou, `vsphere.local` SSO funguje dál (KB 460245) [P4].
- NTP: stránky Planning and Preparation 9.1 NTP neřeší [P2]. Požadavek na běžící NTP na ESX a dosažitelnost
  NTP/DNS z VCF Installeru je v `20-deployment` 3.2–3.3 [P29].
- ESX: po nastavení FQDN je nutné regenerovat certifikát (VCF-ESX-REQD-SEC-001: „Regenerate the certificate of
  each ESX host after assigning the ESX host an FQDN“) [P14]. Postup je v `20-deployment` 4.1.4.

### 3.2 IP plánování
- **Infrastrukturní sítě musí být IPv4**: „All infrastructure networks (management VMkernels, primary storage,
  vMotion, NSX TEPs, etc) must be IPv4 based.“ Workload VLAN a overlay segmenty mohou používat IPv6 [P21].
- **[9.1]** Dual-stack (IPv4 + IPv6) je volba pro celou doménu: „VCF applies dual stack as a domain-wide setting,
  not a per-component choice“ [P2]. vSAN data traffic dual-stack **nepodporuje** (VCF-VSAN-NET-REQD-CFG-003)
  [P15]. **[9.0]** podporoval jen IPv4. 9.1 stránka uvádí „VCF 9.1 and later supports IPv4-only and dual-stack“
  [P2], přesné znění pro 9.0 nebylo ověřeno.
- Počty IP na hosta / uzel podle IPv4 Addressing Model [P21]:

| Síť | Minimum IP | Způsob přidělení |
|---|---|---|
| ESX management VMkernel | 1 / host | Static |
| ESX vMotion VMkernel | 1 / host | Network Pool, DHCPv4 |
| Storage VMkernel (vSAN, NFS) | 1 / host / VMK | Network Pool, DHCPv4 |
| Host TEP | 1 / aktivní VDS uplink / host („typically 2“) | Static IP List, Network Pool, DHCPv4 |
| NSX Edge node management | 1 / uzel | Static, DHCPv4 |
| NSX Edge TEP | 1 / uzel („typically 2“) | Static IP List, Network Pool, DHCPv4 |
| NSX Edge Tier-0 uplinks | 1 / uzel („typically 2“) | Static |
| vSAN Witness management | 1 / uzel | Static |
| vSAN Witness | 1 / uzel | Static |

  Stránka uvádí i VNA řádky (stateful services, EVPN Route Controller, BGP-EVPN peering +1 VIP) [P21].
- **[9.1.1+]** VLAN-backed VPC může běžet v „TEP-less“ režimu bez Host TEP IP [P4].
- Doporučení: subnety dimenzovat s rezervou (VCF-NET-RCMD-IPA-001). Rozšiřování je disruptivní a masku
  infrastrukturních sítí nelze změnit. Používat RFC 1918 (VCF-NET-RCMD-IPA-002) [P21].
- FQDN/IP pro první instanci: `20-deployment` 6.4 [P3]. Pro **další VCF Instance** (Simple / HA) [P4]:
  vCenter 1 FQDN, ESX 1 FQDN / host, vMotion a vSAN 1 IP / host, Host TEP 1 IP / aktivní uplink / host,
  NSX Manager uzly 1 (Simple) / 3 (HA), NSX VIP 1, SDDC Manager 1, Cloud Proxy 1, Instance components 1,
  VCF services runtime 1 FQDN + uzly min. **12 IP** (doporučeno dalších 30), Identity broker (Day-N) 1 FQDN
  s vlastní IP mimo blok runtime, Real-time metrics (Day-N) 6 IP + 1 (Simple) nebo 1–2 (HA) na další worker.

### 3.3 Síť (VLAN, MTU, NIC, switche)
- Porty switchů k hostům v **trunk módu s 802.1q** (VCF-NET-RCMD-SWT-001). Doporučený trunk PortFast a LLDP/CDP
  (VCF-NET-RCMD-SWT-002/003) [P19].
- Každý host připojen aspoň k jednomu switchi (VCF-NET-REQD-TOR-001). Doporučeny **2 a více ToR switchů**
  (VCF-NET-RCMD-TOR-001) a jedna síťová fabric pro všechny hosty (VCF-NET-RCMD-FBR-001) [P19].
- Každé spojení host–fabric je samostatný uplink, ne LAG (VCF-NET-REQD-LAG-001). Doporučeno: VDS s uplinky
  místo LAG (VCF-VDS-COM-RCMD-CFG-005) [P19][P17].
- **MTU** [P19]:
  - Porty pro NSX host/Edge TEP: největší MTU, **minimum 1700** (VCF-NET-REQD-SWT-002). Poznámka pod čarou:
    „1600 is the minimum required MTU, however 1700 is recommended to address future expansion“. Geneve pakety
    mají nastavený DF bit a nelze je fragmentovat.
  - Ostatní porty hostů: největší MTU ze všech typů provozu, minimum 1500 (VCF-NET-REQD-SWT-003).
  - Doporučeno 9000 a více (VCF-NET-RCMD-SWT-004). VDS 9000 (VCF-VDS-COM-RCMD-CFG-002 [P17],
    VCF-VSAN-NET-RCMD-CFG-004 [P15]). MTU 9000 musí podporovat celá cesta.
  - Tabulka MTU datacentra: hosty v clusteru min. 1700 / doporučeno 9000; workload domény v instanci min. 1500 /
    doporučeno 9000; linky k vSAN stretched witness 1500 / 1500; mezi VCF Instance ve fleetu min. 1500 /
    doporučeno 1500–9000 [P19].
- **VMkernel MTU** („Recommended MTU Size“): ESX management 1500 (default), vMotion 9000, vSAN 9000, NFS 9000,
  Host TEP 9000 [P18].
- **VLAN** [P14]:
  - Doporučeno oddělit ESX management síť management domain od VM management sítě (VCF-ESX-RCMD-NET-001).
  - Každá workload domain má vlastní ESX management VLAN a subnet (VCF-ESX-RCMD-NET-002).
  - Každý typ provozu (vSAN, vMotion, NFS, backup) má vlastní VLAN a subnet (VCF-ESX-RCMD-NET-003).
  - vSAN: dedikovaná VLAN pro single-rack cluster, víc vSAN clusterů v jednom racku ji může sdílet
    (VCF-VSAN-NET-REQD-CFG-002). Jeden IPv4 nebo IPv6 subnet s gateway (VCF-VSAN-NET-REQD-CFG-003) [P15].
  - Stretched: další Host TEP VLAN v AZ2 (VCF-VNI-SC-REQD-CFG-001) a Host TEP IP pool per AZ [P13].
  - Multi-Rack L3: subnet a Host TEP pool per rack (VCF-VNI-L3MR-REQD-CFG-001/002), doporučena samostatná Host
    TEP VLAN per rack [P12].
- **Port groups** (Single Distributed Switch model): VM management (jen management domain; v dalších clusterech
  ručně), ESX management, vMotion, Storage (vSAN/NFS) [P17].
- **NIC**: model Single Distributed Switch = **2 fyzické NIC** na hosta (odolnost vůči výpadku jedné NIC) [P17].
  Multi-rack doporučuje víc VDS, každý VDS min. 2 pNIC (VCF-CLS-MR-RCMD-CFG-001) [P11][P12]. Model Storage and
  Workload Separation potřebuje min. 6 NIC (`00-architektura` 6). Uplinky jednoho VDS mají mít stejnou rychlost,
  model a výkon (VCF-VDS-COM-RCMD-CFG-004) [P17]. Ve vSAN clusteru doporučeno 2 pNIC pro small-scale a 4 pNIC
  pro large-scale / IO-intenzivní provoz (VCF-VSAN-NET-RCMD-CFG-002/003) [P15].
- **Rychlost**: 25GbE doporučeno [P14]. vSAN minimálně 10GbE (ESA i OSA), u ESA jen omezeně, „Larger vSAN ESA
  nodes require 25GbE“. 10GbE na ESA spustí compliance check (KB 372309) (VCF-VSAN-NET-REQD-CFG-001) [P15].
  Konvergence: uplinky VDS ≥ 10 Gbps (`20-deployment` 6.5).
- **[9.1.1+]** Greenfield nasazení může sdílet jeden VDS mezi clustery. Default zůstává dedikovaný VDS per cluster
  [P17].
- Stretched: mezi AZ **≥ 10 Gbps** a **RTT < 5 ms**. vSAN witness musí být ve třetí nezávislé fault doméně [P13].
  AZ jsou „geographically close with low latency (under 5ms RTT)“. Je nutná stretched L2 síť mezi AZ [P20].

### 3.4 Hardware ESX hostů
- **Kompatibilita**: HW z HCL, nejnovější podporovaný BIOS a firmware [P14]. Server a BIOS ověřit v Broadcom
  Compatibility Guide jako „certified for VCF 9.1“, dále NIC a HBA. Pro ESA „strongly recommended to use vSAN ESA
  Ready Nodes“. U OSA bez ReadyNode se ověřuje I/O controller, HDD a SSD jednotlivě [P33]. vSAN HW musí být na
  vSAN HCL (VCF-VSAN-REQD-CFG-004) [P15]. Při vSAN v management domain doporučeny vSAN ReadyNodes
  (VCF-ESX-RCMD-CFG-001) [P14].
- **Homogenita**: „Use hosts with a homogeneous configuration“. Doporučena uniformní konfigurace v default
  management clusteru (VCF-ESX-RCMD-CFG-002). pNIC stejné rychlosti, výrobce a modelu v celém clusteru [P14].
  Počáteční management domain nepodporuje heterogenní cluster a hosty musí být od jednoho vendora
  (`20-deployment` 3.2) [P28]. EVC v management clusterech jen při CPU od jednoho výrobce; v default clusteru se
  zapíná při bring-upu přes API / JSON (VCF-CLS-RCMD-CFG-004/006) [P9].
- **Každý host** musí splnit požadovanou specifikaci CPU, RAM a storage (VCF-ESX-REQD-CFG-002). Implikace:
  „Assemble the server specification and number according to the sizing in the VCF Planning and Preparation
  Workbook“ [P14].
- **CPU**: počítat fyzická jádra, ne logická. SMT do sizingu nezapočítávat (VCF-ESX-RCMD-CFG-003) [P14].
  vSAN ESA: **min. 16 jader na uzel** (VCF-VSAN-ESA-REQD-CFG-003) [P15]. OSA: doporučena vyšší základní frekvence
  (VCF-VSAN-OSA-RCMD-CFG-002) [P16].
- **Paměť**: vSAN ESA **min. 128 GB RAM** na uzel (VCF-VSAN-ESA-REQD-CFG-004 [P15], ESX model [P14]). vSAN OSA
  „To support the maximum number of disk groups, you must provide 32 GB of RAM“ [P14].
- **Boot**: high-endurance zařízení (HDD/SSD), **≥ 128 GB** (VCF-ESX-RCMD-CFG-004, zdůvodněno vSAN scratch u hostů
  > 512 GB RAM). Scratch partition v default management clusteru nechat ve výchozí konfiguraci, vSAN datastore pro
  scratch použít nelze (VCF-ESX-RCMD-CFG-005) [P14].
- **Disky vSAN ESA**: certifikované disky (VCF-VSAN-ESA-REQD-CFG-001), jinak „VCF automated workflows may block
  cluster creation“. Velikost **≥ 1,6 TB** na zařízení, max. **24 disků na uzel** (VCF-VSAN-ESA-REQD-CFG-002).
  Doporučeno NVMe TLC, performance class F a vyšší, endurance ≥ 3 DWPD [P15]. Od 9.0.1 lze necertifikované ESA
  disky použít jen pro PoC (KB 408300; `20-deployment` 3.2) [P28].
- **Disky vSAN OSA**: disk group = 1 cache + ≥ 1 capacity zařízení (VCF-VSAN-OSA-REQD-CFG-001). Min. 1 disk group
  na uzel (REQD-CFG-002), doporučeny 2 (RCMD-CFG-001) [P16].
- NVMe přes Tri-Mode controller pro vSAN zakázáno (VCF-VSAN-REQD-CFG-005) [P15].
- Doporučen TPM (VCF-VSAN-RCMD-CFG-002) [P15], redundantní napájení a BIOS power management „OS Controlled
  Mode“ [P14].
- Stateless ESX VCF nepodporuje (`20-deployment` 3.2) [P28].
- Všechny clustery používají vLCM image (VCF-CLS-REQD-CFG-003, VCF-VSAN-REQD-CFG-003) [P9][P15].

### 3.5 Storage – podmínky použití typů
- Principal storage v tabulkách minim: vSAN, NFS (v3), VMFS na FC [P9][P11]. Stretched NFS/FC (vMSC) přes VCF
  Installer, VCF Operations a SDDC Manager: jen FC nebo NFSv3. Ostatní typy jen přes VCF Import při konvergenci
  [P35].
- Design s NFS/FC „should be completed in consultation with your storage vendor“ [P9].

## 4. Workflow

Plánování podle dokumentace. Pořadí kroků není nikde zapsané jako jeden číslovaný postup. Je složené z
„Preparing to Deploy“ (`20-deployment` 4.1), sizing stránky a design requirementů:

1. **Projít podklady**: Product Overview, Design, Release Notes („Getting to Know VCF“) [P1].
2. **Zvolit design**: deployment model fleet, cluster model, storage model, síťový model (Design Library) [P7][P9].
3. **Stáhnout Planning and Preparation Workbook** (9.1.0 nebo 9.1.1 podle cílové verze) a vyplnit tab
   **„Management Domain Sizing“** [P26][P1]. Podle Workbooku sestavit specifikaci serverů a jejich počet
   (implikace VCF-ESX-REQD-CFG-002) [P14].
4. **Zvolit sizing profil installeru** (Simple / HA Small / Medium / Large). Celkové vCPU, RAM a disk jsou
   v `20-deployment` 6.2 [P26].
5. **Spočítat počet hostů**: alespoň minimum pro zvolený cluster model a storage (sekce 6.1;
   VCF-ESX-REQD-CFG-001, VCF-CLS-REQD-CFG-002) [P14][P9]. Pro kapacitu počítat s rezervou na výpadek jednoho hostu
   (N+1) a s poměrem vCPU:pCPU ≤ 2:1 v management domain (sekce 6.3) [P14].
6. **Ověřit kompatibilitu HW** v Broadcom Compatibility Guide (server/BIOS, NIC, HBA, vSAN) [P33].
7. **Naplánovat sítě**: VLAN, subnety, MTU, počty IP (sekce 3.2–3.3) [P21][P19].
8. **Založit DNS záznamy** (A + PTR) a zajistit NTP [P2][P29].
9. **Ověřit veřejné URL** pro online depot a licencování (`20-deployment` 7) [P6].
10. **[9.1]** V UI VCF Installeru projít **integrovaný planning workflow**: topologie + výběr komponent →
    seznam požadavků na CPU, RAM, Storage, VLAN, FQDN → validace proti cílové infrastruktuře [P27]. Konkrétní
    obrazovky dokumentace v povolených zdrojích nepopisuje (viz Otevřené otázky).
11. Pokračovat přípravou ESX a nasazením (`20-deployment` 4).

## 5. Chybové stavy

| Situace | Následek / hláška | Verze | Zdroj |
|---|---|---|---|
| Málo CPU/RAM/storage vůči požadavkům management komponent | Installer „calculates management component requirements (NSX, vCenter) against physical capacity“ a zobrazí **„Resource Requirements Warning“** (proactive validation). Je to warning: pokud jsou zdroje prokazatelně dostačující, lze pokračovat. Falešný poplach mohou způsobit stale vCLS rezervace. Vypnutí validace v `application-prod.properties` jen po konzultaci s podporou. | VCF 9.0.x / VCF Installer | [P34] |
| **[9.1]** Planning workflow: požadavky neodpovídají infrastruktuře | Požadavky se „validated against the target infrastructure to ensure resource sufficiency“. Text hlášky ani to, zda jde o error nebo warning, není uveden. | 9.1 | [P27] |
| Zbytkové oddíly na ESA discích | „vSAN ESA Disks Eligibility Validation Failed“. „Erase Partitions“ selže s „ServerFaultCode: Failed to update disk partitions.“ | 9.0.x | [P34] |
| HCL databáze installeru starší než 90 dní | „ESX Host vSAN HCL Compatibility Validation Failed“, hosty jsou „Not HCL compatible“ i u ReadyNode. Řešení: nahrát aktuální `all.json` do `/nfs/vmware/vcf/nfs-mount/vsan-hcl/`. | 9.0.x | [P34] |
| Necertifikované ESA disky | Bez certifikace se nezapne Auto-RAID; „VCF automated workflows may block cluster creation“ | 9.1 | [P15] |
| 10GbE na vSAN ESA | spustí vSAN cluster compliance check (KB 372309) | 9.1 | [P15] |
| vSAN cluster se 3 uzly | nemá automatický rebuild komponent po výpadku; Reserved Capacity není podporována; podporuje jen „simple install of a management domain default vSphere cluster“ | 9.1 | [P15] |
| vSAN Storage Cluster < 4 uzly | nepodporováno („require minimum four (4) vSAN Nodes“) | 9.1 | [P15] |
| Multi-Rack L3 jako první cluster management domain | „Not supported for primary cluster“; jen jedna AZ | 9.1 | [P12] |
| Simple NSX Manager – výpadek uzlu | „Slower recovery from node failure“, restart přes vSphere HA; management a control plane zasaženy při upgradu | 9.1 | [P24] |
| Výpadek hostu v clusteru s minimem hostů | Poměr vCPU:pCPU vzroste („the CPU over-commitment ratio becomes 2:1“, zdůvodnění VCF-ESX-REQD-CFG-001) | 9.1 | [P14] |
| Primary cluster se 2 hosty při importu vCenteru s NSX HA | „There are not enough ESXi hosts in the primary cluster for the requested NSX deployment.“ / „ERROR - VALIDATION_FAILED“ – „Designated primary cluster contains only two ESXi hosts.“ | **VCF 5.x** (pro 9.x neověřeno) | [P36] |
| Chybí DNS / NTP / blokované porty | viz `20-deployment` 5 a 7 (KB 441245, 439240 atd.) | 9.x | – |

## 6. Limity a čísla

### 6.1 Minimální počet ESX hostů na cluster (Design Library 9.1)

**Single-Rack vSphere Cluster Model** [P9] (9.0 má stejná čísla [P10]). Úvodní věta: „You choose the number of
ESX hosts per vSphere which supports your storage type and VCF domain considerations.“

| Storage | Deployment model | Mgmt domain – default cluster | Mgmt domain – další clustery / WLD – všechny clustery | Rezerva na výpadek hostu | „Failure tolerance“ (doslova) |
|---|---|---|---|---|---|
| vSAN | Simple | **3** | **3** | 33 % CPU a RAM | „Tolerates one host failure“ |
| vSAN | High Availability | **4** | **4** ¹ | 25 % CPU a RAM | „Tolerates one availability zone failure“ ² |
| NFS nebo FC | Simple | **2** | **2** | 50 % CPU a RAM | „Tolerates one availability zone failure“ ² |
| NFS nebo FC | High Availability | **4** | **4** ¹ | 25 % CPU a RAM | „Tolerates one availability zone failure“ ² |

Pod tabulkou: „vSphere clusters are configured allowing for the failure of a single ESX host while still having
enough resources to run all vSphere cluster workloads.“ Poznámka: „Designs should be completed in consultation
with your storage vendor.“ [P9]
¹ V extrahovaném textu je u řádků HA jen jedna sada hodnot. Předpokládáme sloučenou buňku pro oba sloupce
(otevřená otázka 2).
² Text „availability zone“ u single-rack modelu je v rozporu s větou pod tabulkou (otevřená otázka 3).

**Multi-Rack Layer 2** [P11]:

| Storage | Mgmt default cluster – Simple | Mgmt default cluster – HA | Mgmt další clustery | WLD všechny clustery |
|---|---|---|---|---|
| vSAN | **3** | **4** | **3** | 3 ¹ |
| VMFS na FC / NFS | **2** | **4** | **2** | 2 ¹ |

¹ Ve výpisu jsou jen 3 hodnoty pro 4 sloupce. Hodnotu pro WLD předpokládáme jako sloučenou buňku s „další
clustery“ (otevřená otázka 2). Doporučeno: vSAN ESA jako principal storage (VCF-CLS-MR-RCMD-CFG-002) [P11].

**Multi-Rack Layer 3** [P12]: jen další clustery management domain a clustery WLD. vSAN **3**, VMFS na FC / NFS
**2**. Pro primární cluster management domain nepodporováno, jen jedna AZ.

**Stretched vSphere Cluster Model** [P13]:

| Storage | Model | Mgmt first cluster | Mgmt další clustery / WLD |
|---|---|---|---|
| vSAN | Simple | **6** | **6** |
| vSAN | Highly Available | **8** | z extrakce nejasné |
| NFS, FC (vMSC) | Simple | KB 417356 | min. **1 + 1** (celkem 2), doporučeno **2 + 2** (celkem 4) |
| NFS, FC (vMSC) | Highly Available | KB 417356 | z extrakce nejasné |

KB 417356 (VCF 9.x, vMSC): Simple min. 2 hosty (1 na site), doporučeno 4. HA (first mgmt cluster) min. **6**
(3 na site), doporučeno **8** (4 na site). „For a vMSC these numbers are doubled to account for the 2nd Site.“
[P35]. Stretched management domain je prerekvizitou stretched clusteru ve WLD [P13]. Stretch v management domain
je Day 2 [P7]. Konvergence: ≥ 3 hosty / AZ **[9.1]**, ≥ 2 hosty / AZ **[9.1.1+]** (`20-deployment` 6.3) [P31].

**Obecná vSAN pravidla** [P15]:
- Minimální platný vSAN HCI cluster = **3 uzly**. „Supports simple install of a management domain default vSphere
  cluster only.“ (VCF-VSAN-REQD-CFG-001)
- vSAN Storage Cluster = min. **4 uzly**.
- Doporučeno začínat **4 uzly** (VCF-VSAN-RCMD-CFG-001 a pro ESA VCF-VSAN-ESA-RCMD-CFG-004). Kvůli
  automatickému rebuildu, Reserved Capacity a kapacitně úsporné policy u ESA.

**Shrnutí pro greenfield management domain (single-rack nebo multi-rack L2, první cluster)**: vSAN Simple 3,
vSAN HA 4, NFS/FC Simple 2, NFS/FC HA 4 [P9][P11]. HA NSX Manager navíc vyžaduje „at least four physical hosts“
[P23]. Stejná čísla 3/2/4 uvádí stránka o konvergenci (`20-deployment` 6.3) [P31].

**Workload domain / další clustery** (single-rack, multi-rack): vSAN 3 (Simple) / 4 (HA), NFS/FC 2 (Simple) / 4
(HA) [P9]. Multi-rack L2/L3: vSAN 3, FC/NFS 2 [P11][P12].

### 6.2 HW minima a doporučení (souhrn)
| Položka | Hodnota | Typ | Zdroj |
|---|---|---|---|
| vSAN ESA jádra / uzel | ≥ 16 | requirement | [P15] |
| vSAN ESA RAM / uzel | ≥ 128 GB | requirement | [P15][P14] |
| vSAN OSA RAM (max. disk groups) | 32 GB | guidance | [P14] |
| ESA disk | ≥ 1,6 TB; max. 24 disků / uzel | requirement | [P15] |
| OSA disk groups / uzel | min. 1 (doporučeno 2); 1 cache + ≥ 1 capacity | req. / rec. | [P16] |
| Boot zařízení | ≥ 128 GB, high-endurance | recommendation | [P14] |
| pNIC / host (Single VDS) | 2 | model | [P17] |
| pNIC / VDS (multi-rack) | ≥ 2 | recommendation | [P11] |
| pNIC / vSAN uzel | 2 (small) / 4 (large) | recommendation | [P15] |
| Rychlost NIC | 25GbE doporučeno; vSAN min. 10GbE | rec. / req. | [P14][P15] |
| MTU TEP | min. 1700 (1600 absolutní minimum) | requirement | [P19] |
| MTU ostatní | min. 1500; doporučeno 9000 | req. / rec. | [P19][P18] |
| ToR switche / host | ≥ 1 (doporučeno ≥ 2) | req. / rec. | [P19] |
| Stretched inter-AZ | ≥ 10 Gbps, RTT < 5 ms | requirement | [P13] |
| vMSC mezi hosty clusteru | max. 10 ms RTT | KB | [P35] |

### 6.3 HA a admission control
- vSphere HA chrání všechny VM (VCF-CLS-REQD-CFG-004). Zbylé hosty musí mít kapacitu na restart [P9].
- **Admission control**: „Configure admission control for one (1) ESX host failure and percentage-based failover
  capacity“ (VCF-CLS-RCMD-CFG-001). Implikace: „In a vSphere cluster of four (4) ESX hosts, the resources of only
  three (3) ESX hosts are available for use.“ [P9][P11][P12][P13]. Platí v 9.0 i 9.1 [P10].
- Rezervy podle tabulky 6.1: 3 hosty = 33 %, 4 hosty = 25 %, 2 hosty = 50 % CPU a RAM [P9].
- ESX model: paměť „set the admission control setting to N+1, which reserves the resources of one host for
  failover or maintenance“ [P14].
- **Stretched**: navíc „Increase admission control percentage to half of the ESX hosts in the vSphere cluster“
  (VCF-CLS-RCMD-CFG-008). Hosty se přidávají po dvojicích, jeden do každé AZ. Host group per AZ
  (VCF-CLS-REQD-CFG-006) [P13]. Konvergence 2-node vSAN: admission control ≥ 50 % (`20-deployment` 6.3) [P31].
- vSAN HCI clustery: isolation address = gateway vSAN sítě, `das.usedefaultisolationaddress` = false
  (VCF-VSAN-REQD-CFG-006/007) [P15].
- Restart priority **high** pro NSX Manager appliance (VCF-NSX-LM-REQD-CFG-003) [P23][P24].
- Doporučeno: VM Monitoring (VCF-CLS-RCMD-CFG-002), DRS fully automated se střední prahovou hodnotou
  (VCF-CLS-RCMD-CFG-003) [P9].

### 6.4 vSAN – policy a kapacita (jen to, co uvádějí planning a design stránky)
- **[9.1]** „vSAN 9.1 automatically configures vSAN Auto-RAID policy on new vSAN ESA clusters“. Auto-RAID řídí
  odolnost dat „regardless of the size or topology“. Konkrétní FTT ani RAID stránka neuvádí [P15].
- OSA bez zadané policy použije vSAN Default Storage Policy s RAID-1 [P16].
- **Reserved Capacity** doporučena (VCF-VSAN-RCMD-CFG-003). Host Rebuild Reserve např. 25 % u 4 uzlů a 8 % u
  12 uzlů. Nepodporováno u 3uzlových, stretched a fault-domain clusterů [P15].
- **[9.0]** 4uzlový ESA cluster s Host Rebuild Reserve a Auto-Policy nemohl použít RAID-5. **[9.1]** Auto-RAID
  toto omezení odstraňuje [P15].
- Automatic Re-balance doporučen, výchozí práh 30 % [P15].
- Surová kapacita podle Workbooku (VCF-VSAN-REQD-CFG-002) [P15].
- OSA: při nasazení VCF clusteru není povolena volba „compression-only“. Data-at-rest encryption jen Day 2 [P16].

### 6.5 Plánování kapacity (CPU)
- Management domain: poměr **vCPU:pCPU ≤ 2:1**. „While higher ratios such as 3:1 or 4:1 are supported, you must
  closely monitor CPU ready times“ [P14].
- Workload domain: poměr se počítá případ od případu podle CPU náročnosti [P14].
- Počítat fyzická jádra a sizing dělat s ohledem na výpadek hostu a údržbu [P14].
- Celkové vCPU, RAM a disk sizing profilů (první instance: Simple 76 vCPU / 251 GB / 7448 GB … HA Large 298 /
  949 / 15357) jsou v `20-deployment` 6.2 [P26]. Day-2 Log management zvětšuje workery a Real-time metrics
  přidává workery [P26].

## 7. Síťový provoz

Toky, které plyne z plánovacích a design stránek. Porty uvádíme jen tam, kde je dokládá zdroj; jinak
viz `20-deployment` 7 / `00-architektura` 7 (portál ports.broadcom.com [P39] nejde agentem přečíst).

| # | Odkud | Kam | Síť / VLAN | MTU | Typ provozu | Zdroj |
|---|---|---|---|---|---|---|
| 1 | ESX (vmk management) | vCenter, SDDC Manager, NSX Manager | ESX management (static IPv4) | 1500 | správa hostů | [P18][P21] |
| 2 | ESX ↔ ESX (vmk vMotion) | jiné hosty v clusteru | vMotion VLAN (pool / DHCPv4) | 9000 | migrace VM | [P18][P21] |
| 3 | ESX ↔ ESX (vmk vSAN) | jiné hosty v clusteru | vSAN VLAN (dedikovaná, gateway povinná) | 9000 | synchronní replikace vSAN („high speed, low latency“), ≥ 10GbE | [P15][P18] |
| 4 | ESX (vmk NFS) | NFS array | NFS VLAN | 9000 | principal storage | [P18] |
| 5 | ESX Host TEP ↔ Host TEP / Edge TEP | jiné transport nody | Host TEP VLAN (1 IP / aktivní uplink) | min. 1700 (1600), dop. 9000; Geneve, DF bit | NSX overlay (east-west) | [P19][P21] |
| 6 | NSX Edge (Tier-0 uplinks) | fyzické routery (eBGP / static / OSPF) | uplink VLAN | – | north-south; eBGP „Fully supported“, iBGP nedoporučeno | [P19] |
| 7 | VM management síť | vCenter, NSX, SDDC Manager, cloud proxy | VM management VLAN | – | management appliance | `20-deployment` 7 [P5] |
| 8 | AZ1 ↔ AZ2 (stretched) | vSAN, vMotion, management, TEP | stretched L2 + routovaný vSAN mezi AZ | – | replikace storage; ≥ 10 Gbps, RTT < 5 ms | [P13][P20] |
| 9 | Hosty obou AZ | vSAN witness (3. fault doména) | witness síť | 1500 | vSAN witness provoz | [P13][P19] |
| 10 | VCF Instance ↔ VCF Instance | – | routovaná síť | min. 1500 | provoz mezi instancemi fleet | [P19] |
| 11 | Komponenty | DNS (53), NTP (UDP 123 – doloženo pro VCF Operations) | management | – | resolve, čas | `20-deployment` 7 |

Pro vizualizaci zátěže: vMotion má v NIOC share **Low**, management **Normal**, VM a IP storage **High**
(defaulty Single VDS modelu) [P17]. vSAN port group má teaming Failover Order (VCF-VSAN-NET-RCMD-CFG-007) [P15].
Ostatní port groups mají „Route based on physical NIC load“ [P17].

## 8. Otevřené otázky

1. **Obsah Planning and Preparation Workbooku 9.1.1** (tab „Management Domain Sizing“: vzorec pro počet hostů,
   overcommit, HA rezerva, vSAN overhead). Soubor je xlsx a agent ho nemohl rozbalit (bez shellu). Doporučeno:
   uživatel exportuje tab do CSV.
2. **Sloučené buňky v tabulkách minim** – single-rack HA (4 pro default i další clustery?), multi-rack L2
   (hodnota pro WLD), stretched HA (další clustery / WLD a NFS/FC HA). Extrakce HTML tabulky byla nejednoznačná;
   ověřit v PDF (`vmware-cloud-foundation-9-1.pdf`).
3. **Sloupec „failure tolerance“ v Single-Rack tabulce** uvádí „Tolerates one availability zone failure“ u vSAN HA
   a NFS/FC, což u single-rack (1 AZ) nedává smysl. Věta pod tabulkou mluví o výpadku jednoho hostu.
   Pravděpodobně chyba v dokumentaci; v modelu brát „1 host failure“, ale ověřit.
4. **Musí součet vCPU sizing profilu „vejít“ do kapacity hostů?** Dokumentace neuvádí tvrdé pravidlo ani vzorec.
   Doloženo je toto: (a) **[9.1]** planning workflow validuje „resource sufficiency“ proti cílové infrastruktuře
   [P27]; (b) **[9.0.x]** installer porovnává požadavky NSX a vCenter s fyzickou kapacitou a hlásí **warning**,
   se kterým lze pokračovat [P34]; (c) design: vCPU:pCPU ≤ 2:1 v management domain, N+1, fyzická jádra
   [P14]. Nejasné zůstává: zda je ve 9.1 nedostatek zdrojů error, nebo warning; zda se kontroluje vCPU vs.
   fyzická jádra (a s jakým poměrem), nebo jen RAM a storage; zda se odečítá HA rezerva.
5. **Konkrétní obrazovky a hlášky integrovaného planning workflow 9.1** – stránka wizardu na ně jen odkazuje
   (`gethidpage?ux-context-string=vcf_506`).
6. **Simple NSX Manager**: VCF-NSX-LM-RCMD-CFG-001 chce prostředky na 3 uzly i u Simple modelu [P24]. Je to
   záměr (rezerva pro pozdější přechod na HA), nebo chyba stránky?
7. **Minimální počet hostů pro HA VCF management services** (3 CP s anti-affinity) – stránka [P25] ho neuvádí.
   Předpoklad: kryje ho minimum 4 pro HA model.
8. **ESX design 9.0** – URL stránky 9.0 (esx-design) vrátila 404, rozdíly CPU/RAM/boot mezi 9.0 a 9.1 jsou proto
   neověřené.
9. **Dual-stack v 9.0** – 9.1 stránka tvrdí „VCF 9.1 and later supports IPv4-only and dual-stack“; explicitní
   tvrzení pro 9.0 nebylo ověřeno.
10. **Single-host / 2-host management domain** – komunitní zdroje zmiňují lab workaroundy pro VCF 9.1.1. Na
    TechDocs ani v KB nebyla nalezena oficiální podpora, takže je ve hře nemodelovat.
11. **Minimální velikost clusteru NSX Edge, vSAN compute cluster (client) a VCF Edge / remote clusterů** –
    nezpracováno (patří do `51-nsx`, `50-vsan`).
12. **Konkrétní VLAN ID / počet VLAN** pro bring-up – dokumentace dává jen doporučení „dedicated VLAN per traffic
    type“, žádný pevný seznam. Seznam sítí ve wizardu je v `20-deployment`.
13. **Porty** pro vSAN, vMotion, Geneve (TEP), witness – v povolených zdrojích nedoloženo (portál [P39] je JS).

## 9. Zdroje

Základ: `https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/`

- [P1] Planning and Preparation (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/planning-and-preparation.html
- [P2] VCF Components FQDNs and IP addresses (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/planning-and-preparation/vcf-components-fqdns-and-ip-addresses.html
- [P3] First VCF Instance FQDNs and IP addresses (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/planning-and-preparation/vcf-components-fqdns-and-ip-addresses/first-vcf-instance-fqdns-and-ip-addresses.html
- [P4] Additional VCF Instance FQDNs and IP addresses (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/planning-and-preparation/vcf-components-fqdns-and-ip-addresses/additional-vcf-instance-fqdns-and-ip-addresses.html
- [P5] Network Deployment Options for VCF Components (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/planning-and-preparation/network-deployment-options-for-vcf-components.html
- [P6] Public URLs Required for Online Functionalities (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/planning-and-preparation/public-urls-required-for-vmware-cloud-foundation.html
- [P7] Management Domain Model (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/workload-domain-deployment-models/management-domain-deployment-model.html
- [P8] Workload Domain Model (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/workload-domain-deployment-models/workload-domain-deployment-model.html
- [P9] Single-Rack vSphere Cluster Model (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/cluster-models/single-instance-single-availability-zone.html
- [P10] Single-Rack vSphere Cluster Model (9.0): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/design/design-library/cluster-models/single-instance-single-availability-zone.html
- [P11] Multi-Rack Layer 2 vSphere Cluster Model (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/cluster-models/multi-rack-cluster-detailed-design/layer-2-multi-rack-cluster.html
- [P12] Multi-Rack Layer 3 vSphere Cluster Model (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/cluster-models/layer-3-multi-rack-cluster.html
- [P13] Stretched vSphere Cluster Model (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/cluster-models/single-instance-multiple-availability-zones.html
- [P14] ESX Model / ESX design (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/vsphere-detailed-design/esx-design.html
- [P15] Single-Rack vSAN ESA Storage Model (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/storage-models-9-x/standard-vsan-storage-model/single-rack-storage-models/vcf-hardware-configuration-for-vsan.html
- [P16] Single-Rack vSAN OSA Storage Model (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/storage-models-9-x/standard-vsan-storage-model/single-rack-storage-models/vsan-osa-storage-model.html
- [P17] Single Distributed Switch Model (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/network-designs/vsphere-cluster-network-models/simple-network-model.html
- [P18] VMkernel Detailed Design (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/network-designs/vmkernel-design.html
- [P19] Physical Data Center Network Design (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/datacenter-network-requirements/physical-datacenter-design-9-x.html
- [P20] Data Center Network Requirements (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/datacenter-network-requirements.html
- [P21] IPv4 Addressing Model (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/datacenter-network-requirements/infrastucture-ip-addressing-models/ipv4-addressing-model.html
- [P22] Infrastructure IP Addressing Detailed Design (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/datacenter-network-requirements/infrastucture-ip-addressing-models.html
- [P23] High Availability NSX Manager Model (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/nsx-management-and-control-plane-detailed-design/high-availability-nsx-manager-model.html
- [P24] Simple NSX Manager Model (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/nsx-management-and-control-plane-detailed-design/simple-nsx-manager-model.html
- [P25] High Availability VCF Management Services Model (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/vcf-management-services-availabilty-detailed-design/vcf-management-services-high-availability-deployment-model.html
- [P26] VCF Fleet Sizing Models (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/vmware-cloud-foundation-concepts/vcf-fleet-sizing-models-9-x.html
- [P27] What's New in VCF Installer 9.1: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/release-notes/vmware-cloud-foundation-9-1-0-0-release-notes/what-s-new/whats-new-installer.html
- [P28] Preparing ESX Hosts (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/preparing-esx-hosts-for-vmware-cloud-foundation-or-vmware-vsphere-foundation.html
- [P29] Configure NTP on ESX Hosts (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/preparing-esx-hosts-for-vmware-cloud-foundation-or-vmware-vsphere-foundation/configure-ntp-on-vmware-cloud-foundation-hosts.html
- [P30] Configure the Network on ESX Hosts (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/preparing-esx-hosts-for-vmware-cloud-foundation-or-vmware-vsphere-foundation/configure-the-network-on-vmware-cloud-foundation-hosts.html
- [P31] Convergence – Supported and Not Supported Configurations (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/converging-your-existing-vsphere-infrastructure-to-a-vcf-or-vvf-platform-/supported-and-not-supported-configurations.html
- [P32] KB 392993 – Minimum number of ESXi hosts required on vSAN clusters for deployment of VCF Management Domain (odkazuje na [P7]): https://knowledge.broadcom.com/external/article/392993/minimum-number-of-esxi-hosts-required-on.html
- [P33] KB 452580 – How to Verify ESXi Host Compatibility for VCF 9.1: https://knowledge.broadcom.com/external/article/452580
- [P34] KB 442952 – Resolving VCF 9 Deployment Failures: Disk Eligibility and False-Positive HCL Warnings (VCF 9.0.x): https://knowledge.broadcom.com/external/article/442952
- [P35] KB 417356 – Considerations for Implementing vMSC on VCF 9.x: https://knowledge.broadcom.com/external/article/417356
- [P36] KB 444651 – vCenter import fails in SDDC Manager (VCF 5.x; 2 hosty vs NSX): https://knowledge.broadcom.com/external/article/444651/vcenter-import-fails-in-sddc-manager-wit.html
- [P37] Planning and Preparation (9.0): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/planning-and-preparation.html
- [P38] VCF 9.1.1 Release Notes (bez změn minim hostů/HW): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/release-notes/vmware-cloud-foundation-9-1-1-0-release-notes.html
- [P39] VMware Ports and Protocols (odkaz z [P1]): https://ports.broadcom.com/
- [P40] VMware Configuration Maximums (odkaz z [P1]): https://configmax.broadcom.com/
- [P41] Planning and Preparation Workbook 9.1.1: https://techdocs.broadcom.com/content/dam/broadcom/techdocs/us/en/assets/vmware-cis/vcf/vcf-9.1.1-planning-and-preparation-workbook.xlsx
- [P42] Planning and Preparation Workbook 9.1.0: https://techdocs.broadcom.com/content/dam/broadcom/techdocs/us/en/assets/vmware-cis/vcf/vcf-9.1-planning-and-preparation-workbook.xlsx
