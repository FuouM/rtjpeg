export type ComparisonMode = "off" | "sideBySide" | "sliding";

export const comparisonState = {
  mode: "off" as ComparisonMode,
  /** 0–100: split position from the left (sliding mode). */
  sliderPercent: 50,
};
