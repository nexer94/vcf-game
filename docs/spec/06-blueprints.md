# 06 – Design Blueprints (VCF 9.1)

> Modelovaná verze: **VCF 9.1.1** (viz `docs/spec/VERSION.md`). Rozdíly oproti 9.0 jsou označené **[9.0]** / **[9.1]**.
> Zdroje [B1]…[B45] jsou v sekci 9. Všechny vedou na techdocs.broadcom.com.
> Navazuje na `05-design` (modely, ID requirements) – tam je stručný přehled v 2.7, tady je kompletní zpracování
> všech blueprintů ze sekce **Design → Design Blueprints for VMware Cloud Foundation** (9.1).
> Účel: podklad pro **výběr lokality na startu Sandboxu** a pro kampaně (kterou topologii hráč staví).
>
> Citace z dokumentace jsou anglicky v uvozovkách. Nástroj na čtení stránek často vrací jen parafrázi – takový
> text je označený *(parafráze)*. Odvozené součty / závěry, které dokumentace výslovně neuvádí, jsou označené
> *(odvozeno)*.
> Tabulky, které už jsou jinde, se neopakují: minima hostů podle cluster modelu (`10-planning` 6.1), modely fleet
> (`00-architektura` 6), ID requirements design library (`05-design` 6.2).

---

## 1. Shrnutí

Design Blueprints jsou „hotové recepty“ – předvybrané kombinace modelů z Design Library pro typické situace.
Sekce má v 9.1 tři skupiny [B1]:

| Skupina | Blueprinty | Definuje fyzickou topologii? |
|---|---|---|
| **Infrastructure Modernization** [B2] | 5× VCF Fleet (Minimal Footprint, Single Site, Multiple Sites in a Single Region, Multiple Sites Across Multiple Regions, Multiple Sites in a Single Region plus Additional Region(s)); Fleet Management; Monitoring and Alerting; Troubleshooting; 3× VCF Edge (Single Node with Argo CD, Government and Defense, Manufacturing) | **ano** u 5 fleet blueprintů a 3 Edge blueprintů; ne u Fleet Mgmt / Monitoring / Troubleshooting |
| **Application Modernization** [B32] | Self-Service Multi-Tenant Private Cloud Consumption; vSphere Kubernetes Service Consumption; Private AI Services Consumption | ne (Private AI „is intended to be used in conjunction with an underlying infrastructure blueprint“) |
| **Security Modernization** [B33] | Lateral Security with vDefend; VCF Component Backup and Restore; VCF Instance Backup and Restore; VCF Fleet Disaster Recovery; Cyber Recovery for VMware Cloud Foundation | částečně – Fleet DR a Cyber Recovery vyžadují **druhou VCF Instance / lokalitu** |

Stránka Infrastructure Modernization skupinuje blueprinty podle cíle *(parafráze)* [B2]:
1. „Build and Deploy Private Cloud Infrastructure On-Premises“ – 5 fleet blueprintů,
2. „Optimize Infrastructure and Operations“ – Fleet Management, Monitoring and Alerting, Troubleshooting,
3. „Extend Data Center to the Edge, Public, and Sovereign Clouds“ – 3 Edge blueprinty.

Infrastrukturní blueprinty jsou „starting points for the initial deployment“ – pokrývají buď jen management domain,
nebo management domain + první workload domain; rozšiřování je omezeno jen Configuration Maximums *(parafráze)* [B2].

**Klíčová vazba na fleet deployment modely** – stránka VCF Fleet Deployment Models (9.1), odstavec „Infrastructure
Blueprint Selection“: „This fleet design corresponds with the following infrastructure blueprint(s) for
implementation:“ [B21]

| Fleet deployment model [B21] | Infrastrukturní blueprint(y) |
|---|---|
| Basic | VCF Fleet in a Single Site with Minimal Footprint; VCF Fleet in a Single Site |
| Site High Availability (Across Zones) | VCF Fleet with Multiple Sites in a Single Region |
| Disaster Recovery (Across Regions) | VCF Fleet with Multiple Sites Across Multiple Regions |
| Fault Domains and Disaster Recovery | VCF Fleet with Multiple Sites in a Single Region plus Additional Region(s) |

**[9.0]** Sekce Design 9.0 měla také „Design Blueprints for VMware Cloud Foundation“ se **stejnými pěti** fleet
blueprinty (jiné URL, např. `design/blueprints/blueprint-4.html`), ale **bez** Edge, Fleet Management, Monitoring,
Troubleshooting, Application a Security blueprintů [B41][B42]. Podstránky 9.0 blueprintů byly „Planning and
Preparation …“, „Implementation …“, „Design Elements …“; v 9.1 jsou to „Minimum Requirements …“ a „… Design
Selections“ po layerech [B43][B44][B8].

---

## 2. Komponenty a vztahy – jednotlivé blueprinty

Společná struktura stránky 9.1 fleet blueprintu [B3][B6][B8][B16][B19]:
- **Design profile** – Consumption / Availability / Isolation / Recoverability / Expansion,
- **Physical Site Configuration**,
- **Design selections** po layerech (Consumption, Operations, Security Governance and Compliance, Virtual
  Infrastructure, Physical Infrastructure), zvlášť pro management domain, workload domain a „Shared Design Selection
  between Management and Workload Domain“,
- podstránka **Minimum Requirements** (deployment model a velikost ve VCF Installeru, IP počty, DNS záznamy, bloky
  virtuálních sítí).

### 2.1 VCF Fleet in a Single Site with Minimal Footprint [B3][B4][B5]
- URL: [B3]. Fleet model: **Basic** [B21].
- Use case: „the management domain of the first VCF Instance is deployed with a minimal footprint“; „All management
  and workload components are deployed in a single vSphere cluster.“ [B3]
- Physical Site Configuration: single site, jedna VCF Instance *(parafráze)* [B3].
- Topologie: 1 site · 1 AZ · 1 VCF Instance · 1 fleet · 1 doména (management domain, workloady v ní) · 1 cluster.
- Hosty: DNS sekce „ESX: 3 Nodes“ [B4] (viz `05-design` Otevřené otázky 2).
- Design profile – Availability: „Tolerates failure of a single ESX host“, „Tolerates failure of an individual
  network path“; Isolation: hypervisor-based (logical), tenant/tenant [B3].
