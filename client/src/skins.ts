// Shared skin helpers for the Shop and Cosmetics screens.
//
// A skin's id IS a palette token key (ADR 0010) — the id 'gold' is
// palette.gold. Nothing here maps a name to a hex value, so nothing can drift
// out of step with palette.ts. This used to live in garage.ts, which the
// title screen split into three dedicated screens; both of the two that deal
// in skins need it, so it is its own module rather than one importing the
// other.
import { palette } from "./palette.ts";
import type { PaletteKey } from "./palette.ts";
import type { Skin } from "./net.ts";

/** The free default trim. Deliberately not a row in the `skins` table. */
export const DEFAULT_SKIN_ID = "default";

export function skinColor(id: string | null): number {
  if (id && id in palette) return palette[id as PaletteKey].three;
  return palette.magenta.three; // the free default
}

export function skinHex(id: string | null): string {
  if (id && id in palette) return palette[id as PaletteKey].hex;
  return palette.magenta.hex;
}

/**
 * The free magenta trim, shaped like a catalogue row so the two screens can
 * render it with the same code as everything else. `equipped` is true exactly
 * when no purchased skin is.
 */
export function defaultSkinRow(skins: Skin[]): Skin {
  return {
    id: DEFAULT_SKIN_ID,
    name: "Magenta trim",
    cost: 0,
    owned: true,
    equipped: !skins.some((s) => s.equipped),
  };
}

/** The glowing dot that stands for a trim colour. */
export function swatch(id: string): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = "skin-swatch";
  const hex = skinHex(id === DEFAULT_SKIN_ID ? null : id);
  el.style.background = hex;
  el.style.boxShadow = `0 0 10px ${hex}`;
  return el;
}
