# 05 – Design (Architectural Options, Design Library, Design Blueprints)

> Modelovaná verze: **VCF 9.1.1** (viz `docs/spec/VERSION.md`). Rozdíly oproti 9.0 jsou označené **[9.0]** / **[9.1]**.
> Zdroje [D1]…[D44] jsou v sekci 9. Všechny vedou na techdocs.broadcom.com nebo knowledge.broadcom.com.
> Účel: faktický podklad pro **designovou fázi Sandboxu**. Hráč v ní volí modely před plánováním (`10-planning`)
> a nasazením (`20-deployment`).
> Tabulky, které už jsou jinde, se tu neopakují. Na ně odkazujeme:
> - topologie fleet a cluster modely: `00-architektura` 6,
> - sizing profily: `00-architektura` 6 a `20-deployment` 6.2,
> - minima hostů a HA rezervy: `10-planning` 6.1 a 6.3,
> - kroky průvodce VCF Installeru: `20-deployment` 4.2.
>
> Citace z dokumentace jsou anglicky v uvozovkách. Tam, kde nástroj na čtení stránek vrátil jen parafrázi, je text
> označený *(parafráze)*.

---

## 1. Shrnutí

Sekce **Design** v TechDocs VCF 9.1 má tři části [D1]:
- **Architectural Options in VMware Cloud Foundation** – přehled modelů každé komponenty a jejich benefity a
  implikace. Doslova: „This section contains an overview of each component of a VCF private cloud with high-level
  comparisons of the benefits and implications of the options available within each component." [D2]
- **Design Library for VMware Cloud Foundation** – detailní design. Obsahuje requirements (`…-REQD-…`) a
  recommendations (`…-RCMD-…` / `…-RECD-…`) pro každý model [D2][D3].
- **Design Blueprints** – hotové kombinace modelů. Příklady: „VCF Fleet in a Single Site with Minimal Footprint“,
  „VCF Fleet in a Single Site“, multi-site varianty [D34].

**Hlavní otázka: je management domain vyhrazená jen pro management, nebo v ní smějí běžet uživatelské workloady?**

Odpověď podle dokumentace 9.1: **workloady v management domain být mohou, ale doporučuje se pro ně workload domain.**
Termín „consolidated architecture“ z VCF 4.x/5.x se ve stránkách 9.x, které jsme prošli, **nevyskytuje**.

1. Atribut Management Domain Model (9.1), řádek „Resource Allocation“: „VCF fleet management components. VCF Instance
   management components. NSX Edge nodes. **Can also run business workloads.**“ [D5]
2. VCF Domain Models (9.1): management domain „Can also run business workloads.“ [D9]. Stejně v 9.0 [D10].
3. Požadavek **VCF-WLD-REQD-CFG-001**: „Deploy a management domain to host all management components for the VCF
   Instance.“ Mezi zdůvodněními je „Enables the use of dedicated physical compute, network, and storage separately
   from those used for additional workloads.“ [D5]
4. Doporučení **VCF-WLD-RCMD-CFG-002** (Workload Domain Model): „**Use workload domains for customer workloads.**“
   Zdůvodnění: „Aligns with the VMware best practice of separating management workloads from customer workloads.“ a
   „Provides better long-term flexibility and expansion options.“ Implikace: „Requires additional hardware.“ [D6].
   Stejné doporučení je v 9.0 [D8].
5. Blueprint **„VCF Fleet in a Single Site with Minimal Footprint“** (9.1) výslovně počítá se sdíleným clusterem:
   „All management and workload components are deployed in a single vSphere cluster.“ [D35][D37]. Ostatní
   infrastrukturní blueprinty workloady izolují: „workloads are isolated to a separate workload domain.“ [D38][D34]
6. **[9.0]** obsahuje navíc doporučení **VCF-WLD-RCMD-CFG-001**: „If running business workloads in the management
   domain, configure the following vSphere resource pools … to control resource usage by management and business
   workloads.“ Pooly: `cluster-name-rp-sddc-mgmt`, `cluster-name-rp-sddc-edge`, `cluster-name-rp-user-edge`,
   `cluster-name-rp-user-vm`. Implikace: „You must manually create the vSphere resource pools and manage their settings
   over time.“ [D7]. **[9.1]** Stránka Management Domain Model 9.1 toto doporučení **neobsahuje**. Jsou na ní jen
   VCF-WLD-REQD-CFG-001 a VCF-MGMT-RCMD-NSX-001 a resource pooly nezmiňuje [D5].

---

## 2. Komponenty a vztahy

### 2.1 Struktura Architectural Options (9.1) [D2]
Modely jsou seskupené podle funkčních oblastí (sloupce „Functional Area | Models“): Fleet, Consumption, Operations,
Security Governance and Compliance, Virtual Infrastructure, Physical Infrastructure. Stránky v pořadí z navigace:

| # | Model (stránka) | Oblast specu |
|---|---|---|
| 1 | VCF Fleet Deployment Models | zde 4.1 + `00` 6 |
| 2 | VCF Fleet Sizing Models | zde 4.3 + `00` 6 |
| 3 | VCF Automation Models | zde 4.8 |
| 4 | vSphere Supervisor Models | nezpracováno (Otevřené otázky) |
| 5 | Network Consumption Models | zde 4.6 |
| 6 | Workload Connectivity Models | nezpracováno (`51-nsx`) |
| 7 | Load Balancer Models | nezpracováno |
| 8 | VCF Management Services Models | zde 4.3 |
| 9 | VCF Management Network Models | zde 4.6 |
| 10 | VCF Operations Models | zde 4.7 |
| 11 | VCF Recovery Options | nezpracováno |
| 12 | Identity Broker Models | zde 4.9 |
| 13 | VCF Domain Models | zde 4.2 |
| 14 | vSphere Cluster Models | zde 4.4 + `00` 6 + `10` 6.1 |
| 15 | Distributed Switch Models | zde 4.6 |
| 16 | Storage Models | zde 4.5 |
| 17 | NSX Manager and Control Plane Models | zde 4.2 / 4.3 |
| 18–24 | NSX Edge Cluster, Virtual Network Appliance Cluster, Network Fabric, VCF Edge, Private AI (2×), Lateral Security with vDefend | nezpracováno |

Dokumentace **nepředepisuje pořadí**, v jakém se modely volí. Pořadí v navigaci je jen pořadí čtení [D2].

### 2.2 Design Library – VCF Domain Detailed Design [D4]
„A VCF fleet can include one or more VCF domains implemented according to a supported VCF Domain Model. Each VCF
Domain Model has options, requirements, and recommendations.“ *(parafráze úvodu)* Podstránky jsou dvě:
**Management Domain Model** [D5] a **Workload Domain Model** [D6].

### 2.3 Management Domain Model (9.1) [D5]
- Úvod: „The management domain in a VCF fleet hosts the management components of the VCF Instance where it is deployed
  and the management components of the fleet.“
- Resource Allocation: „VCF fleet management components. VCF Instance management components. NSX Edge nodes. Can also
  run business workloads.“
- Management domain první VCF Instance obsahuje: VCF management services („fleet and instance level components“),
  VCF Operations, Cloud Proxy, VCF Operations for Networks, VCF Automation, ESX hosts, vCenter, NSX Manager a
  SDDC Manager.
