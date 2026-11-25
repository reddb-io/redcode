const COLLECTION_STATES = ["loading", "ready", "empty", "error", "refreshing"];
function collectionView(state, itemCount) {
  switch (state) {
    case "loading":
      return { placeholder: "loading", busy: true, stale: false };
    case "error":
      return itemCount > 0 ? { placeholder: null, busy: false, stale: true } : { placeholder: "error", busy: false, stale: false };
    case "refreshing":
      return { placeholder: itemCount > 0 ? null : "loading", busy: true, stale: false };
    case "empty":
      return { placeholder: "empty", busy: false, stale: false };
    default:
      return { placeholder: itemCount > 0 ? null : "empty", busy: false, stale: false };
  }
}
export {
  COLLECTION_STATES,
  collectionView
};
