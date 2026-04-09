package main

import (
	"context"
	"fmt"
	"kitty/backend/audio"
	"kitty/backend/downloader"
	"kitty/backend/library"
	"kitty/backend/media"
	"kitty/backend/metadata"
	"kitty/backend/soundcloud"
	"kitty/backend/storage"
	"log"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx        context.Context
	player     *audio.AudioPlayer
	library    *library.Manager
	downloader *downloader.Client
	media      *media.Service
	sc         *soundcloud.Service
}

type BulkMetadataPatch struct {
	ApplyAlbumArtist bool   `json:"applyAlbumArtist"`
	AlbumArtist      string `json:"albumArtist"`
	ApplyArtist      bool   `json:"applyArtist"`
	Artist           string `json:"artist"`
	ApplyAlbum       bool   `json:"applyAlbum"`
	Album            string `json:"album"`
	ApplyGenre       bool   `json:"applyGenre"`
	Genre            string `json:"genre"`
	ApplyYear        bool   `json:"applyYear"`
	Year             int    `json:"year"`
	ApplyCoverImage  bool   `json:"applyCoverImage"`
	CoverImage       string `json:"coverImage"`
	ApplyComment     bool   `json:"applyComment"`
	Comment          string `json:"comment"`
}

type BulkUpdateError struct {
	FilePath string `json:"filePath"`
	Error    string `json:"error"`
}

type BulkUpdateResult struct {
	Total     int                      `json:"total"`
	Succeeded int                      `json:"succeeded"`
	Failed    int                      `json:"failed"`
	Updated   []metadata.TrackMetadata `json:"updated"`
	Errors    []BulkUpdateError        `json:"errors"`
}

type ExtractAudioResult struct {
	SavedPath    string                  `json:"savedPath"`
	UpdatedTrack *metadata.TrackMetadata `json:"updatedTrack,omitempty"`
	Errors       []string                `json:"errors,omitempty"`
}

type TrimResult struct {
	UpdatedTrack *metadata.TrackMetadata `json:"updatedTrack,omitempty"`
	Backup       *media.TrimBackup       `json:"backup,omitempty"`
}

func NewApp() *App {
	root, _ := filepath.Abs(".")
	return &App{
		player:     audio.NewAudioPlayer(),
		library:    library.NewManager(),
		downloader: downloader.New(filepath.Join(root, "api")),
		media:      media.NewService(),
		sc:         soundcloud.New("http://127.0.0.1:17877/oauth/soundcloud/callback", "127.0.0.1:17877"),
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	if err := a.media.CleanupExpiredBackups(); err != nil {
		log.Printf("[app] trim backup cleanup failed: %v", err)
	}
	set, err := storage.LoadSettings()
	if err != nil {
		log.Printf("[app] load settings failed: %v", err)
		return
	}
	if !set.Downloader.AutoStart {
		return
	}
	go func() {
		if err := a.downloader.Start(ctx); err != nil {
			log.Printf("[app] downloader auto-start failed: %v", err)
		}
	}()
}

func (a *App) shutdown(ctx context.Context) {
	a.downloader.Stop()
}

func (a *App) SelectFiles() ([]string, error) {
	selection, err := runtime.OpenMultipleFilesDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select Music Files",
		Filters: []runtime.FileFilter{
			{DisplayName: "Music Files", Pattern: "*.mp3;*.flac;*.wav;*.ogg;*.m4a"},
		},
	})
	return selection, err
}

func (a *App) SaveLibrary(files []string) {
	storage.SaveLibrary(files)
}

func (a *App) LoadLibrary() []string {
	files, _ := storage.LoadLibrary()
	return files
}

func (a *App) LoadMetadata(path string) (*metadata.TrackMetadata, error) {
	return metadata.LoadMetadata(path)
}

func (a *App) SaveMetadata(md metadata.TrackMetadata) error {
	_, err := a.library.UpdateAndReload(md)
	return err
}

