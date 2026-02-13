import React, { useMemo, useState } from 'react';
import { metadata } from '../../wailsjs/go/models';
import { Disc, Search } from 'lucide-react';

interface SongLibraryProps {
    files: metadata.TrackMetadata[];
    selectedFilePath?: string | null;
    onEditTrack: (track: metadata.TrackMetadata) => void;
}

export const SongLibrary: React.FC<SongLibraryProps> = ({ files, selectedFilePath, onEditTrack }) => {
    const [query, setQuery] = useState('');
    const [sortBy, setSortBy] = useState<'recent' | 'oldest' | 'title' | 'artist' | 'album'>('title');

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        const next = files.filter((t) => {
            if (!q) return true;
            return (
                (t.title || '').toLowerCase().includes(q) ||
                (t.artist || '').toLowerCase().includes(q) ||
                (t.album || '').toLowerCase().includes(q)
            );
        });

        const orderIndex = new Map<string, number>();
        files.forEach((t, i) => orderIndex.set(t.filePath, i));

        return next.sort((a, b) => {
            if (sortBy === 'recent' || sortBy === 'oldest') {
                const ia = orderIndex.get(a.filePath) ?? 0;
                const ib = orderIndex.get(b.filePath) ?? 0;
                return sortBy === 'recent' ? ib - ia : ia - ib;
            }
            const get = (t: metadata.TrackMetadata) => {
                if (sortBy === 'title') return t.title || t.fileName;
                if (sortBy === 'artist') return t.artist || 'Unknown Artist';
                return t.album || 'Unknown Album';
            };
            return get(a).localeCompare(get(b));
        });
    }, [files, query, sortBy]);

    return (
        <div className="h-full w-full overflow-hidden bg-neutral-950/95 flex flex-col min-h-0">
            <div className="flex items-center justify-between px-8 pt-6 pb-4 sticky top-0 z-10 bg-neutral-950/80 backdrop-blur-lg">
                <div className="space-y-1">
                    <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Songs</p>
                    <h1 className="text-2xl font-semibold text-white">All Tracks</h1>
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                    <div className="flex items-center gap-2 bg-neutral-900/80 rounded-full px-2 py-1 shadow-sm shadow-black/30">
                        <Search size={14} className="text-neutral-500" />
                        <input
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder="Search songs"
                            className="bg-transparent text-[12px] text-white outline-none placeholder:text-neutral-600 w-36"
                        />
                    </div>
                    <div className="flex items-center gap-1 bg-neutral-900/80 rounded-full px-2 py-1 border border-white/10 shadow-sm shadow-black/20">
                        <span className="text-[10px] uppercase tracking-[0.12em] text-neutral-500 px-1">Sort</span>
                        <select
                            value={sortBy}
                            onChange={e => setSortBy(e.target.value as any)}
                            className="bg-transparent text-neutral-200 text-[12px] px-2 py-0.5 rounded-full focus:outline-none"
                        >
                            <option value="recent">Recently added</option>
                            <option value="oldest">Oldest added</option>
                            <option value="title">Title</option>
                            <option value="artist">Artist</option>
                            <option value="album">Album</option>
                        </select>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto px-8 pb-24">
                {filtered.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-neutral-600 text-sm">
                        <span>No songs match your search.</span>
                    </div>
                ) : (
                    <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                        {filtered.map(track => {
                            const isSelected = !!selectedFilePath && track.filePath === selectedFilePath;
                            return (
                            <button
                                key={track.filePath}
                                onClick={() => onEditTrack(track)}
                                className={[
                                    'p-4 rounded-xl border bg-neutral-900/50 hover:bg-neutral-900/70 transition-all text-left flex gap-3 items-center group',
                                    isSelected ? 'border-2 border-white/70' : 'border-white/5 hover:border-white/15',
                                ].join(' ')}
                            >
                                <div className="w-16 h-16 shrink-0 bg-neutral-950 rounded-lg overflow-hidden relative border border-white/5">
                                    {track.coverImage ? (
                                        <img src={track.coverImage} alt="" className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-neutral-700">
                                            <Disc size={24} />
                                        </div>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold text-white truncate">{track.title || track.fileName}</p>
                                    <p className="text-xs text-neutral-400 truncate">
                                        {track.artist || 'Unknown Artist'} • {track.album || 'Unknown Album'}
                                    </p>
                                    <p className="text-[11px] text-neutral-600 truncate">{track.fileName}</p>
                                </div>
                            </button>
                        )})}
                    </div>
                )}
            </div>
        </div>
    );
};
