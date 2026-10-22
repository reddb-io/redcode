const NAVBAR_ALIGNMENTS = ["start", "center"];
const NAVBAR_COLLAPSE = ["responsive", "expanded", "collapsed"];
function arrangements(collapse) {
  return { rail: collapse !== "collapsed", compact: collapse !== "expanded" };
}
export {
  NAVBAR_ALIGNMENTS,
  NAVBAR_COLLAPSE,
  arrangements
};
