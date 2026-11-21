# 40 – Workload domény a stopa nasazení (Building Cloud Infrastructure)

> Modelovaná verze: **VCF 9.1.1** (viz `docs/spec/VERSION.md`). Rozdíly jsou označené **[9.0]** / **[9.1]** / **[9.1.1+]**.
> Odkazy `[Wxx]` vedou na konkrétní stránky (seznam v sekci 9). Stav výzkumu: 2026-11-21.
> Zaměření: podklad pro herní režim **„Hotové scénáře“**. Ten ukazuje plně nasazená prostředí: všechny běžící VM,
> kde běží a kolik zdrojů spotřebují. Navazuje na `00-architektura` (komponenty, sizing profily), `06-blueprints`
> (topologie), `10-planning` (minimální počty hostů) a `20-deployment` (bring-up).
>
> Značení: *(odvozeno)* = součet nebo počet spočítaný z dokumentovaných čísel, v dokumentaci tak přímo není.
> *(parafráze)* = převyprávěný text, ne doslovná citace.
> **[WB …]** = buňka oficiálního **VCF 9.1.1 Planning and Preparation Workbooku** [W28], např.
> `[WB SRT C317]` = list „Static Reference Tables“, buňka C317; `[WB MDS K22]` = list „Management Domain Sizing“.
> Lokální kopie listů: `docs/spec/data/vcf-9.1.1-workbook-Static_Reference_Tables.tsv`,
> `docs/spec/data/vcf-9.1.1-workbook-Management_Domain_Sizing.tsv`. Hodnoty jsou uložené hodnoty buněk, vzorce se
> nevyhodnocují. List MDS ukazuje jen jednu aktuální kombinaci vstupů (First Instance, HA, Medium, VCF Operations
> a VCF Automation vyloučené), proto mají přednost statické referenční tabulky (SRT).

---

## 1. Shrnutí

- **Workload domain (WLD)** – „Creating a new workload domain adds a logical pool of compute, network, and storage
  infrastructure to a VCF instance.“ [W1]
- VCF má dva typy domén. **Management domain** vytváří VCF Installer při nasazení nebo konvergenci. **Workload
  domains** se nasazují nebo importují až potom. Každá WLD má vCenter a NSX Manager (NSX Manager lze sdílet mezi
  doménami) a jeden nebo více vSphere clusterů *(parafráze)* [W2].
- WLD se v 9.1 **vytváří ve VCF Operations**: Operate → Overview → Inventory → VCF Instances → **Add workload domain →
  Create new** [W1].
- **vCenter a NSX Manager nové WLD neběží v WLD, ale v management domain**: „For newly-deployed workload domains, NSX
  Manager and vCenter are deployed on the management domain primary cluster.“ [W1]. Proto každá další WLD zvětšuje
  spotřebu management domain. Workbook to potvrzuje: „As each workload domain requires additional vSphere and,
  optionally, NSX components to be deployed, this tab allows you to correctly calculate the requirements for your
  management domain …“ [WB MDS, Notes].
- Hosty WLD tvoří nový cluster. Ten nese business workloady a volitelně vSphere Supervisor (control plane VM)
  a NSX Edge / Virtual Network Appliance uzly [W1][W12][W13].
- Na úrovni **VCF Instance** platí: každá další instance má vlastní management domain (vCenter, NSX, SDDC Manager,
  cloud proxy, instance-level VCF management services). **VCF Operations, VCF Automation a License server** v ní
  **nejsou**, protože běží jen v první instanci [W5][W6][W17].

---

## 2. Komponenty a vztahy

### 2.1 Co obsahuje workload domain a kde to běží (9.1)

| Komponenta WLD | Počet | Kde běží (VM) | Zdroj |
|---|---|---|---|
| vCenter | právě 1 na WLD (dedikovaný, vlastní SSO doména) | **management domain – primární cluster** | [W1][W3] |
| NSX Manager | nový: 1 uzel (Simple) nebo 3 uzly (High-Availability) + VIP („Appliance Cluster FQDN“); **nebo** připojení k existujícímu NSX Manageru (0 nových VM). Workbook nabízí volby „Shared“, „Dedicated - Single Node“, „Dedicated - HA Cluster“ [WB SRT C532–C534]. | **management domain – primární cluster** | [W1] |
| ESX hosty | ≥ minimum podle cluster modelu a storage (viz 6.2) | vlastní hosty WLD (commissioned, stav UNASSIGNED → přiřazené) | [W1][W8] |
| vSphere cluster | 1..n; první vzniká při vytvoření WLD (pokud nejde o „Domain infrastructure only“) | hosty WLD | [W1][W4] |
| vSphere Distributed Switch | ≥ 1 na cluster; **[9.1.1+]** další clustery mohou sdílet VDS prvního clusteru | hosty WLD | [W1][W2] |
| vSphere Supervisor (volitelný, **výchozí zapnutý**) | „a Supervisor, a single Supervisor control plane VM, and a single vSphere zone“ | control plane VM v clusteru WLD *(odvozeno: vSphere zone = cluster WLD; dokumentace umístění VM výslovně neuvádí)* | [W1] |
| NSX Edge cluster (volitelný) | ≥ 2 Edge uzly; nasazuje se **po** vytvoření WLD (Centralized Connectivity) | vSphere cluster / host group, který zvolí admin | [W1][W12] |
| Virtual Network Appliance (VNA) cluster (volitelný) | **[9.1]** lze nasadit při vytvoření WLD (Distributed Connectivity + Supervisor) nebo později; 1 IP/FQDN (2 pro cluster) | zvolený vSphere cluster | [W1][W13] |

Supervisor a VNA podle [W1] *(parafráze)*:
- **[9.1+]** VNA cluster lze nasadit už při vytváření WLD a zajišťuje NAT a load balancing.
- Pokud Supervisor používá Centralized Transit Gateway, je k dokončení aktivace potřeba Edge cluster s tier-0
  gateway. Výjimkou je znovupoužití NSX Manageru, který už kompatibilní Edge cluster má.
- VNA Edge cluster nepotřebuje.

### 2.2 Dedikovaný vs. sdílený NSX Manager

- Volba v kroku **Networking**: **Create New NSX Manager Instance** / **Join Existing NSX Manager Instance** [W1].
- **[9.1]** Lze se připojit i k NSX Manageru management domain [W1]. Taxonomie: „New workload domains can share the same
  NSX Manager cluster with an existing workload domain or with the management domain, or you can deploy a new NSX
  Manager cluster.“ (`00-architektura` [S1]). Workbook: „The management domain is mandatory and cannot be deselected.
  Its NSX Manager instance is required and can be shared with future workload domains.“ [WB MDS, Notes]
- **[9.0]** „Workload domains cannot use the NSX Manager cluster for the management domain.“ (`00-architektura` [S10]).
  Stránka 9.0 [W9] umožňuje sdílet jen NSX Manager jiné workload domény.
- **[9.1.1+]** Při sdílení se sdílí i Full Stack VPC napříč přidruženými doménami *(parafráze)* [W1].
- NSX Federation: „A maximum of four NSX Local Manager instances may be federated by a single NSX Global Manager
  instance.“ [WB MDS, Notes]
- Kompatibilita sdíleného NSX [W1]:

| Sdílený NSX | vCenter WLD | Stav |
|---|---|---|
| NSX 9.1 | vCenter 9.1 | plné funkce |
| NSX 9.1 | vCenter 9.0.x | pinned (funkce vCenter 9.0) |
| NSX 9.1 | vCenter 8.0.x | pinned (funkce vCenter 8.0) |
| NSX 9.0.x | vCenter 9.0.x | plné funkce |
| NSX 4.2.x | vCenter 8.0.x | legacy mode |

- Trade-offy dedikovaný vs. sdílený (footprint, blast radius, lifecycle) jsou v `05-design` 2.5 [D9]. Dedikovaný NSX:
  „Higher footprint as each workload domain requires a dedicated NSX Manager cluster.“

