# 26 – Interaktivní instalace ESX (krok za krokem)

> Modelovaná verze: **VCF 9.1.1 / ESX 9.1** (viz `docs/spec/VERSION.md`). Rozdíly jsou označeny **[9.0]** / **[9.1]**.
> Stav výzkumu: 2026-11-21. Odkazy `[Exx]` vedou do sekce 9 tohoto souboru.
>
> **Navazuje na:** `20-deployment` 4.1.1–4.1.4 (zkrácený postup VCF: ISO → DCUI → NTP → certifikát) a
> `25-usecases-and-physical` (§3.5 stav sítě ESX před installerem, §6.3 výchozí hodnoty sítě, §10 BMC / vzdálená
> instalace přes virtual media). Tady jsou **podrobnosti obrazovek, klávesy, doslovné texty a chybové stavy**
> z vSphere 9.1 „ESX Installation and Setup“, aby hra mohla instalaci simulovat obrazovku po obrazovce. Fakta už
> uvedená v 20/25 se neopakují, jen se na ně odkazuje.
>
> **Pozor na úroveň doslovnosti.** Nástroj pro čtení stránek vrací obsah TechDocs jen jako krátké citace. Texty
> v uvozovkách „…“ jsou citace věty z dokumentace (popis kroku), **ne** nutně přesný text na obrazovce instalátoru.
> Kde dokumentace uvádí název obrazovky / položky menu, je to vyznačeno **tučně**. Texty obrazovek, které dokumentace
> neuvádí (boot loader, „Loading…“, progress text), jsou v Otevřených otázkách a hra je musí označit jako ilustrativní.

---

## 1. Shrnutí

- Interaktivní instalace je jedna ze tří metod (interaktivně, skriptem, vSphere Auto Deploy) [E1]. Dokumentace ji
  doporučuje pro „small deployments of fewer than five hosts“ [E1][E2].
- Princip: server nabootuje instalátor z CD/DVD, USB nebo sítě (PXE) a admin odpovídá na výzvy průvodce, který
  nainstaluje ESX na lokální disk hosta [E3]. Instalátor disk přeformátuje a rozdělí na oddíly a nainstaluje boot image
  ESX [E2].
- **Caution:** na disku bez předchozí instalace ESX instalátor přepíše všechna data, včetně oddílů výrobce HW a OS
  („overwrites all data on the drive“) [E2].
- Po instalaci a rebootu se host konfiguruje v **DCUI** (Direct Console User Interface) – „Use the direct console
  interface for initial ESX configuration and troubleshooting.“ [E18]
- VCF 9.1 na to navazuje stránkami „Prepare ESX hosts“: síť v DCUI, NTP a SSH přes VMware Host Client, regenerace
  certifikátu [E34] (detail `20-deployment` 4.1.2–4.1.4).

## 2. Komponenty a vztahy

| Prvek | Co to je | Zdroj |
|---|---|---|
| ESX installer ISO | z Broadcom Support Portal nebo od OEM; VCF: verze dle VCF Release Notes, případně custom ISO (VCF PowerCLI / vSphere Lifecycle Manager) | [E30]; `20-deployment` 3.2 |
| Boot média instalátoru | „Boot from a CD/DVD.“ · „Boot from a USB flash drive.“ · „Boot from a network.“ · „Boot from a remote location using a remote management application.“ | [E11] |
| Instalační disk (boot device) | lokální HDD/SSD/NVMe (min. 32 GB, viz 6) nebo SAN LUN; nesmí být sdílený mezi hosty | [E6] |
| Oddíly systémového disku | System Boot (FAT16), Boot-bank 0, Boot-bank 1 (FAT16), ESX-OSData (VMFS-L), volitelně lokální VMFS datastore | [E8] |
| DCUI | textová konzole hosta; menu **System Customization** (F2) | [E18][E29] |
| VMware Host Client | webové UI hosta; ve VCF prep pro NTP a SSH | [E32][E33] |
| DPU (volitelně) | instaluje se spolu s ESX; jen UEFI; všechny DPU stejné | [E4] |

Vztahy:
- Instalátor mění **jen instalační disk** („The installer affects only the installation disk.“) [E9]. Ale při **prvním
  bootu** (autoconfiguration) se „all visible blank internal disks are formatted with the virtual machine file system
  (VMFS)“ [E17]. Rozpor s [E9] (autoPartition=FALSE) viz Otevřené otázky.
- Výběr disku, který je součástí **vSAN disk group**, smaže i další disky skupiny (viz 5.1) [E4].
- Klávesnici a root heslo lze po instalaci změnit v DCUI [E4][E19][E20].

## 3. Prerekvizity

### 3.1 Před spuštěním instalátoru [E4]
1. ISO instalátoru na CD/DVD nebo USB flash drive. Lze i PXE boot.
2. Hardwarové hodiny serveru nastavené na **UTC** v BIOS/UEFI.
3. Připojená klávesnice a monitor, nebo remote management aplikace (vzdálená instalace: `25` §10.4.1, [E40]).
4. Volitelně odpojit síťové úložiště (zkrátí hledání disků). **Neodpojovat** LUN s existující instalací ESX ani VMFS
   datastore s existující Service Console.
5. Shromáždit údaje, které průvodce vyžaduje (tabulka 3.3).
6. Na hostu nesmí být ESX Embedded: „ESX Installable and ESX Embedded cannot exist on the same host.“
7. **[VCF 9.1]** ISO z Broadcom Support Portal ve verzi dle VCF Release Notes; jinak custom ISO [E30].

### 3.2 Hardware (ESX 9.1) [E6]
- CPU: „ESX 9.1 and later requires a host with at least two CPU cores.“; „requires the NX/XD bit to be enabled for the
  CPU in the BIOS“; „support for hardware virtualization (Intel VT-x or AMD RVI) must be enabled on x64 CPUs“.
