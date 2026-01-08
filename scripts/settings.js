export const MODULE_ID = "adaptive-audio";

export function registerSettings() {


    game.settings.register(MODULE_ID, "combatIntensity", {
        name: game.i18n.localize(`${MODULE_ID}.settings.combatIntensity.name`),
        hint: game.i18n.localize(`${MODULE_ID}.settings.combatIntensity.hint`),
        scope: "world",
        config: true,
        type: Number,
        range: {
            min: 0,
            max: 100,
            step: 1
        },
        default: 100
    });

    game.settings.register(MODULE_ID, "autoSetCombatIntensity", {
        name: game.i18n.localize(`${MODULE_ID}.settings.autoSetCombatIntensity.name`),
        hint: game.i18n.localize(`${MODULE_ID}.settings.autoSetCombatIntensity.hint`),
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID, "masterVolume", {
        name: game.i18n.localize(`${MODULE_ID}.settings.masterVolume.name`),
        hint: game.i18n.localize(`${MODULE_ID}.settings.masterVolume.hint`),
        scope: "client",
        config: true,
        type: Number,
        range: {
            min: 0,
            max: 100,
            step: 1
        },
        default: 80,
        onChange: (value) => {
            if (game.adaptiveAudio?.player) {
                game.adaptiveAudio.player.setMasterVolume(value / 100);
            }
        }
    });

    game.settings.register(MODULE_ID, "debugLogging", {
        name: "Debug Logging",
        hint: "Enable detailed logging for debugging purposes.",
        scope: "client",
        config: true,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID, "autoDetectOvani", {
        name: "Auto-Detect Ovani Layers",
        hint: "When selecting a 'Main.wav' file from Ovani, automatically set the Mid and Low intensity tracks.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });

    // Internal settings for persistence
    game.settings.register(MODULE_ID, "lowTrackPath", {
        scope: "client",
        config: false,
        type: String,
        default: ""
    });

    game.settings.register(MODULE_ID, "highTrackPath", {
        scope: "client",
        config: false,
        type: String,
        default: ""
    });

    game.settings.register(MODULE_ID, "currentIntensity", {
        scope: "world",
        config: false,
        type: Number,
        default: 50,
        onChange: (value) => {
            // value is 0-100
            if (game.adaptiveAudio?.player) {
                game.adaptiveAudio.player.setGlobalIntensity(value / 100, true);
            }
        }
    });

    // Custom Mix Settings
    game.settings.register(MODULE_ID, "customMixEnabled", {
        scope: "world",
        config: false,
        type: Boolean,
        default: false,
        onChange: (value) => {
            if (game.adaptiveAudio?.player) {
                game.adaptiveAudio.player.setCustomMixEnabled(value, true);
            }
        }
    });

    game.settings.register(MODULE_ID, "customHighVolume", {
        scope: "world",
        config: false,
        type: Number,
        default: 1.0,
        onChange: (value) => {
            if (game.adaptiveAudio?.player) {
                game.adaptiveAudio.player.setCustomVolume('high', value, true);
            }
        }
    });

    game.settings.register(MODULE_ID, "customMidVolume", {
        scope: "world",
        config: false,
        type: Number,
        default: 1.0,
        onChange: (value) => {
            if (game.adaptiveAudio?.player) {
                game.adaptiveAudio.player.setCustomVolume('mid', value, true);
            }
        }
    });

    game.settings.register(MODULE_ID, "customLowVolume", {
        scope: "world",
        config: false,
        type: Number,
        default: 1.0,
        onChange: (value) => {
            if (game.adaptiveAudio?.player) {
                game.adaptiveAudio.player.setCustomVolume('low', value, true);
            }
        }
    });
}

/**
 * Log debug messages if enabled
 * @param {...any} args
 */
export function debug(...args) {
    if (game.settings.get(MODULE_ID, "debugLogging")) {
        console.log(`${MODULE_ID} |`, ...args);
    }
}

/* -------------------------------------------- */
/*  Settings Footer                             */
/* -------------------------------------------- */

Hooks.on("renderSettingsConfig", (app, html, data) => {
    // 1. Define Footer Content
    const footerContent = `
    <div class="form-group settings-footer" style="flex: 100%; text-align: center; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--color-border-light-2);">
        <p style="margin-bottom: 5px;">Developed by <a href="https://github.com/Ludibrium-VTT" target="_blank">Ludibrium VTT</a></p>
        <p style="margin: 0;">
            <a href="https://discord.gg/2Naz5966Up" target="_blank" style="margin-right: 10px;"><i class="fab fa-discord"></i> Discord</a>
            <a href="https://www.patreon.com/cw/LudibriumVTT" target="_blank"><i class="fab fa-patreon"></i> Patreon</a>
        </p>
    </div>
    `;

    // 2. Helper to handle jQuery vs HTMLElement
    const el = (html instanceof jQuery) ? html[0] : html;

    // 3. Find the Anchor
    // We append after the last visible setting of this module.
    // We search for inputs/selects that start with our module ID.
    const inputs = el.querySelectorAll(`[name^="${MODULE_ID}."]`);
    const lastInput = inputs[inputs.length - 1];

    if (lastInput) {
        const formGroup = lastInput.closest(".form-group");
        if (formGroup) {
            // Create wrapper
            const div = document.createElement("div");
            div.innerHTML = footerContent;
            formGroup.after(div.firstElementChild);
        }
    }
});
