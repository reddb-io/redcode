process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { text: "x".repeat(12 * 1024 * 1024) } }) + "\n")
process.stdin.resume()
