/**
 * Unified feedback language (docs/design/UX.md §3.2): four message types and the
 * value badges. Every screen uses these so the player always sees WHO is talking:
 * the documentation (VCF error / VCF warning) or the game (game limitation / tip).
 *
 * The texts here are UI labels only - no VCF facts. Message bodies come from the
 * model / spec via the caller.
 */
import { h } from './dom';
import { stripSourceIds } from '../scenarios/sources';
import { sourceButton, type SourceSpec } from './sandbox/sourcePopover';
import { icon, MESSAGE_ICON, type IconName } from './icons';

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

export type MessageType = 'vcf-error' | 'vcf-warning' | 'game-limit' | 'game-tip';

export interface MessageTypeInfo {
  /** Own line icon shown before the heading (decorative, aria-hidden; ui/icons.ts, T9). */
  readonly icon: IconName;
  /** Default heading (UX.md §3.2). */
  readonly title: string;
  /** Who is speaking - announced to screen readers before the heading. */
  readonly source: string;
  /** Does it block progress (per model)? UI hint only. */
  readonly blocks: 'yes' | 'until-acknowledged' | 'game' | 'no';
}

export const MESSAGE_TYPES: Readonly<Record<MessageType, MessageTypeInfo>> = {
  'vcf-error': { icon: MESSAGE_ICON['vcf-error'], title: 'Podle dokumentace nelze', source: 'Chyba VCF', blocks: 'yes' },
  'vcf-warning': { icon: MESSAGE_ICON['vcf-warning'], title: 'Odchylka od doporučení', source: 'Varování VCF', blocks: 'until-acknowledged' },
  'game-limit': { icon: MESSAGE_ICON['game-limit'], title: 'Zatím ve hře není', source: 'Omezení hry', blocks: 'game' },
  'game-tip': { icon: MESSAGE_ICON['game-tip'], title: 'Tip', source: 'Tip hry', blocks: 'no' },
};

type Content = Node | string | null | undefined | false;

export interface MessageOptions {
  readonly type: MessageType;
  /** Heading; defaults to the type heading. */
  readonly title?: string;
  /** Body: what is wrong -> why (rule) -> how to fix. */
  readonly body?: Content | readonly Content[];
  /** Small reference line (rule ID, spec §, code). */
  readonly reference?: string;
  /** Action buttons / links (Opravit, Potvrdit, Proč?…). */
  readonly actions?: readonly Content[];
  /** Compact variant for inline use (inside an option, a tooltip…). */
  readonly compact?: boolean;
  /** Dimmed (e.g. an acknowledged warning). */
  readonly muted?: boolean;
  /** Extra class names. */
  readonly className?: string;
  /** Language of the body when it is an English model message. */
  readonly bodyLang?: string;
  /** Readable documentation sources ("Zdroj ▾" popover, UX ch. 21) – preferred over a raw `reference`. */
  readonly source?: SourceSpec;
}

/** Spec reference inside a reference line ("10 §3.3 [P19] · CODE") -> Zdroj popover + text without bracket ids. */
const looksLikeSpecRef = (r: string): boolean => /§|\[[A-Z]{1,4}\d+[a-z]?\]/.test(r);

/** One message box (role=note; live announcements are the caller's job). */
export function message(o: MessageOptions): HTMLElement {
  const info = MESSAGE_TYPES[o.type];
  const body = Array.isArray(o.body) ? (o.body as readonly Content[]) : [o.body as Content];
  const cls = ['msg', `msg-${o.type}`, o.compact ? 'msg-compact' : '', o.muted ? 'msg-muted' : '', o.className ?? '']
    .filter(Boolean)
    .join(' ');
  return h('div', { class: cls, role: 'note' },
    h('div', { class: 'msg-head' },
      h('span', { class: 'msg-icon', 'aria-hidden': 'true' }, icon(info.icon)),
      h('span', { class: 'msg-src' }, `${info.source}: `),
      h('strong', { class: 'msg-title' }, o.title ?? info.title),
    ),
    body.some(Boolean) ? h('div', { class: 'msg-body', ...(o.bodyLang ? { lang: o.bodyLang } : {}) }, ...body) : null,
    refLine(o),
    o.actions?.some(Boolean) ? h('div', { class: 'msg-actions' }, ...o.actions) : null,
  );
}

/** Reference line: never bare bracket ids (UX P5); a "Zdroj ▾" button when the reference points into the spec. */
function refLine(o: MessageOptions): HTMLElement | null {
  const src = o.source ?? (o.reference && looksLikeSpecRef(o.reference) ? { specRef: o.reference } : undefined);
  const btn = src ? sourceButton(src) : null;
  const text = o.source ? (o.source.rule ?? '') : o.reference ? stripSourceIds(o.reference) : '';
  if (!text && !btn) return null;
  return h('div', { class: 'msg-ref' }, text, btn ? ' ' : null, btn);
}

// ---------------------------------------------------------------------------
// Value badges
// ---------------------------------------------------------------------------

export type BadgeKind =
  | 'illustrative'
  | 'game-default'
  | 'game-price'
  | 'paraphrase'
  | 'unverified'
  | 'irreversible'
  | 'day2'
  | 'documented'
  | 'out-of-scope'
  | 'game-simplification';

export interface BadgeInfo {
  readonly label: string;
  /** What the badge means (tooltip + screen-reader description). */
  readonly description: string;
}

