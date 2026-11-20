# 20 – Deployment, Convergence, and Upgrade

> Modelovaná verze: **VCF 9.1.1** (viz `docs/spec/VERSION.md`). Rozdíly 9.0 vs 9.1 jsou označeny **[9.0]** / **[9.1]** / **[9.1.1+]**.
> Primární zaměření: **bring-up první VCF Instance (management domain) v nové VCF fleet** pomocí VCF Installer.
> Odkazy `[Sxx]` vedou na konkrétní stránky TechDocs / KB – seznam je v sekci 9. Zdroje.
> Stav výzkumu: 2026-11-20.

---

## 1. Shrnutí

- Sekce TechDocs „Deployment, Convergence, and Upgrade“ popisuje tři cesty k prostředí 9.1.x: **nové nasazení** (VCF fleet, VCF Instance nebo vSphere Foundation) pomocí **VCF Installer** na předinstalované ESX hosty, **konvergenci** (existující vSphere/Aria infrastruktura se stane stavebním blokem VCF/VVF) a **upgrade** z VCF 5.2.x / 9.0.x (a vSphere 8 / Aria 8) na 9.1.x [S1][S2].
- Návod v této sekci pokrývá **jen management domain**; verze management domain určuje verzi celé VCF Instance. Workload domény (vytvoření, import vCenter, upgrade) se řeší až potom v jiných sekcích [S2].
- VCF 9.1.1 lze nasadit **přímo** (bez nasazení 9.1.0 a následného patchování) [S2][S30].
- **VCF Installer** je virtuální appliance (OVA `VCF-SDDC-Manager-Appliance-<version.build_number>.ova`), ke které se přistupuje přes web UI `https://installer_appliance_FQDN` jako `admin@local` [S6]. Nasazení se dělá buď průvodcem (**Deployment Wizard**), nebo nahráním **JSON specifikace** (**Deploy Using JSON Spec**) [S4][S14][S15].
- Předchůdce: ve VCF 5.2 tuto roli měl **VMware Cloud Builder**; od 9.0 je to **VCF Installer** [S3].
- Pokud je VCF Installer nasazen na ESX hostu, který bude součástí management domain, po nasazení se přepne do **SDDC Manager mode** a už nemůže sloužit jako installer [S6].
- Celý proces nového nasazení má tři fáze: **Preparation → Deployment → Post-deployment** [S4].

## 2. Komponenty a vztahy

### 2.1 Co VCF Installer nasazuje (nová VCF fleet / první instance)

Tabulka podle stránky „Deploying a New VCF or vSphere Foundation Platform“ [S4]. Stránka má záhlaví „VMware Cloud Foundation“ (sloupce Simple, High Availability) a „vSphere Foundation“; výpis obsahuje u každého řádku tři hodnoty, interpretace sloupců jako **VCF Simple / VCF HA / VVF** je naše (viz Otevřené otázky).

| Skupina | Komponenta / uzel | VCF Simple | VCF HA | VVF |
|---|---|---|---|---|
| VMware vCenter | vCenter | Yes | Yes | Yes |
| VCF Operations | Primary Node | Yes | Yes | Yes |
| VCF Operations | Replica Node | No | Yes | No |
| VCF Operations | Data Node | No | Yes | No |
| Cloud proxy | – | Yes | Yes | No |
| License server | – | Yes | Yes | Yes |
| VMware NSX | NSX Manager Node 1 | Yes | Yes | No |
| VMware NSX | NSX Manager Node 2 / Node 3 | No | Yes | No |
| VCF Automation* | Node 1 | Yes | Yes | No |
| VCF Automation* | Node 2 / Node 3 | No | Yes | No |
| SDDC Manager | SDDC Manager | Yes | Yes | No |
| VCF management services | VCF services runtime, Fleet lifecycle, SDDC lifecycle, Software depot | Yes | Yes | Yes* |
| VCF management services | Identity broker, Salt RaaS, Salt master | Yes | Yes | No |
| VCF management services | Telemetry | Yes | Yes | Yes |

\* Položky označené hvězdičkou lze při prvním nasazení přeskočit a nasadit později jako Day-N operaci [S4].

Poznámka k Data Node: pole FQDN datového uzlu se v průvodci zobrazí jen pro HA s velikostí Medium nebo Large [S14][S19].

**[9.1]** VCF Installer při novém nasazení nasazuje výchozí sadu VCF management services: VCF services runtime, fleet lifecycle, identity broker, software depot, Salt RaaS, telemetry a license server [S32].

### 2.2 Co VCF Installer nenasazuje (post-deployment) [S4][S18]

| Komponenta | VCF Simple | VCF HA | VVF | Kdo/čím |
|---|---|---|---|---|
| VCF Operations for networks – Platform Node, Collector Node 1 | Yes | Yes | No | VCF Operations [S18] |
| VCF Operations for networks – Collector Node 2 | No | Yes | No | VCF Operations [S18] |
| VCF Operations orchestrator – Primary Node | Yes | Yes | Yes | ručně [S4][S18] |
| VCF Operations orchestrator – Secondary Node 1, 2 | No | Yes | Yes | ručně [S4][S18] |
| Log management | Yes | Yes | Yes | VCF Operations [S18] |
| Real-time metrics | Yes | Yes | No | VCF Operations [S18] |
| VCF Operations HCX (volitelné) | – | – | – | VCF Operations [S18] |

Pořadí dokončovacích kroků podle [S18]: Log Management → VCF Operations for Networks → Real-Time Metrics → VCF Operations Orchestrator → (volitelně) VCF Operations HCX.

### 2.3 Role komponent a úroveň (fleet / instance / domain) [S3]

| Komponenta | Role (zkráceně) | Úroveň / umístění (VCF) |
|---|---|---|
| VCF Operations | celková provozní platforma | fleet |
| Cloud proxy | lokální sběr a monitoring dat | součást VCF Operations; management domain |
| License server | správa licencí | součást VCF Operations; management domain |
| SDDC Manager | lifecycle ESX/vCenter/HCX/NSX, nasazení workload domén, import vCenter, vSAN stretched | součást VCF Operations; management domain |
| NSX Manager | síťování | jeden na doménu |
| vCenter | – | jeden na doménu |
| Fleet lifecycle | orchestrace lifecycle napříč fleet (sekvence upgradů instancí) | první VCF Instance |
| Identity broker | SSO přes IdP | první instance; další volitelně (Day-N) |
| Salt RaaS | desired-state konfigurace a politiky | první instance |
| Software depot | binárky pro install/upgrade/patch, OCI images | první instance; další volitelně (Day-N) |
| Salt Master, SDDC lifecycle, Telemetry, VCF services runtime | vynucení stavu / lifecycle mgmt komponent / telemetrie / kontejnerový runtime | každá instance |
| Log management | logy | první instance (Day-N) |
| Real-time metrics | vysokofrekvenční metriky | každá instance (Day-N) |

VCF services runtime na první VCF Instance hostí fleet-level komponenty i komponenty této instance; každá další instance má vlastní runtime pro instance-level služby [S3].

### 2.4 Mapování názvů 5.2 → 9.0 → 9.1 [S3]

| 5.2 | 9.0 | 9.1 |
|---|---|---|
| VMware Cloud Builder | VCF Installer | VCF Installer |
| VMware Aria Operations | VCF Operations | VCF Operations |
| VMware Aria Operations for logs | VCF Operations for logs | Log management |
| VMware Aria Suite Lifecycle | VCF Operations fleet management | Fleet lifecycle and SDDC lifecycle |
| Workspace ONE Access | VCF Identity Broker | Identity broker |
| VMware Aria Automation | VCF Automation | VCF Automation |
| VMware Aria Automation Orchestrator | VCF Operations orchestrator | VCF Operations orchestrator |
| VMware Cloud Director | N/A | VCF Automation |

