import { MODULE_ID, debug } from "./settings.js";

/**
 * Manages synchronized playback of adaptive audio playlists
 * Each sound in an adaptive playlist can have dual intensity tracks
 */
export class AdaptiveAudioPlayer {
    constructor() {
        // Map of soundId -> {lowSound, highSound, sound}
        this.playingSounds = new Map();
        
        // Preloaded audio cache: path -> true (marks as cached)
        this.preloadedAudio = new Map();
        
        // Track sounds currently being loaded to prevent race conditions
        this.loadingSounds = new Set();
        
        // Global intensity (0.0 to 1.0)
        this.intensity = game.settings.get(MODULE_ID, "currentIntensity") / 100;
        this.masterVolume = game.settings.get(MODULE_ID, "masterVolume") / 100;

        // Custom Mix state
        this.customMixEnabled = game.settings.get(MODULE_ID, "customMixEnabled");
        this.customHighVolume = game.settings.get(MODULE_ID, "customHighVolume");
        this.customMidVolume = game.settings.get(MODULE_ID, "customMidVolume");
        this.customLowVolume = game.settings.get(MODULE_ID, "customLowVolume");
        
        // Combat integration
        this.preCombatIntensity = null; // Store intensity before combat
        this.userOverrideDuringCombat = false; // Track if user manually changed slider during combat
        this.fadeInterval = null; // For smooth fading
        
        // Drift monitoring
        this.driftMonitorInterval = null;
        
        // Track paths for quick test mode (legacy)
        this.lowTrackPath = game.settings.get(MODULE_ID, "lowTrackPath");
        this.highTrackPath = game.settings.get(MODULE_ID, "highTrackPath");
        this.isPlaying = false;
        this.isPaused = false;
        
        // Set up playlist monitoring hooks
        this._setupHooks();
        
        // Preload all adaptive sounds on ready
        if (game.ready) {
            this._restorePlayback();
        } else {
            Hooks.once("ready", () => {
                this._restorePlayback();
            });
        }
    }

    /**
     * Restore playback for sounds that should be playing (e.g. after refresh)
     * @private
     */
    async _restorePlayback() {
debug("Restoring playback...");
        
        for (const playlist of game.playlists) {
            const isAdaptive = playlist.getFlag(MODULE_ID, "isAdaptive");
            if (!isAdaptive) continue;
            
            for (const sound of playlist.sounds) {
                // If the sound is supposed to be playing but isn't tracked by us
                if (sound.playing && !this.playingSounds.has(sound.id)) {
                    debug(`Resuming playback for: ${sound.name}`);
                    await this._playAdaptiveSound(sound);
                }
            }
        }
    }