- Management domain další VCF Instance obsahuje: VCF management services („instance level components“), Cloud Proxy,
  ESX hosts, vCenter, NSX Manager a SDDC Manager.
- Options (povolené modely):
  - První cluster: „Single-Rack vSphere Cluster Model“, „Multi-Rack Layer 2 vSphere Cluster Model“, „Stretched
    vSphere Cluster Model“ **(Day 2)**.
  - Další clustery: „All cluster models.“
  - VCF management services: Simple / High Availability, a dále modely „VCF Management Services in the First VCF
    Instance“ / „… in an Additional VCF Instance“.
  - VCF Operations: Simple / High Availability.
  - VCF Operations for Networks: Simple / High Availability.
  - VCF Automation: Simple / High Availability.
  - NSX Manager: Simple / High Availability.
- **[9.0]** [D7]: první instance obsahuje fleet komponenty „VCF Operations“ a „VCF Automation“. Další instance mají
  „VCF Operations collector(s)“. Instance komponenty jsou „ESX hosts“, „vCenter“, „NSX Manager (dedicated)“ a
  „SDDC Manager“. Options: první cluster Single-Rack / Layer 2 Multi-Rack / Stretched (Day 2). VCF Operations,
  VCF Automation a NSX Manager mají Simple a HA. Stránka 9.0 **nemá** doporučení VCF-MGMT-RCMD-NSX-001.

### 2.4 Workload Domain Model (9.1) [D6]
- „As you expand your VCF fleet, you add workload domains to a VCF Instance.“ „Each workload domain is assigned a vCenter
  and NSX Manager.“
- Atributy: Resource Allocation „NSX Edge nodes.“ a „Business workloads.“. vCenter Single Sign-On Domain „Dedicated.“
- Options:
  - Cluster modely: Single-Rack, Multi-Rack Layer 2, Multi-Rack Layer 3, Stretched.
  - NSX Manager: Simple / High Availability.
  - **NSX Consumption Models**: dedicated NSX instance, nebo „Shared NSX instance with another workload domain
    including the management domain.“
  - Workload Network Type: IPv4 / IPv6.
- **[9.0]** [D8]: stejné atributy a stejné doporučení VCF-WLD-RCMD-CFG-002. Stretched cluster je u WLD označen
  „Day 2“. NSX consumption „Dedicated“ / „Shared“, bez zmínky o management domain. Taxonomie 9.0 výslovně uvádí:
  „Workload domains cannot use the NSX Manager cluster for the management domain.“ [D42]

### 2.5 VCF Domain Models – srovnání (Architectural Options, 9.1) [D9]
- Management domain: „First workload domain deployed in a VCF Instance.“ Obsahuje vCenter, NSX Manager a SDDC Manager
  pro všechny workload domain *(parafráze)*. „Can also run business workloads.“ Může obsahovat NSX Edge nodes.
  Benefity *(parafráze)*: dedikovaný HW pro management, oddělené compute/síť/storage, oddělený lifecycle; může sdílet
  NSX instanci s workload domains. Implikace: „You may need to expand the resources in the management domain to
  accommodate future deployments of additional workload domains and management components.“
- Workload domain: „Represents an additional dedicated set of resources for running customer workloads using dedicated
  ESX hosts.“ „Has a dedicated vCenter and vCenter Single Sign-On domain.“ „Provides support for configurations with a
  dedicated identity provider.“ Může sdílet NSX instanci a při sdílení i NSX Edge clustery *(parafráze)*. „Scales up to
  40 workload domains per VCF Instance.“ Implikace: „Requires additional hardware for running business workloads.“
- **Dedikovaný vs. sdílený NSX** (tabulka) [D9]:

| Atribut | Dedikovaný NSX | Sdílený NSX |
|---|---|---|
| Footprint | „Higher footprint as each workload domain requires a dedicated NSX Manager cluster.“ | menší – jeden cluster pro více domén *(parafráze)* |
| Availability | nezávislá management/control plane per doména *(parafráze)* | „A single NSX management and control plane shared across workload domains increases the blast radius.“ |
| Scalability | „Each workload domain can be scaled independently based on its own requirements.“ | „Scalability can be constrained as the NSX instance is shared across workload domains.“ |
| Lifecycle | „Upgrades and patching can be performed independently per workload domain.“ | „Upgrades and patching impact all included workload domains.“ |

- **[9.0]** [D10]: management domain „Can also run business workloads.“ Workload domain „Scales up to 24 workload
  domains per VCF Instance.“ Implikace: „Additional password management overhead exists for administrators.“
- Slovo „consolidated“ se na stránce 9.1 [D9] ani 9.0 [D10] nevyskytuje.

### 2.6 Umístění vCenteru a NSX Manageru workload domain
Převzato z `00-architektura` 4 [D41]: „You create workload domains in VCF Operations.“ Pro první WLD nasadí VCF
Operations vCenter (a podle potřeby NSX Manager) **do management domain**. Požadavek VCF-NSX-LM-REQD-CFG-001: „Place
the appliances of the NSX Manager cluster on the VM management network in the management domain.“ [D19][D20]
Implikace požadavku VCF-WLD-REQD-CFG-001: „The management components for all greenfield VCF domains are deployed to
the same cluster, and share the same subnet.“ [D5]

### 2.7 Design Blueprints – předpřipravené kombinace (9.1) [D34]
| Blueprint | Management domain | Workloady |
|---|---|---|
| VCF Fleet in a Single Site with Minimal Footprint [D35] | „management domain of the first VCF Instance is deployed with a minimal footprint“ | ve stejném clusteru jako management |
| VCF Fleet in a Single Site [D38] | „deployed with high availability for management components“ | „isolated to a separate workload domain“ |
| VCF Fleet with Multiple Sites in a Single Region / Across Multiple Regions / Single Region plus Additional Region(s) | HA *(parafráze z indexu)* | v samostatné workload domain *(parafráze z indexu)* |

Výběr modelů v minimal-footprint blueprintu [D35][D36]:
- VCF Installer: deployment model „Simple“, velikost „Small“.
- Single-Rack vSphere Cluster Model, Single-Rack vSAN ESA Storage Model, Simple NSX Manager Model.
- Simple VCF Automation, Simple VCF Operations a Simple VCF Management Services Model.
- Single Distributed Switch Model, VCF Management Shared VLAN Network Model.
- Virtual Network Appliance Load Balancer Model.
- Design profile: „Tolerates failure of a single ESX host.“, „Tolerates failure of an individual network path.“,
  izolace „Hypervisor-based (logical isolation).“, „Tenant/Tenant isolation.“.

Výběr modelů v blueprintu Single Site [D38]:
- Management domain: HA VCF Automation („three-node deployment“), VCF Operations „three node cluster … and a single
  cloud proxy appliance“, HA VCF Management Services, Single License Server, VCF Operations for Networks (3 uzly),
  Log Management („three-node deployment behind an internal load balancer“), Identity Broker na VCF Management
  Services, Shared VLAN Network Model.
- Společné pro obě domény: Single-Rack cluster, Storage Separation Distributed Switch Model, Single-Rack vSAN ESA,
  HA NSX Manager.
