import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useMetadata } from '../hooks/useMetadata';
import { Save, Image as ImageIcon } from 'lucide-react';

const TARGET_SIZE = 800;

function clamp(val: number, min: number, max: number) {
    return Math.max(min, Math.min(max, val));
}

function applyBoxBlur(data: Uint8ClampedArray, width: number, height: number, radius: number) {
    const r = Math.floor(radius);
    if (r <= 0) return data;
    const out = new Uint8ClampedArray(data.length);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            for (let c = 0; c < 3; c++) {
                let sum = 0;
                let count = 0;
                for (let dy = -r; dy <= r; dy++) {
                    const yy = y + dy;
                    if (yy < 0 || yy >= height) continue;
                    for (let dx = -r; dx <= r; dx++) {
                        const xx = x + dx;
                        if (xx < 0 || xx >= width) continue;
                        const idx = (yy * width + xx) * 4 + c;
                        sum += data[idx];
                        count++;
                    }
                }
                out[(y * width + x) * 4 + c] = sum / count;
            }
            out[(y * width + x) * 4 + 3] = data[(y * width + x) * 4 + 3];
        }
    }
    return out;
}

function applySharpen(data: Uint8ClampedArray, width: number, height: number, amount: number) {
    if (amount <= 0) return data;
    const out = new Uint8ClampedArray(data.length);
    const a = amount;
    const center = 1 + 4 * a;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idxBase = (y * width + x) * 4;
            for (let c = 0; c < 3; c++) {
                let acc = data[idxBase + c] * center;
                if (x > 0) acc -= data[idxBase - 4 + c] * a;
                if (x < width - 1) acc -= data[idxBase + 4 + c] * a;
                if (y > 0) acc -= data[idxBase - width * 4 + c] * a;
                if (y < height - 1) acc -= data[idxBase + width * 4 + c] * a;
                out[idxBase + c] = clamp(acc, 0, 255);
            }
            out[idxBase + 3] = data[idxBase + 3];
        }
    }
    return out;
}

interface ArtworkEditorProps {
    metadataHook: ReturnType<typeof useMetadata>;
}

