import { TFile } from "obsidian";
import { LiteralValue } from "obsidian-dataview";
import { gctx } from "src/context";
import { autoFieldAccessor, IFieldAccessor } from "src/middleware/field_accessor";
import { bindCollection, DataClass, field, RenderLink } from "src/utilities";
import { HookContextType, HookNames, RelationsProxy, Type } from ".";

export interface NoteState {
    type: Type;
    prefix?: string;
    title?: string;
    fields?: Record<string, string>;
    text?: string;
}

export class Note {
    public type: Type | null;
    private _methods: Record<string, Function>;
    private _actions: Record<string, Function>;
    private _relations: RelationsProxy;
    private _fields: FieldsProxy;
    // private _page: Record<string, any>;

    get fields() {
        if (!this.type) return null;
        if (!this._fields) this._fields = FieldsProxy.new({ note: this });
        return this._fields.proxy;
    }

    get actions() {
        if (!this.type) return null;
        if (!this._actions) this._actions = bindCollection(this.type.actions, { note: this, type: this.type });
        return this._actions;
    }

    get methods() {
        if (!this.type) return null;
        if (!this._methods) this._methods = bindCollection(this.type.methods, { note: this, type: this.type });
        return this._methods;
    }

    get relations() {
        if (!this.type) return null;
        if (!this._relations) this._relations = RelationsProxy.new({ note: this });
        return this._relations;
    }

    get page(): Record<string, LiteralValue> {
        return gctx.dv.page(this.path);
        // if (!this._page) this._page = gctx.dv.page(this.path);
        // return this._page;
    }

    constructor(public path: string, type?: Type) {
        this.type = type ?? gctx.graph.get({ path });

        if (this.type == null) {
            // support for type specification via frontmatter field `_type`
            // TODO: do this only if it is configured
            let file = this.file;
            if (this.file) {
                let explicitTypeName = gctx.app.metadataCache.getFileCache(file)?.frontmatter?._type;
                if (explicitTypeName) {
                    this.type = gctx.graph.get({ name: explicitTypeName });
                }
            }
        }

        if (this.type == null) this.type = gctx.graph.get({ name: "default" });

        if (this.type == null) {
            return;
        }
    }

    // more explicit alias for note.page
    get dvpage() {
        return this.page;
    }

    get folder(): string {
        let lastIndexOfPathSep = this.path.lastIndexOf("/");
        if (lastIndexOfPathSep != -1) {
            return this.path.slice(0, lastIndexOfPathSep);
        } else {
            return "";
        }
    }

    get filename(): string {
        let lastIndexOfPathSep = this.path.lastIndexOf("/");

        return this.path.slice(lastIndexOfPathSep + 1, this.path.length);
    }

    get fullname(): string {
        let filename = this.filename;

        return filename.slice(0, filename.lastIndexOf("."));
    }

    get prefix(): string {
        if (this.type?.prefix) {
            return this.type.prefix.parse(this.fullname).prefix;
        } else {
            return "";
        }
    }

    get extension(): string {
        let filename = this.filename;

        return filename.slice(filename.lastIndexOf(".") + 1);
    }

    get title(): string {
        if (this.type?.prefix) {
            return this.type.prefix.parse(this.fullname).name;
        } else {
            return this.fullname;
        }
    }

    set title(title: string) {
        this.rename({ title });
    }

    get state(): Promise<NoteState> {
        return new Promise((resolve) => resolve(this.getState()));
    }

    set state(state: NoteState | Promise<NoteState>) {
        (async () => this.applyState(await state))();
    }

    async getState(): Promise<NoteState> {
        let fields: Record<string, string> = {};
        if (this.typed) {
            for (let fieldName in this.type.fields) {
                fields[fieldName] = await this.fields[fieldName];
            }
        }
        return { title: this.title, fields, type: this.type, prefix: this.prefix };
    }

