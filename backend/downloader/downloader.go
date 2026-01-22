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
	c.mu.Lock()
	if c.running {
		c.mu.Unlock()
		return nil
	}
	c.mu.Unlock()

	if err := c.ensureInstall(ctx); err != nil {
		return err
	}

	pm, err := c.getPackageManager()
	if err != nil {
		return err
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	if c.running {
		return nil
	}

	cmd := exec.CommandContext(ctx, pm.cmd, pm.startArgs()...)
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

	go streamLogs(stdout, "[cobalt]")
	go streamLogs(stderr, "[cobalt]")

	go func() {
		if err := cmd.Wait(); err != nil {
			log.Printf("[downloader] cobalt api exited: %v", err)
		}
		c.mu.Lock()
		c.running = false
		c.cmd = nil
		c.mu.Unlock()
	}()

	return nil
}

func (c *Client) ensureInstall(ctx context.Context) error {
	c.mu.Lock()
	if c.installed {
		c.mu.Unlock()
		return nil
	}
	c.mu.Unlock()

	pm, err := c.getPackageManager()
	if err != nil {
		return err
	}

	if _, err := os.Stat(filepath.Join(c.apiDir, "node_modules")); err == nil {
		c.mu.Lock()
		c.installed = true
		c.mu.Unlock()
		return nil
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
		if _, err := exec.LookPath(opt.cmd); err == nil {
			pm := opt
			c.mu.Lock()
			c.pm = &pm
			c.mu.Unlock()
			return &pm, nil
		}
	}

	return nil, errors.New("no package manager found; install pnpm or npm and ensure it is in PATH")
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
