import React, { useMemo, useState } from 'react';
import { Trash2, AlertTriangle } from 'lucide-react';
import { GetDownloaderAutoStart, ResetAppData, SetDownloaderAutoStart, SoundCloudLogout, SoundCloudSetCredentials, SoundCloudStatus, SoundCloudValidateCredentials } from '../../wailsjs/go/main/App';
import { useMetadata } from '../hooks/useMetadata';

interface SettingsProps {
    metadataHook: ReturnType<typeof useMetadata>;
}

const STORAGE_KEYS = [
    'kitty_artist_images',
    'metago_artist_images',
    'kitty_downloader_consent',
    'kitty_downloader_dir',
    'kitty_sortBy',
    'kitty_filterBy',
];

export const Settings: React.FC<SettingsProps> = ({ metadataHook }) => {
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [confirmText, setConfirmText] = useState('');
    const [isResetting, setIsResetting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [dlAutoStart, setDlAutoStart] = useState(false);
    const [dlBusy, setDlBusy] = useState(false);
    const [dlInfo, setDlInfo] = useState<string | null>(null);
    const [dlError, setDlError] = useState<string | null>(null);

    const [scClientId, setScClientId] = useState('');
    const [scClientSecret, setScClientSecret] = useState('');
    const [scBusy, setScBusy] = useState(false);
    const [scInfo, setScInfo] = useState<string | null>(null);
    const [scError, setScError] = useState<string | null>(null);
    const [scStatus, setScStatus] = useState<{ configured: boolean; connected: boolean; username: string }>({
        configured: false,
        connected: false,
        username: '',
    });

    const canConfirm = useMemo(() => confirmText.trim().toUpperCase() === 'RESET', [confirmText]);

    const loadDownloaderSetting = async (silent = false) => {
        try {
            const auto = await GetDownloaderAutoStart();
            setDlAutoStart(!!auto);
        } catch (e: any) {
            if (!silent) setDlError(e?.toString?.() ?? 'Failed to load downloader setting');
        }
    };

    React.useEffect(() => {
        void loadDownloaderSetting(true);
    }, []);

    const refreshSoundCloud = async (silent = false) => {
        try {
            const s = await SoundCloudStatus();
            const cid = String((s as any)?.clientId ?? '').trim();
            setScStatus({
                configured: !!(s as any)?.configured,
                connected: !!(s as any)?.connected,
                username: (s as any)?.username || '',
            });
            setScClientId(prev => (prev.trim() === '' && cid ? cid : prev));
        } catch (e: any) {
            if (!silent) setScError(e?.toString?.() ?? 'Failed to load SoundCloud status');
        }
    };

    React.useEffect(() => {
        void refreshSoundCloud(true);
    }, []);

    const setDownloaderMode = async (autoStart: boolean) => {
        setDlError(null);
        setDlInfo(null);
        setDlBusy(true);
        try {
            await SetDownloaderAutoStart(autoStart);
            setDlAutoStart(autoStart);
            setDlInfo(autoStart ? 'Set to start on app launch.' : 'Set to start when downloading.');
        } catch (e: any) {
            setDlError(e?.toString?.() ?? 'Failed to save setting');
        } finally {
            setDlBusy(false);
        }
    };

    const saveSoundCloud = async () => {
        setScError(null);
        setScInfo(null);
        if (!scClientId.trim() || !scClientSecret.trim()) {
            setScError('Enter both client id and client secret.');
            return;
        }
        setScBusy(true);
        try {
            if (scStatus.connected) {
                await SoundCloudLogout();
            }
            await SoundCloudSetCredentials(scClientId.trim(), scClientSecret.trim());
            setScClientSecret('');
            setScInfo(scStatus.connected ? 'Updated. You were disconnected; reconnect from Downloader → SoundCloud Likes.' : 'Saved. You can now connect from Downloader → SoundCloud Likes.');
            await refreshSoundCloud(true);
        } catch (e: any) {
            setScError(e?.toString?.() ?? 'Failed to save credentials');
        } finally {
            setScBusy(false);
        }
    };

    const validateSoundCloud = async () => {
        setScError(null);
        setScInfo(null);
        setScBusy(true);
        try {
            await SoundCloudValidateCredentials();
            setScInfo('Credentials look valid.');
        } catch (e: any) {
            setScError(e?.toString?.() ?? 'Credential check failed');
        } finally {
            setScBusy(false);
        }
    };

    const clearSoundCloud = async () => {
        setScError(null);
        setScInfo(null);
        setScBusy(true);
        try {
            if (scStatus.connected) {
                await SoundCloudLogout();
            }
            await SoundCloudSetCredentials('', '');
            setScClientId('');
            setScClientSecret('');
            setScInfo('Cleared.');
            await refreshSoundCloud(true);
        } catch (e: any) {
            setScError(e?.toString?.() ?? 'Failed to clear credentials');
        } finally {
            setScBusy(false);
        }
    };

    const disconnectSoundCloud = async () => {
        setScError(null);
        setScInfo(null);
        setScBusy(true);
        try {
            await SoundCloudLogout();
            setScInfo('Disconnected.');
            await refreshSoundCloud(true);
        } catch (e: any) {
            setScError(e?.toString?.() ?? 'Failed to disconnect');
        } finally {
            setScBusy(false);
        }
    };

    const reset = async () => {
        setError(null);
        setIsResetting(true);
        try {
            await ResetAppData();
            for (const k of STORAGE_KEYS) {
                try {
                    localStorage.removeItem(k);
                } catch {
                }
            }
            window.location.reload();
        } catch (e: any) {
            setError(e?.toString?.() ?? 'Reset failed');
        } finally {
            setIsResetting(false);
        }
    };

    return (
        <div className="h-full w-full overflow-y-auto px-8 pb-24 pt-6">
            <div className="max-w-3xl mx-auto space-y-6">
                <div className="space-y-1">
                    <p className="text-xs uppercase tracking-[0.24em] text-neutral-500">Settings</p>
                    <h1 className="text-2xl font-semibold text-white">Settings</h1>
                </div>

                <div className="bg-neutral-900/40 border border-white/10 rounded-2xl p-6 shadow-xl space-y-4">
                    <div className="space-y-1">
                        <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Downloader</p>
                        <p className="text-sm text-white font-medium">Cobalt API startup</p>
                    </div>

                    <div className="text-xs text-neutral-500">
                        Host:
                        <span className="font-mono text-neutral-300 ml-2">http://127.0.0.1:8787</span>
                    </div>

                    <div className="space-y-2">
                        <label className="pro-label">Startup</label>
                        <div className="flex flex-wrap gap-2">
                            <button
                                onClick={() => void setDownloaderMode(true)}
                                disabled={dlBusy}
                                className={`pro-button-secondary text-xs px-3 py-2 ${dlAutoStart ? 'bg-white/10 text-white border-white/20' : ''}`}
                            >
                                Start on app launch
                            </button>
                            <button
                                onClick={() => void setDownloaderMode(false)}
                                disabled={dlBusy}
                                className={`pro-button-secondary text-xs px-3 py-2 ${!dlAutoStart ? 'bg-white/10 text-white border-white/20' : ''}`}
                            >
                                Start when downloading
                            </button>
                        </div>
                        <div className="text-xs text-neutral-500">
                            If set to start when downloading, Kitty will start cobalt automatically when you press Download (including SoundCloud Likes).
                        </div>
                    </div>

                    {dlInfo && <div className="text-sm text-emerald-300/90">{dlInfo}</div>}
                    {dlError && <div className="text-sm text-rose-400">{dlError}</div>}
                </div>

                <div className="bg-neutral-900/40 border border-white/10 rounded-2xl p-6 shadow-xl space-y-4">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div className="space-y-1">
                            <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">SoundCloud</p>
                            <p className="text-sm text-white font-medium">API credentials</p>
                            {scStatus.connected && scStatus.username && (
                                <p className="text-xs text-neutral-400">Connected as {scStatus.username}</p>
                            )}
                            {!scStatus.connected && scStatus.configured && (
                                <p className="text-xs text-neutral-400">Configured. Connect from Downloader → SoundCloud Likes.</p>
                            )}
                        </div>

                        {scStatus.connected && (
                            <button onClick={disconnectSoundCloud} disabled={scBusy} className="pro-button-secondary text-xs px-3 py-2">
                                Disconnect
                            </button>
                        )}
                    </div>

                    <div className="text-xs text-neutral-500">
                        Redirect URI:
                        <span className="font-mono text-neutral-300 ml-2">http://127.0.0.1:17877/oauth/soundcloud/callback</span>
                    </div>

                    <div className="grid md:grid-cols-2 gap-4">
                        <div>
                            <label className="pro-label">Client ID</label>
                            <input
                                className="pro-input"
                                value={scClientId}
                                onChange={e => setScClientId(e.target.value)}
                                spellCheck={false}
                                disabled={scBusy}
                            />
                        </div>
                        <div>
                            <label className="pro-label">Client Secret</label>
                            <input
                                className="pro-input"
                                type="password"
                                value={scClientSecret}
                                onChange={e => setScClientSecret(e.target.value)}
                                spellCheck={false}
                                disabled={scBusy}
                                placeholder={scStatus.configured ? '••••••••••••••••' : ''}
                            />
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <button onClick={saveSoundCloud} disabled={scBusy} className="pro-button">
                            Save
                        </button>
                        <button onClick={validateSoundCloud} disabled={scBusy} className="pro-button-secondary">
                            Validate
                        </button>
                        <button onClick={clearSoundCloud} disabled={scBusy} className="pro-button-secondary">
                            Clear
                        </button>
                        <button onClick={() => { void refreshSoundCloud(); }} disabled={scBusy} className="pro-button-secondary">
                            Refresh
                        </button>
                    </div>

                    {scInfo && <div className="text-sm text-emerald-300/90">{scInfo}</div>}
                    {scError && <div className="text-sm text-rose-400">{scError}</div>}
                </div>

                <div className="bg-neutral-900/40 border border-white/10 rounded-2xl p-6 shadow-xl space-y-4">
                    <div className="flex items-start gap-3">
                        <AlertTriangle className="text-amber-300 mt-0.5" size={18} />
                        <div className="space-y-1">
                            <p className="text-sm text-white font-medium">Reset app data</p>
                            <p className="text-xs text-neutral-400 leading-relaxed">
                                This clears Kitty&apos;s saved library list and local UI data (artist images, downloader folder,
                                sort/filter preferences), plus any saved SoundCloud login/credentials. It does not delete your music files or revert tag changes.
                            </p>
                        </div>
                    </div>

                    {!confirmOpen ? (
                        <button
                            onClick={() => { setConfirmOpen(true); setConfirmText(''); metadataHook.clearError?.(); }}
                            className="pro-button-secondary flex items-center gap-2"
                        >
                            <Trash2 size={14} />
                            Reset App Data…
                        </button>
                    ) : (
                        <div className="space-y-3">
                            <div className="text-xs text-neutral-400">
                                Type <span className="font-mono text-neutral-200">RESET</span> to confirm.
                            </div>
                            <input
                                className="pro-input"
                                value={confirmText}
                                onChange={e => setConfirmText(e.target.value)}
                                placeholder="RESET"
                                spellCheck={false}
                            />
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={reset}
                                    disabled={!canConfirm || isResetting}
                                    className="pro-button flex items-center gap-2"
                                >
                                    <Trash2 size={14} />
                                    {isResetting ? 'Resetting…' : 'Confirm Reset'}
                                </button>
                                <button
                                    onClick={() => { setConfirmOpen(false); setConfirmText(''); setError(null); }}
                                    className="pro-button-secondary"
                                    disabled={isResetting}
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}

                    {error && <div className="text-sm text-rose-400">{error}</div>}
                </div>
            </div>
        </div>
    );
};