- Workload domain: „Single Management Zone with Combined Workload Zones“, HA Supervisor Control Plane, Virtual Network
  Appliance LB, Host Fault Tolerant NSX Edge Cluster.
- Design profile: „Tolerates failure of a single ESX host“, „Tolerates failure of a single rack“, „Tolerates failure of
  a single management component“. Izolace navíc „Cluster-based (physical isolation)“ a „Network traffic type
  isolation“.

---

## 3. Prerekvizity

Prerekvizity designových rozhodnutí (vazby mezi volbami). Infrastrukturní prerekvizity (DNS, IP, HW) jsou
v `10-planning`.

| Volba | Musí platit | Zdroj |
|---|---|---|
| Workloady v management domain | management domain musí být dimenzovaná i pro ně: „You must carefully size the management domain to accommodate planned deployments of additional workload domains and management components.“ | [D5] |
| Samostatná workload domain pro workloady | další HW: „Requires additional hardware.“ Min. hosty na cluster podle `10-planning` 6.1. | [D6] |
| Sdílení NSX management domain s WLD | jen **[9.1]**. V **[9.0]** nepodporováno. | [D6][D42] |
| HA NSX Manager | prostředky na 3 uzly v default clusteru management domain (VCF-NSX-LM-REQD-CFG-005). Anti-affinity (VCF-NSX-LM-RCMD-CFG-003) chce „at least four physical hosts“ *(parafráze)*. | [D20] |
| HA VCF Operations | DRS anti-affinity (VCF-OPS-REQD-HA-003) vyžaduje ≥ 4 ESX hosty v default management clusteru *(parafráze)* | [D25] |
| Continuous Availability VCF Operations | dvě AZ pro repliky a třetí AZ pro witness, latence mezi AZ max. 10 ms *(parafráze)*. Model není mezi options Management Domain Modelu. | [D17][D5] |
| Stretched cluster v management domain | Day 2 (nelze při bring-upu) | [D5] |
| Site HA / Fault Domains | „Requires stretched Layer 2 networks or advanced routing.“, „Witness node for split-brain avoidance.“, „The design requires IP addresses to be stretched between the two availability zones.“ | [D11] |
| DR / Fault Domains and DR | druhá VCF Instance v jiné AZ/regionu, VMware Live Recovery, latence a bandwidth podle požadavků VMware | [D11] |
| Simple deployment model | velikost **[9.1]** jen Small („In VCF 9.1, this is the only available option for the simple deployment model.“). Detaily 9.1.1 viz `20-deployment` 4.2. | [D39] |
| VCF Automation | **[9.1]** jen v management domain: „Starting with VCF 9.1, VCF Automation is required to be deployed in the Management Domain only.“ **[9.0]** „VCF Automation is supported to be deployed in a Workload Domain.“ | [D40] |
| Principal storage iSCSI / NVMe / NFSv4.1 | jen konvergencí (management domain) nebo importem (WLD) | [D13] |
| vSAN Storage Cluster model | „Requires vSAN ESA.“ Nepodporováno v default clusteru management domain. | [D13] |
| VCF Operations / Automation na NSX segmentu (management network model s overlay) | jejich nasazení se odloží (deferred). Sítě se musí připravit po VCF Installeru. | [D16] |
| Identity broker – Instance model | služba na VCF Management Services, „Connect the identity broker service to your corporate IdP.“ (VCF-SSO-REQD-EXT-002) | [D33] |

---

## 4. Workflow – designová rozhodnutí

Dokumentace **nedefinuje závazné pořadí** designových rozhodnutí [D2]. Pořadí níže proto skládá dvě doložené
posloupnosti:
- (a) pořadí oblastí v Architectural Options: Fleet → … → Virtual Infrastructure → Physical Infrastructure [D2],
- (b) pořadí voleb v průvodci VCF Installeru 9.1: deployment model a velikost → síť → storage → vSphere Distributed
  Switch → NSX ([D39], kroky viz `20-deployment` 4.2).

Co musí být rozhodnuto před bring-upem a co je Day 2, je u každého kroku vyznačeno.

### 4.1 Fleet deployment model (topologie)
- Volby: Basic, Site High Availability, Disaster Recovery, Fault Domains and DR. Tabulka topologií a povolených
  cluster modelů je v `00-architektura` 6 [D11].
- Omezení a důsledky [D11]:
  - Basic: „Any failure at the availability zone or region level could result in downtime for the entire VCF fleet.“
  - Site HA: „Designed for a single VCF fleet instance across two availability zones.“ Vyžaduje stretched L2 nebo
    advanced routing, witness a low-latency linky.
  - DR: „Longer recovery time …“, „Data loss risk depending on the Recovery Point Objective (RPO) …“, „Significant
    investment in a secondary site …“. DR mechanismus je VMware Live Recovery.
  - Fault Domains and DR: „Requires significant investment in both redundant infrastructure (HA) and a secondary
    site (DR).“
- Všechny modely: „Uses a single VCF Operations instance to manage the environment.“ Více fleet je možné („one fleet
  per region“) za cenu „More management overhead“ [D11].
- Vazba na 4.4: Site HA a Fault Domains povolují stretched management cluster, ale stretch je Day 2 [D5][D11].

### 4.2 Model domén – kde poběží workloady a jak se sdílí NSX
1. **Management domain je povinná**: VCF-WLD-REQD-CFG-001 [D5].
2. **Workloady**. Dokumentace dává dvě volby:
   - (A) **Workloady v management domain**. Povoleno („Can also run business workloads.“ [D5][D9]). Odpovídá
     blueprintu Minimal Footprint, kde je vše v jednom clusteru [D35]. Důsledky: sdílené prostředky a společný
     lifecycle s managementem. Pravidlo VCF-WLD-RCMD-CFG-002 tím není splněno [D6]. **[9.0]** doporučovalo resource
     pooly (VCF-WLD-RCMD-CFG-001) [D7]. **[9.1]** toto doporučení nemá [D5].
   - (B) **Workloady v samostatné workload domain** – **doporučeno** (VCF-WLD-RCMD-CFG-002) [D6]. WLD se přidává
     **po** management domain ve VCF Operations (Day 2, viz `00-architektura` 4 [D41]). Max. 40 WLD na instanci
     **[9.1]** / 24 **[9.0]** [D9][D10].
3. **NSX Manager pro management domain**: doporučen dedikovaný (VCF-MGMT-RCMD-NSX-001) [D5].
4. **NSX pro workload domain**: dedikovaný, nebo sdílený (VCF-WLD-RCMD-NSX-002) [D6]. **[9.1]** smí sdílet i NSX
   management domain [D6]. **[9.0]** nesmí [D42]. Trade-offy jsou v tabulce 2.5 [D9].
5. **SSO domain WLD**: vCenter SSO je dedikovaný per WLD [D6][D9].

### 4.3 Deployment model (Simple / High Availability) a velikost
- Volí se v průvodci VCF Installeru: „High Availability is recommended for production environments.“ Volba platí jen
  pro nově nasazené appliance [D39].
- Velikost **[9.1]**: Simple jen Small. HA: Medium nebo Large. **[9.1.1+]** Small je výchozí pro Simple i HA
  (`20-deployment` 4.2) [D39]. Tabulky profilů vCPU/RAM/disk jsou v `00-architektura` 6 [D12].
