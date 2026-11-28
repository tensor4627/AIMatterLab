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
LangString WorkspaceValidate 2052 "正在核对原工作区和程序文件清单…"
LangString WorkspaceValidate 1033 "Checking the workspace and program file list…"
LangString WorkspaceWait 2052 "正在等待 AIMatterLab 退出…"
LangString WorkspaceWait 1033 "Waiting for AIMatterLab to close…"
LangString WorkspaceCheckRunning 2052 "正在检查应用文件是否仍在使用…"
LangString WorkspaceCheckRunning 1033 "Checking whether application files are in use…"
LangString WorkspaceFiles 2052 "正在替换旧版程序，解压并写入应用文件…"
LangString WorkspaceFiles 1033 "Replacing the program and extracting application files…"
LangString WorkspaceRegister 2052 "正在登记 Windows 应用和快捷方式…"
LangString WorkspaceRegister 1033 "Registering the Windows application and shortcuts…"
LangString WorkspaceGuide 2052 "正在核对工作区指南…"
LangString WorkspaceGuide 1033 "Checking the workspace guide…"
LangString WorkspaceCache 2052 "正在保存下次增量更新所需的安装包…"
LangString WorkspaceCache 1033 "Saving the installer for future differential updates…"
LangString WorkspaceCleanup 2052 "正在核对并清理重复的安装缓存…"
LangString WorkspaceCleanup 1033 "Checking for and cleaning duplicate installer cache files…"
LangString WorkspaceReopen 2052 "正在重新打开 AIMatterLab…"
LangString WorkspaceReopen 1033 "Reopening AIMatterLab…"

!ifndef BUILD_UNINSTALLER
  Var workspaceRestartDir
!endif

!macro customHeader
  !ifndef BUILD_UNINSTALLER
    ShowInstDetails show
  !endif
!macroend

!macro customCheckAppRunning
  !ifndef BUILD_UNINSTALLER
    SetDetailsPrint both
    DetailPrint "$(WorkspaceCheckRunning)"
  !endif
  IfFileExists "$INSTDIR\AIMatterLab.exe" 0 +7
  System::Call 'kernel32::CreateFileW(w "$INSTDIR\AIMatterLab.exe", i 0x40000000, i 0, p 0, i 3, i 0, p 0)p.r0'
  StrCmp $0 -1 0 +4
    MessageBox MB_OK|MB_ICONSTOP "$(WorkspaceBusy)" /SD IDOK
    SetErrorLevel 1
    Abort
  System::Call 'kernel32::CloseHandle(p r0)'
  !ifndef BUILD_UNINSTALLER
    DetailPrint "$(WorkspaceFiles)"
  !endif
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
      StrCpy $workspaceRestartDir "$INSTDIR"
      Banner::show /NOUNLOAD /set 76 "AIMatterLab ${VERSION}" "$(WorkspaceValidate)"
      Push $R1
      !insertmacro workspaceFiles Install
      Pop $R1
      Banner::getWindow /NOUNLOAD
      Pop $R2
      GetDlgItem $R2 $R2 1030
      SendMessage $R2 ${WM_SETTEXT} 0 "STR:$(WorkspaceWait)"
      System::Call 'kernel32::CreateFileW(w "$EXEDIR\restart.ready", i 0x40000000, i 0, p 0, i 1, i 0x80, p 0)p.r0'
      ${If} $0 == -1
        SetErrorLevel 1
        Abort
      ${EndIf}
      System::Call 'kernel32::CloseHandle(p r0)'
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
      Banner::destroy
      ; Only the validated desktop handoff bypasses the directory and finish pages.
      ; All installs share the real NSIS file-progress page and its detail history.
      SetSilent normal
      SetAutoClose true
    ${Else}
      !insertmacro workspaceFiles Install
    ${EndIf}
  ${EndIf}
!macroend

!macro customPageAfterChangeDir
  !define MUI_PAGE_HEADER_TEXT "$(WorkspaceTitle)"
  !define MUI_PAGE_HEADER_SUBTEXT "$(WorkspaceSubtitle)"
  !define MUI_DIRECTORYPAGE_TEXT_TOP "$(WorkspaceBody)"
  !define MUI_PAGE_CUSTOMFUNCTION_PRE WorkspaceDirectoryPre
  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE WorkspaceSelected
  !insertmacro MUI_PAGE_DIRECTORY
  Function WorkspaceDirectoryPre
    ${If} $workspaceRestartDir != ""
      StrCpy $INSTDIR "$workspaceRestartDir"
      Abort
    ${EndIf}
  FunctionEnd
  Function WorkspaceSelected
    !insertmacro workspaceFiles Install
  FunctionEnd
!macroend