    /**
     * Set up hooks to monitor playlist and sound changes
     * @private
     */
    _setupHooks() {
        debug("Setting up hooks...");

        // CRITICAL: Intercept BEFORE Foundry plays the sound
        // This prevents the initial skip and resync
        Hooks.on("preUpdatePlaylistSound", (sound, changes, options, userId) => {
            debug("*** preUpdatePlaylistSound FIRED ***", sound.name, changes);
            
            // Don't block our own internal updates
            if (options?.adaptiveAudioInternal) {
                debug("Allowing internal update for:", sound.name);
                return;
            }
            
            const playlist = sound.parent;
            const isAdaptive = playlist?.getFlag(MODULE_ID, "isAdaptive");
            
            if (!isAdaptive) return;
            
            const midPath = sound.getFlag(MODULE_ID, "midIntensityPath");
            const lowPath = sound.getFlag(MODULE_ID, "lowIntensityPath");
            
            // Not a configured adaptive sound if it doesn't have at least one alternative track
            if (!midPath && !lowPath) return;
            
            // If this is an adaptive sound trying to play
            if (changes.playing === true) {
                debug("Blocking Foundry playback for adaptive sound:", sound.name);
                
                // Prevent Foundry from playing by NOT updating the playing flag
                // We'll handle playback ourselves in updatePlaylist
                delete changes.playing;
                
                // Mark that we need to play this sound
                options.adaptiveAudioPlay = true;
            }
            // If this is an adaptive sound trying to stop
            else if (changes.playing === false) {
                debug("Blocking Foundry stop for adaptive sound:", sound.name);
                
                // Prevent Foundry from trying to stop (it's not playing it anyway)
                delete changes.playing;
                
                // Mark that we need to stop this sound
                options.adaptiveAudioStop = true;
            }
        });

        debug("Registered preUpdatePlaylistSound hook");

        // CRITICAL: Block playlist from playing adaptive sounds BEFORE they start
        Hooks.on("preUpdatePlaylist", (playlist, changes, options, userId) => {
            const isAdaptive = playlist.getFlag(MODULE_ID, "isAdaptive");
            if (!isAdaptive) return;
            
            debug("preUpdatePlaylist for adaptive playlist:", playlist.name, "changes:", changes);
            
            // If sounds array is being updated with playing sounds, we need to intercept
            if (changes.sounds) {
                debug(`Checking ${changes.sounds.length} sound changes`);
                
                for (const soundChange of changes.sounds) {
                    if (soundChange.playing === true) {
                        const sound = playlist.sounds.get(soundChange._id);
                        const midPath = sound?.getFlag(MODULE_ID, "midIntensityPath");
                        const lowPath = sound?.getFlag(MODULE_ID, "lowIntensityPath");
                        
                        if (midPath || lowPath) {
                            debug(`BLOCKING sound from playing in preUpdate: ${sound.name}`);
                            // Prevent Foundry from playing this sound
                            soundChange.playing = false;
                            // Mark that we need to handle this ourselves
                            if (!options.adaptiveAudioSounds) options.adaptiveAudioSounds = [];
                            options.adaptiveAudioSounds.push(sound.id);
                        }
                    }
                }
            }
        });

        // Monitor when playlists update (play/stop)
        Hooks.on("updatePlaylist", (playlist, changes, options, userId) => {
            debug("updatePlaylist:", playlist.name, "changes:", changes);
            this._handlePlaylistUpdate(playlist, changes, options);
        });

        // Monitor when sounds update (play/pause/stop)
        Hooks.on("updatePlaylistSound", (sound, changes, options, userId) => {
            // Ignore our internal updates to avoid recursion/infinite loops
            if (options?.adaptiveAudioInternal) return;

            debug("*** updatePlaylistSound FIRED ***", sound.name, "changes:", changes, "options:", options);
            
            const playlist = sound.parent;
            const isAdaptive = playlist?.getFlag(MODULE_ID, "isAdaptive");
            
            // If we blocked the playing update in preUpdate, trigger our playback now
            if (isAdaptive && options.adaptiveAudioPlay) {
                debug(`Starting adaptive playback for: ${sound.name}`);
                this._playAdaptiveSound(sound);
            }

            // CRITICAL: Ensure native playback is muted for adaptive sounds
            // This handles the case where we set playing:true internally and Foundry starts the native sound
            if (isAdaptive && sound.sound) {
                // Only log if we are actually changing it to avoid spam during volume slides
                if (sound.sound.volume > 0) {
                     debug(`[DEBUG] Setting native sound volume to 0 in _handleSoundUpdate for: ${sound.name}`);
                     sound.sound.volume = 0;
                     debug(`Muted native playback for adaptive sound: ${sound.name}`);
                }
            }
            
            // If we blocked the stop update in preUpdate, stop our playback now
            if (isAdaptive && options.adaptiveAudioStop) {
                debug(`Stopping adaptive playback for: ${sound.name}`);
                this._stopAdaptiveSound(sound.id);
            }
            
            // Also handle via the old method
            this._handleSoundUpdate(sound, changes);
        });

        debug("All hooks registered successfully");

        // Clean up when sounds are deleted
        Hooks.on("deletePlaylistSound", (sound, options, userId) => {
            debug(`deletePlaylistSound detected for: ${sound.name} (${sound.id})`);
            this._stopAdaptiveSound(sound.id, true);
        });

        // CRITICAL: When copying/dragging a playing sound, ensure the new copy starts Paused
        Hooks.on("preCreatePlaylistSound", (sound, data, options, userId) => {
            const playlist = sound.parent;
            const isAdaptive = playlist?.getFlag(MODULE_ID, "isAdaptive");
            
            // Check if this is an adaptive sound (checks parent playlist flag or sound flags)
            // Note: During creation, sound flags might be in `data` or `sound` depending on how it's constructed
            // But we can check data.flags or the sound object itself
            const midPath = sound.getFlag(MODULE_ID, "midIntensityPath") ?? data.flags?.[MODULE_ID]?.midIntensityPath;
            const lowPath = sound.getFlag(MODULE_ID, "lowIntensityPath") ?? data.flags?.[MODULE_ID]?.lowIntensityPath;

            // Only interfere if it is an adaptive sound context
            // If the playlist is adaptive OR the sound itself has adaptive path flags
            if (isAdaptive || midPath || lowPath) {
                // If the sound is being created with playing=true (e.g. cloned from a playing sound)
                if (data.playing) {
                     debug(`Intercepted preCreatePlaylistSound for ${sound.name} - Forcing playing=false for copy`);
                     // Mutate the data object directly to prevent it starting as playing
                     sound.updateSource({ playing: false });
                }
            }
        });

        // Clean up when playlist is deleted (stops all contained sounds)
        Hooks.on("deletePlaylist", (playlist, options, userId) => {
            debug(`deletePlaylist detected for: ${playlist.name} (${playlist.id})`);
            
            // Find all playing sounds that belong to this playlist
            // Note: We can't rely on playlist.sounds because they might already be invalid/detached
            // So we iterate our playingSounds map
            for (const [soundId, entry] of this.playingSounds.entries()) {
                if (entry.sound.parent && entry.sound.parent.id === playlist.id) {
                    debug(`Stopping sound due to playlist deletion: ${entry.sound.name}`);
                    this._stopAdaptiveSound(soundId, true);
                }
            }
        });
        
        // Combat integration - fade intensity on combat start/end
        // Combat integration - fade intensity on combat start/end
        Hooks.on("combatStart", (combat, updateData) => {
            if (!game.settings.get(MODULE_ID, "autoSetCombatIntensity")) return;

            const targetIntensity = game.settings.get(MODULE_ID, "combatIntensity") / 100;
            debug(`Combat started, fading to ${(targetIntensity * 100)}% intensity`);
            
            // Store current intensity ONLY if we aren't already tracking a combat session (first combat started)
            // This prevents overwriting the restore point if a second combat starts
            if (this.preCombatIntensity === null) {
                this.preCombatIntensity = this.intensity;
                this.userOverrideDuringCombat = false;
            }
            
            // Fade to target over 2 seconds
            this.fadeTo(targetIntensity, 2000, true); // true = update UI
        });
        
        Hooks.on("deleteCombat", (combat, options, userId) => {
            if (!game.settings.get(MODULE_ID, "autoSetCombatIntensity")) return;

            // Check if there are other active combats running
            // We only want to restore intensity when the LAST combat ends
            const otherActiveCombats = game.combats.filter(c => c.started && c.id !== combat.id);
            if (otherActiveCombats.length > 0) {
                debug("Combat ended, but other combats remain active. Keeping combat intensity.");
                return;
            }

            debug("All combats ended");
            
            // Only restore pre-combat intensity if user hasn't overridden
            if (!this.userOverrideDuringCombat && this.preCombatIntensity !== null) {
                debug(`Restoring pre-combat intensity: ${(this.preCombatIntensity * 100).toFixed(0)}%`);
                this.fadeTo(this.preCombatIntensity, 2000, true); // true = update UI
            } else if (this.userOverrideDuringCombat) {
                debug(`User overrode intensity during combat, keeping current: ${(this.intensity * 100).toFixed(0)}%`);
            }
            
            // Reset combat state
            this.preCombatIntensity = null;
            this.userOverrideDuringCombat = false;
        });
    }

