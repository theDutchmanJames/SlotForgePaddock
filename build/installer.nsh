; Paddock's application folder is disposable; its collection/profile folders are not.
; Keep the app ID stable so later installers replace this installation in place.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customInit
  ${If} ${isForAllUsers}
    MessageBox MB_OK|MB_ICONSTOP "Install Paddock for the current Windows user. Collections and preferences belong to that user's account." /SD IDOK
    SetErrorLevel 1639
    Quit
  ${EndIf}
!macroend

!macro customUnInit
  ClearErrors
  ${GetParameters} $R0
  ${GetOptions} $R0 "--delete-app-data" $R1
  ${IfNot} ${Errors}
    MessageBox MB_OK|MB_ICONSTOP "This uninstaller keeps Paddock's collections and settings. The delete-app-data option is not supported." /SD IDOK
    SetErrorLevel 1639
    Quit
  ${EndIf}
!macroend

!macro PaddockCheckDirectory
  ; Do not follow a redirected application folder when replacing/removing files.
  System::Call 'kernel32::GetFileAttributesW(w "$INSTDIR") i.r0'
  ${If} $0 != -1
    IntOp $0 $0 & 0x400
    ${If} $0 != 0
      Goto paddock_unsafe_directory
    ${EndIf}
  ${EndIf}
  ; Data never belongs in the application directory. Refuse to remove it if
  ; someone has manually put a database there, even in a marked installation.
  IfFileExists "$INSTDIR\*.sqlite" paddock_unsafe_directory
  IfFileExists "$INSTDIR\database.json" paddock_unsafe_directory
  IfFileExists "$INSTDIR\library.json" paddock_unsafe_directory
  ReadINIStr $R0 "$INSTDIR\paddock-install.ini" "Installation" "AppId"
  ${If} $R0 == "${APP_ID}"
    Goto paddock_directory_ok
  ${EndIf}
  !ifdef BUILD_UNINSTALLER
    Goto paddock_unsafe_directory
  !else
    ; A fresh installation may use an empty folder, never unrelated contents.
    FindFirst $R1 $R2 "$INSTDIR\*"
    paddock_directory_next:
      ${If} $R2 == ""
        FindClose $R1
        Goto paddock_directory_ok
      ${EndIf}
      ${If} $R2 != "."
      ${AndIf} $R2 != ".."
        FindClose $R1
        Goto paddock_unsafe_directory
      ${EndIf}
      FindNext $R1 $R2
      Goto paddock_directory_next
  !endif
  paddock_unsafe_directory:
    MessageBox MB_OK|MB_ICONSTOP "Choose an empty folder or an existing Paddock installation. This folder contains other files, collection data, or is redirected. Nothing has been removed." /SD IDOK
    SetErrorLevel 1603
    Quit
  paddock_directory_ok:
!macroend

!macro customCheckAppRunning
  !insertmacro PaddockCheckDirectory
  paddock_wait_for_exit:
    nsProcess::_FindProcess /NOUNLOAD "${APP_EXECUTABLE_FILENAME}"
    Pop $R0
    nsProcess::_Unload
    ${If} $R0 == 603
      Goto paddock_app_closed
    ${EndIf}
    ${If} $R0 != 0
      MessageBox MB_OK|MB_ICONSTOP "Paddock's running state could not be checked. Close Paddock completely and try again." /SD IDOK
      SetErrorLevel 1603
      Quit
    ${EndIf}
    ${If} ${Silent}
      SetErrorLevel 1618
      Quit
    ${EndIf}
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Please quit Paddock before continuing. If it is running in the background, right-click its tray icon and choose Quit Paddock completely. Wait for saving to finish, then click Retry." IDRETRY paddock_wait_for_exit
    SetErrorLevel 1602
    Quit
  paddock_app_closed:
!macroend

!macro customInstall
  WriteINIStr "$INSTDIR\paddock-install.ini" "Installation" "AppId" "${APP_ID}"
  WriteINIStr "$INSTDIR\paddock-install.ini" "Installation" "Version" "${VERSION}"
!macroend