    // TODO: rename to setState?
    async applyState(newState?: NoteState) {
        if (newState == null) {
            return;
        }
        let state = await this.state;
        for (let fieldName in newState.fields) {
            if (state.fields[fieldName] != newState.fields[fieldName]) {
                await this._fields.setValue(fieldName, newState.fields[fieldName]);
            }
        }
        if (state.title != newState.title) {
            await this.rename({ title: newState.title });
        }
    }

    async runAction(name: string) {
        this.type.actions[name].script.call({ note: this });
    }

    async runHook<T extends HookNames>(name: T, context: HookContextType<T>) {
        this.type.hooks.run(name, context);
    }

    async rename({
        title,
        filename,
        extension,
        prefix,
        folder,
        path,
    }: {
        title?: string;
        filename?: string;
        extension?: string;
        prefix?: string;
        folder?: string;
        path?: string;
    }) {
        if (path == null) {
            if (filename == null) {
                title = title ?? this.title;
                prefix = prefix ?? this.prefix;
                extension = extension ?? this.extension;
                let noteName = `${prefix} ${title}`.trim();
                filename = `${noteName}.${extension}`;
            }
            folder = folder ?? this.folder;
            path = `${folder}/${filename}`;
        }
        let prevPath = this.file.path;
        let prevFilename = this.filename;
        let prevFullname = this.fullname;
        let prevTitle = this.title;

        await gctx.app.fileManager.renameFile(this.file, path);
        this.path = path;

        // TODO: rewrite as a global callback
        this.runHook(HookNames.ON_RENAME, { note: this, prevPath, prevFilename, prevFullname, prevTitle });
    }

    super(typeName?: string) {
        if (!this.type) return this;
        if (!typeName) {
            if (this.type.parentNames.length == 1) {
                typeName = this.type.parentNames[0];
            } else {
                throw new Error(
                    `Type ${this.type.name} has ${this.type.parentNames.length}!=1 parents. Please specify parent type name explictly`
                );
            }
        }
        let superType = gctx.graph.get({ name: typeName });
        if (!superType) {
            throw new Error(`Invalid super type: ${typeName} does not exist`);
        }
        if (!gctx.graph.isinstance(this.type, superType)) {
            throw new Error(`Invalid super type: ${typeName} is not a parent of ${this.type.name}`);
        }
        return new Note(this.path, superType);
    }

    get typed() {
        return this.type != null;
    }

    get file(): TFile {
        let tfile = gctx.app.vault.getAbstractFileByPath(this.path);
        if (!tfile) {
            return null;
        }
        if (!(tfile instanceof TFile)) {
            // TODO: this is probably not right, but I think this should be noexcept
            return null;
        }
        return tfile;
    }

    Link = (props: { children?: any; container?: HTMLElement; linkText?: string }) => {
        return (
            <a class="internal-link" href={this.path}>
                {props?.children ?? <RenderLink note={this} type={this.type} {...props} />}
            </a>
        );
    };

    // TODO
    Header = () => {};
    Footer = () => {};

    async open() {
        let tfile = this.file;
        if (tfile) {
            await gctx.app.workspace.getLeaf().openFile(tfile);
        }
    }
}

class FieldsProxy extends DataClass {
    @field()
    note: Note;

    accessor: IFieldAccessor;
    proxy: Record<string, Promise<string> | string> = {};

    onAfterCreate(): void {
        this.accessor = autoFieldAccessor(this.note.path, gctx.plugin);
        let proxy = this;

        for (let fieldName in this.note.type.fields) {
            Reflect.defineProperty(this.proxy, fieldName, {
                get: async function () {
                    return proxy.getValue(fieldName);
                },
                set: async function (value: string | Promise<string>) {
                    return proxy.setValue(fieldName, value);
                },
            });
        }
    }

    async getValue(fieldName: string) {
        try {
            return await this.accessor.getValue(fieldName);
        } catch (e) {
            return undefined;
        }
    }

    async setValue(fieldName: string, value: string | Promise<string>) {
        return this.accessor.setValue(fieldName, await value);
    }
}