- Recoverability: blueprinty VCF Component Backup and Restore a VCF Instance Backup and Restore [B3].
- Design selections [B3][B5]:
  - Consumption: Simple VCF Automation; Single Management Zone with Combined Workload Zones; Simple vSphere Supervisor
    Control Plane; **Tenancy Deployment Model 1** (Consolidated Management and Organization Workloads in a VCF
    Instance); Virtual Network Appliance Load Balancer.
  - Operations: Simple VCF Operations; VCF Management Services in the First VCF Instance; Simple VCF Management
    Services; Single License Server; Simple VCF Operations for Networks; Simple Log Management.
  - Security: Instance Identity Broker; VCF Fleet-Wide Single Sign-On.
  - Virtual Infrastructure: Management Domain Model; VCF Management Shared VLAN Network; vCenter; ESX; **Single-Rack
    vSphere Cluster**; **Single Distributed Switch**; **Single-Rack vSAN ESA Storage**; **Simple NSX Manager**.
  - Physical Infrastructure: **Single-Rack Network Fabric**.
- VCF Installer: deployment model „Simple“, velikost „Small“ [B4] (viz `05-design` 2.7).
- **[9.0]** [B43]: Embedded VCF Identity Broker (ve vCenter management domain); Host Fault Tolerant NSX Edge Cluster;
  volitelný **druhý cluster** jen pro VCF Automation model „All Apps Organization“. Recoverability: „This blueprint is
  not well suited for adding a disaster recovery solution.“

### 2.2 VCF Fleet in a Single Site [B6][B7]
- URL: [B6]. Fleet model: **Basic** [B21].
- Use case: management domain první instance „deployed with high availability for management components“, workloady
  „isolated to a separate workload domain“ [B6]. „All components are located within a single data center and a single
  availability zone.“ [B2]
- Physical Site Configuration: „Single Site (Single instance)“ *(parafráze)* [B6].
- Topologie: 1 site · 1 AZ · 1 VCF Instance · 1 fleet · management domain + 1 workload domain.
- Hosty: DNS sekce „ESX: 4 nodes“ (stránka nerozlišuje mgmt / WLD) [B7].
- Design profile – Availability: single ESX host, single network path, **single rack**, single management component;
  Isolation navíc cluster-based (physical) a network traffic type *(parafráze)* [B6].
- Recoverability: Component Backup and Restore, Instance Backup and Restore [B6].
- Design selections [B6]:
  - Mgmt Consumption: HA VCF Automation; Tenancy Deployment Model 2 (Shared Workload Domain for Multiple Organizations).
  - Mgmt Operations: HA VCF Operations; Management Services in the First VCF Instance; HA VCF Management Services;
    Single License Server; HA VCF Operations for Networks; HA Log Management.
  - Mgmt Security: Instance Identity Broker; VCF Fleet Level Single Sign On.
  - Mgmt Virtual Infra: Management Domain Model; VCF Management Shared VLAN Network.
  - WLD Consumption: Single Management Zone with Combined Workload Zones; HA vSphere Supervisor Control Plane; Virtual
    Network Appliance LB; Multi Tenancy Consumption Pattern 2.
  - WLD Virtual Infra: Workload Domain Model; Host Fault Tolerant NSX Edge Cluster.
  - Shared: vCenter; ESX; **Single-Rack vSphere Cluster**; **Storage Separation Distributed Switch**; **Single-Rack vSAN
    ESA**; **HA NSX Manager**; Physical: **Single-Rack Network Fabric**.
- VCF Installer: deployment model „High Availability“, velikost „Medium“ [B7].

### 2.3 VCF Fleet with Multiple Sites in a Single Region [B8]–[B15]
- URL: [B8]. Fleet model: **Site High Availability (Across Zones)** [B21].
- Use case: HA management, workloady v samostatné WLD, „stretched clusters are used to increase availability across
  sites“ *(parafráze)* [B8][B2].
- Physical Site Configuration: „Multiple sites within a single region (single instance, stretched cluster between the
  sites for maximum availability).“ [B8]
- Topologie: 1 region · **2 AZ** (data sites) + **třetí nezávislá lokalita pro vSAN witness** · **1 VCF Instance** ·
  1 fleet · management domain + WLD, obě na **stretched** clusteru.
  - Stretched cluster může být „two distinct data centers in a metro distance“ nebo dvě data hall v jednom velkém DC
    *(parafráze)* [B11].
  - „Up to two AZs can be associated with a given stretched vSphere cluster.“ *(parafráze)* [B10]
- Hosty: Minimum Requirements – DNS „AZ 1 ESX: 4 nodes“, „AZ 2 ESX: 4 nodes“ [B9] → 8 celkem *(odvozeno)*.
  Stretched vSAN model: management domain initial cluster „Minimum of eight (8) nodes“ pro HA; stretch je Day-2 a
  vyžaduje 4 další hosty ve druhé AZ *(parafráze)*; WLD cluster „Minimum of six (6) nodes“ (3 na site); obě AZ „an
  equal number of ESX hosts“ (VCF-VSAN-SC-REQD-CFG-001) [B11].
- Witness: VCF-VSAN-SC-REQD-CFG-009 – umístit „not co-located to the ESX hosts in any of the availability zones“;
  třetí site „must not have a logical or physical dependency on either availability zone“ *(parafráze)*. Witness je
  appliance (ESX v OVA), architektura musí odpovídat ESA/OSA (CFG-010) [B11].
- Design profile – Availability: single ESX host, network path, rack, management component, **availability zone**
  [B8]. Recoverability: Component / Instance Backup and Restore [B8].
- Design selections [B8]:
  - Mgmt: HA VCF Automation; Tenancy Model 2; HA VCF Operations („three-node analytics cluster and a single cloud
    proxy“, druhá cloud proxy v collector group doporučena *(parafráze)*); Management Services in the First VCF
    Instance; HA VCF Management Services; Single License Server; HA Ops for Networks; HA Log Management; Instance
    Identity Broker; **VCF Fleet-Wide Single Sign-On** (jeden identity broker pro celou fleet, VCF-SSO-REQD-VFL-001
    [B15]); Management Domain Model; Shared VLAN Network Model.
  - WLD: Single Management Zone with Combined Workload Zones; HA Supervisor Control Plane; Virtual Network Appliance LB;
    Multi-Tenancy Consumption Pattern 2; Workload Domain Model; **Dual Availability Zone Design Based on NSX Edge Node
    HA** [B13].
  - Shared: vCenter; ESX; **Stretched vSphere Cluster**; **Storage Separation Distributed Switch**; **Stretched vSAN
    Storage**; HA NSX Manager; Physical: **Multi Availability Zone Network Fabric** [B8].
- VCF Installer: „High Availability“, „Medium“ [B9].
- Stretch management domain je **Day 2** (bring-up proběhne v AZ1, pak se cluster rozšíří do AZ2) [B11] a
  `05-design` 3 [D5]. Stretched management domain je prerekvizitou stretched clusteru ve WLD *(parafráze)* [B10].
