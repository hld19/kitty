package media

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	defaultWaveformPoints = 320
	maxWaveformPoints     = 2048
	backupRetention       = 30 * 24 * time.Hour
)

const (
	TrimModeCopy     = "copy"
	TrimModeAccurate = "accurate"
)

type Service struct {
	mu sync.Mutex

	backupDir string
	metaPath  string

	ffmpegPath  string
	ffprobePath string
}

type WaveformResult struct {
	DurationMs int64     `json:"durationMs"`
	Peaks      []float64 `json:"peaks"`
}

type TrimBackup struct {
	ID           string `json:"id"`
	OriginalPath string `json:"originalPath"`
	BackupPath   string `json:"backupPath"`
	CreatedAt    int64  `json:"createdAt"`
	ExpiresAt    int64  `json:"expiresAt"`
	Mode         string `json:"mode"`
	StartMs      int64  `json:"startMs"`
	EndMs        int64  `json:"endMs"`
}

type ffprobeOutput struct {
	Streams []struct {
		CodecName string `json:"codec_name"`
	} `json:"streams"`
	Format struct {
		Duration string `json:"duration"`
	} `json:"format"`
}

func NewService() *Service {
	cacheDir, err := os.UserCacheDir()
	if err != nil || strings.TrimSpace(cacheDir) == "" {
		cacheDir = os.TempDir()
	}
	backupDir := filepath.Join(cacheDir, "Kitty", "trim_backups")
	return &Service{
		backupDir: backupDir,
		metaPath:  filepath.Join(backupDir, "backups.json"),
	}
}

func (s *Service) ExtractAudio(ctx context.Context, videoPath, outputDir, outputFormat string) (string, error) {
	videoPath = strings.TrimSpace(videoPath)
	if videoPath == "" {
		return "", errors.New("video path is empty")
	}
	if _, err := os.Stat(videoPath); err != nil {
		return "", err
	}
	outputDir = strings.TrimSpace(outputDir)
	if outputDir == "" {
		return "", errors.New("output directory is empty")
	}
	if info, err := os.Stat(outputDir); err == nil {
		if !info.IsDir() {
			return "", fmt.Errorf("output path is not a directory: %s", outputDir)
		}
	} else if os.IsNotExist(err) {
		if mkErr := os.MkdirAll(outputDir, 0o755); mkErr != nil {
			return "", mkErr
		}
	} else {
		return "", err
	}

	format, err := normalizeExtractFormat(outputFormat)
	if err != nil {
		return "", err
	}

	ffmpegPath, ffprobePath, err := s.resolveBinaries()
	if err != nil {
		return "", err
	}

	probe, err := runFFprobe(ctx, ffprobePath, videoPath)
	if err != nil {
		return "", err
	}
	if len(probe.Streams) == 0 || strings.TrimSpace(probe.Streams[0].CodecName) == "" {
		return "", errors.New("no audio stream found in selected video")
	}
	codec := strings.ToLower(strings.TrimSpace(probe.Streams[0].CodecName))
	outPath, err := uniquePathInDir(outputDir, videoPath, "_audio", "."+format)
	if err != nil {
		return "", err
	}

	copyMode := shouldCopyForFormat(codec, format)
	args := buildExtractAudioArgs(videoPath, outPath, format, copyMode)
	if _, err := runCommand(ctx, ffmpegPath, args...); err != nil {
		if !copyMode {
			return "", err
		}
		fallback := buildExtractAudioArgs(videoPath, outPath, format, false)
		if _, fallbackErr := runCommand(ctx, ffmpegPath, fallback...); fallbackErr != nil {
			return "", fmt.Errorf("audio extraction failed (copy mode: %v; fallback: %w)", err, fallbackErr)
		}
	}

	if _, err := os.Stat(outPath); err != nil {
		return "", fmt.Errorf("extracted file missing: %w", err)
	}

	return outPath, nil
}

func (s *Service) GetWaveform(ctx context.Context, path string, points int) (*WaveformResult, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return nil, errors.New("track path is empty")
	}

	_, ffprobePath, err := s.resolveBinaries()
	if err != nil {
		return nil, err
	}
	probe, err := runFFprobe(ctx, ffprobePath, path)
	if err != nil {
		return nil, err
	}

	durationMs := parseDurationMs(probe.Format.Duration)
	if points <= 0 {
		points = defaultWaveformPoints
	}
	if points > maxWaveformPoints {
		points = maxWaveformPoints
	}

	ffmpegPath, _, err := s.resolveBinaries()
	if err != nil {
		return nil, err
	}

	raw, err := extractPCMMono(ctx, ffmpegPath, path)
	if err != nil {
		return nil, err
	}

	peaks := buildPeaks(raw, points)
	return &WaveformResult{DurationMs: durationMs, Peaks: peaks}, nil
}