- RAM: „ESX 9.1 and later requires a minimum of 8 GB of physical RAM.“ Pro běžný provoz VM „at least 12 GB“.
- NIC: „One or more Gigabit or faster Ethernet controllers.“ (VCF má přísnější požadavky – `25` §5.3, `10-planning`.)
- Boot disk: „at least 32 GB of persistent storage such as HDD, SSD, or NVMe“; doporučeno min. **128 GB**; „A boot
  device must not be shared between ESX hosts.“
- Firmware: „booting ESX hosts from the Unified Extensible Firmware Interface (UEFI) is recommended“; „support for legacy
  BIOS is limited“. S DPU jen UEFI.
- CPU musí být podporované pro 9.x (seznam deprecated/discontinued řad: [E35]; certifikace serverů: BCG / `15-hardware`).
- **[9.0]** stejné minimum: 2 jádra, NX/XD, VT-x/RVI, 8 GB RAM (12 GB doporučeno), boot disk 32 GB (128 GB doporučeno)
  [E7].

### 3.3 Údaje, které průvodce / host potřebuje („Required Information for ESX Installation“, 9.1) [E10]

| Údaj | Povinné? | Výchozí | Poznámka (doslovně) |
|---|---|---|---|
| Keyboard layout | Required | „U.S. English“ | – |
| VLAN ID | Optional | None | „Range: 0 through 4095“ (DCUI ale „1 through 4094“ [E22] – rozpor, viz 8) |
| IP address | Optional | DHCP | „You can allow DHCP to configure the network during installation.“ |
| Subnet mask | Optional | „Calculated based on the IP address“ | – |
| Gateway | Optional | „Based on the configured IP address and subnet mask“ | – |
| Primary DNS | Optional | „Based on the configured IP address and subnet mask“ | – |
| Secondary DNS | Optional | None | – |
| Host name | Required for static IP settings | None | „The vSphere Client can use either the host name or the IP address to access the ESX host.“ |
| Install location | Required | None | „Must be at least 8 GB if you install the components on a single disk.“ (rozpor s 32 GB [E6], viz 8) |
| Root password | Required | None | „The root password must contain between 8 and 40 characters.“ (rozpor s [E12], viz 3.4 a 8) |

Interaktivní průvodce se ptá jen na **disk, klávesnici a root heslo** (kroky 4.1). Síť (VLAN, IP, DNS, hostname) se
nastavuje až po instalaci v DCUI (4.3) [E4][E28].

### 3.4 Pravidla root hesla
**[9.1]** „ESX Passwords and Account Lockout“ (vSphere Security 9.1) [E12]:
- „password length is at least 7 characters and at most 128“.
- Výchozí: „you must include a mix of at least one from each of the following four character classes“: „lowercase
  letters, uppercase letters, numbers, and special characters such as underscore or dash“.
- „An uppercase character that begins a password does not count toward the number of character classes used.“
- „A number that ends a password does not count toward the number of character classes used.“
- „Passwords must not contain the user name or parts of the user name.“
- „A dictionary word used inside a password reduces the overall password strength.“
- Platné heslo v příkladu: `xQaT3#A` (7 znaků, 4 třídy).
- Nastavení politiky: **[9.1]** nový advanced setting `Security.PasswordQualityControlPwquality` („follows the
  pam_pwquality module format“). ESX 9.0 a starší používaly `Security.PasswordQualityControl`. Při upgradu: když byl
  legacy setting nezměněný, nový má default; když byl změněný, nový je „UNUSED“ a platí legacy.
- „The default requirements for ESX passwords can change from one release to the next.“

**[9.0]** Stejná stránka pro 9.0 [E13]:
- „By default, password length is at least 7 characters and less than 40.“
- „By default, you must include a mix of at least three from the following four character classes.“
- Příklady: povolené `xQaTEhb!`, `xQaT3#A`; odmítnuté `Xqat3hi` („Begins with an uppercase character, reducing the
  effective number of character classes to two.“) a `xQaTEh2` („Ends with a number“).
- Pass phrases „are deactivated by default“.

Společné (9.0 i 9.1) [E12][E13]:
- Historie hesel: „Starting in vSphere 8.0 Update 1, the default is five.“
- Lockout: „a maximum of five failed attempts is allowed before the account is locked“; „The account is unlocked after
  15 minutes by default.“ Lockout platí pro SSH a vSphere Web Services SDK. „The Direct Console Interface (DCUI) and the
  ESX Shell do not support account lockout.“

**[VCF]** Pro VCF Installer musí mít hosty heslo splňující „predefined requirements“ (`20-deployment` 3.6).

## 4. Workflow

### 4.1 Instalátor – sekvence obrazovek (vSphere 9.1 „Install ESX Interactively“ [E4], VCF 9.1 „Install ESX on Hosts Using an ISO Image“ [E30])

Stránka vSphere kroky nečísluje (11 odrážek). Číslování níže je naše, pořadí je z [E4].

