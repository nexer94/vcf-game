import { button, docLink, h } from '../dom';
import { badge, chip } from '../messages';
import { blueprintCards, SITE_WHY_LINKS, UPCOMING_BLUEPRINTS, type BlueprintCard, type BlueprintVariant } from '../sandbox/blueprints';
import { formatLinkGame, presetLayout, sharedSitePort } from '../sandbox/siteLayout';
import { siteThumb } from '../sandbox/siteThumbs';
import { disclaimer } from './disclaimer';
import { onEscape, type ScreenDef } from './screen';
import './site.css';

/**
 * „Vyber design blueprint“ – start choice after the Sandbox intro (CLAUDE.md „Výběr lokality na startu“).
 * Each card = one VCF 9.1 fleet Design Blueprint (06-blueprints) + the game site layout(s) it is played in
 * (Site HA: two variants). Card data come from ui/sandbox/blueprints.ts (model/sites.ts first, 06 fallback).
 * Link RTT / bandwidth are game values with a badge; no other numbers than those from the spec.
 */
export const sandboxSiteScreen: ScreenDef = {
  stageMode: 'off',
  mount(root, ctx) {
    const site = sharedSitePort();
    const curPreset = site.layout().preset;
    const curBlueprint = site.blueprintId();

    const enter = (c: BlueprintCard, v: BlueprintVariant): void => {
      site.choose(v.layout, c.blueprintId);
      const multi = presetLayout(v.layout).rooms.length > 1;
      ctx.navigate(multi ? { name: 'sandbox-room', demo: false, overview: true } : { name: 'sandbox-room', demo: false });
    };

    const variantBlock = (c: BlueprintCard, v: BlueprintVariant, many: boolean): HTMLElement => {
      const layout = presetLayout(v.layout);
      const current = curBlueprint === c.blueprintId && curPreset === v.layout;
      return h('div', { class: `site-variant${current ? ' site-variant-current' : ''}` },
        h('div', { class: 'site-card-art' }, siteThumb(v.layout)),
        h('div', { class: 'site-variant-body' },
          h('div', { class: 'site-card-tags' },
            h('span', { class: 'site-layout-tag' }, v.label),
            chip('herní rozvržení', 'badge-game-default', 'Místnosti, budovy a jejich rozměry jsou herní; přiřazení k blueprintu podle 06-blueprints §7a.'),
            current ? chip('aktuální', 'badge-current') : null,
          ),
          h('p', { class: 'muted small' }, v.description),
          ...layout.links.length
            ? [h('p', { class: 'site-card-game small' }, badge('illustrative', 'RTT a propustnost linek jsou herní hodnoty'), ' ',
                layout.links.map((l) => formatLinkGame(l.game)).filter((x, i, a) => a.indexOf(x) === i).join(' · '))]
            : [],
          button(many ? `Vybrat: ${v.label} →` : 'Vybrat →', () => enter(c, v), {
            class: 'btn btn-primary btn-small',
            'aria-label': `Vybrat blueprint ${c.title}, rozvržení ${v.label}`,
          }),
        ),
      );
    };

    const cards = blueprintCards().map((c) =>
      h('li', { class: `site-card${c.variants.length ? '' : ' site-card-pending'}` },
        h('div', { class: 'site-card-body' },
          h('h3', { class: 'site-card-title', lang: 'en' }, c.title),
          h('dl', { class: 'site-facts' },
            h('dt', null, 'Fleet deployment model'), h('dd', { lang: 'en' }, c.fleetModel),
            h('dt', null, 'Topologie'), h('dd', null, c.summary),
            h('dt', null, 'Hosty (minimum)'), h('dd', null, c.hosts),
          ),
          h('p', { class: 'small' },
            h('a', { href: c.url, target: '_blank', rel: 'noopener noreferrer', class: 'doc-link', title: c.url }, 'Proč? ↗'),
            h('span', { class: 'muted' }, ` ${c.specRef}`)),
        ),
        c.variants.length
          ? h('div', { class: `site-variants${c.variants.length > 1 ? ' site-variants-many' : ''}` },
            ...(c.variants.length > 1 ? [h('p', { class: 'small site-variant-hint' }, 'Dokumentace připouští obě varianty – vyber si:')] : []),
            ...c.variants.map((v) => variantBlock(c, v, c.variants.length > 1)))
          : h('p', { class: 'site-card-soon small' }, chip('připravujeme', 'badge-pending', 'Herní rozvržení pro tento blueprint se připravuje (model/sites.ts).'), ' Rozvržení pro tento blueprint se připravuje.'),
      ),
    );

    const back = button('← Zpět', () => ctx.navigate({ name: 'sandbox-intro' }), { class: 'btn btn-ghost' });
    const view = h('div', { class: 'screen screen-page' },
      h('main', { class: 'page-card site-pick', 'aria-labelledby': 'site-title' },
        h('h1', { id: 'site-title' }, 'Vyber design blueprint'),
        h('p', { class: 'lead' },
          'Design Blueprints jsou předpřipravené kombinace návrhových modelů z dokumentace. Každý hraješ v jiném herním rozvržení ',
          'serveroven – místnosti, budovy a vzdálené lokality.'),
        h('ul', { class: 'site-cards' }, ...cards),
        h('details', { class: 'more intro-more' },
          h('summary', null, 'Připravujeme další blueprinty'),
          h('ul', { class: 'facts' }, ...UPCOMING_BLUEPRINTS.map((b) => h('li', null, h('span', { lang: 'en' }, docLink(b.title, b.url)), h('span', { class: 'muted small' }, ` – ${b.specRef}`)))),
        ),
        h('details', { class: 'more intro-more' },
          h('summary', null, 'Proč na rozvržení záleží?'),
          h('p', null, 'Co pro VCF znamenají místnosti, budovy a vzdálená lokalita (availability zone, stretched cluster, witness, druhá VCF Instance) ',
            'a jaké jsou požadavky na linky mezi nimi, říká dokumentace:'),
          h('ul', { class: 'facts' }, ...SITE_WHY_LINKS.map((l) => h('li', null, docLink(l.label, l.url), h('span', { class: 'muted small' }, ` – ${l.specRef}`)))),
          h('p', { class: 'muted small' }, 'Rozměry místností, RTT a propustnost linek ve hře jsou herní hodnoty (', badge('illustrative'), ').'),
        ),
        h('div', { class: 'intro-foot' }, back),
        disclaimer(),
      ),
    );
    root.appendChild(view);
    (view.querySelector<HTMLElement>('.site-variant-current .btn') ?? view.querySelector<HTMLElement>('.site-variant .btn'))?.focus();
    const offEsc = onEscape(() => ctx.navigate({ name: 'sandbox-intro' }));
    return {
      dispose() {
        offEsc();
        view.remove();
      },
    };
  },
};
