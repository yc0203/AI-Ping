Add-Type -AssemblyName System.Windows.Forms,System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class TestWindow {
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr handle, int state);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle);
}
'@
$form = [System.Windows.Forms.Form]::new()
$form.Text = 'Selection verification'
$form.Width = 420
$form.Height = 150
$form.StartPosition = 'CenterScreen'
$text = [System.Windows.Forms.TextBox]::new()
$text.Multiline = $true
$text.Dock = 'Fill'
$text.Text = 'selection verification text'
$form.Controls.Add($text)
$form.Add_Shown({ $form.Activate(); $text.Focus(); $text.SelectAll() })
$form.Show()
[TestWindow]::ShowWindow($form.Handle,5) | Out-Null
[TestWindow]::SetForegroundWindow($form.Handle) | Out-Null
$text.Focus()
$text.SelectAll()
[System.Windows.Forms.Application]::Run($form)
