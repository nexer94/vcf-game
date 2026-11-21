/**
 * Switch panel (UX §9.5 "Konfigurace portu switche", §2.6 L2): port table (mode access / trunk, VLANs, native VLAN,
 * MTU, link, peer), multi-select + one edit form applied to the selection (setSwitchPort with a port list),
 * "Síť firmy" uplink (GAME abstraction) and the model issues of the hosts cabled to this switch.
 * Generic "no-name" switch: its defaults are game defaults (labelled).
 */
import { SWITCH_PORT_GAME_DEFAULTS } from '../../model';
import type { SwitchView } from '../../modes/sandbox/roomView';
import type { SandboxSnapshot } from '../../modes/sandbox/snapshot';
import type { SwitchPortInput } from '../../modes/sandbox/types';
import { button, h } from '../dom';
import { badge, message } from '../messages';
import { formatVlanList, intOf, parseVlanList } from './panelData';
import { fieldRow, focusKey, issueList, restoreFocus, resultNote, textInput, type ResultNote } from './panelKit';
import type { ObjectPanel } from './serverPanel';
import type { SessionOps } from './sessionPort';

export interface SwitchPanelOptions {
  readonly ops: SessionOps;
  readonly switchId: string;
  readonly announce: (text: string, bad?: boolean) => void;
  readonly onClose: () => void;
}

interface PortDraft {
  mode: '' | 'access' | 'trunk';
  vlan: string;
  vlans: string;
  nativeVlan: string;
  mtu: string;
}

const emptyDraft = (): PortDraft => ({ mode: '', vlan: '', vlans: '', nativeVlan: '', mtu: '' });