- NSX Edge (Dual AZ) [B13]: VCF-NSX-EDGE-REQD-DAZEHA-001 – „two (2) or more NSX Edge nodes“ v Edge clusteru;
  doporučen dedikovaný vSphere cluster pro Edge per AZ (RCMD-COMDAZ-001/008); Edge sítě se **nestretchují** („Limit
  the span of NSX Edge node networks to the local rack“, RCMD-DAZEHA-001); BGP peering jen na lokální ToR; primární AZ
  preferována (AS-path prepend, VCF-NSX-BGP-REQD-DAZEHA-001/002, jen routing option B) *(parafráze)*.
- **[9.0]** [B44]: management komponenty v první AZ (active/standby), WLD stretched cluster active/active nebo
  active/standby; Supervisor NSX Load Balancer; VPC with Full Services; Appliance-based Identity Broker; podstránky
  Planning / Implementation / Design Elements. Recoverability 9.0: „Can provide recovery to the second site in the
  event of a single site loss.“

### 2.4 VCF Fleet with Multiple Sites Across Multiple Regions [B16][B17][B18]
- URL: [B16]. Fleet model: **Disaster Recovery (Across Regions)** [B21].
- Use case: HA management první instance, workloady v WLD, „Multiple sites exist in different regions“ [B16].
- Physical Site Configuration: „Multiple sites (across multiple regions)“ [B16].
- Topologie podle Minimum Requirements: **Region 1** a **Region 2**, každý se svou **VCF Instance** (vlastní vCenter,
  SDDC Manager, NSX Manager) v **jedné fleet** (VCF Operations a fleet komponenty jen v Region 1, v Region 2 jen
  cloud proxy a instance-level management services) [B17]. Žádné stretched clustery – všude Single-Rack [B16].
- Hosty: Region 1 „ESX: 4 nodes“, Region 2 „ESX: 4 nodes“ [B17].
- Další instance: „a VCF management services cluster with instance level components for managing that instance
  only“ [B16]. Komponenty: VCF services runtime, SDDC lifecycle, telemetry, Salt master, identity broker, software
  depot, real-time metrics (poslední tři Day-N *(parafráze, nejisté)*); VCF-MS-REQD-ADTL-001/002 – DNS záznamy před
  nasazením [B18].
- Design profile – Availability: single ESX host, single rack, **vSphere cluster**, single management component (bez
  AZ) [B16]. Recoverability: Component Backup, Instance Backup **a VCF Fleet Disaster Recovery** [B16].
- Design selections [B16]:
  - Mgmt: HA VCF Automation; Tenancy Model 2; HA VCF Operations; Management Services in the First VCF Instance **a**
    in an Additional VCF Instance; HA VCF Management Services; Single License Server; HA Ops for Networks; HA Log
    Management; Identity Broker Model; **VCF Fleet-Wide Single Sign-On**; Management Domain Model; Shared VLAN.
  - WLD: Single Management Zone with Combined Workload Zones; HA Supervisor Control Plane; Virtual Network Appliance LB;
    **Multi-Tenancy Consumption Pattern 5** (Multi-Region, Multi-Tenant Resource Isolation with Dedicated and Shared
    Gateways); Workload Domain Model; Host Fault Tolerant NSX Edge Cluster.
  - Shared: vCenter; ESX; **Single-Rack vSphere Cluster**; **Workload Separation Distributed Switch**; Single-Rack vSAN
    ESA; HA NSX Manager; Physical: **Single-Rack Network Fabric**.
- VCF Installer: „High Availability“, „Medium“ [B17].
- VMware Live Recovery / Protection and Recovery stránka blueprintu nezmiňuje; DR řeší samostatný blueprint VCF Fleet
  Disaster Recovery (2.9) [B16][B37]. Fleet model DR uvádí: „this architecture uses VMware Live Recovery to enable
  seamless failover and failback“ [B21].
- **[9.0]** [B45]: dva VDS (mgmt/vMotion/storage + NSX), standalone Identity Broker appliance, Tier-0 active/standby;
  recovery do druhé site vyžaduje doplňkové replikační řešení, které blueprint nepokrývá.

### 2.5 VCF Fleet with Multiple Sites in a Single Region plus Additional Region(s) [B19][B20]
- URL: [B19]. Fleet model: **Fault Domains and Disaster Recovery** [B21].
- Use case: „Multiple sites exist, where some sites co-exist in the same region, and other site(s) exist in a
  different region.“ [B19]
- Topologie: **Region 1 = 2 AZ se stretched clustery** (jako 2.3) + **Region 2 = samostatná VCF Instance, Single-Rack**
  (jako 2.4); 1 fleet [B19][B20]. Witness pro stretched vSAN v Region 1 platí jako v 2.3 [B11].
- Hosty: Region 1 AZ1 4, Region 1 AZ2 4, Region 2 4 [B20] → 12 celkem *(odvozeno)*.
- Design profile – Availability: host, network path, rack, management component, availability zone.
  Recoverability: „Can provide recovery within a region for single site loss“ – vyžaduje dostatečnou externí
  konektivitu a compute v obou sites *(parafráze)*; blueprinty Component Backup, Instance Backup, Fleet DR [B19].
- Design selections [B19]:
  - Mgmt: jako 2.4, ale Security **High Availability VCF Identity Broker** + **Single VCF Instance Single Sign-On**
    (vlastní identity broker per instance, SSO jen v rámci instance) *(parafráze)*.
  - WLD: jako 2.4 (Pattern 5), ale Edge model **Dual Availability Zone Design Based on NSX Edge Node HA**.
  - Shared **Region A**: vCenter; ESX; **Stretched vSphere Cluster**; **Stretched vSAN**; Storage Separation VDS; HA NSX
    Manager; **Multi Availability Zone Network Fabric**.
  - Shared **Region B**: vCenter; ESX; **Single-Rack vSphere Cluster**; Workload Separation VDS; Single-Rack vSAN ESA;
    HA NSX Manager; **Single-Rack Network Fabric**.
- VCF Installer: „High Availability“, „Medium“ [B20].
- Stránka obsahuje nekonzistence odkazů (titulek Pattern 5 vede na slug „pattern-2“; Stretched vSAN a Storage
  Separation VDS mají prohozené slugy) *(parafráze)* [B19].

### 2.6 VCF Edge: Single Node with Argo CD [B25]
- Use case: geograficky rozptýlené lokality (pobočky, továrny, prodejny, taktický edge) s **přerušovaným WAN**, GitOps
  „pull“ model (Argo CD) *(parafráze)* [B25].
- Topologie: centrální **management domain** (vCenter, VCF Operations) v centrálním DC nebo blíž edge; „SDDC Manager and
  NSX manager are not required for the one node architecture.“; „Each edge site is represented by a single vSphere
  Cluster.“ – 1 host, vSphere Supervisor, 1 Supervisor zone; „Even with a single node edge, each host must be a member
  of a single node vSphere cluster.“ [B25]
