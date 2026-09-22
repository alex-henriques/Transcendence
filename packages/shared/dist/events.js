/** Narrowing helper used by both channel clients. */
export function isServerEvent(value) {
    return (typeof value === 'object' &&
        value !== null &&
        typeof value.type === 'string');
}
