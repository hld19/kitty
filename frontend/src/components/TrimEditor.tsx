import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Pause, Play, RefreshCw, Scissors } from 'lucide-react';
import { useMetadata } from '../hooks/useMetadata';
import { GetAudioState, GetTrimWaveform, LoadAudio, PauseAudio, PlayAudio, SeekAudio, TrimTrack } from '../../wailsjs/go/main/App';

interface TrimEditorProps {
    metadataHook: ReturnType<typeof useMetadata>;
}

type WaveformResult = {
    durationMs: number;
    peaks: number[];
};

type DragMode = 'start' | 'end' | 'range' | 'playhead' | null;

const MIN_GAP_MS = 100;

function formatMs(ms: number) {
    if (!ms || ms < 0) return '0:00';
    const total = Math.floor(ms / 1000);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export const TrimEditor: React.FC<TrimEditorProps> = ({ metadataHook }) => {
    const { currentTrack, applyTrackUpdates } = metadataHook;

    const [wave, setWave] = useState<WaveformResult>({ durationMs: 0, peaks: [] });
    const [startMs, setStartMs] = useState(0);
    const [endMs, setEndMs] = useState(0);
    const [mode, setMode] = useState<'copy' | 'accurate'>('copy');
    const [isLoadingWave, setIsLoadingWave] = useState(false);
    const [isTrimming, setIsTrimming] = useState(false);
    const [isPreviewing, setIsPreviewing] = useState(false);
    const [playheadMs, setPlayheadMs] = useState<number | null>(null);
    const [dragMode, setDragMode] = useState<DragMode>(null);
    const [status, setStatus] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const waveformRef = useRef<HTMLDivElement | null>(null);
    const previewTimerRef = useRef<number | null>(null);
    const previewBusyRef = useRef(false);
    const startMsRef = useRef(0);
    const endMsRef = useRef(0);
    const durationRef = useRef(0);
    const dragModeRef = useRef<DragMode>(null);
    const isPreviewingRef = useRef(false);
    const seekPendingRef = useRef(false);
    const seekQueuedMsRef = useRef<number | null>(null);
    const seekTimerRef = useRef<number | null>(null);
    const lastSeekAtRef = useRef(0);
    const dragClientXRef = useRef<number | null>(null);
    const dragRafRef = useRef<number | null>(null);
    const playheadMsRef = useRef<number | null>(null);
    const dragRef = useRef<{
        mode: Exclude<DragMode, null>;
        originX: number;
        originStartMs: number;
        originEndMs: number;
    } | null>(null);

    const canTrim = useMemo(() => {
        return !!currentTrack?.filePath && endMs > startMs + MIN_GAP_MS;
    }, [currentTrack?.filePath, endMs, startMs]);

    useEffect(() => {
        startMsRef.current = startMs;
    }, [startMs]);

    useEffect(() => {
        endMsRef.current = endMs;
    }, [endMs]);

    useEffect(() => {
        durationRef.current = wave.durationMs;
    }, [wave.durationMs]);

    useEffect(() => {
        isPreviewingRef.current = isPreviewing;
    }, [isPreviewing]);

    useEffect(() => {
        dragModeRef.current = dragMode;
    }, [dragMode]);

    useEffect(() => {
        playheadMsRef.current = playheadMs;
    }, [playheadMs]);

    const flushQueuedSeek = () => {
        if (seekPendingRef.current) return;
        const next = seekQueuedMsRef.current;
        if (next === null) return;

        const run = async () => {
            seekPendingRef.current = true;
            try {
                for (;;) {
                    const targetMs = seekQueuedMsRef.current;
                    if (targetMs === null) {
                        break;
                    }
                    seekQueuedMsRef.current = null;
                    const nextDuration = durationRef.current;
                    if (nextDuration <= 0) {
                        continue;
                    }
                    const pct = Math.max(0, Math.min(1, targetMs / nextDuration));
                    await SeekAudio(pct);
                    lastSeekAtRef.current = performance.now();
                }
            } catch {
                // Ignore transient seek failures while scrubbing.
            } finally {
                seekPendingRef.current = false;
                if (seekQueuedMsRef.current !== null) {
                    if (seekTimerRef.current !== null) {
                        window.clearTimeout(seekTimerRef.current);
                    }
                    seekTimerRef.current = window.setTimeout(() => {
                        seekTimerRef.current = null;
                        flushQueuedSeek();
                    }, 0);
                }
            }
        };
        void run();
    };

    const queueSeekMs = (rawMs: number, force: boolean = false) => {
        const duration = durationRef.current;
        if (duration <= 0) return;

        let target = Math.max(0, Math.min(rawMs, duration));
        if (isPreviewingRef.current) {
            const s = startMsRef.current;
            const e = endMsRef.current;
            if (e > s) {
                target = Math.max(s, Math.min(target, e));
            }
        }

        seekQueuedMsRef.current = target;

        if (force) {
            if (seekTimerRef.current !== null) {
                window.clearTimeout(seekTimerRef.current);
                seekTimerRef.current = null;
            }
            flushQueuedSeek();
            return;
        }

        const now = performance.now();
        const elapsed = now - lastSeekAtRef.current;
        const minIntervalMs = 40;
        if (elapsed >= minIntervalMs) {
            flushQueuedSeek();
            return;
        }

        if (seekTimerRef.current !== null) return;
        seekTimerRef.current = window.setTimeout(() => {
            seekTimerRef.current = null;
            flushQueuedSeek();
        }, minIntervalMs - elapsed);
    };

    const loadWaveform = async (path: string) => {
        setIsLoadingWave(true);
        try {
            const wf = await GetTrimWaveform(path, 360) as WaveformResult;
            const duration = Math.max(0, Number(wf?.durationMs || 0));
            const peaks = Array.isArray(wf?.peaks) ? wf.peaks : [];
            setWave({ durationMs: duration, peaks });
            setStartMs(0);
            setEndMs(duration > 0 ? duration : 0);
        } catch (e: any) {
            setError(e?.toString?.() ?? 'Failed to load waveform');
        } finally {
            setIsLoadingWave(false);
        }
    };

    useEffect(() => {
        setStatus(null);
        setError(null);
        setWave({ durationMs: 0, peaks: [] });
        setPlayheadMs(null);
        if (previewTimerRef.current !== null) {
            window.clearInterval(previewTimerRef.current);
            previewTimerRef.current = null;
        }
        previewBusyRef.current = false;
        seekQueuedMsRef.current = null;
        setIsPreviewing(false);
        void PauseAudio();
        if (!currentTrack?.filePath) {
            return;
        }
        void loadWaveform(currentTrack.filePath);
    }, [currentTrack?.filePath]);

    useEffect(() => {
        return () => {
            if (previewTimerRef.current !== null) {
                window.clearInterval(previewTimerRef.current);
                previewTimerRef.current = null;
            }
            previewBusyRef.current = false;
            seekQueuedMsRef.current = null;
            if (seekTimerRef.current !== null) {
                window.clearTimeout(seekTimerRef.current);
                seekTimerRef.current = null;
            }
            setPlayheadMs(null);
            void PauseAudio();
        };
    }, []);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const width = canvas.width;
        const height = canvas.height;
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fillRect(0, 0, width, height);

        const peaks = wave.peaks;
        if (!peaks.length) return;

        const barWidth = Math.max(1, width / peaks.length);
        const activeStart = wave.durationMs > 0 ? (startMs / wave.durationMs) * width : 0;
        const activeEnd = wave.durationMs > 0 ? (endMs / wave.durationMs) * width : width;

        for (let i = 0; i < peaks.length; i++) {
            const x = i * barWidth;
            const amp = Math.min(1, Math.max(0, peaks[i] || 0));
            const barH = Math.max(2, amp * (height - 12));
            const y = (height - barH) / 2;
            const inRange = x >= activeStart && x <= activeEnd;
            ctx.fillStyle = inRange ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.28)';
            ctx.fillRect(x, y, Math.max(1, barWidth - 1), barH);
        }

        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.fillRect(activeStart, 0, 2, height);
        ctx.fillRect(activeEnd, 0, 2, height);

    }, [wave.peaks, wave.durationMs, startMs, endMs]);

    const beginDrag = (
        mode: Exclude<DragMode, null>,
        event: React.PointerEvent,
        originStartMs: number = startMsRef.current,
        originEndMs: number = endMsRef.current,
    ) => {
        if (wave.durationMs <= 0) return;
        event.preventDefault();
        event.stopPropagation();
        const target = event.currentTarget as Element & { setPointerCapture?: (pointerId: number) => void };
        if (target?.setPointerCapture) {
            try {
                target.setPointerCapture(event.pointerId);
            } catch {
            }
        }
        dragRef.current = {
            mode,
            originX: event.clientX,
            originStartMs,
            originEndMs,
        };
        setDragMode(mode);

        if (mode === 'playhead' && waveformRef.current) {
            const rect = waveformRef.current.getBoundingClientRect();
            if (rect.width > 0) {
                const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
                const ms = ratio * wave.durationMs;
                setPlayheadMs(ms);
                queueSeekMs(ms);
            }
        }
    };

    const onWaveformPointerDown = (event: React.PointerEvent) => {
        if (isLoadingWave || durationMs <= 0 || !waveformRef.current) return;

        const rect = waveformRef.current.getBoundingClientRect();
        if (rect.width <= 0) return;

        const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
        const ratio = x / rect.width;
        const targetMs = ratio * durationMs;
        const startX = startPct * rect.width;
        const endX = endPct * rect.width;
        const currentPlayPct = playheadPct ?? startPct;
        const playX = currentPlayPct * rect.width;

        const playheadHit = 12;
        const handleHit = 20;
        const inRange = x >= startX && x <= endX;

        if (Math.abs(x - startX) <= handleHit) {
            beginDrag('start', event);
            return;
        }
        if (Math.abs(x - endX) <= handleHit) {
            beginDrag('end', event);
            return;
        }
        if (Math.abs(x - playX) <= playheadHit) {
            beginDrag('playhead', event);
            return;
        }
        if (inRange) {
            beginDrag('range', event);
            return;
        }

        if (x < startX) {
            const nextStart = Math.max(0, Math.min(targetMs, endMsRef.current - MIN_GAP_MS));
            const rounded = Math.round(nextStart);
            setStartMs(rounded);
            beginDrag('start', event, rounded, endMsRef.current);
            return;
        }

        const nextEnd = Math.min(durationMs, Math.max(targetMs, startMsRef.current + MIN_GAP_MS));
        const rounded = Math.round(nextEnd);
        setEndMs(rounded);
        beginDrag('end', event, startMsRef.current, rounded);
    };

    useEffect(() => {
        const applyDragAtClientX = (clientX: number) => {
            const drag = dragRef.current;
            const box = waveformRef.current;
            const duration = durationRef.current;
            if (!drag || !box || duration <= 0) return;

            const rect = box.getBoundingClientRect();
            if (rect.width <= 0) return;

            const deltaPx = clientX - drag.originX;
            const deltaMs = (deltaPx / rect.width) * duration;

            let nextStart = drag.originStartMs;
            let nextEnd = drag.originEndMs;

            if (drag.mode === 'start') {
                nextStart = Math.max(0, Math.min(drag.originStartMs + deltaMs, drag.originEndMs - MIN_GAP_MS));
            } else if (drag.mode === 'end') {
                nextEnd = Math.min(duration, Math.max(drag.originEndMs + deltaMs, drag.originStartMs + MIN_GAP_MS));
            } else if (drag.mode === 'playhead') {
                const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
                const ms = ratio * duration;
                setPlayheadMs(ms);
                queueSeekMs(ms);
                return;
            } else {
                const rangeLen = drag.originEndMs - drag.originStartMs;
                nextStart = drag.originStartMs + deltaMs;
                nextEnd = drag.originEndMs + deltaMs;
                if (nextStart < 0) {
                    nextEnd -= nextStart;
                    nextStart = 0;
                }
                if (nextEnd > duration) {
                    const overflow = nextEnd - duration;
                    nextStart -= overflow;
                    nextEnd = duration;
                }
                if (nextEnd - nextStart < rangeLen) {
                    nextEnd = Math.min(duration, nextStart + rangeLen);
                }
            }

            const roundedStart = Math.round(nextStart);
            const roundedEnd = Math.round(nextEnd);
            if (roundedStart !== startMsRef.current) {
                setStartMs(roundedStart);
            }
            if (roundedEnd !== endMsRef.current) {
                setEndMs(roundedEnd);
            }
        };

        const handleMove = (event: PointerEvent) => {
            const drag = dragRef.current;
            const box = waveformRef.current;
            const duration = durationRef.current;
            if (!drag || !box || duration <= 0) return;

            event.preventDefault();
            dragClientXRef.current = event.clientX;
            if (dragRafRef.current !== null) return;
            dragRafRef.current = window.requestAnimationFrame(() => {
                dragRafRef.current = null;
                const nextX = dragClientXRef.current;
                if (nextX === null) return;
                applyDragAtClientX(nextX);
            });
        };

        const handleUp = () => {
            if (!dragRef.current) return;
            const previousDrag = dragRef.current;
            dragRef.current = null;
            dragClientXRef.current = null;
            if (dragRafRef.current !== null) {
                window.cancelAnimationFrame(dragRafRef.current);
                dragRafRef.current = null;
            }
            setDragMode(null);
            if (previousDrag.mode === 'playhead' && playheadMsRef.current !== null) {
                queueSeekMs(playheadMsRef.current, true);
            }
        };

        window.addEventListener('pointermove', handleMove, { passive: false });
        window.addEventListener('pointerup', handleUp);
        window.addEventListener('pointercancel', handleUp);

        return () => {
            window.removeEventListener('pointermove', handleMove);
            window.removeEventListener('pointerup', handleUp);
            window.removeEventListener('pointercancel', handleUp);
            if (dragRafRef.current !== null) {
                window.cancelAnimationFrame(dragRafRef.current);
                dragRafRef.current = null;
            }
        };
    }, []);

    const stopPreview = async () => {
        if (previewTimerRef.current !== null) {
            window.clearInterval(previewTimerRef.current);
            previewTimerRef.current = null;
        }
        previewBusyRef.current = false;
        seekQueuedMsRef.current = null;
        setPlayheadMs(null);
        await PauseAudio();
        setIsPreviewing(false);
    };

    const previewSelection = async () => {
        if (!currentTrack?.filePath || !canTrim || wave.durationMs <= 0) return;
        setError(null);
        setStatus(null);

        if (isPreviewing) {
            await stopPreview();
            return;
        }

        try {
            await LoadAudio(currentTrack.filePath);
            const startPct = Math.min(1, Math.max(0, startMs / wave.durationMs));
            await SeekAudio(startPct);
            await PlayAudio();
            setIsPreviewing(true);
            setPlayheadMs(startMs);

            if (previewTimerRef.current !== null) {
                window.clearInterval(previewTimerRef.current);
            }
            previewTimerRef.current = window.setInterval(async () => {
                if (previewBusyRef.current) return;
                previewBusyRef.current = true;
                try {
                    const previewStart = startMsRef.current;
                    const previewEnd = endMsRef.current;
                    const previewDuration = durationRef.current;
                    if (previewDuration <= 0 || previewEnd <= previewStart + MIN_GAP_MS) {
                        await stopPreview();
                        return;
                    }
                    if (dragModeRef.current !== null) {
                        return;
                    }
                    const state = await GetAudioState();
                    const currentMs = Number(state?.position || 0) * 1000;
                    setPlayheadMs(currentMs);
                    const loopStartPct = Math.min(1, Math.max(0, previewStart / previewDuration));
                    if (currentMs < previewStart - 40 || currentMs >= previewEnd) {
                        await SeekAudio(loopStartPct);
                        await PlayAudio();
                        setPlayheadMs(previewStart);
                    }
                } catch {
                    await stopPreview();
                } finally {
                    previewBusyRef.current = false;
                }
            }, 60);
        } catch (e: any) {
            setIsPreviewing(false);
            setError(e?.toString?.() ?? 'Preview failed');
        }
    };

    const runTrim = async () => {
        if (!currentTrack?.filePath || !canTrim) return;
        setError(null);
        setStatus(null);
        setIsTrimming(true);
        try {
            if (isPreviewing) {
                await stopPreview();
            }
            const result = await TrimTrack(currentTrack.filePath, Math.round(startMs), Math.round(endMs), mode) as any;
            const updatedTrack = result?.updatedTrack;
            if (updatedTrack) {
                applyTrackUpdates([updatedTrack]);
            }
            await loadWaveform(currentTrack.filePath);
            setStatus('Trimmed successfully.');
        } catch (e: any) {
            setError(e?.toString?.() ?? 'Trim failed');
        } finally {
            setIsTrimming(false);
        }
    };

    const durationMs = Math.max(0, wave.durationMs);
    const startPct = durationMs > 0 ? Math.max(0, Math.min(1, startMs / durationMs)) : 0;
    const endPct = durationMs > 0 ? Math.max(0, Math.min(1, endMs / durationMs)) : 1;
    const selectedPct = Math.max(0, endPct - startPct);
    const effectivePlayheadMs = playheadMs === null ? startMs : playheadMs;
    const normalizedPlayheadMs = Math.max(0, Math.min(effectivePlayheadMs, durationMs));
    const playheadPct = durationMs <= 0 ? null : Math.max(0, Math.min(1, normalizedPlayheadMs / durationMs));

    if (!currentTrack) {
        return (
            <div className="h-full flex items-center justify-center text-neutral-500">
                Select a library track to trim.
            </div>
        );
    }

    return (
        <div className="h-full w-full overflow-y-auto px-8 pb-24 pt-6">
            <div className="max-w-5xl mx-auto space-y-5">
                <div className="space-y-1">
                    <p className="text-xs uppercase tracking-[0.24em] text-neutral-500">Trim</p>
                    <h1 className="text-2xl font-semibold text-white">{currentTrack.title || currentTrack.fileName}</h1>
                    <p className="text-xs text-neutral-400">{currentTrack.artist || 'Unknown Artist'}</p>
                </div>

                <div className="bg-neutral-900/45 border border-white/10 rounded-2xl p-5 shadow-xl space-y-4">
                    <div className="relative rounded-xl border border-white/10 bg-neutral-950/70 p-3">
                        <canvas ref={canvasRef} width={1024} height={180} className="w-full h-36 rounded-lg" />
                        {durationMs > 0 && (
                            <div
                                ref={waveformRef}
                                onPointerDown={onWaveformPointerDown}
                                className={`absolute inset-3 rounded-lg touch-none ${dragMode ? 'select-none' : ''} ${isLoadingWave ? 'pointer-events-none' : 'cursor-ew-resize'}`}
                            >
                                <div className="absolute inset-0 pointer-events-none">
                                    <div className="absolute inset-y-0 left-0 bg-black/45 rounded-l-lg" style={{ width: `${startPct * 100}%` }} />
                                    <div className="absolute inset-y-0 right-0 bg-black/45 rounded-r-lg" style={{ width: `${(1 - endPct) * 100}%` }} />
                                    <div
                                        className="absolute inset-y-0 border border-cyan-300/70 bg-cyan-400/10 rounded-md"
                                        style={{ left: `${startPct * 100}%`, width: `${selectedPct * 100}%` }}
                                    />
                                </div>

                                <div
                                    className={`absolute inset-y-0 z-10 pointer-events-none ${dragMode === 'range' ? 'cursor-grabbing' : 'cursor-grab'}`}
                                    style={{ left: `${startPct * 100}%`, width: `${selectedPct * 100}%`, minWidth: '14px' }}
                                />

                                <div
                                    className={`absolute top-0 bottom-0 z-20 w-5 -translate-x-1/2 pointer-events-none ${dragMode === 'start' ? 'cursor-grabbing' : 'cursor-ew-resize'}`}
                                    style={{ left: `${startPct * 100}%` }}
                                >
                                    <div className="absolute inset-y-2 left-1/2 -translate-x-1/2 w-[3px] rounded-full bg-cyan-100/95 shadow-[0_0_0_1px_rgba(15,23,42,0.4)]" />
                                </div>

                                <div
                                    className={`absolute top-0 bottom-0 z-20 w-5 -translate-x-1/2 pointer-events-none ${dragMode === 'end' ? 'cursor-grabbing' : 'cursor-ew-resize'}`}
                                    style={{ left: `${endPct * 100}%` }}
                                >
                                    <div className="absolute inset-y-2 left-1/2 -translate-x-1/2 w-[3px] rounded-full bg-cyan-100/95 shadow-[0_0_0_1px_rgba(15,23,42,0.4)]" />
                                </div>

                                {playheadPct !== null && (
                                    <div
                                        className={`absolute top-0 bottom-0 z-30 w-8 -translate-x-1/2 pointer-events-none ${dragMode === 'playhead' ? 'cursor-grabbing transition-none' : 'cursor-ew-resize transition-[left] duration-75 ease-linear'}`}
                                        style={{ left: `${playheadPct * 100}%` }}
                                    >
                                        <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[2px] bg-cyan-300/95 shadow-[0_0_10px_rgba(34,211,238,0.45)]" />
                                        <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full border border-cyan-100/90 bg-cyan-300 shadow-[0_1px_6px_rgba(0,0,0,0.45)]" />
                                    </div>
                                )}
                            </div>
                        )}
                        {isLoadingWave && (
                            <div className="absolute inset-0 flex items-center justify-center text-xs text-neutral-300 bg-black/35 rounded-xl">
                                <Loader2 size={14} className="animate-spin mr-2" />
                                Loading waveform…
                            </div>
                        )}
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-[11px]">
                        <div className="rounded-lg border border-white/10 bg-neutral-950/45 px-3 py-2">
                            <div className="text-neutral-500 uppercase tracking-[0.12em]">Start</div>
                            <div className="text-white mt-0.5">{formatMs(startMs)}</div>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-neutral-950/45 px-3 py-2">
                            <div className="text-neutral-500 uppercase tracking-[0.12em]">End</div>
                            <div className="text-white mt-0.5">{formatMs(endMs)}</div>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-neutral-950/45 px-3 py-2">
                            <div className="text-neutral-500 uppercase tracking-[0.12em]">Selection</div>
                            <div className="text-white mt-0.5">{formatMs(Math.max(0, endMs - startMs))}</div>
                        </div>
                    </div>

                    <p className="text-[11px] text-neutral-500">
                        Drag start/end handles, drag the selected region, and drag the cyan playhead to scrub playback.
                    </p>

                    <div className="flex items-center gap-2 flex-wrap">
                        <button
                            onClick={() => setMode('copy')}
                            className={`pro-button-secondary-compact ${mode === 'copy' ? 'bg-white/10 text-white border-white/20' : ''}`}
                        >
                            Lossless Copy
                        </button>
                        <button
                            onClick={() => setMode('accurate')}
                            className={`pro-button-secondary-compact ${mode === 'accurate' ? 'bg-white/10 text-white border-white/20' : ''}`}
                        >
                            Accurate Re-encode
                        </button>
                        <span className="text-xs text-neutral-500">
                            {mode === 'copy' ? 'No quality loss, fastest.' : 'Exact cut points, slower.'}
                        </span>
                    </div>

                    <div className="flex items-center gap-3 flex-wrap">
                        <button
                            onClick={previewSelection}
                            disabled={!canTrim || isTrimming || isLoadingWave}
                            className="pro-button-secondary-compact flex items-center gap-2"
                        >
                            {isPreviewing ? <Pause size={14} /> : <Play size={14} />}
                            {isPreviewing ? 'Stop Preview' : 'Preview Selection'}
                        </button>
                        <button onClick={runTrim} disabled={!canTrim || isTrimming} className="pro-button flex items-center gap-2">
                            {isTrimming ? <Loader2 size={14} className="animate-spin" /> : <Scissors size={14} />}
                            {isTrimming ? 'Trimming…' : 'Trim + Overwrite'}
                        </button>
                        <button
                            onClick={() => {
                                if (!currentTrack?.filePath) return;
                                void loadWaveform(currentTrack.filePath);
                            }}
                            className="pro-button-secondary-compact flex items-center gap-2"
                            disabled={isLoadingWave}
                        >
                            <RefreshCw size={14} className={isLoadingWave ? 'animate-spin' : ''} />
                            Refresh
                        </button>
                        <span className="text-xs text-neutral-500">
                            Preview loops live while you adjust start/end, without saving.
                        </span>
                    </div>
                </div>

                {status && (
                    <div className="text-sm text-emerald-300/90 bg-emerald-950/20 border border-emerald-500/20 rounded-xl px-4 py-3 flex items-center gap-2">
                        <CheckCircle2 size={15} />
                        <span>{status}</span>
                    </div>
                )}
                {error && (
                    <div className="text-sm text-rose-400 flex items-center gap-2">
                        <AlertTriangle size={14} />
                        <span>{error}</span>
                    </div>
                )}
            </div>
        </div>
    );
};
