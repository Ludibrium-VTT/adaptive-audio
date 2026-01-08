import { MODULE_ID, debug } from "./settings.js";

/**
 * Inject adaptive audio checkbox into Playlist configuration
 */
export function injectPlaylistConfig(app, html, data) {
    html = $(html);
    const playlist = app.document;
    const isAdaptive = playlist.getFlag(MODULE_ID, "isAdaptive") || false;

    // Create checkbox HTML
    const adaptiveCheckbox = `
        <div class="form-group">
            <label>Adaptive Audio Playlist</label>
            <input type="checkbox" name="flags.${MODULE_ID}.isAdaptive" ${isAdaptive ? 'checked' : ''} />
            <p class="notes">When enabled, sounds in this playlist can have multi-layered intensity tracks (Low, Mid, High) that crossfade based on a global intensity slider.</p>
        </div>
    `;

    // Find a good injection point - after the mode selection
    const modeGroup = html.find('select[name="mode"]').closest('.form-group');
    if (modeGroup.length) {
        modeGroup.after(adaptiveCheckbox);
    } else {
        // Fallback: add to the end of the form
        html.find('form').append(adaptiveCheckbox);
    }
}

/**
 * Inject dual file pickers into PlaylistSound configuration
 */
export function injectSoundConfig(app, html, data) {
    html = $(html);
    const sound = app.document;
    const playlist = sound.parent;
    
    debug("injectSoundConfig called for sound:", sound.name);
    
    // Only inject if parent playlist is adaptive
    const isAdaptive = playlist?.getFlag(MODULE_ID, "isAdaptive");
    if (!isAdaptive) return;

    debug("Injecting adaptive audio fields");

    const midPath = sound.getFlag(MODULE_ID, "midIntensityPath") || "";
    const lowPath = sound.getFlag(MODULE_ID, "lowIntensityPath") || "";

    // Relabel the existing Audio Source field to "High Intensity Track"
    const pathLabel = html.find('file-picker[name="path"]').closest('.form-group').find('label');
    if (pathLabel.length) {
        pathLabel.text('High Intensity Track');
    }

    // Create Mid and Low intensity fields
    const newFields = `
        <div class="form-group adaptive-mid-intensity">
            <label for="adaptive-mid-intensity-path">Mid Intensity Track</label>
            <div class="form-fields">
                <input type="text" id="adaptive-mid-intensity-path" name="flags.${MODULE_ID}.midIntensityPath" value="${midPath}" placeholder="path/to/mid.ogg" />
                <button type="button" class="file-picker" data-type="audio" data-target="flags.${MODULE_ID}.midIntensityPath">
                    <i class="fas fa-file-import"></i>
                </button>
            </div>
        </div>
        
        <div class="form-group adaptive-low-intensity">
            <label for="adaptive-low-intensity-path">Low Intensity Track</label>
            <div class="form-fields">
                <input type="text" id="adaptive-low-intensity-path" name="flags.${MODULE_ID}.lowIntensityPath" value="${lowPath}" placeholder="path/to/low.ogg" />
                <button type="button" class="file-picker" data-type="audio" data-target="flags.${MODULE_ID}.lowIntensityPath">
                    <i class="fas fa-file-import"></i>
                </button>
            </div>
            <p class="hint">Adaptive Mixing: Low (0-50%) → Mid (50-100%) → High (Base Track).</p>
        </div>
    `;

    // Inject after the path field
    const pathGroup = html.find('file-picker[name="path"]').closest('.form-group');
    if (pathGroup.length) {
        pathGroup.after(newFields);
    }

    // Bind file picker buttons
    html.find('.adaptive-mid-intensity .file-picker, .adaptive-low-intensity .file-picker').on('click', function(event) {
        event.preventDefault();
        const button = $(this);
        const target = button.data('target');
        const input = html.find(`input[name="${target}"]`);
        
        new FilePicker({
            type: "audio",
            current: input.val(),
            callback: (path) => {
                input.val(path);
            }
        }).render(true);
    });

    // Ovani Auto-Detection Logic
    const mainPathInput = html.find('file-picker[name="path"] input[type="text"]'); 
    
    debug("Binding Ovani listener to:", mainPathInput);

    // Helper to check and update
    const checkOvani = (path) => {
        debug("Checking path for Ovani pattern:", path);
        if (!game.settings.get(MODULE_ID, "autoDetectOvani")) return;
        if (!path) return;
        
        // Check for Ovani + Main.wav pattern
        // Regex: matches "Ovani" anywhere and ends with "Main.wav" (case insensitive)
        // We decodeURIComponent just in case
        try {
            path = decodeURIComponent(path);
        } catch (e) {}

        if (path.match(/Ovani/i) && path.match(/Main\.wav$/i)) {
            debug("Pattern matched!");
            const midInput = html.find('input[name="flags.adaptive-audio.midIntensityPath"]');
            const lowInput = html.find('input[name="flags.adaptive-audio.lowIntensityPath"]');
            
            // Only update if currently empty to avoid overwriting user choices
            // Only update if currently empty to avoid overwriting user choices
            if (midInput.val() === "" && lowInput.val() === "") {
                // Generate new paths (with spaces initially)
                let newMidPath = path.replace(/Main\.wav$/i, "Intensity 2.wav");
                let newLowPath = path.replace(/Main\.wav$/i, "Intensity 1.wav");
                
                // Encode them to match Foundry's URL preference (spaces -> %20, etc.)
                try {
                    newMidPath = encodeURI(newMidPath);
                    newLowPath = encodeURI(newLowPath);
                } catch (e) {
                    console.error(`${MODULE_ID} | Error encoding paths:`, e);
                }
                
                midInput.val(newMidPath);
                lowInput.val(newLowPath);
                
                // Trigger change on them so they save
                midInput.trigger('change');
                lowInput.trigger('change');
                
                ui.notifications.info("Adaptive Audio: Auto-detected Ovani layers");
                debug("Auto-detected Ovani layers:", newMidPath, newLowPath);
            } else {
                debug("Fields not empty, skipping auto-fill.");
            }
        }
    };

    // Listen for manual input changes
    mainPathInput.on('change input', (event) => checkOvani(event.target.value));
    
    // Listen for FilePicker updates by observing the file-picker element
    // We add a small delay to ensure the input value has been propagated by the FilePicker app
    html.find('file-picker[name="path"]').on('change', (event) => {
        const picker = $(event.currentTarget);
        setTimeout(() => {
            const input = picker.find('input');
            const val = input.val();
            debug("Delayed check for path:", val);
            checkOvani(val);
        }, 100);
    });
    
    // Also listen to the specific button click for the main path
    html.find('file-picker[name="path"] button').on('click', () => {
       debug("FilePicker opened for main path");
    });
}
