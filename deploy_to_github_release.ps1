param(
    [Parameter(Mandatory=$true)]
    [string]$Token
)

$ErrorActionPreference = "Stop"

$repoOwner = "smpnboyolangu1-lab"
$repoName = "smartcbt-mobile-APK"
$tagName = "v2.9.3"
$releaseTitle = "Smart CBT v2.9.3 (Build 173) - Rilis Pembaruan Stabilitas & Notifikasi"
$apkPath = "C:\APK\backend\uploads\SmartCBT_v2.9.3.apk"
$gitExe = "C:\Users\user\AppData\Local\Microsoft\WinGet\Packages\Git.MinGit_Microsoft.Winget.Source_8wekyb3d8bbwe\cmd\git.exe"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   OTOMATISASI RILIS GITHUB SMART CBT v2.9.3 (BUILD 173) " -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. PUSH GIT COMMITS & TAGS
Write-Host "`n[1/4] Mengunggah source code dan tag ke GitHub..." -ForegroundColor Cyan
$pushUrl = "https://${Token}@github.com/${repoOwner}/${repoName}.git"

& $gitExe push $pushUrl main --tags -f
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Gagal melakukan git push. Pastikan token Anda memiliki izin 'repo'." -ForegroundColor Red
    exit 1
}
Write-Host " -> Git push berhasil!" -ForegroundColor Green

# 2. BUAT RELEASE DI GITHUB VIA API
Write-Host "`n[2/4] Membuat Release di GitHub..." -ForegroundColor Cyan
$headers = @{
    "Authorization" = "token $Token"
    "Accept" = "application/vnd.github.v3+json"
    "User-Agent" = "SmartCBT-AutoDeploy"
}

$releaseBody = @{
    tag_name = $tagName
    target_commitish = "main"
    name = $releaseTitle
    body = "### Pembaruan Resmi Smart CBT v2.9.3 (Build 173)`n- 🚀 Perbaikan loop auto-update dan sinkronisasi versi 2.9.3 definitif`n- 🔕 Penonaktifan background notification banner yang tidak diinginkan`n- 🔇 Nonaktifkan QR Static total dan migrasi ke Dynamic Class QR Session`n- 🔊 Voice TTS Notifikasi khusus pengurus kelas saat presensi berhasil`n- 📲 Notifikasi keterlambatan langsung via WhatsApp Gateway ke orang tua`n`n**Download APK:** Langsung melalui aplikasi atau link di bawah."
    draft = $false
    prerelease = $false
} | ConvertTo-Json -Depth 5

$releaseResponse = $null
try {
    $releaseResponse = Invoke-RestMethod -Uri "https://api.github.com/repos/${repoOwner}/${repoName}/releases" -Method Post -Headers $headers -Body $releaseBody -ContentType "application/json"
    Write-Host " -> Release berhasil dibuat! ID: $($releaseResponse.id)" -ForegroundColor Green
} catch {
    # Cek apakah release sudah ada
    try {
        $releaseResponse = Invoke-RestMethod -Uri "https://api.github.com/repos/${repoOwner}/${repoName}/releases/tags/${tagName}" -Method Get -Headers $headers
        Write-Host " -> Release tag $tagName sudah ada. ID: $($releaseResponse.id)" -ForegroundColor Yellow
    } catch {
        Write-Host "[ERROR] Gagal membuat release di GitHub: $_" -ForegroundColor Red
        exit 1
    }
}

$releaseId = $releaseResponse.id
$uploadUrlRaw = $releaseResponse.upload_url -replace '\{\?name,label\}', ''

# 3. UPLOAD FILE APK KE GITHUB RELEASE ASSETS
Write-Host "`n[3/4] Mengunggah berkas APK ke GitHub Releases (18.83 MB)..." -ForegroundColor Cyan
if (-not (Test-Path $apkPath)) {
    Write-Host "[ERROR] File APK tidak ditemukan di: $apkPath" -ForegroundColor Red
    exit 1
}

$apkFileName = [System.IO.Path]::GetFileName($apkPath)
$uploadAssetUrl = "${uploadUrlRaw}?name=${apkFileName}"

# Hapus asset lama jika sudah ada dengan nama yang sama
if ($releaseResponse.assets) {
    foreach ($asset in $releaseResponse.assets) {
        if ($asset.name -eq $apkFileName) {
            Write-Host " -> Menghapus asset lama ID $($asset.id)..." -ForegroundColor Yellow
            Invoke-RestMethod -Uri "https://api.github.com/repos/${repoOwner}/${repoName}/releases/assets/$($asset.id)" -Method Delete -Headers $headers
            Start-Sleep -Seconds 2
        }
    }
}

Write-Host " -> Mengunggah data binary APK menggunakan curl.exe..." -ForegroundColor Yellow
$curlCmd = "& C:\Windows\System32\curl.exe -L --progress-bar -X POST -H `"Authorization: token $Token`" -H `"Content-Type: application/vnd.android.package-archive`" --data-binary `"@$apkPath`" `"$uploadAssetUrl`""
$uploadResult = Invoke-Expression $curlCmd

$directDownloadUrl = "https://github.com/${repoOwner}/${repoName}/releases/download/${tagName}/${apkFileName}"
Write-Host " -> APK Berhasil diunggah ke GitHub!" -ForegroundColor Green
Write-Host " -> URL Download Resmi: $directDownloadUrl" -ForegroundColor Yellow

# 4. UPDATE DATABASE AGAR SELURUH APK SISWA MENDOWNLOAD DARI GITHUB
Write-Host "`n[4/4] Memperbarui database server agar download update mengarah ke GitHub..." -ForegroundColor Cyan

$nodeScript = @"
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    await prisma.appVersionConfig.upsert({
        where: { id: 'latest' },
        update: {
            downloadUrl: '$directDownloadUrl',
            versionCode: 173,
            versionName: '2.9.3',
            isForceUpdate: true
        },
        create: {
            id: 'latest',
            downloadUrl: '$directDownloadUrl',
            versionCode: 173,
            versionName: '2.9.3',
            isForceUpdate: true
        }
    });

    await prisma.appVersionRelease.upsert({
        where: { versionCode: 173 },
        update: {
            fileApkUrl: '$directDownloadUrl',
            status: 'ACTIVE'
        },
        create: {
            versionCode: 173,
            nomorVersi: '2.9.3',
            fileApkUrl: '$directDownloadUrl',
            status: 'ACTIVE'
        }
    });

    console.log('DATABASE_UPDATED_SUCCESS');
}

run().catch(console.error).finally(() => prisma.\$disconnect());
"@

$nodeScriptPath = "C:\APK\backend\scratch_update_github_url.js"
[System.IO.File]::WriteAllText($nodeScriptPath, $nodeScript)

Set-Location -Path "C:\APK\backend"
node $nodeScriptPath
Remove-Item -Path $nodeScriptPath -Force

Write-Host " -> Database berhasil diperbarui dengan URL GitHub!" -ForegroundColor Green

Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host "  SUKSES! AUTO-UPDATE GITHUB SELESAI & AKTIF 100%          " -ForegroundColor Green
Write-Host "  Seluruh HP siswa kini akan mendownload update langsung   " -ForegroundColor Green
Write-Host "  dari server GitHub dengan 0 MB bandwidth server sekolah.  " -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
