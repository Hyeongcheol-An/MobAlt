// Modal dialogs: session editor, settings, tunnels, host key / password / keyboard-interactive prompts.
import { h, showModal, toast, confirmDialog, TYPE_LABEL } from './ui.js';
import { THEMES } from './terminal.js';

const themeLabel = (k) => k.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const clamp = (v, min, max, def) => (Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def);
const DEFAULT_PORT = { ssh: 22, mosh: 22, telnet: 23, ftp: 21, rdp: 3389, vnc: 5900, local: 0, serial: 0 };
const BAUD_RATES = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];

function field(label, input, help) {
  // Element.append() would render a literal "null", so only include the help node when present.
  const out = [h('label', {}, label), input];
  if (help) out.push(h('div', { class: 'form-help' }, help));
  return out;
}
function text(value, attrs = {}) {
  return h('input', { type: 'text', value: value ?? '', spellcheck: false, ...attrs });
}
function num(value, attrs = {}) {
  return h('input', { type: 'number', value: value ?? '', ...attrs });
}
function check(label, checked, attrs = {}) {
  const cb = h('input', { type: 'checkbox', checked: !!checked, ...attrs });
  return { el: h('label', {}, cb, label), cb };
}
function select(options, value) {
  return h('select', {}, options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
}

/** Session editor. Resolves with the session object to save, or null. */
export function sessionEditor(app, initial = {}) {
  const s = { type: 'ssh', port: 22, authMethod: 'auto', sftpAuto: true, followCwd: false, tunnels: [], ...initial };
  let type = s.type;
  const folders = app.sessionTree.collectFolders().sort();

  // --- common
  const name = text(s.name, { placeholder: 'Session name (defaults to user@host)' });

  // icon + color (like MobaXterm's per-session icon and tab colour)
  const ICON_CHOICES = ['🐧', '🖥️', '🪟', '🍎', '☁️', '🐳', '🗄️', '🌐', '🔒', '🔑', '⚙️', '🧪', '🚀', '⭐', '🔥', '📦', '💾', '📡', '🏠', '🏢', '🎮', '🤖', '📊'];
  const COLOR_CHOICES = ['#e5534b', '#f08c3a', '#e6b422', '#4caf50', '#2fbfa7', '#4ea1ff', '#7a7dff', '#bd93f9', '#ff79c6', '#8a93a2'];
  let iconVal = s.icon || '';
  let colorVal = s.color || '';
  const iconRow = h('div', { class: 'pick-row' });
  const renderIcons = () => {
    iconRow.replaceChildren(
      h('button', { type: 'button', class: 'pick' + (iconVal ? '' : ' active'), title: 'Default (by session type)', onclick: () => { iconVal = ''; renderIcons(); } }, '—'),
      ...ICON_CHOICES.map((ic) => h('button', { type: 'button', class: 'pick' + (ic === iconVal ? ' active' : ''), onclick: () => { iconVal = ic; renderIcons(); } }, ic))
    );
  };
  renderIcons();
  const customColor = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(colorVal) ? colorVal : '#4ea1ff', title: 'Custom colour' });
  const colorRow = h('div', { class: 'pick-row' });
  const renderColors = () => {
    colorRow.replaceChildren(
      h('button', { type: 'button', class: 'pick' + (colorVal ? '' : ' active'), title: 'No colour', onclick: () => { colorVal = ''; renderColors(); } }, '—'),
      ...COLOR_CHOICES.map((c) => h('button', { type: 'button', class: 'pick swatch' + (c === colorVal ? ' active' : ''), style: { background: c }, title: c, onclick: () => { colorVal = c; renderColors(); } })),
      customColor
    );
  };
  customColor.addEventListener('input', () => { colorVal = customColor.value; renderColors(); });
  renderColors();

  const folder = text(s.folder || '', { list: 'folder-list', placeholder: '(root)' });
  const dl = h('datalist', { id: 'folder-list' }, folders.map((f) => h('option', { value: f })));
  const host = text(s.host, { placeholder: 'hostname or IP' });
  const port = num(s.port ?? DEFAULT_PORT[type], { min: 1, max: 65535 });
  const username = text(s.username, { placeholder: 'login user' });

  // --- ssh auth
  const authMethod = select([['auto', 'Automatic (key → agent → password)'], ['password', 'Password'], ['key', 'Private key'], ['agent', 'SSH agent']], s.authMethod);
  const password = h('input', { type: 'password', placeholder: s.hasPassword ? '•••••••• (saved — leave blank to keep)' : 'leave blank to be prompted', autocomplete: 'new-password' });
  const clearPw = check('Clear saved password', false);
  const keyPath = text(s.privateKeyPath, { placeholder: '~/.ssh/id_ed25519' });
  const keyBrowse = h('button', { class: 'btn small', type: 'button', onclick: async () => {
    const r = await window.api.dialog.open({ title: 'Select private key', defaultPath: app.info.home + '/.ssh', properties: ['openFile', 'showHiddenFiles'] });
    if (!r.canceled && r.filePaths[0]) keyPath.value = r.filePaths[0].replace(app.info.home, '~');
  } }, 'Browse…');
  const passphrase = h('input', { type: 'password', placeholder: s.hasPassphrase ? '•••••••• (saved)' : 'optional', autocomplete: 'new-password' });
  // rows whose relevance depends on the authentication method
  const pwRow = field('Password', password);
  const clearRow = [h('div', {}), h('div', { class: 'checks' }, clearPw.el)];
  const keyRow = field('Private key', h('div', { class: 'inline' }, keyPath, keyBrowse));
  const ppRow = field('Key passphrase', passphrase);
  const applyAuth = () => {
    const m = authMethod.value;
    const showPw = m === 'auto' || m === 'password';
    const showKey = m === 'auto' || m === 'key';
    for (const el of [...pwRow, ...clearRow]) el.hidden = !showPw;
    for (const el of [...keyRow, ...ppRow]) el.hidden = !showKey;
  };
  authMethod.addEventListener('change', applyAuth);
  const sshSessions = app.sessions.sessions.filter((x) => x.type === 'ssh' && x.id !== s.id);
  const jumpSel = select([['', '(none)'], ...sshSessions.map((x) => [x.id, `${x.name} (${x.username ? x.username + '@' : ''}${x.host})`]), ['__manual', 'Enter manually…']], s.jumpSessionId || (s.jumpHost ? '__manual' : ''));
  const jumpHost = text(s.jumpHost, { placeholder: 'user@bastion[:port]', hidden: jumpSel.value !== '__manual' });
  jumpSel.addEventListener('change', () => (jumpHost.hidden = jumpSel.value !== '__manual'));
  const x11 = check('X11 forwarding (XQuartz)', s.x11);
  const agentFwd = check('Agent forwarding', s.agentForward);
  const compression = check('Compression', s.compression);
  const legacy = check('Legacy algorithms (old devices)', s.legacyAlgorithms);
  // --- mosh / ftp
  const moshServer = text(s.moshServer, { placeholder: 'mosh-server (path on the remote host, optional)' });
  const moshPredict = select([['adaptive', 'Adaptive (default)'], ['always', 'Always'], ['never', 'Never'], ['experimental', 'Experimental']], s.moshPredict || 'adaptive');
  const ftps = check('FTPS: explicit TLS (AUTH TLS)', s.ftps);
  const ftpsInsecure = check('Accept untrusted / self-signed certificate', s.ftpsInsecure);
  const keepAlive = num(s.keepAliveInterval ?? app.settings.keepAliveInterval ?? 30, { min: 0, max: 3600 });

  // --- terminal / behaviour
  const startup = h('textarea', { spellcheck: false, placeholder: 'One command per line, typed once the terminal is ready\ne.g. cd /var/log' });
  startup.value = s.startupCommand || '';
  const sftpAuto = check('Open SFTP browser automatically', s.sftpAuto !== false);
  const followCwd = check('SFTP follows terminal folder (injects prompt hook)', s.followCwd);
  const logging = check('Log session output to file', s.logging);
  const theme = select([['', '(default)'], ...Object.keys(THEMES).map((t) => [t, themeLabel(t)])], s.theme || '');
  const fontSize = num(s.fontSize || '', { min: 8, max: 40, placeholder: String(app.settings.fontSize) });
  const notes = h('textarea', { spellcheck: false, placeholder: 'Notes' });
  notes.value = s.notes || '';

  // --- local
  const shell = text(s.shell, { placeholder: app.settings.localShell || '(default login shell)' });
  const cwd = text(s.cwd, { placeholder: '~' });

  // --- serial
  const serialSel = select([['', '(scanning…)']], '');
  const serialCustom = text(s.serialPath || '', { placeholder: 'or type a device path, e.g. /dev/cu.usbserial-1410' });
  const loadPorts = async () => {
    let ports = [];
    try {
      ports = await window.api.term.listSerialPorts();
    } catch {}
    const cur = serialCustom.value.trim() || s.serialPath || '';
    serialSel.replaceChildren(
      h('option', { value: '' }, ports.length ? '(select a port)' : '(no serial devices found)'),
      ...ports.map((p) => h('option', { value: p.path, selected: p.path === cur }, `${p.path}${p.manufacturer ? ' — ' + p.manufacturer : ''}`))
    );
  };
  serialSel.addEventListener('change', () => { if (serialSel.value) serialCustom.value = serialSel.value; });
  const serialRefresh = h('button', { class: 'btn small', type: 'button', title: 'Rescan ports', onclick: () => loadPorts() }, '↻');
  const baud = select(BAUD_RATES.map((b) => [String(b), String(b)]), String(s.baudRate || 115200));
  const dataBits = select([['8', '8 data bits'], ['7', '7 data bits'], ['6', '6'], ['5', '5']], String(s.dataBits || 8));
  const parity = select([['none', 'No parity'], ['even', 'Even'], ['odd', 'Odd']], s.parity || 'none');
  const stopBits = select([['1', '1 stop bit'], ['2', '2 stop bits']], String(s.stopBits || 1));
  const flow = select([['none', 'No flow control'], ['rtscts', 'RTS/CTS'], ['xonxoff', 'XON/XOFF']], s.flow || 'none');
  const localEcho = check('Local echo', s.localEcho);
  const newline = select([['cr', 'CR'], ['lf', 'LF'], ['crlf', 'CR+LF']], s.newline || 'cr');

  // --- tunnels
  const tunnels = (s.tunnels || []).map((t) => ({ ...t }));
  const tunnelTable = h('div');
  const renderTunnels = () => {
    tunnelTable.replaceChildren(
      h('table', { class: 'list-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Type'), h('th', {}, 'Bind'), h('th', {}, 'Destination'), h('th', {}, 'On'), h('th', {}))),
        h('tbody', {}, tunnels.map((t, i) => h('tr', {},
          h('td', {}, { local: 'Local (-L)', remote: 'Remote (-R)', dynamic: 'SOCKS (-D)' }[t.type]),
          h('td', { class: 'mono' }, `${t.bindHost || '127.0.0.1'}:${t.bindPort}`),
          h('td', { class: 'mono' }, t.type === 'dynamic' ? '—' : `${t.destHost}:${t.destPort}`),
          h('td', {}, h('input', { type: 'checkbox', checked: t.enabled !== false, onchange: (e) => (t.enabled = e.target.checked) })),
          h('td', {}, h('button', { class: 'btn small', onclick: () => { tunnels.splice(i, 1); renderTunnels(); } }, '✕'))
        )))
      ),
      h('div', { style: { marginTop: '8px' } }, h('button', { class: 'btn small', onclick: async () => { const t = await tunnelForm(); if (t) { tunnels.push({ ...t, enabled: true }); renderTunnels(); } } }, '＋ Add tunnel'))
    );
  };
  renderTunnels();

  const pages = {
    basic: h('div', { class: 'mpage active form-grid' }),
    advanced: h('div', { class: 'mpage form-grid' }),
    terminal: h('div', { class: 'mpage form-grid' }),
    tunnels: h('div', { class: 'mpage' }, h('p', { style: { color: 'var(--fg-dim)', marginTop: 0 } }, 'Port forwards started automatically when this session connects.'), tunnelTable),
  };
  const tabBtns = {};
  const tabs = h('div', { class: 'mtabs' }, Object.keys(pages).map((k) => (tabBtns[k] = h('button', { onclick: () => showPage(k) }, { basic: 'Basic', advanced: 'Advanced SSH', terminal: 'Terminal', tunnels: `Tunnels` }[k]))));
  const showPage = (k) => {
    for (const [n, p] of Object.entries(pages)) {
      p.classList.toggle('active', n === k);
      tabBtns[n].classList.toggle('active', n === k);
    }
  };
  tabBtns.basic.classList.add('active');

  const typeBtns = {};
  const picker = h('div', { class: 'type-picker' }, ['ssh', 'mosh', 'local', 'telnet', 'serial', 'ftp', 'rdp', 'vnc'].map((t) => (typeBtns[t] = h('button', { type: 'button', class: t === type ? 'active' : '', onclick: () => setType(t) }, h('span', { class: 'ico' }, { ssh: '🔐', mosh: '📶', local: '>_', telnet: '☎️', serial: '⌁', ftp: '📁', rdp: '🪟', vnc: '🖥️' }[t]), TYPE_LABEL[t]))));

  const buildBasic = () => {
    const b = pages.basic;
    b.replaceChildren();
    b.append(...field('Name', name), ...field('Folder', h('div', { class: 'inline' }, folder, dl)),
      ...field('Icon', iconRow), ...field('Colour', colorRow, 'Shown on the session, its tab and pane'));
    if (type === 'local') {
      b.append(...field('Shell', shell, 'Leave blank for your login shell'), ...field('Start folder', cwd));
    } else if (type === 'serial') {
      b.append(
        ...field('Serial port', h('div', { class: 'inline' }, serialSel, serialRefresh)),
        ...field('Device path', serialCustom),
        ...field('Baud rate', baud),
        h('label', {}, 'Framing'), h('div', { class: 'inline' }, dataBits, parity, stopBits, flow),
        h('label', {}, 'Options'), h('div', { class: 'checks' }, localEcho.el),
        ...field('Enter sends', newline)
      );
      loadPorts();
    } else {
      b.append(...field('Host', host), ...field('Port', port), ...field('Username', username));
    }
    if (type === 'ssh') {
      b.append(...field('Authentication', authMethod), ...pwRow, ...clearRow, ...keyRow, ...ppRow);
      applyAuth();
    }
    if (type === 'mosh') {
      b.append(...field('Private key', h('div', { class: 'inline' }, keyPath, keyBrowse), 'Used by the ssh bootstrap; agent keys and password prompts work in the terminal'),
        ...field('mosh-server', moshServer), ...field('Prediction', moshPredict),
        h('div', { class: 'full form-help', style: { gridColumn: '1 / -1' } }, 'Needs the mosh client on this Mac (brew install mosh) and mosh-server on the remote host; UDP ports 60000-61000 must be reachable.'));
    }
    if (type === 'ftp') {
      b.append(...field('Password', password), h('div', {}), h('div', { class: 'checks' }, clearPw.el),
        h('label', {}, 'Security'), h('div', { class: 'checks' }, ftps.el, ftpsInsecure.el),
        h('div', { class: 'full form-help', style: { gridColumn: '1 / -1' } }, 'Leave the username empty for anonymous FTP. Files are browsed, transferred and edited in the Sftp panel.'));
    }
    if (type === 'rdp' || type === 'vnc') {
      b.append(h('div', { class: 'full form-help', style: { gridColumn: '1 / -1' } }, type === 'rdp' ? 'Opens in Windows App / Microsoft Remote Desktop via a generated .rdp file.' : 'Opens in macOS Screen Sharing (vnc:// URL).'));
    }
  };
  pages.advanced.append(
    ...field('Jump host', h('div', { class: 'inline', style: { flexDirection: 'column', alignItems: 'stretch' } }, jumpSel, jumpHost), 'ProxyJump: connect through a bastion'),
    h('label', {}, 'Options'), h('div', { class: 'checks' }, x11.el, agentFwd.el, compression.el, legacy.el),
    ...field('Keep-alive (s)', keepAlive)
  );
  pages.terminal.append(
    ...field('Startup commands', startup),
    h('label', {}, 'Behaviour'), h('div', { class: 'checks' }, sftpAuto.el, followCwd.el, logging.el),
    ...field('Theme', theme), ...field('Font size', fontSize), ...field('Notes', notes)
  );

  let prevType = s.type;
  const setType = (t) => {
    for (const [k, b] of Object.entries(typeBtns)) b.classList.toggle('active', k === t);
    // keep a custom port, but follow the type's default when the port was still the previous type's default
    if (!port.value || +port.value === DEFAULT_PORT[prevType] || +port.value === 0) port.value = DEFAULT_PORT[t] || '';
    prevType = type = t;
    name.placeholder = t === 'local' ? 'Session name (defaults to "Local")' : t === 'serial' ? 'Session name (defaults to device @ baud)' : 'Session name (defaults to user@host)';
    tabBtns.advanced.hidden = t !== 'ssh';
    tabBtns.tunnels.hidden = t !== 'ssh';
    tabBtns.terminal.hidden = t === 'rdp' || t === 'vnc' || t === 'ftp';
    sftpAuto.el.hidden = followCwd.el.hidden = t !== 'ssh';
    buildBasic();
    showPage('basic');
  };
  setType(type);

  const body = h('div', {}, tabs, picker, ...Object.values(pages));
  let dirty = false;
  body.addEventListener('input', () => { dirty = true; });
  body.addEventListener('change', () => { dirty = true; });
  body.addEventListener('click', (e) => { if (e.target.closest('.pick-row, .type-picker')) dirty = true; });
  const modal = showModal({
    title: s.id ? `Edit session — ${s.name}` : 'New session',
    width: 'wide',
    closeOnBackdrop: false,
    beforeClose: () => !dirty || confirmDialog('Discard the changes to this session?', { title: 'Discard changes', okLabel: 'Discard', danger: true }),
    body,
    buttons: [
      { label: 'Cancel', value: null },
      { label: 'Save & Connect', action: (api) => { const out = collect(); if (out) api.close({ ...out, _connect: true }); } },
      { label: 'Save', primary: true, action: (api) => { const out = collect(); if (out) api.close(out); } },
    ],
  });
  function collect() {
    const serialPath = serialCustom.value.trim() || serialSel.value;
    if (type === 'serial' && !serialPath) {
      serialCustom.focus();
      toast('Serial device path is required', 'warn');
      return null;
    }
    if (type !== 'local' && type !== 'serial' && !host.value.trim()) {
      host.focus();
      toast('Host is required', 'warn');
      return null;
    }
    if (type !== 'local' && type !== 'serial') {
      const pn = parseInt(port.value, 10);
      if (!(pn >= 1 && pn <= 65535)) {
        toast('Port must be between 1 and 65535', 'warn');
        showPage('basic');
        port.focus();
        return null;
      }
    }
    const out = {
      ...s,
      type,
      name: name.value.trim() || (type === 'local' ? 'Local' : type === 'serial' ? `${serialPath.replace('/dev/', '')} @ ${baud.value}` : `${username.value ? username.value + '@' : ''}${host.value.trim()}`),
      serialPath,
      baudRate: parseInt(baud.value, 10) || 115200,
      dataBits: parseInt(dataBits.value, 10) || 8,
      stopBits: parseInt(stopBits.value, 10) || 1,
      parity: parity.value,
      flow: flow.value,
      localEcho: localEcho.cb.checked,
      newline: newline.value,
      folder: folder.value.trim().replace(/^\/+|\/+$/g, ''),
      icon: iconVal,
      color: colorVal,
      host: host.value.trim(),
      port: parseInt(port.value, 10) || DEFAULT_PORT[type],
      username: username.value.trim(),
      authMethod: authMethod.value,
      privateKeyPath: keyPath.value.trim(),
      jumpSessionId: jumpSel.value && jumpSel.value !== '__manual' ? jumpSel.value : '',
      jumpHost: jumpSel.value === '__manual' ? jumpHost.value.trim() : '',
      x11: x11.cb.checked,
      agentForward: agentFwd.cb.checked,
      compression: compression.cb.checked,
      legacyAlgorithms: legacy.cb.checked,
      keepAliveInterval: parseInt(keepAlive.value, 10) || 0,
      startupCommand: startup.value.replace(/\n/g, '\r').trim(),
      sftpAuto: sftpAuto.cb.checked,
      followCwd: followCwd.cb.checked,
      logging: logging.cb.checked,
      theme: theme.value,
      fontSize: parseInt(fontSize.value, 10) || undefined,
      notes: notes.value,
      shell: shell.value.trim(),
      cwd: cwd.value.trim(),
      moshServer: moshServer.value.trim(),
      moshPredict: moshPredict.value,
      ftps: ftps.cb.checked,
      ftpsInsecure: ftpsInsecure.cb.checked,
      tunnels,
    };
    delete out._connect;
    // secrets: undefined = keep stored, '' = clear, string = set
    if (clearPw.cb.checked) out.password = '';
    else if (password.value) out.password = password.value;
    else delete out.password;
    if (passphrase.value) out.passphrase = passphrase.value;
    else delete out.passphrase;
    return out;
  }
  return modal.promise;
}

