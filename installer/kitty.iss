#define AppVersion "1.0.0"
#ifdef AppVersionOverride
#undef AppVersion
#define AppVersion AppVersionOverride
#endif

[Setup]
AppId={{9C5C6E0B-2A0E-4D71-B36A-9B0DE73920D7}}
AppName=Kitty
AppVersion={#AppVersion}
AppPublisher=Kitty Maintainers
AppPublisherURL=https://github.com/hld19/kitty
AppSupportURL=https://github.com/hld19/kitty/issues
AppUpdatesURL=https://github.com/hld19/kitty/releases
DefaultDirName={autopf}\Kitty
DefaultGroupName=Kitty
DisableDirPage=no
DisableProgramGroupPage=yes
OutputBaseFilename=Kitty-Installer
OutputDir=..\build\bin
SetupIconFile=..\build\icons\icon.ico
Compression=lzma
SolidCompression=yes
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
PrivilegesRequired=admin
UninstallDisplayIcon={app}\Kitty.exe
VersionInfoVersion={#AppVersion}.0
VersionInfoCompany=Kitty Maintainers
VersionInfoDescription=Kitty Installer
VersionInfoProductName=Kitty
WizardStyle=modern
WizardSizePercent=110
WizardResizable=yes

[Files]
Source: "..\build\bin\Kitty.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\build\bin\resources\*"; DestDir: "{app}\resources"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
; Use the EXE's embedded icon for shortcuts. Referencing a repo-relative .ico path
; results in broken icons after install.
Name: "{autoprograms}\Kitty"; Filename: "{app}\Kitty.exe"
Name: "{autodesktop}\Kitty"; Filename: "{app}\Kitty.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional icons:"

[Run]
Filename: "{app}\Kitty.exe"; Description: "Launch Kitty"; Flags: nowait postinstall skipifsilent
