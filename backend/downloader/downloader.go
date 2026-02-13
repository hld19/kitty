package downloader

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"kitty/backend/metadata"
)

type Client struct {
	apiDir    string
	baseURL   string
	mu        sync.Mutex
	cmd       *exec.Cmd
	running   bool
	installed bool
	http      *http.Client
	pm        *pkgManager
	nodePath  string

	updateOnce   sync.Once
	updateCancel context.CancelFunc
}

type pkgManager struct {
	cmd      string
	baseArgs []string
	label    string
}

func (p pkgManager) installArgs() []string {
	return append(append([]string{}, p.baseArgs...), "install")
}

func (p pkgManager) startArgs() []string {
	args := append([]string{}, p.baseArgs...)
	if p.label == "npm" {
		args = append(args, "run", "start")
	} else {
		args = append(args, "start")
	}
	return args
}

type downloadRequest struct {
	URL             string `json:"url"`
	AudioBitrate    string `json:"audioBitrate"`
	AudioFormat     string `json:"audioFormat"`
	DownloadMode    string `json:"downloadMode"`
	FilenameStyle   string `json:"filenameStyle"`
	LocalProcessing string `json:"localProcessing"`
	DisableMetadata bool   `json:"disableMetadata"`
}

type apiResponse struct {
	Status string `json:"status"`

	Error struct {
		Code    string      `json:"code"`
		Context interface{} `json:"context"`
	} `json:"error"`

	URL      string   `json:"url"`
	Filename string   `json:"filename"`
	Tunnel   []string `json:"tunnel"`
	Output   struct {
		Metadata map[string]interface{} `json:"metadata"`
		Type     string                 `json:"type"`
	} `json:"output"`
	Audio struct {
		Cover bool `json:"cover"`
	} `json:"audio"`
}

type Status struct {
	Running bool `json:"running"`
}

type DownloadResult struct {
	SavedPath string                   `json:"savedPath"`
	Tracks    []metadata.TrackMetadata `json:"tracks"`
	Errors    []string                 `json:"errors"`
	Format    string                   `json:"format"`
	Bitrate   string                   `json:"bitrate"`
}

type DownloadInfo struct {
	URL       string
	Filename  string
	MimeType  string
	CoverURL  string
	MetaHints map[string]interface{}

	RequestedFormat  string
	RequestedBitrate string
}

func New(apiDir string) *Client {
	return &Client{
		apiDir:  apiDir,
		baseURL: "http://127.0.0.1:8787",
		http: &http.Client{
			Timeout: 60 * time.Second,
		},
	}
}