### 2.5 Závislosti a varianty nasazení

- **Deploy a new VCF fleet**: první instance; lze nasadit novou VCF Operations nebo se připojit k existující [S14].
- **Deploy a new VCF Instance** (do existující fleet): je nutné připojit se k existující VCF Operations [S14].
- **[9.1.1+]** VCF Operations musí být v management domain první VCF Instance; pokud se zvolí existující VCF Operations, je vždy zaškrtnuto i „I have an existing vCenter instance“ (tj. konvergence) [S14][S28].
- Identity broker je povinný jen pro primární VCF Instance (v JSON ho lze u dalších instancí vynechat) [S15].
- Hodnoty `workflowType` v JSON: `VCF` (nová fleet / konvergence do nové fleet), `VCF_EXTEND` (nová instance / konvergence do nové instance), `VCF_COMPLETE` (deferred komponenty), `VVF` [S15].

## 3. Prerekvizity

### 3.1 Obecné (před nasazením) [S5]
1. Nasadit a nakonfigurovat potřebnou infrastrukturu (planning sekce ve VCF Installer nebo **Planning and Preparation Workbook**).
2. Projít prerekvizity (stránka prerekvizit ve VCF Installer nebo checklist ve Workbooku).
3. Nainstalovat (image) ESX hosty.
4. Stáhnout VCF Installer appliance z Broadcom Support Portal.
5. Bez přímého přístupu na Internet: VCF download tool → offline depot, nebo ruční přenos binárek.
6. „Use the latest available binaries for components when you deploy, upgrade, and patch.“ [S5]

Planning and Preparation Workbook je Excel soubor (verze pro 9.1.0 a 9.1.1) pro sběr vstupů fleet [S36]. **[9.1]** Integrovaný planning workflow v UI installeru generuje požadavky na CPU, paměť, úložiště, VLAN a FQDN a validuje je proti cílové infrastruktuře [S32].

### 3.2 ESX hosty [S7][S8][S9][S10][S11]
- Verze ESX podle VCF Release Notes; pokud ISO pro danou verzi na portálu není (typicky patch), async patch nebo OEM → custom ISO (VCF PowerCLI nebo vSphere Lifecycle Manager) [S7][S8].
- Počet hostů závisí na typu úložiště a deployment modelu – určí se v planning sekci installeru nebo ve Workbooku [S7]. Konkrétní minima viz 6. Limity a Otevřené otázky.
- VCF **nepodporuje stateless** ESX hosty [S7].
- Počáteční nasazení management domain **nepodporuje heterogenní clustery** – všichni hosté v prvním clusteru musí mít jednotný HW profil [S7].
- Všichni ESX hosté v management domain musí být od **jednoho HW vendora** [S7].
- Od VCF 9.0.1 lze pro vSAN ESA použít necertifikované ESA disky – **jen pro proof-of-concept** (KB 408300) [S7].
- Před nasazením musí být `vmk0` připojen k jedné management NIC na **vSphere Standard Switch** (např. vmnic0); installer během nasazení hosty migruje na vSphere Distributed Switch a přidá uplinky [S9].
- Na každém hostu: statická IPv4 (volitelně IPv6 pro dual-stack), management VLAN ID, DNS servery, FQDN hostname; v „Custom DNS Suffixes“ nesmí být žádné sufixy [S9].
- NTP nakonfigurován a služba běží [S10].
- Self-signed certifikát **regenerován po nastavení hostname** (původní má CN `localhost.localdomain`); FQDN musí odpovídat hodnotě zadané v průvodci, protože installer kontroluje CN certifikátu [S11].
- Pokud firemní politika vyžaduje CA-signed certifikáty → samostatný postup „Configure ESX Hosts with Signed Certificates“ [S7].
- Pokud installer poběží na management hostu s NFS v3 úložištěm → nejprve „Mount NFS Datastore to an ESX Host“ [S7][S14].

### 3.3 VCF Installer appliance [S6]
- OVA: `VCF-SDDC-Manager-Appliance-<version.build_number>.ova` (Broadcom Support Portal).
- Zdroje VM: **4 vCPU, 16 GB RAM, 914 GB storage** [S6] (stejné hodnoty uvádí i 9.0 [S35]).
- Statická IP, DNS záznamy a FQDN appliance musí být platné a resolvovatelné.
- Konektivita na management VLAN použitou při nasazení; VCF management network musí mít konektivitu na appliance.
- Appliance musí dosáhnout na ESX hosty, VM management network a externí služby (DNS, NTP) [S5][S6].
- Pro průvodce: **VCF Installer 9.1.1 nebo novější** [S14][S15].

### 3.4 Binárky [S12]
Pro nové nasazení VCF (16): Cloud proxy, Fleet lifecycle, Identity broker, License server, Migration service engine, Salt master, Salt RaaS, SDDC lifecycle, SDDC Manager, Software depot, Telemetry, VCF Automation, VCF Operations, VCF services runtime, VMware NSX, VMware vCenter.
Pro VVF (8): Fleet lifecycle, License server, SDDC lifecycle, Software depot, Telemetry, VCF Operations, VCF services runtime, VMware vCenter.
- Při znovupoužití existujících komponent nejsou potřeba všechny binárky.
- I když se VCF Operations a VCF Automation odkládají (custom networking), jejich binárky se musí stáhnout [S12].

Online depot navíc vyžaduje: účet ve **VCF Business Services console** s dostatečnou rolí, dostupné URL (KB 327186), proxy bez Kerberos/NTLMv2; při SSL/TLS interception přidat CA proxy do truststore software depotu (KB 442978) [S13].

### 3.5 DNS / FQDN / IP [S19][S20][S14]
- Každé FQDN musí mít funkční **forward (A) i reverse (PTR)** záznam; top-level doména jen ASCII písmena [S20].
- FQDN **malými písmeny**, **ne `.local`**; každé FQDN na unikátní, nepřidělenou IP mimo rozsahy VCF management services [S14][S19].
- Dual-stack je nastavení na úrovni domény; FQDN dual-stack komponent musí resolvovat na IPv4 i IPv6 [S20].
- VCF services runtime: minimálně **12 IP**, doporučeno rezervovat **30** [S19].
- VCF Automation: **5 IP** (3 pro nové uzly, 2 buffer) [S19]. **[9.0]** HA VCF Automation potřebovalo 4 IP (3 aktivní + 1 rezerva pro upgrady); IP uzlů nepotřebují DNS záznamy [S34].
- Interní CIDR VCF services runtime: výchozí `198.18.0.0/15`, alternativy `240.0.0.0/15` nebo `250.0.0.0/15` [S19][S21].
- Pokud se použije externí load balancer pro VCF Operations, musí být nasazen a nakonfigurován předem [S14].

### 3.6 Hesla
- VCF Installer root a local user heslo: min. **15 znaků**, aspoň 1 velké, 1 malé písmeno, 1 číslice, 1 speciální znak z `@ ! # $ % ? ^`; nesmí obsahovat slovníkové slovo (ani jeho část) ani uživatelské jméno (ani jeho část). Nevyhovující heslo způsobí selhání nasazení [S6].
- **[9.1]** Volba **Autogenerate passwords** v průvodci (hesla se získají po startu nasazení) [S14][S32]. **[9.0]** Auto-generovaná hesla: 20 znaků, min. 1 speciální, 1 číslice, 1 velké písmeno, speciální znaky `! @ # $ ^`, max. 2 stejné znaky za sebou [S34].
- **[9.0]** Všichni ESX hosté musí mít v průvodci společné heslo, jinak JSON spec [S34]. Pro 9.1 stránka uvádí jen „ESX hosts require passwords with predefined requirements“ [S14].
- **[9.0]** V ručně zadaném root/administrator hesle vCenter nepoužívat znak `%` [S34].
- Konvergence vCenter 8.0 U3: installer vyžaduje root heslo vCenter **15–20 znaků** (známá chyba, viz 5.) [S31].

