# ========================================================================================
# Cầu nối cập nhật VAESA Extension — bộ nhận lệnh (native messaging host).
# Chrome gọi tệp này khi tiện ích nhờ máy chạy cập nhật. Giao thức native messaging:
#   đọc 4 byte độ dài (little-endian) + JSON từ stdin → chạy update.bat → ghi 4 byte độ dài + JSON ra stdout.
# Chỉ làm ĐÚNG một việc: chạy update.bat ở thư mục cha (cập nhật tiện ích). Không nhận lệnh tuỳ ý.
# ========================================================================================
$ErrorActionPreference = 'Stop'
try {
  $stdin = [Console]::OpenStandardInput()
  $stdout = [Console]::OpenStandardOutput()

  # Đọc 1 message (độ dài 4 byte + nội dung). Message bé (vài chục byte) nên đọc 1 lần là đủ.
  $lenBuf = New-Object byte[] 4
  $read = $stdin.Read($lenBuf, 0, 4)
  if ($read -lt 4) { exit 0 }  # Chrome đóng kết nối — thoát im lặng
  $len = [BitConverter]::ToInt32($lenBuf, 0)
  if ($len -le 0 -or $len -gt 65536) { exit 0 }
  $msgBuf = New-Object byte[] $len
  $got = 0
  while ($got -lt $len) { $n = $stdin.Read($msgBuf, $got, $len - $got); if ($n -le 0) { break }; $got += $n }
  $msgText = [Text.Encoding]::UTF8.GetString($msgBuf, 0, $got)

  $cmd = ''
  try { $cmd = (ConvertFrom-Json $msgText).cmd } catch {}

  $root = Split-Path -Parent $PSScriptRoot      # thư mục tiện ích (cha của cau-noi\)
  $bat = Join-Path $root 'update.bat'
  $resp = @{ ok = $false }

  if ($cmd -eq 'update') {
    if (Test-Path $bat) {
      # Chạy update.bat ở chế độ "auto" (ngầm), ĐỢI xong.
      $p = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "`"$bat`"", 'auto' -WindowStyle Hidden -Wait -PassThru
      # Đọc version mới trên đĩa sau khi cập nhật.
      $ver = ''
      try { $ver = (ConvertFrom-Json (Get-Content (Join-Path $root 'manifest.json') -Raw)).version } catch {}
      $resp = @{ ok = ($p.ExitCode -eq 0); exitCode = $p.ExitCode; version = $ver }
    } else {
      $resp = @{ ok = $false; error = 'khong thay update.bat' }
    }
  } elseif ($cmd -eq 'ping') {
    $resp = @{ ok = $true; pong = $true }
  } else {
    $resp = @{ ok = $false; error = 'lenh khong hop le' }
  }

  $respBytes = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json $resp -Compress))
  $stdout.Write([BitConverter]::GetBytes([int]$respBytes.Length), 0, 4)
  $stdout.Write($respBytes, 0, $respBytes.Length)
  $stdout.Flush()
} catch {
  # Lỗi gì cũng cố trả 1 response để Chrome không treo callback.
  try {
    $e = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json @{ ok = $false; error = "$($_.Exception.Message)" } -Compress))
    $o = [Console]::OpenStandardOutput()
    $o.Write([BitConverter]::GetBytes([int]$e.Length), 0, 4); $o.Write($e, 0, $e.Length); $o.Flush()
  } catch {}
}
