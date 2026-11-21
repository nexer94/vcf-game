# 50 – vSAN (start oblasti): rack awareness a fault domains

> Modelovaná verze: **VCF 9.1.1** (`VERSION.md`). Kde se liší 9.0, je to označené **[9.0]** / **[9.1]**.
> Rozsah: zatím jen **rack awareness**, tedy vSAN fault domains, multi-rack cluster modely, síťový fabric
> per rack a místo konfigurace. Ostatní vSAN témata jsou jen krátce v sekci 6 nebo v „Otevřených otázkách“.
> Citace v uvozovkách jsou doslovné. Text označený *(parafráze)* je převyprávěný.
> Návaznosti: `00-architektura` 6 (cluster modely), `05-design` 4.4–4.5, `06-blueprints` 7a,
> `10-planning` 3.3 a 6.1.

---

## 1. Shrnutí

- **Fault domain** ve vSAN: „A logical grouping of hosts based on their physical location such as a rack“ [V1].
  Admin guide: „A fault domain consists of one or more vSAN hosts grouped according to their physical location in
  the data center.“ [V13]
- Účel: „fault domains can spread redundancy components across the servers in separate computing racks. In this
  way, you can protect the environment from a rack-level failure such as loss of power or connectivity.“ [V12]
- vSAN pak policy uplatňuje na fault domains místo na jednotlivé hosty: „vSAN applies the active virtual machine
  storage policy to the fault domains instead of the individual hosts“. Každá ochranná komponenta (replika,
  witness) leží v jiné fault domain *(parafráze)* [V12].
- Ve VCF je rack awareness ve dvou designových modelech:
  - **vSphere cluster model**: Multi-Rack Layer 2 a Multi-Rack Layer 3. Oba mají „Multiple storage fault domains.“
    Single-Rack má „Single storage fault domain.“ a „No protection against a rack failure.“ [V6]
  - **Storage model**: „Multi-Rack vSAN“ (HCI) a „Multi-Rack vSAN Compute Cluster“. „A multi-rack cluster can use
    vSAN fault domains to tolerate a rack failure.“ [V5] Účel podle Design Library: „This design is primarily used for
    rack awareness and to provide resilience against the failure of an entire rack.“ [V4]
- **Mapování rack → fault domain ve VCF je ruční.** Requirement VCF-VSAN-L3MR-REQD-CFG-003: „Configure vSAN fault
  domains and place the nodes of each rack in their fault domain.“ Implication: „Configure fault domains manually
  in vCenter after cluster expansion.“ [V1]

## 2. Komponenty a vztahy

| Prvek | Popis | Zdroj |
|---|---|---|
| Rack | fyzická fault domain; „Hosts are installed horizontally across physical racks“ *(parafráze atributu „Cluster rack mapping“)* | [V8][V9] |
| vSAN fault domain | 1+ hostů; „Each fault domain must contain at least one host.“ Host bez FD: „If a host is not a member of a fault domain, vSAN interprets it as a stand-alone fault domain.“ | [V13][V12] |
| Multi-Rack vSAN (HCI) | compute + storage; „Can be configured with both Layer 2 cluster type and Layer 3 cluster type.“ | [V5][V1] |
| Multi-Rack vSAN Compute Cluster | jen compute, mountuje datastore vSAN Storage clusteru ve stejné doméně; „A vSAN Compute cluster can be spread over multiple racks routed via Layer 3 networking.“ | [V3] |
| vSphere cluster model | Multi-Rack L2: síť „stretched across racks using a single broadcast domain for each network“; Multi-Rack L3: „isolated to a rack using a separate broadcast domain for each network per rack“ | [V20] |
| Network fabric model | Single-Rack / Multi-Rack (L2, L3) / Multi Availability Zone | [V20] |
| NSX | L3: per rack uplink profile, Host TEP IP pool a sub-TNP (VCF-VNI-L3MR-REQD-CFG-001..003) | [V9] |
| NSX Edge cluster | Rack Fault Tolerant model pro L2 / L3; Edge sítě omezené na rack | [V24][V25] |
| Storage policy | FTT / RAID se mapuje na počet fault domains (2n+1) | [V13][V16] |

Vztahy mezi modely:
- Multi-Rack L2 cluster „can be stretched across availability zones“. Multi-Rack L3 je „single availability zone
  only“ [V1]. „Layer 3 multi-rack vSphere clusters cannot be stretched.“ [V6]
- Stretched cluster model má „Dual storage fault domains.“ (2 AZ jako dvě site fault domains + witness). Detaily
  jsou v `10-planning` 3.3 a `06-blueprints`, mimo rozsah této stránky [V6].
- **[9.0]** Multi-Rack L3 s vSAN může být „HCI or compute cluster (not storage)“ *(parafráze)*. Pro Multi-Rack L2
  uvádí 9.0 HCI, storage nebo compute [V7]. Stránka 9.1 [V6] tuto poznámku v extrakci nemá. `00-architektura` 6
  uvádí pro L3 „nelze jako vSAN storage cluster“.

## 3. Prerekvizity