func (c *Client) Status() Status {
	c.mu.Lock()
	running := c.running
	cmd := c.cmd
	c.mu.Unlock()

	if !running {
		return Status{Running: false}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/", nil)
	resp, err := c.http.Do(req)
	if err == nil {
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		if resp.StatusCode >= 200 && resp.StatusCode < 400 {
			return Status{Running: true}
		}
	}

	if cmd != nil && cmd.ProcessState != nil && cmd.ProcessState.Exited() {
		c.mu.Lock()
		c.running = false
		c.cmd = nil
		c.mu.Unlock()
		return Status{Running: false}
	}

	return Status{Running: running}
}

func (c *Client) Start(ctx context.Context) error {
	if err := c.resolveAPIDir(); err != nil {
		return err
	}

	c.mu.Lock()
	if c.running {
		c.mu.Unlock()
		return nil
	}
	c.mu.Unlock()

	if err := c.ensureInstall(ctx); err != nil {
		return err
	}

	nodePath, err := c.getNodePath()
	if err != nil {
		return err
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	if c.running {
		return nil
	}

	cmd := exec.CommandContext(ctx, nodePath, "src/cobalt")
	cmd.Dir = c.apiDir
	configureCmd(cmd)
	cmd.Env = append(os.Environ(),
		"API_URL="+c.baseURL,
		"API_PORT=8787",
		"API_LISTEN_ADDRESS=127.0.0.1",
		"CORS_WILDCARD=1",
	)
	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()

	if err := cmd.Start(); err != nil {
		return err
	}

	c.cmd = cmd
	c.running = true

	startupLog := &limitedBuffer{limit: 64 * 1024}
	go streamLogs(io.TeeReader(stdout, startupLog), "[cobalt]")
	go streamLogs(io.TeeReader(stderr, startupLog), "[cobalt]")

	waitCh := make(chan error, 1)
	go func() {
		if err := cmd.Wait(); err != nil {
			log.Printf("[downloader] cobalt api exited: %v", err)
			waitCh <- err
		} else {
			waitCh <- nil
		}
		c.mu.Lock()
		c.running = false
		c.cmd = nil
		c.mu.Unlock()
	}()

	readyCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	if err := c.waitForReady(readyCtx, waitCh); err != nil {
		c.Stop()
		out := strings.TrimSpace(startupLog.String())
		if out != "" {
			return fmt.Errorf("%w: %s", err, out)
		}
		return err
	}

	return nil
}

func (c *Client) waitForReady(ctx context.Context, waitCh <-chan error) error {
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()

	for {
		if c.ping(ctx) == nil {
			return nil
		}

		select {
		case <-ctx.Done():
			return fmt.Errorf("cobalt api did not become ready: %w", ctx.Err())
		case err := <-waitCh:
			if err != nil {
				return fmt.Errorf("cobalt api exited during startup: %w", err)
			}
			return errors.New("cobalt api exited during startup")
		case <-ticker.C:
		}
	}
}

func (c *Client) ping(ctx context.Context) error {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/", nil)
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
	if resp.StatusCode >= 200 && resp.StatusCode < 400 {
		return nil
	}
	return fmt.Errorf("unexpected status: %s", resp.Status)
}

func (c *Client) ensureInstall(ctx context.Context) error {
	c.mu.Lock()
	if c.installed {
		c.mu.Unlock()
		return nil
	}
	c.mu.Unlock()

	if _, err := os.Stat(filepath.Join(c.apiDir, "node_modules")); err == nil {
		c.mu.Lock()
		c.installed = true
		c.mu.Unlock()
		return nil
	}

	pm, err := c.getPackageManager()
	if err != nil {
		return err
	}

	cmd := exec.CommandContext(ctx, pm.cmd, pm.installArgs()...)
	cmd.Dir = c.apiDir
	out, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("[downloader] dependency install failed using %s: %s", pm.label, string(out))
		return err
	}

	c.mu.Lock()
	c.installed = true
	c.mu.Unlock()
	return nil
}

func (c *Client) getPackageManager() (*pkgManager, error) {
	c.mu.Lock()
	if c.pm != nil {
		pm := c.pm
		c.mu.Unlock()
		return pm, nil
	}
	c.mu.Unlock()

	options := []pkgManager{
		{cmd: "pnpm", baseArgs: []string{}, label: "pnpm"},
		{cmd: "corepack", baseArgs: []string{"pnpm"}, label: "corepack pnpm"},
		{cmd: "npm", baseArgs: []string{}, label: "npm"},
	}

	for _, opt := range options {
		if _, err := c.lookPath(opt.cmd); err == nil {
			pm := opt
			c.mu.Lock()
			c.pm = &pm
			c.mu.Unlock()
			return &pm, nil
		}
	}

	return nil, errors.New("no package manager found; install pnpm or npm and ensure it is in PATH")
}

func (c *Client) getNodePath() (string, error) {
	c.mu.Lock()
	cached := c.nodePath
	c.mu.Unlock()
	if cached != "" && fileExists(cached) {
		return cached, nil
	}

	if override := strings.TrimSpace(os.Getenv("KITTY_NODE_PATH")); override != "" {
		if fileExists(override) {
			c.mu.Lock()
			c.nodePath = override
			c.mu.Unlock()
			return override, nil
		}
		return "", fmt.Errorf("KITTY_NODE_PATH is set but not executable: %s", override)
	}

	path, err := c.lookPath("node")
	if err == nil {
		c.mu.Lock()
		c.nodePath = path
		c.mu.Unlock()
		return path, nil
	}

	var candidates []string
	if runtime.GOOS == "windows" {
		if v := strings.TrimSpace(os.Getenv("ProgramFiles")); v != "" {
			candidates = append(candidates, filepath.Join(v, "nodejs", "node.exe"))
		}
		if v := strings.TrimSpace(os.Getenv("ProgramFiles(x86)")); v != "" {
			candidates = append(candidates, filepath.Join(v, "nodejs", "node.exe"))
		}
		if v := strings.TrimSpace(os.Getenv("LocalAppData")); v != "" {
			candidates = append(candidates, filepath.Join(v, "Programs", "nodejs", "node.exe"))
		}
		candidates = append(candidates,
			`C:\Program Files\nodejs\node.exe`,
			`C:\Program Files (x86)\nodejs\node.exe`,
		)
	} else {
		candidates = append(candidates,
			"/opt/homebrew/bin/node",
			"/usr/local/bin/node",
			"/usr/bin/node",
		)
		if home, herr := os.UserHomeDir(); herr == nil && home != "" {
			candidates = append(candidates,
				filepath.Join(home, ".volta", "bin", "node"),
			)
			if nvmNode := newestNVMNode(home); nvmNode != "" {
				candidates = append(candidates, nvmNode)
			}
		}
	}

	for _, cand := range uniqueStrings(candidates) {
		if cand == "" {
			continue
		}
		if fileExists(cand) {
			c.mu.Lock()
			c.nodePath = cand
			c.mu.Unlock()
			return cand, nil
		}
	}

	return "", errors.New("node runtime not found; install Node.js 18+ and ensure it is available in PATH (or set KITTY_NODE_PATH)")
}

func (c *Client) resolveAPIDir() error {
	c.mu.Lock()
	current := c.apiDir
	c.mu.Unlock()
	if current != "" && looksLikeCobaltAPIDir(current) {
		return nil
	}

	var candidates []string
	if override := strings.TrimSpace(os.Getenv("KITTY_API_DIR")); override != "" {
		candidates = append(candidates, override)
	}

	if cwd, err := os.Getwd(); err == nil && cwd != "" {
		candidates = append(candidates, filepath.Join(cwd, "api"))
	}

	if exe, err := os.Executable(); err == nil && exe != "" {
		exeDir := filepath.Dir(exe)
		candidates = append(candidates,
			filepath.Join(exeDir, "api"),
			filepath.Join(exeDir, "resources", "app", "api"),
			filepath.Join(exeDir, "..", "Resources", "app", "api"),
			filepath.Join(exeDir, "..", "Resources", "api"),
			filepath.Join(exeDir, "..", "resources", "app", "api"),
			filepath.Join(exeDir, "..", "api"),
			filepath.Join(exeDir, "..", "..", "Resources", "app", "api"),
			filepath.Join(exeDir, "..", "..", "Resources", "api"),
		)
	}

	for _, cand := range uniqueStrings(candidates) {
		if cand == "" {
			continue
		}
		if looksLikeCobaltAPIDir(cand) {
			c.mu.Lock()
			c.apiDir = cand
			c.mu.Unlock()
			return nil
		}
	}

	return errors.New("cobalt api directory not found; the bundled downloader feature cannot start (rebuild to bundle Resources/app/api, or set KITTY_API_DIR)")
}

func (c *Client) lookPath(file string) (string, error) {
	if p, err := exec.LookPath(file); err == nil {
		return p, nil
	}

	var extra []string
	if runtime.GOOS == "windows" {
		if v := strings.TrimSpace(os.Getenv("ProgramFiles")); v != "" {
			extra = append(extra, filepath.Join(v, "nodejs"))
		}
		if v := strings.TrimSpace(os.Getenv("ProgramFiles(x86)")); v != "" {
			extra = append(extra, filepath.Join(v, "nodejs"))
		}
		if v := strings.TrimSpace(os.Getenv("LocalAppData")); v != "" {
			extra = append(extra, filepath.Join(v, "Programs", "nodejs"))
		}
	} else {
		extra = append(extra, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin")
	}

	for _, dir := range uniqueStrings(extra) {
		if dir == "" {
			continue
		}
		cand := filepath.Join(dir, file)
		if runtime.GOOS == "windows" {
			for _, ext := range []string{".exe", ".cmd", ".bat", ""} {
				if fileExists(cand + ext) {
					return cand + ext, nil
				}
			}
			continue
		}
		if fileExists(cand) {
			return cand, nil
		}
	}

	return "", fmt.Errorf("%s not found in PATH", file)
}

func looksLikeCobaltAPIDir(dir string) bool {
	if dir == "" {
		return false
	}
	if !fileExists(filepath.Join(dir, "package.json")) {
		return false
	}
	if !fileExists(filepath.Join(dir, "src", "cobalt.js")) && !fileExists(filepath.Join(dir, "src", "cobalt")) {
		return false
	}
	return true
}

func fileExists(path string) bool {
	if path == "" {
		return false
	}
	st, err := os.Stat(path)
	if err != nil {
		return false
	}
	return !st.IsDir()
}

type limitedBuffer struct {
	mu    sync.Mutex
	buf   bytes.Buffer
	limit int
}

func (l *limitedBuffer) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.limit <= 0 {
		return len(p), nil
	}
	remaining := l.limit - l.buf.Len()
	if remaining <= 0 {
		return len(p), nil
	}
	if len(p) > remaining {
		_, _ = l.buf.Write(p[:remaining])
		return len(p), nil
	}
	_, _ = l.buf.Write(p)
	return len(p), nil
}

func (l *limitedBuffer) String() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.buf.String()
}

