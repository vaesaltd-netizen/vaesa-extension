#!/bin/bash
# Bản cập nhật VAESA Extension cho macOS — tương đương update.bat (Windows).
# Cách dùng: double-click file này (nó tự mở Terminal và chạy).
#
# Toàn bộ logic bọc trong run() — bash đọc hết hàm vào bộ nhớ trước khi chạy,
# nên dù bước cp có ghi đè chính file này giữa chừng cũng không lỗi.
#
# Tải về THƯ MỤC TẠM (mktemp) chứ không tải cạnh file này — vì macOS có thể
# chạy file .command ở vị trí chỉ-đọc (quarantine/translocation) khiến curl
# không ghi được file zip → báo "không tải được" dù mạng vẫn tốt.
run() {
  DIR="$(cd "$(dirname "$0")" && pwd)" || { echo "[LỖI] Không vào được thư mục extension."; exit 1; }

  echo "============================================"
  echo "   CẬP NHẬT VAESA EXTENSION"
  echo "============================================"
  echo

  TMP="$(mktemp -d 2>/dev/null)" || { echo "[LỖI] Không tạo được thư mục tạm."; read -n 1 -s -r -p "Nhấn phím bất kỳ để đóng..."; exit 1; }
  ZIP="$TMP/vaesa_update.zip"
  URL="https://github.com/vaesaltd-netizen/vaesa-extension/archive/refs/heads/master.zip"

  echo "[1/3] Đang tải bản mới nhất từ GitHub..."
  HTTP=$(curl -L -f -s --show-error --retry 3 --retry-delay 2 --connect-timeout 20 \
    -o "$ZIP" -w "%{http_code}" "$URL" 2>"$TMP/err.txt")
  CODE=$?
  if [ "$CODE" -ne 0 ] || [ ! -s "$ZIP" ]; then
    echo
    echo "[LỖI] Không tải được bản mới (curl exit=$CODE, http=$HTTP)."
    [ -s "$TMP/err.txt" ] && echo "      Chi tiết: $(cat "$TMP/err.txt")"
    echo "      → Kiểm tra mạng có vào được github.com không, rồi chạy lại."
    rm -rf "$TMP"
    echo
    read -n 1 -s -r -p "Nhấn phím bất kỳ để đóng..."
    exit 1
  fi

  echo "[2/3] Đang giải nén..."
  unzip -q -o "$ZIP" -d "$TMP"
  SRC="$TMP/vaesa-extension-master"
  if [ ! -d "$SRC" ]; then
    echo
    echo "[LỖI] Giải nén thất bại."
    rm -rf "$TMP"
    read -n 1 -s -r -p "Nhấn phím bất kỳ để đóng..."
    exit 1
  fi

  echo "[3/3] Đang cập nhật file..."
  if ! cp -R "$SRC/." "$DIR/" 2>"$TMP/cperr.txt"; then
    echo
    echo "[LỖI] Không ghi được vào thư mục extension."
    [ -s "$TMP/cperr.txt" ] && echo "      $(cat "$TMP/cperr.txt")"
    echo "      → Thư mục đang bị macOS khoá. Mở Terminal, dán lệnh sau rồi Enter:"
    echo "        xattr -dr com.apple.quarantine \"$DIR\""
    echo "      sau đó chạy lại file này."
    rm -rf "$TMP"
    read -n 1 -s -r -p "Nhấn phím bất kỳ để đóng..."
    exit 1
  fi
  rm -rf "$TMP"

  echo
  echo "============================================"
  echo "   XONG! Đã cập nhật bản mới nhất."
  echo
  echo "   Bước cuối — làm 1 lần:"
  echo "   1. Mở Chrome, vào:  chrome://extensions"
  echo "   2. Tìm VAESA Extension, bấm nút Reload"
  echo "      (biểu tượng mũi tên tròn)."
  echo "============================================"
  echo
  read -n 1 -s -r -p "Nhấn phím bất kỳ để đóng..."
}
run
