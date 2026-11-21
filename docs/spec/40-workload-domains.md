# 40 – Workload domény a stopa nasazení (Building Cloud Infrastructure)

> Modelovaná verze: **VCF 9.1.1** (viz `docs/spec/VERSION.md`). Rozdíly jsou označené **[9.0]** / **[9.1]** / **[9.1.1+]**.
> Odkazy `[Wxx]` vedou na konkrétní stránky (seznam v sekci 9). Stav výzkumu: 2026-11-21.
> Zaměření: podklad pro herní režim **„Hotové scénáře“**. Ten ukazuje plně nasazená prostředí: všechny běžící VM,
> kde běží a kolik zdrojů spotřebují. Navazuje na `00-architektura` (komponenty, sizing profily), `06-blueprints`
> (topologie), `10-planning` (minimální počty hostů) a `20-deployment` (bring-up).
>
> Značení: *(odvozeno)* = součet nebo počet spočítaný z dokumentovaných čísel, v dokumentaci tak přímo není.
> *(parafráze)* = převyprávěný text, ne doslovná citace.

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
  spotřebu management domain. Doménový model to uvádí jako důsledek: „You may need to expand the resources in the
  management domain to accommodate future deployments of additional workload domains and management components.“
  (`05-design` 2.5 [D9]).
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
| NSX Manager | nový: 1 uzel (Simple) nebo 3 uzly (High-Availability) + VIP („Appliance Cluster FQDN“); **nebo** připojení k existujícímu NSX Manageru (0 nových VM) | **management domain – primární cluster** | [W1] |
| ESX hosty | ≥ minimum podle cluster modelu a storage (viz 6.2) | vlastní hosty WLD (commissioned, stav UNASSIGNED → přiřazené) | [W1][W8] |
| vSphere cluster | 1..n; první vzniká při vytvoření WLD (pokud nejde o „Domain infrastructure only“) | hosty WLD | [W1][W4] |
| vSphere Distributed Switch | ≥ 1 na cluster; **[9.1.1+]** další clustery mohou sdílet VDS prvního clusteru | hosty WLD | [W1][W2] |
| vSphere Supervisor (volitelný, **výchozí zapnutý**) | „a Supervisor, a single Supervisor control plane VM, and a single vSphere zone“ | control plane VM v clusteru WLD *(odvozeno: vSphere zone = cluster WLD; dokumentace umístění VM výslovně neuvádí)* | [W1] |
| NSX Edge cluster (volitelný) | ≥ 2 Edge uzly; nasazuje se **po** vytvoření WLD (Centralized Connectivity) | vSphere cluster / host group, který zvolí admin | [W1][W12] |
| Virtual Network Appliance (VNA) cluster (volitelný) | **[9.1]** lze nasadit při vytvoření WLD (Distributed Connectivity + Supervisor) nebo později; 1 IP/FQDN (2 pro cluster) | zvolený vSphere cluster | [W1][W13] |

Citace k Supervisoru a VNA [W1]: „In 9.1+, a VNA cluster can be deployed during creation for NAT and load balancing“
*(parafráze stránky)*. „If Supervisor uses Centralized Transit Gateway, deploy an NSX Edge cluster with a tier-0 gateway
to finish activation, unless you reuse an NSX Manager with a compatible Edge cluster. VNAs do not need an Edge cluster.“
*(parafráze)*.

### 2.2 Dedikovaný vs. sdílený NSX Manager

- Volba v kroku **Networking**: **Create New NSX Manager Instance** / **Join Existing NSX Manager Instance** [W1].
- **[9.1]** Lze se připojit i k NSX Manageru management domain [W1]. Taxonomie: „New workload domains can share the same
  NSX Manager cluster with an existing workload domain or with the management domain, or you can deploy a new NSX
  Manager cluster.“ (`00-architektura` [S1]).
- **[9.0]** „Workload domains cannot use the NSX Manager cluster for the management domain.“ (`00-architektura` [S10]).
  Stránka 9.0 [W9] umožňuje sdílet jen NSX Manager jiné workload domény.
- **[9.1.1+]** Při sdílení se sdílí i Full Stack VPC napříč přidruženými doménami *(parafráze)* [W1].
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

