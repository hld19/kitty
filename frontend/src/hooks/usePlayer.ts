import { useState, useEffect } from 'react';
import { 
    LoadAudio, PlayAudio, PauseAudio, ToggleAudio, 
    SeekAudio, SetVolume, GetAudioState 
} from '../../wailsjs/go/main/App';

export function usePlayer() {
    const [isPlaying, setIsPlaying] = useState(false);
    const [position, setPosition] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolumeState] = useState(0);
    const [error, setError] = useState<string | null>(null);
    
    useEffect(() => {
        let interval: number;
        if (isPlaying) {
            interval = window.setInterval(async () => {
                const state = await GetAudioState();
                setPosition(state.position);
                setDuration(state.duration);
            }, 500);
        }
        return () => window.clearInterval(interval);
    }, [isPlaying]);

    const load = async (path: string) => {
        try {
            await LoadAudio(path);
            await play();
            setError(null);
            return true;
        } catch (err: any) {
            setError(err?.toString?.() ?? 'Failed to load audio');
            setIsPlaying(false);
            return false;
        }
    };

    const play = async () => {
        await PlayAudio();
        setIsPlaying(true);
    };

    const pause = async () => {
        await PauseAudio();
        setIsPlaying(false);
    };

    const toggle = async () => {
        const playing = await ToggleAudio();
        setIsPlaying(playing);
    };

    const seek = async (percentage: number) => {
        await SeekAudio(percentage);
        setPosition(duration * percentage);
    };

    const setVolume = async (vol: number) => {
        await SetVolume(vol);
        setVolumeState(vol);
    };

    return {
        isPlaying,
        position,
        duration,
        volume,
        error,
        load,
        play,
        pause,
        toggle,
        seek,
        setVolume
    };
}