### 2.3 Typy vytvoření WLD (9.1) [W2]

1. **Create a New Workload Domain** – plné nasazení s clusterem [W1].
2. **Create a New Workload Domain without a vSphere Cluster** („Domain infrastructure only“): nasadí jen vCenter
   a NSX Manager do management domain, bez hostů [W4].
3. **Import an Existing vCenter to Create a Workload Domain** [W10].
4. **Workload Domain with a Layer 3 Multi-Rack vSAN HCI Cluster** [W2].

### 2.4 Co nasazuje každá další VCF Instance (9.1)

Podle FQDN tabulky další instance [W5], sizing tabulky [W6], workbooku [W28] a modelů VCF management services [W17]:

| Komponenta | Další instance (Simple) | Další instance (HA) | Zdroj |
|---|---|---|---|
| vCenter (management domain) | 1 | 1 | [W5][W6] |
| ESX hosty | 1 FQDN / host | 1 FQDN / host | [W5] |
| NSX Manager | 1 uzel + VIP | 3 uzly + VIP | [W5][W6] |
| SDDC Manager | 1 | 1 | [W5][W6] |
| VCF Operations Cloud Proxy | 1 | 1 | [W5][W6] |
| VCF management services (VCF services runtime) – control plane | 1 | 3 | [W6]; [WB SRT C314–C315] |
| VCF management services – worker | **1** (workbook) / 2 (stránka) | **2** (stránka) / 3 (workbook) | [W6]; [WB SRT C336–C339]; viz 6.4 |
| Identity broker, Software depot (volitelně) | Day-N, **uvnitř VCF services runtime, žádná další appliance** | dtto | [W5][W17]; [WB MDS, Notes] |
| Real-time metrics | Day-N, uvnitř VCF services runtime | dtto | [W5][W17] |
| **VCF Operations, VCF Automation, License server** | **ne** | **ne** | [W5][W6]; `00-architektura` [S1] |

- Model VCF management services pro další instanci: „Smaller VCF management services instance for running VCF Instance
  level components only.“ [W17]
- Workbook: „Components Realtime Data, Software depot and Identity broker are configured within the VCFMS instance. No
  additional appliances are deployed.“ a „Optional Software depots and Identity broker deployments can be sized for
  additional VCF Instances. vCPU and RAM requirements for these components are allocated from the existing VCFMS
  cluster.“ [WB MDS, Notes]
- **[9.1.1+]** „VCF Operations resides in the management domain of the first VCF Instance“ [W11].
- Nasazení: VCF Installer → „Deploy a new VCF Instance“, připojení k existující VCF Operations (`20-deployment` 2.5).
- Každá instance má vlastní WLD (max. 40 na instanci, viz 6.1). Z [W1] („management domain primary cluster“) plyne,
  že vCenter a NSX workload domén další instance běží v management domain **té instance**, ve které se WLD vytváří
  *(odvozeno)*.

---

## 3. Prerekvizity

### 3.1 Vytvoření WLD s clusterem (9.1) [W1]

- „Hosts must be commissioned with the target principal storage type.“
- Pokud mají hosty management domain express patch, musí být hosty nové domény nainstalované se stejným patchem
  *(parafráze)*.
- vVols: nejdřív přidat VASA provider. vVols je deprecated *(parafráze)*.
- vSAN: každý host má SSD/NVMe disky bez existujících oddílů. V image library VCF musí existovat vSphere Lifecycle
  Manager image *(parafráze)*.
- Statický IP pool nebo DHCP na VLAN NSX host overlay (Host TEP). **[9.1.1+]** neplatí pro VLAN-backed VPC (TEP-less).
- Každý host má alespoň jednu fyzickou NIC připojenou ke standard switchi *(parafráze)*. **[9.0]** „Each host must have at
  least one physical NIC, with a minimum of 10 Gbps speed“ [W9].
- „A network pool with free IP addresses must be available.“
- IP adresy a FQDN vCenteru a NSX Manageru musí být resolvovatelné v DNS.
- Full Stack VPC s Distributed Connectivity: 1 IP/FQDN pro Virtual Network Appliance (2 pro cluster).
- **[9.1.1+]** První cluster nové WLD nemůže sdílet VDS (žádný zatím neexistuje); další clustery mohou sdílet VDS
  prvního clusteru *(parafráze)*.
- Dual-stack: SDDC Manager musí být v dual-stack módu; NSX overlay (TEP) je jen IPv4 a potřebuje vlastní IPv4 rozsah
  v network poolu *(parafráze)*.
- **Kapacita management domain** pro nový vCenter (a NSX) WLD – workbook ji počítá v listu Management Domain Sizing
  [WB MDS G18–G21] (viz 6.5).
- Licence: stránka [W1] žádnou licenční prerekvizitu neuvádí (viz 3.4).

### 3.2 Domain infrastructure only [W4]
- FQDN a IP vCenteru a NSX Manageru resolvovatelné v DNS. „No unassigned ESX hosts are required for creating this workload
  domain.“ [W1]

### 3.3 Commission hostů (před vytvořením WLD) [W8][W14]
- Nejdřív musí existovat **network pool**, který podporuje storage typ hostu [W8][W14].
- Požadavky na host [W8] *(parafráze)*:
  - vSAN host: „vSAN-compliant and certified on the VMware Hardware Compatibility Guide“;
  - správný počet fyzických NIC;
  - management IP na VMkernel portu ve Management Network na standard switchi, gateway v management subnetu;
  - forward i reverse DNS záznam, hostname = FQDN;
  - self-signed certifikát regenerovaný podle FQDN;
  - podporovaná verze ESX;
  - HW health OK, drivery a firmware podle HCL;
  - smazané všechny diskové oddíly.
- Výsledek: „Each host is added to the free pool and is available for VCF domains and vSphere clusters.“ Hosty se
  zobrazí v tabulce Unassigned Hosts; vSAN hosty jdou jen do vSAN clusterů, NFS hosty jen do NFS clusterů *(parafráze)*
  [W8].

### 3.4 Licence (9.1) [W15]
- Licence se přiřazuje **vCenter instanci** ve VCF Operations. „Your other assets that are connected to that vCenter
  instance, including ESX hosts, are then licensed automatically.“
- Prerekvizity *(parafráze)*:
  - oprávnění Licensing > Manage;
  - VCF Operations registrované ve VCF Business Services console;
  - aspoň jedna primární licence přidaná do VCF Operations a license serveru;
  - VCF Instance integrovaná s VCF Operations;
  - licence s kapacitou pro všechny ESX hosty vCenteru.
- Getting Started: „Assigning a license must be done right after you complete deployment.“ (`00-architektura` [S9]).

### 3.5 Další VCF Instance
- Existující první instance s VCF Operations (`20-deployment` 2.5). DNS záznamy additional instance před nasazením
  (VCF-MS-REQD-ADTL-001/002, `06-blueprints` 2.4 [B18]). FQDN bez velkých písmen a bez `.local` u kontejnerových
  služeb [W5].

---

## 4. Workflow

### 4.1 Create a New Workload Domain (9.1, VCF Operations) [W1]

1. Přihlásit se do **VCF Operations**.
2. Horní lišta **Operate** → vlevo **Overview** > **Inventory**.
3. Rozbalit **VCF Instances** a vybrat instanci.
4. Rozbalovací menu **Add workload domain** → **Create new**.
5. Projít prerekvizity → **Select All** → **Proceed**. Otevře se průvodce **Workload Domain**.
6. **General information**:
   - **Workload Domain Name** (3–20 znaků);
   - **Full deployment with cluster** nebo **Domain infrastructure only**;
   - volitelně **vSphere Supervisor** (výchozí zapnuto);
   - volitelně **Dual-Stack (IPv4 and IPv6) Networking**;
   - **SSO Domain Name** (izoluje doménu).

   Hesla appliance se generují automaticky (lze je získat přes SDDC Manager API).