## 4. Workflow

### 4.1 Fáze Preparation (pořadí dle [S5])
1. Review prerequisites (installer nebo Workbook).
2. Image ESX hosts.
3. Deploy VCF Installer appliance.
4. Download binaries to VCF Installer.

#### 4.1.1 Instalace ESX z ISO [S8]
1. Připojit ESX ISO a restartovat stroj.
2. V BIOS/UEFI nastavit boot z ISO.
3. Welcome screen → **Enter**.
4. EULA → **Enter**.
5. „Select a Disk to Install or Upgrade“ → vybrat disk → **Enter**.
6. Zvolit typ klávesnice.
7. Zadat root heslo.
8. „Confirm Install“ → **F11**.
9. „Installation Complete“ → **Enter** (reboot).
10. Nastavit první boot device na disk s ESX.
11. Opakovat pro všechny hosty.

#### 4.1.2 Síť na ESX (DCUI) [S9]
1. Konzole → **F2** → přihlásit root.
2. „Configure Management Network“ → „VLAN (Optional)“ → ESX Management Network VLAN ID.
3. „IPv4 Configuration“ → „Set static IPv4 address and network configuration“ → IPv4 Address, Subnet Mask, Default gateway.
4. (dual-stack) „IPv6 Configuration“ → statická IPv6, CIDR, gateway.
5. „DNS Configuration“ → „Use the following DNS Server address and hostname“ → Primary DNS, Alternate DNS, Hostname (FQDN).
6. „Custom DNS Suffixes“ → ověřit, že žádné nejsou.
7. **Esc** → **Y** pro potvrzení. Opakovat na každém hostu.

#### 4.1.3 NTP na ESX [S10]
(„after you have configured the Virtual Machine Network port group“)
1. VMware Host Client → **Host > Configure > Time Configuration**.
2. **Network Time Protocol** → **EDIT** → zaškrtnout **Enable** → **NTP Server FQDN or IP Address** → **OK**.
3. Ověřit, že NTP služba běží. Opakovat na všech hostech.

#### 4.1.4 Regenerace self-signed certifikátu [S11]
1. Host Client → **Actions > Services > Enable Secure Shell (SSH)**.
2. SSH na host; `esxcli system hostname get` (případně `esxcli system hostname set --fqdn=NEW_FQDN`).
3. `/sbin/generate-certificates`.
4. Reboot hostu.
5. Host Client → **Disable Secure Shell (SSH)**. Opakovat na všech hostech.

#### 4.1.5 Nasazení VCF Installer (přes VMware Host Client na ESX) [S6]
1. Přihlásit se do VMware Host Client.
2. **Host > Actions > Deploy OVF Template**.
3. **Select an OVF template**: jméno VM + OVA → Next.
4. **Review details** → Next.
5. **License agreements**: „I accept all license agreements“ → Next.
6. **Select Storage**: disk format **Thin Provision**; datastore – mimo management infrastrukturu libovolný, na management hostu **lokální disk** (po konfiguraci storage management domain se appliance přesune Storage vMotion a přepne do SDDC Manager mode; lokální disk zůstane prázdný a nepočítá se do kapacity).
7. **Select networks**: mapování sítě.
8. **Customize template > Application**: Root user password (+confirm), Local user password (pro `admin@local` / `vcf`), Host Name (FQDN; při nasazení na management host se stane FQDN SDDC Manageru a **nelze ho později změnit**), NTP Servers.
9. **Customize template > Networking Configuration**: Select IP Address Version (IPv4 / IPv4+IPv6), Network 1 IPv4 Address, Network 1 Subnet Mask, Network Default IPv4 Gateway, (IPv6 adresa, prefix, gateway), DNS Domain Name, Domain Search Path, Domain Name Servers (max. 2).
10. **Ready To Complete** → **Finish**.

Po nasazení [S6]:
1. SSH jako `vcf` (local user password).
2. Ping na ESX hosty.
3. Forward i reverse DNS lookup každého hostu a každého NTP serveru.
4. Prohlížeč → `https://installer_appliance_FQDN` → přijmout self-signed certifikát → `admin@local` → **Log In**.

Umístění installeru [S6]:
- **Mimo management infrastrukturu** (vCenter, laptop s VMware Workstation/Fusion): lze nasadit **více** VCF/VVF platforem.
- **Na ESX hostu budoucí management domain**: jen **jedna** platforma, pak SDDC Manager mode.

#### 4.1.6 Depot a binárky [S13]
Online depot:
1. Login `admin@local` → **Depot Settings and Binary Management**.
2. **Online Depot** → **Configure**.
3. Activation code: zkopírovat software depot ID → vcf.broadcom.com (VCF Business Services console) → vybrat tenant a siteID → **Software Depot Registrations > New Registration** → získat activation code → zadat do installeru.
4. Volitelně proxy: **Enable proxy server**, HTTP/HTTPS, FQDN/IP + port, **Authenticated** (user/heslo) → **Authenticate** → zkontrolovat thumbprint → **Accept**.

Offline depot:
1. (HTTPS depot) SSH `vcf` → `su` → stáhnout certifikát `openssl s_client -connect depot_server_FQDN:443 …` → `keytool -import … -alias offline_depot_server …` → restart `sddcmanager_restart_services.sh`.
2. **Depot Settings and Binary Management** → **Offline Depot** → **Configure** → URL (+ případně **Authentication**) → **Configure**.
3. Hláška při úspěchu: „You are connected to a depot and can download installation binaries.“

Stažení:
1. **Binary Management**: vybrat produkt a verzi.
2. Seznam binárek s velikostí a stavem.
3. Vybrat → **Download**; sledovat sloupec **Download Status** (stahování + validace).

Pravidla: lze mít připojený jen **jeden typ depotu**; konfigurace offline depotu deaktivuje a smaže konfiguraci online depotu. Konfigurace depotu a autentizace se po nasazení přenese do fleet-level software depotu, **stažené binárky ne** [S13].

### 4.2 Fáze Deployment – průvodce „Deploy a new VCF fleet“ (9.1.x) [S14]

Kroky v pořadí dokumentace:

1. **Login**: `https://installer_appliance_FQDN`, `admin@local`.
2. **Deployment Wizard > VMware Cloud Foundation**; úvod → Next.
3. **Select what you want to deploy**: „Deploy a new VCF fleet“ / „Deploy a new VCF Instance“.
4. **Select the existing components**:
   - „I have an existing VCF Operations 9.1 instance“ (jen pro novou fleet; jinak se nasadí nová),
   - „I have an existing vCenter instance“ (pro novou fleet nezaškrtávat → konvergence),
   - „vCenter is registered with NSX Manager“ (→ konvergence),
   - „I have an existing VCF Automation instance or I will deploy later“ (import přes VCF Operations nebo Day-N; Aria Automation 8.x se importuje a upgraduje po nasazení).
   Installer ověří kompatibilitu zvolených komponent.
5. **Deployment model and size**: High Availability (doporučeno pro produkci) nebo Simple; platí jen pro nově nasazené appliance, nové appliance jsou FIPS-compliant. Velikosti:
   - **[9.1]** Simple: jen Small; HA: Medium (výchozí) nebo Large.
   - **[9.1.1+]** Small je výchozí pro Simple i HA; Medium a Large pro HA.
