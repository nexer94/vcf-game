/**
 * Right panel of a "Hotové scénáře" scenario: tabs VM · Zdroje · Hosty · O scénáři (UX Part III conventions:
 * sticky head, scrolling body, readable "Zdroj ▾", badges dokumentováno / odvozeno / nedoloženo).
 *
 * Read-only view over ScenarioModelView (ui/scenarios/scenarioData.ts). Selection is owned by the screen:
 * host -> its VMs are highlighted, VM -> its host is highlighted.
 */
import { button, h } from '../dom';
import { badge, message } from '../messages';
import { derivedBadge, docBadge, gameBadge, undocBadge } from './badges';
import { sourceButton } from '../sandbox/sourcePopover';
import { stripSourceIds } from '../../scenarios/sources';
import { DESIGN_BLUEPRINTS } from '../../model/sites';
import { VM_COMPONENT_LABEL, type ClusterUtilisation, type Resources, type Utilisation, type VmComponent } from '../../model/deployedInventory';
import {
  CPU_GUIDANCE_REF,
  DOCUMENTED_TOTALS_REF,
  PER_VM_TABLE_REF,
  PROFILE_LABEL,
  SCENARIO_GROUP_TITLE,
  WORKBOOK_LINK,
  filterVms,
  fmtRes,
  gapView,
  num,
  pctOf,
  sortVms,
  vmSourceRefs,
  type HostView,
  type ScenarioModelView,
  type VmSortKey,
  type VmView,
} from './scenarioData';

export type ScenarioTab = 'vm' | 'zdroje' | 'hosty' | 'o';
const TABS: readonly [ScenarioTab, string][] = [
  ['vm', 'VM'],
  ['zdroje', 'Zdroje'],
  ['hosty', 'Hosty'],
  ['o', 'O scénáři'],
];

export interface ScenarioPanelOptions {
  readonly model: ScenarioModelView;
  /** Room traffic is an illustrative animation (no model flows yet). */
  readonly illustrativeTraffic: boolean;
  readonly origin: 'engine';
  /** Scenario notes from the engine (Czech, kind game / spec); undefined = the preset's notes. */
  readonly notes?: readonly { readonly text: string; readonly kind: 'game' | 'spec' }[];
  readonly rackLabelOfHost: (hostId: string) => string | undefined;
  readonly onSelectHost: (hostId: string | null) => void;
  readonly onSelectVm: (vmId: string | null) => void;
}

export interface ScenarioPanel {
  readonly el: HTMLElement;
  setSelection(sel: { readonly hostId: string | null; readonly vmId: string | null }): void;
  setTab(t: ScenarioTab): void;
  readonly tab: ScenarioTab;
}

const isZero = (r: Resources): boolean => r.vcpu === 0 && r.ramGB === 0 && r.diskGB === 0;
const ratioText = (x: number): string => (Number.isFinite(x) ? `${num(x)} : 1` : '—');
const pctText = (x: number): string => (Number.isFinite(x) ? `${num(x)} %` : '—');

function bar(label: string, pct: number, text: string, warn = false): HTMLElement {
  const w = Math.max(0, Math.min(100, pct));
  return h('div', { class: 'scen-bar-row' },
    h('span', { class: 'scen-bar-label' }, label),
    h('span', { class: `scen-bar${warn ? ' warn' : ''}`, role: 'img', 'aria-label': `${label}: ${text}` }, h('span', { style: `width:${w}%` })),
    h('span', { class: 'scen-bar-val' }, text),
  );
}