Podle FQDN tabulky další instance [W5], sizing tabulky [W6] a modelů VCF management services [W17]:

| Komponenta | Další instance (Simple) | Další instance (HA) | Zdroj |
|---|---|---|---|
| vCenter (management domain) | 1 | 1 | [W5][W6] |
| ESX hosty | 1 FQDN / host | 1 FQDN / host | [W5] |
| NSX Manager | 1 uzel + VIP | 3 uzly + VIP | [W5][W6] |
| SDDC Manager | 1 | 1 | [W5][W6] |
| VCF Operations Cloud Proxy | 1 | 1 | [W5][W6] |
| VCF management services – „Instance components“, „VCF services runtime“ | 1 CP + 2 worker | 3 CP + 2 worker | [W5][W6] |
| Identity broker | Day-N (volitelně) | Day-N (volitelně) | [W5][W17] |
| Real-time metrics, Software depot | Day-N (volitelně) | Day-N (volitelně) | [W5][W17] |
| **VCF Operations, VCF Automation, License server** | **ne** | **ne** | [W5][W6]; `00-architektura` [S1] |

- Model VCF management services pro další instanci: „Smaller VCF management services instance for running VCF Instance
  level components only.“ [W17]
- **[9.1.1+]** „VCF Operations resides in the management domain of the first VCF Instance“ [W11].
- Nasazení: VCF Installer → „Deploy a new VCF Instance“, připojení k existující VCF Operations (`20-deployment` 2.5).
- Každá instance má vlastní WLD (max. 40 na instanci, viz 6.1). WLD další instance mají vCenter/NSX v management
  domain **své** instance *(odvozeno z [W1]: „management domain primary cluster“ – v rámci instance, kde se WLD
  vytváří)*.

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
- Licence: stránka [W1] žádnou licenční prerekvizitu neuvádí (viz 3.4).

### 3.2 Domain infrastructure only [W4]
- FQDN a IP vCenteru a NSX Manageru resolvovatelné v DNS. „No unassigned ESX hosts are required for creating this workload
  domain.“ [W1]

### 3.3 Commission hostů (před vytvořením WLD) [W8][W14]
- Nejdřív musí existovat **network pool**, který podporuje storage typ hostu [W8][W14].
- Host: vSAN „vSAN-compliant and certified on the VMware Hardware Compatibility Guide“; správný počet fyzických NIC;
  management IP na VMkernel portu ve Management Network na standard switchi; gateway v management subnetu; forward
  i reverse DNS; hostname = FQDN; self-signed certifikát regenerovaný podle FQDN; podporovaná verze ESX; HW health OK;
  drivery a firmware podle HCL; smazané všechny diskové oddíly *(parafráze)* [W8].
- Výsledek: „Each host is added to the free pool and is available for VCF domains and vSphere clusters.“ Hosty se
  zobrazí v tabulce Unassigned Hosts; vSAN hosty jdou jen do vSAN clusterů, NFS hosty jen do NFS clusterů *(parafráze)*
  [W8].

### 3.4 Licence (9.1) [W15]
- Licence se přiřazuje **vCenter instanci** ve VCF Operations. „Your other assets that are connected to that vCenter
  instance, including ESX hosts, are then licensed automatically.“
- Prerekvizity: oprávnění Licensing > Manage; VCF Operations registrované ve VCF Business Services console; aspoň jedna
  primární licence přidaná do VCF Operations a license serveru; VCF Instance integrovaná s VCF Operations; licence musí
  mít kapacitu pro všechny ESX hosty vCenteru *(parafráze)*.
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
6. **General information**: **Workload Domain Name** (3–20 znaků); **Full deployment with cluster** nebo **Domain
   infrastructure only**; volitelně **vSphere Supervisor** (výchozí zapnuto); volitelně **Dual-Stack (IPv4 and IPv6)
   Networking**; **SSO Domain Name** (izoluje doménu). Hesla appliance se generují automaticky (lze je získat přes
   SDDC Manager API).
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
    - **VPC Gateway Connectivity** (jen Full Stack VPC): **Centralized Connectivity** (Edge cluster, konfigurace po
      vytvoření) / **Distributed Connectivity** (VNA; **VLAN ID** a **Gateway CIDR IPv4 Address** shodná s gateway na
      ToR; při Supervisoru FQDN VNA). VPC nepodporuje IPv6.
