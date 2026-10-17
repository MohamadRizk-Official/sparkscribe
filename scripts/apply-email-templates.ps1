# Applies the SparkScribe auth email templates (scripts/apply-email-templates.mjs) on Windows.
# Asks for your Supabase access token with hidden input (it is not shown, saved, or put in the command history),
# shows the dry run, applies only after you type "yes", then removes the token from this process.
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\apply-email-templates.ps1
$secure = Read-Host 'Paste your Supabase access token (hidden), then press Enter' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $env:SUPABASE_ACCESS_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  node "$PSScriptRoot\apply-email-templates.mjs"
  if ($LASTEXITCODE -ne 0) { Write-Host 'The dry run failed, so nothing was changed.'; exit 1 }
  $answer = Read-Host 'Apply these changes now? Type yes to apply'
  if ($answer -eq 'yes') { node "$PSScriptRoot\apply-email-templates.mjs" --apply } else { Write-Host 'Nothing applied.' }
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  Remove-Item Env:SUPABASE_ACCESS_TOKEN -ErrorAction SilentlyContinue
  $secure.Dispose()
}