- Automatické vytvoření single-host WLD přes VCF Operations není k dispozici, přidání hosta je ruční *(parafráze)* [B25].
- Žádná redundance: „there is no redundancy at the physical infrastructure layer.“ Lokální storage VMFS6 na HW RAID
  (RAID 1 při 2 discích), nebo NFS / FC [B25].
- Management domain sizing: 2 hosty s externím storage (NFS/FC), 3 hosty pro vSAN *(parafráze)* [B25].

### 2.7 VCF Edge Design Blueprint for Government and Defense Use Case [B26][B27][B28][B29]
- Use case: federální / obranné nasazení, konektivita „may be intermittent, degraded, or fully disconnected“ [B26].
- Design options [B27]:
  1. **Central Management with Remote Edge Hosts and Intermittent Connectivity** [B28] – centrální management
     komponenty, každá edge site = 1 vSphere cluster („Single-Node or Multi-Node ESX hosts with DRS and HA enabled“),
     vSphere Supervisor, Argo CD.
  2. **Local Management with Multiple Hosts** [B29] – „air-gapped architecture that is designed for total
     self-sufficiency“, „three or more hosts“, management (vCenter, příp. NSX) běží na edge clusteru, vSAN OSA/ESA;
     VCF Operations a fleet management „may run local to the cluster or remotely“.
- Stránka Design Options mluví o „three options“, ale vypisuje dvě [B27] (Otevřené otázky).

### 2.8 VCF Edge Design Blueprint for Manufacturing Use Case [B30][B31]
- Use case: IT/OT konvergence ve výrobě, real-time a non-real-time workloady „can coexist within the same VCF workload
  domain“ [B30].
- Design option „Core vPLC Design Leveraging VCF 9“: „The typical architectural approach involves creating a separate
  Workload Domain for each location.“ Každá doména „generally comprises two clusters“ (real-time vPLC / non-real-time)
  *(parafráze)*; síť PRP „needs two distinct LAN Fabrics“ (LAN A, LAN B) [B31]. VDI option „for context only“ [B31].

### 2.9 VCF Fleet Disaster Recovery (Security Modernization) [B37][B38][B39]
- Use case: výpadek VCF Instance nebo site; obnova fleet komponent „in another location“, „typically outside metro
  radius“ [B37][B33].
- Topologie: **dvě VCF Instance** ve stejné fleet – protected a recovery [B37][B38][B39].
- Komponenty a metoda obnovy [B37]:

| Komponenta | Metoda | IP mobility |
|---|---|---|
| VCF Operations, VCF Operations for networks | replikace Protection and Recovery + recovery plan (nebo image-based backup) | **Required** |
| VCF Automation | nová instance na recovery site + restore z backupu | Not required |
| VCF management services (identity broker, fleet lifecycle, software depot, Salt RaaS, log management) | restore do existující instance management services na recovery site | Not required |
| VCF License Server | nezálohuje se; redeploy jen při failoveru delším než 90 dní | – |

  „Cloud Proxies in each VCF Instance are not replicated.“ [B37]
- Design elements [B38]: Protection and Recovery instance v obou instancích (VCF-PB-DR-REQD-001) v **management
  domain** (REQD-002), velikost „Light“ (REQD-003; „Two protection groups“, „Two recovery plans“), na VM management
  network (REQD-004), statická IP + A/PTR (REQD-005/006); replikace **vSphere Replication** (REQD-013, implikace „All
  management components must be in the same cluster.“); **RPO 15 min** (REQD-017), 3 kopie za 24 h (REQD-018), **RTO
  ≤ 4 h** (REQD-014 *(parafráze)*); dedikovaný portgroup, VLAN a VMkernel pro replikační provoz (REQD-008/009/010/011);
  DNS ve všech instancích (REQD-021/022); backup lokace pro obě instance, stejný SFTP nebo replikace backupů
  (REQD-023/024).

### 2.10 Ostatní blueprinty (bez fyzické topologie)
| Blueprint | Obsah | Zdroj |
|---|---|---|
| VCF Fleet Management | governance ve VCF Operations: IAM, certifikáty, hesla, configuration management, tagy; topologii nedefinuje | [B22] |
| VCF Monitoring and Alerting | real-time metrics, log management, VCF Operations for networks; dashboardy, alerty | [B23] |
| VCF Troubleshooting | incident management, scénáře „scope, analyze, and resolve an issue“ | [B24] |
| Self-Service Multi-Tenant / VKS / Private AI Consumption | consumption vrstva; Private AI staví na infrastrukturním blueprintu (nejmenuje kterém) | [B32] |
| Lateral Security with vDefend | Distributed Firewall, Security Services Platform; NSX Manager management domain může v 9.1 sloužit i WLD | [B34] |
| VCF Component Backup and Restore | externí SFTP per instance (VCF-BCK-REQD-SDDC-001), HA SFTP **v jiné AZ** (VCF-BCK-RCMD-SFTP-001), replikace backupů do jiné site pro fleet DR (VCF-BCK-REQD-SFTP-004), denní backup vCenter / SDDC Manager / NSX (RPO ≤ 24 h), dedikovaná backup VLAN (RCMD-NET-001) | [B35] |
| VCF Instance Backup and Restore | obnova celé instance „must be recovered in the same site“; jen workload domény v jedné AZ; ESX se reinstaluje | [B36] |
| Cyber Recovery for VCF | 2 VCF Instance (protected + recovery s clean room), 2 management domains, 1 protected WLD a 1 recovery WLD; clean room WLD: vSAN compute cluster + vSAN ESA storage cluster + host FT NSX Edge cluster; izolace vDefend Firewall **[9.1.0]** / vDefend nebo NSX VPC **[9.1.1]** | [B40] |

---

## 3. Prerekvizity

| Blueprint | Musí platit | Zdroj |
|---|---|---|
| Minimal Footprint | 3 ESX hosty v jednom racku; VCF Installer Simple / Small | [B4] |
| Single Site | 4 ESX hosty; VCF Installer HA / Medium; 1 AZ | [B7] |
| Multiple Sites in a Single Region | 2 AZ se **stejným** počtem hostů (4 + 4 v min. požadavcích); třetí nezávislá witness site; inter-AZ RTT < 5 ms a ≥ 10 Gb; stretched L2 pro management VLAN; HA first-hop gateway mezi AZ; management domain se stretchne až Day 2 | [B9][B10][B11][B12] |
| Across Multiple Regions | druhá VCF Instance (4 hosty) se svým vCenter / SDDC Manager / NSX; DNS záznamy additional instance před nasazením (VCF-MS-REQD-ADTL-001/002) | [B17][B18] |
| Single Region plus Additional Region(s) | kombinace dvou předchozích řádků | [B20] |
| Fleet DR | druhá VCF Instance; Protection and Recovery v obou; všechny management komponenty v jednom clusteru; IP mobility pro VCF Operations / Ops for networks; sdílené DNS a NTP | [B37][B38] |
| Site HA obecně | „low-latency, high-bandwidth network connectivity between zones“, „Witness node for split-brain avoidance“, IP adresy stretchnuté mezi zónami | [B21] |
| DR obecně | „Network latency and bandwidth between the primary and secondary sites must meet VMware's requirements“ | [B21] |
| Edge (central mgmt) | WAN mezi vCenter a ESX ≤ 300 ms RTT, ≥ 10 Mbps | [B25][B28] |

