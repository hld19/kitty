import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DownloadCloud, FolderOpen, CheckCircle2, LogIn, LogOut, RefreshCw, AlertTriangle } from 'lucide-react';
import { DownloadMedia, SoundCloudBeginAuth, SoundCloudListLikes, SoundCloudLogout, SoundCloudStatus } from '../../wailsjs/go/main/App';
import { useMetadata } from '../hooks/useMetadata';

type Track = {
    title: string;
    artist: string;
    permalinkUrl: string;
    artworkUrl: string;
    durationMs: number;
};

type DownloadState = {
    state: 'downloading' | 'success' | 'error';
    message?: string;
};

interface Props {
    metadataHook: ReturnType<typeof useMetadata>;
    openSettings: () => void;
    consentEnabled: boolean;
    downloadDir: string;
    pickDirectory: () => Promise<void>;
    audioFormat: string;
    setAudioFormat: (v: string) => void;
    audioBitrate: string;
    setAudioBitrate: (v: string) => void;
}

export const SoundCloudLikes: React.FC<Props> = ({
    metadataHook,
    openSettings,
    consentEnabled,
    downloadDir,
    pickDirectory,
    audioFormat,
    setAudioFormat,
    audioBitrate,
    setAudioBitrate,
}) => {
    const [status, setStatus] = useState<{ configured: boolean; connected: boolean; username: string }>({ configured: false, connected: false, username: '' });
    const [error, setError] = useState<string | null>(null);
    const [isConnecting, setIsConnecting] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [tracks, setTracks] = useState<Track[]>([]);
    const [query, setQuery] = useState('');
    const [downloadingUrl, setDownloadingUrl] = useState<string | null>(null);
    const [downloadState, setDownloadState] = useState<Record<string, DownloadState>>({});
    const [autoLoaded, setAutoLoaded] = useState(false);
    const [loadInfo, setLoadInfo] = useState<string | null>(null);
    const loadSeq = useRef(0);
    const indicatorTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

    useEffect(() => {
        return () => {
            for (const t of Object.values(indicatorTimers.current)) {
                clearTimeout(t);
            }
        };
    }, []);

    const setIndicator = (url: string, next?: DownloadState) => {
        setDownloadState(prev => {
            const copy = { ...prev };
            if (!next) {
                delete copy[url];
                return copy;
            }
            copy[url] = next;
            return copy;
        });
    };

    const clearIndicatorTimer = (url: string) => {
        const t = indicatorTimers.current[url];
        if (t) clearTimeout(t);
        delete indicatorTimers.current[url];
    };

    const markSuccess = (url: string) => {
        clearIndicatorTimer(url);
        setIndicator(url, { state: 'success' });
        indicatorTimers.current[url] = setTimeout(() => {
            setIndicator(url, undefined);
        }, 3500);
    };

    const refreshStatus = async (silent = false) => {
        try {
            const s = await SoundCloudStatus();
            setStatus({ configured: !!(s as any)?.configured, connected: !!(s as any)?.connected, username: (s as any)?.username || '' });
        } catch (e: any) {
            if (!silent) {
                setError(e?.toString?.() ?? 'Failed to load SoundCloud status');
            }
        }
    };

    useEffect(() => {
        void refreshStatus(true);
    }, []);

    useEffect(() => {
        if (!status.connected) {
            setAutoLoaded(false);
        }
    }, [status.connected]);

    const loadAllLikes = async () => {
        setError(null);
        setIsLoading(true);
        setLoadInfo(null);
        setTracks([]);

        const seq = ++loadSeq.current;

        let href = '';
        let total = 0;
        let pages = 0;

        try {
            while (true) {
                const page = await SoundCloudListLikes(href);
                if (seq !== loadSeq.current) return;

                const pageTracks = ((page as any)?.tracks ?? []) as Track[];
                const nh = (((page as any)?.nextHref ?? '') as string).trim();

                total += pageTracks.length;
                setTracks(prev => [...prev, ...pageTracks]);
                setLoadInfo(`Loaded ${total} likes…`);

                href = nh;
                pages += 1;

                if (!href) break;
                if (pages >= 250) {
                    throw new Error('Too many liked tracks to load at once.');
                }
            }

            setLoadInfo(total > 0 ? `Loaded ${total} likes.` : 'No liked tracks found.');
        } catch (e: any) {
            if (seq !== loadSeq.current) return;
            setError(e?.toString?.() ?? 'Failed to load likes');
        } finally {
            if (seq === loadSeq.current) setIsLoading(false);
        }
    };

    const connect = async () => {
        setError(null);
        setIsConnecting(true);
        loadSeq.current += 1;
        try {
            const url = await SoundCloudBeginAuth();
            if (!url) {
                setError('Failed to start SoundCloud login');
                return;
            }
            const start = Date.now();
            while (Date.now() - start < 2 * 60_000) {
                await new Promise(r => setTimeout(r, 1000));
                const s = await SoundCloudStatus();
                if ((s as any)?.connected) {
                    setStatus({ configured: !!(s as any)?.configured, connected: true, username: (s as any)?.username || '' });
                    setAutoLoaded(true);
                    await loadAllLikes();
                    return;
                }
            }
            setError("Login timed out. If the SoundCloud page is blank, try a different browser or disable content blockers, then try again.");
        } catch (e: any) {
            setError(e?.toString?.() ?? 'Failed to start SoundCloud login');
        } finally {
            setIsConnecting(false);
        }
    };

    const logout = async () => {
        setError(null);
        loadSeq.current += 1;
        try {
            await SoundCloudLogout();
            setTracks([]);
            setAutoLoaded(false);
            setLoadInfo(null);
            setDownloadingUrl(null);
            setDownloadState({});
            await refreshStatus();
        } catch (e: any) {
            setError(e?.toString?.() ?? 'Failed to disconnect');
        }
    };

    useEffect(() => {
        if (!status.connected) return;
        if (autoLoaded) return;
        setAutoLoaded(true);
        void loadAllLikes();
    }, [status.connected, autoLoaded]);

    const canDownload = useMemo(() => consentEnabled && !!downloadDir, [consentEnabled, downloadDir]);

    const downloadTrack = async (t: Track) => {
        const url = (t.permalinkUrl || '').trim();
        if (!url) return;
        clearIndicatorTimer(url);

        if (!consentEnabled) {
            setIndicator(url, { state: 'error', message: 'Enable the downloader in Direct view first.' });
            return;
        }
        if (!downloadDir) {
            setIndicator(url, { state: 'error', message: 'Choose a download folder first.' });
            return;
        }
        if (downloadingUrl && downloadingUrl !== url) {
            return;
        }

        setDownloadingUrl(url);
        setIndicator(url, { state: 'downloading' });
        try {
            const result = await DownloadMedia(url, downloadDir, audioFormat, audioBitrate);
            const savedPath = (result as any)?.savedPath as string | undefined;
            if (!savedPath) {
                setIndicator(url, { state: 'error', message: 'Download cancelled.' });
                return;
            }
            try {
                await metadataHook.addFilesByPath([savedPath]);
            } catch (e: any) {
                setIndicator(url, { state: 'error', message: e?.toString?.() ?? 'Saved, but failed to import into library.' });
                return;
            }
            markSuccess(url);
        } catch (e: any) {
            setIndicator(url, { state: 'error', message: e?.toString?.() ?? 'Download failed' });
        } finally {
            setDownloadingUrl(null);
        }
    };

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return tracks;
        return tracks.filter(t => (t.title || '').toLowerCase().includes(q) || (t.artist || '').toLowerCase().includes(q));
    }, [tracks, query]);

    const formatDuration = (ms: number) => {
        if (!ms || ms <= 0) return '';
        const total = Math.floor(ms / 1000);
        const m = Math.floor(total / 60);
        const s = total % 60;
        return `${m}:${String(s).padStart(2, '0')}`;
    };

    return (
        <div className="max-w-4xl mx-auto mt-5 space-y-4">
            <div className="bg-gradient-to-br from-neutral-900/70 via-neutral-900/50 to-neutral-950/40 border border-white/10 rounded-2xl p-4 shadow-xl space-y-3">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="space-y-1">
                        <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">SoundCloud</p>
                        <h2 className="text-lg font-semibold text-white">Liked Songs</h2>
                        {status.connected && status.username && (
                            <p className="text-xs text-neutral-400">Signed in as {status.username}</p>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        {status.connected ? (
                            <>
                                <button
                                    onClick={() => { void loadAllLikes(); }}
                                    disabled={isLoading}
                                    className="pro-button-secondary-compact flex items-center gap-2"
                                >
                                    <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
                                    {isLoading ? 'Syncing' : 'Sync'}
                                </button>
                                <button onClick={logout} className="pro-button-secondary-compact flex items-center gap-2">
                                    <LogOut size={14} />
                                    Disconnect
                                </button>
                            </>
                        ) : (
                            <button onClick={connect} disabled={isConnecting || !status.configured} className="pro-button-compact flex items-center gap-2">
                                <LogIn size={14} />
                                {isConnecting ? 'Waiting…' : 'Connect'}
                            </button>
                        )}
                        <button onClick={openSettings} className="pro-button-secondary-compact text-xs px-3 py-2">
                            Settings
                        </button>
                    </div>
                </div>

                {!status.configured && !status.connected && (
                    <div className="flex items-center justify-between gap-4 flex-wrap rounded-xl border border-white/10 bg-neutral-950/30 px-4 py-3">
                        <div className="text-xs text-neutral-400">
                            Set your SoundCloud client id/secret in Settings to enable login.
                            <span className="font-mono text-neutral-300 ml-2">http://127.0.0.1:17877/oauth/soundcloud/callback</span>
                        </div>
                        <button onClick={openSettings} className="pro-button-secondary-compact text-xs px-3 py-2">
                            Open Settings
                        </button>
                    </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                    <div className="md:col-span-4 space-y-2">
                        <label className="pro-label">Search likes</label>
                        <input
                            className="pro-input-compact"
                            placeholder={status.connected ? 'Search' : 'Connect to search'}
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            disabled={!status.connected}
                        />
                    </div>
                    <div className="md:col-span-4 space-y-2">
                        <label className="pro-label">Download folder</label>
                        <button
                            onClick={pickDirectory}
                            className={`pro-input-compact text-left flex items-center gap-2 ${downloadDir ? '' : 'text-neutral-400'}`}
                        >
                            <FolderOpen size={14} className="text-neutral-500 shrink-0" />
                            <span className="truncate">{downloadDir ? downloadDir : 'Choose folder…'}</span>
                            {downloadDir && <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />}
                        </button>
                    </div>
                    <div className="md:col-span-2 space-y-2">
                        <label className="pro-label">Format</label>
                        <select className="pro-input-compact" value={audioFormat} onChange={e => setAudioFormat(e.target.value)}>
                            {['mp3', 'ogg', 'wav', 'opus'].map(opt => (
                                <option key={opt} value={opt}>{opt.toUpperCase()}</option>
                            ))}
                        </select>
                    </div>
                    <div className="md:col-span-2 space-y-2">
                        <label className="pro-label">Bitrate</label>
                        <select className="pro-input-compact" value={audioBitrate} onChange={e => setAudioBitrate(e.target.value)}>
                            {['320', '256', '128', '96', '64', '8'].map(opt => (
                                <option key={opt} value={opt}>{opt} kbps</option>
                            ))}
                        </select>
                    </div>
                </div>

                {status.connected && (
                    <div className="flex items-center justify-between gap-3 pt-1">
                        <div className="text-xs text-neutral-500">
                            {loadInfo ?? `${tracks.length} likes`}
                            {query.trim() ? <span className="text-neutral-600"> • {filtered.length} shown</span> : null}
                        </div>
                        {!consentEnabled && (
                            <div className="text-xs text-amber-300/90">
                                Enable the downloader in the Direct view to download.
                            </div>
                        )}
                    </div>
                )}

                {error && <div className="text-sm text-rose-400">{error}</div>}
            </div>

            {status.connected && isLoading && filtered.length === 0 && (
                <div className="text-xs text-neutral-500">Loading your likes…</div>
            )}

            {status.connected && !isLoading && tracks.length === 0 && (
                <div className="text-xs text-neutral-500">No liked tracks found.</div>
            )}

            {status.connected && tracks.length > 0 && filtered.length === 0 && query.trim() !== '' && (
                <div className="text-xs text-neutral-500">No matches.</div>
            )}

            {status.connected && filtered.length > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 pb-24">
                    {filtered.map(t => (
                        <div
                            key={t.permalinkUrl || `${t.artist}-${t.title}`}
                            className="rounded-xl border border-white/10 bg-neutral-900/35 px-3 py-2 flex items-center gap-3 overflow-hidden"
                        >
                            <div className="w-10 h-10 rounded-lg overflow-hidden bg-neutral-950 border border-white/5 shrink-0 flex items-center justify-center">
                                {t.artworkUrl ? (
                                    <img src={t.artworkUrl} alt="" className="w-full h-full object-cover" />
                                ) : (
                                    <DownloadCloud size={16} className="text-neutral-600" />
                                )}
                            </div>

                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 min-w-0">
                                    <div className="text-sm text-white font-semibold truncate" title={t.title || ''}>
                                        {t.title}
                                    </div>
                                    {t.durationMs > 0 && (
                                        <div className="text-[11px] text-neutral-500 tabular-nums shrink-0">{formatDuration(t.durationMs)}</div>
                                    )}
                                </div>
                                <div className="text-xs text-neutral-400 truncate" title={t.artist || ''}>
                                    {t.artist || 'SoundCloud'}
                                </div>
                            </div>

                            <button
                                onClick={() => downloadTrack(t)}
                                disabled={!!downloadingUrl && downloadingUrl !== t.permalinkUrl}
                                title={
                                    downloadState[t.permalinkUrl]?.state === 'error'
                                        ? (downloadState[t.permalinkUrl]?.message || 'Download failed')
                                        : (!canDownload ? 'Enable downloader in Direct view and choose a download folder.' : '')
                                }
                                className={
                                    downloadState[t.permalinkUrl]?.state === 'success'
                                        ? 'pro-button-secondary-compact flex items-center justify-center gap-2 shrink-0 border-emerald-500/20 text-emerald-200 bg-emerald-950/30 hover:bg-emerald-950/40'
                                        : downloadState[t.permalinkUrl]?.state === 'error'
                                            ? 'pro-button-secondary-compact flex items-center justify-center gap-2 shrink-0 border-rose-500/20 text-rose-200 bg-rose-950/20 hover:bg-rose-950/30'
                                            : (!canDownload
                                                ? 'pro-button-secondary-compact flex items-center justify-center gap-2 shrink-0'
                                                : 'pro-button-compact flex items-center justify-center gap-2 shrink-0')
                                }
                            >
                                {downloadState[t.permalinkUrl]?.state === 'downloading' ? (
                                    <>
                                        <RefreshCw size={14} className="animate-spin" />
                                        Downloading
                                    </>
                                ) : downloadState[t.permalinkUrl]?.state === 'success' ? (
                                    <>
                                        <CheckCircle2 size={14} />
                                        Saved
                                    </>
                                ) : downloadState[t.permalinkUrl]?.state === 'error' ? (
                                    <>
                                        <AlertTriangle size={14} />
                                        Retry
                                    </>
                                ) : (
                                    <>
                                        <DownloadCloud size={14} />
                                        Download
                                    </>
                                )}
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
