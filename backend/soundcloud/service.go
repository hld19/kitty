package soundcloud

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"kitty/backend/storage"
)

const (
	authorizeURL = "https://secure.soundcloud.com/authorize"
	tokenURL     = "https://secure.soundcloud.com/oauth/token"
	apiBase      = "https://api.soundcloud.com"
)

type AuthStatus struct {
	Configured bool   `json:"configured"`
	Connected  bool   `json:"connected"`
	Username   string `json:"username"`
	ClientID   string `json:"clientId"`
}

type Track struct {
	Title        string `json:"title"`
	Artist       string `json:"artist"`
	PermalinkURL string `json:"permalinkUrl"`
	ArtworkURL   string `json:"artworkUrl"`
	DurationMs   int    `json:"durationMs"`
}

type LikesPage struct {
	Tracks   []Track `json:"tracks"`
	NextHref string  `json:"nextHref"`
}

type Service struct {
	redirectURI string
	cbAddr      string
	http        *http.Client

	mu          sync.Mutex
	authRunning bool
	authSrv     *http.Server
}

func New(redirectURI, callbackAddr string) *Service {
	return &Service{
		redirectURI: redirectURI,
		cbAddr:      callbackAddr,
		http: &http.Client{
			Timeout: 20 * time.Second,
		},
	}
}

func (s *Service) Status() (AuthStatus, error) {
	set, err := storage.LoadSettings()
	if err != nil {
		return AuthStatus{}, err
	}
	clientID, clientSecret := s.credentialsFromEnv()
	if clientID == "" {
		clientID = strings.TrimSpace(set.SoundCloud.ClientID)
	}
	if clientSecret == "" {
		clientSecret = strings.TrimSpace(set.SoundCloud.ClientSecret)
	}

	configured := clientID != "" && clientSecret != ""
	connected := strings.TrimSpace(set.SoundCloud.AccessToken) != "" || strings.TrimSpace(set.SoundCloud.RefreshToken) != ""

	return AuthStatus{
		Configured: configured,
		Connected:  connected,
		Username:   strings.TrimSpace(set.SoundCloud.Username),
		ClientID:   strings.TrimSpace(clientID),
	}, nil
}

func (s *Service) SetCredentials(clientID, clientSecret string) error {
	set, err := storage.LoadSettings()
	if err != nil {
		return err
	}
	set.SoundCloud.ClientID = strings.TrimSpace(clientID)
	set.SoundCloud.ClientSecret = strings.TrimSpace(clientSecret)
	return storage.SaveSettings(set)
}

func (s *Service) ValidateCredentials(ctx context.Context) error {
	clientID, clientSecret, err := s.credentials()
	if err != nil {
		return err
	}

	form := url.Values{}
	form.Set("grant_type", "client_credentials")

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(clientID+":"+clientSecret)))

	res, err := s.http.Do(req)
	if err != nil {
		var dnsErr *net.DNSError
		if errors.As(err, &dnsErr) {
			name := strings.TrimSpace(dnsErr.Name)
			if name == "" {
				name = "secure.soundcloud.com"
			}
			return fmt.Errorf("soundcloud network error: DNS lookup failed for %s (check internet/DNS/VPN/adblock): %w", name, err)
		}
		return fmt.Errorf("soundcloud network error: %w", err)
	}
	defer res.Body.Close()

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		raw, _ := io.ReadAll(io.LimitReader(res.Body, 16*1024))
		return fmt.Errorf("soundcloud credentials check failed: %s (%s)", res.Status, strings.TrimSpace(string(raw)))
	}
	return nil
}

func (s *Service) Logout() error {
	set, err := storage.LoadSettings()
	if err != nil {
		return err
	}
	set.SoundCloud.AccessToken = ""
	set.SoundCloud.RefreshToken = ""
	set.SoundCloud.ExpiresAt = 0
	set.SoundCloud.Username = ""
	return storage.SaveSettings(set)
}

