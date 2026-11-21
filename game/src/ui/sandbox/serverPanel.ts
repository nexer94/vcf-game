/**
 * Server panel (UX §2.6, §15): status, hardware summary with REQ / DEV / RCMD findings, hardware editor (before
 * ESX), ESX installation (at the server / remotely via BMC), DCUI console form (management network, test), NTP / SSH /
 * certificate, BMC settings (out of VCF scope – game).
 *
 * Every decision is the engine's: the panel dispatches commands and shows the model's issues unchanged.
 * Prefilled values carry their provenance (documented vs game default).
 */
import { ESX_INSTALL_DEFAULTS, type ServerConfig } from '../../model';
import type { ServerView } from '../../modes/sandbox/roomView';
import type { SandboxSnapshot } from '../../modes/sandbox/snapshot';
import { button, docLink, h } from '../dom';
import { badge, chip, message } from '../messages';
import {
  type DcuiDraft,
  type DcuiSources,
  type ServerTab,
  HW_CLASS_TITLE,
  dcuiPrefill,
  findingMessageType,
  intOf,
  serverTaskOf,
  splitList,
} from './panelData';
import { fieldRow, focusKey, issueList, provenanceBadge, restoreFocus, resultNote, tabs, taskBar, textInput, updateTaskBars, type ResultNote } from './panelKit';
import type { PortResult, SessionOps } from './sessionPort';

/** Documented warning about remote installation (25 §10.4.1 [U67], vSphere 9.1 "Using Remote Management Applications"). */
const VIRTUAL_CD_WARNING = {
  quote: 'the virtual CD might encounter corruption problems with systems or networks operating at peak capacity',
  paraphrase: 'Když instalace z virtuálního CD selže, dokonči ji z fyzického média.',
  specRef: '25 §10.4.1 [U67]',
  url: 'https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/esx-installation-and-setup/installing-and-setting-up-esxi/esxi-requirements/using-remote-management-applications.html',
} as const;

/** "switches utilized for out-of-band connectivity to the ESX host are out of scope" (25 §10.1 [U55]). */
const BMC_SCOPE = {
  quote: 'switches utilized for out-of-band connectivity to the ESX host are out of scope',
  specRef: '25 §10.1 [U55]',
  url: 'https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/datacenter-network-requirements/physical-datacenter-design-9-x.html',
} as const;

const STATUS_TEXT: Readonly<Record<ServerView['status'], string>> = {
  unmounted: '■ v batohu (nezarackovaný)',
  'no-os': '■ bez OS',
  installing: '◐ instaluje se ESX…',
  'esx-dhcp': '● ESX běží · management přes DHCP',
  'esx-static': '● ESX běží · statická IP',
};

const TABS: readonly (readonly [ServerTab, string])[] = [
  ['overview', 'Přehled'],
  ['hardware', 'Hardware'],
  ['esx', 'ESX'],
  ['dcui', 'Síť (DCUI)'],
  ['bmc', '◇ BMC'],
];

export interface ServerPanelOptions {
  readonly ops: SessionOps;
  readonly serverId: string;
  readonly tab?: ServerTab;
  readonly announce: (text: string, bad?: boolean) => void;
  readonly onOpenHost?: (serverId: string) => void;
  readonly onOpenDns?: () => void;
  readonly onClose: () => void;
}

export interface ObjectPanel {
  readonly el: HTMLElement;
  readonly title: string;
  /** Called on every port change; `structural` = snapshot.revision changed. */
  update(snap: SandboxSnapshot, structural: boolean): void;
  dispose(): void;
}

interface PartDraft {
  partId: string;
  count: number;
}
interface HwDraft {
  ramGB: string;
  drives: PartDraft[];
  nics: PartDraft[];
}

const toResult = (r: PortResult, okText: string): ResultNote =>
  r.ok ? { ok: true, text: okText, ...(r.warnings?.length ? { issues: r.warnings } : {}) } : { ok: false, text: r.message, ...(r.issues ? { issues: r.issues } : {}) };

