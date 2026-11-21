# 25 – Use cases VCF Installeru a fyzický / síťový základ hostů

> Modelovaná verze: **VCF 9.1.1** (viz `docs/spec/VERSION.md`). Rozdíly jsou označeny **[9.0]** / **[9.1]** / **[9.1.1+]**.
> Stav výzkumu: 2026-11-21. Odkazy `[Uxx]` vedou do sekce 9.
>
> **Překryv s jinými speci.** Tento soubor nic neopakuje, jen odkazuje:
> - průvodce „Deploy a new VCF fleet / Instance“, JSON spec, příprava ESX (DCUI, NTP, certifikát), depot, VCF Installer
>   appliance, konvergence v kostce, upgrade → `20-deployment` (sekce 2–6),
> - sizing profily (celkové vCPU/RAM/disk), počty uzlů → `00-architektura` 6 a `20-deployment` 6.2,
> - minima hostů podle cluster modelu, MTU/VLAN/NIC požadavky fyzické sítě, planning workflow (obecně) → `10-planning` 3.3, 6,
> - porty mezi komponentami → `20-deployment` 7, `00-architektura` 7.
>
> Nová fakta jsou tu: **(A)** katalog use cases / cest, jejich pořadí kroků a rozhodovací body (včetně cesty
> „nejdřív vSphere, pak konvergence“) a výstupy a kontroly plánování a zdrojů; **(B)** stav sítě ESX hned po
> instalaci, výchozí a maximální MTU, validace MTU a uplinků v installeru a jejich chybové hlášky; **(C)** out-of-band
> management hostů (BMC) – co je a co není dokumentované (sekce 10, zdroje [U57]–[U83]).

---

## 1. Shrnutí

**A – use cases.** TechDocs 9.1 dělí cesty k prostředí 9.1.x na tři skupiny [U1]:
1. **Nové nasazení** – nová VCF fleet, nová VCF Instance (v nové nebo existující fleet) nebo nová vSphere Foundation
   (VVF). Nástroj je **VCF Installer** + workflow ve VCF Operations. „Deployment of standalone components by deploying an
   OVA is typically not supported“, pokud to dokumentace výslovně neuvádí [U1]. Výjimkou je **VVF 9.1 bez VCF management
   services**: ruční cesta bez installeru [U6].
2. **Konvergence** – existující vSphere 8 / Aria 8 infrastruktura se stane stavebním blokem nové VCF fleet, nové VCF
   Instance nebo VVF [U1].
3. **Upgrade** – VCF 5.2.x/9.0.x → 9.1.x, VVF 5.2.x/9.0.x → 9.1.x, vSphere 8 (+ volitelně Aria Operations 8) → 9.1.x
   [U1].

Workload domény se řeší až po management domain [U1].

VCF Installer podle [U2] umí: stáhnout binárky; „Plan the desired size and configuration of your VCF or VMware vSphere
Foundation deployment“; nasadit novou VCF/VVF platformu (i s existující VCF Operations / VCF Automation); konvergovat
existující infrastrukturu; rozšířit fleet o další VCF Instance; „Deploy VCF management services and license server to
complete the vSphere Foundation upgrade to 9.1“; zobrazit historii nasazení, hesla a JSON specifikace.

**B – fyzický a síťový základ.** Čerstvě nainstalovaný ESX nastaví management síť přes **DHCP**. Když DHCP chybí,
dostane link-local adresu 169.254.x.x/16 [U31]. Pro management provoz zvolí **vmnic0** [U32]. Instalace vytvoří
výchozí standardní switch **vSwitch0** [U35]. Před nasazením VCF musí být **vmk0 na vSphere Standard Switch s jednou
management NIC** (např. vmnic0) [U18]. Installer pak hosty migruje na VDS [U18]. MTU: ESX management VMkernel **1500
(Default)** [U43]. Jumbo frames se zapínají hodnotou > 1500 (VSS a VMkernel max. 9000, VDS max. 9190) [U39][U40][U41].
Installer před nasazením ověřuje konektivitu vMotion / vSAN / NSX TEP sítí pomocí `vmkping` s **MTU 9000**. Při chybě
hlásí konkrétní chyby nebo warningy (sekce 5) [U45][U46][U48].

## 2. Komponenty a vztahy

### 2.1 Katalog use cases (9.1.1)

| ID | Use case | Nástroj / volba v UI | Existující komponenty | Výsledek | Zdroj |
|---|---|---|---|---|---|
| UC-1 | **Nová VCF fleet** (greenfield) | VCF Installer → Deployment Wizard > VMware Cloud Foundation → „Deploy a new VCF fleet“ (nebo JSON, `workflowType=VCF`) | žádné; volitelně „existing VCF Automation … or I will deploy later“. **[9.1.1+]** existující VCF Operations jen s konvergencí (viz UC-5) | první VCF Instance + fleet komponenty | [U4][U3]; `20-deployment` 4.2 |
| UC-2 | **Nová VCF Instance** v existující fleet | Deployment Wizard > VMware Cloud Foundation → „Deploy a new VCF Instance“ (JSON `VCF_EXTEND`) | **povinně** existující VCF Operations („you must connect to your existing VCF Operations instance“); volba „existing VCF Operations“ není dostupná, připojení se zadává později v průvodci | další instance (vlastní management domain); VCF Operations se nenasazuje | [U4] |
| UC-3 | **Nová VVF** (s VCF management services) | Deployment Wizard > VMware vSphere Foundation → „Deploy new VMware vSphere Foundation“ | žádné („Do not select any existing components.“) | vCenter, VCF Operations, license server, VCF management services | [U5] |
| UC-4 | **VVF 9.1 bez VCF management services** | **bez VCF Installeru** – ruční nasazení | ESX hosty | vCenter, VCF Operations, License Server | [U6] |
| UC-5 | **Konvergence → VCF** (nová fleet nebo nová instance) | Deployment Wizard > VMware Cloud Foundation, na „Existing Components“ zvolit existující vCenter (JSON `VCF` / `VCF_EXTEND`) | vCenter + ESX (vždy), volitelně vSAN, NSX, Aria Operations, Aria Automation (scénáře A–E) | management domain nové instance | [U1][U7][U9]; `20-deployment` 4.6 |
| UC-6 | **Konvergence → VVF 9.1** | Deployment Wizard > VMware vSphere Foundation → „Deploy new VMware vSphere Foundation“ → Existing Components: VMware vCenter | jen vCenter (+ jeho ESX) | VCF Operations, VCF management services, license server; vCenter „as-is“ | [U8] |
| UC-7 | **Dokončení upgradu VVF na 9.1** – nasazení VCF management services | Deployment Wizard > VMware vSphere Foundation → „Deploy VCF Management Services“ | existující VCF Operations + vCenter | VCF services runtime, fleet lifecycle, SDDC lifecycle, software depot, telemetry, license server (pokud neexistuje) | [U14][U2] |
| UC-8 | **Deferred komponenty** (custom networking) | VCF Installer „Deploy deferred components“ / JSON `VCF_COMPLETE` | nasazená instance | VCF Operations, VCF Automation, cloud proxy, license server | `20-deployment` 4.5 |
| UC-9 | **Upgrade vSphere 8 (+ Aria Ops 8) → 9.1** (bez VCF Installeru) a **později konvergence** | ruční upgrade komponent | vCenter 8 U3+, ESX 8 U3+, (vSAN 8 U3+, Aria Ops 8.18.x) | 9.1 infrastruktura s licencí; lze ji později konvergovat do plného VCF 9.1.x | [U12] |
| UC-10 | Upgrade VCF 5.2.x/9.0.x → 9.1.x, VVF → 9.1.x | VCF Operations / SDDC Manager (lifecycle) | existující VCF/VVF | – | [U1][U13]; `20-deployment` 4.7 |

Scénáře konvergence do VCF (UC-5) podle [U1]: **A** vCenter + ESX; **B** + Aria Operations; **C** + Aria Operations přes
vRealize Suite Lifecycle Manager; **D** + Aria Automation přes vRSLCM; **E** + Aria Operations a Aria Automation přes
vRSLCM. Ve všech je vSAN a NSX volitelný.

### 2.2 Režim VCF Installeru vs. use case [U2]
- **Installer mode**: appliance je na ESX hostu, který „is not part of the management domain for the target
  deployment“. Po nasazení zůstává installerem. Lze s ní nasazovat další VCF Instance a dělat konvergence.
- **SDDC Manager mode**: appliance je na hostu management domain. „Once in SDDC Manager mode, the appliance can no longer
  work in installer mode.“ Doporučeno nasadit na lokální datastore, appliance se během nasazení přesune na primary
  datastore. U FC lze nasadit rovnou na FC datastore.
- „VCF Installer works with major, minor, and maintenance releases, but does not support patch or express patch
  releases“ [U2].
- Průvodci UC-1, UC-2, UC-3, UC-6, UC-7 vyžadují **VCF Installer 9.1.1 nebo novější** [U4][U5][U8][U14].

### 2.3 Závislosti mezi use cases (doložené)
- UC-2 potřebuje existující fleet s VCF Operations [U4]. **[9.1.1+]** VCF Operations musí být v management domain
  první VCF Instance [U4][U15].
- UC-4 → UC-7: k VVF bez management services lze **později** nasadit VCF management services VCF Installerem a pak
  log management přes VCF Operations [U6].
- UC-9 → UC-5: po upgradu vSphere 8 na 9.1 „can be converged into a full VCF 9.1.x deployment“ [U12].
- „Convergence of vSphere Foundation 9.1 with deployed VCF management services to VCF 9.1 is not supported.“ [U1]
  Tedy VVF vzniklá přes UC-3, UC-6 nebo UC-7 se do VCF 9.1 konvergovat nedá. Zda jde konvergovat VVF z UC-4 (bez
  management services), viz Otevřené otázky.

## 3. Prerekvizity

### 3.1 Společné pro průvodce VCF Installeru (UC-1, 2, 3, 5, 6, 7) [U4][U5][U8][U14]
- ESX hosty nasazené a nakonfigurované (pro greenfield; u konvergence je už spravuje vCenter).
- VCF Installer ≥ 9.1.1 nasazený; binárky stažené.
- FQDN a IP nakonfigurované (A + PTR; pravidla `.local` / velká písmena viz `20-deployment` 3.5).
- UC-1: pokud se použije externí load balancer pro VCF Operations, musí být nasazen předem [U4].

### 3.2 Minimální verze pro konvergenci a cestu „nejdřív vSphere“