| # | Obrazovka / akce | Vstup / klávesa | Doslovné texty a poznámky | Zdroj |
|---|---|---|---|---|
| I-1 | Vložit médium + restart | – | „Insert the ESX installer CD/DVD into the CD/DVD-ROM drive“ (nebo připojit USB). VCF: „Mount the ESX ISO on the host and restart the machine“ | [E4][E30] |
| I-2 | BIOS/UEFI: boot device | volba boot zařízení (CD-ROM / USB / mounted ISO) | „If your system has data processing units (DPUs), you can only use UEFI to install and boot ESX on the DPUs.“ | [E4] |
| I-3 | (načítání instalátoru) | – | **Nedokumentováno** – boot loader / loading obrazovky TechDocs nepopisuje (viz 8) | – |
| I-4 | **Welcome** screen | **Enter** | „press Enter to continue“ | [E4][E30] |
| I-5 | **End User License Agreement** | **Enter** = accept | Od ESX 8.0 U3 se DPU vypíší automaticky (s PCI slotem). „The DPU devices must be identical: same vendor, same hardware version, and same firmware.“ | [E4][E30] |
| I-6 | **Select a Disk to Install or Upgrade** | šipky + **Enter**; **F1** = detail disku | „Press F1 for information about the selected disk.“ · Caution: „Do not rely on the disk order in the list to select a disk.“ (pořadí určuje BIOS/UEFI a může se měnit) · vSAN disk group pravidla viz 5.1 | [E4] |
| I-6a | **Confirm Disk Selection** (jen když disk obsahuje data) | potvrzení (klávesa neuvedena) | „If you select a disk that contains data, the Confirm Disk Selection page appears.“ | [E4] |
| I-6b | Volby pro existující ESX / VMFS (jen když disk obsahuje ESX nebo VMFS datastore) | výběr volby | „the installer provides several choices“ – **názvy voleb dokumentace neuvádí**. Upgrade stránka: „Upgrade or install ESX if the installer finds an existing ESX installation and VMFS datastore.“; když VMFS nejde zachovat: „can choose only to install ESX and overwrite the existing VMFS datastore, or to cancel the installation.“ Upgrade/migrace → ESX Upgrade dokumentace | [E4][E14] |
| I-6c | **Select a Disk to store ESX OSData** (jen když byl vybrán SD/USB) | výběr disku + Enter | Zobrazí se warning; „select a persistent storage device with minimum 32 GB of available space.“ | [E4] |
| I-7 | Keyboard type | výběr rozložení | výchozí „U.S. English“ [E10]; „You can change the keyboard type after installation in the direct console.“ | [E4][E10] |
| I-8 | Root password | zadat heslo (+ potvrzení – viz 8) | „You can change the password after installation in the direct console.“ Pravidla 3.4 | [E4] |
| I-9 | (případné varování k HW / CPU) | – | Text „CPU_SUPPORT_WARNING …“ (deprecated CPU) / blokace (discontinued CPU) – kde přesně v sekvenci se zobrazí, dokumentace neuvádí (5.2, 8) | [E35][E36] |
| I-10 | **Confirm Install** | **F11** = start | „Press F11 to confirm the start of the installation.“ S DPU je každá DPU na vlastním řádku | [E4][E30] |
| I-11 | Průběh instalace | – | Od 8.0 U3 „a single progress bar“ pro ESX i DPU. Text progress obrazovky neuveden | [E4] |
| I-12a | **Installation Complete** (úspěch) | vyjmout médium, **Enter** = reboot | „When the installation is complete, remove the installation CD, DVD, or USB flash drive.“ · „Press Enter to reboot the host.“ Název obrazovky „Installation Complete“ uvádí VCF stránka [E30], vSphere stránka ne | [E4][E30] |
| I-12b | **Operation Failed** (selhání) | – | Od 8.0 U3: „if the installation is not successful on any of the targets, you see the Operation Failed screen.“ Zaznamenat error log pro troubleshooting | [E4] |
| I-13 | BIOS/UEFI: první boot device | nastavit disk s ESX | „Set the first boot device to be the drive on which you installed ESX in step 5.“ „UEFI systems might require additional steps to set the boot device.“ (viz 5.3) | [E4] |
| I-14 | VCF: opakovat na všech hostech | – | „Repeat the procedure on all remaining hosts.“ | [E30] |

Klávesy instalátoru (dokumentované): **Enter** (pokračovat / přijmout EULA / vybrat disk / reboot), **F1** (detail
disku), **F11** (potvrdit instalaci) [E4]. Pro upgrade stejné: „Press F11 to confirm and start the upgrade.“ [E14]

**[9.0]** Sekvence je stejná (Welcome → EULA → Select a Disk → Confirm Disk Selection / volby → klávesnice → root
heslo → Confirm Install F11 → OSData 32 GB pro SD/USB → Operation Failed / remove media → Enter reboot → first boot
device) [E5]. Rozdíl 9.0 vs 9.1 ve vlastním průvodci nebyl nalezen. Rozdíly jsou v pravidlech hesla (3.4).

### 4.2 První boot – autokonfigurace [E17][E28][E21]
1. „When you turn on the ESX host for the first time or after resetting the configuration defaults, the host enters an
   autoconfiguration phase.“ „This phase configures system network and storage devices with default settings.“ [E17]
2. Síť: DHCP („By default, Dynamic Host Configuration Protocol (DHCP) configures IP“) [E17]. Bez DHCP link-local
   169.254.x.x/16 [E28]. Pro management zvolí **vmnic0** [E21]. (Stav sítě po instalaci, vSwitch0: `25` §1 B, §6.3.)
3. Úložiště: „all visible blank internal disks are formatted with the virtual machine file system (VMFS)“ [E17]; boot
   disk > 140 GB dostane lokální VMFS datastore (6.2) [E8][E9].
4. DCUI ukazuje IP adresu: „The assigned IP address appears on the direct console.“ [E28]

### 4.3 DCUI – první kroky (vSphere 9.1)

**Klávesy DCUI** („About the Direct Console ESX Interface“) [E18]:

