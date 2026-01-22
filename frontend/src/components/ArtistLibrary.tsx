import React, { useMemo, useRef, useState, useEffect } from 'react';
import { metadata } from '../../wailsjs/go/models';
import { User, Upload, Search, X } from 'lucide-react';
import clsx from 'clsx';

interface ArtistLibraryProps {
    files: metadata.TrackMetadata[];
    images: Record<string, string>;
    setArtistImage: (artist: string, dataUrl: string) => void;
    onEditTrack: (track: metadata.TrackMetadata) => void;
}

export const ArtistLibrary: React.FC<ArtistLibraryProps> = ({ files, images, setArtistImage, onEditTrack }) => {
    const [search, setSearch] = useState('');
    const [selectedArtist, setSelectedArtist] = useState<string | null>(null);
    const [sortBy, setSortBy] = useState<'artist' | 'tracks' | 'cover'>(() => {
        return (localStorage.getItem('kitty_sortBy') as any) || 'artist';
    });
    const [filterBy, setFilterBy] = useState<'all' | 'withCover' | 'noCover' | 'withLyrics' | 'noLyrics'>(() => {
        return (localStorage.getItem('kitty_filterBy') as any) || 'all';
    });
    const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

    const filteredList = useMemo(() => {
        return files.filter(track => {
            if (filterBy === 'withCover') return !!track.coverImage;
            if (filterBy === 'noCover') return !track.coverImage;
            if (filterBy === 'withLyrics') return !!track.lyrics;
            if (filterBy === 'noLyrics') return !track.lyrics;
            return true;
        });
    }, [files, filterBy]);

    const artists = useMemo(() => {
        const map = new Map<string, { display: string; tracks: metadata.TrackMetadata[] }>();
        for (const track of filteredList) {
            const rawBase = track.artist || 'Unknown Artist';
            const raw = (rawBase || '').trim() || 'Unknown Artist';
            const key = raw.toLowerCase();
            if (!map.has(key)) {
                map.set(key, { display: raw, tracks: [] });
            }
            map.get(key)!.tracks.push(track);
        }
        return Array.from(map.entries())
            .map(([_, val]) => [val.display, val.tracks] as [string, metadata.TrackMetadata[]])
            .sort((a, b) => {
                if (sortBy === 'tracks') {
                    const diff = b[1].length - a[1].length;
                    return diff !== 0 ? diff : a[0].localeCompare(b[0]);
                }
                if (sortBy === 'cover') {
                    const aHas = a[1].some(t => !!t.coverImage);
                    const bHas = b[1].some(t => !!t.coverImage);
                    if (aHas !== bHas) return aHas ? -1 : 1;
                }
                return a[0].localeCompare(b[0]);
            });
    }, [filteredList, sortBy]);

    const getAvatar = (artist: string, tracks: metadata.TrackMetadata[]) => {
        if (images[artist]) return images[artist];
        const withCover = tracks.find(t => t.coverImage);
        return withCover?.coverImage || null;
    };

    const handleFile = (artist: string, file?: File | null) => {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
            if (ev.target?.result) {
                setArtistImage(artist, ev.target.result as string);
            }
        };
        reader.readAsDataURL(file);
    };

    const filtered = artists.filter(([artist]) =>
        artist.toLowerCase().includes(search.toLowerCase().trim())
    );

    const activeEntry = selectedArtist ? artists.find(([name]) => name === selectedArtist) : null;

    useEffect(() => {
        localStorage.setItem('kitty_sortBy', sortBy);
    }, [sortBy]);

    useEffect(() => {
        localStorage.setItem('kitty_filterBy', filterBy);
    }, [filterBy]);

    return (
        <div className="h-full w-full overflow-hidden bg-neutral-950/95 flex flex-col min-h-0">
            <div className="flex items-center justify-between px-8 pt-6 pb-4 sticky top-0 z-10 bg-neutral-950/80 backdrop-blur-lg">
                <div className="space-y-1">
                    <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Library</p>
                    <h1 className="text-2xl font-semibold text-white">Recently Added</h1>
                </div>
                <div className="flex items-center gap-1 flex-wrap justify-end">
                    <div className="flex items-center gap-2 bg-neutral-900/80 rounded-full px-2 py-1 shadow-sm shadow-black/30">
                        <Search size={14} className="text-neutral-500" />
                        <input
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Find in Library"
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
                            <option value="artist">Artist A–Z</option>
                            <option value="tracks">Track Count</option>
                            <option value="cover">Covers First</option>
                        </select>
                    </div>
                    <div className="flex items-center gap-1 bg-neutral-900/80 rounded-full px-2 py-1 border border-white/10 shadow-sm shadow-black/20">
                        <span className="text-[10px] uppercase tracking-[0.12em] text-neutral-500 px-1">Filter</span>
                        <select
                            value={filterBy}
                            onChange={e => setFilterBy(e.target.value as any)}
                            className="bg-transparent text-neutral-200 text-[12px] px-2 py-0.5 rounded-full focus:outline-none"
                        >
                            <option value="all">All</option>
                            <option value="withCover">With Cover</option>
                            <option value="noCover">Missing Cover</option>
                            <option value="withLyrics">With Lyrics</option>
                            <option value="noLyrics">Missing Lyrics</option>
                        </select>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto px-8 pb-24">
                <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(130px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
                    {filtered.map(([artist, tracks]) => {
                        const avatar = getAvatar(artist, tracks);
                        return (
                            <button
                                key={artist}
                                onClick={() => setSelectedArtist(artist)}
                                className="flex flex-col gap-2 text-left group"
                            >
                                <div className="aspect-square w-full rounded-xl overflow-hidden bg-neutral-900/80 shadow-lg shadow-black/30 transition-transform group-hover:-translate-y-1">
                                    {avatar ? (
                                        <img src={avatar} alt="" className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-neutral-600">
                                            <User size={28} />
                                        </div>
                                    )}
                                </div>
                                <div className="space-y-0.5">
                                    <p className="text-sm font-semibold text-white truncate">{artist}</p>
                                    <p className="text-xs text-neutral-500">{tracks.length} track{tracks.length !== 1 ? 's' : ''}</p>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>

            {activeEntry && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-20 flex items-center justify-center px-4">
                    {(() => {
                        const [artist, tracks] = activeEntry;
                        const avatar = getAvatar(artist, tracks);
                        return (
                            <div className="w-full max-w-3xl max-h-[80vh] bg-neutral-950 border border-white/10 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden flex flex-col">
                                <div className="flex items-center gap-3 px-5 py-4 border-b border-white/5 bg-neutral-900/70">
                                    <div className="w-14 h-14 rounded-xl overflow-hidden bg-neutral-800 border border-white/10 flex items-center justify-center shrink-0">
                                        {avatar ? <img src={avatar} alt="" className="w-full h-full object-cover" /> : <User className="text-neutral-500" />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-base font-semibold text-white truncate">{artist}</p>
                                        <p className="text-xs text-neutral-500">{tracks.length} track{tracks.length !== 1 ? 's' : ''}</p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <label className="pro-button-secondary flex items-center gap-2 cursor-pointer">
                                            <Upload size={14} />
                                            Change image
                                            <input
                                                type="file"
                                                accept="image/*"
                                                ref={el => (inputRefs.current[artist] = el)}
                                                className="hidden"
                                                onChange={e => handleFile(artist, e.target.files?.[0])}
                                            />
                                        </label>
                                        <button
                                            className="p-2 rounded-full hover:bg-white/10 transition text-neutral-300"
                                            onClick={() => setSelectedArtist(null)}
                                        >
                                            <X size={16} />
                                        </button>
                                    </div>
                                </div>

                                <div className="flex-1 overflow-y-auto divide-y divide-white/5">
                                    {tracks.map(t => (
                                        <button
                                            key={t.filePath}
                                            className="w-full px-5 py-3 flex gap-3 items-center text-left hover:bg-white/5 transition"
                                            onClick={() => { onEditTrack(t); setSelectedArtist(null); }}
                                        >
                                            <div className="w-12 h-12 rounded-md overflow-hidden bg-neutral-800 border border-white/5 flex items-center justify-center shrink-0">
                                                {t.coverImage ? <img src={t.coverImage} alt="" className="w-full h-full object-cover" /> : <User size={16} className="text-neutral-500" />}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm text-white truncate">{t.title || t.fileName}</p>
                                                <p className="text-xs text-neutral-500 truncate">{t.album || t.fileName}</p>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        );
                    })()}
                </div>
            )}
        </div>
    );
};