6. **Network configuration**: výchozí hodnoty nebo **Customize**:
   - VM management network (vCenter, ESX, NSX) – sdílená s ESX management nebo dedikovaná,
   - VCF management network (VCF Operations, VCF Automation) – sdílená s VM management nebo dedikovaná,
   - IP Scheme: přepínač **Dual stack networking** (jen pokud má installer dual-stack); vMotion a Storage IP scheme IPv4/IPv6,
   - „Deploy VCF Operations and VCF Automation to a specific vSphere distributed switch or NSX segment“ (jen nová fleet; přeskočí VCF Operations, cloud proxy, license server a VCF Automation; nedostupné s existující VCF Operations),
   - **[9.1.1+]** VPC Network Configuration: **Full Stack VPC** (TEP overlay; Distributed nebo Centralized connectivity) / **VLAN-Backed VPC** (TEP-less),
   - VPC Gateway Connectivity: **Centralized** (NSX Edge, konfigurace až po vytvoření domény) / **Distributed** (Transit Gateway, konfigurace na stránce NSX Manager). VPC nepodporují IPv6.
7. **Storage type** (principal storage výchozího clusteru, **nelze později změnit**):
   - vSAN ESA (volba „Allow auto claim of HCL incompatible disks“),
   - vSAN OSA (počet tolerovaných výpadků hostů, volitelně dedup + komprese),
   - vSAN data-in-transit encryption (ESA i OSA, rekey interval),
   - VMFS on Fibre Channel (datastore musí existovat a být připojen na všech hostech),
   - NFS v3 (NFS server musí existovat; volba sdílet síťovou konfiguraci s ESX management).
8. **Review the prerequisites**: seznam prerekvizit, tlačítko **PRE-FILL GENERATED FQDNs IN WIZARD**, možnost stáhnout JSON šablonu.
9. **General configuration**: Version, VCF Instance Name (unikátní, jméno adapteru ve VCF Operations), Management domain name (prefix objektů), CEIP, DNS servers, NTP servers, DNS domain name (předvyplněno z installeru), **[9.1]** Autogenerate passwords.
10. **ESX host details**.
11. **Network details**: ESX Management Network (VLAN), VM Management Network (DVPG; skryto, pokud sdílena), VCF Management Network (DVPG; skryto, pokud sdílena), VCF Management Services IP Range, VCF Automation IP Range (5 IP), vMotion Network, vSAN/NFS Network, NSX Host Overlay Network (VLAN pro TEP; **[9.1.1+]** nepotřeba pro VLAN-backed VPC), IP inclusion ranges, MTU.
12. **VCF management components**: VCF Operations primary / replica / data node FQDN, Load balancer FQDN (volitelně, jen HA), Cloud Proxy FQDN, License Server FQDN (nasazuje se jen IPv4; **[9.1.1+]** IPv6 lze nastavit po nasazení), Fleet components FQDN, Instance components FQDN, Identity broker FQDN, VCF services runtime FQDN, Internal cluster CIDR IPv4/IPv6, VCF Automation FQDN, VCF services runtime FQDN pro VCF Automation (dedikovaný).
13. **vCenter details**.
14. **Storage details**: jméno datastore (předvyplněno); u NFS v3 share path, IPv4 NFS serveru, volitelný binding na VMkernel adapter.
15. **vSphere Distributed Switch**: profil Default Configuration (1 switch) / Storage Traffic Separation (2) / NSX Traffic Separation (2) nebo Custom Switch Configuration (traffic types ESX Management, VCF Management, VM Management, vMotion, vSAN, NSX; Name, Number of uplinks; Uplink mode **VDS uplinks** nebo **VDS LAG** (LACP); mapování uplinků na pNIC; DVPG name a load balancing – výchozí „Route Based on Physical NIC Load“) → **Create Distributed Switch**.
16. **NSX Manager details** (u Distributed Connectivity: VLAN ID a Gateway CIDR IPv4 Address, musí odpovídat ToR gateway).
17. **SDDC Manager details** (předvyplněno, běží-li installer na management hostu).
18. **Review deployment information** (editace, případně stáhnout JSON, upravit a nahrát z home page).
19. **Review validation**: warnings → opravit nebo **Acknowledge**; errors → opravit podle remediation, znovu validovat.
20. **Deploy**; průběh sledovat, při chybě **Tasks** panel → opravit → retry.

**[9.0] rozdíly průvodce** [S34]: pořadí stránek bylo jiné (Existing components → General configuration (zde i deployment model a volba custom networking) → VCF Operations → VCF Automation → vCenter → NSX Manager → Storage → ESX hosts → Network → vDS → SDDC Manager → Review → Validation → Deploy); vDS profily zahrnovaly i „Storage and NSX Traffic Separation“ (3 switche); LAG uplinky šly jen přes JSON. **[9.1]** LACP/LAG je v UI a validační pre-checky kontrolují připravenost fyzické sítě na LAG [S32].

Rozsahy IP v 9.1 [S14]:
- „For deployments version 9.1.0.0 through 9.1.0.300, you specify the IP addresses as a contiguous IP range.“ (nesouvislé jen přes JSON)
- „For deployments version 9.1.0.400 and later, you can specify the IP addresses as contiguous or non-contiguous IP range.“
- Totéž platí pro 5 IP VCF Automation.

### 4.3 Deployment přes JSON spec [S15]
1. (Jen VVF bez VCF management services) SSH root → `echo 'explicit.management.components.deployment=true' >> /etc/vmware/vcf/domainmanager/application.properties` → `systemctl restart domainmanager` → `sleep 180` → `curl localhost/domainmanager/about` (očekává JSON a HTTP 200).
2. Sestavit JSON podle „VMware Cloud Foundation Installer API Reference Guide“ z dat Workbooku.
3. Login `admin@local`.
4. **Deploy Using JSON Spec** → nahrát soubor.
5. Zkontrolovat **Summary** a **JSON Preview** → Next.
6. Validace: warnings → Acknowledge / opravit; errors → opravit, případně upravit a znovu nahrát JSON.
7. **Deploy**, sledovat průběh.

Klíče JSON zmíněné na stránce: `workflowType`, `vcfOperationsSpec`, `vcenterSpec`, `vspClusterSpec` (`ipv4Pool` jako `cidr`+`excludedAddresses` / `ipRange` se `startIpAddress`,`endIpAddress` / `addresses`; `internalClusterCidrIpv4`), `vcfAutomationSpec`, `nsxtSpec`, `licenseServerSpec`, `vidbSpec`, `useExistingDeployment` [S15]. Příklad pro nové nasazení: `domainSpec-sfo-m01-example02.json`, pro konvergenci `domainSpec-sfo-m01-example03.json` [S15].

Matice scénářů (`useExistingDeployment`) [S15] – výpis tabulky byl částečně nejednoznačný; pro novou fleet: `workflowType=VCF`, VCF Operations `false`, vCenter `false`. Kompletní matice viz Otevřené otázky.

### 4.4 Post-deployment [S14][S15]
1. **Nepřesouvat** VMs VCF management services ani VCF Automation do jiného resource poolu / složky (jinak selžou pozdější patche, nasazení a scale-out).
2. Licencovat prostředí (registrace VCF Operations a license serveru ve VCF Business Services console).
3. **Review Passwords**; minulá nasazení: uživatelské menu vpravo nahoře → **Deployments**; některá hesla i přes SDDC Manager API a VCF Operations API.
4. Volitelně stáhnout JSON spec (neobsahuje hesla).
5. Nasadit zbývající komponenty (viz 2.2).
6. File-based backup SDDC Manageru a dalších komponent.
7. U HA VCF Operations přidat vSphere DRS anti-affinity pravidlo.

### 4.5 Deferred komponenty na custom networking [S17]
1. Zvolit cílovou síť: shared management network / dedicated management network / NSX overlay segment.
2. Nakonfigurovat DVPG nebo NSX segment.
3. UI: ve VCF Installer zvolit „Deploy deferred components“ a projít průvodce; nebo VCF Installer API.
Nasadí se VCF Operations, VCF Automation, cloud proxy (u NSX segmentu na VM management network) a license server. JSON: `workflowType=VCF_COMPLETE` [S15].

