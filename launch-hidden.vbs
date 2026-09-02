' Pi Web Tabs 隐形启动器：自动定位本文件夹，运行启动脚本且不显示任何黑窗口
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
CreateObject("Wscript.Shell").Run "powershell -NoProfile -ExecutionPolicy Bypass -File """ & dir & "\start-pi-custom.ps1""", 0, False