    /**
     * Preload all adaptive sounds in all adaptive playlists
     */
    async preloadAll() {
        debug("Preloading all adaptive sounds...");
        ui.notifications.info("Adaptive Audio: Preloading all adaptive tracks...");
        
        let count = 0;
        for (const playlist of game.playlists) {
            const isAdaptive = playlist.getFlag(MODULE_ID, "isAdaptive");
            if (!isAdaptive) continue;
            
            count += await this._preloadPlaylistInternal(playlist);
        }
        
        ui.notifications.info(`Adaptive Audio: Preload complete. Verified ${count} tracks.`);
        debug(`Preloading complete. Total checks: ${count}`);
    }

    /**
     * Preload adaptive sounds for a specific playlist
     * @param {string} playlistId 
     */
    async preloadPlaylist(playlistId) {
        const playlist = game.playlists.get(playlistId);
        if (!playlist) return;

        debug(`Preloading playlist: ${playlist.name}`);
        ui.notifications.info(`Adaptive Audio: Preloading ${playlist.name}...`);

        const count = await this._preloadPlaylistInternal(playlist);

        ui.notifications.info(`Adaptive Audio: ${playlist.name} preload complete.`);
    }

    /**
     * Preload adaptive sound layers for a specific sound
     * @param {PlaylistSound} sound 
     */
    async preloadSound(sound) {
        if (!sound) return;

        debug(`Preloading sound: ${sound.name}`);
        ui.notifications.info(`Adaptive Audio: Preloading ${sound.name}...`);

        const highPath = sound.path;
        const midPath = sound.getFlag(MODULE_ID, "midIntensityPath");
        const lowPath = sound.getFlag(MODULE_ID, "lowIntensityPath");
        
        let count = 0;
        const promises = [];
        
        if (highPath) promises.push(this._preloadSound(highPath).then(() => count++));
        if (midPath) promises.push(this._preloadSound(midPath).then(() => count++));
        if (lowPath) promises.push(this._preloadSound(lowPath).then(() => count++));
        
        await Promise.all(promises);
        
        ui.notifications.info(`Adaptive Audio: Preloaded ${count} layers for ${sound.name}`);
    }

    /**
     * Internal helper to preload a single playlist
     * @private
     */
    async _preloadPlaylistInternal(playlist) {
        let count = 0;
        for (const sound of playlist.sounds) {
            const highPath = sound.path; // Base path is now High intensity
            const midPath = sound.getFlag(MODULE_ID, "midIntensityPath");
            const lowPath = sound.getFlag(MODULE_ID, "lowIntensityPath");
            
            if (highPath) { await this._preloadSound(highPath); count++; }
            if (midPath) { await this._preloadSound(midPath); count++; }
            if (lowPath) { await this._preloadSound(lowPath); count++; }
        }
        return count;
    }

