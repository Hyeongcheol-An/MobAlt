// Tools panel (ping/traceroute/port scan/DNS/net info) and Macros panel.
import { $, h, contextMenu, confirmDialog, promptDialog, toast, showModal } from './ui.js';

export class ToolsPanel {
  constructor(app) {
    this.app = app;
    this.out = $('#tool-output');
    this.host = $('#tool-host');
    this.running = null;
    for (const b of document.querySelectorAll('[data-tool]')) b.addEventListener('click', () => this.run(b.dataset.tool));
    this.host.addEventListener('keydown', (e) => e.key === 'Enter' && this.run('ping'));
    window.api.on('tools:output', ({ id, text }) => {
      if (id === this.running) this.append(text);
    });
    window.api.on('tools:done', ({ id }) => {
      if (id === this.running) this.running = null;
    });
  }

  append(text) {
    this.out.textContent += text;
    this.out.scrollTop = this.out.scrollHeight;
  }

  async run(tool) {
    const host = this.host.value.trim();
    if (tool === 'stop') {
      if (this.running) await window.api.tools.stop(this.running);
      return;
    }
    if (tool !== 'netinfo' && !host) return toast('Enter a host', 'warn');
    if (this.running) await window.api.tools.stop(this.running);
    this.out.textContent = '';
    try {
      if (tool === 'ping') this.running = await window.api.tools.ping(host, 5);
      else if (tool === 'traceroute') this.running = await window.api.tools.traceroute(host);
      else if (tool === 'lookup') {
        this.append(`Resolving ${host}…\n`);
        const r = await window.api.tools.lookup(host);
        const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
        const mx = r.mx || [], txt = r.txt || [], ptr = r.reverse || [];
        if (r.error) this.append(`  ${r.error}\n`);
        for (const a of r.addresses || []) this.append(`  ${a.family === 6 ? 'AAAA' : 'A   '}  ${a.address}\n`);
        for (const m of mx) this.append(`  MX    ${m.priority} ${m.exchange}\n`);
        for (const t of txt) this.append(`  TXT   ${t.join('')}\n`);
        for (const p of ptr) this.append(`  PTR   ${p}\n`);
        // say explicitly what was not found instead of ending the listing silently
        if (isIp) {
          if (!ptr.length) this.append(`  (no PTR record: ${host} has no reverse DNS name)\n`);
        } else if (!r.error) {
          if (!mx.length) this.append('  (no MX records)\n');
          if (!txt.length) this.append('  (no TXT records)\n');
        }
        if (!r.error && !(r.addresses || []).length && !ptr.length) this.append('  no records\n');
      } else if (tool === 'netinfo') {
        const r = await window.api.tools.netinfo();
        this.append(`Hostname: ${r.hostname}\nDNS: ${r.dns.join(', ')}\n`);
        let last = null;
        for (const i of r.interfaces) {
          if (i.name !== last) { this.append(`\n${i.name}${i.mac && i.mac !== '00:00:00:00:00:00' ? `  (${i.mac})` : ''}\n`); last = i.name; }
          this.append(`  ${i.family === 'IPv6' ? 'v6' : 'v4'}  ${i.address}${i.netmask ? ' / ' + i.netmask : ''}\n`);
        }
      } else if (tool === 'portscan') {
        const from = $('#tool-port-from').value.trim() === '' ? 1 : parseInt($('#tool-port-from').value, 10);
        const to = $('#tool-port-to').value.trim() === '' ? 1024 : parseInt($('#tool-port-to').value, 10);
        if (!(from >= 1 && from <= 65535) || !(to >= 1 && to <= 65535)) return toast('Ports must be between 1 and 65535', 'warn');
        if (from > to) return toast('The first port must not be greater than the last', 'warn');
        this.append(`Scanning ${host} ports ${from}-${to}…\n`);
        const t0 = Date.now();
        const open = await window.api.tools.portScan(host, from, to);
        this.append(open.length ? open.map((p) => `  ${p}/tcp open`).join('\n') + '\n' : '  no open ports found\n');
        this.append(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
      }
    } catch (e) {
      this.append(`error: ${e.message}\n`);
    }
  }
}

export class MacrosPanel {
  constructor(app) {
    this.app = app;
    this.list = $('#macro-list');
    this.recBtn = $('#macro-record');
    for (const b of document.querySelectorAll('[data-macro]')) b.addEventListener('click', () => this.cmd(b.dataset.macro));
    this.render();
  }

