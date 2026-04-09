package audio

import (
	"log"
	"math"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gopxl/beep"
	"github.com/gopxl/beep/effects"
	"github.com/gopxl/beep/mp3"
	"github.com/gopxl/beep/speaker"
	"github.com/gopxl/beep/vorbis"
	"github.com/gopxl/beep/wav"
)

type AudioPlayer struct {
	mu        sync.Mutex
	streamer  beep.StreamSeekCloser
	format    beep.Format
	ctrl      *beep.Ctrl
	volume    *effects.Volume
	isPlaying bool
	filePath  string
}

func NewAudioPlayer() *AudioPlayer {
	return &AudioPlayer{}
}

func (ap *AudioPlayer) Load(path string) error {
	log.Printf("[audio] load %s", path)
	f, err := os.Open(path)
	if err != nil {
		log.Printf("[audio] open failed: %v", err)
		return err
	}

	var streamer beep.StreamSeekCloser
	var format beep.Format

	lower := strings.ToLower(path)
	switch {
	case strings.HasSuffix(lower, ".mp3"):
		streamer, format, err = mp3.Decode(f)
	case strings.HasSuffix(lower, ".wav"):
		streamer, format, err = wav.Decode(f)
	case strings.HasSuffix(lower, ".ogg"):
		streamer, format, err = vorbis.Decode(f)
	default:
		f.Close()
		log.Printf("[audio] unsupported format for playback: %s", path)
		return os.ErrInvalid
	}
	if err != nil {
		f.Close()
		log.Printf("[audio] decode failed: %v", err)
		return err
	}

	ap.mu.Lock()
	prev := ap.streamer
	ap.streamer = streamer
	ap.format = format
	ap.filePath = path

	speaker.Init(format.SampleRate, format.SampleRate.N(time.Second/10))

	ap.ctrl = &beep.Ctrl{Streamer: ap.streamer, Paused: false}
	ap.volume = &effects.Volume{
		Streamer: ap.ctrl,
		Base:     2,
		Volume:   0,
		Silent:   false,
	}

	ap.isPlaying = true
	ap.mu.Unlock()

	if prev != nil {
		_ = prev.Close()
	}

	speaker.Clear()
	speaker.Play(ap.volume)

	log.Printf("[audio] playback started sr=%d", format.SampleRate)
	return nil
}

func (ap *AudioPlayer) Play() {
	ap.mu.Lock()
	defer ap.mu.Unlock()
	if ap.ctrl != nil {
		speaker.Lock()
		ap.ctrl.Paused = false
		speaker.Unlock()
		ap.isPlaying = true
		log.Printf("[audio] play")
	}
}

func (ap *AudioPlayer) Pause() {
	ap.mu.Lock()
	defer ap.mu.Unlock()
	if ap.ctrl != nil {
		speaker.Lock()
		ap.ctrl.Paused = true
		speaker.Unlock()
		ap.isPlaying = false
		log.Printf("[audio] pause")
	}
}

func (ap *AudioPlayer) TogglePlay() bool {
	ap.mu.Lock()
	defer ap.mu.Unlock()
	if ap.ctrl != nil {
		speaker.Lock()
		ap.ctrl.Paused = !ap.ctrl.Paused
		speaker.Unlock()
		ap.isPlaying = !ap.ctrl.Paused
		log.Printf("[audio] toggle play -> %v", ap.isPlaying)
		return ap.isPlaying
	}
	return false
}

func (ap *AudioPlayer) SetVolume(vol float64) {
	ap.mu.Lock()
	defer ap.mu.Unlock()
	if ap.volume != nil {
		speaker.Lock()
		ap.volume.Volume = vol
		speaker.Unlock()
		log.Printf("[audio] volume %.2f", vol)
	}
}

func (ap *AudioPlayer) Seek(percentage float64) {
	ap.mu.Lock()
	defer ap.mu.Unlock()

	if ap.streamer == nil {
		return
	}

	if percentage < 0 {
		percentage = 0
	} else if percentage > 1 {
		percentage = 1
	}

	length := ap.streamer.Len()
	if length <= 0 {
		return
	}

	pos := int(math.Round(float64(length-1) * percentage))
	if pos < 0 {
		pos = 0
	} else if pos >= length {
		pos = length - 1
	}

	speaker.Lock()
	if err := ap.streamer.Seek(pos); err != nil {
		log.Printf("[audio] seek failed: %v", err)
	}
	speaker.Unlock()
}

func (ap *AudioPlayer) GetDuration() float64 {
	ap.mu.Lock()
	defer ap.mu.Unlock()
	if ap.streamer != nil && ap.format.SampleRate > 0 {
		return float64(ap.streamer.Len()) / float64(ap.format.SampleRate)
	}
	return 0
}

func (ap *AudioPlayer) GetPosition() float64 {
	ap.mu.Lock()
	defer ap.mu.Unlock()
	if ap.streamer != nil && ap.format.SampleRate > 0 {
		return float64(ap.streamer.Position()) / float64(ap.format.SampleRate)
	}
	return 0
}
