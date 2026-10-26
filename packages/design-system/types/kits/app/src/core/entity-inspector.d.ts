export interface InspectorEntity {
    /** Stable application-owned identity. */
    id: string;
    /** Visible entity title. */
    label: string;
    /** Supporting context beneath the title. */
    description?: string;
}
export declare function inspectedEntity(items: readonly InspectorEntity[], selected: string | null): {
    entity: InspectorEntity;
    index: number;
    previous: string;
    next: string | undefined;
};