export function tunnelForm(initial = {}) {
  const type = select([['local', 'Local (-L): local port → remote destination'], ['remote', 'Remote (-R): remote port → local destination'], ['dynamic', 'Dynamic (-D): SOCKS5 proxy']], initial.type || 'local');
  const bindHost = text(initial.bindHost || '127.0.0.1');
  const bindPort = num(initial.bindPort || '', { min: 0, max: 65535, placeholder: '8080' });
  const destHost = text(initial.destHost || '', { placeholder: 'localhost' });
  const destPort = num(initial.destPort || '', { min: 1, max: 65535, placeholder: '80' });
  const name = text(initial.name || '', { placeholder: 'optional label' });
  const destRow = [h('label', {}, 'Destination'), h('div', { class: 'inline' }, destHost, ':', destPort)];
  type.addEventListener('change', () => destRow.forEach((e) => (e.hidden = type.value === 'dynamic')));
  const m = showModal({
    title: 'Tunnel',
    body: h('div', { class: 'form-grid' }, ...field('Type', type), ...field('Label', name), h('label', {}, 'Bind'), h('div', { class: 'inline' }, bindHost, ':', bindPort), ...destRow),
    buttons: [
      { label: 'Cancel', value: null },
      { label: 'OK', primary: true, action: (api) => {
        const bp = parseInt(bindPort.value, 10);
        if (isNaN(bp) || bp < 0 || bp > 65535) { toast('Bind port is required (0-65535)', 'warn'); return bindPort.focus(); }
        if (type.value !== 'dynamic' && !destHost.value.trim()) { toast('Destination host is required', 'warn'); return destHost.focus(); }
        if (type.value !== 'dynamic' && !(parseInt(destPort.value, 10) >= 1 && parseInt(destPort.value, 10) <= 65535)) { toast('Destination port must be 1-65535', 'warn'); return destPort.focus(); }
        api.close({ type: type.value, name: name.value.trim(), bindHost: bindHost.value.trim() || '127.0.0.1', bindPort: bp, destHost: destHost.value.trim(), destPort: parseInt(destPort.value, 10) || 0 });
      } },
    ],
  });
  return m.promise;
}