| Akce (doslovně) | Klávesa |
|---|---|
| „View and change the configuration“ | **F2** |
| „Change the user interface to high-contrast mode“ | **F4** |
| „Shut down or restart the host“ | **F12** |
| „View the VMkernel log“ | **Alt+F12** |
| „Switch to the shell console“ | **Alt+F1** |
| „Switch to the direct console user interface“ | **Alt+F2** |
| „Move the selection between fields“ | **Arrow keys** |
| „Select a menu item“ | **Enter** |
| „Toggle a value“ | **Spacebar** |
| „Confirm sensitive commands, such as resetting configuration defaults“ | **F11** |
| „Save and exit“ | **Enter** |
| „Exit without saving“ | **Esc** |
| „Exit system logs“ | **q** |

**Sekvence (pořadí VCF 9.1 [E31], položky menu z vSphere 9.1):**

| # | Krok | Menu / pole | Klávesy | Zdroj |
|---|---|---|---|---|
| D-1 | Vstup do konfigurace | „Press F2 to enter the DCUI.“ → menu **System Customization** | **F2** | [E31][E29] |
| D-2 | Přihlášení | root + heslo z instalace | Enter | [E31] |
| D-3 | (volitelně) Změna hesla | **Configure Password**: „Old Password“ (jen když heslo existuje) → „New Password“ → znovu | Enter po každém poli | [E20] |
| D-4 | (volitelně) Klávesnice | **Configure Keyboard** → vybrat layout | Enter; **Spacebar** přepíná výběr; Enter | [E19] |
| D-5 | Management síť | **Configure Management Network** | Enter | [E21][E31] |
| D-5a | Síťové adaptéry | **Network Adapters** → vybrat adaptér (vmnic0, vmnic1…) | Enter | [E21] |
| D-5b | VLAN | vSphere: **VLAN**; VCF: **VLAN (Optional)** → VLAN ID „from 1 through 4094“ | Enter | [E22][E31] |
| D-5c | IPv4 | vSphere: **IP Configuration** → „Set static IP address and network configuration“; VCF: **IPv4 Configuration** → „Set static IPv4 address and network configuration“ → IP address, Subnet mask, Default gateway | VCF: **Space bar** pro výběr volby, **Enter** potvrdit | [E23][E31] |
| D-5d | IPv6 (jen dual-stack) | **IPv6 Configuration** → „Set static IPv6 address and network configuration“ → IPv6, CIDR, gateway | Space bar | [E31] |
| D-5e | DNS + hostname | **DNS Configuration** → vSphere: „Use the following DNS server addresses and hostname“ (VCF: „Use the following DNS Server address and hostname“) → Primary DNS, Alternate DNS (optional), Hostname (VCF: FQDN) | Space bar, Enter | [E24][E31] |
| D-5f | DNS sufixy | **Custom DNS Suffixes** – výchozí: „By default, DHCP acquires the DNS suffixes.“ **VCF: ověřit, že žádné nejsou**, Enter | Enter | [E25][E31] |
| D-6 | Uložit a odejít | „Press Escape to exit and press Y to confirm the changes.“ (přesný text dialogu neuveden) | **Esc**, **Y** | [E31] |
| D-7 | (volitelně) Restart sítě | **Restart Management Network** → „Press F11 to confirm the restart.“ | Enter, **F11** | [E26] |
| D-8 | Test sítě | **Test Management Network** → „Press Enter to start the test.“ Testy: „Pings the default gateway“, „Pings the primary DNS name server“, „Pings the secondary DNS nameserver“, „Resolves the configured host name“ | Enter, Enter | [E27] |
| D-9 | VCF: opakovat na každém hostu | – | – | [E31] |

Pozn.: VCF stránka sítě [E31] kroky D-5a, D-7 a D-8 nemá. Pro VCF je ale požadavek „vmk0 … connected to a single
management NIC on a vSphere Standard Switch“ (např. vmnic0) [E31] – D-5a je tedy místo, kde to hráč může pokazit
(více NIC → chyba validace installeru, `25` §5.3).

**[9.0]** Rozdíly v DCUI krocích mezi 9.0 a 9.1 nebyly zkoumány stránku po stránce (viz 8).

### 4.4 Co přidává VCF „Prepare ESX hosts“ (9.1) [E34]
Pořadí: Install ESX z ISO → Configure Network (DCUI, 4.3) → Configure NTP → Regenerate self-signed certificate
(→ případně signed certificates). Detail kroků je v `20-deployment` 4.1.3–4.1.4 [E32][E33]. Shrnutí:
1. **NTP** – VMware Host Client: Time Configuration → Network Time Protocol → EDIT → Enable → NTP server → OK; ověřit,
   že služba běží [E32].
2. **SSH** – Host Client **Actions > Services > Enable Secure Shell (SSH)** [E33]. Alternativa v DCUI (vSphere 9.1):
   F2 → **Troubleshooting Options** → **Troubleshooting Mode Options**: **Enable ESX Shell** / **Enable SSH** → Enter;
   **Modify ESX Shell and SSH timeouts** (výchozí timeout „0 (not active)“); Esc zpět do hlavního menu [E29].
3. **Certifikát** – SSH: `esxcli system hostname get` (příp. `set --fqdn=`), `/sbin/generate-certificates`, reboot,
   pak SSH vypnout [E33]. Původní certifikát má CN `localhost.localdomain`; installer kontroluje CN proti FQDN
   (`20-deployment` 3.2).

## 5. Chybové stavy

