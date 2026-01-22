import React from 'react';
import { useMetadata } from '../hooks/useMetadata';
import { Save } from 'lucide-react';

interface LyricsEditorProps {
    metadataHook: ReturnType<typeof useMetadata>;
}

export const LyricsEditor: React.FC<LyricsEditorProps> = ({ metadataHook }) => {
    const { currentTrack, updateField, saveTrack } = metadataHook;

    if (!currentTrack) return <div className="text-center p-10 text-neutral-500">Select a track to edit lyrics</div>;

    return (
        <div className="h-full overflow-y-auto">
            <div className="p-12 pb-32 flex flex-col max-w-4xl mx-auto w-full">
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h2 className="text-2xl font-bold">Lyrics Editor</h2>
                        <p className="text-neutral-500 text-sm mt-1">{currentTrack.title} - {currentTrack.artist}</p>
                    </div>
                    <button 
                        onClick={() => saveTrack(currentTrack)} 
                        className="pro-button flex items-center gap-2"
                    >
                        <Save size={14} /> Save
                    </button>
                </div>
                
                <div className="flex-1 relative">
                    <textarea 
                        className="w-full h-full bg-neutral-900/50 border border-white/5 rounded-xl p-6 text-neutral-300 font-mono text-sm leading-relaxed resize-none focus:outline-none focus:border-white/20 transition-all shadow-inner"
                        placeholder="Enter lyrics here..."
                        value={currentTrack.lyrics || ""}
                        onChange={e => updateField('lyrics', e.target.value)}
                        spellCheck={false}
                    />
                </div>
            </div>
        </div>
    );
};