---

## 4. Workflow – výběr a realizace blueprintu

Dokumentace dává **výběr** přes fleet deployment model (tabulka v 1, [B21]) a skupiny cílů [B2]. Navržený postup
(složení doložených kroků; samotné pořadí je **návrh pro hru**):
1. Zvolit fleet deployment model (Basic / Site HA / DR / Fault Domains and DR) → odpovídající blueprint [B21].
2. Přečíst Minimum Requirements blueprintu: deployment model + velikost pro VCF Installer, počty hostů (DNS), IP
   počty, DNS záznamy, bloky virtuálních sítí [B4][B7][B9][B17][B20].
3. Připravit infrastrukturu podle `10-planning` (DNS, IP, VLAN, MTU; u 2 AZ Multi-AZ Network Fabric [B12]).
4. Bring-up první VCF Instance VCF Installerem (`20-deployment`) – u Site HA **v AZ1** [B11].
5. Day 2 podle blueprintu:
   - Site HA: přidat 4 hosty v AZ2 a stretchnout management cluster (witness ve 3. site), pak stretched WLD [B10][B11].
   - DR / multi-region: nasadit **další VCF Instance** (Region 2) s instance-level management services [B18].
   - Workload domain(s) a NSX Edge cluster podle WLD selections.
6. Ochrana: Component Backup (SFTP) → u DR modelů Fleet DR (Protection and Recovery, vSphere Replication) [B35][B38].
7. Expanze („Expansion after Infrastructure Blueprint Deployment“) [B2]: přidat hosty do clusteru (stejná konfigurace
   hostů); přidat cluster do domény (failover a balancing se mezi clustery nepřenáší); přidat WLD (vlastní vCenter);
   přidat VCF Instance (sdílí VCF Operations a VCF Automation); „Add Interconnected Site“ ve stejném nebo jiném regionu.

UI: blueprinty jsou dokumentační šablony, ne volba v produktu. Volby se realizují ve VCF Installeru (deployment
model, velikost) a ve VCF Operations (Day 2) – viz `20-deployment`, `05-design` 4.

---

## 5. Chybové stavy

Blueprinty samy hlášky nedefinují. Pro hru relevantní důsledky porušení podmínek blueprintu:

| Situace | Důsledek podle dokumentace | Zdroj |
|---|---|---|
| Nestejný počet hostů v AZ1 a AZ2 | porušení VCF-VSAN-SC-REQD-CFG-001 | [B11] |
| Witness ve stejné lokalitě jako hosty AZ | porušení VCF-VSAN-SC-REQD-CFG-009 | [B11] |
| Inter-AZ RTT ≥ 5 ms nebo < 10 Gb | porušení VCF-VSAN-SC-REQD-CFG-002 / -004 | [B11] |
| Witness RTT > 200 ms | porušení VCF-VSAN-SC-REQD-CFG-003 | [B11] |
| WLD stretched cluster bez stretched management domain | nelze – management domain musí být stretched dřív *(parafráze)* | [B10] |
| Pokus stretchnout management při bring-upu | stretch je Day 2 | [B11][D5 v `05`] |
| Výpadek AZ v Basic (1 AZ) | „Any failure at the availability zone or region level could result in downtime for the entire VCF fleet.“ (z `05-design` 4.1) | [B21] |
| Výpadek site v Minimal Footprint / Single Site | jen restore z backupu; Instance Backup obnovuje „in the same site“ | [B36] |
| Výpadek identity brokeru ve Fleet-Wide SSO | „An outage to the identity broker service impacts the VCF fleet.“ | [B15] |
| Výpadek WAN u Edge (push model) | „if the WAN link is down, the configuration update fails“ | [B25] |
| Fleet DR, failover > 90 dní | nutný redeploy License Serveru | [B37] |

---

## 6. Limity a čísla

### 6.1 Hosty, deployment model, velikost
| Blueprint | Hosty (DNS v Minimum Requirements) | VCF Installer | Zdroj |
|---|---|---|---|
| Minimal Footprint | 3 | Simple / Small | [B4] |
| Single Site | 4 | HA / Medium | [B7] |
| Multi-Site Single Region | AZ1 4 + AZ2 4 | HA / Medium | [B9] |
| Across Multiple Regions | Region 1 4 + Region 2 4 | HA / Medium | [B17] |
| Single Region + Additional Region | R1 AZ1 4 + R1 AZ2 4 + R2 4 | HA / Medium | [B20] |
| Stretched vSAN – mgmt initial cluster (HA) | min. 8 | – | [B11] |
| Stretched vSAN – WLD cluster | min. 6 (3 / site) | – | [B11] |
| Stretched vSAN ESA uzel | ≥ 16 jader, ≥ 128 GB RAM, disky ≥ 1.6 TB; doporučeno ≥ 4 uzly | – | [B11] |
| Edge single node | 1 host / site; mgmt domain 2 (NFS/FC) nebo 3 (vSAN) | – | [B25] |
| Edge Local Management | ≥ 3 hosty | – | [B29] |
| Dual AZ NSX Edge | ≥ 2 Edge nody v Edge clusteru | – | [B13] |

### 6.2 IP adresy (Physical Network IP Requirements)
| Síť | Minimal [B4] | Single Site [B7] | Multi-Site 1 region (AZ1 / AZ2) [B9] | Multi-region (R1 / R2) [B17] | +Additional (R1 AZ1 / AZ2 / R2) [B20] |
|---|---|---|---|---|---|
| ESX Management | 3 | 4 | 4 / 4 | 4 / 4 | 4 / 4 / 4 |
| VM Management | 24 | 35 | 35 (jen AZ1) | 35 / 15 | 35 (region 1) / 15 |
| vMotion | 3 | 4 | 4 / 4 | 4 / 4 | 4 / 4 / 4 |
| vSAN | 3 | 4 | 4 / 4 | 4 / 4 | 4 / 4 / 4 |
| Host TEP | 6 | 8 | 8 / 8 | 8 / 8 | 8 / 8 / 8 |
| Edge TEP (volitelně) | 4 | 4 | 4 (AZ1) | 4 / 4 | 4 (R1) / 4 |
| Edge Uplink (volitelně) | 2 | 2 ¹ | 2 (AZ1) | 2 / 2 | 2 (R1) / 2 |

