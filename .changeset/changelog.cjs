// Redcode release notes come from the reviewed changeset text.
module.exports = {
  getReleaseLine: async (changeset) => `- ${changeset.summary.replace(/\n/g, "\n  ")}`,
  getDependencyReleaseLine: async () => "",
}
