import { createLogger } from "../core/logging";

const logger = createLogger("undo");

/**
 * Maximum amount of undo steps kept in the history
 */
const maxUndoSteps = 10;

/**
 * Records user actions (placing / deleting buildings) so they can be reverted.
 * All buildings placed or deleted during a single drag gesture are grouped
 * into one step, so undoing a dragged belt removes the whole belt at once.
 */
export class UndoManager {
    /**
     * @param {import("./root").GameRoot} root
     */
    constructor(root) {
        this.root = root;

        /**
         * List of undo steps, each step is a list of actions
         * @type {Array<Array<{type: string, entity: import("./entity").Entity, uid: number}>>}
         */
        this.steps = [];

        /**
         * Actions recorded while a drag gesture is running
         * @type {Array<{type: string, entity: import("./entity").Entity, uid: number}>?}
         */
        this.currentGroup = null;

        /**
         * Set while an undo is running, so the operations don't get recorded again
         * @type {boolean}
         */
        this.isRestoring = false;
    }

    /**
     * Starts grouping all recorded actions into a single undo step
     */
    beginGroup() {
        this.currentGroup = [];
    }

    /**
     * Ends the current group and stores it as one undo step
     */
    endGroup() {
        const group = this.currentGroup;
        this.currentGroup = null;
        if (!group || group.length === 0) {
            return;
        }
        this.steps.push(group);
        while (this.steps.length > maxUndoSteps) {
            this.steps.shift();
        }
    }

    /**
     * Records that the given entity was placed by the user
     * @param {import("./entity").Entity} entity
     */
    recordPlacement(entity) {
        if (this.isRestoring) {
            return;
        }
        this.recordAction({ type: "place", entity, uid: entity.uid });
    }

    /**
     * Records that the given entity is about to be deleted by the user.
     * Must be called before the entity gets destroyed.
     * @param {import("./entity").Entity} entity
     */
    recordDeletion(entity) {
        if (this.isRestoring) {
            return;
        }
        if (!this.root.logic.canDeleteBuilding(entity)) {
            return;
        }
        this.recordAction({ type: "delete", entity: entity.clone(), uid: entity.uid });
    }

    /**
     * @param {{type: string, entity: import("./entity").Entity, uid: number}} action
     */
    recordAction(action) {
        if (this.currentGroup) {
            this.currentGroup.push(action);
            return;
        }
        this.steps.push([action]);
        while (this.steps.length > maxUndoSteps) {
            this.steps.shift();
        }
    }

    /**
     * Clears the whole undo history
     */
    clear() {
        this.steps = [];
        this.currentGroup = null;
    }

    /**
     * Returns whether there is anything to undo
     * @returns {boolean}
     */
    getCanUndo() {
        return this.steps.length > 0;
    }

    /**
     * Reverts the last action
     * @returns {boolean} true if something was undone
     */
    undo() {
        const group = this.steps.pop();
        if (!group) {
            return false;
        }
        this.currentGroup = null;
        this.isRestoring = true;
        try {
            for (let i = group.length - 1; i >= 0; --i) {
                const action = group[i];
                if (action.type === "place") {
                    this.revertPlacement(action.uid);
                } else if (action.type === "delete") {
                    this.revertDeletion(action.entity, action.uid);
                }
            }
        } finally {
            this.isRestoring = false;
        }
        return true;
    }

    /**
     * Removes a previously placed entity again
     * @param {number} uid Uid of the entity which was placed
     */
    revertPlacement(uid) {
        const entity = this.root.entityMgr.findByUid(uid, false);
        if (!entity) {
            // Already gone
            return;
        }
        this.root.logic.tryDeleteBuilding(entity);
    }

    /**
     * Places a previously deleted entity again
     * @param {import("./entity").Entity} entity
     * @param {number} uid The uid the entity had before it got deleted
     */
    revertDeletion(entity, uid) {
        if (entity.registered || entity.destroyed) {
            return;
        }
        const staticComp = entity.components.StaticMapEntity;
        if (!staticComp) {
            return;
        }

        // Skip if the area got occupied in the meantime
        const rect = staticComp.getTileSpaceBounds();
        for (let x = rect.x; x < rect.x + rect.w; ++x) {
            for (let y = rect.y; y < rect.y + rect.h; ++y) {
                if (this.root.map.getLayerContentXY(x, y, entity.layer)) {
                    return;
                }
            }
        }

        this.root.map.placeStaticEntity(entity);
        this.root.entityMgr.registerEntity(entity, uid);
    }

    /**
     * Removes all buildings the player placed, keeping the hub.
     * This also clears the undo history.
     * @returns {number} Amount of removed buildings
     */
    clearAllBuildings() {
        const entities = this.root.entityMgr.entities.slice();
        let removed = 0;

        this.root.logic.performBulkOperation(() => {
            for (let i = 0; i < entities.length; ++i) {
                const entity = entities[i];
                const staticComp = entity.components.StaticMapEntity;
                if (!staticComp) {
                    continue;
                }
                if (staticComp.getMetaBuilding().getId() === "hub") {
                    // The hub can not be removed
                    continue;
                }
                if (!this.root.logic.canDeleteBuilding(entity)) {
                    continue;
                }
                this.root.map.removeStaticEntity(entity);
                this.root.entityMgr.destroyEntity(entity);
                ++removed;
            }
            this.root.entityMgr.processDestroyList();
        });

        this.clear();
        logger.log("Removed", removed, "buildings");
        return removed;
    }
}
