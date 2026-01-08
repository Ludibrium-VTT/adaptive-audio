import { MODULE_ID } from "./settings.js";
import { AdaptiveAudioPlayer } from "./AdaptiveAudioPlayer.js";

/**
 * Application UI for the Adaptive Audio Player
 */
export class AdaptiveAudioUI extends Application {
    constructor(player) {
        super();
        this.player = player;
    }

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "adaptive-audio-ui",
            classes: ["adaptive-audio"],
            template: "modules/adaptive-audio/templates/adaptive-audio.hbs",
            title: game.i18n.localize(`${MODULE_ID}.title`),
            width: 500,
            height: "auto",
            resizable: true,
            popOut: true
        });
    }

    getData() {
        const state = this.player.getState();
        return {
            lowTrackPath: state.lowTrackPath || "",
            highTrackPath: state.highTrackPath || "",
            intensity: Math.round(state.intensity * 100),
            masterVolume: Math.round(state.masterVolume * 100),
            loop: state.loop,
            isPlaying: state.isPlaying,
            isPaused: state.isPaused,
            isStopped: !state.isPlaying && !state.isPaused,
            statusText: this._getStatusText(state),
            canPlay: state.lowTrackPath && state.highTrackPath
        };
    }

    _getStatusText(state) {
        if (state.isPlaying) return game.i18n.localize(`${MODULE_ID}.ui.playing`);
        if (state.isPaused) return game.i18n.localize(`${MODULE_ID}.ui.paused`);
        return game.i18n.localize(`${MODULE_ID}.ui.stopped`);
    }

    activateListeners(html) {
        super.activateListeners(html);

        // File picker for low intensity track
        html.find('[name="lowTrackPath"]').on("click", async (event) => {
            const fp = new FilePicker({
                type: "audio",
                current: this.player.lowTrackPath,
                callback: async (path) => {
                    await this.player.loadTracks(path, this.player.highTrackPath);
                    this.render();
                }
            });
            fp.render(true);
        });

        // File picker for high intensity track
        html.find('[name="highTrackPath"]').on("click", async (event) => {
            const fp = new FilePicker({
                type: "audio",
                current: this.player.highTrackPath,
                callback: async (path) => {
                    await this.player.loadTracks(this.player.lowTrackPath, path);
                    this.render();
                }
            });
            fp.render(true);
        });

        // Play button
        html.find('[data-action="play"]').on("click", async (event) => {
            await this.player.play();
            this.render();
        });

        // Pause button
        html.find('[data-action="pause"]').on("click", (event) => {
            this.player.pause();
            this.render();
        });

        // Stop button
        html.find('[data-action="stop"]').on("click", async (event) => {
            await this.player.stop();
            this.render();
        });

        // Intensity slider
        html.find('[name="intensity"]').on("input", (event) => {
            const value = parseInt(event.target.value) / 100;
            this.player.setIntensity(value);
            html.find('[data-intensity-value]').text(event.target.value);
        });

        // Master volume slider
        html.find('[name="masterVolume"]').on("input", (event) => {
            const value = parseInt(event.target.value) / 100;
            this.player.setMasterVolume(value);
            html.find('[data-volume-value]').text(event.target.value);
        });

        // Loop checkbox
        html.find('[name="loop"]').on("change", (event) => {
            this.player.setLoop(event.target.checked);
        });
    }
}
