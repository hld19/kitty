package metadata

import (
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"kitty/backend/analysis"

	"github.com/bogem/id3v2"
	"github.com/dhowden/tag"
)

type TrackMetadata struct {
	FilePath    string `json:"filePath"`
	FileName    string `json:"fileName"`
	Title       string `json:"title"`
	Artist      string `json:"artist"`
	Album       string `json:"album"`
	AlbumArtist string `json:"albumArtist"`
	TrackNumber int    `json:"trackNumber"`
	DiscNumber  int    `json:"discNumber"`
	Genre       string `json:"genre"`
	Year        int    `json:"year"`
	Comment     string `json:"comment"`
	Composer    string `json:"composer"`
	Lyrics      string `json:"lyrics"`
	HasCover    bool   `json:"hasCover"`
	CoverImage  string `json:"coverImage"`
	Format      string `json:"format"`
	Bitrate     int    `json:"bitrate"`
	SampleRate  int    `json:"sampleRate"`
}

func LoadMetadata(path string) (*TrackMetadata, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	m, err := tag.ReadFrom(f)
	if err != nil {
		log.Printf("[metadata] tag read failed for %s: %v", path, err)
		md := minimalMetadata(path)
		if side, sideErr := readSidecar(path); sideErr == nil {
			md = mergeMetadata(md, side)
		}
		return md, nil
	}

	track, _ := m.Track()
	disc, _ := m.Disc()

	md := &TrackMetadata{
		FilePath:    path,
		FileName:    filepath.Base(path),
		Title:       firstNonEmpty(m.Title(), trimExt(filepath.Base(path))),
		Artist:      firstNonEmpty(m.Artist(), "Unknown Artist"),
		Album:       firstNonEmpty(m.Album(), "Unknown Album"),
		AlbumArtist: m.AlbumArtist(),
		TrackNumber: track,
		DiscNumber:  disc,
		Genre:       m.Genre(),
		Year:        m.Year(),
		Comment:     m.Comment(),
		Composer:    m.Composer(),
		Lyrics:      m.Lyrics(),
		Format:      firstNonEmpty(string(m.Format()), strings.TrimPrefix(strings.ToUpper(filepath.Ext(path)), ".")),
	}

	if pic := m.Picture(); pic != nil {
		const maxCoverBytes = 8 * 1024 * 1024
		if len(pic.Data) > maxCoverBytes {
			log.Printf("[metadata] cover too large (%d bytes), skipping embed for %s", len(pic.Data), path)
		} else {
			md.HasCover = true
			mimeType := pic.MIMEType
			if mimeType == "" {
				mimeType = "image/jpeg"
			}
			b64 := base64.StdEncoding.EncodeToString(pic.Data)
			md.CoverImage = fmt.Sprintf("data:%s;base64,%s", mimeType, b64)
		}
	}

	if props, err := analysis.GetAudioProperties(path); err == nil {
		md.Bitrate = props.Bitrate
		md.SampleRate = props.SampleRate
	}

	if side, err := readSidecar(path); err == nil {
		md = mergeMetadata(md, side)
	}

	return md, nil
}

func SaveMetadata(md TrackMetadata) error {
	ext := strings.ToLower(filepath.Ext(md.FilePath))
	if ext == ".mp3" {
		log.Printf("[metadata] SaveMetadata %s coverLen=%d hasCover=%v", md.FilePath, len(md.CoverImage), md.HasCover)
		return saveID3v2(md)
	}
	if err := writeSidecar(md); err != nil {
		log.Printf("[metadata] sidecar write failed for %s: %v", md.FilePath, err)
		return err
	}
	log.Printf("[metadata] saved sidecar for %s (format %s)", md.FilePath, ext)
	return nil
}

