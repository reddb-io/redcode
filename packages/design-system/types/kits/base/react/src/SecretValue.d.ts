import type { SecretValueContract } from "../../src/core/contracts/secretvalue";
export interface SecretValueProps extends SecretValueContract {
    /** Additional composition classes. */
    className?: string;
}
export declare function SecretValue(props: SecretValueProps): import("react").JSX.Element;
export default SecretValue;
