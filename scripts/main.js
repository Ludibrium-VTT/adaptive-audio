import { MODULE_ID, registerSettings } from "./settings.js";
import { AdaptiveAudioPlayer } from "./AdaptiveAudioPlayer.js";
import { AdaptiveAudioUI } from "./AdaptiveAudioUI.js";
import { injectPlaylistConfig, injectSoundConfig } from "./configInjection.js";
import { injectIntensitySlider, styleAdaptiveTracks } from "./sidebarIntensity.js";
import { applyPatches } from "./patching.js";

// Global player instance
let adaptiveAudioPlayer = null;
let adaptiveAudioUI = null;

Hooks.once("init", () => {
    console.log(`${MODULE_ID} | Initializing Adaptive Audio module`);
    registerSettings();
    applyPatches();

    // REGISTER CONTEXT MENU HOOKS (Try both for broad compatibility)
    const contextMenuCallback = (app, options) => {
        options.push({
            name: "Preload Adaptive Audio",
            icon: '<i class="fas fa-download"></i>',
            condition: (li) => {
                try {
                    const element = $(li);
                    // V13 uses data-entry-id, older versions used data-document-id
                    const parent = element.closest("[data-entry-id], [data-document-id]");
                    const id = parent.data("entryId") || parent.data("documentId");
                    
                    const playlist = game.playlists.get(id);
                    return playlist && playlist.getFlag(MODULE_ID, "isAdaptive");
                } catch (e) {
                    console.error(`${MODULE_ID} | Error in context menu condition:`, e);
                    return false;
                }
            },
            callback: (li) => {
                const element = $(li);
                const parent = element.closest("[data-entry-id], [data-document-id]");
                const id = parent.data("entryId") || parent.data("documentId");
                const playlist = game.playlists.get(id);
                if (game.adaptiveAudio?.player && playlist) {
                    game.adaptiveAudio.player.preloadPlaylist(playlist.id);
                }
            }
        });
    };

    // V13+
    Hooks.on("getPlaylistContextOptions", contextMenuCallback);
    // V10-V12 fallback
    Hooks.on("getPlaylistDirectoryEntryContext", contextMenuCallback);
});

Hooks.once("ready", () => {
    console.log(`${MODULE_ID} | Module ready`);
    
    // Create player instance
    adaptiveAudioPlayer = new AdaptiveAudioPlayer();
    
    // Create UI instance
    adaptiveAudioUI = new AdaptiveAudioUI(adaptiveAudioPlayer);
    
    // Make globally accessible
    game.adaptiveAudio = {
        player: adaptiveAudioPlayer,
        ui: adaptiveAudioUI
    };

    // Note: Combat hooks are handled internally by AdaptiveAudioPlayer
});

// Inject adaptive audio configuration into playlist and sound configs
Hooks.on("renderPlaylistConfig", (app, html, data) => {
    injectPlaylistConfig(app, html, data);
});

Hooks.on("renderPlaylistSoundConfig", (app, html, data) => {
    // Delay injection to ensure we run after other modules (like dynamic-soundscapes)
    // allowing us to insert immediately after the target field and push others down
    setTimeout(() => {
        injectSoundConfig(app, html, data);
    }, 0);
});

// Inject intensity slider into Playlists sidebar
Hooks.on("renderPlaylistDirectory", (app, html, data) => {
    injectIntensitySlider(app, html, data);
    styleAdaptiveTracks(app, html, data);
});

// Context menu moved to init


// Add button to scene controls using the proper hook
Hooks.on("getSceneControlButtons", (controls) => {
    // In Foundry v13, controls and tools are objects, not arrays
    if (controls.sounds && controls.sounds.tools) {
        controls.sounds.tools["adaptive-audio"] = {
            name: "adaptive-audio",
            title: game.i18n.localize(`${MODULE_ID}.title`),
            icon: "fas fa-music",
            button: true,
            onClick: () => {
                game.adaptiveAudio?.ui?.render(true);
            }
        };
    }
});

console.log(`${MODULE_ID} | Module loaded`);
