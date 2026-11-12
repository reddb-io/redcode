export default {
  id: "creator.echo",
  async setup(ctx) {
    await ctx.tool.transform((editor) =>
      editor.add({
        name: "creator_echo",
        description: "Echo text without side effects",
        options: { codemode: false },
        input: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
          additionalProperties: false,
        },
        async execute(input) {
          return { content: input.text }
        },
      }),
    )
  },
}