11. **Storage**: **vSAN** (ESA přepínačem, jinak OSA; typ clusteru vSAN HCI / vSAN Compute Cluster (OSA) / vSAN Storage
    (ESA); data-in-transit encryption, rekey (výchozí 1440 min); OSA: Failures to Tolerate, dedup+komprese),
    **NFS**, **VMFS on FC**, **vVol**.
12. **Hosts**: vybrat commissioned hosty se stejným storage typem („Your selection determines the minimum number of
    required ESX hosts.“).
13. **vSphere Distributed Switch**: profil **Default** (1 VDS, doporučeno), **Storage Traffic Separation** (2),
    **NSX Traffic Separation** (2), **Storage Traffic and NSX Traffic Separation** (3), nebo Custom → **Create
    Distributed Switch**.
14. **vSphere Supervisor** (jen pokud je zapnutý): Supervisor Name, Service CIDR, Control Plane IP Range (min. 5 adres),
    NSX Project, VPC Connectivity Profile, Private (Transit Gateway) CIDR, Private CIDR, Workload DNS, Workload NTP.
15. Review → **Finish**. „After successful validation, workload domain creation starts.“
16. Průběh: **Fleet Management** > **Tasks**.

**[9.0] rozdíly** [W9]: cesta **Inventory > Detailed View** → VCF Instances → **Add Workload Domain** → **Create New**.
NSX deployment size se jmenuje **Standard** (místo Simple). Supervisor vyžaduje Centralized Connectivity a NSX Edge
cluster s tier-0 active-standby (VNA alternativa není uvedena). Vyžaduje se NIC ≥ 10 Gbps. Stránka neuvádí, kde běží
NSX Manager. U vCenteru uvádí: „The vCenter for a workload domain deployed in the management domain.“

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

### 6.2 Minimální počty hostů WLD
Převzato z `10-planning` 6.1: single-rack vSAN Simple 3 / HA 4; NFS/FC Simple 2 / HA 4; multi-rack L2/L3 vSAN 3, FC/NFS 2;
stretched vSAN WLD min. 6 (3 na site). Průvodce WLD sám minimum neuvádí („Your selection determines the minimum number
of required ESX hosts.“) [W1].

### 6.3 Velikosti jednotlivých appliance (dokumentované)

**vCenter appliance (vSphere 9.1)** [W18][W19]

| Velikost | Hosty / VM (do) | vCPU | RAM | Storage default | Large storage | X-Large storage |
|---|---|---|---|---|---|---|
| Tiny | 10 / 100 | 2 | 14 GB | 619 GB | 2059 GB | 4319 GB |
| Small | 100 / 1 000 | 4 | 21 GB | 734 GB | 2084 GB | 4344 GB |
| Medium | 400 / 4 000 | 8 | 30 GB | 933 GB | 2233 GB | 4493 GB |
| Large | 1 000 / 10 000 | 16 | 39 GB | 1383 GB | 2283 GB | 4543 GB |
| X-Large | 2 000 / 35 000 | 24 | 58 GB | 2308 GB | 2408 GB | 4668 GB |

**[9.0]** X-Large: 2 500 hostů / 45 000 VM (u 9.1 to platí jen s X-Large storage) [W18][W19].

**NSX Manager uzel** – volby „Node Size“ ze stránky **VCF 9.0** (stránku pro 9.1 se nepodařilo najít) [W20]:

| Velikost | vCPU | RAM | Storage |
|---|---|---|---|
| Small | 4 | 16 GB | 300 GB |
| Medium | 6 | 24 GB | 300 GB |
| Large | 12 | 48 GB | 300 GB |
| Extra Large | 24 | 96 GB | 400 GB |

Pro 9.1 potvrzuje Medium = 6 vCPU / 24 GB / 300 GB stránka požadavků Supervisoru [W21]. Průvodce WLD nabízí jen
Medium / Large / Extra Large [W1].

