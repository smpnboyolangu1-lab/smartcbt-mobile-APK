@echo off
title Smart CBT - Auto Upload ^& Release GitHub v2.8.90
color 0b
echo ================================================================
echo    SMART CBT v2.8.90 (BUILD 100) - AUTO UPLOAD ^& RELEASE GITHUB
echo ================================================================
echo.
echo Pastikan Anda sudah menyiapkan GitHub Personal Access Token (PAT).
echo Jika belum punya, buka: https://github.com/settings/tokens/new
echo (Centang izin 'repo' lalu Generate token)
echo.
set /p TOKEN="Masukkan Personal Access Token (PAT) GitHub Anda: "

if "%TOKEN%"=="" (
    echo Token tidak boleh kosong!
    pause
    exit /b
)

echo.
echo Menjalankan proses upload dan rilis otomatis...
powershell -ExecutionPolicy Bypass -File "C:\APK\deploy_to_github_release.ps1" -Token "%TOKEN%"

echo.
pause