export function createServerPanel(o: ServerPanelOptions): ObjectPanel & { setTab(t: ServerTab): void } {
  const { ops } = o;
  let tab: ServerTab = o.tab ?? 'overview';
  let snap = ops.snapshot();
  let result: ResultNote | null = null;
  let hwEdit: HwDraft | null = null;
  let method: 'physical' | 'bmc' = 'physical';
  let dcui: { draft: DcuiDraft; sources: DcuiSources; forRevisionOfNet: string } | null = null;
  let ntpDraft: string | null = null;
  let bmcDraft: { ip: string; vlan: string } | null = null;

  const body = h('div', { class: 'op-body' });
  const el = h('section', { class: 'op-panel op-server', role: 'dialog', 'aria-label': `Server ${o.serverId}` });
  const srv = (): ServerView | undefined => snap.physical.servers.find((x) => x.id === o.serverId);

  const run = (cmd: Parameters<SessionOps['dispatch']>[0], okText: string): boolean => {
    const r = ops.dispatch(cmd);
    result = toResult(r, okText);
    o.announce(r.ok ? okText : `Nelze: ${r.message}`, !r.ok);
    render();
    return r.ok;
  };

  function header(v: ServerView): HTMLElement {
    const name = v.esx.network?.hostnameFqdn ?? v.id;
    return h('div', { class: 'op-head' },
      h('div', { class: 'op-title' },
        h('strong', null, name),
        h('span', { class: 'muted' }, ` · ${v.modelName}`),
        h('div', { class: `op-status st-${v.status}` }, STATUS_TEXT[v.status]),
      ),
      button('✖', () => o.onClose(), { class: 'btn btn-small', 'aria-label': 'Zavřít panel (Esc)', title: 'Zavřít (Esc)', 'data-fk': 'close' }),
    );
  }

  // ------------------------------------------------------------------ tabs
  function overview(v: ServerView): HTMLElement[] {
    const t = serverTaskOf(snap, v.id);
    const m = v.metrics;
    const out: HTMLElement[] = [];
    if (t) out.push(taskBar(t));
    out.push(
      h('dl', { class: 'op-dl' },
        h('dt', null, 'Umístění'), h('dd', null, v.mount ? `${v.mount.rackId} · U${v.mount.positionU}` : 'v batohu'),
        h('dt', null, 'Hardware'), h('dd', null, m ? `${m.cores} jader · ${m.ramGB} GB RAM · ${m.driveCount} disků (${m.nodeCapacityTB} TB) · ${m.nicPorts}× NIC port` : 'neúplná konfigurace'),
        h('dt', null, 'ESX'), h('dd', null, v.esx.esxVersion ?? 'nenainstalováno'),
        h('dt', null, 'Management'), h('dd', null, v.mgmt.ipv4 ? `${v.mgmt.ipv4}${v.mgmt.vlan !== undefined ? ` · VLAN ${v.mgmt.vlan}` : ' · bez VLAN ID'}` : v.status === 'esx-dhcp' ? 'DHCP (zatím bez statické IP)' : '–'),
        h('dt', null, 'Dosažitelnost'), h('dd', null, v.mgmt.gatewayReachable === undefined ? '–' : `gateway ${v.mgmt.gatewayReachable ? '✓' : '✖'} · DNS ${Object.entries(v.mgmt.dnsReachable ?? {}).map(([k, ok]) => `${k} ${ok ? '✓' : '✖'}`).join(', ') || '–'}`),
        h('dt', null, 'BMC'), h('dd', null, `${v.bmc.label} · ${v.bmc.cabled ? 'zapojeno' : 'nezapojeno'}${v.bmc.ipv4 ? ` · ${v.bmc.ipv4}` : ''} `, badge('out-of-scope', BMC_SCOPE.specRef)),
        h('dt', null, 'Cena'), h('dd', null, `¤ ${v.price.toLocaleString('cs-CZ')} `, badge('game-price')),
      ),
    );
    const topo = [...v.topology.errors, ...v.topology.warnings, ...v.topology.recommendations];
    out.push(h('h4', null, `Síť a kabeláž (${topo.length})`), issueList(topo, v.mount ? '✓ Model nehlásí problém se zapojením.' : 'Server není v racku.'));
    const actions = h('div', { class: 'op-actions' });
    if (v.mount && o.onOpenHost) actions.append(button('Detail sítě hosta (karty vmnic)', () => o.onOpenHost!(v.id), { class: 'btn btn-small', 'data-fk': 'open-host' }));
    if (v.status === 'no-os' && v.mount) actions.append(button('Instalovat ESX 9 →', () => setTab('esx'), { class: 'btn btn-small btn-primary', 'data-fk': 'go-esx' }));
    if (v.status === 'esx-dhcp' || v.status === 'esx-static') actions.append(button('Síť v DCUI →', () => setTab('dcui'), { class: 'btn btn-small btn-primary', 'data-fk': 'go-dcui' }));
    out.push(actions);
    return out;
  }

  function hardware(v: ServerView): HTMLElement[] {
    const cat = snap.physical.catalog;
    const model = cat.serverModels.find((x) => x.id === v.modelId);
    const partLabel = (id: string): string => {
      const it = cat.items.find((x) => x.id === id);
      return it?.kind === 'drive' ? `${it.part.family} · ${it.part.interface} · ${it.part.capacityTB} TB` : it?.kind === 'nic' ? `${it.part.bomName} (${it.part.ports}× ${it.part.speedsGbE.join('/')} GbE)` : id;
    };
    const c = v.config;
    const out: HTMLElement[] = [
      h('dl', { class: 'op-dl' },
        h('dt', null, 'Model'), h('dd', null, `${v.modelName} `, v.bcgUrl ? docLink('BCG', v.bcgUrl) : null, ' ', v.certified91 ? chip('BCG: ESXi 9.1', 'badge-game-default', 'Broadcom Compatibility Guide uvádí ESXi 9.1 (vSAN 9.1) jako podporovaný release') : chip('BCG: bez 9.1', 'badge-warn')),
        h('dt', null, 'CPU'), h('dd', null, `${c.sockets}× socket · ${c.sockets * c.coresPerSocket} jader`),
        h('dt', null, 'RAM'), h('dd', null, `${c.ramGB} GB${model ? ` (max ${model.maxMemoryGB} GB)` : ''}`),
        h('dt', null, 'Disky'), h('dd', null, c.drives.length ? h('ul', { class: 'op-plain' }, ...c.drives.map((d) => h('li', null, `${d.count}× ${partLabel(d.partId)}`))) : 'žádné'),
        h('dt', null, 'NIC'), h('dd', null, c.nics.length ? h('ul', { class: 'op-plain' }, ...c.nics.map((d) => h('li', null, `${d.count}× ${partLabel(d.partId)}`))) : 'žádné'),
        h('dt', null, 'Boot'), h('dd', null, c.boot.description),
        h('dt', null, 'vSAN ESA profil'), h('dd', null, v.hw.esaProfile ? `${v.hw.esaProfile.profile ?? 'pod HCI-SM'}${v.hw.esaProfile.networkLimited ? ' (omezeno sítí)' : ''}` : '–'),
      ),
    ];
    const storage = v.hw.storage ? `pro zvolené úložiště ${v.hw.storage}` : 'obecné požadavky na host (úložiště v návrhu zatím nezvoleno)';
    out.push(h('h4', null, `Nálezy hardwaru – ${storage}`));
    const f = v.hw.findings;
    if (!f.length) out.push(h('p', { class: 'ok-line' }, '✓ Model nehlásí žádný nález.'));
    for (const cls of ['REQ', 'DEV', 'RCMD'] as const)
      for (const x of v.hw.byClass[cls])
        out.push(message({ type: findingMessageType(x), compact: true, title: HW_CLASS_TITLE[cls], body: x.message, bodyLang: 'en', reference: `${x.specRef} · ${x.code}${x.documentationConflict ? ` · rozpor zdrojů: ${x.documentationConflict.refs.join(', ')}` : ''}` }));
    // Editor
    if (v.esx.esxVersion !== undefined) {
      out.push(message({ type: 'game-tip', compact: true, title: 'Hardware se mění před instalací ESX', body: 'V Sandboxu jde konfiguraci upravit jen na serveru bez ESX (herní pravidlo).' }));
      return out;
    }
    if (!hwEdit) {
      out.push(h('div', { class: 'op-actions' }, button('Upravit konfiguraci', () => {
        hwEdit = { ramGB: String(c.ramGB), drives: c.drives.map((d) => ({ ...d })), nics: c.nics.map((d) => ({ ...d })) };
        result = null;
        render();
      }, { class: 'btn btn-small btn-primary', 'data-fk': 'hw-edit' })));
      return out;
    }
    out.push(hwEditor(v));
    return out;
  }

  function partSelect(kind: 'drive' | 'nic', value: string, fk: string, onChange: (id: string) => void, vendor: string | undefined): HTMLSelectElement {
    const items = snap.physical.catalog.items.filter((x) => x.kind === kind);
    const sel = h('select', { 'data-fk': fk, 'aria-label': kind === 'drive' ? 'Typ disku' : 'Typ NIC' });
    const groups = new Map<string, HTMLOptGroupElement>();
    const sorted = [...items].sort((a, b) => {
      const oa = a.kind === 'drive' ? a.part.oem : '';
      const ob = b.kind === 'drive' ? b.part.oem : '';
      return (oa === vendor ? 0 : 1) - (ob === vendor ? 0 : 1) || oa.localeCompare(ob) || a.label.localeCompare(b.label);
    });
    for (const it of sorted) {
      const g = it.kind === 'drive' ? `${it.part.oem}` : 'NIC';
      let og = groups.get(g);
      if (!og) {
        og = h('optgroup', { label: g });
        groups.set(g, og);
        sel.append(og);
      }
      const label = it.kind === 'drive' ? `${it.part.family} · ${it.part.interface} · ${it.part.capacityTB} TB` : it.kind === 'nic' ? `${it.part.bomName} · ${it.part.ports}× ${it.part.speedsGbE.join('/')} GbE` : it.label;
      og.append(h('option', { value: it.id, ...(it.id === value ? { selected: true } : {}) }, label));
    }
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  }

  function hwEditor(v: ServerView): HTMLElement {
    const d = hwEdit!;
    const rows = (kind: 'drive' | 'nic', list: PartDraft[]): HTMLElement => {
      const box = h('div', { class: 'op-parts' });
      list.forEach((p, i) => {
        const cnt = h('input', { type: 'number', min: '0', max: '64', value: String(p.count), 'data-fk': `${kind}-cnt-${i}`, 'aria-label': 'Počet kusů', class: 'op-num' });
        cnt.addEventListener('input', () => (p.count = Math.max(0, Number(cnt.value) || 0)));
        box.append(h('div', { class: 'op-part-row' },
          cnt, ' × ',
          partSelect(kind, p.partId, `${kind}-part-${i}`, (id) => (p.partId = id), v.vendor),
          button('✖', () => {
            list.splice(i, 1);
            render();
          }, { class: 'btn btn-small', 'aria-label': 'Odebrat řádek', 'data-fk': `${kind}-del-${i}` }),
        ));
      });
      box.append(button(kind === 'drive' ? '+ disk' : '+ NIC', () => {
        const first = snap.physical.catalog.items.find((x) => x.kind === kind && (kind !== 'drive' || (x.kind === 'drive' && x.part.oem === v.vendor))) ?? snap.physical.catalog.items.find((x) => x.kind === kind);
        if (first) list.push({ partId: first.id, count: 1 });
        render();
      }, { class: 'btn btn-small', 'data-fk': `${kind}-add` }));
      return box;
    };
    const ram = textInput(d.ramGB, 'hw-ram', (x) => (d.ramGB = x), { inputmode: 'numeric', class: 'op-num' });
    return h('div', { class: 'op-editor' },
      h('h4', null, 'Upravit konfiguraci ', badge('game-price', 'díly navíc se dokoupí, odebrané jdou do batohu')),
      fieldRow('RAM (GB)', ram),
      h('div', { class: 'op-sub' }, 'Disky'), rows('drive', d.drives),
      h('div', { class: 'op-sub' }, 'NIC'), rows('nic', d.nics),
      message({ type: 'game-tip', compact: true, body: 'Co je povolené, rozhodne model podle katalogu z BCG – po uložení uvidíš nálezy REQ / DEV / RCMD.' }),
      h('div', { class: 'op-actions' },
        button('Uložit konfiguraci', () => {
          const ramGB = intOf(d.ramGB);
          if (ramGB === undefined) {
            result = { ok: false, text: 'RAM musí být celé číslo (GB).' };
            return render();
          }
          const config: ServerConfig = { ...v.config, ramGB, drives: d.drives.filter((x) => x.count > 0).map((x) => ({ ...x })), nics: d.nics.filter((x) => x.count > 0).map((x) => ({ ...x })) };
          if (run({ type: 'configureServer', serverId: v.id, config }, 'Konfigurace serveru uložena.')) {
            hwEdit = null;
            render();
          }
        }, { class: 'btn btn-small btn-primary', 'data-fk': 'hw-save' }),
        button('Zrušit', () => {
          hwEdit = null;
          result = null;
          render();
        }, { class: 'btn btn-small', 'data-fk': 'hw-cancel' }),
      ),
    );
  }

  function esx(v: ServerView): HTMLElement[] {
    const t = serverTaskOf(snap, v.id);
    if (t && t.kind === 'esx-install') return [taskBar(t), h('p', { class: 'muted small' }, 'Kroky instalace jsou v obou cestách stejné (20-deployment §4.1.1). Po dokončení dostanou porty jména vmnic.')];
    if (v.esx.esxVersion !== undefined)
      return [
        h('p', null, '✓ ESX nainstalován: ', h('strong', null, v.esx.esxVersion)),
        h('dl', { class: 'op-dl' },
          h('dt', null, 'Standard switch'), h('dd', null, ESX_INSTALL_DEFAULTS.standardSwitchName.value, ' ', badge('documented', ESX_INSTALL_DEFAULTS.standardSwitchName.specRef)),
          h('dt', null, 'Management NIC'), h('dd', null, `vmnic${ESX_INSTALL_DEFAULTS.managementUplink.value} `, badge('documented', ESX_INSTALL_DEFAULTS.managementUplink.specRef)),
          h('dt', null, 'Adresa vmk0'), h('dd', null, `${v.mgmt.staticIp ? 'statická' : 'DHCP'} `, v.mgmt.staticIp ? null : badge('documented', ESX_INSTALL_DEFAULTS.managementAddressing.specRef)),
        ),
        h('div', { class: 'op-actions' }, button('Nastavit síť v DCUI →', () => setTab('dcui'), { class: 'btn btn-small btn-primary', 'data-fk': 'go-dcui' })),
      ];
    if (!v.mount) return [message({ type: 'game-tip', compact: true, body: 'Server nejdřív zarackuj – instalace probíhá na serveru v racku.' })];
    const bmcOk = v.bmc.remoteInstallDocumented && v.bmc.reachableFromAdmin;
    if (method === 'bmc' && !bmcOk) method = 'physical';
    const radio = (id: 'physical' | 'bmc', label: string, disabled: boolean, extra: (Node | null)[]): HTMLElement => {
      const r = h('input', { type: 'radio', name: `esx-method-${v.id}`, value: id, id: `esx-m-${id}-${v.id}`, 'data-fk': `m-${id}`, ...(method === id ? { checked: true } : {}), ...(disabled ? { disabled: true } : {}) });
      r.addEventListener('change', () => {
        method = id;
        render();
      });
      return h('div', { class: `op-radio${disabled ? ' disabled' : ''}` }, r, h('label', { for: r.id }, label), ...extra.filter((x): x is Node => !!x));
    };
    const bmcReason = !v.bmc.remoteInstallDocumented
      ? `Dokumentace pro ${v.bmc.label} vzdálenou instalaci ESX neuvádí (${v.bmc.remoteInstallRef}).`
      : !v.bmc.reachableFromAdmin
        ? `${v.bmc.label} není připravený: zapoj BMC port, nastav IP a připoj switch do sítě firmy (počítač admina).`
        : null;
    return [
      h('h4', null, 'Jak nainstalovat ESX 9?'),
      radio('physical', 'U serveru – fyzické médium', false, [h('span', { class: 'muted small' }, ' (vždy dostupné)')]),
      radio('bmc', 'Vzdáleně přes BMC – virtual media', !bmcOk, [
        document.createTextNode(' '), badge('out-of-scope', BMC_SCOPE.specRef),
        bmcReason ? h('div', { class: 'op-hint' }, '⛔ ', bmcReason, !v.bmc.remoteInstallDocumented ? null : button('Nastavit BMC', () => setTab('bmc'), { class: 'btn btn-small', 'data-fk': 'go-bmc' })) : null,
      ]),
      method === 'bmc'
        ? message({
            type: 'vcf-warning',
            compact: true,
            title: 'Varování dokumentace (vSphere)',
            body: [h('q', { lang: 'en' }, VIRTUAL_CD_WARNING.quote), h('div', null, VIRTUAL_CD_WARNING.paraphrase, ' ', badge('paraphrase'))],
            reference: VIRTUAL_CD_WARNING.specRef,
            actions: [docLink('Proč?', VIRTUAL_CD_WARNING.url)],
          })
        : null,
      h('p', { class: 'muted small' }, 'Kroky instalace jsou v obou cestách stejné (20-deployment §4.1.1). Pořadí „BMC → virtual media → instalace → DCUI“ je ', badge('game-simplification', '25 §10.4.1'), '.'),
      h('div', { class: 'op-actions' },
        button('Instalovat ESX 9', () => run({ type: 'installEsx', serverId: v.id, method }, `Instalace ESX na ${v.id} začala.`), { class: 'btn btn-primary', 'data-fk': 'esx-install' }),
        h('span', { class: 'muted small' }, 'trvání ', badge('illustrative')),
      ),
    ].filter((x): x is HTMLElement => !!x);
  }

  function dcuiTab(v: ServerView): HTMLElement[] {
    if (v.esx.esxVersion === undefined || !v.hostNet) {
      const it = serverTaskOf(snap, v.id);
      return [...(it ? [taskBar(it)] : []), message({ type: 'game-tip', compact: true, title: 'Nejdřív ESX', body: 'DCUI (konzole hosta) je k dispozici po instalaci ESX.', actions: [button('Instalovat ESX →', () => setTab('esx'), { class: 'btn btn-small', 'data-fk': 'go-esx' })] })];
    }
    const netKey = JSON.stringify(v.esx.network ?? null);
    if (!dcui || dcui.forRevisionOfNet !== netKey) dcui = { ...dcuiPrefill(snap, v.id), forRevisionOfNet: netKey };
    const d = dcui.draft;
    const src = dcui.sources;
    const field = (label: string, key: keyof DcuiDraft, hint?: string): HTMLElement => {
      const i = textInput(d[key], `dcui-${key}`, (x) => (d[key] = x), { class: 'dcui-input' });
      return fieldRow(label, i, [provenanceBadge(src[key])], hint);
    };
    const t = serverTaskOf(snap, v.id);
    const test = v.mgmt.lastTest;
    const prep = snap.planning.hosts.find((x) => x.host.id === v.id);
    const save = (): void => {
      const vlanTxt = d.vlan.trim();
      const vlan = vlanTxt === '' ? null : intOf(vlanTxt);
      if (vlan === undefined) {
        result = { ok: false, text: 'VLAN ID musí být číslo (nebo prázdné = bez VLAN ID).' };
        return render();
      }
      run({
        type: 'configureMgmtNetwork',
        serverId: v.id,
        hostname: d.hostname.trim(),
        ip: d.ip.trim(),
        mask: d.mask.trim(),
        gw: d.gw.trim(),
        vlan,
        dns: [d.dns1, d.dns2].map((x) => x.trim()).filter(Boolean),
        customDnsSuffixes: splitList(d.suffixes),
      }, `Management síť ${v.id} uložena (DCUI).`);
    };
    const form = h('form', { class: 'dcui', 'aria-label': 'DCUI – Configure Management Network' },
      h('div', { class: 'dcui-top' }, h('span', null, 'DCUI'), h('span', null, `${v.modelName}`), h('span', { class: 'dcui-chip' }, 'herní konzole')),
      h('div', { class: 'dcui-title', lang: 'en' }, 'Configure Management Network'),
      h('div', { class: 'dcui-adapters' }, h('span', { lang: 'en' }, 'Network Adapters: '), `vmnic${v.hostNet.switches.find((s) => s.name === 'vSwitch0')?.uplinks.join(', vmnic') ?? '–'} `, provenanceBadge({ kind: 'documented', specRef: ESX_INSTALL_DEFAULTS.managementUplink.specRef })),
      field('VLAN (optional)', 'vlan', 'prázdné = VLAN ID nenastaveno'),
      h('div', { class: 'dcui-sub', lang: 'en' }, 'IPv4 Configuration – static'),
      field('IPv4 Address', 'ip'),
      field('Subnet Mask', 'mask'),
      field('Default Gateway', 'gw'),
      h('div', { class: 'dcui-sub', lang: 'en' }, 'DNS Configuration'),
      field('Primary DNS Server', 'dns1'),
      field('Alternate DNS Server', 'dns2'),
      field('Hostname (FQDN)', 'hostname'),
      field('Custom DNS Suffixes', 'suffixes', 'oddělené čárkou'),
      h('div', { class: 'dcui-keys' },
        button('<Enter> Uložit', () => save(), { class: 'dcui-btn primary', 'data-fk': 'dcui-save' }),
        button('<Esc> Zahodit změny', () => {
          dcui = null;
          result = null;
          render();
        }, { class: 'dcui-btn', 'data-fk': 'dcui-reset' }),
      ),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      save();
    });
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
        e.preventDefault();
        save();
      }
    });
    const testBox = h('div', { class: 'dcui dcui-test' },
      h('div', { class: 'dcui-title', lang: 'en' }, 'Test Management Network'),
      t?.kind === 'mgmt-network-test' ? taskBar(t) : null,
      test
        ? h('ul', { class: 'dcui-results' },
            h('li', null, `${test.gateway ? '[ OK ]' : '[FAIL]'} ping default gateway`),
            ...Object.entries(test.dns).map(([ip, ok]) => h('li', null, `${ok ? '[ OK ]' : '[FAIL]'} DNS ${ip}`)),
          )
        : h('p', { class: 'dcui-dim' }, v.mgmt.configured ? 'Zatím netestováno.' : 'Nejdřív ulož management síť.'),
      h('div', { class: 'dcui-keys' }, button('Spustit test', () => run({ type: 'testManagementNetwork', serverId: v.id }, `Test Management Network na ${v.id} běží.`), { class: 'dcui-btn primary', 'data-fk': 'dcui-test', ...(t ? { disabled: true } : {}) })),
      h('div', { class: 'op-hint' }, 'Co test dělá: 25 §6.3 [U34]. Trvání ', badge('illustrative')),
    );
    // NTP / SSH / certificate (20-deployment §4.1.3 – §4.1.4)
    const ntpEp = snap.physical.endpoints.find((e) => e.kind === 'ntp')?.ipv4;
    if (ntpDraft === null) ntpDraft = v.esx.ntp.servers.length ? v.esx.ntp.servers.join(', ') : ntpEp ?? '';
    const ntpInput = textInput(ntpDraft, 'ntp', (x) => (ntpDraft = x));
    const certOk = prep?.steps.certificateMatchesFqdn === true;
    const more = h('div', { class: 'op-more' },
      h('h4', null, 'Další nastavení hosta'),
      fieldRow('NTP servery', ntpInput, [
        v.esx.ntp.servers.length ? null : provenanceBadge({ kind: 'game-default', ...(ntpEp ? { note: 'NTP sítě firmy (herní)' } : {}) }),
        button('Nastavit NTP', () => {
          if (run({ type: 'configureHostNtp', hostId: v.id, servers: splitList(ntpDraft ?? '') }, `NTP na ${v.id} nastaveno.`)) ntpDraft = null;
          render();
        }, { class: 'btn btn-small', 'data-fk': 'ntp-save' }),
      ], `stav: ${v.esx.ntp.enabled && v.esx.ntp.serviceRunning ? 'běží' : 'neběží'} · 20-deployment §4.1.3`),
      h('div', { class: 'op-field' }, h('span', { class: 'op-label' }, 'SSH'),
        h('div', { class: 'op-field-ctl' }, v.esx.sshEnabled ? 'zapnuto ' : 'vypnuto ',
          button(v.esx.sshEnabled ? 'Vypnout SSH' : 'Zapnout SSH', () => run({ type: 'setHostSsh', hostId: v.id, enabled: !v.esx.sshEnabled }, `SSH na ${v.id} ${v.esx.sshEnabled ? 'vypnuto' : 'zapnuto'}.`), { class: 'btn btn-small', 'data-fk': 'ssh' }))),
      h('div', { class: 'op-field' }, h('span', { class: 'op-label' }, 'Certifikát'),
        h('div', { class: 'op-field-ctl' }, h('code', null, `CN=${v.esx.certificateCn}`), ' ', certOk ? '✓ odpovídá FQDN' : '',
          button('Regenerovat certifikát', () => run({ type: 'regenerateHostCertificate', hostId: v.id }, `Certifikát ${v.id} regenerován.`), { class: 'btn btn-small', 'data-fk': 'cert' })),
        h('div', { class: 'op-hint' }, '20-deployment §4.1.4')),
      prep?.steps.dns && !prep.steps.dns.ok && o.onOpenDns
        ? h('div', { class: 'op-actions' }, h('span', null, `DNS záznam hosta: ${prep.steps.dns.reason} `), button('Otevřít DNS firmy', () => o.onOpenDns!(), { class: 'btn btn-small', 'data-fk': 'open-dns' }))
        : null,
    );
    const prepIssues = prep ? [...prep.issues.errors, ...prep.issues.warnings, ...prep.issues.recommendations] : [];
    return [
      form,
      testBox,
      more,
      h('h4', null, `Připravenost hosta pro VCF Installer (${prepIssues.length})`),
      issueList(prepIssues, '✓ Model nehlásí žádný problém přípravy hosta.'),
    ];
  }

  function bmcTab(v: ServerView): HTMLElement[] {
    bmcDraft ??= { ip: v.bmc.ipv4 ?? '', vlan: v.bmc.tag !== null ? String(v.bmc.tag) : '' };
    const d = bmcDraft;
    const ip = textInput(d.ip, 'bmc-ip', (x) => (d.ip = x));
    const vlan = textInput(d.vlan, 'bmc-vlan', (x) => (d.vlan = x), { inputmode: 'numeric', class: 'op-num' });
    return [
      h('div', { class: 'op-outscope' },
        h('strong', null, `${v.bmc.label} – vzdálená správa serveru `), badge('out-of-scope', BMC_SCOPE.specRef),
        h('p', { class: 'small' }, 'Dokumentace VCF považuje síť pro BMC za mimo svůj rozsah: ', h('q', { lang: 'en' }, BMC_SCOPE.quote), ' ', docLink('Proč?', BMC_SCOPE.url)),
        h('p', { class: 'small muted' }, 'Volitelný krok – nic neblokuje. BMC nenese žádný provoz VCF.'),
      ),
      h('dl', { class: 'op-dl' },
        h('dt', null, 'Typ BMC'), h('dd', null, v.bmc.label),
        h('dt', null, 'Kabel'), h('dd', null, v.bmcPort.peerLabel ? `zapojeno do ${v.bmcPort.peerLabel}` : 'nezapojeno – v racku zapoj port BMC do libovolného portu switche',
          v.bmcPort.link && !v.bmcPort.link.up ? h('div', { class: 'op-hint' }, `▲ link nenaběhl – port BMC umí ${v.bmcPort.speedsGbE.join('/')} GbE a cílový port tuto rychlost nemá (herní pravidlo; zkus OOB switch 1G).`) : null),
        h('dt', null, 'Dosažitelné z počítače admina'), h('dd', null, v.bmc.reachableFromAdmin ? '✓ ano' : '✖ ne', ' ', badge('game-simplification')),
        h('dt', null, 'Vzdálená instalace ESX'), h('dd', null, v.bmc.remoteInstallDocumented ? `dokumentace ji pro tento BMC uvádí (${v.bmc.remoteInstallRef})` : `dokumentace ji pro tento BMC neuvádí (${v.bmc.remoteInstallRef})`),
      ),
      fieldRow('IP BMC', ip, [d.ip === '' ? provenanceBadge({ kind: 'game-default', note: 'prázdné = bez IP' }) : null], 'IP BMC je jiná než IP hosta (25 §10.2.1 [U74]).'),
      fieldRow('VLAN tag BMC', vlan, [provenanceBadge({ kind: 'game-default', note: 'prázdné = untagged' })]),
      h('div', { class: 'op-actions' },
        button('Uložit BMC', () => {
          const vt = d.vlan.trim();
          const vl = vt === '' ? null : intOf(vt);
          if (vl === undefined) {
            result = { ok: false, text: 'VLAN tag musí být číslo (nebo prázdné).' };
            return render();
          }
          if (run({ type: 'configureBmc', serverId: v.id, ip: d.ip.trim() === '' ? null : d.ip.trim(), vlan: vl }, `${v.bmc.label} na ${v.id} nastaven.`)) bmcDraft = null;
          render();
        }, { class: 'btn btn-small btn-primary', 'data-fk': 'bmc-save' }),
      ),
    ];
  }

  // ------------------------------------------------------------------ render
  function render(): void {
    const v = srv();
    const fk = focusKey(el);
    if (!v) {
      el.replaceChildren(h('div', { class: 'op-head' }, h('strong', null, o.serverId), button('✖', () => o.onClose(), { class: 'btn btn-small', 'aria-label': 'Zavřít' })), h('p', null, 'Server už neexistuje.'));
      return;
    }
    let content: HTMLElement[];
    switch (tab) {
      case 'overview':
        content = overview(v);
        break;
      case 'hardware':
        content = hardware(v);
        break;
      case 'esx':
        content = esx(v);
        break;
      case 'dcui':
        content = dcuiTab(v);
        break;
      case 'bmc':
        content = bmcTab(v);
        break;
    }
    body.replaceChildren(...content);
    const note = resultNote(result);
    el.replaceChildren(header(v), tabs(TABS, tab, setTab, `Panel serveru ${v.id}`), ...(note ? [note] : []), body);
    restoreFocus(el, fk);
  }

  function setTab(t: ServerTab): void {
    if (t === tab) return;
    tab = t;
    result = null;
    render();
    el.querySelector<HTMLElement>(`[data-fk="tab-${t}"]`)?.focus({ preventScroll: true });
  }

  render();
  return {
    el,
    get title() {
      return `Server ${o.serverId}`;
    },
    setTab,
    update(next, structural) {
      snap = next;
      if (structural) render();
      else updateTaskBars(el, next.tasks);
    },
    dispose() {
      el.remove();
    },
  };
}