¹ Single Site: hodnota 2, poznámka „2 IPs per Edge VM, x2 Edge VMs“ – nekonzistentní [B7].
Bloky virtuálních sítí (všechny HA blueprinty): vSphere Supervisor Service CIDR (příklad 10.96.0.0/23), VPC Private IP
Block, Distributed Transit Gateway Private IP Block, External IP Block, Private VPC Block a Private TGW IP Block per
organizace [B7][B9][B17][B20].

### 6.3 DNS záznamy (HA blueprinty, první instance) [B7][B9][B17][B20]
vCenter; ESX (podle počtu); SDDC Manager; NSX Manager VIP + Node A/B/C; VCF Operations Primary, Replica, Data, Cloud
Proxy (Single Site navíc „(Optional) VIP“); VCF Management Services: VCF Services Runtime, VCF Management Instance
Service, VCF Fleet Component; VCF Automation; VCF Service Runtime for VCF Automation; License Server; Identity Broker;
Log Management; VCF Operations for Networks Platform 1–3 + Collector.
**Další instance (Region 2)**: vCenter; ESX 4; SDDC Manager; NSX Manager VIP + 3 nody; VCF Operations Cloud Proxy;
VCF Management Services: VCF Services Runtime, VCF Management Instance Service [B17][B20].

### 6.4 Síťové limity mezi lokalitami
| Spoj | Požadavek | Zdroj |
|---|---|---|
| AZ1 ↔ AZ2 (vSAN stretched) | RTT < 5 ms (2.5 ms one way), ≥ 10 GbE | [B11] (VCF-VSAN-SC-REQD-CFG-002/004), [B10] |
| Data sites ↔ witness | RTT ≤ 200 ms (100 ms one way); bandwidth bez minima, podle počtu VM | [B11] (CFG-003/005) |
| Stretched NFS / FC (vMSC) | určit se storage vendorem | [B10] |
| Region 1 ↔ Region 2 (DR) | „must meet VMware's requirements“ – čísla neuvedena | [B21] |
| Central ↔ Edge | ≤ 300 ms RTT vCenter–ESX, ≥ 10 Mbps, doporučen primární + sekundární WAN | [B25][B28] |
| Fleet DR replikace | RPO 15 min, RTO ≤ 4 h (management komponenty) | [B38] |

MTU pro Multi-AZ fabric (min / preferované) [B12]: management VM 1500/9000; ESX management 1500; IP storage 9000;
Host TEP 1700; Edge TEP 1700; Edge RTEP 1500; Edge uplink 1700; workload VLAN 1500/9000.

---

## 7. Síťový provoz

| # | Blueprint | Tok (odkud → kam) | Síť / typ | Zdroj |
|---|---|---|---|---|
| 1 | Všechny | management komponenty ↔ hosty v rámci site | VM management (Shared VLAN model) | [B3][B6] |
| 2 | Multi-Site 1 region | vSAN synchronní replikace AZ1 ↔ AZ2 | vSAN VMkernel, **routovaná** mezi AZ (per-AZ subnety, VCF-CLS-REQD-CFG-005 override gateway) | [B10][B12] |
| 3 | Multi-Site 1 region | hosty AZ1 i AZ2 → vSAN witness (3. site) | witness traffic (doporučeno přes vmk0, L3, nezávislé cesty z každé AZ) | [B11][B12] |
| 4 | Multi-Site 1 region | management VM, Edge management, workload VLAN – **stretched L2** mezi AZ s HA first-hop gateway (HSRP / VRRP / AnyCast) | L2 stretch přes DCI | [B12] |
| 5 | Multi-Site 1 region | ESX mgmt, vMotion, IP storage, Host TEP – **AZ-local** subnety, routované mezi AZ (Host TEP pool per AZ) | L3 | [B10][B12] |
| 6 | Multi-Site 1 region | north-south přes Edge v primární AZ; sekundární AZ jen při ztrátě BGP sousedů v primární | BGP k lokálním ToR | [B13] |
| 7 | Multi-region / +Additional | VCF Operations (Region 1) ↔ cloud proxy a management services Region 2; fleet lifecycle → SDDC lifecycle v další instanci | management WAN mezi instancemi | [B17][B18] |
| 8 | Multi-region s Fleet-Wide SSO | přihlášení v Region 2 → identity broker v první instanci | management / auth | [B15][B16] |
| 9 | Fleet DR | vSphere Replication VCF Operations VM protected → recovery instance | dedikovaná VLAN + VMkernel, komprese | [B38] |
| 10 | Component Backup | komponenty → externí SFTP (příp. replikace backupů do jiné site) | dedikovaná backup VLAN doporučena | [B35] |
| 11 | Edge | vCenter (centrála) ↔ ESX na edge; Git / registry pull | WAN, ≤ 300 ms, ≥ 10 Mbps | [B25] |

Porty: blueprinty je neuvádějí (kromě log forwarding cfapi 9543 u Protection and Recovery [B38]); viz
`00-architektura` 7, `10-planning` 7.

---

## 7a. Mapování „Blueprint → herní lokalita“

Herní volby lokality (CLAUDE.md, „Výběr lokality na startu“): 1 malá místnost · 2 větší místnost · 3 dvě místnosti
v jedné budově · 4 dvě budovy (kampus) · 5 vzdálená lokalita pro DR. Vzdálenosti a latence jsou **herní hodnoty**;
níže jsou jen **dokumentované podmínky**, které musí engine vynutit.