export const ArtworkEditor: React.FC<ArtworkEditorProps> = ({ metadataHook }) => {
    const { currentTrack, updateField, saveTrack } = metadataHook;
    const [brightness, setBrightness] = useState(100);
    const [saturation, setSaturation] = useState(100);
    const [blur, setBlur] = useState(0);
    const [sharpness, setSharpness] = useState(0);
    const [cropZoom, setCropZoom] = useState(1);
    const [cropX, setCropX] = useState(0);
    const [cropY, setCropY] = useState(0);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [baseImage, setBaseImage] = useState<string | null>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const processingRef = useRef(0);
    const [lastFilePath, setLastFilePath] = useState<string | null>(null);
    const skipNextRender = useRef(false);

    useEffect(() => {
        if (!currentTrack) return;
        if (currentTrack.filePath !== lastFilePath) {
            setBaseImage(currentTrack.coverImage);
            setBrightness(100);
            setSaturation(100);
            setBlur(0);
            setSharpness(0);
            setCropZoom(1);
            setCropX(0);
            setCropY(0);
            setLastFilePath(currentTrack.filePath);
        } else if (!baseImage && currentTrack.coverImage) {
            setBaseImage(currentTrack.coverImage);
        }
    }, [currentTrack?.filePath, baseImage]); 

    const processImage = useCallback(async (doSave: boolean) => {
        const sourceUrl = baseImage || currentTrack?.coverImage;
        if (!sourceUrl || !canvasRef.current) return;

        const processId = ++processingRef.current;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const img = new Image();
        img.src = sourceUrl;
        img.crossOrigin = "anonymous";
        
        if (img.decode) {
            await img.decode().catch(() => new Promise((resolve) => { img.onload = () => resolve(null); }));
        } else {
            await new Promise((resolve) => { img.onload = () => resolve(null); });
        }
        if (processId !== processingRef.current) return;

        const minDim = Math.min(img.width, img.height);
        const cropSize = minDim / cropZoom;
        const maxOffsetX = (img.width - cropSize) / 2;
        const maxOffsetY = (img.height - cropSize) / 2;
        const offsetX = (cropX / 100) * maxOffsetX;
        const offsetY = (cropY / 100) * maxOffsetY;
        const sx = clamp((img.width - cropSize) / 2 + offsetX, 0, img.width - cropSize);
        const sy = clamp((img.height - cropSize) / 2 + offsetY, 0, img.height - cropSize);

        canvas.width = TARGET_SIZE;
        canvas.height = TARGET_SIZE;
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, sx, sy, cropSize, cropSize, 0, 0, TARGET_SIZE, TARGET_SIZE);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let data = imageData.data;
        const bFactor = brightness / 100;
        const sFactor = saturation / 100;
        for (let i = 0; i < data.length; i += 4) {
            let r = data[i];
            let g = data[i + 1];
            let b = data[i + 2];

            r = Math.min(255, r * bFactor);
            g = Math.min(255, g * bFactor);
            b = Math.min(255, b * bFactor);

            const gray = 0.299 * r + 0.587 * g + 0.114 * b;
            data[i] = Math.min(255, Math.max(0, gray + (r-gray) * sFactor));
            data[i + 1] = Math.min(255, Math.max(0, gray + (g-gray) * sFactor));
            data[i + 2] = Math.min(255, Math.max(0, gray + (b-gray) * sFactor));
        }
        if (blur > 0) {
            data = applyBoxBlur(data, canvas.width, canvas.height, blur);
        }
        if (sharpness > 0) {
            data = applySharpen(data, canvas.width, canvas.height, sharpness / 10);
        }
        ctx.putImageData(new ImageData(data, canvas.width, canvas.height), 0, 0);
        
        const newDataUrl = canvas.toDataURL('image/jpeg', 0.9);
        setPreviewUrl(newDataUrl);

        if (doSave && currentTrack) {
            updateField('coverImage', newDataUrl);
            updateField('hasCover', true);
            const updatedTrack = { ...currentTrack, coverImage: newDataUrl, hasCover: true };
            await saveTrack(updatedTrack as any);
            skipNextRender.current = true;
            setBaseImage(newDataUrl);
            setBrightness(100);
            setSaturation(100);
            setBlur(0);
            setSharpness(0);
            setCropZoom(1);
            setCropX(0);
            setCropY(0);
        }
    }, [baseImage, brightness, blur, currentTrack, cropX, cropY, cropZoom, saturation, sharpness, saveTrack, updateField]);

    const handleApply = async () => {
        await processImage(true);
    };
    
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                if (ev.target?.result) {
                    const res = ev.target.result as string;
                    setBaseImage(res);
                    setPreviewUrl(res);
                    updateField('coverImage', res);
                    updateField('hasCover', true);
                    setBrightness(100);
                    setSaturation(100);
                    setBlur(0);
                    setSharpness(0);
                    setCropZoom(1);
                    setCropX(0);
                    setCropY(0);
                }
            };
            reader.readAsDataURL(e.target.files[0]);
        }
    };

    useEffect(() => {
        if (!baseImage) return;
        if (skipNextRender.current) {
            skipNextRender.current = false;
            return;
        }
        processImage(false);
    }, [baseImage, processImage]);

    if (!currentTrack) return <div className="text-center p-10 text-neutral-500">Select a track to edit artwork</div>;

    return (
        <div className="h-full p-12 flex flex-col items-center justify-center pb-32 overflow-y-auto">
            <div className="max-w-4xl w-full grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
                <div className="aspect-square bg-neutral-900 rounded-2xl overflow-hidden border border-white/5 shadow-2xl relative">
                    {previewUrl ? (
                        <img
                            src={previewUrl}
                            alt="Cover"
                            className="w-full h-full object-cover transition-all"
                        />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-neutral-700">
                            <ImageIcon size={64} strokeWidth={1} />
                        </div>
                    )}
                    <canvas ref={canvasRef} className="hidden" />
                </div>

                <div className="space-y-8">
                    <div>
                        <h2 className="text-2xl font-bold mb-6">Artwork Editor</h2>

                        <div className="space-y-6">
                            <div className="text-xs text-neutral-500">Output: {TARGET_SIZE} x {TARGET_SIZE} (square)</div>
                            <div>
                                <label className="pro-label flex justify-between">
                                    Crop Zoom <span className="text-white">{cropZoom.toFixed(2)}x</span>
                                </label>
                                <input
                                    type="range"
                                    min="1"
                                    max="3"
                                    step="0.01"
                                    value={cropZoom}
                                    onChange={e => setCropZoom(parseFloat(e.target.value))}
                                    onInput={e => setCropZoom(parseFloat((e.target as HTMLInputElement).value))}
                                    className="w-full accent-white h-1 bg-neutral-800 rounded-full appearance-none cursor-pointer"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="pro-label flex justify-between">
                                        Crop X Offset <span className="text-white">{cropX}%</span>
                                    </label>
                                    <input
                                        type="range"
                                        min="-100"
                                        max="100"
                                        value={cropX}
                                        onChange={e => setCropX(parseInt(e.target.value))}
                                        onInput={e => setCropX(parseInt((e.target as HTMLInputElement).value))}
                                        className="w-full accent-white h-1 bg-neutral-800 rounded-full appearance-none cursor-pointer"
                                    />
                                </div>
                                <div>
                                    <label className="pro-label flex justify-between">
                                        Crop Y Offset <span className="text-white">{cropY}%</span>
                                    </label>
                                    <input
                                        type="range"
                                        min="-100"
                                        max="100"
                                        value={cropY}
                                        onChange={e => setCropY(parseInt(e.target.value))}
                                        onInput={e => setCropY(parseInt((e.target as HTMLInputElement).value))}
                                        className="w-full accent-white h-1 bg-neutral-800 rounded-full appearance-none cursor-pointer"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="pro-label flex justify-between">
                                    Brightness <span className="text-white">{brightness}%</span>
                                </label>
                                <input
                                    type="range"
                                    min="0"
                                    max="200"
                                    value={brightness}
                                    onChange={e => setBrightness(parseInt(e.target.value))}
                                    onInput={e => setBrightness(parseInt((e.target as HTMLInputElement).value))}
                                    className="w-full accent-white h-1 bg-neutral-800 rounded-full appearance-none cursor-pointer"
                                />
                            </div>
                            <div>
                                <label className="pro-label flex justify-between">
                                    Saturation <span className="text-white">{saturation}%</span>
                                </label>
                                <input
                                    type="range"
                                    min="0"
                                    max="200"
                                    value={saturation}
                                    onChange={e => setSaturation(parseInt(e.target.value))}
                                    onInput={e => setSaturation(parseInt((e.target as HTMLInputElement).value))}
                                    className="w-full accent-white h-1 bg-neutral-800 rounded-full appearance-none cursor-pointer"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="pro-label flex justify-between">
                                        Blur <span className="text-white">{blur}px</span>
                                    </label>
                                    <input
                                        type="range"
                                        min="0"
                                        max="5"
                                        step="0.5"
                                        value={blur}
                                        onChange={e => setBlur(parseFloat(e.target.value))}
                                        onInput={e => setBlur(parseFloat((e.target as HTMLInputElement).value))}
                                        className="w-full accent-white h-1 bg-neutral-800 rounded-full appearance-none cursor-pointer"
                                    />
                                </div>
                                <div>
                                    <label className="pro-label flex justify-between">
                                        Sharpness <span className="text-white">{sharpness.toFixed(1)}</span>
                                    </label>
                                    <input
                                        type="range"
                                        min="0"
                                        max="20"
                                        step="1"
                                        value={sharpness}
                                        onChange={e => setSharpness(parseInt(e.target.value))}
                                        onInput={e => setSharpness(parseInt((e.target as HTMLInputElement).value))}
                                        className="w-full accent-white h-1 bg-neutral-800 rounded-full appearance-none cursor-pointer"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-col gap-3">
                        <button onClick={handleApply} className="pro-button w-full">Apply Adjustments</button>

                        <div className="relative">
                            <input
                                type="file"
                                accept="image/*"
                                onChange={handleFileChange}
                                className="absolute inset-0 opacity-0 cursor-pointer"
                            />
                            <button className="pro-button-secondary w-full pointer-events-none">Replace Image...</button>
                        </div>

                        <button
                            onClick={() => saveTrack(currentTrack)}
                            className="pro-button bg-blue-600 hover:bg-blue-500 border-none text-white w-full flex items-center justify-center gap-2 mt-4 shadow-blue-900/20"
                        >
                            <Save size={16} /> Save Changes to File
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
