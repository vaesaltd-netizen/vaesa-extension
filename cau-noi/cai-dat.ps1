# Cài cầu nối cập nhật VAESA — ghi file cấu hình native host + khai báo với Chrome/Edge (HKCU, không cần admin).
# Tách khỏi file .bat để tránh lỗi escape JSON trong batch (chỗ hay hỏng).
$ErrorActionPreference = 'Stop'
try {
  $here = Split-Path -Parent $MyInvocation.MyCommand.Path   # ...\cau-noi
  $hostBat = Join-Path $here 'host.bat'
  $manifestPath = Join-Path $here 'com.vaesa.updater.json'
  # Mã tiện ích đã ghim (manifest có "key") — cố định trên mọi máy.
  $extId = 'ljiklndcfjkkcchlibopnimnpbimckia'

  if (-not (Test-Path $hostBat)) { Write-Host "[LOI] Khong thay host.bat ben canh."; exit 1 }

  # ConvertTo-Json tự escape dấu \ trong đường dẫn Windows → JSON hợp lệ, không phải tự chèn tay.
  $obj = [ordered]@{
    name            = 'com.vaesa.updater'
    description     = 'VAESA updater bridge'
    path            = $hostBat
    type            = 'stdio'
    allowed_origins = @("chrome-extension://$extId/")
  }
  ($obj | ConvertTo-Json -Compress) | Set-Content -LiteralPath $manifestPath -Encoding ASCII

  # Khai báo cho Chrome và Edge (HKCU — của riêng người dùng, không cần quyền admin).
  foreach ($base in @('HKCU:\Software\Google\Chrome\NativeMessagingHosts',
                      'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts')) {
    $key = Join-Path $base 'com.vaesa.updater'
    New-Item -Path $key -Force | Out-Null
    Set-ItemProperty -Path $key -Name '(default)' -Value $manifestPath
  }

  Write-Host '[OK] Da cai cau noi xong.'
  Write-Host ''
  Write-Host '     Tu gio: mo app VAESA, co ban moi bam nut "Cap nhat" la may tu lo.'
  Write-Host '     (Neu dang mo Chrome: dong het cua so Chrome roi mo lai 1 lan de Chrome nhan cau noi.)'
  exit 0
} catch {
  Write-Host "[LOI] $($_.Exception.Message)"
  exit 1
}
