export namespace main {
	
	export class EnvFile {
	    path: string;
	    exists: boolean;
	
	    static createFrom(source: any = {}) {
	        return new EnvFile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.exists = source["exists"];
	    }
	}
	export class EnvStatus {
	    zcodeDir: string;
	    zcodeDirExists: boolean;
	    files: Record<string, EnvFile>;
	
	    static createFrom(source: any = {}) {
	        return new EnvStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.zcodeDir = source["zcodeDir"];
	        this.zcodeDirExists = source["zcodeDirExists"];
	        this.files = this.convertValues(source["files"], EnvFile, true);
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
	export class FileItem {
	    name: string;
	    path: string;
	    size: number;
	    mtime: number;
	
	    static createFrom(source: any = {}) {
	        return new FileItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.size = source["size"];
	        this.mtime = source["mtime"];
	    }
	}
	export class MigrateResult {
	    setting: number;
	    tasks: number;
	    meta: number;
	    nodeOrders: number;
	    sessions: number;
	
	    static createFrom(source: any = {}) {
	        return new MigrateResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.setting = source["setting"];
	        this.tasks = source["tasks"];
	        this.meta = source["meta"];
	        this.nodeOrders = source["nodeOrders"];
	        this.sessions = source["sessions"];
	    }
	}
	export class OpResult {
	    ok: boolean;
	    output: string;
	
	    static createFrom(source: any = {}) {
	        return new OpResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.output = source["output"];
	    }
	}
	export class Refs {
	    setting: number;
	    tasks: number;
	    sessions: number;
	    messages: number;
	    lastSession: number;
	
	    static createFrom(source: any = {}) {
	        return new Refs(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.setting = source["setting"];
	        this.tasks = source["tasks"];
	        this.sessions = source["sessions"];
	        this.messages = source["messages"];
	        this.lastSession = source["lastSession"];
	    }
	}
	export class PathEntry {
	    path: string;
	    exists: boolean;
	    firstSeen: number;
	    firstSeenStr: string;
	    refs: Refs;
	
	    static createFrom(source: any = {}) {
	        return new PathEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.exists = source["exists"];
	        this.firstSeen = source["firstSeen"];
	        this.firstSeenStr = source["firstSeenStr"];
	        this.refs = this.convertValues(source["refs"], Refs);
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
	export class ProcStatus {
	    running: boolean;
	    count: number;
	    pids: string[];
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new ProcStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.running = source["running"];
	        this.count = source["count"];
	        this.pids = source["pids"];
	        this.error = source["error"];
	    }
	}
	export class TaskItem {
	    id: string;
	    title: string;
	    msgs: number;
	    files: number;
	    fileList: FileItem[];
	    tc: number;
	    last: number;
	    status: string;
	
	    static createFrom(source: any = {}) {
	        return new TaskItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.title = source["title"];
	        this.msgs = source["msgs"];
	        this.files = source["files"];
	        this.fileList = this.convertValues(source["fileList"], FileItem);
	        this.tc = source["tc"];
	        this.last = source["last"];
	        this.status = source["status"];
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
	export class ProjectTasksResult {
	    name: string;
	    projectPath: string;
	    tasks: TaskItem[];
	
	    static createFrom(source: any = {}) {
	        return new ProjectTasksResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.projectPath = source["projectPath"];
	        this.tasks = this.convertValues(source["tasks"], TaskItem);
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
	
	export class RemoveProjectResult {
	    setting: number;
	    tasks: number;
	    nodeOrders: number;
	    sessions: number;
	    messages: number;
	    projSettings: number;
	    diskFiles: number;
	
	    static createFrom(source: any = {}) {
	        return new RemoveProjectResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.setting = source["setting"];
	        this.tasks = source["tasks"];
	        this.nodeOrders = source["nodeOrders"];
	        this.sessions = source["sessions"];
	        this.messages = source["messages"];
	        this.projSettings = source["projSettings"];
	        this.diskFiles = source["diskFiles"];
	    }
	}
	export class RemoveTaskResult {
	    msgs: number;
	    disk: number;
	
	    static createFrom(source: any = {}) {
	        return new RemoveTaskResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.msgs = source["msgs"];
	        this.disk = source["disk"];
	    }
	}
	export class ScanResult {
	    scannedAt: string;
	    paths: PathEntry[];
	    staleCount: number;
	    excluded: number;
	
	    static createFrom(source: any = {}) {
	        return new ScanResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.scannedAt = source["scannedAt"];
	        this.paths = this.convertValues(source["paths"], PathEntry);
	        this.staleCount = source["staleCount"];
	        this.excluded = source["excluded"];
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
	export class SpaceItem {
	    path: string;
	    name: string;
	    customName: boolean;
	    exists: boolean;
	    tasks: number;
	    files: number;
	    firstUsed: string;
	    firstUsedNum: number;
	    lastUsed: string;
	    lastUsedNum: number;
	
	    static createFrom(source: any = {}) {
	        return new SpaceItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.name = source["name"];
	        this.customName = source["customName"];
	        this.exists = source["exists"];
	        this.tasks = source["tasks"];
	        this.files = source["files"];
	        this.firstUsed = source["firstUsed"];
	        this.firstUsedNum = source["firstUsedNum"];
	        this.lastUsed = source["lastUsed"];
	        this.lastUsedNum = source["lastUsedNum"];
	    }
	}
	export class SpaceTask {
	    id: string;
	    title: string;
	    cwd: string;
	    status: string;
	    deleted: boolean;
	    created: number;
	    last: number;
	    msgs: number;
	
	    static createFrom(source: any = {}) {
	        return new SpaceTask(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.title = source["title"];
	        this.cwd = source["cwd"];
	        this.status = source["status"];
	        this.deleted = source["deleted"];
	        this.created = source["created"];
	        this.last = source["last"];
	        this.msgs = source["msgs"];
	    }
	}
	export class SpaceTasksResult {
	    name: string;
	    spacePath: string;
	    tasks: SpaceTask[];
	
	    static createFrom(source: any = {}) {
	        return new SpaceTasksResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.spacePath = source["spacePath"];
	        this.tasks = this.convertValues(source["tasks"], SpaceTask);
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
	
	export class UpdateInfo {
	    current: string;
	    latest: string;
	    hasUpdate: boolean;
	    url: string;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new UpdateInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.current = source["current"];
	        this.latest = source["latest"];
	        this.hasUpdate = source["hasUpdate"];
	        this.url = source["url"];
	        this.error = source["error"];
	    }
	}
	export class WbBrokenItem {
	    path: string;
	    sessions: number;
	    sessionsCurrent: number;
	    deviceLevel: boolean;
	    isCurrent: boolean;
	
	    static createFrom(source: any = {}) {
	        return new WbBrokenItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.sessions = source["sessions"];
	        this.sessionsCurrent = source["sessionsCurrent"];
	        this.deviceLevel = source["deviceLevel"];
	        this.isCurrent = source["isCurrent"];
	    }
	}
	export class WbBroken {
	    items: WbBrokenItem[];
	    uid: string;
	
	    static createFrom(source: any = {}) {
	        return new WbBroken(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.items = this.convertValues(source["items"], WbBrokenItem);
	        this.uid = source["uid"];
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
	
	export class WbFileItem {
	    path: string;
	    name: string;
	    ext: string;
	    size: number;
	
	    static createFrom(source: any = {}) {
	        return new WbFileItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.name = source["name"];
	        this.ext = source["ext"];
	        this.size = source["size"];
	    }
	}
	export class WbMigrateResult {
	    preview: boolean;
	    sessions: number;
	    workspaces: number;
	    files: number;
	    dirs: number;
	    heartbeats: number;
	
	    static createFrom(source: any = {}) {
	        return new WbMigrateResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.preview = source["preview"];
	        this.sessions = source["sessions"];
	        this.workspaces = source["workspaces"];
	        this.files = source["files"];
	        this.dirs = source["dirs"];
	        this.heartbeats = source["heartbeats"];
	    }
	}
	export class WbRemoveResult {
	    removed: number;
	    disk: number;
	    spaces: number;
	    requested: number;
	
	    static createFrom(source: any = {}) {
	        return new WbRemoveResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.removed = source["removed"];
	        this.disk = source["disk"];
	        this.spaces = source["spaces"];
	        this.requested = source["requested"];
	    }
	}
	export class WbSession {
	    id: string;
	    title: string;
	    cwd: string;
	    msgs: number;
	    files: number;
	    stale: boolean;
	    deleted: boolean;
	    earliest: string;
	    earliestNum: number;
	    updated: string;
	    updatedNum: number;
	
	    static createFrom(source: any = {}) {
	        return new WbSession(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.title = source["title"];
	        this.cwd = source["cwd"];
	        this.msgs = source["msgs"];
	        this.files = source["files"];
	        this.stale = source["stale"];
	        this.deleted = source["deleted"];
	        this.earliest = source["earliest"];
	        this.earliestNum = source["earliestNum"];
	        this.updated = source["updated"];
	        this.updatedNum = source["updatedNum"];
	    }
	}

}