- Volba ovlivňuje modely komponent:

| Komponenta | Simple | High Availability | Zdroj |
|---|---|---|---|
| VCF management services | VCF-MS-REQD-SIM-001: „single control plane node and three worker nodes in the default management vSphere cluster“. Doporučené použití: proof of concept a lab *(parafráze)*. „Loss of the single control plane node would result in a need to redeploy the cluster and restore from backup.“ | VCF-MS-REQD-HA-001: „three (3) control plane nodes and the corresponding number of worker nodes“. Velikosti Medium, Large. | [D22][D23] |
| NSX Manager | VCF-NSX-LM-REQD-CFG-004: jeden uzel v default clusteru management domain | VCF-NSX-LM-REQD-CFG-005: „Deploy three (3) NSX Manager nodes in the management domain default vSphere cluster…“ | [D19][D20] |
| VCF Operations | VCF-OPS-REQD-SIM-001: „Deploy VCF Operations as a single node in the default management vSphere cluster.“ | VCF-OPS-REQD-HA-001: 3uzlový cluster v default management clusteru *(parafráze)* | [D24][D25] |
| VCF Automation | VCF-AUTO-REQD-SIM-001: „Deploy VCF Automation as a single node in the default management domain vSphere cluster.“ | VCF-AUTO-REQD-HA-001: „Deploy VCF Automation as a three node cluster.“ | [D27][D28] |

- Přechod Simple → HA:
  - Simple VCF management services: „Scale out to a medium or large high availability deployment model is
    supported.“ [D22]
  - Simple VCF Automation: „Scale-up to a larger node size and scale-out to three nodes at the same time.“ [D27]
  - Simple VCF Operations: „Can be scaled-out to be highly available.“ [D17]
  - Obecné pravidlo „Simple → HA“ pro celou instanci sizing stránka neuvádí (Otevřené otázky) [D12].

### 4.4 vSphere cluster model (první cluster management domain, clustery WLD)
- Management domain, první cluster: Single-Rack, Multi-Rack L2, Stretched (Day 2). Další clustery: „All cluster
  models.“ [D5]
- WLD: Single-Rack, Multi-Rack L2, Multi-Rack L3, Stretched [D6].
- Společné požadavky clusteru [D18]: VCF-CLS-REQD-CFG-001 … 004. Doporučení: VCF-CLS-RCMD-CFG-001 … 004 a 006.
  Texty jsou v sekci 6.2. Minima hostů a rezervy jsou v `10-planning` 6.1 a 6.3.

### 4.5 Principal storage model
- Definice: „Principal storage is used during the creation of a VCF domain or a vSphere cluster and is capable of
  running workloads.“ Supplemental storage „can be added after the creation of a VCF domain or a vSphere cluster“
  [D13].
- Povolené modely (Storage Models 9.1) [D13]:

| Model | Mgmt – default cluster | Mgmt – další clustery | WLD |
|---|---|---|---|
| Single-Rack vSAN ESA / OSA | Principal | Principal | Principal |
| Single-Rack vSAN Storage Cluster / Compute Cluster | **Non Supported** | Principal | Principal |
| Multi-Rack vSAN / Multi-Rack vSAN Compute Cluster | **Non Supported** | Principal | Principal |
| Fibre Channel, NFS (NFSv3) | Principal, Supplemental | Principal, Supplemental | Principal, Supplemental |
| NFSv4.1, iSCSI, NVMe/TCP, NVMe/FC, NVMe/RDMA | Principal*, Supplemental | Principal*, Supplemental | Principal*, Supplemental |

  \* „Principal Storage marked with an asterisk can be achieved by converging existing virtual infrastructure … for a
  management domain or importing an existing virtual infrastructure … for a workload domain.“ [D13]
- Funkce, které má jen vSAN (ne FC/NFS/iSCSI/NVMe) [D13]: „Provides a Full SDDC Solution“, „Storage Policy Based
  Management“, „Automated Deployment and Scale“, „Automated LCM, Patching, and Upgrades“, „Compute Only Clusters“.
  Stretched cluster podporují vSAN, FC a NFS (FC/NFS přes vMSC, KB 417356).
- V průvodci VCF Installeru lze zvolit vSAN ESA, vSAN OSA, VMFS on FC a NFS v3. „the principal storage type for a
  cluster cannot be changed“. Do management domain lze později přidat clustery s jiným principal storage [D39]
  (`20-deployment` 4.2 krok 7).
- vSAN Storage Cluster: „Not recommended running virtual machine workloads directly on the vSAN Storage Clusters.“
  vSAN Compute Cluster „Must be co-located in the same workload domain as its corresponding vSAN Storage cluster.“
  [D13]
- Síť: „All other vSAN ESA nodes require 25GbE or greater.“ Výjimka je ReadyNode profil „vSAN-ESA-AF-0“ (10GbE)
  [D13].

### 4.6 Síťový model
1. **Distributed Switch model** [D15]:
   - Single Distributed Switch. Implikace: „Does not provide network traffic separation to another physical network
     fabric.“
   - Storage Separation.
   - Workload Separation.
   - Storage and Workload Separation: „minimum of six (6) with redundancy“ pNIC.
   - Dedicated vSphere Cluster for NSX Edge Node.
   - vSAN Storage Cluster Separation (2 VDS).
   - **[9.1.1]** „Starting with VCF 9.1.1 for greenfield deployments it is now supported to share a vSphere Distributed
     Switch between clusters in a VCF domain.“
   - Profily průvodce (Default / Storage Traffic Separation / NSX Traffic Separation / Custom) jsou v
     `20-deployment` 4.2 krok 15.
2. **VCF Management Network model** [D16]:
   - Shared VLAN (VM management network).
   - Dedicated VLAN (VCF management network).
   - Dedicated VLAN and NSX Overlay Segment.
   - Dedicated VLAN and NSX Stretched Overlay Segment.
   - Pravidla: VCF management services vždy na vSphere distributed port group. Cloud proxy vždy na VM management
     network. Overlay segmenty jen pro VCF Operations, VCF Automation, License Server a VCF Operations for networks.
     U custom networkingu se VCF Operations a VCF Automation nasazují odloženě. *(parafráze)*
3. **Network Consumption model** (workloady) [D14]:
   - VCF Automation All Apps Orgs.
   - Virtual Private Cloud (VPC): „VPC model cannot be consumed via NSX Global Manager.“
   - NSX Segment.
   - VLAN Networking: „supported in VMware Cloud Foundation and may be appropriate for specific use cases“.
   - Federace (centralizovaná security policy, L2/L3 extension) nefunguje u All Apps Orgs ani u VPC *(parafráze)*.
   - VPC volby v průvodci (Full Stack VPC / VLAN-Backed VPC, Centralized / Distributed) jsou v `20-deployment` 4.2
     krok 6.
4. **Workload network type WLD**: IPv4 / IPv6 [D6].

### 4.7 VCF Operations model
- Volby [D17][D26]:
  - Simple: „Single node for VCF Operations.“, „Slower recovery from failure.“
  - High Availability: Primary, Replica a Data node.
  - Continuous Availability: „A cluster with a pair of nodes, across two availability zones“. „Manual operations after
    the initial installation“. Dvě AZ a třetí AZ pro witness, max. 10 ms *(parafráze)*.
