import React, { useEffect, useMemo, useState } from 'react';
import { metadata } from '../../wailsjs/go/models';
import { BulkUpdateMetadata } from '../../wailsjs/go/main/App';
import { useMetadata } from '../hooks/useMetadata';
import { Search, CheckSquare, Square, ImagePlus, Save, AlertTriangle, CheckCircle2 } from 'lucide-react';

type SortBy = 'recent' | 'title' | 'artist' | 'album';

type BulkUpdateErrorItem = {
    filePath: string;
    error: string;
};

type BulkUpdateResult = {
    total: number;
    succeeded: number;
    failed: number;
    updated: metadata.TrackMetadata[];
    errors: BulkUpdateErrorItem[];
};

type BulkPatch = {
    applyAlbumArtist: boolean;
    albumArtist: string;
    applyArtist: boolean;
    artist: string;
    applyAlbum: boolean;
    album: string;
    applyGenre: boolean;
    genre: string;
    applyYear: boolean;
    year: string;
    applyCoverImage: boolean;
    coverImage: string;
    applyComment: boolean;
    comment: string;
};

interface BulkEditorProps {
    metadataHook: ReturnType<typeof useMetadata>;
}

const defaultPatch: BulkPatch = {
    applyAlbumArtist: false,
    albumArtist: '',
    applyArtist: false,
    artist: '',
    applyAlbum: false,
    album: '',
    applyGenre: false,
    genre: '',
    applyYear: false,
    year: '',
    applyCoverImage: false,
    coverImage: '',
    applyComment: false,
    comment: '',
};