export function createScenarioPanel(o: ScenarioPanelOptions): ScenarioPanel {
  const m = o.model;
  let tab: ScenarioTab = 'vm';
  let sel: { hostId: string | null; vmId: string | null } = { hostId: null, vmId: null };
  let sortKey: VmSortKey = 'name';
  let sortDir: 1 | -1 = 1;
  let query = '';
  let comp: VmComponent | '' = '';
  let onlyHost = false;

  const hostById = new Map(m.hosts.map((x) => [x.id, x]));
  const vmById = new Map(m.vms.map((x) => [x.id, x]));
  const domName = new Map(m.instances.flatMap((i) => i.domains.map((d) => [d.id, d.name] as const)));
  const domKind = new Map(m.instances.flatMap((i) => i.domains.map((d) => [d.id, d.kind] as const)));
  const uniqueLabels = new Set(m.hosts.map((x) => x.label)).size === m.hosts.length;
  const hostLabel = (id: string | undefined): string => {
    const x = id ? hostById.get(id) : undefined;
    if (!x) return '—';
    if (m.clusters.length < 2 || uniqueLabels) return x.label;
    // "m01/esx02", "wld01/esx01" – domain name without the instance prefix when there is one instance.
    const dn = domName.get(x.domainId) ?? '';
    const short = m.instances.length > 1 ? dn : dn.replace(/^[a-z0-9]+-/, '');
    return `${short}/${x.label}`;
  };

  const tabBtns = new Map<ScenarioTab, HTMLButtonElement>();
  const tabBar = h('div', { class: 'scen-tabs', role: 'tablist', 'aria-label': 'Scénář' },
    ...TABS.map(([id, label]) => {
      const b = button(label, () => setTab(id), { class: 'scen-tab', role: 'tab', id: `scen-tab-${id}`, 'aria-controls': 'scen-tabpanel', 'aria-selected': 'false' });
      tabBtns.set(id, b);
      return b;
    }),
  );
  tabBar.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = TABS.findIndex(([t]) => t === tab);
    const n = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]![0];
    setTab(n);
    tabBtns.get(n)?.focus();
    e.preventDefault();
  });
  const selBox = h('div', { class: 'scen-sel', 'aria-live': 'polite' });
  const body = h('div', { class: 'scen-body', id: 'scen-tabpanel', role: 'tabpanel' });
  const el = h('aside', { class: 'scen-panel', 'aria-label': 'Detail scénáře' }, h('div', { class: 'scen-panel-head' }, tabBar, selBox), body);

  // ------------------------------------------------------------------ selection line
  const renderSel = (): void => {
    const host = sel.hostId ? hostById.get(sel.hostId) : undefined;
    const vm = sel.vmId ? vmById.get(sel.vmId) : undefined;
    if (!host && !vm) {
      selBox.replaceChildren(h('span', { class: 'muted small' }, 'Tip: klikni na rack v místnosti nebo na VM.'));
      return;
    }
    selBox.replaceChildren(
      h('span', { class: 'scen-sel-text' },
        vm ? h('strong', null, vm.name) : '',
        vm ? ' běží na ' : 'Vybraný host: ',
        h('strong', null, hostLabel(host?.id)),
        host ? h('span', { class: 'muted' }, ` · ${o.rackLabelOfHost(host.id) ? `rack ${o.rackLabelOfHost(host.id)} · ` : ''}${host.vmIds.length} VM`) : '',
      ),
      button('×', () => {
        o.onSelectVm(null);
        o.onSelectHost(null);
      }, { class: 'btn btn-small', 'aria-label': 'Zrušit výběr', title: 'Zrušit výběr' }),
    );
  };

  // ------------------------------------------------------------------ VM tab
  const vmTab = (): HTMLElement => {
    const search = h('input', { type: 'search', placeholder: 'Hledat VM…', 'aria-label': 'Hledat VM', value: query }) as HTMLInputElement;
    search.addEventListener('input', () => {
      query = search.value;
      rows();
    });
    const comps = [...new Set(m.vms.map((v) => v.component))];
    const compSel = h('select', { 'aria-label': 'Komponenta' }, h('option', { value: '' }, 'Všechny komponenty'), ...comps.map((c) => h('option', { value: c }, VM_COMPONENT_LABEL[c]))) as HTMLSelectElement;
    compSel.value = comp;
    compSel.addEventListener('change', () => {
      comp = compSel.value as VmComponent | '';
      rows();
    });
    const only = h('input', { type: 'checkbox', id: 'scen-only-host' }) as HTMLInputElement;
    only.checked = onlyHost;
    only.disabled = !sel.hostId;
    only.addEventListener('change', () => {
      onlyHost = only.checked;
      rows();
    });
    const head = (k: VmSortKey, label: string, cls = ''): HTMLElement => {
      const active = sortKey === k;
      const b = button(`${label}${active ? (sortDir === 1 ? ' ▲' : ' ▼') : ''}`, () => {
        if (sortKey === k) sortDir = sortDir === 1 ? -1 : 1;
        else {
          sortKey = k;
          sortDir = k === 'name' || k === 'component' || k === 'host' ? 1 : -1;
        }
        rerender();
      }, { class: 'scen-sort' });
      return h('th', { class: cls, scope: 'col', 'aria-sort': active ? (sortDir === 1 ? 'ascending' : 'descending') : 'none' }, b);
    };
    const tbody = h('tbody');
    const table = h('table', { class: 'scen-table scen-vms' },
      h('thead', null, h('tr', null, head('name', 'VM'), head('vcpu', 'vCPU', 'n'), head('ramGB', 'RAM', 'n'), head('diskGB', 'Disk', 'n'), head('host', 'Host'))),
      tbody,
    );
    const countEl = h('span', { class: 'muted small' });
    const rows = (): void => {
      let list = filterVms(m.vms, query, comp);
      if (onlyHost && sel.hostId) list = list.filter((v) => v.hostId === sel.hostId);
      countEl.textContent = `${list.length} z ${m.vms.length} VM`;
      const out: HTMLElement[] = [];
      for (const inst of m.instances)
        for (const d of inst.domains) {
          const vs = sortVms(list.filter((v) => v.domainId === d.id), sortKey, sortDir, hostLabel);
          if (!vs.length) continue;
          const sum = vs.reduce((s, v) => (v.undocumented ? s : { vcpu: s.vcpu + (v.vcpu ?? 0), ramGB: s.ramGB + (v.ramGB ?? 0), diskGB: s.diskGB + (v.diskGB ?? 0) }), { vcpu: 0, ramGB: 0, diskGB: 0 });
          out.push(h('tr', { class: 'scen-group-row' }, h('th', { colspan: '5', scope: 'rowgroup' },
            m.instances.length > 1 ? `${inst.name} · ` : '', d.name, ` (${d.kind === 'management' ? 'management doména' : 'workload doména'})`,
            h('span', { class: 'muted' }, ` · ${vs.length} VM · ${num(sum.vcpu)} vCPU / ${num(sum.ramGB)} GB`),
          )));
          for (const v of vs) out.push(vmRow(v));
        }
      if (!out.length) out.push(h('tr', null, h('td', { colspan: '5', class: 'muted' }, 'Žádná VM neodpovídá filtru.')));
      tbody.replaceChildren(...out);
    };
    const vmRow = (v: VmView): HTMLElement => {
      const hl = (sel.hostId && v.hostId === sel.hostId) || sel.vmId === v.id;
      const src = sourceButton({ specRef: vmSourceRefs(v), extra: WORKBOOK_LINK }, 'Zdroj ▾');
      const serves = v.servesDomainId !== v.domainId ? h('span', { class: 'ui-chip scen-serves', title: 'VM běží v management doméně, ale patří k workload doméně (vCenter / NSX Manager WLD).' }, `pro ${domName.get(v.servesDomainId) ?? v.servesDomainId}`) : null;
      const nameBtn = button(v.name, () => o.onSelectVm(sel.vmId === v.id ? null : v.id), { class: 'scen-vm-name', 'aria-pressed': sel.vmId === v.id ? 'true' : 'false', title: 'Klik = ukázat host, na kterém VM běží' });
      const cell = (n: number | null, extra?: HTMLElement | null): HTMLElement => h('td', { class: 'n' }, n === null ? '—' : num(n), extra ?? '');
      return h('tr', { class: `scen-vm${hl ? ' hl' : ''}${sel.vmId === v.id ? ' sel' : ''}`, 'data-vm': v.id },
        h('td', null,
          nameBtn,
          h('div', { class: 'scen-vm-sub' }, v.componentLabel, ' · ', h('span', { lang: 'en' }, v.size), serves ? ' ' : '', serves ?? '', v.undocumented ? ' ' : '', v.undocumented ? undocBadge(true) : '', ' ', src ?? ''),
        ),
        cell(v.vcpu),
        cell(v.ramGB),
        cell(v.diskGB, v.diskDerived ? h('span', { class: 'scen-mark', title: 'Disk workerů je ve workbooku jedna hodnota za profil – tady rozdělená na uzly (odvozeno).' }, '*') : null),
        // Rows are grouped by the domain the VM runs in, so the short host name is unambiguous here.
        h('td', { class: 'scen-host-cell' }, v.hostId ? button(hostById.get(v.hostId)?.label ?? v.hostId, () => o.onSelectHost(v.hostId!), { class: 'link-btn', title: `Vybrat host ${hostLabel(v.hostId)}` }) : '—'),
      );
    };
    rows();
    return h('div', { class: 'scen-tab-vm' },
      h('div', { class: 'scen-toolbar' }, search, compSel),
      h('div', { class: 'scen-toolbar' }, h('label', { class: 'set-row', for: 'scen-only-host' }, only, ' Jen VM vybraného hostu'), h('span', { class: 'inv-spacer' }), countEl),
      table,
      h('p', { class: 'muted small' },
        'RAM a disk v GB. Velikosti VM: Planning and Preparation Workbook 9.1.1. Rozmístění na hosty je ', gameBadge('Na kterém hostu VM běží, dokumentace neurčuje – rozložení je herní.'), '. * disk rozdělený na uzly (odvozeno). ',
        sourceButton({ specRef: PER_VM_TABLE_REF, extra: WORKBOOK_LINK }) ?? ''),
    );
  };

  // ------------------------------------------------------------------ Zdroje tab
  const resRow = (label: string | HTMLElement, r: Resources, ...badges: (HTMLElement | null | string)[]): HTMLElement =>
    h('div', { class: 'scen-res-row' }, h('div', { class: 'scen-res-label' }, label, ' ', ...badges.filter(Boolean) as HTMLElement[]), h('div', { class: 'scen-res-val' }, fmtRes(r)));

  const zdrojeTab = (): HTMLElement => {
    const out: HTMLElement[] = [];
    for (const inst of m.instances) {
      const md = m.totals.managementDomains.find((x) => x.instanceId === inst.id);
      const it = m.totals.instances.find((x) => x.instanceId === inst.id);
      const sec = h('section', { class: 'scen-sec' },
        h('h3', null, m.instances.length > 1 ? `${inst.name} · ` : '', 'Management doména ', h('span', { class: 'muted' }, md ? `· profil ${PROFILE_LABEL[md.profile]}` : '')),
      );
      if (md) {
        if (md.documented) sec.append(resRow('Dokumentovaný součet profilu', md.documented.resources, docBadge(), sourceButton({ specRef: DOCUMENTED_TOTALS_REF })));
        sec.append(resRow(`Součet per-VM (${md.base.vmCount} VM)`, md.base.perVm, derivedBadge(), md.base.undocumentedVms ? undocBadge() : null));
        if (md.documentedMinusPerVm) {
          const g = gapView(md.documentedMinusPerVm, md.base.undocumentedVms);
          sec.append(h('div', { class: 'scen-gap' },
            h('div', null, h('strong', null, 'Rozdíl dokumentováno − per-VM: '), fmtRes(g.gap)),
            g.cpuRamText ? h('p', null, g.cpuRamText) : '',
            g.diskText ? h('p', null, g.diskText) : '',
            h('div', null, badge('paraphrase'), ' ', sourceButton({ specRef: '40-workload-domains §6.4, §8 [W6]' }) ?? ''),
          ));
        }
        if (!isZero(md.workloadIncrements.perVm))
          sec.append(resRow(`vCenter / NSX Manager workload domén (${md.workloadIncrements.vmCount} VM)`, md.workloadIncrements.perVm, derivedBadge(), sourceButton({ specRef: '40-workload-domains §2.1 [W1]' })));
        sec.append(resRow(h('strong', null, 'Management doména celkem (plán)'), md.planning, derivedBadge(md.documented ? 'Dokumentovaný součet profilu + součet per-VM workload doménových VM (odvozeno).' : 'Součet per-VM (odvozeno).')));
      }
      for (const w of m.totals.workloadDomains.filter((x) => x.instanceId === inst.id)) {
        const name = domName.get(w.domainId) ?? w.domainId;
        sec.append(h('h4', null, `Workload doména ${name}`));
        sec.append(resRow(`V clusteru ${name} (${w.inCluster.vmCount} VM: Supervisor, Edge…)`, w.inCluster.perVm, derivedBadge()));
        sec.append(resRow(`V management doméně (${w.inManagementDomain.vmCount} VM)`, w.inManagementDomain.perVm, derivedBadge()));
      }
      if (it && m.instances.length > 1) sec.append(resRow(h('strong', null, `Instance ${inst.name} celkem (plán)`), it.planning, derivedBadge()));
      out.push(sec);
    }
    const f = m.totals.fleet;
    out.push(h('section', { class: 'scen-sec scen-fleet' },
      h('h3', null, 'Fleet celkem'),
      resRow(h('strong', null, 'Plán (dokumentované základy + per-VM navíc)'), f.planning, derivedBadge('Dokumentované součty management domén + per-VM součty ostatních VM (odvozeno).')),
      resRow(`Součet per-VM všech ${f.all.vmCount} VM`, f.all.perVm, derivedBadge(), f.all.undocumentedVms ? undocBadge() : null),
      h('p', { class: 'muted small' }, 'Byznys workloady (VM uživatelů) scénář nemodeluje – jen management komponenty a infrastruktura domén.'),
    ));
    return h('div', { class: 'scen-tab-res' }, ...out);
  };

  // ------------------------------------------------------------------ Hosty tab
  const utilRows = (u: Utilisation, label: string): HTMLElement[] => {
    const over = u.vcpuPerCore > 2 || u.vcpuPerCoreOneHostDown > 2;
    return [
      h('tr', null, h('th', { scope: 'row' }, label, ' vCPU : pCore'), h('td', { class: over ? 'warnc' : '' }, ratioText(u.vcpuPerCore)), h('td', { class: over ? 'warnc' : '' }, ratioText(u.vcpuPerCoreOneHostDown))),
      h('tr', null, h('th', { scope: 'row' }, label, ' RAM'), h('td', { class: u.ramPct > 100 ? 'badc' : '' }, pctText(u.ramPct)), h('td', { class: u.ramPctOneHostDown > 100 ? 'badc' : '' }, pctText(u.ramPctOneHostDown))),
      h('tr', null, h('th', { scope: 'row' }, label, ' disk z raw vSAN'), h('td', { class: u.diskPctOfRaw > 100 ? 'badc' : '' }, pctText(u.diskPctOfRaw)), h('td', null, '')),
    ];
  };
  const utilTable = (u: ClusterUtilisation): HTMLElement =>
    h('table', { class: 'scen-table scen-util' },
      h('thead', null, h('tr', null, h('th', null, ''), h('th', { scope: 'col' }, 'Všechny hosty'), h('th', { scope: 'col', title: 'Jeden host mimo provoz (údržba / porucha) – odebrán největší host' }, 'N-1'))),
      h('tbody', null, ...(u.planning ? utilRows(u.planning, 'Plán') : []), ...utilRows(u.perVm, u.planning ? 'Per-VM' : '')),
    );
  const hostCard = (x: HostView): HTMLElement => {
    const cap = x.capacity;
    const selected = sel.hostId === x.id;
    const cpuPct = pctOf(x.load.vcpu, cap?.cores);
    const ramPct = pctOf(x.load.ramGB, cap?.ramGB);
    const card = h('div', { class: `scen-host${selected ? ' sel' : ''}`, 'data-host': x.id },
      h('div', { class: 'scen-host-head' },
        button(x.label, () => o.onSelectHost(selected ? null : x.id), { class: 'scen-host-name', 'aria-pressed': selected ? 'true' : 'false' }),
        h('span', { class: 'muted small' }, `${o.rackLabelOfHost(x.id) ? `rack ${o.rackLabelOfHost(x.id)} · ` : ''}${x.configId}`),
        h('span', { class: 'inv-spacer' }),
        h('span', { class: 'muted small' }, `${x.vmIds.length} VM`),
      ),
      cap
        ? h('div', null,
            bar('CPU', cpuPct / 2, `${num(x.load.vcpu)} vCPU / ${num(cap.cores)} jader`, x.load.vcpu > cap.cores * 2),
            bar('RAM', ramPct, `${num(x.load.ramGB)} / ${num(cap.ramGB)} GB`, ramPct > 100))
        : h('p', { class: 'muted small' }, 'Kapacita hostu se nenačetla (katalog hardwaru).'),
      x.vmIds.length
        ? h('div', { class: 'scen-host-vms' }, ...x.vmIds.map((id) => {
            const v = vmById.get(id);
            return button(v?.name ?? id, () => o.onSelectVm(id), { class: `scen-vm-chip${sel.vmId === id ? ' sel' : ''}`, title: v ? `${v.componentLabel} · ${v.size}` : '' });
          }))
        : h('p', { class: 'muted small' }, 'Žádná management VM – kapacita pro workloady.'),
    );
    return card;
  };
  const hostyTab = (): HTMLElement => {
    const out: HTMLElement[] = [];
    for (const c of m.clusters) {
      const u = c.util;
      const sec = h('section', { class: 'scen-sec' },
        h('h3', null, `Cluster ${c.name}`, h('span', { class: 'muted' }, ` · ${c.domainName} (${domKind.get(c.domainId) === 'management' ? 'management' : 'workload'})`)),
      );
      if (u) {
        sec.append(h('p', { class: 'small' }, `${u.hostCount} hosty · ${num(u.cores)} jader · ${num(u.ramGB)} GB RAM · ${num(Math.round(u.rawCapacityGB / 100) / 10)} TB raw vSAN `, derivedBadge('Kapacita ze sestavy serveru (katalog), poměry odvozené.')));
        sec.append(utilTable(u));
        if (u.cpuGuidanceMaxRatio !== undefined)
          sec.append(message({
            type: 'game-tip',
            compact: true,
            title: `Doporučení: vCPU : pCore v management doméně do ${u.cpuGuidanceMaxRatio} : 1`,
            body: 'Vyšší poměry (3 : 1, 4 : 1) jsou podporované, ale je potřeba hlídat CPU ready. Počítej i se situací, kdy je jeden host v údržbě (N-1).',
            source: { specRef: CPU_GUIDANCE_REF },
          }));
      }
      sec.append(...c.hostIds.map((id) => hostById.get(id)).filter((x): x is HostView => !!x).map(hostCard));
      out.push(sec);
    }
    out.push(h('p', { class: 'muted small' }, 'Zátěž hostu = součet per-VM hodnot VM na hostu (bez License serveru). Lišta CPU: 100 % = 2 vCPU na jádro. Rozmístění VM je ', gameBadge('Dokumentace neurčuje, na kterém hostu VM běží.'), '.'));
    return h('div', { class: 'scen-tab-hosts' }, ...out);
  };

  // ------------------------------------------------------------------ O scénáři tab
  const oTab = (): HTMLElement => {
    const p = m.preset;
    const bp = p.blueprintId ? DESIGN_BLUEPRINTS[p.blueprintId] : null;
    const configs = m.clusters.map((c) => `${c.name}: ${c.hostIds.length}× ${hostById.get(c.hostIds[0] ?? '')?.configId ?? '?'}`);
    const gameNote = (n: string): boolean => /game choice|game|herní/i.test(n);
    return h('div', { class: 'scen-tab-about' },
      h('h3', null, p.title),
      h('p', { class: 'muted small' }, `Scénář ${p.scenario}: ${SCENARIO_GROUP_TITLE[p.scenario]}`),
      h('dl', { class: 'scen-facts' },
        h('dt', null, 'Blueprint'),
        h('dd', null, bp ? h('span', null, h('a', { href: bp.url, target: '_blank', rel: 'noopener noreferrer', lang: 'en' }, `${bp.title} ↗`), ' ', sourceButton({ specRef: bp.specRef }) ?? '') : 'bez blueprintu (jen sizing profil management domény)'),
        ...m.instances.flatMap((i) => [
          h('dt', null, m.instances.length > 1 ? `Instance ${i.name}` : 'Instance'),
          h('dd', null, `${i.first ? 'první' : 'další'} VCF Instance · profil ${i.profile ? PROFILE_LABEL[i.profile] : '?'} · ${i.location === 'region2' ? 'region 2' : 'region 1'} · domény: ${i.domains.map((d) => d.name).join(', ')}`),
        ]),
        h('dt', null, 'Servery'), h('dd', null, configs.join(' · '), ' ', gameBadge('Konfigurace serveru je herní volba z certifikovaného startovního katalogu (Broadcom Compatibility Guide).')),
        h('dt', null, 'Provoz v místnosti'),
        h('dd', null, o.illustrativeTraffic ? h('span', null, 'jen animace provozu ', badge('illustrative')) : h('span', null, 'toky z modelu, objemy ', badge('illustrative'))),
        h('dt', null, 'Rozmístění VM'), h('dd', null, 'deterministické herní rozložení, víceuzlové komponenty na různých hostech ', gameBadge('Dokumentace neurčuje, na kterém hostu VM běží (za běhu rozhoduje DRS).')),
      ),
      h('h4', null, 'Poznámky ke scénáři'),
      h('ul', { class: 'scen-notes' }, ...(o.notes ?? p.notes.map((t) => ({ text: t, kind: gameNote(t) ? ('game' as const) : ('spec' as const) }))).map((n) =>
        h('li', /[áčďéěíňóřšťúůýž]/i.test(n.text) ? null : { lang: 'en' }, stripSourceIds(n.text), ' ', n.kind === 'game' ? gameBadge('Herní volba, ne údaj z dokumentace.') : ''))),
      h('p', null, sourceButton({ specRef: [p.specRef, DOCUMENTED_TOTALS_REF] }, 'Zdroj scénáře ▾') ?? ''),
      m.issues.length
        ? h('div', null, h('h4', null, 'Hlášení modelu'), ...m.issues.map((x) => message({ type: x.severity === 'error' ? 'vcf-error' : 'vcf-warning', compact: true, body: x.message, bodyLang: 'en', source: { specRef: x.specRef } })))
        : '',
      h('p', { class: 'muted small' }, 'Data: scénářová session enginu (stejný model a pravidla jako Sandbox).'),
    );
  };

  // ------------------------------------------------------------------ render
  /** Identity of the focused control inside the body (re-rendering replaces the DOM – keep keyboard focus). */
  const focusKey = (): string | null => {
    const a = document.activeElement;
    if (!(a instanceof HTMLElement) || !body.contains(a)) return null;
    const row = a.closest<HTMLElement>('[data-vm], [data-host]');
    const cls = a.classList[0];
    if (!row || !cls) return null;
    const attr = row.dataset['vm'] !== undefined ? 'data-vm' : 'data-host';
    return `[${attr}="${CSS.escape(row.getAttribute(attr) ?? '')}"] .${cls}`;
  };
  const rerender = (): void => {
    const scroll = body.scrollTop;
    const fk = focusKey();
    body.replaceChildren(tab === 'vm' ? vmTab() : tab === 'zdroje' ? zdrojeTab() : tab === 'hosty' ? hostyTab() : oTab());
    body.scrollTop = scroll;
    if (fk) body.querySelector<HTMLElement>(fk)?.focus({ preventScroll: true });
    for (const [id, b] of tabBtns) {
      b.setAttribute('aria-selected', id === tab ? 'true' : 'false');
      b.tabIndex = id === tab ? 0 : -1;
    }
    body.setAttribute('aria-labelledby', `scen-tab-${tab}`);
  };
  const setTab = (t: ScenarioTab): void => {
    if (t === tab) return;
    tab = t;
    body.scrollTop = 0;
    rerender();
  };
  renderSel();
  rerender();

  const scrollToSelection = (): void => {
    const q = tab === 'vm' ? (sel.vmId ? `[data-vm="${CSS.escape(sel.vmId)}"]` : sel.hostId ? 'tr.scen-vm.hl' : null) : tab === 'hosty' && sel.hostId ? `[data-host="${CSS.escape(sel.hostId)}"]` : null;
    const t = q ? body.querySelector<HTMLElement>(q) : null;
    t?.scrollIntoView({ block: 'nearest' });
  };

  return {
    el,
    get tab() {
      return tab;
    },
    setTab: (t) => {
      setTab(t);
      scrollToSelection();
    },
    setSelection(s) {
      const hostChanged = s.hostId !== sel.hostId;
      sel = { hostId: s.hostId, vmId: s.vmId };
      if (!sel.hostId) onlyHost = false;
      renderSel();
      rerender();
      if (hostChanged || s.vmId) scrollToSelection();
    },
  };
}
