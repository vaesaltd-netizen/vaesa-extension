@echo off
REM Chrome goi tep nay (native messaging). No chi khoi dong host.ps1 — bo nhan lenh.
REM -ExecutionPolicy Bypass de khong bi chinh sach chay script chan. stdin/stdout noi thang qua.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0host.ps1"