**VCF Operations uzel** – KB „VCF Operations 9.0 Sizing Guidelines“ (platí pro **9.0**; pro 9.1 nenalezeno) [W22]:

| Velikost | vCPU | RAM (default) | RAM (max) | Disk |
|---|---|---|---|---|
| Extra Small | 2 | 8 GB | 16 GB | neuvedeno („See the Sizing Guide Worksheet“) |
| Small | 4 | 16 GB | 32 GB | neuvedeno |
| Medium | 8 | 32 GB | 64 GB | neuvedeno |
| Large | 16 | 48 GB | 96 GB | neuvedeno |
| Extra Large | 24 | 128 GB | 256 GB | neuvedeno |

**Cloud proxy**:
- **9.1**: Unified Small 4 vCPU / 16 GB (do 16 000 VM), Unified Standard 8 vCPU / 48 GB (16 000–80 000 VM). Disk neuveden.
  „Do not deploy the OVA using the Classic Cloud Proxy configuration unless explicitly instructed by technical support.“
  [W23]
- **9.0** (KB): Classic Small 2/8 GB, Classic Standard 4/32 GB, Unified Small 4/16 GB, Unified Standard 8/48 GB [W22].
- Nepodařilo se ověřit, zda VCF Installer nasazuje cloud proxy ve variantě Unified, nebo Classic (otevřená otázka 4).

**VCF Installer / SDDC Manager appliance**: 4 vCPU, 16 GB RAM, 914 GB storage [W24]. SDDC Manager je tatáž appliance
přepnutá do SDDC Manager mode (`20-deployment` 1, 2.6 v `00`) → stejná čísla *(odvozeno)*.

**Worker uzly VCF management services** [W6]: Simple – Medium 12 vCPU / 24 GB; Small HA – Small 10/16 GB; Medium HA –
Medium 12/24 GB; Large HA – Large 16/32 GB. Log management (Day-2) zvětší workery: Small → Large 16/32 GB,
Medium a Large → xLarge 24/48 GB. **Control plane uzly: velikost neuvedena** [W6].

**NSX Edge VM (9.1)** [W12]: Small 2 vCPU / 4 GB / 200 GB (jen lab/PoC); Medium 4/8 GB/200 GB; Large 8/32 GB/200 GB;
XLarge 16/64 GB/200 GB.

**Supervisor control plane VM (VPC networking, 9.1, minimum)** [W21]: 4 vCPU / 16 GB / 48 GB. Počet: 1 pro single
Management Zone (doporučeny 3), nebo 3 pro tři Management Zones.

**Nedokumentováno** (otevřené otázky): velikost control plane uzlu VCF management services, License server („Default“),
VCF Automation uzly (Small/Medium/Large), disk VCF Operations uzlů, Virtual Network Appliance (form factor; výchozí
„medium“ [W13], čísla nenalezena), velikost vCenteru pro WLD.

### 6.4 Sizing profily (celkové součty z dokumentace) [W6]

| Profil | První instance (vCPU / RAM / Disk) | Další instance (vCPU / RAM / Disk) |
|---|---|---|
| Simple | 76 / 251 GB / 7448 GB | 34 / 111 GB / 4562 GB |
| HA – Small | 106 / 335 GB / 8422 GB | 62 / 187 GB / 5462 GB |
| HA – Medium | 184 / 656 GB / 11445 GB | 74 / 244 GB / 5813 GB |
| HA – Large | 298 / 949 GB / 15357 GB | 120 / 353 GB / 8321 GB |

- **[9.1]** Simple jen Small; HA Medium (výchozí) nebo Large. **[9.1.1+]** Small výchozí pro Simple i HA [W11]
  (`20-deployment` 4.2 krok 5).
- **[9.1.1+]** „VCF management services now require less compute and memory resources for all deployment sizes.“
  Podrobnosti jsou ve VCF 9.1.1 Planning and Preparation Workbooku [W11]. Brownfield nasazení patchované na 9.1.1
  zmenší footprint podle KB 455842; greenfield 9.1.1+ dostane optimalizované velikosti automaticky [W25].
  Sizing stránka [W6] neříká, ke které verzi (9.1.0 / 9.1.1) se čísla vztahují (otevřená otázka 2).