| Blueprint (fleet model) | Navržená herní lokalita | Co musí hra vynutit (jen z dokumentace) |
|---|---|---|
| Minimal Footprint (Basic) | **1 – malá místnost** (1 rack) | 1 site, 1 AZ, 1 instance; Single-Rack cluster, 1 cluster pro management i workloady; 3 hosty; Simple / Small [B3][B4] |
| Single Site (Basic) | **2 – větší místnost** (víc racků) | 1 site, 1 AZ; management domain + samostatná WLD; Single-Rack clustery; 4 hosty (min. požadavky); HA / Medium [B6][B7] |
| Multiple Sites in a Single Region (Site HA) | **3 – dvě místnosti v jedné budově** nebo **4 – dvě budovy (kampus)** | 2 AZ, 1 instance; dokumentace připouští obojí: „two distinct data centers in a metro distance“ i dvě data hall v jednom DC [B11]. RTT mezi AZ < 5 ms a ≥ 10 GbE [B11]; stejný počet hostů v AZ [B11]; **witness ve 3. lokalitě** nezávislé na obou AZ, RTT ≤ 200 ms [B11]; stretched L2 jen pro management/edge-mgmt/workload VLAN, HA first-hop gateway [B12]; mgmt stretch až Day 2 (+4 hosty v AZ2) [B11] |
| Multiple Sites Across Multiple Regions (DR) | **1 nebo 2 + 5 – vzdálená lokalita** | 2 regiony, 2 VCF Instance v 1 fleet; každý region 4 hosty, Single-Rack; Region 2 bez VCF Operations (jen cloud proxy) [B17]; latence/bandwidth „must meet VMware's requirements“ (čísla neuvedena) [B21]; Fleet DR: recovery „typically outside metro radius“ [B37] |
| Single Region plus Additional Region(s) (Fault Domains and DR) | **3 nebo 4 + 5** | kombinace dvou řádků výše: Region 1 = 2 AZ stretched + witness, Region 2 = samostatná instance [B19][B20] |
| VCF Fleet DR (Security) | **5** jako recovery site k libovolné lokalitě | druhá VCF Instance, Protection and Recovery v obou management doménách, RPO 15 min / RTO ≤ 4 h [B38] |
| VCF Edge blueprinty | (zatím žádná volba – kandidát „pobočka“) | 1 host / edge cluster (single node) nebo ≥ 3 (local mgmt); ≤ 300 ms RTT, ≥ 10 Mbps k centrálnímu vCenter [B25][B28][B29] |

Důsledky pro herní lokality:
- Pro lokality 3 a 4 hra potřebuje **třetí místo pro vSAN witness** (nesmí být v žádné z obou AZ) [B11]. Dokumentace
  neříká, jak daleko; jen nezávislost a RTT ≤ 200 ms. Herní volby 1–5 třetí místo nemají → nutné doplnit (např. malá
  „witness“ místnost / vzdálená lokalita 5 jako witness) – rozhodnutí je herní, podmínky dokumentované.
- Lokalita 3 vs. 4 se z pohledu VCF neliší – rozhoduje jen to, zda herní latence/bandwidth spoje splní < 5 ms a ≥ 10 GbE.
- Lokalita 5 sama o sobě znamená **druhou VCF Instance** (jiný region), ne stretched cluster.
- Volba 1 (malá místnost) odpovídá jedinému racku; Single Site design profile uvádí „Tolerates failure of a single
  rack“, i když volí Single-Rack cluster model [B6] – nejasné (Otevřené otázky 3); doporučujeme lokalitu 2 s víc racky.

---

## 8. Otevřené otázky

1. **Host counts vs. cluster minima**: Minimum Requirements uvádějí jen DNS počty ESX (3 / 4 / 4+4). Nerozlišují
   mgmt a WLD – Single Site (4 hosty) přitom má samostatnou WLD, pro kterou by byly potřeba další hosty [B7].
   Není jasné, zda „4 nodes“ = jen management domain.
2. **Stretched vSphere Cluster Model – tabulka minim** je v extrakci nejednoznačná (vSAN Simple 6 / HA 8) [B10];
   Stretched vSAN model říká mgmt HA min. 8 a WLD min. 6 [B11]. Viz i `10-planning` Otevřené otázky 2.
3. **Single Site „Tolerates failure of a single rack“** při Single-Rack cluster modelu [B6] – rozpor nebo chyba
   dokumentace?
4. **Latence/bandwidth mezi regiony (DR)** – blueprinty ani fleet model čísla nedávají („must meet VMware's
   requirements“ [B21]). Hledat na Ports and Protocols / Live Recovery dokumentaci.
5. **Witness site** – vzdálenost / typ lokality není definován, jen nezávislost a RTT ≤ 200 ms [B11]. Witness
   bandwidth se odkazuje na externí „vSAN Stretched Cluster Bandwidth Sizing“ [B11].
6. **Identity broker v +Additional Region** – Single VCF Instance SSO a HA Identity Broker (per instance) vs.
   Fleet-Wide SSO u Multi-Region [B16][B19]. Vychází z parafráze; ověřit na layer stránkách.
7. **Day-N komponenty additional instance** (identity broker, software depot, real-time metrics) – určeno z hvězdiček
   v tabulce a diagramu, nejisté [B18].
8. **Edge Government – „three options“** vs. dvě vypsané [B27]; podstránky Edge blueprintů (Management Component
   Design, Edge Cluster Design…) nezpracovány.
9. **Layer stránky** jednotlivých modelů v blueprintech (Consumption / Operations / Security / Virtual / Physical) jsou
   zpracované jen tam, kde byly potřeba pro topologii (Stretched vSphere, Stretched vSAN, Multi-AZ fabric, Dual AZ Edge,
   Fleet-Wide SSO, Additional Instance MS). Ostatní (Tenancy models, Supervisor, VNA LB, Pattern 2/5) nezpracovány.
10. **9.0 blueprint podstránky** (Planning and Preparation / Implementation / Design Elements) nebyly staženy – 9.0
    host counts a IP tabulky neověřeny [B43][B44][B45].
11. **RTO 4 h u Fleet DR** – ID z parafráze („REQD-014“) je u RTO i u automatizované obnovy; ověřit přesné ID [B38].
12. **Cyber Recovery** – zda recovery instance může být cloudová / on-prem, stránka neuvádí [B40].

---

## 9. Zdroje

Základ 9.1: `https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/`
(dále jen `…/9-1/design/design-blueprints-for/`); IM = `infrastructure-modernization/`.

