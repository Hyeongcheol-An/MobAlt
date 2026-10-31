// Tools panel (ping/traceroute/port scan/DNS/net info, Wake-on-LAN, network scanner) and Macros panel.
import { $, h, contextMenu, confirmDialog, promptDialog, toast, showModal } from './ui.js';
import { normMac, trimLabel, parsePort, sshPortOf, comparePorts } from './nettools.js';
import { t, tn, onChange } from './i18n.js'; // interface language: every label / message shown to the user goes through t() / tn()

const ipKey = (ip) => (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip) ? ip.split('.').map((o) => o.padStart(3, '0')).join('.') : '~' + ip); // IPv4 in address order, anything else after
const fmtRtt = (ms) => t('{rtt} ms', { rtt: ms >= 100 ? String(Math.round(ms)) : ms.toFixed(ms < 10 ? 2 : 1) });

export class ToolsPanel {
  constructor(app) {
    this.app = app;
    this.out = $('#tool-output');
    this.host = $('#tool-host');
    this.running = null; // id of the streaming tool (ping / traceroute) whose output belongs on screen
    this.runSeq = 0; // bumped by every run: output of an earlier run is dropped once a later one owns the panel
    for (const b of document.querySelectorAll('[data-tool]')) b.addEventListener('click', () => this.run(b.dataset.tool));
    this.host.addEventListener('keydown', (e) => e.key === 'Enter' && this.run('ping'));
    window.api.on('tools:output', ({ id, text }) => {
      if (id === this.running) this.append(text);
    });
    window.api.on('tools:done', ({ id }) => {
      if (id === this.running) this.running = null;
    });
    this.initWol();
    this.initScanner();
    onChange(() => { if (this.scan) this.renderScanRows(); }); // a language switch: the result rows' "Add as session" buttons and RTT units (the <pre> output is a log and stays)
  }

  append(text) {
    this.out.textContent += text;
    this.out.scrollTop = this.out.scrollHeight;
  }

  /** The classic tools write into the <pre>, the scanner fills its table: the output area shows whichever ran last. */
  showOutput(which) {
    this.out.hidden = which !== 'text';
    $('#scan-results').hidden = which !== 'scan';
  }