### 6.5 „Co běží a kolik to žere“ – hotové scénáře

Pravidla pro tabulky:
- Počty a velikosti VM jsou ze sizing profilů [W6]. U položek s dokumentovanou velikostí jsou uvedena čísla z 6.3.
- Řádek **„Celkem (dokumentováno)“** je celkový součet ze sizing stránky [W6]. Ten je směrodatný.
- Součty z per-VM čísel **nejsou úplné**, protože chybí velikosti CP uzlů, License serveru a VCF Automation.
  Proto se neuvádějí jako náhrada celkového součtu.
- **VCF Installer**: když se nasadí na host budoucí management domain, stane se SDDC Managerem a žádná VM navíc nevzniká.
  Když se nasadí mimo (installer mode), běží **mimo fleet** jako další VM 4/16/914 [W24]
  (`20-deployment` 4.1.5). V součtech není.
- Day-N komponenty (Log management, VCF Operations for networks, Real-time metrics, Orchestrator, HCX) nejsou součástí
  výchozího nasazení (`20-deployment` 2.2). Proto v tabulkách nejsou, pokud není uvedeno jinak.

#### Scénář 1 – Nejmenší, vše Simple (blueprint „Minimal Footprint“)

Topologie: 1 instance, jen management domain, 1 cluster pro management i workloady, **3 hosty** (vSAN), VCF Installer
„Simple“ / „Small“ (`06-blueprints` 2.1 [B3][B4]).

| # | VM | Počet | Velikost | vCPU / RAM / Disk na VM | Kde běží |
|---|---|---|---|---|---|
| 1 | vCenter (management) | 1 | Small | 4 / 21 GB / 734 GB [W18][W19] | mgmt domain, default cluster |
| 2 | NSX Manager | 1 (+VIP) | Medium | 6 / 24 GB / 300 GB [W20][W21] | mgmt domain |
| 3 | SDDC Manager | 1 | Default | 4 / 16 GB / 914 GB *(odvozeno z [W24])* | mgmt domain |
| 4 | VCF Operations (primary) | 1 | Small | 4 / 16 GB / disk neuveden ([W22], 9.0 KB) | mgmt domain |
| 5 | Cloud proxy | 1 | Small | 4 / 16 GB, pokud jde o Unified [W23] | mgmt domain (VM management network) |
| 6 | License server | 1 | Default | neuvedeno | mgmt domain |
| 7 | VCF Automation | 1 | Small | neuvedeno | mgmt domain |
| 8 | VCF management services – control plane | 1 | – | neuvedeno | mgmt domain |
| 9 | VCF management services – worker | 2 ¹ | Medium | 12 / 24 GB / disk neuveden [W6] | mgmt domain |
| | **Celkem VM** | **10** *(odvozeno)* | | | |
| | **Celkem (dokumentováno)** | | | **76 vCPU / 251 GB / 7448 GB** [W6] | |

¹ Sizing [W6] uvádí 2 workery. Model VCF management services [W17] uvádí „Three worker nodes.“ (otevřená otázka 1).
Blueprint navíc obsahuje Day-N volby „Simple VCF Operations for Networks“ a „Simple Log Management“ a „Simple vSphere
Supervisor Control Plane“ (`06-blueprints` 2.1). Ty nejsou v součtu.

#### Scénář 2 – HA instalace (management domain HA)

Topologie: 1 instance, management domain HA, **4 hosty** vSAN (`10-planning` 6.1). Tři varianty velikosti [W6]:

