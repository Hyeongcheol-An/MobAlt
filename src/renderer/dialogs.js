// Modal dialogs: session editor, settings, tunnels, host key / password / keyboard-interactive prompts.
import { h, showModal, toast, confirmDialog, TYPE_LABEL, icon, ipcMessage } from './ui.js';
import { THEMES } from './terminal.js';
import { mix, contrast } from './theme.js';
import { analysePaste, KIND_LABEL, DANGER_KINDS, PASTE_CONFIRM_CHARS } from './pasteguard.js';
import { DEFAULT_RULES, COLOR_KEYS, compileRules, normalizeRule } from './highlight.js';
import { t, tn, LANGUAGES, SYSTEM_LOCALE, languageOf } from './i18n.js';

const themeLabel = (k) => k.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
/**
 * Settings → Theme: a sample prompt painted in the chosen theme's own colours (inline styles, never the chrome's
 * tokens), so the preview reads the same whatever the window currently looks like.
 */
function paintThemePreview(el, name) {
  const th = THEMES[name] || THEMES['moba-dark'];
  el.replaceChildren(
    h('span', { style: { color: th.green } }, 'user@host'), ':', h('span', { style: { color: th.blue } }, '~'), '$ ls ',
    h('span', { style: { color: th.cyan } }, 'src '), h('span', { style: { color: th.magenta } }, 'docs '), h('span', { style: { color: th.yellow } }, 'README')
  );
  // the outline: the theme's bright black where it shows against the chip (Solarized's equals its background), else a mid-tone of its text
  const border = th.brightBlack && contrast(th.brightBlack, th.background) >= 1.5 ? th.brightBlack : mix(th.foreground, th.background, 0.5);
  Object.assign(el.style, { background: th.background, color: th.foreground, borderColor: border });
  el.title = t('{theme}: the terminal colours', { theme: themeLabel(name) });
  return el;
}
const clamp = (v, min, max, def) => (Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def);
const DEFAULT_PORT = { ssh: 22, mosh: 22, telnet: 23, ftp: 21, rdp: 3389, vnc: 5900, local: 0, serial: 0 };
const BAUD_RATES = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];
// Labels looked up when a row is rendered (never at module load), so they follow the interface language.
/** A tunnel's type as the session editor's Tunnels table shows it. */
const tunnelTypeLabel = (type) => (type === 'remote' ? t('Remote (-R)') : type === 'dynamic' ? t('SOCKS (-D)') : t('Local (-L)'));
/** A tunnel's status word (tunnels.js) as the Tunnels dialog's badge shows it; an unknown one shows as it is. */
const TUNNEL_STATUS = { active: () => t('active'), starting: () => t('starting'), connecting: () => t('connecting'), error: () => t('error'), disconnected: () => t('disconnected'), stopped: () => t('stopped') };
const tunnelStatusLabel = (status) => (TUNNEL_STATUS[status] ? TUNNEL_STATUS[status]() : String(status || ''));
/** The highlight colour slots (highlight.js COLOR_KEYS) with their user-facing names; a slot without one keeps its own label. */
const COLOUR_NAME = { red: () => t('Red'), yellow: () => t('Yellow'), green: () => t('Green'), blue: () => t('Blue'), magenta: () => t('Magenta'), cyan: () => t('Cyan'), accent: () => t('Accent'), 'accent-dim': () => t('Accent (dim)'), dim: () => t('Dim'), text: () => t('Text') };
const colourOptions = () => COLOR_KEYS.map(([k, label]) => [k, COLOUR_NAME[k] ? COLOUR_NAME[k]() : label]);

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
/**
 * A labelled form row. The visible label names the control for assistive tech (VoiceOver: "Font size, stepper"):
 * the control gets a stable id derived from the label text (`fld-font-size`; a numbered one if that id is already on
 * screen in another dialog) and the label points at it. `input` may be a wrapper (an .inline group, the Theme
 * preview): then its first input/select/textarea is the one named; a picker row (role=radiogroup) carries its own
 * aria-label and is left alone, as are controls that already have an id.
 */
function field(label, input, help) {
  const lab = h('label', {}, label);
  const ctl = input.matches('input, select, textarea') ? input : [...input.querySelectorAll('input, select, textarea')].find((c) => !c.closest('[role=radiogroup]'));
  if (ctl) {
    if (!ctl.id) {
      const base = `fld-${slug(label) || 'field'}`;
      let id = base;
      for (let n = 2; document.getElementById(id); n++) id = `${base}-${n}`;
      ctl.id = id;
    }
    lab.htmlFor = ctl.id;
  }
  // Element.append() would render a literal "null", so only include the help node when present.
  const out = [lab, input];
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
  const { title, ...rest } = attrs; // a title explains the whole row (label + box), not only the box
  const cb = h('input', { type: 'checkbox', checked: !!checked, ...rest });
  return { el: h('label', { title }, cb, label), cb };
}
function select(options, value, attrs = {}) {
  return h('select', attrs, options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
}
/** One pick of a picker row (role=radio): only the chosen one (or `extra.stop`) is in the Tab order, see pickRow(). */
function pick(content, checked, title, onclick, extra = {}) {
  return h('button', { type: 'button', class: 'pick' + (extra.class ? ' ' + extra.class : '') + (checked ? ' active' : ''), role: 'radio', 'aria-checked': String(checked), tabindex: checked || extra.stop ? 0 : -1, title, style: extra.style, onclick }, content);
}
/**
 * A picker row is ONE Tab stop (roving tabindex): ←/→/↑/↓ move between the picks (wrapping), Home/End jump,
 * Enter/Space choose (the button's own click). The Tab stop follows the focus; a re-render keeps the focus.
 */
function pickRow(label) {
  const row = h('div', { class: 'pick-row', role: 'radiogroup', 'aria-label': label });
  row.addEventListener('keydown', (e) => {
    const picks = [...row.querySelectorAll('.pick')];
    const i = picks.indexOf(e.target), n = picks.length;
    if (i < 0 || e.metaKey || e.ctrlKey || e.altKey) return;
    let to;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = picks[(i + 1) % n];
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = picks[(i - 1 + n) % n];
    else if (e.key === 'Home') to = picks[0];
    else if (e.key === 'End') to = picks[n - 1];
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.target.click(); return; } // one click: the prevented keydown cancels the button's own activation
    else return;
    e.preventDefault();
    to.focus();
  });

  row.addEventListener('focusin', (e) => {
    if (!e.target.classList.contains('pick')) return;
    for (const p of row.querySelectorAll('.pick')) p.tabIndex = p === e.target ? 0 : -1;
  });
  /** Replace the picks; focus (if it was in the row) lands on the chosen one. */
  row.fill = (...picks) => {
    const had = row.contains(document.activeElement);
    row.replaceChildren(...picks);
    if (had) row.querySelector('.pick[tabindex="0"]')?.focus();
  };
  return row;
}

/**
 * ←/→ (↑/↓) on a dialog's `.mtabs` strip move between its section tabs (wrapping, hidden ones skipped) and show that
 * section; Home/End jump to the first/last. Every tab stays a Tab stop of its own, so Tab/⇧Tab reach them as well.
 */
function tabStripKeys(strip) {
  strip.addEventListener('keydown', (e) => {
    const tabs = [...strip.querySelectorAll('button:not([hidden])')];
    const i = tabs.indexOf(e.target), n = tabs.length;
    if (i < 0 || e.metaKey || e.ctrlKey || e.altKey) return;
    let to;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = tabs[(i + 1) % n];
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = tabs[(i - 1 + n) % n];
    else if (e.key === 'Home') to = tabs[0];
    else if (e.key === 'End') to = tabs[n - 1];
    else return;
    e.preventDefault();
    to.focus();
    to.click();
  });
  return strip;
}
let tabSeq = 0;
/**
 * Section tabs of a dialog: the `.mtabs` strip (a tablist) and one `.mpage` panel per section, the first one shown.
 * `sections` = [[key, label, panel], …]; returns { strip, pages, btns, show(key) }. Every panel stays in the DOM, so a
 * Save handler reads all its fields whichever section is in front.
 */
function modalTabs(sections) {
  const seq = ++tabSeq;
  const btns = {}, pages = {};
  const show = (k) => {
    for (const key of Object.keys(pages)) {
      pages[key].classList.toggle('active', key === k);
      btns[key].classList.toggle('active', key === k);
      btns[key].setAttribute('aria-selected', String(key === k));
    }
  };
  const strip = tabStripKeys(h('div', { class: 'mtabs', role: 'tablist' }, sections.map(([k, label, page]) => {
    page.classList.add('mpage');
    page.id = `mtab-${seq}-${k}`;
    page.setAttribute('role', 'tabpanel');
    page.setAttribute('aria-label', label);
    pages[k] = page;
    return (btns[k] = h('button', { type: 'button', role: 'tab', 'aria-controls': page.id, onclick: () => show(k) }, label));
  })));
  show(sections[0][0]);
  return { strip, pages, btns, show };
}
/**
 * Keep a tabbed dialog body at the height of its tallest section, so the dialog does not grow, shrink and re-centre
 * when another section comes to the front. Measured once the modal is in the DOM (each page shown in turn); the
 * CSS min-heights (.settings-tabs, .shortcuts-tabs) stay as floors.
 */
function holdTallest(container, { pages, show }, current) {
  let max = 0;
  for (const k of Object.keys(pages)) { show(k); max = Math.max(max, container.offsetHeight); }
  show(current);
  container.style.minHeight = `${max}px`;
}