### 3.1 Racky a hosty (vSAN Multi-Rack, 9.1 = 9.0)
| ID / zdroj | Text | Typ |
|---|---|---|
| VCF-VSAN-L3MR-REQD-CFG-002 [V1][V2] | „Use a minimum of three (3) racks for the cluster.“ Justification: „Provides support for re-protecting vSAN objects if a single-rack failure occurs.“ Implication: „Requires a minimum of 3 hosts in a cluster, distributed across three (3) racks.“ / „Will provide redundancy, but will not provide automatic rebuild of vSAN components.“ | requirement |
| VCF-VSAN-L3MR-RCMD-CFG-001 [V1][V2] | „Use four (4) Fault domains for vSAN HCI multi-rack“. Implication: „Requires a minimum of four(4) ESX hosts added to a cluster, distributed across four (4) racks.“ | recommendation |
| VCF-VSAN-L3MR-REQD-CFG-003 [V1] | „Configure vSAN fault domains and place the nodes of each rack in their fault domain.“ | requirement |
| VCF-VSAN-L3MR-REQD-CFG-004 [V1] | „Deactivate vSAN ESA auto policy management.“ Justification: „This feature is not supported with vSAN fault domains.“ Implication: „To align with the number of vSAN fault domains, it maybe necessary create a default storage policy manually.“ | requirement |
| VCF-VSAN-L3MR-REQD-CFG-005 [V1] | „Do not enable reserved Capacity in a vSAN HCI multi-rack cluster.“ Nepodporováno pro „Three (3) node clusters.“, „vSAN stretched clusters.“, „vSAN clusters using fault domains“. Implication: „This will require manually calculating vSAN slack space.“ | requirement |
| VCF-VSAN-L3MR-REQD-CFG-001 [V1] | Pro L3 multi-rack nastavit vSAN gateway každého racku jako HA isolation address pro hosty racku. Gateways musí být HA a odpovídat na ICMP *(parafráze)*. | requirement |
| VCF-CLS-MR-RCMD-CFG-002 [V8][V9] | vSAN ESA jako principal storage (vyžaduje HW kompatibilní s ESA) *(parafráze)* | recommendation |
| VCF-CLS-MR-RCMD-CFG-001 [V8][V9] | Víc VDS pro oddělení storage, NSX a vMotion; každý VDS min. 2 pNIC *(parafráze)* | recommendation |

Pravidla návrhu fault domains (vSAN 9.1 admin/planning) [V12][V13]:
- „Define at least three fault domains. Define a minimum of four domains for best protection.“ [V12]
- „Assign the same number of hosts to each fault domain.“ [V12] / „place a uniform number of hosts in each fault
  domain.“ [V13]
- „Use hosts that have uniform configurations.“ [V12]
- „Dedicate one fault domain of free capacity for rebuilding data after a failure, if possible.“ [V12]
- „Provide enough fault domains to satisfy the Failures to tolerate that are configured in the storage policies.“ [V12]

> **Pozor:** Rovnoměrné rozložení hostů v rackách je v dokumentaci **doporučení** vSAN planning/admin guide.
> Design Library VCF ho jako requirement neuvádí. Multi-Rack vSAN Storage Model minimum hostů *na rack* nedává,
> jen celkové minimum („3 hosts … across three racks“ / „four … across four racks“) [V1].

### 3.2 Cluster model a doména
- Minimum hostů na cluster: Multi-Rack L2 – vSAN 3 (mgmt first cluster Simple), 4 (mgmt first cluster HA), 3
  (další clustery). Multi-Rack L3 – vSAN 3, VMFS na FC / NFS 2 [V8][V9]. Detail a nejasnosti tabulek viz
  `10-planning` 6.1.
- Multi-Rack L3: „Not supported for primary cluster, additional clusters supported“ (management domain) [V9][V10].
  „This model is not applicable to the default management vSphere cluster VCF Instance.“ [V22]
- Storage model „Multi-Rack vSAN“ a „Multi-Rack vSAN Compute Cluster“ je pro **default cluster management domain
  „Non Supported“**. Pro další clustery management domain a pro WLD je „Principal“ [V5]. Rozpor s L2 cluster
  modelem viz Otevřené otázky 1.
- Multi-Rack vSAN Compute Cluster: „Minimum two (2) vSAN compute nodes is required for VCF provisioned clusters“.
  Latence ke Storage clusteru „less than 5 milliseconds“. Musí být ve stejné doméně jako vSAN Storage Cluster.
  Max. „up to 5 remote datastores“ (VCF-VSAN-COMP-CLU-REQD-CFG-001..007) [V3].

### 3.3 Síť
- **Multi-Rack L2**: VLANy roztažené přes racky. Fabric to zajistí „using its intrinsic capabilities such as
  EVPN-VXLAN“. Gateway „highly available across racks“ (příklady HSRP, VRRP, AnyCast) *(parafráze)* [V22].
- **Multi-Rack L3**: VLAN segmenty izolované per rack. Hosty jednoho clusteru mohou mít v různých rackách různé
  VLANy *(parafráze)* [V22].
  - VCF-VNI-L3MR-REQD-CFG-001: „Create an uplink profile for each rack.“ [V10]
  - VCF-VNI-L3MR-REQD-CFG-002: „Create a host TEP IP pool for each rack with a subnet allocated per rack and a
    gateway for the subnet.“ [V10]
  - VCF-VNI-L3MR-REQD-CFG-003: „Create NSX host sub transport node profiles for additional racks.“ [V10]
  - Doporučení (stránka u něj omylem opakuje ID VCF-VNI-L3MR-REQD-CFG-001): „Use a separate host TEP transport VLAN
    ID per rack.“ [V10][V9]
  - vSAN: VCF-VSAN-L3MR-RCMD-CFG-002 / VCF-VSAN-NET-RCMD-CFG-006 – Layer 3 mezi fault domains. Implication: víc
    subnetů per rack, gateway pro každý subnet, routing mezi racky *(parafráze)* [V1].
- **ToR**: „Each ESX host must be connected to at least one network switch for IP connectivity.“
  (VCF-NET-REQD-TOR-001); „Connect each ESX host to two (2) or more top of rack switches.“ (VCF-NET-RCMD-TOR-001)
  [V23]. Počet ToR na rack dokumentace výslovně neuvádí.
- First-hop gateway pro všechny infrastrukturní VLANy (VCF-NET-REQD-GTW-001). Doporučena plovoucí IP přes FHRP
  (VCF-NET-RCMD-GTW-001) [V20].

## 4. Workflow

### 4.1 Návrh (Design Library)
1. Zvolit vSphere cluster model podle domény a požadované odolnosti: Single-Rack / Multi-Rack L2 / Multi-Rack L3 /
   Stretched [V6]. Povolené kombinace jsou v sekci 6.3.
