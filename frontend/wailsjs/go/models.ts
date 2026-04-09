export namespace downloader {
	
	export class DownloadResult {
	    savedPath: string;
	    tracks: metadata.TrackMetadata[];
	    errors: string[];
	    format: string;
	    bitrate: string;
	
	    static createFrom(source: any = {}) {
	        return new DownloadResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.savedPath = source["savedPath"];
	        this.tracks = this.convertValues(source["tracks"], metadata.TrackMetadata);
	        this.errors = source["errors"];
	        this.format = source["format"];
	        this.bitrate = source["bitrate"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Status {
	    running: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Status(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.running = source["running"];
	    }
	}

}

export namespace library {
	
	export class BatchResult {
	    tracks: metadata.TrackMetadata[];
	    errors: string[];
	
	    static createFrom(source: any = {}) {
	        return new BatchResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.tracks = this.convertValues(source["tracks"], metadata.TrackMetadata);
	        this.errors = source["errors"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace main {
	
	export class BulkMetadataPatch {
	    applyAlbumArtist: boolean;
	    albumArtist: string;
	    applyArtist: boolean;
	    artist: string;
	    applyAlbum: boolean;
	    album: string;
	    applyGenre: boolean;
	    genre: string;
	    applyYear: boolean;
	    year: number;
	    applyCoverImage: boolean;
	    coverImage: string;
	    applyComment: boolean;
	    comment: string;
	
	    static createFrom(source: any = {}) {
	        return new BulkMetadataPatch(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.applyAlbumArtist = source["applyAlbumArtist"];
	        this.albumArtist = source["albumArtist"];
	        this.applyArtist = source["applyArtist"];
	        this.artist = source["artist"];
	        this.applyAlbum = source["applyAlbum"];
	        this.album = source["album"];
	        this.applyGenre = source["applyGenre"];
	        this.genre = source["genre"];
	        this.applyYear = source["applyYear"];
	        this.year = source["year"];
	        this.applyCoverImage = source["applyCoverImage"];
	        this.coverImage = source["coverImage"];
	        this.applyComment = source["applyComment"];
	        this.comment = source["comment"];
	    }
	}
	export class BulkUpdateError {
	    filePath: string;
	    error: string;
	
	    static createFrom(source: any = {}) {
	        return new BulkUpdateError(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.filePath = source["filePath"];
	        this.error = source["error"];
	    }
	}
	export class BulkUpdateResult {
	    total: number;
	    succeeded: number;
	    failed: number;
	    updated: metadata.TrackMetadata[];
	    errors: BulkUpdateError[];
	
	    static createFrom(source: any = {}) {
	        return new BulkUpdateResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.total = source["total"];
	        this.succeeded = source["succeeded"];
	        this.failed = source["failed"];
	        this.updated = this.convertValues(source["updated"], metadata.TrackMetadata);
	        this.errors = this.convertValues(source["errors"], BulkUpdateError);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ExtractAudioResult {
	    savedPath: string;
	    updatedTrack?: metadata.TrackMetadata;
	    errors?: string[];
	
	    static createFrom(source: any = {}) {
	        return new ExtractAudioResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.savedPath = source["savedPath"];
	        this.updatedTrack = this.convertValues(source["updatedTrack"], metadata.TrackMetadata);
	        this.errors = source["errors"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class TrimResult {
	    updatedTrack?: metadata.TrackMetadata;
	    backup?: media.TrimBackup;
	
	    static createFrom(source: any = {}) {
	        return new TrimResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.updatedTrack = this.convertValues(source["updatedTrack"], metadata.TrackMetadata);
	        this.backup = this.convertValues(source["backup"], media.TrimBackup);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace media {
	
	export class TrimBackup {
	    id: string;
	    originalPath: string;
	    backupPath: string;
	    createdAt: number;
	    expiresAt: number;
	    mode: string;
	    startMs: number;
	    endMs: number;
	
	    static createFrom(source: any = {}) {
	        return new TrimBackup(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.originalPath = source["originalPath"];
	        this.backupPath = source["backupPath"];
	        this.createdAt = source["createdAt"];
	        this.expiresAt = source["expiresAt"];
	        this.mode = source["mode"];
	        this.startMs = source["startMs"];
	        this.endMs = source["endMs"];
	    }
	}
	export class WaveformResult {
	    durationMs: number;
	    peaks: number[];
	
	    static createFrom(source: any = {}) {
	        return new WaveformResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.durationMs = source["durationMs"];
	        this.peaks = source["peaks"];
	    }
	}

}

export namespace metadata {
	
	export class TrackMetadata {
	    filePath: string;
	    fileName: string;
	    title: string;
	    artist: string;
	    album: string;
	    albumArtist: string;
	    trackNumber: number;
	    discNumber: number;
	    genre: string;
	    year: number;
	    comment: string;
	    composer: string;
	    lyrics: string;
	    hasCover: boolean;
	    coverImage: string;
	    format: string;
	    bitrate: number;
	    sampleRate: number;
	
	    static createFrom(source: any = {}) {
	        return new TrackMetadata(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.filePath = source["filePath"];
	        this.fileName = source["fileName"];
	        this.title = source["title"];
	        this.artist = source["artist"];
	        this.album = source["album"];
	        this.albumArtist = source["albumArtist"];
	        this.trackNumber = source["trackNumber"];
	        this.discNumber = source["discNumber"];
	        this.genre = source["genre"];
	        this.year = source["year"];
	        this.comment = source["comment"];
	        this.composer = source["composer"];
	        this.lyrics = source["lyrics"];
	        this.hasCover = source["hasCover"];
	        this.coverImage = source["coverImage"];
	        this.format = source["format"];
	        this.bitrate = source["bitrate"];
	        this.sampleRate = source["sampleRate"];
	    }
	}

}

export namespace soundcloud {
	
	export class AuthStatus {
	    configured: boolean;
	    connected: boolean;
	    username: string;
	    clientId: string;
	
	    static createFrom(source: any = {}) {
	        return new AuthStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.configured = source["configured"];
	        this.connected = source["connected"];
	        this.username = source["username"];
	        this.clientId = source["clientId"];
	    }
	}
	export class Track {
	    title: string;
	    artist: string;
	    permalinkUrl: string;
	    artworkUrl: string;
	    durationMs: number;
	
	    static createFrom(source: any = {}) {
	        return new Track(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.title = source["title"];
	        this.artist = source["artist"];
	        this.permalinkUrl = source["permalinkUrl"];
	        this.artworkUrl = source["artworkUrl"];
	        this.durationMs = source["durationMs"];
	    }
	}
	export class LikesPage {
	    tracks: Track[];
	    nextHref: string;
	
	    static createFrom(source: any = {}) {
	        return new LikesPage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.tracks = this.convertValues(source["tracks"], Track);
	        this.nextHref = source["nextHref"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