func (a *App) SaveMetadataAndRefresh(md metadata.TrackMetadata) (*metadata.TrackMetadata, error) {
	updated, err := a.library.UpdateAndReload(md)
	if err != nil {
		return nil, err
	}
	return &updated, nil
}

func (a *App) LoadAudio(path string) error {
	return a.player.Load(path)
}

func (a *App) PlayAudio() {
	a.player.Play()
}

func (a *App) PauseAudio() {
	a.player.Pause()
}

func (a *App) ToggleAudio() bool {
	return a.player.TogglePlay()
}

func (a *App) SetVolume(vol float64) {
	a.player.SetVolume(vol)
}

func (a *App) SeekAudio(percentage float64) {
	a.player.Seek(percentage)
}

func (a *App) GetAudioState() map[string]float64 {
	return map[string]float64{
		"duration": a.player.GetDuration(),
		"position": a.player.GetPosition(),
	}
}

func (a *App) LoadLibraryWithMetadata() (*library.BatchResult, error) {
	return a.library.LoadStoredLibrary()
}

func (a *App) AddFiles(paths []string) (*library.BatchResult, error) {
	return a.library.AddFiles(paths)
}

func (a *App) DownloaderStatus() downloader.Status {
	return a.downloader.Status()
}

func (a *App) StartDownloader() error {
	return a.downloader.Start(a.ctx)
}

func (a *App) StopDownloader() {
	a.downloader.Stop()
}

func (a *App) GetDownloaderAutoStart() (bool, error) {
	set, err := storage.LoadSettings()
	if err != nil {
		return false, err
	}
	return set.Downloader.AutoStart, nil
}

func (a *App) SetDownloaderAutoStart(enabled bool) error {
	set, err := storage.LoadSettings()
	if err != nil {
		return err
	}
	set.Downloader.AutoStart = enabled
	return storage.SaveSettings(set)
}

func (a *App) ResetAppData() error {
	a.downloader.Stop()
	a.player.Pause()

	if err := storage.ClearLibrary(); err != nil {
		return err
	}
	if err := storage.ClearSettings(); err != nil {
		return err
	}
	if err := metadata.ClearSidecarCache(); err != nil {
		return err
	}
	if err := a.media.ClearBackups(); err != nil {
		return err
	}

	a.library = library.NewManager()
	return nil
}

func (a *App) ChooseDownloadFolder() (string, error) {
	dir, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select download folder",
	})
	return dir, err
}

func (a *App) SelectVideoFile() (string, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select Video File",
		Filters: []runtime.FileFilter{
			{DisplayName: "Video Files", Pattern: "*.mp4;*.mkv;*.mov;*.webm;*.avi;*.m4v;*.flv"},
		},
	})
	return path, err
}

func (a *App) ExtractAudioFromVideo(videoPath string, targetDir string, format string) (*ExtractAudioResult, error) {
	videoPath = strings.TrimSpace(videoPath)
	if videoPath == "" {
		return nil, fmt.Errorf("video path is required")
	}
	targetDir = strings.TrimSpace(targetDir)
	if targetDir == "" {
		return nil, fmt.Errorf("target directory is required")
	}

	outPath, err := a.media.ExtractAudio(a.ctx, videoPath, targetDir, format)
	if err != nil {
		return nil, err
	}

	res, addErr := a.library.AddFiles([]string{outPath})
	if addErr != nil {
		return &ExtractAudioResult{
			SavedPath: outPath,
			Errors:    []string{addErr.Error()},
		}, nil
	}

	var updated *metadata.TrackMetadata
	for i := range res.Tracks {
		if res.Tracks[i].FilePath == outPath {
			cp := res.Tracks[i]
			updated = &cp
			break
		}
	}

	return &ExtractAudioResult{
		SavedPath:    outPath,
		UpdatedTrack: updated,
		Errors:       res.Errors,
	}, nil
}

