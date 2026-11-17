param(
    [Parameter(Mandatory)][ValidateSet('Installer','Manifest','Verify')][string]$Mode,
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$Thumbprint
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1')
if ($Mode -eq 'Verify') {
    $signed = Get-AuthenticodeSignature -LiteralPath $Path
    if ($signed.SignerCertificate.Thumbprint -ne $Thumbprint -or $signed.Status -in @('HashMismatch','NotSigned')) { throw 'Unexpected installer signature' }
    return
}
$cert = Get-Item -LiteralPath ("Cert:\CurrentUser\My\" + $Thumbprint)
if (!$cert.HasPrivateKey) { throw 'The AIMatterLab release signing key is required' }
if ($Mode -eq 'Installer') {
    $signed = Set-AuthenticodeSignature -LiteralPath $Path -Certificate $cert -HashAlgorithm SHA256 -IncludeChain Signer
    if ($signed.SignerCertificate.Thumbprint -ne $Thumbprint) { throw ('Installer signing failed: ' + $signed.StatusMessage) }
} else {
    $key = [Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($cert)
    try {
        $signature = $key.SignData([IO.File]::ReadAllBytes($Path),[Security.Cryptography.HashAlgorithmName]::SHA256,[Security.Cryptography.RSASignaturePadding]::Pkcs1)
        [Convert]::ToBase64String($signature)
    } finally { $key.Dispose() }
}