| Use case | vCenter | ESX | Další | Zdroj |
|---|---|---|---|---|
| **[9.1]** UC-5 konvergence → VCF (scénář A) | „VMware vCenter 8.0 Update 3a“ | „VMware ESX 8.0 Update 3“ | (Optional) vSAN 8.0 U3, (Optional) NSX 4.2.1 | [U7] |
| **[9.1]** UC-5 – podmínka vCenter | bez NSX registrace → **upgradovat vCenter na 9.1.x**; s NSX ≥ 4.2.1 a vCenter ≥ 8.0 U3a → bez upgradu | – | – | [U7] |
| **[9.1]** UC-6 konvergence → VVF 9.1 | **vCenter 9.1** | ESX 8.0 Update 3 | VCF Installer ≥ 9.1.1 | [U8] |
| **[9.1]** UC-9 vSphere 8 → 9.1 | 8 U3+ | 8 U3+ | vSAN 8 U3+ (volit.), Aria Operations 8.18.x (volit.); nepodporováno: SDDC Manager, NSX, Aria Operations for Logs | [U12] |
| **[9.1]** UC-10 VVF → 9.1 | „forward-only“: např. vCenter 8.0 U3a → 9.1.0 ano, 8.0 U3j → 9.1.0 ne | – | výchozí VVF 5.2.x nebo 9.0.x | [U13] |
| **[9.0]** konvergence → VCF 9.0.0 | vCenter 9.0 | ESX 9.0 | – | [U11] |
| **[9.0]** konvergence → VCF 9.0.1 / 9.0.2 | vCenter 8.0 Update 3 (bez NSX registrace upgradovat na 9.0+) | ESX 8.0 Update 1 | NSX 4.2.1 | [U11] |
| vCenter 9.1 appliance – cílový host pro nasazení | – | appliance lze nasadit na „ESX 8.0 Update 1 or later hosts, or vCenter 8.0 or later instances“ | – | [U24] |

**[9.0]** Stránka cest 9.0 uváděla volbu „upgradovat samostatné vCenter, ESX a Aria Operations na 9.0 a používat je
až 90 dní v evaluaci před licencováním“ [U10]. Ve stránce cest 9.1 tato formulace není [U1].

### 3.3 Prerekvizity konvergence, které ovlivňují cestu „nejdřív vSphere“ [U9]
Pokud hráč staví vSphere ručně s úmyslem konvergovat, musí výsledná konfigurace splnit „Supported Configurations“:
- **VDS 8.0 nebo novější**; „vCenter instances without a vSphere Distributed Switch“ nejsou podporované (VSS-only
  prostředí konvergovat nelze).
- Clustery s **vSphere Lifecycle Manager images**. Clustery s baselines nejsou podporované (ESX je třeba nejprve
  upgradovat na 9.1.x).
- **DRS fully automated**. Manual a partially automated nejsou podporované.
- Statické VMkernel IP. Dynamicky přidělené VMkernel IP nejsou podporované. Více VMkernel adapterů na vMotion port
  group není podporováno.
- Uplinky ≥ 10 Gbps. 1 Gbps pNIC jen pro ESX management nebo vMotion.
- Sdílený datastore dostupný ze všech hostů clusteru a „enough free space for the full deployment“.
- Počty hostů: Simple **3** (vSAN) / **2** (externí storage), HA **4**. Navíc „maintain an additional 20% free capacity
  beyond the deployment resource requirements“.
- Další nepodporované stavy (ELM s NSX, VCHA, vCenter VM hostovaný na clusteru jiného vCenteru…) → `20-deployment` 5.4.
- UC-6 (VVF): VM home, VMDK a swap vCenteru musí ležet na datastore, kam se nasadí management services. Nesmí být
  připojené ISO a snapshot nesmí odkazovat na jiný datastore. vCenter nesmí mít připojený NSX Manager [U8].

### 3.4 Prerekvizity ručního nasazení vCenter (UC-4, cesta „nejdřív vSphere“) [U25][U24]
- Cílový ESX host: „not in lockdown or maintenance mode and not part of a fully automated vSphere cluster“.
- Cílový cluster ve vCenter inventory: aspoň jeden host mimo lockdown a maintenance mode.
- NTP servery běží a čas mezi NTP a cílovým serverem je synchronizovaný.
- Statická IP + FQDN → forward i reverse DNS záznam.
- vSAN ESA s šifrováním → zapnout ESA encryption **před** instalací vCenteru.
- Cíl: ESX ≥ 8.0 U1 nebo vCenter ≥ 8.0 [U24]. Pozor: úvodní stránka [U23] uvádí „ESX 9.0 or later“. Rozpor viz
  Otevřené otázky.

### 3.5 Prerekvizity ESX sítě před VCF Installerem (B)
- vmk0 + VLAN ID management sítě nastavené v DCUI. vmk0 připojený k **jedné** management NIC na **vSphere Standard
  Switch** (např. vmnic0) [U18].
- Validace installeru očekává standard switch jménem **vSwitch0** s **právě jedním** fyzickým uplinkem. Ostatní NIC
  musí být „unclaimed, not unused“ [U36][U37].
- Fyzické switch porty k hostům v trunk módu 802.1Q, MTU podle typu provozu → `10-planning` 3.3 [U55].
- Na hostu nesmí být registrované VM („VCF requires hosts to be in a clean state“) – KB pro **[9.1]** greenfield [U53].
  Výjimka pro VCF Installer appliance nasazenou na management hostu (podporovanou podle [U2][U27]) v KB uvedena není.
  Viz Otevřené otázky.

## 4. Workflow

> Pořadí kroků je převzaté z dokumentace. Tam, kde spojujeme více stránek do jedné cesty, je to výslovně označeno
> jako **složení** (a ne jako jeden dokumentovaný postup).

### 4.1 UC-1 / UC-2 – nová VCF fleet / instance (greenfield)
Fáze dle [U3]: **Preparation → Deployment → Post-deployment**.
1. Prepare ESX hosts: Install ESX z ISO → Configure Network (DCUI) → Configure NTP → Regenerate self-signed
   certificate (→ případně signed certificates) [U17]. Detail: `20-deployment` 4.1.1–4.1.4.
2. Deploy VCF Installer appliance [U3] (`20-deployment` 4.1.5).
3. Download binaries [U3] (`20-deployment` 4.1.6).
4. Deployment Wizard > VMware Cloud Foundation → „Deploy a new VCF fleet“ / „Deploy a new VCF Instance“. „After you
   choose a deployment path, you plan and gather all the information required for deployment. By specifying the scale of
   the deployment, network, and storage types, you define the required resources…“ [U4]. Celé pořadí stránek:
   `20-deployment` 4.2.
5. UC-2 navíc: připojení k VCF Operations spravující fleet, zadání cloud proxy. Pokud je k ní připojena VCF Automation,
   zobrazí se její FQDN a je třeba zadat root heslo. Volby vCenter a „Deploy VCF Operations and VCF Automation to a
   specific vSphere distributed switch or NSX segment“ nejsou dostupné [U4].
6. Post-deployment: licence, deferred komponenty, dokončení platformy (`20-deployment` 4.4, 2.2).

### 4.2 UC-3 – nová VVF přes VCF Installer [U5]
1. Login `admin@local`.
2. **Deployment Wizard > VMware vSphere Foundation** → Next.
3. **Deploy new VMware vSphere Foundation**.
4. Network configuration: VM management network (vCenter, ESX) sdílená s ESX management nebo dedikovaná; VCF management
   network sdílená s VM management nebo dedikovaná; IP scheme (dual-stack jen pokud ho má installer).
5. Storage type management domain (vSAN ESA / vSAN OSA / data-in-transit encryption / VMFS on FC / NFS v3). Principal
   storage nelze později změnit. U NFS lze převzít gateway, VLAN a **MTU** ESX management sítě.
6. Review prerequisites → „Pre-fill generated FQDNs in wizard“, případně stáhnout JSON šablonu.
7. General configuration (Version, CEIP, DNS, NTP, DNS domain, **[9.1]** Autogenerate passwords).
8. ESX host details.
9. Network details (port groups; VCF Management Services IP range: **[9.1.0.0–9.1.0.300]** souvislý rozsah,
   **[9.1.0.400+]** i nesouvislý; rozsahy vMotion/vSAN/VCF management ≥ počet hostů).
10. VCF management components: VCF Operations primary node FQDN, License Server FQDN (IPv4 only při nasazení), Fleet
    components / Instance components / VCF services runtime FQDN (lowercase), Internal cluster CIDR.
11. vCenter details.
12. Storage details.
13. **vSphere Distributed Switch**: Default Configuration (1 switch) / Storage Traffic Separation (2) / Custom (traffic
    types ESX management, VCF management, VM management, vMotion, vSAN; uplinky VDS nebo LAG s LACP – „requires matching
    physical switch configuration“) → **Create Distributed Switch**.
14. Review → 15. Validation (warnings: Acknowledge; errors: opravit a znovu validovat) → 16. **Deploy**, sledovat Tasks.

Velikosti v průvodci jsou pevné: **medium vCenter, medium VCF Operations, small VCF management services**. Jiné velikosti
jen přes JSON [U5].

### 4.3 UC-4 – VVF 9.1 bez VCF management services (bez installeru) [U6]
Prerekvizita: ESX hosty nasazené a nakonfigurované podle „Installing and Setting Up ESX“.
1. Deploy the vCenter Appliance.
2. Deploy VCF Operations, pak ve VCF Operations nakonfigurovat vCenter account.
3. Deploy and configure the License Server.

Bez management services nejsou dostupné: log management, binary management přes software depot a integrovaný lifecycle
VCF Operations. Patching a upgrade jdou standardními vSphere lifecycle mechanismy. Management services lze doplnit
později (UC-7) [U6].

**Nasazení vCenter appliance (vSphere 9.1)** [U23]: GUI installer má dvě fáze. **Stage 1** nasadí OVA na cílový ESX
host nebo vCenter. **Stage 2** nastaví a spustí služby appliance. CLI installer provede obě fáze podle JSON bez
interakce.

### 4.4 UC-5 – konvergence vCenter + ESX → VCF (9.1) [U7]
„Each step includes a dedicated and detailed procedure, that you must complete, before proceeding with the next one.“
1. Deploy VCF Installer appliance.
2. Download binaries.
3. Ověřit verzi vCenter: bez NSX registrace → upgradovat vCenter na 9.1.x. S NSX ≥ 4.2.1 a vCenter ≥ 8.0 U3a →
   bez upgradu.
4. Konvergovat VCF Installerem („VCF Installer validates and uses your existing components“ a nasadí chybějící).
   Detail průvodce: `20-deployment` 4.6.
5. Pokud installer nasadil nové NSX → synchronizovat inventory management domain ve VCF Operations.
6. Následně: licencování, zbývající komponenty, import dalších vCenterů jako workload domén, upgrade WLD, integrace do
   VCF Automation.

**[9.0] odlišné pořadí** [U11]: 1. ověřit/upgradovat vCenter → 2. ověřit verzi ESX → 3. deploy VCF Installer →
4. binárky → 5. „Deploy VCF 9.0.x using your existing components“ → 6. zbývající komponenty.