func (s *Service) TrimTrack(ctx context.Context, path string, startMs, endMs int64, mode string) (*TrimBackup, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return nil, errors.New("track path is empty")
	}
	if _, err := os.Stat(path); err != nil {
		return nil, err
	}

	mode = strings.ToLower(strings.TrimSpace(mode))
	if mode == "" {
		mode = TrimModeCopy
	}
	if mode != TrimModeCopy && mode != TrimModeAccurate {
		return nil, errors.New("unsupported trim mode")
	}

	ffmpegPath, ffprobePath, err := s.resolveBinaries()
	if err != nil {
		return nil, err
	}
	probe, err := runFFprobe(ctx, ffprobePath, path)
	if err != nil {
		return nil, err
	}
	durationMs := parseDurationMs(probe.Format.Duration)
	if durationMs > 0 && endMs > durationMs {
		endMs = durationMs
	}
	if startMs < 0 {
		startMs = 0
	}
	if endMs <= startMs {
		return nil, errors.New("end time must be greater than start time")
	}

	tmpPath := filepath.Join(filepath.Dir(path), fmt.Sprintf(".kitty_trim_%d%s", time.Now().UnixNano(), strings.ToLower(filepath.Ext(path))))
	defer func() {
		_ = os.Remove(tmpPath)
	}()

	start := fmt.Sprintf("%.3f", float64(startMs)/1000.0)
	end := fmt.Sprintf("%.3f", float64(endMs)/1000.0)

	var args []string
	if mode == TrimModeCopy {
		args = []string{
			"-y", "-v", "error",
			"-ss", start,
			"-to", end,
			"-i", path,
			"-map", "0",
			"-map_metadata", "0",
			"-c", "copy",
			"-avoid_negative_ts", "make_zero",
			tmpPath,
		}
	} else {
		codec, extra, codecErr := accurateCodecArgs(path)
		if codecErr != nil {
			return nil, codecErr
		}
		args = []string{
			"-y", "-v", "error",
			"-i", path,
			"-ss", start,
			"-to", end,
			"-map", "0:a:0",
			"-map_metadata", "0",
			"-c:a", codec,
		}
		args = append(args, extra...)
		args = append(args, tmpPath)
	}

	if _, err := runCommand(ctx, ffmpegPath, args...); err != nil {
		return nil, err
	}

	if err := replaceFile(path, tmpPath); err != nil {
		return nil, err
	}

	return nil, nil
}

func (s *Service) ListBackups(path string) ([]TrimBackup, error) {
	path = strings.TrimSpace(path)

	s.mu.Lock()
	defer s.mu.Unlock()

	if err := s.ensureStorageLocked(); err != nil {
		return nil, err
	}
	backups, err := s.loadBackupsLocked()
	if err != nil {
		return nil, err
	}
	backups, changed := s.compactBackupsLocked(backups, time.Now())
	if changed {
		if err := s.saveBackupsLocked(backups); err != nil {
			return nil, err
		}
	}

	if path == "" {
		return backups, nil
	}

	out := make([]TrimBackup, 0)
	for _, b := range backups {
		if samePath(b.OriginalPath, path) {
			out = append(out, b)
		}
	}
	return out, nil
}

func (s *Service) RestoreBackup(backupID string) (*TrimBackup, error) {
	backupID = strings.TrimSpace(backupID)
	if backupID == "" {
		return nil, errors.New("backup id is empty")
	}

	s.mu.Lock()
	if err := s.ensureStorageLocked(); err != nil {
		s.mu.Unlock()
		return nil, err
	}
	backups, err := s.loadBackupsLocked()
	if err != nil {
		s.mu.Unlock()
		return nil, err
	}
	backups, changed := s.compactBackupsLocked(backups, time.Now())
	if changed {
		if err := s.saveBackupsLocked(backups); err != nil {
			s.mu.Unlock()
			return nil, err
		}
	}

	idx := -1
	for i := range backups {
		if backups[i].ID == backupID {
			idx = i
			break
		}
	}
	if idx < 0 {
		s.mu.Unlock()
		return nil, errors.New("backup not found")
	}
	backup := backups[idx]
	s.mu.Unlock()

	if _, err := os.Stat(backup.BackupPath); err != nil {
		return nil, fmt.Errorf("backup file missing: %w", err)
	}
	if err := copyFile(backup.BackupPath, backup.OriginalPath); err != nil {
		return nil, err
	}

	return &backup, nil
}

