import { useEffect, useState } from 'react';

const STORAGE_KEY = 'kitty_artist_images';
const LEGACY_STORAGE_KEY = 'metago_artist_images';

export function useArtistImages() {
    const [images, setImages] = useState<Record<string, string>>({});

    useEffect(() => {
        try {
            const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                setImages(parsed);
            }
        } catch (err) {
            console.error('Failed to load artist images', err);
        }
    }, []);

    const setArtistImage = (artist: string, dataUrl: string) => {
        setImages(prev => {
            const next = { ...prev, [artist]: dataUrl };
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
            } catch (err) {
                console.error('Failed to persist artist image', err);
            }
            return next;
        });
    };

    return {
        images,
        setArtistImage,
    };
}
