import {
    Plugin,
    TAbstractFile,
    parseYaml,
    MarkdownView,
    WorkspaceLeaf,
    addIcon,
    TFile,
    Platform,
} from "obsidian";
import { DataviewApi } from "obsidian-dataview";
import {
    registerMarginalsPostProcessors,
    monkeyPatchPreviewView,
} from "src/marginals";
import { registry } from "./type";
import { registerLinksPostProcessor } from "./link";
import { TypedNote } from "./typed_note";
import { Config } from "./config";
import { hideInlineFields } from "./utils";
import { ctx } from "./context";
import ReactDOM from "react-dom";
import { ViewTitle } from "./components/view_title";
import React from "react";
import {
    ActionsFuzzySuggestModal,
    ActionsModal,
    StringSuggestModal,
    TypeSuggestModal,
} from "./modals";

export default class TypingPlugin extends Plugin {
    conf: Config;
    configPath: string = "typing.yaml";

    async onload() {
        console.log("Typing: loading");
        ctx.setApp(this.app);
        ctx.setPlugin(this);

        addIcon(
            "grid",
            `<path stroke="currentColor" fill="currentColor" d="m 34.375,0 h -25 c -5.1777344,0 -9.375,4.1972656 -9.375,9.375 v 25 c 0,5.175781 4.1972656,9.375 9.375,9.375 h 25 c 5.175781,0 9.375,-4.199219 9.375,-9.375 v -25 c 0,-5.1777344 -4.199219,-9.375 -9.375,-9.375 z m 56.25,56.25 h -25 c -5.175781,0 -9.375,4.199219 -9.375,9.375 v 25 c 0,5.177734 4.197266,9.375 9.375,9.375 h 25 c 5.177734,0 9.375,-4.197266 9.375,-9.375 v -25 c 0,-5.175781 -4.199219,-9.375 -9.375,-9.375 z m 0,-56.25 h -25 c -5.175781,0 -9.375,4.1972656 -9.375,9.375 v 25 c 0,5.175781 4.199219,9.375 9.375,9.375 h 25 c 5.175781,0 9.375,-4.199219 9.375,-9.375 v -25 c 0,-5.1777344 -4.199219,-9.375 -9.375,-9.375 z m -56.25,56.25 h -25 c -5.1777344,0 -9.375,4.199219 -9.375,9.375 v 25 c 0,5.175781 4.1972656,9.375 9.375,9.375 h 25 c 5.175781,0 9.375,-4.199219 9.375,-9.375 v -25 c 0,-5.175781 -4.199219,-9.375 -9.375,-9.375 z" />`
        );

        this.addCommand({
            id: "typing-find",
            name: "Find",
            callback: () => {},
        });

        this.addCommand({
            id: "typing-new",
            name: "New",
            callback: async () => {
                new TypeSuggestModal(this.app, async (type) => {
                    let options = await type.promptNew();
                    if (!options.success) {
                        return;
                    }

                    let newPath = await type.new(options.name, options.fields);
                    this.app.workspace.activeLeaf.openFile(
                        this.app.vault.getAbstractFileByPath(newPath) as TFile
                    );
                }).open();
            },
        });

        // this.addCommand({
        //     id: "typing-change-type",
        //     name: "Change Type",
        //     callback: () => {},
        // });

        this.addCommand({
            id: "typing-field",
            name: "Set Field",
            callback: async () => {
                let note = this.currentNote;
                if (note) {
                    let fieldNames = note.type.fields.map(
                        (field) => field.name
                    );
                    new StringSuggestModal(
                        this.app,
                        fieldNames,
                        async (field) => {
                            let newValue = await note.promptField(field);
                            if (newValue != null) {
                                note.setField(field, newValue);
                            }
                        }
                    ).open();
                }
            },
        });

        this.addCommand({
            id: "typing-actions",
            name: "Open Actions",
            callback: () => {
                let note = this.currentNote;
                if (note) {
                    this.openActions(note);
                }
            },
        });

        registerMarginalsPostProcessors(this);
        monkeyPatchPreviewView(this);
        registerLinksPostProcessor(this);
        this.registerMarkdownPostProcessor(hideInlineFields);

        this.reloadConfig();
        this.setConfigReloader();

        this.app.workspace.onLayoutReady(this.processLeaves);
        this.app.workspace.on("layout-change", this.processLeaves);
    }

