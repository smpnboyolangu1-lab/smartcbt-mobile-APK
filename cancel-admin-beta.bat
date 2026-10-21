@echo off
chcp 65001 >nul
title Batalkan Versi Uji Coba Admin (Smart CBT)

echo ==========================================================================
echo 🗑️ MEMBATALKAN VERSI UJI COBA ADMIN
echo ==========================================================================
echo.
echo Tindakan ini akan menghapus versi beta internal dan mengembalikan
echo HP Admin untuk memantau versi rilis publik siswa.
echo.
set /p confirm="Batalkan versi uji coba admin? (Y/N): "
if /i not "%confirm%"=="Y" (
    echo.
    echo ❌ Batal.
    goto end
)

echo.
node "%~dp0scripts\cancel_admin_beta.js"

:end
echo.
echo Tekan tombol apa saja untuk menutup...
pause >nul
