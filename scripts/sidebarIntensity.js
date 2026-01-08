import { MODULE_ID, debug } from "./settings.js";

/**
 * Inject global intensity slider into the Playlists sidebar
 */
export function injectIntensitySlider(app, html, data) {
    // Only GM can control intensity
    if (!game.user.isGM) return;

    // Ensure html is a jQuery object
    html = $(html);
    
    // Check if already injected
    if (html.find('.adaptive-audio-intensity').length) return;

    const currentIntensity = game.settings.get(MODULE_ID, "currentIntensity");
    
    // Get current custom mix state from player if available
    // Get current custom mix state from Settings (Source of Truth for UI Init)
    const customMixEnabled = game.settings.get(MODULE_ID, "customMixEnabled");
    const customHigh = Math.round((game.settings.get(MODULE_ID, "customHighVolume") ?? 1.0) * 100);
    const customMid = Math.round((game.settings.get(MODULE_ID, "customMidVolume") ?? 1.0) * 100);
    const customLow = Math.round((game.settings.get(MODULE_ID, "customLowVolume") ?? 1.0) * 100);
    
    const player = game.adaptiveAudio?.player;

    // Create intensity slider HTML
    const intensityHTML = `
        <div class="adaptive-audio-intensity">
            <h3>Adaptive Audio Intensity</h3>
            
            <div class="intensity-control main-intensity">
                <label class="intensity-labels">
                    <span>Low</span>
                    <span>High</span>
                </label>
                <input type="range" name="intensity" min="0" max="100" step="1" value="${currentIntensity}" />
                <div class="intensity-value-display">
                    <span class="intensity-value">${currentIntensity}%</span>
                </div>
            </div>

            <div class="custom-mix-toggle">
                <label>
                    <input type="checkbox" name="customMix" ${customMixEnabled ? 'checked' : ''} /> Custom Mix
                </label>
            </div>

            <div class="custom-mix-controls" style="${customMixEnabled ? '' : 'display: none;'}">
                <div class="custom-track-control">
                    <label>High (Base)</label>
                    <input type="range" name="customHigh" min="0" max="100" step="1" value="${customHigh}" />
                </div>
                <div class="custom-track-control">
                    <label>Mid</label>
                    <input type="range" name="customMid" min="0" max="100" step="1" value="${customMid}" />
                </div>
                <div class="custom-track-control">
                    <label>Low</label>
                    <input type="range" name="customLow" min="0" max="100" step="1" value="${customLow}" />
                </div>
            </div>

            <p class="notes">Controls the mix between low, mid, and high intensity tracks. Note: Custom Mix overrides automatic Combat Intensity changes.</p>
            
            <div class="adaptive-audio-actions" style="margin-top: 5px; text-align: center;">
                <button type="button" class="preload-all-btn">
                    <i class="fas fa-download"></i> Preload All
                </button>
            </div>
        </div>
    `;

    // Find the global volume controls or directory footer
    let insertPoint = html.find('.directory-footer');
    if (!insertPoint.length) {
        insertPoint = html.find('footer');
    }
    if (!insertPoint.length) {
        // Fallback: append to directory list
        insertPoint = html.find('.directory-list');
    }

    if (insertPoint.length) {
        insertPoint.before(intensityHTML);
    }

    // Helper to calculate volumes from intensity
    const calculateVolumes = (intensity) => {
        // Use shared logic from player if available (DRY)
        if (game.adaptiveAudio?.player?.calculateMix) {
            return game.adaptiveAudio.player.calculateMix(intensity);
        }

        // Fallback (Simple linear crossfade in case player not ready)
        let low = 0, mid = 0, high = 0;
        if (intensity <= 0.5) {
            const progress = intensity / 0.5;
            low = 1 - progress;
            mid = progress;
        } else {
            const progress = (intensity - 0.5) / 0.5;
            mid = 1 - progress;
            high = progress;
        }
        return { low, mid, high };
    };

    // Helper to update custom sliders UI globally
    const updateCustomSliders = (volumes) => {
        $('.adaptive-audio-intensity').each(function() {
            const container = $(this);
            container.find('input[name="customHigh"]').val(Math.round(volumes.high * 100));
            container.find('input[name="customMid"]').val(Math.round(volumes.mid * 100));
            container.find('input[name="customLow"]').val(Math.round(volumes.low * 100));
        });
    };

    // Bind intensity slider event
    html.find('.adaptive-audio-intensity input[name="intensity"]').on('input', function(event) {
        const value = parseInt(event.target.value);
        const intensity = value / 100;
        
        // Update ALL instances locally to ensure instant sync
        $('.adaptive-audio-intensity').each(function() {
            const container = $(this);
            const slider = container.find('input[name="intensity"]');
            const display = container.find('.intensity-value');
            
            // Sync slider value if not the one being dragged
            if (slider[0] !== event.target) {
                slider.val(value);
            }
            
            // Update display text
            display.text(`${value}%`);
        });
        
        // Update player
        if (game.adaptiveAudio?.player) {
            game.adaptiveAudio.player.setGlobalIntensity(intensity);
            
            // If custom mix is enabled, default behavior is to let global slider drive custom sliders
            // (Unless user manually adjusted custom sliders, but here we are dragging global)
            // Logic remains: Global Slider -> Drives Custom Sliders
            if (game.adaptiveAudio.player.customMixEnabled) {
                const volumes = calculateVolumes(intensity);
                
                updateCustomSliders(volumes);
                
                // Update player custom volumes
                game.adaptiveAudio.player.setCustomVolume('high', volumes.high);
                game.adaptiveAudio.player.setCustomVolume('mid', volumes.mid);
                game.adaptiveAudio.player.setCustomVolume('low', volumes.low);
            }
        }
        
        // Save to settings
        game.settings.set(MODULE_ID, "currentIntensity", value);
    });

    // Bind Custom Mix toggle
    html.find('.adaptive-audio-intensity input[name="customMix"]').on('change', function(event) {
        const enabled = event.target.checked;
        debug(`Custom Mix toggled: ${enabled}`);
        
        // Update ALL instances locally to ensure instant sync without waiting for Hook
        $('.adaptive-audio-intensity').each(function() {
            const container = $(this);
            const checkbox = container.find('input[name="customMix"]');
            
            // Sync checkbox state if not the one clicked
            if (checkbox[0] !== event.target) {
                checkbox.prop('checked', enabled);
            }
            
            const controls = container.find('.custom-mix-controls');
            if (enabled) {
                 controls.stop(true, false).slideDown();
            } else {
                 controls.stop(true, false).slideUp();
            }
        });
        
        if (enabled) {
            // Initialize volume values based on current intensity
            // We use the first found intensity slider as source of truth (they should be synced)
            const globalVal = parseInt($('.adaptive-audio-intensity input[name="intensity"]').val() || "0");
            const currentGlobal = globalVal / 100;
            const volumes = calculateVolumes(currentGlobal);
            
            updateCustomSliders(volumes);
            
            // Also update player state
            if (game.adaptiveAudio?.player) {
                game.adaptiveAudio.player.setCustomVolume('high', volumes.high);
                game.adaptiveAudio.player.setCustomVolume('mid', volumes.mid);
                game.adaptiveAudio.player.setCustomVolume('low', volumes.low);
            }
        }
        
        if (game.adaptiveAudio?.player) {
            game.adaptiveAudio.player.setCustomMixEnabled(enabled);
        }
    });

    // Bind Custom Mix sliders
    const bindCustomSlider = (name, type) => {
        html.find(`.adaptive-audio-intensity input[name="${name}"]`).on('input', function(event) {
            const value = parseInt(event.target.value) / 100;
            if (game.adaptiveAudio?.player) {
                game.adaptiveAudio.player.setCustomVolume(type, value);
            }
        });
    };

    bindCustomSlider('customHigh', 'high');
    bindCustomSlider('customMid', 'mid');
    bindCustomSlider('customLow', 'low');
    bindCustomSlider('customLow', 'low');

    // Bind Preload All button
    html.find('.adaptive-audio-intensity .preload-all-btn').on('click', (event) => {
        event.preventDefault();
        if (game.adaptiveAudio?.player) {
            game.adaptiveAudio.player.preloadAll();
        }
    });
}

