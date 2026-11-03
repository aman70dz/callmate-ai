import axios from 'axios';
import { env, liveCallsEnabled } from '../config/env.js';

export function escapeXml(unsafe) {
  if (unsafe === null || unsafe === undefined) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildTwilioVoiceTwiML({ openingStatement, gatherUrl, language = 'en' }) {
  const isHindi = language === 'hi';
  const lang = isHindi ? 'hi-IN' : 'en-IN';
  const voice = 'Polly.Aditi';
  const noInputMsg = isHindi
    ? 'मुझे कोई आवाज़ नहीं सुनाई दी। धन्यवाद, अलविदा।'
    : 'I did not receive any response. Thank you, goodbye.';

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}" language="${lang}">${escapeXml(openingStatement)}</Say>
  <Gather input="speech" action="${escapeXml(gatherUrl)}" method="POST" speechTimeout="auto" language="${lang}">
  </Gather>
  <Say voice="${voice}" language="${lang}">${escapeXml(noInputMsg)}</Say>
  <Hangup/>
</Response>`;
}

export function buildTwilioGatherTwiML({ reply, gatherUrl, language = 'en', endCall = false }) {
  const isHindi = language === 'hi';
  const lang = isHindi ? 'hi-IN' : 'en-IN';
  const voice = 'Polly.Aditi';

  if (endCall) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}" language="${lang}">${escapeXml(reply)}</Say>
  <Hangup/>
</Response>`;
  }

  const noInputMsg = isHindi
    ? 'धन्यवाद, आपसे बात करके अच्छा लगा। अलविदा।'
    : 'Thank you for your time. Goodbye.';

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}" language="${lang}">${escapeXml(reply)}</Say>
  <Gather input="speech" action="${escapeXml(gatherUrl)}" method="POST" speechTimeout="auto" language="${lang}">
  </Gather>
  <Say voice="${voice}" language="${lang}">${escapeXml(noInputMsg)}</Say>
  <Hangup/>
</Response>`;
}

export async function placeTwilioCall({ phoneNumber, taskId }) {
  if (!liveCallsEnabled) {
    throw new Error('Live calling is disabled. Set ENABLE_LIVE_CALLS=true in .env to place live phone calls.');
  }

  const sid = env.TWILIO_ACCOUNT_SID;
  const token = env.TWILIO_AUTH_TOKEN;
  const from = env.TWILIO_PHONE_NUMBER;
  const rawBase = (env.APP_BASE_URL || '').replace(/\/$/, '');

  if (!sid || !token || !from) {
    throw new Error('Missing Twilio credentials: set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in .env');
  }

  if (!rawBase || rawBase.includes('YOUR_PUBLIC_HTTPS_HOST')) {
    throw new Error('APP_BASE_URL must be a reachable public HTTPS URL (Render, ngrok, or Cloudflare Tunnel) so Twilio can fetch call instructions.');
  }

  const voiceUrl = `${rawBase}/webhooks/twilio/voice?taskId=${encodeURIComponent(taskId)}`;
  const statusCallback = `${rawBase}/webhooks/twilio/status?taskId=${encodeURIComponent(taskId)}`;

  const params = new URLSearchParams();
  params.append('To', phoneNumber);
  params.append('From', from);
  params.append('Url', voiceUrl);
  params.append('StatusCallback', statusCallback);
  params.append('StatusCallbackMethod', 'POST');
  params.append('StatusCallbackEvent', 'initiated');
  params.append('StatusCallbackEvent', 'ringing');
  params.append('StatusCallbackEvent', 'answered');
  params.append('StatusCallbackEvent', 'completed');

  const authHeader = 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64');
  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`;

  const response = await axios.post(endpoint, params.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': authHeader
    },
    timeout: 20000
  });

  const call = response.data;
  if (!call?.sid) {
    throw new Error('Twilio call creation response did not contain a Call SID.');
  }

  return { sid: call.sid, status: call.status };
}

