!include LogicLib.nsh

!macro customUnInstall
    MessageBox MB_YESNO|MB_ICONQUESTION "Do you want to delete local files created by Blueberry Music Player?" /SD IDNO IDYES deleteFiles
    Goto done

deleteFiles:
    RMDir /r "$LOCALAPPDATA\Blueberry Music Player"
    RMDir /r "$APPDATA\Blueberry Music Player"

done:
!macroend