7. **vCenter**: **vCenter FQDN**, **vCenter IP Address**, **vCenter Gateway**. Volbu velikosti vCenteru stránka
   neuvádí.
8. **Cluster**: **Cluster name**; volitelně **Manage this cluster by using vSphere Lifecycle Manager images**; při
   Supervisoru **vSphere Zone Name**.
9. **Image**: **Select an image from the catalog** nebo **Extract an image from a host in this VCF instance**.
10. **Networking**: **Create New NSX Manager Instance** / **Join Existing NSX Manager Instance**.
    - Create new: **Deployment Size** **Simple** („Deploys single-node NSX Manager requiring fewer resources.“) nebo
      **High-Availability** (doporučeno; „Deploys a three-node NSX Manager cluster …“); **Appliance Size** **Medium /
      Large / Extra Large**; **Appliance 1/2/3 FQDN** a **Appliance Cluster FQDN** (2 a 3 se u Simple nezadávají).
    - **[9.1.1+]** **VPC Network Configuration**: **Full Stack VPC** / **VLAN-Backed VPC**.
    - **VPC Gateway Connectivity** (jen Full Stack VPC):
      - **Centralized Connectivity** – Edge cluster, konfigurace po vytvoření domény;
      - **Distributed Connectivity** – VNA; zadává se **VLAN ID** a **Gateway CIDR IPv4 Address** (musí odpovídat
        gateway na ToR), při Supervisoru i FQDN VNA.

      VPC nepodporuje IPv6.
11. **Storage**: **vSAN**, **NFS**, **VMFS on FC** nebo **vVol**. U vSAN:
    - ESA se zapíná přepínačem, jinak se použije OSA;
    - typ clusteru: vSAN HCI, vSAN Compute Cluster (OSA) nebo vSAN Storage (ESA);
    - data-in-transit encryption, rekey interval (výchozí 1440 min);
    - jen OSA: Failures to Tolerate, deduplikace a komprese.
12. **Hosts**: vybrat commissioned hosty se stejným storage typem („Your selection determines the minimum number of
    required ESX hosts.“).
13. **vSphere Distributed Switch**: profil **Default** (1 VDS, doporučeno), **Storage Traffic Separation** (2),
    **NSX Traffic Separation** (2), **Storage Traffic and NSX Traffic Separation** (3), nebo Custom → **Create
    Distributed Switch**.
14. **vSphere Supervisor** (jen pokud je zapnutý): Supervisor Name, Service CIDR, Control Plane IP Range (min. 5 adres),
    NSX Project, VPC Connectivity Profile, Private (Transit Gateway) CIDR, Private CIDR, Workload DNS, Workload NTP.
15. Review → **Finish**. „After successful validation, workload domain creation starts.“
16. Průběh: **Fleet Management** > **Tasks**.

**[9.0] rozdíly** [W9]:
- Cesta je **Inventory > Detailed View** → VCF Instances → **Add Workload Domain** → **Create New**.
- NSX deployment size se jmenuje **Standard** (místo Simple).
- Supervisor vyžaduje Centralized Connectivity a NSX Edge cluster s tier-0 active-standby. Alternativa přes VNA
  uvedená není.
- Každý host potřebuje NIC ≥ 10 Gbps.
- Stránka neuvádí, kde běží NSX Manager. U vCenteru uvádí: „The vCenter for a workload domain deployed in the
  management domain.“

### 4.2 Domain infrastructure only [W4]
1.–5. Jako 4.1. Na stránce General information zvolit „Domain infrastructure only“.
6. **vCenter**: FQDN a SSO domain name.
7. **Networking**: nový nebo existující NSX Manager (Simple/HA, appliance size, FQDN); **[9.1.1+]** VPC konfigurace.
8. Review → **Finish** → Fleet Management > Tasks.
- Výsledek: „The new vCenter and NSX Manager instances are deployed in the management domain.“ Potom přidat cluster:
  „After you add a cluster to the domain, all lifecycle operations are available.“

### 4.3 Po vytvoření WLD
1. Přiřadit licenci vCenteru WLD: VCF Operations → **Manage** → **Licensing** > **Licenses & Registration** → záložka
   **Version 9+** → tabulka **vCenter Systems** → vybrat vCenter → **Assign Primary License** → licence → **Assign**
   [W15].
2. Volitelně síťová konektivita přes Edge cluster ve vSphere Clientu (vCenter WLD) → **Networks > Transit Gateways** →
   **Setup Network Connectivity** → Centralized Connection → Edge cluster (form factor, ≥ 2 Edge uzly) → konektivita
   domény → **Deploy** [W12].
3. Nebo VNA cluster: vSphere Client → Networking → **Configure** → **VNA Clusters** → **Add Cluster** → Form Factor
   (výchozí medium) → **Add Node** → **Apply** [W13].
4. Clustery a hosty se do existující WLD přidávají ve vSphere Clientu [W2].

### 4.4 Commission hostů (9.1) [W8]
Cesta: **Global Inventory Lists** > **Hosts** > **Unassigned Hosts** → **Commission Hosts** (stránka zmiňuje i SDDC
Manager UI jako alternativu).
1. Checklist → **Select All** → **Proceed**.
2. **Add new** (po jednom) nebo import JSON šablony: FQDN, storage type, network pool name, root credentials.
3. Ověřit fingerprint → **Confirm All Finger Prints**.
4. **Validate All**.
5. **Next**, volba **Skip failed hosts during commissioning** (výchozí zapnuto).
6. **Commission**.

### 4.5 Další VCF Instance
Bring-up přes VCF Installer („Deploy a new VCF Instance“), viz `20-deployment` 4.2. Výsledná sada VM je v 2.4.

---

## 5. Chybové stavy

| Situace | Chování / hláška | Verze | Zdroj |
|---|---|---|---|
| Host neprojde validací při commissioningu | stav „Invalid“; opravit a „validate again“, nebo hosta **Remove** a commissionovat jen validní | 9.1 | [W8] |
| MAC address filtering na síti | „Multiple VMkernels are created to test the vMotion network“ – může způsobit selhání validace vMotion konektivity *(parafráze)* | 9.1 | [W8] |
| Host se špatným storage typem | vSAN host jen do vSAN clusteru, NFS host jen do NFS clusteru *(parafráze)* | 9.1 | [W8] |
| Chybí network pool / nemá volné IP | prerekvizita nesplněna („A network pool with free IP addresses must be available.“); přesná hláška neuvedena | 9.1 | [W1] |
| FQDN vCenter/NSX neresolvuje | prerekvizita nesplněna; přesná hláška neuvedena | 9.1 | [W1] |
| Validace průvodce | „After successful validation, workload domain creation starts.“ – bez úspěšné validace se nevytvoří; konkrétní texty chyb stránka neuvádí | 9.1 | [W1] |
| WLD bez clusteru | „A workload domain without a vSphere cluster cannot be a management domain.“; „You cannot enable vSphere Supervisor for a workload domain without a vSphere cluster.“; „You cannot patch or upgrade the components in the workload domain before adding a vSphere cluster.“; patch/upgrade je blokovaný i u WLD, která s takovou doménou sdílí NSX Manager *(parafráze)* | 9.1 | [W4] |
| **[9.0]** WLD chce sdílet NSX management domain | nepodporováno | 9.0 | `00-architektura` [S10] |
| **[9.1.1+]** První cluster WLD chce sdílet VDS | nelze, VDS ještě neexistuje | 9.1.1 | [W1] |
| Licence bez dostatečné kapacity | „the assignment fails“ | 9.1 | [W15] |
| Přidání hostu, jehož jádra přesahují zbývající kapacitu | host je přidán v „evaluation mode“ (90 dní); pak se odpojí od vCenteru (VM zůstanou) | 9.1 | [W15] |
| Expirace licence vCenteru | hosty se odpojí i s override licencí, workload operace se zastaví *(parafráze)* | 9.1 | [W15] |
| Selhání přiřazení licence ve VCF Operations 9.1 | zkontrolovat síťovou konektivitu vCenter ↔ VCF Operations *(parafráze)* | 9.1 | [W15] |
| Supervisor s Centralized TGW bez Edge clusteru | aktivace Supervisoru se nedokončí, dokud se nenasadí Edge cluster s tier-0 (pokud se nepoužije NSX s kompatibilním Edge clusterem) *(parafráze)* | 9.1 | [W1] |
| Edge cluster s < 2 uzly | „A minimum of two Edge Nodes are required to deploy an Edge Cluster.“ | 9.1 | [W12] |
| Cluster bez kapacity pro Edge | Edge uzly rezervují 100 % CPU shares a paměti; cluster/resource pool musí mít kapacitu aspoň pro 2 Edge uzly *(parafráze)* | 9.1 | [W12] |
| Management domain bez rezervy | každá WLD přidá vCenter (+ NSX) do management domain; „You may need to expand the resources in the management domain …“ | 9.1 | [W1]; `05-design` [D9] |
| NSX Manager příliš malý pro WLD | limity velikostí: Medium „128 Hosts - 5 vSphere Clusters“, Large „1024 Hosts - 256 vSphere Clusters“, XLarge „2048 Hosts - 512 vSphere Clusters“; Small „POC only“ (hláška neuvedena) | 9.1.1 | [WB SRT B646–C651] |

