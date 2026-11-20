# 00 – Architektura VCF 9.x

> Modelovaná verze: **VCF 9.1.1** (viz `docs/spec/VERSION.md`). Rozdíly oproti 9.0 jsou označené **[9.0]** / **[9.1]**.
> Všechny odkazy vedou na techdocs.broadcom.com. Číslování zdrojů [S1]…[S21] odpovídá sekci 9 (Zdroje).

---

## 1. Shrnutí

VMware Cloud Foundation (VCF) 9.1 je „a private cloud platform that delivers public cloud scale and agility with
on-premises security, resilience and performance" a „a full-stack IaaS platform that delivers software-defined
compute, storage, networking, security, and management" [S3].

Objektová hierarchie (taxonomie) VCF 9.x [S1]:

```
Private Cloud
 └─ VCF Fleet (1..n)            – spravuje jedna sada fleet-level komponent (VCF Operations, VCF Automation)
     ├─ VCF Instance (1..n)
     │   ├─ Management domain (právě 1, vytvoří ji VCF Installer)
     │   └─ Workload domain (0..n, max. 40 na instanci [9.1] / 24 [9.0])
     │       └─ vSphere cluster (1..n, vSphere HA + DRS)
     │           └─ ESX host
     └─ standalone vCenter (0..n, volitelně)
```

- **Private cloud** – „The highest level of management and consumption for the underlying software-defined data
  center resources." Obsahuje jednu nebo více VCF fleet [S1].
- **VCF fleet** – prostředí spravované jednou sadou fleet-level komponent (VCF Operations a VCF Automation). „A VCF
  fleet contains one or more VCF Instances and might contain one or more standalone vCenter instances, managed by the
  VCF Operations instance for the fleet." [S1]
- **VCF Instance** – výpočetní, úložná a síťová virtuální infrastruktura pro byznysové workloady; skládá se z VCF
  domén: jedné management domain a volitelně jedné či více workload domains [S1].
- **VCF domain** – „a logical unit of application-ready infrastructure", skupina ESX hostů spravovaná jedním
  vCenterem; obsahuje jeden nebo více vSphere clusterů [S6].
- **vSphere cluster** – samostatná definice v taxonomii chybí; doména obsahuje „One or more vSphere clusters with
  vSphere HA and vSphere DRS enabled." [S1]. Cluster model se definuje per cluster a určuje maximální úroveň
  dostupnosti VM na něm [S7].

---

## 2. Komponenty a vztahy

### 2.1 Co žije na které úrovni (9.1)

| Úroveň | Komponenty | Zdroj |
|---|---|---|
| Private cloud | 1..n VCF fleet | [S1] |
| Fleet | VCF Operations, VCF Automation, 1..n VCF Instance, volitelně standalone vCenter. Fleet komponenty běží v management domain **první** VCF Instance. | [S1] |
| Instance | SDDC Manager, NSX, vCenter, ESX, VCF management services (instance-level), License server | [S1] |
| Management domain | komponenty společné všem doménám + SDDC Manager appliance + instance-level VCF management services; v **první** instanci navíc License server, VCF Operations, fleet-level VCF management services a VCF Automation | [S1] |
| Každá VCF domain | „One vCenter instance."; 1..n vSphere clusterů s HA a DRS; „At least one vSphere Distributed Switches per cluster for system traffic and NSX segments for workloads."; jeden NSX Manager (dedikovaný nebo sdílený mezi doménami); volitelně NSX Edge nebo Virtual Network Appliance clustery (přidávají se po vytvoření workload domain); 1..n sdílených storage alokací (principal/supplemental) | [S1] |

Citace k management domain [S1]: „The management domain contains the components of the VCF Instance and, in the first
VCF Instance, License server, VCF Operations, VCF management services, and VCF Automation." a „In addition to the
components that are common for each VCF domain, the management domain includes the SDDC Manager appliance that adds
workflows for infrastructure management automation to the VCF Operations instance for the VCF fleet, and VCF
management services that are working on the instance level."

V čisté (greenfield) instalaci běží management komponenty instance v prvním vSphere clusteru management domain;
v konvergovaných prostředích mohou běžet i v clusterech workload domén [S1].

V vSphere Foundation (VVF) mohou komponenty běžet na management vCenteru; v VCF běží v management domain každé VCF
Instance [S2].

### 2.2 Hlavní komponenty (tabulka „Components in VCF and vSphere Foundation", 9.1) [S2]

| Komponenta | Platforma | Popis v dokumentaci |
|---|---|---|
| VCF Operations | VCF, VVF | centrální operations platforma (odkaz na VCF Operations Overview) |
| Cloud proxy | VCF, VVF | „A part of VCF Operations." – „Collects and monitors data locally in the platform" |
| VCF Operations for networks | VCF | doplněk VCF Operations – síťová analytika |
| VCF Operations HCX | VCF | součást VCF Operations – migrace workloadů mezi vCentery/clustery |
| VCF Automation | VCF | odkaz na VCF Automation Overview |
| SDDC Manager | VCF | „A part of VCF Operations." – „Lifecycle management for ESX, vCenter, HCX, and NSX" / „Deployment of workload domains" / „Import of vCenter instances as workload domains" / „Configuration of vSAN stretched clusters" |
| NSX Manager | VCF | správa NSX sítí |
| NSX Edge | VCF | north-south konektivita do fyzické sítě, east-west, stateful služby (LB, DHCP) |
| Virtual Network Appliance | VCF | VM-based NAT a load balancer pro distributed VPC |
| vCenter | VCF, VVF | správa ESX hostů a clusterů |
| ESX | VCF, VVF | hypervisor |
| License server | VCF, VVF | „A part of VCF Operations." – „Provides secure and integrated license management for your platform." |