### 4.6 Konvergence (high-level) [S24][S26][S27][S28]
- Existující vSphere komponenty se stanou management domain nové VCF Instance (v nové nebo existující fleet); jen management domain, workload domény se importují a upgradují později ve VCF Operations [S24].
- Scénáře: vCenter + ESX; + Aria Operations; + Aria Automation; + obě (vždy volitelně vSAN a NSX) [S26].
- Minimální verze (scénář vCenter + ESX): „VMware vCenter 8.0 Update 3a“, „VMware ESX 8.0 Update 3“, „(Optional) vSAN 8.0 Update 3“, „(Optional) VMware NSX 4.2.1“ [S27].
- Postup [S27]: deploy VCF Installer → binárky → vCenter bez NSX registrace upgradovat na 9.1.x (s NSX ≥ 4.2.1 a vCenter ≥ 8.0 U3a bez upgradu) → konvergence průvodcem → pokud installer nasadil nové NSX, synchronizovat inventory (Remediate VCF Domain Configuration Drift).
- Průvodce [S28]: stejný vstup (Deployment Wizard > VMware Cloud Foundation), na „Existing Components“ se zvolí existující vCenter → skryjí se stránky **Storage**, **Hosts**, **Distributed Switch**; přibude **Existing vCenter**. Pro vCenter jen IPv4 v UI, dual-stack přes JSON. U NSX < 9.0 nelze během konvergence aktivovat Edge cluster sync.
- **[9.1]** novinky: konvergence vCenter 8.0 U3+ s NSX 4.2+ bez ručních upgradů; vCenter 8.0 U3+ bez NSX po ručním upgradu vCenter na 9.1; vCenter bez ELM s NSX Local Managers ve Federation; dual-stack vCenter [S32].
- Konvergence vSphere Foundation 9.1 s nasazenými VCF management services na VCF 9.1 **není podporována** [S2].
- Nejstarší verze komponenty určuje efektivní verzi VCF celé instance [S24].
- Podporované / nepodporované konfigurace – viz 6.3 a 5.

### 4.7 Upgrade na 9.1.x (high-level) [S29][S30][S33]
- Zdroje: VCF 9.0.x, VCF 5.2.x (sekvenční nebo skip-level; starší než 5.2 nejdřív na 5.2.x), vSphere 8 + Aria 8, VVF 5.2/9.0.x [S29].
- Pravidlo „forward-only“: cíl musí být vydán po aktuální verzi; příklady 5.2.0 → 9.1.0 ano, 5.2.4 → 9.1.0 ne, 5.2.4 → 9.1.1 ano [S24][S29].
- „requires a strict component upgrade sequence“ [S33]. Hrubé pořadí: management komponenty a management domain instance s VCF Operations → management domény ostatních instancí → workload domény kdykoli později [S29].
- Pořadí komponent (z 9.0.x) [S29]: (0) případně redeploy Identity Broker 9.0.x na management síť → VCF Operations + cloud proxy → (vSphere Replication, Live Site Recovery, vSAN Data Protection, Avi) → SDDC Manager → VCF management services + license server (nové v 9.1) → Identity Broker → VCF Automation → VCF Operations Orchestrator → VCF Operations for networks → Log management → VCF Operations HCX → Data Services Manager → NSX Global Manager → NSX Manager → vCenter → VKS/Supervisor → vSAN witness → ESX → NSX Edge + finalize → vDS → DSM databases → VMware Tools → VM compatibility → vSAN On-Disk Format → vSAN File Service.
- Z 9.1.1 RN: upgrade začíná VCF Operations na 9.1.1 [S30]. Patch 9.1.0.x → 9.1.1.x: „DO NOT use the Upgrade All button in VCF Operations UI“, dokud nejsou splněny závislosti; nejprve fleet lifecycle na 9.1.1 [S30].
- SDDC Manager UI je deprecated; po upgradu se lifecycle dělá ve VCF Operations [S29].

## 5. Chybové stavy

### 5.1 Validace průvodce / JSON [S14][S15][S28]
| Situace | Chování |
|---|---|
| Validace vrátí **warning** | „Review any warnings and either address them or click Acknowledge to proceed with deployment.“ |
| Validace vrátí **error** | „Review all failed validations and resolve the issue(s) using the remediation information provided in the error message.“ – nutné opravit a validaci spustit znovu (případně upravit a znovu nahrát JSON). Deploy je možný až po vyřešení. |
| Selže úloha během nasazení | „If there are errors, review the failed tasks in the Tasks panel, address the issue(s), and retry the deployment.“ |
| IP inclusion range | musí mít ≥ tolik adres jako hostů, bez konfliktů, ve správné VLAN, bez network/broadcast adresy [S14][S34] |
| FQDN | lowercase, ne `.local`, unikátní volná IP mimo rozsahy management services [S14] |

### 5.2 Selhání v přípravě
| Příčina | Důsledek | Zdroj |
|---|---|---|
| Heslo installeru nesplňuje pravidla | „Passwords that don't meet these rules cause the deployment to fail“ (nasazení OVA neuspěje) | [S6] |
| Nesprávné FQDN/CN certifikátu ESX (`localhost.localdomain`) | kontrola identity hostu installerem selže | [S11] |
| Proxy s Kerberos / NTLMv2 | nepodporováno | [S13] |
| SSL/TLS interception | installer nemusí navázat důvěryhodné spojení s Broadcom authorization serverem → KB 442978 | [S13] |
| Zamčený účet installeru | `systemctl restart commonsvcs`, počkat ~5 min | [S16] |
| Přesun mgmt services / VCF Automation VM do jiného resource poolu/složky | pozdější patching, nasazení a scale-out selžou | [S14] |

### 5.3 Známé problémy VCF Installer 9.1 (Release Notes) [S31]
| # | Symptom (citace) | Workaround |
|---|---|---|
| 1 | Konvergence (vCenter upgradovaný z 8.x): „Failed to bootstrap VCF services runtime“; bootstrap selže ve stage INIT0001 (ingress FQDN nelze resolvovat přes nameserver 127.0.0.1) | odstranit duplicitní `nameserver 127.0.0.1` z `/etc/resolv.conf` a z `DNS=` v `/etc/systemd/network/10-eth0.network`, restart `systemd-networkd`; po selhání opravit a retry |
| 2 | Nasazení selže, pokud FQDN fleet components, instance components, identity broker, VCF services runtime, VCF Automation nebo VCF services runtime VCF Automation obsahují velká písmena | použít lowercase |
| 3 | „Failed to validate NFS configuration. NFS datastore mount failed on host <host>“ na hostech s jednou pNIC | žádný – single pNIC nepodporováno, použít ≥ 2 pNIC |
| 4 | Fleet lifecycle: úlohy zůstanou „In Progress“, opakovaná instalace komponenty, krok bez progresu > 2 h | ignorovat (1, 2) / KB 435569 (3) |
| 5 | Konvergence vCenter, který už spravuje SDDC Manager, smaže fleet komponenty první instance; varování o existující SDDC Manager extension nasazení nezastaví | žádný – redeploy nebo restore |
| 6 | Po konverzi installeru na SDDC Manager hlášky v Depot settings (API už není podporováno od 9.1) | ignorovat |
| 7 | Validace konvergence/importu selže kvůli chybějícímu install image NSX-T Manager | stáhnout uvedený image, retry |
| 8 | Konvergence vCenter 8.0 U3: root heslo musí mít 15–20 znaků (vCenter 8.0 U3 povoluje 8–20) | změnit heslo (malé, velké, číslice, speciální znak, ASCII, bez mezer) |
| 16 (SDDC Mgr) | Nasazení SDDC Manager selže s single-uplink DVS a NFS datastore | nepodporovaná konfigurace |