func saveID3v2(md TrackMetadata) error {
	id3Tag, err := id3v2.Open(md.FilePath, id3v2.Options{Parse: true})
	if err != nil {
		log.Printf("[metadata] open ID3v2 failed: %v", err)
		return err
	}
	defer id3Tag.Close()

	id3Tag.SetTitle(md.Title)
	id3Tag.SetArtist(md.Artist)
	id3Tag.SetAlbum(md.Album)
	id3Tag.SetGenre(md.Genre)
	id3Tag.SetYear(fmt.Sprintf("%d", md.Year))

	id3Tag.DeleteFrames("TPE2")
	id3Tag.AddTextFrame("TPE2", id3v2.EncodingUTF8, md.AlbumArtist)

	id3Tag.DeleteFrames("TRCK")
	id3Tag.AddTextFrame("TRCK", id3v2.EncodingUTF8, fmt.Sprintf("%d", md.TrackNumber))

	id3Tag.DeleteFrames("TPOS")
	id3Tag.AddTextFrame("TPOS", id3v2.EncodingUTF8, fmt.Sprintf("%d", md.DiscNumber))

	id3Tag.DeleteFrames("TCOM")
	id3Tag.AddTextFrame("TCOM", id3v2.EncodingUTF8, md.Composer)

	id3Tag.DeleteFrames("COMM")
	id3Tag.AddCommentFrame(id3v2.CommentFrame{
		Encoding: id3v2.EncodingUTF8,
		Language: "eng",
		Text:     md.Comment,
	})

	id3Tag.DeleteFrames("USLT")
	if strings.TrimSpace(md.Lyrics) != "" {
		id3Tag.AddUnsynchronisedLyricsFrame(id3v2.UnsynchronisedLyricsFrame{
			Encoding: id3v2.EncodingUTF8,
			Language: "eng",
			Lyrics:   md.Lyrics,
		})
	}

	coverData := strings.TrimSpace(md.CoverImage)
	if coverData != "" {
		id3Tag.DeleteFrames("APIC")
		parts := strings.Split(md.CoverImage, ",")
		if len(parts) == 2 {
			mimeType := strings.TrimSuffix(strings.TrimPrefix(parts[0], "data:"), ";base64")
			data, err := base64.StdEncoding.DecodeString(parts[1])
			if err == nil {
				log.Printf("[metadata] writing cover mime=%s bytes=%d", mimeType, len(data))
				pic := id3v2.PictureFrame{
					Encoding:    id3v2.EncodingUTF8,
					MimeType:    mimeType,
					PictureType: id3v2.PTFrontCover,
					Description: "Cover",
					Picture:     data,
				}
				id3Tag.AddAttachedPicture(pic)
			} else {
				log.Printf("[metadata] cover decode failed: %v", err)
			}
		}
	} else {
		log.Printf("[metadata] removing cover art")
		id3Tag.DeleteFrames("APIC")
	}

	if err := id3Tag.Save(); err != nil {
		log.Printf("[metadata] tag.Save failed: %v", err)
		return err
	}
	writeSidecar(md)
	if f, err := os.Open(md.FilePath); err == nil {
		if m, err2 := tag.ReadFrom(f); err2 == nil {
			if pic := m.Picture(); pic != nil {
				sum := sha1.Sum(pic.Data)
				log.Printf("[metadata] save complete %s coverBytes=%d sha1=%s", md.FilePath, len(pic.Data), hex.EncodeToString(sum[:8]))
			} else {
				log.Printf("[metadata] save complete %s but no picture found on reload", md.FilePath)
			}
		} else {
			log.Printf("[metadata] save complete %s but re-read failed: %v", md.FilePath, err2)
		}
		f.Close()
	} else {
		log.Printf("[metadata] save complete %s (verify open failed: %v)", md.FilePath, err)
	}
	return nil
}