---

## 6. Limity a čísla

### 6.1 Limity domén

| Položka | Hodnota | Zdroj |
|---|---|---|
| WLD na VCF Instance | max. **40** **[9.1]** / **24** **[9.0]** | `00-architektura` [S6]/[S12] |
| vCenter na WLD | 1 (dedikovaný, vlastní SSO doména) | [W1][W3] |
| NSX Manager pro novou WLD | 1 uzel (Simple) / 3 uzly (HA) / 0 (sdílený) | [W1] |
| Jméno WLD | 3–20 znaků | [W1] |
| Supervisor Control Plane IP Range | min. 5 adres | [W1] |
| Edge uzly v Edge clusteru | min. 2; zjednodušený workflow ve vCenteru max. 10 | [W12] |
| vSAN rekey interval (výchozí) | 1440 min | [W1] |
| NSX Local Managerů na 1 Global Manager | max. 4 | [WB MDS, Notes] |
| Kapacita vCenteru | Tiny 10 hostů / 100 VM · Small 100 / 1000 · Medium 400 / 4000 · Large 1000 / 10000 · XLarge 2000 / 35000 | [W18]; [WB SRT B639–C644] |
| Kapacita NSX Manageru | Extra_Small „Cloud Service Manager Only“ · Small „POC only“ · Medium 128 hostů / 5 clusterů · Large 1024 / 256 · XLarge 2048 / 512 | [WB SRT B646–C651] |

### 6.2 Minimální počty hostů WLD
Čísla jsou převzatá z `10-planning` 6.1:

| Cluster model / storage | Simple | HA |
|---|---|---|
| Single-rack, vSAN | 3 | 4 |
| Single-rack, NFS/FC | 2 | 4 |
| Multi-rack L2/L3, vSAN | 3 | 3 |
| Multi-rack L2/L3, FC/NFS | 2 | 2 |
| Stretched vSAN | min. 6 (3 na site) | min. 6 (3 na site) |

Průvodce WLD sám minimum neuvádí: „Your selection determines the minimum number of required ESX hosts.“ [W1].

### 6.3 Velikosti jednotlivých appliance (per VM)

Primární zdroj je **workbook 9.1.1** [W28], konkrétně list „Static Reference Tables“ (SRT). Všechny hodnoty jsou
na jednu VM: vCPU / RAM GB / Disk GB.

| Komponenta | Velikost | vCPU | RAM | Disk | Zdroj (workbook) | Shoda s TechDocs |
|---|---|---|---|---|---|---|
| SDDC Manager | – | 4 | 16 | 914 | SRT C33–C35 | = VCF Installer [W24] |
| vCenter | Tiny | 2 | 14 | 619 | SRT C37, C43, C49 | = [W18][W19] |
| vCenter | Small | 4 | 21 | 734 | SRT C38, C44, C54 | = [W18][W19] |
| vCenter | Medium | 8 | 30 | 933 | SRT C39, C45, C59 | = [W18][W19] |
| vCenter | Large | 16 | 39 | 1383 | SRT C40, C46, C64 | = [W18][W19] |
| vCenter | XLarge | 24 | 58 | 2308 | SRT C41, C47, C69 | = [W18][W19] |
| vCenter – storage Large / XLarge | dle velikosti | – | – | Tiny 2059/4319 · Small 2084/4344 · Medium 2233/4493 · Large 2283/4543 ¹ · XLarge 2408/4668 | SRT C50–C73 | = [W19] |
| NSX Manager | Extra_Small | 2 | 8 | 300 | SRT C75, C81, C87 | (jen workbook) |
| NSX Manager | Small | 4 | 16 | 300 | SRT C76, C82, C88 | = [W20] (9.0) |
| NSX Manager | Medium | 6 | 24 | 300 | SRT C77, C83, C89 | = [W20][W21] |
| NSX Manager | Large | 12 | 48 | 300 | SRT C78, C84, C90 | = [W20] |
| NSX Manager | XLarge | 24 | 96 | 400 | SRT C79, C85, C91 | = [W20] |
| NSX Edge | Small / Medium / Large / XLarge | 2 / 4 / 8 / 16 | 4 / 8 / 32 / 64 | 200 | SRT C93–C114 | = [W12] |
| Virtual Network Appliance | Small / Medium / Large / XLarge | 2 / 4 / 8 / 16 | 4 / 8 / 32 / 64 | 200 | SRT C97–C118 | TechDocs čísla neuvádí; výchozí form factor „medium“ [W13] |
| VCF Operations uzel | Extra Small / Small / Medium / Large / Extra Large | 2 / 4 / 8 / 16 / 24 | 8 / 16 / 32 / 48 / 128 | **274** (všechny) | SRT C159–C175 | CPU/RAM = KB 9.0 [W22]; disk jen workbook |
| Cloud proxy | Small | 4 | 16 | 264 | SRT C177, C181, C185 | = Unified Small [W23] |
| Cloud proxy | Standard | 8 | 48 | 264 | SRT C178, C182, C186 | = Unified Standard [W23] |
| VCF Automation uzel | Small | 24 | 96 | 600 | SRT C135, C139, C143 | TechDocs čísla neuvádí |
| VCF Automation uzel | Medium | 24 | 96 | 900 | SRT C136, C140, C144 | dtto |
| VCF Automation uzel | Large | 32 | 128 | 1200 | SRT C137, C141, C145 | dtto |
| VCF services runtime – control plane uzel | Small / Small HA / Medium | 4 | 10 | 100 | SRT C317–C319, C322–C324, C327–C329 | TechDocs čísla neuvádí |
| VCF services runtime – control plane uzel | Large | 8 | 14 | 100 | SRT C320, C325, C330 | dtto |
| VCF services runtime – worker uzel | Simple / HA-Small / HA-Medium / HA-Large | 12 / 10 / 12 / 16 | 24 / 16 / 24 / 32 | viz pozn. ² | SRT C341–C357 | CPU/RAM = [W6] |
| Supervisor control plane VM | Tiny / Small / Medium / Large / Xlarge | 2 / 4 / 8 / 16 / 32 | 8 / 16 / 24 / 32 / 64 | 48 | SRT C400–C416 | minimum pro VPC 4/16/48 = [W21] |
| **License server** | Default | **v workbooku není** | – | – | – | otevřená otázka 1 |

¹ U Large uvádí workbook dvě hodnoty: „LargeXLarge“ 4543 (C68) a „Largexlstorage“ 4553 (C67). TechDocs [W19] uvádí 4543.

² **Disk workerů** je ve workbooku jedna hodnota na profil, ne na uzel:

| Instance | Simple | HA-Small | HA-Medium | HA-Large | Zdroj |
|---|---|---|---|---|---|
| První | 2900 | 2800 | 3300 | 4002 | SRT C359–C362 |
| Další | 1000 | 1000 | 1202 | 1500 | SRT C363–C366 |

List MDS při vstupu HA-Medium a 3 workerech ukazuje „VCF services runtime worker nodes“ 3 uzly / 36 vCPU / 72 GB /
**3300 GB** [WB MDS J23–M23]. Disk 3300 je tedy **celkem za všechny workery**, ne na uzel *(odvozeno)*. Control
plane: 3 uzly / 12 / 30 / 300 [WB MDS J22–M22], tedy 100 GB na uzel.

**Day-N a služby uvnitř VCF services runtime (bez vlastních VM)** – workbook:
- Log management na repliku: Small 8/16, Medium 16/32, Large 32/64 [WB SRT C378–C385]. Workery se při jeho zapnutí
  zvětší (`00-architektura` 6 [W6]).
- Day-0 služby (Identity broker, Software depot, Salt, Salt RaaS, Telemetry, Fleet LCM, SDDC LCM) mají CPU/RAM
  rozpočty per profil [WB SRT B417–C496]. Pro HA-Medium dávají celkem 19.8 vCPU / 28.14 GB [WB SRT C398–D398]
  a „are allocated from the existing VCFMS cluster“ [WB MDS, Notes]. Do VM footprintu se nepřičítají, protože běží
  ve workerech.
- VCF Operations for networks: platform Small–XXL 4–24 vCPU / 16–128 GB / 1024–2048 GB; collector 2–16 / 4–48 /
  250–300 [WB SRT C211–C245] (Day-N, ve scénářích není).

### 6.4 Sizing profily – počty uzlů a celkové součty

**Celkové součty (stránka VCF Fleet Sizing Models)** [W6]:

| Profil | První instance (vCPU / RAM / Disk) | Další instance (vCPU / RAM / Disk) |
|---|---|---|
| Simple | 76 / 251 GB / 7448 GB | 34 / 111 GB / 4562 GB |
| HA – Small | 106 / 335 GB / 8422 GB | 62 / 187 GB / 5462 GB |
| HA – Medium | 184 / 656 GB / 11445 GB | 74 / 244 GB / 5813 GB |
| HA – Large | 298 / 949 GB / 15357 GB | 120 / 353 GB / 8321 GB |

**Platí pro 9.1.1?** Workbook je verze **9.1.1** [W28] a jeho per-VM hodnoty CPU/RAM po sečtení dávají součty
ze stránky [W6] (viz rozbor níže). Pro CPU a RAM proto bereme stránku [W6] jako platnou pro 9.1.1 *(odvozeno)*.
- **[9.1]** Simple jen Small; HA Medium (výchozí) nebo Large.
- **[9.1.1+]** Small výchozí pro Simple i HA [W11] (`20-deployment` 4.2 krok 5).
- **[9.1.1+]** „VCF management services now require less compute and memory resources for all deployment sizes.“
  [W11]; brownfield se přizpůsobí podle KB 455842 [W25].

**Počet worker uzlů – rozpor workbook × stránka:**

| Instance / profil | Stránka [W6] | Workbook [WB SRT C332–C339] | Který počet sedí na celkový součet CPU/RAM [W6] *(odvozeno)* |
|---|---|---|---|
| První – Simple | 2 | 2 | 2 (shoda) |
| První – HA-Small | 3 | 3 | 3 (shoda) |
| První – HA-Medium | 3 | 3 | 3 (shoda) |
| První – HA-Large | **4** | **3** | **4** (stránka) |
| Další – Simple | **2** | **1** | **1** (workbook) |
| Další – HA-Small | **2** | **3** | **2** (stránka) |
| Další – HA-Medium | **2** | **3** | **2** (stránka) |
| Další – HA-Large | **2** | **3** | **2** (stránka) |

Control plane: Simple 1, HA 3 [WB SRT C314–C315], stejně jako na stránce [W6].

**Pro hru**: použít počty ze sloupce „sedí na součet“. U nich součet per-VM hodnot workbooku dá přesně celkové
CPU/RAM ze stránky [W6] (u první instance po připočtení License serveru, viz níže). Rozpory jsou v otevřené otázce 2.

**Kontrola součtů (CPU/RAM)** *(odvozeno)*:
- Další instance: Simple (1 worker) 34/111, HA-Small 62/187, HA-Medium 74/244, HA-Large 120/353. Všechny přesně
  odpovídají [W6].
- První instance: Simple 74/247, HA-Small 104/331, HA-Medium 182/652, HA-Large (4 workery) 296/945. Proti [W6]
  chybí vždy přesně **2 vCPU / 4 GB**. Ty pravděpodobně připadají na **License server**, který v SRT chybí
  *(odvozeno z rozdílu, nedoloženo)*.
- **Disk nesedí**: součty per-VM disků jsou menší než disk v [W6], rozdíl je 1062–3172 GB podle profilu. Hra má
  použít disk z [W6] jako celek (otevřená otázka 3).

### 6.5 „Co běží a kolik to žere“ – hotové scénáře

Pravidla:
- Per-VM hodnoty jsou z 6.3 (workbook). Počty uzlů jsou ze sloupce „sedí na součet“ v 6.4.
- **„Celkem (dokumentováno)“** je součet ze stránky [W6]. Ten je pro celou management domain směrodatný.
- **„Součet per-VM“** je *(odvozeno)* bez License serveru, disk workerů je celkem za profil (pozn. ² v 6.3).
- **VCF Installer**: když se nasadí na host budoucí management domain, stane se SDDC Managerem a VM navíc nevzniká.
  Když se nasadí mimo (installer mode), běží **mimo fleet** jako VM 4/16/914 [W24] (`20-deployment` 4.1.5). V součtech
  není.
- Day-N komponenty (Log management, VCF Operations for networks, Real-time metrics, Orchestrator, HCX) nejsou
  součástí výchozího nasazení (`20-deployment` 2.2), proto v tabulkách nejsou.

#### Scénář 1 – Nejmenší, vše Simple (blueprint „Minimal Footprint“)

Topologie podle `06-blueprints` 2.1 [B3][B4]:
- 1 instance, jen management domain;
- 1 cluster pro management i workloady;
- **3 hosty** (vSAN);
- VCF Installer: model „Simple“, velikost „Small“.

| # | VM | Počet | Velikost | vCPU / RAM / Disk na VM | Kde běží |
|---|---|---|---|---|---|
| 1 | vCenter (management) | 1 | Small | 4 / 21 / 734 | mgmt domain, default cluster |
| 2 | NSX Manager | 1 (+VIP) | Medium | 6 / 24 / 300 | mgmt domain |
| 3 | SDDC Manager | 1 | – | 4 / 16 / 914 | mgmt domain |
| 4 | VCF Operations (primary) | 1 | Small | 4 / 16 / 274 | mgmt domain |
| 5 | Cloud proxy | 1 | Small | 4 / 16 / 264 | mgmt domain (VM management network) |
| 6 | License server | 1 | Default | neuvedeno (≈ 2 / 4 *(odvozeno z rozdílu)*) | mgmt domain |
| 7 | VCF Automation | 1 | Small | 24 / 96 / 600 | mgmt domain |
| 8 | VCF services runtime – control plane | 1 | Small | 4 / 10 / 100 | mgmt domain |
| 9 | VCF services runtime – worker | 2 | Simple (12/24) | 24 / 48 celkem, disk 2900 celkem | mgmt domain |
| | **Celkem VM** | **10** *(odvozeno)* | | | |
| | **Součet per-VM** *(odvozeno, bez License serveru)* | | | **74 / 247 GB / 6086 GB** | |
| | **Celkem (dokumentováno)** | | | **76 / 251 GB / 7448 GB** [W6] | |

