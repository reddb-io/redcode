import type { EntityJourneyContract } from "../../src/core/contracts/entityjourney";
export type { JourneyStage, JourneyState } from "../../src/core/entity-journey";
export interface EntityJourneyProps extends EntityJourneyContract {
    /** Additional root composition classes. */
    className?: string;
}
export declare function EntityJourney({ label, items, selected, onselectedchange, emptyLabel, className, }: EntityJourneyProps): import("react").JSX.Element;
export default EntityJourney;
