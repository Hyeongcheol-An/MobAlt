# Hướng dẫn sử dụng MobAlt

This guide in: [English](USER_GUIDE.md) · [한국어](USER_GUIDE.ko.md) · [简体中文](USER_GUIDE.zh-CN.md) · [日本語](USER_GUIDE.ja.md) · [Tiếng Việt](USER_GUIDE.vi.md) · [हिन्दी](USER_GUIDE.hi.md) · [Deutsch](USER_GUIDE.de.md) · [Français](USER_GUIDE.fr.md) · [Español](USER_GUIDE.es.md) · [Português](USER_GUIDE.pt.md) · [العربية](USER_GUIDE.ar.md)

MobAlt là một bàn làm việc kiểu MobaXterm cho macOS: cây phiên ở bên trái, các terminal theo thẻ và
chia ngăn ở giữa, còn trình duyệt SFTP, công cụ mạng và macro nằm trong các bảng bên.

Xem thêm: [Mức tương đương tính năng với MobaXterm 26.6](MOBAXTERM_PARITY.md) — những gì MobAlt có, còn thiếu và làm khác đi, kèm lộ trình phát triển.

![MobAlt với hai shell từ xa đặt cạnh nhau](images/hero.png)

Mục lục: [Tải về và cài đặt](#tải-về-và-cài-đặt) · [Cập nhật](#cập-nhật) · [Phiên](#phiên) · [Kết nối](#kết-nối) ·
[Terminal](#terminal) · [Tệp (SFTP / FTP)](#tệp-sftp--ftp) · [Đường hầm](#đường-hầm-chuyển-tiếp-cổng) ·
[X11, Mosh, Serial, RDP/VNC](#x11-mosh-serial-rdpvnc) · [Công cụ và macro](#công-cụ-và-macro) ·
[Không gian làm việc và cài đặt](#không-gian-làm-việc-và-cài-đặt) · [Phím tắt](#phím-tắt) ·
[Dữ liệu và quyền riêng tư](#dữ-liệu-và-quyền-riêng-tư) · [Khắc phục sự cố](#khắc-phục-sự-cố)

## Tải về và cài đặt

- **Homebrew**: `brew tap Hyeongcheol-An/tap && brew trust Hyeongcheol-An/tap && brew install --cask mobalt`
  (Homebrew 7 yêu cầu bạn tin cậy tap của bên thứ ba một lần; về sau `brew upgrade --cask mobalt` sẽ cập nhật)
- **DMG**: tải DMG cho Apple Silicon (`arm64`) hoặc Intel (`x64`) từ
  [Releases](https://github.com/Hyeongcheol-An/MobAlt/releases) rồi kéo MobAlt vào thư mục Applications.

Các bản phát hành đều được ký và công chứng (notarized). Yêu cầu: macOS 13 trở lên. Công cụ hỗ trợ tùy chọn:
[XQuartz](https://www.xquartz.org/) để chuyển tiếp X11, `brew install mosh` cho phiên Mosh,
Windows App cho RDP.

Khi khởi động, MobAlt kiểm tra GitHub Releases xem có phiên bản mới hơn không và đề xuất trong một hộp thoại;
không có gì được tải về hay cài đặt khi bạn chưa xác nhận. Xem [Cập nhật](#cập-nhật).

## Cập nhật

Có ba cách để lên bản phát hành mới; cách nào cũng kết thúc bằng gói ứng dụng mới tại `/Applications/MobAlt.app`:

- **Trình cập nhật trong ứng dụng**: MobAlt kiểm tra GitHub Releases khi khởi động (tắt trong Cài đặt → Cập nhật),
  còn Help → Kiểm tra bản cập nhật… hoặc "Kiểm tra ngay" trong Cài đặt → Cập nhật cho phép kiểm tra thủ công.
  Phiên bản mới hơn được đề xuất trong một hộp thoại, chỉ được tải về khi bạn đồng ý và được cài khi bạn thoát,
  hoặc ngay lập tức với "Khởi động lại ngay".
- **Homebrew**: `brew upgrade --cask mobalt` thay thế ứng dụng trong Applications.
- **DMG**: tải DMG mới từ [Releases](https://github.com/Hyeongcheol-An/MobAlt/releases) rồi
  kéo MobAlt vào Applications, thay thế bản cũ.

Cập nhật trong ứng dụng và Homebrew không xung đột nhau. Khi bật "Kiểm tra bản cập nhật khi khởi động" (Cài đặt → Cập nhật),
MobAlt tự giữ mình ở bản mới nhất, và chạy `brew upgrade --cask mobalt` lúc nào cũng an toàn: nếu ứng dụng đã tự cập nhật,
Homebrew chỉ cài lại phiên bản đang có. Vì cask khai báo `auto_updates`, lệnh `brew upgrade` trơn (không nêu tên cask)
sẽ bỏ qua MobAlt trừ khi bạn thêm `--greedy`; hãy nêu tên cask, hoặc thêm `--greedy`, khi muốn Homebrew đảm nhận việc cập nhật.

Nâng cấp trong lúc MobAlt đang chạy là bình thường — kể cả từ một terminal của chính MobAlt. Ứng dụng đang chạy tiếp tục
thực thi bản cũ từ bộ nhớ, nhận ra gói mới trên đĩa (trong vòng một phút, hoặc ngay khi cửa sổ được chọn lại) và hiện
một biểu ngữ phía trên các thẻ: *MobAlt 0.11.0 đã được cài trên đĩa — bạn đang chạy 0.10.1. Khởi chạy lại để dùng.*
**Khởi chạy lại** sẽ hỏi trước về các kết nối SSH/FTP đang mở (giống ⌘Q), lưu không gian làm việc và khởi động phiên bản
mới; các thẻ của bạn quay lại nhờ tính năng khôi phục không gian làm việc. **Để sau** ẩn biểu ngữ cho tới khi có thêm
một phiên bản khác nữa. Nếu gói mới đã có trên đĩa khi trình cập nhật chạy, không có gì được tải lại: lần kiểm tra báo
"0.11.0 đã được cài trên đĩa; khởi chạy lại để dùng" và đề xuất cùng thao tác khởi chạy lại.

## Phiên

Bảng **Phiên** (Sessions) là cây dấu trang của bạn. Tạo phiên bằng `＋ Phiên` (⌘N), chọn một loại
rồi điền thẻ Cơ bản. Nhấp đúp vào phiên để kết nối; nhấp chuột phải để mở menu ngữ cảnh
(mở, chia phải/xuống, sửa, nhân bản, xóa, khởi động đường hầm, tạo phiên mới trong thư mục này).

![Trình sửa phiên](images/session-editor.png)

| Loại | Chức năng |
|---|---|
| SSH | Terminal qua SSH, kèm trình duyệt SFTP, đường hầm, chuyển tiếp X11 và agent |
| Mosh | Terminal chuyển vùng qua client `mosh` (khởi động qua SSH) |
| Cục bộ (Local) | Shell đăng nhập macOS của bạn (zsh/bash), có theo dõi thư mục |
| Telnet | Telnet cổ điển với thương lượng NAWS/TTYPE |
| Serial | Console USB-serial (baud, khung, điều khiển luồng, echo cục bộ) |
| FTP | Trình duyệt tệp FTP / FTPS (TLS tường minh) trong bảng Sftp |
| RDP / VNC | Chuyển sang Windows App hoặc Chia sẻ màn hình của macOS |

**Thư mục**: nút thư mục ở đầu bảng (Thư mục mới) tạo một thư mục; kéo phiên và thư mục để di chuyển chúng (thả vào vùng trống
để đưa về gốc). Menu ngữ cảnh của thư mục có thể mở mọi phiên bên trong thành lưới hoặc thành các thẻ.

**Biểu tượng và màu**: chọn một emoji và một màu trong trình sửa phiên. Chúng hiện trên hàng, trên thẻ và trên
đầu ngăn, nhờ vậy phiên "production" màu đỏ khó bị nhầm với phiên "staging" màu xanh lá.

**Nhập / xuất**: chân bảng có nút nhập `~/.ssh/config` (máy chủ, người dùng, cổng, khóa, ProxyJump) và
tệp `MobaXterm.ini` của MobaXterm (dấu trang). Xuất / nhập toàn bộ phiên dưới dạng JSON từ menu ngữ cảnh của cây.
Tệp JSON chứa mọi phiên và thư mục nhưng không bao giờ chứa mật khẩu hay cụm mật khẩu: những thứ đó nằm trong
kho mã hóa của MobAlt trên máy Mac này, còn tệp chỉ ghi lại rằng đã có mật khẩu được lưu (`hasPassword`), nên một
phiên được nhập trên máy Mac khác sẽ hỏi mật khẩu ở lần kết nối đầu tiên. Thao tác nhập gộp vào những gì bạn đang có:
phiên có `id` trùng với một phiên hiện có sẽ được thay bằng phiên bản trong tệp (mật khẩu đã lưu ở đây cho phiên đó vẫn được giữ),
mọi phiên khác được thêm vào — mục viết tay không có `id` luôn được thêm, và `password` ghi trong tệp sẽ được lấy và lưu
ở dạng mã hóa — thư mục được thêm và không có gì bị xóa, nên nhập cùng một tệp hai lần không thay đổi gì. Các mục
không có tên, có loại không rõ hoặc cổng không hợp lệ sẽ bị bỏ qua và được đếm trong thông báo; tệp không phải là tệp phiên
của MobAlt sẽ bị từ chối kèm lý do. `~/.ssh/config` bỏ qua các máy chủ bạn đã có (cùng thư mục và tên). Dấu trang MobaXterm
được đưa vào thư mục `MobaXterm`; dấu trang đã được nhập trước đó (cùng thư mục, tên và máy chủ) được làm mới tại chỗ —
máy chủ, cổng, người dùng, X11 và nén theo tệp `.ini`, còn mật khẩu đã lưu, biểu tượng, màu, đường hầm và đường dẫn khóa
do bạn đặt thì giữ nguyên — nên nhập cùng một tệp `.ini` hai lần cũng không thay đổi gì.

**Lệnh khởi động** (thẻ Terminal): mỗi dòng một lệnh, được gõ vào terminal khi terminal đã sẵn sàng.
Với SSH là ngay sau khi đăng nhập; với shell cục bộ là ngay sau khi dấu nhắc xuất hiện. Ví dụ:
một phiên cục bộ có *Thư mục bắt đầu* đặt là một dự án và lệnh `claude --resume <id>`.
*Thư mục bắt đầu* của phiên cục bộ nhận đường dẫn gõ đầy đủ hoặc chọn bằng nút Chọn… bên cạnh; nút này mở hộp thoại
chọn thư mục và giữ nguyên trường khi bạn hủy.

## Kết nối

- **Kết nối nhanh**: gõ `user@host[:port]` vào thanh công cụ rồi nhấn Enter. Tiền tố xác định
  loại phiên: `ssh://`, `mosh://`, `telnet://`, `ftp://`, `ftps://`, `rdp://`, `vnc://`. Nếu có phiên đã lưu
  khớp, phiên đó được dùng.
- **Xác thực**: *Tự động* lần lượt thử khóa đã cấu hình, mật khẩu đã lưu, SSH agent và các
  khóa mặc định trong `~/.ssh` trước khi hỏi. Chọn *Mật khẩu*, *Khóa riêng* hoặc *SSH agent* để
  giới hạn. Khóa có cụm mật khẩu sẽ hỏi một lần; đánh dấu "Lưu trong phiên" để giữ lại.
- **Khóa máy chủ**: lần kết nối đầu tiên hiện dấu vân tay (SHA256 và MD5). Chấp nhận sẽ lưu
  khóa; khóa đã thay đổi được cảnh báo rõ ràng và không bao giờ được chấp nhận ngầm.
- **Khóa SSH**: Phiên → Tạo khóa SSH… (cũng có trong bảng Công cụ, và nút *Tạo…* cạnh
  trường khóa riêng trong trình sửa phiên) chạy `ssh-keygen` của macOS cho bạn: Ed25519 (mặc định),
  RSA 4096 hoặc ECDSA, một chú thích, cụm mật khẩu tùy chọn kèm gợi ý độ mạnh, và tệp (mặc định
  `~/.ssh/id_<type>`, được đánh số nếu tên đó đã có; `~/.ssh` được tạo ở chế độ riêng tư nếu chưa có,
  các tệp có quyền 0600 / 0644). Cửa sổ hiện khóa công khai kèm nút Sao chép và dấu vân tay.
  "Thêm vào ssh-agent" chạy `ssh-add --apple-use-keychain`; "Cài lên máy chủ…" kết nối tới một phiên
  đã lưu bằng cách xác thực thường dùng của phiên và thêm khóa công khai vào `~/.ssh/authorized_keys` của nó,
  giống `ssh-copy-id` (không bao giờ thêm hai lần). Từ trình sửa phiên, *Dùng trong phiên này* điền sẵn trường khóa.
- **Thuật toán**: SSH nâng cao → Thuật toán liệt kê những gì phiên cung cấp cho trao đổi khóa, khóa máy chủ,
  mã hóa và MAC, điền sẵn các giá trị mặc định tích hợp; sửa một danh sách để giới hạn hoặc sắp xếp lại
  (tên không rõ bị từ chối ngay tại chỗ), *Đặt lại mặc định* đưa các danh sách về như cũ, và "Thuật toán cũ
  (thiết bị cũ)" là thiết lập sẵn thêm các trao đổi khóa SHA-1, mã hóa CBC và khóa máy chủ DSA mà các thiết bị
  cũ vẫn cần. Chỉ những danh sách khác mặc định mới được lưu.
- **Máy chủ trung gian**: SSH nâng cao → Máy chủ trung gian chọn một phiên đã lưu khác làm bastion (ProxyJump).
- **Khi kết nối thất bại**: terminal in ra điều đã xảy ra, ví dụ
  `authentication failed — server accepts: publickey; tried: ~/.ssh/id_ed25519`, hoặc gợi ý rằng
  không có gì trả lời trên cổng đó. Xem [Khắc phục sự cố](#khắc-phục-sự-cố).

## Terminal

![Lưới chia ngăn](images/split-grid.png)

- **Thẻ**: mỗi phiên mở trong một thẻ. Kéo thẻ để sắp xếp lại, nhấp đúp để đổi tên, nhấp chuột giữa
  để đóng. Thẻ cục bộ được đặt tên theo thư mục hiện tại. Menu ngữ cảnh của thẻ (nhấp chuột phải, hoặc
  ⇧F10 trên thẻ đang chọn) cho phép đổi tên, nhân bản, tô màu, chia và đóng: *Đóng thẻ khác*, *Đóng các thẻ
  bên trái*, *Đóng các thẻ bên phải* và *Đóng tất cả* đóng nhiều thẻ cùng lúc và chỉ hỏi một câu,
  đếm mọi kết nối đang mở trong số đó ("Đóng 3 thẻ với 2 kết nối đang mở?").
- **Thẻ được ghim** (*Ghim thẻ* trong menu, ⇧⌘P): thẻ được ghim chuyển về bên trái dải thẻ, theo thứ tự
  được ghim, và thu nhỏ còn chấm trạng thái, biểu tượng và tiêu đề ngắn, với một chiếc ghim nhỏ ở chỗ
  dấu ✕. Các lệnh đóng hàng loạt ở trên và nhấp chuột giữa không động tới thẻ được ghim (⌘W, mục *Đóng*
  trong menu và ⌫ trên thẻ đang chọn vẫn đóng từng thẻ), và không thể kéo thẻ được ghim vượt qua thẻ chưa ghim.
  Ghim là một phần của không gian làm việc, nên vẫn còn sau khi khởi động lại. *Bỏ ghim thẻ* đặt thẻ ngay
  sau khối thẻ được ghim.
- **Tách thẻ ra cửa sổ riêng** (*Tách ra cửa sổ mới* trong menu thẻ, ⌥⌘N, hoặc menu Phiên):
  thẻ chuyển sang một cửa sổ MobAlt thứ hai và giữ nguyên các terminal — không có gì kết nối lại hay
  khởi động lại. Cửa sổ mới vẽ lại 256 KB đầu ra cuối cùng của mỗi terminal và tiếp tục từ đó;
  thẻ đã chia được chuyển cùng mọi ngăn. Cửa sổ có cùng thanh công cụ, menu và phím tắt, và
  khởi động với thanh bên thu gọn (⌘B để hiện); MultiExec áp dụng theo từng cửa sổ. Cửa sổ tách thứ hai
  mở lệch so với cửa sổ đầu, nên không cửa sổ nào che cửa sổ nào. Đóng một cửa sổ tách sẽ trả các thẻ
  của nó về cửa sổ chính với các phiên vẫn đang chạy — không bao giờ kết thúc phiên; đóng thẻ cuối cùng
  của nó (⌘W) sẽ đóng chính cửa sổ đó, vì không còn gì để trả về; đóng cửa sổ chính sẽ
  thoát MobAlt, kể cả các cửa sổ tách. Không gian làm việc ghi nhớ
  các cửa sổ tách và mở lại chúng ở lần khởi chạy sau, kết nối lại các phiên giống như của cửa sổ
  chính. Không thể kéo thẻ giữa các cửa sổ: hãy đóng cửa sổ để đưa thẻ về, hoặc tách lại
  từ đó.
- **Chia ngăn và lưới**: `Chia ▾` (⌘D phải, ⇧⌘D xuống) thêm một ngăn trống; các mục lưới tạo
  bố cục 1×2 … 2×4 (⌥⌘2/4/6/8). Thả một phiên từ cây vào ngăn trống để kết nối tại đó,
  vào cạnh của một ngăn để chia theo hướng đó, hoặc vào giữa ngăn để thay thế nó. Kéo một thẻ vào
  một ngăn để chuyển terminal đó vào bố cục chia. ⌥⌘1 (Hiển thị → Bỏ chia, `Chia ▾` → Bỏ chia) bỏ chia
  thẻ: theo mặc định, mỗi ngăn còn lại trở thành một thẻ riêng, đặt ngay sau thẻ hiện tại theo
  thứ tự ngăn, giữ nguyên terminal, tiêu đề và trạng thái — không có gì kết nối lại, không mất đầu ra;
  ngăn đang chọn giữ lại thẻ. Cài đặt → Terminal → **Bỏ chia** chọn cách xử lý khác: *Giữ ngăn đang hoạt động,
  đóng các ngăn khác* (các ngăn khác bị đóng, kèm câu hỏi thường lệ khi có kết nối đang mở sẽ bị ngắt)
  hoặc *Hỏi mỗi lần* (một hộp thoại nhỏ đưa ra *Chuyển ngăn thành thẻ*, *Chỉ giữ ngăn này* hoặc
  Hủy, tức là giữ nguyên bố cục chia). Thẻ chỉ có một ngăn thì không bị động tới, và ngăn đang phóng to được khôi phục trước.
- **Phóng to ngăn** (⇧⌘⏎, nút ⤢ ở đầu ngăn, hoặc `Chia ▾` → Phóng to ngăn): ngăn đang chọn
  lấp đầy thẻ, giống zoom của tmux hay maximize của iTerm2. Các ngăn khác vẫn kết nối nhưng bị
  ẩn; đầu ngăn hiện nhãn *phóng to* và thẻ hiện một dấu ⤢ nhỏ. Nhấn lại (hoặc ⤡ ở đầu ngăn)
  để đưa bố cục trở lại. Chia ngăn, đóng một ngăn, chọn bố cục lưới hoặc chuyển tới một ngăn đang ẩn (⌘])
  sẽ khôi phục bố cục trước. Mỗi thẻ giữ trạng thái phóng to riêng, kể cả sau khi khởi động lại.
- **MultiExec** (⇧⌘M): khi bật, mọi phím gõ được gửi tới mọi terminal đang hiện trên màn hình — các
  ngăn đang chạy của thẻ hiện hành, hoặc chỉ ngăn đang phóng to khi ngăn đó lấp đầy thẻ. Các thẻ khác không bao giờ
  nhận được, vì vậy hãy chia thẻ (hoặc dùng lưới) để đặt cạnh nhau những máy chủ bạn muốn điều khiển.
  Biểu ngữ cho biết có bao nhiêu terminal đang hiện nhận phím gõ và đi theo thẻ bạn chuyển sang.
- **Thanh giám sát từ xa**: mỗi ngăn SSH hiện một dải một dòng dưới đầu ngăn — CPU, bộ nhớ đã dùng / tổng,
  dung lượng đĩa gốc đã dùng, tốc độ mạng ↓ / ↑, tải trung bình, thời gian hoạt động và tên máy chủ — làm mới mỗi 3 giây
  (Cài đặt → Tính năng → Giám sát, 2–30 giây). Một đoạn mã POSIX `sh` nhỏ chạy qua chính kết nối của phiên, nên
  không cần đăng nhập lần hai, hoạt động qua máy chủ trung gian và không bao giờ in ra terminal; máy chủ Linux được đọc từ
  `/proc`, macOS và các BSD qua `sysctl`, `vm_stat` và `netstat`. Máy chủ không chạy được đoạn mã này (không có `sh`,
  không có quyền) hiện chữ mờ *không giám sát được* và không được hỏi lại cho tới khi kết nối lại. Việc lấy mẫu tạm dừng
  khi ngăn không hiện trên màn hình (một thẻ khác ở phía trước, một ngăn cùng thẻ đang phóng to, cửa sổ bị ẩn) và tiếp tục khi
  ngăn hiện lại. Tắt theo từng phiên (SSH nâng cao → *Hiện thanh giám sát từ xa*), theo từng ngăn (nút nhịp tim
  ở đầu ngăn, Hiển thị → Thanh giám sát từ xa, hoặc menu ngữ cảnh của terminal) hoặc cho mọi phiên trong
  Cài đặt. Ngăn Mosh không có kênh SSH riêng: thanh của nó hiện qua kết nối SFTP đi kèm
  trong lúc kết nối đó đang mở.
- **Tìm** (⌘F): tìm kiếm tăng dần, có nút bật/tắt phân biệt hoa/thường và regex, kèm bộ đếm kết quả.
- **Tô sáng từ khóa**: lỗi, cảnh báo, OK/done, địa chỉ IP, URL và kích cỡ (`512M`, `3.2GB`) được
  tô màu ngay khi xuất hiện, với màu lấy từ chủ đề terminal nên đọc được trên mọi bảng màu.
  Cài đặt → Tính năng → *Tô sáng từ khóa* để tắt; *Quy tắc…* mở bảng quy tắc — mỗi quy tắc gồm
  văn bản thường hoặc biểu thức chính quy, bỏ qua hoa/thường, một màu, màu nền tùy chọn, đậm và gạch dưới;
  *Khôi phục mặc định* đưa bộ quy tắc tích hợp trở lại. Khi các quy tắc chồng lên nhau, kết quả khớp trước thắng, rồi tới
  kết quả dài hơn. Thẻ Terminal của một phiên có thể buộc bật hoặc tắt (*Tô sáng từ khóa: Mặc định / Bật / Tắt*).
  Chỉ những dòng mới được ghi ra mới được quét (ứng dụng toàn màn hình như vim không bị động tới); tối đa 2.000 kết quả
  được tô trên mỗi terminal — khi có một loạt đầu ra dài, các hàng cũ nhất trở về bình thường trước — và ⌘K xóa tất cả.
- **Zmodem (rz/sz)**: truyền tệp ngay qua terminal, cách làm cổ điển qua console serial hoặc máy chủ trung gian
  nơi không dùng được SFTP. Chạy `sz file …` ở máy từ xa để tải về máy Mac, hoặc `rz` để tải lên từ máy Mac; MobAlt
  nhận ra quá trình truyền trong luồng dữ liệu, tạm dừng terminal và hiện nó trong danh sách truyền tệp của bảng Sftp (có nút Hủy)
  và bộ đếm trên thanh trạng thái. Tệp tải về được lưu vào Thư mục tải về (Cài đặt → Chung), hoặc vào thư mục bạn chọn nếu
  chưa đặt; tải lên sẽ mở hộp thoại chọn tệp. Hoạt động trong ngăn SSH, cục bộ, telnet và serial — không có với Mosh (luồng của nó
  thuộc về client mosh, không phải luồng byte thô). Tắt bằng Cài đặt → Tính năng → Truyền tệp → *Truyền tệp Zmodem (rz/sz)* (bật theo mặc định);
  khi tắt, các byte `rz`/`sz` chỉ hiện ra như ký tự rác giống trước đây. Ctrl-C trong ngăn hoặc Hủy trong danh sách
  sẽ kết thúc quá trình truyền: `sz`/`rz` ở máy từ xa được yêu cầu dừng, phần dữ liệu còn đang trên đường bị nuốt đi thay vì vẽ ra,
  và dấu nhắc quay lại trong vòng một giây; `sz` từ xa bị chết sẽ được phát hiện trong vài giây. Lần tải về thứ hai
  cùng tên được lưu thành `name (1).ext` và được liệt kê dưới tên đó.
- **Bảng nhớ tạm**: chọn văn bản là sao chép (Cài đặt → Terminal → Sao chép khi chọn); nhấp chuột phải để dán
  (⇧-chuột phải mở menu). Thả tệp từ Finder vào terminal SSH sẽ tải chúng lên;
  vào terminal cục bộ thì dán đường dẫn.
- **Bảo vệ dán**: nội dung dán có nhiều hơn một dòng (hoặc trên 1000 ký tự) sẽ hỏi trước — *Dán N
  dòng vào …?* hiện văn bản trong ô xem trước có thể sửa; ⌘⏎ để dán, Esc để hủy. Mọi lần dán cũng
  được kiểm tra những gì bảng nhớ tạm không cho thấy: ký tự độ rộng 0 và ký tự bidi, khoảng trắng không ngắt (nhìn
  như dấu cách, nhưng với shell lại là một phần của từ), ký tự điều khiển, xuống dòng ở cuối (dòng cuối sẽ
  chạy ngay), ký tự CR giữa dòng, `curl … | sh`,
  ghi vào `~/.zshrc` và các tệp tương tự hoặc `~/.ssh/authorized_keys`, các lệnh kiểu `rm -rf /` và các từ Latinh
  có chữ cái Kirin hoặc Hy Lạp trông giống. Các phát hiện được liệt kê và đánh dấu trong ô xem trước;
  *Dán đã làm sạch* bỏ các ký tự ẩn và xuống dòng ở cuối, *Dán nguyên bản* gửi văn bản
  không thay đổi. Cả hai bước kiểm tra là các tùy chọn bật/tắt trong Cài đặt → Tính năng → Bảo vệ dán (bật theo mặc định);
  chúng áp dụng cho ⌘V, chuột phải và văn bản thả vào ngăn, không áp dụng cho macro. Khi bật MultiExec, một lần xác nhận áp dụng cho mọi
  terminal đang hiện.
- **Phím**: Shift+Enter và Option+Enter gửi ESC+CR (xuống dòng trong ứng dụng TUI như Claude Code);
  Option hoạt động như Meta theo mặc định.
- **Ghi nhật ký**: Terminal → Bắt đầu/Dừng ghi nhật ký phiên, hoặc tùy chọn trong phiên, ghi đầu ra thô vào
  `~/Documents/MobAlt Logs/`. Cài đặt → Nhật ký → *Bỏ màu và chuỗi điều khiển* giữ
  nhật ký ở dạng văn bản thuần (màu ANSI, lệnh di chuyển con trỏ và hook theo dõi thư mục bị loại bỏ).
- **Chủ đề và giao diện**: Cài đặt → Terminal → Chủ đề tô màu toàn bộ chương trình, không chỉ terminal.
  Thanh công cụ, thanh bên, thẻ, thanh trạng thái, hộp thoại, menu, thông báo và biểu ngữ nhận bảng màu khung giao diện
  suy ra từ chủ đề đã chọn — *Moba Dark* là khung tối quen thuộc, *Light* là giao diện sáng với
  các bảng gần như trắng và chữ tối, *One Dark*, *Dracula*, *Solarized Dark* và *Gruvbox Dark* phủ lên
  khung giao diện sắc màu riêng của chúng — và các điều khiển gốc cùng dải thanh tiêu đề cũng đổi theo. Mọi màu chữ
  trong khung giao diện đều giữ độ tương phản tối thiểu 4,5:1 với nền, ở mọi chủ đề. Ô chọn chủ đề hiện một
  dấu nhắc mẫu bằng chính màu của bảng màu; Lưu áp dụng ngay. Cài đặt → Terminal → Phông chữ áp dụng cho mọi
  terminal; một phiên có thể ghi đè chủ đề và phông chữ trong thẻ Terminal của nó — chủ đề riêng chỉ tô màu terminal
  của ngăn đó, còn cửa sổ giữ chủ đề chung.

## Tệp (SFTP / FTP)

![Bảng SFTP](images/sftp-panel.png)

Bảng **Sftp** đi theo ngăn SSH hoặc FTP đang hoạt động. Bảng tự mở khi kết nối
(Cài đặt → Chung → "Chuyển sang bảng SFTP khi SSH kết nối").

- Điều hướng bằng cách nhấp đúp vào thư mục, gõ đường dẫn (dùng được `~`) hoặc dùng ⬆ / 🏠 / ⟳.
  "Theo terminal" giữ bảng ở thư mục hiện tại của shell (cần tùy chọn tương ứng trong phiên,
  tùy chọn này chèn một hook nhỏ vào dấu nhắc). `>_` gửi lệnh `cd` tới terminal.
- Thanh công cụ và menu ngữ cảnh: thư mục mới, đổi tên, quyền, xóa, tải về, tải lên. Chọn nhiều mục
  bằng ⌘ / ⇧. Kéo tệp từ Finder vào danh sách để tải lên; tên đã tồn tại sẽ được hỏi trước khi ghi đè.
- Nhấp đúp vào tệp văn bản để sửa trong trình sửa tích hợp (⌘S lưu ngược lên máy chủ). "Sửa bằng trình
  sửa ngoài" mở tệp trong trình sửa của bạn (Cài đặt → Chung → Trình sửa ngoài) và tải lại lên mỗi khi lưu.
- Quá trình truyền tệp hiện tiến độ, tốc độ và nút hủy; "Hiện trong Finder" sau khi tải về.
- Tiêu đề cột sắp xếp theo tên, kích cỡ hoặc ngày. Khi thanh bên hẹp, cột ngày được ẩn.

## Đường hầm (chuyển tiếp cổng)

![Đường hầm](images/tunnels.png)

`Đường hầm` (⇧⌘U) quản lý các chuyển tiếp cổng SSH:

- **Cục bộ (-L)**: `127.0.0.1:8080 → db.internal:5432` qua máy chủ SSH.
- **Từ xa (-R)**: một cổng trên máy chủ được chuyển tiếp ngược về một dịch vụ cục bộ.
- **Động (-D)**: một proxy SOCKS5 cục bộ đi qua máy chủ.

Khởi động đường hầm trên một kết nối đang mở, hoặc để MobAlt mở một kết nối riêng tới một phiên
đã lưu. Các đường hầm liệt kê trong thẻ **Đường hầm** của một phiên tự khởi động khi phiên đó
kết nối, và bạn được báo nếu có đường hầm không lắng nghe được.

## X11, Mosh, Serial, RDP/VNC

- **X11**: đánh dấu "Chuyển tiếp X11" trong SSH nâng cao. MobAlt khởi động XQuartz khi cần, chuyển tiếp
  display và hoán đổi cookie xác thực, nên `xeyes` hay `gedit` chạy ngay. Thanh trạng thái cho biết X11
  có sẵn hay không.
- **Mosh**: cần `brew install mosh` trên máy cục bộ và `mosh-server` trên máy chủ (UDP 60000-61000).
  Ngăn chạy client mosh; bước khởi động SSH dùng khóa, agent hoặc dấu nhắc tương tác của bạn.
  Đặt đường dẫn `mosh-server` nếu nó không nằm trong PATH của máy từ xa.
- **Mosh + SFTP**: mosh không mang kênh SFTP, nên bảng Sftp duyệt máy chủ Mosh qua một
  kết nối SSH riêng không có shell tới cùng máy chủ đó (cùng khóa, agent và dấu nhắc). Kết nối này tự mở
  khi "Tự động mở trình duyệt SFTP" được bật cho phiên (và "Chuyển sang bảng SFTP
  khi SSH kết nối" trong Cài đặt → Chung), nếu không thì mở từ nút "Mở SFTP cho máy chủ này (qua SSH)" của bảng hoặc
  mục "Mở trình duyệt SFTP" trong menu ngăn; kết nối bị đóng cùng với ngăn.
- **Serial**: trình sửa phiên liệt kê các thiết bị USB-serial; đặt baud, bit dữ liệu/bit dừng, chẵn lẻ, điều khiển luồng,
  echo cục bộ và ký tự Enter gửi đi (CR, LF, CRLF).
- **RDP / VNC**: MobAlt ghi một tệp `.rdp` và mở Windows App, hoặc mở `vnc://` trong Chia sẻ
  màn hình. Phiên giữ máy chủ, người dùng và thư mục như mọi dấu trang khác.

## Công cụ và macro

- Bảng **Công cụ**: ping, traceroute, tra cứu DNS, quét cổng và thông tin mạng cục bộ (Mạng), có nút Dừng
  cho các lượt chạy dài.
- **Wake-on-LAN** (bảng Công cụ): gõ địa chỉ MAC theo bất kỳ cách viết nào (`aa:bb:cc:dd:ee:ff`,
  `aa-bb-…`, `aabb.ccdd.eeff` hoặc hex trần) rồi nhấn Đánh thức: gói magic được gửi ba lần dưới dạng
  UDP broadcast (255.255.255.255, cổng 9 theo mặc định; broadcast có hướng như 192.168.1.255
  tới được mạng con khác). 10 địa chỉ gần nhất được ghi nhớ kèm nhãn tùy chọn và được gợi ý
  khi bạn gõ.
- **Trình quét mạng** (bảng Công cụ): quét một CIDR (`192.168.1.0/24`), một dải (`10.0.0.1-10.0.0.50`
  hoặc `10.0.0.1-50`) hoặc một máy chủ, tối đa /16, bằng ICMP ping và/hoặc kết nối TCP tới một danh sách cổng ngắn
  (mặc định 22, 80, 443, 3389, 5900), có thể chỉnh số luồng chạy song song và thời gian chờ, kèm tra cứu DNS ngược
  cho mỗi kết quả. Các máy chủ trả lời xuất hiện trong bảng có thể sắp xếp ngay khi được tìm thấy (IP, tên máy chủ,
  thời gian khứ hồi, cổng mở) trong khi thanh tiến trình đếm `123/254`; Dừng để hủy, ＋ mở
  trình sửa phiên với SSH tới máy chủ đó đã được điền sẵn, và "Sao chép" (Copy as text) đưa bảng vào bảng nhớ tạm.
- Bảng **Macro**: ghi phím gõ trong một terminal (● Ghi / ■ Dừng), lưu dưới một cái tên và
  phát lại vào terminal đang hoạt động hoặc vào tất cả terminal. Macro văn bản có thể gõ trực tiếp;
  hỗ trợ các chuỗi escape như `\n` hoặc `\x1b[A`.

## Không gian làm việc và cài đặt

MobAlt khôi phục các thẻ, bố cục chia và phiên của bạn (các thẻ đã tách ra cửa sổ riêng quay lại thành cửa sổ) ở lần khởi chạy sau và kết nối lại các phiên SSH
(shell cục bộ mở lại ở thư mục cuối cùng). Tắt tính năng này trong Cài đặt → Chung → Hành vi.

![Cài đặt](images/settings.png)

Cài đặt có năm thẻ, thẻ nào cũng vừa với cửa sổ nhỏ nhất mà không cần cuộn: **Chung**
(ngôn ngữ giao diện, xác nhận khi thoát, chuyển sang bảng SFTP, khôi phục không gian làm việc, shell cục bộ và tích hợp
thư mục của nó, trình sửa ngoài, thư mục tải về, SSH keep-alive, và "Mở thư mục cấu hình",
cho biết mọi thứ được lưu ở đâu), **Terminal** (phông chữ, chiều cao dòng, con trỏ, cuộn ngược, chủ đề — giao diện của toàn bộ
cửa sổ, xem *Chủ đề và giao diện* — chuột/phím, và việc *Bỏ chia* làm gì với các ngăn khác của thẻ đã chia: chuyển chúng
thành thẻ riêng, đóng chúng, hoặc hỏi mỗi lần), **Tính năng** (bảo vệ dán, thanh giám sát từ xa và chu kỳ làm mới,
tô sáng từ khóa cùng bảng quy tắc, và truyền tệp Zmodem), **Nhật ký** (thư mục nhật ký, nhật ký phiên dạng văn bản thuần) và **Cập nhật** (kiểm tra
khi khởi động và "Kiểm tra ngay").

### Ngôn ngữ giao diện

Menu, thanh công cụ, bảng, hộp thoại và thông báo của MobAlt có mười ngôn ngữ: English, 한국어, 简体中文, 日本語,
Tiếng Việt, हिन्दी, Deutsch, Français, Español và Português. Theo mặc định (**Mặc định hệ thống**), giao diện theo
danh sách ngôn ngữ của macOS (Cài đặt hệ thống → Cài đặt chung → Ngôn ngữ & Vùng): ngôn ngữ đầu tiên trong danh sách đó mà
MobAlt có sẽ được dùng, và tiếng Anh nếu không có ngôn ngữ nào khớp. Cài đặt → Chung → **Ngôn ngữ** chọn một ngôn ngữ cụ thể; thay đổi
có hiệu lực ngay trong mọi cửa sổ — không có gì khởi động lại, các kết nối vẫn giữ — và được ghi nhớ. Đầu ra terminal không bao giờ
được dịch: những gì máy chủ từ xa in ra được hiển thị nguyên vẹn. Hướng dẫn sử dụng cũng có đủ mười ngôn ngữ đó
(`docs/USER_GUIDE.<language>.md`); Help → **Hướng dẫn sử dụng** mở bản cho ngôn ngữ hiện tại.

Để chạy MobAlt bằng một ngôn ngữ trong một lần mà không đổi cài đặt (chụp màn hình, kiểm thử), hãy khởi động với `MOBALT_LANG=<code>`
trong biến môi trường (`en`, `ko`, `zh-CN`, `ja`, `vi`, `hi`, `de`, `fr`, `es`, `pt`).

## Phím tắt

| Thao tác | Phím |
|---|---|
| Phiên mới / terminal cục bộ / kết nối nhanh | ⌘N / ⌘T / ⇧⌘N |
| Nhân bản / kết nối lại / đóng thẻ / đóng ngăn | ⇧⌘T / ⌘R / ⌘W / ⇧⌘W |
| Ghim / bỏ ghim thẻ đang hoạt động | ⇧⌘P |
| Tách thẻ đang hoạt động ra cửa sổ riêng | ⌥⌘N |
| Đóng các thẻ khác / các thẻ bên trái / các thẻ bên phải | Menu Phiên, hoặc menu ngữ cảnh của thẻ |
| Chia phải / xuống, bỏ chia | ⌘D / ⇧⌘D, ⌥⌘1 |
| Lưới 2 / 4 / 6 / 8 ngăn | ⌥⌘2 / ⌥⌘4 / ⌥⌘6 / ⌥⌘8 |
| Ngăn tiếp theo, thẻ sau / trước, thẻ 1-9 | ⌘] , ⌃Tab / ⌃⇧Tab, ⌃⌘1-9 |
| Phóng to ngăn (đầy thẻ) / khôi phục bố cục | ⇧⌘⏎ |
| Tìm, xóa màn hình, thu phóng | ⌘F, ⌘K, ⌘= / ⌘- / ⌘0 |
| Thanh bên, Phiên / SFTP / Công cụ / Macro | ⌘B, ⌘1 / ⌘2 / ⌘3 / ⌘4 |
| MultiExec, đường hầm, cài đặt | ⇧⌘M, ⇧⌘U, ⌘, |
| Xuống dòng trong ứng dụng TUI | ⇧Enter hoặc ⌥Enter |
| Hộp thoại bảo vệ dán (dán nhiều dòng hoặc đáng ngờ): dán / hủy | ⌘⏎ / Esc |
| Thẻ đang chọn: di chuyển / kích hoạt / đóng, menu ngữ cảnh | ← → / ⏎ / ⌫, ⇧F10 hoặc phím Menu |
| Hàng phiên đang chọn: di chuyển / gập / mở / mở trong ngăn chia / xóa | ↑ ↓ / ← → / ⏎ / ⌘⏎ hoặc ⇧⏎ / ⌫ |
| Hàng phiên hoặc thư mục đang chọn: menu ngữ cảnh (thư mục: Di chuyển vào thư mục…) | ⇧F10 hoặc phím Menu |
| Macro đang chọn: di chuyển / phát / xóa, menu ngữ cảnh | ↑ ↓ / ⏎ / ⌫, ⇧F10 hoặc phím Menu |
| Danh sách SFTP: di chuyển / mở / thư mục cha / xóa, menu ngữ cảnh | ↑ ↓ Home End PgUp PgDn / ⏎ / ⌫ / Del, ⇧F10 hoặc phím Menu |
| Danh sách SFTP: mở rộng vùng chọn / bật tắt hàng đang chọn / chọn tất cả | ⇧↑ ⇧↓ ⇧Home ⇧End / Space / ⌘A |
| Danh sách SFTP: sắp xếp theo cột | Tab tới tiêu đề cột Tên / Kích cỡ / Ngày sửa, ⏎ hoặc Space |
| Cây phiên và danh sách SFTP: nhảy tới một tên | gõ vài chữ cái đầu, kể cả dấu cách (gõ lại cùng chữ cái: kết quả tiếp theo) |
| Chọn biểu tượng và màu trong trình sửa phiên: di chuyển / chọn | ← → ↑ ↓ / ⏎ hoặc Space |
| Nút bảng trên dải bên / ⌘1-4 | ⏎ đưa bàn phím vào bảng; khi chuyển bảng, vị trí cũ được ghi nhớ |

Help → Phím tắt hiện cùng danh sách này ngay trong ứng dụng. Phím Tab đi tới thanh công cụ, dải
bên, cây phiên, danh sách macro, danh sách SFTP và dải thẻ (mỗi danh sách là một điểm dừng Tab;
các phím mũi tên di chuyển bên trong); hộp thoại giữ Tab bên trong và trả tiêu điểm về thẻ,
hàng hoặc nút đã mở nó khi đóng; menu ngữ cảnh nhận ↑ ↓ / ⏎ / Esc. Esc trong ô
lọc phiên hoặc ô kết nối nhanh sẽ xóa nội dung và quay về terminal.


## Dữ liệu và quyền riêng tư

Mọi thứ nằm trong `~/Library/Application Support/MobAlt/`: `sessions.json` (mật khẩu và
cụm mật khẩu được mã hóa thông qua Chuỗi khóa của macOS), `settings.json`, `known_hosts`,
`workspace.json`, và các tệp tích hợp zsh. Nhật ký phiên được lưu vào `~/Documents/MobAlt Logs/`.
MobAlt chỉ kết nối tới các máy chủ bạn cấu hình; bước kiểm tra cập nhật tùy chọn chỉ đọc danh sách bản phát hành
trên GitHub, ngoài ra không gì khác. Chi tiết: [SECURITY.md](../SECURITY.md).

## Khắc phục sự cố

- **"Timed out while waiting for handshake" / ETIMEDOUT**: không có gì trả lời trên cổng đó. Kiểm tra
  địa chỉ, VPN và chuyển tiếp cổng trên router; thử `nc -vz host port` trong một terminal cục bộ.
- **"xác thực thất bại — máy chủ chấp nhận: …; đã thử: …"**: máy chủ không chấp nhận những gì MobAlt
  đưa ra. So sánh danh sách "chấp nhận" với phương thức xác thực của phiên; với máy chủ chỉ nhận khóa,
  hãy chọn đúng tệp khóa. Thất bại lặp lại có thể khiến IP của bạn bị fail2ban hoặc cơ chế phạt theo nguồn
  của sshd cấm trong một thời gian.
- **"không có trao đổi khóa / khóa máy chủ / mã hóa / MAC nào khớp: phiên này cung cấp …; máy chủ cung cấp …"**:
  hai bên không có thuật toán chung nào. Thông báo liệt kê những gì máy chủ hỗ trợ: thêm một
  trong số đó vào SSH nâng cao → Thuật toán (hoặc *Đặt lại mặc định*); với thiết bị cũ chỉ
  cung cấp SHA-1 / CBC, hãy đánh dấu "Thuật toán cũ (thiết bị cũ)".
- **Khóa máy chủ đã thay đổi**: máy chủ đã được cài lại, hoặc có thứ gì đó đang chặn bắt kết nối.
  Chỉ chấp nhận khi bạn biết lý do; khóa cũ có thể được xóa khỏi `known_hosts` trong thư mục cấu hình.
- **Ứng dụng X11 không hiện ra**: cài XQuartz, và đảm bảo shell từ xa không ghi đè
  `DISPLAY` trong các tệp khởi động của nó.
- **Mosh**: "không tìm thấy mosh client" nghĩa là máy cục bộ chưa chạy `brew install mosh`;
  "mosh-server not found" nghĩa là máy chủ chưa có nó hoặc nó không nằm trong PATH (đặt đường dẫn trong
  phiên).
- **Cảnh báo Gatekeeper với ứng dụng tự build**: nhấp chuột phải → Mở một lần, hoặc
  `xattr -dr com.apple.quarantine /Applications/MobAlt.app`.
- **`hdiutil: attach failed – Resource busy` khi chạy `brew upgrade --cask mobalt`**: một tiến trình Homebrew khác
  (ví dụ `brew audit` hoặc `brew fetch`) đang gắn cùng tệp DMG đó vào lúc ấy. Chỉ cần chạy lại
  lệnh.