Model management services [W17] uvádí u Simple „Three worker nodes.“. Workbook i sizing stránka ale uvádějí 2,
proto počítáme se 2. Blueprint navíc obsahuje Day-N volby „Simple VCF Operations for Networks“, „Simple Log
Management“ a „Simple vSphere Supervisor Control Plane“ (`06-blueprints` 2.1). Ty v součtu nejsou.

#### Scénář 2 – HA instalace (management domain HA)

Topologie: 1 instance, management domain HA, **4 hosty** vSAN (`10-planning` 6.1).

| VM | HA – Small | HA – Medium | HA – Large |
|---|---|---|---|
| vCenter | 1× Small 4/21/734 | 1× Medium 8/30/933 | 1× Large 16/39/1383 |
| NSX Manager | 3× Medium 6/24/300 | 3× Medium 6/24/300 | 3× Large 12/48/300 |
| SDDC Manager | 1× 4/16/914 | 1× 4/16/914 | 1× 4/16/914 |
| VCF Operations | 2× Small 4/16/274 (primary, replica) | 3× Medium 8/32/274 (primary, replica, data) | 3× Large 16/48/274 |
| Cloud proxy | 1× Small 4/16/264 | 1× Standard 8/48/264 | 1× Standard 8/48/264 |
| License server | 1× (neuvedeno) | 1× (neuvedeno) | 1× (neuvedeno) |
| VCF Automation | 1× Medium 24/96/900 ³ | 3× Medium 24/96/900 | 3× Large 32/128/1200 |
| Runtime control plane | 3× 4/10/100 | 3× 4/10/100 | 3× 8/14/100 |
| Runtime worker | 3× 10/16 (disk 2800 celkem) | 3× 12/24 (disk 3300 celkem) | 4× 16/32 (disk 4002 celkem) ⁴ |
| **Celkem VM** *(odvozeno)* | **16** | **19** | **20** |
| **Součet per-VM** *(odvozeno, bez License serveru)* | **104 / 331 / 7360** | **182 / 652 / 10133** | **296 / 945 / 12185** |
| **Celkem (dokumentováno)** [W6] | **106 / 335 GB / 8422 GB** | **184 / 656 GB / 11445 GB** | **298 / 949 GB / 15357 GB** |

Vše běží v management domain (default cluster) [W3] (`00-architektura` 2.1). Po nasazení se pro HA VCF Operations
přidává DRS anti-affinity pravidlo (`20-deployment` 4.4).

³ Sizing [W6] uvádí „1x Medium“, ale podle [W26] Medium automaticky znamená 3 uzly (otevřená otázka 4). Počet VM
16 počítá s 1 uzlem, jak uvádí [W6].
⁴ Workbook uvádí 3 workery [WB SRT C335]. S nimi by součet byl 280 / 913 *(odvozeno)*, celkový součet [W6] sedí
jen se 4 workery.

#### Scénář 3 – Management domain + 1 workload doména (blueprint „VCF Fleet in a Single Site“)

Blueprint (`06-blueprints` 2.2 [B6][B7]):
- management domain HA, VCF Installer „High Availability“ / „Medium“;
- workloady v samostatné WLD;
- WLD: Host Fault Tolerant NSX Edge Cluster, HA vSphere Supervisor Control Plane, Virtual Network Appliance LB.

**A) Management domain** = Scénář 2, HA – Medium (19 VM, 184 / 656 GB / 11445 GB) [W6].

**B) Přírůstek v management domain za WLD** [W1]. Řádky WLD w01–w35 v listu MDS mají jako výchozí vstup vCenter
**Medium** / storage **Default** a NSX **„Dedicated - HA Cluster“** [WB MDS D44, F44, H44]. NSX je Medium u w01
(I44), u většiny dalších řádků Large.

| VM | Počet | Velikost | vCPU / RAM / Disk na VM | Kde běží |
|---|---|---|---|---|
| vCenter WLD | 1 | Medium (výchozí vstup workbooku) ⁵ | 8 / 30 / 933 | mgmt domain primary cluster |
| NSX Manager WLD – „Dedicated - HA Cluster“ | 3 (+VIP) | Medium (nebo Large / XLarge) | 6 / 24 / 300 (L 12/48/300 · XL 24/96/400) | mgmt domain primary cluster |
| NSX Manager WLD – „Dedicated - Single Node“ | 1 (+VIP) | dtto | dtto | mgmt domain primary cluster |
| NSX Manager WLD – „Shared“ **[9.1]** | 0 | – | – | – |

⁵ Průvodce 9.1 volbu velikosti vCenteru neuvádí [W1]. Workbook ji jako vstup má (otevřená otázka 5).

**C) V clusteru WLD** (hosty WLD):

| VM | Počet | Velikost | vCPU / RAM / Disk na VM | Poznámka |
|---|---|---|---|---|
| Supervisor control plane VM | 1 (výchozí, „a single Supervisor control plane VM“ [W1]); 3 doporučeno [W21] | Tiny–Xlarge [WB SRT]; minimum pro VPC Small | Small 4 / 16 / 48 | jen při zapnutém Supervisoru (výchozí) |
| NSX Edge uzly | ≥ 2 | Medium / Large / XLarge (Small jen PoC) | M 4/8/200 · L 8/32/200 · XL 16/64/200 | jen u Centralized Connectivity; nasazuje se po vytvoření WLD; cluster si volí admin |
| Virtual Network Appliance | 1 (2 pro cluster) [W1] | výchozí medium [W13] | Medium 4 / 8 / 200 [WB SRT C98, C107, C116] | jen u Distributed Connectivity |
| Business workloady | – | – | – | hlavní účel WLD |

Hosty WLD: vSAN HA min. 4, Simple min. 3 (`10-planning` 6.1). Blueprint uvádí v DNS „ESX: 4 nodes“ a nerozlišuje
mgmt a WLD (`06-blueprints` 2.2, otevřená otázka 7).

**Součty** *(odvozeno)*:

| Varianta | Přírůstek v mgmt domain | Management domain celkem | VM v mgmt domain |
|---|---|---|---|
| Dedikovaný HA NSX Medium + vCenter Medium | 8 + 18 = **26 vCPU / 102 GB / 1833 GB** | **210 vCPU / 758 GB / 13 278 GB** | **23** |
| Sdílený NSX **[9.1]** + vCenter Medium | **8 / 30 / 933** | **192 / 686 GB / 12 378 GB** | **20** |

**Příklad clusteru WLD** *(odvozeno)*: 1 Supervisor CP Small (4/16/48) + 2 Edge Large (2× 8/32/200) =
**20 vCPU / 80 GB / 448 GB**. U Edge platí 100% rezervace CPU shares a paměti [W12].

#### Scénář 4 – Více workload domén v jedné instanci

Každá další WLD přidá do **management domain** [W1]:
- **vždy** 1× vCenter (výchozí vstup workbooku Medium 8/30/933 [WB MDS D44]),
- **podle volby** 0 / 1 / 3 uzly NSX Manageru (Shared / Dedicated - Single Node / Dedicated - HA Cluster
  [WB SRT C532–C534]).

V clusteru každé WLD případně běží Supervisor CP VM, Edge uzly nebo VNA (jako ve Scénáři 3 C). Workbook má 35 řádků
pro WLD (w01–w35) [WB MDS B44–B78], limit dokumentace je 40 na instanci (6.1). Kapacitu management domain je nutné
dimenzovat předem: „You must carefully size the management domain to accommodate planned deployments of additional
workload domains and management components.“ (`05-design` 3 [D5]).

**Příklad: management domain HA – Medium + 2 WLD, vCenter Medium** *(odvozeno)*:

