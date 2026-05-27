/**
 * Public audio surface.
 */

export { AudioController } from './controller';
export type {
  AudioBackend,
  Chord,
  ChordProgression,
  LoopName,
  SfxName,
  SfxSpec,
  Waveform,
} from './types';
export { SFX } from './sfxBank';
export { DEFAULT_PROGRESSION, PROGRESSIONS } from './progressions';
export { WebAudioBackend } from './webAudioBackend';
export { mountVolumeMixer } from './dom/volumeMixer';
