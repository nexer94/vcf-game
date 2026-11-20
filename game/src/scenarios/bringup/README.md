# Kampaň 1 – Nové prostředí: bring-up první instance (VCF 9.1.1)

Režim **Kariéra**. Mise vedou hráče celým reálným workflow nového nasazení podle `docs/spec/20-deployment.md`
(Preparation → Deployment → Post-deployment, 20 §1, §4) s architekturou z `docs/spec/00-architektura.md`
a minimy hostů z `docs/spec/10-planning.md`. Formát misí: `game/src/scenarios/schema.ts`.

Hodnoty ve workbooku (FQDN, IP, VLAN, hesla, activation code, proxy) jsou **ilustrativní herní data**.
Body, srážky a rozpočet jsou **herní mechanika** (fiktivní), ne fakta z dokumentace.

## Přehled misí

| # | Soubor | Mise | Obtížnost | Max. bodů / k projití | Odemyká se po |
|---|---|---|---|---|---|
| 1 | `01-vcf-installer.json` | První kroky: nasazení VCF Installeru | Tutoriál | 120 / 70 | – |
| 2 | `02-esx-hosts.json` | Příprava ESX hostů pro management doménu | Běžný provoz | 165 / 100 | 1 |
| 3 | `03-depot-binaries.json` | Depot a binárky | Běžný provoz | 160 / 100 | 1 |
| 4 | `04-bringup-simple.json` | Bring-up první instance (Simple) | Běžný provoz | 230 / 140 | 2, 3 |
| 5 | `05-troubleshooting-validation.json` | Validace selhala: JSON spec po kolegovi | Troubleshooting | 245 / 150 | 4 |
| 6 | `06-production-ha-design.json` | Návrh pro produkci: HA fleet | Návrh pro produkci | 270 / 175 | 5 |

## Mapování na spec

### 1 – VCF Installer (tutoriál)
- Úkoly: zdroje appliance (20 §3.3, §6.1 [S6][S35]), umístění installeru (20 §4.1.5 [S6], 00 §2.6 [S4]),
  nasazení OVA (20 §4.1.5, §3.6 [S6]), login `admin@local` (20 §4.1.5, §4.2 krok 1 [S6][S14]).
- Pasti (kódy modelu): politika hesel `PASSWORD_*` (20 §3.6, §5.2 [S6]), max. 2 DNS servery
  `INSTALLER_TOO_MANY_DNS_SERVERS` (20 §4.1.5 krok 9, §6.1 [S6]), FQDN velkými písmeny `FQDN_NOT_LOWERCASE`
  (20 §3.5 [S14][S19]).

### 2 – Příprava ESX hostů (běžný provoz)
- Úkoly v pořadí dokumentace: instalace z ISO (20 §4.1.1 [S8]), síť v DCUI (§4.1.2 [S9]), DNS A + PTR
  (§3.5 [S20]), NTP (§4.1.3 [S10]), regenerace certifikátu po nastavení hostname + vypnutí SSH (§4.1.4 [S11]),
  kvíz HW pravidel – homogenní profil, jeden vendor, žádné stateless hosty, vmk0 na VSS (§3.2 [S7][S9]),
  kontrola `validateEsxHostsForBringup`.
- Pasti: `ESX_CUSTOM_DNS_SUFFIXES` (§4.1.2 krok 6), chybějící PTR `DNS_RECORD_MISSING` (§3.5),
  `ESX_SSH_DISABLED` (§4.1.4), NTP před sítí `ESX_NETWORK_NOT_CONFIGURED` (§4.1.3 – Host Client potřebuje síť).

### 3 – Depot a binárky (běžný provoz)
- Úkoly: 16 binárek, VCF Operations/Automation i při odložení (20 §3.4 [S12]), připojení online/offline depotu
  (§4.1.6 [S13]), stažení + Download Status, kontrola `validateBinariesForDeployment`, co se přenese do fleet
  depotu (§4.1.6).
- Pasti: proxy s NTLMv2 `DEPOT_PROXY_AUTH_UNSUPPORTED`, SSL/TLS interception `DEPOT_SSL_INTERCEPTION`
  (§3.4, §5.2 [S13]), chybějící activation code, HTTPS offline depot bez importu certifikátu
  `DEPOT_CERT_NOT_TRUSTED`, stahování bez depotu `DEPOT_NOT_CONNECTED` (§4.1.6 [S13]).

### 4 – Bring-up Simple (běžný provoz)
- Úkoly = kroky 2–20 průvodce „Deploy a new VCF fleet“ (20 §4.2 [S14]), validace warnings/errors (§5.1),
  kontrola výsledné fleet (`buildFleetFromBringup` + `validateFleet`, 20 §2.1, 00 §2.1), post-deployment:
  licence, záloha, nepřesouvat VM management services (20 §4.4, §5.2; 00 §3 [S9]).