  async run(tool) {
    const host = this.host.value.trim();
    if (tool === 'stop') {
      if (this.running) await window.api.tools.stop(this.running); // its "[stopped]" line is the answer to the click
      return;
    }
    if (tool !== 'netinfo' && !host) return toast(t('Enter a host'), 'warn');
    // From here the panel belongs to this run: the previous tool's "[stopped]" line (sent when the kill lands, after
    // stop() has answered) and a still-pending lookup or port scan are dropped instead of landing in this output.
    const run = ++this.runSeq;
    const append = (text) => run === this.runSeq && this.append(text);
    if (this.running) {
      const prev = this.running;
      this.running = null;
      await window.api.tools.stop(prev);
    }
    if (run !== this.runSeq) return; // another tool was started while the previous one was being stopped
    this.out.textContent = '';
    this.showOutput('text');
    try {
      if (tool === 'ping' || tool === 'traceroute') {
        const id = await (tool === 'ping' ? window.api.tools.ping(host, 5) : window.api.tools.traceroute(host));
        if (run === this.runSeq) this.running = id;
        else window.api.tools.stop(id); // superseded while starting: never show its output
      } else if (tool === 'lookup') {
        append(t('Resolving {host}…', { host }) + '\n');
        const r = await window.api.tools.lookup(host);
        const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
        const mx = r.mx || [], txt = r.txt || [], ptr = r.reverse || [];
        if (r.error) append(`  ${r.error}\n`);
        for (const a of r.addresses || []) append(`  ${a.family === 6 ? 'AAAA' : 'A   '}  ${a.address}\n`);
        for (const m of mx) append(`  MX    ${m.priority} ${m.exchange}\n`);
        for (const t of txt) append(`  TXT   ${t.join('')}\n`);
        for (const p of ptr) append(`  PTR   ${p}\n`);
        // say explicitly what was not found instead of ending the listing silently
        if (isIp) {
          if (!ptr.length) append('  ' + t('(no PTR record: {host} has no reverse DNS name)', { host }) + '\n');
        } else if (!r.error) {
          if (!mx.length) append('  ' + t('(no MX records)') + '\n');
          if (!txt.length) append('  ' + t('(no TXT records)') + '\n');
        }
        if (!r.error && !(r.addresses || []).length && !ptr.length) append('  ' + t('no records') + '\n');
      } else if (tool === 'netinfo') {
        const r = await window.api.tools.netinfo();
        append(t('Hostname: {hostname}', { hostname: r.hostname }) + '\n' + t('DNS: {servers}', { servers: r.dns.join(', ') }) + '\n');
        let last = null;
        for (const i of r.interfaces) {
          if (i.name !== last) { append(`\n${i.name}${i.mac && i.mac !== '00:00:00:00:00:00' ? `  (${i.mac})` : ''}\n`); last = i.name; }
          append(`  ${i.family === 'IPv6' ? 'v6' : 'v4'}  ${i.address}${i.netmask ? ' / ' + i.netmask : ''}\n`);
        }
      } else if (tool === 'portscan') {
        const from = $('#tool-port-from').value.trim() === '' ? 1 : parseInt($('#tool-port-from').value, 10);
        const to = $('#tool-port-to').value.trim() === '' ? 1024 : parseInt($('#tool-port-to').value, 10);
        if (!(from >= 1 && from <= 65535) || !(to >= 1 && to <= 65535)) return toast(t('Ports must be between 1 and 65535'), 'warn');
        if (from > to) return toast(t('The first port must not be greater than the last'), 'warn');
        append(t('Scanning {host} ports {from}-{to}…', { host, from, to }) + '\n');
        const t0 = Date.now();
        const open = await window.api.tools.portScan(host, from, to);
        append(open.length ? open.map((p) => '  ' + t('{port}/tcp open', { port: p })).join('\n') + '\n' : '  ' + t('no open ports found') + '\n');
        append(t('done in {seconds}s', { seconds: ((Date.now() - t0) / 1000).toFixed(1) }) + '\n');
      }
    } catch (e) {
      append(t('error: {message}', { message: e.message }) + '\n');
    }
  }

