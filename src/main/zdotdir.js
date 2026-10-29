'use strict';
// zsh shell integration for local terminals: a wrapper ZDOTDIR that sources the
// user's real dotfiles and adds a precmd hook emitting OSC 7 (current directory)
// so the SFTP/local file panel can follow the terminal folder.
const fs = require('fs');
const path = require('path');
const { userDataFile } = require('./store');

const FILES = {
  '.zshenv': `# MobAlt shell integration (generated)
__mobalt_orig="\${MOBALT_ORIG_ZDOTDIR:-$HOME}"
__mobalt_zdotdir="$ZDOTDIR"
ZDOTDIR="$__mobalt_orig"
[[ -f "$__mobalt_orig/.zshenv" ]] && source "$__mobalt_orig/.zshenv"
ZDOTDIR="$__mobalt_zdotdir"
`,
  '.zprofile': `__mobalt_orig="\${MOBALT_ORIG_ZDOTDIR:-$HOME}"
[[ -f "$__mobalt_orig/.zprofile" ]] && source "$__mobalt_orig/.zprofile"
`,
  '.zshrc': `__mobalt_orig="\${MOBALT_ORIG_ZDOTDIR:-$HOME}"
[[ -f "$__mobalt_orig/.zshrc" ]] && source "$__mobalt_orig/.zshrc"
__mobalt_cwd() { printf '\\033]7;file://%s%s\\a' "$HOST" "$PWD" }
autoload -Uz add-zsh-hook 2>/dev/null && add-zsh-hook precmd __mobalt_cwd || precmd_functions+=(__mobalt_cwd)
__mobalt_cwd
if [[ "$__mobalt_orig" == "$HOME" ]]; then unset ZDOTDIR; else ZDOTDIR="$__mobalt_orig"; fi
unset __mobalt_orig MOBALT_ORIG_ZDOTDIR
`,
  '.zlogin': `__mobalt_orig="\${MOBALT_ORIG_ZDOTDIR:-$HOME}"
[[ -f "$__mobalt_orig/.zlogin" ]] && source "$__mobalt_orig/.zlogin"
`,
};

function ensureZdotdir() {
  try {
    const dir = userDataFile('zdotdir');
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(FILES)) {
      const p = path.join(dir, name);
      let cur = null;
      try {
        cur = fs.readFileSync(p, 'utf8');
      } catch {}
      if (cur !== content) fs.writeFileSync(p, content);
    }
    return dir;
  } catch {
    return null;
  }
}

module.exports = { ensureZdotdir };