- [B1] Design Blueprints for VMware Cloud Foundation (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for.html
- [B2] Infrastructure Modernization (9.1, vč. „Expansion after Infrastructure Blueprint Deployment“): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/infrastructure-modernization.html
- [B3] VCF Fleet in a Single Site with Minimal Footprint: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/infrastructure-modernization/vcf-fleet-in-a-single-site-with-minimal-footprint-blueprint.html
- [B4] Minimum Requirements – Minimal Footprint: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/infrastructure-modernization/vcf-fleet-in-a-single-site-with-minimal-footprint-blueprint/minimaltemo.html
- [B5] Management Domain Design Selections – Minimal Footprint: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/infrastructure-modernization/vcf-fleet-in-a-single-site-with-minimal-footprint-blueprint/management-domain-design-selections.html
- [B6] VCF Fleet in a Single Site: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/infrastructure-modernization/vcf-fleet-in-a-single-site-blueprint.html
- [B7] Minimum Requirements for VCF Fleet in a Single Site: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/infrastructure-modernization/vcf-fleet-in-a-single-site-blueprint/minimal-requirements-for-fleet-single-site.html
- [B8] VCF Fleet with Multiple Sites in a Single Region: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/infrastructure-modernization/vcf-fleet-with-multiple-sites-in-a-single-region-blueprint.html
- [B9] Minimum Requirements – Multiple Sites in a Single Region: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/infrastructure-modernization/vcf-fleet-with-multiple-sites-in-a-single-region-blueprint/minimal.html
- [B10] Stretched vSphere Cluster Model (blueprint Multi-Site Single Region): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/infrastructure-modernization/vcf-fleet-with-multiple-sites-in-a-single-region-blueprint/shared-design-selection-between-management-and-workload-domain/virtual-infrastructure-layer(6)/stretched-vsphere-cluster-model.html
- [B11] Stretched vSAN Storage Model (blueprint Multi-Site Single Region): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/infrastructure-modernization/vcf-fleet-with-multiple-sites-in-a-single-region-blueprint/shared-design-selection-between-management-and-workload-domain/virtual-infrastructure-layer(6)/stretched-vsan-storage-model(1).html
- [B12] Multi Availability Zone Network Fabric Model: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/infrastructure-modernization/vcf-fleet-with-multiple-sites-in-a-single-region-blueprint/shared-design-selection-between-management-and-workload-domain/physical-infrastructure-layer(2)/multi-availability-zone-network-fabric-model.html
- [B13] Dual Availability Zone Design Based on NSX Edge Node HA Model: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/infrastructure-modernization/vcf-fleet-with-multiple-sites-in-a-single-region-blueprint/workload-domain-design-selections(1)/virtual-infrastructure-layer(5)/dual-availability-zone-design-based-on-nsx-edge-node-ha-model.html
- [B14] Management Domain Model (blueprint Multi-Site Single Region): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/infrastructure-modernization/vcf-fleet-with-multiple-sites-in-a-single-region-blueprint/management-domain-design-selections(2)/virtual-infrastructure-layer(4)/management-domain-model(1).html
- [B15] VCF Fleet-Wide Single Sign-On Model (blueprint Multi-Site Single Region): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/infrastructure-modernization/vcf-fleet-with-multiple-sites-in-a-single-region-blueprint/management-domain-design-selections(2)/security-governance-and-compliance-layer(2)/vcf-fleet-level-single-sign-on-mode.html
- [B16] VCF Fleet with Multiple Sites Across Multiple Regions: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/infrastructure-modernization/vcf-fleet-with-multiple-sites-across-multiple-regions-blueprint.html
- [B17] Minimum Requirements – Across Multiple Regions: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/infrastructure-modernization/vcf-fleet-with-multiple-sites-across-multiple-regions-blueprint/minimal-requirements-for-blueprint(3).html
- [B18] VCF Management Services in an Additional VCF Instance Model (blueprint Multi-Region): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/infrastructure-modernization/vcf-fleet-with-multiple-sites-across-multiple-regions-blueprint/management-domain-design-selections(3)/operations-layer(3)/vcf-management-services-in-an-additional-vcf-instance-model(1).html
- [B19] VCF Fleet with Multiple Sites in a Single Region plus Additional Region(s): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/infrastructure-modernization/vcf-fleet-with-multiple-sites-in-a-single-region-plus-additional-region-blueprint.html
- [B20] Minimum Requirements – Single Region plus Additional Region(s): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/infrastructure-modernization/vcf-fleet-with-multiple-sites-in-a-single-region-plus-additional-region-blueprint/minimal-requirements-for-blueprint(4).html
- [B21] VCF Fleet Deployment Models (9.1, odstavec „Infrastructure Blueprint Selection“; = [D11] v `05`): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/vmware-cloud-foundation-concepts/vcf-operations-deployment-models.html
- [B22] VCF Fleet Management Blueprint: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/infrastructure-modernization/fleet-management-blueprint.html
- [B23] VCF Monitoring and Alerting Blueprint: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/infrastructure-modernization/monitoring-and-alerting-guide.html
- [B24] VCF Troubleshooting Blueprint: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/infrastructure-modernization/troubleshooting-guide.html
- [B25] VCF Edge: Single Node with Argo CD Design Blueprint: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/infrastructure-modernization/edge.html
- [B26] VCF Edge Design Blueprint for Government and Defense Use Case: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/infrastructure-modernization/vcf-edge-design-for-federal-use-case.html
- [B27] Design Options (Government and Defense): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/infrastructure-modernization/vcf-edge-design-for-federal-use-case/design-options.html
- [B28] Central Management with Remote Edge Hosts and Intermittent Connectivity: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/infrastructure-modernization/vcf-edge-design-for-federal-use-case/design-options/central-management-with-remote-edge-hosts-and-intermittent-connectivity.html
- [B29] Local Management with Multiple Hosts: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/infrastructure-modernization/vcf-edge-design-for-federal-use-case/design-options/remote-management-with-multiple-hosts.html
- [B30] VCF Edge Design Blueprint for Manufacturing Use Case: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/infrastructure-modernization/vcf-edge-design-for-manufacturing-use-case.html
- [B31] Design Options (Manufacturing): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/infrastructure-modernization/vcf-edge-design-for-manufacturing-use-case/design-options.html
- [B32] Application Modernization: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/application-modernization.html
- [B33] Security Modernization: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/security-modernization.html
- [B34] Lateral Security with vDefend: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/security-modernization/vdefend-lateral-security.html
- [B35] Design Elements for VCF Component Backup and Restore: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/security-modernization/vcf-backup-and-restore/design-elements-for-vcf-backup-and-restore.html
- [B36] VCF Instance Backup and Restore: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/security-modernization/vcf-instance-recovery.html
- [B37] VCF Fleet Disaster Recovery (blueprint): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/security-modernization/vcf-disaster-recovery.html
- [B38] Design Elements for VCF Fleet Disaster Recovery: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/security-modernization/vcf-disaster-recovery/design-elements-for-vcf-disaster-recovery.html
- [B39] VCF Fleet Disaster Recovery (Fleet Management, implementace): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/vcf-fleet-disaster-recovery.html
- [B40] Cyber Recovery for VMware Cloud Foundation: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/security-modernization/vcf-ransomware-recovery.html
- [B41] Design (9.0): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/design.html
- [B42] Design Blueprints for VMware Cloud Foundation (9.0): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/design/blueprints.html
- [B43] VCF Fleet in a Single Site with Minimal Footprint (9.0): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/design/blueprints/vcf-fleet-basic-management-design.html
- [B44] VCF Fleet with Multiple Sites in a Single Region (9.0): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/design/blueprints/vsphere-only-to-vcf-fleet-upgrade-blueprint.html
- [B45] VCF Fleet with Multiple Sites Across Multiple Regions (9.0): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/design/blueprints/blueprint-4.html
