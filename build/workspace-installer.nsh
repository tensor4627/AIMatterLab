LangString WorkspaceTitle 2052 "选择 AIMatterLab 工作区"
LangString WorkspaceTitle 1033 "Choose your AIMatterLab workspace"
LangString WorkspaceSubtitle 2052 "安装完成后，可直接从桌面启动。"
LangString WorkspaceSubtitle 1033 "After setup, launch AIMatterLab from your desktop."
LangString WorkspaceBody 2052 "软件将解压到所选目录，并创建桌面快捷方式。源码、用户缓存和项目技能也保存在这里。升级已有工作区时请选择原目录。"
LangString WorkspaceBody 1033 "The application, sources, user cache and project skills live in this folder. Setup creates a desktop shortcut. Select the same workspace to upgrade."
LangString WorkspaceError 2052 "无法使用此工作区"
LangString WorkspaceError 1033 "Cannot use this workspace"
LangString WorkspaceBusy 2052 "请先关闭从这个工作区启动的 AIMatterLab，再重新运行安装或卸载。"
LangString WorkspaceBusy 1033 "Close the copy of AIMatterLab running from this workspace and retry."

!macro customCheckAppRunning
  IfFileExists "$INSTDIR\AIMatterLab.exe" 0 +7
  System::Call 'kernel32::CreateFileW(w "$INSTDIR\AIMatterLab.exe", i 0x40000000, i 0, p 0, i 3, i 0, p 0)p.r0'
  StrCmp $0 -1 0 +4
    MessageBox MB_OK|MB_ICONSTOP "$(WorkspaceBusy)" /SD IDOK
    SetErrorLevel 1
    Abort
  System::Call 'kernel32::CloseHandle(p r0)'
!macroend

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro workspaceFiles MODE
  InitPluginsDir
  File /oname=$PLUGINSDIR\workspace-files.ps1 "${BUILD_RESOURCES_DIR}\workspace-files.ps1"
  File /oname=$PLUGINSDIR\workspace-program.files "${PROJECT_DIR}\.studio\installer\${VERSION}-win.files"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\workspace-files.ps1" -Mode ${MODE} -Workspace "$INSTDIR" -Manifest "$PLUGINSDIR\workspace-program.files"'
  Pop $0
  Pop $1
  ${If} $0 != "0"
    MessageBox MB_OK|MB_ICONSTOP "$(WorkspaceError)$\r$\n$1" /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
!macroend

!macro customInit
  ${If} ${Silent}
    !insertmacro workspaceFiles Install
  ${EndIf}
!macroend

!macro customPageAfterChangeDir
  !define MUI_PAGE_HEADER_TEXT "$(WorkspaceTitle)"
  !define MUI_PAGE_HEADER_SUBTEXT "$(WorkspaceSubtitle)"
  !define MUI_DIRECTORYPAGE_TEXT_TOP "$(WorkspaceBody)"
  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE WorkspaceSelected
  !insertmacro MUI_PAGE_DIRECTORY
  Function WorkspaceSelected
    !insertmacro workspaceFiles Install
  FunctionEnd
!macroend

!macro customInstall
  File /oname=$PLUGINSDIR\workspace-guide.md "${PROJECT_DIR}\installation\workspace-guide.md"
  ; CopyFile's fail-if-exists flag preserves any user-authored project instructions.
  System::Call 'kernel32::CopyFileW(w "$PLUGINSDIR\workspace-guide.md", w "$INSTDIR\AGENTS.md", i 1)i.r0'
  ; The upstream NSIS template caches a full installer for electron-updater.
  ; This app has no updater. Discard only an exact duplicate, never the running setup.
  GetFullPathName $R4 "$LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}"
  ${If} ${FileExists} "$R4"
  ${AndIf} $R4 != $EXEPATH
    ${StdUtils.HashFile} $R5 "SHA2-256" "$EXEPATH"
    ${StdUtils.HashFile} $R6 "SHA2-256" "$R4"
    StrLen $R7 $R5
    ${If} $R7 == 64
    ${AndIf} $R5 == $R6
      Delete "$R4"
      ${StdUtils.GetParentPath} $R7 "$R4"
      RMDir "$R7"
    ${EndIf}
  ${EndIf}
!macroend

!macro customRemoveFiles
  SetOutPath $TEMP
  !insertmacro workspaceFiles Remove
  Delete "$INSTDIR\${UNINSTALL_FILENAME}"
!macroend
