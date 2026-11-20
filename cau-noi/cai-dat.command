#!/bin/bash
# Cài cầu nối cập nhật VAESA (macOS) — ghi file cấu hình native host vào thư mục Chrome/Edge của
# người dùng (không cần sudo) + cấp quyền chạy cho host.command.
DIR="$(cd "$(dirname "$0")" && pwd)"   # ...cau-noi
HOST="$DIR/host.command"
EXTID="ljiklndcfjkkcchlibopnimnpbimckia"   # mã tiện ích đã ghim, cố định mọi máy

if [ ! -f "$HOST" ]; then echo "[LOI] Khong thay host.command ben canh."; exit 1; fi
chmod +x "$HOST" 2>/dev/null

# Đường dẫn macOS không có dấu \ nên nhét thẳng vào JSON là hợp lệ (dấu cách trong JSON không cần escape).
JSON="{\"name\":\"com.vaesa.updater\",\"description\":\"VAESA updater bridge\",\"path\":\"$HOST\",\"type\":\"stdio\",\"allowed_origins\":[\"chrome-extension://$EXTID/\"]}"

OK=0
for d in "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts" \
         "$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"; do
  if mkdir -p "$d" 2>/dev/null; then
    printf '%s' "$JSON" > "$d/com.vaesa.updater.json" && OK=1
  fi
done

if [ "$OK" = "1" ]; then
  echo "[OK] Da cai cau noi xong (macOS)."
  echo "     Tu gio: mo app VAESA, co ban moi bam nut \"Cap nhat\" la may tu lo."
  echo "     (Neu dang mo Chrome: thoat han Chrome roi mo lai de nhan cau noi.)"
else
  echo "[LOI] Khong ghi duoc cau hinh (chua cai Chrome/Edge?)."
  exit 1
fi
