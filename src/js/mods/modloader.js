/* typehints:start */
import { Application } from "../application";
/* typehints:end */
import { globalConfig } from "../core/config";
import { createLogger } from "../core/logging";
import { StorageImplBrowserIndexedDB } from "../platform/browser/storage_indexed_db";
import { StorageImplElectron } from "../platform/electron/storage";
import { FILE_NOT_FOUND } from "../platform/storage";
import { Mod } from "./mod";
import { ModInterface } from "./mod_interface";
import { MOD_SIGNALS } from "./mod_signals";

import semverValidRange from "semver/ranges/valid";
import semverSatisifies from "semver/functions/satisfies";

const LOG = createLogger("mods");

const BUILTIN_DISABLED_MODS_KEY = "shapez_builtin_disabled_mods";

/**
 * Returns the ids of the builtin mods which are currently disabled by the user
 * @returns {string[]}
 */
export function getDisabledBuiltinMods() {
    try {
        const raw = localStorage.getItem(BUILTIN_DISABLED_MODS_KEY);
        if (!raw) {
            return [];
        }
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (ex) {
        LOG.warn("Failed to read disabled builtin mods:", ex);
        return [];
    }
}

/**
 * Enables or disables a builtin mod, this takes effect after a restart
 * @param {string} id
 * @param {boolean} disabled
 */
export function setBuiltinModDisabled(id, disabled) {
    const current = getDisabledBuiltinMods().filter(entry => entry !== id);
    if (disabled) {
        current.push(id);
    }
    try {
        localStorage.setItem(BUILTIN_DISABLED_MODS_KEY, JSON.stringify(current));
    } catch (ex) {
        LOG.warn("Failed to store disabled builtin mods:", ex);
    }
}

/**
 * @typedef {{
 *   name: string;
 *   version: string;
 *   author: string;
 *   website: string;
 *   description: string;
 *   id: string;
 *   minimumGameVersion?: string;
 *   settings: [];
 *   doesNotAffectSavegame?: boolean
 * }} ModMetadata
 */

export class ModLoader {
    constructor() {
        LOG.log("modloader created");

        /**
         * @type {Application}
         */
        this.app = undefined;

        /** @type {Mod[]} */
        this.mods = [];

        this.modInterface = new ModInterface(this);

        /** @type {({ meta: ModMetadata, modClass: typeof Mod})[]} */
        this.modLoadQueue = [];

        /**
         * Metadata of all builtin mods (including disabled ones), used by the mods UI
         * @type {Array<{ file: string, id?: string, name?: string, version?: string, author?: string, description?: string }>}
         */
        this.builtinModManifest = [];


        this.initialized = false;

        this.signals = MOD_SIGNALS;
    }

    linkApp(app) {
        this.app = app;
    }

    anyModsActive() {
        return this.mods.length > 0;
    }

    /**
     *
     * @returns {import("../savegame/savegame_typedefs").SavegameStoredMods}
     */
    getModsListForSavegame() {
        return this.mods
            .filter(mod => !mod.metadata.doesNotAffectSavegame)
            .map(mod => ({
                id: mod.metadata.id,
                version: mod.metadata.version,
                website: mod.metadata.website,
                name: mod.metadata.name,
                author: mod.metadata.author,
            }));
    }

    /**
     *
     * @param {import("../savegame/savegame_typedefs").SavegameStoredMods} originalMods
     */
    computeModDifference(originalMods) {
        /**
         * @type {import("../savegame/savegame_typedefs").SavegameStoredMods}
         */
        let missing = [];

        const current = this.getModsListForSavegame();

        originalMods.forEach(mod => {
            for (let i = 0; i < current.length; ++i) {
                const currentMod = current[i];
                if (currentMod.id === mod.id && currentMod.version === mod.version) {
                    current.splice(i, 1);
                    return;
                }
            }
            missing.push(mod);
        });

        return {
            missing,
            extra: current,
        };
    }

    exposeExports() {
        if (G_IS_STEAM_DEMO) {
            return;
        }

        let exports = {};
        const modules = require.context("../", true, /\.js$/);
        Array.from(modules.keys()).forEach(key => {
            // @ts-ignore
            const module = modules(key);
            for (const member in module) {
                if (member === "default" || member === "__$S__") {
                    // Setter
                    continue;
                }
                if (exports[member]) {
                    // Optimized builds may expose the same member from multiple modules.
                    // Keep the first one instead of failing to boot the game.
                    continue;
                }

                Object.defineProperty(exports, member, {
                    get() {
                        return module[member];
                    },
                    set(v) {
                        module.__$S__(member, v);
                    },
                });
            }
        });

        window.shapez = exports;
    }

    async initMods() {
        if (G_IS_STEAM_DEMO) {
            this.initialized = true;
            return;
        }

        // Create a storage for reading mod settings
        const storage = G_IS_STANDALONE
            ? new StorageImplElectron(this.app)
            : new StorageImplBrowserIndexedDB(this.app);
        await storage.initialize();

        LOG.log("hook:init", this.app, this.app.storage);
        this.exposeExports();

        let mods = [];

        // Load the mods bundled with the game, this works fully offline
        try {
            const manifestResponse = await fetch("builtin_mods/index.json", {
                method: "GET",
                cache: "no-cache",
            });
            if (manifestResponse.status === 200) {
                const manifest = await manifestResponse.json();
                const entries = manifest.map(entry => (typeof entry === "string" ? { file: entry } : entry));
                this.builtinModManifest = entries;
                const disabledMods = getDisabledBuiltinMods();
                for (let i = 0; i < entries.length; ++i) {
                    const entry = entries[i];
                    if (entry.id && disabledMods.indexOf(entry.id) !== -1) {
                        LOG.log("Skipping disabled builtin mod:", entry.id);
                        continue;
                    }
                    const response = await fetch("builtin_mods/" + entry.file, {
                        method: "GET",
                        cache: "no-cache",
                    });
                    if (response.status !== 200) {
                        console.warn("Failed to load builtin mod", entry.file);
                        continue;
                    }
                    mods.push(await response.text());
                }
            }
        } catch (ex) {
            console.warn("Failed to load builtin mods:", ex);
        }

        if (G_IS_STANDALONE) {
            mods = mods.concat(await ipcRenderer.invoke("get-mods"));
        }
        if (G_IS_DEV && globalConfig.debug.externalModUrl) {
            const modURLs = Array.isArray(globalConfig.debug.externalModUrl)
                ? globalConfig.debug.externalModUrl
                : [globalConfig.debug.externalModUrl];

            for (let i = 0; i < modURLs.length; i++) {
                const response = await fetch(modURLs[i], {
                    method: "GET",
                });
                if (response.status !== 200) {
                    throw new Error(
                        "Failed to load " + modURLs[i] + ": " + response.status + " " + response.statusText
                    );
                }
                mods.push(await response.text());
            }
        }

        window.$shapez_registerMod = (modClass, meta) => {
            if (this.initialized) {
                throw new Error("Can't register mod after modloader is initialized");
            }
            if (this.modLoadQueue.some(entry => entry.meta.id === meta.id)) {
                console.warn("Not registering mod", meta, "since a mod with the same id is already loaded");
                return;
            }
            this.modLoadQueue.push({
                modClass,
                meta,
            });
        };

        mods.forEach(modCode => {
            modCode += `
                        if (typeof Mod !== 'undefined') {
                            if (typeof METADATA !== 'object') {
                                throw new Error("No METADATA variable found");
                            }
                            window.$shapez_registerMod(Mod, METADATA);
                        }
                    `;
            try {
                const func = new Function(modCode);
                func();
            } catch (ex) {
                console.error(ex);
                alert("Failed to parse mod (launch with --dev for more info): \n\n" + ex);
            }
        });

        delete window.$shapez_registerMod;

        for (let i = 0; i < this.modLoadQueue.length; i++) {
            const { modClass, meta } = this.modLoadQueue[i];
            const modDataFile = "modsettings_" + meta.id + "__" + meta.version + ".json";

            if (meta.minimumGameVersion) {
                const minimumGameVersion = meta.minimumGameVersion;
                if (!semverValidRange(minimumGameVersion)) {
                    alert("Mod " + meta.id + " has invalid minimumGameVersion: " + minimumGameVersion);
                    continue;
                }
                if (!semverSatisifies(G_BUILD_VERSION, minimumGameVersion)) {
                    alert(
                        "Mod  '" +
                            meta.id +
                            "' is incompatible with this version of the game: \n\n" +
                            "Mod requires version " +
                            minimumGameVersion +
                            " but this game has version " +
                            G_BUILD_VERSION
                    );
                    continue;
                }
            }

            let settings = meta.settings;

            if (meta.settings) {
                try {
                    const storedSettings = await storage.readFileAsync(modDataFile);
                    settings = JSON.parse(storedSettings);
                } catch (ex) {
                    if (ex === FILE_NOT_FOUND) {
                        // Write default data
                        await storage.writeFileAsync(modDataFile, JSON.stringify(meta.settings));
                    } else {
                        alert("Failed to load settings for " + meta.id + ", will use defaults:\n\n" + ex);
                    }
                }
            }

            try {
                const mod = new modClass({
                    app: this.app,
                    modLoader: this,
                    meta,
                    settings,
                    saveSettings: () => storage.writeFileAsync(modDataFile, JSON.stringify(mod.settings)),
                });

                // Some mods defer their setup to an `onReady` hook which they only invoke
                // after the app booted. If their internal promise chain fails (e.g. because
                // the storage is not ready yet during boot) the hook never runs, leaving
                // parts of the mod (such as its settings state) uninitialized. Track the
                // invocation and call it ourselves as a fallback once the app booted.
                let onReadyCalled = false;
                if (typeof mod.onReady === "function") {
                    const originalOnReady = mod.onReady;
                    mod.onReady = function (...args) {
                        onReadyCalled = true;
                        return originalOnReady.apply(this, args);
                    };
                    MOD_SIGNALS.appBooted.add(() => {
                        setTimeout(() => {
                            if (onReadyCalled) {
                                return;
                            }
                            try {
                                LOG.log("Running deferred onReady of mod", meta.id);
                                mod.onReady();
                            } catch (ex) {
                                LOG.warn("Failed to run deferred onReady of mod", meta.id, ex);
                            }
                        }, 0);
                    });
                }

                await mod.init();
                this.mods.push(mod);
            } catch (ex) {
                console.error(ex);
                alert("Failed to initialize mods (launch with --dev for more info): \n\n" + ex);
            }
        }

        this.modLoadQueue = [];
        this.initialized = true;
    }
}

export const MODS = new ModLoader();
