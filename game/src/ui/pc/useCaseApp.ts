/**
 * Computer app "Use case" (UX.md §11.5, §2.7 "Co nasadit"): catalog UC-1 … UC-10 of the engine
 * (modes/sandbox/useCases.ts, spec 25 §2.1) with spec references and links; choose = command chooseUseCase.
 * Playable vs "herní omezení" is the engine's game-scope flag (`modelled`), not a VCF fact.
 * The step order of a use case is not in the engine data yet -> only the documentation link is shown
 * (no invented steps).
 */
import { USE_CASES, type UseCaseId } from '../../modes/sandbox/useCases';
import { specRefInline } from '../sandbox/sourcePopover';
import { button, docLink, h } from '../dom';
import { message } from '../messages';
import { icon } from '../icons';
import type { RoomPort } from '../sandbox/sessionPort';
import { nn, type PcApp } from './designApp';

export interface UseCaseAppOptions {
  readonly port: RoomPort;
  announce(text: string, bad?: boolean): void;
  onOpenDesign(): void;
}

export function createUseCaseApp(o: UseCaseAppOptions): PcApp {
  const el = h('div', { class: 'pc-app pc-usecase' });

  const choose = (id: UseCaseId | null): void => {
    const ops = o.port.ops;
    if (!ops) return o.announce('V ukázkové místnosti se use case nevybírá (není tu simulace).', true);
    const r = ops.dispatch({ type: 'chooseUseCase', useCaseId: id });
    if (!r.ok) return o.announce(r.message, true);
    o.announce(id ? `Use case: ${id}.` : 'Volba use case zrušena.');
  };

  function render(): void {
    const snap = o.port.ops?.snapshot();
    const chosen = snap?.useCase;
    el.replaceChildren(...nn(
      h('header', { class: 'pc-app-head' }, h('h2', null, 'Use case – co nasazuješ'), h('span', { class: 'muted small' }, 'Katalog podle dokumentace (spec 25 §2.1). Volba odpovídá prvním krokům průvodce VCF Installeru.')),
      o.port.ops ? null : message({ type: 'game-limit', compact: true, title: 'Ukázková místnost', body: 'Tady se use case nevybírá – otevři svoji serverovnu (bez ukázky).' }),
      chosen
        ? h('section', { class: 'uc-chosen', 'aria-label': 'Vybraný use case' },
            h('h3', null, `Vybráno: ${chosen.id} – `, h('span', { lang: 'en' }, chosen.title)),
            h('p', { class: 'small' }, 'Pořadí kroků a prerekvizity: ', docLink('dokumentace TechDocs', chosen.url), specRefInline(chosen.specRef)),
            h('p', { class: 'muted small' }, 'Hra zatím nemá pořadí kroků tohoto use case jako vlastní data – řiď se odkazem a úkoly v trackeru.'),
            chosen.gameScopeNote ? message({ type: 'game-limit', compact: true, body: chosen.gameScopeNote }) : null,
            ...chosen.limitations.map((i) => message({ type: 'game-limit', compact: true, body: h('span', { lang: 'en' }, i.message), reference: `${i.code} · Spec: ${i.specRef}` })),
            h('div', { class: 'uc-actions' },
              chosen.modelled ? button('Pokračovat na Návrh VCF ▸', () => o.onOpenDesign(), { class: 'btn btn-primary btn-small' }) : null,
              button('Zrušit volbu', () => choose(null), { class: 'btn btn-small' })),
          )
        : null,
      h('ul', { class: 'uc-list' },
        ...USE_CASES.map((u) => {
          const isChosen = chosen?.id === u.id;
          return h('li', { class: `uc-card${isChosen ? ' chosen' : ''}${u.modelled ? '' : ' not-modelled'}` },
            h('div', { class: 'uc-head' },
              h('strong', null, u.id),
              u.modelled ? h('span', { class: 'ui-badge badge-ok' }, 'hratelné') : h('span', { class: 'ui-badge badge-game-simplification', title: 'Hra tuto cestu zatím nesimuluje – není to chyba VCF.' }, icon('puzzle', { className: 'badge-icon' }), 'herní omezení'),
            ),
            h('div', { class: 'uc-title', lang: 'en' }, u.title),
            h('div', { class: 'small' }, docLink('TechDocs', u.url), specRefInline(u.specRef)),
            isChosen
              ? h('span', { class: 'ok small' }, '✓ vybráno')
              : button('Vybrat', () => choose(u.id), { class: 'btn btn-small', disabled: !o.port.ops, 'aria-label': `Vybrat ${u.id}: ${u.title}` }),
          );
        }),
      ),
    ));
  }

  const off = o.port.subscribe(render);
  render();
  return { el, escape: () => false, dispose: off };
}
