#!/bin/bash
# Cầu nối cập nhật VAESA (macOS) — bộ nhận lệnh native messaging.
# Chrome gọi tệp này. Giao thức: đọc 4 byte độ dài (little-endian) + JSON từ stdin,
# chạy update.command, ghi 4 byte độ dài + JSON ra stdout. Dùng Perl (/usr/bin/perl, luôn có trên macOS).
# Chỉ làm đúng 1 việc: chạy update.command ở thư mục cha. Không nhận lệnh tuỳ ý.
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$DIR")"
exec /usr/bin/perl -e '
  my $r; my $n = read(STDIN,$r,4); exit 0 if !defined($n) || $n < 4;
  my $len = unpack("L",$r); exit 0 if $len <= 0 || $len > 65536;
  my $msg = ""; my $got = 0;
  while ($got < $len) { my $k = read(STDIN,my $b,$len-$got); last if !$k; $msg .= $b; $got += $k; }
  my $cmd = ($msg =~ /"cmd"\s*:\s*"([^"]+)"/) ? $1 : "";
  my $root = $ARGV[0];
  my $resp;
  if ($cmd eq "update") {
    my $rc = system("/bin/bash", "$root/update.command", "auto");
    my $ok = ($rc == 0) ? "true" : "false";
    $resp = "{\"ok\":$ok}";
  } elsif ($cmd eq "ping") {
    $resp = "{\"ok\":true,\"pong\":true}";
  } else {
    $resp = "{\"ok\":false,\"error\":\"lenh khong hop le\"}";
  }
  print pack("L", length($resp)); print $resp;
' "$ROOT"