2. Zvolit storage model: Multi-Rack vSAN (HCI) nebo Multi-Rack vSAN Compute Cluster [V4][V5].
3. Naplánovat racky: min. 3, doporučeno 4 fault domains. Stejný počet hostů v každém racku. Ideálně jedna FD
   volné kapacity na rebuild [V1][V12].
4. Naplánovat síť: L2 (VLANy roztažené) nebo L3 (VLAN/subnet per rack, Host TEP pool, uplink profile a sub-TNP per
   rack) [V9][V22]. „Host-to-rack addressing must be planned in advance“ *(parafráze)* [V1].

### 4.2 Workload domain s L3 Multi-Rack vSAN HCI clusterem **[9.1]** [V26]
Úvod stránky: clustery mají L3 fabric mezi racky, „a dedicated NSX host sub-transport node profile for each
rack“ *(parafráze)* a volitelně každý rack jako vSAN fault domain. Postup:
1. **Nasadit** L3 multi-rack vSAN workload domain. Stránka neříká, zda přes UI nebo API (Otevřené otázky 3).
2. **Deactivate Auto Policy Management** („You cannot use auto policy management in a multi-rack cluster when using
   vSAN fault domains.“) [V26][V27]. vSphere Client (vCenter WLD) → Hosts and clusters → cluster → **Configure** →
   **vSAN Services** → panel **vSAN ESA** → **Edit** → vypnout **Auto-policy Management** → **Apply**.
3. **Create and Assign a New Default Storage Policy** [V28]: Menu → **Policies and Profiles** → **VM Storage
   Policies** → **Create** → vybrat vCenter → název → **Policy structure** (enable rules for vSAN storage) → tab
   **Availability**: **Failures to tolerate** podle prostředí (ESA: RAID 5 nebo RAID 6) → **Storage Rules**: **All
   flash** → **Storage compatibility** → **Review and finish** → **Finish**. Pak Storage inventory → vSAN datastore
   → **Configure** → **General** → Default Storage Policy **Edit** → vybrat novou policy → **OK**. Důvod: default
   ESA policy se řídí počtem hostů při vytvoření clusteru, pro rack resilience je potřeba policy podle počtu racků
   *(parafráze)* [V26][V28].
4. **Create vSAN Fault Domains** [V29]: „For vSAN multi-rack clusters with more than one ESX node per rack create a
   vSAN fault domain“ pro každý rack. vSphere Client (vCenter WLD) → Hosts and clusters → multi-rack cluster →
   **Configure** → **vSAN** → **Fault Domains** → **+** → dialog **New Fault Domain**: název + hosty racku →
   **Create** → opakovat pro každý rack.
   Poznámka: „During a future cluster expansion, add hosts manually to their respective fault domains.“ [V29]

### 4.3 Totéž ve **[9.0]** (VCF Operations API) [V30]
1. Připravit JSON spec. Příklad: 4 racky (r01–r04) po 1 hostu, per-rack IP pool (např. 10.15.14.0/24 … 10.15.47.0/24),
   per-rack transport VLAN (1514, 1525, 1536, 1547), per-rack uplink profile a `networkProfiles`
   (`hostSpecs[].hostNetworkSpec.networkProfileName`), ESA `esaConfig.enabled`.
2. VCF Operations → **Developer Center** → **APIs & SDKs** → **API Explorer** → vybrat VCF Instance.
3. `GET /v1/hosts` se statusem `UNASSIGNED_USEABLE` → ID hostů do `hostSpecs[].id`.
4. `GET /v1/personalities` → `clusterImageId`.
5. `POST /v1/domains/validations` → `POST /v1/domains/` → **View Task Status**.
6. Pokračovat jako 4.2 kroky 2–4.
Hodnoty v bodu 1 jsou z příkladu, ne minima. Stránka uvádí, že doména „requires routed networks between racks“.

### 4.4 Obecná správa fault domains (vSphere Client, vSAN 9.1)
- **Create**: cluster → **Configure** → **vSAN** → **Fault Domains** → ikona **plus** → průvodce **New Fault Domain**
  → název, hosty → **Create** [V14].
- **Move host into FD**: tamtéž přetáhnout host na existující FD → dialog **Add Hosts To Domain** → **Move** [V31b].
- Dále Move out, Rename, Remove (podstránky [V13], obsah zatím nestažen).
- Výsledek: „Each fault domain displays the used and reserved capacity information.“ [V14]

### 4.5 Rozšíření clusteru o host (Day 2) **[9.1]**
1. Host commissioned (Unassigned, active) [V32].
2. vSphere Client → cluster → **Actions > Add Hosts > Add Unassigned Hosts** → vybrat host → **Next** → networking
   (VMNIC → VDS uplinky) → **Next** → review → **Finish** [V32].
3. U multi-rack clusteru host **ručně** zařadit do FD jeho racku [V29] (postup 4.4 Move).
- Prerekvizita: pokud cluster používá statický NSX Host TEP pool, „that pool must include enough IP addresses for
  the hosts you are adding.“ [V32] U L3 jde o pool daného racku (dovozeno z VCF-VNI-L3MR-REQD-CFG-002 [V9]).

### 4.6 Bring-up (VCF Installer) a management domain
- První cluster management domain smí být Multi-Rack **L2** (ne L3) [V6][V35]. Postup konfigurace fault domains
  pro management cluster při bring-upu ani zda to VCF Installer umí, povolené zdroje neuvádějí (Otevřené otázky 2).
  Obecné pravidlo z Design Library: fault domains se konfigurují ručně ve vCenter po rozšíření clusteru [V1].

## 5. Chybové stavy

