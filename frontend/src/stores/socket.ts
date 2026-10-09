// Pinia store owning the websocket connection. It connects while logged in, disconnects on logout, and lets other stores
// and views subscribe to the server's push events (see @commons/socket.ts) with on(), which survives reconnects
import { ref, watch } from "vue";
import { defineStore } from "pinia";
import { io, type Socket } from "socket.io-client";
import {
    SOCKET_PATH,
    SocketEvent,
    type ClientToServerEvents,
    type ISocketAuth,
    type ServerToClientEvents,
} from "@commons/socket";
import { baseOrigin } from "@src/interfaces/general";
import { useAuthStore } from "@src/stores/auth";

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// The handler type of one event, e.g. (event: IDatasetEvent) => void
type Handler<E extends SocketEvent> = ServerToClientEvents[E];

export const useSocketStore = defineStore("socket", () => {
    const auth = useAuthStore();

    // True while the websocket is open. Views can use it to fall back to a manual refresh or show a "live updates paused" hint
    const connected = ref(false);
    // Id of the current connection, or null while disconnected. Sent with the change-password request so the server keeps this session
    // open while it ends the user's other ones
    const socketId = ref<string | null>(null);
    // Incremented on every (re)connect after the first, so a store can refetch what it may have missed while offline
    const reconnects = ref(0);

    // Not reactive: the socket is an implementation detail, only `connected` is state
    let socket: AppSocket | null = null;
    let hasConnected = false;
    // Handlers registered with on(), kept here (not on the socket) so they stay attached when the socket is replaced at login
    const handlers = new Map<SocketEvent, Set<(...args: never[]) => void>>();

    // Opens the connection with the current token (does nothing if one is already open)
    function connect() {
        if (socket || !auth.token) return;
        const next: AppSocket = io(baseOrigin, {
            path: SOCKET_PATH,
            // A function, so every reconnect sends the current token (it changes when the user logs in again)
            auth: (cb) => cb({ token: auth.token ?? "" } satisfies ISocketAuth),
        });
        next.on("connect", () => {
            connected.value = true;
            socketId.value = next.id ?? null;
            if (hasConnected) reconnects.value++;
            hasConnected = true;
        });
        next.on("disconnect", () => {
            connected.value = false;
            socketId.value = null;
        });
        // The server refuses a bad or expired token with a connect_error; the REST 401 handler logs the user out, so only log it
        next.on("connect_error", (err) => console.warn("[SOCKET] Connection failed:", err.message));
        // One forwarder for every event instead of one listener per event name
        next.onAny((event: SocketEvent, ...args: unknown[]) => {
            handlers.get(event)?.forEach((handler) => (handler as (...a: unknown[]) => void)(...args));
        });
        socket = next;
    }

    // Closes the connection; subscriptions made with on() are kept for the next login
    function disconnect() {
        socket?.close();
        socket = null;
        connected.value = false;
        socketId.value = null;
        hasConnected = false;
    }

    /**
     * Subscribes to a server event and returns a function that unsubscribes. Can be called before the socket is connected.
     * In a component, call the returned function in onUnmounted so the handler doesn't outlive the page
     */
    function on<E extends SocketEvent>(event: E, handler: Handler<E>) {
        let set = handlers.get(event);
        if (!set) handlers.set(event, (set = new Set()));
        set.add(handler as (...args: never[]) => void);
        return () => {
            set.delete(handler as (...args: never[]) => void);
        };
    }

    // Follow the login: connect once there is a token, and reconnect with the new one if it changes (a different user)
    watch(
        () => auth.token,
        (token) => {
            disconnect();
            if (token) connect();
        },
        { immediate: true }
    );

    // The server ended the session (user deleted or deactivated, role or password changed): log out without waiting for a 401
    on(SocketEvent.SESSION_REVOKED, () => {
        void auth.logout();
    });

    return { connected, socketId, reconnects, connect, disconnect, on };
});