  // ---------- Wake-on-LAN ----------
  initWol() {
    this.wolMac = $('#wol-mac');
    this.wolBroadcast = $('#wol-broadcast');
    this.wolPort = $('#wol-port');
    this.wolLabel = $('#wol-label');
    this.waking = false;
    $('[data-wol="wake"]').addEventListener('click', () => this.wake());
    for (const el of [this.wolMac, this.wolBroadcast, this.wolPort, this.wolLabel]) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.wake(); } });
    // a MAC picked from the history (or typed again, in any spelling) brings its label along
    this.wolMac.addEventListener('input', () => {
      const mac = normMac(this.wolMac.value);
      const known = mac && this.wolHistory.find((x) => x.mac === mac);
      if (known && known.label) this.wolLabel.value = known.label;
    });
    this.renderWolHistory();
  }

  /** The last 10 MACs woken, newest first: [{ mac, label, at }] (settings key wolHistory). */
  get wolHistory() {
    return Array.isArray(this.app.settings.wolHistory) ? this.app.settings.wolHistory : [];
  }

  /** The MAC box's datalist: every remembered address, its label as the option's secondary text. */
  renderWolHistory() {
    $('#wol-history').replaceChildren(...this.wolHistory.map((e) => h('option', { value: e.mac, label: trimLabel(e.label) || null })));
  }

  /** Wake: the main process validates, builds and broadcasts the magic packet; a success goes into the history with the label. */
  async wake() {
    if (this.waking) return;
    const mac = this.wolMac.value.trim();
    if (!mac) return toast(t('Enter a MAC address'), 'warn');
    const port = parsePort(this.wolPort.value); // "1.5" is refused here (parseInt would have sent to port 1)
    if (port.error) {
      this.wolPort.focus();
      return toast(port.error, 'warn');
    }
    const broadcast = this.wolBroadcast.value.trim() || '255.255.255.255';
    this.waking = true;
    try {
      const r = await window.api.tools.wake({ mac, broadcast, port: port.port });
      if (!r.ok) return toast(r.error, 'warn');
      const old = this.wolHistory.find((x) => x.mac === r.mac);
      const label = trimLabel(this.wolLabel.value) || (old && old.label) || '';
      this.wolLabel.value = label; // what the history keeps (at most 40 characters)
      const wolHistory = [{ mac: r.mac, label, at: Date.now() }, ...this.wolHistory.filter((x) => x.mac !== r.mac)].slice(0, 10);
      await this.app.saveSettings({ wolHistory }, true);
      this.renderWolHistory();
      this.wolMac.value = r.mac; // the spelling the history keeps
      const p = { label, mac: r.mac, broadcast: r.broadcast, port: r.port };
      toast(label ? t('Magic packet sent to {label} ({mac}) via {broadcast}:{port}', p) : t('Magic packet sent to {mac} via {broadcast}:{port}', p), 'success');
    } catch (e) {
      toast(t('Wake-on-LAN failed: {message}', { message: e.message }), 'error');
    } finally {
      this.waking = false;
    }
  }

  // ---------- network scanner ----------
  initScanner() {
    this.scanTarget = $('#scan-target');
    this.scanBody = $('#scan-results tbody');
    this.scan = null; // the last run: { id, total, done, rows, running, cancelled, ms, target }
    this.scanStarting = false; // scanStart in flight: a second Scan click / Enter meanwhile is ignored (it would start an untracked scan)
    this.scanStopRequested = false; // Stop pressed during that window: stops the run as soon as it is known
    this.scanSort = { key: 'ip', dir: 1 };
    for (const b of document.querySelectorAll('[data-scan]')) b.addEventListener('click', () => this.scanCmd(b.dataset.scan));
    for (const el of [this.scanTarget, $('#scan-ports'), $('#scan-concurrency'), $('#scan-timeout')]) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.startScan(); } });
    for (const b of document.querySelectorAll('#scan-results th button[data-sort]')) b.addEventListener('click', () => this.sortScan(b.dataset.sort));
    window.api.on('tools:scan', (ev) => this.onScanEvent(ev));
    this.syncScanButtons();
  }

  scanCmd(name) {
    if (name === 'start') this.startScan();
    else if (name === 'stop') this.stopScan();
    else if (name === 'copy') this.copyScan();
  }

  /** Scan while idle, Stop while running (or starting), Copy once there is a row — the keyboard is moved off a button before it goes inert. */
  syncScanButtons() {
    const running = this.scanStarting || !!(this.scan && this.scan.running);
    const start = $('[data-scan="start"]'), stop = $('[data-scan="stop"]');
    if (running) {
      stop.disabled = false;
      if (document.activeElement === start) stop.focus();
      start.disabled = true;
    } else {
      start.disabled = false;
      if (document.activeElement === stop) start.focus();
      stop.disabled = true;
    }
    $('[data-scan="copy"]').disabled = !(this.scan && this.scan.rows.length);
  }

  async startScan() {
    if (this.scanStarting || (this.scan && this.scan.running)) return;
    const target = this.scanTarget.value.trim();
    if (!target) return toast(t('Enter a CIDR, an address range or a host'), 'warn');
    const int = (sel, def) => { const v = parseInt($(sel).value, 10); return Number.isInteger(v) ? v : def; };
    // Scan goes inert at once: a second click or Enter before the main process answered would start another run
    // that nothing here tracks or can stop (main refuses a second start too)
    this.scanStarting = true;
    this.scanStopRequested = false;
    this.syncScanButtons();
    let r;
    try {
      r = await window.api.tools.scanStart({ target, method: $('#scan-method').value, ports: $('#scan-ports').value, concurrency: int('#scan-concurrency', 64), timeout: int('#scan-timeout', 600), reverseDns: $('#scan-rdns').checked });
    } finally {
      this.scanStarting = false;
    }
    if (!r || r.error) {
      this.syncScanButtons();
      return toast(r ? r.error : t('The scan could not start'), 'warn');
    }
    this.scan = { id: r.id, total: r.total, done: 0, rows: [], running: true, cancelled: false, ms: 0, target };
    this.scanBody.replaceChildren();
    $('#scan-progress').hidden = false;
    this.showOutput('scan');
    this.renderScanProgress();
    this.renderScanEmpty();
    this.syncScanButtons();
    this.fitScanResults();
    if (this.scanStopRequested) this.stopScan();
  }

  async stopScan() {
    if (this.scanStarting) { this.scanStopRequested = true; return; } // the id is not known yet: stop it once it is
    if (!this.scan || !this.scan.running) return;
    await window.api.tools.scanStop(this.scan.id); // the run's 'done' event (cancelled) closes it
  }

  /**
   * A short panel (the 900×560 window, a narrow sidebar whose rows wrap): the results table keeps a minimum height
   * (styles.css) and the panel scrolls for the rest — so the Wake-on-LAN group folds up when the table would
   * otherwise push past the bottom, and the table is scrolled into view (the forms above it move up, not off).
   */
  fitScanResults() {
    const panel = $('#panel-tools'), wol = $('#tools-wol');
    if (wol.open && panel.scrollHeight > panel.clientHeight + 1) wol.open = false;
    if (panel.scrollHeight > panel.clientHeight + 1) $('#scan-results').scrollIntoView({ block: 'nearest' });
  }

  onScanEvent(ev) {
    const s = this.scan;
    if (!s || ev.id !== s.id) return; // an earlier run's late events
    if (ev.type === 'progress') {
      s.done = ev.done;
      this.renderScanProgress();
    } else if (ev.type === 'hit') {
      s.rows.push(ev);
      this.renderScanRows();
    } else if (ev.type === 'error') {
      toast(ev.message, 'warn');
    } else if (ev.type === 'done') {
      Object.assign(s, { done: ev.done, running: false, cancelled: ev.cancelled, ms: ev.ms });
      this.renderScanProgress();
      this.renderScanEmpty();
      this.syncScanButtons();
      const n = s.rows.length, p = { done: ev.done, total: ev.total, seconds: (ev.ms / 1000).toFixed(1) };
      toast(ev.cancelled ? tn('Scan stopped: {n} host up, {done}/{total} scanned', 'Scan stopped: {n} hosts up, {done}/{total} scanned', n, p) : tn('Scan finished: {n} host up of {total} in {seconds} s', 'Scan finished: {n} hosts up of {total} in {seconds} s', n, p), ev.cancelled ? 'warn' : 'success');
    }
  }

  renderScanProgress() {
    const s = this.scan, bar = $('#scan-bar');
    bar.max = s.total || 1;
    bar.value = s.done;
    $('#scan-count').textContent = `${s.done}/${s.total}`;
  }

  renderScanEmpty() {
    $('#scan-empty').hidden = !this.scan || this.scan.running || this.scan.rows.length > 0;
  }

  /**
   * A header click sorts by that column; the same column again flips the direction (aria-sort says which). Ports
   * starts descending — the hosts with the most open ports first, what a scan is run for — and says so in aria-sort.
   */
  sortScan(key) {
    this.scanSort = this.scanSort.key === key ? { key, dir: -this.scanSort.dir } : { key, dir: key === 'ports' ? -1 : 1 };
    for (const b of document.querySelectorAll('#scan-results th button[data-sort]')) {
      const on = b.dataset.sort === key;
      b.classList.toggle('on', on);
      b.closest('th').setAttribute('aria-sort', on ? (this.scanSort.dir > 0 ? 'ascending' : 'descending') : 'none');
    }
    this.renderScanRows();
  }

  sortedScanRows() {
    const { key, dir } = this.scanSort;
    const byIp = (a, b) => (ipKey(a.ip) < ipKey(b.ip) ? -1 : ipKey(a.ip) > ipKey(b.ip) ? 1 : 0);
    const cmp = {
      ip: byIp,
      hostname: (a, b) => (a.hostname || '').localeCompare(b.hostname || '') || byIp(a, b),
      rtt: (a, b) => (a.rtt ?? Infinity) - (b.rtt ?? Infinity) || byIp(a, b),
      ports: (a, b) => comparePorts(a, b) || byIp(a, b), // ascending: fewest open ports first (the indicator's direction)
    }[key] || byIp;
    return [...this.scan.rows].sort((a, b) => dir * cmp(a, b));
  }

  renderScanRows() {
    this.scanBody.replaceChildren(...this.sortedScanRows().map((r) => h('tr', {},
      h('td', { class: 'mono', title: r.hostname || null }, r.ip), // the name stays reachable when a narrow sidebar hides the Host column
      h('td', { class: 'host', title: r.hostname || null }, r.hostname || '—'),
      h('td', { class: 'mono num' }, r.rtt == null ? '—' : fmtRtt(r.rtt)),
      h('td', { class: 'mono' }, r.ports.length ? r.ports.join(', ') : '—'),
      h('td', { class: 'act' }, h('button', { type: 'button', class: 'scan-add', title: t('Add {ip} as an SSH session', { ip: r.ip }), 'aria-label': t('Add {ip} as session', { ip: r.ip }), onclick: () => this.addScanSession(r) }, '＋')),
    )));
    this.renderScanEmpty();
    this.syncScanButtons();
  }

  /** "Add as session": the session editor with SSH to this host filled in — port 22 when it is open, else the SSH-looking open port (2222…), else the first open one (named after the reverse lookup). */
  addScanSession(r) {
    const s = { type: 'ssh', host: r.ip, port: sshPortOf(r.ports) };
    if (r.hostname) s.name = r.hostname;
    this.app.editSession(s);
  }

  /** "Copy as text": the table as it is sorted, in aligned columns. */
  async copyScan() {
    if (!this.scan || !this.scan.rows.length) return toast(t('No scan results to copy'), 'warn');
    const rows = this.sortedScanRows();
    const cols = [['IP', (r) => r.ip], [t('Hostname'), (r) => r.hostname || '-'], ['RTT', (r) => (r.rtt == null ? '-' : fmtRtt(r.rtt))], [t('Open ports'), (r) => (r.ports.length ? r.ports.join(',') : '-')]];
    const cells = rows.map((r) => cols.map(([, f]) => f(r)));
    const widths = cols.map(([name], i) => Math.max(name.length, ...cells.map((c) => c[i].length)));
    const line = (c) => c.map((v, i) => (i === cols.length - 1 ? v : v.padEnd(widths[i]))).join('  ');
    await window.api.clipboard.write([line(cols.map(([name]) => name)), ...cells.map(line)].join('\n') + '\n');
    toast(tn('Copied {n} host as text', 'Copied {n} hosts as text', rows.length), 'success');
  }
}