- **[9.1.1]** „VCF Operations is always deployed in the management domain of the first VCF Instance in the VCF fleet.“
  [D39]
- Provozní volby, které dokumentace vede jako alternativy pod stejným ID (vybírá se jedna) [D24][D25]:
  - VCF-OPS-RECD-NET-001: default port group / dedikovaná port group / NSX segment,
  - VCF-OPS-RECD-LIC-001: Connected / Disconnected licensing mode,
  - VCF-OPS-RECD-DIAG-001: přímé stahování / ruční upload signatur,
  - VCF-OPS-RECD-BIN-001: online depot / offline depot / ruční upload.

### 4.8 VCF Automation model
- Simple (1 uzel, Small) nebo HA (3 uzly) [D27][D28][D29].
- Nasazení buď přes VCF Installer, který „Uses the VM management distributed port group by default“, nebo přes VCF
  Operations fleet management, který „Allows for custom network configurations.“ [D29]
- **[9.1]** jen v management domain. **[9.0]** mohla být ve WLD [D40].

### 4.9 Identity / SSO model
1. **Identity broker deployment model** [D31]:
   - **Embedded**: „Use the embedded identity broker in the first management domain vCenter.“
     (VCF-SSO-REQD-EMB-001). „This deployment model is intended for VMware Cloud Foundation lab environments or
     proof-of-concept (POC) use cases.“ „One identity broker per VCF Instance.“ Přechod na instance model: „Migration
     from embedded to the instance model is performed via a streamlined wizard in VCF Operations.“ [D32]
   - **Instance**: „This option is recommended for a production VMware Cloud Foundation deployment.“ [D31] Běží na
     VCF Management Services, automaticky v první management domain. Další brokery jsou Day 2 (VCF-SSO-REQD-EXT-001:
     „Deploy additional identity broker instances as a Day N operation as needed.“) [D33].
2. **VCF SSO model** [D30]:
   - Fleet-Wide: „each VCF fleet contains a single identity broker deployment“.
   - Cross VCF Instance: „Each identity broker instance serves a defined set of VCF instances in the same VCF fleet.“
   - Single VCF Instance: „each VCF Instance will utilize its own dedicated identity broker.“
   - Pravidla: „all components belonging to a single VCF instance must belong to the same SSO realm.“ Split-SSO není
     podporováno *(parafráze)*. SSO není povinné – lze zůstat u autentizace per komponenta *(parafráze)*.

### 4.10 Shrnutí pořadí pro Sandbox (návrh herní posloupnosti, ne pořadí dokumentace)
1. fleet deployment model (4.1),
2. umístění workloadů a model domén / NSX sharing (4.2),
3. deployment model + velikost (4.3),
4. cluster model první management cluster (4.4),
5. principal storage (4.5),
6. VDS model + management network model + VPC/consumption (4.6),
7. VCF Operations / VCF Automation modely (4.7–4.8, odvozené z 3),
8. identity / SSO model (4.9).

Kroky 3, 5 a 6 odpovídají pořadí v průvodci VCF Installeru [D39]. Stretch, další WLD, další identity brokery,
Continuous Availability VCF Operations a Log management jsou Day 2.

---

## 5. Chybové stavy

Designová dokumentace uvádí, co je **nepodporované** nebo **nedoporučené**. Konkrétní validační hlášky nedává.

| Situace | Co říká dokumentace | Typ (pro hru) | Zdroj |
|---|---|---|---|
| WLD sdílí NSX Manager management domain ve **[9.0]** | „Workload domains cannot use the NSX Manager cluster for the management domain.“ | nepodporováno (9.0) | [D42] |
| VCF Automation ve WLD po upgradu VCF Operations na 9.1 | „Starting with VCF 9.1, VCF Automation is required to be deployed in the Management Domain only.“ „This placement model is enforced by VCF Operations 9.1 and Fleet Management.“ Nasazení je hlášeno jako non-compliant a migrace „is required before proceeding with the remaining VCF 9.1 upgrade.“ | blokace upgradu | [D40] |
| Multi-Rack L3 jako první cluster management domain | není mezi options („Single-Rack“, „Multi-Rack Layer 2“, „Stretched … (Day 2)“) | nepodporováno | [D5] |
| Stretched management cluster při bring-upu | označeno „(Day 2)“ | nelze v designu Day 0 | [D5] |
| vSAN Storage / Compute / Multi-Rack vSAN v default clusteru management domain | „Non Supported“ | nepodporováno | [D13] |
| iSCSI / NVMe / NFSv4.1 jako principal storage v greenfieldu | jen konvergencí nebo importem | nepodporováno v greenfieldu | [D13] |
| Změna principal storage clusteru | „the principal storage type for a cluster cannot be changed“ | nevratné | [D39] |
| Simple deployment model s velikostí Medium/Large **[9.1]** | Small je „the only available option for the simple deployment model“ | validace volby | [D39] |
| VPC + NSX Global Manager | „VPC model cannot be consumed via NSX Global Manager.“ | nepodporováno | [D14] |
| Split-SSO mezi komponentami jedné instance | komponenty WLD se musí připojit ke stejnému brokeru instance. Split-SSO není podporováno *(parafráze)*. | nepodporováno | [D30] |
| Restore identity brokeru do jiného SSO realmu | „restoring an identity broker to a VCF instance in a different SSO realm is not supported.“ | nepodporováno | [D30] |
| Workloady v management domain bez dimenzování | implikace VCF-WLD-REQD-CFG-001: nutné pečlivé dimenzování. Porušení doporučení VCF-WLD-RCMD-CFG-002. | **nedoporučení** (varování, ne chyba) | [D5][D6] |
| Sdílený NSX – výpadek | „increases the blast radius“. Upgrade „impact[s] all included workload domains“. | důsledek volby | [D9] |
| Simple VCF management services – ztráta control plane | „Loss of the single control plane node would result in a need to redeploy the cluster and restore from backup.“ | důsledek volby | [D22] |
| Embedded identity broker – údržba vCenteru | „maintenance tasks performed on the vCenter instance also impact your ability to authenticate“ | důsledek volby | [D32] |
| Basic fleet – výpadek AZ | „Any failure at the availability zone or region level could result in downtime for the entire VCF fleet.“ | důsledek volby | [D11] |

---

## 6. Limity a čísla

