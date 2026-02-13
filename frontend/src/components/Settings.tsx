import React, { useMemo, useState } from 'react';
import { Trash2, AlertTriangle } from 'lucide-react';
import { ResetAppData } from '../../wailsjs/go/main/App';
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

    const canConfirm = useMemo(() => confirmText.trim().toUpperCase() === 'RESET', [confirmText]);

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
                    <h1 className="text-2xl font-semibold text-white">App Data</h1>
                </div>

                <div className="bg-neutral-900/40 border border-white/10 rounded-2xl p-6 shadow-xl space-y-4">
                    <div className="flex items-start gap-3">
                        <AlertTriangle className="text-amber-300 mt-0.5" size={18} />
                        <div className="space-y-1">
                            <p className="text-sm text-white font-medium">Reset Kitty</p>
                            <p className="text-xs text-neutral-400 leading-relaxed">
                                This clears Kitty&apos;s saved library list and local UI data (artist images, downloader consent/folder,
                                sort/filter preferences). It does not delete your music files or revert tag changes.
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
