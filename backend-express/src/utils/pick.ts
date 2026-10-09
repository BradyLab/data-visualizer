/**
 * Builds a partial object containing only the listed keys that are defined on body.
 * @param body untrusted input (e.g. req.body); null/undefined is treated as {}
 * @param keys whitelist of keys to copy
 */
export const pick = <T extends object>(body: unknown, keys: readonly (keyof T)[]): Partial<T> => {
    const source = (body ?? {}) as Partial<T>;
    const result: Partial<T> = {};
    for (const key of keys) {
        if (source[key] !== undefined) result[key] = source[key];
    }
    return result;
};
