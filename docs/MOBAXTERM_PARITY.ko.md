# MobaXterm 26.6 기능 대응표

[English](MOBAXTERM_PARITY.md)

MobAlt 0.12.0을 MobaXterm 26.6(Mobatek, Windows, 2026-10-25 출시)과 기능 하나하나 맞대어 본
문서입니다. 비교 기준일은 2026-10-31입니다.

**무엇을 비교했나.** MobaXterm 쪽은 공식 기능 페이지, 문서, 전체 변경 이력(v1.0 → v26.6), Home /
Professional 에디션 안내 페이지를 바탕으로 만든 목록이며, MobaXterm 문서가 나누는 방식 그대로 묶었습니다.
MobAlt 쪽은 0.12.0 소스(`src/main`, `src/renderer`), [사용자 안내서](USER_GUIDE.ko.md), README를 한
줄씩 대조해 확인했고, 기억에 의존해 적은 내용은 없습니다. "Settings → …"는 MobAlt의 Settings 대화상자(⌘,),
"세션 편집기"는 ＋ Session(⌘N), "Sftp 패널"은 파일 브라우저(⌘2), "Tools 패널"은 ⌘3을 뜻합니다.

**상태 열 읽는 법.**

| 상태 | 뜻 |
|---|---|
| ✅ | 사용자 입장에서 같은 기능. 마지막 열에 패널·메뉴·단축키를 적었습니다 |
| 🟡 | 있지만 범위가 좁거나, 방식이 다르거나, 다른 macOS 앱을 거칩니다(RDP는 Windows App, VNC는 화면 공유, X11은 XQuartz) |
| ❌ | 없고, macOS에서 만들 수 있는 것. 이 항목들이 끝의 [로드맵](#로드맵-다음에-만들-것)으로 이어집니다 |
| ➖ | Windows 전용이거나 macOS에서 의미가 없는 것(WSL, Cygwin 플러그인, CMD/PowerShell, CAPI 스마트카드, Home 에디션 제한, Customizer 라이선스 등). 마지막 열에 Mac 사용자가 대신 쓰는 것을 적었습니다 |

변경 이력 항목 여러 개가 한 행에 묶인 경우에는 핵심 기능 기준으로 상태를 매기고, 빠진 부분은 마지막 열에
적었습니다.

## 요약

| 분류 | ✅ | 🟡 | ❌ | ➖ | 행 수 |
|---|---|---|---|---|---|
| 1. 세션 종류 | 7 | 6 | 4 | 4 | 21 |
| 2. SSH 세부 기능 | 15 | 10 | 10 | 2 | 37 |
| 3. 터미널 | 8 | 12 | 10 | 1 | 31 |
| 4. X 서버와 내장 Unix 도구 | 2 | 1 | 1 | 17 | 21 |
| 5. 네트워크·관리 도구, 내장 서버, Moba* 유틸리티 | 4 | 2 | 10 | 19 | 35 |
| 6. 작업대 기능 | 7 | 9 | 6 | 3 | 25 |
| 7. Professional 전용 항목과 Home 에디션 제한 | 0 | 0 | 0 | 13 | 13 |
| **1–7절 합계(기능당 한 번)** | **43** | **40** | **41** | **59** | **183** |
| 8. 최근 추가 기능(24.3 → 26.6) | 2 | 16 | 9 | 3 | 30 |
| 9. 파워 유저가 기대는 UX | 5 | 11 | 3 | 1 | 20 |
| **전체 표 합계** | **50** | **67** | **53** | **63** | **233** |

8절과 9절은 원본 목록의 구성을 그대로 따른 것이라 1–7절에 이미 나온 기능을 다시 세므로, "전체 표 합계"에는
같은 기능이 두 번 들어갑니다. 인용할 때는 1–7절 합계를 쓰세요. 다르게 읽으면, macOS에서 의미가 있는 기능
124개(1–7절에서 ➖ 제외) 가운데 MobAlt는 43개를 그대로, 40개를 더 좁거나 다른 형태로 갖고 있고, 41개는
없습니다.

## 1. 세션 종류

| MobaXterm 기능 | MobAlt | MobAlt의 방식, 또는 없는 이유 |
|---|---|---|
| SSH 세션 | ✅ | 세션 편집기의 SSH 종류: ssh2 터미널, 접속과 함께 열리는 Sftp 패널, X11, 점프 호스트, 터널, 시작 명령 |
| Telnet 세션 | 🟡 | NAWS/TTYPE 협상이 되는 Telnet 종류. 호스트·포트만 받고 keepalive, 자동 로그인, "^M 전송" 옵션은 없음 |
| Rsh / Rlogin 세션 | ➖ | macOS가 더는 클라이언트를 싣지 않는 평문 프로토콜. SSH(구형 장비는 Telnet)를 쓰면 됨 |
| Xdmcp 세션 | ❌ | XDMCP 세션 종류 없음. XQuartz에서 `X :1 -query host`로 직접 띄울 수는 있음 |
| RDP 세션 | 🟡 | RDP 종류는 `.rdp` 파일(호스트·포트·사용자·전체 화면)을 써서 Windows App을 엶. Quick connect의 `rdp://`도 됨 |
| RDP — 새 64비트 엔진 | ➖ | MobaXterm 내부 엔진. macOS에서는 Windows App이 RDP 엔진 |
| RDP — 고급(Restricted Admin, 다중 모니터, 드라이브 등) | 🟡 | 전부 Windows App 안에서 설정. MobAlt는 호스트·포트·사용자만 넘김 |
| VNC 세션 | 🟡 | VNC 종류는 `vnc://` URL을 macOS 화면 공유로 엶. Quick connect의 `vnc://`도 됨. 앱 안 뷰어는 없음 |
| FTP 세션 | ✅ | FTP 종류: 명시적 TLS FTPS, 익명 로그인, 자체 서명 인증서 허용 옵션. Sftp 패널에서 탐색·전송·편집(ASCII 모드는 없음) |
| SFTP 세션 | 🟡 | SFTP 단독 세션은 없음. Sftp 패널은 모든 SSH 세션에 딸려 오고, Mosh에는 동반 SSH 연결로 붙음 |
| Serial(COM) 세션 | ✅ | Serial 종류: USB-시리얼 자동 검색, baud, 데이터/정지 비트, 패리티, 흐름 제어, 로컬 에코, Enter 전송(CR/LF/CRLF). 명명된 파이프는 없음 |
| File 세션(로컬 폴더 탭) | ❌ | 로컬 파일 브라우저 탭 없음. Finder나 Local 터미널의 `open .` |
| Shell 세션(로컬 터미널) | ✅ | Local 종류: 로그인 셸(또는 Settings → General → Local shell의 아무 경로), 시작 폴더, 시작 명령. ⌘T로 바로 하나 |
| Browser 세션 | ❌ | 내장 브라우저 탭 없음 |
| Mosh 세션 | ✅ | Mosh 종류: 키/에이전트/프롬프트로 SSH 부트스트랩, `mosh-server` 경로, 예측 모드. `brew install mosh` 필요 |
| Aws S3 세션 | ❌ | S3 브라우저 없음 |
| WSL 세션 | ➖ | Windows 전용. Local 세션이 이미 Unix 셸 |
| 라이브 세션(저장 안 함) | ✅ | Quick connect 입력란(⇧⌘N): `user@host[:port]`에 `ssh:// mosh:// telnet:// ftp:// ftps:// rdp:// vnc://` 접두사를 붙여 저장하지 않는 세션을 엶. 셸 명령과 `-exec`는 6절 참고 |
| 사용자 셸 스크립트 북마크 | 🟡 | 시작 명령에 스크립트를 넣은 Local 세션. 바탕화면 바로가기는 없음 |
| "같은 설정으로 SFTP 세션 열기" | ✅ | 페인 메뉴 → Open SFTP Browser, Mosh는 Sftp 패널의 "Open SFTP for this host (via SSH)". SSH 세션에는 패널이 이미 있음 |
| 세션 수 제한(Home 12개) | ➖ | 제한 없음. MIT 라이선스 |

## 2. SSH 세부 기능

| MobaXterm 기능 | MobAlt | MobAlt의 방식, 또는 없는 이유 |
|---|---|---|
| SSH 엔진(MoTTY + 내장 OpenSSH CLI) | ✅ | 세션은 ssh2, Local 터미널에서는 macOS 자체 `ssh`/`scp`/`sftp`/`rsync`/`git`. `ssh -legacy` 자리는 "Legacy algorithms" |
| 비밀번호 인증 + 비밀번호 저장 | ✅ | 세션 편집기 → Authentication. 비밀번호 프롬프트에 "Save in session (Keychain-encrypted)" 체크 |
| Keyboard-interactive / 2FA | ✅ | keyboard-interactive 프롬프트를 대화상자로 표시(여러 줄 PAM 프롬프트 포함). 숨김 프롬프트 하나뿐이면 저장된 비밀번호로 한 번 응답 |
| 공개키 인증 | 🟡 | Ed25519를 포함한 OpenSSH 키, 패스프레이즈 프롬프트(저장 선택), `~/.ssh` 기본 키 시도. `.ppk`는 `puttygen`으로 변환 필요 |
| SSH 인증서(사용자 인증서, 호스트 CA) | ❌ | 미지원. known_hosts의 `@cert-authority` 줄은 건너뜀 |
| 스마트카드(CAPI) 인증 | ➖ | CAPI는 Windows 것. macOS에서는 PKCS#11 모듈을 `ssh-agent`에 올리고(`ssh-add -s`) "SSH agent"를 선택 |
| GSSAPI / Kerberos | ❌ | ssh2에 GSSAPI 없음. Local 터미널에서 시스템 `ssh -K` |
| 내장 SSH 에이전트 "MobAgent" | 🟡 | 내장 에이전트 없음. macOS `ssh-agent`(`SSH_AUTH_SOCK`)를 쓰고, 키는 `ssh-add --apple-use-keychain` |
| 외부 에이전트 | ✅ | `SSH_AUTH_SOCK`이 가리키는 것이면 무엇이든: ssh-agent, 1Password, Secretive, gpg-agent… |
| 에이전트 포워딩 | ✅ | Advanced SSH의 "Agent forwarding" |
| SSH 게이트웨이 / 점프 호스트(다단, 홉별 자격 증명) | 🟡 | Advanced SSH → Jump host: 저장된 세션 또는 `user@host:port`, 점프 세션 자신의 점프 호스트를 따라 3홉까지 연쇄, Sftp와 X11도 통과. SSH만 해당, CyberArk/Teleport 없음 |
| 프록시(SOCKS / HTTP / netcat) | ❌ | 세션별 프록시 없음. 점프 호스트나 다른 세션의 `-D` 터널로 대신 |
| Keepalive | ✅ | Settings → General → SSH keep-alive (s), Advanced SSH에서 세션별 덮어쓰기. 기본 켜짐(30초) |
| "connection reset by peer 우회" | 🟡 | 그런 체크박스는 없음. 구형 서버용 손잡이는 Advanced SSH → "Legacy algorithms (old devices)" |
| 압축 | ✅ | Advanced SSH의 "Compression"(기본 꺼짐, `MobaXterm.ini`와 `~/.ssh/config`에서 가져옴) |
| X11 포워딩 | ✅ | Advanced SSH의 "X11 forwarding (XQuartz)": 원격 DISPLAY 설정, 쿠키 교체, 점프 호스트 통과. 기본 꺼짐 |
| 원격 환경(창 모드 X 서버에 전체 데스크톱) | 🟡 | 포워딩된 X11로 어떤 클라이언트든 띄울 수 있지만, 데스크톱 전체는 XQuartz 자체의 전체 화면 모드가 필요 |
| 명령 실행 / 접속 유지 | ✅ | 시작 명령(세션 편집기 → Terminal): 로그인 뒤 입력되고 셸은 그대로 열려 있음 |
| 시작 매크로 | 🟡 | 녹화한 매크로를 붙이는 대신 모든 종류의 세션에 시작 명령 |
| 원격 모니터링 바(CPU/RAM/net/disk) | ❌ | 미구현 |
| 그래픽 SSH 브라우저(SFTP/SCP) | ✅ | 접속과 함께 열리는 Sftp 패널(⌘2): 진행률·취소가 있는 업로드/다운로드, 새 폴더, 이름 변경, 권한, 삭제, 숨김 파일, 더블클릭 편집 후 저장. SFTP만, SCP 모드 없음 |
| SSH 브라우저 부가 기능(SUDO, 경로 이력, 붙여넣기, diff 등) | 🟡 | 덮어쓰기 확인, 다운로드 시 수정 시각 보존, 정렬, Show in Finder, 호스트 키 확인은 있음. SUDO, 주소 이력, ⌘V 파일 붙여넣기, SCP 폴백, diff, 열 너비 기억은 없음 |
| 터미널 폴더 추종 | ✅ | 세션 옵션 "SFTP follows terminal folder"(bash/zsh용 OSC 7 훅)와 패널의 Follow 체크박스. 기본 꺼짐 |
| Zmodem(rz/sz) | ❌ | 미구현 |
| 로케일 맞추기 | ❌ | 원격 셸에 로케일을 넘기지 않음 |
| 전문가 SSH 설정(암호, KEX, MAC, 양자내성) | 🟡 | "Legacy algorithms" 토글 하나가 SHA-1 KEX / CBC 암호를 추가할 뿐, 알고리즘별 선택은 없음. ssh2 1.17은 strict KEX(Terrapin)는 되고 ML-KEM은 안 됨 |
| 세션별 터미널 종류 | ❌ | `xterm-256color` 고정 |
| SSH 터널(MobaSSHTunnel) | 🟡 | Tunneling 대화상자(⇧⌘U): -L, -R, -D SOCKS5를 열린 연결 또는 저장된 세션의 전용 연결로, 세션별 Tunnels 탭은 자동 시작. 자동 재연결, 순서 바꾸기, 복제는 없음. 개수 제한 없음 |
| 자격 증명 관리자(공유 자격 증명) | ❌ | 비밀번호는 세션마다 따로 |
| 마스터 비밀번호 | 🟡 | 마스터 비밀번호 없음. 비밀 정보는 Electron `safeStorage`(macOS Keychain, 로그인으로 잠금 해제)로 암호화. JSON 내보내기에는 절대 들어가지 않음 |
| Windows Hello | ➖ | Windows 전용. MobAlt의 비밀 정보는 로그인 Keychain이 지킴 |
| MobaKeyGen | ❌ | 키 생성 UI 없음. Local 터미널에서 `ssh-keygen` |
| Known hosts | ✅ | `~/.ssh/known_hosts`와 앱 자체 목록. 첫 접속에 지문(SHA256, MD5) 표시, 바뀐 키는 경고하고 조용히 받아들이지 않음 |
| 세션 로그 | ✅ | 세션별 "Log session output to file" 또는 Terminal → Start/Stop Session Log. 원본 또는 일반 텍스트(Settings → Logging). 시작/종료 시각만 기록, 줄별 타임스탬프 없음 |
| IPv6 | ✅ | 호스트 칸에 IPv6 주소, Quick connect에는 `[addr]:port` |
| 제목 고정 / 재접속 안내 | ✅ | Rename Tab(더블클릭)이 제목을 고정. 끊긴 세션은 "Press Enter to reconnect, ⌘W to close"와 Reconnect/Close 오버레이 |
| 세션 프리셋 | ❌ | 기본 프리셋 없음. Duplicate로 세션 하나를 복사 |

## 3. 터미널

| MobaXterm 기능 | MobAlt | MobAlt의 방식, 또는 없는 이유 |
|---|---|---|
| 탭 터미널 | ✅ | 탭: 드래그로 순서 변경, 더블클릭 이름 변경, 가운데 클릭 닫기, ⌃Tab / ⌃⇧Tab, ⌃⌘1-9, 탭 목록 메뉴. 개수 제한 없음 |
| 분할 모드(1 / 2 / 4) | ✅ | Split ▾: 오른쪽(⌘D), 아래(⇧⌘D), 1×2 … 2×4 = 8페인 격자(⌥⌘2/4/6/8), 분할 해제 ⌥⌘1, 페인 가장자리에 세션 드롭 |
| MultiExec | 🟡 | ⇧⌘M이 활성 탭에 보이는 모든 페인으로 입력을 보냄. 페인별 제외(Exclude)나 스크롤 동기화는 없음 |
| 분리 / 재결합 / 전체 화면 / 항상 위 | ❌ | 창의 초록 버튼으로 macOS 전체 화면만. 별도 창으로 분리나 항상 위는 없음 |
| 매크로(키보드) | 🟡 | Macros 패널(⌘4): ● Rec로 키 입력 녹화, `\n` / `\x1b[A` 이스케이프가 되는 텍스트 매크로, 활성 또는 모든 터미널에 재생. 대기 조건, 폴더, 중첩, 터미널 안 선택 메뉴는 없음 |
| 그래픽 매크로(마우스 + 키보드) | ❌ | 미구현 |
| 색상 스킴 | 🟡 | 내장 테마 6종(Settings → Terminal → Theme)과 세션별 덮어쓰기. 사용자 정의나 가져오기는 없음 |
| 글꼴(번들 글꼴, 합자, 고정 크기) | 🟡 | 설치된 아무 글꼴, 크기, 줄 간격(Settings → Terminal), ⌘= / ⌘- / ⌘0, 세션별 글꼴 크기. 합자와 행/열 고정은 없음 |
| 키워드 구문 강조 | ❌ | 미구현(URL 밑줄만) |
| 터미널 내 검색 | ✅ | ⌘F 증분 검색, 대소문자·정규식 토글, 일치 개수 |
| 로그 / 저장 / 인쇄 | 🟡 | 폴더로 세션 로그. "터미널 텍스트 저장"이나 인쇄는 없음(Select All 후 복사) |
| 스크롤백 | ✅ | Settings → Terminal → Scrollback lines(100 – 1,000,000, 기본 10,000). ⌘K로 지움 |
| 붙여넣기 동작(우클릭, 여러 줄 미리보기, 지연) | 🟡 | Settings → Terminal → "Right-click pastes (⇧-right-click for menu)", ⌘V. 브래킷 붙여넣기 지원. 여러 줄 미리보기와 줄별 지연은 없음 |
| 악성 붙여넣기 경고 | ❌ | 미구현 |
| 선택하면 복사 | ✅ | Settings → Terminal → Copy on select(기본 켜짐) |
| 선택 모드(단어, 사각형) | ✅ | 더블클릭 단어, 트리플클릭 줄, ⌥-드래그 사각형 선택(xterm.js 열 선택). 단어 구분 문자는 설정 불가 |
| Ctrl+클릭 URL / 경로 | 🟡 | URL은 밑줄이 그어지고 클릭하면 브라우저로 열림. 파일·폴더 경로는 링크되지 않음 |
| 유니코드 / 문자셋 / IME | 🟡 | UTF-8만, 유니코드 11 폭 테이블, 터미널 안 IME 조합(xterm.js). 다른 문자셋은 없음 |
| 전문가 터미널 설정 | 🟡 | 커서 모양/깜박임, 스크롤백, Option을 Meta로, 선택 시 복사, 우클릭 붙여넣기. 대체 화면, 로컬 에코, answerback, CR/LF 설정은 없음(Serial에는 로컬 에코와 Enter 전송 있음) |
| 터미널 종류(xterm, linux, OpenVMS2) | ❌ | `xterm-256color`만 |
| 탭 색상 / 아이콘 / 고정 / 왼쪽·오른쪽 닫기 | ✅ | 세션별 색상과 이모지 아이콘이 행·탭·페인 머리글에 표시. Pin Tab(⇧⌘P)은 탭을 짧은 제목·✕ 없이 왼쪽에 고정. Close Others / Tabs to the Left / Tabs to the Right / All은 고정 탭을 건너뛰고 살아 있는 연결을 모두 세어 한 번만 물음. 가운데 클릭 닫기, Duplicate. 비활성 탭 닫기는 없음 |
| 활동 표시(파란 점, 빨간 제목) | 🟡 | 탭의 상태 점(접속 중 / 접속됨 / 끊김)과 트리의 초록 점. 출력 활동 표시는 없음 |
| 벨(소리 / 깜박임) | ❌ | 벨 소리나 깜박임 없음 |
| Backspace ^H / ^? | ❌ | 설정 불가(xterm.js는 ^? 전송) |
| 명령 사이 구분선 | ❌ | 미구현 |
| 팝업 콘솔(Guake 스타일) | ❌ | 미구현 |
| 트레이로 숨기기(Ctrl+M) | ➖ | macOS의 ⌘H로 앱을 숨기고 Dock / ⌘Tab으로 되돌림 |
| 커서(포커스 없을 때 속 빈 모양) | ✅ | Settings → Terminal → Cursor(block / underline / bar)와 깜박임. xterm.js가 포커스 없는 블록 커서를 윤곽선으로 그림 |
| 단축키(변경 가능) | 🟡 | macOS 식 고정 세트(Help → Keyboard Shortcuts). 바꿀 수 없음 |
| "라이브 터미널" 설정 | ❌ | Quick connect 세션은 기본값을 씀. 별도 설정 없음 |
| 종료 시 잠금(명령 실행 중 확인) | 🟡 | 살아 있는 연결이 있는 탭/페인을 닫을 때 확인(Settings → General). 실행 중인 명령 기준은 아님 |

## 4. X 서버와 내장 Unix 도구

| MobaXterm 기능 | MobAlt | MobAlt의 방식, 또는 없는 이유 |
|---|---|---|
| 내장 X 서버("MobaX") | 🟡 | X11 세션이 접속할 때 XQuartz를 필요 시 시작. MIT-MAGIC-COOKIE 교체, 상태 표시줄에 X11 가용 여부 |
| X 확장(OpenGL/GLX, Composite, Randr) | ➖ | XQuartz가 제공하고 설정 |
| 표시 모드(멀티윈도우, Fvwm2/TWM/Openbox, DWM 탭) | ➖ | XQuartz의 rootless 또는 전체 화면 모드(XQuartz 환경설정). 번들 윈도 매니저 없음 |
| 다중 모니터 | ➖ | XQuartz가 처리 |
| XDMCP | ❌ | XDMCP 세션 없음(1절 참고) |
| X11 원격 접근 제어 | ➖ | XQuartz → "네트워크 클라이언트 연결 허용", `xhost` |
| X11 ↔ 호스트 클립보드 | ➖ | XQuartz의 pasteboard 동기화 설정 |
| 키보드(xmodmap, Unix 호환 키보드) | ➖ | XQuartz 입력 설정, Local 터미널의 `xmodmap` |
| DirectDraw 렌더링 | ➖ | Windows 렌더링 옵션 |
| X11 글꼴 | ➖ | XQuartz가 글꼴을 포함. 더 필요하면 Homebrew |
| 대체 X 서버 플러그인(Xephyr, Xvfb 등) | ➖ | 필요하면 Homebrew |
| X 서버만 실행(`-noX`, `-hideterm`) | ➖ | XQuartz는 별도 앱이라 혼자 실행됨 |
| 로컬 Unix 터미널(CygUtils) | ✅ | Local 세션이 진짜 Unix 로그인 셸. macOS에 BSD 유틸리티, ssh, rsync, vim이 있고 나머지는 Homebrew |
| 64비트 터미널(CygUtils64) | ➖ | 네이티브 arm64 / x64 셸 |
| MobApt / apt-get 패키지 관리자 | ➖ | Homebrew |
| 플러그인(.mxt3) | ➖ | Homebrew |
| 셸에서 Windows 통합(`open`, `/drives`, `/registry`) | ➖ | macOS에는 `open`, Finder, `/Volumes`가 원래 있음 |
| 보조 명령(MobaHwInfo, MobaTaskList, mkshortcut 등) | ➖ | `system_profiler`, `ps`, `top`, `mdfind`, `man` |
| 셸 선택(Bash, Zsh, CMD, PowerShell, WSL 등) | ✅ | Settings → General → Local shell(아무 경로, 기본은 로그인 셸 + `-l`), 세션별 Shell 칸 |
| 영구 홈과 루트 | ➖ | 진짜 홈 디렉터리 |
| 프로필 스크립트(통합 .profile) | ➖ | 셸 자체의 dotfile이 그대로 적용됨. MobAlt의 zsh 통합은 그것을 읽어 들인 뒤 폴더 훅만 추가 |

## 5. 네트워크·관리 도구, 내장 서버, Moba* 유틸리티

| MobaXterm 기능 | MobAlt | MobAlt의 방식, 또는 없는 이유 |
|---|---|---|
| 네트워크 스캐너(서브넷) | ❌ | 미구현 |
| 포트 스캐너 | ✅ | Tools 패널(⌘3) → Port scan: 포트 범위, 동시 TCP 연결 |
| 패킷 캡처(TCPCapture) | ❌ | Local 터미널에서 `sudo tcpdump`, 또는 Wireshark |
| 열린 네트워크 포트 목록(MobaListPorts) | ❌ | Local 터미널에서 `lsof -iTCP -sTCP:LISTEN` |
| Wake-on-LAN | ❌ | 미구현 |
| Ping | ✅ | Tools 패널 → Ping(실시간 출력, Stop 버튼) |
| Traceroute | ✅ | Tools 패널 → Traceroute(GUI. MobaXterm에는 CLI뿐) |
| iperf / httping | ➖ | `brew install iperf3 httping` 후 Local 세션에서 실행 |
| DNS 도구(dig, host, nslookup, whois) | ✅ | Tools 패널 → DNS lookup(A/AAAA, MX, TXT, 역방향 PTR). `dig`, `host`, `nslookup`, `whois`, `nc`는 macOS에 포함 |
| Netstat | ➖ | macOS `netstat`, `lsof` |
| 내장 TFTP 서버 | ❌ | 미구현 |
| 내장 FTP 서버 | ❌ | 미구현 |
| 내장 HTTP 서버 | ❌ | 미구현(당장은 `python3 -m http.server`) |
| 내장 SSH/SFTP 서버 | ➖ | macOS 원격 로그인(시스템 설정 → 일반 → 공유) |
| 내장 Telnet 서버 | ➖ | 구식. 원격 로그인(sshd) |
| 내장 NFS 서버 | ➖ | macOS `nfsd`(`/etc/exports`) |
| 내장 VNC 서버 | ➖ | macOS 화면 공유(시스템 설정 → 공유) |
| 내장 Cron 서비스 | ➖ | `cron`과 `launchd`가 내장 |
| 내장 Iperf 서버 | ➖ | Homebrew의 `iperf3 -s` |
| 서비스 관리자 | ➖ | 시스템 설정 → 공유 |
| 폴더 공유 | ➖ | 시스템 설정의 파일 공유(SMB) |
| MobaSSHTunnel | 🟡 | Tunneling 대화상자(⇧⌘U). 2절 참고 |
| MobaTextEditor | 🟡 | 원격 파일용 내장 일반 텍스트 편집기(⌘S로 저장) 또는 자동 업로드되는 외부 편집기. 구문 강조와 검색은 없음 |
| MobaDiff / MobaTextDiff | ❌ | FileMerge(`opendiff`), `diff`, 쓰는 편집기 |
| MobaFoldersDiff | ❌ | `diff -r`, FileMerge |
| MobaKeyGen | ❌ | Local 터미널에서 `ssh-keygen`(2절 참고) |
| MobaPictureViewer | ➖ | "Show in Finder" 뒤 훑어보기 / 미리보기 |
| MobaMonitor | ➖ | 원본 목록에서 이 이름의 MobaXterm 도구를 찾지 못함. 가장 가까운 기능은 원격 모니터링 바(2절, ❌) |
| 하드웨어 / 프로세스 목록 | ➖ | 시스템 정보, 활성 상태 보기, `ps` |
| 관리자 셸(관리자 권한 CMD / PowerShell) | ➖ | Local 세션에서 `sudo` |
| 사무용 부가 기능(ASCII 표, 계산기, fdupes) | ➖ | 계산기 앱, `man ascii`, `brew install fdupes` |
| 게임 | ➖ | 없음 |
| 펭귄 화면 보호기 | ➖ | 없음 |
| 스마트카드 관리자 | ➖ | CAPI는 Windows 것. macOS에서는 `ssh-agent`를 통한 PKCS#11 |
| Windows 탐색기 통합(컨텍스트 메뉴, URL 핸들러) | ➖ | Finder에는 그런 훅이 없고, MobAlt도 URL 스킴을 등록하지 않음 |

## 6. 작업대 기능

| MobaXterm 기능 | MobAlt | MobAlt의 방식, 또는 없는 이유 |
|---|---|---|
| 세션 사이드바(트리, 우클릭, 드래그 앤 드롭, 모두 접기) | ✅ | Sessions 패널(⌘1): 중첩 폴더, 필터, 드래그 앤 드롭, 컨텍스트 메뉴, Expand/Collapse All, 완전한 키보드 트리. 왼쪽에만(⌘B로 숨김) |
| 세션 폴더와 일괄 실행 | ✅ | 중첩 폴더. 폴더 메뉴 → Open All in Grid / Open All in Tabs. 바탕화면 바로가기는 없음 |
| 열린 세션 표시(초록 점, 클릭으로 이동) | 🟡 | 트리에서 접속된 세션에 초록 점. 더블클릭은 탭으로 이동하지 않고 하나 더 엶 |
| Quick connect / 검색 | ✅ | Quick connect 입력란(`user@host[:port]`, 스킴 접두사, 일치하는 저장 세션 재사용), 세션 필터(Enter로 첫 일치 열기), 트리의 타이핑 이동. 메모 검색은 없음 |
| 홈 탭(최근 세션, 이전 인스턴스 복구) | 🟡 | 시작 페이지 없음. 작업대 복원이 지난 탭을 자동으로 되살리고, ⌘T가 로컬 터미널을 엶 |
| 세션 자동 저장 | 🟡 | 의도된 동작: Quick connect 세션은 저장되지 않음(일치하는 저장 세션은 재사용). 세션은 ⌘N으로 만듦 |
| 복제 | ✅ | Duplicate Session(⇧⌘T)과 트리 메뉴의 Duplicate. 시작 명령은 세션의 일부 |
| 세션 내보내기 / 가져오기(폴더별 .mxtsessions) | ✅ | Session → Export / Import Sessions (JSON): 트리 전체, id로 병합, 비밀 정보는 절대 포함하지 않음. `.mxtsessions` 파일은 MobaXterm 가져오기로 읽음 |
| 타사 가져오기(PuTTY, SuperPuTTY, mRemoteNG, SecureCRT, RDM, CSV) | 🟡 | `MobaXterm.ini` / `.mxtsessions`와 `~/.ssh/config`(호스트, 사용자, 포트, 키, ProxyJump)만. 나머지는 없음 |
| 공유 세션(팀, http/ftp/sftp 백엔드) | ❌ | 미구현. JSON 내보내기를 손으로 나눌 수는 있음 |
| 설정 가져오기 / 내보내기(.mobaconf) | 🟡 | 세션은 JSON으로. `settings.json`과 매크로는 Settings → "Open config folder"에서 손으로 복사. 암호화된 묶음은 없음 |
| 포터블 모드(exe + INI) | ➖ | macOS 앱은 데이터를 `~/Library/Application Support/MobAlt`에 둠(`MOBALT_USER_DATA`로 옮길 수 있으나 테스트 용도) |
| INI 사용자 설정(`[Misc]` 키) | 🟡 | `settings.json`을 편집할 수는 있지만 Settings 대화상자에 있는 항목만 담김 |
| 명령줄 매개변수 | ❌ | 없음 |
| 셸에서 스크립팅(`livesession`, `createsession`) | ❌ | 없음 |
| 테마 / 스킨(다크 테마, 아이콘 테마) | ✅ | Light를 포함한 창 전체 테마 6종(네이티브 컨트롤도 따라감), 이모지 세션 아이콘. 아이콘 테마는 없음 |
| 컴팩트 모드 | 🟡 | ⌘B로 사이드바 숨김, macOS 전체 화면. 한 번에 켜는 컴팩트 토글은 없음 |
| 툴바 사용자 정의 | ❌ | 툴바 고정 |
| 단축키 편집기 | ❌ | 바꿀 수 없음 |
| HiDPI / 배율 | ➖ | Retina는 macOS가 처리. ⌘= / ⌘-로 터미널 글꼴 확대/축소 |
| 다중 인스턴스 | 🟡 | `open -n -a MobAlt`로 두 번째 인스턴스를 띄울 수 있지만 둘 다 같은 설정 폴더에 씀 |
| "마지막 탭을 닫아도 종료하지 않음" | ✅ | 창이 빈 탭 줄과 함께 남음. 따로 켤 것 없음 |
| 수동 업데이트 확인만 | 🟡 | 시작 시 확인이 기본 켜짐(Settings → Updates에서 끔), Help → Check for Updates…로 수동 확인. GitHub 릴리스 목록만 읽음 |
| Pro 프로필 스크립트 / 배너 | ➖ | Customizer 기능 |
| 세션 프리셋 | ❌ | 2절 참고 |

## 7. Professional 전용 항목과 Home 에디션 제한

| MobaXterm 기능 | MobAlt | MobAlt의 방식, 또는 없는 이유 |
|---|---|---|
| 세션 수 제한(Home 12개) | ➖ | 제한 없음 |
| SSH 터널 제한(Home 2개) | ➖ | 제한 없음 |
| 매크로 제한(Home 4개) | ➖ | 제한 없음 |
| 데몬 실행 시간 제한(Home 360초) | ➖ | 데몬도 제한도 없음 |
| Home 라이선스 조건(회사 배포 금지) | ➖ | MIT: 어디서든 쓰고 배포 |
| Pro 라이선스 조건(사용자당, 1년 업데이트) | ➖ | MIT |
| 가격 | ➖ | 무료 |
| Customizer 프로그램(브랜드 빌드) | ➖ | 포크해서 `npm run dist` |
| 보안 잠금(Customizer "Security" 탭) | ➖ | 관리자 잠금 프로필 없음 |
| 게임 / 화면 보호기 / 도구 제거 | ➖ | 제거할 것이 없음 |
| 회사 내 배포 | ➖ | MIT, Homebrew cask `mobalt` |
| 지원 | ➖ | GitHub 이슈 |
| 에디션 전환 경고 | ➖ | 에디션이 하나 |

## 8. 최근 추가 기능(24.3 → 26.6)

| MobaXterm 기능 | MobAlt | MobAlt의 방식, 또는 없는 이유 |
|---|---|---|
| 26.6 — 64비트 RDP 엔진 | ➖ | Windows App |
| 26.6 — 터미널 안 IME 조합 | ✅ | xterm.js가 커서 위치에서 IME 입력을 조합 |
| 26.6 — 여러 줄 PAM 프롬프트, 프롬프트 안 URL 감지 | 🟡 | 여러 입력란이 있는 keyboard-interactive 대화상자. 프롬프트 안 URL은 링크되지 않음 |
| 26.6 — 브라우저가 숨겨져 있어도 경로 추종, 루트 경로의 `_Username_` | 🟡 | 폴더 추종은 어느 패널이 보이든 OSC 7 훅으로 돌아감. 경로 변수는 없음 |
| 26.5 — VNC 개편(인코딩, 인증, 자동 크기 조절) | 🟡 | macOS 화면 공유 |
| 26.5 — RDP의 WebAuthn 리디렉션 | ➖ | Windows App |
| 26.5 — SFTP에서 로컬 하위 폴더로 드래그, CygUtils 무결성 검사, Customizer 옵션 | 🟡 | 다운로드는 지정한 폴더로(Download folder 설정 또는 대화상자). Finder로 끌어내기는 없음 |
| 26.4 — 스마트카드 SSH 인증(CAPI) + 관리자, MobAgent의 스마트카드 | ➖ | macOS `ssh-agent`를 통한 PKCS#11 |
| 26.4 — SSH → 같은 설정의 SFTP, 트리 옆 브라우저, 열 너비 저장, 덮어쓰기 확인 | 🟡 | Sftp 패널은 세션마다 붙어 있고 덮어쓰기 전에 물음. 나란히 도킹이나 열 너비 기억은 없음 |
| 26.4 — "linux" 터미널 종류, 압축 기본 꺼짐, Quick connect 폴더 자동 펼침 | 🟡 | 압축 기본 꺼짐. 터미널 종류는 고정. 필터가 일치 항목을 보여 줌 |
| 26.3 — 붙여넣기 확인 다듬기 | ❌ | 붙여넣기 확인 없음 |
| 26.2 — 악성 붙여넣기 경고 | ❌ | 미구현 |
| 26.2 — 터널 복제, Alt+Space 매크로 메뉴, 폴더 모두 접기, Wine 호환 | 🟡 | 트리 메뉴의 Collapse All. 터널 복제나 터미널 안 매크로 메뉴는 없음 |
| 26.1 — 트리의 열린 세션 점(클릭으로 이동) | 🟡 | 초록 점은 있고 이동은 없음 |
| 26.1 — Customizer의 세션별 아이콘, 64개 넘는 아이콘, MobaTextDiff 좌우 바꾸기, MobAgent 없는 SK-SSH-Agent | 🟡 | 세션 아이콘은 아무 이모지나. FIDO 키는 macOS 에이전트를 통해. diff 도구는 없음 |
| 26.0 — `livesession` / `createsession`, `-exec` 자동화 | ❌ | 스크립팅 인터페이스 없음 |
| 26.0 — Remote Desktop Manager와 CSV 가져오기 | ❌ | 미구현 |
| 26.0 — MAC 제조사 조회, DirectDraw, 터널 순서 변경, 브래킷 붙여넣기 기본, apt X 글꼴 | 🟡 | 브래킷 붙여넣기는 xterm.js가 지원. 나머지는 없거나 Windows 전용 |
| 25.4 — Windows SSH 에이전트, 다른 PuTTY 에이전트, Windows Hello | ✅ | `SSH_AUTH_SOCK` 뒤의 아무 에이전트나. Hello는 Windows 전용 |
| 25.4 — 매크로 포함, ms 단위 로그 타임스탬프, "full KEXINIT에 막힘", Cisco KEX 자동 감지, 떠 있는 팝업 콘솔 | ❌ | 모두 없음("Legacy algorithms"가 유일한 구형 장비 손잡이) |
| 25.3 — MobaTextEditor / MobaDiff 개편 | 🟡 | 일반 텍스트 내장 편집기 또는 외부 편집기만 |
| 25.2 — ML-KEM 양자내성 KEX, PuTTY 엔진 갱신 | ❌ | ssh2 1.17에 ML-KEM 없음 |
| 25.2 — RDP 리디렉션 옵션, 터널 재연결, 아이콘 64개, 경로 추종·모니터링 기본 켜짐, 내보내기 비밀번호 | 🟡 | 아이콘 ✅. RDP 옵션은 Windows App에. 터널 재연결 없음. 추종은 선택 사항 |
| 25.1 — netcat/socat 경유 SSH 프록시, 사용자 인증서 + 호스트 CA, PuTTY의 프록시/인증서/Teleport 가져오기, CyberArk | ❌ | 모두 없음 |
| 25.0 — PuTTY 엔진 + 유니코드 16, 다크 모드 대화상자, CVE-2025-0714 | 🟡 | 유니코드 11 폭 테이블. 대화상자는 고른 테마(다크든 라이트든)를 따름 |
| 24.4 — SFTP 다중 블록 전송, 왼쪽/오른쪽 탭 닫기, 탭 이름 변경 단축키, Pro X11 잠금, PNG 로고 | 🟡 | SFTP 동시 읽기/쓰기. 탭 메뉴의 Close Tabs to the Left / Right. Rename Tab(더블클릭 / 메뉴, 단축키 없음). X11 잠금과 로고 옵션은 없음 |
| 24.3 — 그래픽 매크로, 매크로 폴더, 암호화된 매크로, VNC IPv6, 64비트 기본, 비활성 탭 닫기 | ❌ | 없음(매크로는 `settings.json`에 저장) |
| 24.2 — 전문가 RDP 설정, 모니터 전체 전체 화면, MultiExec 스크롤 동기화, `X11MCAuth` | ❌ | RDP는 Windows App 몫. 스크롤 동기화 없음 |
| 24.0 — 전문가 터미널 설정, SFTP 브라우저의 호스트 키 확인 | 🟡 | 터미널 설정의 일부. 호스트 키는 모든 접속에서 확인 |
| 23.x — Edge 브라우저 엔진, 편집 가능한 공유 세션, NTRU Prime + AES-GCM, Telnet keepalive, 탭 고정, Terrapin 수정 | 🟡 | ssh2의 strict KEX(Terrapin)와 기본 AES-GCM. 탭 고정(⇧⌘P). 브라우저, 공유 세션, telnet keepalive는 없음 |

## 9. 파워 유저가 기대는 UX

| MobaXterm 동작 | MobAlt | MobAlt의 방식, 또는 없는 이유 |
|---|---|---|
| `cd`를 따라가는 SFTP 창, 저장하면 업로드되는 편집 | ✅ | 세션 옵션 "SFTP follows terminal folder" + Follow 체크박스. 더블클릭 편집, ⌘S 업로드. 추종은 기본 꺼짐 |
| 원격 모니터링 바 | ❌ | 미구현 |
| 사이드바 = 세션 트리 + 매크로 + 파일 브라우저, 도킹, 오른쪽 배치 | 🟡 | Sessions / Sftp / Tools / Macros 사이드 스트립(⌘1-4), 한 번에 패널 하나, 왼쪽에만, ⌘B로 숨김 |
| 전부 자동 저장(Quick connect 세션 포함) | 🟡 | 세션과 설정은 Save 때, 작업대는 20초마다 저장. Quick connect 세션은 저장되지 않음 |
| 전역 토글인 우클릭 붙여넣기 | ✅ | Settings → Terminal → "Right-click pastes (⇧-right-click for menu)", 기본 켜짐 |
| 선택 시 복사, Alt-드래그 사각형, 조정 가능한 구분 문자 | ✅ | Copy on select(토글), ⌥-드래그 열 선택. 구분 문자 조정은 없음 |
| 미리보기와 악성 검사가 있는 여러 줄 붙여넣기 보호 | ❌ | 미구현 |
| MultiExec와 분할 보기(Exclude, 스크롤 동기화) | 🟡 | 8페인까지 분할과 격자. MultiExec에 Exclude나 스크롤 동기화는 없음 |
| 일급 객체인 매크로(WaitFor, 중첩, 폴더, 암호화) | 🟡 | 녹화·텍스트 매크로를 하나 또는 모든 터미널에 재생. 부가 기능은 없음 |
| 드롭다운으로 고르는 점프 호스트 | ✅ | Advanced SSH → Jump host 드롭다운(저장된 세션 또는 직접 입력), 점프 세션 자신의 점프 호스트로 연쇄. Sftp와 X11도 통과. SSH 세션만 |
| 자격 증명과 비밀번호(이름 있는 자격 증명, 마스터 비밀번호, Hello) | 🟡 | Keychain에 세션별 비밀번호. 이름 있는 자격 증명은 없음 |
| 상태를 지닌 탭(색상, 아이콘, 점, 고정, 왼쪽/오른쪽 닫기, 분리) | 🟡 | 색상, 아이콘, 상태 점, 트리의 초록 점, Pin Tab, Close Tabs to the Left / Right. 분리와 활동 표시는 없음 |
| 홈 탭 + Quick connect(`ssh user@host` 그대로) | 🟡 | `user@host`와 스킴 접두사를 그대로 받는 Quick connect. 홈 탭은 없고 복원은 자동 |
| Guake 스타일 팝업 콘솔, 트레이로 숨기기 | ❌ | 팝업 콘솔 없음. ⌘H로 앱 숨김 |
| 로컬 터미널이 진짜 Unix 셸 | ✅ | 원래 그렇고, 내 dotfile이 그대로 적용 |
| X11이 "그냥 됨"(자동 시작, DISPLAY, WM, XDMCP) | 🟡 | XQuartz를 필요 시 띄우고 쿠키 교체. 포워딩은 세션별 옵션. 윈도 매니저나 XDMCP는 없음 |
| 게임과 펭귄 | ➖ | 없음 |
| 만능 서랍 같은 Tools 메뉴 | 🟡 | Tools 패널(ping, traceroute, DNS, 포트 스캔, 네트워크 정보)과 Tunneling. 나머지는 macOS나 Homebrew로 |
| 어디에나 있는 전문가 설정(터미널, SSH, RDP) | 🟡 | "Legacy algorithms"와 터미널 설정 몇 가지. 전문가 SSH / RDP 대화상자는 없음 |
| 텔레메트리 없음, 자동 업데이트 없음, 관리자 권한 불필요 | 🟡 | 텔레메트리 없음. 시작 시 업데이트 확인은 끌 수 있고 동의해야만 설치. 관리자 권한 불필요(Applications로 드래그 또는 Homebrew) |

## MobAlt에는 있고 MobaXterm에는 없는 것

모두 0.12.0 소스에서 확인한 항목입니다.

- **명암비를 보장하는 창 전체 테마.** 크롬 팔레트는 터미널 테마에서 유도되고(`src/renderer/theme.js`), 모든 텍스트 토큰이 모든 표면에서 4.5:1 이상, 테두리는 3:1 이상을 지킵니다. Light를 포함한 6개 테마 전부를 `test/unit/theme.test.js`가 검증합니다. MobaXterm은 터미널만 테마를 입히고 다크 스킨 하나를 제공합니다.
- **키보드 접근성.** 세션 트리와 SFTP 목록은 roving tabindex를 쓰는 트리 / 리스트박스이고 Finder 식 타이핑 이동이 되며, 컨텍스트 메뉴는 ⇧F10이나 Menu 키로 열리고, 대화상자는 포커스를 가두었다가 되돌립니다(`src/renderer/sidebar.js`, `src/renderer/sftp.js`, `test/e2e-a11y.js`).
- **SFTP 동반 연결이 있는 Mosh.** Mosh 페인은 같은 호스트로 셸 없는 SSH 연결을 하나 더 열어 Sftp 패널에 씁니다(`src/main/ssh.js`의 `sftpOnly`).
- **FTPS**(명시적 TLS)와 익명 FTP를 SFTP와 같은 파일 패널에서(`src/main/ftp.js`). MobaXterm의 FTP 클라이언트는 별도 탭 종류입니다.
- **일반 텍스트 세션 로그.** Settings → Logging이 색상, 커서 이동, 폴더 훅을 로그에서 걷어냅니다(`src/main/terminals.js`의 `PlainTextFilter`).
- **디스크 상의 업데이트 감지와 재시작 배너.** `brew upgrade`나 DMG가 실행 중인 번들을 바꿔치면 이를 알아채고, 작업대를 복원하는 재시작을 제안합니다(`src/main/bundlewatch.js`).
- **Homebrew 설치와 서명·공증된, 동의 기반 자동 업데이트**(`Casks/mobalt.rb`, `.github/workflows/release.yml`, `src/main/updater.js`).
- **비밀 정보가 절대 들어가지 않는 JSON 내보내기**(`src/renderer/app.js`에서 `password`, `passphrase`, `jumpPassword`를 제거. 가져오기는 id로 병합).
- **`MobaXterm.ini` / `.mxtsessions`와 `~/.ssh/config` 가져오기.** ProxyJump, IdentityFile, ForwardX11, ForwardAgent, Compression까지(`src/main/importers.js`).
- **모든 세션 종류의 시작 명령** — SSH, Mosh, Local, Telnet, Serial(`src/renderer/terminal.js`의 `_sendStartup`, `src/main/ssh.js`).
- **페인 확대**(⇧⌘⏎)를 탭마다 기억하고 재시작 후에도 유지(`src/renderer/layout.js`).
- **SSH 자동 재접속이 있는 작업대 복원.** 로컬 셸은 쓰던 폴더로 돌아옴(`src/renderer/app.js`의 `restoreWorkspace`).
- **세션 편집기의 시리얼 장치 자동 검색**(`src/main/terminals.js`의 `SerialPort.list()`).
- **macOS Keychain 기반 비밀 저장.** 비밀번호와 패스프레이즈를 Electron `safeStorage`로 저장하므로 마스터 비밀번호를 칠 일이 없음(`src/main/store.js`).
- **2 × 4까지의 격자와 드래그 분할.** 페인 가장자리에 세션을 놓으면 그 방향으로 분할되고, 탭을 페인으로 끌어올 수 있음(`src/renderer/layout.js`). MobaXterm은 고정 4개에서 멈춥니다.
- **GUI가 있는 Traceroute와 DNS 조회**가 Tools 패널에(`src/main/tools.js`). MobaXterm에는 CLI 도구뿐입니다.
- **Shift+Enter / Option+Enter가 ESC+CR을 전송.** Claude Code 같은 TUI 앱이 줄바꿈으로 받는 조합입니다(`src/renderer/terminal.js`).
- **살아 있는 연결을 세어 주는 종료·닫기 확인**(SSH, Mosh, SFTP, FTP). 뭉뚱그린 경고가 아닙니다(`src/main/live.js`).
- **폴더를 따라가는 로컬 터미널.** OSC 7 훅으로 현재 디렉터리가 탭 제목이 됩니다(`src/main/zdotdir.js`).

## 로드맵: 다음에 만들 것

위의 ❌ 행을 우선순위로 나눈 목록입니다. 크기는 대략적인 추정입니다(S = 며칠, M = 1–2주, L = 그 이상).

**P1 — 가치가 크고 만들 수 있는 것**

| 항목 | 이유 | 크기 |
|---|---|---|
| 편집 가능한 미리보기와 악성 붙여넣기 검사(동형 문자, 셸로 파이프, 프로필 리디렉션, 폭 없는 공백)가 있는 여러 줄 붙여넣기 보호 | MobaXterm에서 가장 자주 언급되는 안전장치. xterm.js가 붙여넣기 경로를 이미 노출함 | M |
| 터미널 안 Zmodem(rz/sz) 전송 | SFTP를 못 쓰는 시리얼 콘솔과 점프 호스트 너머로 파일을 옮기는 고전적 방법 | M |
| SSH 연결의 exec 채널을 주기적으로 돌리는 원격 모니터링 바(CPU / RAM / 디스크 / 네트워크) | MobaXterm은 25.2부터 기본 켜짐. ssh2 연결은 이미 있음 | M |
| Tools 패널의 Wake-on-LAN과 서브넷 / 네트워크 스캐너 | Tools를 완성함. WoL은 UDP 매직 패킷, 스캐너는 포트 스캔 워커를 재사용 | S + M |
| 터미널 키워드 구문 강조 | 색이 없는 서버에서도 읽기 좋은 로그. xterm.js decorations API | M |
| SSH 키 생성 UI(`ssh-keygen` 래퍼) | 가장 흔한 "SSH 첫걸음" 작업. MobaKeyGen 공백도 메움 | S |
| 전문가 SSH 알고리즘 / KEX / 암호 / MAC 설정 | 레거시 토글 하나로는 너무 거칠다. ssh2의 `algorithms` 옵션이 명시적 목록을 받음(ML-KEM은 ssh2를 기다려야 함) | S |

**P2**

| 항목 | 이유 | 크기 |
|---|---|---|
| 내장 브라우저 세션(Electron webview) | 웹 콘솔을 그것을 관리하는 셸 옆에 | M |
| 공유 자격 증명 관리자(자격 증명 하나를 여러 세션과 점프 호스트가 사용) | 여러 서버의 비밀번호 교체 | M |
| PuTTY / SecureCRT / mRemoteNG / Remote Desktop Manager / CSV 세션 가져오기 | MobaXterm만이 아니라 다른 Windows 도구에서의 이주 | M |
| 글꼴 합자(`@xterm/addon-ligatures`) | Fira Code 등 | S |
| 팝업 콘솔(전역 단축키 드롭다운 터미널) | Guake 식 빠른 셸 | M |
| 공유 / 팀 세션 파일(공유 폴더나 URL의 읽기 전용 트리) | 팀이 북마크 한 벌을 함께 씀 | M |
| 트리의 열린 세션 점을 클릭하면 탭으로 이동 | 점은 있고 클릭만 없음 | S |
| 파일 패널의 SCP 모드(SFTP 서브시스템이 없는 서버) | 구형 장비 | M |

**P3**

| 항목 | 이유 | 크기 |
|---|---|---|
| AWS S3 브라우저 | 틈새지만 실수요. 파일 패널 API를 재사용할 수 있음 | L |
| 앱 안 VNC 뷰어(noVNC 브리지) | 화면 공유로 충분. 터널을 거치는 VNC에만 의미가 있음 | L |
| 간단한 내장 서버(장비에 파일을 넘기기 위한 HTTP / TFTP / FTP) | 네트워크 장비 작업 | M |
| 앱 안 RDP | 당분간 Windows App 유지 | L |

**백로그(일정에 없는 ❌ 행)**: XDMCP 세션, 로컬 파일 브라우저 탭, SSH 사용자 인증서 / 호스트 CA, GSSAPI,
세션별 SOCKS/HTTP 프록시, 로케일 맞추기, 세션별 터미널 종류, 세션 프리셋, 그래픽 매크로, 터미널 텍스트 저장 /
인쇄, 벨, backspace 모드, 명령 구분선, "라이브 터미널" 설정, 패킷 캡처, 열린 포트 목록, MobaDiff /
MobaFoldersDiff, 명령줄 매개변수, 셸 스크립팅 명령, 툴바 사용자 정의, 단축키 편집기, 설정 묶음 내보내기.
🟡 행 안의 작은 공백: MultiExec의 Exclude와 스크롤 동기화, 터널 자동 재연결 / 복제 / 순서 변경, telnet
keepalive와 자동 로그인, 사용자 정의 색상 테마, 탭의 활동 표시, 파일 패널 나란히 도킹, 오른쪽 사이드바.

## macOS에서는 해당 없음

➖ 행 전부와, Mac 사용자가 대신 쓰는 것:

| MobaXterm 항목 | macOS에서는 |
|---|---|
| Rsh / Rlogin, 내장 Telnet 서버 | SSH(macOS 원격 로그인). 구형 장비에는 MobAlt의 Telnet 종류 |
| RDP 엔진, 전문가 RDP 설정, WebAuthn 리디렉션 | Windows App(Microsoft) |
| WSL 세션, 64비트 Cygwin 터미널, CygUtils, MobApt, `.mxt3` 플러그인, 영구 홈/루트, 프로필 스크립트 | macOS 셸 자체와 Homebrew |
| CMD / PowerShell 셸, "관리자로 시작" | Local 세션에서 `sudo` |
| Windows Hello, CAPI 스마트카드, 스마트카드 관리자 | 로그인 Keychain. `ssh-agent`를 통한 PKCS#11 |
| X 확장, 표시 모드, 다중 모니터, 접근 제어, 클립보드, 키보드, DirectDraw, 글꼴, 대체 X 서버, X 서버 단독 모드 | XQuartz와 그 환경설정 |
| Windows 통합(`/drives`, `/registry`, `open`), 보조 명령, 하드웨어 / 프로세스 목록 | Finder, `/Volumes`, `open`, `system_profiler`, 활성 상태 보기 |
| iperf / httping, netstat, 그림 뷰어, 사무용 부가 기능 | Homebrew, `netstat` / `lsof`, 훑어보기, 계산기 |
| 내장 SSH, NFS, VNC, Cron, Iperf 서버, 서비스 관리자, 폴더 공유 | 시스템 설정 → 공유, `nfsd`, `launchd`, `iperf3 -s` |
| 트레이로 숨기기 | ⌘H |
| 포터블 모드, HiDPI 스위치 | `~/Library/Application Support/MobAlt`. Retina는 macOS가 처리 |
| Windows 탐색기 통합, 게임, 펭귄 화면 보호기, MobaMonitor(그런 도구 없음) | 필요 없음 |
| Home 에디션 제한, 라이선스, 가격, Customizer, 보안 잠금, 배포 조건, 지원, 에디션 전환 | MIT 라이선스, Homebrew cask, GitHub 이슈 |
