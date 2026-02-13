package library

import (
	"fmt"
	"kitty/backend/metadata"
	"kitty/backend/storage"
	"log"
	"path/filepath"
	"runtime"
	"sync"
)

type BatchResult struct {
	Tracks []metadata.TrackMetadata `json:"tracks"`
	Errors []string                 `json:"errors"`
}

type Manager struct {
	mu     sync.Mutex
	tracks map[string]metadata.TrackMetadata
	order  []string
}

func NewManager() *Manager {
	return &Manager{
		tracks: make(map[string]metadata.TrackMetadata),
		order:  make([]string, 0),
	}
}

func (m *Manager) LoadStoredLibrary() (*BatchResult, error) {
	paths, err := storage.LoadLibrary()
	if err != nil {
		return &BatchResult{}, err
	}
	return m.loadAndMerge(paths, false)
}

func (m *Manager) AddFiles(paths []string) (*BatchResult, error) {
	return m.loadAndMerge(paths, true)
}

func (m *Manager) UpdateAndReload(md metadata.TrackMetadata) (metadata.TrackMetadata, error) {
	if err := metadata.SaveMetadata(md); err != nil {
		return metadata.TrackMetadata{}, err
	}
	refreshed, err := metadata.LoadMetadata(md.FilePath)
	if err != nil {
		return metadata.TrackMetadata{}, err
	}

	m.mu.Lock()
	m.tracks[refreshed.FilePath] = *refreshed
	if !m.hasPath(refreshed.FilePath) {
		m.order = append(m.order, refreshed.FilePath)
	}
	snapshot := m.snapshotLocked()
	m.mu.Unlock()

	log.Printf("[library] updated %s; total tracks=%d", filepath.Base(refreshed.FilePath), len(snapshot))
	return *refreshed, nil
}

func (m *Manager) loadAndMerge(paths []string, persist bool) (*BatchResult, error) {
	unique := m.filterNew(paths)
	if len(unique) == 0 {
		return &BatchResult{Tracks: m.snapshot()}, nil
	}

	workerCount := runtime.NumCPU() * 8
	if len(unique) < workerCount {
		workerCount = len(unique)
	}

	type res struct {
		track metadata.TrackMetadata
		err   error
		path  string
	}

	jobs := make(chan string)
	results := make(chan res, len(unique))
	var wg sync.WaitGroup

	for i := 0; i < workerCount; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for path := range jobs {
				md, err := metadata.LoadMetadata(path)
				if err != nil {
					results <- res{err: err, path: path}
					continue
				}
				results <- res{track: *md, path: path}
			}
		}()
	}

	for _, p := range unique {
		jobs <- p
	}
	close(jobs)
	wg.Wait()
	close(results)

	var (
		newTracks []metadata.TrackMetadata
		errs      []string
	)

	for r := range results {
		if r.err != nil {
			errs = append(errs, fmt.Sprintf("%s: %v", r.path, r.err))
			continue
		}
		newTracks = append(newTracks, r.track)
	}

	loadedByPath := make(map[string]metadata.TrackMetadata, len(newTracks))
	for _, t := range newTracks {
		loadedByPath[t.FilePath] = t
	}
	orderedNewTracks := make([]metadata.TrackMetadata, 0, len(newTracks))
	for _, p := range unique {
		if t, ok := loadedByPath[p]; ok {
			orderedNewTracks = append(orderedNewTracks, t)
		}
	}

	if len(orderedNewTracks) > 0 {
		m.mu.Lock()
		for _, t := range orderedNewTracks {
			if _, exists := m.tracks[t.FilePath]; !exists {
				m.order = append(m.order, t.FilePath)
			}
			m.tracks[t.FilePath] = t
		}
		snapshot := m.snapshotLocked()
		m.mu.Unlock()

		if persist {
			if err := storage.SaveLibrary(m.order); err != nil {
				errs = append(errs, fmt.Sprintf("save library failed: %v", err))
			}
		}

		log.Printf("[library] added %d tracks (errors: %d); total=%d", len(orderedNewTracks), len(errs), len(snapshot))
	}

	return &BatchResult{
		Tracks: m.snapshot(),
		Errors: errs,
	}, nil
}

func (m *Manager) ApplyMetadata(path string, overlay metadata.TrackMetadata) metadata.TrackMetadata {
	m.mu.Lock()
	defer m.mu.Unlock()

	existing, ok := m.tracks[path]
	if !ok {
		m.tracks[path] = overlay
		m.order = append(m.order, path)
		return overlay
	}

	if overlay.Title != "" {
		existing.Title = overlay.Title
	}
	if overlay.Artist != "" {
		existing.Artist = overlay.Artist
	}
	if overlay.Album != "" {
		existing.Album = overlay.Album
	}
	if overlay.AlbumArtist != "" {
		existing.AlbumArtist = overlay.AlbumArtist
	}
	if overlay.Genre != "" {
		existing.Genre = overlay.Genre
	}
	if overlay.Comment != "" {
		existing.Comment = overlay.Comment
	}
	if overlay.Composer != "" {
		existing.Composer = overlay.Composer
	}
	if overlay.Lyrics != "" {
		existing.Lyrics = overlay.Lyrics
	}
	if overlay.CoverImage != "" {
		existing.CoverImage = overlay.CoverImage
		existing.HasCover = true
	}

	if overlay.TrackNumber > 0 {
		existing.TrackNumber = overlay.TrackNumber
	}
	if overlay.DiscNumber > 0 {
		existing.DiscNumber = overlay.DiscNumber
	}
	if overlay.Year > 0 {
		existing.Year = overlay.Year
	}

	m.tracks[path] = existing
	return existing
}

func (m *Manager) snapshot() []metadata.TrackMetadata {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.snapshotLocked()
}

func (m *Manager) snapshotLocked() []metadata.TrackMetadata {
	tracks := make([]metadata.TrackMetadata, 0, len(m.order))
	for _, path := range m.order {
		if t, ok := m.tracks[path]; ok {
			tracks = append(tracks, t)
		}
	}
	return tracks
}

func (m *Manager) hasPath(path string) bool {
	for _, p := range m.order {
		if p == path {
			return true
		}
	}
	return false
}

func (m *Manager) filterNew(paths []string) []string {
	m.mu.Lock()
	defer m.mu.Unlock()

	seen := make(map[string]struct{}, len(paths))
	var unique []string
	for _, p := range paths {
		if _, ok := seen[p]; ok {
			continue
		}
		seen[p] = struct{}{}
		if _, exists := m.tracks[p]; !exists {
			unique = append(unique, p)
		}
	}
	return unique
}
