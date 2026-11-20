import { docLink, h } from '../dom';
import { ILLUSTRATIVE_LABEL } from '../hud';

/**
 * EXTENSION POINT for the "Návrh" (design) phase.
 *
 * The UI only renders data; it never invents options. Once docs/spec/05-design.md
 * exists and the domain-modeler exposes the design decisions in game/src/model,
 * map them to DesignStepData in sandbox/designData.ts. Every decision and option
 * must carry at least one documentation source (techdocs.broadcom.com).
 */
export interface DocRef {
  readonly title: string;
  readonly url: string;
}

export interface DesignOption {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly sources: readonly DocRef[];
  /** True if a shown value is not directly from the docs (rendered with the badge). */
  readonly illustrative?: boolean;
  /** Why the option is not available (from model validation), if it is not. */
  readonly disabledReason?: string;
}

export interface DesignDecision {
  readonly id: string;
  readonly title: string;
  readonly help?: string;
  readonly options: readonly DesignOption[];
  readonly sources: readonly DocRef[];
}

export interface DesignStepData {
  readonly decisions: readonly DesignDecision[];
}

export interface DesignStepProps {
  /** null = spec not available yet -> placeholder, no fake options. */
  readonly data: DesignStepData | null;
  readonly selection: ReadonlyMap<string, string>;
  /** Player intent; later forwarded to an engine command, the UI does not validate. */
  onSelect(decisionId: string, optionId: string): void;
}

const sourceList = (sources: readonly DocRef[]): HTMLElement =>
  h('span', { class: 'sources' }, 'Zdroj: ', ...sources.flatMap((s, i) => [i ? ', ' : '', docLink(s.title, s.url)]));

export function renderDesignStep(parent: HTMLElement, props: DesignStepProps): void {
  if (!props.data || props.data.decisions.length === 0) {
    parent.append(
      h('div', { class: 'placeholder' },
        h('h3', null, 'Obsah fáze Návrh se připravuje'),
        h('p', null,
          'Možnosti návrhu doplníme podle specifikace sestavené z oficiální dokumentace (sekce Design). ' +
            'Každá volba bude mít odkaz na zdroj. Dokud nejsou ověřené, nic si nevymýšlíme.'),
      ),
    );
    return;
  }
  for (const d of props.data.decisions) {
    const chosen = props.selection.get(d.id);
    const options = d.options.map((o) => {
      const input = h('input', {
        type: 'radio',
        name: `design-${d.id}`,
        value: o.id,
        checked: chosen === o.id,
        disabled: o.disabledReason !== undefined,
      });
      input.addEventListener('change', () => props.onSelect(d.id, o.id));
      return h('label', { class: 'option' },
        input,
        h('span', { class: 'option-body' },
          h('span', { class: 'option-title' }, o.label, o.illustrative ? h('span', { class: 'ui-badge' }, ILLUSTRATIVE_LABEL) : null),
          o.description ? h('span', { class: 'option-desc' }, o.description) : null,
          o.disabledReason ? h('span', { class: 'option-blocked' }, o.disabledReason) : null,
          sourceList(o.sources),
        ),
      );
    });
    parent.append(
      h('fieldset', { class: 'decision' },
        h('legend', null, d.title),
        d.help ? h('p', { class: 'muted' }, d.help) : null,
        ...options,
        sourceList(d.sources),
      ),
    );
  }
}