Pozn.: SDDC Manager je v tabulce označen jako „A part of VCF Operations" (poskytuje funkce do UI VCF Operations),
ale fyzicky jde o appliance v management domain každé instance [S1][S2].

### 2.3 VCF management services [9.1 – nové]

„VCF 9.1 introduces VCF management services to provide a unified architecture for centralized lifecycle and
operational functionalities." „Every VCF Instance has a VCF services runtime instance that hosts the instance-level
VCF management services." Runtime první instance hostí navíc fleet-level komponenty [S2]. Komponenty běží jako
worker-node workloady ve VCF services runtime (kontejnerový runtime) [S1][S2].

| Služba | Platforma | Rozsah nasazení (VCF) | Úroveň dle [S5] |
|---|---|---|---|
| Fleet lifecycle | VCF, VVF | jen první VCF Instance | fleet |
| Salt RaaS | VCF | jen první VCF Instance | fleet |
| Log management | VCF, VVF | první instance, Day-N (volitelné) | fleet |
| Identity broker | VCF | první instance; volitelně další instance (Day-N) | instance |
| Software depot | VCF, VVF | první instance; volitelně další (Day-N); „Can operate on the fleet level or optionally on an instance-level." | instance |
| Real-time metrics | VCF | každá instance, Day-N (volitelné) | instance |
| Salt Master | VCF | každá instance | instance |
| SDDC lifecycle | VCF, VVF | každá instance – instaluje/aktualizuje management komponenty instance | instance |
| Telemetry | VCF, VVF | každá instance – posílá telemetrii do Broadcomu | instance |
| VCF services runtime | VCF, VVF | každá instance – kontejnerový runtime | – |

Zdroj tabulky: [S2], [S5]. V VVF jsou VCF management services volitelné a běží na vCenteru [S2].

### 2.4 Mapování názvů komponent 5.2 → 9.0 → 9.1 [S2]

| VCF 5.2 | VCF 9.0 | VCF 9.1 |
|---|---|---|
| VMware Cloud Builder | VCF Installer | VCF Installer |
| SDDC Manager | SDDC Manager | SDDC Manager |
| VMware Aria Operations | VCF Operations | VCF Operations |
| VMware Aria Operations for logs | VCF Operations for logs | Log management |
| VMware Aria Operations for networks | VCF Operations for networks | VCF Operations for networks |
| VMware Aria Suite Lifecycle | VCF Operations fleet management | Fleet lifecycle + SDDC lifecycle |
| Workspace ONE Access | VCF Identity Broker | Identity broker |
| VMware HCX | VCF Operations HCX | VCF Operations HCX |
| VMware Aria Automation | VCF Automation | VCF Automation |
| VMware Aria Automation Orchestrator | VCF Operations orchestrator | VCF Operations orchestrator |
| VMware Cloud Director | N/A | VCF Automation |
| vSphere with Tanzu / IaaS Control Plane | vSphere Supervisor | vSphere Supervisor |

### 2.5 Rozdíly 9.0 vs 9.1

- **[9.0]** Management domain obsahuje „the SDDC Manager appliance and the fleet management appliance" [S10].
  V 9.0 existují samostatné komponenty VCF Operations fleet management (deployment a lifecycle VCF Operations, VCF
  Automation a VCF Identity Broker), VCF Identity Broker, VCF Operations for logs, VCF Operations collector [S11].
- **[9.1]** Místo fleet management appliance jsou VCF management services (Fleet lifecycle + SDDC lifecycle, Identity
  broker, Log management, …) ve VCF services runtime [S1][S2].
- **[9.0]** „Workload domains cannot use the NSX Manager cluster for the management domain." [S10]
- **[9.1]** „New workload domains can share the same NSX Manager cluster with an existing workload domain or with the
  management domain, or you can deploy a new NSX Manager cluster." [S1]
- **[9.0]** max. 24 workload domains per VCF Instance [S12]; **[9.1]** max. 40 [S6].

### 2.6 VCF Installer

- „a dedicated virtual machine that helps you plan, configure, and deploy VCF and vSphere Foundation components" [S4].
- Binárky VCF Installeru i SDDC Manageru jsou ve stejném souboru `VCF-SDDC-Manager-Appliance-9.x.x.ova` [S4].
- Režimy [S4]:
  - **Installer mode** – appliance běží na ESX hostu mimo cílovou management domain; zůstává instalátorem a může
    nasazovat další VCF Instance a konvergence.
  - **SDDC Manager mode** – appliance běží na hostu cílové management domain; během nasazení se přepne a stane se
    SDDC Managerem instance; „the appliance can no longer work in installer mode".
