@echo off
echo Rejoining StormSafe CRM app files...
cd /d "%~dp0"
copy /b "StormSafe-CRM.zip.part1" + "StormSafe-CRM.zip.part2" "StormSafe-CRM.zip" >nul
echo Extracting (this takes a minute)...
tar -xf "StormSafe-CRM.zip"
echo.
echo Done! Open the "StormSafe CRM-win32-x64" folder and run "StormSafe CRM.exe"
echo Tip: right-click the exe ^> Send to ^> Desktop (create shortcut)
pause
