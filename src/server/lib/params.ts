// Express 5 types a route param as `string | string[]` (wildcards can
// repeat), so every one of them gets flattened to the single value a `:id`-
// or `:token`-style route actually means.
export const param = (value: string | string[]): string =>
  Array.isArray(value) ? value[0]! : value;
