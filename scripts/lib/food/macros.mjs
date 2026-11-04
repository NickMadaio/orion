// Macros are said in words ("6 g protein, 23 g carbs, 8 g fat"): written "6P 23C 8F" is read badly aloud, and the F was once
// rewritten as a temperature (2026-11-04). Every food reply builds its macros here.
export const macroWords = ({ p, c, f }) => `${Math.round(p)} g protein, ${Math.round(c)} g carbs, ${Math.round(f)} g fat`;
