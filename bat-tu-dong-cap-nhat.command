#!/bin/bash
# Bật tự động cập nhật VAESA Extension cho macOS.
# Chạy file này 1 LẦN — nó tạo LaunchAgent để mỗi lần đăng nhập máy,
# update.command tự chạy ngầm (cập nhật extension, không hiện cửa sổ).
run() {
  DIR="$(cd "$(dirname "$0")" && pwd)" || { echo "[LỖI] Không vào được thư mục."; exit 1; }

  echo "============================================"
  echo "   BẬT TỰ ĐỘNG CẬP NHẬT VAESA EXTENSION"
  echo "============================================"
  echo
  echo "Chỉ chạy file này 1 LẦN trên máy. Từ giờ mỗi lần đăng nhập,"
  echo "extension sẽ tự cập nhật bản mới nhất (chạy ngầm)."
  echo

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

  # Nạp lại agent — bỏ bản cũ nếu có rồi nạp mới (để cập nhật đường dẫn).
  launchctl unload "$PLIST" 2>/dev/null
  launchctl load "$PLIST" 2>/dev/null

  if [ -f "$PLIST" ]; then
    echo "[OK] Đã BẬT tự động cập nhật thành công."
    echo
    echo "     Từ giờ: bật máy → extension tự cập nhật → mở Chrome là có bản mới."
    echo "     Không ai phải chạy updater hay bấm Reload nữa."
    echo
    echo "     Muốn TẮT sau này: mở Terminal dán lệnh:"
    echo "       launchctl unload \"$PLIST\" && rm \"$PLIST\""
  else
    echo "[LỖI] Không tạo được LaunchAgent. Thử chạy lại file này."
  fi
  echo
  read -n 1 -s -r -p "Nhấn phím bất kỳ để đóng..."
}
run