func (s *Service) DeleteBackup(backupID string) error {
	backupID = strings.TrimSpace(backupID)
	if backupID == "" {
		return errors.New("backup id is empty")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if err := s.ensureStorageLocked(); err != nil {
		return err
	}
	backups, err := s.loadBackupsLocked()
	if err != nil {
		return err
	}

	out := make([]TrimBackup, 0, len(backups))
	var target *TrimBackup
	for _, b := range backups {
		if b.ID == backupID {
			copyB := b
			target = &copyB
			continue
		}
		out = append(out, b)
	}
	if target == nil {
		return errors.New("backup not found")
	}

	if err := s.saveBackupsLocked(out); err != nil {
		return err
	}
	if err := os.Remove(target.BackupPath); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func (s *Service) CleanupExpiredBackups() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if err := s.ensureStorageLocked(); err != nil {
		return err
	}
	backups, err := s.loadBackupsLocked()
	if err != nil {
		return err
	}
	backups, changed := s.compactBackupsLocked(backups, time.Now())
	if !changed {
		return nil
	}
	return s.saveBackupsLocked(backups)
}

func (s *Service) ClearBackups() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.RemoveAll(s.backupDir); err != nil {
		return err
	}
	return nil
}

func (s *Service) createBackup(path, mode string, startMs, endMs int64) (*TrimBackup, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if err := s.ensureStorageLocked(); err != nil {
		return nil, err
	}

	backups, err := s.loadBackupsLocked()
	if err != nil {
		return nil, err
	}
	backups, changed := s.compactBackupsLocked(backups, time.Now())
	if changed {
		if err := s.saveBackupsLocked(backups); err != nil {
			return nil, err
		}
	}

	id, err := randomID(8)
	if err != nil {
		return nil, err
	}
	ext := strings.ToLower(filepath.Ext(path))
	if ext == "" {
		ext = ".audio"
	}
	backupPath := filepath.Join(s.backupDir, id+ext)
	if err := copyFile(path, backupPath); err != nil {
		return nil, err
	}

	now := time.Now()
	backup := TrimBackup{
		ID:           id,
		OriginalPath: path,
		BackupPath:   backupPath,
		CreatedAt:    now.Unix(),
		ExpiresAt:    now.Add(backupRetention).Unix(),
		Mode:         mode,
		StartMs:      startMs,
		EndMs:        endMs,
	}
	backups = append(backups, backup)
	if err := s.saveBackupsLocked(backups); err != nil {
		_ = os.Remove(backupPath)
		return nil, err
	}
	return &backup, nil
}

