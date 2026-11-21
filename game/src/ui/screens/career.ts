/**
 * Career (UX.md Part III ch. 25.5): level list → briefing → (room in Career mode) → result.
 *
 * Level data come from the engine's career layer (modes/career/level.ts: title, briefing, budget, workbook, success
 * criteria with spec refs). Result = evaluateLevel / computeScore over the career session (modes/career/evaluate.ts).
 * Budget, points and stars are GAME mechanics – always labelled "herní".
 */
import { button, h } from '../dom';
import { message } from '../messages';
import { sourceButton } from '../sandbox/sourcePopover';
import { loadedSandboxSession, resetSharedRoomPort, setCareerLevel, setPlayMode } from '../sandbox/sessionPort';
import { resetSharedSitePort } from '../sandbox/siteLayout';
import { formatPrice } from '../sandbox/shop';
import { onEscape, type ScreenDef } from './screen';
import '../sandbox/v3.css';
import type { CareerLevelDef } from '../../modes/career/level';
import type { SandboxSnapshot } from '../../modes/sandbox/snapshot';

/** Later campaigns (CLAUDE.md "Kariéra" order) – titles only, locked. */
const LATER: readonly string[] = [
  'Kampaň 2 – Migrace: konvergence vSphere do VCF',
  'Kampaň 3 – Upgrade VCF 5.2 / 9.0 → 9.1',
  'Kampaň 4 – Den 2: nová workload doména / instance',
];

const stars = (n: number): string => '★'.repeat(n) + '☆'.repeat(3 - n);

