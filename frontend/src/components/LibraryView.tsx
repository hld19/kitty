import React from 'react';
import { metadata } from '../../wailsjs/go/models';
import { Disc, Music } from 'lucide-react';
import clsx from 'clsx';

interface LibraryViewProps {
    files: metadata.TrackMetadata[];
    currentTrack: metadata.TrackMetadata | null;
    onSelect: (track: metadata.TrackMetadata) => void;
}

export const LibraryView: React.FC<LibraryViewProps> = ({ files, currentTrack, onSelect }) => {
    return (
        <div className="h-full overflow-y-auto p-8 pb-40">
            <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
                <Music className="text-neutral-400" />
                Library <span className="text-neutral-600 text-sm font-normal">({files.length} tracks)</span>
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {files.map((track) => {
                    const isSelected = currentTrack?.filePath === track.filePath;
                    return (
                        <div 
                            key={track.filePath}
                            onClick={() => onSelect(track)}
                            className={clsx(
                                "p-3 rounded-xl border flex gap-3 cursor-pointer transition-all group select-none",
                                isSelected 
                                    ? "bg-white/10 border-white/20 shadow-lg" 
                                    : "bg-neutral-900/40 border-white/5 hover:bg-neutral-800/60 hover:border-white/10"
                            )}
                        >
                            <div className="w-16 h-16 shrink-0 bg-neutral-950 rounded-lg overflow-hidden relative border border-white/5">
                                {track.coverImage ? (
                                    <img src={track.coverImage} alt="" className="w-full h-full object-cover" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-neutral-800">
                                        <Disc size={24} />
                                    </div>
                                )}
                            </div>
                            <div className="flex flex-col justify-center min-w-0">
                                <h3 className={clsx("font-medium truncate text-sm", isSelected ? "text-white" : "text-neutral-300")}>
                                    {track.title || track.fileName}
                                </h3>
                                <p className="text-xs text-neutral-500 truncate">
                                    {track.artist || "Unknown Artist"}
                                </p>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
