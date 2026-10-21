param (
    [int]$VersionCode = 0,
    [string]$VersionName = "",
    [string]$ReleaseNotes = "",
    [switch]$ForceUpdate = $true,
    [string]$Target = "admin_only"
)

$ErrorActionPreference = "Stop"

Write-Host "==========================================================================" -ForegroundColor Cyan
Write-Host "SISTEM PEMBUATAN APK UPDATE LOKAL (STAGED ROLLOUT)" -ForegroundColor Cyan
Write-Host "SMP NEGERI 1 BOYOLANGU - SMART CBT" -ForegroundColor Cyan
Write-Host "==========================================================================" -ForegroundColor Cyan

$gradleFile = "C:\APK\android_app\app\build.gradle.kts"
if (-not (Test-Path $gradleFile)) {
    Write-Error "Berkas build.gradle.kts tidak ditemukan di $gradleFile"
    exit 1
}

$gradleContent = Get-Content $gradleFile -Raw
$currCodeMatch = [regex]::Match($gradleContent, 'versionCode\s*=\s*(\d+)')
$currNameMatch = [regex]::Match($gradleContent, 'versionName\s*=\s*"([^"]+)"')

$currentCode = if ($currCodeMatch.Success) { [int]$currCodeMatch.Groups[1].Value } else { 181 }
$currentName = if ($currNameMatch.Success) { $currNameMatch.Groups[1].Value } else { "2.9.11" }

Write-Host "Versi Terpasang Saat Ini: v$currentName (Build $currentCode)" -ForegroundColor Yellow

if ($VersionCode -le 0) {
    $defaultNextCode = $currentCode + 1
    $inputCode = Read-Host "Masukkan Version Code Baru [$defaultNextCode]"
    if ([string]::IsNullOrWhiteSpace($inputCode)) {
        $VersionCode = $defaultNextCode
    } else {
        $VersionCode = [int]$inputCode
    }
}

if ([string]::IsNullOrWhiteSpace($VersionName)) {
    $defaultNextName = "2.9.$($VersionCode - 170)"
    $inputName = Read-Host "Masukkan Version Name Baru [$defaultNextName]"
    if ([string]::IsNullOrWhiteSpace($inputName)) {
        $VersionName = $defaultNextName
    } else {
        $VersionName = $inputName
    }
}

if ([string]::IsNullOrWhiteSpace($ReleaseNotes)) {
    $ReleaseNotes = "Pembaruan Sistem Smart CBT v$VersionName (Build $VersionCode)"
}