### 5.1 Výběr disku
| Situace | Následek / text | Verze | Zdroj |
|---|---|---|---|
| Disk bez předchozí instalace ESX | přepíše všechna data na disku (Caution) | 9.1 | [E2] |
| Disk obsahuje data | obrazovka **Confirm Disk Selection** | 9.0, 9.1 | [E4][E5] |
| Disk s ESX / VMFS, VMFS nejde zachovat | jen „install ESX and overwrite the existing VMFS datastore, or … cancel“; zálohovat datastore | 9.1 (upgrade) | [E14] |
| Výběr **SSD** ve vSAN disk group | „the SSD and all underlying HDDs in the same disk group are wiped“ | 9.0, 9.1 | [E4] |
| Výběr **HDD**, disk group > 2 disky | „only the selected HDD is wiped“ | 9.0, 9.1 | [E4] |
| Výběr **HDD**, disk group ≤ 2 disky | „the SSD and the selected HDD is wiped“ | 9.0, 9.1 | [E4] |
| Spoléhání na pořadí disků | Caution: pořadí určuje BIOS/UEFI, může se lišit → riziko přepsání špatného disku | 9.x | [E4] |
| Vybrán SD/USB disk | warning + nutná obrazovka **Select a Disk to store ESX OSData** (persistent, min. 32 GB) | 9.0, 9.1 | [E4][E5] |
| Bez persistentního úložiště pro OSData | „ESX-OSData is automatically created on a RAM disk“; alarm „Secondary persistent device not found. Please move installation to persistent storage as support for SD-Card/USB only configuration is being deprecated.“ | 9.1 | [E6] |
| Instalátor nevidí disky (NVMe za Intel VMD, Micron 6550) | „does not see Micron 6550 as a device to install on“; vmkernel log „Attach device failed:Out of memory“; řešení: ESX 9.0.1 build (iavmd -4vmw) nebo vypnout VMD | **[9.0] GA** (KB) | [E38] |
| Instalátor vidí jen fyzické disky, ne RAID logical devices | chybí driver v ISO → OEM custom ISO, případně vendor | ESXi (verze neuvedena) | [E39] |
| Sdílený boot disk / LUN mezi hosty se stejnou scratch | „The host stops at bootup when sharing a boot disk with another host.“ → ScratchConfig.ConfiguredScratchLocation unikátní pro hosta | 9.1 | [E16] |

### 5.2 CPU / paměť / HW
| Situace | Následek / text | Verze | Zdroj |
|---|---|---|---|
| CPU řada **Deprecated** | installer zobrazí warning, instalace pokračuje: „CPU_SUPPORT_WARNING: The CPUs in this host may not be supported in future VCF releases. Plan accordingly.“ (KB 413002 má „Please plan accordingly.“ a uvádí ho u upgradu) | 9.x | [E35][E36] |
| CPU řada **Discontinued** | „the ESX/VCF installer will block or prevent the installation“; přesný text chyby KB neuvádí | 9.x | [E35] |
| Konkrétní řady 9.x – Deprecated | AMD EPYC 7001 (Naples), EPYC 7002/7Fx2 (Rome), Intel Xeon Scalable 2. gen. (Cascade Lake SP / Refresh), Xeon E-2100/E-2200 (Coffee Lake), Atom C3000 (Denverton) | 9.x | [E35] |
| Konkrétní řady 9.x – Discontinued | Broadwell-DE/EP (Xeon D-1500, E5-2600/1600/4600-V4, E7-8800/4800-V4), Skylake S (E3-1200/1500-V5), Kabylake-S (E3-1200-v6), Skylake-D (D-2100), Skylake-W (W-2100) | 9.x | [E35] |
| Skylake-SP (Xeon Scalable 1. gen.) | dříve discontinued ve 9.0; update KB 2026-09-18: „Deprecated Mode“ pro VCF 9.x (9.0 GA i 9.1.x), instalace s OVERRIDE dle přiloženého PDF; EOL CPU „will not be recognized by ESX 9.x during installation“ | 9.0, 9.1 | [E37] |
| < 2 CPU jádra, NX/XD vypnutý, VT-x/RVI vypnuté, < 8 GB RAM | požadavek nesplněn [E6]; **text chyby instalátoru dokumentace 9.1 neuvádí** (viz 8) | 9.1 | [E6] |
| Upgrade serveru s boot diskem < 8 GB | „Upgrading servers with boot disk of size less than 8 GB to ESX 9.1 is blocked.“ (**[9.0]** „to ESX 9.0 is blocked“) | 9.0, 9.1 | [E6][E7] |
| DPU host při interaktivním upgradu | interaktivní / skriptovaný installer DPU hosty pro upgrade nepodporuje → vLCM nebo ESXCLI | 9.1 | [E14] |
| Na hostu je ESX Embedded | nelze: „ESX Installable and ESX Embedded cannot exist on the same host.“ | 9.1 | [E4] |

### 5.3 Boot po instalaci
| Situace | Následek / text | Zdroj |
|---|---|---|
| UEFI host po instalaci nenabootuje | „After you install ESX on a host machine in UEFI mode, the machine might fail to boot.“ Často „No boot device available“. Příčiny: zápis do NVRAM, firmware přepíše boot order, starý firmware, boot disk s MBR/MSDOS tabulkou („If the boot disk has an MBR or MSDOS partition table, a UEFI boot fails.“). Řešení: boot menu (klávesa / BIOS / BMC, iLO, iDRAC) → „VMware ESX“; jinak „Add boot option“ → `\EFI\BOOT\BOOTx64.EFI` → nastavit pořadí | [E15] |
| Médium nevyjmuto / první boot device nenastaven | dokumentace jen předepisuje kroky I-12a a I-13. Co se stane jinak, neuvádí (viz 8) | [E4] |
| Vzdálená instalace – virtual CD | možné poškození při zátěži → dokončit z fyzického média (`25` §10.5) | [E40] |

### 5.4 DCUI / síť
| Situace | Následek / text | Zdroj |
|---|---|---|
| Restart Management Network | „Restarting the management network will result in a brief network outage“; nová DHCP identita (IP/hostname) → vzdálený management se odpojí | [E26] |
| Test Management Network selže | test pinguje gateway, primary/secondary DNS a resolvuje hostname. Jak se výsledek zobrazí, dokumentace neuvádí | [E27] |
| Bez DHCP | link-local 169.254.x.x/16 | [E28] |
| Špatná hesla v DCUI | DCUI **nepodporuje account lockout** (zamykání jen SSH / SDK, 5 pokusů / 15 min) | [E12] |
| Chyby, které se projeví až ve VCF Installeru (vSwitch0, 1 uplink, custom DNS suffixy, CN certifikátu) | `25` §5.3, `20-deployment` 5.2 | – |

