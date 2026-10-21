// Tests for the socket store: connecting with the login, dispatching server events to subscribers, and logging out when the session is revoked
// (socket.io-client is replaced by a fake socket that the test drives)
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { io } from "socket.io-client";
import { SocketEvent } from "@commons/socket";
import { useAuthStore } from "@src/stores/auth";
import { useSocketStore } from "@src/stores/socket";

// Just enough of a socket: listeners by name, the catch-all listener and close()
class FakeSocket {
    id: string | undefined = "sock-1";
    listeners = new Map<string, (...args: unknown[]) => void>();
    anyListener: ((event: string, ...args: unknown[]) => void) | null = null;
    close = vi.fn();
    on(event: string, listener: (...args: unknown[]) => void) {
        this.listeners.set(event, listener);
        return this;
    }
    onAny(listener: (event: string, ...args: unknown[]) => void) {
        this.anyListener = listener;
        return this;
    }
}

vi.mock("socket.io-client", () => ({ io: vi.fn() }));
vi.mock("@src/api/auth", () => ({
    authApi: { login: vi.fn(), logout: vi.fn().mockResolvedValue(undefined), me: vi.fn(), changePassword: vi.fn() },
}));
vi.mock("@src/router", () => ({ default: { push: vi.fn() } }));

let sockets: FakeSocket[];

beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    sockets = [];
    vi.mocked(io).mockImplementation((() => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
    }) as never);
    setActivePinia(createPinia());
});

// Logs in on the auth store, which makes the socket store connect
const login = async (token = "tok") => {
    useAuthStore().token = token;
    await nextTick();
};

describe("connection", () => {
    it("does not connect while logged out", () => {
        const store = useSocketStore();
        expect(io).not.toHaveBeenCalled();
        expect(store.connected).toBe(false);
    });

    it("connects once there is a token, and reports the connection and its id", async () => {
        const store = useSocketStore();
        await login();
        expect(io).toHaveBeenCalledTimes(1);
        sockets[0]!.listeners.get("connect")!();
        expect(store.connected).toBe(true);
        expect(store.socketId).toBe("sock-1");
        sockets[0]!.listeners.get("disconnect")!();
        expect(store.connected).toBe(false);
        expect(store.socketId).toBeNull();
    });

    it("sends the current token with every (re)connect", async () => {
        useSocketStore();
        await login("first");
        const options = vi.mocked(io).mock.calls[0]![1] as { auth: (cb: (data: unknown) => void) => void };
        const send = vi.fn();
        options.auth(send);
        expect(send).toHaveBeenCalledWith({ token: "first" });
        useAuthStore().token = "second";
        options.auth(send);
        expect(send).toHaveBeenLastCalledWith({ token: "second" });
    });

    it("counts reconnects but not the first connect", async () => {
        const store = useSocketStore();
        await login();
        const connect = sockets[0]!.listeners.get("connect")!;
        connect();
        expect(store.reconnects).toBe(0);
        connect();
        connect();
        expect(store.reconnects).toBe(2);
    });

    it("closes on logout and opens a new connection for the next login", async () => {
        useSocketStore();
        await login("one");
        useAuthStore().token = null;
        await nextTick();
        expect(sockets[0]!.close).toHaveBeenCalled();
        await login("two");
        expect(sockets).toHaveLength(2);
    });

    it("replaces the connection when a different token arrives", async () => {
        useSocketStore();
        await login("one");
        await login("two");
        expect(sockets[0]!.close).toHaveBeenCalled();
        expect(sockets).toHaveLength(2);
    });
});

describe("events", () => {
    it("delivers an event to every subscriber, and stops after unsubscribing", async () => {
        const store = useSocketStore();
        await login();
        const a = vi.fn();
        const b = vi.fn();
        const stopA = store.on(SocketEvent.DATASET_DELETED, a);
        store.on(SocketEvent.DATASET_DELETED, b);
        sockets[0]!.anyListener!(SocketEvent.DATASET_DELETED, { id: "d" });
        expect(a).toHaveBeenCalledWith({ id: "d" });
        expect(b).toHaveBeenCalledWith({ id: "d" });
        stopA();
        sockets[0]!.anyListener!(SocketEvent.DATASET_DELETED, { id: "e" });
        expect(a).toHaveBeenCalledTimes(1);
        expect(b).toHaveBeenCalledTimes(2);
    });

    it("keeps subscriptions made before connecting and across logins", async () => {
        const store = useSocketStore();
        const handler = vi.fn();
        store.on(SocketEvent.USER_DELETED, handler);
        await login("one");
        useAuthStore().token = null;
        await nextTick();
        await login("two");
        sockets[1]!.anyListener!(SocketEvent.USER_DELETED, { id: "u" });
        expect(handler).toHaveBeenCalledWith({ id: "u" });
    });

    it("a handler that throws does not stop the others", async () => {
        const store = useSocketStore();
        await login();
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const after = vi.fn();
        store.on(SocketEvent.FILE_REMOVED, () => {
            throw new Error("boom");
        });
        store.on(SocketEvent.FILE_REMOVED, after);
        sockets[0]!.anyListener!(SocketEvent.FILE_REMOVED, { id: "f" });
        expect(after).toHaveBeenCalled();
        expect(error).toHaveBeenCalled();
    });

    it("logs the user out when the server revokes the session", async () => {
        const auth = useAuthStore();
        const logout = vi.spyOn(auth, "logout").mockResolvedValue(undefined as never);
        useSocketStore();
        await login();
        sockets[0]!.anyListener!(SocketEvent.SESSION_REVOKED, { reason: "PASSWORD_CHANGED" });
        expect(logout).toHaveBeenCalled();
    });

    it("only warns when the server refuses the connection", async () => {
        useSocketStore();
        await login();
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        sockets[0]!.listeners.get("connect_error")!(new Error("Unauthorized"));
        expect(warn).toHaveBeenCalled();
    });
});