/** Session editor. Resolves with the session object to save, or null. */
export function sessionEditor(app, initial = {}) {
  const s = { type: 'ssh', port: 22, authMethod: 'auto', sftpAuto: true, followCwd: false, tunnels: [], ...initial };
  let dirty = false; // any edit, incl. tunnel rows and picker clicks, asks before discarding
  const markDirty = () => { dirty = true; };
  let type = s.type;
  const folders = app.sessionTree.collectFolders().sort();

  // --- common
  const name = text(s.name, { placeholder: t('Session name (defaults to user@host)') });

  // icon + color (like MobaXterm's per-session icon and tab colour)
  const ICON_CHOICES = ['🐧', '🖥️', '🪟', '🍎', '☁️', '🐳', '🗄️', '🌐', '🔒', '🔑', '⚙️', '🧪', '🚀', '⭐', '🔥', '📦', '💾', '📡', '🏠', '🏢', '🎮', '🤖', '📊'];
  const COLOR_CHOICES = ['#e5534b', '#f08c3a', '#e6b422', '#4caf50', '#2fbfa7', '#4ea1ff', '#7a7dff', '#bd93f9', '#ff79c6', '#8a93a2'];
  let iconVal = s.icon || '';
  let colorVal = s.color || '';
  const iconRow = pickRow(t('Icon'));
  const renderIcons = () => {
    iconRow.fill(
      pick('—', !iconVal, t('Default (by session type)'), () => { iconVal = ''; renderIcons(); }),
      ...ICON_CHOICES.map((ic) => pick(ic, ic === iconVal, ic, () => { iconVal = ic; renderIcons(); }))
    );
  };
  renderIcons();
  const customColor = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(colorVal) ? colorVal : '#4ea1ff', title: t('Custom colour'), 'aria-label': t('Custom colour') });
  const colorRow = pickRow(t('Colour'));
  const renderColors = () => {
    // a custom colour (the colour input) is none of the swatches: "—" then holds the group's Tab stop without being chosen
    colorRow.fill(
      pick('—', !colorVal, t('No colour'), () => { colorVal = ''; renderColors(); }, { stop: !COLOR_CHOICES.includes(colorVal) }),
      ...COLOR_CHOICES.map((c) => pick('', c === colorVal, c, () => { colorVal = c; renderColors(); }, { class: 'swatch', style: { background: c } })),
      customColor
    );
  };
  customColor.addEventListener('input', () => { colorVal = customColor.value; renderColors(); });
  renderColors();

  const folder = text(s.folder || '', { list: 'folder-list', placeholder: t('(root)') });
  const dl = h('datalist', { id: 'folder-list' }, folders.map((f) => h('option', { value: f })));
  const host = text(s.host, { placeholder: t('hostname or IP') });
  const port = num(s.port ?? DEFAULT_PORT[type], { min: 1, max: 65535 });
  const username = text(s.username, { placeholder: t('login user') });

  // --- ssh auth
  const authMethod = select([['auto', t('Automatic (key → agent → password)')], ['password', t('Password')], ['key', t('Private key')], ['agent', t('SSH agent')]], s.authMethod);
  const password = h('input', { type: 'password', placeholder: s.hasPassword ? t('•••••••• (saved — leave blank to keep)') : t('leave blank to be prompted'), autocomplete: 'new-password' });
  const clearPw = check(t('Clear saved password'), false);
  const keyPath = text(s.privateKeyPath, { placeholder: '~/.ssh/id_ed25519' });
  const keyBrowse = h('button', { class: 'btn small', type: 'button', onclick: async () => {
    const r = await window.api.dialog.open({ title: t('Select private key'), defaultPath: app.info.home + '/.ssh', properties: ['openFile', 'showHiddenFiles'] });
    if (!r.canceled && r.filePaths[0]) keyPath.value = r.filePaths[0].replace(app.info.home, '~');
  } }, t('Browse…'));
  // Generate… opens the key generator on top of the editor; "Use in this session" there fills the key field
  const keyGen = h('button', { class: 'btn small', type: 'button', title: t('Generate a new key pair (ssh-keygen)'), onclick: async () => {
    const r = await keygenDialog(app, { forSession: true });
    if (r && r.privateKeyPath) {
      keyPath.value = r.privateKeyPath.replace(app.info.home, '~');
      if (authMethod.value === 'password' || authMethod.value === 'agent') { authMethod.value = 'auto'; applyAuth(); }
      markDirty();
    }
  } }, t('Generate…'));
  const passphrase = h('input', { type: 'password', placeholder: s.hasPassphrase ? t('•••••••• (saved)') : t('optional'), autocomplete: 'new-password' });
  // rows whose relevance depends on the authentication method
  const pwRow = field(t('Password'), password);
  const clearRow = [h('div', {}), h('div', { class: 'checks' }, clearPw.el)];
  const keyRow = field(t('Private key'), h('div', { class: 'inline' }, keyPath, keyBrowse, keyGen));
  const ppRow = field(t('Key passphrase'), passphrase);
  const applyAuth = () => {
    const m = authMethod.value;
    const showPw = m === 'auto' || m === 'password';
    const showKey = m === 'auto' || m === 'key';
    for (const el of [...pwRow, ...clearRow]) el.hidden = !showPw;
    for (const el of [...keyRow, ...ppRow]) el.hidden = !showKey;
  };
  authMethod.addEventListener('change', applyAuth);
  const sshSessions = app.sessions.sessions.filter((x) => x.type === 'ssh' && x.id !== s.id);
  const jumpSel = select([['', t('(none)')], ...sshSessions.map((x) => [x.id, `${x.name} (${x.username ? x.username + '@' : ''}${x.host})`]), ['__manual', t('Enter manually…')]], s.jumpSessionId || (s.jumpHost ? '__manual' : ''));
  const jumpHost = text(s.jumpHost, { placeholder: t('user@bastion[:port]'), 'aria-label': t('Jump host address'), hidden: jumpSel.value !== '__manual' });
  jumpSel.addEventListener('change', () => (jumpHost.hidden = jumpSel.value !== '__manual'));
  const x11 = check(t('X11 forwarding (XQuartz)'), s.x11);
  const agentFwd = check(t('Agent forwarding'), s.agentForward);
  const compression = check(t('Compression'), s.compression);
  const legacy = check(t('Legacy algorithms (old devices)'), s.legacyAlgorithms);
  // the remote monitoring bar: a session without its own value shows Settings → Features' default and saves it explicitly
  const monitor = check(t('Show remote monitoring bar'), s.monitor ?? app.settings.monitorBar !== false);
  // --- mosh / ftp
  const moshServer = text(s.moshServer, { placeholder: t('mosh-server (path on the remote host, optional)') });
  const moshPredict = select([['adaptive', t('Adaptive (default)')], ['always', t('Always')], ['never', t('Never')], ['experimental', t('Experimental')]], s.moshPredict || 'adaptive');
  const ftps = check(t('FTPS: explicit TLS (AUTH TLS)'), s.ftps);
  const ftpsInsecure = check(t('Accept untrusted / self-signed certificate'), s.ftpsInsecure);
  const keepAlive = num(s.keepAliveInterval ?? app.settings.keepAliveInterval ?? 30, { min: 0, max: 3600 });

  // --- algorithms (Advanced SSH): what this session offers for key exchange, host key, cipher and MAC, pre-filled
  // from ssh2's defaults; "Legacy algorithms" is a preset that adds (or takes out) the SHA-1 / CBC / DSA ones; every
  // name is checked against what ssh2 supports (an unknown one is an inline error and never saved). Only lists that
  // differ from the preset are stored, as `algorithms: { kex, serverHostKey, cipher, hmac }`.
  const algo = app.algorithms; // { defaults, supported, legacy } from the main process; null when it could not be read
  const ALGO_CATS = [['kex', t('Key exchange')], ['serverHostKey', t('Host key')], ['cipher', t('Ciphers')], ['hmac', t('MACs')]];
  const uniq = (l) => [...new Set(l)];
  const parseAlgos = (v) => uniq(String(v || '').split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean));
  const algoPreset = (cat, legacyOn) => (legacyOn ? uniq([...algo.defaults[cat], ...algo.legacy[cat]]) : [...algo.defaults[cat]]);
  const algoArea = {}, algoErr = {};
  // the same wording as the main process (algorithms.js validate): its labels ("MAC", not "mac"), and a name ssh2
  // knows but this build's crypto lacks is "not available", not "unknown"
  const checkAlgos = (cat) => {
    const list = parseAlgos(algoArea[cat].value);
    const missing = list.filter((a) => ((algo.unavailable && algo.unavailable[cat]) || []).includes(a));
    const unknown = list.filter((a) => !algo.supported[cat].includes(a) && !missing.includes(a));
    const label = (algo.labels && algo.labels[cat]) || ALGO_CATS.find((c) => c[0] === cat)[1];
    // one sentence per count (not tn(): the count itself is not shown, the names are)
    algoErr[cat].textContent = unknown.length === 1 ? t('Unknown {label} algorithm: {list}', { label, list: unknown[0] })
      : unknown.length ? t('Unknown {label} algorithms: {list}', { label, list: unknown.join(', ') })
      : missing.length ? t('Not available in this build: {list} (1024-bit Diffie-Hellman was removed from its crypto)', { list: missing.join(', ') }) : '';
    const bad = !!(unknown.length || missing.length);
    algoErr[cat].hidden = !bad;
    algoArea[cat].classList.toggle('invalid', bad);
    algoArea[cat].setAttribute('aria-invalid', bad ? 'true' : 'false');
    return !bad;
  };
  if (algo) {
    for (const [cat, label] of ALGO_CATS) {
      const ta = h('textarea', { class: 'algo-list', spellcheck: false, rows: 2, 'aria-label': t('{label} algorithms', { label }) });
      const own = s.algorithms && Array.isArray(s.algorithms[cat]) && s.algorithms[cat].length ? s.algorithms[cat] : null;
      ta.value = (own || algoPreset(cat, !!s.legacyAlgorithms)).join(', ');
      ta.addEventListener('input', () => checkAlgos(cat));
      algoArea[cat] = ta;
      algoErr[cat] = h('div', { class: 'form-error', role: 'alert', hidden: true });
    }
    // the preset adds its algorithms to the lists, or takes them out again (never one that is also a default)
    legacy.cb.addEventListener('change', () => {
      for (const [cat] of ALGO_CATS) {
        const cur = parseAlgos(algoArea[cat].value);
        const next = legacy.cb.checked ? uniq([...cur, ...algo.legacy[cat]]) : cur.filter((a) => !(algo.legacy[cat].includes(a) && !algo.defaults[cat].includes(a)));
        algoArea[cat].value = next.join(', ');
        checkAlgos(cat);
      }
    });
  }
  const algoReset = h('button', { class: 'btn small', type: 'button', onclick: () => {
    for (const [cat] of ALGO_CATS) { algoArea[cat].value = algoPreset(cat, legacy.cb.checked).join(', '); checkAlgos(cat); }
    markDirty();
  } }, t('Reset to defaults'));

  // --- terminal / behaviour
  const startup = h('textarea', { spellcheck: false, placeholder: t('One command per line, typed once the terminal is ready\ne.g. cd /var/log') });
  startup.value = s.startupCommand || '';
  const sftpAuto = check(t('Open SFTP browser automatically'), s.sftpAuto !== false);
  const followCwd = check(t('SFTP follows terminal folder (injects prompt hook)'), s.followCwd);
  const logging = check(t('Log session output to file'), s.logging);
  const theme = select([['', t('(default)')], ...Object.keys(THEMES).map((k) => [k, themeLabel(k)])], s.theme || '');
  const fontSize = num(s.fontSize || '', { min: 8, max: 40, placeholder: String(app.settings.fontSize) });
  const highlight = select([['', t('Default (Settings)')], ['on', t('On')], ['off', t('Off')]], s.highlight === 'on' || s.highlight === 'off' ? s.highlight : '');
  const notes = h('textarea', { spellcheck: false, placeholder: t('Notes') });
  notes.value = s.notes || '';

  // --- local
  const shell = text(s.shell, { placeholder: app.settings.localShell || t('(default login shell)') });
  const cwd = text(s.cwd, { placeholder: '~' });
  // Browse…: a folder dialog fills the field with the absolute path, which is what the shell is started in (the value
  // goes to the pty as typed — nothing expands a leading ~, so the picked path is not shortened like a key path is);
  // Cancel leaves the field as it was. The field's own path, when absolute, is where the dialog opens.
  const cwdBrowse = h('button', { class: 'btn small', type: 'button', title: t('Choose the folder the shell starts in'), onclick: async () => {
    const cur = cwd.value.trim();
    const r = await window.api.dialog.open({ title: t('Select start folder'), defaultPath: cur.startsWith('/') ? cur : app.info.home, properties: ['openDirectory', 'createDirectory'] });
    if (!r.canceled && r.filePaths[0]) { cwd.value = r.filePaths[0]; markDirty(); }
  } }, t('Browse…'));

  // --- serial
  const serialSel = select([['', t('(scanning…)')]], '');
  const serialCustom = text(s.serialPath || '', { placeholder: t('or type a device path, e.g. /dev/cu.usbserial-1410') });
  const loadPorts = async () => {
    let ports = [];
    try {
      ports = await window.api.term.listSerialPorts();
    } catch {}
    const cur = serialCustom.value.trim() || s.serialPath || '';
    serialSel.replaceChildren(
      h('option', { value: '' }, ports.length ? t('(select a port)') : t('(no serial devices found)')),
      ...ports.map((p) => h('option', { value: p.path, selected: p.path === cur }, `${p.path}${p.manufacturer ? ' — ' + p.manufacturer : ''}`))
    );
  };
  serialSel.addEventListener('change', () => { if (serialSel.value) serialCustom.value = serialSel.value; });
  const serialRefresh = h('button', { class: 'btn small', type: 'button', title: t('Rescan ports'), 'aria-label': t('Rescan ports'), onclick: () => loadPorts() }, '↻');
  const baud = select(BAUD_RATES.map((b) => [String(b), String(b)]), String(s.baudRate || 115200));
  // the four Framing selects share one visible caption: each carries its own name
  const dataBits = select([['8', t('8 data bits')], ['7', t('7 data bits')], ['6', '6'], ['5', '5']], String(s.dataBits || 8), { 'aria-label': t('Data bits') });
  const parity = select([['none', t('No parity')], ['even', t('Even')], ['odd', t('Odd')]], s.parity || 'none', { 'aria-label': t('Parity') });
  const stopBits = select([['1', t('1 stop bit')], ['2', t('2 stop bits')]], String(s.stopBits || 1), { 'aria-label': t('Stop bits') });
  const flow = select([['none', t('No flow control')], ['rtscts', 'RTS/CTS'], ['xonxoff', 'XON/XOFF']], s.flow || 'none', { 'aria-label': t('Flow control') });
  const localEcho = check(t('Local echo'), s.localEcho);
  const newline = select([['cr', 'CR'], ['lf', 'LF'], ['crlf', 'CR+LF']], s.newline || 'cr');

  // --- tunnels
  const tunnels = (s.tunnels || []).map((tu) => ({ ...tu }));
  const tunnelRows = h('div');
  // the button stays the same element across re-renders: the Tunnel sub-dialog hands focus back to it when it closes
  const addTunnel = h('button', { class: 'btn small', type: 'button', onclick: async () => { const tf = await tunnelForm(); if (tf) { tunnels.push({ ...tf, enabled: true }); markDirty(); renderTunnels(); } } }, t('＋ Add tunnel'));
  const tunnelTable = h('div', {}, tunnelRows, h('div', { style: { marginTop: '8px' } }, addTunnel));
  const renderTunnels = () => {
    tunnelRows.replaceChildren(
      h('table', { class: 'list-table' },
        h('thead', {}, h('tr', {}, h('th', {}, t('Type')), h('th', {}, t('Bind')), h('th', {}, t('Destination')), h('th', {}, t('On')), h('th', {}))),
        h('tbody', {}, tunnels.map((tu, i) => h('tr', {},
          h('td', {}, tunnelTypeLabel(tu.type)),
          h('td', { class: 'mono' }, `${tu.bindHost || '127.0.0.1'}:${tu.bindPort}`),
          h('td', { class: 'mono' }, tu.type === 'dynamic' ? '—' : `${tu.destHost}:${tu.destPort}`),
          h('td', {}, h('input', { type: 'checkbox', checked: tu.enabled !== false, 'aria-label': t('Tunnel {port} enabled', { port: tu.bindPort }), onchange: (e) => (tu.enabled = e.target.checked) })),
          h('td', {}, h('button', { class: 'btn small icon-only', type: 'button', title: t('Remove'), 'aria-label': t('Remove tunnel {port}', { port: tu.bindPort }), onclick: (e) => {
            const viaKeyboard = e.currentTarget === document.activeElement;
            tunnels.splice(i, 1);
            markDirty();
            renderTunnels();
            if (viaKeyboard) (tunnelRows.querySelectorAll('tbody button')[Math.min(i, tunnels.length - 1)] || addTunnel).focus(); // the removed ✕ had the focus
          } }, icon('x')))
        )))
      )
    );
  };
  renderTunnels();

  const pages = {
    basic: h('div', { class: 'mpage active form-grid' }),
    advanced: h('div', { class: 'mpage form-grid' }),
    terminal: h('div', { class: 'mpage form-grid' }),
    tunnels: h('div', { class: 'mpage' }, h('p', { style: { color: 'var(--fg-dim)', marginTop: 0 } }, t('Port forwards started automatically when this session connects.')), tunnelTable),
  };
  // the same tablist / tab / tabpanel strip as Settings and Keyboard shortcuts (arrows between the sections, aria-selected on the one in front)
  const { strip: tabs, btns: tabBtns, show: showPage } = modalTabs([['basic', t('Basic'), pages.basic], ['advanced', t('Advanced SSH'), pages.advanced], ['terminal', t('Terminal'), pages.terminal], ['tunnels', t('Tunnels'), pages.tunnels]]);

  const typeBtns = {};
  const picker = h('div', { class: 'type-picker' }, ['ssh', 'mosh', 'local', 'telnet', 'serial', 'ftp', 'rdp', 'vnc'].map((k) => (typeBtns[k] = h('button', { type: 'button', class: k === type ? 'active' : '', onclick: () => setType(k) }, h('span', { class: 'ico' }, { ssh: '🔐', mosh: '📶', local: '💻', telnet: '☎️', serial: '🔌', ftp: '📁', rdp: '🪟', vnc: '🖥️' }[k]), TYPE_LABEL[k]))));

  const buildBasic = () => {
    const b = pages.basic;
    b.replaceChildren();
    b.append(...field(t('Name'), name), ...field(t('Folder'), h('div', { class: 'inline' }, folder, dl)),
      ...field(t('Icon'), iconRow), ...field(t('Colour'), colorRow, t('Shown on the session, its tab and pane')));
    if (type === 'local') {
      b.append(...field(t('Shell'), shell, t('Leave blank for your login shell')), ...field(t('Start folder'), h('div', { class: 'inline' }, cwd, cwdBrowse)));
    } else if (type === 'serial') {
      b.append(
        ...field(t('Serial port'), h('div', { class: 'inline' }, serialSel, serialRefresh)),
        ...field(t('Device path'), serialCustom),
        ...field(t('Baud rate'), baud),
        h('label', {}, t('Framing')), h('div', { class: 'inline' }, dataBits, parity, stopBits, flow),
        h('label', {}, t('Options')), h('div', { class: 'checks' }, localEcho.el),
        ...field(t('Enter sends'), newline)
      );
      loadPorts();
    } else {
      b.append(...field(t('Host'), host), ...field(t('Port'), port), ...field(t('Username'), username));
    }
    if (type === 'ssh') {
      b.append(...field(t('Authentication'), authMethod), ...pwRow, ...clearRow, ...keyRow, ...ppRow);
      applyAuth();
    }
    if (type === 'mosh') {
      // the same key row as SSH (moving the inputs into a new wrapper would empty the SSH row after a type round-trip)
      b.append(...keyRow, h('div', { class: 'form-help' }, t('Used by the ssh bootstrap; agent keys and password prompts work in the terminal')),
        ...field('mosh-server', moshServer), ...field(t('Prediction'), moshPredict),
        h('div', { class: 'full form-help', style: { gridColumn: '1 / -1' } }, t('Needs the mosh client on this Mac (brew install mosh) and mosh-server on the remote host; UDP ports 60000-61000 must be reachable.')));
    }
    if (type === 'ftp') {
      b.append(...pwRow, ...clearRow,
        h('label', {}, t('Security')), h('div', { class: 'checks' }, ftps.el, ftpsInsecure.el),
        h('div', { class: 'full form-help', style: { gridColumn: '1 / -1' } }, t('Leave the username empty for anonymous FTP. Files are browsed, transferred and edited in the Sftp panel.')));
    }
    if (type === 'mosh') for (const el of keyRow) el.hidden = false;
    if (type === 'ftp') for (const el of [...pwRow, ...clearRow]) el.hidden = false;
    if (type === 'rdp' || type === 'vnc') {
      b.append(h('div', { class: 'full form-help', style: { gridColumn: '1 / -1' } }, type === 'rdp' ? t('Opens in Windows App / Microsoft Remote Desktop via a generated .rdp file.') : t('Opens in macOS Screen Sharing (vnc:// URL).')));
    }
  };
  // the rows that are SSH's alone: a Mosh session keeps the legacy preset, the algorithm lists and the monitoring
  // bar (they drive its host-key check and its SFTP companion connection), not the jump host, X11, agent
  // forwarding, compression or keep-alive (the mosh client's own ssh does not take them)
  const jumpRows = field(t('Jump host'), h('div', { class: 'inline', style: { flexDirection: 'column', alignItems: 'stretch' } }, jumpSel, jumpHost), t('ProxyJump: connect through a bastion'));
  const keepAliveRows = field(t('Keep-alive (s)'), keepAlive);
  const moshAlgoNote = h('div', { class: 'form-help', hidden: true }, t('Mosh: the preset and these lists apply to the host-key check before mosh starts and to the SFTP companion connection; mosh\'s own ssh keeps its defaults.'));
  pages.advanced.append(
    ...jumpRows,
    h('label', {}, t('Options')), h('div', { class: 'checks' }, x11.el, agentFwd.el, compression.el, legacy.el),
    ...keepAliveRows,
    ...(algo ? [
      h('label', { class: 'algo-title' }, t('Algorithms')), h('div', { class: 'algo-head' }, algoReset),
      h('div', { class: 'form-help' }, t('What this session offers the server, most preferred first (comma or newline separated). "Legacy algorithms" adds the SHA-1 key exchanges, CBC ciphers and DSA host keys for old devices.')),
      moshAlgoNote,
      ...ALGO_CATS.flatMap(([cat, label]) => [...field(label, algoArea[cat]), algoErr[cat]]),
    ] : []),
    h('label', {}, t('Monitoring')), h('div', { class: 'checks' }, monitor.el),
    h('div', { class: 'form-help' }, t('CPU, memory, disk, network, load and uptime under the terminal, polled over this connection every few seconds (Settings → Features sets the default and the refresh); the pane head and the View menu toggle it per pane'))
  );
  pages.terminal.append(
    ...field(t('Startup commands'), startup),
    h('label', {}, t('Behaviour')), h('div', { class: 'checks' }, sftpAuto.el, followCwd.el, logging.el),
    ...field(t('Theme'), theme), ...field(t('Font size'), fontSize),
    ...field(t('Keyword highlighting'), highlight, t('Errors, warnings, IP addresses, URLs… coloured by the rules in Settings → Features')),
    ...field(t('Notes'), notes)
  );

  let prevType = s.type;
  const setType = (ty) => {
    for (const [k, b] of Object.entries(typeBtns)) b.classList.toggle('active', k === ty);
    // keep a custom port, but follow the type's default when the port was still the previous type's default
    if (!port.value || +port.value === DEFAULT_PORT[prevType] || +port.value === 0) port.value = DEFAULT_PORT[ty] || '';
    prevType = type = ty;
    name.placeholder = ty === 'local' ? t('Session name (defaults to "Local")') : ty === 'serial' ? t('Session name (defaults to device @ baud)') : t('Session name (defaults to user@host)');
    tabBtns.advanced.hidden = ty !== 'ssh' && ty !== 'mosh'; // Mosh: the preset / lists (host-key check, SFTP companion) and the monitoring bar
    for (const el of [...jumpRows, ...keepAliveRows, x11.el, agentFwd.el, compression.el]) el.hidden = ty !== 'ssh';
    moshAlgoNote.hidden = ty !== 'mosh';
    tabBtns.tunnels.hidden = ty !== 'ssh';
    tabBtns.terminal.hidden = ty === 'rdp' || ty === 'vnc' || ty === 'ftp';
    sftpAuto.el.hidden = ty !== 'ssh' && ty !== 'mosh'; // Mosh: opens the SFTP companion connection automatically
    followCwd.el.hidden = ty !== 'ssh';
    buildBasic();
    showPage('basic');
  };
  setType(type);

  const body = h('div', {}, tabs, picker, ...Object.values(pages));
  body.addEventListener('input', () => { dirty = true; });
  body.addEventListener('change', () => { dirty = true; });
  body.addEventListener('click', (e) => { if (e.target.closest('.pick-row, .type-picker')) dirty = true; });
  const modal = showModal({
    title: s.id ? t('Edit session — {name}', { name: s.name }) : t('New session'),
    width: 'wide',
    closeOnBackdrop: false,
    beforeClose: () => !dirty || confirmDialog(t('Discard the changes to this session?'), { title: t('Discard changes'), okLabel: t('Discard'), danger: true }),
    body,
    buttons: [
      { label: t('Cancel'), value: null },
      { label: t('Save & Connect'), action: (api) => { const out = collect(); if (out) api.close({ ...out, _connect: true }); } },
      { label: t('Save'), primary: true, action: (api) => { const out = collect(); if (out) api.close(out); } },
    ],
  });
  function collect() {
    const serialPath = serialCustom.value.trim() || serialSel.value;
    if (type === 'serial' && !serialPath) {
      serialCustom.focus();
      toast(t('Serial device path is required'), 'warn');
      return null;
    }
    if (type !== 'local' && type !== 'serial' && !host.value.trim()) {
      host.focus();
      toast(t('Host is required'), 'warn');
      return null;
    }
    if (type !== 'local' && type !== 'serial') {
      const pn = /^\d+$/.test(port.value.trim()) ? parseInt(port.value, 10) : NaN; // integers only (12.5 / 1e3 are not ports)
      if (!(pn >= 1 && pn <= 65535)) {
        toast(t('Port must be between 1 and 65535'), 'warn');
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
      monitor: type === 'ssh' || type === 'mosh' ? monitor.cb.checked : s.monitor,
      startupCommand: startup.value.replace(/\n/g, '\r').trim(),
      sftpAuto: sftpAuto.cb.checked,
      followCwd: followCwd.cb.checked,
      logging: logging.cb.checked,
      theme: theme.value,
      fontSize: parseInt(fontSize.value, 10) || undefined,
      highlight: highlight.value,
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
    if (algo && (type === 'ssh' || type === 'mosh')) { // Mosh: used by its host-key check and SFTP companion (main.js, terminal.js)
      for (const [cat] of ALGO_CATS) {
        if (checkAlgos(cat)) continue;
        showPage('advanced');
        algoArea[cat].focus();
        toast(algoErr[cat].textContent, 'warn');
        return null;
      }
      const lists = {};
      for (const [cat] of ALGO_CATS) {
        const list = parseAlgos(algoArea[cat].value);
        if (list.length && list.join('\n') !== algoPreset(cat, legacy.cb.checked).join('\n')) lists[cat] = list;
      }
      if (Object.keys(lists).length) out.algorithms = lists;
      else delete out.algorithms;
    }
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
  const type = select([['local', t('Local (-L): local port → remote destination')], ['remote', t('Remote (-R): remote port → local destination')], ['dynamic', t('Dynamic (-D): SOCKS5 proxy')]], initial.type || 'local');
  // host:port pairs share one visible label (Bind / Destination): each box carries its own name
  const bindHost = text(initial.bindHost || '127.0.0.1', { 'aria-label': t('Bind address') });
  const bindPort = num(initial.bindPort || '', { min: 0, max: 65535, placeholder: '8080', 'aria-label': t('Bind port') });
  const destHost = text(initial.destHost || '', { placeholder: 'localhost', 'aria-label': t('Destination host') });
  const destPort = num(initial.destPort || '', { min: 1, max: 65535, placeholder: '80', 'aria-label': t('Destination port') });
  const name = text(initial.name || '', { placeholder: t('optional label') });
  const destRow = field(t('Destination'), h('div', { class: 'inline' }, destHost, ':', destPort));
  type.addEventListener('change', () => destRow.forEach((e) => (e.hidden = type.value === 'dynamic')));
  const m = showModal({
    title: t('Tunnel'),
    body: h('div', { class: 'form-grid' }, ...field(t('Type'), type), ...field(t('Label'), name), ...field(t('Bind'), h('div', { class: 'inline' }, bindHost, ':', bindPort)), ...destRow),
    buttons: [
      { label: t('Cancel'), value: null },
      { label: t('OK'), primary: true, action: (api) => {
        const bp = parseInt(bindPort.value, 10);
        if (isNaN(bp) || bp < 0 || bp > 65535) { toast(t('Bind port is required (0-65535)'), 'warn'); return bindPort.focus(); }
        if (type.value !== 'dynamic' && !destHost.value.trim()) { toast(t('Destination host is required'), 'warn'); return destHost.focus(); }
        if (type.value !== 'dynamic' && !(parseInt(destPort.value, 10) >= 1 && parseInt(destPort.value, 10) <= 65535)) { toast(t('Destination port must be 1-65535'), 'warn'); return destPort.focus(); }
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
          h('thead', {}, h('tr', {}, h('th', {}, t('Type')), h('th', {}, t('Bind')), h('th', {}, t('Destination')), h('th', {}, t('Via')), h('th', {}, t('Status')), h('th', {}, t('Conns')), h('th', {}))),
          h('tbody', {}, list.map((tu) => h('tr', {},
            h('td', {}, { local: '-L', remote: '-R', dynamic: '-D' }[tu.type]),
            h('td', { class: 'mono' }, `${tu.bindHost || '127.0.0.1'}:${tu.bindPort}`),
            h('td', { class: 'mono' }, tu.type === 'dynamic' ? 'SOCKS5' : `${tu.destHost}:${tu.destPort}`),
            h('td', {}, tu.sessionName || tu.connId || ''),
            h('td', {}, h('span', { class: 'badge ' + tu.status, title: tu.error || '' }, tunnelStatusLabel(tu.status)), tu.error ? h('div', { class: 'form-help', style: { gridColumn: 'auto', color: 'var(--danger-fg)', marginTop: '2px' } }, tu.error) : null),
            h('td', {}, String(tu.connections || 0)),
            h('td', {}, h('button', { class: 'btn small', onclick: async () => { await window.api.tunnels.stop(tu.id); render(); } }, t('Stop')))
          ))))
        : h('div', { style: { color: 'var(--fg-faint)', padding: '10px 0' } }, t('No active tunnels.'))
    );
  };
  const off = window.api.on('tunnels:changed', () => render());
  await render();

  const openConns = app.workspace.allPanes().filter((p) => p.kind === 'ssh' && p.status === 'connected');
  const sessions = app.sessions.sessions.filter((x) => x.type === 'ssh');
  const viaOptions = [
    ...openConns.map((p) => ['conn:' + p.termId, t('Open connection: {title}', { title: p.title })]),
    ...sessions.map((x) => ['sess:' + x.id, t('New connection: {name}', { name: x.name })]),
  ];
  const via = select(viaOptions.length ? viaOptions : [['', t('(no SSH sessions yet — create one in the Sessions panel)')]],
    preset.sessionId ? 'sess:' + preset.sessionId : openConns[0] ? 'conn:' + openConns[0].termId : '');
  if (!viaOptions.length) via.disabled = true;
  const form = h('div', { class: 'form-grid', style: { marginTop: '12px' } },
    ...field(t('Via'), via),
    h('label', {}), h('div', {}, h('button', { class: 'btn primary small', disabled: !viaOptions.length, onclick: async () => {
      if (!via.value) return toast(t('No SSH session available'), 'warn');
      const tf = await tunnelForm();
      if (!tf) return;
      const [kind, id] = via.value.split(':');
      try {
        await window.api.tunnels.start(kind === 'conn' ? { ...tf, connId: id } : { ...tf, sessionId: id });
      } catch (e) {
        toast(e.message, 'error');
      }
      render();
    } }, t('＋ New tunnel…')))
  );
  const m = showModal({
    title: t('SSH Tunnels (port forwarding)'),
    width: 'wide',
    body: h('div', {}, table, form),
    buttons: [{ label: t('Close'), value: null }],
    onClose: () => off(),
  });
  return m.promise;
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const sameRules = (a, b) => JSON.stringify((a || []).map(normalizeRule)) === JSON.stringify((b || []).map(normalizeRule));

/**
 * Settings → Features → Keyword highlighting → Rules…: the editable rule table (pattern, regex, ignore case, colour,
 * background, bold, underline). Resolves with the rule list to save (empty patterns dropped), or null on Cancel; OK
 * refuses a regex that does not compile (toast, the pattern keeps the focus). "Restore defaults" reloads the built-in set.
 */
export function highlightRulesDialog(initial) {
  const rules = (Array.isArray(initial) && initial.length ? initial : DEFAULT_RULES).map((r) => ({ ...normalizeRule(r) }));
  const rows = h('div', { class: 'hl-rules' });
  // a colour cell: the theme's slots, or Custom… with a colour well
  const colourCell = (value, none, label, onChange) => {
    const custom = HEX_COLOR.test(value);
    const sel = select([['', none], ...colourOptions(), ['custom', t('Custom…')]], custom ? 'custom' : value, { 'aria-label': label });
    const well = h('input', { type: 'color', value: custom ? value : '#ff8800', hidden: !custom, 'aria-label': t('{label} (custom)', { label }) });
    const emit = () => onChange(sel.value === 'custom' ? well.value.toLowerCase() : sel.value);
    sel.addEventListener('change', () => { well.hidden = sel.value !== 'custom'; emit(); });
    well.addEventListener('input', emit);
    return h('div', { class: 'inline' }, sel, well);
  };
  const flag = (r, key, label, i) => h('input', { type: 'checkbox', checked: r[key], 'aria-label': t('Rule {n}: {what}', { n: i + 1, what: label }), onchange: (e) => (r[key] = e.target.checked) });
  let addBtn;
  const render = (focusRow) => {
    rows.replaceChildren(h('table', { class: 'list-table' },
      h('thead', {}, h('tr', {}, h('th', {}, t('Pattern')), h('th', { title: t('Regular expression') }, t('Regex')), h('th', { title: t('Ignore case') }, 'Aa'),
        h('th', {}, t('Colour')), h('th', {}, t('Background')), h('th', { title: t('Bold') }, 'B'), h('th', { title: t('Underline') }, 'U'), h('th', {}))),
      h('tbody', {}, rules.map((r, i) => h('tr', {},
        h('td', { class: 'pat' }, text(r.pattern, { placeholder: r.regex ? t('regular expression') : t('text'), 'aria-label': t('Rule {n}: pattern', { n: i + 1 }), oninput: (e) => (r.pattern = e.target.value) })),
        h('td', {}, flag(r, 'regex', t('regular expression'), i)),
        h('td', {}, flag(r, 'ci', t('ignore case'), i)),
        h('td', {}, colourCell(r.color, t('(keep)'), t('Rule {n}: colour', { n: i + 1 }), (v) => (r.color = v))),
        h('td', {}, colourCell(r.bg, t('(none)'), t('Rule {n}: background', { n: i + 1 }), (v) => (r.bg = v))),
        h('td', {}, flag(r, 'bold', t('bold'), i)),
        h('td', {}, flag(r, 'underline', t('underline'), i)),
        h('td', {}, h('button', { class: 'btn small icon-only', type: 'button', title: t('Remove'), 'aria-label': t('Remove rule {n}', { n: i + 1 }), onclick: (e) => {
          const viaKeyboard = e.currentTarget === document.activeElement;
          rules.splice(i, 1);
          render();
          if (viaKeyboard) (rows.querySelectorAll('tbody .icon-only')[Math.min(i, rules.length - 1)] || addBtn).focus();
        } }, icon('x')))
      )))
    ));
    for (const i of rows.querySelectorAll('tbody input[type=text]')) { try { i.setSelectionRange(0, 0); } catch {} } // a focused pattern reads from its start, not scrolled to its end
    if (focusRow !== undefined) rows.querySelectorAll('tbody input[type=text]')[focusRow]?.focus();
  };
  addBtn = h('button', { class: 'btn small', type: 'button', onclick: () => { rules.push(normalizeRule({ color: 'red' })); render(rules.length - 1); } }, t('＋ Add rule'));
  const restoreBtn = h('button', { class: 'btn small', type: 'button', onclick: () => { rules.splice(0, rules.length, ...DEFAULT_RULES.map((r) => ({ ...r }))); render(); toast(t('Built-in rules restored'), 'info'); } }, t('Restore defaults'));
  render();
  const m = showModal({
    title: t('Keyword highlighting rules'),
    width: 'wide',
    body: h('div', {},
      h('div', { class: 'hl-help' }, t('Matches in every terminal take the rule\'s colour. Plain text matches anywhere in a line; Regex is a JavaScript regular expression. Colours come from the terminal theme, so they read on every palette. Where rules overlap, the earlier match wins, then the longer one.')),
      rows,
      h('div', { class: 'hl-actions' }, addBtn, restoreBtn)),
    buttons: [
      { label: t('Cancel'), value: null },
      { label: t('OK'), primary: true, action: (api) => {
        const { invalid } = compileRules(rules.map((r) => ({ ...r, enabled: true })));
        if (invalid.length) {
          const { index, rule, error } = invalid[0];
          toast(t('"{pattern}" is not a valid regular expression: {error}', { pattern: rule.pattern, error }), 'warn', 6000);
          rows.querySelectorAll('tbody input[type=text]')[index]?.focus();
          return;
        }
        api.close(rules.map(normalizeRule).filter((r) => r.pattern));
      } },
    ],
  });
  setTimeout(() => { // showModal focused the first pattern: caret and scroll at its start, so the regex reads from its beginning
    const f = rows.querySelector('tbody input[type=text]');
    if (f && document.activeElement === f) { try { f.setSelectionRange(0, 0); } catch {} f.scrollLeft = 0; }
  }, 20);
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
  const themePreview = paintThemePreview(h('span', { class: 'theme-preview', 'aria-hidden': 'true' }), theme.value);
  theme.addEventListener('change', () => paintThemePreview(themePreview, theme.value));
  const rightClickPaste = check('Right-click pastes (⇧-right-click for menu)', s.rightClickPaste);
  const copyOnSelect = check('Copy on select', s.copyOnSelect);
  const optMeta = check('Option key acts as Meta/Alt', s.macOptionIsMeta !== false);
  // the two paste-guard toggles (terminal.js pasteText); their long explanation lives in the user guide
  const pasteConfirm = check('Confirm multi-line pastes', s.pasteConfirmMultiline !== false, { title: `A paste with more than one line, or over ${PASTE_CONFIRM_CHARS} characters, asks first and can be edited` });
  const pasteWarn = check('Warn about suspicious pastes', s.pasteWarnSuspicious !== false, { title: 'Invisible or control characters, a trailing newline, curl | sh, writes to shell profiles, rm -rf / and look-alike letters are listed, with a "Paste cleaned" option' });
  // the explanation is the row's tooltip: the Terminal section must keep fitting a 900×560 window without scrolling
  const monitorBar = check('Remote monitoring bar on SSH sessions', s.monitorBar !== false, { title: 'CPU, memory, disk, network, load and uptime under each SSH terminal, polled over the session\'s own connection; a session (Advanced SSH) or a pane (its head, the View menu) can differ' });
  const monitorInterval = num(s.monitorInterval ?? 3, { min: 2, max: 30, step: 1, class: 'mon-interval', 'aria-label': 'Monitoring bar refresh, seconds', title: 'Seconds between two polls (2–30)' });
  // keyword highlighting: the switch here, the rule table in a sub-dialog (the Terminal tab must keep fitting 900×560);
  // null rules = the built-in set, so "Restore defaults" (or an unchanged table) keeps following it
  const hlEnabled = check('Highlight keywords: errors, warnings, OK, IP addresses, URLs, sizes', s.highlightEnabled !== false);
  let hlRules = Array.isArray(s.highlightRules) && s.highlightRules.length ? s.highlightRules.map(normalizeRule) : null;
  const hlRulesBtn = h('button', { class: 'btn small', type: 'button', onclick: async () => {
    const r = await highlightRulesDialog(hlRules);
    if (r) hlRules = sameRules(r, DEFAULT_RULES) ? null : r;
  } }, 'Rules…');
  const zmodemCb = check('Zmodem transfers (rz/sz)', s.zmodem !== false);
  const localShell = text(s.localShell, { placeholder: '(login shell)' });
  const shellInt = check('zsh/bash integration (folder following)', s.localShellIntegration !== false);
  const editor = text(s.editorCommand, { placeholder: 'e.g. code --wait {file}   (blank = TextEdit)' });
  const confirmClose = check('Confirm quit with open connections (SSH, Mosh, SFTP, FTP)', s.confirmClose);
  const restoreWs = check('Restore tabs & split layout at startup', s.restoreWorkspace !== false);
  const sftpAutoOpen = check('Switch to SFTP panel when SSH connects', s.sftpAutoOpen !== false);
  const downloadDir = text(s.downloadDir, { placeholder: '~/Downloads' });
  const logDir = text(s.logDir, { placeholder: '~/Documents/MobAlt Logs' });
  const logPlain = check('Strip colours and control sequences from session logs (plain text)', !!s.logPlainText);
  const keepAlive = num(s.keepAliveInterval, { min: 0, max: 3600 });
  const autoUpdate = check('Check for updates at startup', s.autoUpdate !== false);
  // Settings → General → Language: 'system' follows the macOS language list (the name shows what that is on this Mac);
  // a choice applies at once to menus, panels and dialogs of every window (app.js _applyLanguage) — terminals are never touched
  const sysLang = languageOf(SYSTEM_LOCALE) || LANGUAGES[0];
  const language = select([['system', t('System default ({name})', { name: sysLang.name })], ...LANGUAGES.map((l) => [l.code, l.name])], languageOf(s.language) ? languageOf(s.language).code : 'system', { 'aria-label': t('Language') });
  // "Check now" reports on its own line, e.g. "0.11.0 is already installed on disk; relaunch to use it"
  const updStatus = h('span', { class: 'upd-status', 'aria-live': 'polite' });
  const checkNow = h('button', { class: 'btn small', type: 'button', onclick: async () => {
    updStatus.textContent = 'Checking…';
    try {
      const r = await window.api.app.checkUpdates();
      updStatus.textContent = (r && r.message) || '';
    } catch (e) {
      updStatus.textContent = e.message;
    }
  } }, 'Check now');
  // Five section tabs (General / Terminal / Features / Logging / Updates): each fits the 900×560 minimum window without scrolling.
  // Every field stays in the DOM whichever tab is in front, so Save reads them all.
  const tabs = modalTabs([
    ['general', 'General', h('div', { class: 'form-grid' },
      ...field(t('Language'), language, t('Menus, panels and dialogs switch at once; terminal output is not translated')),
      h('label', {}, 'Behaviour'), h('div', { class: 'checks' }, confirmClose.el, sftpAutoOpen.el, restoreWs.el),
      ...field('Local shell', localShell), h('label', {}), h('div', { class: 'checks' }, shellInt.el),
      ...field('External editor', editor, '{file} is replaced by the temp file path; omit it to append the path'),
      ...field('Download folder', downloadDir), ...field('SSH keep-alive (s)', keepAlive),
      h('label', {}, 'Data'), h('div', {}, h('button', { class: 'btn small', onclick: () => window.api.shell.openPath(app.info.userData) }, 'Open config folder'))
    )],
    ['terminal', 'Terminal', h('div', { class: 'form-grid' },
      ...field('Font family', fontFamily), ...field('Font size', fontSize), ...field('Line height', lineHeight),
      ...field('Cursor', h('div', { class: 'inline' }, cursorStyle, cursorBlink.el)), // the blink toggle shares the row: Terminal is the tallest section and must fit the 560px window
      ...field('Scrollback lines', scrollback),
      ...field('Theme', h('div', { class: 'inline theme-field' }, theme, themePreview), 'Colours the whole window — toolbar, sidebar, tabs, dialogs — not only the terminals; a session can keep its own terminal theme'),
      h('label', {}, 'Mouse / keys'), h('div', { class: 'checks' }, rightClickPaste.el, copyOnSelect.el, optMeta.el)
    )],
    ['features', 'Features', h('div', { class: 'form-grid' },
      h('label', {}, 'Paste guard'), h('div', { class: 'checks' }, pasteConfirm.el, pasteWarn.el),
      h('label', {}, 'Monitoring'), h('div', { class: 'checks' }, monitorBar.el, h('label', { class: 'mon-every' }, 'every', monitorInterval, 's')),
      h('label', {}, 'Keyword highlighting'), h('div', { class: 'checks hl-row' }, hlEnabled.el, hlRulesBtn),
      h('label', {}, 'Transfers'), h('div', { class: 'checks' }, zmodemCb.el)
    )],
    ['logging', 'Logging', h('div', { class: 'form-grid' },
      ...field('Log folder', logDir, 'Terminal → Start Session Log, or a session\'s Logging option, writes here'),
      h('label', {}, 'Session logs'), h('div', { class: 'checks' }, logPlain.el)
    )],
    ['updates', 'Updates', h('div', { class: 'form-grid' },
      h('label', {}, 'Updates'), h('div', { class: 'checks' }, autoUpdate.el),
      h('div', { class: 'form-help' }, 'Releases on GitHub; a newer version is offered in a dialog and installed only when you agree'),
      h('label', {}), h('div', { class: 'checks' }, checkNow, updStatus)
    )],
  ]);
  const body = h('div', { class: 'settings-tabs' }, tabs.strip, ...Object.values(tabs.pages));
  const m = showModal({
    title: 'Settings',
    width: 'wide',
    body,
    buttons: [
      { label: 'Cancel', value: null },
      { label: 'Save', primary: true, action: (api) => api.close({
        fontFamily: fontFamily.value.trim() || s.fontFamily, fontSize: clamp(parseInt(fontSize.value, 10), 8, 40, 13), lineHeight: clamp(parseFloat(lineHeight.value), 0.8, 2, 1),
        cursorStyle: cursorStyle.value, cursorBlink: cursorBlink.cb.checked, scrollback: clamp(parseInt(scrollback.value, 10), 100, 1000000, 10000), theme: theme.value,
        rightClickPaste: rightClickPaste.cb.checked, copyOnSelect: copyOnSelect.cb.checked, macOptionIsMeta: optMeta.cb.checked, zmodem: zmodemCb.cb.checked,
        pasteConfirmMultiline: pasteConfirm.cb.checked, pasteWarnSuspicious: pasteWarn.cb.checked,
        localShell: localShell.value.trim(), localShellIntegration: shellInt.cb.checked, editorCommand: editor.value.trim(),
        confirmClose: confirmClose.cb.checked, sftpAutoOpen: sftpAutoOpen.cb.checked, restoreWorkspace: restoreWs.cb.checked, downloadDir: downloadDir.value.trim(), logDir: logDir.value.trim(), logPlainText: logPlain.cb.checked,
        keepAliveInterval: clamp(parseInt(keepAlive.value, 10), 0, 3600, 30), autoUpdate: autoUpdate.cb.checked, language: language.value,
        monitorBar: monitorBar.cb.checked, monitorInterval: clamp(parseInt(monitorInterval.value, 10), 2, 30, 3),
        highlightEnabled: hlEnabled.cb.checked, highlightRules: hlRules,
      }) },
    ],
  });
  holdTallest(body, tabs, 'general'); // Terminal is the tallest section: the dialog never jumps when it comes to the front
  return m.promise;
}

export function hostKeyDialog(p) {
  const forName = p.name ? ` — ${p.name}` : '';
  const m = showModal({
    title: (p.status === 'mismatch' ? '⚠️ Host key changed!' : 'Unknown host key') + forName,
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
  const input = h('input', { type: 'password', autocomplete: 'current-password', 'aria-label': 'Password', style: { width: '100%', height: '28px', padding: '0 8px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg-input)' } });
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
  const inputs = (p.prompts || []).map((pr) => h('input', { type: pr.echo ? 'text' : 'password', 'aria-label': pr.prompt, style: { width: '100%', height: '28px', padding: '0 8px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg-input)', marginBottom: '8px' } }));
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

/**
 * The paste guard's preview: the text with every finding's characters wrapped in a <mark>, drawn in a <pre> behind
 * a transparent textarea that has the same box and font (styles.css .pg-preview), so the marks sit under the editable
 * text. Zero-width characters and line breaks get a thin bar (padding without advance) so that they show at all.
 */
function paintPasteMarks(pre, value, findings, max = Infinity) {
  const ranges = [];
  for (const f of findings) for (const [index, length] of f.ranges) ranges.push({ index, length, kind: f.kind });
  ranges.sort((a, b) => a.index - b.index);
  const nodes = [];
  let at = 0, painted = 0;
  for (const r of ranges) {
    if (r.index < at) continue; // inside the previous mark (a look-alike word that also holds an invisible character)
    if (painted >= max) break; // thousands of marks (every line of a long paste flagged) cost more to paint than they tell
    painted++;
    if (r.index > at) nodes.push(document.createTextNode(value.slice(at, r.index)));
    const bar = r.kind === 'invisible' || r.kind === 'control' || r.kind === 'trailing-newline' || r.kind === 'cr';
    nodes.push(h('mark', { class: 'pg-mark' + (DANGER_KINDS.has(r.kind) ? ' danger' : '') + (bar ? ' pg-bar' : '') }, value.slice(r.index, r.index + r.length)));
    at = r.index + r.length;
  }
  if (at < value.length) nodes.push(document.createTextNode(value.slice(at)));
  if (value.endsWith('\n')) nodes.push(document.createTextNode('\n')); // a textarea shows an empty last line after a final newline; a <pre> hangs it
  pre.replaceChildren(...nodes);
  return { total: ranges.length, painted };
}

/** The preview re-analyses the edited text this long after the last keystroke, and paints at most this many marks. */
const PG_DEBOUNCE_MS = 120;
const PG_MAX_MARKS = 500;

/**
 * The paste guard (app.js guardPaste): "Paste N lines into <where>?" with what src/renderer/pasteguard.js found, an
 * editable preview with the offending characters marked, and Paste (as is) / Paste cleaned / Cancel. ⌘⏎ pastes, Esc
 * cancels; the textarea has the focus. `warn` false hides the findings (the "Warn about suspicious pastes" toggle is
 * off: only the multi-line confirmation is wanted). Resolves with the text to send, or null.
 */
export function pasteGuardDialog({ text, analysis, where, warn = true }) {
  const lf = (t) => t.replace(/\r\n|\r/g, '\n'); // a textarea's value is LF-normalised whatever was put in it
  const findingsOf = (a) => (warn ? a.findings : []);
  const ta = h('textarea', { class: 'pg-text', spellcheck: false, autocapitalize: 'off', autocomplete: 'off', wrap: 'soft', 'aria-label': 'Text to paste (editable)' });
  ta.value = text;
  const backdrop = h('pre', { class: 'pg-backdrop', 'aria-hidden': 'true' });
  const list = h('ul', { class: 'pg-findings', hidden: true });
  const note = h('div', { class: 'pg-note' });
  const lfText = lf(text);
  const lfAnalysis = lfText === text ? analysis : analysePaste(lfText); // the marks sit on the textarea's own (LF) text, whose offsets differ once CRs are gone
  const edited = () => ta.value !== lfText;
  const value = () => (edited() ? ta.value : text); // untouched: the original goes out, CR / CRLF intact
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const title = (a) => `Paste ${plural(a.lines, 'line')} into ${where}?`;
  let pasteBtn = null, cleanBtn = null, m = null;
  const render = () => {
    const current = edited() ? analysePaste(ta.value) : analysis; // one analysis per render
    const marks = edited() ? current : lfAnalysis;
    const fs = findingsOf(current);
    const danger = fs.some((f) => DANGER_KINDS.has(f.kind));
    list.hidden = !fs.length;
    list.className = 'pg-findings' + (danger ? ' danger' : '');
    list.replaceChildren(...fs.map((f) => h('li', {}, h('span', { class: 'pg-kind' }, KIND_LABEL[f.kind] || f.kind), h('span', { class: 'pg-msg' }, f.message, current.multiline ? h('span', { class: 'pg-where' }, ` (line ${f.line})`) : null))));
    const cleanable = warn && current.cleanable;
    const painted = paintPasteMarks(backdrop, ta.value, findingsOf(marks), PG_MAX_MARKS);
    note.textContent = `${plural(current.lines, 'line')} · ${plural(current.chars, 'character')} · ⌘⏎ pastes, Esc cancels` + (cleanable ? ' · Paste cleaned removes the hidden characters and the trailing newline' : '')
      + (painted.painted < painted.total ? ` · marks on the first ${painted.painted} of ${painted.total} places` : '');
    if (cleanBtn) cleanBtn.hidden = !cleanable;
    if (pasteBtn) pasteBtn.textContent = fs.length ? 'Paste as is' : 'Paste';
    if (m) { // the title counts the lines of what will be pasted, edits included
      const t = title(current);
      m.el.querySelector('.modal-title-text').textContent = t;
      m.el.setAttribute('aria-label', t);
    }
  };
  m = showModal({
    title: title(analysis),
    width: 'wide',
    closeOnBackdrop: false,
    body: h('div', { class: 'pg' }, note, list, h('div', { class: 'pg-preview' }, backdrop, ta)),
    buttons: [
      { label: 'Cancel', value: null },
      { label: 'Paste cleaned', action: (api) => api.close(analysePaste(value()).cleaned) },
      { label: 'Paste', primary: true, action: (api) => api.close(value()) },
    ],
  });
  [, cleanBtn, pasteBtn] = [...m.el.querySelectorAll('.modal-foot button')];
  render();
  let pending = null; // typing re-analyses once the keys pause, not per keystroke (a 5000-line flagged paste took 190 ms each)
  ta.addEventListener('input', () => { clearTimeout(pending); pending = setTimeout(render, PG_DEBOUNCE_MS); });
  ta.addEventListener('scroll', () => { backdrop.scrollTop = ta.scrollTop; backdrop.scrollLeft = ta.scrollLeft; });
  m.el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.metaKey && !e.isComposing) { e.preventDefault(); e.stopPropagation(); m.close(value()); }
  });
  setTimeout(() => { ta.focus(); ta.setSelectionRange(0, 0); ta.scrollTop = 0; }, 20);
  return m.promise;
}

export function shortcutsDialog(app) {
  const rightClick = app.settings.rightClickPaste !== false;
  // One section tab per area, each two columns of label + key chip (a chip that does not fit beside its label drops
  // to its own line, styles.css .shortcuts): every section fits the 900×560 minimum window without scrolling.
  const sections = [
    ['sessions', 'Sessions & tabs', [
      ['New session', '⌘N'], ['New local terminal', '⌘T'], ['Quick connect', '⇧⌘N'], ['Duplicate session', '⇧⌘T'], ['Reconnect', '⌘R'], ['Close tab', '⌘W'],
      ['Next / previous tab', '⌃Tab / ⌃⇧Tab'], ['Switch to tab 1-9', '⌃⌘1 … ⌃⌘9'], ['Focused tab: move / activate / close', '← → / ⏎ / ⌫'],
      ['Pin / unpin tab, detach tab to its own window', '⇧⌘P / ⌥⌘N'],
    ]],
    ['panes', 'Panes & terminal', [
      ['Split right / down', '⌘D / ⇧⌘D'], ['Grid 2 / 4 / 6 / 8 panes', '⌥⌘2 / ⌥⌘4 / ⌥⌘6 / ⌥⌘8'], ['Unsplit', '⌥⌘1'], ['Close pane', '⇧⌘W'], ['Next pane', '⌘]'], ['Zoom pane (fill the tab) / restore', '⇧⌘⏎'],
      ['Find', '⌘F'], ['Clear terminal', '⌘K'], ['Zoom', '⌘= / ⌘- / ⌘0'], ['Copy / Paste', '⌘C / ⌘V'], ['Paste (terminal)', rightClick ? 'Right-click' : '⌘V'], ['Terminal menu', rightClick ? '⇧Right-click' : 'Right-click'],
      ['Newline in TUI apps (ESC+CR)', '⇧Enter / ⌥Enter'], ['MultiExec', '⇧⌘M'],
    ]],
    ['sidebar', 'Sidebar, SFTP & lists', [
      ['Toggle sidebar', '⌘B'], ['Sessions / SFTP / Tools / Macros', '⌘1 / ⌘2 / ⌘3 / ⌘4'],
      ['Focused session row: move / fold / open', '↑ ↓ / ← → / ⏎'], ['Focused session row: open in split / delete', '⌘⏎ or ⇧⏎ / ⌫'],
      ['Focused macro: play / delete, context menu', '⏎ / ⌫, ⇧F10'], ['Context menu: focused tab, row, macro, SFTP entry', '⇧F10 / Menu key'],
      ['SFTP list: context menu / delete / parent folder', '⇧F10 or Menu / Del or ⌘⌫ / ⌫'], ['SFTP list: move / open', '↑ ↓ Home End PgUp PgDn / ⏎'],
      ['SFTP list: extend selection / toggle row / select all', '⇧↑ ⇧↓ ⇧Home ⇧End / Space / ⌘A'], ['SFTP list: sort by a column', 'Tab to a header, ⏎ or Space'],
      ['Session tree, SFTP list: jump to a name', 'type its first letters'],
    ]],
    ['dialogs', 'Dialogs', [
      ['Settings', '⌘,'], ['Tunnels', '⇧⌘U'], ['Icon & colour picks: move / choose', '← → ↑ ↓ / ⏎ or Space'],
      ['Dialog: confirm / close', '⏎ / Esc'], ['Dialog: next / previous control', 'Tab / ⇧Tab'], ['Dialog tabs: previous / next, first / last section', '← → / Home End'],
      ['Paste guard (multi-line or suspicious paste): paste / cancel', '⌘⏎ / Esc'],
    ]],
  ];
  const tabs = modalTabs(sections.map(([k, label, rows]) => [k, label, h('div', {}, h('div', { class: 'shortcuts' }, rows.map(([a, b]) => h('div', {}, h('span', {}, a), h('span', { class: 'kbd' }, b)))))]));
  const body = h('div', { class: 'shortcuts-tabs' }, tabs.strip, ...Object.values(tabs.pages));
  showModal({ title: 'Keyboard shortcuts', width: 'wide', body, buttons: [{ label: 'Close', value: null }] });
  holdTallest(body, tabs, sections[0][0]);
}

/** ~ for the home folder in what the key generator shows. */
const tildeHome = (p, home) => (home && p.startsWith(home + '/') ? '~' + p.slice(home.length) : p);
/** A rough passphrase strength for the hint under the field: ['none' | 'weak' | 'fair' | 'strong', text]. */
export function passphraseStrength(p) {
  if (!p) return ['none', 'No passphrase: anyone who copies the private key file can use it'];
  let score = 0;
  if (p.length >= 8) score++;
  if (p.length >= 12) score++;
  if (p.length >= 20) score++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) score++;
  if (/\d/.test(p)) score++;
  if (/[^A-Za-z0-9\s]/.test(p)) score++;
  if (p.trim().split(/\s+/).length >= 4) score += 2; // a few words make a good passphrase
  return score <= 2 ? ['weak', 'Weak passphrase: use 12 characters or more with mixed case, digits or symbols, or a few words']
    : score <= 4 ? ['fair', 'Fair passphrase'] : ['strong', 'Strong passphrase'];
}

/**
 * SSH key generator (the MobaKeyGen counterpart): key type, comment, passphrase, output file, "add to ssh-agent" and
 * "install on a server" (ssh-copy-id over a saved session), then the public key with Copy and the fingerprint.
 * Resolves { privateKeyPath, publicKeyPath, publicKey } when a key was generated and "Use in this session" chosen
 * (the editor's Generate… button, `forSession`), null otherwise.
 */
export async function keygenDialog(app, { forSession = false } = {}) {
  const KINDS = [['ed25519', 'Ed25519 (recommended)'], ['rsa', 'RSA 4096'], ['ecdsa-256', 'ECDSA P-256'], ['ecdsa-384', 'ECDSA P-384']];
  const kindOf = (v) => v.split('-')[0];
  const bitsOf = (v) => (v === 'rsa' ? 4096 : v.startsWith('ecdsa') ? parseInt(v.split('-')[1], 10) : undefined);
  const home = app.info.home || '';
  const user = home.split('/').pop() || 'user';
  const type = select(KINDS, 'ed25519');
  const comment = text(`${user}@mobalt`, { placeholder: 'comment (who / what this key is for)' });
  const pass = h('input', { type: 'password', placeholder: 'optional: protects the private key file', autocomplete: 'new-password' });
  const pass2 = h('input', { type: 'password', placeholder: 'repeat the passphrase', autocomplete: 'new-password' });
  const strength = h('div', { class: 'form-help keygen-strength', 'aria-live': 'polite' });
  const passErr = h('div', { class: 'form-error', role: 'alert', hidden: true });
  const outPath = text('', { placeholder: '~/.ssh/id_ed25519' });
  const pathErr = h('div', { class: 'form-error', role: 'alert', hidden: true });
  let suggested = '';
  const suggest = async () => {
    try { suggested = await window.api.keygen.suggest(kindOf(type.value)); } catch { suggested = `~/.ssh/id_${kindOf(type.value)}`; }
    return suggested;
  };
  outPath.value = await suggest(); // the next free ~/.ssh/id_<type> (a counter when that name is taken)
  type.addEventListener('change', async () => {
    const was = suggested;
    const next = await suggest();
    if (!outPath.value.trim() || outPath.value === was) outPath.value = next; // a path typed by hand stays
  });
  const browse = h('button', { class: 'btn small', type: 'button', onclick: async () => {
    const cur = outPath.value.trim() || suggested;
    const r = await window.api.dialog.save({ title: 'Save private key as', defaultPath: cur.startsWith('~') ? home + cur.slice(1) : cur, properties: ['showHiddenFiles', 'createDirectory'] });
    if (!r.canceled && r.filePath) { outPath.value = tildeHome(r.filePath, home); pathErr.hidden = true; }
  } }, 'Browse…');
  const agent = check('Add to ssh-agent (ssh-add --apple-use-keychain)', false);
  const install = check('Install on a server…', false);
  const sshSessions = app.sessions.sessions.filter((x) => x.type === 'ssh');
  const target = select(sshSessions.length
    ? sshSessions.map((x) => [x.id, `${x.name} (${x.username ? x.username + '@' : ''}${x.host}${x.port && x.port !== 22 ? ':' + x.port : ''})`])
    : [['', '(no saved SSH session yet)']], sshSessions[0] ? sshSessions[0].id : '');
  if (!sshSessions.length) target.disabled = true;
  const remoteFile = text('~/.ssh/authorized_keys');
  const installRows = [
    ...field('Server', target, 'A saved SSH session; it connects with its usual authentication (you may be asked for its password) and appends the public key like ssh-copy-id'),
    ...field('Remote file', remoteFile),
  ];
  const applyInstall = () => { for (const el of installRows) el.hidden = !install.cb.checked; };
  install.cb.addEventListener('change', applyInstall);
  applyInstall();
  const updateStrength = () => {
    const [level, msg] = passphraseStrength(pass.value);
    strength.textContent = msg;
    strength.dataset.level = level;
  };
  pass.addEventListener('input', () => { updateStrength(); passErr.hidden = true; });
  pass2.addEventListener('input', () => { passErr.hidden = true; });
  outPath.addEventListener('input', () => { pathErr.hidden = true; });
  updateStrength();
  const status = h('div', { class: 'keygen-status', 'aria-live': 'polite' });
  const form = h('div', { class: 'form-grid keygen-form' },
    ...field('Key type', type), ...field('Comment', comment),
    ...field('Passphrase', pass), strength, ...field('Confirm', pass2), passErr,
    ...field('Save as', h('div', { class: 'inline' }, outPath, browse), 'The public key goes next to it with .pub; ~/.ssh is created private when missing'), pathErr,
    h('label', {}, 'Options'), h('div', { class: 'checks' }, agent.el, install.el),
    ...installRows
  );
  const result = h('div', { class: 'keygen-result', hidden: true });
  const body = h('div', { class: 'keygen' }, form, result, status);
  let done = null; // { privateKeyPath, publicKeyPath, publicKey } once generated
  // while the key is generated / added to the agent / installed, the dialog cannot be dismissed (Cancel, ✕, Esc):
  // the key pair is on disk by then, and closing early would hide its path and the install's outcome
  let busyNow = false;
  const m = showModal({
    title: 'Generate SSH key',
    width: 'wide',
    closeOnBackdrop: false,
    beforeClose: () => !busyNow,
    body,
    buttons: [
      { label: 'Cancel', value: null },
      { label: 'Use in this session', action: (api) => api.close(done) },
      { label: 'Generate', primary: true, action: (api) => (done ? api.close(forSession ? done : null) : generate(api)) },
    ],
  });
  const [cancelBtn, useBtn, genBtn] = m.el.querySelectorAll('.modal-foot .btn');
  const closeX = m.el.querySelector('.modal-title .close');
  useBtn.hidden = true;
  const controls = () => [...form.querySelectorAll('input, select, button')];
  const busy = (on) => {
    busyNow = on;
    for (const el of controls()) el.disabled = on || (el === target && !sshSessions.length);
    genBtn.disabled = on;
    cancelBtn.disabled = on;
    closeX.disabled = on;
    closeX.title = on ? 'Wait for the key to be generated and installed' : 'Close (Esc)';
  };

  async function generate() {
    passErr.hidden = pathErr.hidden = true;
    if (pass.value !== pass2.value) {
      passErr.textContent = 'The passphrases do not match';
      passErr.hidden = false;
      pass2.focus();
      pass2.select();
      return;
    }
    const where = outPath.value.trim();
    if (!where) {
      pathErr.textContent = 'Choose where to save the key';
      pathErr.hidden = false;
      outPath.focus();
      return;
    }
    if (install.cb.checked && !target.value) return toast('Save an SSH session first to install the key on it', 'warn');
    busy(true);
    status.textContent = `Generating ${KINDS.find((k) => k[0] === type.value)[1]} key…`;
    let r;
    try {
      r = await window.api.keygen.generate({ type: kindOf(type.value), bits: bitsOf(type.value), comment: comment.value.trim(), passphrase: pass.value, path: where });
    } catch (e) {
      busy(false);
      status.textContent = '';
      pathErr.textContent = ipcMessage(e); // "~/.ssh/id_ed25519 already exists — choose another file name", "ssh-keygen was not found…"
      pathErr.hidden = false;
      outPath.focus();
      return;
    }
    done = { privateKeyPath: r.privateKeyPath, publicKeyPath: r.publicKeyPath, publicKey: r.publicKey };
    const steps = [];
    if (agent.cb.checked) {
      status.textContent = 'Adding the key to ssh-agent…';
      const a = await window.api.keygen.addToAgent(r.privateKeyPath, pass.value).catch((e) => ({ ok: false, error: ipcMessage(e) }));
      steps.push({ ok: a.ok, text: a.ok ? `Added to ssh-agent (${a.message})` : `ssh-agent: ${a.error}` });
    }
    if (install.cb.checked && target.value) {
      const sess = sshSessions.find((x) => x.id === target.value);
      status.textContent = `Installing the public key on ${sess ? sess.name : 'the server'}…`;
      const i = await window.api.keygen.install(target.value, r.publicKey, remoteFile.value.trim() || '~/.ssh/authorized_keys').catch((e) => ({ ok: false, error: ipcMessage(e) }));
      steps.push({ ok: i.ok, text: i.ok ? (i.added ? `Installed on ${i.host} in ${i.remoteFile}` : `Already present on ${i.host} in ${i.remoteFile}`) : i.error });
    }
    status.textContent = '';
    busy(false); // the result can be closed again
    showResult(r, steps);
  }

  function showResult(r, steps) {
    const pub = h('textarea', { class: 'keygen-pub', readOnly: true, rows: 3, spellcheck: false });
    pub.value = r.publicKey;
    pub.addEventListener('focus', () => pub.select());
    const copy = h('button', { class: 'btn small', type: 'button', onclick: async () => {
      await window.api.clipboard.write(r.publicKey);
      toast('Public key copied', 'success');
    } }, 'Copy');
    const fp = r.fingerprint || {};
    result.replaceChildren(
      h('div', { class: 'keygen-ok' }, 'Key pair saved: ', h('span', { class: 'mono' }, tildeHome(r.privateKeyPath, home)), ' (private, 0600) and ', h('span', { class: 'mono' }, tildeHome(r.publicKeyPath, home)), ' (public, 0644)'),
      h('div', { class: 'form-grid' },
        ...field('Public key', h('div', { class: 'inline keygen-pubrow' }, pub, copy), 'One line for ~/.ssh/authorized_keys on the servers this key should open'),
        ...field('Fingerprint', h('div', { class: 'hostkey-fp keygen-fp' }, fp.hash ? `${fp.hash} (${fp.type} ${fp.bits})` : fp.line || '')),
        ...(steps.length ? [h('label', {}, 'Steps'), h('div', { class: 'keygen-steps' }, steps.map((st) => h('div', { class: 'keygen-step ' + (st.ok ? 'ok' : 'err') }, st.text)))] : [])
      )
    );
    form.hidden = true;
    result.hidden = false;
    m.el.querySelector('.modal-title-text').textContent = 'SSH key generated';
    genBtn.hidden = true;
    cancelBtn.textContent = 'Close';
    if (forSession) { useBtn.hidden = false; useBtn.classList.add('primary'); useBtn.focus(); }
    else copy.focus();
  }
  return m.promise;
}
