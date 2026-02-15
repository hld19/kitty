package storage

import (
	"encoding/json"
	"os"
	"path/filepath"
)

type Settings struct {
	SoundCloud SoundCloudSettings `json:"soundcloud"`
	Downloader DownloaderSettings `json:"downloader"`
}

type SoundCloudSettings struct {
	ClientID     string `json:"clientId"`
	ClientSecret string `json:"clientSecret"`

	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken"`
	ExpiresAt    int64  `json:"expiresAt"`
	Username     string `json:"username"`
}

type DownloaderSettings struct {
	AutoStart bool `json:"autoStart"`
}

func settingsPath() string {
	configDir, err := os.UserConfigDir()
	if err != nil || configDir == "" {
		return "kitty_settings.json"
	}
	return filepath.Join(configDir, "Kitty", "settings.json")
}

func LoadSettings() (Settings, error) {
	path := settingsPath()
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return Settings{}, nil
		}
		return Settings{}, err
	}

	var s Settings
	if err := json.Unmarshal(data, &s); err != nil {
		return Settings{}, err
	}
	return s, nil
}

func SaveSettings(s Settings) error {
	data, err := json.Marshal(s)
	if err != nil {
		return err
	}
	path := settingsPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o600)
}

func ClearSettings() error {
	path := settingsPath()
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}
