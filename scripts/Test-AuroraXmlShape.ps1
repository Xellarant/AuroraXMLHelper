<#
.SYNOPSIS
Runs Aurora Builder specific XML shape checks for element source repositories.

.DESCRIPTION
This script validates Aurora XML files beyond plain XML parsing. It checks the
document shape Aurora expects, required element attributes, class/multiclass
structure, update/index file metadata, duplicate element ids, optional local raw
GitHub targets for index entries, and optional id references against an
AuroraLegacy elements checkout. Use -CheckUpdateLocalTargets to also validate
update-node raw URLs against local files.

.EXAMPLE
.\scripts\Test-AuroraXmlShape.ps1 -RootPath .

.EXAMPLE
.\scripts\Test-AuroraXmlShape.ps1 `
  -RootPath . `
  -LocalRawPrefix "https://raw.githubusercontent.com/Xellarant/the-book-of-xellarant/master/" `
  -LocalIdPrefix "ID_EFA_" `
  -FocusPath "Eberron Forge of the Artificer"

.EXAMPLE
.\scripts\Test-AuroraXmlShape.ps1 `
  -RootPath "C:\Users\Ralla\source\repos\Aurora XML Helper" `
  -LegacyPath "C:\Users\Ralla\source\repos\AuroraLegacy-elements" `
  -LocalIdPrefix "ID_EFA_"
#>

[CmdletBinding()]
param(
    [string]$RootPath = ".",

    [string]$LegacyPath,

    [string[]]$FocusPath = @(),

    [string[]]$LocalIdPrefix = @(),

    [string[]]$LocalRawPrefix = @(),

    [string[]]$AllowedUnresolvedId = @(),

    [string[]]$ExcludeDirectory = @(".git", ".codex-tmp", "bin", "obj"),

    [switch]$CheckUpdateLocalTargets,

    [switch]$Json
)

$ErrorActionPreference = "Stop"

$Findings = New-Object System.Collections.Generic.List[object]
$ParsedDocuments = New-Object System.Collections.Generic.List[object]
$ElementIdLocations = @{}
$MulticlassIdLocations = @{}
$RepoDefinedIds = New-Object "System.Collections.Generic.HashSet[string]"
$AllowedUnresolvedIds = New-Object "System.Collections.Generic.HashSet[string]"

foreach ($id in $AllowedUnresolvedId) {
    if (-not [string]::IsNullOrWhiteSpace($id)) {
        [void]$AllowedUnresolvedIds.Add($id)
    }
}

function Add-Finding {
    param(
        [ValidateSet("Error", "Warning")]
        [string]$Severity,
        [string]$File,
        [string]$Check,
        [string]$Message
    )

    $script:Findings.Add([pscustomobject]@{
        Severity = $Severity
        Check = $Check
        File = $File
        Message = $Message
    }) | Out-Null
}

function Get-FullPath {
    param([string]$Path)

    if ([System.IO.Path]::IsPathRooted($Path)) {
        return [System.IO.Path]::GetFullPath($Path)
    }

    return [System.IO.Path]::GetFullPath((Join-Path (Get-Location).Path $Path))
}

function Get-DisplayPath {
    param([string]$Path)

    if ($Path.StartsWith($script:RootFullPath, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $Path.Substring($script:RootFullPath.Length).TrimStart("\", "/")
    }

    return $Path
}

function Get-TextContent {
    param([string]$Path)

    $raw = Get-Content -LiteralPath $Path -Raw
    if ($null -eq $raw) {
        return ""
    }

    return [string]$raw
}

function Get-ReferenceScanText {
    param([string]$Path)

    $text = Get-TextContent $Path
    return [System.Text.RegularExpressions.Regex]::Replace($text, "<!--[\s\S]*?-->", "")
}

function Get-XmlAttribute {
    param(
        [System.Xml.XmlNode]$Node,
        [string]$Name
    )

    if ($null -eq $Node -or $null -eq $Node.Attributes) {
        return $null
    }

    $attribute = $Node.Attributes.GetNamedItem($Name)
    if ($null -eq $attribute) {
        return $null
    }

    return [string]$attribute.Value
}

function Test-UnderExcludedDirectory {
    param([string]$Path)

    $relative = Get-DisplayPath $Path
    $segments = $relative -split "[\\/]"
    foreach ($directory in $script:ExcludeDirectory) {
        if ($segments -contains $directory) {
            return $true
        }
    }

    return $false
}

function Test-InFocus {
    param([string]$Path)

    if ($script:FocusFullPaths.Count -eq 0) {
        return $true
    }

    foreach ($focus in $script:FocusFullPaths) {
        if ($Path.Equals($focus, [System.StringComparison]::OrdinalIgnoreCase)) {
            return $true
        }

        $prefix = $focus.TrimEnd("\", "/") + [System.IO.Path]::DirectorySeparatorChar
        if ($Path.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            return $true
        }
    }

    return $false
}

function Add-IdLocation {
    param(
        [hashtable]$Table,
        [string]$Id,
        [string]$File
    )

    if ([string]::IsNullOrWhiteSpace($Id)) {
        return
    }

    if (-not $Table.ContainsKey($Id)) {
        $Table[$Id] = New-Object System.Collections.Generic.List[string]
    }

    $Table[$Id].Add($File) | Out-Null
    [void]$script:RepoDefinedIds.Add($Id)
}

function Format-IdList {
    param(
        [string[]]$Ids,
        [int]$Limit = 5
    )

    $uniqueIds = @($Ids | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Sort-Object -Unique)
    if ($uniqueIds.Count -le $Limit) {
        return ($uniqueIds -join ", ")
    }

    $head = @($uniqueIds | Select-Object -First $Limit)
    return (($head -join ", ") + " and $($uniqueIds.Count - $Limit) more")
}

function Test-AbilityScoreName {
    param([string]$Name)

    return @("strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma") -contains $Name
}

function Test-ElementAuroraContentRules {
    param(
        [System.Xml.XmlNode]$Element,
        [string]$DisplayPath
    )

    $id = Get-XmlAttribute $Element "id"
    $name = Get-XmlAttribute $Element "name"
    $type = Get-XmlAttribute $Element "type"
    $label = if (-not [string]::IsNullOrWhiteSpace($id)) { $id } elseif (-not [string]::IsNullOrWhiteSpace($name)) { $name } else { "<unnamed>" }

    $grantNodes = @($Element.SelectNodes("./rules/grant"))
    foreach ($grant in $grantNodes) {
        $grantType = Get-XmlAttribute $grant "type"
        $grantId = Get-XmlAttribute $grant "id"

        if ($grantType -eq "Condition Immunity" -and $grantId -like "ID_INTERNAL_CONDITION_DAMAGE_RESISTANCE_*") {
            Add-Finding "Error" $DisplayPath "DamageResistanceGrant" "Element '$label' grants damage resistance '$grantId' as Condition Immunity; use grant type 'Condition' for damage resistance."
        }
    }

    foreach ($stat in @($Element.SelectNodes("./rules/stat"))) {
        $value = Get-XmlAttribute $stat "value"
        if ($value -match "^level:[A-Za-z0-9_-]+:\d+$") {
            Add-Finding "Warning" $DisplayPath "LevelMultiplierStat" "Element '$label' uses stat value '$value'. Aurora generation should emit repeated level stat entries for level multipliers."
        }
    }

    if ($type -eq "Spell") {
        foreach ($supportsNode in @($Element.SelectNodes("./supports"))) {
            $tokens = @($supportsNode.InnerText -split "," | ForEach-Object { $_.Trim() })
            $numericTokens = @($tokens | Where-Object { $_ -match "^\d+$" })
            if ($numericTokens.Count -gt 0) {
                Add-Finding "Warning" $DisplayPath "SpellSupportsLevel" "Spell '$label' has numeric supports token(s) '$($numericTokens -join ", ")'. Put spell level in setters/rules rather than supports."
            }
        }
    }

    if ($type -eq "Background") {
        $directAbilityStats = @($Element.SelectNodes("./rules/stat") | Where-Object {
            $statName = Get-XmlAttribute $_ "name"
            Test-AbilityScoreName $statName
        })

        $asiGrantNodes = @($grantNodes | Where-Object {
            (Get-XmlAttribute $_ "type") -eq "Ability Score Improvement" -and
            (Get-XmlAttribute $_ "id") -like "ID_INTERNAL_ABILITY_SCORE_IMPROVEMENT_COMBINATION_*"
        })

        $backgroundAsiGrantNodes = @($grantNodes | Where-Object {
            (Get-XmlAttribute $_ "id") -eq "ID_INTERNAL_GRANTS_BACKGROUND_ASI"
        })

        $phb24FeatGrantNodes = @($grantNodes | Where-Object {
            (Get-XmlAttribute $_ "id") -like "ID_WOTC_PHB24_FEAT_*"
        })

        if ($asiGrantNodes.Count -gt 0 -and $backgroundAsiGrantNodes.Count -eq 0) {
            Add-Finding "Error" $DisplayPath "BackgroundAsiGrant" "Background '$label' grants a 2024-style ability score choice but is missing ID_INTERNAL_GRANTS_BACKGROUND_ASI."
        }

        if ($directAbilityStats.Count -gt 0) {
            $statNames = @($directAbilityStats | ForEach-Object { Get-XmlAttribute $_ "name" } | Sort-Object -Unique)
            $severity = if ($phb24FeatGrantNodes.Count -gt 0 -or $asiGrantNodes.Count -gt 0) { "Error" } else { "Warning" }
            Add-Finding $severity $DisplayPath "BackgroundAbilityStats" "Background '$label' uses direct ability stat grant(s) '$($statNames -join ", ")'. 2024-style backgrounds should grant an Ability Score Improvement combination and ID_INTERNAL_GRANTS_BACKGROUND_ASI."
        }
    }
}

function Test-FileNode {
    param(
        [System.Xml.XmlNode]$Node,
        [string]$DisplayPath,
        [string]$CheckPrefix
    )

    $name = Get-XmlAttribute $Node "name"
    $url = Get-XmlAttribute $Node "url"

    if ([string]::IsNullOrWhiteSpace($name)) {
        Add-Finding "Error" $DisplayPath $CheckPrefix "File node is missing a non-empty name attribute."
    }

    if ([string]::IsNullOrWhiteSpace($url)) {
        Add-Finding "Error" $DisplayPath $CheckPrefix "File node '$name' is missing a non-empty url attribute."
    }
}

function Test-LocalRawTarget {
    param(
        [System.Xml.XmlNode]$Node,
        [string]$DisplayPath,
        [string]$CheckName = "IndexLocalTarget"
    )

    if ($script:LocalRawPrefix.Count -eq 0) {
        return
    }

    $url = Get-XmlAttribute $Node "url"
    if ([string]::IsNullOrWhiteSpace($url)) {
        return
    }

    foreach ($prefix in $script:LocalRawPrefix) {
        if (-not $url.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            continue
        }

        $relativeUrl = $url.Substring($prefix.Length)
        $relativePath = [System.Uri]::UnescapeDataString($relativeUrl).Replace("/", [System.IO.Path]::DirectorySeparatorChar)
        $target = Join-Path $script:RootFullPath $relativePath
        if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
            $name = Get-XmlAttribute $Node "name"
            Add-Finding "Error" $DisplayPath $CheckName "Raw URL for '$name' points to missing local file '$relativePath'."
        }
    }
}

function Test-ElementsDocument {
    param(
        [xml]$Xml,
        [string]$FullPath,
        [string]$DisplayPath
    )

    $info = $Xml.SelectSingleNode("/elements/info")
    if ($null -eq $info) {
        Add-Finding "Error" $DisplayPath "ElementsInfo" "Missing /elements/info node."
    }
    else {
        if ($null -ne $info.SelectSingleNode("./n")) {
            Add-Finding "Error" $DisplayPath "ElementsInfo" "Uses /elements/info/n; Aurora metadata should use /elements/info/name."
        }

        $update = $info.SelectSingleNode("./update")
        if ($null -eq $update) {
            Add-Finding "Error" $DisplayPath "ElementsUpdate" "Missing /elements/info/update node."
        }
        else {
            $version = Get-XmlAttribute $update "version"
            if ([string]::IsNullOrWhiteSpace($version)) {
                Add-Finding "Error" $DisplayPath "ElementsUpdate" "Update node is missing a non-empty version attribute."
            }

            foreach ($fileNode in @($update.SelectNodes("./file"))) {
                Test-FileNode $fileNode $DisplayPath "ElementsUpdate"
                if ($script:CheckUpdateLocalTargets) {
                    Test-LocalRawTarget $fileNode $DisplayPath "UpdateLocalTarget"
                }
            }
        }
    }

    foreach ($element in @($Xml.SelectNodes("/elements/element"))) {
        foreach ($attributeName in @("name", "type", "source", "id")) {
            $value = Get-XmlAttribute $element $attributeName
            if ([string]::IsNullOrWhiteSpace($value)) {
                $elementName = Get-XmlAttribute $element "name"
                Add-Finding "Error" $DisplayPath "ElementAttributes" "Element '$elementName' is missing a non-empty '$attributeName' attribute."
            }
        }

        $id = Get-XmlAttribute $element "id"
        Add-IdLocation $script:ElementIdLocations $id $FullPath

        $type = Get-XmlAttribute $element "type"
        if ($type -eq "Class") {
            $hdNode = $element.SelectSingleNode("./setters/set[@name='hd']")
            if ($null -eq $hdNode -or [string]::IsNullOrWhiteSpace($hdNode.InnerText)) {
                Add-Finding "Error" $DisplayPath "ClassShape" "Class '$id' is missing a non-empty hd setter."
            }

            foreach ($multiclassNode in @($element.SelectNodes("./multiclass"))) {
                $multiclassId = Get-XmlAttribute $multiclassNode "id"
                if ([string]::IsNullOrWhiteSpace($multiclassId)) {
                    Add-Finding "Error" $DisplayPath "ClassShape" "Class '$id' has a multiclass node without an id attribute."
                }
                else {
                    Add-IdLocation $script:MulticlassIdLocations $multiclassId $FullPath
                }
            }
        }

        Test-ElementAuroraContentRules $element $DisplayPath
    }
}

function Test-IndexDocument {
    param(
        [xml]$Xml,
        [string]$DisplayPath
    )

    $info = $Xml.SelectSingleNode("/index/info")
    if ($null -eq $info) {
        Add-Finding "Error" $DisplayPath "IndexInfo" "Missing /index/info node."
    }
    else {
        $update = $info.SelectSingleNode("./update")
        if ($null -eq $update) {
            Add-Finding "Error" $DisplayPath "IndexUpdate" "Missing /index/info/update node."
        }
        else {
            $version = Get-XmlAttribute $update "version"
            if ([string]::IsNullOrWhiteSpace($version)) {
                Add-Finding "Error" $DisplayPath "IndexUpdate" "Update node is missing a non-empty version attribute."
            }

            foreach ($fileNode in @($update.SelectNodes("./file"))) {
                Test-FileNode $fileNode $DisplayPath "IndexUpdate"
                if ($script:CheckUpdateLocalTargets) {
                    Test-LocalRawTarget $fileNode $DisplayPath "UpdateLocalTarget"
                }
            }
        }
    }

    $filesNode = $Xml.SelectSingleNode("/index/files")
    if ($null -eq $filesNode) {
        Add-Finding "Error" $DisplayPath "IndexFiles" "Missing /index/files node."
        return
    }

    $seenFileNames = @{}
    foreach ($fileNode in @($filesNode.SelectNodes("./file"))) {
        Test-FileNode $fileNode $DisplayPath "IndexFiles"
        Test-LocalRawTarget $fileNode $DisplayPath

        $name = Get-XmlAttribute $fileNode "name"
        if (-not [string]::IsNullOrWhiteSpace($name)) {
            if ($seenFileNames.ContainsKey($name)) {
                Add-Finding "Warning" $DisplayPath "IndexFiles" "Index contains duplicate file name '$name'."
            }
            else {
                $seenFileNames[$name] = $true
            }
        }
    }
}

function Add-LegacyKnownIds {
    param([string]$Path)

    $legacyFullPath = Get-FullPath $Path
    if (-not (Test-Path -LiteralPath $legacyFullPath -PathType Container)) {
        Add-Finding "Error" $legacyFullPath "ExternalIds" "LegacyPath does not exist or is not a directory."
        return
    }

    $legacyFiles = Get-ChildItem -LiteralPath $legacyFullPath -Recurse -File |
        Where-Object { $_.Extension -in @(".xml", ".index") }

    foreach ($file in $legacyFiles) {
        $text = Get-ReferenceScanText $file.FullName
        foreach ($match in [regex]::Matches($text, "ID_[A-Z0-9_]+")) {
            [void]$script:RepoDefinedIds.Add($match.Value)
        }
    }
}

function Test-IdReferences {
    param([System.Collections.Generic.List[object]]$Documents)

    if (-not [string]::IsNullOrWhiteSpace($script:LegacyPath)) {
        Add-LegacyKnownIds $script:LegacyPath
    }

    foreach ($document in $Documents) {
        $text = Get-ReferenceScanText $document.FullPath
        $ids = [regex]::Matches($text, "ID_[A-Z0-9_]+") |
            ForEach-Object { $_.Value } |
            Sort-Object -Unique

        $hasPhb24Ids = @($ids | Where-Object { $_.StartsWith("ID_WOTC_PHB24_", [System.StringComparison]::OrdinalIgnoreCase) })
        $legacyPhbSpellFeatIds = @($ids | Where-Object { $_ -match "^ID_PHB_(SPELL|FEAT)_" })
        if ($hasPhb24Ids.Count -gt 0 -and $legacyPhbSpellFeatIds.Count -gt 0) {
            Add-Finding "Warning" $document.DisplayPath "SourceEditionIds" "Document mixes 2024 PHB ids with legacy PHB spell/feat ids: $(Format-IdList $legacyPhbSpellFeatIds). Verify the intended source edition."
        }

        foreach ($id in $ids) {
            if ($script:AllowedUnresolvedIds.Contains($id)) {
                continue
            }

            foreach ($prefix in $script:LocalIdPrefix) {
                if ($id.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase) -and -not $script:RepoDefinedIds.Contains($id)) {
                    Add-Finding "Error" $document.DisplayPath "LocalIds" "Local id reference '$id' is not defined as an element id or multiclass id in this root."
                }
            }

            if ([string]::IsNullOrWhiteSpace($script:LegacyPath)) {
                continue
            }

            if ($script:RepoDefinedIds.Contains($id)) {
                continue
            }

            if (Test-InFocus $document.FullPath) {
                Add-Finding "Error" $document.DisplayPath "ExternalIds" "Id reference '$id' is not defined in this root or in the supplied LegacyPath."
            }
            else {
                Add-Finding "Warning" $document.DisplayPath "ExternalIds" "Id reference '$id' is not defined in this root or in the supplied LegacyPath."
            }
        }
    }
}

$RootFullPath = Get-FullPath $RootPath
if (-not (Test-Path -LiteralPath $RootFullPath -PathType Container)) {
    throw "RootPath does not exist or is not a directory: $RootFullPath"
}

$FocusFullPaths = New-Object System.Collections.Generic.List[string]
foreach ($path in $FocusPath) {
    if ([string]::IsNullOrWhiteSpace($path)) {
        continue
    }

    if ([System.IO.Path]::IsPathRooted($path)) {
        $FocusFullPaths.Add([System.IO.Path]::GetFullPath($path)) | Out-Null
    }
    else {
        $FocusFullPaths.Add([System.IO.Path]::GetFullPath((Join-Path $RootFullPath $path))) | Out-Null
    }
}

$sourceFiles = Get-ChildItem -LiteralPath $RootFullPath -Recurse -File |
    Where-Object { $_.Extension -in @(".xml", ".index") } |
    Where-Object { -not (Test-UnderExcludedDirectory $_.FullName) } |
    Sort-Object FullName

if ($sourceFiles.Count -eq 0) {
    Add-Finding "Error" (Get-DisplayPath $RootFullPath) "Discovery" "No .xml or .index files were found."
}

foreach ($file in $sourceFiles) {
    $displayPath = Get-DisplayPath $file.FullName

    try {
        [xml]$xml = Get-TextContent $file.FullName
    }
    catch {
        Add-Finding "Error" $displayPath "XmlParse" "XML parse failed: $($_.Exception.Message)"
        continue
    }

    $ParsedDocuments.Add([pscustomobject]@{
        FullPath = $file.FullName
        DisplayPath = $displayPath
        Xml = $xml
    }) | Out-Null

    $root = $xml.DocumentElement
    if ($null -eq $root) {
        Add-Finding "Error" $displayPath "XmlParse" "XML document has no root element."
        continue
    }

    switch ($root.Name) {
        "elements" {
            Test-ElementsDocument $xml $file.FullName $displayPath
        }
        "index" {
            Test-IndexDocument $xml $displayPath
        }
        default {
            Add-Finding "Error" $displayPath "RootShape" "Unexpected root '$($root.Name)'; expected 'elements' or 'index'."
        }
    }
}

foreach ($entry in $ElementIdLocations.GetEnumerator()) {
    $uniqueLocations = @($entry.Value | Sort-Object -Unique)
    if ($uniqueLocations.Count -gt 1) {
        $files = ($uniqueLocations | ForEach-Object { Get-DisplayPath $_ }) -join "; "
        Add-Finding "Error" $files "DuplicateElementIds" "Duplicate element id '$($entry.Key)'."
    }
}

Test-IdReferences $ParsedDocuments

$errors = @($Findings | Where-Object Severity -eq "Error")
$warnings = @($Findings | Where-Object Severity -eq "Warning")

$result = [pscustomobject]@{
    RootPath = $RootFullPath
    FilesChecked = $sourceFiles.Count
    ErrorCount = $errors.Count
    WarningCount = $warnings.Count
    Findings = @($Findings | Sort-Object Severity, Check, File, Message)
}

if ($Json) {
    $result | ConvertTo-Json -Depth 6
}
else {
    Write-Host "Aurora XML shape check"
    Write-Host "Root: $RootFullPath"
    Write-Host "Files checked: $($result.FilesChecked)"
    Write-Host "Errors: $($result.ErrorCount)"
    Write-Host "Warnings: $($result.WarningCount)"

    if ($Findings.Count -gt 0) {
        ""
        $Findings |
            Sort-Object Severity, Check, File, Message |
            Format-Table Severity, Check, File, Message -AutoSize |
            Out-String -Width 4096 |
            Write-Host
    }
}

if ($errors.Count -gt 0) {
    exit 1
}

exit 0
