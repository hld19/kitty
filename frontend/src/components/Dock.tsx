import React from 'react';
import { Library, Tag, Mic2, Image, PlusCircle, AudioLines, DownloadCloud, Trash2 } from 'lucide-react';
import clsx from 'clsx';

interface DockProps {
    activeTab: string;
    setActiveTab: (tab: string) => void;
    onAddFiles: () => void;
}

export const Dock: React.FC<DockProps> = ({ activeTab, setActiveTab, onAddFiles }) => {
    const tabs = [
        { id: 'downloader', icon: DownloadCloud, label: 'Downloader' },
        { id: 'library', icon: Library, label: 'Library' },
        { id: 'songs', icon: AudioLines, label: 'Songs' },
        { id: 'editor', icon: Tag, label: 'Metadata' },
        { id: 'covers', icon: Image, label: 'Artwork' },
        { id: 'lyrics', icon: Mic2, label: 'Lyrics' },
        { id: 'settings', icon: Trash2, label: 'Data' },
    ];

    return (
        <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center px-4 z-40">
            <div className="flex items-center gap-2 px-3 py-2 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.04),transparent_35%),radial-gradient(circle_at_80%_80%,rgba(0,255,213,0.04),transparent_35%),rgba(12,14,20,0.82)] backdrop-blur-[18px] border border-white/20 rounded-full shadow-[0_10px_24px_rgba(0,0,0,0.26)] pointer-events-auto">
                <button
                    onClick={onAddFiles}
                    className="p-3 rounded-full text-neutral-900 bg-[radial-gradient(circle_at_20%_20%,#9beafe,transparent_45%),radial-gradient(circle_at_80%_80%,#fbbf24,transparent_45%),linear-gradient(120deg,#0ea5e9,#22c55e,#f97316)] hover:brightness-110 transition-all shadow-[0_10px_20px_rgba(0,0,0,0.35)] mr-1 group relative"
                    title="Add Files"
                >
                    <PlusCircle size={20} strokeWidth={2} />
                    <span className="absolute -top-12 left-1/2 -translate-x-1/2 bg-neutral-900 text-white text-[10px] font-medium py-1.5 px-3 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none border border-white/10 whitespace-nowrap shadow-xl">
                        Add Files
                    </span>
                </button>

                <div className="w-px h-6 bg-white/15 mx-1" />

                {tabs.map((tab) => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={clsx(
                                "p-3 rounded-full transition-all duration-200 group relative",
                                isActive
                                    ? "bg-white/80 text-neutral-900 shadow-[inset_0_-2px_6px_rgba(0,0,0,0.25),inset_0_3px_6px_rgba(255,255,255,0.35)]"
                                    : "text-white/75 hover:text-white bg-white/6 shadow-[inset_0_1px_2px_rgba(255,255,255,0.08),inset_0_-4px_10px_rgba(0,0,0,0.35)]"
                            )}
                            title={tab.label}
                        >
                            <Icon size={20} strokeWidth={1.5} />

                            <span className="absolute -top-12 left-1/2 -translate-x-1/2 bg-neutral-900 text-white text-[10px] font-medium py-1.5 px-3 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none border border-white/10 whitespace-nowrap shadow-xl">
                                {tab.label}
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};
