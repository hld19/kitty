import React, { useState } from 'react';
import { useMetadata } from '../hooks/useMetadata';
import { usePlayer } from '../hooks/usePlayer';
import { Save, Music, Play, Pause, Disc } from 'lucide-react';

interface EditorProps {
    metadataHook: ReturnType<typeof useMetadata>;
    playerHook: ReturnType<typeof usePlayer>;
}

export const MetadataEditor: React.FC<EditorProps> = ({ metadataHook, playerHook }) => {
    const { currentTrack, updateField, saveTrack, isLoading } = metadataHook;
    const { isPlaying, toggle, load: loadAudio, error: playerError } = playerHook;
    
    const handlePreview = async () => {
        if (!currentTrack) return;
        if (isPlaying) {
            toggle();
        } else {
            const ok = await loadAudio(currentTrack.filePath);
            if (!ok) return;
        }
    };

    if (!currentTrack) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-neutral-500 h-full">
                <div className="w-24 h-24 rounded-3xl bg-neutral-900 border border-neutral-800 flex items-center justify-center mb-6 shadow-2xl">
                    <Music size={32} strokeWidth={1} className="text-neutral-600" />
                </div>
                <h2 className="text-lg font-medium text-neutral-300 mb-2">No Track Selected</h2>
                <p className="text-xs">Select a track from the Library to edit.</p>
            </div>
        );
    }

    return (
        <div className="h-full overflow-y-auto p-12 pb-40">
            <div className="max-w-5xl mx-auto">
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-xl font-semibold text-white tracking-tight">{currentTrack.title || "Untitled Track"}</h1>
                        <p className="text-neutral-500 text-sm mt-1">{currentTrack.artist || "Unknown Artist"}</p>
                    </div>
                <div className="flex items-center gap-3">
                    <button 
                        onClick={handlePreview}
                        className="pro-button-secondary flex items-center gap-2"
                    >
                        {isPlaying ? <Pause size={14} /> : <Play size={14} />}
                        Preview Audio
                    </button>
                    {playerError && <span className="text-xs text-rose-400">{playerError}</span>}
                    <button 
                        onClick={() => saveTrack(currentTrack)} 
                        disabled={isLoading}
                        className="pro-button flex items-center gap-2"
                    >
                            <Save size={14} />
                            Save Changes
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-12 gap-10">
                    <div className="col-span-4 flex flex-col gap-6">
                        <div className="aspect-square bg-neutral-900 rounded-2xl overflow-hidden border border-white/5 shadow-2xl relative group">
                            {currentTrack.coverImage ? (
                                <img src={currentTrack.coverImage} alt="Cover" className="w-full h-full object-cover" />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-neutral-700">
                                    <Disc size={64} strokeWidth={1} />
                                </div>
                            )}
                        </div>
                        
                        <div className="pro-panel rounded-xl p-5">
                            <h3 className="text-[10px] uppercase tracking-wider font-bold text-neutral-500 mb-4">Technical Details</h3>
                            <div className="space-y-3 text-xs">
                                <div className="flex justify-between items-center py-1 border-b border-white/5">
                                    <span className="text-neutral-500">Format</span>
                                    <span className="font-mono text-neutral-300">{currentTrack.format}</span>
                                </div>
                                <div className="flex justify-between items-center py-1 border-b border-white/5">
                                    <span className="text-neutral-500">Bitrate</span>
                                    <span className="font-mono text-neutral-300">
                                        {currentTrack.bitrate > 0 ? `${currentTrack.bitrate} kbps` : '--'}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center py-1 border-b border-white/5">
                                    <span className="text-neutral-500">Sample Rate</span>
                                    <span className="font-mono text-neutral-300">
                                        {currentTrack.sampleRate > 0 ? `${currentTrack.sampleRate} Hz` : '--'}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="col-span-8 space-y-6">
                        <div className="grid grid-cols-2 gap-5">
                            <div>
                                <label className="pro-label">Title</label>
                                <input 
                                    className="pro-input" 
                                    value={currentTrack.title}
                                    onChange={e => updateField('title', e.target.value)}
                                />
                            </div>
                            <div>
                                <label className="pro-label">Artist</label>
                                <input 
                                    className="pro-input" 
                                    value={currentTrack.artist}
                                    onChange={e => updateField('artist', e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-5">
                            <div>
                                <label className="pro-label">Album</label>
                                <input 
                                    className="pro-input" 
                                    value={currentTrack.album}
                                    onChange={e => updateField('album', e.target.value)}
                                />
                            </div>
                            <div>
                                <label className="pro-label">Album Artist</label>
                                <input 
                                    className="pro-input" 
                                    value={currentTrack.albumArtist}
                                    onChange={e => updateField('albumArtist', e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-5">
                            <div>
                                <label className="pro-label">Genre</label>
                                <input 
                                    className="pro-input" 
                                    value={currentTrack.genre}
                                    onChange={e => updateField('genre', e.target.value)}
                                />
                            </div>
                            <div>
                                <label className="pro-label">Year</label>
                                <input 
                                    className="pro-input" 
                                    value={currentTrack.year}
                                    onChange={e => updateField('year', parseInt(e.target.value) || 0)}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-5">
                            <div>
                                <label className="pro-label">Track No.</label>
                                <input 
                                    className="pro-input" 
                                    value={currentTrack.trackNumber}
                                    onChange={e => updateField('trackNumber', parseInt(e.target.value) || 0)}
                                />
                            </div>
                             <div>
                                <label className="pro-label">Disc No.</label>
                                <input 
                                    className="pro-input" 
                                    value={currentTrack.discNumber}
                                    onChange={e => updateField('discNumber', parseInt(e.target.value) || 0)}
                                />
                            </div>
                        </div>
                        
                         <div>
                            <label className="pro-label">Comment</label>
                            <input 
                                className="pro-input" 
                                value={currentTrack.comment}
                                onChange={e => updateField('comment', e.target.value)}
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
