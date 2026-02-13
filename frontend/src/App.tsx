import React, { useState, useEffect } from 'react';
import { Dock } from './components/Dock';
import { MetadataEditor } from './components/MetadataEditor';
import { LandingPage } from './components/LandingPage';
import { ArtworkEditor } from './components/ArtworkEditor';
import { LyricsEditor } from './components/LyricsEditor';
import { SongLibrary } from './components/SongLibrary';
import { Downloader } from './components/Downloader';
import { useMetadata } from './hooks/useMetadata';
import { usePlayer } from './hooks/usePlayer';
import { useArtistImages } from './hooks/useArtistImages';
import { ArtistLibrary } from './components/ArtistLibrary';
import { OnFileDrop, OnFileDropOff } from '../wailsjs/runtime/runtime';
import { X } from 'lucide-react';
import { Settings } from './components/Settings';

function App() {
    const [activeTab, setActiveTab] = useState('library');
    const metadataHook = useMetadata();
    const playerHook = usePlayer();
    const artistImagesHook = useArtistImages();
    const { fileList, importFiles, addFilesByPath, currentTrack, selectTrack } = metadataHook;

    useEffect(() => {
        OnFileDrop((x, y, paths) => {
            if (paths && paths.length > 0) {
                addFilesByPath(paths);
            }
        }, false);

        return () => {
            OnFileDropOff();
        };
    }, []);

    const showLoader = metadataHook.isBooting || metadataHook.isSyncing || metadataHook.isLoading;
    const showLanding = fileList.length === 0 && activeTab !== 'downloader' && activeTab !== 'settings' && !metadataHook.isBooting && !metadataHook.isLoading && !metadataHook.isSyncing;

    return (
        <div className="h-full w-full text-neutral-200 relative selection:bg-neutral-700/50 bg-[#0b0b0f]">
            <div className="app-shell h-full w-full relative flex flex-col">
                {metadataHook.error && (
                    <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 w-[min(720px,calc(100vw-2rem))] px-4">
                        <div className="rounded-2xl border border-rose-500/20 bg-rose-950/40 backdrop-blur-xl shadow-2xl shadow-black/40 p-4 flex gap-3 items-start">
                            <div className="flex-1 min-w-0">
                                <p className="text-xs uppercase tracking-[0.18em] text-rose-300/90">Error</p>
                                <pre className="mt-2 text-[11px] leading-5 text-rose-100/90 whitespace-pre-wrap break-words max-h-40 overflow-auto">
                                    {metadataHook.error}
                                </pre>
                                <p className="mt-2 text-[11px] text-rose-200/70">
                                    If this mentions permissions (EPERM / operation not permitted), on macOS you may need to allow Kitty in
                                    System Settings → Privacy &amp; Security → Files and Folders (or Full Disk Access).
                                </p>
                            </div>
                            <button
                                onClick={metadataHook.clearError}
                                className="p-2 rounded-full hover:bg-white/10 transition text-rose-100/80"
                                title="Dismiss"
                            >
                                <X size={16} />
                            </button>
                        </div>
                    </div>
                )}
                <div className="h-14 z-20 bg-neutral-950/90 backdrop-blur flex items-center justify-between pl-24 pr-4 md:pr-6 window-drag">
                    <div className="flex items-center gap-3 no-drag">
                        <span className="text-[11px] uppercase tracking-[0.3em] text-neutral-400">Kitty</span>
                        <span className="text-xs px-2 py-1 rounded-full bg-white/10 text-white/80 capitalize">
                            {activeTab}
                        </span>
                    </div>
                </div>

                <div className="flex-1 min-h-0 relative z-10 pt-3 pb-3 overflow-hidden">
                    {showLanding ? (
                        <LandingPage onImport={importFiles} />
                    ) : (
                        <>
                            {activeTab === 'library' && (
                                <ArtistLibrary 
                                    files={fileList} 
                                    images={artistImagesHook.images} 
                                    setArtistImage={artistImagesHook.setArtistImage} 
                                    onEditTrack={(track) => { selectTrack(track); }} 
                                />
                            )}
                            {activeTab === 'songs' && (
                                <SongLibrary
                                    files={fileList}
                                    selectedFilePath={currentTrack?.filePath ?? null}
                                    onEditTrack={(track) => { selectTrack(track); }}
                                />
                            )}
                            {activeTab === 'editor' && (
                                <MetadataEditor metadataHook={metadataHook} playerHook={playerHook} />
                            )}
                            {activeTab === 'covers' && (
                                 <ArtworkEditor metadataHook={metadataHook} />
                            )}
                            {activeTab === 'lyrics' && (
                                 <LyricsEditor metadataHook={metadataHook} />
                            )}
                            {activeTab === 'downloader' && (
                                <Downloader metadataHook={metadataHook} />
                            )}
                            {activeTab === 'settings' && (
                                <Settings metadataHook={metadataHook} />
                            )}
                        </>
                    )}

                    {showLoader && !showLanding && (
                        <div className="absolute inset-0 bg-black/30 backdrop-blur-sm z-30 flex items-center justify-center pointer-events-none">
                            <div className="flex items-center gap-3 px-4 py-3 bg-neutral-900/90 rounded-2xl border border-white/10 shadow-lg pointer-events-auto">
                                <div className="spinner-circle" />
                                <div className="leading-tight">
                                    <p className="text-sm text-white">Loading your library</p>
                                    <p className="text-xs text-neutral-500">Restoring previously added tracks…</p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {!showLoader && (
                    <Dock 
                        activeTab={activeTab} 
                        setActiveTab={setActiveTab} 
                        onAddFiles={importFiles}
                    />
                )}
            </div>
        </div>
    );
}

export default App;
