param([switch]$Check, [switch]$Probe)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class SelectionInput {
 [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
 [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
 [StructLayout(LayoutKind.Sequential)] public struct KEYBOARD { public ushort vk, scan; public uint flags, time; public UIntPtr extra; }
 [StructLayout(LayoutKind.Sequential)] public struct MOUSE { public int x,y; public uint data,flags,time; public UIntPtr extra; }
 [StructLayout(LayoutKind.Explicit)] public struct UNION { [FieldOffset(0)] public KEYBOARD key; [FieldOffset(0)] public MOUSE mouse; }
 [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public UNION data; }
 [DllImport("user32.dll")] private static extern uint SendInput(uint count, INPUT[] inputs, int size);
 public static void Copy() {
  var inputs = new INPUT[4]; var keys = new ushort[]{17,67,67,17};
  for(int i=0;i<4;i++){inputs[i].type=1;inputs[i].data.key.vk=keys[i];inputs[i].data.key.flags=i<2?0u:2u;}
  if(SendInput(4,inputs,Marshal.SizeOf(typeof(INPUT)))!=4) throw new InvalidOperationException("无法复制所选文字");
 }
}
'@
if ($Check) { 'Selection helper compiled successfully'; exit 0 }
try {
 $deadline = [DateTime]::UtcNow.AddSeconds(60)
 $pressed = $Probe.IsPresent
 while (-not $Probe -and [DateTime]::UtcNow -lt $deadline) {
  if (([SelectionInput]::GetAsyncKeyState(27) -band 0x8000) -ne 0) { throw '已取消划词' }
  $down = ([SelectionInput]::GetAsyncKeyState(1) -band 0x8000) -ne 0
  if ($down) { $pressed = $true }
  if ($pressed -and -not $down) { break }
  Start-Sleep -Milliseconds 20
 }
 if (-not $pressed -or [DateTime]::UtcNow -ge $deadline) { throw '等待划词超时，请重试' }
 Start-Sleep -Milliseconds 150
 $selected = ''
 try {
  $element = [System.Windows.Automation.AutomationElement]::FocusedElement
  $pattern = $null
  if ($null -ne $element -and $element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$pattern)) {
   $ranges = $pattern.GetSelection()
   $selected = (($ranges | ForEach-Object { $_.GetText(20000) }) -join "`n").Trim()
  }
 } catch {}
 if (-not $selected) {
  # Preserve all original clipboard formats, and require a new clipboard sequence.
  $original = [System.Windows.Forms.Clipboard]::GetDataObject()
  $backup = [System.Windows.Forms.DataObject]::new()
  if ($null -ne $original) {
   foreach ($format in $original.GetFormats($false)) {
    $value = $original.GetData($format,$false)
    if ($value -is [System.IO.MemoryStream]) { $value = [System.IO.MemoryStream]::new($value.ToArray()) }
    if ($value -is [System.Drawing.Image]) { $value = $value.Clone() }
    if ($null -ne $value) { $backup.SetData($format,$false,$value) }
   }
  }
  $sequence = [SelectionInput]::GetClipboardSequenceNumber()
  $copiedSequence = $sequence
  try {
   foreach ($key in @(17,18,16)) {
    while (([SelectionInput]::GetAsyncKeyState($key) -band 0x8000) -ne 0 -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 20 }
   }
   [SelectionInput]::Copy()
   for ($i=0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 30
    $copiedSequence = [SelectionInput]::GetClipboardSequenceNumber()
    if ($copiedSequence -ne $sequence) { break }
   }
   if ($copiedSequence -ne $sequence -and [System.Windows.Forms.Clipboard]::ContainsText()) {
    $selected = [System.Windows.Forms.Clipboard]::GetText().Trim()
   }
  } finally {
   # Do not overwrite a clipboard changed by another app after our copy.
   if ($copiedSequence -ne $sequence -and [SelectionInput]::GetClipboardSequenceNumber() -eq $copiedSequence) {
    if ($null -ne $original) { [System.Windows.Forms.Clipboard]::SetDataObject($backup,$true) }
    else { [System.Windows.Forms.Clipboard]::Clear() }
   }
  }
 }
 if (-not $selected) { throw '无法获取所选文字，请改用截图翻译' }
 @{text=$selected.Substring(0,[Math]::Min($selected.Length,20000))} | ConvertTo-Json -Compress
} catch { @{error=$_.Exception.Message} | ConvertTo-Json -Compress }