func (s *Service) StartAuth(ctx context.Context) (string, error) {
	s.mu.Lock()
	if s.authRunning {
		s.mu.Unlock()
		return "", errors.New("soundcloud auth already in progress")
	}
	s.authRunning = true
	s.mu.Unlock()

	var cleanupOnce sync.Once
	cleanup := func() {
		cleanupOnce.Do(func() {
			s.mu.Lock()
			s.authRunning = false
			s.authSrv = nil
			s.mu.Unlock()
		})
	}

	clientID, clientSecret, err := s.credentials()
	if err != nil {
		cleanup()
		return "", err
	}

	state, err := randomURLSafe(24)
	if err != nil {
		cleanup()
		return "", err
	}
	verifier, err := randomURLSafe(64)
	if err != nil {
		cleanup()
		return "", err
	}
	challenge := pkceChallenge(verifier)

	ln, err := net.Listen("tcp", s.cbAddr)
	if err != nil {
		cleanup()
		return "", fmt.Errorf("failed to listen for callback on %s: %w", s.cbAddr, err)
	}

	mux := http.NewServeMux()
	var srv *http.Server
	mux.HandleFunc("/oauth/soundcloud/callback", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if e := strings.TrimSpace(q.Get("error")); e != "" {
			_, _ = io.WriteString(w, "<html><body>Login cancelled. You can return to Kitty.</body></html>")
			go func() {
				if srv != nil {
					_ = srv.Shutdown(context.Background())
				}
				cleanup()
			}()
			return
		}

		gotState := strings.TrimSpace(q.Get("state"))
		if gotState == "" || gotState != state {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = io.WriteString(w, "invalid state")
			go func() {
				if srv != nil {
					_ = srv.Shutdown(context.Background())
				}
				cleanup()
			}()
			return
		}

		code := strings.TrimSpace(q.Get("code"))
		if code == "" {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = io.WriteString(w, "missing code")
			go func() {
				if srv != nil {
					_ = srv.Shutdown(context.Background())
				}
				cleanup()
			}()
			return
		}

		_, _ = io.WriteString(w, "<html><body>Login complete. You can return to Kitty.</body></html>")
		go func() {
			exCtx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
			defer cancel()

			token, err := s.exchangeCode(exCtx, clientID, clientSecret, code, verifier)
			if err == nil {
				username, _ := s.fetchUsername(exCtx, token.AccessToken)
				_ = s.saveToken(token, username)
			}
			if srv != nil {
				_ = srv.Shutdown(context.Background())
			}
			cleanup()
		}()
	})

	srv = &http.Server{Handler: mux}
	s.mu.Lock()
	s.authSrv = srv
	s.mu.Unlock()

	go func() {
		if serveErr := srv.Serve(ln); serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
			_ = srv.Shutdown(context.Background())
			cleanup()
		}
	}()

	authURL, err := buildAuthorizeURL(clientID, s.redirectURI, state, challenge)
	if err != nil {
		_ = srv.Shutdown(context.Background())
		cleanup()
		return "", err
	}

	go func() {
		select {
		case <-ctx.Done():
			_ = srv.Shutdown(context.Background())
			cleanup()
		case <-time.After(5 * time.Minute):
			_ = srv.Shutdown(context.Background())
			cleanup()
		}
	}()

	return authURL, nil
}

