# MobAlt — MobaXterm alternative for macOS

MobaXterm을 쓰던 사람이 macOS에서 같은 방식으로 일할 수 있도록 만든 **탭형 SSH/SFTP/로컬 터미널 앱**입니다.
세션 매니저, 접속과 동시에 열리는 SFTP 브라우저, X11 포워딩, 포트 포워딩(터널), MultiExec, 분할 창, 매크로, 네트워크 도구, Serial 콘솔을 한 창에 담았습니다.

- 저장소: https://github.com/Hyeongcheol-An/mobaXterm
- 배포: [GitHub Releases](https://github.com/Hyeongcheol-An/mobaXterm/releases) — `main`에 커밋이 올라가면 semantic-release가 버전을 올리고 DMG/zip(arm64·x64)을 자동으로 첨부합니다.

## MobaXterm 기능 대응표

| MobaXterm | MobAlt | 비고 |
|---|---|---|
| Sessions 사이드바 (폴더, 검색) | ✅ Sessions 패널 | 폴더 드래그 이동, 필터, 우클릭 메뉴, 세션 복제 |
| SSH 세션 (비밀번호/키/에이전트) | ✅ | 자동(키→에이전트→비밀번호) 순서, keyboard-interactive(2FA), 암호화 키 패스프레이즈 프롬프트 |
| 비밀번호 저장(마스터 암호) | ✅ | macOS Keychain 기반 `safeStorage`로 암호화 저장 |
| Host key 확인 | ✅ | `~/.ssh/known_hosts` + 앱 자체 known_hosts, 변경 시 경고 |
| SFTP 브라우저 (접속 시 자동) | ✅ Sftp 패널 | 업로드/다운로드(폴더 재귀, 진행률, 취소), 새 폴더, 이름 변경, 권한(chmod), 삭제, 숨김 파일 |
| "Follow terminal folder" | ✅ | OSC 7 셸 훅(bash/zsh) 주입 — 세션 옵션에서 켜기 |
| 원격 파일 편집 (MobaTextEditor) | ✅ | 내장 편집기(⌘S 저장) + 외부 편집기(저장 시 자동 업로드) |
| 드래그 앤 드롭 업로드 | ✅ | Finder → SFTP 목록 또는 터미널 위로 드롭 |
| 내장 X 서버 | ✅ XQuartz 연동 | 세션 옵션 X11 켜면 XQuartz 자동 기동·쿠키 교체 프록시 |
| MobaSSHTunnel (포트 포워딩) | ✅ Tunneling | Local(-L), Remote(-R), Dynamic SOCKS5(-D). 세션별 자동 터널 + 독립 터널 |
| MultiExec | ✅ | 모든 터미널에 동시 입력 (⇧⌘M) |
| 분할 터미널 | ✅ | 가로/세로 분할(⌘D / ⇧⌘D), 드래그로 크기 조절 |
| Macros | ✅ | 키 입력 녹화/재생, 텍스트 매크로, 모든 터미널에 재생 |
| Tools (ping, traceroute, port scan…) | ✅ Tools 패널 | Ping, Traceroute, DNS 조회, 포트 스캔, 네트워크 정보 |
| Telnet | ✅ | NAWS/TTYPE 협상 포함 |
| RDP / VNC | ⚠️ 외부 앱 실행 | RDP는 `.rdp` 파일 생성 후 Windows App으로, VNC는 macOS 화면 공유(`vnc://`)로 |
| 로컬 터미널 (Cygwin) | ✅ 네이티브 zsh/bash | macOS 로그인 셸을 그대로 사용, 폴더 추종 셸 통합 |
| 세션 로그 저장 | ✅ | 세션 옵션 또는 우클릭 → Session Log |
| MobaXterm.ini 가져오기 | ✅ | Bookmarks 섹션(SSH/Telnet/RDP/VNC) best-effort 파싱, `~/.ssh/config` 가져오기도 지원 |
| Serial 콘솔 | ✅ | USB-시리얼 장치 자동 검색, baud/framing/flow, 로컬 에코, Enter→CR/LF/CRLF |
| Mosh, FTP | ❌ 미구현 | 필요 시 추가 가능 |

## 설치

1. [Releases](https://github.com/Hyeongcheol-An/mobaXterm/releases)에서 `MobAlt-<버전>-arm64.dmg`(Apple Silicon) 또는 `-x64.dmg`(Intel)를 받습니다.
2. DMG를 열어 `MobAlt.app`을 응용 프로그램 폴더로 끕니다.
3. 코드 서명이 없는 앱이므로 첫 실행 시 Gatekeeper가 막습니다. 아래 중 하나로 열어 주세요.
   - Finder에서 앱을 **우클릭 → 열기 → 열기**
   - 또는 터미널에서 `xattr -dr com.apple.quarantine /Applications/MobAlt.app`
4. X11 포워딩을 쓰려면 [XQuartz](https://www.xquartz.org/)를 설치합니다. 앱이 필요할 때 자동으로 띄웁니다.

## 사용법 요약

- **세션 만들기**: 툴바 `＋ Session`(⌘N) → 종류(SSH/Local/Telnet/RDP/VNC) 선택 → 저장 & 접속. 사이드바에서 더블클릭으로 접속합니다.
- **빠른 접속**: 우측 상단 `user@host[:port]` 입력 후 Enter. `telnet://`, `rdp://`, `vnc://` 접두사도 됩니다.
- **SFTP**: SSH 접속 시 Sftp 패널이 자동으로 열립니다. 더블클릭으로 폴더 이동/파일 편집, `>_` 버튼으로 터미널을 현재 폴더로 `cd`.
- **터널**: 툴바 `Tunneling`(⇧⌘U)에서 열린 연결 또는 저장된 세션을 통해 터널을 시작합니다. 세션 편집기의 Tunnels 탭에 등록하면 접속 시 자동 시작됩니다.
- **MultiExec**: 툴바 버튼 또는 ⇧⌘M. 켜져 있는 동안 입력이 모든 터미널에 전달됩니다.
- **단축키**: Help → Keyboard Shortcuts. 터미널 우클릭은 붙여넣기(⇧+우클릭은 메뉴), 선택하면 자동 복사됩니다(설정에서 변경 가능).

## 개발

요구 사항: macOS, Node.js 22+, Xcode Command Line Tools(네이티브 모듈 `node-pty` 빌드), Python 3.

```bash
git clone git@github.com:Hyeongcheol-An/mobaXterm.git
cd mobaXterm
npm install          # postinstall에서 node-pty를 Electron ABI로 리빌드
npm start            # 앱 실행
npm test             # 단위 테스트 (importers, known_hosts, x11)
npm run pack         # dist/mac-arm64/MobAlt.app 생성 (서명 없음)
npm run dist         # DMG/zip 생성
npm run install:local  # 최신 코드로 arm64 빌드 후 /Applications/MobAlt.app 설치
```

> VS Code 통합 터미널처럼 `ELECTRON_RUN_AS_NODE=1`이 설정된 셸에서는 `env -u ELECTRON_RUN_AS_NODE npm start`로 실행하세요.

### 구조

```
src/main/           Electron 메인 프로세스
  main.js           창, 메뉴, IPC 라우팅, 테스트 훅
  preload.js        contextBridge로 노출되는 window.api
  store.js          sessions.json / settings.json (비밀은 safeStorage 암호화)
  terminals.js      터미널 레지스트리, 로컬 pty(node-pty), telnet
  ssh.js            ssh2 연결(인증 핸들러, 점프 호스트, X11, 셸)
  sftp.js           SFTP 목록/파일 작업/전송(진행률·취소)/원격 편집
  tunnels.js        -L/-R/-D(SOCKS5) 포트 포워딩
  x11.js            XQuartz 탐색·기동, X11 채널 프록시(쿠키 교체)
  knownhosts.js     호스트 키 검증
  importers.js      ~/.ssh/config, MobaXterm.ini 가져오기
  tools.js          ping/traceroute/port scan/DNS
  zdotdir.js        로컬 zsh 셸 통합(OSC 7)
src/renderer/       렌더러 (프레임워크 없이 ES 모듈)
  app.js            컨트롤러(이벤트, 액션, 상태 표시줄)
  terminal.js       xterm.js 페인(테마, 검색, DnD, 재접속)
  layout.js         탭 + 분할 트리
  sidebar.js        세션 트리
  sftp.js           SFTP 패널
  panels.js         Tools / Macros 패널
  dialogs.js        세션 편집기, 설정, 터널, 호스트키/비밀번호 프롬프트
test/
  unit/             node --test 단위 테스트
  start-sshd.sh     포트 2222 사용자 권한 테스트 sshd(키 인증, SFTP, X11, 포워딩)
  e2e-ssh.js        앱 안에서 실행되는 E2E 스크립트 (SSH/SFTP/X11/터널)
  e2e-ui.js         다이얼로그·패널 UI E2E
  e2e-serial.js     가상 시리얼 장치(mock-serial.py) E2E
  e2e-auth.js       인증 실패 진단·포트 거부 힌트·키 접속 E2E
```

### E2E 테스트 (로컬 sshd)

```bash
test/start-sshd.sh start
S=/tmp/mobalt-e2e; mkdir -p $S/userdata $S/shots
MOBALT_USER_DATA=$S/userdata MOBALT_TEST_SCRIPT=test/e2e-ssh.js MOBALT_SHOT_DIR=$S/shots \
MOBALT_SCREENSHOT=$S/shots/final.png MOBALT_SCREENSHOT_DELAY=120000 npx electron .
test/start-sshd.sh stop
```

호스트키 프롬프트 → 키 인증 → 폴더 추종 → X11 → 세션 터널 → SFTP 업/다운로드·편집 → 암호화 키 패스프레이즈 → 분할 → MultiExec 순으로 검증하고 `RESULTS {...}`를 출력합니다.

## 릴리스 / 버저닝

- 커밋 메시지는 [Conventional Commits](https://www.conventionalcommits.org/)를 따릅니다. `feat:` → minor, `fix:` → patch, `feat!:`/`BREAKING CHANGE` → major.
- `main`에 push되면 `.github/workflows/release.yml`이 macOS 러너에서 `npm test` → `semantic-release`를 실행합니다.
  1. 커밋 분석 → 다음 버전 결정
  2. `CHANGELOG.md` 생성, `package.json` 버전 갱신
  3. `npm run dist`로 DMG/zip 빌드
  4. GitHub Release 생성 + 산출물 첨부, `chore(release): vX.Y.Z [skip ci]` 커밋
- PR과 비-main 브랜치는 `ci.yml`에서 테스트와 패키징만 수행합니다.

## 데이터 위치

`~/Library/Application Support/MobAlt/` — `sessions.json`(비밀은 Keychain 암호화), `settings.json`, `known_hosts`, `zdotdir/`.
세션 로그 기본 위치는 `~/Documents/MobAlt Logs/` 입니다.

## 알려진 제약

- 코드 서명/공증이 없어 첫 실행 시 Gatekeeper 우회가 필요합니다. 배포용 서명에는 Apple Developer Program의 "Developer ID Application" 인증서가 필요합니다(Apple Development 인증서로는 불가).
- `~/.zprofile` 등에서 `export DISPLAY=:0`처럼 DISPLAY를 고정하면 원격 셸의 X11 DISPLAY가 덮어써집니다. X11 포워딩이 안 되면 원격 쪽 rc 파일을 확인하세요.
- MobaXterm.ini 형식은 비공개라 호스트/포트/사용자/폴더/X11 플래그만 가져오며 비밀번호는 가져오지 않습니다. `.ppk` 키는 `puttygen`으로 OpenSSH 형식으로 변환해야 합니다.
- Mosh, FTP는 아직 없습니다.
- 접속이 "Timed out while waiting for handshake" / ETIMEDOUT으로 실패하면 먼저 로컬 터미널에서 `nc -vz <host> <port>`로 TCP 도달 여부를 확인하세요. 직전에 인증 실패가 있었다면 서버의 fail2ban·sshd PerSourcePenalties가 내 IP를 일시 차단했을 수 있습니다(서버에서 `sudo fail2ban-client status sshd`, `unbanip <내 IP>`). 자동 인증 모드는 비밀번호가 저장된 세션에서는 ssh-agent 키를 시도하지 않아 실패 횟수를 줄입니다.

## 라이선스

MIT
