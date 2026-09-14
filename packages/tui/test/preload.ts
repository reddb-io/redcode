// No TUI test may launch a real browser (Design review, links, OAuth); launcher tests inject fakes.
process.env.REDCODE_NO_BROWSER = "1"
process.env.REDCODE_DESIGN_NO_OPEN = "1"