func (s *Service) ensureStorageLocked() error {
	if err := os.MkdirAll(s.backupDir, 0o700); err != nil {
		return err
	}
	if _, err := os.Stat(s.metaPath); os.IsNotExist(err) {
		if err := os.WriteFile(s.metaPath, []byte("[]"), 0o600); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) loadBackupsLocked() ([]TrimBackup, error) {
	data, err := os.ReadFile(s.metaPath)
	if err != nil {
		if os.IsNotExist(err) {
			return []TrimBackup{}, nil
		}
		return nil, err
	}
	if strings.TrimSpace(string(data)) == "" {
		return []TrimBackup{}, nil
	}
	var backups []TrimBackup
	if err := json.Unmarshal(data, &backups); err != nil {
		return nil, err
	}
	sort.Slice(backups, func(i, j int) bool {
		return backups[i].CreatedAt > backups[j].CreatedAt
	})
	return backups, nil
}

func (s *Service) saveBackupsLocked(backups []TrimBackup) error {
	data, err := json.Marshal(backups)
	if err != nil {
		return err
	}
	return os.WriteFile(s.metaPath, data, 0o600)
}

func (s *Service) compactBackupsLocked(backups []TrimBackup, now time.Time) ([]TrimBackup, bool) {
	changed := false
	active := make([]TrimBackup, 0, len(backups))
	for _, b := range backups {
		if b.ExpiresAt > 0 && now.Unix() >= b.ExpiresAt {
			_ = os.Remove(b.BackupPath)
			changed = true
			continue
		}
		if _, err := os.Stat(b.BackupPath); err != nil {
			changed = true
			continue
		}
		active = append(active, b)
	}
	sort.Slice(active, func(i, j int) bool {
		return active[i].CreatedAt > active[j].CreatedAt
	})
	return active, changed
}

func (s *Service) resolveBinaries() (ffmpegPath string, ffprobePath string, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if strings.TrimSpace(s.ffmpegPath) != "" && strings.TrimSpace(s.ffprobePath) != "" {
		return s.ffmpegPath, s.ffprobePath, nil
	}

	ffmpegPath, err = resolveBinary("KITTY_FFMPEG_PATH", "ffmpeg")
	if err != nil {
		return "", "", err
	}
	ffprobePath, err = resolveBinary("KITTY_FFPROBE_PATH", "ffprobe")
	if err != nil {
		return "", "", err
	}

	s.ffmpegPath = ffmpegPath
	s.ffprobePath = ffprobePath
	return ffmpegPath, ffprobePath, nil
}

func resolveBinary(envKey, fallback string) (string, error) {
	if override := strings.TrimSpace(os.Getenv(envKey)); override != "" {
		if isFile(override) {
			return override, nil
		}
		return "", fmt.Errorf("%s is set but not executable: %s", envKey, override)
	}

	if path, err := exec.LookPath(fallback); err == nil {
		return path, nil
	}

	for _, cand := range binaryCandidates(fallback) {
		if isFile(cand) {
			return cand, nil
		}
	}

	return "", fmt.Errorf(
		"%s not found in PATH; set %s to an absolute binary path (e.g. /opt/homebrew/bin/%s)",
		fallback,
		envKey,
		fallback,
	)
}

func binaryCandidates(binary string) []string {
	binary = strings.TrimSpace(binary)
	if binary == "" {
		return nil
	}

	paths := make([]string, 0, 32)
	appendCandidate := func(p string) {
		p = strings.TrimSpace(p)
		if p == "" {
			return
		}
		paths = append(paths, filepath.Clean(p))
	}

	if exePath, err := os.Executable(); err == nil && exePath != "" {
		exeDir := filepath.Dir(exePath)
		appendCandidate(filepath.Join(exeDir, binary))
		appendCandidate(filepath.Join(exeDir, "bin", binary))
		appendCandidate(filepath.Join(exeDir, "resources", "bin", binary))
		appendCandidate(filepath.Join(exeDir, "resources", "app", "bin", binary))
		appendCandidate(filepath.Join(exeDir, "..", "Resources", "bin", binary))
		appendCandidate(filepath.Join(exeDir, "..", "Resources", "app", "bin", binary))
	}

	for _, dir := range commonBinaryDirs() {
		appendCandidate(filepath.Join(dir, binary))
	}

	if runtime.GOOS == "windows" {
		withExt := make([]string, 0, len(paths)*4)
		for _, p := range paths {
			withExt = append(withExt, p)
			if strings.HasSuffix(strings.ToLower(p), ".exe") {
				continue
			}
			withExt = append(withExt, p+".exe", p+".cmd", p+".bat")
		}
		paths = withExt
	}

	seen := make(map[string]struct{}, len(paths))
	out := make([]string, 0, len(paths))
	for _, p := range paths {
		if p == "" {
			continue
		}
		if _, ok := seen[p]; ok {
			continue
		}
		seen[p] = struct{}{}
		out = append(out, p)
	}
	return out
}

func commonBinaryDirs() []string {
	dirs := []string{}

	switch runtime.GOOS {
	case "windows":
		if v := strings.TrimSpace(os.Getenv("ProgramFiles")); v != "" {
			dirs = append(dirs, filepath.Join(v, "ffmpeg", "bin"), filepath.Join(v, "nodejs"))
		}
		if v := strings.TrimSpace(os.Getenv("ProgramFiles(x86)")); v != "" {
			dirs = append(dirs, filepath.Join(v, "ffmpeg", "bin"), filepath.Join(v, "nodejs"))
		}
		if v := strings.TrimSpace(os.Getenv("ProgramData")); v != "" {
			dirs = append(dirs, filepath.Join(v, "chocolatey", "bin"))
		}
		if v := strings.TrimSpace(os.Getenv("LocalAppData")); v != "" {
			dirs = append(dirs,
				filepath.Join(v, "Programs", "ffmpeg", "bin"),
				filepath.Join(v, "Programs", "nodejs"),
				filepath.Join(v, "Microsoft", "WindowsApps"),
				filepath.Join(v, "Microsoft", "WinGet", "Links"),
			)
		}
		if home, err := os.UserHomeDir(); err == nil && strings.TrimSpace(home) != "" {
			dirs = append(dirs,
				filepath.Join(home, "scoop", "shims"),
				filepath.Join(home, "AppData", "Local", "Programs", "ffmpeg", "bin"),
				filepath.Join(home, "AppData", "Local", "Programs", "nodejs"),
				filepath.Join(home, "ffmpeg", "bin"),
			)
		}
		dirs = append(dirs, `C:\ffmpeg\bin`, `C:\tools\ffmpeg\bin`, `C:\ProgramData\chocolatey\bin`)
	default:
		dirs = append(dirs, "/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin", "/usr/bin", "/bin")
	}

	if home, err := os.UserHomeDir(); err == nil && strings.TrimSpace(home) != "" {
		dirs = append(dirs,
			filepath.Join(home, ".local", "bin"),
			filepath.Join(home, ".asdf", "shims"),
			filepath.Join(home, ".nix-profile", "bin"),
		)
	}
	dirs = append(dirs, strings.Split(os.Getenv("PATH"), string(os.PathListSeparator))...)

	seen := make(map[string]struct{}, len(dirs))
	out := make([]string, 0, len(dirs))
	for _, d := range dirs {
		d = strings.TrimSpace(d)
		if d == "" {
			continue
		}
		d = filepath.Clean(d)
		if _, ok := seen[d]; ok {
			continue
		}
		seen[d] = struct{}{}
		out = append(out, d)
	}
	return out
}

func runFFprobe(ctx context.Context, ffprobePath, path string) (*ffprobeOutput, error) {
	args := []string{
		"-v", "error",
		"-select_streams", "a:0",
		"-show_entries", "stream=codec_name:format=duration",
		"-of", "json",
		path,
	}
	out, err := runCommand(ctx, ffprobePath, args...)
	if err != nil {
		return nil, err
	}
	var parsed ffprobeOutput
	if err := json.Unmarshal(out, &parsed); err != nil {
		return nil, err
	}
	return &parsed, nil
}

func runCommand(ctx context.Context, cmd string, args ...string) ([]byte, error) {
	c := exec.CommandContext(ctx, cmd, args...)
	out, err := c.CombinedOutput()
	if err != nil {
		msg := strings.TrimSpace(string(out))
		if msg == "" {
			return nil, fmt.Errorf("%s failed: %w", cmd, err)
		}
		return nil, fmt.Errorf("%s failed: %w: %s", cmd, err, msg)
	}
	return out, nil
}

func extractPCMMono(ctx context.Context, ffmpegPath, path string) ([]byte, error) {
	args := []string{
		"-v", "error",
		"-i", path,
		"-map", "0:a:0",
		"-ac", "1",
		"-ar", "8000",
		"-f", "s16le",
		"-",
	}

	cmd := exec.CommandContext(ctx, ffmpegPath, args...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	if err := cmd.Start(); err != nil {
		return nil, err
	}
	raw, readErr := io.ReadAll(stdout)
	waitErr := cmd.Wait()
	if readErr != nil {
		return nil, readErr
	}
	if waitErr != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			return nil, fmt.Errorf("ffmpeg waveform extraction failed: %w", waitErr)
		}
		return nil, fmt.Errorf("ffmpeg waveform extraction failed: %w: %s", waitErr, msg)
	}
	return raw, nil
}