| VM | HA – Small | HA – Medium | HA – Large | Per-VM (dokumentováno) |
|---|---|---|---|---|
| vCenter | 1× Small | 1× Medium | 1× Large | S 4/21/734 · M 8/30/933 · L 16/39/1383 [W18][W19] |
| NSX Manager | 3× Medium | 3× Medium | 3× Large | M 6/24/300 · L 12/48/300 [W20] |
| SDDC Manager | 1× | 1× | 1× | 4/16/914 *(odvozeno z [W24])* |
| VCF Operations | 2× Small (primary + replica) | 3× Medium (primary, replica, data) | 3× Large | S 4/16 · M 8/32 · L 16/48 ([W22], 9.0) |
| Cloud proxy | 1× Small | 1× Standard | 1× Standard | Unified S 4/16 · Std 8/48 [W23] |
| License server | 1× | 1× | 1× | neuvedeno |
| VCF Automation | 1× Medium ² | 3× Medium | 3× Large | neuvedeno |
| MS control plane | 3× | 3× | 3× | neuvedeno |
| MS worker | 3× Small (10/16) | 3× Medium (12/24) | 4× Large (16/32) | [W6] |
| **Celkem VM** *(odvozeno)* | **16** | **19** | **20** | |
| **Celkem (dokumentováno)** [W6] | **106 / 335 GB / 8422 GB** | **184 / 656 GB / 11445 GB** | **298 / 949 GB / 15357 GB** | |

Vše běží v management domain (default cluster) [W3] (`00-architektura` 2.1).
² Rozpor: Medium podle [W26] znamená automaticky 3 uzly (otevřená otázka 3). Počet VM 16 počítá s 1 uzlem.
Po nasazení: DRS anti-affinity pravidlo pro HA VCF Operations (`20-deployment` 4.4). Data node jen u HA Medium/Large
(`20-deployment` 6.4).

#### Scénář 3 – Management domain + 1 workload doména (blueprint „VCF Fleet in a Single Site“)

Blueprint: management domain HA, VCF Installer „High Availability“ / „Medium“, workloady v samostatné WLD
(`06-blueprints` 2.2 [B6][B7]). WLD: Host Fault Tolerant NSX Edge Cluster, HA vSphere Supervisor Control Plane,
Virtual Network Appliance LB (`06-blueprints` 2.2).

**A) Management domain** = Scénář 2, HA – Medium (19 VM, 184 / 656 GB / 11445 GB) [W6].

**B) Přírůstek v management domain za WLD** [W1]:

| VM | Počet | Velikost | vCPU / RAM / Disk na VM | Kde běží |
|---|---|---|---|---|
| vCenter WLD | 1 | **velikost v průvodci neuvedena** (otevřená otázka 5) | podle tabulky vCenter (6.3) | mgmt domain primary cluster |
| NSX Manager WLD – varianta „dedikovaný HA“ | 3 (+VIP) | Medium / Large / Extra Large | M 6/24/300 · L 12/48/300 · XL 24/96/400 [W20] | mgmt domain primary cluster |
| NSX Manager WLD – varianta „dedikovaný Simple“ | 1 (+VIP) | Medium / Large / Extra Large | dtto | mgmt domain primary cluster |
| NSX Manager WLD – varianta „sdílený“ **[9.1]** | 0 | – | – | – |

**C) V clusteru WLD** (hosty WLD):

| VM | Počet | Velikost | vCPU / RAM / Disk na VM | Poznámka |
|---|---|---|---|---|
| Supervisor control plane VM | 1 (výchozí, „a single Supervisor control plane VM“ [W1]); 3 doporučeno [W21] | min. pro VPC | 4 / 16 GB / 48 GB [W21] | jen při zapnutém Supervisoru (výchozí) |
| NSX Edge uzly | ≥ 2 | Medium / Large / XLarge (Small jen PoC) | M 4/8/200 · L 8/32/200 · XL 16/64/200 [W12] | jen u Centralized Connectivity; nasazuje se po vytvoření WLD; cluster si volí admin |
| Virtual Network Appliance | 1 (2 pro cluster) [W1] | výchozí form factor medium [W13] | neuvedeno | jen u Distributed Connectivity |
| Business workloady | – | – | – | hlavní účel WLD |

Hosty WLD: vSAN HA min. 4 / Simple min. 3 (`10-planning` 6.1). Blueprint uvádí v DNS „ESX: 4 nodes“ a nerozlišuje
mgmt a WLD (`06-blueprints` 2.2, otevřená otázka 7).