    /**
     * Preload a single audio file
     * @private
     */
    async _preloadSound(path) {
        if (this.preloadedAudio.has(path)) {
            return; // Already cached
        }
        
        try {
            debug(`Preloading: ${path}`);
            
            // Use Foundry's audio helper to preload
            // This creates the audio element but doesn't play it
            const sound = await foundry.audio.AudioHelper.play({
                src: path,
                volume: 0,
                loop: false
            }, false);
            
            // Immediately stop it (we just wanted to load it)
            if (sound) {
                sound.stop();
                this.preloadedAudio.set(path, true);
                debug(`Cached: ${path}`);
            }
        } catch (error) {
            console.warn(`${MODULE_ID} | Failed to preload ${path}:`, error);
        }
    }

    /**
     * Handle playlist updates (mode changes, playing state)
     * @private
     */
    async _handlePlaylistUpdate(playlist, changes, options) {
        // Check if this is an adaptive playlist
        const isAdaptive = playlist.getFlag(MODULE_ID, "isAdaptive");
        if (!isAdaptive) return;

        debug("Handling adaptive playlist update:", playlist.name);
        
        // Check if we blocked any sounds in preUpdate
        if (options?.adaptiveAudioSounds) {
            debug(`Playing ${options.adaptiveAudioSounds.length} blocked sounds`);
            for (const soundId of options.adaptiveAudioSounds) {
                const sound = playlist.sounds.get(soundId);
                if (sound) {
                    debug(`Starting adaptive playback for blocked sound: ${sound.name}`);
                    await this._playAdaptiveSound(sound);
                    
                    // Update the sound document to show it's playing (for UI)
                    // Use a flag to prevent our preUpdate hook from blocking this
                    if (sound.isOwner) {
                        await sound.update({ playing: true }, { diff: false, render: true, adaptiveAudioInternal: true });
                    }
                    
                    // EXTRA SAFETY: Mute native playback here as well, just in case updatePlaylistSound hook misses it
                    if (sound.sound) {
                        debug(`[DEBUG] Setting native sound volume to 0 in _handlePlaylistUpdate for: ${sound.name}`);
                        sound.sound.volume = 0;
                        debug(`Muted native playback (safety check) for: ${sound.name}`);
                    }
                    
                    debug("Updated sound to playing:true for UI");
                }
            }
            return; // We've handled everything
        }
        
        // Fallback: check for sounds that are already playing (shouldn't happen if preUpdate works)
        for (const sound of playlist.sounds) {
            const midPath = sound.getFlag(MODULE_ID, "midIntensityPath");
            const lowPath = sound.getFlag(MODULE_ID, "lowIntensityPath");
            
            // Only handle sounds with at least one alternative track configured
            if ((!midPath && !lowPath) || !sound.path) continue;
            
            // Check if this sound is currently playing
            if (sound.playing && !this.playingSounds.has(sound.id)) {
                if (game.settings.get(MODULE_ID, "debugLogging")) console.warn(`${MODULE_ID} | Sound started playing despite preUpdate block - stopping it`);
                
                if (sound.sound) {
                    sound.sound.stop();
                }
                
                debug(`Starting adaptive playback for: ${sound.name}`);
                await this._playAdaptiveSound(sound);
            }
            // Check if this sound stopped playing
            else if (!sound.playing && this.playingSounds.has(sound.id)) {
                debug(`Stopping adaptive playback for: ${sound.name}`);
                this._stopAdaptiveSound(sound.id);
            }
        }
    }

    /**
     * Handle individual sound updates
     * @private
     */
    async _handleSoundUpdate(sound, changes) {
        const playlist = sound.parent;
        const isAdaptive = playlist?.getFlag(MODULE_ID, "isAdaptive");
        if (!isAdaptive) return;

        // If sound started playing
        if (changes.playing === true) {
            await this._playAdaptiveSound(sound);
        }
        // If sound stopped
        else if (changes.playing === false) {
            this._stopAdaptiveSound(sound.id);
        }
        // If volume changed (and we are playing)
        else if (changes.volume !== undefined && this.playingSounds.has(sound.id)) {
            // Recalculate volumes with new track volume
            this._applyIntensityToSound(sound.id);
        }
    }