## 6. Limity a čísla

### 6.1 Hardware a heslo
| Položka | 9.1 | 9.0 | Zdroj |
|---|---|---|---|
| CPU jádra min. | 2 | 2 | [E6][E7] |
| RAM min. / doporučeno | 8 GB / 12 GB | 8 GB / 12 GB | [E6][E7] |
| Boot disk min. / doporučeno | 32 GB / 128 GB | 32 GB / 128 GB | [E6][E7] |
| Boot disk endurance / zápis | 128 TBW / 100 MB/s sekv. zápis | stejné | [E6][E7] |
| OSData pro SD/USB boot | persistent, min. 32 GB | stejné | [E4][E5] |
| Upgrade blokován při boot disku | < 8 GB | < 8 GB | [E6][E7] |
| Boot z disku > 2 TB | ano (podle firmware) | – | [E6] |
| Root heslo délka | 7–128 | 7–39 („less than 40“) | [E12][E13] |
| Třídy znaků (default) | všechny 4 | aspoň 3 ze 4 | [E12][E13] |
| Historie hesel | 5 | 5 | [E12][E13] |
| Lockout | 5 pokusů, unlock 15 min (ne DCUI) | stejné | [E12][E13] |
| VLAN ID v DCUI | 1–4094 | – | [E22] |
| Doporučení interaktivní instalace | < 5 hostů | – | [E1] |
| DCUI ESX Shell / SSH timeout default | „0 (not active)“ | – | [E29] |

### 6.2 Rozdělení boot disku (ESX 9.1) [E8][E9]

| Oddíl | 8–32 GB | 32–128 GB | > 128 GB |
|---|---|---|---|
| System Boot (FAT16) | ~105 MB | ~105 MB | ~105 MB |
| Boot-bank 0 (FAT16) | ~1 GB | ~4 GB | ~4 GB |
| Boot-bank 1 (FAT16) | ~1 GB | ~4 GB | ~4 GB |
| ESX-OSData (VMFS-L) | zbytek | zbytek | až 138 GB |
| VMFS datastore | – | – | zbytek (média > 140 GB) |

- „If the boot media is a high-endurance one with capacity larger than 140 GB, a VMFS datastore is created
  automatically to store virtual machine data.“ [E8]
- „The default is autoPartition=FALSE, which formats with VMFS only boot devices with size larger than 140 GB.“; „the
  ESX installer requires a minimum of 140 GB of free space on the installation disk“ [E9].
- Boot option `systemMediaSize`: `default` (138 GB), `max` (celé místo) – detail KB 345195 [E8].
- ESX-OSData: „Not used for booting and virtual machines.“ Sjednocuje scratch, VMware Tools locker a core dump [E8].

## 7. Síťový provoz

Během instalace (I-1 až I-13) instalátor z lokálního / virtuálního média **žádné síťové toky nedokumentuje** (kromě
varianty PXE boot a remote management – `25` §10.7 O2). Toky po instalaci:

| # | Odkud | Kam | Síť | Protokol / port | Kdy / účel | Zdroj |
|---|---|---|---|---|---|---|
| E-N1 | ESX (vmk0) | DHCP server | ESX management | DHCP (port neuveden) | autokonfigurace při prvním bootu (stejné jako `25` N1) | [E17][E28] |
| E-N2 | ESX (vmk0) | default gateway | ESX management | ping | DCUI Test Management Network | [E27] |
| E-N3 | ESX (vmk0) | primary DNS, secondary DNS | ESX management | ping | DCUI Test Management Network | [E27] |
| E-N4 | ESX (vmk0) | DNS server | ESX management | DNS resolve (port neuveden) | „Resolves the configured host name“ | [E27] |
| E-N5 | ESX (vmk0) | DHCP server | ESX management | DHCP renew | Restart Management Network („renew a DHCP lease“) | [E26] |
| E-N6 | admin stanice | ESX Host Client | ESX management | HTTPS (port neuveden zde) | NTP / SSH nastavení ve VCF prep | [E32][E33] |
| E-N7 | ESX | NTP server | ESX management | NTP (port neuveden zde) | po zapnutí NTP | [E32] |
| E-N8 | admin stanice | ESX | ESX management | SSH (port neuveden zde) | regenerace certifikátu | [E33] |

ESX firewall „is configured to block incoming and outgoing traffic“ ve výchozím stavu kromě služeb instalovaných
ve výchozím stavu. Porty uvádí jen VMware Ports and Protocols Tool [E41]. Ten nejde agentem přečíst, viz 8.

## 8. Otevřené otázky

1. **Texty obrazovek instalátoru** – boot loader / „Loading ESX installer“, přesný text Welcome, EULA (klávesy pro
   odmítnutí / listování), progress obrazovky, „Installation Complete“ a dialogu po Esc v DCUI („Y“): TechDocs 9.1
   je nepopisují doslovně. Hra je musí označit jako ilustrativní.
2. **Názvy voleb pro disk s existujícím ESX / VMFS** (např. upgrade / install s zachováním / přepsáním VMFS) – stránky
   9.1 [E4][E14] jen říkají „several choices“. Konkrétní popisky nenalezeny.
3. **Potvrzení hesla v instalátoru** (pole „Confirm password“) a kontrola pravidel při zadání: [E4] říká jen „Enter
   the root password“. Jakou hlášku instalátor ukáže při slabém heslu, není doloženo.