func uniqueStrings(in []string) []string {
	seen := make(map[string]struct{}, len(in))
	out := make([]string, 0, len(in))
	for _, s := range in {
		s = filepath.Clean(s)
		if s == "." || s == "" {
			continue
		}
		if _, ok := seen[s]; ok {
			continue
		}
		seen[s] = struct{}{}
		out = append(out, s)
	}
	return out
}

type semver struct {
	major int
	minor int
	patch int
	raw   string
}

func newestNVMNode(home string) string {
	base := filepath.Join(home, ".nvm", "versions", "node")
	entries, err := os.ReadDir(base)
	if err != nil {
		return ""
	}

	var vers []semver
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		name := strings.TrimSpace(e.Name())
		if !strings.HasPrefix(name, "v") {
			continue
		}
		parts := strings.Split(strings.TrimPrefix(name, "v"), ".")
		if len(parts) < 2 {
			continue
		}
		maj, err1 := strconv.Atoi(parts[0])
		min, err2 := strconv.Atoi(parts[1])
		patch := 0
		var err3 error
		if len(parts) >= 3 {
			patch, err3 = strconv.Atoi(parts[2])
		}
		if err1 != nil || err2 != nil || err3 != nil {
			continue
		}
		vers = append(vers, semver{major: maj, minor: min, patch: patch, raw: name})
	}

	if len(vers) == 0 {
		return ""
	}

	sort.Slice(vers, func(i, j int) bool {
		if vers[i].major != vers[j].major {
			return vers[i].major > vers[j].major
		}
		if vers[i].minor != vers[j].minor {
			return vers[i].minor > vers[j].minor
		}
		if vers[i].patch != vers[j].patch {
			return vers[i].patch > vers[j].patch
		}
		return vers[i].raw > vers[j].raw
	})

	node := filepath.Join(base, vers[0].raw, "bin", "node")
	if fileExists(node) {
		return node
	}
	return ""
}

