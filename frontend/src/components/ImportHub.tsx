import React, { useState } from 'react';
import { Film, Music2, FolderUp, Clapperboard, Loader2, CheckCircle2, FolderOpen } from 'lucide-react';
import { SelectVideoFile, ExtractAudioFromVideo, ChooseDownloadFolder } from '../../wailsjs/go/main/App';
import { useMetadata } from '../hooks/useMetadata';

interface ImportHubProps {
    metadataHook: ReturnType<typeof useMetadata>;
}

const DIR_KEY = 'kitty_downloader_dir';

export const ImportHub: React.FC<ImportHubProps> = ({ metadataHook }) => {
    const [videoPath, setVideoPath] = useState('');
    const [targetDir, setTargetDir] = useState<string>(() => localStorage.getItem(DIR_KEY) || '');
    const [extractFormat, setExtractFormat] = useState<'mp3' | 'wav'>('mp3');
    const [isExtracting, setIsExtracting] = useState(false);
    const [status, setStatus] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const chooseVideo = async () => {
        setError(null);
        setStatus(null);
        try {
            const picked = await SelectVideoFile();
            if (picked && picked.trim()) {
                setVideoPath(picked.trim());
            }
        } catch (e: any) {
            setError(e?.toString?.() ?? 'Failed to select video file');
        }
    };

    const chooseOutputDirectory = async () => {
        setError(null);
        setStatus(null);
        try {
            const dir = await ChooseDownloadFolder();
            if (dir && dir.trim()) {
                const cleaned = dir.trim();
                setTargetDir(cleaned);
                localStorage.setItem(DIR_KEY, cleaned);
            }
        } catch (e: any) {
            setError(e?.toString?.() ?? 'Failed to choose output folder');
        }
    };

    const extractAudio = async () => {
        setError(null);
        setStatus(null);
        if (!videoPath.trim()) {
            setError('Choose a video file first.');
            return;
        }
        if (!targetDir.trim()) {
            setError('Choose an output folder first.');
            return;
        }

        setIsExtracting(true);
        try {
            const res = await ExtractAudioFromVideo(videoPath.trim(), targetDir.trim(), extractFormat);
            const savedPath = (res as any)?.savedPath as string | undefined;
            if (!savedPath) {
                throw new Error('No output file was produced by extraction.');
            }

            await metadataHook.addFilesByPath([savedPath]);
            const importErrors = (res as any)?.errors as string[] | undefined;
            if (importErrors?.length) {
                setError(importErrors.join('\n'));
            }
            setStatus(`Extracted and imported: ${savedPath}`);
        } catch (e: any) {
            setError(e?.toString?.() ?? 'Audio extraction failed');
        } finally {
            setIsExtracting(false);
        }
    };

    return (
        <div className="h-full w-full overflow-y-auto px-8 pb-24 pt-6">
            <div className="max-w-5xl mx-auto space-y-5">
                <div className="space-y-1">
                    <p className="text-xs uppercase tracking-[0.24em] text-neutral-500">Import</p>
                    <h1 className="text-2xl font-semibold text-white">Add Audio</h1>
                </div>

                <div className="grid gap-5 lg:grid-cols-2">
                    <div className="bg-neutral-900/45 border border-white/10 rounded-2xl p-6 shadow-xl flex flex-col gap-4">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center">
                                <Music2 size={18} className="text-white/90" />
                            </div>
                            <div>
                                <p className="text-sm font-medium text-white">Import Audio Files</p>
                                <p className="text-xs text-neutral-400">Select MP3/FLAC/WAV/OGG/M4A files and add them to your library.</p>
                            </div>
                        </div>

                        <button onClick={metadataHook.importFiles} className="pro-button w-full flex items-center justify-center gap-2">
                            <FolderUp size={14} />
                            Choose Audio Files
                        </button>
                    </div>

                    <div className="bg-neutral-900/45 border border-white/10 rounded-2xl p-6 shadow-xl flex flex-col gap-4">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center">
                                <Film size={18} className="text-white/90" />
                            </div>
                            <div>
                                <p className="text-sm font-medium text-white">Extract Audio from Video</p>
                                <p className="text-xs text-neutral-400">Uses FFmpeg and prefers stream copy (`-c:a copy`) when the source codec already matches your selected output format.</p>
                            </div>
                        </div>

                        <div className="flex flex-col gap-3">
                            <div className="space-y-2">
                                <label className="pro-label">Output folder</label>
                                <div className="flex flex-col gap-2">
                                    <button onClick={chooseOutputDirectory} className="pro-button-secondary w-full flex items-center justify-center gap-2">
                                        <FolderOpen size={14} />
                                        {targetDir ? 'Change Output Folder' : 'Choose Output Folder'}
                                    </button>
                                    {targetDir && (
                                        <div className="text-xs text-neutral-300 border border-white/10 rounded-lg bg-neutral-950/40 px-3 py-2 break-all">
                                            {targetDir}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="pro-label">Output format</label>
                                <div className="grid grid-cols-2 gap-2">
                                    {(['mp3', 'wav'] as const).map(fmt => (
                                        <button
                                            key={fmt}
                                            onClick={() => setExtractFormat(fmt)}
                                            className={`pro-button-secondary w-full text-xs py-2 ${extractFormat === fmt ? 'bg-white/10 text-white border-white/20' : ''}`}
                                        >
                                            {fmt.toUpperCase()}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <label className="pro-label">Video file</label>
                            <button onClick={chooseVideo} className="pro-button-secondary w-full flex items-center justify-center gap-2">
                                <Clapperboard size={14} />
                                {videoPath ? 'Change Video File' : 'Choose Video File'}
                            </button>
                            {videoPath && (
                                <div className="text-xs text-neutral-300 border border-white/10 rounded-lg bg-neutral-950/40 px-3 py-2 break-all">
                                    {videoPath}
                                </div>
                            )}
                        </div>

                        <button
                            onClick={extractAudio}
                            disabled={isExtracting || !videoPath.trim() || !targetDir.trim()}
                            className="pro-button w-full flex items-center justify-center gap-2"
                        >
                            {isExtracting ? <Loader2 size={14} className="animate-spin" /> : <Music2 size={14} />}
                            {isExtracting ? 'Extracting…' : 'Extract + Import Audio'}
                        </button>
                    </div>
                </div>

                {status && (
                    <div className="text-sm text-emerald-300/90 bg-emerald-950/20 border border-emerald-500/20 rounded-xl px-4 py-3 flex items-center gap-2">
                        <CheckCircle2 size={15} />
                        <span>{status}</span>
                    </div>
                )}
                {error && <div className="text-sm text-rose-400">{error}</div>}
            </div>
        </div>
    );
};
