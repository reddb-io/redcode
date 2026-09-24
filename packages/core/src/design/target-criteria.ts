export * as DesignTargetCriteria from "./target-criteria"

/**
 * What System One chooses between when it classifies a design's target, shared by the `design_target`
 * operation and the per-message prompt classification. Kept free of imports so the intelligence
 * module can use it without a cycle.
 */

export const TARGETS = {
  web: "A website or web application used in a browser, responsive across phone, tablet and desktop widths",
  app: "A mobile app for phones, with native iOS or Android screens, navigation and controls",
  presentation: "A slide deck, talk, pitch or other paced presentation shown one slide at a time",
}

export const PLATFORMS = {
  ios: "An iPhone or iOS app, following Apple's Human Interface Guidelines",
  android: "An Android app, following Material Design",
  either: "Both platforms, no platform named or implied, or not a mobile app at all",
}
