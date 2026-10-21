@echo off
chcp 65001 >nul
title Sistem Pembuatan APK Update Lokal (Smart CBT SMPN 1 Boyolangu)

echo ==========================================================================
echo 🚀 MEMULAI BUILD APK UPDATE LOKAL (TARGET: HP ADMIN SAJA)
echo ==========================================================================
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build_local_apk.ps1"

echo.
echo Tekan tombol apa saja untuk menutup jendela ini...
pause >nul
