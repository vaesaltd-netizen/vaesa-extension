#!/bin/bash
# CÀI CẦU NỐI CẬP NHẬT VAESA (macOS) — chạy 1 LẦN. Double-click file này.
# Sau đó app có nút "Cập nhật" bấm được. Không cần sudo.
echo "============================================"
echo "   CAI CAU NOI CAP NHAT VAESA EXTENSION"
echo "============================================"
echo
DIR="$(cd "$(dirname "$0")" && pwd)"
if [ ! -f "$DIR/cau-noi/cai-dat.command" ]; then
  echo "[LOI] Khong thay cau-noi/cai-dat.command. Hay chay file nay TRONG thu muc extension VAESA."
  read -n 1 -s -r -p "Nhan phim bat ky de dong..."
  exit 1
fi
chmod +x "$DIR/cau-noi/cai-dat.command" "$DIR/cau-noi/host.command" 2>/dev/null
bash "$DIR/cau-noi/cai-dat.command"
echo
read -n 1 -s -r -p "Nhan phim bat ky de dong..."
