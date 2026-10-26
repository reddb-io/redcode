import type { ChangeReviewContract } from "../../src/core/contracts/changereview";
export type { ReviewChange, ReviewState } from "../../src/core/change-review";
export interface ChangeReviewProps extends ChangeReviewContract {
    /** Additional composition classes. */
    className?: string;
}
export declare function ChangeReview({ title, items, applying, blockedReason, onapplyrequest, ondiscardrequest, beforeLabel, afterLabel, applyLabel, discardLabel, discardItemLabel, emptyLabel, pendingLabel, applyingLabel, appliedLabel, failedLabel, headingLevel, className, }: ChangeReviewProps): import("react").JSX.Element;
export default ChangeReview;
