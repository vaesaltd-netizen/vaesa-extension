#!/bin/bash
# Bản cập nhật VAESA Extension cho macOS — tương đương update.bat (Windows).
# Cách dùng: double-click file này (nó tự mở Terminal và chạy).
#
# Toàn bộ logic bọc trong run() — bash đọc hết hàm vào bộ nhớ trước khi chạy,
# nên dù bước cp có ghi đè chính file này giữa chừng cũng không lỗi.
run() {
  cd "$(dirname "$0")" || { echo "[LỖI] Không vào được thư mục extension."; exit 1; }

  echo "============================================"
  echo "   CẬP NHẬT VAESA EXTENSION"
  echo "============================================"
  echo

  echo "[1/3] Đang tải bản mới nhất từ GitHub..."
  curl -L -s -o "_vaesa_update.zip" "https://github.com/vaesaltd-netizen/vaesa-extension/archive/refs/heads/master.zip"
  if [ ! -f "_vaesa_update.zip" ]; then
    echo
    echo "[LỖI] Không tải được — kiểm tra kết nối mạng rồi chạy lại."
    echo
    read -n 1 -s -r -p "Nhấn phím bất kỳ để đóng..."
    exit 1
  fi

  echo "[2/3] Đang giải nén..."
  rm -rf "vaesa-extension-master"
  unzip -q -o "_vaesa_update.zip"
  if [ ! -d "vaesa-extension-master" ]; then
    echo
    echo "[LỖI] Giải nén thất bại."
    rm -f "_vaesa_update.zip"
    read -n 1 -s -r -p "Nhấn phím bất kỳ để đóng..."
    exit 1
  fi

  echo "[3/3] Đang cập nhật file..."
  cp -R "vaesa-extension-master/." "."
  rm -rf "vaesa-extension-master"
  rm -f "_vaesa_update.zip"

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