### 6.1 Čísla
| Položka | Hodnota | Zdroj |
|---|---|---|
| Workload domains na VCF Instance | max. 40 **[9.1]** / 24 **[9.0]** | [D9][D10] |
| Management domain na VCF Instance | 1 (VCF-WLD-REQD-CFG-001) | [D5] |
| VCF Operations instancí na fleet | 1 („a single VCF Operations instance“) | [D11] |
| NSX Manager | Simple 1 uzel / HA 3 uzly (+ anti-affinity → ≥ 4 hosty) | [D19][D20] |
| VCF Operations | Simple 1 / HA 3 (Primary, Replica, Data) / CA páry uzlů přes 2 AZ + witness AZ | [D17] |
| VCF Operations HA anti-affinity | ≥ 4 ESX hosty v default management clusteru *(parafráze)* | [D25] |
| CA VCF Operations – latence mezi AZ | max. 10 ms *(parafráze)* | [D17] |
| VCF Automation | Simple 1 (Small) / HA 3 | [D27][D28] |
| VCF management services | Simple 1 CP + 3 worker [D22] (rozpor se sizing tabulkou: `00` Otevřené otázky 1) / HA 3 CP + workery | [D22][D23] |
| Identity broker Embedded | 1 („As part of vCenter“), 1 na VCF Instance | [D32] |
| VDS model Storage and Workload Separation | min. 6 pNIC | [D15] |
| vSAN ESA síť | ≥ 25GbE (výjimka vSAN-ESA-AF-0: 10GbE) | [D13] |
| Minimal footprint blueprint – IP | ESX Mgmt 3, VM Mgmt 24, vMotion 3, vSAN 3, Host TEP 6, volitelně Edge TEP 4 a Edge Uplink 2 *(parafráze tabulky)* | [D36] |
| Minima hostů na cluster | viz `10-planning` 6.1 | [D18] |

### 6.2 ID requirements a recommendations relevantní pro design fázi
Formát ID: `VCF-<oblast>-<REQD|RCMD|RECD>-<kategorie>-<NNN>`.
- `REQD` = Design Requirement.
- `RCMD` = Design Recommendation. Stránky VCF Operations používají variantu `RECD` [D24][D25].
- Oblasti, které jsme viděli: WLD, MGMT, CLS, VNI, NSX-LM, MS, OPS, AUTO, SSO.
- Kategorie, které jsme viděli: CFG, NSX, COM, SIM, HA, EXT, EMB, NET, LIC, DIAG, BIN.
- Některá ID se na stránce opakují pro alternativní volby (např. VCF-OPS-RECD-NET-001 třikrát) [D24][D25].

| ID | Text (doslova, pokud není uvedeno jinak) | Verze | Zdroj |
|---|---|---|---|
| VCF-WLD-REQD-CFG-001 | „Deploy a management domain to host all management components for the VCF Instance.“ | 9.0, 9.1 | [D5][D7] |
| VCF-WLD-RCMD-CFG-001 | „If running business workloads in the management domain, configure the following vSphere resource pools … to control resource usage by management and business workloads.“ | **jen 9.0** | [D7] |
| VCF-WLD-RCMD-CFG-002 | „Use workload domains for customer workloads.“ | 9.0, 9.1 | [D6][D8] |
| VCF-MGMT-RCMD-NSX-001 | „Use a dedicated NSX Manager instance for the management domain.“ | **9.1** (v 9.0 na stránce není) | [D5][D7] |
| VCF-WLD-RCMD-NSX-002 | „Use a dedicated or shared NSX Manager instance for the workload domain.“ | 9.1 | [D6] |
| VCF-CLS-REQD-CFG-001 | „Create a vSphere cluster in each VCF domain for the initial set of ESX hosts.“ | 9.1 | [D18] |
| VCF-CLS-REQD-CFG-002 | „Allocate the minimum number of ESX hosts according to the vSphere cluster type being deployed.“ | 9.1 | [D18] |
| VCF-CLS-REQD-CFG-003 | „Use vSphere Lifecycle Manager images as the lifecycle management method for all vSphere clusters.“ | 9.1 | [D18] |
| VCF-CLS-REQD-CFG-004 | „Use vSphere HA to protect all virtual machines against failures.“ | 9.1 | [D18] |
| VCF-CLS-RCMD-CFG-001 | „Configure admission control for one (1) ESX host failure and percentage-based failover capacity.“ | 9.1 | [D18] |
| VCF-CLS-RCMD-CFG-002 | „Enable VM Monitoring for each vSphere cluster.“ | 9.1 | [D18] |
| VCF-CLS-RCMD-CFG-003 | „Enable vSphere DRS on all vSphere clusters, using the default fully automated mode with medium threshold.“ | 9.1 | [D18] |
| VCF-CLS-RCMD-CFG-004 | „Enable Enhanced vMotion Compatibility on all vSphere clusters in the management domain.“ Pro default management cluster se EVC zapíná při bring-upu přes API a JSON spec *(parafráze implikace)*. | 9.1 | [D18] |
| VCF-CLS-RCMD-CFG-006 | „Set the Enhanced vMotion Compatibility mode on a vSphere cluster to the highest available baseline …“ (zkráceno) | 9.1 | [D18] |
| VCF-VNI-REQD-CFG-001 | „Configure all ESX hosts in the workload domain as transport nodes in NSX.“ | 9.1 | [D18] |
| VCF-VNI-REQD-CFG-002 | „Configure each ESX host as a transport node using transport node profiles.“ | 9.1 | [D18] |
| VCF-VNI-REQD-CFG-003 | „Create a single overlay transport zone in the NSX instance for all overlay traffic across the host …“ (zkráceno) | 9.1 | [D18] |
| VCF-VNI-RCMD-CFG-001 | „Use static IP pools to assign IP addresses to the host TEP interfaces.“ | 9.1 | [D18] |
| VCF-VNI-RCMD-CFG-002 | „Create an uplink profile with a load balance source teaming policy with all active uplinks for ESX hosts.“ | 9.1 | [D18] |
| VCF-NSX-LM-REQD-CFG-001 | „Place the appliances of the NSX Manager cluster on the VM management network in the management domain.“ | 9.1 | [D19][D20] |
| VCF-NSX-LM-REQD-CFG-002 | „Create a virtual IP (VIP) address for the NSX Manager cluster for the workload domain.“ | 9.1 | [D19][D20] |
| VCF-NSX-LM-REQD-CFG-003 | „In vSphere HA, set the restart priority policy for each appliance to high.“ | 9.1 | [D19][D20] |
| VCF-NSX-LM-REQD-CFG-004 | „Deploy a single NSX Manager node in the management domain default vSphere cluster …“ (Simple) | 9.1 | [D19] |
| VCF-NSX-LM-REQD-CFG-005 | „Deploy three (3) NSX Manager nodes in the management domain default vSphere cluster …“ (HA) | 9.1 | [D20] |
| VCF-NSX-LM-RCMD-CFG-001 | „Deploy appropriately sized nodes in the NSX Manager cluster for the workload domain.“ | 9.1 | [D19][D20] |
| VCF-NSX-LM-RCMD-CFG-002 | „Add the NSX Manager appliances to the virtual machine group for the first availability zone.“ (stretched) | 9.1 | [D19][D20] |
| VCF-NSX-LM-RCMD-CFG-003 | „Apply VM-VM anti-affinity rules in vSphere DRS to the NSX Manager appliances.“ | 9.1 | [D20] |
| VCF-MS-REQD-COM-001 | „Allocate a sufficient IP range for the required number of control plane and worker nodes for your chosen deployment type.“ | 9.1 | [D22][D23] |
| VCF-MS-REQD-COM-002 | „Use Kubernetes Cluster API Provider vSphere (CAPV) node anti-affinity to ensure the nodes run on different ESX hosts.“ | 9.1 | [D22][D23] |
| VCF-MS-REQD-COM-003 | „Protect the VCF management services nodes by using vSphere HA.“ | 9.1 | [D22][D23] |
| VCF-MS-REQD-SIM-001 | „Deploy VCF management services with a single control plane node and three worker nodes in the default management vSphere cluster.“ | 9.1 | [D22] |
| VCF-MS-REQD-HA-001 | „Deploy VCF management services in high availability mode with three (3) control plane nodes and the corresponding number of worker nodes in the default management vSphere cluster.“ | 9.1 | [D23] |
| VCF-OPS-REQD-SIM-001 | „Deploy VCF Operations as a single node in the default management vSphere cluster.“ | 9.1 | [D24] |
| VCF-OPS-REQD-COM-001 | „Deploy the fleet management component in the VCF management services in default management cluster.“ | 9.1 | [D24] |
| VCF-OPS-REQD-COM-002 | „Protect through the fleet management VCF management services configuration.“ | 9.1 | [D24] |
| VCF-OPS-REQD-COM-003 | „Deploy a single cloud proxy appliance in the default management vSphere cluster.“ | 9.1 | [D24] |
| VCF-OPS-REQD-COM-004 | „Protect cloud proxy appliance by using vSphere HA.“ | 9.1 | [D24] |
| VCF-OPS-REQD-HA-001 … 005 | HA: 3uzlový cluster v default management clusteru, 1 unified collector, DRS anti-affinity (≥ 4 hosty), SAN certifikátu se všemi FQDN uzlů, příp. FQDN LB *(parafráze)* | 9.1 | [D25] |
| VCF-OPS-RECD-COM-001 … 006 | cloud proxy data persistence, notifikace, physical data center objekt, Ping integrace, měna, „Deploy real-time metrics in each VCF Instance.“ | 9.1 | [D24][D25] |
| VCF-OPS-RCMD-HA-001 … 005 | externí LB, collector group per instance, další collector, anti-affinity collectorů, adapter na lokální collector group *(parafráze)* | 9.1 | [D25] |
| VCF-AUTO-REQD-SIM-001 | „Deploy VCF Automation as a single node in the default management domain vSphere cluster.“ | 9.1 | [D27] |
| VCF-AUTO-REQD-SIM-002 | „Protect the VCF Automation node using vSphere HA.“ | 9.1 | [D27] |
| VCF-AUTO-REQD-HA-001 | „Deploy VCF Automation as a three node cluster.“ | 9.1 | [D28] |
| VCF-AUTO-REQD-HA-003 | „Protect all VCF Automation nodes using vSphere HA.“ | 9.1 | [D28] |
| VCF-SSO-REQD-EMB-001 | „Use the embedded identity broker in the first management domain vCenter.“ | 9.1 | [D32] |
| VCF-SSO-REQD-EMB-002 | „Connect the embedded identity broker to your corporate IdP.“ | 9.1 | [D32] |
| VCF-SSO-REQD-EXT-001 | „Deploy additional identity broker instances as a Day N operation as needed.“ | 9.1 | [D33] |
| VCF-SSO-REQD-EXT-002 | „Connect the identity broker service to your corporate IdP.“ | 9.1 | [D33] |