func (a *App) DownloadMedia(link string, targetDir string, format string, bitrate string) (*downloader.DownloadResult, error) {
	if err := a.downloader.Start(a.ctx); err != nil {
		return nil, err
	}
	if format == "" {
		format = "mp3"
	}
	if bitrate == "" {
		bitrate = "320"
	}
	info, err := a.downloader.RequestDownload(a.ctx, link, format, bitrate)
	if err != nil {
		return nil, err
	}

	filename := info.Filename
	if filename == "" {
		filename = deriveFilename(link, info.MimeType, "mp3")
	} else {
		filename = ensureExtension(filename, info.MimeType, "mp3")
	}

	var savePath string
	if targetDir != "" {
		savePath = filepath.Join(targetDir, filename)
	} else {
		savePath, err = runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
			Title:           "Save downloaded audio",
			DefaultFilename: filename,
		})
		if err != nil {
			return nil, err
		}
		if savePath == "" {
			return nil, nil
		}
	}

	if _, err := a.downloader.Fetch(a.ctx, info.URL, savePath); err != nil {
		return nil, err
	}

	res, err := a.library.AddFiles([]string{savePath})
	if err != nil {
		return nil, err
	}

	merged := mergeAndPersistMetadata(savePath, info, res.Tracks, a.library, a.downloader)

	return &downloader.DownloadResult{
		SavedPath: savePath,
		Tracks:    merged,
		Errors:    res.Errors,
		Format:    info.RequestedFormat,
		Bitrate:   info.RequestedBitrate,
	}, nil
}

func (a *App) SoundCloudStatus() (soundcloud.AuthStatus, error) {
	return a.sc.Status()
}

func (a *App) SoundCloudSetCredentials(clientID string, clientSecret string) error {
	return a.sc.SetCredentials(clientID, clientSecret)
}

func (a *App) SoundCloudValidateCredentials() error {
	return a.sc.ValidateCredentials(a.ctx)
}

func (a *App) SoundCloudBeginAuth() (string, error) {
	authURL, err := a.sc.StartAuth(a.ctx)
	if err != nil {
		return "", err
	}
	runtime.BrowserOpenURL(a.ctx, authURL)
	return authURL, nil
}

func (a *App) SoundCloudLogout() error {
	return a.sc.Logout()
}

func (a *App) SoundCloudListLikes(nextHref string) (*soundcloud.LikesPage, error) {
	return a.sc.ListLikes(a.ctx, nextHref)
}

func (a *App) BulkUpdateMetadata(paths []string, patch BulkMetadataPatch) (*BulkUpdateResult, error) {
	unique := make([]string, 0, len(paths))
	seen := make(map[string]struct{}, len(paths))
	for _, p := range paths {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if _, ok := seen[p]; ok {
			continue
		}
		seen[p] = struct{}{}
		unique = append(unique, p)
	}

	result := &BulkUpdateResult{
		Total:   len(unique),
		Updated: make([]metadata.TrackMetadata, 0, len(unique)),
		Errors:  make([]BulkUpdateError, 0),
	}
	if len(unique) == 0 {
		return result, nil
	}

	for _, path := range unique {
		md, err := metadata.LoadMetadata(path)
		if err != nil {
			result.Errors = append(result.Errors, BulkUpdateError{
				FilePath: path,
				Error:    err.Error(),
			})
			continue
		}
		if md == nil {
			result.Errors = append(result.Errors, BulkUpdateError{
				FilePath: path,
				Error:    "metadata not available",
			})
			continue
		}

		build := *md
		if patch.ApplyAlbumArtist {
			build.AlbumArtist = patch.AlbumArtist
		}
		if patch.ApplyArtist {
			build.Artist = patch.Artist
		}
		if patch.ApplyAlbum {
			build.Album = patch.Album
		}
		if patch.ApplyGenre {
			build.Genre = patch.Genre
		}
		if patch.ApplyYear {
			build.Year = patch.Year
		}
		if patch.ApplyCoverImage {
			build.CoverImage = strings.TrimSpace(patch.CoverImage)
			build.HasCover = build.CoverImage != ""
		}
		if patch.ApplyComment {
			build.Comment = patch.Comment
		}

		updated, updateErr := a.library.UpdateAndReload(build)
		if updateErr != nil {
			result.Errors = append(result.Errors, BulkUpdateError{
				FilePath: path,
				Error:    updateErr.Error(),
			})
			continue
		}

		result.Updated = append(result.Updated, updated)
	}

	result.Succeeded = len(result.Updated)
	result.Failed = len(result.Errors)
	return result, nil
}

