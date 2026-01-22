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