    /**
     * Play an adaptive sound with dual intensity tracks
     * @private
     */
    async _playAdaptiveSound(sound) {
        // Prevent concurrent loading of the same sound
        if (this.loadingSounds.has(sound.id)) {
            debug(`Sound "${sound.name}" is already loading, skipping duplicate request`);
            return;
        }

        // ENFORCE PLAYLIST EXCLUSIVITY
        // Because we block the native "stop" updates in preUpdatePlaylistSound, 
        // we must manually ensure other sounds stop when starting a new one (unless Simultaneous)
        const playlist = sound.parent;
        if (playlist && playlist.mode !== CONST.PLAYLIST_MODES.SIMULTANEOUS) {
             const soundsToStop = [];
             for (const [otherId, entry] of this.playingSounds) {
                 if (entry.sound.parent?.id === playlist.id && otherId !== sound.id) {
                     soundsToStop.push(otherId);
                 }
             }
             
             for (const id of soundsToStop) {
                 const entry = this.playingSounds.get(id);
                 debug(`Enforcing playlist exclusivity: Stopping ${entry?.sound?.name}`);
                 this._stopAdaptiveSound(id);
             }
        }

        const startTime = performance.now();
        debug(`[TIMING] _playAdaptiveSound START for: ${sound.name}`);
        
        const highPath = sound.path; // Base path is High intensity
        const midPath = sound.getFlag(MODULE_ID, "midIntensityPath");
        const lowPath = sound.getFlag(MODULE_ID, "lowIntensityPath");

        // Skip if not configured with at least one alternative track
        if (!midPath && !lowPath) {
            console.warn(`${MODULE_ID} | Sound "${sound.name}" missing adaptive tracks`);
            return;
        }

        // Stop if already playing
        if (this.playingSounds.has(sound.id)) {
            debug("_playAdaptiveSound called for playing sound, restarting...");
            this._stopAdaptiveSound(sound.id);
        }

        this.loadingSounds.add(sound.id);

        try {
            debug(`Playing adaptive sound: ${sound.name}`);
            
            // Instantiate sound objects
            const highSound = highPath ? new foundry.audio.Sound(highPath) : null;
            const midSound = midPath ? new foundry.audio.Sound(midPath) : null;
            const lowSound = lowPath ? new foundry.audio.Sound(lowPath) : null;

            // Load all tracks in parallel to ensure we are ready to play whatever the slider dictates
            const loadStart = performance.now();
            const promises = [];
            if (highSound) promises.push(highSound.load());
            if (midSound) promises.push(midSound.load());
            if (lowSound) promises.push(lowSound.load());

            if (promises.length > 0) {
                if (promises.length > 1) {
                     ui.notifications.info(`${MODULE_ID}: Buffering ${promises.length} audio layers...`, { permanent: false });
                }
                await Promise.all(promises);
            }
            
            debug(`Tracks loaded - took: ${(performance.now() - loadStart).toFixed(1)}ms`);

            // Store the state
            this.playingSounds.set(sound.id, {
                highSound,
                midSound,
                lowSound,
                sound,
                needsInitialSync: false
            });

            // Start all tracks simultaneously
            // Since we waited for load, they should start very close to each other
            const playOptions = { volume: 0, loop: sound.repeat };
            if (highSound) highSound.play(playOptions);
            if (midSound) midSound.play(playOptions);
            if (lowSound) lowSound.play(playOptions);

            debug("Tracks started. Applying intensity.");
            this._applyIntensityToSound(sound.id);
            
            // Update UI
            if (sound.isOwner) {
                await sound.update({ playing: true }, { diff: false, render: true, adaptiveAudioInternal: true });
            }
            
            debug(`[TIMING] _playAdaptiveSound complete: ${(performance.now() - startTime).toFixed(1)}ms`);

            // Start drift monitor
            if (!this.driftMonitorInterval) {
               this._startDriftMonitoring();
            }

        } catch (error) {
            console.error(`${MODULE_ID} | Error playing adaptive sound:`, error);
        } finally {
            this.loadingSounds.delete(sound.id);
        }
    }

    /**
     * Stop an adaptive sound
     * @private
     * @param {string} soundId
     * @param {boolean} [skipUpdate=false] - Whether to skip updating the sound document (e.g. during deletion)
     */
    _stopAdaptiveSound(soundId, skipUpdate = false) {
        const entry = this.playingSounds.get(soundId);
        if (!entry) return;

        if (entry.lowSound) entry.lowSound.stop();
        if (entry.midSound) entry.midSound.stop();
        if (entry.highSound) entry.highSound.stop();

        this.playingSounds.delete(soundId);

        debug(`Stopped adaptive sound: ${entry.sound.name}`);
        
        // IMPORTANT: Update the sound document to reflect it stopped
        // This prevents "zombie" playback on reload
        // Skip if explicitly requested (e.g. during deletion) or if parent is missing
        const sound = entry.sound;
        if (!skipUpdate && sound.isOwner && sound.playing && sound.parent && game.playlists.has(sound.parent.id)) {
             sound.update({ playing: false }, { diff: false, render: true, adaptiveAudioInternal: true }).catch(err => {
                 if (game.settings.get(MODULE_ID, "debugLogging")) console.warn(`${MODULE_ID} | Failed to update sound status (likely deleted):`, err);
             });
        }

        // Stop drift monitoring if no sounds playing
        if (this.playingSounds.size === 0) {
            this._stopDriftMonitoring();
        }
    }

    /**
     * Set global intensity for all playing adaptive sounds
     * @param {number} intensity - Value between 0.0 and 1.0
     * @param {boolean} fromSync - True if called from settings sync or fade (don't propagate)
     */
    setGlobalIntensity(intensity, fromSync = false) {
        this.intensity = Math.max(0, Math.min(1, intensity));
        
        // If this is a manual change during combat, mark it as user override
        // (Only if not from sync/fade)
        if (!fromSync && this.preCombatIntensity !== null) {
            this.userOverrideDuringCombat = true;
            debug("User manually changed intensity during combat");
        }
        
        // Apply to all playing sounds
        for (const soundId of this.playingSounds.keys()) {
            this._applyIntensityToSound(soundId);
        }

        // Propagate to settings if GM and not from sync
        if (!fromSync && game.user.isGM) {
            game.settings.set(MODULE_ID, "currentIntensity", Math.round(this.intensity * 100));
            
            // If custom mix is enabled, we might need to update those settings too if the slider drives them?
            // Sidebar logic handles that by calling setCustomVolume separately, so we just handle intensity here.
        }
    }

