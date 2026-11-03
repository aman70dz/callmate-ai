import WebSocket, { WebSocketServer } from 'ws';
import { env } from '../config/env.js';
import { repository } from '../services/repository.js';
import { buildAgentInstructions } from '../services/agentInstructions.js';

// Exotel streams raw mono PCM16 little-endian at 24 kHz.
// Google Gemini Multimodal Live API also streams raw mono PCM16 at 24 kHz (audio/pcm;rate=24000).
// This allows direct, low-latency streaming without audio resampling.
export function attachVoiceBridge(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/media') return socket.destroy();
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });

  wss.on('connection', (exo, req) => {
    const streamUrl = new URL(req.url, 'http://localhost');
    const taskIdFromUrl = streamUrl.searchParams.get('taskId');
    let audioOutBuffer = Buffer.alloc(0);
    let streamSid = null;
    let task = null;
    let ai = null;
    let ready = false;
    let stopped = false;

    const sendExotel = (event, payload = {}) => {
      if (exo.readyState === WebSocket.OPEN && streamSid) {
        exo.send(JSON.stringify({ event, stream_sid: streamSid, ...payload }));
      }
    };

    const flushAudio = (final = false) => {
      // Exotel recommends PCM chunks in multiples of 320 bytes; buffer small
      // audio deltas into >=3200-byte packets before sending to the telephony stream.
      while (audioOutBuffer.length >= 3200) {
        const size = Math.min(32000, Math.floor(audioOutBuffer.length / 320) * 320);
        const chunk = audioOutBuffer.subarray(0, size);
        audioOutBuffer = audioOutBuffer.subarray(size);
        sendExotel('media', { media: { payload: chunk.toString('base64') } });
      }
      if (final && audioOutBuffer.length >= 320) {
        const size = Math.floor(audioOutBuffer.length / 320) * 320;
        const chunk = audioOutBuffer.subarray(0, size);
        audioOutBuffer = audioOutBuffer.subarray(size);
        sendExotel('media', { media: { payload: chunk.toString('base64') } });
      }
    };

    const closeBoth = () => {
      stopped = true;
      if (ai && ai.readyState === WebSocket.OPEN) ai.close();
      if (exo.readyState === WebSocket.OPEN) exo.close();
    };

    exo.on('message', async raw => {
      let packet;
      try {
        packet = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (packet.event === 'start') {
        streamSid = packet.start?.stream_sid || packet.stream_sid;
        const callSid = packet.start?.call_sid;
        const attempt = callSid ? await repository.getAttemptByProviderSid(callSid) : null;
        task = taskIdFromUrl
          ? await repository.getTask(taskIdFromUrl)
          : (attempt ? await repository.getTask(attempt.task_id) : null);

        if (!task) return closeBoth();
        if (!env.GEMINI_API_KEY) {
          console.error('[VoiceBridge] Cannot connect to Gemini Live: GEMINI_API_KEY is missing.');
          return closeBoth();
        }

        const modelConfig = env.GEMINI_REALTIME_MODEL || 'models/gemini-2.5-flash-native-audio-latest';
        const modelName = modelConfig.startsWith('models/') ? modelConfig : `models/${modelConfig}`;
        const geminiLiveUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;

        ai = new WebSocket(geminiLiveUrl);

        ai.on('open', () => {
          console.log(`[VoiceBridge] Connected to Gemini Multimodal Live API (${modelName}). Sending handshake setup...`);
          ai.send(JSON.stringify({
            setup: {
              model: modelName,
              generationConfig: {
                responseModalities: ['AUDIO'],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: {
                      voiceName: env.GEMINI_REALTIME_VOICE || 'Puck'
                    }
                  }
                }
              },
              systemInstruction: {
                parts: [
                  { text: buildAgentInstructions(task) }
                ]
              }
            }
          }));
        });

        ai.on('message', data => {
          let event;
          try {
            event = JSON.parse(data.toString());
          } catch {
            return;
          }

          // Handshake complete
          if (event.setupComplete && !ready) {
            ready = true;
            console.log('[VoiceBridge] Gemini Live session established. Triggering opening greeting...');
            ai.send(JSON.stringify({
              clientContent: {
                turns: [
                  {
                    role: 'user',
                    parts: [
                      {
                        text: 'Greet the recipient now. Identify yourself as an AI assistant calling on behalf of the user, then explain the purpose of the call.'
                      }
                    ]
                  }
                ],
                turnComplete: true
              }
            }));
          }

          // Process incoming synthesized audio chunks from Gemini
          if (event.serverContent?.modelTurn?.parts) {
            for (const part of event.serverContent.modelTurn.parts) {
              const audioBase64 = part.inlineData?.data || part.data;
              if (audioBase64) {
                audioOutBuffer = Buffer.concat([audioOutBuffer, Buffer.from(audioBase64, 'base64')]);
                flushAudio(false);
              }
            }
          }

          if (event.serverContent?.turnComplete) {
            flushAudio(true);
          }

          // Barge-in / interruption handling
          if (event.serverContent?.interrupted) {
            console.log('[VoiceBridge] Recipient interrupted CallMate; clearing Exotel audio playback buffer.');
            audioOutBuffer = Buffer.alloc(0);
            sendExotel('clear');
          }
        });

        ai.on('error', err => {
          console.error('[VoiceBridge] Gemini Live WebSocket error:', err.message);
        });

        ai.on('close', (code, reason) => {
          console.log(`[VoiceBridge] Gemini Live socket closed (${code}: ${reason?.toString() || 'normal'})`);
          if (!stopped) closeBoth();
        });
      } else if (packet.event === 'media' && ai?.readyState === WebSocket.OPEN && ready) {
        // Stream Exotel audio chunk to Gemini Live
        if (packet.media?.payload) {
          ai.send(JSON.stringify({
            realtimeInput: {
              mediaChunks: [
                {
                  mimeType: 'audio/pcm;rate=24000',
                  data: packet.media.payload
                }
              ]
            }
          }));
        }
      } else if (packet.event === 'stop') {
        flushAudio(true);
        closeBoth();
      }
    });

    exo.on('close', closeBoth);
    exo.on('error', err => {
      console.error('[VoiceBridge] Exotel socket error:', err.message);
      closeBoth();
    });
  });

  return wss;
}