Write-Host "Mengupdate versi di android_app/app/build.gradle.kts..." -ForegroundColor Cyan
$updatedGradle = [regex]::Replace($gradleContent, 'versionCode\s*=\s*\d+', "versionCode = $VersionCode")
$updatedGradle = [regex]::Replace($updatedGradle, 'versionName\s*=\s*"[^"]+"', "versionName = `"$VersionName`"")
Set-Content -Path $gradleFile -Value $updatedGradle -Encoding UTF8

Write-Host "Menyiapkan environment Java JDK Android Studio..." -ForegroundColor Cyan
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"

Write-Host "Memulai proses kompilasi Gradle (assembleRelease)..." -ForegroundColor Cyan
Push-Location "C:\APK\android_app"
try {
    .\gradlew.bat assembleRelease --no-daemon
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Kompilasi Gradle gagal dengan exit code $LASTEXITCODE"
        exit $LASTEXITCODE
    }
} finally {
    Pop-Location
}

$apkSource = "C:\APK\android_app\app\build\outputs\apk\release\app-release.apk"
if (-not (Test-Path $apkSource)) {
    Write-Error "File output release APK tidak ditemukan di $apkSource"
    exit 1
}

$fileItem = Get-Item $apkSource
$fileSizeBytes = $fileItem.Length
$fileSizeMb = [math]::Round(($fileSizeBytes / 1MB), 2)
$sha256 = (Get-FileHash -Path $apkSource -Algorithm SHA256).Hash.ToLower()

Write-Host "`nHasil Build:" -ForegroundColor Green
Write-Host ("  - Ukuran: " + $fileSizeMb + " MB (" + $fileSizeBytes + " bytes)")
Write-Host ("  - SHA256: " + $sha256)

if ($Target -eq "public") {
    $apkFileName = "smartcbt-latest.apk"
    $targetDesc = "PUBLIK SELURUH SISWA (3.000 Siswa Langsung Menerima)"
} else {
    $apkFileName = "smartcbt-admin-beta.apk"
    $targetDesc = "HP ADMIN DAN OPERATOR SAJA"
}

$destinations = @(
    "C:\APK\backend\uploads\$apkFileName",
    "C:\APK\backend\public\$apkFileName",
    "C:\APK\backend\public\downloads\$apkFileName",
    "C:\APK\backend\public\uploads\$apkFileName",
    "C:\APK\backend\storage\apk\$apkFileName",
    "C:\APK\backend\$apkFileName",
    "C:\APK\$apkFileName"
)

Write-Host "`nMenyalin APK ke endpoint server lokal..." -ForegroundColor Cyan
foreach ($dest in $destinations) {
    $parent = Split-Path $dest -Parent
    if (-not (Test-Path $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    Copy-Item -Path $apkSource -Destination $dest -Force
    Write-Host "  [OK] $dest" -ForegroundColor Gray
}

Write-Host "`nMendaftarkan konfigurasi versi ke database server..." -ForegroundColor Cyan
$registerPayload = @{
    versionCode = $VersionCode
    versionName = $VersionName
    downloadUrl = "/uploads/$apkFileName"
    fileSizeMb = $fileSizeMb
    releaseNotes = $ReleaseNotes
    isForceUpdate = $ForceUpdate
    target = $Target
    sha256 = $sha256
} | ConvertTo-Json

try {
    $regResponse = Invoke-RestMethod -Uri "http://localhost:3000/api/admin/app-version/register-local-build" -Method Post -Body $registerPayload -ContentType "application/json"
    Write-Host "  [OK] Respon Server: $($regResponse.message)" -ForegroundColor Green
} catch {
    Write-Warning "Gagal mendaftarkan via API HTTP. Mencoba pendaftaran langsung via Prisma..."
    $tempJson = "C:\APK\backend\temp_reg.json"
    $tempScript = "C:\APK\backend\temp_reg.js"
    Set-Content -Path $tempJson -Value $registerPayload -Encoding UTF8
    $nodeFallback = @'
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const data = JSON.parse(fs.readFileSync('temp_reg.json', 'utf8'));
  const targetId = data.target === 'public' ? 'latest' : 'admin_beta';
  const payload = {
    versionCode: data.versionCode,
    versionName: data.versionName,
    downloadUrl: data.downloadUrl,
    fileSizeMb: data.fileSizeMb,
    releaseNotes: data.releaseNotes,
    isForceUpdate: Boolean(data.isForceUpdate)
  };
  await prisma.appVersionConfig.upsert({
    where: { id: targetId },
    update: payload,
    create: { id: targetId, ...payload }
  });
  console.log('Database updated successfully via Prisma for target: ' + targetId);
}
main().catch(console.error).finally(() => prisma.$disconnect());
'@
    Set-Content -Path $tempScript -Value $nodeFallback -Encoding UTF8
    Push-Location "C:\APK\backend"
    node $tempScript
    Pop-Location
    Remove-Item $tempJson -Force -ErrorAction SilentlyContinue
    Remove-Item $tempScript -Force -ErrorAction SilentlyContinue
}

Write-Host "`n==========================================================================" -ForegroundColor Green
Write-Host "PROSES BUILD LOKAL SELESAI!" -ForegroundColor Green
Write-Host "==========================================================================" -ForegroundColor Green
Write-Host "Versi Baru  : Smart CBT v$VersionName (Build $VersionCode)" -ForegroundColor White
Write-Host "Target Rilis: $targetDesc" -ForegroundColor Yellow
Write-Host "File Server : /uploads/$apkFileName ($fileSizeMb MB)" -ForegroundColor White
Write-Host "==========================================================================`n" -ForegroundColor Green
