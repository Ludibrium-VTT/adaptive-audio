# Adaptive Audio for Foundry VTT

A Foundry VTT module that enables seamless adaptive audio playback with multi-layered tracks. Perfect for music that dynamically responds to combat intensity or scene mood.

## Features

- **Playlist-Based Adaptive Audio**: Mark any playlist as "adaptive" to enable multi-track support.
- **Three Intensity Layers**: Each sound supports **Low**, **Mid**, and **High** intensity tracks.
- **Dynamic 5-Stage Mixing**: Uses a sophisticated mixing curve to oscillate between tracks (Low -> Mid -> Low+Mid -> Mid+High -> All) as intensity rises.
- **Global Intensity Control**: Single slider in the Playlists sidebar controls all playing adaptive sounds.
- **Custom Mix Mode**: Manually adjust the volume of each layer individually (Low, Mid, High) for granular control.
- **Convenience Features**: 
    - **Ovani Auto-Config**: Automatically detects and fills "Intensity 1" and "Intensity 2" layers when you select a "Main" track.
    - **Preload**: One-click preload for all adaptive tracks to ensure instant playback.
- **Combat Integration**: Automatically adjust intensity when combat starts/ends.
- **Client-Side Sync**: Each player controls their own adaptive audio locally with drift monitoring.

## Installation

1. Copy this module to your Foundry VTT `Data/modules/adaptive-audio` directory
2. Launch Foundry VTT
3. Enable "Adaptive Audio" in **Add-on Modules**

## Usage

### Setting Up an Adaptive Playlist

1. **Create or open a playlist**
2. **Right-click the playlist → Configure**
3. **Check "Adaptive Audio Playlist"** checkbox
4. **Save**

### Configuring Sounds

1. **Add sounds to your adaptive playlist** (or use existing sounds)
2. **Right-click a sound → Configure**
3. **Select your High Intensity Track**: This is the standard "Audio Source" field (acts as the base track).
4. **Select Mid/Low Tracks**: New fields appear below the main source for "Mid Intensity" and "Low Intensity".
5. **Ovani Auto-Fill**: If you select a file named `...Main.wav` (containing "Ovani"), the module will automatically fill the Mid (`Intensity 2`) and Low (`Intensity 1`) fields for you!

### Controlling Intensity

**Global Intensity Slider** (in Playlists sidebar):
- **0%**: Low track only (Ambient)
- **25%**: Mid track only (Low fades out)
- **50%**: Low + Mid tracks (Rich mix)
- **75%**: Mid + High tracks (Action starts)
- **100%**: All three tracks (Maximum intensity)

**Custom Mix**: Check the "Custom Mix" box to reveal individual sliders for Low, Mid, and High layers.

### Managing Playback & Preloading

- **Preload All**: Click the "Preload All" button in the sidebar (or right-click a playlist -> "Preload Adaptive Audio") to cache files before the session.
- **Resume**: If you refresh the page, the module automatically detects running tracks and resumes distinct layers immediately.

## Settings

Access in **Configure Settings → Module Settings**:

- **Default Intensity**: Starting intensity value (default: 50%)
- **Combat Intensity**: Intensity during combat (default: 100%)
- **Auto-Set Combat Intensity**: Enable/disable automatic combat adjustment
- **Auto-Detect Ovani Layers**: Enable/disable automatic file path filling
- **Master Volume**: Overall volume level for adaptive audio

## Compatibility

- **Foundry VTT**: v13+
- **Systems**: All (system-agnostic)
- **Modules**: No dependencies

## Troubleshooting

**Tracks out of sync?**
- Check console (F12) for drift warnings.
- Ensure audio files are the exact same length and tempo.

**Intensity slider not visible?**
- Ensure you have GM permissions.
- Check Playlists sidebar footer.

## License

This module is provided as-is for use with Foundry VTT.

## Repository

https://github.com/JoshBrodieNZ/adaptive-audio

## Technical Architecture

For developers contributing to this module, here is a breakdown of how it functions:

### Core Concepts
The module functions by **intercepting** Foundry's native audio playback for specific "Adaptive" sounds and replacing it with a custom multi-track player.

1.  **Data Storage**:
    - Configuration is stored exclusively in `flags`:
        - `Playlist`: `flags.adaptive-audio.isAdaptive` (Boolean)
        - `PlaylistSound`: `flags.adaptive-audio.midIntensityPath` & `lowIntensityPath` (Strings)

2.  **The "Hijack" (Patching)**:
    - The module patches `PlaylistSound.prototype.sync`.
    - When `sync()` is called (which acts as the main playback state manager in Foundry), the patch checks if the sound is "Adaptive".
    - If Adaptive, it **returns early**, preventing Foundry from creating or managing its own `Howl` instance. This ensures no double-audio playback.
    - Standard non-adaptive sounds are passed through to the original method.

3.  **Custom Audio Engine (`AdaptiveAudioPlayer`)**:
    - The module uses its own `AdaptiveAudioPlayer` class to manage playback.
    - It listens to `preUpdatePlaylistSound` and `updatePlaylistSound` hooks to detect when a user clicks "Play".
    - Instead of one audio stream, it creates **three** `foundry.audio.Sound` instances (wrappers around `Howl`) for the Low, Mid, and High tracks.
    - All three tracks play simultaneously but with varying volumes based on the global intensity setting.

4.  **Synchronization**:
    - **Drift Monitor**: Since three separate audio instances may drift apart over time, a `DriftMonitor` runs periodically. It checks the `seek` time of the primary track and corrects the secondary tracks if they drift by more than a small threshold.

5.  **UI Injection**:
    - Standard jQuery injection is used for the Intensity Slider (`renderPlaylistDirectory`) and configuration fields (`renderPlaylistConfig`, `renderPlaylistSoundConfig`).

### API (Macros & Modules)

The module exposes its player instance at `game.adaptiveAudio.player`. You can use this to control intensity via macros.

**Set Intensity Immediately**
```javascript
// Set to 50%
game.adaptiveAudio.player.setGlobalIntensity(0.5);
```

**Fade Intensity**
```javascript
// Fade to 100% over 3 seconds
game.adaptiveAudio.player.fadeTo(1.0, 3000);
```