- Co nasazuje: nové VCF/VVF platformy (volitelně s existujícími VCF Operations / VCF Automation), další VCF Instance do
  existující fleet, VCF management services a License server při upgradu VVF na 9.1 [S4].
- Management domain vytváří VCF Installer při deploymentu nebo konvergenci [S1].

### 2.7 Identity broker

- Lze ho konzumovat „as an embedded service, running on vCenter, or deployed as an instance"; instance model je
  doporučený pro produkci a běží jako komponenta na VCF management services [S13].
- Je „the single broker for VCF Single Sign-On", ověřuje komponenty fleet „except for SDDC Manager" [S13].
- SSO modely: **Fleet-wide** (jeden broker pro celou fleet), **Cross-instance** (jeden broker pro podmnožinu
  instancí), **Single-instance** (broker v každé instanci) [S13].

### 2.8 vCenter a SSO v doménách

- Každá workload domain má dedikovaný vCenter a dedikovanou vCenter Single Sign-On doménu (umožňuje vlastní IdP) [S6].
- „VCF Instances that are upgraded from an earlier version may have shared vCenter Single Sign-On domains." [S6]

### 2.9 NSX Manager

- Modely lokálního NSX Manageru: **Simple** (1 uzel + VIP), **High Availability** (3uzlový cluster + VIP,
  anti-affinity), **High Availability with External Load Balancer** (3 uzly + externí LB s druhým VIP) [S14].
- NSX Federation: Global Manager jako **HA** (3uzlový cluster) nebo **HA with Standby** (aktivní + standby cluster,
  manuální failover) [S14].
- Dedikovaný vs. sdílený NSX: sdílený má menší footprint, ale „increases the blast radius in the event of a failure"
  a upgrade ovlivní všechny sdílející domény [S6].

### 2.10 VCF Automation

- Běží jako kontejnery v Kubernetes clusteru na dedikovaných appliance; „the central provisioning console for your VCF
  fleet" [S15].
- **Simple**: 1 uzel (Small), bez aplikační HA; zvětšení na Medium/Large „automatically scales the deployment out to
  3 nodes". **High availability**: 3 uzly Medium nebo Large, podporuje externí LB [S15].

---

## 3. Prerekvizity

Architektonické prerekvizity (detailní DNS/IP/HW patří do `10-planning`):

- Každá VCF Instance potřebuje management domain; „The version of the management domain also defines the VCF Instance
  version." [S8]
- Fleet komponenty (VCF Operations, VCF Automation, fleet-level management services) vyžadují první VCF Instance –
  běží v její management domain [S1][S9].
- Workload domain vyžaduje existující management domain (vytváří se ve VCF Operations) [S1][S8].
- Každý cluster: vSphere HA + DRS, alespoň jeden vSphere Distributed Switch [S1].
- Stretched / Site HA design: „Layer 2 extension or routing solutions" pro stretched IP mezi zónami, low-latency
  high-bandwidth linky, witness [S16].
- Multi-rack Layer 3 cluster: „Management domain default cluster not supported." [S7]
- VCF management services musí být vždy na vSphere distributed port group [S17].
- Licence: „Assigning a license must be done right after you complete deployment." [S9]

---

## 4. Workflow

Postup budování prostředí podle „Getting Started with VMware Cloud Foundation" [S9]:

1. Deploy a VCF fleet or VCF Instance (nový deployment, konvergence, nebo upgrade). „The first step in building a VCF
   platform is deploying a VCF fleet or a VCF Instance in a VCF fleet." Při nové fleet „the first management domain
   hosts the components of the VCF fleet too."
2. Volitelně přidat vCenter instanci do fleet (infrastruktura s licencí vSphere Foundation).
3. Dokončit konfiguraci ve VCF Operations / vSphere Clientu (licence, software depot, identity a přístup, backup,
   certifikáty, hesla; clustery a hosty do domén se přidávají ve vSphere Clientu).
4. Přidat workload domains do VCF Instance (nová, nebo import existujícího vCenteru).
5. Zařadit workload domains do organizační struktury ve VCF Automation Provider Management (sítě a VPC, Supervisor
   s NSX VPC, IdP, organizace).
6. Projít design blueprints a VCF capabilities.
7. Předat organizačním administrátorům ve VCF Automation.