func (s *Service) ListLikes(ctx context.Context, nextHref string) (*LikesPage, error) {
	token, err := s.ensureAccessToken(ctx)
	if err != nil {
		return nil, err
	}

	endpoint := nextHref
	if strings.TrimSpace(endpoint) == "" {
		endpoint = apiBase + "/me/likes/tracks?linked_partitioning=true&limit=50"
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "OAuth "+token)
	req.Header.Set("Accept", "application/json")

	res, err := s.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		raw, _ := io.ReadAll(io.LimitReader(res.Body, 16*1024))
		return nil, fmt.Errorf("soundcloud likes failed: %s (%s)", res.Status, strings.TrimSpace(string(raw)))
	}

	var parsed likesResponse
	if err := json.NewDecoder(res.Body).Decode(&parsed); err != nil {
		return nil, err
	}

	tracks := make([]Track, 0, len(parsed.Collection))
	for _, item := range parsed.Collection {
		if t := normalizeTrack(item); t != nil {
			tracks = append(tracks, *t)
		}
	}

	return &LikesPage{
		Tracks:   tracks,
		NextHref: strings.TrimSpace(parsed.NextHref),
	}, nil
}

type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"`
}

func (s *Service) exchangeCode(ctx context.Context, clientID, clientSecret, code, verifier string) (tokenResponse, error) {
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("client_id", clientID)
	form.Set("client_secret", clientSecret)
	form.Set("redirect_uri", s.redirectURI)
	form.Set("code", code)
	form.Set("code_verifier", verifier)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return tokenResponse{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	res, err := s.http.Do(req)
	if err != nil {
		return tokenResponse{}, err
	}
	defer res.Body.Close()

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		raw, _ := io.ReadAll(io.LimitReader(res.Body, 16*1024))
		return tokenResponse{}, fmt.Errorf("soundcloud token exchange failed: %s (%s)", res.Status, strings.TrimSpace(string(raw)))
	}

	var tr tokenResponse
	if err := json.NewDecoder(res.Body).Decode(&tr); err != nil {
		return tokenResponse{}, err
	}
	if strings.TrimSpace(tr.AccessToken) == "" {
		return tokenResponse{}, errors.New("soundcloud token exchange returned empty access_token")
	}
	return tr, nil
}

func (s *Service) refresh(ctx context.Context, clientID, clientSecret, refreshToken string) (tokenResponse, error) {
	form := url.Values{}
	form.Set("grant_type", "refresh_token")
	form.Set("client_id", clientID)
	form.Set("client_secret", clientSecret)
	form.Set("refresh_token", refreshToken)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return tokenResponse{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	res, err := s.http.Do(req)
	if err != nil {
		return tokenResponse{}, err
	}
	defer res.Body.Close()

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		raw, _ := io.ReadAll(io.LimitReader(res.Body, 16*1024))
		return tokenResponse{}, fmt.Errorf("soundcloud token refresh failed: %s (%s)", res.Status, strings.TrimSpace(string(raw)))
	}

	var tr tokenResponse
	if err := json.NewDecoder(res.Body).Decode(&tr); err != nil {
		return tokenResponse{}, err
	}
	if strings.TrimSpace(tr.AccessToken) == "" {
		return tokenResponse{}, errors.New("soundcloud token refresh returned empty access_token")
	}
	return tr, nil
}

func (s *Service) ensureAccessToken(ctx context.Context) (string, error) {
	set, err := storage.LoadSettings()
	if err != nil {
		return "", err
	}
	now := time.Now().Unix()
	if strings.TrimSpace(set.SoundCloud.AccessToken) != "" && (set.SoundCloud.ExpiresAt == 0 || now < set.SoundCloud.ExpiresAt-30) {
		return set.SoundCloud.AccessToken, nil
	}
	if strings.TrimSpace(set.SoundCloud.RefreshToken) == "" {
		return "", errors.New("soundcloud not connected")
	}

	clientID, clientSecret, err := s.credentials()
	if err != nil {
		return "", err
	}

	tr, err := s.refresh(ctx, clientID, clientSecret, set.SoundCloud.RefreshToken)
	if err != nil {
		return "", err
	}
	username, _ := s.fetchUsername(ctx, tr.AccessToken)
	if err := s.saveToken(tr, username); err != nil {
		return "", err
	}
	return tr.AccessToken, nil
}

