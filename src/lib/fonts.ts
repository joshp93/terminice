/**
 * Monospace font stack shared by the terminal and the composer.
 *
 * Nerd Font variants come first so prompt themes that draw private-use glyphs
 * (Powerlevel10k, oh-my-posh, PowerUp) render their icons instead of blanks.
 */
export const MONO_FONT_STACK =
  '"MesloLGLDZ Nerd Font Mono", "MesloLGM Nerd Font Mono", "MesloLGL Nerd Font Mono", "Cascadia Code", Consolas, "Courier New", monospace';