func applyMetaHints(lib *library.Manager, path string, hints map[string]interface{}) *metadata.TrackMetadata {
	build := metadata.TrackMetadata{FilePath: path, FileName: filepath.Base(path)}

	setString := func(key string, target *string) {
		if v, ok := hints[key]; ok {
			if s, ok2 := v.(string); ok2 && strings.TrimSpace(s) != "" {
				*target = s
			}
		}
	}
	setStringUnderscore := func(key string, target *string) {
		if v, ok := hints[key]; ok {
			if s, ok2 := v.(string); ok2 && strings.TrimSpace(s) != "" {
				*target = s
			}
		}
	}
	setInt := func(key string, target *int) {
		if v, ok := hints[key]; ok {
			switch t := v.(type) {
			case float64:
				*target = int(t)
			case int:
				*target = t
			}
		}
	}

	setString("title", &build.Title)
	setString("artist", &build.Artist)
	setString("album", &build.Album)
	setString("albumArtist", &build.AlbumArtist)
	setStringUnderscore("album_artist", &build.AlbumArtist)
	setString("genre", &build.Genre)
	setString("comment", &build.Comment)
	setString("composer", &build.Composer)
	setString("lyrics", &build.Lyrics)
	setInt("track", &build.TrackNumber)
	setInt("disc", &build.DiscNumber)
	setInt("year", &build.Year)
	if br, ok := hints["bitrate"]; ok {
		switch t := br.(type) {
		case float64:
			build.Bitrate = int(t)
		case int:
			build.Bitrate = t
		case string:
			if n, err := strconv.Atoi(strings.TrimSpace(t)); err == nil {
				build.Bitrate = n
			}
		}
	}
	if build.Title == "" && build.FileName != "" {
		build.Title = strings.TrimSuffix(build.FileName, filepath.Ext(build.FileName))
	}

	result := lib.ApplyMetadata(path, build)
	return &result
}

func deriveFilename(rawURL, mimeType, fallbackExt string) string {
	ext := fallbackExt
	if mimeType != "" {
		if e := extensionFromMime(mimeType); e != "" {
			ext = e
		}
	}
	if ext == "" {
		ext = "mp3"
	}

	if u, err := url.Parse(rawURL); err == nil {
		seg := filepath.Base(u.Path)
		seg = strings.TrimSpace(seg)
		if seg != "" && seg != "/" && seg != "." {
			seg = strings.TrimSuffix(seg, filepath.Ext(seg))
			return seg + "." + ext
		}
	}
	return "download." + ext
}

func ensureExtension(name, mimeType, fallbackExt string) string {
	ext := filepath.Ext(name)
	if ext == "" || len(ext) <= 1 {
		return deriveFilename(name, mimeType, fallbackExt)
	}
	return name
}

func extensionFromMime(mimeType string) string {
	switch strings.ToLower(mimeType) {
	case "audio/mpeg", "audio/mp3", "audio/mpg":
		return "mp3"
	case "audio/ogg":
		return "ogg"
	case "audio/wav", "audio/x-wav":
		return "wav"
	case "audio/opus":
		return "opus"
	case "audio/aac":
		return "aac"
	}
	return ""
}

