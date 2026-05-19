#!/bin/bash
# Bản cập nhật VAESA Extension cho macOS — tương đương update.bat (Windows).
# Cách dùng: double-click file này (nó tự mở Terminal và chạy).
#
# Chế độ "auto" (tham số "auto"): chạy ngầm, KHÔNG hỏi bấm phím — dùng khi
# LaunchAgent gọi tự động lúc đăng nhập máy.
#
# Toàn bộ logic bọc trong run() — bash đọc hết hàm vào bộ nhớ trước khi chạy,
# nên dù bước cp có ghi đè chính file này giữa chừng cũng không lỗi.
run() {
  AUTO=""
  [ "$1" = "auto" ] && AUTO=1
  # pause() — chỉ chờ bấm phím khi chạy tay; chế độ auto thì bỏ qua.
  pause() { [ -z "$AUTO" ] && read -n 1 -s -r -p "Nhấn phím bất kỳ để đóng..."; }

  DIR="$(cd "$(dirname "$0")" && pwd)" || { echo "[LỖI] Không vào được thư mục extension."; exit 1; }

  if [ -z "$AUTO" ]; then
    echo "============================================"
    echo "   CẬP NHẬT VAESA EXTENSION"
    echo "============================================"
    echo
  fi

  # Dọn file rác từ bản updater cũ — Chrome TỪ CHỐI load extension nếu thư mục có
  # file/folder tên bắt đầu bằng "_". Xoá ngay dù updater có chạy tiếp hay không.
  rm -f "$DIR/_vaesa_update.zip"
  rm -rf "$DIR/_vaesa_extract"

  TMP="$(mktemp -d 2>/dev/null)" || { echo "[LỖI] Không tạo được thư mục tạm."; pause; exit 1; }
  ZIP="$TMP/vaesa_update.zip"
  URL="https://github.com/vaesaltd-netizen/vaesa-extension/archive/refs/heads/master.zip"

  [ -z "$AUTO" ] && echo "[1/3] Đang tải bản mới nhất từ GitHub..."
  HTTP=$(curl -L -f -s --show-error --retry 3 --retry-delay 2 --connect-timeout 20 \
    -o "$ZIP" -w "%{http_code}" "$URL" 2>"$TMP/err.txt")
  CODE=$?
  if [ "$CODE" -ne 0 ] || [ ! -s "$ZIP" ]; then
    rm -rf "$TMP"
    [ -n "$AUTO" ] && exit 1
    echo
    echo "[LỖI] Không tải được bản mới (curl exit=$CODE, http=$HTTP)."
    echo "      → Kiểm tra mạng có vào được github.com không, rồi chạy lại."
    echo
    pause
    exit 1
  fi

  [ -z "$AUTO" ] && echo "[2/3] Đang giải nén..."
  unzip -q -o "$ZIP" -d "$TMP"
  SRC="$TMP/vaesa-extension-master"
  if [ ! -d "$SRC" ]; then
    rm -rf "$TMP"
    [ -n "$AUTO" ] && exit 1
    echo
    echo "[LỖI] Giải nén thất bại."
    pause
    exit 1
  fi

  [ -z "$AUTO" ] && echo "[3/3] Đang cập nhật file..."
  if ! cp -R "$SRC/." "$DIR/" 2>"$TMP/cperr.txt"; then
    CPERR="$(cat "$TMP/cperr.txt" 2>/dev/null)"
    rm -rf "$TMP"
    [ -n "$AUTO" ] && exit 1
    echo
    echo "[LỖI] Không ghi được vào thư mục extension."
    [ -n "$CPERR" ] && echo "      $CPERR"
    echo "      → Thư mục đang bị macOS khoá. Mở Terminal, dán lệnh sau rồi Enter:"
    echo "        xattr -dr com.apple.quarantine \"$DIR\""
    echo "      sau đó chạy lại file này."
    pause
    exit 1
  fi
  rm -rf "$TMP"

  # Chế độ auto: xong, thoát ngầm (Chrome tự nạp bản mới ở lần mở kế tiếp).
  [ -n "$AUTO" ] && exit 0

  echo
  echo "============================================"
  echo "   XONG! Đã cập nhật bản mới nhất."
  echo
  echo "   Nếu Chrome đang mở: vào chrome://extensions bấm Reload."
  echo "   Lần sau bật máy — extension tự cập nhật, khỏi cần làm gì."
  echo "============================================"
  echo
  pause
}
run "$@"