/**
 * Apply custom styling to adaptive tracks in the playlist directory
 */
export function styleAdaptiveTracks(app, html, data) {
    if (!game.playlists) return;

    html = $(html);

    html.find(".sound").each((i, el) => {
        const li = $(el);
        const playlistId = li.data("playlist-id");
        const soundId = li.data("sound-id");
        
        const playlist = game.playlists.get(playlistId);
        if (!playlist) return;
        
        const sound = playlist.sounds.get(soundId);
        if (!sound) return;
        
        // Check if this is an adaptive sound
        // It must have at least one alternative track configured and main track must be present
        const midPath = sound.getFlag(MODULE_ID, "midIntensityPath");
        const lowPath = sound.getFlag(MODULE_ID, "lowIntensityPath");
        
        // Only consider it adaptive if it has flags OR the playlist is marked adaptive
        // But specifically we want to highlight tracks that actually HAVE adaptive qualities
        if (midPath || lowPath) {
            // Found an adaptive track
            const header = li.find("header");
            const icon = header.find("i.fa-music"); // Default icon
            
            if (icon.length) {
                // Change icon to Broadcast Tower or similar to indicate "Adaptive/Multi-channel"
                icon.removeClass("fa-music").addClass("fa-tower-broadcast");
                icon.addClass("adaptive-track-icon");
                
                // Add tooltip
                icon.attr("title", game.i18n.localize(`${MODULE_ID}.ui.adaptiveTrack`) || "Adaptive Audio Track");
                
                // Optional: add a subtle indicator class to the row
                li.addClass("adaptive-audio-track");
            }
        }
    });
}
// Sync UI when setting changes externally
// Sync UI when setting changes externally
Hooks.on("updateSetting", (setting, changes, options, userId) => {
    // Ignore local changes to prevent UI fighting (we handle local updates instantly in handlers)
    if (userId === game.user.id) return;

    // 1. Custom Mix Sync
    if (setting.key === `${MODULE_ID}.customMixEnabled`) {
        if (changes.value === undefined) return;
        const enabled = changes.value;
        
        $('.adaptive-audio-intensity').each(function() {
            const container = $(this);
            const checkbox = container.find('input[name="customMix"]');
            const controls = container.find('.custom-mix-controls');
            
            // Sync Checkbox
            if (checkbox.prop('checked') !== enabled) {
                checkbox.prop('checked', enabled);
            }
            
            // Sync Visibility
            // Only intervene if state doesn't match target
            if (enabled) {
                // Populate values from player state (if available) before showing
                if (game.adaptiveAudio?.player) {
                    const p = game.adaptiveAudio.player;
                    container.find('input[name="customHigh"]').val(Math.round((p.customHighVolume ?? 1) * 100));
                    container.find('input[name="customMid"]').val(Math.round((p.customMidVolume ?? 1) * 100));
                    container.find('input[name="customLow"]').val(Math.round((p.customLowVolume ?? 1) * 100));
                }

                if (controls.is(':hidden')) {
                    debug("Hook: Syncing Custom Mix SlideDown");
                    controls.stop(true, false).slideDown();
                }
            } else {
                if (!controls.is(':hidden')) {
                    debug("Hook: Syncing Custom Mix SlideUp");
                    controls.stop(true, false).slideUp();
                }
            }
        });
    }

    // 2. Global Intensity Sync
    if (setting.key === `${MODULE_ID}.currentIntensity`) {
        if (changes.value === undefined) return;
        const intensity = changes.value; // 0-100 expected
        
        $('.adaptive-audio-intensity').each(function() {
            const container = $(this);
            const input = container.find('input[name="intensity"]');
            const label = container.find('.intensity-value');
            
            if (parseInt(input.val()) !== intensity) {
                input.val(intensity);
                label.text(`${intensity}%`);
            }
        });
    }

    // 3. Custom Volume Sync (High/Mid/Low)
    const customVolMatch = setting.key.match(new RegExp(`${MODULE_ID}\\.custom(High|Mid|Low)Volume`));
    if (customVolMatch) {
        if (changes.value === undefined) return;
        const type = customVolMatch[1]; // "High", "Mid", "Low"
        // Convert to input name: customHigh, customMid, customLow
        const inputName = `custom${type}`;
        const val = Math.round(changes.value * 100);

        $('.adaptive-audio-intensity').each(function() {
             const input = $(this).find(`input[name="${inputName}"]`);
             if (parseInt(input.val()) !== val) {
                 input.val(val);
             }
        });
    }
});
