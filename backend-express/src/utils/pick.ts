// Copies only the allowed keys from a request body so clients cannot set columns like id or createdAt
export const pick = <T extends object>(body: unknown, keys: readonly (keyof T)[]): Partial<T> => {
    const source = (body ?? {}) as Partial<T>;
    const result: Partial<T> = {};
    for (const key of keys) {
        if (source[key] !== undefined) result[key] = source[key];
    }
    return result;
};