func minimalMetadata(path string) *TrackMetadata {
	base := filepath.Base(path)
	return &TrackMetadata{
		FilePath:    path,
		FileName:    base,
		Title:       trimExt(base),
		Artist:      "Unknown Artist",
		Album:       "Unknown Album",
		AlbumArtist: "",
		Genre:       "",
		Year:        0,
		Format:      strings.TrimPrefix(strings.ToUpper(filepath.Ext(path)), "."),
	}
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func trimExt(name string) string {
	return strings.TrimSuffix(name, filepath.Ext(name))
}

func sidecarDir() (string, error) {
	configDir, err := os.UserConfigDir()
	if err != nil || strings.TrimSpace(configDir) == "" {
		return "", fmt.Errorf("user config dir unavailable")
	}
	return filepath.Join(configDir, "Kitty", "sidecars"), nil
}

func legacySidecarPath(path string) string {
	return path + ".kittymeta.json"
}

func sidecarKey(path string) string {
	clean := filepath.Clean(path)
	if abs, err := filepath.Abs(clean); err == nil && strings.TrimSpace(abs) != "" {
		clean = abs
	}
	if runtime.GOOS == "windows" {
		clean = strings.ToLower(clean)
	}
	return clean
}

func sidecarPath(path string) string {
	dir, err := sidecarDir()
	if err != nil {
		return legacySidecarPath(path)
	}
	sum := sha1.Sum([]byte(sidecarKey(path)))
	name := hex.EncodeToString(sum[:]) + ".kittymeta.json"
	return filepath.Join(dir, name)
}

func readSidecar(path string) (*TrackMetadata, error) {
	primary := sidecarPath(path)
	data, err := os.ReadFile(primary)
	if err != nil {
		legacy := legacySidecarPath(path)
		if legacy == primary {
			return nil, err
		}
		alt, altErr := os.ReadFile(legacy)
		if altErr != nil {
			return nil, err
		}
		data = alt
	}
	var md TrackMetadata
	if err := json.Unmarshal(data, &md); err != nil {
		return nil, err
	}
	md.FilePath = path
	md.FileName = filepath.Base(path)

	if legacy := legacySidecarPath(path); legacy != primary {
		if _, statErr := os.Stat(primary); os.IsNotExist(statErr) {
			_ = writeSidecar(md)
		}
	}
	return &md, nil
}

func writeSidecar(md TrackMetadata) error {
	data, err := json.Marshal(md)
	if err != nil {
		return err
	}
	path := sidecarPath(md.FilePath)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return err
	}

	legacy := legacySidecarPath(md.FilePath)
	if legacy != path {
		if err := os.Remove(legacy); err != nil && !os.IsNotExist(err) {
		}
	}
	return nil
}

func ClearSidecarCache() error {
	dir, err := sidecarDir()
	if err != nil {
		return nil
	}
	return os.RemoveAll(dir)
}

func mergeMetadata(base *TrackMetadata, override *TrackMetadata) *TrackMetadata {
	result := *base

	if strings.TrimSpace(override.Title) != "" {
		result.Title = override.Title
	}
	if strings.TrimSpace(override.Artist) != "" {
		result.Artist = override.Artist
	}
	if strings.TrimSpace(override.Album) != "" {
		result.Album = override.Album
	}
	if strings.TrimSpace(override.AlbumArtist) != "" {
		result.AlbumArtist = override.AlbumArtist
	}
	if strings.TrimSpace(override.Genre) != "" {
		result.Genre = override.Genre
	}
	if strings.TrimSpace(override.Comment) != "" {
		result.Comment = override.Comment
	}
	if strings.TrimSpace(override.Composer) != "" {
		result.Composer = override.Composer
	}
	if strings.TrimSpace(override.Lyrics) != "" {
		result.Lyrics = override.Lyrics
	}
	if override.TrackNumber > 0 {
		result.TrackNumber = override.TrackNumber
	}
	if override.DiscNumber > 0 {
		result.DiscNumber = override.DiscNumber
	}
	if override.Year > 0 {
		result.Year = override.Year
	}
	if override.HasCover && strings.TrimSpace(override.CoverImage) != "" {
		result.CoverImage = override.CoverImage
		result.HasCover = true
	}
	if strings.TrimSpace(override.Format) != "" {
		result.Format = override.Format
	}
	if override.Bitrate > 0 {
		result.Bitrate = override.Bitrate
	}
	if override.SampleRate > 0 {
		result.SampleRate = override.SampleRate
	}

	return &result
}