**Příklad součtu přírůstku v management domain** *(odvozeno; velikost vCenteru WLD **není v dokumentaci určena**,
pro ilustraci je zvolena Medium)*: vCenter Medium 8/30/933 + 3× NSX Medium 3×(6/24/300) = **26 vCPU / 102 GB /
1833 GB**. Management domain celkem pak 184+26 = **210 vCPU / 758 GB / 13 278 GB** *(odvozeno)*. Se sdíleným NSX
**[9.1]** jen vCenter: 8/30/933 → **192 / 686 GB / 12 378 GB** *(odvozeno, stejný předpoklad)*.

#### Scénář 4 – Více workload domén v jedné instanci

Každá další WLD přidá do **management domain** [W1]:
- **vždy** 1× vCenter (velikost: otevřená otázka 5),
- **podle volby** 0 / 1 / 3 uzly NSX Manageru (sdílený / dedikovaný Simple / dedikovaný HA).

V clusteru každé WLD případně Supervisor CP VM, Edge uzly nebo VNA (jako ve Scénáři 3 C).

| Položka | Hodnota |
|---|---|
| Max. WLD | 40 na instanci **[9.1]** / 24 **[9.0]** (6.1) |
| Počet vCenterů v mgmt domain | 1 (mgmt) + N (WLD) *(odvozeno z [W1])* |
| Počet NSX Manager uzlů v mgmt domain | mgmt NSX (1 nebo 3) + součet za WLD s dedikovaným NSX *(odvozeno)* |

**Příklad** *(odvozeno, předpoklad vCenter WLD Medium jako ve Scénáři 3)*: mgmt HA – Medium + 2 WLD.
- **2a)** Každá WLD má dedikovaný HA NSX Medium: 184 + 2×26 = **236 vCPU / 860 GB / 15 111 GB**, VM v mgmt domain:
  19 + 2×4 = **27**.
- **2b)** Obě WLD sdílí jeden nový HA NSX Medium (první WLD ho vytvoří, druhá se připojí): 184 + 2×8 + 18 =
  **218 vCPU / 788 GB / 14 211 GB**, VM: 19 + 2 + 3 = **24**.
- **2c)** **[9.1]** Obě WLD sdílí NSX management domain: 184 + 2×8 = **200 vCPU / 716 GB / 13 311 GB**, VM: 19 + 2 =
  **21**.

Kapacitu management domain je nutné dimenzovat předem: „You must carefully size the management domain to accommodate
planned deployments of additional workload domains and management components.“ (`05-design` 3 [D5]).

#### Scénář 5 – Více VCF instancí (blueprint „Multiple Sites Across Multiple Regions“)

Topologie: Region 1 = první instance (HA – Medium), Region 2 = další instance (HA – Medium), každá 4 hosty, 1 fleet
(`06-blueprints` 2.4 [B16][B17]).

| VM | Instance 1 (Region 1) | Instance 2 (Region 2) | Zdroj |
|---|---|---|---|
| vCenter (mgmt) | 1× Medium | 1× Medium | [W6] |
| NSX Manager | 3× Medium | 3× Medium | [W6] |
| SDDC Manager | 1× | 1× | [W6] |
| VCF Operations | 3× Medium | – | [W6] |
| Cloud proxy | 1× Standard | 1× Standard | [W6] |
| License server | 1× | – | [W6] |
| VCF Automation | 3× Medium | – | [W6] |
| MS control plane | 3× | 3× | [W6] |
| MS worker | 3× Medium | 2× Medium | [W6] |
| **VM v mgmt domain** *(odvozeno)* | **19** | **11** | |
| **Celkem (dokumentováno)** | **184 / 656 GB / 11445 GB** | **74 / 244 GB / 5813 GB** | [W6] |
| **Fleet celkem** *(odvozeno)* | **258 vCPU / 900 GB / 17 258 GB**, 30 VM | | |

Varianty instance 2 [W6]: Simple 1 CP + 2 W → 34 / 111 GB / 4562 GB (7 VM *(odvozeno)*); HA – Small 3 CP + 2 W →
62 / 187 GB / 5462 GB; HA – Large → 120 / 353 GB / 8321 GB.
Volitelně Day-N v instanci 2: Identity broker, Software depot, Real-time metrics (přidávají workery) [W5][W17].
Workload domény se přidávají per instance; WLD v Region 2 mají vCenter/NSX v management domain instance 2 (viz 2.4).

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