### 4.5 UC-6 – konvergence vCenter + ESX → VVF 9.1 [U8]
1. Login `admin@local`. 2. Deployment Wizard > **VMware vSphere Foundation**. 3. **Deploy new VMware vSphere
Foundation**. 4. Existing Components: **VMware vCenter**. Stránky Storage, Hosts, Networks a Distributed Switch nejsou
dostupné. 5. Network configuration (VCF management network sdílená s VM management nebo dedikovaná). 6. Review
prerequisites. 7. General information. 8. VCF Management (FQDN VCF Operations, license server, management services,
services runtime). 9. **Existing vCenter** (installer ověří kompatibilitu). 10. Networks: IP rozsah management services
(**aspoň 12 adres**). 11. Review. 12. Validate & Deploy.
- Nasadí se VCF Operations (výchozí medium), VCF management services (výchozí small) a license server. Management
  services se umístí na datastore vCenteru. Lifecycle konvergovaného vCenteru a ESX řídí VCF Operations, přidávání hostů
  a clusterů se dělá ve vCenteru [U8].

### 4.6 UC-7 – Deploy VCF Management Services (dokončení upgradu VVF na 9.1) [U14]
1. Login → 2. Deployment Wizard > VMware vSphere Foundation → 3. Next → 4. **Deploy VCF Management Services** →
5. Network configuration → 6. Review prerequisites (+ pre-fill FQDN) → 7. General settings → 8. Existing VCF Operations
(primary node FQDN + admin heslo) → 9. Existing vCenter → 10. VCF management network + IP pool → 11. FQDN management
services, internal cluster CIDR, license server FQDN → 12. Validation → 13. Deploy.
- IP pool: **[9.1.0.0–9.1.0.300]** rozsah s **aspoň 10 adresami**; **[9.1.0.400+]** seznam (i nesouvislý) s volitelnými
  výjimkami [U14]. (Jiné stránky uvádějí pro services runtime min. 12 IP – viz Otevřené otázky.)

### 4.7 UC-9 – vSphere 8 (+ Aria Ops 8) → 9.1, pak konvergence [U12]
1. Upgrade Aria Operations 8.18+ na VCF Operations 9.1, nebo deploy VCF Operations 9.1 (pokud Aria Operations není).
2. Deploy license server.
3. Upgrade vCenter.
4. Upgrade ESX hostů.
5. Upgrade vSAN on-disk format.
6. Upgrade vSAN File Service.

„VCF Operations and the license server components are required to license all 9.1.x environments.“ Konvergence do VCF
je možná později (UC-5) [U12].

### 4.8 Cesta „nejdřív vSphere, pak VCF“ – **složení** z dokumentovaných stránek
Dokumentace ji nepopisuje jako jeden postup. Skládá se z UC-4 / UC-9 a UC-5:

| Krok | Co | Podmínka / zdroj |
|---|---|---|
| 1 | Instalace ESX (ISO), management síť v DCUI | `20-deployment` 4.1.1–4.1.2; [U30]–[U34] |
| 2 | DNS (A + PTR) pro vCenter, NTP | [U25] |
| 3 | Nasazení vCenter 9.1 appliance (Stage 1 + 2) na ESX host | [U23][U24] |
| 4 | Cluster s vLCM image, DRS fully automated, HA; **VDS ≥ 8.0** a migrace hostů z VSS; statické VMkernel IP; sdílený datastore (vSAN/NFS/FC) | prerekvizity konvergence [U9] |
| 5a | (VVF) VCF Operations + License Server ručně → UC-4; nebo VCF Installer → UC-6 | [U6][U8] |
| 5b | (VCF) Deploy VCF Installer → binárky → konvergence (vCenter bez NSX musí být 9.1.x – čerstvý 9.1 to splňuje) | [U7] |

Rozhodovací bod: pokud hráč v kroku 5a zvolí VVF s **VCF management services**, cesta do VCF 9.1 přes konvergenci je
uzavřená („not supported“) [U1].

### 4.9 Rozhodovací body (pro výběr cesty v Sandboxu)

| Otázka | Možnosti | Důsledek | Zdroj |
|---|---|---|---|
| VCF nebo VVF? | VCF (UC-1/2/5) / VVF (UC-3/4/6) | VVF nenasazuje NSX, SDDC Manager, VCF Automation, Identity broker, Salt | `20-deployment` 2.1 [U5] |
| Greenfield nebo konvergence? | čisté hosty / existující vCenter | konvergence skryje stránky Storage, Hosts, Distributed Switch | [U4][U8]; `20-deployment` 4.6 |
| S VCF Installerem nebo bez? | installer (UC-1/2/3/5/6/7) / ručně (UC-4, UC-9) | bez installeru jen VVF bez management services nebo upgrade vSphere 8 | [U6][U12] |
| První instance nebo další? | nová fleet / nová instance | nová instance vyžaduje existující VCF Operations | [U4] |
| Kde poběží installer? | mimo management domain / na management hostu | installer mode (více nasazení) / SDDC Manager mode (1 nasazení) | [U2] |
| VVF s management services? | ano / ne | ano → konvergence do VCF 9.1 nepodporována | [U1] |

### 4.10 Plánování a kontrola zdrojů v installeru
1. **[9.1]** Integrovaný planning workflow: „define your deployment topology and component selection directly in the UI“.
   Installer vygeneruje seznam **CPU, Memory, Storage, VLAN a FQDN** požadavků, které „are then validated against the
   target infrastructure to ensure resource sufficiency prior to deployment“ [U16].
2. Počet hostů: „You use the planning section of VCF Installer to determine the minimum number of ESX hosts required for
   your environment“ (alternativa: Planning and Preparation Workbook) [U17].
3. Stránka **Review the prerequisites**: „Depending on your selections in the wizard, the prerequisites for the deployment
   are listed.“ Obsahuje **PRE-FILL GENERATED FQDNs IN WIZARD** a stažení JSON šablony [U4].
4. **[9.1.1]** Existuje stránka **„VLAN requirements summary“** s tlačítkem **„View Details“**. Známá chyba: u VLAN-backed
   VPC ukazuje špatný počet VLAN, správný je ve „View Details“ [U15].
5. Kontrola zdrojů při validaci – viz sekce 5.2.

## 5. Chybové stavy

### 5.1 Use cases / cesty
| Situace | Následek / hláška | Verze | Zdroj |
|---|---|---|---|
| Konvergence VVF 9.1 s nasazenými VCF management services → VCF 9.1 | „not supported“ | 9.1 | [U1] |
| vCenter bez NSX registrace, verze < 9.1 (UC-5) | nutný upgrade vCenter na 9.1.x před konvergencí | 9.1 | [U7] |
| vCenter < 9.1 při UC-6 | nesplňuje minimum „VMware vCenter 9.1“ | 9.1 | [U8] |
| vCenter bez VDS | nepodporováno pro konvergenci | 9.1 | [U9] |
| Nová instance bez existující VCF Operations | nelze, připojení k VCF Operations je povinné | 9.1 | [U4] |
| Installer v SDDC Manager mode | „can no longer work in installer mode“ – nelze nasadit další platformu | 9.x | [U2] |
| Patch / express patch verze jako cíl installeru | installer je nepodporuje, patche až ručně po dokončení | 9.x | [U2] |
| Nesprávné SSO credentials vCenteru při konvergenci | zavádějící hláška „vCenter VM must be connected to a Distributed Virtual Switch.“ → zadat správné SSO credentials | 9.1.1 (known issue) | [U15] |
| Na hostu registrované VM (greenfield) | task „Validate VCF Domain Input Data“: „one or more virtual machines were found on the host“; log `HOST_VM_VALIDATION_FAILED One or more VMs found on host` | 9.1 | [U53] |

### 5.2 Kontrola zdrojů
| Situace | Následek / hláška | Verze | Zdroj |
|---|---|---|---|
| Konvergence: cluster nemá požadované zdroje (+20 %) | installer zobrazí **warning, neblokuje** nasazení | 9.1 | [U9] |
| Proaktivní validace CPU/RAM/storage (NSX, vCenter vs. fyzická kapacita) | „Resource Requirements Warning“; lze pokračovat, pokud jsou zdroje prokazatelně dostatečné (detail `10-planning` 5) | 9.0.x | [U51] |
| NSX deployment resource validation (import / WLD / konvergence) | „NOT_ENOUGH_RESOURCES_IN_MANAGEMENT_DOMAIN Not enough resources found in management domain.“ + „Required CPU:<CPU> vCpus, Memory: <MEM> GB, Storage: <STORAGE> GB.“ / „Available CPU:…“. Chyba počítala i vypnuté VM, opraveno v **9.1.1** | 9.0.1, 9.0.2, 9.1, 5.2.x | [U52] |

### 5.3 Fyzická síť, uplinky a VSS (B)
| Situace | Hláška | Verze | Zdroj |
|---|---|---|---|
| Chybí / přejmenován vSwitch0, host už na VDS, zbytková konfigurace | „Host does not contain vSphere Standard Switch - vSwitch0“ | VCF 5.x, 9.x | [U36] |
| Více pNIC na vSwitch0 | „ESX Host <ESXi Host FQDN> has 2 Physical NICs connected to vSphere Standard Switch vSwitch0 (Expecting 1)“ → nechat 1 uplink, ostatní „unclaimed, not unused“ | VCF 9.x | [U37] |
| NIC < 10G na vSwitch0 | „vSphere standard switch vSwitch0 must have only one NIC as Uplink.“; log `HOST_STANDARD_SWITCH_UPLINK_VALIDATION_FAILED`, „vmnic0, Speed: 1000 … a less than 10G NIC“; KB cituje „All physical NICs must have a minimum speed of 10 Gbps.“ | VCF 9 (KB) | [U38] |
| **[9.1.1+]** 1 Gbit NIC pro management | vyřešeno: „ESX hosts with 1Gbit NIC are supported“ (bez dřívějších podmínek dedikované VM Management sítě a separátního VDS) | 9.1.1 | [U15] |
| vmk management/vMotion bez dedikované port group (falešně pozitivní při importu VDS) | „Host <esx_name> VMKernel adapter management is not assigned to a dedicated port group.“ | 9.1.x | [U54] |