| Situace | Následek / hláška | Verze | Zdroj |
|---|---|---|---|
| FD bez hostů | „A fault domain cannot be empty. You must select at least one host to include in the fault domain.“ | 9.1 | [V14] |
| Duplicitní název FD | „vSAN does not support duplicate fault domain names in a cluster.“ | 9.1 | [V14] |
| Host offline / HW problém | nelze přiřadit do FD *(parafráze prerekvizity „Verify that your vSAN hosts are online.“)* | 9.1 | [V14] |
| Málo fault domains pro policy (FTT) | „There are currently [X] usable fault domains. The operation requires [Y] more usable fault domain.“ Příčiny: odpojené / partitioned hosty, maintenance mode, vadné disky, „Too few hosts for the policy, such as FTT=2 on a 3-node cluster“ *(parafráze)* | vSAN all versions | [V33] |
| Partition clusteru při aplikaci default FTT=1 | „There are currently 2 usable fault domains. The operation requires 1 more usable fault domains.“ (FTT=1 potřebuje 3 FD) | vSAN 7.x, 8.x, 9.0 | [V34] |
| Jen 3 fault domains | „A cluster with three fault domains has the same restrictions that a three host cluster has, such as the inability to reprotect data after a failure“ a „the inability to use the Full data migration mode.“ | 9.1 | [V13] |
| Výpadek racku | „When a rack fails, all resources including the CPU, memory in the rack become unavailable to the cluster.“ | 9.1 | [V13] |
| Auto policy management + fault domains | nepodporováno („not supported with vSAN fault domains“) → nutné vypnout | 9.0, 9.1 | [V1][V26] |
| Reserved Capacity + fault domains | nepodporováno → ruční výpočet slack space | 9.0, 9.1 | [V1] |
| Policy vyžaduje víc hostů, než cluster má (force provisioning) | objekt se nasadí s „bare minimum“ (No Data Redundancy). Příklad: RAID-6 na 4 hostech místo 6 *(parafráze)* | 9.1 | [V17] |
| L3 multi-rack jako default cluster mgmt domain | nepodporováno | 9.0, 9.1 | [V6][V9][V10] |
| Stretch L3 multi-rack clusteru | „Layer 3 multi-rack vSphere clusters cannot be stretched.“ | 9.1 | [V6] |
| Přidávaný host neodpovídá konfiguraci clusteru | „a warning is displayed“; warning „does not prevent the expansion“ | 9.1 | [V32] |
| Dočasný + trvalý výpadek při FTT=1 | „a temporary failure followed by a permanent failure in a cluster can result in data loss“. Extra FD umožní „durability component“. „6 host cluster with RAID 6 object cannot create a durability component if there is a host failure.“ | 9.1 | [V15] |

## 6. Limity a čísla

### 6.1 Fault domains a FTT
| Pravidlo | Hodnota | Zdroj |
|---|---|---|
| Vzorec | „vSAN requires a minimum of 2*n+1 fault domains in the cluster.“ (FTT = n). Policy page: „If fault domains are configured, 2n+1 fault domains with ESX hosts contributing capacity are required.“ | [V13][V16] |
| FTT=1 | „A minimum of three fault domains are required to support FTT=1.“ | [V13] |
| FTT=2 | „configure five fault domains in the cluster.“ | [V13] |
| Doporučení | min. 4 FD („If possible, use at least four fault domains.“) | [V12] |
| VCF multi-rack | min. 3 racky (REQD), doporučeno 4 FD (RCMD) | [V1] |
| Hosty / FD | ≥ 1; stejný počet v každé FD (doporučení) | [V13][V12] |
| Compute cluster (multi-rack) | ≥ 2 compute uzly; ≤ 5 remote datastores; < 5 ms ke storage clusteru | [V3] |

### 6.2 RAID / FTT (vSAN ESA 9.1) [V18]
Standardní (ne stretched) cluster. Stránka uvádí „Min Hosts“, nikoli fault domains:

| FTT | RAID | Overhead | Layout | Min hostů |
|---|---|---|---|---|
| 0 | RAID-0 | 1x | single copy | 1 |
| 1 | RAID-1 | 2x | 2 mirrors | 3 |
| 2 | RAID-1 | 3x | 3 mirrors | 5 |
| 3 | RAID-1 | 4x | 4 mirrors | 7 |
| 1 | RAID-5 (2+1) | 1.5x | 2 data + 1 parity | 3 |
| 1 | RAID-5 (4+1) | 1.25x | 4 data + 1 parity | 6 |
| 2 | RAID-6 (4+2) | 1.5x | 4 data + 2 parity | 6 |

Na stejné stránce je ale i text „You can configure RAID 5 on all-flash clusters with four or more fault domains.“ a
„You can configure RAID 5 or RAID 6 on all-flash clusters with six or more fault domains.“ Počet komponent RAID-5:
„If six or more fault domains are available … five components“, „If five or fewer … three components“. „RAID 5 or
RAID 6 erasure coding does not support a Failures to tolerate value of 3.“ [V18] Rozpor 3 vs. 4 viz Otevřené
otázky 4.

**ESA Auto-RAID [9.1]** (standard cluster) [V18][V16]:

| Hostů | Auto-RAID |
|---|---|
| < 3 | FTT=0, RAID-0 (1.0x) |
| 2 (two-node) | FTT=1, RAID-1 (2.0x) |
| 3–5 | FTT=1, RAID-5 2+1 (1.5x) |
| 6+ | FTT=2, RAID-6 4+2 (1.5x) |

- „In VCF 9.1, vSAN clusters use RAID-6 as the default RAID level.“ „vSAN automatically configures RAID-6, removing
  the need for manual selection“ [V19].
- Auto-RAID nejde použít na clusterech VCF/ESX 9.0 a starších. Remote datastore 9.1+ potřebuje na remote clusteru
  „Assume auto RAID“ [V18].
- **[9.0] vs [9.1]**: s auto-policy management musí mít cluster 4 hosty pro RAID-5 a 6 hostů pro RAID-6 [V17].
  Multi-Rack model: u vSAN 9.0 s „Host Rebuild Reserve“ a Auto-Policy na 4 hostech nelze použít RAID-5; „vSAN
  Auto-RAID removes this limitaton in vSAN 9.1“ [V1].
- Vztah Auto-RAID k fault domains: VCF multi-rack vyžaduje vypnout **auto policy management**
  (VCF-VSAN-L3MR-REQD-CFG-004) [V1]. Zda se to týká i Auto-RAID pravidla 9.1, není ověřeno (Otevřené otázky 5).