1. **Počet worker uzlů v Simple** – sizing [W6]: 2, model [W17]: „Three worker nodes.“ (stejně jako `00` OQ 1).
2. **K jaké verzi patří sizing tabulka [W6]** (9.1.0 nebo 9.1.1)? Release notes 9.1.1 uvádí menší nároky VCF management
   services [W11], čísla jsou jen ve Workbooku 9.1.1 (Excel, nestaženo).
3. **VCF Automation v HA – Small**: „1x Medium“ [W6] vs. „Medium … automatically scales the deployment out to 3 nodes“
   [W26]. Pro Simple uvádí sizing [W6] „1x Small“. Stránka Minimum Requirements blueprintu Minimal Footprint [B4]
   velikosti komponent v načteném textu neobsahuje, takže to nejde křížově ověřit.
4. **Varianta cloud proxy, kterou nasazuje VCF Installer** (Unified vs. Classic). Sizing [W6] používá „Small/Standard“
   bez rozlišení; per-VM čísla se liší (Classic Small 2/8 vs. Unified Small 4/16).
5. **Velikost vCenteru WLD** – průvodce 9.1 [W1] volbu neuvádí. SDDC Manager API `VcenterSpec.vmSize` (tiny…xlarge)
   a `storageSize` (lstorage/xlstorage) jsou dokumentované jen ve verzi API **5.2.5** [W27]. Pro 9.1 nebylo ověřeno,
   jaká velikost se použije ani zda ji lze změnit. Bez toho nejde přesně spočítat přírůstek za WLD.
6. **Chybějící per-VM velikosti**: control plane uzel VCF management services, License server („Default“),
   VCF Automation (Small/Medium/Large), disk VCF Operations, VNA form factory, NSX Manager pro **9.1** (máme jen 9.0
   stránku [W20]). **Součty per-VM nesedí na celkové součty [W6]**: např. další instance Simple = 34 vCPU, ale už
   workery (2×12) + vCenter Small (4) + NSX Medium (6) + SDDC Manager (4) = 38 vCPU *(odvozeno)*. Je potřeba
   Workbook 9.1.1 (tab „Management Domain Sizing“) nebo jiný zdroj.
7. **Hosty v blueprintu Single Site** – „ESX: 4 nodes“ nerozlišuje mgmt a WLD. Pro WLD platí minima z `10-planning`.
8. **Umístění Supervisor control plane VM** – dokumentace říká „single vSphere zone“ na clusteru WLD. Že VM běží
   v clusteru WLD, je odvozeno (hra to tak modeluje).
9. **Velikost a počet Edge uzlů pro „Host Fault Tolerant NSX Edge Cluster“** (blueprint Single Site) – design stránka
   nebyla zpracována (`05-design` OQ 8).
10. **Licence WLD**: průvodce [W1] licenční prerekvizitu neuvádí. Co se stane s WLD před přiřazením licence (evaluation
    mód celé WLD?), není v načtených stránkách popsáno. Popsán je jen evaluation mode hostu při nedostatku kapacity [W15].
11. **Day-N komponenty ve „hotových“ scénářích** (Log management, Ops for networks, Real-time metrics) – blueprinty
    je vybírají, ale jejich velikosti nejsou zpracované (Log management jen zvětšuje workery [W6]). Má je hra
    ve scénářích zobrazovat?
12. **Přesné texty validačních chyb** průvodce WLD – stránka [W1] je neuvádí.
13. **Max. počet WLD sdílejících jeden NSX Manager** a max. počet VCF Instancí ve fleet – nenalezeno (configmax).

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

Odkazy na jiné spec soubory: `00-architektura` [S1], [S2], [S6], [S9], [S10], [S12], [S29]–[S33]; `05-design` [D5], [D9];
`06-blueprints` [B3], [B4], [B6], [B7], [B16]–[B18]; `10-planning` 6.1; `20-deployment` 2.2, 2.5, 4.1.5, 4.2, 4.4, 6.4.