export function createSwitchPanel(o: SwitchPanelOptions): ObjectPanel {
  const { ops } = o;
  let snap = ops.snapshot();
  const selected = new Set<number>();
  let draft = emptyDraft();
  let result: ResultNote | null = null;
  let filter: 'all' | 'cabled' = 'cabled';
  let uplinkPort = '';
  const el = h('section', { class: 'op-panel op-switch', role: 'dialog', 'aria-label': `Switch ${o.switchId}` });
  const sw = (): SwitchView | undefined => snap.physical.switches.find((x) => x.id === o.switchId);

  const run = (cmd: Parameters<SessionOps['dispatch']>[0], okText: string): boolean => {
    const r = ops.dispatch(cmd);
    result = r.ok ? { ok: true, text: okText, ...(r.warnings?.length ? { issues: r.warnings } : {}) } : { ok: false, text: r.message, ...(r.issues ? { issues: r.issues } : {}) };
    o.announce(r.ok ? okText : `Nelze: ${r.message}`, !r.ok);
    render();
    return r.ok;
  };

  function apply(v: SwitchView): void {
    if (!selected.size) {
      result = { ok: false, text: 'Vyber aspoň jeden port (zaškrtni v tabulce).' };
      return render();
    }
    const cfg: { -readonly [K in keyof SwitchPortInput]: SwitchPortInput[K] } = {};
    if (draft.mode) cfg.mode = draft.mode;
    const num = (s: string, label: string): number | undefined | null => {
      if (s.trim() === '') return undefined;
      const n = intOf(s);
      if (n === undefined) {
        result = { ok: false, text: `${label} musí být číslo.` };
        return null;
      }
      return n;
    };
    const vlan = num(draft.vlan, 'Access VLAN');
    const native = num(draft.nativeVlan, 'Native VLAN');
    const mtu = num(draft.mtu, 'MTU');
    if (vlan === null || native === null || mtu === null) return render();
    if (vlan !== undefined) cfg.vlan = vlan;
    if (native !== undefined) cfg.nativeVlan = native;
    if (mtu !== undefined) cfg.mtu = mtu;
    if (draft.vlans.trim() !== '') {
      const l = parseVlanList(draft.vlans);
      if (l === null) {
        result = { ok: false, text: 'Povolené VLAN zadej jako „all“ nebo seznam „10, 20-22“.' };
        return render();
      }
      cfg.vlans = l;
    }
    if (!Object.keys(cfg).length) {
      result = { ok: false, text: 'Nic se nemění – vyplň aspoň jedno pole.' };
      return render();
    }
    const ports = [...selected].sort((a, b) => a - b);
    if (run({ type: 'setSwitchPort', switchId: v.id, port: ports, config: cfg }, `Nastaveno na ${ports.length} portech (${ports.map((p) => `p${p + 1}`).join(', ')}).`)) draft = emptyDraft();
    render();
  }

  function render(): void {
    const v = sw();
    const fk = focusKey(el);
    if (!v) {
      el.replaceChildren(h('p', null, `Switch ${o.switchId} už neexistuje.`), button('Zavřít', () => o.onClose(), { class: 'btn btn-small' }));
      return;
    }
    const company = snap.physical.companyNetwork;
    const rows = v.ports.filter((p) => filter === 'all' || p.cableId !== undefined || p.companyUplink || selected.has(p.index));
    const allSel = rows.length > 0 && rows.every((p) => selected.has(p.index));
    const selAll = h('input', { type: 'checkbox', 'aria-label': 'Vybrat všechny zobrazené porty', 'data-fk': 'sel-all', ...(allSel ? { checked: true } : {}) });
    selAll.addEventListener('change', () => {
      for (const p of rows) {
        if (selAll.checked) selected.add(p.index);
        else selected.delete(p.index);
      }
      render();
    });
    const table = h('table', { class: 'op-table port-table' },
      h('thead', null, h('tr', null, h('th', null, selAll), h('th', null, 'Port'), h('th', null, 'Zapojeno do'), h('th', null, 'Režim'), h('th', null, 'VLAN'), h('th', null, 'Native'), h('th', null, 'MTU'))),
      h('tbody', null, ...rows.map((p) => {
        const cb = h('input', { type: 'checkbox', 'aria-label': `Vybrat port p${p.index + 1}`, 'data-fk': `sel-${p.index}`, ...(selected.has(p.index) ? { checked: true } : {}) });
        cb.addEventListener('change', () => {
          if (cb.checked) selected.add(p.index);
          else selected.delete(p.index);
          render();
        });
        const c = p.config;
        return h('tr', { class: selected.has(p.index) ? 'sel' : '' },
          h('td', null, cb),
          h('td', null, `p${p.index + 1}`, p.config.lagGroup ? ` · LAG ${p.config.lagGroup}` : ''),
          h('td', null, p.companyUplink ? '⇧ Síť firmy (herní)' : p.peerLabel ? `${p.link?.up ? '●' : '▲'} ${p.peerLabel}` : '–'),
          h('td', null, c.mode === 'trunk' ? 'trunk 802.1Q' : 'access'),
          h('td', null, c.mode === 'trunk' ? formatVlanList(c.allowedVlans) : String(c.accessVlan)),
          h('td', null, c.mode === 'trunk' ? String(c.nativeVlan) : '–'),
          h('td', null, String(c.mtu)),
        );
      })),
    );
    const modeSel = h('select', { 'data-fk': 'f-mode', 'aria-label': 'Režim portu' },
      h('option', { value: '' }, '(beze změny)'),
      h('option', { value: 'access', ...(draft.mode === 'access' ? { selected: true } : {}) }, 'access'),
      h('option', { value: 'trunk', ...(draft.mode === 'trunk' ? { selected: true } : {}) }, 'trunk 802.1Q'),
    );
    modeSel.addEventListener('change', () => {
      draft.mode = modeSel.value as PortDraft['mode'];
      render();
    });
    const ph = { placeholder: '(beze změny)' };
    const form = h('div', { class: 'op-editor' },
      h('h4', null, `Upravit vybrané porty (${selected.size})`),
      fieldRow('Režim', modeSel),
      draft.mode !== 'trunk' ? fieldRow('Access VLAN', textInput(draft.vlan, 'f-vlan', (x) => (draft.vlan = x), { ...ph, class: 'op-num' })) : null,
      draft.mode !== 'access' ? fieldRow('Povolené VLAN (trunk)', textInput(draft.vlans, 'f-vlans', (x) => (draft.vlans = x), { placeholder: 'all nebo 10, 20-22' })) : null,
      draft.mode !== 'access' ? fieldRow('Native VLAN (trunk)', textInput(draft.nativeVlan, 'f-native', (x) => (draft.nativeVlan = x), { ...ph, class: 'op-num' })) : null,
      fieldRow('MTU', textInput(draft.mtu, 'f-mtu', (x) => (draft.mtu = x), { ...ph, class: 'op-num' }), [], `max. ${v.maxMtu} (model generického switche, herní)`),
      h('div', { class: 'op-actions' },
        button('Použít na vybrané', () => apply(v), { class: 'btn btn-small btn-primary', 'data-fk': 'f-apply' }),
        button('Zrušit výběr', () => {
          selected.clear();
          render();
        }, { class: 'btn btn-small', 'data-fk': 'f-clear' }),
      ),
    );
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
        e.preventDefault();
        apply(v);
      }
    });
    // Company network uplink (GAME abstraction)
    const free = v.ports.filter((p) => p.cableId === undefined);
    if (uplinkPort === '' || !free.some((p) => String(p.index) === uplinkPort)) uplinkPort = String(free[free.length - 1]?.index ?? '');
    const upSel = h('select', { 'data-fk': 'up-port', 'aria-label': 'Port pro síť firmy' }, ...free.map((p) => h('option', { value: String(p.index), ...(String(p.index) === uplinkPort ? { selected: true } : {}) }, `p${p.index + 1}`)));
    upSel.addEventListener('change', () => (uplinkPort = upSel.value));
    const eps = snap.physical.endpoints.filter((e) => e.attachment.kind === 'switch-port');
    const companyBox = h('div', { class: 'op-company' },
      h('h4', null, '⇧ Síť firmy ', badge('game-simplification', 'gateway, DNS, NTP, DHCP a počítač admina za jedním portem')),
      company?.switchId === v.id
        ? h('div', null, `Připojeno na p${company.port + 1}. `, button('Odpojit síť firmy', () => run({ type: 'disconnectCompanyNetwork' }, 'Síť firmy odpojena.'), { class: 'btn btn-small btn-danger', 'data-fk': 'up-off' }))
        : company
          ? h('p', { class: 'small' }, `Síť firmy je připojená do ${company.switchId} p${company.port + 1}.`)
          : h('div', null, 'Port: ', upSel, ' ', button('Připojit do sítě firmy', () => run({ type: 'connectCompanyNetwork', switchId: v.id, ...(uplinkPort !== '' ? { port: Number(uplinkPort) } : {}) }, 'Switch je připojený do sítě firmy.'), { class: 'btn btn-small btn-primary', 'data-fk': 'up-on', ...(v.mount ? {} : { disabled: true }) })),
      eps.length
        ? h('ul', { class: 'op-plain small' }, ...eps.map((e) => h('li', null, `${e.label ?? e.id}: ${e.ipv4 ?? ''}`)), h('li', null, 'adresy: ', badge('game-default')))
        : h('p', { class: 'muted small' }, 'Za portem bude gateway, DNS, NTP, DHCP a počítač admina (herní adresy).'),
    );
    // Issues of hosts cabled to this switch (model)
    const hostIds = new Set(v.ports.flatMap((p) => (p.peer && p.peer.kind !== 'switch' ? [p.peer.serverId] : [])));
    const issues = snap.physical.servers.filter((s) => hostIds.has(s.id)).flatMap((s) => [...s.topology.errors, ...s.topology.warnings, ...s.topology.recommendations]);
    const fAll = button(filter === 'all' ? 'Jen zapojené porty' : `Všechny porty (${v.ports.length})`, () => {
      filter = filter === 'all' ? 'cabled' : 'all';
      render();
    }, { class: 'btn btn-small', 'data-fk': 'f-filter' });
    const note = resultNote(result);
    el.replaceChildren(
      h('div', { class: 'op-head' },
        h('div', { class: 'op-title' }, h('strong', null, v.id), h('span', { class: 'muted' }, ` · ${v.label}`),
          h('div', { class: 'op-status' }, `${v.ports.length} portů · ${v.speedsGbE.join('/')} GbE · `, badge('game-simplification', 'generický „no-name“ switch'))),
        button('✖', () => o.onClose(), { class: 'btn btn-small', 'aria-label': 'Zavřít panel (Esc)', 'data-fk': 'close' }),
      ),
      ...(note ? [note] : []),
      h('div', { class: 'op-body' },
        h('p', { class: 'small muted' }, `Výchozí port: ${SWITCH_PORT_GAME_DEFAULTS.mode}, VLAN ${SWITCH_PORT_GAME_DEFAULTS.accessVlan}, MTU ${defaultMtu(snap, v.modelId)} `, badge('game-default', 'generický switch nemá dokumentovaný default')),
        h('div', { class: 'op-actions' }, fAll, h('span', { class: 'muted small' }, 'Zaškrtni porty a uprav je najednou.')),
        h('div', { class: 'op-scroll' }, rows.length ? table : h('p', { class: 'muted' }, 'Žádný port není zapojený.')),
        form,
        companyBox,
        h('h4', null, `Hlášení modelu u zapojených hostů (${issues.length})`),
        issueList(issues, hostIds.size ? '✓ Model nehlásí problém.' : 'Do switche zatím není zapojený žádný host.'),
        message({ type: 'game-tip', compact: true, body: 'Požadavky na VLAN a MTU podle návrhu ukáže validace a úkoly – UI je samo nekontroluje.' }),
      ),
    );
    restoreFocus(el, fk);
  }

  render();
  return {
    el,
    get title() {
      return `Switch ${o.switchId}`;
    },
    update(next, structural) {
      snap = next;
      if (structural) render();
    },
    dispose() {
      el.remove();
    },
  };
}

function defaultMtu(snap: SandboxSnapshot, modelId: string): string {
  const it = snap.physical.catalog.items.find((x) => x.id === modelId);
  return it?.kind === 'switch' ? String(it.model.defaultPortMtu) : '–';
}
