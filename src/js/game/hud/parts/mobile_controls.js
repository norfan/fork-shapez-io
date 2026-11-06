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
            { label: "Q", binding: KEYMAPPINGS.placement.pipette },
            { label: "⌖", binding: KEYMAPPINGS.navigation.centerMap },
            { label: "+", binding: KEYMAPPINGS.navigation.mapZoomIn },
            { label: "−", binding: KEYMAPPINGS.navigation.mapZoomOut },
            { label: "☰", binding: KEYMAPPINGS.general.back },
        ];

        for (let i = 0; i < buttons.length; ++i) {
            const button = makeDiv(this.element, null, ["button"], buttons[i].label);
            this.trackClicks(button, () => {
                this.root.keyMapper.getBinding(buttons[i].binding).signal.dispatch();
            });
        }
    }

    initialize() {}
}