func buildPeaks(raw []byte, points int) []float64 {
	if points <= 0 {
		points = defaultWaveformPoints
	}
	peaks := make([]float64, points)
	sampleCount := len(raw) / 2
	if sampleCount <= 0 {
		return peaks
	}

	for i := 0; i < sampleCount; i++ {
		off := i * 2
		s := int16(binary.LittleEndian.Uint16(raw[off : off+2]))
		amp := math.Abs(float64(s)) / 32768.0
		bin := i * points / sampleCount
		if bin >= points {
			bin = points - 1
		}
		if amp > peaks[bin] {
			peaks[bin] = amp
		}
	}
	return peaks
}

func parseDurationMs(v string) int64 {
	f, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
	if err != nil || f <= 0 {
		return 0
	}
	return int64(f * 1000)
}

func accurateCodecArgs(path string) (string, []string, error) {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".mp3":
		return "libmp3lame", []string{"-q:a", "2"}, nil
	case ".m4a", ".aac", ".mp4":
		return "aac", []string{"-b:a", "320k"}, nil
	case ".flac":
		return "flac", nil, nil
	case ".ogg":
		return "libvorbis", []string{"-q:a", "8"}, nil
	case ".opus":
		return "libopus", []string{"-b:a", "192k"}, nil
	case ".wav":
		return "pcm_s16le", nil, nil
	default:
		return "", nil, fmt.Errorf("accurate trim is unsupported for %s", filepath.Ext(path))
	}
}

