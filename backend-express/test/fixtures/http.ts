// Stand-ins for Express's request and response, so controllers and middleware can be called directly in tests
export interface FakeRes {
    statusCode: number;
    body: unknown;
    ended: boolean;
    locals: Record<string, unknown>;
    status: (code: number) => FakeRes;
    json: (body: unknown) => FakeRes;
    send: (body?: unknown) => FakeRes;
}

/** A response that records the status and body the handler sends; locals holds what the auth middleware would have set */
export const fakeRes = (locals: Record<string, unknown> = {}): FakeRes => {
    const res: FakeRes = {
        statusCode: 200,
        body: undefined,
        ended: false,
        locals,
        status: (code) => {
            res.statusCode = code;
            return res;
        },
        json: (body) => {
            res.body = body;
            res.ended = true;
            return res;
        },
        send: (body) => {
            res.body = body;
            res.ended = true;
            return res;
        },
    };
    return res;
};

/** A request with only the parts the handlers read */
export const fakeReq = (parts: { params?: Record<string, string>; body?: unknown; query?: Record<string, unknown>; headers?: Record<string, string> } = {}) =>
    ({ params: {}, body: {}, query: {}, headers: {}, ...parts }) as never;
