import React, { useEffect, useState } from 'react';
import { DownloadMedia, StartDownloader, ChooseDownloadFolder } from '../../wailsjs/go/main/App';
import { useMetadata } from '../hooks/useMetadata';
import { AlertTriangle, DownloadCloud, PlugZap, FolderOpen, CheckCircle2 } from 'lucide-react';
import { SoundCloudLikes } from './SoundCloudLikes';

interface DownloaderProps {
    metadataHook: ReturnType<typeof useMetadata>;
    openSettings: () => void;
}

const CONSENT_KEY = 'kitty_downloader_consent';
const DIR_KEY = 'kitty_downloader_dir';

export const Downloader: React.FC<DownloaderProps> = ({ metadataHook, openSettings }) => {
    const [view, setView] = useState<'direct' | 'soundcloud'>('direct');
    const [link, setLink] = useState('');
    const [status, setStatus] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [isStarting, setIsStarting] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);
    const [consent, setConsent] = useState<boolean>(() => {
        return localStorage.getItem(CONSENT_KEY) === '1';
    });
    const [downloadDir, setDownloadDir] = useState<string>(() => localStorage.getItem(DIR_KEY) || '');
    const [audioFormat, setAudioFormat] = useState('mp3');
    const [audioBitrate, setAudioBitrate] = useState('320');

    useEffect(() => {
        if (!consent) return;
        let cancelled = false;
        (async () => {
            try {
                await StartDownloader();
            } catch (err: any) {
                if (!cancelled) {
                    setError(err?.toString?.() ?? 'Failed to start downloader');
                }
            }
        })();
        return () => { cancelled = true; };
    }, [consent]);

    const pickDirectory = async () => {
        try {
            const dir = await ChooseDownloadFolder();
            if (dir) {
                setDownloadDir(dir);
                localStorage.setItem(DIR_KEY, dir);
            }
        } catch (err: any) {
            setError(err?.toString?.() ?? 'Failed to choose folder');
        }
    };

    const handleDownload = async () => {
        setError(null);
        setStatus('');
        if (!link.trim()) {
            setError('Please paste a link first.');
            return;
        }
        if (!downloadDir) {
            setError('Choose a download folder first.');
            return;
        }
        setIsDownloading(true);
        try {
            await StartDownloader();
            const result = await DownloadMedia(link.trim(), downloadDir, audioFormat, audioBitrate);
            const savedPath = (result as any)?.savedPath as string | undefined;
            if (savedPath) {
                await metadataHook.addFilesByPath([savedPath]);
                setStatus(`Saved to ${savedPath}`);
                setLink('');
            } else {
                setStatus('Download cancelled.');
            }
        } catch (err: any) {
            setError(err?.toString?.() ?? 'Download failed');
        } finally {
            setIsDownloading(false);
        }
    };

    const handleConsent = async () => {
        setError(null);
        setIsStarting(true);
        try {
            await StartDownloader();
            setConsent(true);
            localStorage.setItem(CONSENT_KEY, '1');
        } catch (err: any) {
            setError(err?.toString?.() ?? 'Failed to start downloader');
        } finally {
            setIsStarting(false);
        }
    };

    return (
        <div className="h-full w-full overflow-hidden bg-neutral-950/95 flex flex-col min-h-0 relative">
            <div className="px-8 pt-6 pb-3 sticky top-0 z-10 bg-neutral-950/85 backdrop-blur-lg flex items-center">
                <div className="flex-1 flex items-end justify-between gap-4">
                    <div className="flex flex-col gap-1">
                        <p className="text-xs uppercase tracking-[0.24em] text-neutral-500">Downloader</p>
                        <h1 className="text-2xl font-semibold text-white leading-tight flex items-center gap-2">
                            <span className="text-amber-300 text-lg">@_@</span>
                        </h1>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setView('direct')}
                            className={`pro-button-secondary text-xs px-3 py-2 ${view === 'direct' ? 'bg-white/10 text-white border-white/20' : ''}`}
                        >
                            Direct
                        </button>
                        <button
                            onClick={() => setView('soundcloud')}
                            className={`pro-button-secondary text-xs px-3 py-2 ${view === 'soundcloud' ? 'bg-white/10 text-white border-white/20' : ''}`}
                        >
                            SoundCloud Likes
                        </button>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto px-8 pb-24">
                {view === 'direct' ? (
                    !consent ? (
                        <div className="h-full w-full flex items-center justify-center px-6">
                            <div className="max-w-xl w-full bg-neutral-900/60 border border-white/10 rounded-2xl p-8 shadow-2xl space-y-6">
                                <div className="flex items-center gap-3">
                                    <AlertTriangle className="text-amber-400" />
                                    <div>
                                        <h2 className="text-lg font-semibold text-white">Enable Media Downloader</h2>
                                        <p className="text-sm text-neutral-400">To use this feature, Kitty will self-host the bundled cobalt API in the background.</p>
                                    </div>
                                </div>
                                <p className="text-xs text-neutral-500">
                                    Kitty will start the bundled cobalt API in the background, bound to <code>http://127.0.0.1:8787</code>.
                                    If dependencies are missing, it may run a one-time install using pnpm or npm. Continue?
                                </p>
                                <div className="flex gap-3">
                                    <button
                                        onClick={handleConsent}
                                        disabled={isStarting}
                                        className="pro-button flex items-center gap-2"
                                    >
                                        <PlugZap size={14} />
                                        {isStarting ? 'Starting…' : 'Yes, enable'}
                                    </button>
                                    <button
                                        onClick={() => { setConsent(false); localStorage.setItem(CONSENT_KEY, '0'); }}
                                        className="pro-button-secondary"
                                    >
                                        No
                                    </button>
                                </div>
                                {error && <div className="text-sm text-rose-400">{error}</div>}
                            </div>
                        </div>
                    ) : (
                        <div className="max-w-4xl mx-auto grid md:grid-cols-5 gap-6 mt-6">
                            <div className="md:col-span-5 bg-gradient-to-br from-neutral-900/80 via-neutral-900/70 to-neutral-800/60 border border-white/10 rounded-2xl p-6 shadow-xl space-y-5">
                                <div className="space-y-2">
                                    <label className="pro-label">Media link</label>
                                    <input
                                        className="pro-input w-full"
                                        placeholder="Paste a link from YouTube, TikTok, Twitter/X, SoundCloud..."
                                        value={link}
                                        onChange={e => setLink(e.target.value)}
                                    />
                                </div>

                                <div className="space-y-2">
                                    <label className="pro-label">Download folder</label>
                                    <div className="flex flex-col sm:flex-row gap-3">
                                        <button
                                            onClick={pickDirectory}
                                            className="pro-button-secondary flex items-center justify-center gap-2 whitespace-nowrap w-full sm:w-auto"
                                        >
                                            <FolderOpen size={14} />
                                            {downloadDir ? 'Change folder' : 'Choose folder'}
                                        </button>
                                        {downloadDir && (
                                            <div className="flex items-center gap-2 text-xs text-neutral-200 px-3 py-2 rounded-lg border border-white/10 bg-neutral-900/60 flex-1">
                                                <CheckCircle2 size={14} className="text-emerald-400" />
                                                <span className="truncate">{downloadDir}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="grid sm:grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="pro-label">Format</label>
                                        <div className="grid grid-cols-2 gap-2">
                                            {['mp3','ogg','wav','opus'].map(opt => (
                                                <button
                                                    key={opt}
                                                    onClick={() => setAudioFormat(opt)}
                                                    className={`pro-button-secondary w-full text-xs py-2 ${audioFormat === opt ? 'bg-white/10 text-white border-white/20' : ''}`}
                                                >
                                                    {opt.toUpperCase()}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="pro-label">Bitrate</label>
                                        <div className="grid grid-cols-3 gap-2">
                                            {['320','256','128','96','64','8'].map(opt => (
                                                <button
                                                    key={opt}
                                                    onClick={() => setAudioBitrate(opt)}
                                                    className={`pro-button-secondary w-full text-xs py-2 ${audioBitrate === opt ? 'bg-white/10 text-white border-white/20' : ''}`}
                                                >
                                                    {opt} kbps
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex flex-col sm:flex-row gap-3">
                                    <button
                                        onClick={handleDownload}
                                        disabled={isDownloading}
                                        className="pro-button flex items-center justify-center gap-2 whitespace-nowrap w-full sm:w-auto"
                                    >
                                        <DownloadCloud size={14} />
                                        {isDownloading ? 'Downloading…' : 'Download'}
                                    </button>
                                </div>

                                {status && <div className="text-sm text-neutral-300">{status}</div>}
                                {error && <div className="text-sm text-rose-400">{error}</div>}
                                <p className="text-xs text-neutral-500">
                                    Files save to your chosen folder and auto-import into your Kitty library.
                                </p>
                            </div>
                        </div>
                    )
                ) : (
                    <SoundCloudLikes
                        metadataHook={metadataHook}
                        openSettings={openSettings}
                        consentEnabled={consent}
                        downloadDir={downloadDir}
                        pickDirectory={pickDirectory}
                        audioFormat={audioFormat}
                        setAudioFormat={setAudioFormat}
                        audioBitrate={audioBitrate}
                        setAudioBitrate={setAudioBitrate}
                    />
                )}
            </div>
            {view === 'direct' && (
                <pre
                    className="pointer-events-none text-neutral-400 text-base sm:text-lg whitespace-pre leading-6 absolute right-6 bottom-6 opacity-80"
                    style={{ fontFamily: '"SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' }}
                >
{`  ╱|、
 (˚ˎ 。7
  |、˜〵
  じしˍ,)ノ`}
                </pre>
            )}
        </div>
    );
};
