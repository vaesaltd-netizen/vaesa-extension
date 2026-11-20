#!/bin/bash
# CÀI ĐẶT VAESA (1 LẦN) cho macOS — gộp 2 việc: (1) bật tự động cập nhật khi đăng nhập máy,
# (2) cài cầu nối để bấm "Cập nhật" ngay trên app. Chạy sau khi đã Load unpacked extension.
echo "============================================"
echo "   CAI DAT VAESA EXTENSION (chay 1 lan)"
echo "============================================"
echo
DIR="$(cd "$(dirname "$0")" && pwd)" || { echo "[LOI] Khong vao duoc thu muc."; exit 1; }

# --- (1) Bat tu dong cap nhat: LaunchAgent goi update.command che do auto khi dang nhap ---
LA="$HOME/Library/LaunchAgents"
PLIST="$LA/com.vaesa.autoupdate.plist"
mkdir -p "$LA"
cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.vaesa.autoupdate</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$DIR/update.command</string>
    <string>auto</string>
  </array>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
PLISTEOF
launchctl unload "$PLIST" 2>/dev/null
launchctl load "$PLIST" 2>/dev/null
[ -f "$PLIST" ] && echo "[1/2] Da bat tu dong cap nhat." || echo "[1/2] [canh bao] Khong bat duoc tu dong cap nhat."

# --- (2) Cai cau noi (native messaging) de app bam "Cap nhat" ---
if [ -f "$DIR/cau-noi/cai-dat.command" ]; then
  chmod +x "$DIR/cau-noi/cai-dat.command" "$DIR/cau-noi/host.command" 2>/dev/null
  bash "$DIR/cau-noi/cai-dat.command"
else
  echo "[2/2] [canh bao] Khong thay cau-noi/cai-dat.command — bo qua cau noi."
fi

echo
echo "============================================"
echo "   XONG! May tu cap nhat + bam \"Cap nhat\" tren app duoc."
echo "   (Neu Chrome dang mo: thoat han Chrome roi mo lai 1 lan.)"
echo "============================================"
echo
read -n 1 -s -r -p "Nhan phim bat ky de dong..."
