import {
  Definition,
  Operation,
  type Data,
  type ParallelDefinition,
  type Payload,
  type SerialDefinition,
  type WaterfallDefinition,
} from "../effect/operation-hook.js"
import type { Registration } from "./registration.js"

export { Definition, Operation }
export type { Data, Payload }

export type Next<D extends WaterfallDefinition> = (data?: Data<D>) => Promise<Data<D>>
export type WaterfallHandler<D extends WaterfallDefinition> = (
  event: Payload<D>,
  next: Next<D>,
) => Promise<Data<D>> | Data<D>
export type Observer<D extends SerialDefinition | ParallelDefinition> = (event: Payload<D>) => Promise<void> | void

export interface Hooks {
  readonly waterfall: <D extends WaterfallDefinition>(
    definition: D,
    callback: WaterfallHandler<D>,
  ) => Promise<Registration>
  readonly serial: <D extends SerialDefinition>(definition: D, callback: Observer<D>) => Promise<Registration>
  readonly parallel: <D extends ParallelDefinition>(definition: D, callback: Observer<D>) => Promise<Registration>
}
