import { ApiError, createApi, NetworkError } from '@/api/client'

// The API client is the one place that decides what the app does with a status code, so it
// takes its token source, its 401 handler and fetch itself as dependencies — no keychain and
// no network needed here.
interface FakeResponse {
  status: number
  ok: boolean
  json: () => Promise<unknown>
}

function jsonResponse(status: number, body: unknown): FakeResponse {
  return { status, ok: status >= 200 && status < 300, json: async () => body }
}

function setup(
  response: FakeResponse | (() => never),
  options: { token?: string | null } = {},
) {
  const calls: { url: string; init: RequestInit }[] = []
  const onUnauthorized = jest.fn()
  const fetchImpl = ((url: string, init: RequestInit) => {
    calls.push({ url, init })
    if (typeof response === 'function') return response()
    return Promise.resolve(response)
  }) as unknown as typeof fetch

  const api = createApi({
    baseUrl: 'https://api.test',
    getToken: async () => options.token ?? null,
    onUnauthorized,
    fetchImpl,
  })
  return { api, calls, onUnauthorized }
}

describe('request building', () => {
  it('prefixes the base URL and sends the bearer token', async () => {
    const { api, calls } = setup(jsonResponse(200, [{ id: '1' }]), { token: 'abc123' })
    await api.get('/schedule/today')

    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://api.test/schedule/today')
    const headers = calls[0]!.init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer abc123')
  })

  it('sends no Authorization header when there is no token', async () => {
    const { api, calls } = setup(jsonResponse(200, {}), { token: null })
    await api.get('/auth/me')
    const headers = calls[0]!.init.headers as Record<string, string>
    expect(headers.Authorization).toBeUndefined()
  })

  it('never attaches a token to the login call', async () => {
    const { api, calls } = setup(jsonResponse(200, { token: 't', user: {} }), { token: 'stale' })
    await api.login('Driver@Company.com', 'secret')

    const headers = calls[0]!.init.headers as Record<string, string>
    expect(headers.Authorization).toBeUndefined()
    expect(headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      email: 'Driver@Company.com',
      password: 'secret',
    })
  })

  it('sends no body and no Content-Type on a bodyless POST', async () => {
    const { api, calls } = setup(jsonResponse(200, { skipped: true }), { token: 't' })
    await api.post('/parent/students/1/skip-pickup')

    expect(calls[0]!.init.body).toBeUndefined()
    expect((calls[0]!.init.headers as Record<string, string>)['Content-Type']).toBeUndefined()
  })
})

describe('error handling', () => {
  it("shows the server's own message for a 409", async () => {
    const { api } = setup(
      jsonResponse(409, { error: 'you already worked the Morning shift today and cannot return to it' }),
      { token: 't' },
    )
    await expect(api.post('/sessions/checkin', { shift_period: 'morning' })).rejects.toMatchObject({
      name: 'ApiError',
      status: 409,
      message: 'you already worked the Morning shift today and cannot return to it',
    })
  })

  it("shows the server's own message for a 403 business rule", async () => {
    const { api } = setup(jsonResponse(403, { error: "too late to skip today's pickup" }), { token: 't' })
    await expect(api.post('/parent/students/1/skip-pickup')).rejects.toThrow(
      "too late to skip today's pickup",
    )
  })

  it('falls back to a readable message when the error body is not JSON', async () => {
    const { api } = setup(
      {
        status: 502,
        ok: false,
        json: () => Promise.reject(new Error('not json')),
      },
      { token: 't' },
    )
    const error = await api.get('/trips').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(502)
    expect((error as ApiError).message).toMatch(/try again/i)
  })

  it('reports a failed connection as a NetworkError, not a server error', async () => {
    const { api } = setup(() => {
      throw new TypeError('Network request failed')
    })
    const error = await api.get('/schedule/today').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(NetworkError)
    expect((error as NetworkError).message).toMatch(/connection/i)
  })
})

describe('401 handling', () => {
  it('tears down the session on a 401 from a normal call', async () => {
    const { api, onUnauthorized } = setup(jsonResponse(401, { error: 'invalid token' }), { token: 'expired' })
    await expect(api.get('/schedule/today')).rejects.toBeInstanceOf(ApiError)
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  it('does NOT tear down the session on a 401 from login', async () => {
    // Login's 401 means "invalid credentials" — a wrong password typed by someone who is
    // already signed in must not log them out.
    const { api, onUnauthorized } = setup(jsonResponse(401, { error: 'invalid credentials' }), {
      token: 'still-good',
    })
    await expect(api.login('a@b.test', 'wrong')).rejects.toThrow('invalid credentials')
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it('leaves the session alone on a 403', async () => {
    // 403 is "your role may not do this", not "sign in again".
    const { api, onUnauthorized } = setup(jsonResponse(403, { error: 'forbidden' }), { token: 't' })
    await expect(api.get('/students')).rejects.toThrow('forbidden')
    expect(onUnauthorized).not.toHaveBeenCalled()
  })
})