### 5.4 Konvergence – nepodporované konfigurace (validace odmítne / nepodporováno) [S25]
- Cisco virtual switches; vCenter bez VDS; custom porty vCenter; porty mimo VMware Ports and Protocols; dynamické VMkernel IP; více NSX Managerů na jeden vCenter; více VMkernel adapterů na vMotion port group.
- vCenter s ELM (bez NSX registrace lze upgradovat na 9.1.x a ELM rozbít); vCenter s NSX registrací a ELM; vCenter VM hostovaný na clusteru jiného vCenter; clustery s baselines; DRS manual/partially automated; vCenter HA (VCHA); vCenter už připojený k SDDC Manageru; částečný import clusterů.
- vVols je ve VCF 9 deprecated.

### 5.5 Upgrade – vybrané známé chyby [S31]
- Pre-checky spuštěné z Lifecycle tabu VCF Operations / Available Upgrades v SDDC Manageru: „Triggering SDDC Manager upgrade bundle failed.“ → spustit z Upgrades tabu domény.
- „Failed to SSH into VCenter using root credentials“ (izolované WLD s vlastním SSO) → `lcm.vcenter.ssh.precheck=false`.

### 5.6 Diagnostika [S16]
- Support bundle: user menu → **Support Bundle** → **GENERATE NEW SUPPORT BUNDLE** → **DOWNLOAD**.
- Log: `/var/log/vmware/vcf/domainmanager/domainmanager.log`.
- SoS utility `/opt/vmware/sddc-support/sos` (na installeru jen podmnožina voleb; jen logy posledního nasazení).

## 6. Limity a čísla

### 6.1 Appliance a zdroje
| Položka | Hodnota | Zdroj |
|---|---|---|
| VCF Installer VM | 4 vCPU, 16 GB RAM, 914 GB storage | [S6][S35] |
| Heslo installeru | ≥ 15 znaků, spec. znaky `@ ! # $ % ? ^` | [S6] |
| DNS servery v OVF | max. 2 | [S6] |
| Platformy z jednoho installeru | mimo mgmt infrastrukturu: více; na mgmt hostu: 1 | [S6] |

### 6.2 Celkové zdroje první VCF Instance (sizing profily) [S23]
| Profil | vCPU | RAM (GB) | Disk (GB) |
|---|---|---|---|
| Simple | 76 | 251 | 7448 |
| HA – Small | 106 | 335 | 8422 |
| HA – Medium | 184 | 656 | 11445 |
| HA – Large | 298 | 949 | 15357 |

Velikosti komponent první instance [S23]:
| Komponenta | Simple | HA Small | HA Medium | HA Large |
|---|---|---|---|---|
| VCF Management Services | 1 CP + 2 Worker | 3 CP + 3 Worker | 3 CP + 3 Worker | 3 CP + 4 Worker |
| SDDC Manager | 1x Default | 1x Default | 1x Default | 1x Default |
| vCenter | 1x Small | 1x Small | 1x Medium | 1x Large |
| NSX | 1x Medium | 3x Medium | 3x Medium | 3x Large |
| VCF Operations | 1x Small | 2x Small | 3x Medium | 3x Large |
| License Server | 1x Default | 1x Default | 1x Default | 1x Default |
| Cloud Proxy | 1x Small | 1x Small | 1x Standard | 1x Standard |
| VCF Automation | 1x Small | 1x Medium | 3x Medium | 3x Large |

Další VCF Instance: Simple 34 vCPU / 111 GB / 4562 GB; HA Small 62/187/5462; HA Medium 74/244/5813; HA Large 120/353/8321 [S23]. Custom velikosti jen přes JSON spec [S23].

### 6.3 Počty hostů
- V kontextu konvergence (nové nasazení VCF Operations, VCF Automation a NSX Manager): **Simple: 3 ESX hosty s vSAN nebo 2 s externím úložištěm; HA: 4 ESX hosty** [S25].
- vSAN stretched při konvergenci: **[9.1]** ≥ 3 hosty na AZ; **[9.1.1+]** ≥ 2 hosty na AZ (+ witness) [S25].
- Dvouuzlový vSAN ROBO cluster (2 hosty + witness) pro Simple; admission control ≥ 50 % CPU i paměti [S25].
- Pro greenfield bring-up stránky průvodce minimum neuvádějí – viz Otevřené otázky.

### 6.4 FQDN a IP (první instance) [S19]
| Komponenta | Simple FQDN | HA FQDN | IP / síť |
|---|---|---|---|
| vCenter | 1 | 1 | – |
| ESX | 1 / host | 1 / host | – |
| vMotion | – | – | 1 / host (vMotion) |
| Host TEP | – | – | 1 / aktivní VDS uplink / host (overlay); **[9.1.1+]** ne u VLAN-backed VPC |
| vSAN | – | – | 1 / host (vSAN) |
| NSX Manager nodes | 1 | 3 | – |
| NSX Manager Cluster VIP | 1 | 1 | – |
| SDDC Manager | 1 | 1 | – |
| VCF Operations primary | 1 | 1 | – |
| VCF Operations replica | – | 1 | – |
| VCF Operations data node | – | 1 (jen Medium/Large) | – |
| VCF Operations load balancer (volitelně) | – | 1 | – |
| Cloud Proxy | 1 | 1 | – |
| License Server | 1 | 1 | – |
| VCF Automation | 1 | 1 | VCF management |
| VCF services runtime (VCF Automation) | 1 | 1 | VCF management |
| VCF Automation nodes | – | – | 5 (3 + 2 buffer) |
| Fleet components, Instance components, VCF services runtime, Identity broker | 1 každý | 1 každý | VCF management |
| VCF services runtime nodes | – | – | min. 12, doporučeno 30 |

Day-N: Log management 6 IP (+1 na další small/medium repliku, +2 na large), Real-time metrics 6 IP (+1 na worker; HA 1–2) – z IP bloku services runtime [S19].

### 6.5 Další čísla
- Interní CIDR services runtime: `198.18.0.0/15` (alt. `240.0.0.0/15`, `250.0.0.0/15`); IPv6 `fd00::/111` výchozí [S14][S19].
- Load balancing „Route Based on Physical NIC Load“: přesun při > 75 % vytížení uplinku po 30 s [S14].
- vDS profily: Default (1 switch), Storage Traffic Separation (2), NSX Traffic Separation (2) [S14]; **[9.0]** navíc Storage and NSX Traffic Separation (3) [S34].
- Primární datastore při více typech (konvergence): vSAN > NFS v3 > VMFS > NFS 4.1 > iSCSI > vVols [S25].
- Konvergence: VDS ≥ 8.0; uplinky ≥ 10 Gbps na VDS; 1 Gbps pNIC jen pro management/vMotion [S25].
- SoS `--history`: posledních 20 umístění logů; certifikát expirující za 1–30 dní = žlutá [S16].

## 7. Síťový provoz

Pouze toky doložené v dokumentaci (porty komponent mezi sebou jsou na ports.broadcom.com, viz Otevřené otázky).

