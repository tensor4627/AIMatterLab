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
LangString WorkspaceApplying 2052 "正在更新 AIMatterLab，完成后将重新打开工作区。"
LangString WorkspaceApplying 1033 "Updating AIMatterLab. Your workspace will reopen when installation finishes."

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
  Var /GLOBAL workspaceUpdateBanner
  ${If} ${Silent}
    ${GetParameters} $R0
    ClearErrors
    ${GetOptions} $R0 "--wait-pid=" $R1
    ${IfNot} ${Errors}
      GetFullPathName $R3 "$EXEDIR\..\.."
      ${If} "$EXEDIR" != "$R3\user-cache\updates"
      ${OrIfNot} ${FileExists} "$R3\.aimatterlab-workspace"
        SetErrorLevel 1
        Abort
      ${EndIf}
      StrCpy $INSTDIR "$R3"
      ; Detect another registered workspace before asking the desktop to close.
      ReadRegStr $R2 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
      ${If} $R2 != ""
        GetFullPathName $R2 "$R2"
        ${If} $R2 != $R3
          SetErrorLevel 1
          Abort
        ${EndIf}
      ${EndIf}
      ; workspaceFiles uses scratch registers. Save the parent PID across this call.
      Push $R1
      !insertmacro workspaceFiles Install
      Pop $R1
      System::Call 'kernel32::CreateFileW(w "$EXEDIR\restart.ready", i 0x40000000, i 0, p 0, i 1, i 0x80, p 0)p.r0'
      ${If} $0 == -1
        SetErrorLevel 1
        Abort
      ${EndIf}
      System::Call 'kernel32::CloseHandle(p r0)'
      Banner::show /NOUNLOAD "$(WorkspaceApplying)"
      StrCpy $workspaceUpdateBanner "1"
      ; Let the originating desktop finish its normal terminal and agent cleanup.
      StrCpy $2 $R1
      System::Call 'kernel32::OpenProcess(i 0x100000, i 0, i r2)p.r0'
      ${If} $0 != 0
        System::Call 'kernel32::WaitForSingleObject(p r0, i 60000)i.r1'
        System::Call 'kernel32::CloseHandle(p r0)'
        ${If} $1 != 0
          SetErrorLevel 1
          Abort
        ${EndIf}
      ${EndIf}
    ${Else}
      !insertmacro workspaceFiles Install
    ${EndIf}
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
  File /oname=$PLUGINSDIR\workspace-guide.md "${PROJECT_DIR}\agent\context\AGENTS.md"
  ; Seed new workspaces and update only the unchanged guide shipped in 0.1.9.
  System::Call 'kernel32::CopyFileW(w "$PLUGINSDIR\workspace-guide.md", w "$INSTDIR\AGENTS.md", i 1)i.r0'
  ${If} $0 == 0
    File /oname=$PLUGINSDIR\legacy-workspace-guide.md "${PROJECT_DIR}\installation\workspace-guide.md"
    ${StdUtils.HashFile} $R5 "SHA2-256" "$PLUGINSDIR\legacy-workspace-guide.md"
    ${StdUtils.HashFile} $R6 "SHA2-256" "$INSTDIR\AGENTS.md"
    StrLen $R7 $R5
    ${If} $R7 == 64
    ${AndIf} $R5 == $R6
      GetTempFileName $R3 "$INSTDIR"
      System::Call 'kernel32::CopyFileW(w "$PLUGINSDIR\workspace-guide.md", w "$R3", i 0)i.r0'
      ${If} $0 != 0
        System::Call 'kernel32::MoveFileExW(w "$R3", w "$INSTDIR\AGENTS.md", i 9)i.r0'
      ${EndIf}
      Delete "$R3"
    ${EndIf}
  ${EndIf}
  ; Seed a fresh base even for an offline/manual installation. Replace atomically.
  GetTempFileName $R3 "$INSTDIR\user-cache\updates"
  StrCpy $2 $R3
  System::Call 'kernel32::CopyFileW(w "$EXEPATH", w r2, i 0)i.r0'
  ${If} $0 != 0
    System::Call 'kernel32::MoveFileExW(w r2, w "$INSTDIR\user-cache\updates\installer.exe", i 9)i.r0'
  ${EndIf}
  Delete "$R3"
  ; Drop only the upstream duplicate after comparing it with the running setup.
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
  ${If} $workspaceUpdateBanner == "1"
    Banner::destroy
  ${EndIf}
!macroend

!macro customRemoveFiles
  SetOutPath $TEMP
  !insertmacro workspaceFiles Remove
  Delete "$INSTDIR\${UNINSTALL_FILENAME}"
!macroend
