$ErrorActionPreference = 'Stop'
try {
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class StudioLaunchToken {
[DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
[DllImport("advapi32.dll", SetLastError=true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
[DllImport("advapi32.dll")] static extern bool IsTokenRestricted(IntPtr token);
[DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
public static bool Restricted() {
IntPtr token;
if (!OpenProcessToken(GetCurrentProcess(), 8, out token)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
try { return IsTokenRestricted(token); } finally { CloseHandle(token); }
}}
"@
$restricted = [StudioLaunchToken]::Restricted()
@{status=$(if ($restricted) {'blocked'} else {'allowed'}); restricted=$restricted; reason=$(if ($restricted) {'restricted_token'} else {'normal_token'})} | ConvertTo-Json -Compress
if ($restricted) { exit 2 }
exit 0
} catch {
@{status='blocked'; reason='token_probe_failed'} | ConvertTo-Json -Compress
exit 3
}
