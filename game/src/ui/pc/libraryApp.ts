/**
 * Computer app "Knihovna" (UX.md §11.5): documentation links the game uses, collected from the data the game
 * already carries (design sources of the model, use-case catalog, objective references, BCG pages of the
 * hardware catalog). Nothing new is cited here.
 */
import { DESIGN_SOURCES } from '../../model';
import { USE_CASES } from '../../modes/sandbox/useCases';
import { docLink, h } from '../dom';
import type { RoomPort } from '../sandbox/sessionPort';
import { nn, type PcApp } from './designApp';

interface Entry {
  readonly title: string;
  readonly url: string;
  readonly ref?: string;
}

const SPEC_LABEL: Readonly<Record<string, string>> = { '05-design': 'Návrh (spec 05-design)', '10-planning': 'Plánování (spec 10-planning)', '00-architektura': 'Architektura (spec 00-architektura)' };

export function libraryGroups(port: RoomPort): { title: string; entries: Entry[] }[] {
  const groups = new Map<string, Map<string, Entry>>();
  const add = (g: string, e: Entry): void => {
    const m = groups.get(g) ?? new Map<string, Entry>();
    if (!m.has(e.url)) m.set(e.url, e);
    groups.set(g, m);
  };
  for (const s of Object.values(DESIGN_SOURCES) as { title: string; url: string; spec: string }[]) add(SPEC_LABEL[s.spec] ?? s.spec, { title: s.title, url: s.url });
  for (const u of USE_CASES) add('Use case a nasazení (spec 25)', { title: `${u.id} – ${u.title}`, url: u.url, ref: u.specRef });
  const st = port.state();
  for (const o of st.objectives) if (o.docUrl) add('Úkoly trackeru', { title: o.title, url: o.docUrl, ...(o.specRef ? { ref: o.specRef } : {}) });
  for (const s of st.catalog.servers) if (s.bcgUrl) add('Hardware – Broadcom Compatibility Guide', { title: `${s.vendor} ${s.model}`, url: s.bcgUrl });
  return [...groups].map(([title, m]) => ({ title, entries: [...m.values()] }));
}

export function createLibraryApp(port: RoomPort): PcApp {
  const el = h('div', { class: 'pc-app pc-library' });
  const search = h('input', { type: 'search', class: 'pc-search', placeholder: 'Hledat v odkazech…', 'aria-label': 'Hledat v odkazech' });
  const list = h('div', { class: 'lib-groups' });
  const render = (): void => {
    const q = search.value.trim().toLowerCase();
    list.replaceChildren(...nn(
      ...libraryGroups(port).map((g) => {
        const es = g.entries.filter((e) => !q || e.title.toLowerCase().includes(q) || (e.ref ?? '').toLowerCase().includes(q));
        if (!es.length) return null;
        return h('details', { class: 'lib-group', open: !!q || g.entries.length <= 12 },
          h('summary', null, `${g.title} (${es.length})`),
          h('ul', null, ...es.map((e) => h('li', null, docLink(e.title, e.url), e.ref ? h('span', { class: 'spec-ref' }, ` spec ${e.ref}`) : null))));
      }),
    ));
  };
  search.addEventListener('input', render);
  el.append(
    h('header', { class: 'pc-app-head' }, h('h2', null, 'Knihovna'), h('span', { class: 'muted small' }, 'Odkazy na oficiální dokumentaci, ze kterých hra vychází.'), search),
    list,
  );
  render();
  return { el, escape: () => false, dispose: () => undefined };
}