### 5.4 MTU a konektivita sítí (validace installeru)
| Situace | Hláška | Verze | Zdroj |
|---|---|---|---|
| Host Overlay VDS s MTU 1500 | validace „Deployment Specification“: „The provided MTU for Distributed vSphere Switch which is going to be used for Host Overlay is 1500. Must be at least 1600“ → nastavit MTU ≥ 1600 a retry | VVF 9.1 (dle KB) | [U49] |
| Jumbo frames blokované fyzickou sítí (1500 projde, 9000 ne) | „ESX host vmkping from VLAN #### does not support MTU 9000 for network "VMOTION'“; NSX: host „with MTU 9000 fails vmkping“, remediation „Ensure that ESX Host <ESXI_HOST_FQDN> is responsive“; SDDC Manager „Validate Network“: „doesn't support MTU 9000 for network 'VMOTION' but smaller 1500 MTU packet passes“ | VCF 9.x | [U46] |
| Celkový výpadek konektivity mezi hosty (8972 i 1472 B selžou) | **warning**: „… with MTU 9000 fail to vmkping. Possible no network connection or not reachable.“ / „Ensure that ESX Host ######### is responsive.“ | vSAN 8.x/9.x | [U48] |
| vMotion gateway nedostupná / ping 9000 selže | „Gateway 192.168.#.# for VMOTION network is not responding from host.example“; „Failed to validate connectivity of VMOTION network“; „vmkping failed from ESXi host … on VLAN #### using an MTU size of 9000.“ Příčina v KB: installer nerespektuje standby uplink, když aktivní vmnic používá vSwitch0. Workaround: `validation.disable.network.connectivity.check=true` nebo ACTIVE/ACTIVE v JSON | 9.0, 9.1.1 | [U45] |
| vMotion pre-check „vMotion Network Connectivity“ | příčiny: bug standby uplinku, MTU mismatch / špatné VLAN tagování na uplinkových portech, špatné mapování vmnic v předdefinovaném switch profilu → Custom Switch Configuration | 9.0.x, 9.1.x | [U47] |
| Duplicitní IP na vSAN/vMotion vmk | „VSAN Cluster validation failed on ####“; `vob.net.vmknic.ip.duplicate`. KB zmiňuje i alarmy při špatném MTU („MTU not set to 1500“) | VCF 9.x, 5.2.x | [U50] |
| Frame větší než MTU zařízení na cestě | zařízení frame „will drop“ (žádná fragmentace Geneve – DF bit, viz `10-planning` 3.3) | NSX 9.x | [U44] |

Doporučení z KB [U46][U47]: povolit jumbo frames na všech host-facing portech i ISL. Fyzické MTU nastavit na **9128**
nebo ekvivalent výrobce (např. **9216**). Ruční test: `vmkping -I vmkX -s 8972 -d <IP>` (8972 B payload + hlavičky =
9000 MTU).

## 6. Limity a čísla

### 6.1 Zdroje management komponent
- Celkové sizing profily a počty uzlů: `00-architektura` 6 a `20-deployment` 6.2 [U19]. Stránka sizingu (9.1.x)
  neuvádí, zda součty odpovídají 9.1.0 nebo 9.1.1 [U19].
- **[9.1.1+]** „VCF management services now require less compute and memory resources for all deployment sizes.“
  Detail je ve Workbooku 9.1.1 (KB 455842 pro patchovaná prostředí). Výchozí velikost v installeru je **small** místo
  medium [U15].
- VCF Installer appliance: 4 vCPU / 16 GB / 914 GB (`20-deployment` 6.1) [U27].
- VVF průvodce (UC-3): medium vCenter, medium VCF Operations, small VCF management services [U5]. UC-6: VCF Operations
  medium, management services small [U8].
- **vCenter appliance** (vSphere 9.1) [U20][U22]:

| Velikost | Hosty / VM | vCPU | RAM | Storage default / large / x-large |
|---|---|---|---|---|
| Tiny | 10 / 100 | 2 | 14 GB | 619 / 2059 / 4319 GB |
| Small | 100 / 1 000 | 4 | 21 GB | 734 / 2084 / 4344 GB |
| Medium | 400 / 4 000 | 8 | 30 GB | 933 / 2233 / 4493 GB |
| Large | 1 000 / 10 000 | 16 | 39 GB | 1383 / 2283 / 4543 GB |
| X-Large | **[9.1]** 2 000 / 35 000 (s X-Large storage 2 500 / 45 000); **[9.0]** 2 500 / 45 000 | 24 | 58 GB | 2308 / 2408 / 4668 GB |

  Storage zahrnuje vSphere Lifecycle Manager. Host s > 512 LUN a 2 048 cestami vyžaduje Large nebo X-Large [U20][U21][U22].
- NSX Manager Medium: 6 vCPU / 24 GB / 300 GB – uvedeno **jen** jako minimum v požadavcích Supervisoru s VPC (9.1)
  [U26]. Ostatní velikosti NSX Manageru a VCF Operations uzlů viz Otevřené otázky.

### 6.2 Kapacitní pravidla
- Konvergence: +20 % volné kapacity nad požadavky, jinak warning [U9].
- Host minima: `10-planning` 6.1. Konvergence 3/2/4 [U9].
- IP: rozsahy vMotion/vSAN/VCF management ≥ počet ESX hostů [U4][U5]. Management services IP: min. 12 (UC-6 [U8]),
  resp. ≥ 10 adres pro 9.1.0.0–9.1.0.300 (UC-7 [U14]).

### 6.3 Síť ESX a MTU

| Položka | Hodnota | Zdroj |
|---|---|---|
| Výchozí IP management sítě ESX | DHCP (IP, maska, gateway). Bez DHCP link-local 169.254.x.x/16 | [U30][U31] |
| IP adres pro management | „ESX requires one IP address for the management network.“ | [U30] |
| Výchozí management NIC | vmnic0 („During the autoconfiguration phase, the ESX host chooses vmnic0 for management traffic.“) | [U32] |
| Výchozí standardní switch | vSwitch0 („default Standard Switch (vSwitch0) created during the fresh ESXi installation“; KB bez uvedení verze) | [U35] |
| VLAN ID management (DCUI) | 1–4094 | [U33] |
| Test Management Network (DCUI) | ping default gateway, ping primary a secondary DNS, resolve hostname | [U34] |
| ESX Management VMkernel MTU | **1500 (Default)** | [U43] |
| vMotion / vSAN / NFS / Host TEP VMkernel MTU (doporučeno) | 9000 | [U43] |
| VSS jumbo frames | MTU > 1500, max. **9000** | [U39] |
| VDS jumbo frames | MTU > 1500, max. **9190**. Změna MTU restartuje uplink NIC → výpadek „between 5 to 10 milliseconds“ | [U40] |
| VMkernel jumbo frames | MTU > 1500, max. **9000** | [U41] |
| Jumbo frames obecně | „The network must support jumbo frames end-to-end“ (pNIC, fyzické switche, storage) | [U42] |
| NSX TEP MTU | min. **1600**, doporučeno **1700**. Global Tunnel Endpoint MTU **default 1700**. Global Logical Interface MTU **default 1500**. MTU v uplink profilu je volitelné (jinak global TEP MTU). U VDS se MTU uplink profilu **nepoužije**, platí MTU VDS. Při jumbo podloží TEP/uplink profil/VDS ≥ 9000 | [U44] |
| Guest VM MTU | typicky 1500; o ≥ 100 B (lépe 200 B) menší než MTU fabric | [U44] |
| Fyzické porty (TEP min. 1700, ostatní min. 1500, dop. 9000) | → `10-planning` 3.3 | [U55] |
| Fyzické MTU dle KB pro jumbo | 9128 nebo 9216 | [U46] |
| Validační ping installeru | vmkping MTU 9000 (payload 8972) a 1500 (payload 1472) | [U46][U48] |

## 7. Síťový provoz