func mergeAndPersistMetadata(
	path string,
	info *downloader.DownloadInfo,
	tracks []metadata.TrackMetadata,
	lib *library.Manager,
	dl *downloader.Client,
) []metadata.TrackMetadata {
	mergedList := tracks

	if md, err := metadata.LoadMetadata(path); err == nil && md != nil {
		updated := lib.ApplyMetadata(path, *md)
		for i := range mergedList {
			if mergedList[i].FilePath == path {
				mergedList[i] = updated
				break
			}
		}
	}

	if len(info.MetaHints) > 0 {
		if merged := applyMetaHints(lib, path, info.MetaHints); merged != nil {
			for i := range mergedList {
				if mergedList[i].FilePath == path {
					mergedList[i] = *merged
					break
				}
			}
		}
	}

	if info.CoverURL != "" {
		if dataURL, err := dl.FetchDataURL(context.Background(), info.CoverURL); err == nil && dataURL != "" {
			overlay := metadata.TrackMetadata{
				FilePath:   path,
				FileName:   filepath.Base(path),
				CoverImage: dataURL,
				HasCover:   true,
			}
			merged := lib.ApplyMetadata(path, overlay)
			metadata.SaveMetadata(merged)
			for i := range mergedList {
				if mergedList[i].FilePath == path {
					mergedList[i] = merged
					break
				}
			}
		}
	}

	if info != nil {
		br := parseBitrate(info.RequestedBitrate)
		if br > 0 {
			overlay := metadata.TrackMetadata{
				FilePath: path,
				FileName: filepath.Base(path),
				Bitrate:  br,
			}
			merged := lib.ApplyMetadata(path, overlay)
			for i := range mergedList {
				if mergedList[i].FilePath == path {
					mergedList[i] = merged
					break
				}
			}
		}
		if strings.TrimSpace(info.RequestedFormat) != "" {
			overlay := metadata.TrackMetadata{
				FilePath: path,
				FileName: filepath.Base(path),
				Format:   strings.ToUpper(info.RequestedFormat),
			}
			merged := lib.ApplyMetadata(path, overlay)
			for i := range mergedList {
				if mergedList[i].FilePath == path {
					mergedList[i] = merged
					break
				}
			}
		}
	}

	return mergedList
}

func parseBitrate(s string) int {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}
	if strings.HasSuffix(s, "kbps") {
		s = strings.TrimSuffix(s, "kbps")
	}
	if n, err := strconv.Atoi(strings.TrimSpace(s)); err == nil {
		return n
	}
	return 0
}

func (a *App) GetTrimWaveform(path string, points int) (*media.WaveformResult, error) {
	return a.media.GetWaveform(a.ctx, path, points)
}

func (a *App) TrimTrack(path string, startMs int64, endMs int64, mode string) (*TrimResult, error) {
	backup, err := a.media.TrimTrack(a.ctx, path, startMs, endMs, mode)
	if err != nil {
		return nil, err
	}

	var updated *metadata.TrackMetadata
	if md, loadErr := metadata.LoadMetadata(path); loadErr == nil && md != nil {
		synced := a.library.ApplyMetadata(path, *md)
		updated = &synced
	} else if loadErr != nil {
		log.Printf("[app] trim completed but metadata reload failed: %v", loadErr)
	}

	return &TrimResult{
		UpdatedTrack: updated,
		Backup:       backup,
	}, nil
}

func (a *App) ListTrimBackups(path string) ([]media.TrimBackup, error) {
	return a.media.ListBackups(path)
}

func (a *App) RestoreTrimBackup(backupID string) (*TrimResult, error) {
	backup, err := a.media.RestoreBackup(backupID)
	if err != nil {
		return nil, err
	}

	var updated *metadata.TrackMetadata
	if md, loadErr := metadata.LoadMetadata(backup.OriginalPath); loadErr == nil && md != nil {
		synced := a.library.ApplyMetadata(backup.OriginalPath, *md)
		updated = &synced
	} else if loadErr != nil {
		log.Printf("[app] restore completed but metadata reload failed: %v", loadErr)
	}

	return &TrimResult{
		UpdatedTrack: updated,
		Backup:       backup,
	}, nil
}

func (a *App) DeleteTrimBackup(backupID string) error {
	return a.media.DeleteBackup(backupID)
}
