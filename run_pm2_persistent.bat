@echo off
title Smart School CBT - Persistent PM2 Service
cd /d C:\APK\backend

echo ========================================================
echo   SMART SCHOOL PERSISTENT PM2 SUPERVISOR
echo ========================================================

set PM2_HOME=C:\Users\user\.pm2
set NODE_ENV=production

echo [%date% %time%] [PM2 SUPERVISOR START] Memulai supervisor >> C:\APK\pm2_persistent.log

:: 1. Mulai atau Pulihkan PM2
call "C:\Users\user\AppData\Roaming\npm\pm2.cmd" resurrect >> C:\APK\pm2_persistent.log 2>&1
call "C:\Users\user\AppData\Roaming\npm\pm2.cmd" start ecosystem.config.js >> C:\APK\pm2_persistent.log 2>&1
call "C:\Users\user\AppData\Roaming\npm\pm2.cmd" save --force >> C:\APK\pm2_persistent.log 2>&1

set /a FAIL_COUNT=0
set /a CF_FAIL_COUNT=0
set /a PG_FAIL_COUNT=0

:: 2. Monitoring loop tangguh (20 detik per siklus)
:LOOP
ping -n 21 127.0.0.1 >nul

:: Periksa apakah PostgreSQL aktif di port 5432
netstat -aon | findstr :5432 | findstr LISTENING >nul 2>&1
if %errorlevel% equ 0 (
    set /a PG_FAIL_COUNT=0
) else (
    set /a PG_FAIL_COUNT+=1
    echo [%date% %time%] [WARN] PostgreSQL belum listening di port 5432 - Cek ke-%PG_FAIL_COUNT% >> C:\APK\pm2_persistent.log
    if %PG_FAIL_COUNT% geq 3 (
        echo [%date% %time%] [ALERT] PostgreSQL padam! Memulihkan via PM2 >> C:\APK\pm2_persistent.log
        call "C:\Users\user\AppData\Roaming\npm\pm2.cmd" restart smart-school-postgres >> C:\APK\pm2_persistent.log 2>&1
        set /a PG_FAIL_COUNT=0
        ping -n 6 127.0.0.1 >nul
    )
)

:: Periksa apakah port 3000 aktif
netstat -aon | findstr :3000 | findstr LISTENING >nul 2>&1
if %errorlevel% equ 0 (
    set /a FAIL_COUNT=0
) else (
    set /a FAIL_COUNT+=1
    echo [%date% %time%] [WARN] Port 3000 belum listening - Cek ke-%FAIL_COUNT% >> C:\APK\pm2_persistent.log
    if %FAIL_COUNT% geq 4 (
        echo [%date% %time%] [ALERT] Port 3000 terdeteksi padam! Memulihkan via PM2 >> C:\APK\pm2_persistent.log
        call "C:\Users\user\AppData\Roaming\npm\pm2.cmd" resurrect >> C:\APK\pm2_persistent.log 2>&1
        call "C:\Users\user\AppData\Roaming\npm\pm2.cmd" restart smart-school-backend >> C:\APK\pm2_persistent.log 2>&1
        call "C:\Users\user\AppData\Roaming\npm\pm2.cmd" save --force >> C:\APK\pm2_persistent.log 2>&1
        set /a FAIL_COUNT=0
        ping -n 11 127.0.0.1 >nul
    )
)

:: Periksa apakah Cloudflare Tunnel aktif
tasklist /fi "imagename eq cloudflared.exe" | findstr /i "cloudflared.exe" >nul 2>&1
if %errorlevel% equ 0 (
    set /a CF_FAIL_COUNT=0
) else (
    set /a CF_FAIL_COUNT+=1
    echo [%date% %time%] [WARN] Cloudflare tunnel belum aktif - Cek ke-%CF_FAIL_COUNT% >> C:\APK\pm2_persistent.log
    if %CF_FAIL_COUNT% geq 3 (
        echo [%date% %time%] [ALERT] Cloudflare Tunnel padam! Memulihkan via PM2 >> C:\APK\pm2_persistent.log
        call "C:\Users\user\AppData\Roaming\npm\pm2.cmd" restart cloudflare-tunnel >> C:\APK\pm2_persistent.log 2>&1
        call "C:\Users\user\AppData\Roaming\npm\pm2.cmd" save --force >> C:\APK\pm2_persistent.log 2>&1
        set /a CF_FAIL_COUNT=0
    )
)

goto LOOP