  get macros() {
    return this.app.settings.macros || [];
  }

  async save(macros) {
    await this.app.saveSettings({ macros });
    this.render();
  }

  render() {
    this.list.replaceChildren();
    if (!this.macros.length) {
      this.list.append(h('div', { class: 'tree-empty' }, 'No macros. Press ● Rec to record keystrokes in the active terminal, or ＋ to type one.'));
      return;
    }
    for (const m of this.macros) {
      const row = h('div', { class: 'tree-row', title: m.text.slice(0, 200) }, h('span', { class: 'ico' }, '▶'), h('span', { class: 'label' }, m.name), h('span', { class: 'sub' }, `${m.text.length} ch`));
      row.addEventListener('dblclick', () => this.play(m));
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        contextMenu(e.clientX, e.clientY, [
          { label: 'Play in Active Terminal', action: () => this.play(m) },
          { label: 'Play in All Terminals', action: () => this.play(m, true) },
          '-',
          { label: 'Edit…', action: () => this.edit(m) },
          { label: 'Rename…', action: async () => { const n = await promptDialog('Rename macro', { value: m.name }); if (n) this.save(this.macros.map((x) => (x.id === m.id ? { ...x, name: n } : x))); } },
          '-',
          { label: 'Delete', danger: true, action: async () => { if (await confirmDialog(`Delete macro "${m.name}"?`, { okLabel: 'Delete', danger: true })) this.save(this.macros.filter((x) => x.id !== m.id)); } },
        ]);
      });
      this.list.append(row);
    }
  }

  play(m, all = false) {
    const panes = all ? this.app.workspace.allPanes() : [this.app.activePane()].filter(Boolean);
    if (!panes.length) return toast('No active terminal', 'warn');
    for (const p of panes) p.write(m.text);
    if (!all) panes[0].focus();
  }

  async cmd(name) {
    if (name === 'record') {
      if (this.app.macroRecorder) {
        const text = this.app.macroRecorder.text;
        this.app.macroRecorder = null;
        this.recBtn.classList.remove('on');
        this.recBtn.textContent = '● Rec';
        if (!text) return toast('Nothing recorded', 'warn');
        let n = await promptDialog('Save macro', { label: `${text.length} characters recorded`, placeholder: 'macro name' });
        while (n !== null && !n.trim()) {
          toast('Give the macro a name', 'warn');
          n = await promptDialog('Save macro', { label: `${text.length} characters recorded`, placeholder: 'macro name' });
        }
        if (!n) return;
        this.save([...this.macros, { id: 'm' + Date.now(), name: n, text }]);
      } else {
        if (!this.app.activePane()) return toast('Focus a terminal first', 'warn');
        this.app.macroRecorder = { text: '' };
        this.recBtn.classList.add('on');
        this.recBtn.textContent = '■ Stop';
        this.app.activePane().focus();
        toast('Recording keystrokes… press ■ Stop when done', 'info');
      }
    } else if (name === 'new') {
      this.edit(null);
    }
  }

  edit(m) {
    const name = h('input', { type: 'text', value: m ? m.name : '', placeholder: 'name' });
    const text = h('textarea', { spellcheck: false, placeholder: 'Text to send. Use \\n for Enter, \\t for Tab, \\x03 for Ctrl-C.', style: { minHeight: '140px' } });
    text.value = m ? m.text.replace(/\r/g, '\\n').replace(/\t/g, '\\t').replace(/[\x00-\x08\x0b-\x1f]/g, (c) => '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0')) : '';
    const modal = showModal({
      title: m ? 'Edit macro' : 'New macro',
      body: h('div', { class: 'form-grid' }, h('label', {}, 'Name'), name, h('label', {}, 'Text'), text),
      buttons: [
        { label: 'Cancel', value: null },
        { label: 'Save', primary: true, action: (api) => {
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
