import type { SecretValueContract, SecretHideReason } from "./contracts/secretvalue";
export declare function secretIsVisible(options: SecretValueContract): boolean;
/** Portable exposure lifetime. Refreshing props never extends the current deadline. */
export declare function createSecretExposure(read: () => SecretValueContract, publish: (visible: boolean) => void): {
    sync(): void;
    matches(value: string | null | undefined): boolean;
    request(next: boolean): void;
    hide: (reason: SecretHideReason) => void;
    destroy(): void;
};
