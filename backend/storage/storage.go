package storage

import (
	"encoding/json"
	"os"
	"path/filepath"
)

type Library struct {
	Files []string `json:"files"`
}

func GetConfigPath() string {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return "kitty_library.json"
	}
	return filepath.Join(configDir, "kitty_library.json")
}

func getLegacyConfigPath() string {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return "metago_library.json"
	}
	return filepath.Join(configDir, "metago_library.json")
}

func SaveLibrary(files []string) error {
	lib := Library{Files: files}
	data, err := json.Marshal(lib)
	if err != nil {
		return err
	}
	path := GetConfigPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

func LoadLibrary() ([]string, error) {
	path := GetConfigPath()
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return []string{}, nil
		}
		legacy := getLegacyConfigPath()
		if legacy != path {
			if alt, altErr := os.ReadFile(legacy); altErr == nil {
				data = alt
			} else {
				return []string{}, err
			}
		} else {
			return []string{}, err
		}
	}
	var lib Library
	if err := json.Unmarshal(data, &lib); err != nil {
		return []string{}, err
	}
	return lib.Files, nil
}