export const careerScreen: ScreenDef = {
  stageMode: 'off',
  mount(root, ctx, route) {
    const view = h('div', { class: 'screen screen-page' });
    root.appendChild(view);
    let disposed = false;
    const levelId = route.name === 'career' ? route.level : undefined;
    const result = route.name === 'career' && route.result === true;
    const offEsc = onEscape(() => ctx.navigate(levelId ? { name: 'career' } : { name: 'menu' }));

    const start = (l: CareerLevelDef, fresh: boolean): void => {
      setPlayMode('career');
      setCareerLevel(l.id);
      if (fresh) {
        resetSharedRoomPort('career');
        resetSharedSitePort('career');
      }
      ctx.navigate({ name: 'sandbox-room', demo: false, career: l.id });
    };

    import('../../modes/career/level').then(({ CAREER_LEVELS, careerLevel }) => {
      if (disposed) return;
      const level = levelId ? careerLevel(levelId) : undefined;
      if (!levelId) return renderList(CAREER_LEVELS);
      if (!level) return renderList(CAREER_LEVELS);
      if (result) return renderResult(level);
      renderBriefing(level);
    }, (err: unknown) => {
      view.replaceChildren(h('main', { class: 'page-card' }, message({ type: 'game-limit', title: 'Kariéra se nenačetla', body: String(err) })));
    });

    function renderList(levels: readonly CareerLevelDef[]): void {
      const back = button('← Menu', () => ctx.navigate({ name: 'menu' }), { class: 'btn btn-ghost' });
      const cards = levels.map((l) =>
        button(h('span', { class: 'menu-item-body' },
          h('span', { class: 'menu-item-title' }, `Kampaň ${l.campaign} · Level ${l.level}`),
          h('span', { class: 'menu-item-desc' }, l.title),
        ), () => ctx.navigate({ name: 'career', level: l.id }), { class: 'menu-item menu-primary level-card' }),
      );
      view.replaceChildren(h('main', { class: 'page-card career-card' },
        h('h1', null, 'Kariéra'),
        h('p', { class: 'lead' }, 'Jsi admin VCF. Každý level je jedno reálné zadání – checklist vlevo a bubliny tě vedou krok za krokem. Pravidla jsou stejná jako v Sandboxu (podle dokumentace).'),
        h('nav', { class: 'menu-list', 'aria-label': 'Levely' }, ...cards,
          ...LATER.map((t) => h('div', { class: 'menu-item menu-soon', 'aria-disabled': 'true' }, h('span', { class: 'menu-item-body' }, h('span', { class: 'menu-item-title' }, t, h('span', { class: 'ui-chip chip-soon' }, 'Připravujeme'))))),
        ),
        h('p', { class: 'muted small' }, 'Rozpočet, body a hvězdy jsou herní mechanika (fiktivní měna) – nejsou to údaje z dokumentace.'),
        h('div', { class: 'actions' }, back),
      ));
      cards[0]?.focus();
    }

    function renderBriefing(l: CareerLevelDef): void {
      const go = button('Začít level', () => start(l, !loadedSandboxSession('career')), { class: 'btn btn-primary btn-big' });
      const restart = loadedSandboxSession('career') ? button('Začít znovu', () => start(l, true), { class: 'btn' }) : null;
      if (restart) go.textContent = 'Pokračovat v levelu';
      const src = sourceButton({ specRef: l.specRefs });
      view.replaceChildren(h('main', { class: 'page-card career-card', 'aria-labelledby': 'brief-title' },
        h('div', { class: 'muted small' }, `Kariéra · Kampaň ${l.campaign} · Level ${l.level}`),
        h('h1', { id: 'brief-title' }, l.title),
        ...l.briefing.map((t) => h('p', null, t)),
        h('dl', { class: 'brief-facts' },
          h('dt', null, 'Rozpočet'), h('dd', null, `${formatPrice(l.budget)} `, h('span', { class: 'ui-badge badge-game-price' }, 'herní')),
          h('dt', null, 'Obtížnost'), h('dd', null, l.difficulty === 'tutorial' ? 'výuková' : l.difficulty),
          h('dt', null, 'Workbook firmy'), h('dd', null, `doména ${l.workbook.domain} · gateway ${l.workbook.gateway} · DNS ${l.workbook.dnsServer} `, h('span', { class: 'ui-badge badge-game-default' }, 'herní hodnoty')),
        ),
        h('div', { class: 'actions' }, button('← Levely', () => ctx.navigate({ name: 'career' }), { class: 'btn btn-ghost' }), src, h('span', { class: 'inv-spacer' }), restart, go),
      ));
      go.focus();
    }

    function renderResult(l: CareerLevelDef): void {
      const session = loadedSandboxSession('career');
      const back = button('← Levely', () => ctx.navigate({ name: 'career' }), { class: 'btn btn-ghost' });
      if (!session) {
        view.replaceChildren(h('main', { class: 'page-card' }, h('h1', null, l.title), h('p', null, 'Level ještě neběží.'), h('div', { class: 'actions' }, back, button('Začít level', () => start(l, true), { class: 'btn btn-primary' }))));
        return;
      }
      import('../../modes/career/evaluate').then(({ evaluateLevel }) => {
        if (disposed) return;
        const snap = session.snapshot() as SandboxSnapshot;
        const ev = evaluateLevel(snap, l);
        const score = careerScoreOf(session);
        view.replaceChildren(h('main', { class: 'page-card career-card result-card', 'aria-labelledby': 'res-title' },
          h('div', { class: 'result-head' },
            h('h1', { id: 'res-title' }, ev.passed ? `Level ${l.level} splněn` : `Level ${l.level} zatím nesplněn`),
            score ? h('span', { class: 'result-stars', 'aria-label': `${score.stars} ze 3 hvězd (herní)` }, stars(score.stars)) : null,
          ),
          h('ul', { class: 'result-criteria' }, ...ev.criteria.map((c) => h('li', { class: c.ok ? 'ok' : 'bad' }, h('span', { 'aria-hidden': 'true' }, c.ok ? '✓ ' : '✗ '), h('span', null, c.label), ' ', sourceButton({ specRef: c.specRef }) ?? ''))),
          score
            ? h('p', null, `Body ${score.points} / ${score.maxPoints} `, h('span', { class: 'ui-badge badge-game-price' }, 'herní'),
                h('span', { class: 'muted' }, ` · − nápovědy ${score.penalties.hints} · − validace ${score.penalties.validation}${score.bonusPoints ? ` · + bonus ${score.bonusPoints}` : ''}`))
            : null,
          h('div', { class: 'actions' }, back,
            button(ev.passed ? 'Znovu' : '← Zpět do levelu', () => (ev.passed ? start(l, true) : ctx.navigate({ name: 'sandbox-room', demo: false, career: l.id })), { class: 'btn' }),
            button('Další level ▸ (brzy)', () => undefined, { class: 'btn btn-primary', disabled: true })),
        ));
      }, () => undefined);
    }

    return {
      dispose() {
        disposed = true;
        offEsc();
        view.remove();
      },
    };
  },
};

/** Score of the career session when the engine exposes it (snapshot.career.score); null otherwise. */
export function careerScoreOf(session: { snapshot(): unknown }): { points: number; maxPoints: number; bonusPoints: number; stars: number; penalties: { hints: number; validation: number } } | null {
  const snap = session.snapshot() as { career?: { score?: { points: number; maxPoints: number; bonusPoints: number; stars: number; penalties: { hints: number; validation: number } } } };
  return snap.career?.score ?? null;
}