/** Tunnels manager: active tunnels + start a new one through an open connection or a saved session. */
export async function tunnelsDialog(app, preset = {}) {
  const table = h('div');
  const render = async () => {
    const list = await window.api.tunnels.list();
    table.replaceChildren(
      list.length
        ? h('table', { class: 'list-table' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Type'), h('th', {}, 'Bind'), h('th', {}, 'Destination'), h('th', {}, 'Via'), h('th', {}, 'Status'), h('th', {}, 'Conns'), h('th', {}))),
          h('tbody', {}, list.map((t) => h('tr', {},
            h('td', {}, { local: '-L', remote: '-R', dynamic: '-D' }[t.type]),
            h('td', { class: 'mono' }, `${t.bindHost || '127.0.0.1'}:${t.bindPort}`),
            h('td', { class: 'mono' }, t.type === 'dynamic' ? 'SOCKS5' : `${t.destHost}:${t.destPort}`),
            h('td', {}, t.sessionName || t.connId || ''),
            h('td', {}, h('span', { class: 'badge ' + t.status, title: t.error || '' }, t.status), t.error ? h('div', { class: 'form-help', style: { gridColumn: 'auto', color: 'var(--danger, #e5534b)', marginTop: '2px' } }, t.error) : null),
            h('td', {}, String(t.connections || 0)),
            h('td', {}, h('button', { class: 'btn small', onclick: async () => { await window.api.tunnels.stop(t.id); render(); } }, 'Stop'))
          ))))
        : h('div', { style: { color: 'var(--fg-faint)', padding: '10px 0' } }, 'No active tunnels.')
    );
  };
  const off = window.api.on('tunnels:changed', () => render());
  await render();

  const openConns = app.workspace.allPanes().filter((p) => p.kind === 'ssh' && p.status === 'connected');
  const sessions = app.sessions.sessions.filter((x) => x.type === 'ssh');
  const viaOptions = [
    ...openConns.map((p) => ['conn:' + p.termId, `Open connection: ${p.title}`]),
    ...sessions.map((x) => ['sess:' + x.id, `New connection: ${x.name}`]),
  ];
  const via = select(viaOptions.length ? viaOptions : [['', '(no SSH sessions yet — create one in the Sessions panel)']],
    preset.sessionId ? 'sess:' + preset.sessionId : openConns[0] ? 'conn:' + openConns[0].termId : '');
  if (!viaOptions.length) via.disabled = true;
  const form = h('div', { class: 'form-grid', style: { marginTop: '12px' } },
    ...field('Via', via),
    h('label', {}), h('div', {}, h('button', { class: 'btn primary small', disabled: !viaOptions.length, onclick: async () => {
      if (!via.value) return toast('No SSH session available', 'warn');
      const t = await tunnelForm();
      if (!t) return;
      const [kind, id] = via.value.split(':');
      try {
        await window.api.tunnels.start(kind === 'conn' ? { ...t, connId: id } : { ...t, sessionId: id });
      } catch (e) {
        toast(e.message, 'error');
      }
      render();
    } }, '＋ New tunnel…'))
  );
  const m = showModal({
    title: 'SSH Tunnels (port forwarding)',
    width: 'wide',
    body: h('div', {}, table, form),
    buttons: [{ label: 'Close', value: null }],
    onClose: () => off(),
  });
  return m.promise;
}

export function settingsDialog(app) {
  const s = app.settings;
  const fontFamily = text(s.fontFamily);
  const fontSize = num(s.fontSize, { min: 8, max: 40 });
  const lineHeight = num(s.lineHeight || 1, { min: 0.8, max: 2, step: 0.05 });
  const cursorStyle = select([['block', 'Block'], ['underline', 'Underline'], ['bar', 'Bar']], s.cursorStyle);
  const cursorBlink = check('Blink cursor', s.cursorBlink);
  const scrollback = num(s.scrollback, { min: 100, max: 1000000 });
  const theme = select(Object.keys(THEMES).map((t) => [t, themeLabel(t)]), s.theme);
  const rightClickPaste = check('Right-click pastes (⇧-right-click for menu)', s.rightClickPaste);
  const copyOnSelect = check('Copy on select', s.copyOnSelect);
  const optMeta = check('Option key acts as Meta/Alt', s.macOptionIsMeta !== false);
  const localShell = text(s.localShell, { placeholder: '(login shell)' });
  const shellInt = check('zsh/bash integration (folder following)', s.localShellIntegration !== false);
  const editor = text(s.editorCommand, { placeholder: 'e.g. code --wait {file}   (blank = TextEdit)' });
  const confirmClose = check('Confirm quit with open SSH sessions', s.confirmClose);
  const restoreWs = check('Restore tabs & split layout at startup', s.restoreWorkspace !== false);
  const sftpAutoOpen = check('Switch to SFTP panel when SSH connects', s.sftpAutoOpen !== false);
  const downloadDir = text(s.downloadDir, { placeholder: '~/Downloads' });
  const logDir = text(s.logDir, { placeholder: '~/Documents/MobAlt Logs' });
  const keepAlive = num(s.keepAliveInterval, { min: 0, max: 3600 });
  const autoUpdate = check('Check for updates at startup', s.autoUpdate !== false);
  const m = showModal({
    title: 'Settings',
    width: 'wide',
    body: h('div', { class: 'form-grid' },
      ...field('Font family', fontFamily), ...field('Font size', fontSize), ...field('Line height', lineHeight),
      ...field('Cursor', cursorStyle), h('label', {}), h('div', { class: 'checks' }, cursorBlink.el),
      ...field('Scrollback lines', scrollback), ...field('Theme', theme),
      h('label', {}, 'Mouse / keys'), h('div', { class: 'checks' }, rightClickPaste.el, copyOnSelect.el, optMeta.el),
      ...field('Local shell', localShell), h('label', {}), h('div', { class: 'checks' }, shellInt.el),
      ...field('External editor', editor, '{file} is replaced by the temp file path; omit it to append the path'),
      ...field('Download folder', downloadDir), ...field('Log folder', logDir), ...field('SSH keep-alive (s)', keepAlive),
      h('label', {}, 'Behaviour'), h('div', { class: 'checks' }, confirmClose.el, sftpAutoOpen.el, restoreWs.el),
      h('label', {}, 'Updates'), h('div', { class: 'checks' }, autoUpdate.el, h('button', { class: 'btn small', type: 'button', onclick: () => window.api.app.checkUpdates() }, 'Check now')),
      h('label', {}, 'Data'), h('div', {}, h('button', { class: 'btn small', onclick: () => window.api.shell.openPath(app.info.userData) }, 'Open config folder'))
    ),
    buttons: [
      { label: 'Cancel', value: null },
      { label: 'Save', primary: true, action: (api) => api.close({
        fontFamily: fontFamily.value.trim() || s.fontFamily, fontSize: clamp(parseInt(fontSize.value, 10), 8, 40, 13), lineHeight: clamp(parseFloat(lineHeight.value), 0.8, 2, 1),
        cursorStyle: cursorStyle.value, cursorBlink: cursorBlink.cb.checked, scrollback: clamp(parseInt(scrollback.value, 10), 100, 1000000, 10000), theme: theme.value,
        rightClickPaste: rightClickPaste.cb.checked, copyOnSelect: copyOnSelect.cb.checked, macOptionIsMeta: optMeta.cb.checked,
        localShell: localShell.value.trim(), localShellIntegration: shellInt.cb.checked, editorCommand: editor.value.trim(),
        confirmClose: confirmClose.cb.checked, sftpAutoOpen: sftpAutoOpen.cb.checked, restoreWorkspace: restoreWs.cb.checked, downloadDir: downloadDir.value.trim(), logDir: logDir.value.trim(),
        keepAliveInterval: clamp(parseInt(keepAlive.value, 10), 0, 3600, 30), autoUpdate: autoUpdate.cb.checked,
      }) },
    ],
  });
  return m.promise;
}

export function hostKeyDialog(p) {
  const m = showModal({
    title: p.status === 'mismatch' ? '⚠️ Host key changed!' : 'Unknown host key',
    closeOnBackdrop: false,
    body: h('div', {},
      p.status === 'mismatch' ? h('div', { class: 'warn' }, 'The host key for this server does not match the saved one. This could be a man-in-the-middle attack, or the server was reinstalled.') : h('p', {}, `The authenticity of host ${p.host}:${p.port} can't be established.`),
      h('div', {}, h('b', {}, `${p.host}:${p.port}`), ` (${p.keyType})`),
      h('div', { class: 'hostkey-fp' }, p.fingerprint.sha256, h('br'), p.fingerprint.md5),
      h('p', { style: { color: 'var(--fg-dim)' } }, 'Accept to continue and remember this key.')
    ),
    buttons: [
      { label: 'Cancel', value: false },
      { label: p.status === 'mismatch' ? 'Accept new key' : 'Accept', primary: true, danger: p.status === 'mismatch', value: true },
    ],
  });
  return m.promise.then((r) => !!r);
}

export function passwordDialog(p) {
  const input = h('input', { type: 'password', autocomplete: 'current-password', style: { width: '100%', height: '30px', padding: '0 8px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg)' } });
  const save = h('input', { type: 'checkbox', checked: false });
  const m = showModal({
    title: p.title || 'Password',
    width: 'narrow',
    closeOnBackdrop: false,
    body: h('div', {}, h('div', { style: { marginBottom: '8px' } }, p.message), input,
      p.session && p.session.id ? h('label', { style: { display: 'flex', gap: '6px', marginTop: '10px', alignItems: 'center' } }, save, `Save in session "${p.session.name}" (Keychain-encrypted)`) : null),
    buttons: [
      { label: 'Cancel', value: null },
      { label: 'OK', primary: true, action: (api) => api.close({ password: input.value, save: save.checked }) },
    ],
  });
  setTimeout(() => input.focus(), 20);
  return m.promise;
}

export function kbdIntDialog(p) {
  const inputs = (p.prompts || []).map((pr) => h('input', { type: pr.echo ? 'text' : 'password', style: { width: '100%', height: '30px', padding: '0 8px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg)', marginBottom: '8px' } }));
  const m = showModal({
    title: p.name || 'Authentication',
    width: 'narrow',
    closeOnBackdrop: false,
    body: h('div', {}, h('div', { style: { color: 'var(--fg-dim)', marginBottom: '8px' } }, p.label), p.instructions ? h('pre', { style: { whiteSpace: 'pre-wrap' } }, p.instructions) : null,
      (p.prompts || []).map((pr, i) => h('div', {}, h('div', {}, pr.prompt), inputs[i]))),
    buttons: [
      { label: 'Cancel', value: null },
      { label: 'OK', primary: true, action: (api) => api.close(inputs.map((i) => i.value)) },
    ],
  });
  setTimeout(() => inputs[0] && inputs[0].focus(), 20);
  return m.promise;
}

export function shortcutsDialog(app) {
  const rows = [
    ['New session', '⌘N'], ['New local terminal', '⌘T'], ['Quick connect', '⇧⌘N'], ['Duplicate session', '⇧⌘T'], ['Reconnect', '⌘R'], ['Close tab', '⌘W'],
    ['Split right / down', '⌘D / ⇧⌘D'], ['Grid 2 / 4 / 6 / 8 panes', '⌥⌘2 / ⌥⌘4 / ⌥⌘6 / ⌥⌘8'], ['Unsplit', '⌥⌘1'], ['Close pane', '⇧⌘W'], ['Next pane', '⌘]'], ['Next / previous tab', '⌃Tab / ⌃⇧Tab'],
    ['Find', '⌘F'], ['Clear terminal', '⌘K'], ['Zoom', '⌘= / ⌘- / ⌘0'], ['Toggle sidebar', '⌘B'], ['Sessions / SFTP / Tools / Macros', '⌘1 / ⌘2 / ⌘3 / ⌘4'],
    ['MultiExec', '⇧⌘M'], ['Tunnels', '⇧⌘U'], ['Settings', '⌘,'], ['Copy / Paste', '⌘C / ⌘V'], ['Paste (terminal)', app.settings.rightClickPaste !== false ? 'Right-click' : '⌘V'], ['Terminal menu', app.settings.rightClickPaste !== false ? '⇧Right-click' : 'Right-click'],
    ['Switch to tab 1-9', '⌃⌘1 … ⌃⌘9'], ['Newline in TUI apps (ESC+CR)', '⇧Enter / ⌥Enter'],
  ];
  showModal({ title: 'Keyboard shortcuts', body: h('div', { class: 'shortcuts' }, rows.map(([a, b]) => h('div', {}, h('span', {}, a), h('span', { class: 'kbd' }, b)))), buttons: [{ label: 'Close', value: null }] });
}
