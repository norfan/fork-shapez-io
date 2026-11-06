import { isCapacitorApp, openStandaloneLink, THIRDPARTY_URLS } from "../core/config";
import { WEB_STEAM_SSO_AUTHENTICATED } from "../core/steam_sso";
import { TextualGameState } from "../core/textual_game_state";
import { getDisabledBuiltinMods, MODS, setBuiltinModDisabled } from "../mods/modloader";
import { T } from "../translations";

export class ModsState extends TextualGameState {
    constructor() {
        super("ModsState");
    }

    getStateHeaderTitle() {
        return T.mods.title;
    }

    get modsSupported() {
        if (isCapacitorApp()) {
            // Our offline build ships mods inside the app, so they are always supported
            return true;
        }
        return (
            !WEB_STEAM_SSO_AUTHENTICATED &&
            !G_IS_STEAM_DEMO &&
            (G_IS_STANDALONE || (G_IS_DEV && !window.location.href.includes("demo")))
        );
    }

    internalGetFullHtml() {
        let headerHtml = `
            <div class="headerBar">
                <h1><button class="backButton"></button> ${this.getStateHeaderTitle()}</h1>

                <div class="actions">
                   ${
                       this.modsSupported && !isCapacitorApp() && MODS.mods.length > 0
                           ? `<button class="styledButton browseMods">${T.mods.browseMods}</button>`
                           : ""
                   }
                   ${
                       this.modsSupported && !isCapacitorApp()
                           ? `<button class="styledButton openModsFolder">${T.mods.openFolder}</button>`
                           : ""
                   }
                </div>

            </div>`;

        return `
            ${headerHtml}
            <div class="container">
                    ${this.getInnerHTML()}
            </div>
        `;
    }

    getMainContentHTML() {
        if (isCapacitorApp() && MODS.builtinModManifest.length > 0) {
            // The offline build has builtin mods which are shipped with the app,
            // list them so the player can see and toggle them
            return this.getBuiltinModsHTML();
        }

        if (!this.modsSupported) {
            return `
                <div class="noModSupport">

                    <p>${WEB_STEAM_SSO_AUTHENTICATED ? T.mods.browserNoSupport : T.mods.noModSupport}</p>
                    <br>
                    <button class="styledButton browseMods">${T.mods.browseMods}</button>
                    <a href="#" class="steamLink steam_dlbtn_0" target="_blank">Get on Steam!</a>


                </div>
            `;
        }

        if (MODS.mods.length === 0) {
            return `

            <div class="modsStats noMods">
                ${T.mods.modsInfo}

                <button class="styledButton browseMods">${T.mods.browseMods}</button>
            </div>

            `;
        }

        let modsHtml = ``;

        MODS.mods.forEach(mod => {
            modsHtml += `
                <div class="mod">
                    <div class="mainInfo">
                        <span class="name">${mod.metadata.name}</span>
                        <span class="description">${mod.metadata.description}</span>
                        <a class="website" href="${mod.metadata.website}" target="_blank">${T.mods.modWebsite}</a>
                    </div>
                    <span class="version"><strong>${T.mods.version}</strong>${mod.metadata.version}</span>
                    <span class="author"><strong>${T.mods.author}</strong>${mod.metadata.author}</span>
                    <div class="value checkbox checked">
                        <span class="knob"></span>
                    </div>

                </div>
            `;
        });
        return `

            <div class="modsStats">
                ${T.mods.modsInfo}
            </div>

            <div class="modsList">
                ${modsHtml}
           </div>
        `;
    }

    /**
     * Renders the list of builtin mods of the offline build
     * @returns {string}
     */
    getBuiltinModsHTML() {
        const disabledMods = getDisabledBuiltinMods();
        let modsHtml = ``;

        MODS.builtinModManifest.forEach(entry => {
            const isDisabled = entry.id ? disabledMods.indexOf(entry.id) !== -1 : false;
            modsHtml += `
                <div class="mod" data-mod-id="${entry.id || ""}">
                    <div class="mainInfo">
                        <span class="name">${entry.name || entry.file}</span>
                        <span class="description">${entry.description || ""}</span>
                        ${
                            entry.settingsState
                                ? `<span class="settingsButton" data-state="${entry.settingsState}" style="pointer-events:all;cursor:pointer;text-decoration:underline;align-self:flex-start;margin-top:5px">打开设置</span>`
                                : ""
                        }
                    </div>
                    <span class="version"><strong>${T.mods.version}</strong>${entry.version || ""}</span>
                    <span class="author"><strong>${T.mods.author}</strong>${entry.author || ""}</span>
                    <div class="value checkbox ${isDisabled ? "" : "checked"}">
                        <span class="knob"></span>
                    </div>
                </div>
            `;
        });

        return `
            <div class="modsStats">
                内置模组随游戏一起提供，开关后需重启游戏才会生效。
            </div>

            <div class="modsList">
                ${modsHtml}
            </div>
        `;
    }

    onEnter() {
        const steamLink = this.htmlElement.querySelector(".steamLink");
        if (steamLink) {
            this.trackClicks(steamLink, this.onSteamLinkClicked);
        }
        const openModsFolder = this.htmlElement.querySelector(".openModsFolder");
        if (openModsFolder) {
            this.trackClicks(openModsFolder, this.openModsFolder);
        }
        const browseMods = this.htmlElement.querySelector(".browseMods");
        if (browseMods) {
            this.trackClicks(browseMods, this.openBrowseMods);
        }

        const checkboxes = this.htmlElement.querySelectorAll(".checkbox");
        Array.from(checkboxes).forEach(checkbox => {
            if (isCapacitorApp()) {
                this.trackClicks(checkbox, () => this.onBuiltinModToggleClicked(checkbox));
            } else {
                this.trackClicks(checkbox, this.showModTogglingComingSoon);
            }
        });

        const settingsButtons = this.htmlElement.querySelectorAll(".settingsButton");
        Array.from(settingsButtons).forEach(button => {
            this.trackClicks(button, () => this.openBuiltinModSettings(button));
        });
    }

    /**
     * Opens the configuration state of a builtin mod
     * @param {HTMLElement} button
     */
    openBuiltinModSettings(button) {
        const stateId = button.getAttribute("data-state");
        if (!stateId) {
            return;
        }
        this.moveToStateAddGoBack(stateId);
    }

    /**
     * Toggles a builtin mod, the change takes effect after a restart
     * @param {HTMLElement} checkbox
     */
    onBuiltinModToggleClicked(checkbox) {
        const modElement = checkbox.parentElement;
        const id = modElement ? modElement.getAttribute("data-mod-id") : null;
        if (!id) {
            return;
        }

        const willBeEnabled = !checkbox.classList.contains("checked");
        setBuiltinModDisabled(id, !willBeEnabled);
        checkbox.classList.toggle("checked", willBeEnabled);

        this.dialogs.showWarning(T.dialogs.restartRequired.title, T.dialogs.restartRequired.text);
    }

    showModTogglingComingSoon() {
        this.dialogs.showWarning(T.mods.togglingComingSoon.title, T.mods.togglingComingSoon.description);
    }

    openModsFolder() {
        if (!G_IS_STANDALONE) {
            this.dialogs.showWarning(T.global.error, T.mods.folderOnlyStandalone);
            return;
        }
        ipcRenderer.invoke("open-mods-folder");
    }

    openBrowseMods() {
        this.app.platformWrapper.openExternalLink(THIRDPARTY_URLS.modBrowser);
    }

    onSteamLinkClicked() {
        openStandaloneLink(this.app, "shapez_modsettings");
        return false;
    }

    getDefaultPreviousState() {
        return "SettingsState";
    }
}