4. **Rozpor pravidel hesla** – „Required Information“ 9.1 [E10]: „between 8 and 40 characters“; Security 9.1 [E12]:
   7–128 a všechny 4 třídy; Security 9.0 [E13]: 7–39, 3 ze 4 tříd. Pro hru doporučujeme [E12] (podrobnější stránka),
   ale rozpor je potřeba ověřit.
5. **Install location min.** – [E10] „at least 8 GB“ vs. [E6] „at least 32 GB“. Pravděpodobně zastaralá tabulka [E10].
   Hra má použít 32 GB ([E6]), ale nepotvrzeno.
6. **VLAN rozsah** – [E10] „0 through 4095“ vs. DCUI [E22] „1 through 4094“.
7. **Chybové hlášky instalátoru pro RAM < 8 GB, < 2 jádra, NX/XD / VT-x vypnuté** – precheck tabulka („Errors and
   Warnings Returned by the Installation and Upgrade Precheck Script“) pro 9.1 nebyla v TechDocs nalezena. Kódy jako
   MEMORY_SIZE / CPU_SUPPORT jsou doložené jen pro starší verze (mimo povolený rozsah verzí) – **nepřebírat**.
8. **Kde v sekvenci se zobrazí CPU_SUPPORT_WARNING** u čisté interaktivní instalace (KB 413002 mluví o upgradu) a jaká
   klávesa ho potvrzuje.
9. **Rozpor autoformátu disků** – [E17] „all visible blank internal disks are formatted with … VMFS“ při autokonfiguraci
   vs. [E9] „autoPartition=FALSE, which formats with VMFS only boot devices with size larger than 140 GB“. Pro vSAN
   (disky musí zůstat nenaformátované) je to důležité – ověřit.
10. **Hranice 128 vs. 140 GB** pro lokální datastore [E8] (sloupec „> 128 GB“ vs. text „larger than 140 GB“).
11. **DCUI IPv6 / IPv4 názvy položek** – vSphere 9.1 [E23] má „IP Configuration“ / „Set static IP address…“, VCF 9.1
    [E31] „IPv4 Configuration“ / „Set static IPv4 address…“. Skutečný popisek v ESX 9.1 nepotvrzen. Stránka vSphere
    9.1 pro IPv6 v DCUI nenalezena.
