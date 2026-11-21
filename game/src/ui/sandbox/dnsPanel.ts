/**
 * DNS panel – "DNS server firmy (mimo VCF)": list / add / remove A + PTR records (environment actions
 * addDnsRecord / removeDnsRecord). The forward / reverse check per record is the model's (net.checkForwardReverse
 * via snapshot.planning.dns). Hosts with a management FQDN whose records are missing get a one-click suggestion
 * (values taken from the host's own DCUI configuration).
 */
import type { SandboxSnapshot } from '../../modes/sandbox/snapshot';
import type { DnsRecordKind } from '../../modes/sandbox/types';
import { button, h } from '../dom';
import { badge } from '../messages';
import { fieldRow, focusKey, restoreFocus, resultNote, textInput, type ResultNote } from './panelKit';
import type { ObjectPanel } from './serverPanel';
import type { SessionOps } from './sessionPort';

const CHECK_TEXT: Readonly<Record<string, string>> = {
  'no-forward': 'chybí A záznam',
  'no-reverse': 'chybí PTR záznam',
  'reverse-mismatch': 'PTR ukazuje na jiné jméno',
};

export interface DnsPanelOptions {
  readonly ops: SessionOps;
  readonly announce: (text: string, bad?: boolean) => void;
  readonly onClose: () => void;
}

export function createDnsPanel(o: DnsPanelOptions): ObjectPanel {
  const { ops } = o;
  let snap = ops.snapshot();
  let result: ResultNote | null = null;
  const draft = { fqdn: '', ip: '', kind: 'a+ptr' as DnsRecordKind };
  const el = h('section', { class: 'op-panel op-dns', role: 'dialog', 'aria-label': 'DNS server firmy' });

  const run = (cmd: Parameters<SessionOps['dispatch']>[0], okText: string): boolean => {
    const r = ops.dispatch(cmd);
    result = r.ok ? { ok: true, text: okText } : { ok: false, text: r.message, ...(r.issues ? { issues: r.issues } : {}) };
    o.announce(r.ok ? okText : `Nelze: ${r.message}`, !r.ok);
    render();
    return r.ok;
  };

  function render(): void {
    const fk = focusKey(el);
    const dns = snap.planning.dns;
    const hosts = snap.physical.servers.filter((s) => s.esx.network);
    const missing = hosts.filter((s) => {
      const p = snap.planning.hosts.find((x) => x.host.id === s.id);
      return p?.steps.dns !== undefined && !p.steps.dns.ok;
    });
    const kindSel = h('select', { 'data-fk': 'dns-kind', 'aria-label': 'Typ záznamu' },
      ...(['a+ptr', 'a', 'ptr'] as const).map((k) => h('option', { value: k, ...(draft.kind === k ? { selected: true } : {}) }, k === 'a+ptr' ? 'A + PTR' : k.toUpperCase())),
    );
    kindSel.addEventListener('change', () => (draft.kind = kindSel.value as DnsRecordKind));
    const add = (): void => {
      if (run({ type: 'addDnsRecord', fqdn: draft.fqdn.trim(), ip: draft.ip.trim(), records: draft.kind }, `Záznam ${draft.fqdn.trim()} přidán.`)) {
        draft.fqdn = '';
        draft.ip = '';
        render();
      }
    };
    const form = h('div', { class: 'op-editor' },
      h('h4', null, 'Přidat záznam'),
      fieldRow('FQDN', textInput(draft.fqdn, 'dns-fqdn', (x) => (draft.fqdn = x), { placeholder: 'esx01.lab.example' })),
      fieldRow('IPv4', textInput(draft.ip, 'dns-ip', (x) => (draft.ip = x), { placeholder: '10.0.0.11' })),
      fieldRow('Záznamy', kindSel),
      h('div', { class: 'op-actions' }, button('Přidat', add, { class: 'btn btn-small btn-primary', 'data-fk': 'dns-add' })),
    );
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
        e.preventDefault();
        add();
      }
    });
    const note = resultNote(result);
    el.replaceChildren(
      h('div', { class: 'op-head' },
        h('div', { class: 'op-title' }, h('strong', null, 'DNS server firmy (mimo VCF)'),
          h('div', { class: 'op-status' }, 'Prostředí zákazníka, ne součást VCF · ', badge('game-simplification', 'jeden DNS server za portem „Síť firmy“'))),
        button('✖', () => o.onClose(), { class: 'btn btn-small', 'aria-label': 'Zavřít panel (Esc)', 'data-fk': 'close' }),
      ),
      ...(note ? [note] : []),
      h('div', { class: 'op-body' },
        missing.length
          ? h('div', { class: 'op-suggest' },
              h('h4', null, `Hosty bez platných záznamů (${missing.length})`),
              ...missing.map((s) => {
                const n = s.esx.network!;
                return h('div', { class: 'op-part-row' }, h('span', null, `${n.hostnameFqdn} → ${n.ipv4Address}`),
                  button('Přidat A + PTR', () => run({ type: 'addDnsRecord', fqdn: n.hostnameFqdn, ip: n.ipv4Address, records: 'a+ptr' }, `Záznamy pro ${n.hostnameFqdn} přidány.`), { class: 'btn btn-small', 'data-fk': `sug-${s.id}` }));
              }),
              h('p', { class: 'muted small' }, 'Hodnoty jsou z DCUI konfigurace hosta.'),
            )
          : null,
        h('h4', null, `A záznamy (${dns.a.length})`),
        dns.a.length
          ? h('table', { class: 'op-table' },
              h('thead', null, h('tr', null, h('th', null, 'FQDN'), h('th', null, 'IPv4'), h('th', null, 'Forward + reverse'), h('th', null, ''))),
              h('tbody', null, ...dns.a.map((r) => h('tr', null,
                h('td', null, r.fqdn), h('td', null, r.ip),
                h('td', null, r.check.ok ? '✓ OK' : `✖ ${CHECK_TEXT[r.check.reason] ?? r.check.reason}`),
                h('td', null, button('Odebrat', () => run({ type: 'removeDnsRecord', fqdn: r.fqdn, records: 'a+ptr' }, `Záznamy ${r.fqdn} odebrány.`), { class: 'btn btn-small btn-danger', 'aria-label': `Odebrat ${r.fqdn}`, 'data-fk': `rm-a-${r.fqdn}` })),
              ))))
          : h('p', { class: 'muted' }, 'Zatím žádné záznamy.'),
        h('h4', null, `PTR záznamy (${dns.ptr.length})`),
        dns.ptr.length
          ? h('table', { class: 'op-table' },
              h('thead', null, h('tr', null, h('th', null, 'IPv4'), h('th', null, 'FQDN'), h('th', null, ''))),
              h('tbody', null, ...dns.ptr.map((r) => h('tr', null, h('td', null, r.ip), h('td', null, r.fqdn),
                h('td', null, button('Odebrat PTR', () => run({ type: 'removeDnsRecord', fqdn: r.fqdn, records: 'ptr' }, `PTR ${r.ip} odebrán.`), { class: 'btn btn-small btn-danger', 'data-fk': `rm-p-${r.ip}` })),
              ))))
          : h('p', { class: 'muted' }, 'Zatím žádné záznamy.'),
        form,
      ),
    );
    restoreFocus(el, fk);
  }

  render();
  return {
    el,
    title: 'DNS server firmy',
    update(next: SandboxSnapshot, structural: boolean) {
      snap = next;
      if (structural) render();
    },
    dispose() {
      el.remove();
    },
  };
}
