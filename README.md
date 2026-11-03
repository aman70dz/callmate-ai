# CallMate AI

A personal AI calling assistant starter project: web dashboard, Node/Express API, Supabase persistence, BullMQ retry worker, Exotel outbound voice adapter, and OpenAI Realtime audio bridge.

## Important safety defaults

- `ENABLE_LIVE_CALLS=false` by default. The app cannot place a real call until you deliberately enable it.
- `DATA_MODE=demo` by default. Demo data is stored in memory and disappears when the server restarts.
- The call form requires you to confirm the recipient has agreed to receive the call. Do not call people who have not agreed, and do not use this for spam, harassment, impersonation, or deceptive calls.
- The agent identifies itself as an AI assistant. Respect stop requests and applicable Indian telecom, privacy, and recording requirements.
- The Exotel webhook route is a starter and must be secured with provider-authenticity verification before public deployment.

## Requirements

- Node.js 22+
- Redis (only for the worker / durable retry queue)
- Supabase project for persistent production data
- OpenAI API project with Realtime API access
- Exotel account, ExoPhone, API credentials, and Connect Voice AI enabled for your account
- Public HTTPS/WSS backend URL for Exotel callbacks and audio streaming

## Local demo

1. Copy `.env.example` to `.env`.
2. Leave `DATA_MODE=demo` and `ENABLE_LIVE_CALLS=false`.
3. Install dependencies: `npm install`.
4. Start API: `npm run dev`.
5. Serve `frontend/` with a static server, for example `npx serve frontend -l 5173`.
6. Open `http://localhost:5173`.

The demo lets you create, list, and cancel call tasks. It does not place calls. Demo tasks are in-memory.

## Supabase setup

1. Run `database/schema.sql` in Supabase SQL Editor.
2. Set `DATA_MODE=supabase`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`.
3. Configure Supabase Auth in the frontend and pass the signed-in user's access token as `Authorization: Bearer <token>` to `/api/calls`.
4. Keep the service-role key on the server only. Never expose it in browser JavaScript.
5. Run Redis and set `REDIS_URL`.

The frontend currently uses demo mode without login. Production Supabase mode requires adding the Supabase Auth sign-in UI and attaching the access token to API requests before deployment.

## Exotel / OpenAI live integration

1. Ask Exotel to enable Connect Voice AI / AgentStream for your account and confirm the permitted use case, caller-ID requirements, and local telecom compliance.
2. Configure Exotel credentials and a public `APP_BASE_URL` that supports HTTPS and WSS.
3. The adapter calls `POST /v1/Accounts/{AccountSid}/Calls/connect` with `From`, `CallerId`, `StreamUrl`, `StreamType=bidirectional`, and status callbacks.
4. The StreamUrl requests `sample-rate=24000`. Exotel's AgentStream protocol sends JSON `start`, `media`, and `stop` events. Media payload is base64 raw PCM16 mono little-endian.
5. The voice bridge connects to OpenAI Realtime at `wss://api.openai.com/v1/realtime?model=...` and uses 24 kHz PCM. Test the exact event/audio behavior against the Exotel account before enabling production calls.
6. Secure the webhook with Exotel's current request-authentication mechanism. Add call-attempt lookup, idempotency, authenticated ownership checks, call termination controls, transcript persistence, and end-of-call summaries before production.
7. Only after all provider access, compliance, webhook verification, and test-call checks pass, set `ENABLE_LIVE_CALLS=true` and run `npm run worker` in a separate process.

## Retry behavior

The webhook starter schedules one delayed retry after 10 minutes for `busy`, `no-answer`, or `failed` on attempt 1. It does not retry after attempt 2. Before production, make the state transition atomic (database RPC/transaction + idempotency key) and verify Exotel's exact callback payload and status mapping for your account. A `completed` call status means the call ended; it does not by itself prove a human conversation succeeded.

## Scripts

- `npm run dev` — API with Node watch mode
- `npm start` — API server
- `npm run worker` — BullMQ worker (requires Redis)
- `npm run check` — syntax checks for key server files

## Architecture

`frontend` → Express API → Supabase + BullMQ → Exotel outbound call → Exotel bidirectional WebSocket → OpenAI Realtime → audio back to recipient.


## OpenAI instruction-preparation integration (Phase 2)

1. Copy `.env.example` to `.env` if you have not already.
2. Add your OpenAI API key to `OPENAI_API_KEY` in `.env` (never put it in frontend files or share it in chat).
3. Keep `DATA_MODE=demo` and `ENABLE_LIVE_CALLS=false`.
4. Set `OPENAI_TEXT_MODEL=gpt-5-mini` or another text model available to your API project.
5. Restart `npm run dev`.
6. In the dashboard, enter a recipient name and instruction, then click **Prepare with OpenAI**.

This integration uses the OpenAI Responses API to create a structured call brief and a reply-generation service for later conversation testing. It does not dial a phone number. Live phone audio remains a separate Realtime + Exotel integration and stays disabled by default.