| # | Odkud | Kam | Port / protokol | Typ provozu | Zdroj |
|---|---|---|---|---|---|
| 1 | Admin (prohlížeč) | VCF Installer `https://installer_appliance_FQDN` | HTTPS (port neuveden, implicitně 443) | UI, login `admin@local` | [S6] |
| 2 | Admin | VCF Installer | SSH (`vcf`, pak `su`) | správa, logy, certifikáty | [S6][S16] |
| 3 | Admin | ESX host (VMware Host Client) | HTTPS | nasazení OVA, NTP, SSH služba | [S6][S10][S11] |
| 4 | Admin | ESX host | SSH (dočasně) | regenerace certifikátu | [S11] |
| 5 | VCF Installer | ESX hosty (management network) | ping; dále neuvedeno | ověření, konfigurace během bring-upu | [S5][S6] |
| 6 | VCF Installer | DNS servery | DNS (forward + reverse) | resolve hostů a NTP | [S6] |
| 7 | VCF Installer, ESX hosty | NTP servery | NTP | synchronizace času | [S6][S10] |
| 8 | VCF Installer | `dl.broadcom.com`, `eapi.broadcom.com`, `vvs.broadcom.com`, `vsanhealth.vmware.com`, **[9.1.1+]** `vcf.packages.broadcom.com` | 443 | stažení binárek | [S22] |
| 9 | VCF Installer | `vvs.broadcom.com` | 443 | data kompatibility komponent | [S22] |
| 10 | VCF Installer | `vsanhealth.vmware.com`, `eapi.broadcom.com` | 443 | vSAN HCL data | [S22] |
| 11 | VCF Installer | proxy (HTTP/HTTPS, FQDN/IP:port) | dle konfigurace | online depot přes proxy | [S13] |
| 12 | VCF Installer | offline depot web server | HTTPS 443 (dle příkladu `openssl s_client -connect depot_server_FQDN:443`) | stažení binárek | [S13] |
| 13 | Admin (prohlížeč) | `vcf.broadcom.com` (VCF Business Services console) | HTTPS | registrace software depotu, activation code | [S13] |
| 14 | VCF Installer (na mgmt hostu) | management domain storage | Storage vMotion | přesun appliance z lokálního disku, přepnutí do SDDC Manager mode | [S6] |
| 15 | VCF Operations | `vcf.broadcom.com`, `eapi.broadcom.com` | 443 | licencování (post-deployment) | [S22] |
| 16 | VCF services runtime IP pools (s depotem) | `projects.packages.broadcom.com`, **[9.1.1+]** `vcf.packages.broadcom.com` | 443 | Supervisor a VCF service binárky | [S22] |
| 17 | SDDC Manager, vCenter, VCF Operations, services runtime | `vcsa.vmware.com`, `vcsa.telemetry.broadcom.com`, `scapi.telemetry.broadcom.com` | 443 | CEIP telemetrie | [S22] |

Logické sítě (umístění komponent) [S21]:
- **ESX management network** – výchozí pro VM management provoz.
- **VM management network** – vCenter, NSX, SDDC Manager, cloud proxy.
- **VCF management network** (**[9.1]**) – VCF Operations, license server, VCF Automation, VCF management services; výchozí je sdílená s VM management network.
- **Custom DVPG / NSX segment** – VCF Operations, license server, VCF Automation při volbě separátního VDS/segmentu.
- Dále host sítě: vMotion, vSAN nebo NFS, NSX Host Overlay (TEP) [S14].
- VCF services runtime má interní síť (CIDR viz 6.5); více runtime instancí na stejné síti může sdílet jednu interní síť [S21].

## 8. Otevřené otázky

1. **Minimální počet ESX hostů pro greenfield bring-up management domain** (Simple vs HA, vSAN vs FC/NFS) – stránky průvodce (9.0 i 9.1) ho neuvádějí; čísla 3/2/4 jsou doložena jen na stránce konvergence [S25]. Stránka „Management Domain Deployment Model“ (design) čísla v extrahovaném textu neobsahovala. Ověřit v Design → vSphere cluster models nebo ve VCF Installer planning sekci.
2. **Interpretace sloupců tabulky komponent** v [S4] (tři hodnoty pod záhlavími VCF Simple/HA a VVF) – předpoklad VCF Simple / VCF HA / VVF; ověřit v PDF.
3. **Úplná matice `workflowType` × `useExistingDeployment`** v [S15] – extrakce byla částečně nejednoznačná.
4. **API VCF Installer** (endpointy pro validaci a deployment, stav úloh) – TechDocs odkazuje na „VMware Cloud Foundation Installer API Reference Guide“ na developer.broadcom.com, což není povolený zdroj; konkrétní endpointy nejsou ve specu.
5. **Pole stránek „ESX host details“ a „vCenter details“** (např. velikost vCenter, název datacentra/clusteru, počet hostů) – stránka 9.1 uvádí jen „Enter the ESX host details“ / „Enter the vCenter details“.
6. **Pořadí a názvy interních úloh bring-upu** (co se v Tasks panelu děje: nasazení vCenter, vSAN, NSX, SDDC Manager, management services…) – v dokumentaci nenalezeno.
7. **Konkrétní texty validačních chyb** (kromě známých problémů v [S31]) – dokumentace uvádí jen obecný mechanismus warnings/errors.
8. **Porty mezi komponentami** (installer ↔ ESX, vCenter, NSX…) – dokumentace odkazuje na ports.broadcom.com (není v seznamu povolených zdrojů).
9. **Hodnota 914 GB** storage pro VCF Installer – tak uvedeno v 9.1 i 9.0 [S6][S35]; ověřit, zda jde o provisioned (thin) velikost.
10. **Replica node FQDN** – stránka [S14] ho neoznačuje jako jen-HA, ale tabulka [S19] a [S4] uvádí repliku jen v HA. Ověřit chování průvodce u Simple.
11. **Verze 9.1.0.0–9.1.0.300 / 9.1.0.400** u IP rozsahů – není jasné, zda jde o build/verzi installeru nebo deployment; jak se to promítá do 9.1.1.
12. **Detailní kroky VVF průvodce** a konvergence pro VVF – v tomto souboru jen odkazy, nezpracováno.
13. **Jednotlivé upgrade postupy** (VCF Operations 9.1, SDDC Manager 9.1, deploy VCF management services při upgradu) – zpracováno jen high-level; detail patří do `60-lifecycle`.
14. **Datum patchů 9.1.1**: TechDocs na všech stránkách uvádí „19 NOV“ pro nové patche komponent 9.1.1, zatímco `VERSION.md` uvádí 12. 10. 2026 – nutno aktualizovat (version-scout).

## 9. Zdroje

Základ URL: `https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/`

