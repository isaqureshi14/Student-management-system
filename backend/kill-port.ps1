powershell -Command "
# Get port mappings
$portMapping = netstat -ano | findstr :3001 | findstr LISTENING
if ($portMapping) {
    $pid = ($portMapping -split ' ') | Select-Object -Last 1
    try {
        Stop-Process -Id $pid -Force
        Write-Host 'Killed process ' $pid
    } catch {
        Write-Host 'Error killing process: ' $($_.Exception.Message)
    }
} else {
    Write-Host 'No process found listening on port 3001'
}
"