- Pasti: Simple jen Small `SIZE_NOT_ALLOWED_FOR_MODEL` (§4.2 krok 5), `NSX_NODE_COUNT` (§6.4, 00 §2.9),
  `VCF_AUTOMATION_IPS_TOO_FEW`, `SERVICES_RUNTIME_IPS_TOO_FEW`, warning `SERVICES_RUNTIME_IPS_BELOW_RECOMMENDED`
  (§3.5, §6.4 [S19]), inclusion range mimo podsíť / network-broadcast (§5.1 [S14][S34]),
  `FQDN_IP_IN_RESERVED_RANGE` / `FQDN_IP_NOT_UNIQUE` (§3.5), Deploy před validací `ILLEGAL_DEPLOYMENT_TRANSITION`.

### 5 – Troubleshooting (JSON spec)
- Workflow „Deploy Using JSON Spec“ (20 §4.3 [S15]); installer na management hostu → po nasazení SDDC Manager mode
  (20 §4.1.5 [S6], 00 §2.6 [S4]).
- Osm chyb ve výchozím stavu (přesně ověřeno testem proti modelu): `SDDC_MANAGER_FQDN_FIXED` (§4.1.5 krok 8,
  §4.2 krok 17), `DNS_RECORD_MISSING` (chybějící PTR, §3.5 [S20]), `FQDN_NOT_LOWERCASE` (known issue #2,
  §5.3 [S31]), `FQDN_LOCAL_DOMAIN` (§3.5), `SERVICES_RUNTIME_IPS_TOO_FEW` (§3.5), `INCLUSION_RANGE_TOO_SMALL`
  (§5.1), `INSTALLER_CANNOT_REACH` NTP (§3.3 [S5][S6], KB 439240 [S44]), `ESX_CERT_CN_MISMATCH` (§5.2 [S11]).

### 6 – Návrh pro produkci (HA)
- Rozhodnutí: fleet design Basic a single-rack management cluster (00 §6 [S16][S7]), HA pro produkci
  (20 §4.2 krok 5), velikost Medium/Large kvůli data node VCF Operations (20 §2.1, §6.2 [S14][S19][S23]),
  sizing kvíz HA Medium 184/656/11445 (§6.2), hosty management domény – default cluster single-rack s vSAN
  v HA potřebuje min. 4 hosty (10 §6.1 [P9]; stránka ESX host details, 20 §4.2 krok 10), profil Storage Traffic Separation (§4.2 krok 15, §6.5), 30 IP pro services runtime kvůli Day-N (§6.4),
  TEP 1 IP na aktivní uplink (§6.4), DRS anti-affinity pro HA VCF Operations (§4.4 krok 7).
- Pasti: `SIZE_NOT_ALLOWED_FOR_MODEL`, `FQDN_REQUIRED`, `NSX_NODE_COUNT`, `VDS_PROFILE_SWITCH_COUNT`,
  `VDS_UPLINKS_EXCEED_PNICS`, `LAG_PHYSICAL_NETWORK_NOT_READY` (20 §4.2 [9.1] [S32]), `INCLUSION_RANGE_TOO_SMALL`
  (TEP), `SERVICES_RUNTIME_IPS_BELOW_RECOMMENDED`, `MGMT_DEFAULT_CLUSTER_L3_UNSUPPORTED` (00 §3, §5 [S7]),
  `MGMT_DOMAIN_TOO_FEW_HOSTS` – návrh nechat esx04 stranou a nasadit HA + vSAN na 3 hosty (10 §6.1 [P9]);
  self-check ve `expectedInitialIssues`: esx01–03 v HA hlásí kód, ve Simple ne.
- Rozpočet 500 000 herních kreditů – jen rámec, katalog HW zatím není.

## Záměrně vynecháno (otevřené otázky ve specu / modelu)
- Minima hostů, která spec neuvádí jednoznačně (stretched NFS/FC – vMSC, další clustery / WLD; 10 §8 q2) –
  model je nekontroluje, mise je nepoužívají. Mise 5 past `MGMT_DOMAIN_TOO_FEW_HOSTS` nemá (Simple, 4 hosty;
  přesná sada výchozích chyb zůstává beze změny).
- Replica FQDN v Simple, počet workerů services runtime v Simple, VCF Automation HA-Small, texty hlášek,
  pole „ESX host details“ / „vCenter details“, názvy interních úloh bring-upu, konvergence, VVF, deferred
  komponenty, kontrola kapacity hostů vs. sizing.

## Kontrola
`src/scenarios/__tests__/scenarios.test.ts` ověřuje tvar JSON (`checkMissionShape`), existenci všech kódů
v modelu, existenci sekcí a zdrojů ve specu, že odkazy v nápovědách jsou zdroje specu, výchozí chyby
(`expectedInitialIssues`) a že referenční řešení každé mise projde validacemi modelu.