    get currentNote(): TypedNote | null {
        let leaf = this.app.workspace.activeLeaf;
        if (leaf.view.getViewType() != "markdown") {
            return null;
        }
        let view = leaf.view as MarkdownView;
        let note = this.asTyped(view.file.path);
        return note;
    }

    processLeaves = () => {
        this.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
            if (leaf.view.getViewType() != "markdown") {
                return;
            }
            let view = leaf.view as MarkdownView;
            let note = this.asTyped(view.file.path);

            this.addViewActionsMenu(view, note);
            this.setViewTitle(view, note);
        });
    };

    addViewActionsMenu(view: MarkdownView, note: TypedNote) {
        let actionsEl = view.containerEl.querySelector(
            ".view-actions"
        ) as HTMLElement;
        if (!actionsEl.querySelector(`a.view-action[aria-label="Actions"]`)) {
            view.addAction("grid", "Actions", () => {
                this.openActions(this.asTyped(view.file.path));
            });
        }
    }

    openActions(note: TypedNote) {
        if (Platform.isMobile) {
            new ActionsModal(
                this.app,
                note.actions,
                this.conf.pinnedActions,
                note
            ).open();
        } else {
            new ActionsFuzzySuggestModal(
                this.app,
                note.actions,
                this.conf.pinnedActions,
                note
            ).open();
        }
    }

    setViewTitle(view: MarkdownView, note: TypedNote) {
        let titleContainerEl = view.containerEl.querySelector(
            ".view-header-title-container"
        ) as HTMLElement;

        let name = null,
            prefix = null;
        if (note.prefix) {
            let tmp = note.prefix.splitByPrefix(note.name);
            name = tmp.name;
            prefix = tmp.prefix;
        } else {
            name = note.name;
        }

        ReactDOM.render(
            <ViewTitle
                prefix={prefix}
                name={name}
                onNameClick={async () => {
                    let newName = await note.promptName();
                    if (newName != null) {
                        await note.rename(newName);
                    }
                }}
            ></ViewTitle>,
            titleContainerEl
        );
    }

    asTyped(path: string): TypedNote | null {
        return TypedNote.fromPath(path, this.conf);
    }

    getDefaultContext(note: TypedNote) {
        return {
            dv: this.syncDataviewApi(),
            plugin: this,
            app: this.app,
            note: note,
            type: note.type,
            TypedNote: TypedNote,
            registry: registry,
        };
    }

    onunload() {
        console.log("Typing: unloading");
        this.app.workspace.off("layout-change", this.processLeaves);
    }

    async asyncDataviewApi(): Promise<DataviewApi> {
        let dvPlugin = this.app.plugins.plugins.dataview;
        if (dvPlugin.api) {
            return dvPlugin.api;
        }
        return await new Promise((resolve) => {
            this.app.metadataCache.on(
                "dataview:api-ready",
                (api: DataviewApi) => {
                    resolve(api);
                }
            );
        });
    }

    syncDataviewApi(): DataviewApi {
        return this.app.plugins.plugins.dataview.api;
    }

    setConfigReloader() {
        this.registerEvent(
            this.app.vault.on("modify", (file: TAbstractFile) => {
                if (file.path === this.configPath) {
                    this.reloadConfig();
                }
            })
        );
    }

    async reloadConfig() {
        let configSpec = parseYaml(
            await this.app.vault.adapter.read(this.configPath)
        );
        this.conf = await Config.fromSpec(configSpec);
    }
}