Doplňuje `20-deployment` 7 a `00-architektura` 7, kde jsou toky installer → ESX (ping, kontrola obsazené IP), DNS,
NTP, vCenter ↔ ESX (443/902), ESX → NSX (443/1234/1235) atd. Porty uvádí oficiální web Ports and Protocols
(https://ports.broadcom.com/ [U56], odkaz z Planning and Preparation). Ten je ale JS aplikace a jeho obsah nešel stáhnout,
viz `20-deployment` 8 #8. Níže jsou **jen nové toky doložené ve zdrojích tohoto souboru**:

| # | Odkud | Kam | Síť / VLAN | Protokol / velikost | Kdy / účel | Zdroj |
|---|---|---|---|---|---|---|
| N1 | ESX (vmk0) | DHCP server | ESX management | DHCP (port neuveden) | výchozí stav po instalaci, získání IP/masky/gateway | [U30][U31] |
| N2 | ESX (vmk0) | default gateway, primary + secondary DNS | ESX management | ping; DNS resolve hostname | DCUI „Test Management Network“ | [U34] |
| N3 | ESX (vmk vMotion) | ESX (vmk vMotion) ostatních hostů | vMotion VLAN | vmkping, MTU 9000 (payload 8972) a 1500 | validace installeru „vMotion Network Connectivity“ před nasazením | [U45][U46][U47] |
| N4 | ESX (vmk vMotion) | gateway vMotion sítě | vMotion VLAN | ping | validace („Gateway … for VMOTION network is not responding“) | [U45] |
| N5 | ESX (vmk vSAN) | ESX (vmk vSAN) ostatních hostů | vSAN VLAN | vmkping, MTU 9000 / 1500 | validace „vSAN Network Connectivity“ (warning při selhání) | [U45][U48] |
| N6 | ESX (Host TEP) | ESX (Host TEP) ostatních hostů | NSX Host Overlay VLAN | vmkping MTU 9000 | validace NSX overlay installerem | [U46] |
| N7 | VCF Installer (admin) | ESX Host Client | ESX management | HTTPS | nasazení OVA installeru / vCenter Stage 1 na ESX | [U27][U23] |
| N8 | vCenter installer (Stage 1) | cílový ESX host | ESX management | neuvedeno | nasazení vCenter OVA (UC-4, cesta „nejdřív vSphere“) | [U23] |

Fyzicky: management provoz po instalaci vede přes **jedinou** pNIC na vSwitch0 (vmnic0). Management VLAN je tagovaná
na vmk0 (DCUI) a ToR port musí být trunk 802.1Q (`10-planning` 3.3) [U18][U32][U55]. Po bring-upu installer migruje hosty
na VDS a přidá další uplinky [U18].

## 8. Otevřené otázky

1. **Obrazovky integrovaného planning workflow 9.1** – kromě „VLAN requirements summary“ / „View Details“ [U15] a
   „Review the prerequisites“ [U4] dokumentace jednotlivé obrazovky ani formát výstupu (tabulka CPU/RAM/storage)
   nepopisuje. Nejasné je i to, zda nedostatek zdrojů v greenfield je ve 9.1 error, nebo warning (u konvergence je
   doloženo „warning, not block“ [U9]).
2. **Výchozí port groups po instalaci ESX 9.x** („Management Network“, „VM Network“) – ve zdrojích 9.x nebyly doloženy.
   KB [U36] používá „Management Network“ jen jako příklad. [U17] zmiňuje „After you have configured the Virtual Machine
   Network port group, configure the NTP service“, ale krok konfigurace této port group v 9.1 postupu chybí.
3. **Výchozí MTU VSS / VDS** – stránky vSphere 9.1 uvádějí jen „set MTU to a value greater than 1500“ pro jumbo frames.
   Explicitně „default 1500“ je jen u ESX Management VMkernel v designu VCF [U43]. Jaké MTU nastaví VCF Installer na
   vytvořeném VDS, není doloženo (průvodce má pole MTU u sítí s IP rozsahem [U4]).
4. **KB [U49] (Host Overlay MTU ≥ 1600)** je označen pro VVF 9.1, přestože VVF podle [U5] NSX nenasazuje. Ověřit, zda
   validace platí i pro VCF greenfield (pravděpodobné, ale nedoložené).
5. **Konvergence VVF bez VCF management services (UC-4) do VCF 9.1** – výslovně nepopsáno. Zákaz [U1] se týká jen VVF
   „with deployed VCF management services“.
6. **VM na hostu před greenfield** [U53] vs. podporované nasazení VCF Installeru na management host [U2][U27] – KB
   výjimku pro installer VM neuvádí.
7. **Cílová verze ESX pro nasazení vCenter 9.1** – [U24] „ESX 8.0 Update 1 or later“ vs. úvodní stránka [U23]
   „ESX 9.0 or later“.
8. **Minimum IP pro VCF management services**: 12 (UC-6 [U8], `20-deployment` 3.5) vs. „at least 10“ (UC-7 [U14], verze
   9.1.0.0–9.1.0.300).
9. **Velikosti NSX Manageru a VCF Operations uzlů (vCPU/RAM/disk) pro 9.1** – v povolených zdrojích nenalezeny jako
   tabulka pro 9.1. NSX Medium 6/24/300 je doloženo jen ze stránky Supervisoru [U26]. Ta navíc uvádí „vCenter 9.0 Small
   2 vCPU / 21 GB / 290 GB“, což je v rozporu s [U20] (Small = 4 vCPU). Nepřebírat bez ověření.
10. **Minimální rychlost NIC ve 9.0 vs 9.1.1** – KB [U38] (VCF 9) cituje „minimum speed of 10 Gbps“, RN 9.1.1 [U15]
    uvádí podporu 1Gbit NIC. Přesný rozsah (jen management? i vMotion?) v RN není úplně vypsán. Konvergence: 1 Gbps
    jen pro management/vMotion [U9].
11. **Journey PDF** (`vcf-9.0-vvf-converge-from-vsphere-journey.pdf`, `vcf-9.0-holistic-from-vsphere-aria-operations-end-to-end-journey.pdf`
    na techdocs) – obsahují pořadí cest „z vSphere“ pro 9.0. PDF nešlo agentem přečíst a ekvivalent pro 9.1 nebyl
    nalezen.
12. **Evaluační období 90 dní** před licencováním – doloženo jen pro 9.0 [U10]. Pro 9.1 neověřeno.
13. **Porty pro N1, N3–N6, N8** – zdroje uvádějí jen ping/vmkping/DHCP bez portů. Portál [U56] nejde stáhnout.

## 9. Zdroje

Základ VCF 9.1: `https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/`

- [U1] Paths to Building 9.1.x Environments: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/overview-of-deploy--converge--and-upgrade.html
- [U2] What Is the VCF Installer (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/overview-of-vmware-cloud-foundation-9/what-is-vmware-cloud-foundation-and-vmware-vsphere-foundation/what-is-the-vcf-installer-.html
- [U3] Deploying a New VCF or vSphere Foundation Platform: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-.html
- [U4] Start a New VCF Fleet or a New VCF Instance Deployment (wizard): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/deploy-a-new-vcf-fleet-or-a-new-vcf-instance.html
- [U5] Start a New vSphere Foundation Deployment (wizard): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/deploy-vmware-vsphere-foundation-using-the-deployment-wizard.html
- [U6] Deploying vSphere Foundation 9.1 Without VCF Management Services: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/deploy-vmware-vsphere-foundation-using-the-deployment-wizard/deploying-vmware-vsphere-foundation-9-1-without-vcf-management-services.html
- [U7] Converge Your Existing vCenter Instance and ESX Hosts (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/converging-your-existing-vsphere-infrastructure-to-a-vcf-or-vvf-platform-/supported-scenarios-to-converge-to-vcf/converge-your-existing-vcenter-instance-and-esx-hosts.html
- [U8] Use Existing vSphere Infrastructure to Create a vSphere Foundation Environment (wizard): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/converging-your-existing-vsphere-infrastructure-to-a-vcf-or-vvf-platform-/use-existing-vsphere-infrastructure-to-create-a-vmware-vsphere-foundation-environment-using-the-deployment-wizard.html
- [U9] Supported and Not Supported Configurations to Converge to VCF (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/converging-your-existing-vsphere-infrastructure-to-a-vcf-or-vvf-platform-/supported-and-not-supported-configurations.html
- [U10] Paths to Building 9.0.x Environments: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/deployment/overview-of-deploy--converge--and-upgrade.html
- [U11] Converge Your Existing vCenter Instance and ESX Hosts (9.0): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/deployment/converging-your-existing-vsphere-infrastructure-to-a-vcf-or-vvf-platform-/supported-scenarios-to-converge-to-vcf/converge-your-existing-vcenter-instance-and-esx-hosts.html
- [U12] Upgrading vSphere 8 and Optionally vSAN and Aria Operations 8 to 9.1.x: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/upgrading-your-vsphere-foundation-to-9-1/upgrade-to-91-from-vsphere-8-and-aria-8-environments(1).html
- [U13] Upgrading to vSphere Foundation 9.1.x: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/upgrading-your-vsphere-foundation-to-9-1.html
- [U14] Deploy VCF Management Services and License Server for the vSphere Foundation Upgrade: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/upgrading-your-vsphere-foundation-to-9-1/install-vcf-management-services-to-vsphere-foundation-environment.html
- [U15] VCF Installer / SDDC Manager 9.1.1.0 Release Notes: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/release-notes/vmware-cloud-foundation-9-1-1-0-release-notes/sddc-manager-9-1-1-0-release-notes.html
- [U16] What's New: VCF Installer 9.1: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/release-notes/vmware-cloud-foundation-9-1-0-0-release-notes/what-s-new/whats-new-installer.html
- [U17] Preparing ESX Hosts for VCF or vSphere Foundation (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/preparing-esx-hosts-for-vmware-cloud-foundation-or-vmware-vsphere-foundation.html
- [U18] Configure the Network on the ESX Hosts (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/preparing-esx-hosts-for-vmware-cloud-foundation-or-vmware-vsphere-foundation/configure-the-network-on-vmware-cloud-foundation-hosts.html
- [U19] VCF Fleet Sizing Models (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/vmware-cloud-foundation-concepts/vcf-fleet-sizing-models-9-x.html
- [U20] Hardware Requirements for the vCenter Appliance (vSphere 9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/vcenter-installation-and-setup/deploying-the-vcenter-server-appliance/vcenter-server-appliance-requirements/vcenter-server-appliance-hardware-requirements.html
- [U21] Hardware Requirements for the vCenter Appliance (vSphere 9.0): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-0/vcenter-installation-and-setup/deploying-the-vcenter-server-appliance/vcenter-server-appliance-requirements/vcenter-server-appliance-hardware-requirements.html
- [U22] Storage Requirements for the vCenter Appliance (vSphere 9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/vcenter-installation-and-setup/deploying-the-vcenter-server-appliance/vcenter-server-appliance-requirements/vcsa-storage-requirements.html
- [U23] Deploying the vCenter Appliance (vSphere 9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/vcenter-installation-and-setup/deploying-the-vcenter-server-appliance.html
- [U24] System Requirements for the vCenter Appliance (vSphere 9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/vcenter-installation-and-setup/deploying-the-vcenter-server-appliance/vcenter-server-appliance-requirements.html
- [U25] Prerequisites for Deploying the vCenter Appliance (vSphere 9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/vcenter-installation-and-setup/deploying-the-vcenter-server-appliance/prerequisites-for-deploying-the-vcsa.html
- [U26] Requirements for Supervisor Deployment with VPC Networking (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/vsphere-supervisor-installation-and-configuration/supervisor-networking-with-virtual-private-clouds/nsx-vpc-workflow-for-supervisor/requirements-for-supervisor-deployment-with-nsx-vpc.html
- [U27] Deploy VCF Installer (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/deploy-the-vmware-cloud-foundation-installer-appliance.html
- [U30] Configuring Network Settings (ESX 9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/esx-installation-and-setup/setting-up-esxi/configuring-network-settings.html
- [U31] Network Access to Your ESX Host (ESX 9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/esx-installation-and-setup/setting-up-esxi/configuring-network-settings/network-access-to-your-esxi-host.html
- [U32] Choose Network Adapters for the Management Network (ESX 9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/esx-installation-and-setup/setting-up-esxi/configuring-network-settings/choose-network-adapters-for-the-management-network.html
- [U33] Set the VLAN ID (ESX 9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/esx-installation-and-setup/setting-up-esxi/configuring-network-settings/set-the-vlan-id.html
- [U34] Test the Management Network (ESX 9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/esx-installation-and-setup/setting-up-esxi/test-the-management-network.html
- [U35] KB 410316 – Networking Operations Fail After Reinstalling an ESXi Host Enrolled in a VDS: https://knowledge.broadcom.com/external/article/410316/after-reinstalling-an-esxi-host-that-is.html
- [U36] KB 453316 – Host Commissioning Fails „Host does not contain vSphere Standard Switch - vSwitch0“: https://knowledge.broadcom.com/external/article/453316/sddc-manager-host-commissioning-fails-wi.html
- [U37] KB 415469 – VCF 9.0 Installer validation fails at ESX Host Configuration (2 pNIC na vSwitch0): https://knowledge.broadcom.com/external/article/415469/vcf-90-installer-validation-fails-at-esx.html
- [U38] KB 412127 – vSphere standard switch vSwitch0 must have only one NIC as Uplink: https://knowledge.broadcom.com/external/article/412127/vsphere-standard-switch-vswitch0-must-ha.html
- [U39] Enable Jumbo Frames on a vSphere Standard Switch (vSphere 9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/vsphere-networking/managing-network-resources/enabling-jumbo-frames/enable-jumbo-frames-on-a-vsphere-standard-switch.html
- [U40] Enable Jumbo Frames on a vSphere Distributed Switch (vSphere 9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/vsphere-networking/managing-network-resources/enabling-jumbo-frames/enable-jumbo-frames-on-a-vsphere-distributed-switch-with-the-vsphere-web-client.html
- [U41] Enable Jumbo Frames for a VMkernel Adapter (vSphere 9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/vsphere-networking/managing-network-resources/enabling-jumbo-frames/enable-jumbo-frames-for-a-vmkernel-adapter.html
- [U42] What are Jumbo Frames (vSphere 9.0): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-0/vsphere-networking/managing-network-resources/enabling-jumbo-frames.html
- [U43] VMkernel Detailed Design (VCF 9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/network-designs/vmkernel-design.html
- [U44] Guidance to Set Maximum Transmission Unit (NSX, VCF 9.0 stránka; selektor nabízí 9.1, URL 9.1 vrátila 404): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/advanced-network-management/administration-guide/transport-zones-and-transport-nodes/mtu-guidance.html
- [U45] KB 437248 – 9.1 VCF Installer fails on „vMotion Network Connectivity“ and/or „vSAN Network Connectivity“: https://knowledge.broadcom.com/external/article/437248/91-vcf-installer-fails-on-vmotion-networ.html
- [U46] KB 434502 – VCF Installer Fails to Validate vmkping Using Jumbo Frames for vMotion and NSX Overlay: https://knowledge.broadcom.com/external/article/434502/vcf-installer-fails-to-validate-vmkping.html
- [U47] KB 453284 – VCF 9.x Deployment Fails at vMotion Network Connectivity Validation: https://knowledge.broadcom.com/external/article/453284/vcf-9x-deployment-fails-at-vmotion-netw.html
- [U48] KB 431776 – VCF installation reports a warning during network validation: https://knowledge.broadcom.com/external/article/431776
- [U49] KB 442925 – The provided MTU for Distributed vSphere Switch … Host Overlay is 1500. Must be at least 1600: https://knowledge.broadcom.com/external/article/442925/the-provided-mtu-for-distributed-vsphere.html
- [U50] KB 448859 – VSAN Cluster validation failed due to network pool IP or MTU conflicts: https://knowledge.broadcom.com/external/article/448859/error-vsan-cluster-validation-failed-in.html
- [U51] KB 442952 – Resolving VCF 9 Deployment Failures: Disk Eligibility and False-Positive HCL Warnings: https://knowledge.broadcom.com/external/article/442952/resolving-vcf-9-deployment-failures-disk.html
- [U52] KB 442607 – NSX Deployment Resource Validation Error „Not enough resources found in management domain.“: https://knowledge.broadcom.com/external/article/442607/vcf-brownfield-import-fails-due-to-nsx-d.html
- [U53] KB 446453 – „One or more VMs found on host during VCF 9.1 Greenfield deployment“: https://knowledge.broadcom.com/external/article/446453/error-one-or-more-vms-found-on-host-duri.html
- [U54] KB 442109 – VMKernel adapter „is not assigned to a dedicated port group“: https://knowledge.broadcom.com/external/article/442109/vmkernel-adapter-validation-failure-is-n.html
- [U55] Physical Data Center Network Design (VCF 9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/datacenter-network-requirements/physical-datacenter-design-9-x.html
- [U56] VMware Ports and Protocols (odkaz z Planning and Preparation 9.1): https://ports.broadcom.com/
- [U57]–[U83]: zdroje sekce 10 (OOB management) jsou v 10.9.

---

## 10. OOB management (BMC)

> Výzkum 2026-11-21, modelovaná verze 9.1.1. Otázka z game designu: první síť, kterou hráč v Sandboxu kabeluje, je
> „management / OOB“. Je OOB síť (BMC: iDRAC / iLO / XCC / CIMC, IPMI, Redfish) ve VCF 9.x dokumentovaný požadavek,
> doporučení, nebo nic? Struktura 10.1–10.9 kopíruje sekce 1–9.
>
> **Pozor na termín.** Ve VCF 9.1 znamená „out-of-band (OOB) operations“ i něco jiného: změny dělané přímo ve vCenteru
> nebo NSX Manageru mimo workflow SDDC Manageru („These direct changes are called out-of-band (OOB) operations.“) [U82].
> Ve hře proto vždy rozlišovat **OOB management (BMC)** a **OOB operations (config drift)**.

### 10.1 Shrnutí

**Verdikt: OOB síť pro BMC není v dokumentaci VCF 9.x požadavek ani doporučení. Design VCF ji výslovně vyřazuje ze
scope.**
- Physical Data Center Network Design (9.1, stejně i 9.0), sekce „Host to Physical Switch Mapping Models“: „In VMware
  Cloud Foundation networking, switches utilized for out-of-band connectivity to the ESX host are out of scope.“
  [U55][U57]
- Seznamy sítí a VLAN pro management domain (Design Library, blueprinty, planning stránky) OOB / BMC síť **neobsahují**
  (10.2.2) [U58][U60][U61][U62][U63][U64]. Nenašli jsme v nich žádné design ID (REQD/RCMD) o BMC.
- Dokumentace přitom **předpokládá, že BMC existuje** a používá ho v konkrétních postupech:
  - **Start VCF** (Fleet Management > VCF Shutdown and Startup, 9.1): hosty management domain se zapínají přes „an
    out-of-band management interface, such as, ILO or iDRAC“ [U75][U76].
  - **Vzdálená instalace ESX** (vSphere 9.1): „Remote management applications allow you to install ESX on servers that
    are in remote locations.“ Podporované aplikace a minimální firmware jsou v tabulce [U67][U68].
  - **vSphere DPM**: probuzení hosta ze standby přes IPMI nebo iLO. Vyžaduje nakonfigurovaný BMC s IP, „as distinct from
    the IP address of the host“ [U73][U74].
  - **KB / troubleshooting**: kontrola SEL / logů v iDRAC, iLO, Cisco IMC, Lenovo XCC; restart nebo vypnutí hosta
    přes iLO/iDRAC [U80][U81].
- **Firmware přes vSphere Lifecycle Manager** jde přes **hardware support manager (HSM)**. Je to vendorový plug-in
  registrovaný jako vCenter extension. Dokumentace **neuvádí**, že by HSM komunikoval s BMC [U70][U71][U72].
- **ESX management (vmk0)** a BMC jsou dokumentované jako **dvě různá rozhraní s různými IP** [U74]. Hardware health
  přes CIM jde přes ESX host (vCenter ticket → CIM na host), ne přes BMC [U77]. Jak se BMC fyzicky kabeluje (dedikovaný
  port, sdílený LOM, samostatný switch), VCF nepopisuje. Je to „out of scope“ [U55].

### 10.2 Komponenty a vztahy

#### 10.2.1 Co dokumentace o BMC říká (vSphere 9.1)
- „The BMC is powered-on even when the host itself is powered-off.“ BMC poskytuje vzdálený přístup k ovládání
  hardwaru přes sériovou linku nebo LAN [U74].
- BMC má vlastní NIC: v DPM se zadává „IP address of the NIC associated with the BMC, as distinct from the IP address of
  the host“ a „MAC address of the NIC associated with the BMC“ [U74].
- Výrobci a jejich BMC v povolených zdrojích (pro herní vendory):

| Vendor ve hře | BMC v dokumentaci | Kde | Zdroj |
|---|---|---|---|
| Dell | DRAC / iDRAC (DRAC 4–10) | remote install tabulka, startup VCF, KB | [U68][U75][U80] |
| HPE | iLO (iLO – iLO 7) | remote install tabulka, DPM, startup VCF, KB | [U68][U73][U75][U80] |
| Lenovo | XClarity Controller XCC2, XCC3 | remote install tabulka, KB (SEL) | [U68][U80] |
| Cisco | Cisco IMC | jen KB (SEL logy) | [U80] |
| Supermicro | – | v žádném nalezeném zdroji | – |

#### 10.2.2 Sítě management domain podle dokumentace (OOB mezi nimi není)

| Zdroj | Vyjmenované sítě / VLAN | OOB / BMC? |
|---|---|---|
| **[9.1]** Network Fabric Detailed Design – „VLAN Traffic Types“ [U60] | ESX Infrastructure Traffic („ESX Management, vMotion, vSAN, etc.“), VM Management Traffic („Optional segment that may be shared with ESX management VMkernel Segment“), NSX Edge Node Uplink Networks, NSX Host and Edge TEPs, NSX Edge RTEP (optional), Workload VM VLAN Segments, External VLAN for DTGW | ne |
| **[9.1]** VMkernel Detailed Design [U43] | ESX Management (1500 default), vSphere vMotion (9000), vSAN (9000), NFS (9000), Host TEPs (9000) | ne |
| **[9.1]** ESX Model [U58] | VCF-ESX-RCMD-NET-001 (ESX management oddělit od VM management), -002 (ESX management VLAN per workload domain), -003 („Use dedicated VLANs for each traffic type“) | ne |
| **[9.1]** Blueprint „VCF Fleet in a Single Site with Minimal Footprint“ – Minimum Requirements [U61] | ESX Management (3 IPs), VM Management (24 IPs), vMotion (3 IPs), vSAN (3 IPs), Host TEP (6 IPs), (Optional) Edge TEP (4 IPs), (Optional) Edge Uplink (2 IPs) | ne |
| **[9.1]** Blueprint – Single-Rack Network Fabric Model [U62] | Management VM Appliances, ESX management VMK, IP Storage VMKs (vSAN, NFS, iSCSI), vMotion VMK, Host TEP, NSX Edge node management, NSX Edge TEP, NSX Edge RTEP, NSX Edge Uplink, VNA – Stateful Services, VNA Node Management, VNA – EVPN Route Controller, BGP-EVPN Peering | ne |
| **[9.0]** Blueprint minimal footprint – Planning and Preparation [U63] | „7x VLANS (with a physical network gateway interface attached)“: ESX Management, VM Management, vSAN (nebo NFS), vMotion, Host TEP, Edge TEP, Edge Uplink | ne |
| **[9.1]** Network Deployment Options for VCF Components [U64] | ESX management network, VM management network, (dedikovaná) VCF management network, custom segment / distributed port group | ne |

Pro hru: **první síť, kterou VCF dokumentuje, je ESX management** (vmk0, VLAN nastavená v DCUI, viz 3.5). OOB síť
v seznamu chybí.

#### 10.2.3 Vztah vmk0 (ESX management) ↔ BMC
- Dvě různé IP: BMC NIC „as distinct from the IP address of the host“ [U74]. vmk0 je „one IP address for the management
  network“ ESX [U30].
- VCF neříká, jestli má BMC ležet ve stejné VLAN / subnetu jako vmk0, nebo v jiné. Switche pro OOB jsou „out of
  scope“ [U55].
- In-band hardware monitoring jde přes ESX management: aplikace se autentizuje do vCenteru, dostane ticket
  `AcquireCimServicesTicket()` a pak volá CIM na ESX host („CIM-XML port 5989 or WS-Man port 433“, citováno doslova,
  viz 10.8) [U77].
- **Interní host ↔ BMC rozhraní (vSwitchBMC / vusb0)**: když je v iDRAC nebo iLO zapnuté USB/NIC rozhraní, ESX vytvoří
  standard switch **vSwitchBMC** s uplinkem **vusb0** (KB uvádí vSphere 8.0 a 8.0.3). Podle KB to „might cause the
  VMware Cloud Foundation Bring-Up process to fail“ [U78]. U Dellu existuje varianta s přepínačem „iDRAC“ na vusb0
  a řešením „turn off the OS to iDRAC Pass-Through functionality“ v out-of-band iDRAC UI [U79]. Nejde o OOB síť, je to
  vnitřní USB-NIC mezi OS a BMC.

#### 10.2.4 Firmware a HSM (vSphere Lifecycle Manager 9.1)
- „The hardware support manager is a plug-in that registers itself as a vCenter extension.“ Každý výrobce dodává
  vlastní HSM. HSM poskytuje seznam firmware updatů a „is also responsible for retrieving the firmware versions on the
  host hardware“ [U70].
- Uvedené HSM [U71]: **Cisco** (Intersight, bez appliance ve vCenter), **Dell** (OpenManage Integration for VMware
  vCenter – OMIVV, appliance), **HPE** (Compute Ops Management plug-in, HPE OneView for VMware vCenter), **Lenovo**
  (XClarity Integrator for VMware vCenter, appliance), Hitachi (UCP Advisor). Plný seznam certifikovaných HSM je
  v Broadcom Compatibility Guide [U71]. **Supermicro na stránce uveden není.**
- Firmware update přes image jde jen u clusterů spravovaných image (ne baselines). Všechny hosty v clusteru musí být od
  stejného výrobce [U72].
- **[9.1]** „If both vCenter and ESX are of version 9.1 and later and no hardware support manager is configured“ lze
  před remediací vygenerovat hardware compatibility report [U72].
- Přes jakou síť nebo rozhraní HSM firmware na host dostane (BMC, Redfish, in-band), stránky **neuvádějí** [U70][U71].

### 10.3 Prerekvizity
- **Pro VCF deployment / bring-up: žádná dokumentovaná prerekvizita týkající se BMC/OOB.** Příprava ESX hostů
  (9.1) BMC ani vzdálenou správu nezmiňuje [U17]. Krok instalace říká jen „Mount the ESX ISO on the host and restart the
  machine“, bez určení, jak (fyzické médium / virtual media) [U66].
- **Vzdálená instalace ESX** (volitelná cesta): jen podporované aplikace a minimální firmware z tabulky [U67][U68]
  (10.6).
- **vSphere DPM přes IPMI/iLO** [U74]:
  - „Configure the BMC“ (podle dokumentace výrobce) před použitím IPMI nebo iLO jako wake protokolu.
  - IPMI: „the BMC LAN channel is configured to be always available and to allow operator-privileged commands“. Na
    některých systémech je třeba zapnout IPMI over LAN v BIOSu a vytvořit IPMI účet.
  - Účet BMC, který umí host vzdáleně zapnout; IP a MAC NIC BMC; „The IP address should be static or a DHCP address
    with infinite lease.“
- **Startup VCF**: přístup k out-of-band rozhraní každého hosta management domain [U75][U76].
- **HSM**: nasadit vendorový HSM a zaregistrovat ho jako vCenter extension. U Dellu cluster profile [U72].

### 10.4 Workflow

#### 10.4.1 Pořadí „nejdřív BMC, pak ESX přes virtual media“
**Není dokumentováno jako postup VCF.** Doložené kousky:
1. Instalace ESX (VCF 9.1, Install ESX on Hosts Using an ISO Image) [U66]: Mount ISO → restart → v BIOS/UEFI boot
   z ISO → Enter → EULA → výběr disku → klávesnice → root heslo → F11 → reboot → první boot device = disk s ESX →
   opakovat pro všechny hosty.
2. Vzdálená varianta instalace (vSphere 9.1) [U67]: remote management aplikace lze použít pro interaktivní
   i skriptovanou instalaci. Varování: „the virtual CD might encounter corruption problems with systems or networks
   operating at peak capacity“. Při selhání dokončit instalaci z fyzického média.
3. Pak příprava ESX dle 4.1 (DCUI síť, NTP, certifikát) [U17].

Pořadí „BMC (IP, účet) → virtual media → instalace ESX → DCUI“ je **logické složení**, ne dokumentovaný postup.
Ve hře ho označit jako herní zjednodušení (viz 10.10).

#### 10.4.2 Start management domain (9.1) [U75][U76]
1. „Power on the first ESX host in the management domain.“
   - „Log in to the first ESX host in the domain by using the out-of-band management interface.“
   - „Power on the ESX host according to the hardware vendor guide.“
2. „Repeat the previous step to start all the remaining ESX hosts in the management domain.“
3. Další kroky: vSAN – restart vSAN clusteru z vCenteru, začít clusterem s management vCenterem [U75]. NFS/FC – zapnout
   vCenter z ESX Host Clientu, ověřit připojení hostů, exit maintenance mode [U76].

#### 10.4.3 Nastavení IPMI/iLO pro DPM (vSphere Client, per host) [U74]
1. Browse to the host. 2. Configure tab. 3. System > **Power Management**. 4. **Edit**. 5. BMC user name + password,
IP adresa NIC BMC, MAC adresa NIC BMC. 6. OK.
Pořadí wake protokolů: „If a host supports multiple protocols, they are used in the following order: IPMI, iLO, WOL.“
[U73]

#### 10.4.4 Firmware přes image (vSphere Client 9.1) [U72]
Cluster / host spravovaný image → Updates → Hosts → Image → Edit → Firmware and Drivers Addon: **Select** → vybrat HSM
→ vybrat firmware add-on → Select → validovat a uložit image → Image Compliance → remediovat nekompatibilní hosty.

### 10.5 Chybové stavy

| Situace | Následek / hláška | Verze / kontext | Zdroj |
|---|---|---|---|
| iDRAC/iLO USB-NIC rozhraní zapnuté → ESX vytvoří vSwitchBMC (vusb0) | „might cause the VMware Cloud Foundation Bring-Up process to fail“. Řešení: před instalací vypnout USB rozhraní v remote management aplikaci, nebo `esxcfg-advcfg -s 0 /Net/BMCNetworkEnable` + reboot. **Výjimka:** na systémech s DPU je vSwitchBMC nutný pro DPU management: „DO NOT "Disable vSwitchBMC creation"…“ | KB: vSphere 8.0 / 8.0.3, verze VCF neuvedena | [U78] |
| Přepínač „iDRAC“ na vusb0 se po rebootu znovu vytváří | stará definice v lokální konfiguraci; smazat switch, uložit, reboot; „access the out-of-band iDRAC UI and turn off the OS to iDRAC Pass-Through functionality“ | KB bez verze | [U79] |
| Host neumí IPMI, iLO ani WOL | „If a host does not support any of these protocols it cannot be put into standby mode by vSphere DPM.“ | vSphere 9.1 | [U73] |
| BMC nepodporuje MD5 ani plaintext autentizaci (pro Operator) | IPMI nelze s hostem použít, vCenter zkusí Wake-on-LAN | vSphere 9.1 | [U74] |
| Virtual CD při vzdálené instalaci | možné poškození při špičkovém zatížení systému/sítě → dokončit z fyzického média | vSphere 9.1 | [U67] |
| HSM od jiného výrobce než hosty / hosty různých výrobců | prerekvizita „Verify that all hosts in the cluster are from the same vendor.“ (přesnou hlášku stránka neuvádí) | vSphere 9.1 | [U72] |
| Neočekávaný reboot / shutdown hosta | může přijít přes iLO/iDRAC („An ESXi host can also be shut down or rebooted through out-of-band management interfaces such as iLO or iDRAC.“). Kontrola SEL „(such as HPE iLO, Dell iDRAC, Cisco IMC or Lenovo XCC)“ | KB: ESXi 7.0/8.0, VVF 9.0.x | [U80] |
| Host „Not Responding“ | „Inspect the out-of-band management console (iDRAC, iLO, or BMC) for recorded ECC or multi-bit memory errors“ | KB: ESXi 8.0.3 | [U81] |

### 10.6 Limity a čísla

**Remote management – podporované modely a minimální firmware pro instalaci ESX** [U68] (9.1) / [U69] (9.0). Jen
řádky relevantní pro herní vendory (plná tabulka obsahuje i Fujitsu iRMC S5/S6 a IBM RSA 2):

| Model | Firmware 9.1 | Firmware 9.0 |
|---|---|---|
| Dell DRAC 10 | 1.10.17.00 | 1.10.17.00 |
| Dell DRAC 9 | 6.0.30.00 | 6.0.30.00 |
| Dell DRAC 7 / 6 / 5 / 4 | 1.30.30 (Build 43) / 1.54 (Build 15), 1.70 (Build 21) / 1.0, 1.45, 1.51 / 1.75 | stejné |
| HP ILO / ILO 2 / ILO 3 / ILO 4 | 1.81, 1.92 / 1.8, 1.81 / 1.28 / 1.13 | stejné |
| HP ILO 5 | 2.72 | 2.72 |
| HPE ILO 6 | 1.10 | 1.10 |
| HPE ILO 7 | **[9.1]** 1.20 | **[9.0]** 1.13.0 |
| Lenovo XCC2 | 8.10 (iyx346k‑8.10) | stejné |
| Lenovo XCC3 | 9.11 (qgx3a2g‑9.11) | stejné |
| Cisco (CIMC), Supermicro | v tabulce **nejsou** | – |

Další čísla:
- Počet IP pro BMC, VLAN pro OOB, MTU OOB sítě: **nedokumentováno** (OOB je out of scope [U55]).
- DPM: IP BMC statická nebo DHCP s nekonečným leasem [U74].
- CIM ticket je třeba obnovovat zhruba každé 2 minuty [U77].

### 10.7 Síťový provoz

Toky doložené ve zdrojích (porty jen tam, kde je zdroj uvádí). Doplňuje sekci 7:

| # | Odkud | Kam | Síť | Protokol / port | Kdy / účel | Zdroj |
|---|---|---|---|---|---|---|
| O1 | admin (stanice) | BMC hosta (iLO/iDRAC) | OOB (síť **nedokumentovaná**, out of scope) | neuvedeno | zapnutí hostů při startu VCF | [U75][U76] |
| O2 | admin (remote management aplikace) | BMC hosta → virtual CD | OOB (nedokumentovaná) | neuvedeno | vzdálená instalace ESX z ISO | [U67] |
| O3 | vCenter (DPM) | BMC NIC hosta (IP ≠ IP hosta) | síť, kde je BMC NIC (nedokumentovaná) | IPMI (port neuveden) / iLO | probuzení hosta ze standby | [U73][U74] |
| O4 | vCenter (DPM) | ESX host | neuvedeno | Wake-on-LAN | fallback probuzení | [U73][U74] |
| O5 | monitoring aplikace | vCenter (ticket), pak ESX host | ESX management (vmk0) | CIM-XML **5989**; WS-Man „433“ (doslova, viz 10.8) | in-band hardware monitoring | [U77] |
| O6 | vCenter / vLCM | HSM (vendor appliance / Intersight) | neuvedeno (při proxy u vCenteru musí být HSM dosažitelný; IP 10.x.x.x je z proxy vyjmuta automaticky, jinak proxy výjimka) | neuvedeno | seznam firmware, verze, remediace | [U70][U71] |
| O7 | ESX OS | BMC | interní USB-NIC (vusb0, vSwitchBMC) – ne síťový kabel | neuvedeno | OS ↔ BMC rozhraní (DPU management) | [U78][U79] |

**Pro vizualizaci:** OOB kabel / OOB switch není dokumentovaná součást VCF networkingu [U55]. Pokud ho hra kreslí,
musí být graficky odlišený jako „mimo VCF scope“ a bez toků management domain (vCenter, NSX, vSAN…). Jediné doložené
toky přes BMC jsou O1–O3.

### 10.8 Otevřené otázky
1. **Planning and Preparation Workbook 9.1 / 9.1.1** (xlsx [U65]) – agent nedokázal přečíst binární xlsx. Zda záložky
   „Prerequisite Checklist“ / „Management Domain Creation“ obsahují řádek pro BMC/OOB (IP, VLAN), je neověřené.
   Doporučení: orchestrátor rozbalí xlsx (`unzip`, `xl/sharedStrings.xml`) a vyhledá „BMC|iLO|iDRAC|out-of-band|IPMI“.
2. **Porty BMC** (IPMI, Redfish/HTTPS, virtual media) – žádný povolený zdroj je neuvádí. Portál Ports and Protocols
   [U56] nešel stáhnout. Port IPMI (běžně 623/UDP) **nepřebírat z paměti**.
3. **Redfish** – v žádném nalezeném zdroji VCF 9.x / vSphere 9.1 nezmíněn (ani u HSM, ani ve VCF Operations).
4. **VCF Operations a BMC** – nenašli jsme integraci ani management pack pro BMC/Redfish ve VCF Operations 9.x. ESX
   health ve VCF Operations 9.1 má kategorii hardware (memory, SSD), zdroj dat ale neuveden. Neověřeno.
5. **Jak HSM komunikuje s hardwarem** (BMC vs. in-band) – v dokumentaci vSphere neuvedeno, řídí to OEM („The deployment
   method, entitlement, licensing, and management of a hardware support manager plug-in … are determined by the
   respective OEM“) [U70][U71].
6. **WS-Man „port 433“** [U77] – pravděpodobně překlep za 443, ale nepotvrzeno. Ve hře použít jen CIM-XML 5989, nebo
   nechat port neuvedený.
7. **KB 376173 (vSwitchBMC)** [U78] – environment bez verze VCF; text zmiňuje vSphere 8.0 / 8.0.3 a „VMware Cloud
   Foundation Bring-Up“. Platnost pro VCF Installer 9.1 a vztah k validaci „vSwitch0 s jedním uplinkem“ (5.3)
   nejsou doloženy.
8. **Supermicro a Cisco** – v tabulce remote install [U68] nejsou. Cisco má HSM přes Intersight [U71] a CIMC jen v KB
   [U80]. Supermicro BMC ani HSM ve zdrojích není. Podporu je třeba ověřit v BCG (HSM / ReadyNode), např. skriptem
   `tools/bcg`.
9. **DPM ve VCF** – Design Library 9.1 (cluster design) DPM nezmiňuje (ani doporučení, ani zákaz) [U83]. Zda je DPM
   v management domain VCF podporované nebo vhodné, není doloženo.
10. **Shutdown hostů** – zda postup vypnutí management domain (9.1) používá BMC, nebylo ověřeno přímým čtením stránky
    (vyhledávání naznačuje vSAN shutdown wizard / vSphere Client). Ověřit na „Shut Down the Management Domain“ 9.1.

### 10.9 Zdroje (pokračování)
- [U55] (už výše) Physical Data Center Network Design (VCF 9.1) – věta o OOB switchích „out of scope“.
- [U57] Physical Data Center Network Design (VCF 9.0): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/design/design-library/external-services-design/datacenter-network-requirements/physical-datacenter-design-9-x.html
- [U58] ESX Model – Design Library (VCF 9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/vsphere-detailed-design/esx-design.html
- [U59] Design Library for VCF (9.1, rozcestník): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library.html
- [U60] Network Fabric Detailed Design (VCF 9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/datacenter-network-requirements/network-fabric-design.html
- [U61] Minimal Footprint blueprint – Minimum Requirements (VCF 9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/infrastructure-modernization/vcf-fleet-in-a-single-site-with-minimal-footprint-blueprint/minimaltemo.html
- [U62] Minimal Footprint blueprint – Single-Rack Network Fabric Model (VCF 9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/infrastructure-modernization/vcf-fleet-in-a-single-site-with-minimal-footprint-blueprint/management-domain-design-selections/physical-infrastructure-layer/single-rack-network-fabric-model.html
- [U63] Planning and Preparation for VCF Fleet in a Single Site with Minimal Footprint (VCF 9.0): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/design/blueprints/vcf-fleet-basic-management-design/preparing-for.html
- [U64] Network Deployment Options for VCF Components (VCF 9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/planning-and-preparation/network-deployment-options-for-vcf-components.html
- [U65] Planning and Preparation (VCF 9.1) + Workbook 9.1.1: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/planning-and-preparation.html ; https://techdocs.broadcom.com/content/dam/broadcom/techdocs/us/en/assets/vmware-cis/vcf/vcf-9.1.1-planning-and-preparation-workbook.xlsx
- [U66] Install ESX on Hosts Using an ISO Image (VCF 9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/preparing-esx-hosts-for-vmware-cloud-foundation-or-vmware-vsphere-foundation/install-esx-on-hosts-using-the-iso.html
- [U67] Using Remote Management Applications (vSphere 9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/esx-installation-and-setup/installing-and-setting-up-esxi/esxi-requirements/using-remote-management-applications.html
- [U68] Supported Remote Management Server Models and Minimum Firmware Versions (vSphere 9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/esx-installation-and-setup/installing-and-setting-up-esxi/esxi-requirements/using-remote-management-applications/supported-remote-management-server-models-and-minimum-firmware-versions.html
- [U69] Totéž pro vSphere 9.0: https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-0/esx-installation-and-setup/installing-and-setting-up-esxi/esxi-requirements/using-remote-management-applications/supported-remote-management-server-models-and-minimum-firmware-versions.html
- [U70] Firmware Updates with vSphere Lifecycle Manager (vSphere 9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/managing-host-and-cluster-lifecycle/using-images-to-install-and-update-esxi-hosts-and-clusters/firmware-updates.html
- [U71] Deploying Hardware Support Managers (vSphere 9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/managing-host-and-cluster-lifecycle/using-images-to-install-and-update-esxi-hosts-and-clusters/firmware-updates/hardware-support-managers.html
- [U72] Use an Image for Firmware Updates (vSphere 9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/managing-host-and-cluster-lifecycle/using-images-to-install-and-update-esxi-hosts-and-clusters/firmware-updates/use-an-image-for-firmware-updates.html
- [U73] Managing Power Resources (vSphere DPM, vSphere 9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/vsphere-resource-management/using-drs-clusters-to-manage-resources/managing-power-resources.html
- [U74] Configure IPMI or iLO Settings for vSphere DPM (vSphere 9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/vsphere-resource-management/using-drs-clusters-to-manage-resources/managing-power-resources/configure-ipmi-or-ilo-settings-for-vsphere-dpm.html
- [U75] Start vSAN and the ESX Hosts in the Management Domain (VCF 9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/vcf-shutdown-and-startup/sddc-startup/start-the-management-domain/start-the-esx-hosts-and-vcenter-server-in-management-domain/start-vsan-and-the-esxi-hosts-in-the-management-domain.html
- [U76] Start ESX Hosts with NFS or Fibre Channel Storage in the Management Domain (VCF 9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/vcf-shutdown-and-startup/sddc-startup/start-the-management-domain/start-the-esx-hosts-and-vcenter-server-in-management-domain/start-esx-hosts-without-vsan-storage-in-the-management-domain.html
- [U77] Control Access for CIM-Based Hardware Monitoring Tools (vSphere 9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/vsphere-security/securing-esxi-hosts/general-security-recommendations/control-cim-based-hardware-monitoring-tool-access.html
- [U78] KB 376173 – ESXi creates standard switch vSwitchBMC with uplink vusb0: https://knowledge.broadcom.com/external/article/376173/esxi-creates-standard-switch-vswitchbmc.html
- [U79] KB 451680 – Automated iDRAC vSwitch Recreation Post-Reboot: https://knowledge.broadcom.com/external/article/451680/automated-idrac-vswitch-recreation-postr.html
- [U80] KB 317245 – Investigating Unexpected ESXi Reboot or Shutdown: https://knowledge.broadcom.com/external/article/317245/unexpected-esxi-reboot-or-shutdown.html
- [U81] KB 434645 – ESXi Host Enters Not Responding State with Management Agent Hang: https://knowledge.broadcom.com/external/article/434645/esxi-host-enters-not-responding-state-in.html
- [U82] Configuration Drift and Out-of-Band Operations in VCF (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/building-your-private-cloud-infrastructure/working-with-workload-domains/configuration-drift-and-out-of-band-operations-in-vmware-cloud-foundation.html
- [U83] vSphere Cluster Detailed Design (VCF 9.1; DPM / BMC nezmíněno): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/cluster-models.html

### 10.10 Dokumentované vs. herní scope (pro domain-modeler / scenario-designer)

| Prvek ve hře | Status | Opora |
|---|---|---|
| VCF networking vyřazuje OOB switche ze scope | **fakt** | [U55][U57] |
| OOB/BMC síť jako požadavek nebo doporučení VCF | **nedokumentováno** – nesmí blokovat validace VCF ani být podmínkou bring-upu | 10.1 |
| Seznam sítí management domain (ESX mgmt, VM mgmt, vMotion, vSAN/NFS, Host TEP, Edge TEP, Edge uplink, volitelně VCF mgmt) | **fakt** | [U43][U60][U61][U63][U64] |
| BMC existuje, je napájený i při vypnutém hostu, má vlastní NIC a IP odlišnou od IP hosta | **fakt** (vSphere 9.1 DPM) | [U74] |
| Zapnutí hostů management domain přes iLO/iDRAC při startu VCF | **fakt** | [U75][U76] |
| Instalace ESX přes remote management (virtual CD), podporované modely a min. firmware | **fakt** (vSphere 9.1) | [U67][U68] |
| Pořadí „OOB kabel → BMC IP → virtual media → ESX“ | **herní zjednodušení** (logické složení, ne postup z dokumentace) | 10.4.1 |
| BMC VLAN / subnet / MTU / port, OOB switch, kabeláž dedikovaného BMC portu | **herní scope** (out of scope VCF) | [U55] |
| vmk0 ≠ BMC; první dokumentovaná síť je ESX management (DCUI VLAN, vSwitch0, vmnic0) | **fakt** | [U18][U32][U74] |
| Firmware přes vLCM image + vendor HSM (Dell OMIVV, HPE COM/OneView, Lenovo XClarity Integrator, Cisco Intersight) | **fakt** | [U71][U72] |
| HSM mluví s BMC / Redfish | **nedokumentováno** | 10.8 #3, #5 |
| vSwitchBMC/vusb0 jako past při bring-upu | **fakt z KB s nejasnou verzí** – jen jako „možná příčina“, s odkazem na KB | [U78] |
| Incidenty: neočekávaný reboot přes iLO/iDRAC, SEL logy v BMC, ECC chyby v OOB konzoli | **fakt z KB** (verze ESXi 7/8, VVF 9.0) | [U80][U81] |