### 6.3 Kde je který rack model povolen
| Kontext | Povolené cluster modely | Zdroj |
|---|---|---|
| Management domain – default (první) cluster | Single-Rack, Multi-Rack L2, Stretched (Day 2). **Ne** L3. | [V35][V6] |
| Management domain – další clustery | „All cluster models.“ | [V35] |
| Workload domain | Single-Rack, Multi-Rack L2, Multi-Rack L3, Stretched | [V36] |
| Storage model Multi-Rack vSAN / Multi-Rack vSAN Compute | default cluster mgmt: **Non Supported**; další mgmt clustery a WLD: Principal | [V5] |
| Fleet model Basic | mgmt: single-rack; WLD: single-rack, multi-rack | `00-architektura` 6 [S16] |
| Site HA / Fault Domains and DR | mgmt: single-rack, stretched; WLD: single-rack, multi-rack L2, multi-rack L3, stretched | `00-architektura` 6 [S16] |
| Disaster Recovery | mgmt: single-rack; WLD: single-rack, multi-rack L2, multi-rack L3 | `00-architektura` 6 [S16] |
| Design Blueprints 9.1 | všechny vybírají **Single-Rack** (nebo Stretched) cluster a Single-Rack (nebo Multi-AZ) network fabric. Multi-rack žádný blueprint nevolí. | `06-blueprints` |

### 6.4 Kapacita a rezervy
- Reserved Capacity (Operations Reserve + Host Rebuild Reserve) se s fault domains **nepoužívá** → slack se počítá
  ručně (vSAN sizer) [V1].
- Příklad Host Rebuild Reserve: „the Host Rebuild Reserve for a four (4) node cluster would be 25% while it would be
  just 8% for a twelve (12) node cluster.“ [V1] (Platí pro clustery bez FD.)
- Rezerva na rack: „Dedicate one fault domain of free capacity for rebuilding data after a failure, if possible.“
  [V12]. Konkrétní procento pro CPU/RAM (HA admission control na výpadek racku) dokumentace neuvádí. VCF-CLS-RCMD-
  CFG-001 počítá s výpadkem jednoho **hostu** [V8].

### 6.5 Co se stane při výpadku racku
1. Data zůstanou dostupná: komponenty (repliky + witness) jsou v různých FD. „Allows workload VMs to tolerate a rack
   failure by distributing copies of the data and witness components on nodes in separate racks.“ [V1]
2. vSphere HA restartuje VM na hostech v jiných rackách *(parafráze „workloads can automatically restart affected
   virtual machines on ESX hosts in other racks“)* [V1].
3. CPU a RAM racku zmizí z clusteru [V13].
4. **3 racky**: redundance ano, ale „will not provide automatic rebuild of vSAN components“ [V1]. Data nejde znovu
   ochránit [V13].
5. **≥ 4 racky** (s volnou kapacitou): vSAN objekty lze znovu ochránit (re-protect) po výpadku jednoho racku [V1][V12].
6. NSX Edge (Rack Fault Tolerant model): N-S služby běží dál na Edge uzlech v jiných rackách. „Mobility is not
   supported across racks.“ [V25]

## 7. Síťový provoz

### 7.1 Rozsah VLAN/subnetů podle fabric modelu
Obecné pravidlo: L2 – „The networks are stretched across racks using a single broadcast domain for each
network.“ L3 – „The networks are isolated to a rack using a separate broadcast domain for each network per
rack.“ [V20]

| Síť | Single-Rack [V21] | Multi-Rack L2 [V22][V1][V8] | Multi-Rack L3 [V22][V1][V9] |
|---|---|---|---|
| Management VM appliances | Rack local, HA gateway, MTU 1500/1500 | across racks, gateway HA across racks | per rack (VLAN lokální na ToR, subnet per rack, HA gateway na ToR) [V9]; volitelně stretch L2 mezi racky „to support management components“ [V22] |
| ESX management VMK | (extrakce nečitelná) | stretched (obecné pravidlo [V20]) | **Rack Local**, gateway „Highly Available, Within a Rack“, 1500/1500 [V22] |
| vSAN VMK | dedikovaná VLAN, 1 subnet (VCF-VSAN-NET-REQD-CFG-002/003 ve Single-Rack ESA modelu, `10-planning` [P15]; v multi-rack modelu zní REQD-CFG-002 „VLAN design depends on the multi-rack L2 or L3 design“ *(parafráze)* [V1]); MTU min. 1500 (VCF-NET-REQD-MTU-004), doporučeno 9000 (VCF-NET-RCMD-MTU-003) [V20] | stretched (obecné pravidlo [V20]) | **per rack** subnet + gateway (VCF-VSAN-L3MR-RCMD-CFG-002, VCF-VSAN-NET-RCMD-CFG-006) [V1] |
| vMotion VMK | (nečitelné) | stretched (obecné pravidlo [V20]) | per rack (obecné pravidlo [V20]) |
| Host TEP (Geneve) | MTU min. 1700 | stretched (obecné pravidlo [V20]) | **per rack**: uplink profile, IP pool + subnet + gateway, sub-TNP (REQD); vlastní transport VLAN (RCMD) [V9][V10] |
| NSX Edge TEP / uplinks / mgmt | Edge mgmt rack local | RFT Edge model: Edge sítě omezené na lokální rack (VCF-NSX-EDGE-RCMD-COMSAZ-020) [V24]; pozor Otevřené otázky 13 | dtto [V25]; BGP jen s lokálními ToR |
| NFS | – | „Not supported.“ (vSAN multi-rack model) | „Not supported.“ |

Poznámky:
- VM segmenty musí být „equally accessible to all ESX hosts within the vSphere cluster“ se stejným VLAN ID ve všech
  rackách/AZ *(parafráze)* [V20].