- [S1]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment.html – Deployment, Convergence, and Upgrade
- [S2]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/overview-of-deploy--converge--and-upgrade.html – Paths to Building 9.1.x Environments
- [S3]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/vcf-management-appliances.html – Components in VCF and vSphere Foundation
- [S4]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-.html – Deploying a New VCF or vSphere Foundation Platform
- [S5]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment.html – Preparing to Deploy
- [S6]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/deploy-the-vmware-cloud-foundation-installer-appliance.html – Deploy VCF Installer (9.1)
- [S7]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/preparing-esx-hosts-for-vmware-cloud-foundation-or-vmware-vsphere-foundation.html – Preparing ESX Hosts
- [S8]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/preparing-esx-hosts-for-vmware-cloud-foundation-or-vmware-vsphere-foundation/install-esx-on-hosts-using-the-iso.html – Install ESX Using ISO
- [S9]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/preparing-esx-hosts-for-vmware-cloud-foundation-or-vmware-vsphere-foundation/configure-the-network-on-vmware-cloud-foundation-hosts.html – Configure the Network on ESX Hosts
- [S10]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/preparing-esx-hosts-for-vmware-cloud-foundation-or-vmware-vsphere-foundation/configure-ntp-on-vmware-cloud-foundation-hosts.html – Configure NTP
- [S11]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/preparing-esx-hosts-for-vmware-cloud-foundation-or-vmware-vsphere-foundation/regenerate-the-self-signed-certificate-on-esx-hosts.html – Regenerate Self-Signed Certificate
- [S12]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/downloading-binaries-to-the-vcf-installer-appliance.html – Downloading Binaries
- [S13]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/downloading-binaries-to-the-vcf-installer-appliance/connect-to-an-online-depot-to-download-binaries.html – Connect to Online/Offline Depot
- [S14]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/deploy-a-new-vcf-fleet-or-a-new-vcf-instance.html – Deployment Wizard: New VCF Fleet / Instance (9.1)
- [S15]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/use-a-json-specification-to-deploy-vmware-cloud-foundation-or-vmware-vsphere-foundation.html – JSON Specification
- [S16]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/troubleshooting-vmware-cloud-foundation-or-vmware-vsphere-foundation-deployments.html – Troubleshooting Deployments
- [S17]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/deploying-vcf-operations-and-vcf-automation-on-custom-networking.html – Deferred Components on Custom Networking
- [S18]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/manual-deployment-of-components-to-complete-your-vcf-platform.html – Completing the Deployment
- [S19]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/planning-and-preparation/vcf-components-fqdns-and-ip-addresses/first-vcf-instance-fqdns-and-ip-addresses.html – First VCF Instance FQDNs and IPs
- [S20]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/planning-and-preparation/vcf-components-fqdns-and-ip-addresses.html – VCF Components FQDNs and IP addresses
- [S21]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/planning-and-preparation/network-deployment-options-for-vcf-components.html – Network Deployment Options
- [S22]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/planning-and-preparation/public-urls-required-for-vmware-cloud-foundation.html – Public URLs
- [S23]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/vmware-cloud-foundation-concepts/vcf-fleet-sizing-models-9-x.html – VCF Fleet Sizing Models
- [S24]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/converging-your-existing-vsphere-infrastructure-to-a-vcf-or-vvf-platform-.html – Converging Existing Infrastructure
- [S25]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/converging-your-existing-vsphere-infrastructure-to-a-vcf-or-vvf-platform-/supported-and-not-supported-configurations.html – Supported and Not Supported Configurations
- [S26]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/converging-your-existing-vsphere-infrastructure-to-a-vcf-or-vvf-platform-/supported-scenarios-to-converge-to-vcf.html – Supported Scenarios
- [S27]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/converging-your-existing-vsphere-infrastructure-to-a-vcf-or-vvf-platform-/supported-scenarios-to-converge-to-vcf/converge-your-existing-vcenter-instance-and-esx-hosts.html – Converge vCenter and ESX
- [S28]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/converging-your-existing-vsphere-infrastructure-to-a-vcf-or-vvf-platform-/use-existing-vsphere-infrastructure-to-create-a-new-vcf-fleet-or-a-new-vcf-instance-using-the-deployment-wizard.html – Convergence Wizard
- [S29]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/upgrading-cloud-foundation.html – Upgrading to VCF 9.1.x
- [S30]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/release-notes/vmware-cloud-foundation-9-1-1-0-release-notes.html – VCF 9.1.1 Release Notes
- [S31]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/release-notes/vmware-cloud-foundation-9-1-0-0-release-notes/known-issues/vcf-installer-91-known-issues.html – VCF Installer 9.1 Known Issues
- [S32]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/release-notes/vmware-cloud-foundation-9-1-0-0-release-notes/what-s-new/whats-new-installer.html – What's New: VCF Installer 9.1
- [S33]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/release-notes/vmware-cloud-foundation-9-1-0-0-release-notes/upgrade-sequence-to-91.html – Upgrade Sequence to 9.1
- [S34]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/deploy-a-new-vcf-fleet-or-a-new-vcf-instance.html – Deployment Wizard (9.0)
- [S35]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/deploy-the-vmware-cloud-foundation-installer-appliance.html – Deploy VCF Installer (9.0)
- [S36]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/planning-and-preparation.html – Planning and Preparation

[S1]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment.html
[S2]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/overview-of-deploy--converge--and-upgrade.html
[S3]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/vcf-management-appliances.html
[S4]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-.html
[S5]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment.html
[S6]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/deploy-the-vmware-cloud-foundation-installer-appliance.html
[S7]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/preparing-esx-hosts-for-vmware-cloud-foundation-or-vmware-vsphere-foundation.html
[S8]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/preparing-esx-hosts-for-vmware-cloud-foundation-or-vmware-vsphere-foundation/install-esx-on-hosts-using-the-iso.html
[S9]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/preparing-esx-hosts-for-vmware-cloud-foundation-or-vmware-vsphere-foundation/configure-the-network-on-vmware-cloud-foundation-hosts.html
[S10]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/preparing-esx-hosts-for-vmware-cloud-foundation-or-vmware-vsphere-foundation/configure-ntp-on-vmware-cloud-foundation-hosts.html
[S11]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/preparing-esx-hosts-for-vmware-cloud-foundation-or-vmware-vsphere-foundation/regenerate-the-self-signed-certificate-on-esx-hosts.html
[S12]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/downloading-binaries-to-the-vcf-installer-appliance.html
[S13]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/downloading-binaries-to-the-vcf-installer-appliance/connect-to-an-online-depot-to-download-binaries.html
[S14]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/deploy-a-new-vcf-fleet-or-a-new-vcf-instance.html
[S15]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/use-a-json-specification-to-deploy-vmware-cloud-foundation-or-vmware-vsphere-foundation.html
[S16]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/troubleshooting-vmware-cloud-foundation-or-vmware-vsphere-foundation-deployments.html
[S17]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/deploying-vcf-operations-and-vcf-automation-on-custom-networking.html
[S18]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/manual-deployment-of-components-to-complete-your-vcf-platform.html
[S19]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/planning-and-preparation/vcf-components-fqdns-and-ip-addresses/first-vcf-instance-fqdns-and-ip-addresses.html
[S20]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/planning-and-preparation/vcf-components-fqdns-and-ip-addresses.html
[S21]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/planning-and-preparation/network-deployment-options-for-vcf-components.html
[S22]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/planning-and-preparation/public-urls-required-for-vmware-cloud-foundation.html
[S23]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/vmware-cloud-foundation-concepts/vcf-fleet-sizing-models-9-x.html
[S24]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/converging-your-existing-vsphere-infrastructure-to-a-vcf-or-vvf-platform-.html
[S25]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/converging-your-existing-vsphere-infrastructure-to-a-vcf-or-vvf-platform-/supported-and-not-supported-configurations.html
[S26]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/converging-your-existing-vsphere-infrastructure-to-a-vcf-or-vvf-platform-/supported-scenarios-to-converge-to-vcf.html
[S27]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/converging-your-existing-vsphere-infrastructure-to-a-vcf-or-vvf-platform-/supported-scenarios-to-converge-to-vcf/converge-your-existing-vcenter-instance-and-esx-hosts.html
[S28]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/converging-your-existing-vsphere-infrastructure-to-a-vcf-or-vvf-platform-/use-existing-vsphere-infrastructure-to-create-a-new-vcf-fleet-or-a-new-vcf-instance-using-the-deployment-wizard.html
[S29]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/upgrading-cloud-foundation.html
[S30]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/release-notes/vmware-cloud-foundation-9-1-1-0-release-notes.html
[S31]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/release-notes/vmware-cloud-foundation-9-1-0-0-release-notes/known-issues/vcf-installer-91-known-issues.html
[S32]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/release-notes/vmware-cloud-foundation-9-1-0-0-release-notes/what-s-new/whats-new-installer.html
[S33]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/release-notes/vmware-cloud-foundation-9-1-0-0-release-notes/upgrade-sequence-to-91.html
[S34]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/deploy-a-new-vcf-fleet-or-a-new-vcf-instance.html
[S35]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/deploy-the-vmware-cloud-foundation-installer-appliance.html
[S36]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/planning-and-preparation.html
