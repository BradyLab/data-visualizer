// Reverse proxy settings (TRUST_PROXY): how many proxies sit in front of the server, so the real client address can be read from X-Forwarded-For.
// Only a count is supported (1 for the Caddy container in docker-compose.prod.yml): the proxy must overwrite any X-Forwarded-For a client sends,
// and then the entry the last trusted proxy added is the client. Trusting "everyone" would let any client claim any address and dodge the rate limits

/** Number of trusted proxies from TRUST_PROXY, or 0 when unset/empty (no proxy: the socket address is the client). Throws on anything else */
export const trustProxyHops = (value: string | undefined = process.env.TRUST_PROXY) => {
    const text = value?.trim();
    if (!text) return 0;
    if (!/^\d+$/.test(text))
        throw new Error(`TRUST_PROXY must be the number of proxies in front of the server (for example 1), not "${text}"`);
    return Number(text);
};

/**
 * The client's address for a request that came through `hops` trusted proxies: the `hops`-th entry from the right of X-Forwarded-For
 * (each proxy appends the address it saw), or the socket address when there are no proxies or the header has fewer entries than expected
 * (the request did not come through the proxy, so the header cannot be trusted either)
 */
export const clientAddress = (forwardedFor: string | string[] | undefined, socketAddress: string, hops: number) => {
    if (hops <= 0) return socketAddress;
    const list = (Array.isArray(forwardedFor) ? forwardedFor.join(",") : (forwardedFor ?? ""))
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
    return list.length >= hops ? list[list.length - hops]! : socketAddress;
};
