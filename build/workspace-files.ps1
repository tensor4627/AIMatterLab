param(
    [Parameter(Mandatory)][ValidateSet('Install','Remove')][string]$Mode,
    [Parameter(Mandatory)][string]$Workspace,
    [Parameter(Mandatory)][string]$Manifest
)
$ErrorActionPreference = 'Stop'

function Test-AppPath([string]$Name, [string]$Type) {
    $exact = @('resources\app.asar', 'resources\tool-sources.json', 'resources\agent-runtimes\dsh\runtime.json')
    $trees = @('resources\app.asar.unpacked\worker', 'resources\agent-runtimes\dsh\bundles',
        'resources\studio-dsh', 'resources\studio-skills', 'resources\studio-tools', 'resources\terminal-service')
    if ($Name -match '\.(dll|exe|node|pyd|dylib|so(\.\d+)*)$') { return $false }
    if ($Type -ceq 'F' -and $exact -ccontains $Name) { return $true }
    foreach ($tree in $trees) {
        if ($Type -ceq 'D' -and $Name -ceq $tree) { return $true }
        if ($Name.StartsWith($tree+'\', [StringComparison]::Ordinal)) { return $true }
    }
    return $false
}

function Read-HotProgramFiles([IO.DirectoryInfo]$Root) {
    $parent = $Root
    foreach ($directory in @('resources','studio-updater')) {
        $entry = $parent.GetFileSystemInfos($directory)
        if (!$entry.Length) { return $null }
        if ($entry[0] -isnot [IO.DirectoryInfo] -or ($entry[0].Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw 'Linked application update program directory.'
        }
        $parent = $entry[0]
    }
    $entry = $parent.GetFileSystemInfos('app-files.txt')
    if (!$entry.Length) { return $null }
    if ($entry[0] -isnot [IO.FileInfo] -or ($entry[0].Attributes -band [IO.FileAttributes]::ReparsePoint) -or
        $entry[0].Length -gt 4MB) { throw 'Invalid application update program file list.' }
    $hotFiles = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $hotDirs = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($line in [IO.File]::ReadLines($entry[0].FullName)) {
        if ($line -cnotmatch '^(F|D)\|(.+)$') { throw 'Invalid application update program file entry.' }
        $type = $Matches[1]
        $name = $Matches[2]
        if ($name.Length -gt 1024 -or $name -match '[<>:"/|?*\x00-\x1f]' -or
            ($name.Split('\') | Where-Object { !$_.Length -or $_.Length -gt 255 -or
                $_ -match '[ .]$|^(con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(\.|$)' }) -or
            !(Test-AppPath $name $type)) { throw 'Invalid application update program path.' }
        if ($hotFiles.Contains($name) -or $hotDirs.Contains($name)) { throw 'Duplicate application update program path.' }
        if ($type -ceq 'F') { [void]$hotFiles.Add($name) } else { [void]$hotDirs.Add($name) }
    }
    if (!$hotFiles.Contains('resources\app.asar')) { throw 'Incomplete application update program file list.' }
    foreach ($name in @($hotDirs) + @($hotFiles)) {
        $parentName = [IO.Path]::GetDirectoryName($name)
        if ((Test-AppPath $parentName 'D') -and !$hotDirs.Contains($parentName)) {
            throw 'Missing application update program directory.'
        }
    }
    return @{Files=$hotFiles; Directories=$hotDirs}
}

try {
    if ($Workspace -notmatch '^[A-Za-z]:[\\/]' -or $Workspace -match '[\r\n]') { throw 'Choose a local workspace directory.' }
    $rootDir = [IO.DirectoryInfo]::new([IO.Path]::GetFullPath($Workspace))
    if (!$rootDir.Parent) { throw 'Choose a workspace folder inside the drive.' }
    for ($ancestor = $rootDir; $null -ne $ancestor; $ancestor = $ancestor.Parent) {
        if ($ancestor.Exists -and ($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Choose a workspace without linked parent folders.' }
    }
    $rootDir.Create()
    $marker = [IO.Path]::Combine($rootDir.FullName,'.aimatterlab-workspace')
    $markerText = 'AIMatterLab workspace v1'
    $files = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $directories = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($line in [IO.File]::ReadLines($Manifest)) {
        $name = $line.Substring(2)
        if ([IO.Path]::IsPathRooted($name) -or $name -match '(^|\\)\.\.?(\\|$)|[:*?]') { throw 'Invalid program file list.' }
        if ($line.StartsWith('D|')) { [void]$directories.Add($name) }
        elseif ($line.StartsWith('F|')) { [void]$files.Add($name) }
        else { throw 'Invalid program file list.' }
    }
    if (!$files.Contains('AIMatterLab.exe') -or !$files.Contains('resources\app.asar')) { throw 'Incomplete program file list.' }
    $known = $false
    $markerEntry = $rootDir.GetFileSystemInfos('.aimatterlab-workspace')
    if ($markerEntry.Length) {
        if ($markerEntry[0] -isnot [IO.FileInfo] -or ($markerEntry[0].Attributes -band [IO.FileAttributes]::ReparsePoint) -or $markerEntry[0].Length -gt 64 -or [IO.File]::ReadAllText($marker) -ne $markerText) { throw 'Unrecognized workspace marker.' }
        $known = $true
    }
    if ($Mode -eq 'Remove' -and !$known) { throw 'Cannot confirm the installed workspace.' }
    if ($known -and $files.Contains('resources\studio-updater\app-files.txt')) {
        $hot = Read-HotProgramFiles $rootDir
        if ($hot) {
            if ($Mode -eq 'Remove') {
                foreach ($name in @($files)) { if (Test-AppPath $name 'F') { [void]$files.Remove($name) } }
                foreach ($name in @($directories)) { if (Test-AppPath $name 'D') { [void]$directories.Remove($name) } }
            }
            $files.UnionWith($hot.Files)
            $directories.UnionWith($hot.Directories)
        }
    }
    $ownedFiles = [Collections.Generic.List[IO.FileInfo]]::new()
    $ownedDirs = [Collections.Generic.List[IO.DirectoryInfo]]::new()
    $pending = [Collections.Generic.Stack[IO.DirectoryInfo]]::new()
    $pending.Push($rootDir)
    while ($pending.Count) {
        $parent = $pending.Pop()
        foreach ($entry in $parent.EnumerateFileSystemInfos()) {
            $relative = $entry.FullName.Substring($rootDir.FullName.TrimEnd('\').Length + 1)
            if (!$files.Contains($relative) -and !$directories.Contains($relative)) { continue }
            if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Linked program path: $relative" }
            if ($directories.Contains($relative) -and $entry -is [IO.DirectoryInfo]) {
                $ownedDirs.Add($entry)
                $pending.Push($entry)
            } elseif ($files.Contains($relative) -and $entry -is [IO.FileInfo]) {
                $ownedFiles.Add($entry)
            } else { throw "Conflicting workspace path: $relative" }
        }
    }
    if ($Mode -eq 'Install') {
        if (!$known -and ($ownedFiles.Count -or $ownedDirs.Count)) {
            # An earlier unpacked AIMatterLab distribution can keep its .config in place.
            $exe = [IO.Path]::Combine($rootDir.FullName,'AIMatterLab.exe')
            $asar = [IO.Path]::Combine($rootDir.FullName,'resources','app.asar')
            if (![IO.File]::Exists($exe) -or ![IO.File]::Exists($asar) -or [Diagnostics.FileVersionInfo]::GetVersionInfo($exe).ProductName -ne 'AIMatterLab') { throw 'Program filenames already exist here. Choose a dedicated workspace folder.' }
        }
        foreach ($name in @('sources','user-cache','user-cache\updates','user-cache\skills','user-cache\skills\user','.config')) {
            $dir = [IO.DirectoryInfo]::new([IO.Path]::Combine($rootDir.FullName,$name))
            if ([IO.File]::Exists($dir.FullName) -or ($dir.Exists -and ($dir.Attributes -band [IO.FileAttributes]::ReparsePoint))) { throw "Conflicting data directory: $name" }
            $dir.Create()
        }
        if (!$known) {
            $stream = [IO.File]::Open($marker,[IO.FileMode]::CreateNew)
            try { $bytes = [Text.Encoding]::ASCII.GetBytes($markerText); $stream.Write($bytes,0,$bytes.Length) } finally { $stream.Dispose() }
        }
    } else {
        foreach ($entry in $ownedFiles) { $entry.Delete() }
        for ($index=$ownedDirs.Count-1; $index -ge 0; $index--) {
            $dir = $ownedDirs[$index]
            if (!($dir.EnumerateFileSystemInfos() | Select-Object -First 1)) { $dir.Delete($false) }
        }
    }
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