export class MacrosPanel {
  constructor(app) {
    this.app = app;
    this.list = $('#macro-list');
    this.recBtn = $('#macro-record');
    for (const b of document.querySelectorAll('[data-macro]')) b.addEventListener('click', () => this.cmd(b.dataset.macro));
    // keyboard: the rows are options of a listbox with one Tab stop (roving tabindex), see onKey()
    this.list.setAttribute('role', 'listbox');
    this.list.setAttribute('aria-label', t('Macros'));
    this.list.addEventListener('keydown', (e) => this.onKey(e));
    this.list.addEventListener('focusin', (e) => {
      const r = e.target.closest('.tree-row');
      if (r) this._rove(r);
    });
    this.render();
    onChange(() => { // a language switch: the list (empty state, "{n} ch") and the record button, whose text this panel rewrites
      this.list.setAttribute('aria-label', t('Macros'));
      this.recBtn.textContent = this.app.macroRecorder ? t('■ Stop') : t('● Rec');
      this.render();
    });
  }

  rows() {
    return [...this.list.querySelectorAll('.tree-row')];
  }

  /** Roving tabindex: `row` is the list's single Tab stop. */
  _rove(row) {
    for (const r of this.rows()) r.tabIndex = r === row ? 0 : -1;
  }

  /** Keyboard cursor: focus the row (ring by :focus-visible) and mark it as the selected option. */
  focusRow(row) {
    if (!row) return;
    row.focus();
    row.scrollIntoView({ block: 'nearest' });
    for (const r of this.rows()) r.setAttribute('aria-selected', String(r === row));
  }