Storage ID (VCF-VSAN-…) a ID multi-rack/stretched clusterů (VCF-CLS-MR-…, VCF-CLS-REQD-CFG-006, VCF-CLS-RCMD-CFG-008)
jsou v `10-planning` 6.1 a 6.3.

---

## 7. Síťový provoz

Designové volby **nevytvářejí nové porty**. Porty jsou v `00-architektura` 7, `10-planning` 7 a `20-deployment` 7.
Design určuje, **na které síti / VLAN** toky běží. To je pro vizualizaci podstatné:

| # | Volba | Tok (odkud → kam) | Síť | Typ | Zdroj |
|---|---|---|---|---|---|
| 1 | Workloady v management domain (A) | workload VM ↔ management VM sdílejí hosty, vSAN a uplinky clusteru | stejné VDS / pNIC jako management | data + management na stejném HW | [D5][D35] |
| 2 | Samostatná WLD (B) | vCenter WLD a (dedikovaný) NSX Manager WLD běží v management domain a spravují hosty WLD | VM management network management domain → ESX management WLD | management (cross-domain) | [D5][D19][D41] |
| 3 | Sdílený NSX (9.1) | jeden NSX Manager cluster ↔ transport nody více domén | VM management network | control/management plane | [D6][D9] |
| 4 | Shared VLAN management network | VCF Operations, VCF Automation, management services, vCenter, NSX na jedné VLAN | VM management network | management | [D16] |
| 5 | Dedicated VLAN management network | VCF Operations / Automation / management services na samostatné VLAN; cloud proxy zůstává na VM management | VCF management network + VM management | management (L3 mezi VLAN) | [D16] |
| 6 | NSX overlay management segment | VCF Operations / Automation / License Server / Ops for networks na overlay segmentu (Tier-1 LB) | NSX overlay (Geneve přes TEP) | management přes overlay | [D16] |
| 7 | VDS separation modely | vSAN / NFS a workload provoz na oddělených pNIC / fabricích | podle modelu | storage vs. data | [D15] |
| 8 | Site HA / CA VCF Operations | replikace a heartbeat mezi AZ, witness ve 3. AZ | inter-AZ link (≤ 10 ms pro CA VCF Ops) | synchronní replikace | [D11][D17] |
| 9 | DR | replikace VMware Live Recovery mezi instancemi | inter-site / inter-region | asynchronní replikace | [D11] |

---

## 8. Otevřené otázky

1. **Workloady v management domain v 9.1 – resource pooly.** 9.0 doporučovalo resource pooly
   (VCF-WLD-RCMD-CFG-001) [D7]. Stránka 9.1 [D5] doporučení nemá. Není jasné, jestli bylo vědomě zrušené, nebo
   přesunuté jinam (např. do blueprintu Minimal Footprint, jehož layer stránky jsme neprošli). Ve hře zatím
   modelovat jen jako 9.0 pravidlo.
2. **Minimum hostů pro blueprint Minimal Footprint.** Stránka Minimum Requirements [D36] uvádí jen „ESX: 3 Nodes“
   v DNS záznamech a IP počty pro 3 hosty. Explicitní HW minima a kapacitu pro workloady nedává.
3. **Continuous Availability VCF Operations** je ve VCF Operations Detailed Design [D26][D17], ale ne mezi options
   Management Domain Modelu [D5]. Je to Day 2 transformace? Jak souvisí se Site HA fleet modelem?
4. **Velikost HA VCF management services**: stránka HA modelu uvádí „Medium, Large“ [D23]. Průvodce 9.1.1 ale
   dovoluje Small i pro HA (`20-deployment` 4.2) a sizing tabulka má „HA – Small“ [D12]. Vztah nevyjasněn.
5. **Počet workerů Simple VCF management services** (3 vs 2) – stále otevřené (`00-architektura` Otevřené otázky 1).
   [D22] uvádí 3.
6. **Změna Simple → HA celé instance** (NSX 1→3 uzly, VCF Operations 1→3). Jednotlivé komponenty scale-out
   podporují [D17][D22][D27]. Celkový postup a změnu „deployment modelu“ instance ale dokumentace v design sekci
   neuvádí [D12].
7. **Stránky layerů blueprintů** (Consumption / Operations / Security / Virtual / Physical Infrastructure Layer)
   a blueprinty multi-site nebyly staženy jednotlivě. Tabulka 2.7 pro multi-site je parafráze indexu [D34].
