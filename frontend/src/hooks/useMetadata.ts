import { useEffect, useState } from 'react';
import { AddFiles, LoadLibraryWithMetadata, SaveMetadataAndRefresh, SelectFiles } from '../../wailsjs/go/main/App';
import { metadata } from '../../wailsjs/go/models';

export function useMetadata() {
    const [fileList, setFileList] = useState<metadata.TrackMetadata[]>([]);
    const [currentTrack, setCurrentTrack] = useState<metadata.TrackMetadata | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isBooting, setIsBooting] = useState(true);
    const [isSyncing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hadCache, setHadCache] = useState(false);

    useEffect(() => {
        const loadInit = async () => {
            try {
                const res = await LoadLibraryWithMetadata();
                if (res?.tracks) {
                    setFileList(res.tracks);
                    setCurrentTrack(res.tracks[0] ?? null);
                    setHadCache(res.tracks.length > 0);
                }
                if (res?.errors && res.errors.length > 0) {
                    setError(res.errors.join('\n'));
                }
            } catch (e: any) {
                setError(e?.toString?.() ?? 'Failed to load library');
            } finally {
                setIsBooting(false);
            }
        };
        loadInit();
    }, []);

    const importFiles = async () => {
        setIsLoading(true);
        try {
            const paths = await SelectFiles();
            if (paths && paths.length > 0) {
                await addFilesByPath(paths);
            }
        } catch (err: any) {
            setError(err.toString());
        } finally {
            setIsLoading(false);
        }
    };
    
    const addFilesByPath = async (paths: string[]) => {
        setIsLoading(true);
        try {
            const res = await AddFiles(paths);
            if (res?.tracks) {
                setFileList(res.tracks);
                if (!currentTrack && res.tracks.length > 0) {
                    setCurrentTrack(res.tracks[0]);
                } else if (currentTrack) {
                    const updated = res.tracks.find(t => t.filePath === currentTrack.filePath);
                    if (updated) setCurrentTrack(updated);
                }
            }
            if (res?.errors && res.errors.length > 0) {
                setError(res.errors.join('\n'));
            }
        } catch (err: any) {
            setError(err.toString());
        } finally {
            setIsLoading(false);
        }
    };

    const selectTrack = (track: metadata.TrackMetadata) => {
        setCurrentTrack(track);
    };

    const saveTrack = async (track: metadata.TrackMetadata) => {
        setIsLoading(true);
        try {
            const refreshed = await SaveMetadataAndRefresh(track);
            if (refreshed) {
                setFileList(prev => prev.map(t => t.filePath === refreshed.filePath ? refreshed : t));
                setCurrentTrack(refreshed);
            }
        } catch (err: any) {
            setError(err.toString());
        } finally {
            setIsLoading(false);
        }
    };

    const updateField = (field: keyof metadata.TrackMetadata, value: any) => {
        if (!currentTrack) return;
        const updated = new metadata.TrackMetadata({ ...currentTrack });
        (updated as any)[field] = value;
        if (field === 'coverImage') {
            updated.hasCover = !!value;
        }
        if (field === 'hasCover' && !value) {
            updated.coverImage = '';
        }
        setCurrentTrack(updated);
    };

    return {
        fileList,
        currentTrack,
        isLoading,
        isBooting,
        isSyncing,
        hadCache,
        error,
        clearError: () => setError(null),
        importFiles,
        addFilesByPath,
        selectTrack,
        saveTrack,
        updateField,
        setCurrentTrack
    };
}