func normalizeExtractFormat(format string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(format)) {
	case "", "mp3":
		return "mp3", nil
	case "wav":
		return "wav", nil
	default:
		return "", fmt.Errorf("unsupported extraction format: %s", format)
	}
}

func shouldCopyForFormat(codec, format string) bool {
	codec = strings.ToLower(strings.TrimSpace(codec))
	switch format {
	case "mp3":
		return codec == "mp3"
	case "wav":
		return strings.HasPrefix(codec, "pcm_")
	default:
		return false
	}
}

func buildExtractAudioArgs(videoPath, outPath, format string, copyMode bool) []string {
	args := []string{
		"-y", "-v", "error",
		"-i", videoPath,
		"-map", "0:a:0",
		"-vn",
	}
	if copyMode {
		args = append(args, "-c:a", "copy")
	} else {
		switch format {
		case "wav":
			args = append(args, "-c:a", "pcm_s16le")
		default:
			args = append(args, "-c:a", "libmp3lame", "-q:a", "0")
		}
	}
	args = append(args, outPath)
	return args
}

func extensionForCodec(codec string) string {
	switch codec {
	case "aac", "alac":
		return ".m4a"
	case "mp3":
		return ".mp3"
	case "flac":
		return ".flac"
	case "opus":
		return ".opus"
	case "vorbis":
		return ".ogg"
	case "ac3":
		return ".ac3"
	case "eac3":
		return ".eac3"
	case "dts":
		return ".dts"
	case "pcm_s16le", "pcm_s24le", "pcm_s32le", "pcm_f32le", "pcm_u8", "pcm_s8", "pcm_mulaw", "pcm_alaw":
		return ".wav"
	default:
		return ".mka"
	}
}

func uniqueSiblingPath(sourcePath, suffix, ext string) (string, error) {
	dir := filepath.Dir(sourcePath)
	base := strings.TrimSuffix(filepath.Base(sourcePath), filepath.Ext(sourcePath))
	if ext == "" {
		ext = ".mka"
	}
	for i := 0; i < 1000; i++ {
		name := base + suffix
		if i > 0 {
			name = fmt.Sprintf("%s%s_%d", base, suffix, i+1)
		}
		cand := filepath.Join(dir, name+ext)
		if _, err := os.Stat(cand); os.IsNotExist(err) {
			return cand, nil
		}
	}
	return "", errors.New("failed to find available output filename")
}

func uniquePathInDir(dirPath, sourcePath, suffix, ext string) (string, error) {
	base := strings.TrimSuffix(filepath.Base(sourcePath), filepath.Ext(sourcePath))
	if strings.TrimSpace(base) == "" {
		base = "audio"
	}
	if ext == "" {
		ext = ".wav"
	}
	for i := 0; i < 1000; i++ {
		name := base + suffix
		if i > 0 {
			name = fmt.Sprintf("%s%s_%d", base, suffix, i+1)
		}
		cand := filepath.Join(dirPath, name+ext)
		if _, err := os.Stat(cand); os.IsNotExist(err) {
			return cand, nil
		}
	}
	return "", errors.New("failed to find available output filename")
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	st, err := in.Stat()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o700); err != nil {
		return err
	}
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, st.Mode())
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	if err := out.Sync(); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

func replaceFile(dst, src string) error {
	if _, err := os.Stat(src); err != nil {
		return err
	}
	_ = os.Remove(dst)
	if err := os.Rename(src, dst); err != nil {
		return err
	}
	return nil
}

func randomID(n int) (string, error) {
	if n <= 0 {
		n = 8
	}
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func isFile(path string) bool {
	st, err := os.Stat(path)
	if err != nil {
		return false
	}
	return !st.IsDir()
}

func samePath(a, b string) bool {
	ca := filepath.Clean(a)
	cb := filepath.Clean(b)
	if abs, err := filepath.Abs(ca); err == nil {
		ca = abs
	}
	if abs, err := filepath.Abs(cb); err == nil {
		cb = abs
	}
	return ca == cb
}
