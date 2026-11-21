/**
 * Host detail – network (UX §12.4, §9.6): three bands VMkernel -> virtual switch (vSwitch0 / VDS) -> vmnic cards,
 * with the switch port at the bottom of every card, MTU chain vmk -> vSwitch -> switch port (the short link is
 * highlighted) and illustrative per-class loads from snapshot.flows.uplinks as shaped, coloured dots.
 *
 * DOM view (cheap CSS transform animations, no filters); also the accessible table alternative ("Tabulka").
 * Edits go through engine commands (setVmkMtu, setHostSwitchMtu, setHostUplinks, setSwitchPort).
 */
import './panels.css';
import { ESX_INSTALL_DEFAULTS, type FlowTrafficClass } from '../../model';
import type { SandboxSnapshot } from '../../modes/sandbox/snapshot';
import { DOT_GLYPH } from '../../render/room/dotAtlas';
import { loadBand } from '../../render/traffic/loadStyle';
import { TRAFFIC_STYLE } from '../../render/traffic/trafficTypes';
import { button, h } from '../dom';
import { badge } from '../messages';
import { formatVlanList, hostNetBands, intOf, type VmnicCard } from './panelData';
import { focusKey, issueList, restoreFocus, resultNote, type ResultNote } from './panelKit';
import type { SessionOps } from './sessionPort';

export interface HostDetailOptions {
  readonly ui: HTMLElement;
  readonly ops: SessionOps;
  readonly hostId: string;
  readonly rackId: string;
  readonly announce: (text: string, bad?: boolean) => void;
  readonly onBack: () => void;
  readonly onOpenServer: (serverId: string, tab: 'dcui' | 'overview') => void;
  readonly onOpenSwitch: (switchId: string) => void;
  readonly reducedMotion: () => boolean;
}

export interface HostDetail {
  update(snap: SandboxSnapshot, structural: boolean): void;
  escape(): boolean;
  dispose(): void;
}

const CLASS_STYLE: Readonly<Record<Exclude<FlowTrafficClass, 'oob'>, { label: string; css: string; glyph: string }>> = {
  management: { label: TRAFFIC_STYLE.management.label, css: TRAFFIC_STYLE.management.css, glyph: DOT_GLYPH.management },
  vmotion: { label: TRAFFIC_STYLE.vmotion.label, css: TRAFFIC_STYLE.vmotion.css, glyph: DOT_GLYPH.vmotion },
  vsan: { label: TRAFFIC_STYLE.vsan.label, css: TRAFFIC_STYLE.vsan.css, glyph: DOT_GLYPH.vsan },
  nfs: { label: TRAFFIC_STYLE.nfs.label, css: TRAFFIC_STYLE.nfs.css, glyph: DOT_GLYPH.nfs },
  overlay: { label: TRAFFIC_STYLE.overlay.label, css: TRAFFIC_STYLE.overlay.css, glyph: DOT_GLYPH.overlay },
};

const pct = (u: number): string => (u > 0 && u < 0.01 ? '< 1 %' : `${Math.round(u * 100)} %`);