- Scope VLAN: „Global across AZs“ / „Availability Zone Local“ / „Rack Local“ [V20].
- Fabric typy: L3 – „CLOS Network Fabric (Leaf-Spine/Superspine)“, VLAN „Unique per rack“. L2 – „Campus-style
  Network Fabric (Core–Aggregation–Access)“ [V23] (mapování z rozházené tabulky, viz Otevřené otázky 7).
- Řádek NFS „Not supported.“ je odvozen z rozházené tabulky [V1] (Otevřené otázky 7).

### 7.2 Toky (pro vizualizaci)
| Odkud | Kam | Typ provozu | Cesta L2 / L3 | Zdroj |
|---|---|---|---|---|
| ESX (vSAN VMK) rack A | ESX (vSAN VMK) rack B | vSAN replikace (synchronní) + witness komponenty | L2: stejný subnet přes fabric. L3: routováno přes ToR/leaf → spine | [V1][V5] |
| ESX (vSAN VMK) | ESX v ostatních rackách | resync / rebuild po výpadku racku (jen ≥ 4 FD) | dtto | [V1][V12] |
| ESX | vSAN gateway vlastního racku | HA isolation check (ICMP), VCF-VSAN-L3MR-REQD-CFG-001 / VCF-VSAN-REQD-CFG-006 | lokální ToR SVI | [V1] |
| ESX (Host TEP) | ESX / Edge TEP v jiných rackách | Geneve overlay; L3: TEP subnety per rack, routováno | ToR → spine | [V9][V22] |
| ESX (vMotion VMK) | ESX v jiném racku | vMotion (např. HA/DRS po výpadku) | L2 stretched / L3 routováno | [V22] |
| NSX Edge | lokální ToR | BGP peering (+ BFD); „Avoid BGP peering across racks.“ | jen lokální rack | [V24][V25] |
| vSAN Compute Cluster | vSAN Storage Cluster | remote datastore, < 5 ms | L3 routováno | [V3] |

**Porty:** konkrétní porty vSAN, vMotion a Geneve povolené zdroje v textu neuvádějí. TechDocs odkazuje na portál
Ports and Protocols (viz `00-architektura` 7, [S28]). Doplnit (Otevřené otázky 8).

---

## 7a. Dopady pro hru

Jen pravidla z dokumentace výše. Co je odvozené, je tak označené.

1. **Cluster model odvodit z fyzického umístění hostů.** Hosty clusteru v jednom racku → Single-Rack (1 storage
   FD, bez ochrany proti výpadku racku) [V6]. Hosty ve více rackách → Multi-Rack (L2 nebo L3 podle sítě) *(odvozeno:
   „Hosts are installed horizontally across physical racks“ [V8][V9])*.
2. **Multi-Rack vSAN**: vynutit **≥ 3 racky**, doporučit **4** [V1]. Každá FD musí mít ≥ 1 host [V13]. Doporučení
   „stejný počet hostů v každém racku“ a „jedna FD volné kapacity“ zobrazit jako **varování**, ne jako blokaci
   [V12][V13].
3. **Fault domains nejsou automatické.** Po vytvoření clusteru (a po každém přidání hostu) musí hráč ve vSphere
   Clientu ručně vytvořit FD a zařadit hosty. Dokud to neudělá, každý host je samostatná FD. Hosty jednoho racku pak
   nejsou seskupené a ochrana proti výpadku racku chybí *(odvozeno z [V12][V29]; bez FD vSAN „might store both replicas of
   an object with hosts in the same rack enclosure“ [V12])*. Výjimka: při 1 hostu na rack stránka [V29] FD nevyžaduje („with more
   than one ESX node per rack“).
4. **Policy vs. počet FD**: FTT=n potřebuje 2n+1 FD (FTT=1 → 3, FTT=2 → 5). Při nedostatku hláška „There are
   currently [X] usable fault domains. The operation requires [Y] more usable fault domain.“ [V13][V33]
5. **Multi-rack checklist** (VCF-VSAN-L3MR-REQD-CFG-004/005): vypnout auto policy management, vytvořit vlastní
   default policy podle počtu racků, nezapínat Reserved Capacity [V1][V26].
6. **Simulace výpadku racku**: 3 racky = data dostupná, HA restart VM, ale žádný rebuild. ≥ 4 racky s volnou
   kapacitou = rebuild/re-protect [V1][V13].
7. **Síť per model**:
   - L2: sítě roztažené přes racky, jedna broadcast doména pro každou síť, HA gateway přes racky [V20][V22].
   - L3: pro **každý rack** vlastní VLAN + subnet + HA gateway na ToR (minimálně ESX mgmt [V22] a VM mgmt [V9]; vSAN
     per rack podle VCF-VSAN-L3MR-RCMD-CFG-002 [V1]). Per rack také NSX uplink profile, Host TEP IP pool a sub-TNP
     (REQD) [V9][V10]. vSAN gateway racku = HA isolation address (REQD) [V1].
   - ToR: každý host ≥ 1 switch (blokace), doporučeno ≥ 2 ToR (varování) [V23].
8. **Omezení domén**: L3 multi-rack zakázat pro default cluster management domain [V6]. Multi-rack vSAN storage
   model pro default cluster mgmt domény je „Non Supported“ [V5] (pozor na Otevřené otázky 1). L3 nelze
   stretchnout [V6]. NFS v multi-rack vSAN modelu „Not supported.“ (s výhradou, Otevřené otázky 7) [V1].
9. **Blueprinty**: žádný oficiální blueprint 9.1 multi-rack nevolí. Multi-rack je tedy volba Sandboxu nebo Day 2
   (nový cluster / WLD), ne startovní blueprint (`06-blueprints`).
10. **Rozšíření clusteru**: nový host musí do FD svého racku. U L3 musí mít Host TEP pool racku volné IP [V29][V32].

---

## 8. Otevřené otázky

