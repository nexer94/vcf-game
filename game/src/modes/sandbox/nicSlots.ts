/**
 * NIC slots of a server (UX 19.4 "Přidání NIC klikem na volný slot").
 *
 * - Slot count is a GAME VALUE ([SIMPL]): BCG does not list PCIe / OCP slot counts. 2 slots per server (UX 27.3 q2
 *   proposal); a configuration with more cards (none of the starter configurations) gets as many slots as cards.
 * - Cards fill slots in order: slot n = n-th card of `ServerConfig.nics` (count expanded). Removing a card moves the
 *   later cards up (vmnic numbering follows the card order, model serverNicPorts).
 * - Offered cards = NICs of the model's BCG BOM (`ServerModel.nics`, 15 B.2 [BCG]) ∩ the game parts catalog.
 */
import type { HardwareCatalog, NicPart, PartCount, ServerConfig } from '../../model';

/** [SIMPL] NIC slots per server – game value (BCG has no slot count). */
export const NIC_SLOTS_GAME_DEFAULT = 2;

/** Card part ids in slot order (counts expanded). */
export function nicCards(config: ServerConfig): string[] {
  return config.nics.flatMap((n) => Array.from({ length: Math.max(0, n.count) }, () => n.partId));
}

export const nicSlotCount = (config: ServerConfig): number => Math.max(NIC_SLOTS_GAME_DEFAULT, nicCards(config).length);

/** Cards -> PartCount list (consecutive equal parts merged, order kept). */
export function cardsToNics(cards: readonly string[]): PartCount[] {
  const out: { partId: string; count: number }[] = [];
  for (const c of cards) {
    const last = out[out.length - 1];
    if (last && last.partId === c) last.count += 1;
    else out.push({ partId: c, count: 1 });
  }
  return out;
}

/** NIC parts certified for the model (BOM name in ServerModel.nics) and present in the game catalog. */
export function certifiedNicParts(catalog: HardwareCatalog, modelId: string): NicPart[] {
  const model = catalog.models.get(modelId);
  if (!model) return [];
  return [...catalog.nics.values()].filter((n) => model.nics.includes(n.bomName));
}

export interface NicSlotView {
  /** 1-based slot number. */
  readonly slot: number;
  readonly partId?: string;
  readonly label?: string;
  readonly ports?: number;
  readonly speedsGbE?: readonly number[];
  /** vmnic indexes of the card (model serverNicPorts order). */
  readonly vmnics: readonly number[];
  /** Slot count is a game value (tooltip "herní"). */
  readonly gameDefault: true;
}

export function nicSlotViews(catalog: HardwareCatalog, config: ServerConfig): NicSlotView[] {
  const cards = nicCards(config);
  let vmnic = 0;
  return Array.from({ length: nicSlotCount(config) }, (_, i): NicSlotView => {
    const partId = cards[i];
    const part = partId !== undefined ? catalog.nics.get(partId) : undefined;
    if (!part) return { slot: i + 1, vmnics: [], gameDefault: true };
    const vmnics = Array.from({ length: part.ports }, (_, k) => vmnic + k);
    vmnic += part.ports;
    return { slot: i + 1, partId: part.id, label: part.bomName, ports: part.ports, speedsGbE: part.speedsGbE, vmnics, gameDefault: true };
  });
}
