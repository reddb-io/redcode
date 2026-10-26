import { type ReactNode } from "react";
import type { ErrorBoundaryContract } from "../../src/core/contracts/errorboundary";
export interface ErrorBoundaryProps extends ErrorBoundaryContract {
    /** Native child region; client render failures are contained here. */
    children?: ReactNode;
    /** Optional caller-owned safe recovery content, receiving the error and retry operation. */
    fallback?: (context: {
        error: unknown;
        retry: () => void;
    }) => ReactNode;
    /** Additional classes on the failed region. */
    className?: string;
}
export declare function ErrorBoundary({ title, description, retryLabel, resetKey, ...props }: ErrorBoundaryProps): import("react").JSX.Element;
export default ErrorBoundary;