1. **Multi-Rack L2 v default clusteru management domain vs. storage model.** Cluster model L2 je pro default cluster
   „supported“ [V6][V35]. Storage model „Multi-Rack vSAN“ je ale pro default cluster „Non Supported“ [V5] a stránka
   L2 cluster modelu nabízí jen „Single-Rack vSAN ESA/OSA“, FC a NFS [V8]. Jde tedy o L2 cluster bez vSAN fault
   domains, nebo o fault domains nastavené ručně po bring-upu? Nevyjasněno.
2. **VCF Installer a fault domains**: umí bring-up nastavit FD nebo multi-rack L2 topologii? Povolené zdroje nic
   neuvádějí. Známé je jen „manually in vCenter after cluster expansion“ [V1].
3. **[9.1] Jak se nasazuje L3 multi-rack WLD**: stránka [V26] neuvádí, zda UI (VCF Operations wizard) nebo API.
   Wizard „Create a New Workload Domain“ [V37] neuvádí per-rack network profiles ani IP pooly. V 9.0 jde o API
   [V30]. Nevyjasněna je i vazba na **network pools per rack** při commissioningu hostů.
4. **RAID-5 minimum**: tabulka ESA uvádí RAID-5 2+1 = 3 hosty, text stejné stránky „four or more fault domains“
   [V18]. Default policy page: „RAID-5 in vSAN ESA supports three ESX host clusters“, ale s auto-policy
   management 4 hosty [V17]. Pro hru: kolik FD potřebuje RAID-5 v multi-rack clusteru s fault domains?
5. **Auto-RAID (9.1) vs. fault domains**: požadavek vypnout „auto policy management“ [V1] pochází už z 9.0 [V2].
   Není jasné, zda Auto-RAID pravidlo 9.1 funguje s FD a zda multi-rack cluster po vypnutí dostane Auto-RAID.
6. **HA admission control pro výpadek racku**: dokumentace doporučuje rezervu na 1 host (VCF-CLS-RCMD-CFG-001)
   [V8]. Doporučení rezervovat CPU/RAM celého racku nebylo nalezeno.
7. **Rozházené tabulky** VLAN scope (Single-Rack / Multi-Rack network fabric [V21][V22], VLAN tabulka v [V1],
   fabric typy [V23]): řádky vSAN, vMotion, Host TEP, Edge RTEP a NFS nejsou v extrakci jednoznačné. Ověřit v PDF
   https://techdocs.broadcom.com/content/dam/broadcom/techdocs/us/en/pdf/vmware/vcf/vcf-90/vmware-cloud-foundation-9-1.pdf
8. **Porty** vSAN / vMotion / Geneve – portál Ports and Protocols (JS) nejde stáhnout. Viz `00-architektura` 7.
9. **L3 vSAN routing**: static routes nebo „Override default gateway“ pro vSAN VMK v multi-rack L3. Nalezeno jen pro
   stretched cluster, pro multi-rack ne.
10. **Počet ToR na rack**: dokumentace říká jen ≥ 1 switch na host a doporučuje ≥ 2 ToR na host [V23]. Že má
    každý rack „vlastní ToR“, vyplývá jen z textů „gateway at the ToR switches … in the rack“ a „local ToR
    switches“ [V1][V25]. Explicitní requirement chybí.
11. **NSX Edge RFT – ID**: stránka L2 uvádí pod ID VCF-NSX-EDGE-REQD-RFTL2-001 dva různé texty („Deploy two (2) or
    more NSX Edge nodes…“ a „evenly deployed across different racks“). Stejně tak 2× VCF-VSAN-COMP-CLU-REQD-CFG-001
    [V3]. Jde o chyby dokumentace.
12. **Ostatní vSAN témata** (mimo aktuální rozsah): ESA/OSA architektura, vSAN Storage Cluster (min. 4 uzly – viz
    `10-planning`), stretched vSAN a witness, File Services, encryption, sizing kapacity, upgrade vSAN. Doplnit
    v dalších iteracích 50-vsan.
13. **Edge uplink v L2 multi-rack**: VLAN tabulka vSAN modelu uvádí pro „NSX Edge Uplink01“ „Shared across racks“
    [V1]. Rack Fault Tolerant Edge model ale doporučuje „Limit the span of NSX Edge node networks to the local
    racks.“ (VCF-NSX-EDGE-RCMD-COMSAZ-020) [V24]. Co má hra vynutit?

## 9. Zdroje