func streamLogs(r io.Reader, prefix string) {
	buf := make([]byte, 2048)
	for {
		n, err := r.Read(buf)
		if n > 0 {
			log.Printf("%s %s", prefix, bytes.TrimSpace(buf[:n]))
		}
		if err != nil {
			return
		}
	}
}

func (c *Client) Stop() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.updateCancel != nil {
		c.updateCancel()
		c.updateCancel = nil
	}
	killProcessTree(c.cmd)
	c.cmd = nil
	c.running = false
}

func (c *Client) RequestDownload(ctx context.Context, link string, format string, bitrate string) (*DownloadInfo, error) {
	if link == "" {
		return nil, errors.New("missing link")
	}
	payload := downloadRequest{
		URL:             link,
		AudioBitrate:    bitrate,
		AudioFormat:     format,
		DownloadMode:    "audio",
		FilenameStyle:   "pretty",
		LocalProcessing: "preferred",
		DisableMetadata: false,
	}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	res, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		const maxErrBody = 16 * 1024
		raw, _ := io.ReadAll(io.LimitReader(res.Body, maxErrBody))
		var parsed apiResponse
		if err := json.Unmarshal(raw, &parsed); err == nil && parsed.Error.Code != "" {
			if parsed.Error.Context != nil {
				return nil, fmt.Errorf("api error (%s): %s (context: %v)", res.Status, parsed.Error.Code, parsed.Error.Context)
			}
			return nil, fmt.Errorf("api error (%s): %s", res.Status, parsed.Error.Code)
		}
		if s := strings.TrimSpace(string(raw)); s != "" {
			return nil, fmt.Errorf("api responded with %s: %s", res.Status, s)
		}
		return nil, fmt.Errorf("api responded with %s", res.Status)
	}

	var parsed apiResponse
	if err := json.NewDecoder(res.Body).Decode(&parsed); err != nil {
		return nil, err
	}

	switch parsed.Status {
	case "redirect", "tunnel":
		if parsed.URL == "" {
			return nil, errors.New("api returned empty url")
		}
		return &DownloadInfo{
			URL:              parsed.URL,
			Filename:         parsed.Filename,
			MimeType:         parsed.Output.Type,
			MetaHints:        parsed.Output.Metadata,
			RequestedFormat:  payload.AudioFormat,
			RequestedBitrate: payload.AudioBitrate,
		}, nil
	case "local-processing":
		if len(parsed.Tunnel) == 0 {
			return nil, errors.New("no tunnel URLs returned")
		}
		coverURL := ""
		if parsed.Audio.Cover && len(parsed.Tunnel) > 1 {
			coverURL = parsed.Tunnel[len(parsed.Tunnel)-1]
		}
		return &DownloadInfo{
			URL:              parsed.Tunnel[0],
			Filename:         parsed.Filename,
			MimeType:         parsed.Output.Type,
			CoverURL:         coverURL,
			MetaHints:        parsed.Output.Metadata,
			RequestedFormat:  payload.AudioFormat,
			RequestedBitrate: payload.AudioBitrate,
		}, nil
	case "error":
		return nil, fmt.Errorf("api error: %s", parsed.Error.Code)
	default:
		return nil, fmt.Errorf("unsupported response status: %s", parsed.Status)
	}
}

