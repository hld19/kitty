import React from 'react';
import { Upload, Music } from 'lucide-react';

interface LandingPageProps {
    onImport: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onImport }) => {
    return (
        <div className="flex-1 flex flex-col items-center justify-center h-screen bg-neutral-950 text-neutral-400 p-8">
            <div 
                className="w-full max-w-2xl aspect-[2/1] border-2 border-dashed border-neutral-800 rounded-3xl flex flex-col items-center justify-center gap-6 hover:border-neutral-600 hover:bg-neutral-900/30 transition-all cursor-pointer group"
                onClick={onImport}
            >
                <div className="w-20 h-20 rounded-full bg-neutral-900 flex items-center justify-center group-hover:scale-110 transition-transform shadow-2xl border border-white/5">
                    <Upload size={32} className="text-neutral-500 group-hover:text-white transition-colors" />
                </div>
                <div className="text-center">
                    <h1 className="text-2xl font-semibold text-neutral-200 mb-2">Add Music Files</h1>
                    <p className="text-sm text-neutral-500">Drag and drop files here or click to browse</p>
                </div>
            </div>
            
            <div className="mt-12 flex gap-4 opacity-30 items-center">
                <Music size={16} />
                <span className="text-[10px] tracking-[0.2em] uppercase font-bold">u_u</span>
            </div>
        </div>
    );
};
