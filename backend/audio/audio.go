package audio

import (
	"log"
	"os"
	"strings"
	"time"

	"github.com/gopxl/beep"
	"github.com/gopxl/beep/effects"
	"github.com/gopxl/beep/mp3"
	"github.com/gopxl/beep/speaker"
	"github.com/gopxl/beep/vorbis"
	"github.com/gopxl/beep/wav"
)

type AudioPlayer struct {
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

	if ap.streamer != nil {
		ap.streamer.Close()
	}

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

	speaker.Clear()
	speaker.Play(ap.volume)

	log.Printf("[audio] playback started sr=%d", format.SampleRate)
	return nil
}

func (ap *AudioPlayer) Play() {
	if ap.ctrl != nil {
		ap.ctrl.Paused = false
		ap.isPlaying = true
		log.Printf("[audio] play")
	}
}

func (ap *AudioPlayer) Pause() {
	if ap.ctrl != nil {
		ap.ctrl.Paused = true
		ap.isPlaying = false
		log.Printf("[audio] pause")
	}
}

func (ap *AudioPlayer) TogglePlay() bool {
	if ap.ctrl != nil {
		ap.ctrl.Paused = !ap.ctrl.Paused
		ap.isPlaying = !ap.ctrl.Paused
		log.Printf("[audio] toggle play -> %v", ap.isPlaying)
		return ap.isPlaying
	}
	return false
}

func (ap *AudioPlayer) SetVolume(vol float64) {
	if ap.volume != nil {
		ap.volume.Volume = vol
		log.Printf("[audio] volume %.2f", vol)
	}
}

func (ap *AudioPlayer) Seek(percentage float64) {
	if ap.streamer != nil {
		len := ap.streamer.Len()
		pos := int(float64(len) * percentage)
		ap.streamer.Seek(pos)
	}
}

func (ap *AudioPlayer) GetDuration() float64 {
	if ap.streamer != nil {
		return float64(ap.streamer.Len()) / float64(ap.format.SampleRate)
	}
	return 0
}

func (ap *AudioPlayer) GetPosition() float64 {
	if ap.streamer != nil {
		return float64(ap.streamer.Position()) / float64(ap.format.SampleRate)
	}
	return 0
}
