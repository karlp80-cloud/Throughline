/**
 * Public theme surface.
 */

export { applyTheme, DEFAULT_PALETTE, type AppliedTheme, type ApplyOptions } from './applier';
export {
  AA_BODY_RATIO,
  contrastRatio,
  relativeLuminance,
  validatePalette,
  type PaletteValidation,
} from './contrast';
export { findMissingTokens, substitute, type Vocab } from './vocabulary';
