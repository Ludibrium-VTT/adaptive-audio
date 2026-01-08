import { MODULE_ID, debug } from "./settings.js";

/**
 * Apply patches to Foundry Core to support Adaptive Audio
 * We want to completely disable Foundry's native playback for Adaptive tracks
 * so that AdaptiveAudioPlayer has full, exclusive control.
 */
export function applyPatches() {
    debug("Applying patches...");

    // Patch PlaylistSound.prototype.sync
    // This is the core method that starts/stops/updates sounds based on DB state.
    // By intercepting this, we stop Foundry from ever touching the audio for our tracks.
    const originalSync = PlaylistSound.prototype.sync;
    PlaylistSound.prototype.sync = function() {
        try {
            // Check if this is an adaptive sound
            // We use safe access (?) because this might be called during deletion/setup
            const isAdaptive = this.parent?.getFlag && this.parent.getFlag(MODULE_ID, "isAdaptive");
            const midPath = this.getFlag && this.getFlag(MODULE_ID, "midIntensityPath");
            const lowPath = this.getFlag && this.getFlag(MODULE_ID, "lowIntensityPath");

            // Only interfere if it's explicitly configured as adaptive (has alternate layers)
            if (isAdaptive && (midPath || lowPath)) {
                
                // If the system tries to play it, we just ignore it.
                // AdaptiveAudioPlayer listens to the same hooks/data and handles it.
                debug(`[PATCH] Blocking native sync for adaptive sound: ${this.name}`);
                
                // We must NOT call originalSync.
                // However, we might need to manually set some internal state to satisfy the UI?
                // The UI (PlaylistDirectory) renders based on document.playing, which IS updated.
                // The UI 'Stop' button calls sound.update({playing: false}), which works.
                // So purely visual state is fine. We just skip the Audio Element management.
                return;
            }
        } catch (err) {
            console.error(`${MODULE_ID} | Error in sync patch:`, err);
        }

        // For normal sounds, proceed as usual
        return originalSync.apply(this, arguments);
    };
}