func (s *Service) fetchUsername(ctx context.Context, accessToken string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiBase+"/me", nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "OAuth "+accessToken)
	req.Header.Set("Accept", "application/json")

	res, err := s.http.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return "", fmt.Errorf("soundcloud /me failed: %s", res.Status)
	}

	var out struct {
		Username string `json:"username"`
	}
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return "", err
	}
	return strings.TrimSpace(out.Username), nil
}

func (s *Service) saveToken(tr tokenResponse, username string) error {
	set, err := storage.LoadSettings()
	if err != nil {
		return err
	}
	set.SoundCloud.AccessToken = strings.TrimSpace(tr.AccessToken)
	if strings.TrimSpace(tr.RefreshToken) != "" {
		set.SoundCloud.RefreshToken = strings.TrimSpace(tr.RefreshToken)
	}
	if tr.ExpiresIn > 0 {
		set.SoundCloud.ExpiresAt = time.Now().Add(time.Duration(tr.ExpiresIn) * time.Second).Unix()
	}
	if strings.TrimSpace(username) != "" {
		set.SoundCloud.Username = strings.TrimSpace(username)
	}
	return storage.SaveSettings(set)
}

func (s *Service) credentials() (string, string, error) {
	clientID, clientSecret := s.credentialsFromEnv()
	if clientID != "" && clientSecret != "" {
		return clientID, clientSecret, nil
	}

	set, err := storage.LoadSettings()
	if err != nil {
		return "", "", err
	}
	clientID = strings.TrimSpace(set.SoundCloud.ClientID)
	clientSecret = strings.TrimSpace(set.SoundCloud.ClientSecret)
	if clientID == "" || clientSecret == "" {
		return "", "", errors.New("missing SoundCloud credentials (client id/secret)")
	}
	return clientID, clientSecret, nil
}

func (s *Service) credentialsFromEnv() (string, string) {
	return strings.TrimSpace(os.Getenv("KITTY_SOUNDCLOUD_CLIENT_ID")), strings.TrimSpace(os.Getenv("KITTY_SOUNDCLOUD_CLIENT_SECRET"))
}

func buildAuthorizeURL(clientID, redirectURI, state, challenge string) (string, error) {
	u, err := url.Parse(authorizeURL)
	if err != nil {
		return "", err
	}
	q := u.Query()
	q.Set("client_id", clientID)
	q.Set("redirect_uri", redirectURI)
	q.Set("response_type", "code")
	q.Set("state", state)
	q.Set("code_challenge", challenge)
	q.Set("code_challenge_method", "S256")
	u.RawQuery = q.Encode()
	return u.String(), nil
}

func pkceChallenge(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func randomURLSafe(n int) (string, error) {
	if n <= 0 {
		return "", errors.New("invalid random length")
	}
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

type likesResponse struct {
	Collection []json.RawMessage `json:"collection"`
	NextHref   string            `json:"next_href"`
}

func normalizeTrack(raw json.RawMessage) *Track {
	var direct struct {
		Title        string `json:"title"`
		PermalinkURL string `json:"permalink_url"`
		ArtworkURL   string `json:"artwork_url"`
		Duration     int    `json:"duration"`
		User         struct {
			Username string `json:"username"`
		} `json:"user"`
	}
	if err := json.Unmarshal(raw, &direct); err == nil && strings.TrimSpace(direct.Title) != "" {
		return &Track{
			Title:        strings.TrimSpace(direct.Title),
			Artist:       strings.TrimSpace(direct.User.Username),
			PermalinkURL: strings.TrimSpace(direct.PermalinkURL),
			ArtworkURL:   strings.TrimSpace(direct.ArtworkURL),
			DurationMs:   direct.Duration,
		}
	}

	var wrapped struct {
		Track json.RawMessage `json:"track"`
	}
	if err := json.Unmarshal(raw, &wrapped); err == nil && len(wrapped.Track) > 0 {
		return normalizeTrack(wrapped.Track)
	}

	return nil
}
