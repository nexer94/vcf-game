/**
 * Server panel (UX §2.6, §15): status, hardware summary with REQ / DEV / RCMD findings, hardware editor (before
 * ESX), ESX installation (at the server / remotely via BMC), DCUI console form (management network, test), NTP / SSH /
 * certificate, BMC settings (out of VCF scope – game).
 *
 * Every decision is the engine's: the panel dispatches commands and shows the model's issues unchanged.
 * Prefilled values carry their provenance (documented vs game default).
 */
import type { ServerView } from '../../modes/sandbox/roomView';
import type { SandboxSnapshot } from '../../modes/sandbox/snapshot';
import { button, h } from '../dom';
import { badge, message } from '../messages';
import { type ServerTab, HW_CLASS_TITLE, findingMessageType, serverTaskOf, splitList } from './panelData';
import { fieldRow, focusKey, issueList, provenanceBadge, restoreFocus, resultNote, tabs, taskBar, textInput, updateTaskBars, type ResultNote } from './panelKit';
import { uRangeLabel } from '../../render/rack/rackLayout';
import { sourceButton } from './sourcePopover';
import type { PortResult, SessionOps } from './sessionPort';

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

/** v3 (UX 19.3): only 2 tabs; ESX installer and DCUI are the server CONSOLE (ch. 20), BMC is a row. */
type PanelTab = 'overview' | 'network';
const TABS: readonly (readonly [PanelTab, string])[] = [
  ['overview', 'Přehled'],
  ['network', 'Síť'],
];

export interface ServerPanelOptions {
  readonly ops: SessionOps;
  readonly serverId: string;
  readonly tab?: ServerTab;
  readonly announce: (text: string, bad?: boolean) => void;
  readonly onOpenHost?: (serverId: string) => void;
  readonly onOpenDns?: () => void;
  /** Open the server console (ESX installer / DCUI – UX ch. 20). */
  readonly onOpenConsole?: (serverId: string) => void;
  readonly onClose: () => void;
}

export interface ObjectPanel {
  readonly el: HTMLElement;
  readonly title: string;
  /** Called on every port change; `structural` = snapshot.revision changed. */
  update(snap: SandboxSnapshot, structural: boolean): void;
  dispose(): void;
}

const toResult = (r: PortResult, okText: string): ResultNote =>
  r.ok ? { ok: true, text: okText, ...(r.warnings?.length ? { issues: r.warnings } : {}) } : { ok: false, text: r.message, ...(r.issues ? { issues: r.issues } : {}) };