export const BADGES: Readonly<Record<BadgeKind, BadgeInfo>> = {
  illustrative: {
    label: 'ilustrativní model',
    description: 'Hodnota není z dokumentace – herní vizualizace (např. provoz, trvání).',
  },
  'game-default': {
    label: 'herní výchozí',
    description: 'Výchozí hodnota, kterou zvolila hra; dokumentace ji neurčuje.',
  },
  'game-price': {
    label: 'herní cena',
    description: 'Herní mechanika (fiktivní měna), ne údaj z dokumentace.',
  },
  paraphrase: {
    label: 'parafráze',
    description: 'Český převod textu dokumentace, ne doslovná citace.',
  },
  unverified: {
    label: 'neověřeno',
    description: 'Otevřená otázka ve specifikaci – zatím neověřeno v dokumentaci.',
  },
  irreversible: {
    label: 'Nevratné',
    description: 'Podle dokumentace nejde po nasazení změnit.',
  },
  day2: {
    label: 'Day 2',
    description: 'Podle dokumentace až po nasazení (Day 2) – není součástí návrhu Day 0.',
  },
  documented: {
    label: 'dokumentace',
    description: 'Výchozí hodnota podle dokumentace (odkaz na specifikaci v popisku).',
  },
  'out-of-scope': {
    label: 'mimo VCF scope – herní',
    description: 'Dokumentace VCF tento krok vyřazuje ze svého rozsahu. Ve hře je to volitelný krok z reálné serverovny, který nic neblokuje.',
  },
  'game-simplification': {
    label: 'herní zjednodušení',
    description: 'Herní abstrakce reality (např. síť firmy za jedním portem) – není to údaj z dokumentace.',
  },
};

export const BADGE_ORDER: readonly BadgeKind[] = [
  'illustrative',
  'game-default',
  'game-price',
  'paraphrase',
  'unverified',
  'irreversible',
  'day2',
  'documented',
  'out-of-scope',
  'game-simplification',
];

const descId = (kind: BadgeKind): string => `badge-desc-${kind}`;

/**
 * Hidden description elements shared by all badges (aria-describedby target).
 * Created once per document; badges stay out of the tab order.
 */
function ensureDescriptions(): void {
  if (typeof document === 'undefined' || document.getElementById(descId('illustrative'))) return;
  const box = h('div', { class: 'sr-only' },
    ...BADGE_ORDER.map((k) => h('span', { id: descId(k) }, BADGES[k].description)),
  );
  document.body.appendChild(box);
}

/**
 * Passive value badge. Not focusable (no tabindex): meaning is given by `title`
 * (mouse) and aria-describedby (screen readers); the "?" legend lists all badges.
 * @param detail extra detail appended to the tooltip (e.g. spec reference).
 */
export function badge(kind: BadgeKind, detail?: string): HTMLElement {
  ensureDescriptions();
  const info = BADGES[kind];
  return h('span', {
    class: `ui-badge badge-${kind}`,
    title: detail ? `${info.description} (${stripSourceIds(detail)})` : info.description,
    'aria-describedby': descId(kind),
  }, info.label);
}

/** Generic small chip (e.g. "varování", "zkráceno") with an optional tooltip; not focusable. */
export function chip(text: string, cls: string, title?: string, iconName?: IconName): HTMLElement {
  return h('span', { class: `ui-badge ${cls}`, ...(title ? { title } : {}) }, iconName ? icon(iconName, { className: 'badge-icon' }) : null, text);
}

/** Inline "icon + text" (decorative icon; the text carries the meaning). */
export function iconText(name: IconName, text: string, cls = ''): HTMLElement {
  return h('span', { class: `icon-text ${cls}`.trim() }, icon(name), text);
}

/** "?" legend popover listing the badges (and optional extra rows). Uses native <details>. */
export function badgeLegend(kinds: readonly BadgeKind[] = BADGE_ORDER, extra: readonly [Node, string][] = []): HTMLElement {
  return h('details', { class: 'legend-pop' },
    h('summary', { 'aria-label': 'Vysvětlivky značek', title: 'Vysvětlivky značek' }, '?'),
    h('div', { class: 'legend-pop-body' },
      h('strong', null, 'Značky'),
      h('dl', null,
        ...extra.flatMap(([el, text]) => [h('dt', null, el), h('dd', null, text)]),
        ...kinds.flatMap((k) => [h('dt', null, h('span', { class: `ui-badge badge-${k}` }, BADGES[k].label)), h('dd', null, BADGES[k].description)]),
      ),
      h('strong', null, 'Hlášky'),
      h('dl', null,
        ...(Object.keys(MESSAGE_TYPES) as MessageType[]).flatMap((t) => [
          h('dt', null, h('span', { class: `msg-swatch msg-${t}` }, icon(MESSAGE_TYPES[t].icon), MESSAGE_TYPES[t].source)),
          h('dd', null, MESSAGE_HELP[t]),
        ]),
      ),
    ),
  );
}

const MESSAGE_HELP: Readonly<Record<MessageType, string>> = {
  'vcf-error': 'Dokumentace to neumožňuje – blokuje, dokud to neopravíš.',
  'vcf-warning': 'Odchylka od doporučení dokumentace – jde pokračovat po potvrzení.',
  'game-limit': 'Dokumentace to umožňuje, simulace to zatím nemodeluje.',
  'game-tip': 'Herní rada (ovládání, pořadí kroků) – nic neblokuje.',
};
