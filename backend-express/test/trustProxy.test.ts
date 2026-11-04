// Unit tests for utils/trustProxy
import { test } from "node:test";
import assert from "node:assert/strict";
import { clientAddress, trustProxyHops } from "@src/utils/trustProxy.ts";

test("trustProxyHops is 0 when unset or empty", () => {
    assert.equal(trustProxyHops(undefined), 0);
    assert.equal(trustProxyHops(""), 0);
    assert.equal(trustProxyHops("  "), 0);
});

test("trustProxyHops reads a whole number", () => {
    assert.equal(trustProxyHops("1"), 1);
    assert.equal(trustProxyHops(" 2 "), 2);
    assert.equal(trustProxyHops("0"), 0);
});

test("trustProxyHops refuses anything that is not a count, including trusting everyone", () => {
    for (const bad of ["true", "false", "loopback", "10.0.0.0/8", "-1", "1.5"]) assert.throws(() => trustProxyHops(bad), /TRUST_PROXY/);
});

test("clientAddress is the socket address without proxies, whatever the header says", () => {
    assert.equal(clientAddress("6.6.6.6", "10.0.0.2", 0), "10.0.0.2");
});

test("clientAddress takes the entry the last trusted proxy added", () => {
    assert.equal(clientAddress("203.0.113.9", "172.18.0.5", 1), "203.0.113.9");
    // A client-supplied first entry is ignored: only the rightmost counts with one proxy
    assert.equal(clientAddress("6.6.6.6, 203.0.113.9", "172.18.0.5", 1), "203.0.113.9");
    assert.equal(clientAddress("203.0.113.9, 10.1.1.1", "172.18.0.5", 2), "203.0.113.9");
    assert.equal(clientAddress(["6.6.6.6", "203.0.113.9"], "172.18.0.5", 1), "203.0.113.9");
});

test("clientAddress falls back to the socket address when the header is missing or too short", () => {
    assert.equal(clientAddress(undefined, "172.18.0.5", 1), "172.18.0.5");
    assert.equal(clientAddress("", "172.18.0.5", 1), "172.18.0.5");
    assert.equal(clientAddress("203.0.113.9", "172.18.0.5", 2), "172.18.0.5");
});
