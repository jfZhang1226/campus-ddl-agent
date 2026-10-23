param(
    [string]$ApkPath = (Join-Path $PSScriptRoot '../client/.arkui-x/android/app/build/outputs/apk/debug/app-debug.apk'),
    [ValidateSet('arm64-v8a', 'armeabi-v7a', 'x86_64')]
    [string]$Abi = 'arm64-v8a'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$t08Archive = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $ApkPath).Path)
try {
    $t08Entries = @($t08Archive.Entries | ForEach-Object { $_.FullName })
    $t08Required = @('libfile_fs.so', 'libfile_streamrw.so', 'libutil_stream.so', 'libutil.so', 'libcrypto_openssl.so', 'librouter.so')
    $t08Missing = @($t08Required | Where-Object { $t08Entries -notcontains "lib/$Abi/$_" })
    if ($t08Missing.Count -gt 0) {
        throw ('T08 APK is missing native adapters: ' + ($t08Missing -join ', ') + '. Run devecocli build clean, then the full ACE APK build; do not install this artifact.')
    }
    Write-Output "T08 APK adapter check passed: $($t08Required.Count) required libraries for $Abi. Runtime validation is still required."
} finally {
    $t08Archive.Dispose()
}