12. **Rozdíly DCUI 9.0 vs. 9.1** – nezkoumáno stránku po stránce. Instalátor 9.0 [E5] vs. 9.1 [E4] beze změny sekvence.
13. **Výsledek Test Management Network** (formát „OK“ / „FAILED“) – neuveden [E27].
14. **Porty** (DHCP, DNS, NTP, SSH, HTTPS Host Client) – firewall stránka [E41] odkazuje na Ports and Protocols Tool
    (https://ports.broadcom.com/), který nejde agentem přečíst (stejně jako `25` §8 #13).
15. **KB 322291** („Installation of ESXi Shows No Available Local Disks“) uvádí workaround `preferVmklinux=TRUE` přes
    **Shift+O** – bez verze. VMKLinux v ESX 9.x nemusí existovat → **nepřebírat**. Klávesa Shift+O pro boot options
    v 9.1 nebyla ověřena na techdocs.
16. **Co se stane, když admin nevyjme médium / nenastaví boot order** – nedokumentováno (v realitě znovu naběhne
    instalátor; nepřebírat bez zdroje).

## 9. Zdroje

vSphere 9.1 ESX Installation and Setup – základ: `https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/esx-installation-and-setup/`

- [E1] Installing ESX (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/esx-installation-and-setup/installing-esxi.html
- [E2] Installing ESX Interactively (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/esx-installation-and-setup/installing-esxi/installing-esxi-interactively.html
- [E3] Interactive ESX Installation (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/esx-installation-and-setup/installing-esxi/installing-esxi-interactively/interactive-esxi-installation.html
- [E4] Install ESX Interactively (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/esx-installation-and-setup/installing-esxi/installing-esxi-interactively/install-esxi-interactivelly.html
- [E5] Install ESX Interactively (9.0): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-0/esx-installation-and-setup/installing-esxi/installing-esxi-interactively/install-esxi-interactivelly.html
- [E6] ESX Hardware Requirements (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/esx-installation-and-setup/installing-and-setting-up-esxi/esxi-requirements/esxi-hardware-requirements.html
- [E7] ESX Hardware Requirements (9.0): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-0/esx-installation-and-setup/installing-and-setting-up-esxi/esxi-requirements/esxi-hardware-requirements.html
- [E8] ESX System Storage Overview (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/esx-installation-and-setup/installing-and-setting-up-esxi/esxi-requirements/esxi-system-storage-overview.html
- [E9] Storage Behavior (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/esx-installation-and-setup/installing-and-setting-up-esxi/esxi-requirements/esxi-system-storage-overview/storage-behavior.html
- [E10] Required Information for ESX Installation (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/esx-installation-and-setup/installing-and-setting-up-esxi/before-you-install-esxi/required-information-for-esx-installation.html
- [E11] Media Options for Booting the ESX Installer (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/esx-installation-and-setup/installing-and-setting-up-esxi/before-you-install-esxi/media-options-for-booting-the-esx-installer(1).html
- [E12] ESX Passwords and Account Lockout (vSphere Security 9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/vsphere-security/securing-esxi-hosts/general-security-recommendations/esxi-passwords-and-lockout.html
- [E13] ESX Passwords and Account Lockout (vSphere Security 9.0): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-0/vsphere-security/securing-esxi-hosts/general-security-recommendations/esxi-passwords-and-lockout.html
- [E14] Upgrade Hosts Interactively (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/esx-upgrade/upgrade-or-migrate-hosts-interactively.html
- [E15] Host Fails to Boot After You Install ESX in UEFI Mode (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/esx-installation-and-setup/troubleshooting-esxi-booting/host-fails-to-boot-after-esxi-is-installed-in-uefi-mode.html
- [E16] Host Stops Unexpectedly at Bootup When Sharing a Boot Disk (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/esx-installation-and-setup/troubleshooting-esxi-booting/host-stops-unexpectedly-at-bootup-when-sharing-a-boot-disk-with-another-host.html
- [E17] ESX Autoconfiguration (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/esx-installation-and-setup/setting-up-esxi/initial-esxi-configuration/esxi-autoconfiguration.html
- [E18] About the Direct Console ESX Interface (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/esx-installation-and-setup/setting-up-esxi/initial-esxi-configuration/about-the-direct-console-esxi-interface.html
- [E19] Configure the Keyboard Layout for the Direct Console (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/esx-installation-and-setup/setting-up-esxi/initial-esxi-configuration/configure-the-keyboard-layout.html
- [E20] Set the Password for the Administrator Account (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/esx-installation-and-setup/setting-up-esxi/set-the-password-for-the-administrator-account.html
- [E21] Choose Network Adapters for the Management Network (9.1; = `25` [U32]): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/esx-installation-and-setup/setting-up-esxi/configuring-network-settings/choose-network-adapters-for-the-management-network.html
- [E22] Set the VLAN ID (9.1; = `25` [U33]): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/esx-installation-and-setup/setting-up-esxi/configuring-network-settings/set-the-vlan-id.html
- [E23] Configure IP Settings from the Direct Console (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/esx-installation-and-setup/setting-up-esxi/configuring-network-settings/configure-ip-settings-from-the-direct-console.html
- [E24] Configure DNS Settings from the Direct Console (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/esx-installation-and-setup/setting-up-esxi/configuring-network-settings/configure-dns-settings-from-the-direct-console.html
- [E25] Configure DNS Suffixes (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/esx-installation-and-setup/setting-up-esxi/configuring-network-settings/configure-dns-suffixes.html
- [E26] Restart the Management Network (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/esx-installation-and-setup/setting-up-esxi/restart-the-management-network.html
- [E27] Test the Management Network (9.1; = `25` [U34]): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/esx-installation-and-setup/setting-up-esxi/test-the-management-network.html
- [E28] Network Access to Your ESX Host (9.1; = `25` [U31]): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/esx-installation-and-setup/setting-up-esxi/configuring-network-settings/network-access-to-your-esxi-host.html
- [E29] Enable ESX Shell and SSH Access with the Direct Console User Interface (9.1): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/esx-installation-and-setup/setting-up-esxi/enable-esxi-shell-and-ssh-access-with-the-direct-console-user-interface.html
- [E30] Install ESX on Hosts Using an ISO Image (VCF 9.1; = `20` [S8], `25` [U66]): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/preparing-esx-hosts-for-vmware-cloud-foundation-or-vmware-vsphere-foundation/install-esx-on-hosts-using-the-iso.html
- [E31] Configure the Network on the ESX Hosts (VCF 9.1; = `20` [S9], `25` [U18]): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/preparing-esx-hosts-for-vmware-cloud-foundation-or-vmware-vsphere-foundation/configure-the-network-on-vmware-cloud-foundation-hosts.html
- [E32] Configure NTP on ESX Hosts (VCF 9.1; = `20` [S10]): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/preparing-esx-hosts-for-vmware-cloud-foundation-or-vmware-vsphere-foundation/configure-ntp-on-vmware-cloud-foundation-hosts.html
- [E33] Regenerate the Self-Signed Certificate on ESX Hosts (VCF 9.1; = `20` [S11]): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/preparing-esx-hosts-for-vmware-cloud-foundation-or-vmware-vsphere-foundation/regenerate-the-self-signed-certificate-on-esx-hosts.html
- [E34] Preparing ESX Hosts for VCF or vSphere Foundation (VCF 9.1; = `20` [S7], `25` [U17]): https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/preparing-esx-hosts-for-vmware-cloud-foundation-or-vmware-vsphere-foundation.html
- [E35] KB 318697 – CPU Support Deprecation and Discontinuation In VCF Releases: https://knowledge.broadcom.com/external/article/318697/cpu-support-deprecation-and-discontinuat.html
- [E36] KB 413002 – CPU_SUPPORT_WARNING is shown when upgrading to ESXi Server Version 8.0 or later: https://knowledge.broadcom.com/external/article/413002/cpusupportwarning-is-shown-when-upgradin.html
- [E37] KB 428874 – Deprecated CPU Systems / Servers in ESX 9.0 and implications for support: https://knowledge.broadcom.com/external/article/428874/deprecated-cpu-systems-servers-in-esx-9.html
- [E38] KB 417726 – Micron 6550 drives are not listing when installing ESXi 9.0/8.0U3e: https://knowledge.broadcom.com/external/article/417726/micron-6550-drives-are-not-listing-when.html
- [E39] KB 415108 – ESXi installer cannot detect RAID logical devices: https://knowledge.broadcom.com/external/article/415108/esxi-installer-cannot-detect-raid-logica.html
- [E40] Using Remote Management Applications (vSphere 9.1; = `25` [U67]): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/esx-installation-and-setup/installing-and-setting-up-esxi/esxi-requirements/using-remote-management-applications.html
- [E41] Incoming and Outgoing Firewall Ports for ESX Hosts (vSphere 9.1; odkazuje na Ports and Protocols Tool https://ports.broadcom.com/): https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/vsphere-security/securing-esxi-hosts/customizing-hosts-with-the-security-profile/esxi-firewall-configuration/incoming-and-outgoing-firewall-ports.html
