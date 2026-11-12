// JSON Inspector — plugin de servidor do Redcode (SDK)
//
// Duas ferramentas de agente, somente leitura:
//   - json_inspect       valida o texto JSON e resume a estrutura.
//   - json_pointer_get   le um valor via JSON Pointer (RFC 6901).
//
// Sem imports e sem dependencias. Sem eval, sem execucao de codigo,
// sem acesso a rede, filesystem ou credenciais. Nunca modifica arquivos.

function jsonType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const t = typeof value;
  if (t === "object") return "object";
  return t; // "string" | "number" | "boolean"
}

// Contagem iterativa (pilha explicita, sem recursao) para tolerar documentos profundos.
// Somente propriedades proprias: Object.keys em objetos JSON.parse; indices proprios em arrays.
function summarize(root) {
  const counts = { objects: 0, arrays: 0, keys: 0, values: 0 };
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    counts.values += 1;
    if (Array.isArray(node)) {
      counts.arrays += 1;
      const keys = Object.keys(node);
      for (let i = 0; i < keys.length; i++) stack.push(node[keys[i]]);
    } else if (node !== null && typeof node === "object") {
      counts.objects += 1;
      const keys = Object.keys(node);
      counts.keys += keys.length;
      for (let i = 0; i < keys.length; i++) stack.push(node[keys[i]]);
    }
  }
  return counts;
}

function parseJsonText(text) {
  if (typeof text !== "string") {
    return { error: "Input 'json' must be a string containing JSON text." };
  }
  try {
    return { value: JSON.parse(text) };
  } catch (err) {
    const message = err && typeof err.message === "string" ? err.message : String(err);
    return { error: "Invalid JSON: " + message };
  }
}

function unescapePointerToken(rawToken, segmentIndex) {
  if (rawToken.indexOf("~") === -1) return { token: rawToken };
  let out = "";
  for (let i = 0; i < rawToken.length; i++) {
    const ch = rawToken[i];
    if (ch !== "~") {
      out += ch;
      continue;
    }
    const next = rawToken[i + 1];
    if (next !== "0" && next !== "1") {
      return {
        error:
          "Invalid JSON Pointer escape in segment " +
          segmentIndex +
          ": '~' must be written as '~0' (literal ~) or '~1' (literal /).",
      };
    }
    out += next === "0" ? "~" : "/";
    i += 1;
  }
  return { token: out };
}

// JSON Pointer (RFC 6901): "" = documento inteiro; "/a/b" = chaves;
// indices de array exigem canonical form ("0", "12"; "01", "-1", "+" sao invalidos);
// escapes ~0 -> ~ e ~1 -> /, com escape malformado rejeitado.
// Somente propriedades proprias; primitivos nunca sao tratados como objetos.
function resolvePointer(root, pointer) {
  if (typeof pointer !== "string") {
    return { error: "Input 'pointer' must be a string (RFC 6901 JSON Pointer)." };
  }
  if (pointer === "") return { value: root };
  if (pointer.charAt(0) !== "/") {
    return { error: "Invalid JSON Pointer: a non-empty pointer must start with '/'." };
  }
  const rawTokens = pointer.slice(1).split("/");
  let current = root;
  for (let i = 0; i < rawTokens.length; i++) {
    const raw = rawTokens[i];
    const unescaped = unescapePointerToken(raw, i);
    if (unescaped.error) return { error: unescaped.error };
    const token = unescaped.token;
    if (Array.isArray(current)) {
      if (!/^(0|[1-9][0-9]*)$/.test(token)) {
        return {
          error:
            "JSON Pointer segment " +
            i +
            " ('" +
            raw +
            "') is not a valid array index for the current location.",
        };
      }
      const index = Number(token);
      if (index >= current.length) {
        return {
          error:
            "JSON Pointer segment " +
            i +
            ": array index " +
            index +
            " is out of bounds (length " +
            current.length +
            ").",
        };
      }
      current = current[index];
    } else if (current !== null && typeof current === "object") {
      if (!Object.prototype.hasOwnProperty.call(current, token)) {
        return {
          error: "JSON Pointer segment " + i + ": object has no own key '" + token + "'.",
        };
      }
      current = current[token];
    } else {
      return {
        error:
          "JSON Pointer segment " +
          i +
          " ('" +
          raw +
          "') cannot be resolved: the current value is " +
          jsonType(current) +
          ", not an object or array.",
      };
    }
  }
  return { value: current };
}

export default {
  id: "creator.json-inspector",
  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "json_inspect",
        description: "Validate JSON and summarize its structure without modifying files",
        options: { codemode: false },
        input: {
          type: "object",
          properties: { json: { type: "string" } },
          required: ["json"],
          additionalProperties: false,
        },
        async execute(input) {
          const args = input || {};
          const parsed = parseJsonText(args.json);
          if (parsed.error) {
            return { content: JSON.stringify({ ok: false, error: parsed.error }) };
          }
          const root = parsed.value;
          return {
            content: JSON.stringify({
              ok: true,
              type: jsonType(root),
              counts: summarize(root),
            }),
          };
        },
      });

      editor.add({
        name: "json_pointer_get",
        description:
          "Read the value at an RFC 6901 JSON Pointer inside a JSON text without modifying files",
        options: { codemode: false },
        input: {
          type: "object",
          properties: {
            json: { type: "string" },
            pointer: { type: "string" },
          },
          required: ["json", "pointer"],
          additionalProperties: false,
        },
        async execute(input) {
          const args = input || {};
          const parsed = parseJsonText(args.json);
          if (parsed.error) {
            return { content: JSON.stringify({ ok: false, error: parsed.error }) };
          }
          const resolved = resolvePointer(parsed.value, args.pointer);
          if (resolved.error) {
            return { content: JSON.stringify({ ok: false, error: resolved.error }) };
          }
          return {
            content: JSON.stringify({
              ok: true,
              pointer: args.pointer,
              value: resolved.value,
              type: jsonType(resolved.value),
            }),
          };
        },
      });
    });
  },
};