export const BulkEditor: React.FC<BulkEditorProps> = ({ metadataHook }) => {
    const { fileList, applyTrackUpdates } = metadataHook;
    const [query, setQuery] = useState('');
    const [sortBy, setSortBy] = useState<SortBy>('recent');
    const [panelMode, setPanelMode] = useState<'songs' | 'edit'>('songs');
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [patch, setPatch] = useState<BulkPatch>(defaultPatch);
    const [isApplying, setIsApplying] = useState(false);
    const [status, setStatus] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [batchErrors, setBatchErrors] = useState<BulkUpdateErrorItem[]>([]);

    useEffect(() => {
        const validPaths = new Set(fileList.map((t) => t.filePath));
        setSelected(prev => {
            let changed = false;
            const next = new Set<string>();
            prev.forEach(p => {
                if (validPaths.has(p)) {
                    next.add(p);
                } else {
                    changed = true;
                }
            });
            return changed ? next : prev;
        });
    }, [fileList]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        const orderIndex = new Map<string, number>();
        fileList.forEach((t, i) => orderIndex.set(t.filePath, i));

        const next = fileList.filter((t) => {
            if (!q) return true;
            return (
                (t.title || '').toLowerCase().includes(q) ||
                (t.artist || '').toLowerCase().includes(q) ||
                (t.album || '').toLowerCase().includes(q) ||
                (t.fileName || '').toLowerCase().includes(q)
            );
        });

        return next.sort((a, b) => {
            if (sortBy === 'recent') {
                const ia = orderIndex.get(a.filePath) ?? 0;
                const ib = orderIndex.get(b.filePath) ?? 0;
                return ib - ia;
            }
            const get = (t: metadata.TrackMetadata) => {
                if (sortBy === 'title') return t.title || t.fileName;
                if (sortBy === 'artist') return t.artist || 'Unknown Artist';
                return t.album || 'Unknown Album';
            };
            return get(a).localeCompare(get(b));
        });
    }, [fileList, query, sortBy]);

    const selectedCount = selected.size;
    const visibleSelectedCount = useMemo(
        () => filtered.reduce((count, t) => count + (selected.has(t.filePath) ? 1 : 0), 0),
        [filtered, selected]
    );
    const allVisibleSelected = filtered.length > 0 && visibleSelectedCount === filtered.length;

    const hasAnyFieldEnabled =
        patch.applyAlbumArtist ||
        patch.applyArtist ||
        patch.applyAlbum ||
        patch.applyGenre ||
        patch.applyYear ||
        patch.applyCoverImage ||
        patch.applyComment;

    const toggleTrack = (path: string) => {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(path)) {
                next.delete(path);
            } else {
                next.add(path);
            }
            return next;
        });
    };

    const toggleAllVisible = () => {
        setSelected(prev => {
            const next = new Set(prev);
            if (allVisibleSelected) {
                filtered.forEach(t => next.delete(t.filePath));
            } else {
                filtered.forEach(t => next.add(t.filePath));
            }
            return next;
        });
    };

    const clearSelection = () => setSelected(new Set());

    const setPatchField = <K extends keyof BulkPatch>(key: K, value: BulkPatch[K]) => {
        setPatch(prev => ({ ...prev, [key]: value }));
    };

    const enabledFieldLabels = useMemo(() => {
        const labels: string[] = [];
        if (patch.applyAlbumArtist) labels.push('Album Artist');
        if (patch.applyArtist) labels.push('Artist');
        if (patch.applyAlbum) labels.push('Album');
        if (patch.applyGenre) labels.push('Genre');
        if (patch.applyYear) labels.push('Year');
        if (patch.applyCoverImage) labels.push('Album Cover');
        if (patch.applyComment) labels.push('Comment');
        return labels;
    }, [patch]);

    const onCoverPicked = (file?: File | null) => {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const data = ev.target?.result;
            if (typeof data !== 'string' || !data) {
                setError('Failed to read selected image.');
                return;
            }
            setPatch(prev => ({
                ...prev,
                applyCoverImage: true,
                coverImage: data,
            }));
            setError(null);
        };
        reader.onerror = () => setError('Failed to read selected image.');
        reader.readAsDataURL(file);
    };

    const applyBulkChanges = async () => {
        if (selectedCount === 0) {
            setError('Select at least one track.');
            return;
        }
        if (!hasAnyFieldEnabled) {
            setError('Enable at least one field to update.');
            return;
        }
        if (patch.applyCoverImage && !patch.coverImage) {
            setError('Choose a cover image before applying.');
            return;
        }

        const selectedPaths = Array.from(selected);
        const confirmMessage = `Apply ${enabledFieldLabels.join(', ')} to ${selectedPaths.length} tracks?`;
        if (!window.confirm(confirmMessage)) {
            return;
        }

        setIsApplying(true);
        setStatus(null);
        setError(null);
        setBatchErrors([]);

        try {
            const res = await BulkUpdateMetadata(selectedPaths, {
                applyAlbumArtist: patch.applyAlbumArtist,
                albumArtist: patch.albumArtist,
                applyArtist: patch.applyArtist,
                artist: patch.artist,
                applyAlbum: patch.applyAlbum,
                album: patch.album,
                applyGenre: patch.applyGenre,
                genre: patch.genre,
                applyYear: patch.applyYear,
                year: patch.year.trim() === '' ? 0 : (parseInt(patch.year, 10) || 0),
                applyCoverImage: patch.applyCoverImage,
                coverImage: patch.coverImage,
                applyComment: patch.applyComment,
                comment: patch.comment,
            }) as BulkUpdateResult;

            if (res?.updated?.length > 0) {
                applyTrackUpdates(res.updated);
            }

            const total = res?.total ?? selectedPaths.length;
            const succeeded = res?.succeeded ?? 0;
            const failed = res?.failed ?? 0;
            setStatus(`Updated ${succeeded}/${total} tracks${failed > 0 ? ` (${failed} failed)` : ''}.`);
            setBatchErrors(res?.errors ?? []);
        } catch (e: any) {
            setError(e?.toString?.() ?? 'Bulk update failed.');
        } finally {
            setIsApplying(false);
        }
    };

    return (
        <div className="h-full w-full overflow-hidden bg-neutral-950/95 flex flex-col min-h-0">
            <div className="sticky top-0 z-10 px-8 pt-5 pb-3 bg-[linear-gradient(180deg,rgba(10,10,13,0.96),rgba(10,10,13,0.84))] backdrop-blur-lg border-b border-white/5">
                <div className="space-y-1">
                    <p className="text-xs uppercase tracking-[0.22em] text-neutral-500">Metadata</p>
                    <h1 className="text-2xl font-semibold text-white">Bulk Edit</h1>
                </div>
            </div>

            <div className="flex-1 min-h-0 px-8 pb-16">
                <div className="h-full bg-[linear-gradient(180deg,rgba(38,38,48,0.32),rgba(20,20,25,0.25))] border border-white/10 rounded-2xl shadow-xl flex flex-col overflow-hidden">
                    <div className="px-5 py-4 border-b border-white/10 bg-neutral-950/55 backdrop-blur flex items-center justify-between gap-4 flex-wrap">
                        <div className="space-y-1">
                            <p className="text-xs uppercase tracking-[0.18em] text-neutral-500">
                                {panelMode === 'songs' ? 'Song Selection' : 'Edit Selected Songs'}
                            </p>
                            <p className="text-sm text-neutral-300">
                                {panelMode === 'songs'
                                    ? 'Choose the songs you want to update, then switch to Edit.'
                                    : 'Set the fields you want, then apply to selected songs.'}
                            </p>
                        </div>

                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setPanelMode('songs')}
                                className={`pro-button-secondary-compact ${panelMode === 'songs' ? 'bg-white/10 text-white border-white/20' : ''}`}
                            >
                                Songs
                            </button>
                            <button
                                onClick={() => setPanelMode('edit')}
                                className={`pro-button-secondary-compact ${panelMode === 'edit' ? 'bg-white/10 text-white border-white/20' : ''}`}
                            >
                                Edit
                            </button>
                        </div>
                    </div>

                    {panelMode === 'songs' ? (
                        <>
                            <div className="px-5 py-3 border-b border-white/10 bg-neutral-950/45 backdrop-blur-sm flex items-center gap-2 flex-wrap">
                                <div className="flex items-center gap-2 bg-neutral-900/80 rounded-full px-3 py-2 shadow-sm shadow-black/30 border border-white/10">
                                    <Search size={14} className="text-neutral-500" />
                                    <input
                                        value={query}
                                        onChange={e => setQuery(e.target.value)}
                                        placeholder="Search title, artist, album, filename"
                                        className="bg-transparent text-[12px] text-white outline-none placeholder:text-neutral-600 w-64 max-w-[56vw]"
                                    />
                                </div>
                                <div className="flex items-center gap-1 bg-neutral-900/80 rounded-full px-2 py-1 border border-white/10 shadow-sm shadow-black/20">
                                    <span className="text-[10px] uppercase tracking-[0.12em] text-neutral-500 px-1">Sort</span>
                                    <select
                                        value={sortBy}
                                        onChange={e => setSortBy(e.target.value as SortBy)}
                                        className="bg-transparent text-neutral-200 text-[12px] px-2 py-0.5 rounded-full focus:outline-none"
                                    >
                                        <option value="recent">Recently added</option>
                                        <option value="title">Title</option>
                                        <option value="artist">Artist</option>
                                        <option value="album">Album</option>
                                    </select>
                                </div>
                                <button
                                    onClick={toggleAllVisible}
                                    className="pro-button-secondary-compact flex items-center gap-1.5"
                                    disabled={filtered.length === 0}
                                >
                                    {allVisibleSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                                    {allVisibleSelected ? 'Unselect visible' : 'Select visible'}
                                </button>
                                <button onClick={clearSelection} className="pro-button-secondary-compact" disabled={selectedCount === 0}>
                                    Clear
                                </button>
                            </div>

                            <div className="flex-1 overflow-y-auto p-3 space-y-2">
                                {filtered.length === 0 ? (
                                    <div className="h-full flex items-center justify-center text-sm text-neutral-600 px-4">
                                        No tracks match your search.
                                    </div>
                                ) : (
                                    filtered.map((track) => {
                                        const isSelected = selected.has(track.filePath);
                                        return (
                                            <label
                                                key={track.filePath}
                                                className={[
                                                    'w-full rounded-xl border px-3 py-2.5 flex items-center gap-3 cursor-pointer transition-all',
                                                    isSelected
                                                        ? 'bg-white/[0.08] border-white/30 shadow-[0_6px_18px_rgba(0,0,0,0.28)]'
                                                        : 'bg-neutral-950/35 border-white/10 hover:bg-white/[0.04] hover:border-white/20',
                                                ].join(' ')}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() => toggleTrack(track.filePath)}
                                                    className="accent-white h-4 w-4"
                                                />
                                                <div className="w-11 h-11 rounded-md overflow-hidden bg-neutral-950 border border-white/10 shrink-0">
                                                    {track.coverImage ? (
                                                        <img src={track.coverImage} alt="" className="w-full h-full object-cover" />
                                                    ) : (
                                                        <div className="w-full h-full flex items-center justify-center text-neutral-700 text-[10px]">No Art</div>
                                                    )}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-2">
                                                        <div className="text-sm text-white truncate">{track.title || track.fileName}</div>
                                                        {track.format && (
                                                            <span className="text-[10px] uppercase tracking-[0.1em] px-2 py-0.5 rounded-full border border-white/10 text-neutral-300 shrink-0">
                                                                {track.format}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="text-xs text-neutral-400 truncate">
                                                        {track.artist || 'Unknown Artist'} • {track.album || 'Unknown Album'}
                                                    </div>
                                                    <div className="text-[11px] text-neutral-600 truncate font-mono">{track.fileName}</div>
                                                </div>
                                            </label>
                                        );
                                    })
                                )}
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="px-5 py-3 border-b border-white/10 bg-neutral-950/45 backdrop-blur-sm">
                                {selectedCount === 0 ? (
                                    <p className="text-xs text-amber-300/90">No songs selected yet. Go to Songs, select tracks, then come back to Edit.</p>
                                ) : (
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        <span className="text-xs text-neutral-400 mr-1">Active fields:</span>
                                        {enabledFieldLabels.length === 0 ? (
                                            <span className="text-xs text-neutral-500">none</span>
                                        ) : (
                                            enabledFieldLabels.map((label) => (
                                                <span
                                                    key={label}
                                                    className="text-[10px] uppercase tracking-[0.1em] px-2 py-1 rounded-full border border-sky-500/25 bg-sky-900/20 text-sky-200"
                                                >
                                                    {label}
                                                </span>
                                            ))
                                        )}
                                    </div>
                                )}
                            </div>

                            <div className="flex-1 overflow-y-auto p-5">
                                <div className="grid sm:grid-cols-2 gap-2">
                                    <label className="rounded-lg border border-white/10 bg-neutral-950/35 p-2 space-y-1.5">
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="checkbox"
                                                checked={patch.applyAlbumArtist}
                                                onChange={e => setPatchField('applyAlbumArtist', e.target.checked)}
                                                className="accent-white"
                                            />
                                            <span className="text-xs text-neutral-200">Album Artist</span>
                                        </div>
                                        <input
                                            className="pro-input-compact"
                                            disabled={!patch.applyAlbumArtist}
                                            value={patch.albumArtist}
                                            onChange={e => setPatchField('albumArtist', e.target.value)}
                                            placeholder="Set album artist"
                                        />
                                    </label>

                                    <label className="rounded-lg border border-white/10 bg-neutral-950/35 p-2 space-y-1.5">
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="checkbox"
                                                checked={patch.applyArtist}
                                                onChange={e => setPatchField('applyArtist', e.target.checked)}
                                                className="accent-white"
                                            />
                                            <span className="text-xs text-neutral-200">Artist</span>
                                        </div>
                                        <input
                                            className="pro-input-compact"
                                            disabled={!patch.applyArtist}
                                            value={patch.artist}
                                            onChange={e => setPatchField('artist', e.target.value)}
                                            placeholder="Set artist"
                                        />
                                    </label>

                                    <label className="rounded-lg border border-white/10 bg-neutral-950/35 p-2 space-y-1.5">
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="checkbox"
                                                checked={patch.applyAlbum}
                                                onChange={e => setPatchField('applyAlbum', e.target.checked)}
                                                className="accent-white"
                                            />
                                            <span className="text-xs text-neutral-200">Album</span>
                                        </div>
                                        <input
                                            className="pro-input-compact"
                                            disabled={!patch.applyAlbum}
                                            value={patch.album}
                                            onChange={e => setPatchField('album', e.target.value)}
                                            placeholder="Set album"
                                        />
                                    </label>

                                    <label className="rounded-lg border border-white/10 bg-neutral-950/35 p-2 space-y-1.5">
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="checkbox"
                                                checked={patch.applyGenre}
                                                onChange={e => setPatchField('applyGenre', e.target.checked)}
                                                className="accent-white"
                                            />
                                            <span className="text-xs text-neutral-200">Genre</span>
                                        </div>
                                        <input
                                            className="pro-input-compact"
                                            disabled={!patch.applyGenre}
                                            value={patch.genre}
                                            onChange={e => setPatchField('genre', e.target.value)}
                                            placeholder="Set genre"
                                        />
                                    </label>

                                    <label className="rounded-lg border border-white/10 bg-neutral-950/35 p-2 space-y-1.5">
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="checkbox"
                                                checked={patch.applyYear}
                                                onChange={e => setPatchField('applyYear', e.target.checked)}
                                                className="accent-white"
                                            />
                                            <span className="text-xs text-neutral-200">Year</span>
                                        </div>
                                        <input
                                            type="number"
                                            className="pro-input-compact"
                                            disabled={!patch.applyYear}
                                            value={patch.year}
                                            onChange={e => setPatchField('year', e.target.value)}
                                            placeholder="Set year"
                                        />
                                    </label>

                                    <div className="rounded-lg border border-white/10 bg-neutral-950/35 p-2 space-y-1.5">
                                        <label className="flex items-center gap-2">
                                            <input
                                                type="checkbox"
                                                checked={patch.applyCoverImage}
                                                onChange={e => setPatchField('applyCoverImage', e.target.checked)}
                                                className="accent-white"
                                            />
                                            <span className="text-xs text-neutral-200">Album Cover</span>
                                        </label>
                                        <div className="flex items-center gap-2">
                                            <div className="relative flex-1">
                                                <input
                                                    type="file"
                                                    accept="image/*"
                                                    onChange={e => onCoverPicked(e.target.files?.[0])}
                                                    className="absolute inset-0 opacity-0 cursor-pointer"
                                                />
                                                <button className="pro-button-secondary-compact w-full pointer-events-none flex items-center justify-center gap-1.5">
                                                    <ImagePlus size={13} />
                                                    Choose image
                                                </button>
                                            </div>
                                            {patch.coverImage && (
                                                <div className="w-9 h-9 rounded-md overflow-hidden border border-white/10">
                                                    <img src={patch.coverImage} alt="Selected cover" className="w-full h-full object-cover" />
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <label className="mt-2 block rounded-lg border border-white/10 bg-neutral-950/35 p-2 space-y-1.5">
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="checkbox"
                                            checked={patch.applyComment}
                                            onChange={e => setPatchField('applyComment', e.target.checked)}
                                            className="accent-white"
                                        />
                                        <span className="text-xs text-neutral-200">Comment</span>
                                    </div>
                                    <textarea
                                        className="pro-input-compact min-h-[72px] resize-y"
                                        disabled={!patch.applyComment}
                                        value={patch.comment}
                                        onChange={e => setPatchField('comment', e.target.value)}
                                        placeholder="Set comment text"
                                    />
                                </label>
                            </div>

                            <div className="px-5 py-4 border-t border-white/10 bg-neutral-950/65 backdrop-blur space-y-3">
                                <button
                                    onClick={applyBulkChanges}
                                    disabled={isApplying || selectedCount === 0 || !hasAnyFieldEnabled}
                                    className="pro-button w-full flex items-center justify-center gap-2"
                                >
                                    <Save size={14} />
                                    {isApplying ? 'Applying…' : `Apply to ${selectedCount} selected`}
                                </button>

                                {status && (
                                    <div className="text-sm text-emerald-300/90 flex items-center gap-2">
                                        <CheckCircle2 size={14} />
                                        <span>{status}</span>
                                    </div>
                                )}
                                {error && (
                                    <div className="text-sm text-rose-400 flex items-center gap-2">
                                        <AlertTriangle size={14} />
                                        <span>{error}</span>
                                    </div>
                                )}
                                {batchErrors.length > 0 && (
                                    <div className="rounded-xl border border-rose-500/20 bg-rose-950/20 p-3 space-y-2">
                                        <p className="text-xs uppercase tracking-[0.14em] text-rose-300">Failed Files</p>
                                        <div className="max-h-40 overflow-y-auto space-y-1">
                                            {batchErrors.map((item) => (
                                                <div key={`${item.filePath}:${item.error}`} className="text-xs text-rose-100/85">
                                                    <span className="font-mono">{item.filePath}</span>
                                                    <span className="text-rose-300/90"> — {item.error}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};