export function createHostDetail(o: HostDetailOptions): HostDetail {
  const { ops } = o;
  let snap = ops.snapshot();
  let result: ResultNote | null = null;
  let showTable = false;
  const mtuDraft = new Map<string, string>();
  const root = h('section', { class: 'host-detail', role: 'region', 'aria-label': `Síť hosta ${o.hostId}` });
  o.ui.appendChild(root);

  const run = (cmd: Parameters<SessionOps['dispatch']>[0], okText: string): void => {
    const r = ops.dispatch(cmd);
    result = r.ok ? { ok: true, text: okText } : { ok: false, text: r.message, ...(r.issues ? { issues: r.issues } : {}) };
    o.announce(r.ok ? okText : `Nelze: ${r.message}`, !r.ok);
    render();
  };

  function mtuInput(key: string, value: number | undefined, label: string, apply: (mtu: number) => void, short: boolean): HTMLElement {
    const inp = h('input', { type: 'text', inputmode: 'numeric', class: `op-num mtu-in${short ? ' short' : ''}`, value: mtuDraft.get(key) ?? (value !== undefined ? String(value) : ''), 'aria-label': `MTU ${label}`, 'data-fk': `mtu-${key}` });
    inp.addEventListener('input', () => mtuDraft.set(key, inp.value));
    inp.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const n = intOf(inp.value);
      if (n === undefined) {
        result = { ok: false, text: 'MTU musí být celé číslo.' };
        return render();
      }
      mtuDraft.delete(key);
      apply(n);
    });
    inp.addEventListener('change', () => {
      const n = intOf(inp.value);
      if (n === undefined || n === value) return;
      mtuDraft.delete(key);
      apply(n);
    });
    return inp;
  }

  function dots(c: VmnicCard): HTMLElement {
    const lane = h('div', { class: 'hd-lane', 'aria-hidden': 'true' });
    if (!c.linkUp) return lane;
    const classes = (Object.keys(c.loadByClass) as FlowTrafficClass[]).filter((k): k is Exclude<FlowTrafficClass, 'oob'> => k !== 'oob' && (c.loadByClass[k] ?? 0) > 0);
    classes.forEach((k, ci) => {
      const gbps = c.loadByClass[k] ?? 0;
      const n = Math.min(3, 1 + Math.floor(Math.log10(1 + gbps * 100)));
      const dur = Math.max(0.9, 2.6 - Math.log10(1 + gbps * 10));
      for (let i = 0; i < n; i++) {
        const st = CLASS_STYLE[k];
        lane.append(h('span', { class: 'hd-dot', style: `color:${st.css};left:${14 + ci * 22}px;animation-duration:${dur.toFixed(2)}s;animation-delay:${(-(i / n) * dur).toFixed(2)}s` }, st.glyph));
      }
    });
    return lane;
  }

  function render(): void {
    const fk = focusKey(root);
    const srv = snap.physical.servers.find((x) => x.id === o.hostId);
    const bands = hostNetBands(snap, o.hostId);
    root.classList.toggle('reduced', o.reducedMotion());
    if (!srv || !bands) {
      root.replaceChildren(h('div', { class: 'hd-bar' }, button('← Rack', () => o.onBack(), { class: 'btn btn-small' })), h('p', null, `Host ${o.hostId} neexistuje.`));
      return;
    }
    const name = srv.esx.network?.hostnameFqdn ?? srv.id;
    const online = srv.status === 'esx-dhcp' || srv.status === 'esx-static';
    const status = online ? `● ESX online · ${srv.mgmt.staticIp ? 'statická IP' : 'DHCP'}` : srv.status === 'installing' ? '◐ instaluje se ESX' : '■ bez OS';
    const bar = h('div', { class: 'hd-bar', role: 'toolbar', 'aria-label': 'Detail hosta' },
      button(`← Rack ${o.rackId}`, () => o.onBack(), { class: 'btn btn-small', title: 'Zpět (Esc)', 'data-fk': 'back' }),
      h('strong', null, `${name} · síť hosta`),
      h('span', { class: 'muted' }, status),
      h('span', { class: 'hd-spacer' }),
      button(showTable ? 'Karty' : 'Tabulka', () => {
        showTable = !showTable;
        render();
      }, { class: 'btn btn-small', 'aria-pressed': String(showTable), 'data-fk': 'table' }),
      button('Konfigurovat síť (DCUI)', () => o.onOpenServer(srv.id, 'dcui'), { class: 'btn btn-small btn-primary', 'data-fk': 'dcui' }),
    );
    if (!online && !srv.hostNet) {
      root.replaceChildren(bar, h('div', { class: 'hd-empty' },
        h('p', null, 'Síť hosta (VMkernel, vSwitch0, vmnic) vzniká instalací ESX.'),
        h('ul', { class: 'op-plain' }, ...srv.nicPorts.map((n) => h('li', null, `${n.label}: ${n.peerLabel ? `→ ${n.peerLabel}` : 'bez kabelu'}`))),
        button('Otevřít panel serveru', () => o.onOpenServer(srv.id, 'overview'), { class: 'btn btn-small' })));
      restoreFocus(root, fk);
      return;
    }
    // Band 1 – VMkernel
    const vmkBand = h('div', { class: 'hd-band hd-vmk' }, h('div', { class: 'hd-band-title' }, 'PROVOZ (VMkernel)'),
      h('div', { class: 'hd-row' }, ...bands.vmks.map((b) => {
        const st = CLASS_STYLE[b.cls as Exclude<FlowTrafficClass, 'oob'>];
        const v = b.vmk;
        return h('div', { class: `hd-box${v ? '' : ' off'}`, style: `--c:${st.css}` },
          h('div', { class: 'hd-box-title' }, h('span', { class: 'tglyph', style: `color:${st.css}`, 'aria-hidden': 'true' }, st.glyph), ' ', b.label),
          v
            ? h('div', { class: 'hd-box-body' },
                h('div', null, h('strong', null, v.name), ` · ${v.switchName}`),
                h('div', null, v.ipv4 ? `${v.ipv4}` : v.addressing === 'dhcp' ? 'DHCP' : '–'),
                h('div', null, v.tag !== null ? `VLAN ${v.tag}` : 'bez VLAN ID'),
                h('div', { class: 'hd-mtu' }, 'MTU ', mtuInput(`vmk-${v.name}`, v.mtu, v.name, (m) => run({ type: 'setVmkMtu', serverId: srv.id, vmk: v.name, mtu: m }, `MTU ${v.name} = ${m}.`), false),
                  v.name === 'vmk0' && v.mtu === ESX_INSTALL_DEFAULTS.vmk0Mtu.value ? badge('documented', ESX_INSTALL_DEFAULTS.vmk0Mtu.specRef) : null),
              )
            : h('div', { class: 'hd-box-body muted' }, 'nenastaveno'),
        );
      })));
    // Band 2 – virtual switches
    const swBand = h('div', { class: 'hd-band hd-vs' },
      ...bands.switches.map((w) => h('div', { class: 'hd-vswitch' },
        h('strong', null, w.name), ` (${w.kind === 'vss' ? 'Standard' : 'Distributed'}) · uplinky: ${w.uplinks.map((u) => `vmnic${u}`).join(', ') || '–'}${w.virtualUplinks?.length ? ` + ${w.virtualUplinks.join(', ')}` : ''} · MTU `,
        mtuInput(`vs-${w.name}`, w.mtu, w.name, (m) => run({ type: 'setHostSwitchMtu', serverId: srv.id, switchName: w.name, mtu: m }, `MTU ${w.name} = ${m}.`), false),
        w.name === ESX_INSTALL_DEFAULTS.standardSwitchName.value && w.mtu === ESX_INSTALL_DEFAULTS.vswitch0Mtu.value ? badge('game-default', ESX_INSTALL_DEFAULTS.vswitch0Mtu.specRef) : null,
      )),
    );
    // Band 3 – vmnic cards
    const vss0 = bands.switches.find((w) => w.name === ESX_INSTALL_DEFAULTS.standardSwitchName.value);
    const cards = h('div', { class: 'hd-band hd-nics' }, h('div', { class: 'hd-band-title' }, 'FYZICKÉ NIC (vmnic)'),
      h('div', { class: 'hd-row' }, ...bands.cards.map((c) => {
        const band = loadBand(c.utilization);
        const used = c.utilization > 0;
        const chk = h('input', { type: 'checkbox', 'aria-label': `${c.label} jako uplink vSwitch0`, 'data-fk': `upl-${c.vmnic}`, ...(vss0?.uplinks.includes(c.vmnic) ? { checked: true } : {}), ...(vss0 ? {} : { disabled: true }) });
        chk.addEventListener('change', () => {
          if (!vss0) return;
          const next = chk.checked ? [...vss0.uplinks, c.vmnic] : vss0.uplinks.filter((x) => x !== c.vmnic);
          run({ type: 'setHostUplinks', serverId: srv.id, vmnics: [...new Set(next)].sort((a, b) => a - b) }, `Uplinky vSwitch0: ${next.map((x) => `vmnic${x}`).join(', ') || 'žádné'}.`);
        });
        const p = c.port;
        return h('div', { class: `hd-card${c.vswitch ? ' on-vs' : ''}` },
          dots(c),
          h('div', { class: 'hd-card-head' }, h('strong', null, c.label), ' ', c.cabled ? (c.linkUp ? h('span', { class: 'led up', title: 'link up' }, '● up') : h('span', { class: 'led down', title: 'link nenaběhl' }, '▲ down')) : h('span', { class: 'led off' }, '○ bez kabelu')),
          h('div', null, `${c.speedGbE ?? Math.max(0, ...c.speedsGbE)} GbE`),
          h('div', { class: 'hd-load' },
            h('div', { class: `hd-load-bar ${band}`, style: `width:${Math.min(100, Math.max(used ? 3 : 0, c.utilization * 100))}%` }),
          ),
          h('div', { class: 'small' }, c.linkUp ? (used ? pct(c.utilization) : 'nevyužito') : '–'),
          h('label', { class: 'small hd-upl' }, chk, ' uplink vSwitch0'),
          c.mtuChain.length
            ? h('div', { class: 'hd-chain', 'aria-label': 'Řetěz MTU' }, ...c.mtuChain.flatMap((l, i) => [
                i ? h('span', { 'aria-hidden': 'true' }, ' → ') : null,
                h('span', { class: `hd-link${l.short ? ' short' : ''}`, title: l.short ? 'článek je menší než MTU VMkernelu' : '' }, `${l.short ? '⚠ ' : ''}${l.label} ${l.mtu ?? '?'}`),
              ]).filter((x): x is HTMLElement => !!x))
            : null,
          h('div', { class: 'hd-port' },
            p
              ? h('div', null,
                  h('div', null, `→ ${p.switchLabel} p${p.index + 1}`),
                  h('div', { class: 'small' }, p.view.config.mode === 'trunk' ? `trunk · VLAN ${formatVlanList(p.view.config.allowedVlans)} · native ${p.view.config.nativeVlan}` : `access · VLAN ${p.view.config.accessVlan}`),
                  h('div', { class: 'small hd-mtu' }, 'port MTU ', mtuInput(`port-${p.switchId}-${p.index}`, p.view.config.mtu, `${p.switchLabel} p${p.index + 1}`, (m) => run({ type: 'setSwitchPort', switchId: p.switchId, port: p.index, config: { mtu: m } }, `MTU ${p.switchLabel} p${p.index + 1} = ${m}.`), c.mtuChain[2]?.short === true)),
                  button('Otevřít switch', () => o.onOpenSwitch(p.switchId), { class: 'btn btn-small', 'data-fk': `sw-${c.vmnic}` }),
                )
              : h('div', { class: 'muted small' }, c.peerLabel ? `→ ${c.peerLabel}` : 'bez kabelu'),
          ),
        );
      })));
    const bmc = h('div', { class: 'hd-bmc' }, `BMC (${bands.bmc.label}): ${bands.bmc.peerLabel ? `zapojeno do ${bands.bmc.peerLabel}` : 'nezapojeno'}${bands.bmc.ip ? ` · vlastní IP ${bands.bmc.ip}` : ''} · není vmnic, ESX ho nevidí jako síťovou kartu `, badge('out-of-scope', '25 §10.1 [U55]'));
    const legendClasses = (Object.keys(CLASS_STYLE) as (keyof typeof CLASS_STYLE)[]).filter((k) => bands.cards.some((c) => (c.loadByClass[k] ?? 0) > 0));
    const legend = h('div', { class: 'hd-legend' },
      'Provoz: ', ...(legendClasses.length ? legendClasses.map((k) => h('span', { class: 'hd-leg' }, h('span', { style: `color:${CLASS_STYLE[k].css}`, class: 'tglyph', 'aria-hidden': 'true' }, CLASS_STYLE[k].glyph), ` ${CLASS_STYLE[k].label}`)) : [h('span', { class: 'muted' }, 'zatím žádný')]),
      ' · vytížení a tečky ', badge('illustrative', snap.flows.note),
    );
    const table = h('table', { class: 'op-table hd-table' },
      h('caption', null, 'Síť hosta – tabulka'),
      h('thead', null, h('tr', null, ...['vmnic', 'link', 'rychlost', 'vSwitch', 'vytížení (ilustr.)', 'provoz', 'port switche', 'MTU řetěz'].map((x) => h('th', null, x)))),
      h('tbody', null, ...bands.cards.map((c) => h('tr', null,
        h('td', null, c.label),
        h('td', null, c.cabled ? (c.linkUp ? 'up' : 'down') : 'bez kabelu'),
        h('td', null, `${c.speedGbE ?? '–'} GbE`),
        h('td', null, c.vswitch ?? '–'),
        h('td', null, c.linkUp ? pct(c.utilization) : '–'),
        h('td', null, Object.entries(c.loadByClass).filter(([, g]) => (g ?? 0) > 0).map(([k, g]) => `${k} ${(g ?? 0).toFixed(3)} Gb/s`).join(', ') || '–'),
        h('td', null, c.port ? `${c.port.switchLabel} p${c.port.index + 1} · ${c.port.view.config.mode} · MTU ${c.port.view.config.mtu}` : c.peerLabel ?? '–'),
        h('td', null, c.mtuChain.map((l) => `${l.short ? '⚠ ' : ''}${l.label} ${l.mtu ?? '?'}`).join(' → ') || '–'),
      ))),
    );
    const topo = [...srv.topology.errors, ...srv.topology.warnings, ...srv.topology.recommendations];
    const note = resultNote(result);
    root.replaceChildren(
      bar,
      ...(note ? [note] : []),
      h('div', { class: 'hd-scroll' },
        showTable ? table : h('div', { class: 'hd-bands' }, vmkBand, h('div', { class: 'hd-wire', 'aria-hidden': 'true' }), swBand, h('div', { class: 'hd-wire', 'aria-hidden': 'true' }), cards),
        bmc,
        legend,
        h('p', { class: 'small muted' }, `vmnic${ESX_INSTALL_DEFAULTS.managementUplink.value} = výchozí management NIC po instalaci ESX `, badge('documented', ESX_INSTALL_DEFAULTS.managementUplink.specRef), ' · MTU měníš přímo v polích (Enter).'),
        h('h4', null, `Hlášení modelu (${topo.length})`),
        issueList(topo, '✓ Model nehlásí problém se zapojením.'),
      ),
    );
    restoreFocus(root, fk);
  }

  render();
  return {
    update(next, structural) {
      snap = next;
      if (structural) render();
    },
    escape() {
      if (showTable) {
        showTable = false;
        render();
        return true;
      }
      return false;
    },
    dispose() {
      root.remove();
    },
  };
}
