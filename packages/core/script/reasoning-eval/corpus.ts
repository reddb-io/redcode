import { Schema } from "effect"
import { codingCases } from "./coding-cases"
import { challengeCases } from "./challenge-cases"

export const Corpus = Schema.Literals(["original", "challenge"])

export function codingCorpus(corpus: typeof Corpus.Type) {
  return corpus === "challenge" ? challengeCases : codingCases
}
