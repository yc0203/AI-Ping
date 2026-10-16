$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$originalFormats = @([System.Windows.Forms.Clipboard]::GetDataObject().GetFormats($false)) | Sort-Object
$fixture = Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',"$PSScriptRoot\selection-fixture.ps1" -WindowStyle Hidden -PassThru
try {
 Start-Sleep -Seconds 2
 Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
 $focusedProcess = [System.Windows.Automation.AutomationElement]::FocusedElement.Current.ProcessId
 if ($focusedProcess -ne $fixture.Id) { throw 'Fixture could not take focus; selection test cannot continue safely' }
 $result = & powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "$PSScriptRoot\..\native\text-selection.ps1" -Probe
 $parsed = $result | ConvertFrom-Json
 if ($parsed.text -ne 'selection verification text') { throw ($parsed.error ?? 'Selection verification failed') }
 $afterFormats = @([System.Windows.Forms.Clipboard]::GetDataObject().GetFormats($false)) | Sort-Object
 if (($originalFormats -join '|') -ne ($afterFormats -join '|')) { throw 'Clipboard formats changed after text retrieval' }
 'Selected text retrieval: passed'
 'Clipboard formats preserved: passed'
} finally { Stop-Process -Id $fixture.Id -ErrorAction SilentlyContinue }