  /** ↑/↓ move, Home/End, Enter plays in the active terminal (like a double-click), ⌫/Delete asks and deletes, ⇧F10 / Menu key open the row's menu. */
  onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const rows = this.rows();
    const row = e.target.closest('.tree-row');
    const i = rows.indexOf(row);
    if (i < 0) return;
    const m = row._macro;
    switch (e.key) {
      case 'ArrowDown': this.focusRow(rows[i + 1]); break;
      case 'ArrowUp': this.focusRow(rows[i - 1]); break;
      case 'Home': this.focusRow(rows[0]); break;
      case 'End': this.focusRow(rows[rows.length - 1]); break;
      case 'Enter': this.play(m); break;
      case 'Backspace': case 'Delete': this.remove(m); break;
      case 'F10': case 'ContextMenu': {
        if (e.key === 'F10' && !e.shiftKey) return;
        const r = row.getBoundingClientRect();
        this.rowMenu(m, r.left + 24, r.bottom);
        break;
      }
      default: return;
    }
    e.preventDefault();
  }

  rowMenu(m, x, y) {
    contextMenu(x, y, [
      { label: t('Play in Active Terminal'), key: '⏎', action: () => this.play(m) },
      { label: t('Play in All Terminals'), action: () => this.play(m, true) },
      '-',
      { label: t('Edit…'), action: () => this.edit(m) },
      { label: t('Rename…'), action: async () => { const n = await promptDialog(t('Rename macro'), { value: m.name }); if (n) this.save(this.macros.map((x) => (x.id === m.id ? { ...x, name: n } : x))); } },
      '-',
      { label: t('Delete'), key: '⌫', danger: true, action: () => this.remove(m) },
    ]);
  }

  async remove(m) {
    if (await confirmDialog(t('Delete macro "{name}"?', { name: m.name }), { okLabel: t('Delete'), danger: true })) this.save(this.macros.filter((x) => x.id !== m.id));
  }

  get macros() {
    return this.app.settings.macros || [];
  }

  async save(macros) {
    await this.app.saveSettings({ macros });
    this.render();
  }

  render() {
    // a re-render while the keyboard is in the list (rename, delete…) keeps a row focused: same id, else same place
    const fa = document.activeElement;
    const focused = fa && fa.classList.contains('tree-row') && this.list.contains(fa) ? { id: fa._macro?.id, index: this.rows().indexOf(fa) } : null;
    this.list.replaceChildren();
    if (!this.macros.length) {
      this.list.append(h('div', { class: 'tree-empty' }, t('No macros. Press ● Rec to record keystrokes in the active terminal, or ＋ to type one.')));
      if (focused) $('[data-macro="new"]').focus(); // the last macro was deleted from the keyboard: ＋ is the nearest control
      return;
    }
    for (const m of this.macros) {
      const row = h('div', { class: 'tree-row', title: m.text.slice(0, 200), role: 'option', tabindex: -1, 'aria-selected': 'false' }, h('span', { class: 'ico' }, '▶'), h('span', { class: 'label' }, m.name), h('span', { class: 'sub' }, t('{n} ch', { n: m.text.length })));
      row._macro = m;
      row.addEventListener('dblclick', () => this.play(m));
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.rowMenu(m, e.clientX, e.clientY);
      });
      this.list.append(row);
    }
    const rows = this.rows();
    const again = focused && (rows.find((r) => r._macro.id === focused.id) || rows[Math.min(focused.index, rows.length - 1)]);
    this._rove(again || rows[0]);
    if (again) this.focusRow(again);
  }

  play(m, all = false) {
    const panes = all ? this.app.workspace.allPanes() : [this.app.activePane()].filter(Boolean);
    if (!panes.length) return toast(t('No active terminal'), 'warn');
    for (const p of panes) p.write(m.text);
    if (!all) panes[0].focus();
  }

  async cmd(name) {
    if (name === 'record') {
      if (this.app.macroRecorder) {
        const text = this.app.macroRecorder.text;
        this.app.macroRecorder = null;
        this.recBtn.classList.remove('on');
        this.recBtn.textContent = t('● Rec');
        if (!text) return toast(t('Nothing recorded'), 'warn');
        const ask = () => promptDialog(t('Save macro'), { label: tn('{n} character recorded', '{n} characters recorded', text.length), placeholder: t('macro name') });
        let n = await ask();
        while (n !== null && !n.trim()) {
          toast(t('Give the macro a name'), 'warn');
          n = await ask();
        }
        if (!n) return;
        this.save([...this.macros, { id: 'm' + Date.now(), name: n, text }]);
      } else {
        if (!this.app.activePane()) return toast(t('Focus a terminal first'), 'warn');
        this.app.macroRecorder = { text: '' };
        this.recBtn.classList.add('on');
        this.recBtn.textContent = t('■ Stop');
        this.app.activePane().focus();
        toast(t('Recording keystrokes… press ■ Stop when done'), 'info');
      }
    } else if (name === 'new') {
      this.edit(null);
    }
  }

  edit(m) {
    const name = h('input', { type: 'text', id: 'fld-macro-name', value: m ? m.name : '', placeholder: t('name') });
    const text = h('textarea', { id: 'fld-macro-text', spellcheck: false, placeholder: t('Text to send. Use \\n for Enter, \\t for Tab, \\x03 for Ctrl-C.'), style: { minHeight: '140px' } });
    text.value = m ? m.text.replace(/\r/g, '\\n').replace(/\t/g, '\\t').replace(/[\x00-\x08\x0b-\x1f]/g, (c) => '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0')) : '';
    const modal = showModal({
      title: m ? t('Edit macro') : t('New macro'),
      body: h('div', { class: 'form-grid' }, h('label', { for: name.id }, t('Name')), name, h('label', { for: text.id }, t('Text')), text),
      buttons: [
        { label: t('Cancel'), value: null },
        { label: t('Save'), primary: true, action: (api) => {
          if (!name.value.trim()) return name.focus();
          const raw = text.value.replace(/\\x([0-9a-f]{2})/gi, (_, x) => String.fromCharCode(parseInt(x, 16))).replace(/\\n/g, '\r').replace(/\\t/g, '\t');
          const macro = { id: m ? m.id : 'm' + Date.now(), name: name.value.trim(), text: raw };
          this.save(m ? this.macros.map((x) => (x.id === m.id ? macro : x)) : [...this.macros, macro]);
          api.close(macro);
        } },
      ],
    });
    return modal.promise;
  }
}
