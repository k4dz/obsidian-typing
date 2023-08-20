import builtins from "builtin-modules";
import chokidar from "chokidar";
import esbuild from "esbuild";
import { postcssModules, sassPlugin } from "esbuild-sass-plugin";
import fs from "fs";
import process from "process";
import Tsm from "typed-scss-modules";
import { lezerPlugin } from "./esbuild-lezer-plugin.mjs";

const banner = `/*
THIS IS A GENERATED/BUNDLED FILE BY ESBUILD
if you want to view the source, please visit the github repository of this plugin
*/
`;

const prod = process.argv[2] === "production";

// generates and regenerates scss type declarations
export const scssTypesPlugin = (stylesPattern, watch) => {
    const generateScssTypeDeclarations = async (pattern, options) => {
        console.log("GENERATE SCSS TYPES", pattern, options, Tsm);
        await Tsm.default(pattern, options);
    };

    let setupDone = false;

    return {
        name: "scss-types-plugin",
        setup(build) {
            console.log("setup", stylesPattern);
            build.onStart(async () => {
                console.log("onstart");
                await generateScssTypeDeclarations(stylesPattern);
                setupDone = true;
            });

            if (watch) {
                console.log("setup watch");
                chokidar.watch(stylesPattern).on(
                    "all", // was on(change)
                    async (event, filename) => {
                        console.log("onwatch", event, filename);
                        if (event == "add" && !setupDone) return;
                        if (!(event == "change" || event == "add")) return;
                        await generateScssTypeDeclarations(filename);
                    }
                );
            }
        },
    };
};

// renames `main.css` to `styles.css` in build dir
const renameCompiledCSS = {
    name: "rename-compiled-css",
    setup(build) {
        build.onEnd(() => {
            const { outfile } = build.initialOptions;
            const outCssSrc = outfile.replace(/\.js$/, ".css");
            const outCssDst = outfile.replace(/main\.js$/, "styles.css");
            if (fs.existsSync(outCssSrc)) {
                console.log(`RENAME COMPILED CSS: ${outCssSrc} -> ${outCssDst}`);
                fs.renameSync(outCssSrc, outCssDst);
            }
        });
    },
};

// copies `manifest.json` to build dir
const copyManifest = {
    name: "copy-manifest",
    setup(build) {
        build.onEnd(() => {
            const { outfile } = build.initialOptions;
            const manifestSrc = "manifest.json";
            const manifestDst = outfile.replace(/main\.js$/, "manifest.json");
            if (fs.existsSync(manifestSrc)) {
                console.log(`COPY MANIFEST: ${manifestSrc} -> ${manifestDst}`);
                fs.copyFileSync(manifestSrc, manifestDst);
            }
        });
    },
};

const context = await esbuild.context({
    banner: {
        js: banner,
    },
    entryPoints: ["src/main.tsx"],
    bundle: true,
    external: [
        "obsidian",
        "electron",
        // "@codemirror/autocomplete",
        "@codemirror/collab",
        // "@codemirror/commands",
        "@codemirror/language",
        // "@codemirror/lint",
        "@codemirror/search",
        "@codemirror/state",
        "@codemirror/view",
        "@lezer/common",
        "@lezer/highlight",
        "@lezer/lr",
        ...builtins,
    ],
    format: "cjs",
    target: "es6",
    logLevel: "info",
    // sourcemap: prod ? false : "inline",
    sourcemap: true,
    metafile: false,
    // minifyWhitespace: true,
    // ref: https://github.com/mgmeyers/obsidian-kanban/blob/05e43e09100f8c8efd7a4cd5ccb391b850e65f28/esbuild.config.js#L129C8-L129C8
    inject: ["src/preact-globals.ts"],
    treeShaking: true,
    outfile: "build/main.js",
    alias: {
        react: "preact/compat",
        "react-dom": "preact/compat",
    },
    plugins: [
        lezerPlugin("./src/language/grammar/otl.grammar", !prod),
        scssTypesPlugin("src/styles/**/*.scss", !prod),
        sassPlugin({
            basedir: ".",
            transform: postcssModules({
                localsConvention: "camelCaseOnly",
                // generateScopedName: "typing--[local]",
                generateScopedName: (name, filename, css) => {
                    console.log("gen scoped name", name, filename);
                    if (filename.includes("notranspile")) return name;
                    // return `typing--${name}`;
                    return name;
                },
                // generateScopedName: "[name]__[local]",
            }),
            type: "css",
        }),
        renameCompiledCSS,
        copyManifest,
    ],
});

if (prod) {
    await context.rebuild();
    process.exit(0);
} else {
    await context.watch();
}