- [V1] Multi-Rack vSAN Storage Model (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/storage-models-9-x/standard-vsan-storage-model/vsan-compute-cluster-storage-models/vsan-multirack-model.html
- [V2] Multi-Rack vSAN Storage Model (9.0): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/design/design-library/storage-models-9-x/standard-vsan-storage-model/vsan-compute-cluster-storage-models/vsan-multirack-model.html
- [V3] Multi-Rack vSAN Compute Cluster Storage Model (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/storage-models-9-x/standard-vsan-storage-model/vsan-compute-cluster-storage-models/vsan-multirack-compute-cluster-model.html
- [V4] vSAN Storage Models (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/storage-models-9-x/standard-vsan-storage-model.html
- [V5] Storage Models – concepts (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/vmware-cloud-foundation-concepts/storage-models.html
- [V6] vSphere Cluster Models – concepts (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/vmware-cloud-foundation-concepts/vsphere-cluster-models.html
- [V7] vSphere Cluster Models – concepts (9.0): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/design/vmware-cloud-foundation-concepts/vsphere-cluster-models.html
- [V8] Multi-Rack Layer 2 vSphere Cluster Model (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/cluster-models/multi-rack-cluster-detailed-design/layer-2-multi-rack-cluster.html
- [V9] Multi-Rack Layer 3 vSphere Cluster Model (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/cluster-models/layer-3-multi-rack-cluster.html
- [V10] Layer 3 Multi-Rack Cluster Model (9.0): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/design/design-library/cluster-models/multi-rack-cluster-detailed-design/layer-3-multi-rack-cluster.html
- [V11] Multi-Rack vSphere Cluster Detailed Design (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/cluster-models/multi-rack-cluster-detailed-design.html
- [V12] Designing and Sizing vSAN Fault Domains (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/vsan-deployment-administration-and-monitoring/vsan-planning-and-deployment/designing-and-sizing-a-virtual-san-cluster/designing-and-sizing-virtual-san-fault-domains.html
- [V13] Managing Fault Domains in vSAN Clusters (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/vsan-deployment-administration-and-monitoring/administering-vmware-vsan/expanding-and-managing-a-vsan-cluster/managing-fault-domains-in-vsan-clusters.html
- [V14] Create a New Fault Domain in vSAN Cluster (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/vsan-deployment-administration-and-monitoring/administering-vmware-vsan/expanding-and-managing-a-vsan-cluster/managing-fault-domains-in-vsan-clusters/create-a-new-fault-domain-in-vsan-cluster.html
- [V15] Tolerate Additional Failures with Fault Domains (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/vsan-deployment-administration-and-monitoring/administering-vmware-vsan/expanding-and-managing-a-vsan-cluster/managing-fault-domains-in-vsan-clusters/tolerate-additional-failures-with-fault-domains-in-vsan-cluster.html
- [V16] What are vSAN Policies (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/vsan-deployment-administration-and-monitoring/administering-vmware-vsan/using-vsan-policies/about-vsan-policies.html
- [V17] What are vSAN Default Storage Policies (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/vsan-deployment-administration-and-monitoring/administering-vmware-vsan/using-vsan-policies/about-the-vsan-default-storage-policy.html
- [V18] Selecting the Best RAID Configuration for a vSAN Storage Cluster (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/vsan-deployment-administration-and-monitoring/administering-vmware-vsan/increasing-space-efficiency-in-a-vsan-cluster/using-raid-5-6-erasure-coding-in-vsan-cluster.html
- [V19] What's New – vSAN (VCF 9.1 Release Notes): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/release-notes/vmware-cloud-foundation-9-1-0-0-release-notes/what-s-new/whats-new-vsan.html
- [V20] Network Fabric Detailed Design (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/datacenter-network-requirements/network-fabric-design.html
- [V21] Single-Rack Network Fabric Model (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/datacenter-network-requirements/network-fabric-design/single-rack-availability.html
- [V22] Multi-Rack Network Fabric Model (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/datacenter-network-requirements/network-fabric-design/multi-rack-availability.html
- [V23] Physical Data Center Network Design (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/datacenter-network-requirements/physical-datacenter-design-9-x.html
- [V24] Rack Fault Tolerant NSX Edge Cluster – Layer 2 vSphere Clusters across Racks (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/design-library-nsx-edge-cluster/nsx-edge-cluster-models-for-single-availability-zone/rack-fault-tolerant-design-single-layer-2-vsphere-clusters-deployed-across-multiple-racks.html
- [V25] Rack Fault Tolerant NSX Edge Cluster – Layer 3 vSphere Clusters across Racks (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/design-library-nsx-edge-cluster/nsx-edge-cluster-models-for-single-availability-zone/rack-fault-tolerant-design-single-layer-3-vsphere-clusters-deployed-across-multiple-racks.html
- [V26] Create and Configure a Workload Domain with a Layer 3 Multi-Rack vSAN HCI Cluster (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/building-your-private-cloud-infrastructure/working-with-workload-domains/deploy-a-l3-multi-rack-vsan-vi-workload-domain.html
- [V27] Deactivate Auto Policy Management for vSAN ESA Cluster (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/building-your-private-cloud-infrastructure/working-with-workload-domains/deploy-a-l3-multi-rack-vsan-vi-workload-domain/disable-vsan-auto-policy-management.html
- [V28] Create and Assign a New Default Storage Policy for vSAN ESA Cluster (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/building-your-private-cloud-infrastructure/working-with-workload-domains/deploy-a-l3-multi-rack-vsan-vi-workload-domain/create-and-assign-a-new-default-vsan-storage-policy.html
- [V29] Create vSAN Fault Domains (WLD, 9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/building-your-private-cloud-infrastructure/working-with-workload-domains/deploy-a-l3-multi-rack-vsan-vi-workload-domain/create-vsan-fault-domain.html
- [V30] Create a Workload Domain with a Layer 3 Multi-Rack vSAN HCI Cluster – API (9.0): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/building-your-private-cloud-infrastructure/working-with-workload-domains/create-a-workload-domain-by-using-the-vcf-operations-api/deploy-a-l3-multi-rack-vsan-vi-workload-domain/deploy-a-workload-domain-with-a-3-three-multi-rack-vsan-hci-cluster.html
- [V31b] Move ESX Host into Selected Fault Domain (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/vsan-deployment-administration-and-monitoring/administering-vmware-vsan/expanding-and-managing-a-vsan-cluster/managing-fault-domains-in-vsan-clusters/move-hosts-into-selected-fault-domain-in-vsan-cluster.html
- [V32] Add an ESX Host to an SDDC Cluster in a VCF Domain (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/building-your-private-cloud-infrastructure/working-with-workload-domains/expand-a-workload-domain/add-a-host-to-a-vsphere-cluster-using-the-sddc-manager-ui.html
- [V33] KB 326856 – „There are currently [X] usable fault domains…“: https://knowledge.broadcom.com/external/article/326856/vsan-creatingreverting-snapshots-fails.html
- [V34] KB 388397 – „There are currently 2 usable fault domains…“: https://knowledge.broadcom.com/external/article/388397/error-there-are-currently-2-usable-fault.html
- [V35] Management Domain Model (9.1) (= `05-design` [D5]): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/workload-domain-deployment-models/management-domain-deployment-model.html
- [V36] Workload Domain Model (9.1) (= `05-design` [D6]): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/workload-domain-deployment-models/workload-domain-deployment-model.html
- [V37] Create a New Workload Domain (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/building-your-private-cloud-infrastructure/working-with-workload-domains/deploy-a-vi-workload-domain-using-the-sddc-manager-ui.html
- [S16], [S28]: viz `00-architektura` (VCF Fleet Deployment Models 9.1; vSAN Network Port Requirements 9.1).