    /**
     * Fade intensity smoothly from current value to target value
     * @param {number} targetIntensity - Target intensity (0.0 to 1.0)
     * @param {number} duration - Fade duration in milliseconds
     * @param {boolean} updateUI - Whether to update the UI slider
     * @private
     */
    /**
     * Fade intensity smoothly from current value to target value
     * @param {number} targetIntensity - Target intensity (0.0 to 1.0)
     * @param {number} duration - Fade duration in milliseconds
     * @param {boolean} [updateUI=false] - Whether to update the UI slider
     */
    fadeTo(targetIntensity, duration, updateUI = false) {
        // Clear any existing fade
        if (this.fadeInterval) {
            clearInterval(this.fadeInterval);
            this.fadeInterval = null;
        }
        
        const startIntensity = this.intensity;
        const delta = targetIntensity - startIntensity;
        const startTime = Date.now();
        
        debug(`Fading intensity from ${startIntensity.toFixed(2)} to ${targetIntensity.toFixed(2)} over ${duration}ms`);

        this.fadeInterval = setInterval(() => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1.0);
            
            // Ease-in-out curve for smooth fade
            const eased = progress < 0.5
                ? 2 * progress * progress
                : 1 - Math.pow(-2 * progress + 2, 2) / 2;
            
            const newIntensity = startIntensity + (delta * eased);
            
            // Apply intensity locally
            // fromSync=true prevents recursion and settings spam
            this.setGlobalIntensity(newIntensity, true);
            
            // Update UI if requested
            if (updateUI) {
                const percentValue = Math.round(newIntensity * 100);
                
                // Update ALL sliders and displays
                const sliders = document.querySelectorAll('.adaptive-audio-intensity input[name="intensity"]');
                const displays = document.querySelectorAll('.adaptive-audio-intensity .intensity-value');
                
                sliders.forEach(slider => { slider.value = percentValue; });
                displays.forEach(display => { display.textContent = `${percentValue}%`; });
            }
            
            // Stop when complete
            if (progress >= 1.0) {
                clearInterval(this.fadeInterval);
                this.fadeInterval = null;
                debug("Fade complete");
                
                // Final sync to world settings at end of fade
                if (game.user.isGM) {
                     game.settings.set(MODULE_ID, "currentIntensity", Math.round(targetIntensity * 100));
                }
            }
        }, 16); // ~60fps
    }

    /**
     * Set custom mix state
     * @param {boolean} enabled - Whether custom mix is enabled
     * @param {boolean} fromSync - True if from settings sync
     */
    setCustomMixEnabled(enabled, fromSync = false) {
        this.customMixEnabled = enabled;
        this.setGlobalIntensity(this.intensity, true); // Re-apply to update volumes (local)
        
        if (!fromSync && game.user.isGM) {
            game.settings.set(MODULE_ID, "customMixEnabled", enabled);
        }
    }

    /**
     * Set custom volume for a specific track type
     * @param {string} type - 'high', 'mid', or 'low'
     * @param {number} volume - Volume between 0.0 and 1.0
     * @param {boolean} fromSync - True if from settings sync
     */
    setCustomVolume(type, volume, fromSync = false) {
        volume = Math.max(0, Math.min(1, volume));
        
        if (type === 'high') this.customHighVolume = volume;
        else if (type === 'mid') this.customMidVolume = volume;
        else if (type === 'low') this.customLowVolume = volume;
        
        if (this.customMixEnabled) {
            this.setGlobalIntensity(this.intensity, true); // Re-apply to update volumes (local)
        }
        
        if (!fromSync && game.user.isGM) {
            if (type === 'high') game.settings.set(MODULE_ID, "customHighVolume", volume);
            else if (type === 'mid') game.settings.set(MODULE_ID, "customMidVolume", volume);
            else if (type === 'low') game.settings.set(MODULE_ID, "customLowVolume", volume);
        }
    }

    /**
     * Calculate volume levels for tracks based on intensity
     * @param {number} intensity - Value between 0.0 and 1.0
     * @returns {Object} - { low, mid, high } volumes (0-1 range)
     */
    calculateMix(intensity) {
        // Linear interpolation helper
        // points is array of {p: intensity_percent, v: volume}
        const interp = (val, points) => {
            for (let i = 0; i < points.length - 1; i++) {
                const p1 = points[i];
                const p2 = points[i+1];
                if (val >= p1.p && val <= p2.p) {
                    const range = p2.p - p1.p;
                    const progress = (val - p1.p) / range;
                    return p1.v + (p2.v - p1.v) * progress;
                }
            }
            return points[points.length-1].v;
        };

        // 5-Stage Curve (Oscillating Low)
        const low = interp(intensity, [
            {p: 0.00, v: 1.0},
            {p: 0.25, v: 0.0},
            {p: 0.50, v: 1.0},
            {p: 0.75, v: 0.0},
            {p: 1.00, v: 1.0}
        ]);

        const mid = interp(intensity, [
            {p: 0.00, v: 0.0},
            {p: 0.25, v: 1.0},
            {p: 1.00, v: 1.0}
        ]);

        const high = interp(intensity, [
            {p: 0.00, v: 0.0},
            {p: 0.50, v: 0.0},
            {p: 0.75, v: 1.0},
            {p: 1.00, v: 1.0}
        ]);

        return { low, mid, high };
    }

    /**
     * Apply intensity to a specific sound
     * Handles dynamic mixing based on available tracks
     * @private
     */
    _applyIntensityToSound(soundId) {
        const entry = this.playingSounds.get(soundId);
        if (!entry) return;

        let lowVolume = 0;
        let midVolume = 0;
        let highVolume = 0;
        
        // Detect available tracks
        const hasLow = !!entry.lowSound;
        const hasMid = !!entry.midSound;
        const hasHigh = !!entry.highSound;

        // Get individual track volume (from playlist slider)
        // Default to 1 if undefined
        const trackVolume = entry.sound.volume ?? 1.0;
        const effectiveMasterVolume = this.masterVolume * trackVolume;

        if (this.customMixEnabled) {
            debug("Custom Mix Enabled - using static volumes (Global Intensity ignored)");
            // Use custom volumes
            lowVolume = (this.customLowVolume ?? 1.0) * effectiveMasterVolume;
            midVolume = (this.customMidVolume ?? 1.0) * effectiveMasterVolume;
            highVolume = (this.customHighVolume ?? 1.0) * effectiveMasterVolume;
        } else {
            debug(`_applyIntensityToSound | Intensity: ${this.intensity.toFixed(2)} | Tracks: L=${hasLow} M=${hasMid} H=${hasHigh}`);

            // Calculate mixing curves
            // Scenario 1: All 3 tracks (Complex 5-stage curve)
            if (hasLow && hasMid && hasHigh) {
                const mix = this.calculateMix(this.intensity);
                
                lowVolume = mix.low * effectiveMasterVolume;
                midVolume = mix.mid * effectiveMasterVolume;
                highVolume = mix.high * effectiveMasterVolume;
                
                debug(`Complex Mix Result | Low: ${lowVolume.toFixed(2)} | Mid: ${midVolume.toFixed(2)} | High: ${highVolume.toFixed(2)}`);
            } 
            // Scenario 2: High + Mid only (interpolated 0-100)
            else if (!hasLow && hasMid && hasHigh) {
                // 0-100%: Mid -> High
                const progress = this.intensity;
                midVolume = (1 - progress) * effectiveMasterVolume;
                highVolume = progress * effectiveMasterVolume;
            }
            // Scenario 3: High + Low only (interpolated 0-100)
            else if (hasLow && !hasMid && hasHigh) {
                 // 0-100%: Low -> High
                 const progress = this.intensity;
                 lowVolume = (1 - progress) * effectiveMasterVolume;
                 highVolume = progress * effectiveMasterVolume;
            }
            // Scenario 4: Mid + Low only (interpolated 0-100)
            else if (hasLow && hasMid && !hasHigh) {
                // 0-100%: Low -> Mid
                const progress = this.intensity;
                lowVolume = (1 - progress) * effectiveMasterVolume;
                midVolume = progress * effectiveMasterVolume;
            }
            // Scenario 5: Single adaptive track? (Fallback)
             else {
                // Just map everything to whatever is available
                if (hasHigh) highVolume = effectiveMasterVolume;
                if (hasMid) midVolume = effectiveMasterVolume;
                if (hasLow) lowVolume = effectiveMasterVolume;
            }
        }
        
        if (entry.lowSound) entry.lowSound.volume = lowVolume;
        if (entry.midSound) entry.midSound.volume = midVolume;
        if (entry.highSound) entry.highSound.volume = highVolume;
    }

    /**
     * Set master volume
     * @param {number} volume - Value between 0.0 and 1.0
     */
    setMasterVolume(volume) {
        this.masterVolume = Math.max(0, Math.min(1, volume));
        game.settings.set(MODULE_ID, "masterVolume", this.masterVolume * 100);
        
        // Re-apply intensity to update volumes
        this.setGlobalIntensity(this.intensity);
    }

    /**
     * Monitor for drift between tracks
     * @private
     */
    /**
     * Monitor for drift between tracks and correct secondary tracks
     * @private
     */
    _startDriftMonitoring() {
        this._stopDriftMonitoring();

        this.driftMonitorInterval = setInterval(() => {
            if (this.playingSounds.size === 0) {
                this._stopDriftMonitoring();
                return;
            }

            for (const [soundId, entry] of this.playingSounds.entries()) {
                try {
                    const { lowSound, midSound, highSound, sound } = entry;
                    
                    // Identify Primary (must match _playAdaptiveSound logic: Low > Mid > High)
                    const primarySound = lowSound || midSound || highSound;
                    if (!primarySound || !primarySound.playing) continue;
                    
                    // Detect End of Track (if not looping)
                    // We use a small threshold to catch it just before or at the end
                    if (!sound.repeat && primarySound.duration > 0 && primarySound.currentTime >= (primarySound.duration - 0.2)) {
                        debug(`Track finished: ${sound.name}`);
                        this._stopAdaptiveSound(soundId);
                        continue;
                    }
                    
                    const baseTime = primarySound.currentTime;
                    
                    // Check Secondaries
                    const checkDrift = (secondary, label) => {
                        if (!secondary || !secondary.playing) return;
                        
                        const drift = Math.abs(secondary.currentTime - baseTime);
                        
                        // Verbose logging
                        // if (game.settings.get(MODULE_ID, "debugLogging")) {
                        //     console.log(`${MODULE_ID} | [Drift Check] ${sound.name} (${label}): ${drift.toFixed(3)}s`);
                        // }

                        if (drift > 0.1) { // 100ms threshold
                            console.warn(`${MODULE_ID} | Drift detected in "${sound.name}" (${label}): ${(drift * 1000).toFixed(0)}ms. Resyncing to Primary...`);
                            
                            // Resync: Stop secondary, Play secondary at Base Time
                            // We use a small volume fade or just hard cut? Hard cut is safer for sync.
                            secondary.stop();
                            
                            // Re-play with offset
                            const offset = primarySound.currentTime;
                            secondary.play({ 
                                volume: 0, 
                                offset: offset, 
                                loop: sound.repeat 
                            });
                            
                            // Re-apply volumes instantly
                            this._applyIntensityToSound(soundId);
                        }
                    };

                    // Check both secondaries against Primary
                    if (primarySound !== highSound) checkDrift(highSound, "High");
                    if (primarySound !== midSound) checkDrift(midSound, "Mid");
                    if (primarySound !== lowSound) checkDrift(lowSound, "Low");

                } catch (error) {
                    // Silently fail if properties inaccessible
                }
            }
        }, 1000);
    }

    /**
     * Stop drift monitoring
     * @private
     */
    _stopDriftMonitoring() {
        if (this.driftMonitorInterval) {
            clearInterval(this.driftMonitorInterval);
            this.driftMonitorInterval = null;
        }
    }

    /**
     * Get current state
     */
    getState() {
        return {
            playingSoundsCount: this.playingSounds.size,
            intensity: this.intensity,
            masterVolume: this.masterVolume,
            // Legacy quick test mode
            isPlaying: this.isPlaying,
            isPaused: this.isPaused,
            lowTrackPath: this.lowTrackPath,
            highTrackPath: this.highTrackPath,
            loop: true
        };
    }

    // ===== LEGACY QUICK TEST MODE METHODS =====
    // These maintain compatibility with the original single-track UI

    async loadTracks(lowPath, highPath) {
        await this.stop();
        this.lowTrackPath = lowPath;
        this.highTrackPath = highPath;
        await game.settings.set(MODULE_ID, "lowTrackPath", lowPath);
        await game.settings.set(MODULE_ID, "highTrackPath", highPath);
        return true;
    }

    async play() {
        // Legacy single-track playback for quick test
        if (!this.lowTrackPath || !this.highTrackPath) {
            ui.notifications.warn(game.i18n.localize(`${MODULE_ID}.notifications.bothTracksRequired`));
            return false;
        }

        try {
            await this.stop();

            const [lowSound, highSound] = await Promise.all([
                foundry.audio.AudioHelper.play({
                    src: this.lowTrackPath,
                    volume: 1.0,
                    loop: true
                }, false),
                foundry.audio.AudioHelper.play({
                    src: this.highTrackPath,
                    volume: 1.0,
                    loop: true
                }, false)
            ]);

            this.playingSounds.set("legacy-test", {
                lowSound,
                highSound,
                sound: { name: "Quick Test", id: "legacy-test" }
            });

            this._applyIntensityToSound("legacy-test");
            this.isPlaying = true;
            this.isPaused = false;
            this._startDriftMonitoring();

            return true;
        } catch (error) {
            console.error(`${MODULE_ID} | Error during playback:`, error);
            return false;
        }
    }

    pause() {
        // Legacy pause for quick test
        const entry = this.playingSounds.get("legacy-test");
        if (!entry) return;

        if (entry.lowSound) entry.lowSound.pause();
        if (entry.highSound) entry.highSound.pause();

        this.isPaused = true;
        this.isPlaying = false;
        this._stopDriftMonitoring();
    }

    async stop() {
        // Stop legacy test track
        this._stopAdaptiveSound("legacy-test");
        this.isPlaying = false;
        this.isPaused = false;
    }

    setIntensity(intensity) {
        this.setGlobalIntensity(intensity);
    }

    setLoop(enabled) {
        // Not applicable for playlist-based system
    }
}