func (c *Client) Fetch(ctx context.Context, downloadURL, destinationPath string) (string, error) {
	if downloadURL == "" {
		return "", errors.New("download URL missing")
	}
	if destinationPath == "" {
		return "", errors.New("destination path missing")
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, downloadURL, nil)
	if err != nil {
		return "", err
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("download failed with status %s", resp.Status)
	}

	if err := os.MkdirAll(filepath.Dir(destinationPath), 0o755); err != nil {
		return "", err
	}

	out, err := os.Create(destinationPath)
	if err != nil {
		return "", err
	}
	defer out.Close()

	if _, err := io.Copy(out, resp.Body); err != nil {
		return "", err
	}

	return destinationPath, nil
}

func (c *Client) FetchDataURL(ctx context.Context, fileURL string) (string, error) {
	if fileURL == "" {
		return "", errors.New("missing url")
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fileURL, nil)
	if err != nil {
		return "", err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("cover fetch failed: %s", resp.Status)
	}

	limit := int64(8 * 1024 * 1024)
	contentLen := resp.ContentLength
	if contentLen > 0 && contentLen > limit {
		return "", fmt.Errorf("cover too large (%d bytes)", contentLen)
	}

	buf := &bytes.Buffer{}
	if _, err := io.CopyN(buf, resp.Body, limit); err != nil && !errors.Is(err, io.EOF) {
		return "", err
	}

	mimeType := resp.Header.Get("Content-Type")
	if mimeType == "" {
		mimeType = "image/jpeg"
	}

	b64 := base64.StdEncoding.EncodeToString(buf.Bytes())
	return fmt.Sprintf("data:%s;base64,%s", mimeType, b64), nil
}
