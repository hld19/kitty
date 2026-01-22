package analysis

import (
	"io"
	"os"
	"strings"
	"time"

	"github.com/gopxl/beep"
	beepmp3 "github.com/gopxl/beep/mp3"
	"github.com/gopxl/beep/vorbis"
	"github.com/gopxl/beep/wav"
	mp3frames "github.com/tcolgate/mp3"
)

type AudioProperties struct {
	Bitrate    int `json:"bitrate"`
	SampleRate int `json:"sampleRate"`
}

func GetAudioProperties(path string) (AudioProperties, error) {
	lower := strings.ToLower(path)
	switch {
	case strings.HasSuffix(lower, ".mp3"):
		return mp3Props(path)
	case strings.HasSuffix(lower, ".wav"):
		return decodeProps(path, func(r io.ReadCloser) (beep.StreamSeekCloser, beep.Format, error) {
			return wav.Decode(r)
		})
	case strings.HasSuffix(lower, ".ogg"):
		return decodeProps(path, func(r io.ReadCloser) (beep.StreamSeekCloser, beep.Format, error) {
			return vorbis.Decode(r)
		})
	default:
		return AudioProperties{}, nil
	}
}

func mp3Props(path string) (AudioProperties, error) {
	f, err := os.Open(path)
	if err != nil {
		return AudioProperties{}, err
	}
	defer f.Close()

	d := mp3frames.NewDecoder(f)
	var frame mp3frames.Frame
	var skipped int
	var (
		bestBitrate int
		sampleRate  int
		totalDur    time.Duration
	)

	for {
		if err := d.Decode(&frame, &skipped); err != nil {
			if err == io.EOF {
				break
			}
			continue
		}

		header := frame.Header()
		if sr := int(header.SampleRate()); sr > 0 && sampleRate == 0 {
			sampleRate = sr
		}
		if header.BitRate() > 0 {
			if br := int(header.BitRate()) / 1000; br > bestBitrate {
				bestBitrate = br
			}
		}
		totalDur += frame.Duration()
	}

	if bestBitrate > 0 {
		return AudioProperties{
			Bitrate:    bestBitrate,
			SampleRate: sampleRate,
		}, nil
	}

	if totalDur > 0 {
		if fi, err := os.Stat(path); err == nil {
			seconds := totalDur.Seconds()
			if seconds > 0 {
				br := int((float64(fi.Size()*8) / seconds) / 1000)
				return AudioProperties{
					Bitrate:    br,
					SampleRate: sampleRate,
				}, nil
			}
		}
	}

	if props, err := decodeProps(path, beepmp3.Decode); err == nil {
		if props.SampleRate == 0 {
			props.SampleRate = sampleRate
		}
		return props, nil
	}

	return AudioProperties{SampleRate: sampleRate}, nil
}

func decodeProps(path string, decoder func(io.ReadCloser) (beep.StreamSeekCloser, beep.Format, error)) (AudioProperties, error) {
	f, err := os.Open(path)
	if err != nil {
		return AudioProperties{}, err
	}
	defer f.Close()

	streamer, format, err := decoder(f)
	if err != nil {
		return AudioProperties{}, err
	}
	defer streamer.Close()

	samples := streamer.Len()
	if samples <= 0 || format.SampleRate <= 0 {
		return AudioProperties{}, nil
	}

	duration := float64(samples) / float64(format.SampleRate)
	if duration <= 0 {
		return AudioProperties{SampleRate: int(format.SampleRate)}, nil
	}

	fi, err := os.Stat(path)
	if err != nil {
		return AudioProperties{SampleRate: int(format.SampleRate)}, nil
	}

	bitrate := int((float64(fi.Size()*8) / duration) / 1000)
	return AudioProperties{
		Bitrate:    bitrate,
		SampleRate: int(format.SampleRate),
	}, nil
}
