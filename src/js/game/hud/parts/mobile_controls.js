/* typehints:start */
import { GameRoot } from "../root";
/* typehints:end */

import { IS_DEBUG, IS_MOBILE } from "../../../core/config";
import { makeDiv } from "../../../core/utils";
import { BaseHUDPart } from "../base_hud_part";
import { KEYMAPPINGS } from "../../key_action_mapper";

/**
 * Returns whether the on screen touch controls should be shown.
 * They are also shown in the local debug build to make them testable on desktop.
 * @returns {boolean}
 */
export function shouldShowMobileControls() {
    return IS_MOBILE || IS_DEBUG;
}

/**
 * On screen buttons which replace the essential keyboard shortcuts on mobile devices
 */
export class HUDMobileControls extends BaseHUDPart {
    createElements(parent) {
        this.element = makeDiv(parent, "ingame_HUD_MobileControls");

        const buttons = [
            { label: "⟳", binding: KEYMAPPINGS.placement.rotateWhilePlacing },
            { label: "DEL", deletionToggle: true },
            { label: "撤", undo: true },
            { label: "清", clearAll: true },
            { label: "Q", binding: KEYMAPPINGS.placement.pipette },
            { label: "⌖", binding: KEYMAPPINGS.navigation.centerMap },
            { label: "+", binding: KEYMAPPINGS.navigation.mapZoomIn },
            { label: "−", binding: KEYMAPPINGS.navigation.mapZoomOut },
            { label: "☰", binding: KEYMAPPINGS.general.back },
        ];

        for (let i = 0; i < buttons.length; ++i) {
            const button = makeDiv(this.element, null, ["button"], buttons[i].label);
            if (buttons[i].deletionToggle) {
                button.style.fontSize = "13px";
                const updateState = () => {
                    const active = this.root.camera.touchDeletionMode;
                    button.style.background = active ? "rgba(196, 62, 74, 0.92)" : "";
                    button.style.boxShadow = active ? "0 0 0 2px rgba(255, 255, 255, 0.65)" : "";
                };
                this.deletionStateUpdater = updateState;
                this.trackClicks(button, () => {
                    const active = !this.root.camera.touchDeletionMode;
                    this.root.camera.touchDeletionMode = active;
                    if (active) {
                        // Deletion only works while no building is selected
                        this.root.hud.parts.buildingPlacer.currentMetaBuilding.set(null);
                    }
                    updateState();
                });
                updateState();
            } else if (buttons[i].undo) {
                this.trackClicks(button, () => {
                    this.root.undoMgr.undo();
                });
            } else if (buttons[i].clearAll) {
                button.style.fontSize = "13px";
                this.clearButton = button;
                this.trackClicks(button, () => {
                    if (this.clearConfirmPending) {
                        this.resetClearConfirm();
                        this.root.undoMgr.clearAllBuildings();
                        return;
                    }
                    this.clearConfirmPending = true;
                    button.innerHTML = "确认?";
                    button.style.background = "rgba(196, 62, 74, 0.92)";
                    button.style.boxShadow = "0 0 0 2px rgba(255, 255, 255, 0.65)";
                    this.clearConfirmTimeout = setTimeout(() => this.resetClearConfirm(), 4000);
                });
            } else {
                this.trackClicks(button, () => {
                    this.root.keyMapper.getBinding(buttons[i].binding).signal.dispatch();
                });
            }
        }
    }

    /**
     * Resets the "clear all" button back to its normal state
     */
    resetClearConfirm() {
        this.clearConfirmPending = false;
        if (this.clearConfirmTimeout) {
            clearTimeout(this.clearConfirmTimeout);
            this.clearConfirmTimeout = null;
        }
        if (this.clearButton) {
            this.clearButton.innerHTML = "清";
            this.clearButton.style.background = "";
            this.clearButton.style.boxShadow = "";
        }
    }

    cleanup() {
        super.cleanup();
        this.resetClearConfirm();
    }

    initialize() {
        // Leave deletion mode as soon as the player picks a building
        this.root.hud.signals.selectedPlacementBuildingChanged.add(metaBuilding => {
            if (metaBuilding && this.root.camera.touchDeletionMode) {
                this.root.camera.touchDeletionMode = false;
                if (this.deletionStateUpdater) {
                    this.deletionStateUpdater();
                }
            }
        });
    }
}