| Varianta NSX | Celkem v management domain | VM v mgmt domain |
|---|---|---|
| **4a)** každá WLD má dedikovaný HA NSX Medium: 184 + 2×26 | **236 vCPU / 860 GB / 15 111 GB** | 19 + 2×4 = **27** |
| **4b)** obě WLD sdílí jeden nový HA NSX Medium (první WLD ho vytvoří, druhá se připojí): 184 + 2×8 + 18 | **218 vCPU / 788 GB / 14 211 GB** | 19 + 2 + 3 = **24** |
| **4c) [9.1]** obě WLD sdílí NSX management domain: 184 + 2×8 | **200 vCPU / 716 GB / 13 311 GB** | 19 + 2 = **21** |

#### Scénář 5 – Více VCF instancí (blueprint „Multiple Sites Across Multiple Regions“)

Topologie: Region 1 = první instance (HA – Medium), Region 2 = další instance (HA – Medium), každá 4 hosty, 1 fleet
(`06-blueprints` 2.4 [B16][B17]).

| VM | Instance 1 (Region 1) | Instance 2 (Region 2) |
|---|---|---|
| vCenter (mgmt) | 1× Medium 8/30/933 | 1× Medium 8/30/933 |
| NSX Manager | 3× Medium 6/24/300 | 3× Medium 6/24/300 |
| SDDC Manager | 1× 4/16/914 | 1× 4/16/914 |
| VCF Operations | 3× Medium 8/32/274 | – |
| Cloud proxy | 1× Standard 8/48/264 | 1× Standard 8/48/264 |
| License server | 1× (neuvedeno) | – |
| VCF Automation | 3× Medium 24/96/900 | – |
| Runtime control plane | 3× 4/10/100 | 3× 4/10/100 |
| Runtime worker | 3× 12/24 (disk 3300 celkem) | 2× 12/24 (disk 1202 celkem) ⁶ |
| **VM v mgmt domain** *(odvozeno)* | **19** | **11** |
| **Součet per-VM** *(odvozeno)* | 182 / 652 / 10133 (bez License serveru) | **74 / 244 / 4513** |
| **Celkem (dokumentováno)** [W6] | **184 / 656 GB / 11445 GB** | **74 / 244 GB / 5813 GB** |
| **Fleet celkem** *(odvozeno z [W6])* | **258 vCPU / 900 GB / 17 258 GB**, 30 VM | |

⁶ Workbook uvádí pro další instanci HA 3 workery [WB SRT C338]. S nimi by součet byl 86 / 268 *(odvozeno)* a neseděl
by na [W6].

Varianty instance 2 *(součty per-VM odvozené, celkové součty z [W6])*:

| Profil | Uzly runtime | Počet VM | Součet per-VM | Celkem [W6] |
|---|---|---|---|---|
| Simple | 1 CP + **1** worker | **6** | 34 / 111 / 3312 | 34 / 111 GB / 4562 GB |
| HA – Small | 3 CP + 2 worker | 11 | 62 / 187 / 3112 | 62 / 187 GB / 5462 GB |
| HA – Large | 3 CP (8/14) + 2 worker (16/32) | 11 | 120 / 353 / 5261 | 120 / 353 GB / 8321 GB |

Volitelně Day-N v instanci 2: Identity broker, Software depot, Real-time metrics. Běží uvnitř VCF services runtime
a nepřidávají appliance [W5][W17][WB MDS, Notes]. Workload domény se přidávají per instance. WLD v Region 2 mají
vCenter/NSX v management domain instance 2 (viz 2.4).

---

## 7. Síťový provoz

Porty jsou převzaté z `00-architektura` 7 a `20-deployment` 7 (TechDocs + KB). Portál Ports and Protocols je
JavaScriptová aplikace a jeho obsah se nepodařilo stáhnout (viz tamní otevřené otázky).

| # | Odkud | Kam | Port / protokol | Typ provozu | Platí pro | Zdroj |
|---|---|---|---|---|---|---|
| 1 | Admin (prohlížeč) | VCF Operations | HTTPS | průvodce Create Workload Domain, Fleet Management > Tasks | 9.1 | [W1] |
| 2 | VCF Operations / SDDC Manager | mgmt domain vCenter | neuvedeno | nasazení VM vCenteru a NSX Manageru WLD do mgmt primary clusteru | 9.1 | [W1] |
| 3 | vCenter WLD (VM v mgmt domain) | ESX hosty WLD | 443 (HTTPS), 902, ICMP | správa hostů, přidání do clusteru, vLCM | 9.0.1 / 9.x | `00-architektura` [S31] |
| 4 | ESX hosty WLD | vCenter WLD | UDP 902 | heartbeats | 9.x | `00-architektura` [S32] |
| 5 | ESX hosty WLD (vmk0) | všechny uzly NSX Manageru WLD (v mgmt domain) | TCP 443, 1234, 1235 | příprava host transport node, spojení s NSX | NSX 4.x/9.x | `00-architektura` [S29] |
| 6 | NSX Manager WLD | vCenter WLD | TCP 80 (do 9.1.0) / 443 (**[9.1.1+]**) | registrace compute manageru, sync inventáře | viz zdroj | `00-architektura` [S30] |
| 7 | SDDC Manager | uzly NSX Manageru | 443 | prerekvizita importu vCenteru jako WLD | 9.1 | [W10] |
| 8 | VCF Operations (uzly) / cloud proxy | vCenter WLD | 443 | monitoring, licence | 9.x | `00-architektura` [S33]; [W15] |
| 9 | Hosty WLD | hosty WLD | neuvedeno (vMotion, vSAN, Geneve TEP) | east-west provoz clusteru WLD | 9.1 | [W1] |
| 10 | NSX Edge uzly (cluster WLD) | ToR (BGP peery) / NSX Manager | neuvedeno | north-south (Centralized), management Edge → NSX Manager („Edge management must reach NSX Manager“ *(parafráze)*) | 9.1 | [W12] |
| 11 | VNA | ToR gateway (VLAN ID + Gateway CIDR) | neuvedeno | north-south (Distributed) | 9.1 | [W1] |
| 12 | VCF Operations (Region 1) | cloud proxy a mgmt services instance 2 | neuvedeno | management WAN mezi instancemi | 9.1 | `06-blueprints` 7 #7 |
| 13 | Fleet lifecycle (instance 1) | SDDC lifecycle (instance 2) | neuvedeno | orchestrace lifecycle | 9.1 | `00-architektura` [S2] |

Pro vizualizaci: provoz WLD má dvě „ramena“. Řízení (vCenter WLD, NSX WLD) běží jako VM v management domain
a řídí hosty v racku WLD (toky 3–6). Datový provoz workloadů zůstává v clusteru WLD a ven jde přes Edge nebo VNA
(toky 9–11).

---

## 8. Otevřené otázky

**Vyřešeno workbookem 9.1.1 [W28]:**
- Velikosti per VM: control plane uzly runtime, VCF Automation, disk VCF Operations, cloud proxy (= Unified
  varianta), NSX Manager, Edge, VNA, Supervisor (6.3).
- Platnost sizingu pro 9.1.1: CPU a RAM ze stránky [W6] sedí na per-VM hodnoty workbooku 9.1.1 (6.4).
- Velikost vCenteru WLD jako vstup sizingu: workbook ji nabízí, výchozí vstup je Medium.

**Stále otevřené:**
1. **License server** – velikost není ve workbooku (SRT) ani v TechDocs. Rozdíl 2 vCPU / 4 GB mezi součty a [W6] na
   ni ukazuje *(odvozeno)*, ale není to doloženo.
2. **Počty worker uzlů** – workbook [WB SRT C332–C339] a stránka [W6] se liší u první instance HA-Large (3 vs 4)
   a u všech profilů další instance (Simple 1 vs 2, HA 3 vs 2). Celkové CPU/RAM na [W6] sedí na „smíšené“ počty
   (6.4). Model services [W17] navíc u Simple uvádí 3 workery. Hra použije počty, které sedí na součty. Nutné
   potvrzení od Broadcomu nebo z nové verze dokumentace.