Cesty k prostředí 9.1.x [S8]: (a) nový deployment (VCF Installer + VCF Operations workflows; „you can directly deploy
VCF 9.1.1 without first deploying 9.1.0"), (b) konvergence existující vSphere 8 / Aria 8 infrastruktury,
(c) upgrade z VCF 5.2.x / 9.0.x, VVF 5.2.x / 9.0.x, vSphere 8, (d) workload domains po management domain.
„Deployment of standalone components by deploying an OVA is typically not supported" (kromě explicitně uvedených) [S8].

Rozšíření fleet: VCF Installer v installer mode nasazuje další VCF Instance do existující fleet [S4]; každá instance
má vlastní management domain [S9].

Vytvoření workload domain [S1]: „You create workload domains in VCF Operations"; u první workload domain VCF Operations
nasadí vCenter (a pokud je třeba NSX Manager) **do management domain**; každá další WLD dostane další vCenter.

---

## 5. Chybové stavy

Na architektonické úrovni dokumentace uvádí tato omezení / nepodporované stavy (konkrétní hlášky viz další oblasti):

- Appliance přepnutá do SDDC Manager mode „can no longer work in installer mode" [S4].
- VCF Installer „works with major, minor, and maintenance releases, but does not support patch or express patch
  releases" – patche se aplikují ručně po dokončení workflow [S4].
- „Convergence of vSphere Foundation 9.1 with deployed VCF management services to VCF 9.1 is not supported." [S8]
- Multi-rack Layer 3 cluster nelze použít jako default cluster management domain; „Layer 3 multi-rack vSphere clusters
  cannot be stretched." [S7]
- Single-rack storage cluster s vSAN Storage Client traffic separation nelze stretchnout [S7].
- Simple model VCF management services: ztráta jediného control plane uzlu znamená redeploy clusteru a obnovu ze
  zálohy [S5].
- Single-rack cluster: žádná ochrana proti výpadku racku [S7].
- **[9.0]** Pokus o sdílení NSX Manageru management domain s workload domain – nepodporováno [S10]; v 9.1 povoleno [S1].
- Pořadí patchování 9.1.1: nejdřív Fleet lifecycle; VCF Operations „must not be patched in parallel with other
  components"; během patchování Software depot je patchování ostatních komponent blokováno [S18].

---

## 6. Limity a čísla

| Položka | Hodnota | Zdroj |
|---|---|---|
| Workload domains na VCF Instance | max. 40 **[9.1]** / 24 **[9.0]** | [S6] / [S12] |
| vCenter na doménu | právě 1 | [S1] |
| vSphere clusterů na doménu | ≥ 1 | [S1] |
| vSphere Distributed Switch na cluster | ≥ 1 | [S1] |
| Management domain na instanci | 1 | [S1] |
| VCF Operations / VCF Automation na fleet | 1 / 1 („a single VCF Operations instance") | [S16] |
| NSX Manager | 1 uzel (Simple) nebo 3 uzly (HA) | [S14] |
| VCF Automation | 1 uzel (Simple) nebo 3 uzly (HA) | [S15] |
| VCF services runtime – Simple | 1 control plane + 3 worker [S1][S5] (sizing tabulka uvádí 2 worker – viz otevřené otázky [S19]) | |
| VCF services runtime – HA | 3 control plane + odpovídající počet workerů, anti-affinity | [S1][S5] |
| Distributed switch model „Storage and Workload Separation" | min. 6 fyzických NIC s redundancí | [S20] |

### Sizing profily VCF Installeru – první VCF Instance [S19]

| Komponenta | Simple | HA – Small | HA – Medium | HA – Large |
|---|---|---|---|---|
| VCF Management Services | 1 CP, 2 worker | 3 CP, 3 worker | 3 CP, 3 worker | 3 CP, 4 worker |
| SDDC Manager | 1x Default | 1x Default | 1x Default | 1x Default |
| vCenter | 1x Small | 1x Small | 1x Medium | 1x Large |
| NSX | 1x Medium | 3x Medium | 3x Medium | 3x Large |
| VCF Operations | 1x Small | 2x Small | 3x Medium | 3x Large |
| License Server | 1x Default | 1x Default | 1x Default | 1x Default |
| Cloud Proxy | 1x Small | 1x Small | 1x Standard | 1x Standard |
| VCF Automation | 1x Small | 1x Medium | 3x Medium | 3x Large |
| **vCPU** | 76 | 106 | 184 | 298 |
| **RAM** | 251 GB | 335 GB | 656 GB | 949 GB |
| **Disk** | 7448 GB | 8422 GB | 11445 GB | 15357 GB |

### Sizing profily – další VCF Instance [S19]

| Komponenta | Simple | HA – Small | HA – Medium | HA – Large |
|---|---|---|---|---|
| VCF Management Services | 1 CP, 2 worker | 3 CP, 2 worker | 3 CP, 2 worker | 3 CP, 2 worker |
| SDDC Manager | 1x Default | 1x Default | 1x Default | 1x Default |
| vCenter | 1x Small | 1x Small | 1x Medium | 1x Large |
| NSX | 1x Medium | 3x Medium | 3x Medium | 3x Large |
| Cloud Proxy | 1x Small | 1x Small | 1x Standard | 1x Standard |
| **vCPU** | 34 | 62 | 74 | 120 |
| **RAM** | 111 GB | 187 GB | 244 GB | 353 GB |
| **Disk** | 4562 GB | 5462 GB | 5813 GB | 8321 GB |

### Worker uzly VCF management services [S19]

| Typ | Form factor | vCPU / worker | RAM / worker |
|---|---|---|---|
| Simple | Medium | 12 | 24 GB |
| Small HA | Small | 10 | 16 GB |
| Medium HA | Medium | 12 | 24 GB |
| Large HA | Large | 16 | 32 GB |

Day-2 Log management zvětší workery: Small → Large (16 vCPU / 32 GB), Medium a Large → xLarge (24 vCPU / 48 GB).
Real-time metrics přidává workery podle potřeby, nemění jejich velikost [S19]. Vlastní velikosti lze zadat JSON
deployment specifikací [S19].

### Deployment modely fleet (topologie) [S16]

| Design | Topologie | Cluster modely – management domain | Cluster modely – workload domains |
|---|---|---|---|
| 1. Basic Design | 1 fleet v 1 AZ/regionu | single-rack | single-rack, multi-rack |
| 2. Site High Availability | 1 fleet přes 2 AZ (stretched cluster, witness) | single-rack, stretched | single-rack, multi-rack L2, multi-rack L3, stretched |
| 3. Disaster Recovery | druhá instance v jiné AZ/regionu, VMware Live Recovery | single-rack | single-rack, multi-rack L2, multi-rack L3 |
| 4. Fault Domains and DR | kombinace 2 + 3 | single-rack, stretched | single-rack, multi-rack L2, multi-rack L3, stretched |

Více fleet: „Organizations may choose to deploy multiple VCF fleets to account for the scale in their environment",
např. jedna fleet na region (AMER, EMEA, APAC) [S16].

### vSphere cluster modely [S7]

| Model | Storage fault domains | Síť mezi hosty | Poznámka |
|---|---|---|---|
| Single-Rack | 1 | L2 | všechny domény; bez ochrany proti výpadku racku |
| Multi-Rack Layer 2 | více | L2 | default cluster management domain podporován |
| Multi-Rack Layer 3 | více | L3 | default cluster management domain **nepodporován**; nelze jako vSAN storage cluster; nelze stretchnout |
| Stretched | 2 | – | ochrana proti výpadku AZ |

---

## 7. Síťový provoz

**Zdroj portů.** TechDocs 9.1 (Planning and Preparation [S23], vSAN Network Port Requirements [S28], Import an
Existing vCenter [S26]) odkazuje pro úplný seznam portů na web **VMware Ports and Protocols**
https://ports.broadcom.com/ [S22]. Odkazy z KB článků ukazují, že web má pohledy pro VCF **9.1**
(např. `?vcfVersion=9.1+VCF-Operations`, `?vcfVersion=9.1+VCF-Automation+VCF-Management-Services` [S33][S34]).
Web je ale čistě JavaScriptová aplikace: při stažení (2026-11-20) vrací jen titulek „VMware Ports and Protocols“,
žádné tabulky. **Porty níže proto nejsou z portálu.** Pocházejí z TechDocs 9.1 a z KB článků na
knowledge.broadcom.com, které konkrétní port uvádějí. Ke každému je uvedena verze, na kterou se zdroj vztahuje.
Jde o **neúplný výčet**: KB články řeší jednotlivé chyby, ne celou matici portů.

Toky odvozené z architektury (doplněné o porty, kde je zdroj uvádí):

| Odkud | Kam | Port / protokol | Typ provozu | Platí pro (dle zdroje) | Zdroj |
|---|---|---|---|---|---|
| VCF Operations | všechny komponenty fleet (instance, vCentery) | – (souhrnně neuvedeno) | správa/monitoring; umístění fleet „should account for the latency between VCF Operations and all the components of the fleet" | 9.1 | [S16] |
| VCF Operations (každý uzel clusteru) | vCenter | TCP 443 | API spojení integrace vCenter účtu; „all VCF Operations nodes in the cluster should have accessibility over 443“, pokud se pro sběr nepoužívá cloud proxy group | VCF Operations 9.x | [S33] |
| Cloud proxy (v každé instanci) | komponenty instance → VCF Operations | odchozí HTTPS 443 („Allow outgoing HTTPS traffic for cloud proxy over port 443“) | lokální sběr dat | 9.1 | [S2][S25] |
| Endpointy / push adaptéry / Suite-API | cloud proxy | příchozí 443; 4505, 4506 (Telegraf application monitoring); 8443 (dříve, „will reach end of support“; pro nové nasazení použít 443) | sběr dat agentů, push model adapters | 9.1 | [S25] |
| Cloud proxy | síťová proxy (log forwarding) | 9543 („If you use a network proxy for log forwarding, port 9543 must be open“) | přeposílání logů | 9.1 | [S25] |
| Komponenty fleet (VCF Ops, VCF Automation, …) | Identity broker | neuvedeno | SSO autentizace (kromě SDDC Manageru) | 9.1 | [S13] |
| Telemetry (každá instance); SDDC Manager, vCenter, VCF Operations, services runtime | Broadcom (`vcsa.vmware.com`, `vcsa.telemetry.broadcom.com`, `scapi.telemetry.broadcom.com`) | 443 | telemetrie (CEIP) | 9.1 | [S2][S24] |
| VCF Operations | `vcf.broadcom.com`, `eapi.broadcom.com` | 443 | licencování v connected módu („License usage submission and license downloads“) | 9.x | [S24][S40] |
| Fleet lifecycle (první instance) | SDDC lifecycle / komponenty ve všech instancích | souhrnně neuvedeno | orchestrace upgradů napříč instancemi | 9.1 | [S2] |
| SDDC Manager, Fleet LCM, VCF Operations | VCF Automation / VCF services runtime (VSP IP adresy, consumption cluster) | TCP 443, 6443, 9100, 2381, 10257, 10259 – obousměrně (účel jednotlivých portů KB neuvádí) | nasazení VCF Automation; pravidla musí sedět na fyzickém firewallu i v NSX DFW | VCF Automation 9.x | [S34] |
| VCF Automation uzly | vCenter, do kterého se nasazují | 443 | nasazení („Failed to create services platform cluster“ při blokaci) | VCF Automation 9.0 | [S35] |
| Bootstrap VM (VCF services runtime) | vCenter | TCP 443 | získání thumbprintu vCenteru při bootstrapu services runtime | 9.1 | [S41] |
| SDDC Manager | VCF Operations fleet management VM | 22, 443 (protokol KB neuvádí; chybová hláška uvádí SSH) | nasazení fleet management, výměna certifikátů | 9.0.1 | [S36] |
| SDDC Manager | všechny uzly NSX Manageru | 443 | prerekvizita importu vCenteru jako workload domény | 9.1 | [S26] |
| SDDC Manager | vCenter, ESX hosty | TCP 443 (obousměrně) | autentizace k host agentům, rotace/remediace hesel | **VCF 5.2.2** (pro 9.x nedoloženo) | [S38] |
| SDDC Manager | vCenter | 8084, 9084, 9087 (jednosměrně; protokol KB neuvádí) | ESX prechecky a patching | **VCF 4.x/5.x** (pro 9.x nedoloženo) | [S37] |
| Salt Master (každá instance) | komponenty instance | neuvedeno | vynucení desired-state konfigurace | 9.1 | [S2] |
| vCenter | ESX hosty | 443 (HTTPS, management), 902 („MKS“, host management a konzole VM); ICMP | správa hostů, vLCM remediace, přidání hostů do clusteru | 9.0.1 / 9.x | [S31] |
| ESX hosty | vCenter | UDP 902 | „ESXi host heartbeats“ (při blokaci host neuvádí metadata VM, nasazení collectoru selže) | 9.x | [S32] |
| ESX / externí syslog klienti | vCenter (syslog) | 1514 (TLS); **[9.1]** port 514 (UDP/TCP) zablokován | syslog do vCenteru | **[9.1]** změna oproti 9.0 | [S27] |
| ESX hosty (management IP, vmk0) | všechny uzly NSX Manageru | TCP 443, 1234, 1235 | příprava hostu pro NSX (instalace VIB), spojení s NSX Manager; odchozí pravidla na ESX se vytvoří až po instalaci NSX VIB | NSX 4.x/9.x, VCF 9.x | [S29] |
| NSX Manager | vCenter | TCP 80 (HTTP CONNECT tunel na interní `sdkTunnel:8089`, uvnitř TLS) – **do 9.1.0 nutný**; TCP 443 (jen probe verze, od 9.1.1 i autentizace a sync) | registrace NSX jako vCenter extension, discovery a sync inventáře | **[9.0, 9.1.0]** TCP 80 nutný; **[9.1.1+]** NSX i vCenter ≥ 9.1.1 → přepne na 443, TCP 80 lze zavřít | [S30] |
| VCF Operations uzly | NTP server | UDP 123 | synchronizace času (při blokaci selže „Install VCF Operations and VCF Cloud proxy using Fleet Lifecycle“) | 9.1 | [S39] |
| ESX VMkernel | fyzická síť přes VDS | neuvedeno (vSAN porty: TechDocs odkazuje na portál [S28]; ESX firewall pravidla pro vSAN se přidají automaticky) | management, vSphere vMotion, vSAN, NSX host TEP | 9.1 | [S20][S28] |
| NSX Edge | fyzická síť | neuvedeno | north-south; east-west mezi workloady | 9.1 | [S2] |
| vSAN stretched cluster | mezi AZ + witness | neuvedeno (portál [S28]) | replikace storage, low-latency link | 9.1 | [S16][S28] |

Management sítě [S17]:
- VCF Installer ve výchozím stavu nasadí management komponenty na **VM management network** (sdílená s vCenter,
  NSX Manager, SDDC Manager) – model „Shared VLAN": 1 subnet, 1 VLAN.
- Další modely: Dedicated VLAN; Dedicated VLAN + NSX overlay segment; Dedicated VLAN + NSX stretched overlay segment
  (vyžaduje NSX Federation Global Managers Active/Standby).
- Cloud proxy „is always deployed to the VM management network"; VCF management services vždy na distributed port
  group; NSX overlay je podporován pro VCF Operations, VCF Automation, License Server a VCF Operations for networks.

Distributed switch modely [S20]: Single Distributed Switch; Storage Separation; Workload Separation; Storage and
Workload Separation; Dedicated vSphere Cluster for NSX Edge Nodes; vSAN Storage Cluster Separation. Od VCF 9.1.1
(greenfield) „it is now supported to share a vSphere Distributed Switch between clusters in a VCF domain".

---

## 8. Otevřené otázky

1. **Počet worker uzlů v Simple modelu VCF management services**: taxonomie [S1] a Management Services Models [S5]
   uvádějí „three worker nodes", sizing tabulka [S19] uvádí „1x Control Plane Nodes, 2x Worker Nodes". Který údaj
   platí pro 9.1.1?
2. **VCF Automation v profilu HA – Small**: sizing [S19] uvádí „1x Medium", ale [S15] říká, že velikost Medium
   automaticky znamená 3 uzly. Rozpor nevyjasněn.
3. **Scale limity fleet** (max. instancí na fleet, hostů na cluster/doménu, vCenterů na fleet, standalone vCenterů):
   stránka [S19] odkazuje na „Scale limits", ale hodnoty v obsahu nebyly – ověřit (pravděpodobně configmax nebo PDF).
4. **Úroveň Identity brokeru**: [S2] říká „First instance; optionally other instances", [S5] ho řadí mezi
   instance-level služby; přitom SSO model může být fleet-wide [S13]. Jak přesně modelovat – instance-level služba,
   která může obsluhovat celou fleet?
5. **Úroveň Log management**: [S5] fleet-level, [S2] „First instance (Day-N)" – shodné, ale není jasné, zda může být
   i v dalších instancích.
6. **Porty a protokoly** (zúženo): portál https://ports.broadcom.com/ [S22] je čistě JS a nejde ho stáhnout jako
   text. Porty v sekci 7 jsou proto z TechDocs a KB článků, a ty jsou neúplné. Zbývá:
   (a) projít portál ručně v prohlížeči (pohledy VCF 9.1: SDDC Manager, vCenter, ESX, NSX, VCF Operations,
   VCF Automation, VCF Management Services) a převzít celé tabulky včetně účelu portů;
   (b) porty pro Identity broker, Salt Master, fleet lifecycle, cloud proxy → VCF Operations (cíl),
   vSAN (vč. stretched/witness), vMotion, NSX TEP (Geneve) a NSX Edge – v povolených zdrojích nenalezeny;
   (c) SDDC Manager → vCenter 8084/9084/9087 [S37] a SDDC Manager → ESX 443 [S38] jsou doloženy jen pro VCF 4.x/5.x;
   pro 9.x ověřit;
   (d) účel jednotlivých portů VCF Automation 6443/9100/2381/10257/10259 [S34] KB neuvádí (odkazuje na přílohu
   `Micro_Segmentation_Port_Requirement.xlsx`).
7. **Minimální počet hostů** v management domain / workload domain / clusteru (vSAN vs. jiný storage) – na fetchnutých
   stránkách neuvedeno; patří do `10-planning`, ale ovlivní model.
8. **VCF Edge Models** (dříve Remote Clusters) a **vSphere Supervisor Models** – stránky existují v Design Library
   [S21], nebyly zpracovány.
9. **Standalone vCenter ve fleet** – jaké funkce nad ním VCF Operations má (licence VVF?) – jen zmínka v [S1][S9].
10. **[9.0] sizing a node counts** (fleet management appliance, VCF Operations for logs) – 9.0 sizing stránka nebyla
    stažena; pro 9.0 tedy čísla chybí.
11. **Režim NSX Manageru v management domain** pro první workload domain – [S1] říká, že vCenter (a NSX Manager)
    první WLD jsou nasazeny „in the management domain"; není jasné, jestli to platí i pro další WLD (vCenter ano –
    „additional vCenter instance", umístění neupřesněno).

---

## 9. Zdroje

- [S1] VCF Taxonomy (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/overview-of-vmware-cloud-foundation-9/workload-domains-in-vmware-cloud-foundation.html
- [S2] Components in VCF and vSphere Foundation (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/vcf-management-appliances.html
- [S3] What Is VMware Cloud Foundation? (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/overview-of-vmware-cloud-foundation-9/what-is-vmware-cloud-foundation-and-vmware-vsphere-foundation.html
- [S4] VCF Installer Overview (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/overview-of-vmware-cloud-foundation-9/what-is-vmware-cloud-foundation-and-vmware-vsphere-foundation/what-is-the-vcf-installer-.html
- [S5] VCF Management Services Models (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/vmware-cloud-foundation-concepts/vcf-management-services-models.html
- [S6] VCF Domain Models (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/vmware-cloud-foundation-concepts/design-guide-vmware-cloud-foundation-architecture-models.html
- [S7] vSphere Cluster Models (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/vmware-cloud-foundation-concepts/vsphere-cluster-models.html
- [S8] Paths to Building 9.1.x Environments: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/overview-of-deploy--converge--and-upgrade.html
- [S9] Getting Started with VMware Cloud Foundation (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/overview-of-vmware-cloud-foundation-9/getting-started-with-vcf.html
- [S10] VCF Taxonomy (9.0): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/overview-of-vmware-cloud-foundation-9/workload-domains-in-vmware-cloud-foundation.html
- [S11] Components in VCF and vSphere Foundation (9.0): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/deployment/vcf-management-appliances.html
- [S12] VCF Domain Models (9.0): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/design/vmware-cloud-foundation-concepts/design-guide-vmware-cloud-foundation-architecture-models.html
- [S13] Identity Broker / VCF Single Sign-On Models (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/vmware-cloud-foundation-concepts/auth-design-vcf.html
- [S14] NSX Manager and Control Plane Models (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/vmware-cloud-foundation-concepts/vcf-networking-management-and-control-plane.html
- [S15] VCF Automation Models (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/vmware-cloud-foundation-concepts/vcf-automation-deployment-models.html
- [S16] VCF Fleet Deployment Models (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/vmware-cloud-foundation-concepts/vcf-operations-deployment-models.html
- [S17] VCF Management Network Models (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/vmware-cloud-foundation-concepts/fleet-level-component-backing-networking-models.html
- [S18] VCF 9.1.1.0 Release Notes: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/release-notes/vmware-cloud-foundation-9-1-1-0-release-notes.html
- [S19] VCF Fleet Sizing Models (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/vmware-cloud-foundation-concepts/vcf-fleet-sizing-models-9-x.html
- [S20] Distributed Switch Models (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/vmware-cloud-foundation-concepts/cluster-network-deployment-models.html
- [S21] Architectural Options in VMware Cloud Foundation (9.1, index Design Library modelů): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/vmware-cloud-foundation-concepts.html
- [S22] VMware Ports and Protocols (portál, odkaz z TechDocs [S23]; JS aplikace, obsah nešel stáhnout): https://ports.broadcom.com/
- [S23] Planning and Preparation (9.1) – odkazuje na „VMware Ports and Protocols“: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/planning-and-preparation.html
- [S24] Public URLs Required for Online Functionalities (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/planning-and-preparation/public-urls-required-for-vmware-cloud-foundation.html
- [S25] Deploy Cloud Proxy for the VCF 9.1 Upgrade (porty cloud proxy): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/upgrading-cloud-foundation/upgrade-backup-and-restore/configuring-cloud-proxies-in-vrealize-operations-cloud.html
- [S26] Import an Existing vCenter to Create a Workload Domain (9.1) – SDDC Manager → NSX Manager 443: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/building-your-private-cloud-infrastructure/working-with-workload-domains/import-an-existing-vcenter-to-create-a-workload-domain.html
- [S27] VCF 9.1 Product Support Notes (vCenter syslog 514 → 1514): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/release-notes/vmware-cloud-foundation-9-1-0-0-release-notes/vcf-91-product-support-notes.html
- [S28] vSAN Network Port Requirements (9.1; odkazuje na portál): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/vsan-deployment-administration-and-monitoring/vsan-network-design/understanding-vsan-networking/network-requirements-for-vsan/vsan-network-port-requirements.html
- [S29] KB 447321 – NSX VIB installation or upgrade fails due to TCP port timeout (ESX → NSX 443/1234/1235): https://knowledge.broadcom.com/external/article/447321/nsx-vib-installation-or-upgrade-fails-du.html
- [S30] KB 446323 – NSX Manager to vCenter Server Communication Over TCP/80: https://knowledge.broadcom.com/external/article/446323/nsx-manager-to-vcenter-server-communicat.html
- [S31] KB 435005 – VCF 9.0.1 Deployment Fails and Rolls Back (vCenter → ESX 443/902): https://knowledge.broadcom.com/external/article/435005/vcf-901-deployment-fails-and-rolls-back.html
- [S32] KB 436501 – VCF 9.x deployment fails with VMWithNameIPAndHostNameNotFoundException (ESX → vCenter UDP 902): https://knowledge.broadcom.com/external/article/436501/vcf-9x-deployment-fails-with-vmwithnamei.html
- [S33] KB 445194 – Configuring a vCenter Account in VCF Operations fails „Connection Timed out“ (VCF Ops → vCenter 443): https://knowledge.broadcom.com/external/article/445194/configuring-a-vcenter-account-in-vcf-ope.html
- [S34] KB 458322 – VCF Automation deployment fails due to blocked ports in micro-segmented environment: https://knowledge.broadcom.com/external/article/458322/vcf-automation-deployment-fails-due-to-b.html
- [S35] KB 418755 – VCF 9 Automation install failing (Automation nodes → vCenter 443): https://knowledge.broadcom.com/external/article/418755/vcf-9-automation-install-failing-with-lc.html
- [S36] KB 427641 – VCF deployment failing at VCF Operations fleet management deployment (SDDC Manager → fleet management 22/443): https://knowledge.broadcom.com/external/article/427641/vcf-900-deployment-failing-at-vcf-operat.html
- [S37] KB 411436 – ESXi patching from SDDC Manager fails (SDDC Manager → vCenter 8084/9084/9087; VCF 4.x/5.x): https://knowledge.broadcom.com/external/article/411436/esxi-patching-from-sddc-manager-fails-wi.html
- [S38] KB 432304 – Password remediation for ESXi and vCenter accounts fails with handshake failure (TCP 443; VCF 5.2.2): https://knowledge.broadcom.com/external/article/432304/password-remediation-for-esxi-and-vcente.html
- [S39] KB 439240 – VCF 9.1 installer fails due to unreachable NTP server (UDP 123): https://knowledge.broadcom.com/external/article/439240
- [S40] KB 404593 – Unable to Register License in VCF Operations in Connected Mode (vcf/eapi.broadcom.com 443): https://knowledge.broadcom.com/external/article/404593/unable-to-register-license-in-vcf-operat.html
- [S41] KB 458004 – VCF 9.1 deployment fails with „Failed to bootstrap VCF services runtime“ (bootstrap VM → vCenter TCP 443): https://knowledge.broadcom.com/external/article/458004