export function createServerPanel(o: ServerPanelOptions): ObjectPanel & { setTab(t: ServerTab): void } {
  const { ops } = o;
  let tab: PanelTab = o.tab === 'dcui' ? 'network' : 'overview';
  let snap = ops.snapshot();
  let result: ResultNote | null = null;
  let ntpDraft: string | null = null;

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
    const slots = v.nicSlots ?? [];
    const slotRow = slots.length
      ? h('ul', { class: 'op-plain op-slots' }, ...slots.map((sl) => h('li', null,
          `slot ${sl.slot}: `,
          sl.partId ? h('span', { lang: 'en' }, `${sl.label ?? sl.partId} (${sl.ports ?? '?'}× ${(sl.speedsGbE ?? []).join('/')} GbE)`) : h('span', { class: 'muted' }, 'volný – přidáš klikem na [+] v racku'),
          sl.partId && v.esx.esxVersion === undefined
            ? button('Odebrat', () => run({ type: 'removeNic', serverId: v.id, slot: sl.slot }, `Karta ze slotu ${sl.slot} odebrána.`), { class: 'btn btn-small', 'data-fk': `nic-del-${sl.slot}`, title: 'Kabely karty se odpojí' })
            : null,
        )))
      : h('span', null, m ? `${m.nicPorts}× NIC port` : '–');
    out.push(
      h('dl', { class: 'op-dl' },
        h('dt', null, 'Umístění'), h('dd', null, v.mount ? `${v.mount.rackId} · ${uRangeLabel(v.mount.positionU, v.rackUnits)}` : 'nezaracováno'),
        h('dt', null, 'Hardware'), h('dd', null, m ? `${m.cores} jader · ${m.ramGB} GB RAM · ${m.driveCount}× disk (${m.nodeCapacityTB} TB)` : 'neúplná konfigurace', ' ', v.bcgUrl ? sourceButton({ extra: { label: `Broadcom Compatibility Guide: ${v.modelName}`, url: v.bcgUrl } }) : null),
        h('dt', null, 'NIC sloty'), h('dd', null, slotRow, slots.length ? h('div', { class: 'muted small' }, 'počet slotů je herní hodnota') : null),
        h('dt', null, 'ESX'), h('dd', null, v.esx.esxVersion ?? 'nenainstalováno'),
        h('dt', null, 'BMC'), h('dd', null, `${v.bmc.label} · ${v.bmc.cabled ? 'zapojeno' : 'nezapojeno'}${v.bmc.ipv4 ? ` · ${v.bmc.ipv4}` : ''} `, badge('out-of-scope'), ' ', sourceButton({ specRef: BMC_SCOPE.specRef, why: `Dokumentace: „${BMC_SCOPE.quote}“.` })),
        h('dt', null, 'Cena'), h('dd', null, `¤ ${v.price.toLocaleString('cs-CZ')} `, badge('game-price')),
      ),
    );
    const actions = h('div', { class: 'op-actions' });
    if (v.mount && o.onOpenConsole) actions.append(button(v.status === 'no-os' ? 'Instalovat ESX (konzole)' : 'Otevřít konzoli', () => o.onOpenConsole!(v.id), { class: 'btn btn-small btn-primary', 'data-fk': 'console' }));
    if (v.mount && o.onOpenHost) actions.append(button('Karty vmnic', () => o.onOpenHost!(v.id), { class: 'btn btn-small', 'data-fk': 'open-host' }));
    out.push(actions);
    const f = v.hw.findings;
    out.push(h('h4', null, `Nálezy hardwaru (${f.length})`));
    if (!f.length) out.push(h('p', { class: 'ok-line' }, '✓ Model nehlásí žádný nález.'));
    for (const cls of ['REQ', 'DEV', 'RCMD'] as const)
      for (const x of v.hw.byClass[cls])
        out.push(message({ type: findingMessageType(x), compact: true, title: HW_CLASS_TITLE[cls], body: x.message, bodyLang: 'en', source: { specRef: x.specRef, rule: x.code } }));
    return out;
  }

  function network(v: ServerView): HTMLElement[] {
    const out: HTMLElement[] = [];
    out.push(h('dl', { class: 'op-dl' },
      h('dt', null, 'Management'), h('dd', null, v.mgmt.ipv4 ? `${v.mgmt.ipv4}${v.mgmt.vlan !== undefined ? ` · VLAN ${v.mgmt.vlan}` : ' · bez VLAN ID'}` : v.status === 'esx-dhcp' ? 'DHCP (zatím bez statické IP)' : '–'),
      h('dt', null, 'Dosažitelnost'), h('dd', null, v.mgmt.gatewayReachable === undefined ? '–' : `gateway ${v.mgmt.gatewayReachable ? '✓' : '✖'} · DNS ${Object.entries(v.mgmt.dnsReachable ?? {}).map(([k, ok]) => `${k} ${ok ? '✓' : '✖'}`).join(', ') || '–'}`),
      h('dt', null, 'Test sítě'), h('dd', null, v.mgmt.lastTest ? `gateway ${v.mgmt.lastTest.gateway ? 'OK' : 'FAIL'} · ${Object.entries(v.mgmt.lastTest.dns).map(([ip, ok]) => `DNS ${ip} ${ok ? 'OK' : 'FAIL'}`).join(' · ')}` : 'zatím netestováno (DCUI v konzoli)'),
    ));
    const actions = h('div', { class: 'op-actions' });
    if (v.mount && o.onOpenHost) actions.append(button('Karty vmnic (síť hosta)', () => o.onOpenHost!(v.id), { class: 'btn btn-small', 'data-fk': 'open-host' }));
    if (v.esx.esxVersion !== undefined && o.onOpenConsole) actions.append(button('DCUI v konzoli (F2)', () => o.onOpenConsole!(v.id), { class: 'btn btn-small btn-primary', 'data-fk': 'go-dcui' }));
    out.push(actions);
    const topo = [...v.topology.errors, ...v.topology.warnings, ...v.topology.recommendations];
    out.push(h('h4', null, `Kabeláž a síť (${topo.length})`), issueList(topo, v.mount ? '✓ Model nehlásí problém se zapojením.' : 'Server není v racku.'));
    if (v.esx.esxVersion === undefined || !v.hostNet) return out;
    // NTP / SSH / certificate (20-deployment §4.1.3 – §4.1.4)
    const prep = snap.planning.hosts.find((x) => x.host.id === v.id);
    const ntpEp = snap.physical.endpoints.find((e) => e.kind === 'ntp')?.ipv4;
    if (ntpDraft === null) ntpDraft = v.esx.ntp.servers.length ? v.esx.ntp.servers.join(', ') : ntpEp ?? '';
    const ntpInput = textInput(ntpDraft, 'ntp', (x) => (ntpDraft = x));
    const certOk = prep?.steps.certificateMatchesFqdn === true;
    out.push(h('div', { class: 'op-more' },
      h('h4', null, 'Další nastavení hosta'),
      fieldRow('NTP servery', ntpInput, [
        v.esx.ntp.servers.length ? null : provenanceBadge({ kind: 'game-default', ...(ntpEp ? { note: 'NTP sítě firmy (herní)' } : {}) }),
        button('Nastavit NTP', () => {
          if (run({ type: 'configureHostNtp', hostId: v.id, servers: splitList(ntpDraft ?? '') }, `NTP na ${v.id} nastaveno.`)) ntpDraft = null;
          render();
        }, { class: 'btn btn-small', 'data-fk': 'ntp-save' }),
      ], `stav: ${v.esx.ntp.enabled && v.esx.ntp.serviceRunning ? 'běží' : 'neběží'}`),
      h('div', { class: 'op-field' }, h('span', { class: 'op-label' }, 'SSH'),
        h('div', { class: 'op-field-ctl' }, v.esx.sshEnabled ? 'zapnuto ' : 'vypnuto ',
          button(v.esx.sshEnabled ? 'Vypnout SSH' : 'Zapnout SSH', () => run({ type: 'setHostSsh', hostId: v.id, enabled: !v.esx.sshEnabled }, `SSH na ${v.id} ${v.esx.sshEnabled ? 'vypnuto' : 'zapnuto'}.`), { class: 'btn btn-small', 'data-fk': 'ssh' }))),
      h('div', { class: 'op-field' }, h('span', { class: 'op-label' }, 'Certifikát'),
        h('div', { class: 'op-field-ctl' }, h('code', null, `CN=${v.esx.certificateCn}`), ' ', certOk ? '✓ odpovídá FQDN' : '',
          button('Regenerovat certifikát', () => run({ type: 'regenerateHostCertificate', hostId: v.id }, `Certifikát ${v.id} regenerován.`), { class: 'btn btn-small', 'data-fk': 'cert' }))),
      h('div', { class: 'op-hint' }, sourceButton({ specRef: '20-deployment §4.1.3, §4.1.4' }) ?? ''),
      prep?.steps.dns && !prep.steps.dns.ok && o.onOpenDns
        ? h('div', { class: 'op-actions' }, h('span', null, `DNS záznam hosta: ${prep.steps.dns.reason} `), button('Otevřít DNS firmy', () => o.onOpenDns!(), { class: 'btn btn-small', 'data-fk': 'open-dns' }))
        : null,
    ));
    const prepIssues = prep ? [...prep.issues.errors, ...prep.issues.warnings, ...prep.issues.recommendations] : [];
    out.push(h('h4', null, `Připravenost pro VCF Installer (${prepIssues.length})`), issueList(prepIssues, '✓ Model nehlásí žádný problém přípravy hosta.'));
    return out;
  }

  // ------------------------------------------------------------------ render
  function render(): void {
    const v = srv();
    const fk = focusKey(el);
    if (!v) {
      el.replaceChildren(h('div', { class: 'op-head' }, h('strong', null, o.serverId), button('✖', () => o.onClose(), { class: 'btn btn-small', 'aria-label': 'Zavřít' })), h('p', null, 'Server už neexistuje.'));
      return;
    }
    const content = tab === 'network' ? network(v) : overview(v);
    body.replaceChildren(...content);
    const note = resultNote(result);
    el.replaceChildren(header(v), tabs(TABS, tab, setTab, `Panel serveru ${v.id}`), ...(note ? [note] : []), body);
    restoreFocus(el, fk);
  }

  function setTab(t: ServerTab | PanelTab): void {
    // Legacy tabs (showMe data): ESX / DCUI live in the console now.
    if ((t === 'esx' || t === 'dcui') && o.onOpenConsole) {
      const v = srv();
      if (v?.mount) o.onOpenConsole(v.id);
    }
    const next: PanelTab = t === 'network' || t === 'dcui' ? 'network' : 'overview';
    if (next === tab) return;
    tab = next;
    result = null;
    render();
    el.querySelector<HTMLElement>(`[data-fk="tab-${next}"]`)?.focus({ preventScroll: true });
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