3. **Disk** – součty per-VM disků (včetně disku workerů z SRT) jsou o 1062–3172 GB menší než disk na [W6]. Část
   rozdílu by vysvětlila větší storage vCenteru (např. HA-Medium další instance: +1300 = vCenter Medium Large
   storage 2233 − 933). Obecné pravidlo ale nenalezeno. Zda je disk workerů v SRT na uzel, nebo celkem, je odvozeno
   z MDS M23.
4. **VCF Automation v HA – Small**: „1x Medium“ [W6] vs. „Medium … automatically scales the deployment out to 3 nodes“
   [W26]. Součet CPU/RAM na [W6] sedí s 1 uzlem Medium.
5. **Velikost vCenteru WLD v produktu** – průvodce 9.1 [W1] volbu nemá, workbook ji jako vstup má (výchozí Medium).
   SDDC Manager API `VcenterSpec.vmSize` je doložené jen pro API 5.2.5 [W27]. Jakou velikost VCF Operations skutečně
   nasadí, není ověřeno.
6. **Umístění Supervisor control plane VM** – „single vSphere zone“ na clusteru WLD. Že VM běží v clusteru WLD, je
   odvozeno.
7. **Hosty v blueprintu Single Site** – „ESX: 4 nodes“ nerozlišuje mgmt a WLD.
8. **Velikost a počet Edge uzlů pro „Host Fault Tolerant NSX Edge Cluster“** – design stránka nebyla zpracována
   (`05-design` OQ 8).
9. **Licence WLD**: průvodce [W1] licenční prerekvizitu neuvádí. Chování WLD před přiřazením licence není popsáno.
   Popsán je jen evaluation mode hostu při nedostatku kapacity [W15].
10. **Day-N komponenty ve „hotových“ scénářích** – workbook dává velikosti (Log management per replika, Ops for networks).
    Zda je hra ve scénářích zobrazí, je herní rozhodnutí.
11. **Přesné texty validačních chyb** průvodce WLD – stránka [W1] je neuvádí.
12. **Max. počet WLD sdílejících jeden NSX Manager** a max. počet VCF Instancí ve fleet – nenalezeno. Nepřímo:
    kapacita NSX Medium 128 hostů / 5 clusterů [WB SRT C649].
13. **Rozpor storage vCenteru Large/xlstorage** ve workbooku (4543 vs 4553 GB, [WB SRT C67/C68]). TechDocs [W19]
    uvádí 4543.

---

## 9. Zdroje

- [W1] Create a New Workload Domain (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/building-your-private-cloud-infrastructure/working-with-workload-domains/deploy-a-vi-workload-domain-using-the-sddc-manager-ui.html
- [W2] Managing VCF Domains / Working with Workload Domains (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/building-your-private-cloud-infrastructure/working-with-workload-domains.html
- [W3] VCF Taxonomy (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/overview-of-vmware-cloud-foundation-9/workload-domains-in-vmware-cloud-foundation.html
- [W4] Create a New Workload Domain without a vSphere Cluster (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/building-your-private-cloud-infrastructure/working-with-workload-domains/create-a-workload-domain-without-an-esx-cluster.html
- [W5] Additional VCF Instance FQDNs and IP addresses (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/planning-and-preparation/vcf-components-fqdns-and-ip-addresses/additional-vcf-instance-fqdns-and-ip-addresses.html
- [W6] VCF Fleet Sizing Models (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/vmware-cloud-foundation-concepts/vcf-fleet-sizing-models-9-x.html
- [W8] Commission ESX Hosts (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/building-your-private-cloud-infrastructure/host-management/commission-hosts.html
- [W9] Create a New Workload Domain (9.0): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/building-your-private-cloud-infrastructure/working-with-workload-domains/deploy-a-vi-workload-domain-using-the-sddc-manager-ui.html
- [W10] Import an Existing vCenter to Create a Workload Domain (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/building-your-private-cloud-infrastructure/working-with-workload-domains/import-an-existing-vcenter-to-create-a-workload-domain.html
- [W11] VCF Installer / SDDC Manager 9.1.1.0 Release Notes: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/release-notes/vmware-cloud-foundation-9-1-1-0-release-notes/sddc-manager-9-1-1-0-release-notes.html
- [W12] Configure Centralized Network Connectivity with Edge Clusters (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/building-your-private-cloud-infrastructure/managing-network-connectivity-in-vcenter/managing-centralized-network-connectivity-with-edge-clusters.html
- [W13] Create a Virtual Networking Appliance Cluster (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/building-your-private-cloud-infrastructure/managing-network-connectivity-in-vcenter/add-virtual-network-appliance-clusters.html
- [W14] Network Pool Management (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/building-your-private-cloud-infrastructure/host-management/about-network-pools.html
- [W15] Assign a Primary License to a vCenter Instance (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/licensing/assign-a-licenses-to-a-vcenter-instance.html
- [W17] VCF Management Services Models (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/vmware-cloud-foundation-concepts/vcf-management-services-models.html
- [W18] Hardware Requirements for the vCenter Appliance (vSphere 9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/vcenter-installation-and-setup/deploying-the-vcenter-server-appliance/vcenter-server-appliance-requirements/vcenter-server-appliance-hardware-requirements.html
- [W19] Storage Requirements for the vCenter Appliance (vSphere 9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/vcenter-installation-and-setup/deploying-the-vcenter-server-appliance/vcenter-server-appliance-requirements/vcsa-storage-requirements.html
- [W20] Deploy NSX Manager Nodes to Form a Cluster from the UI (VCF **9.0**; Node Size): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/advanced-network-management/administration-guide/scale-up-nsx-manager/installing-nsx-manager-cluster-on-vsphere/install-nsx-manager-and-available-appliances/deploy-nsx-manager-nodes-to-form-a-cluster-using-ui.html
- [W21] Requirements for Supervisor Deployment with VPC Networking (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/vsphere-supervisor-installation-and-configuration/supervisor-networking-with-virtual-private-clouds/nsx-vpc-workflow-for-supervisor/requirements-for-supervisor-deployment-with-nsx-vpc.html
- [W22] KB 397782 – VCF Operations 9.0 Sizing Guidelines: https://knowledge.broadcom.com/external/article/397782/vcf-operations-90-sizing-guidelines.html
- [W23] Deploy Cloud Proxy for the VCF 9.1 Upgrade (velikosti cloud proxy): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/upgrading-cloud-foundation/upgrade-backup-and-restore/configuring-cloud-proxies-in-vrealize-operations-cloud.html
- [W24] Deploy VCF Installer (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/deploy-the-vmware-cloud-foundation-installer-appliance.html
- [W25] KB 455842 – optimalizace footprintu VCF management services po patchi na 9.1.1: https://knowledge.broadcom.com/external/article/455842
- [W26] VCF Automation Models (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/vmware-cloud-foundation-concepts/vcf-automation-deployment-models.html
- [W27] VCF API – VcenterSpec (developer.broadcom.com, verze API 5.2.5): https://developer.broadcom.com/xapis/vmware-cloud-foundation-api/latest/data-structures/VcenterSpec/
- [W28] **VCF 9.1.1 Planning and Preparation Workbook** (TechDocs asset; listy „Static Reference Tables“ [WB SRT]
  a „Management Domain Sizing“ [WB MDS]): https://techdocs.broadcom.com/content/dam/broadcom/techdocs/us/en/assets/vmware-cis/vcf/vcf-9.1.1-planning-and-preparation-workbook.xlsx
  – lokální výpisy `docs/spec/data/vcf-9.1.1-workbook-Static_Reference_Tables.tsv`,
  `docs/spec/data/vcf-9.1.1-workbook-Management_Domain_Sizing.tsv` (extrakce 2026-11-21).

Odkazy na jiné spec soubory: `00-architektura` [S1], [S2], [S6], [S9], [S10], [S12], [S29]–[S33]; `05-design` [D5], [D9];
`06-blueprints` [B3], [B4], [B6], [B7], [B16]–[B18]; `10-planning` 6.1; `20-deployment` 2.2, 2.5, 4.1.5, 4.2, 4.4, 6.4.
