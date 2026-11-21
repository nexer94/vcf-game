/**
 * Start choice "Vyber design blueprint": one card = one VCF 9.1 fleet Design Blueprint and the game site layout(s)
 * it is played in. ALL facts come from the model (model/sites.ts DESIGN_BLUEPRINTS, filled from
 * docs/spec/06-blueprints.md §1, §2.1–2.5, §6.1) and the layout mapping from LAYOUT_BLUEPRINTS (06 §7a).
 * This file only turns them into Czech display text.
 */
import type { FleetDesign } from '../../model/architecture';
import { DESIGN_BLUEPRINTS, LAYOUT_BLUEPRINTS, SITE_LAYOUTS, type BlueprintDef, type BlueprintId } from '../../model/sites';
import { SITE_LAYOUT_IDS, type SiteLayoutId } from './siteLayout';

const TD = 'https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/';

/** Official names of the fleet deployment models (06 §1 table [B21]). */
export const FLEET_MODEL_NAME: Readonly<Record<FleetDesign, string>> = {
  basic: 'Basic',
  'site-high-availability': 'Site High Availability (Across Zones)',
  'disaster-recovery': 'Disaster Recovery (Across Regions)',
  'fault-domains-and-dr': 'Fault Domains and Disaster Recovery',
};

export interface BlueprintVariant {
  readonly layout: SiteLayoutId;
  /** Game name of the layout (model). */
  readonly label: string;
  readonly description: string;
}

export interface BlueprintCard {
  readonly blueprintId: BlueprintId;
  /** Official blueprint name (English, as in TechDocs). */
  readonly title: string;
  readonly url: string;
  readonly specRef: string;
  readonly fleetModel: string;
  readonly hosts: string;
  readonly summary: string;
  /** Playable layouts (Site HA offers two variants). Empty = preset not available yet. */
  readonly variants: readonly BlueprintVariant[];
}

const HOST_LOC: Readonly<Record<BlueprintDef['hostGroups'][number]['location'], string>> = { site: '', az1: 'AZ1 ', az2: 'AZ2 ', region2: 'Region 2 ' };

const plural = (n: number, one: string, few: string, many: string): string => `${n} ${n === 1 ? one : n >= 2 && n <= 4 ? few : many}`;

/** "AZ1 4 + AZ2 4 ESX hosty" from the model's host groups (Minimum Requirements, 06 §6.1). */
export function hostsText(bp: BlueprintDef): string {
  const g = bp.hostGroups;
  const total = g.reduce((a, x) => a + x.esxHosts, 0);
  const multiRegion = g.some((x) => x.location === 'region2');
  const parts = g.map((x) => `${x.location === 'site' && multiRegion ? 'Region 1 ' : HOST_LOC[x.location]}${x.esxHosts}`).join(' + ');
  return g.length > 1 ? `${parts} (celkem ${plural(total, 'ESX host', 'ESX hosty', 'ESX hostů')})` : plural(total, 'ESX host', 'ESX hosty', 'ESX hostů');
}

/** "1 region · 2 AZ · witness · 1 VCF Instance" from the model's topology counts. */
export function topologyText(bp: BlueprintDef): string {
  const t = bp.topologyCounts;
  return [
    plural(t.regions, 'region', 'regiony', 'regionů'),
    `${t.availabilityZones} AZ`,
    ...(t.witnessSite ? ['+ třetí místo pro vSAN witness'] : []),
    `${t.vcfInstances} VCF Instance`,
  ].join(' · ');
}

const variant = (id: SiteLayoutId): BlueprintVariant => ({ layout: id, label: SITE_LAYOUTS[id].label, description: SITE_LAYOUTS[id].description });

/** The five fleet blueprints in TechDocs order, as start-screen cards. */
export function blueprintCards(): BlueprintCard[] {
  return (Object.keys(DESIGN_BLUEPRINTS) as BlueprintId[]).map((id) => {
    const bp = DESIGN_BLUEPRINTS[id];
    return {
      blueprintId: id,
      title: bp.title,
      url: bp.url,
      specRef: bp.specRef,
      fleetModel: FLEET_MODEL_NAME[bp.fleetModel],
      hosts: hostsText(bp),
      summary: topologyText(bp),
      variants: SITE_LAYOUT_IDS.filter((l) => LAYOUT_BLUEPRINTS[l].blueprintId === id).map(variant),
    };
  });
}

/** Blueprints with a physical topology that the game does not play yet (06 §2.6–2.9) – listed as „Připravujeme“. */
export const UPCOMING_BLUEPRINTS: readonly { readonly title: string; readonly url: string; readonly specRef: string }[] = [
  { title: 'VCF Edge: Single Node with Argo CD', url: `${TD}infrastructure-modernization/edge.html`, specRef: '06 §2.6 [B25]' },
  { title: 'VCF Edge Design Blueprint for Government and Defense Use Case', url: `${TD}infrastructure-modernization/vcf-edge-design-for-federal-use-case.html`, specRef: '06 §2.7 [B26]' },
  { title: 'VCF Edge Design Blueprint for Manufacturing Use Case', url: `${TD}infrastructure-modernization/vcf-edge-design-for-manufacturing-use-case.html`, specRef: '06 §2.8 [B30]' },
  { title: 'VCF Fleet Disaster Recovery', url: `${TD}security-modernization/vcf-disaster-recovery.html`, specRef: '06 §2.9 [B37]' },
];

/** „Proč?“ – where the spec explains what rooms / AZ / sites mean for VCF. Section names only; facts stay in the spec. */
export const SITE_WHY_LINKS: readonly { readonly label: string; readonly specRef: string; readonly url: string }[] = [
  { label: 'Design Blueprints – přehled', specRef: '06 §1 [B1]', url: `${TD.slice(0, -1)}.html` },
  { label: 'Fleet deployment modely a výběr blueprintu', specRef: '06 §1, 00 §6 [B21]', url: 'https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/vmware-cloud-foundation-concepts/vcf-operations-deployment-models.html' },
  { label: 'Stretched cluster – požadavky mezi AZ a witness', specRef: '06 §6.4, 10 §3.3 [P13]', url: 'https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/cluster-models/single-instance-multiple-availability-zones.html' },
  { label: 'Data Center Network Requirements', specRef: '10 §3.3 [P20]', url: 'https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/datacenter-network-requirements.html' },
];