8. **Nezpracované modely**: vSphere Supervisor, Workload Connectivity, Load Balancer, VCF Recovery Options, NSX Edge
   Cluster, Virtual Network Appliance, Network Fabric, VCF Edge, Private AI, vDefend [D2]. Patří do `51-nsx`,
   `80-automation`, `90-operations`.
9. **Přesné celé texty** některých ID jsou v nástroji zkrácené nebo parafrázované: VCF-OPS-REQD-HA-*,
   VCF-OPS-RCMD-HA-*, VCF-CLS-RCMD-CFG-006, VCF-VNI-REQD-CFG-003. Ověřit v PDF Design Library 9.1.
10. **„Consolidated architecture“ v 9.x**: na stránkách [D4]–[D10] a v blueprintech termín nenalezen. Fulltextové
    hledání přes celé TechDocs 9.x nebylo možné (vyhledávač nerespektoval `site:`). Komunitní a partnerské zdroje
    (Dell) termín pro 9.0 používají – to **není** zdroj faktu.
11. **VCF Operations for Networks a Log management** jako designové volby (Simple / HA, 3 uzly) – zmíněné v options
    [D5] a v blueprintu [D38], detailní stránky nebyly zpracovány.
12. **[9.0] VCF Automation ve WLD** – KB [D40] to potvrzuje. Stránka 9.0 Management Domain Model ale řadí VCF
    Automation mezi fleet komponenty management domain [D7]. Jak přesně byla v 9.0 volba umístění nabízena (UI),
    neověřeno.

---

## 9. Zdroje

Základ: `https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/`

- [D1] Design (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design.html
- [D2] Architectural Options in VMware Cloud Foundation (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/vmware-cloud-foundation-concepts.html
- [D3] Design Library for VMware Cloud Foundation (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library.html
- [D4] VCF Domain Detailed Design (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/workload-domain-deployment-models.html
- [D5] Management Domain Model (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/workload-domain-deployment-models/management-domain-deployment-model.html
- [D6] Workload Domain Model (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/workload-domain-deployment-models/workload-domain-deployment-model.html
- [D7] Management Domain Model (9.0): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/design/design-library/workload-domain-deployment-models/management-domain-deployment-model.html
- [D8] Workload Domain Model (9.0): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/design/design-library/workload-domain-deployment-models/workload-domain-deployment-model.html
- [D9] VCF Domain Models (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/vmware-cloud-foundation-concepts/design-guide-vmware-cloud-foundation-architecture-models.html
- [D10] VCF Domain Models (9.0): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/design/vmware-cloud-foundation-concepts/design-guide-vmware-cloud-foundation-architecture-models.html
- [D11] VCF Fleet Deployment Models (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/vmware-cloud-foundation-concepts/vcf-operations-deployment-models.html
- [D12] VCF Fleet Sizing Models (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/vmware-cloud-foundation-concepts/vcf-fleet-sizing-models-9-x.html
- [D13] Storage Models (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/vmware-cloud-foundation-concepts/storage-models.html
- [D14] Network Consumption Models (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/vmware-cloud-foundation-concepts/network-backing-models.html
- [D15] Distributed Switch Models (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/vmware-cloud-foundation-concepts/cluster-network-deployment-models.html
- [D16] VCF Management Network Models (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/vmware-cloud-foundation-concepts/fleet-level-component-backing-networking-models.html
- [D17] VCF Operations Models (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/vmware-cloud-foundation-concepts/vcf-operations.html
- [D18] Single-Rack vSphere Cluster Model (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/cluster-models/single-instance-single-availability-zone.html
- [D19] Simple NSX Manager Model (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/nsx-management-and-control-plane-detailed-design/simple-nsx-manager-model.html
- [D20] High Availability NSX Manager Model (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/nsx-management-and-control-plane-detailed-design/high-availability-nsx-manager-model.html
- [D21] NSX Manager and Control Plane Detailed Design (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/nsx-management-and-control-plane-detailed-design.html
- [D22] Simple VCF Management Services Model (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/vcf-management-services-availabilty-detailed-design/vcf-management-services-simple-deployment-model.html
- [D23] High Availability VCF Management Services Model (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/vcf-management-services-availabilty-detailed-design/vcf-management-services-high-availability-deployment-model.html
- [D24] Simple VCF Operations Model (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/vcf-operations-design/simple-vcf-operations-model1.html
- [D25] High Availability VCF Operations Model (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/vcf-operations-design/vcf-operations-ha-model.html
- [D26] VCF Operations Detailed Design (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/vcf-operations-design.html
- [D27] Simple VCF Automation Model (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/vcf-automation-deployment-models-9-x/vcf-automation-simple-deployment-model.html
- [D28] High Availability VCF Automation Model (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/vcf-automation-deployment-models-9-x/vcf-automation-high-availability-deployment-model.html
- [D29] VCF Automation Detailed Design (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/vcf-automation-deployment-models-9-x.html
- [D30] VCF Single Sign-On Detailed Design (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/single-sign-on-models.html
- [D31] Identity Broker Detailed Design (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/single-sign-on-instance-models.html
- [D32] Embedded Identity Broker Model (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/single-sign-on-instance-models/embedded-vidb.html
- [D33] Instance Identity Broker Model (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/single-sign-on-instance-models/external-vidb.html
- [D34] Design Blueprints – Infrastructure Modernization (9.1, vč. „Expansion after Infrastructure Blueprint Deployment“): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/infrastructure-modernization.html
- [D35] VCF Fleet in a Single Site with Minimal Footprint (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/infrastructure-modernization/vcf-fleet-in-a-single-site-with-minimal-footprint-blueprint.html
- [D36] Minimum Requirements for VCF Fleet in a Single Site with Minimal Footprint (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/infrastructure-modernization/vcf-fleet-in-a-single-site-with-minimal-footprint-blueprint/minimaltemo.html
- [D37] Management Domain Design Selections – Minimal Footprint (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/infrastructure-modernization/vcf-fleet-in-a-single-site-with-minimal-footprint-blueprint/management-domain-design-selections.html
- [D38] VCF Fleet in a Single Site (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/infrastructure-modernization/vcf-fleet-in-a-single-site-blueprint.html
- [D39] Deploy a New VCF Fleet or a New VCF Instance – průvodce (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/deploy-a-new-vcf-fleet-or-a-new-vcf-instance.html
- [D40] KB 459019 – Migrating VCF Automation 9.0.x from Workload Domain to Management Domain after VCF Operations 9.1 Upgrade: https://knowledge.broadcom.com/external/article/459019
- [D41] VCF Taxonomy (9.1) – převzato přes `00-architektura` [S1]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/overview-of-vmware-cloud-foundation-9/workload-domains-in-vmware-cloud-foundation.html
- [D42] VCF Taxonomy (9.0) – převzato přes `00-architektura` [S10]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/overview-of-vmware-cloud-foundation-9/workload-domains-in-vmware-cloud-foundation.html
- [D43] vSphere Cluster Detailed Design (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/cluster-models.html
- [D44] VCF Management Services Detailed Design (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/vcf-management-services-availabilty-detailed-design.html