!macro customFinishPage
  Function WorkspaceStartApp
    ${If} ${isUpdated}
      StrCpy $1 "--updated"
    ${Else}
      StrCpy $1 ""
    ${EndIf}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd
  Function WorkspaceFinishPre
    ${If} $workspaceRestartDir != ""
      Abort
    ${EndIf}
  FunctionEnd
  !define MUI_PAGE_CUSTOMFUNCTION_PRE WorkspaceFinishPre
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION WorkspaceStartApp
  !insertmacro MUI_PAGE_FINISH
!macroend

!macro customFiles_x64
  DetailPrint "$(WorkspaceRegister)"
!macroend

!macro workspaceInstallerSize FILE OUT
  StrCpy ${OUT} ""
  ClearErrors
  FileOpen $R5 "${FILE}" r
  ${IfNot} ${Errors}
    ClearErrors
    FileSeek $R5 0 END ${OUT}
    ${If} ${Errors}
      StrCpy ${OUT} ""
    ${EndIf}
    FileClose $R5
  ${EndIf}
!macroend

!macro customInstall
  DetailPrint "$(WorkspaceGuide)"
  File /oname=$PLUGINSDIR\workspace-guide.md "${PROJECT_DIR}\installation\workspace-guide.md"
  ; Seed a local directory guide on fresh install. Runtime instructions come from app.asar.
  System::Call 'kernel32::CopyFileW(w "$PLUGINSDIR\workspace-guide.md", w "$INSTDIR\AGENTS.md", i 1)i.r0'
  ; Promote the verified desktop download in place. Manual setups still seed a base.
  DetailPrint "$(WorkspaceCache)"
  StrCpy $R8 "$INSTDIR\user-cache\updates\installer.exe"
  StrCpy $R9 "$EXEPATH"
  StrCpy $R7 "0"
  ${If} $workspaceRestartDir != ""
  ${AndIf} "$EXEPATH" == "$INSTDIR\user-cache\updates\pending.exe"
    System::Call 'kernel32::MoveFileExW(w "$EXEPATH", w "$R8", i 1)i.r0?e'
    Pop $1
    ${If} $0 != 0
      StrCpy $R9 $R8
    ${ElseIf} $1 == 32
      ; NSIS can hold the running setup open. The reopened app promotes it after exit.
      System::Call 'kernel32::CreateFileW(w "$INSTDIR\user-cache\updates\promote-installer-${VERSION}.ready", i 0x40000000, i 0, p 0, i 1, i 0x80, p 0)p.r0'
      ${If} $0 != -1
        System::Call 'kernel32::CloseHandle(p r0)'
        StrCpy $R7 "1"
      ${EndIf}
    ${EndIf}
  ${EndIf}
  ${If} $R9 != $R8
  ${AndIf} $R7 != "1"
    GetTempFileName $R3 "$INSTDIR\user-cache\updates"
    StrCpy $2 $R3
    System::Call 'kernel32::CopyFileW(w "$EXEPATH", w r2, i 0)i.r0'
    ${If} $0 != 0
      System::Call 'kernel32::MoveFileExW(w r2, w "$R8", i 9)i.r0'
    ${EndIf}
    Delete "$R3"
  ${EndIf}
  ; Drop only the upstream duplicate after comparing it with the running setup.
  DetailPrint "$(WorkspaceCleanup)"
  GetFullPathName $R4 "$LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}"
  ${If} ${FileExists} "$R4"
  ${AndIf} $R4 != $R9
  ${AndIf} $R4 != $R8
    !insertmacro workspaceInstallerSize "$R9" $R6
    !insertmacro workspaceInstallerSize "$R4" $R7
    ${If} $R6 != ""
    ${AndIf} $R6 == $R7
      ${StdUtils.HashFile} $R5 "SHA2-256" "$R9"
      ${StdUtils.HashFile} $R6 "SHA2-256" "$R4"
      StrLen $R7 $R5
      ${If} $R7 == 64
      ${AndIf} $R5 == $R6
        Delete "$R4"
        ${StdUtils.GetParentPath} $R7 "$R4"
        RMDir "$R7"
      ${EndIf}
    ${EndIf}
  ${EndIf}
  ${If} $workspaceRestartDir != ""
    System::Call 'kernel32::CreateFileW(w "$INSTDIR\user-cache\updates\announce-update-${VERSION}.ready", i 0x40000000, i 0, p 0, i 2, i 0x80, p 0)p.r0'
    ${If} $0 != -1
      System::Call 'kernel32::CloseHandle(p r0)'
    ${EndIf}
    DetailPrint "$(WorkspaceReopen)"
    Call WorkspaceStartApp
  ${EndIf}
!macroend

!macro customRemoveFiles
  SetOutPath $TEMP
  !insertmacro workspaceFiles Remove
  Delete "$INSTDIR\${UNINSTALL_FILENAME}"
!macroend
