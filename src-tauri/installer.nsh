; terminice — NSIS installer hooks.
;
; Two jobs with nothing to do with each other: unticking the finish page's
; optional checkboxes, at the bottom of this file, and putting the install
; directory on PATH so `terminice` works from any terminal — taken off again on
; uninstall.
;
; PATH is edited through PowerShell rather than in NSIS itself because NSIS caps
; a variable at 1024 characters by default and PATH is routinely longer than
; that. Reading it into a variable and writing it back would silently truncate
; everything past the limit, and the user would not find out until a tool
; stopped being on PATH — which is not a failure an installer is allowed to
; cause.
;
; The script below only ever adds or removes its own entry. It leaves every
; other entry alone, deduplicates nothing else, and preserves REG_EXPAND_SZ so
; entries like %SystemRoot% keep expanding.

; Which registry hive PATH lives in, decided from the configured install mode.
;
; This has to run inside the hook macros rather than at the top of this file.
; Tauri includes this file near the top of the generated script but only defines
; INSTALLMODE further down, so an `!if` here would compare against an undefined
; name, quietly take the else branch, and write a machine-wide install into the
; current user's PATH. Macro bodies are expanded where they are inserted, which
; is well after that define, so the comparison is only meaningful in here.
!macro TERMINICE_DECIDE_PATH_SCOPE
  !if "${INSTALLMODE}" == "perMachine"
    !define /redef TERMINICE_PATH_SCOPE "Machine"
  !else if "${INSTALLMODE}" == "currentUser"
    !define /redef TERMINICE_PATH_SCOPE "User"
  !else
    !error "installer.nsh: installMode '${INSTALLMODE}' is not handled by the PATH hook. Use perMachine or currentUser, or branch on the runtime MultiUser.InstallMode variable instead."
  !endif
!macroend

!macro TERMINICE_WRITE_PATH_SCRIPT
  FileOpen $9 "$PLUGINSDIR\terminice-path.ps1" w
  FileWrite $9 "param([string]$$Dir,[string]$$Scope,[switch]$$Remove)$\r$\n"
  FileWrite $9 "$$ErrorActionPreference='Stop'$\r$\n"
  FileWrite $9 "if($$Scope -eq 'Machine'){$\r$\n"
  FileWrite $9 "$$key=[Microsoft.Win32.Registry]::LocalMachine.OpenSubKey('SYSTEM\CurrentControlSet\Control\Session Manager\Environment',$$true)$\r$\n"
  FileWrite $9 "}else{$\r$\n"
  FileWrite $9 "$$key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment',$$true)$\r$\n"
  FileWrite $9 "}$\r$\n"
  FileWrite $9 "if($$null -eq $$key){exit 0}$\r$\n"
  FileWrite $9 "$$raw=[string]$$key.GetValue('Path','',[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)$\r$\n"
  FileWrite $9 "$$parts=@($$raw -split ';'|Where-Object{$$_ -ne ''})$\r$\n"
  FileWrite $9 "if($$Remove){$\r$\n"
  FileWrite $9 "$$next=@($$parts|Where-Object{$$_ -ne $$Dir})$\r$\n"
  FileWrite $9 "}else{$\r$\n"
  FileWrite $9 "if($$parts -contains $$Dir){$$key.Close();exit 0}$\r$\n"
  FileWrite $9 "$$next=@($$parts+$$Dir)$\r$\n"
  FileWrite $9 "}$\r$\n"
  FileWrite $9 "$$key.SetValue('Path',($$next -join ';'),[Microsoft.Win32.RegistryValueKind]::ExpandString)$\r$\n"
  FileWrite $9 "$$key.Close()$\r$\n"
  FileWrite $9 "exit 0$\r$\n"
  FileClose $9
!macroend

; 0xFFFF is HWND_BROADCAST and 0x001A is WM_SETTINGCHANGE, written as literals
; so this file does not depend on WinMessages.nsh having been included before
; it. Without the broadcast, Explorer keeps serving the old environment and a
; terminal opened from the Start Menu would not see the change until the next
; sign-in.
!macro TERMINICE_EDIT_PATH removeFlag
  !insertmacro TERMINICE_DECIDE_PATH_SCOPE
  InitPluginsDir
  !insertmacro TERMINICE_WRITE_PATH_SCRIPT
  nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\terminice-path.ps1" -Dir "$INSTDIR" -Scope ${TERMINICE_PATH_SCOPE} ${removeFlag}'
  Pop $0
  SendMessage 0xFFFF 0x001A 0 "STR:Environment" /TIMEOUT=5000
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro TERMINICE_EDIT_PATH ""
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro TERMINICE_EDIT_PATH "-Remove"
!macroend

; Finish page defaults.
;
; Tauri renders "Create a desktop shortcut" and "Run terminice" as the finish
; page's two checkboxes, and defines neither NOTCHECKED flag, so both arrive
; ticked — the installer making two choices on the user's behalf that it was
; never asked to make.
;
; MUI reads these flags while expanding MUI_PAGE_FINISH, which Tauri emits well
; below the point it includes this file, so a !define here reaches them in
; time. Both names are MUI's, not Tauri's, and there is no tauri.conf.json
; setting for either.
;
; The Start Menu shortcut is not one of these two. Tauri creates it
; unconditionally, and offers no checkbox to untick.
!define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
!define MUI_FINISHPAGE_RUN_NOTCHECKED
