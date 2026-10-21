@echo off
chcp 65001 >nul
title Publikasikan Update Smart CBT ke Seluruh Siswa

echo ==========================================================================
echo 🚀 MEMULAI PUBLIKASI PEMBARUAN KE SELURUH SISWA (3.000 SISWA)
echo ==========================================================================
echo.
echo PERINGATAN:
echo Tindakan ini akan mengaktifkan versi APK terbaru ke seluruh 3.000 siswa.
echo Pastikan Anda telah menguji coba versi ini di HP Admin terlebih dahulu.
echo.
set /p confirm="Lanjutkan publikasi ke seluruh siswa? (Y/N): "
if /i not "%confirm%"=="Y" (
    echo.
    echo ❌ Publikasi dibatalkan.
    goto end
)

echo.
node "%~dp0scripts\publish_to_students.js"

:end
echo.
echo Tekan tombol apa saja untuk menutup...
pause >nul
